import { appConfig } from "@/lib/config";
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
};

type ChatCompletionsResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  data?: unknown;
  images?: unknown;
  output?: Array<{ content?: unknown }>;
};

function previewPrompt(prompt: string, max = 220): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized;
}

function normalizeLockedTexts(values: string[]): string[] {
  const normalized = values
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length > 0)
    .filter((item) => /[\p{L}\p{N}]/u.test(item));
  return Array.from(new Set(normalized)).slice(0, 6);
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
  if (cleaned.length < 64) {
    return null;
  }
  return `data:${mimeType};base64,${cleaned}`;
}

function extractUrlFromText(text: string): string | null {
  const normalized = text.trim();
  if (!normalized) return null;

  const dataUrlMatch = normalized.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/);
  if (dataUrlMatch?.[0] && isValidAbsoluteUrl(dataUrlMatch[0])) {
    return dataUrlMatch[0];
  }

  const urlMatch = normalized.match(/https?:\/\/\S+/i)?.[0];
  if (urlMatch && isValidAbsoluteUrl(urlMatch)) {
    return urlMatch;
  }

  return null;
}

function extractImageFromUnknown(value: unknown): string | null {
  if (typeof value === "string") {
    if (isValidAbsoluteUrl(value)) {
      return value;
    }
    return extractUrlFromText(value);
  }

  const record = asRecord(value);
  if (!record) return null;

  const imageUrlField = record.image_url;
  if (typeof imageUrlField === "string" && isValidAbsoluteUrl(imageUrlField)) {
    return imageUrlField;
  }
  const imageUrlObj = asRecord(imageUrlField);
  if (imageUrlObj?.url && typeof imageUrlObj.url === "string" && isValidAbsoluteUrl(imageUrlObj.url)) {
    return imageUrlObj.url;
  }

  if (typeof record.url === "string" && isValidAbsoluteUrl(record.url)) {
    return record.url;
  }

  if (typeof record.b64_json === "string") {
    return toDataUrl(record.b64_json);
  }
  if (typeof record.base64 === "string") {
    return toDataUrl(record.base64);
  }

  const inlineData = asRecord(record.inlineData);
  if (inlineData && typeof inlineData.data === "string") {
    const mimeType = typeof inlineData.mimeType === "string" ? inlineData.mimeType : "image/png";
    return toDataUrl(inlineData.data, mimeType);
  }

  if (typeof record.text === "string") {
    const textUrl = extractUrlFromText(record.text);
    if (textUrl) return textUrl;
  }

  return null;
}

function extractImageUrl(payload: ChatCompletionsResponse): { imageUrl?: string; source?: string } {
  const choice = payload.choices?.[0];
  const choiceMessage = asRecord(choice?.message);

  const messageImages = choiceMessage?.images;
  if (Array.isArray(messageImages)) {
    for (const imageItem of messageImages) {
      const imageRecord = asRecord(imageItem);
      const snakeUrl = asRecord(imageRecord?.image_url);
      if (typeof snakeUrl?.url === "string" && isValidAbsoluteUrl(snakeUrl.url)) {
        return { imageUrl: snakeUrl.url, source: "choices[0].message.images[].image_url.url" };
      }

      const camelUrl = asRecord(imageRecord?.imageUrl);
      if (typeof camelUrl?.url === "string" && isValidAbsoluteUrl(camelUrl.url)) {
        return { imageUrl: camelUrl.url, source: "choices[0].message.images[].imageUrl.url" };
      }

      const direct = extractImageFromUnknown(imageItem);
      if (direct) return { imageUrl: direct, source: "choices[0].message.images[]" };
    }
  }

  const content = choice?.message?.content;

  if (Array.isArray(content)) {
    for (const part of content) {
      const imageUrl = extractImageFromUnknown(part);
      if (imageUrl) return { imageUrl, source: "choices[0].message.content[]" };
    }
  } else {
    const imageUrl = extractImageFromUnknown(content);
    if (imageUrl) return { imageUrl, source: "choices[0].message.content" };
  }

  if (Array.isArray(payload.data)) {
    for (const item of payload.data) {
      const imageUrl = extractImageFromUnknown(item);
      if (imageUrl) return { imageUrl, source: "data[]" };
    }
  } else {
    const imageUrl = extractImageFromUnknown(payload.data);
    if (imageUrl) return { imageUrl, source: "data" };
  }

  if (Array.isArray(payload.images)) {
    for (const item of payload.images) {
      const imageUrl = extractImageFromUnknown(item);
      if (imageUrl) return { imageUrl, source: "images[]" };
    }
  } else {
    const imageUrl = extractImageFromUnknown(payload.images);
    if (imageUrl) return { imageUrl, source: "images" };
  }

  for (const outputItem of payload.output ?? []) {
    const outputRecord = asRecord(outputItem);
    const outputContent = outputRecord?.content;
    if (Array.isArray(outputContent)) {
      for (const part of outputContent) {
        const imageUrl = extractImageFromUnknown(part);
        if (imageUrl) return { imageUrl, source: "output[].content[]" };
      }
    } else {
      const imageUrl = extractImageFromUnknown(outputContent);
      if (imageUrl) return { imageUrl, source: "output[].content" };
    }
  }

  return {};
}

export async function generateNanoBananaImage({
  prompt,
  aspectRatio,
  negativePrompt = DEFAULT_NEGATIVE_PROMPT,
  seed,
  textOnImage = false,
  lockedTexts = [],
  modelOverride
}: GenerateImageInput): Promise<{ imageUrl: string; usedFallback: boolean; provider: string; error?: string }> {
  const RATE_LIMIT_FALLBACK_MODEL = "google/gemini-2.5-flash-image";
  const fallback = buildFallbackGradientUrl(seed ?? 1, aspectRatio);
  const apiUrl = appConfig.llm.apiUrl;
  const apiKey = appConfig.llm.apiKey || appConfig.externalKeys.openrouter;
  const modelName = modelOverride ?? appConfig.image.model;
  const responseFormat = appConfig.image.responseFormat;
  const isImageModel = /image/i.test(modelName);

  if (!apiUrl) {
    return {
      imageUrl: fallback,
      usedFallback: true,
      provider: "fallback-gradient",
      error: "LLM_API_URL is missing"
    };
  }

  if (!apiKey) {
    return {
      imageUrl: fallback,
      usedFallback: true,
      provider: "fallback-gradient",
      error: "LLM_API_KEY is missing"
    };
  }

  const effectiveLockedTexts = textOnImage
    ? normalizeLockedTexts([...lockedTexts, ...inferLockedTextsFromPrompt(prompt)])
    : [];

  const textLockRequirement = textOnImage && effectiveLockedTexts.length
    ? [
        "Text lock requirement: render each exact text line exactly character-by-character.",
        "Do not translate, paraphrase, summarize, truncate, add, delete, normalize punctuation, or change capitalization/line order.",
        "Do not render any extra text beyond the exact text lines provided below.",
        "Never render labels like LOCKED_TEXT, LOCKED_TEXT_1, TEXT_LOCK, or any placeholder token names.",
        "Never render hexadecimal color strings (for example #22d3ee) or palette legend labels.",
        "Exact text lines:",
        ...effectiveLockedTexts.map((item) => `- ${item}`)
      ].join("\n")
    : "";

  const outputRequirement = textOnImage
    ? "Render exact text lines prominently when they are provided."
    : "Output requirement: image-only background for text overlay. Include clean copy space in composition.";

  const finalPrompt = [
    prompt,
    `Aspect ratio: ${aspectRatio}.`,
    outputRequirement,
    textLockRequirement,
    `Negative constraints: ${negativePrompt}.`
  ].filter(Boolean).join("\n");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };

  if (appConfig.llm.httpReferer) {
    headers["HTTP-Referer"] = appConfig.llm.httpReferer;
  }
  if (appConfig.llm.xTitle) {
    headers["X-Title"] = appConfig.llm.xTitle;
  }

  const payload: Record<string, unknown> = {
    model: modelName,
    stream: false,
    ...(isImageModel ? { modalities: ["image", "text"] } : {}),
    messages: [
      {
        role: "user",
        content: finalPrompt
      }
    ]
  };

  if (!isImageModel && responseFormat.trim()) {
    payload.response_format = { type: responseFormat.trim() };
  }

  console.info("[NanoBanana] Generate start", {
    apiUrl,
    model: modelName,
    aspectRatio,
    modalities: isImageModel ? ["image", "text"] : undefined,
    responseFormat: responseFormat || "default",
    promptPreview: previewPrompt(finalPrompt)
  });

  try {
    const response = await withTimeout(
      fetch(apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        cache: "no-store"
      }),
      appConfig.image.timeoutMs
    );

    const textPayload = await response.text();
    let parsedPayload: ChatCompletionsResponse = {};
    try {
      parsedPayload = JSON.parse(textPayload) as ChatCompletionsResponse;
    } catch {
      parsedPayload = {};
    }

    if (!response.ok) {
      if (
        response.status === 429 &&
        !modelOverride &&
        modelName !== RATE_LIMIT_FALLBACK_MODEL
      ) {
        console.warn("[NanoBanana] Primary model rate-limited, retrying fallback image model", {
          primaryModel: modelName,
          fallbackModel: RATE_LIMIT_FALLBACK_MODEL,
          aspectRatio
        });
        const retry = await generateNanoBananaImage({
          prompt,
          aspectRatio,
          negativePrompt,
          seed,
          textOnImage,
          lockedTexts,
          modelOverride: RATE_LIMIT_FALLBACK_MODEL
        });
        if (!retry.usedFallback) {
          return retry;
        }
      }

      console.error("[NanoBanana] Generate failed", {
        apiUrl,
        model: modelName,
        aspectRatio,
        status: response.status,
        responsePreview: previewPrompt(textPayload, 500)
      });
      return {
        imageUrl: fallback,
        usedFallback: true,
        provider: "fallback-gradient",
        error: `Image API error: ${response.status}`
      };
    }

    const extracted = extractImageUrl(parsedPayload);
    if (extracted.imageUrl) {
      console.info("[NanoBanana] Generate success", {
        model: modelName,
        aspectRatio,
        source: extracted.source ?? "unknown"
      });
      return {
        imageUrl: extracted.imageUrl,
        usedFallback: false,
        provider: `llm-image:${modelName}`
      };
    }

    console.error("[NanoBanana] Generate fallback: no image in payload", {
      apiUrl,
      model: modelName,
      aspectRatio,
      payloadPreview: previewPrompt(textPayload, 500)
    });
    return {
      imageUrl: fallback,
      usedFallback: true,
      provider: "fallback-gradient",
      error: `No image returned by ${modelName}.`
    };
  } catch (error) {
    console.error("[NanoBanana] Generate failed", {
      apiUrl,
      model: modelName,
      aspectRatio,
      message: error instanceof Error ? error.message : String(error)
    });
    return {
      imageUrl: fallback,
      usedFallback: true,
      provider: "fallback-gradient",
      error: error instanceof Error ? error.message : "Unknown image generation error"
    };
  }
}
