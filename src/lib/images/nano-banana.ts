import { GoogleGenAI } from "@google/genai";
import { appConfig } from "@/lib/config";
import { generateNanoBananaImage as generateNanoBananaImageViaOpenrouter } from "@/lib/images/nano-banana.openrouter";
import type { AspectRatio } from "@/lib/types/skills";

export const DEFAULT_NEGATIVE_PROMPT = [
  "text",
  "letters",
  "watermark",
  "logo",
  "signature",
  "blurry",
  "low quality",
  "distorted",
  "artifact",
  "overexposed",
  "oversaturated",
  "cluttered background"
].join(", ");

/** Use when we explicitly want text rendered on the image (e.g. quote slides). */
export const NEGATIVE_PROMPT_WITH_TEXT_ON_IMAGE = [
  "watermark",
  "logo",
  "signature",
  "blurry",
  "low quality",
  "distorted",
  "artifact",
  "overexposed",
  "oversaturated",
  "cluttered background"
].join(", ");

const RATIO_DIMENSIONS: Record<AspectRatio, { width: number; height: number }> = {
  "4:5": { width: 1200, height: 1500 },
  "1:1": { width: 1200, height: 1200 },
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1600, height: 900 }
};

const OPENROUTER_RATE_LIMIT_FALLBACK_MODEL = "google/gemini-2.5-flash-image";

type GenerateImageInput = {
  prompt: string;
  aspectRatio: AspectRatio;
  negativePrompt?: string;
  seed?: number;
  /** When true, the image should render the quote/text from the prompt (vs. background-only for overlay). */
  textOnImage?: boolean;
  /** Optional exact text lines that must be rendered verbatim if text is present in the image. */
  lockedTexts?: string[];
  /** Internal model override for fallback retry. */
  modelOverride?: string;
  /** Internal retry attempt for transient network failures. */
  retryAttempt?: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function isValidAbsoluteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "data:";
  } catch {
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Image generation timeout after ${timeoutMs}ms`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function previewPrompt(prompt: string, max = 220): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized;
}

function normalizeLockedTexts(values: string[]): string[] {
  const normalized = values
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length > 0)
    .filter((item) => /[\p{L}\p{N}]/u.test(item));
  return Array.from(new Set(normalized)).slice(0, 4);
}

function inferLockedTextsFromPrompt(prompt: string): string[] {
  const candidates: string[] = [];
  const quotedPatterns = [/"([^"\n]{2,280})"/g, /“([^”\n]{2,280})”/g, /'([^'\n]{2,280})'/g];

  for (const pattern of quotedPatterns) {
    let match: RegExpExecArray | null = pattern.exec(prompt);
    while (match) {
      if (match[1]) {
        candidates.push(match[1]);
      }
      match = pattern.exec(prompt);
    }
  }

  return normalizeLockedTexts(candidates);
}

function toDataUrl(base64Value: string, mimeType = "image/png"): string | null {
  const cleaned = base64Value.replace(/\s+/g, "").trim();
  if (cleaned.length < 64) return null;
  return `data:${mimeType};base64,${cleaned}`;
}

function extractImageFromUnknown(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (isValidAbsoluteUrl(trimmed)) return trimmed;

    const dataMatch = trimmed.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/);
    if (dataMatch?.[0] && isValidAbsoluteUrl(dataMatch[0])) {
      return dataMatch[0];
    }

    const urlMatch = trimmed.match(/https?:\/\/\S+/i)?.[0];
    if (urlMatch && isValidAbsoluteUrl(urlMatch)) return urlMatch;
    return null;
  }

  const record = asRecord(value);
  if (!record) return null;

  if (typeof record.url === "string" && isValidAbsoluteUrl(record.url)) {
    return record.url;
  }

  if (typeof record.image_url === "string" && isValidAbsoluteUrl(record.image_url)) {
    return record.image_url;
  }

  const inlineData = asRecord(record.inlineData) ?? asRecord(record.inline_data);
  if (inlineData && typeof inlineData.data === "string") {
    const mimeType = typeof inlineData.mimeType === "string"
      ? inlineData.mimeType
      : typeof inlineData.mime_type === "string"
        ? inlineData.mime_type
        : "image/png";
    return toDataUrl(inlineData.data, mimeType);
  }

  if (typeof record.b64_json === "string") {
    return toDataUrl(record.b64_json);
  }

  if (typeof record.base64 === "string") {
    return toDataUrl(record.base64);
  }

  return null;
}

function extractImageUrlFromGeminiResponse(payload: unknown): { imageUrl?: string; source?: string } {
  const parsed = asRecord(payload);
  if (!parsed) return {};

  const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
  for (const candidateItem of candidates) {
    const candidate = asRecord(candidateItem);
    const content = asRecord(candidate?.content);
    const parts = Array.isArray(content?.parts) ? content?.parts : [];

    for (const part of parts) {
      const imageUrl = extractImageFromUnknown(part);
      if (imageUrl) {
        return { imageUrl, source: "candidates[].content.parts[]" };
      }
    }
  }

  const directImage = extractImageFromUnknown(payload);
  if (directImage) {
    return { imageUrl: directImage, source: "response" };
  }

  return {};
}

function normalizeGeminiModelName(value: string): string {
  return value.replace(/^google\//i, "").trim();
}

function isTransientNetworkError(error: unknown): boolean {
  const record = asRecord(error);
  const status = Number(record?.status ?? record?.code);
  if (Number.isFinite(status) && status >= 500) {
    return true;
  }

  const message = String(record?.message ?? error ?? "").toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("socket hang up") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("eai_again") ||
    message.includes("enotfound")
  );
}

function toOpenrouterModelName(modelName: string): string {
  const normalized = modelName.trim();
  if (!normalized) return "google/gemini-3.1-flash-image-preview";
  return normalized.startsWith("google/") ? normalized : `google/${normalized}`;
}

async function tryOpenrouterFallback({
  prompt,
  aspectRatio,
  negativePrompt,
  seed,
  textOnImage,
  lockedTexts,
  modelName,
  reason
}: {
  prompt: string;
  aspectRatio: AspectRatio;
  negativePrompt: string;
  seed?: number;
  textOnImage: boolean;
  lockedTexts: string[];
  modelName: string;
  reason: string;
}): Promise<{ imageUrl: string; usedFallback: boolean; provider: string; error?: string } | null> {
  const openrouterPrimaryModel = toOpenrouterModelName(modelName);
  console.warn("[NanoBanana] Native Gemini failed, fallback to OpenRouter", {
    reason,
    primaryModel: modelName,
    openrouterModel: openrouterPrimaryModel,
    aspectRatio
  });

  const openrouterRetry = await generateNanoBananaImageViaOpenrouter({
    prompt,
    aspectRatio,
    negativePrompt,
    seed,
    textOnImage,
    lockedTexts,
    modelOverride: openrouterPrimaryModel
  });
  if (!openrouterRetry.usedFallback) {
    return openrouterRetry;
  }

  console.warn("[NanoBanana] OpenRouter primary failed, retrying downgraded model via OpenRouter", {
    openrouterPrimaryModel,
    openrouterBackupModel: OPENROUTER_RATE_LIMIT_FALLBACK_MODEL,
    aspectRatio
  });
  const openrouterBackupRetry = await generateNanoBananaImageViaOpenrouter({
    prompt,
    aspectRatio,
    negativePrompt,
    seed,
    textOnImage,
    lockedTexts,
    modelOverride: OPENROUTER_RATE_LIMIT_FALLBACK_MODEL
  });
  if (!openrouterBackupRetry.usedFallback) {
    return openrouterBackupRetry;
  }

  return null;
}

function extractGeminiErrorDetails(error: unknown): {
  status?: number;
  code?: string | number;
  message: string;
  detailsPreview?: string;
  isTimeout: boolean;
} {
  const record = asRecord(error);
  const statusRaw = record?.status ?? record?.statusCode ?? record?.httpStatus;
  const status = Number(statusRaw);
  const code = record?.code as string | number | undefined;
  const message = error instanceof Error ? error.message : String(record?.message ?? error ?? "Unknown error");
  const isTimeout = /timeout/i.test(message);

  const detailsRaw = (() => {
    if (record?.error != null) return record.error;
    if (record?.response != null) return record.response;
    if (record?.details != null) return record.details;
    return undefined;
  })();

  const detailsPreview = detailsRaw == null
    ? undefined
    : previewPrompt(
        typeof detailsRaw === "string" ? detailsRaw : JSON.stringify(detailsRaw),
        600
      );

  return {
    status: Number.isFinite(status) ? status : undefined,
    code,
    message,
    detailsPreview,
    isTimeout
  };
}

function getGeminiApiKey(): string {
  return appConfig.externalKeys.gemini || process.env.GEMINI_API_KEY || "";
}

export function buildFallbackGradientUrl(index: number, aspectRatio: AspectRatio): string {
  const { width, height } = RATIO_DIMENSIONS[aspectRatio];
  const hueA = (index * 47) % 360;
  const hueB = (hueA + 70) % 360;
  const hueC = (hueA + 140) % 360;

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${hueA} 82% 56%)"/>
      <stop offset="55%" stop-color="hsl(${hueB} 70% 46%)"/>
      <stop offset="100%" stop-color="hsl(${hueC} 64% 34%)"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="34%" r="70%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.20)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect width="${width}" height="${height}" fill="url(#glow)"/>
  <rect x="${Math.round(width * 0.15)}" y="${Math.round(height * 0.28)}" width="${Math.round(width * 0.7)}" height="${Math.round(height * 0.44)}" rx="24" fill="rgba(12,18,32,0.20)"/>
</svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export async function generateNanoBananaImage({
  prompt,
  aspectRatio,
  negativePrompt = DEFAULT_NEGATIVE_PROMPT,
  seed,
  textOnImage = false,
  lockedTexts = [],
  modelOverride,
  retryAttempt = 0
}: GenerateImageInput): Promise<{ imageUrl: string; usedFallback: boolean; provider: string; error?: string }> {
  const fallback = buildFallbackGradientUrl(seed ?? 1, aspectRatio);
  const configuredModel = modelOverride || appConfig.image.model || "gemini-3.1-flash-image-preview";
  const modelName = normalizeGeminiModelName(configuredModel);
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    const openrouterFallback = await tryOpenrouterFallback({
      prompt,
      aspectRatio,
      negativePrompt,
      seed,
      textOnImage,
      lockedTexts,
      modelName,
      reason: "missing GEMINI_API_KEY"
    });
    if (openrouterFallback) {
      return openrouterFallback;
    }
    return {
      imageUrl: fallback,
      usedFallback: true,
      provider: "fallback-gradient",
      error: "GEMINI_API_KEY is missing"
    };
  }

  const explicitLockedTexts = normalizeLockedTexts(lockedTexts);
  const inferredLockedTexts = explicitLockedTexts.length ? [] : inferLockedTextsFromPrompt(prompt);
  const effectiveLockedTexts = textOnImage
    ? normalizeLockedTexts([...explicitLockedTexts, ...inferredLockedTexts])
    : [];

  const textLockRequirement = textOnImage && effectiveLockedTexts.length
    ? [
        "Text lock requirement: render each LOCKED_TEXT exactly character-by-character.",
        "Do not translate, paraphrase, summarize, truncate, add, delete, normalize punctuation, or change capitalization/line order.",
        "Do not render any extra text beyond LOCKED_TEXT lines.",
        "Never render hexadecimal color strings (for example #22d3ee) or palette legend labels.",
        ...effectiveLockedTexts.map((item, index) => `LOCKED_TEXT_${index + 1}: ${item}`)
      ].join("\n")
    : "";

  const outputRequirement = textOnImage
    ? "Render locked text prominently when LOCKED_TEXT lines are provided."
    : "Output requirement: image-only background for text overlay. Include clean copy space in composition.";

  const finalPrompt = [
    prompt,
    `Aspect ratio: ${aspectRatio}.`,
    outputRequirement,
    textLockRequirement,
    `Negative constraints: ${negativePrompt}.`
  ].filter(Boolean).join("\n");

  console.info("[NanoBanana] Generate start", {
    provider: "google-genai",
    model: modelName,
    aspectRatio,
    promptPreview: previewPrompt(finalPrompt)
  });

  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model: modelName,
        contents: finalPrompt,
        config: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: {
            aspectRatio
          },
          seed
        }
      }),
      appConfig.image.timeoutMs
    );

    const extracted = extractImageUrlFromGeminiResponse(response);
    if (extracted.imageUrl) {
      console.info("[NanoBanana] Generate success", {
        provider: "google-genai",
        model: modelName,
        source: extracted.source ?? "unknown"
      });
      return {
        imageUrl: extracted.imageUrl,
        usedFallback: false,
        provider: `gemini:${modelName}`
      };
    }

    console.error("[NanoBanana] Generate fallback: no image in payload", {
      provider: "google-genai",
      model: modelName,
      payloadPreview: previewPrompt(JSON.stringify(response).slice(0, 700), 500)
    });

    const openrouterFallback = await tryOpenrouterFallback({
      prompt,
      aspectRatio,
      negativePrompt,
      seed,
      textOnImage,
      lockedTexts,
      modelName,
      reason: "native response has no image payload"
    });
    if (openrouterFallback) {
      return openrouterFallback;
    }

    return {
      imageUrl: fallback,
      usedFallback: true,
      provider: "fallback-gradient",
      error: `No image returned by ${modelName}.`
    };
  } catch (error) {
    const err = extractGeminiErrorDetails(error);
    const retryMax = Math.max(0, Number(appConfig.image.transientRetryMax ?? 0));
    const retryBaseDelayMs = Math.max(100, Number(appConfig.image.transientRetryBaseDelayMs ?? 450));
    if ((err.isTimeout || isTransientNetworkError(error)) && retryAttempt < retryMax) {
      const nextAttempt = retryAttempt + 1;
      const backoffMs = retryBaseDelayMs * (2 ** retryAttempt);
      console.warn("[NanoBanana] Transient/timeout error, retrying native Gemini call", {
        provider: "google-genai",
        model: modelName,
        aspectRatio,
        attempt: nextAttempt,
        maxAttempts: retryMax,
        backoffMs,
        message: err.message
      });
      await sleep(backoffMs);
      return generateNanoBananaImage({
        prompt,
        aspectRatio,
        negativePrompt,
        seed,
        textOnImage,
        lockedTexts,
        modelOverride,
        retryAttempt: nextAttempt
      });
    }
    const openrouterFallback = await tryOpenrouterFallback({
      prompt,
      aspectRatio,
      negativePrompt,
      seed,
      textOnImage,
      lockedTexts,
      modelName,
      reason: `native error: ${err.message}`
    });
    if (openrouterFallback) {
      return openrouterFallback;
    }

    console.error("[NanoBanana] Generate failed", {
      provider: "google-genai",
      model: modelName,
      aspectRatio,
      status: err.status,
      code: err.code,
      isTimeout: err.isTimeout,
      timeoutMs: appConfig.image.timeoutMs,
      message: err.message,
      detailsPreview: err.detailsPreview
    });

    return {
      imageUrl: fallback,
      usedFallback: true,
      provider: "fallback-gradient",
      error: err.message || "Unknown image generation error"
    };
  }
}
