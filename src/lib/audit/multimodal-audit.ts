import { appConfig } from "@/lib/config";
import { recordUsageFromPayload } from "@/lib/llm/usage-tracker";

export type AuditSlideInput = {
  slide_id: number;
  content_quote: string;
  image_url: string;
  visual_prompt?: string;
};

export type AuditModelScore = {
  model: string;
  status: "completed" | "failed";
  total_score: number | null;
  dimensions: {
    readability: number;
    aesthetics: number;
    alignment: number;
  } | null;
  critical_issue: string;
  fix_suggestion: string;
  error?: string;
};

export type MultiModelAuditResult = {
  summary: {
    models_requested: number;
    models_succeeded: number;
    overall_average_score: number;
  };
  model_scores: AuditModelScore[];
};

type AuditResponse = {
  total_score?: number;
  dimensions?: {
    readability?: number;
    aesthetics?: number;
    alignment?: number;
  };
  critical_issue?: string;
  fix_suggestion?: string;
};

type ChatResponse = {
  choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string }> }>;
  usage?: unknown;
  model?: string;
};

const DEFAULT_AUDIT_MODELS = [
  "google/gemini-3-flash-preview",
  "openai/gpt-4o-mini",
  "anthropic/claude-3.5-sonnet",
  "minimax/minimax-m2.5"
];

const SYSTEM_PROMPT = [
  "Act as a Senior Creative Auditor and UI/UX Specialist for social media slides.",
  "Score each result with rigorous standards across readability, aesthetics, and semantic alignment.",
  "Return strict JSON only. No markdown. No prose.",
  "Score scale is 0-100 (integer)."
].join(" ");

function isImageRefUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(value);
}

function sanitizeModelList(models?: string[]): string[] {
  const incoming = Array.isArray(models) ? models : [];
  const normalized = incoming
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, 5);
  return normalized.length ? normalized : DEFAULT_AUDIT_MODELS;
}

function toIntScore(value: unknown, fallback = 60): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

function extractText(payload: ChatResponse): string {
  const choiceContent = payload.choices?.[0]?.message?.content;
  return (
    (typeof choiceContent === "string"
      ? choiceContent
      : choiceContent?.map((part) => part.text ?? "").join("")) ||
    payload.output_text ||
    payload.output?.[0]?.content?.map((part) => part.text ?? "").join("") ||
    ""
  );
}

function safeParseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(extractJson(raw)) as T;
  } catch {
    return null;
  }
}

function serializeMessageBody(params: {
  slides: AuditSlideInput[];
  outputLanguage: string;
  targetAudience: string;
  platform: string;
  includeImages: boolean;
}): Array<Record<string, unknown>> {
  const userText = [
    `Audit these final slides for audience: ${params.targetAudience}, platform: ${params.platform}.`,
    `All feedback language: ${params.outputLanguage}.`,
    "Checklist: Text-Background Contrast, Subject Interference, Branding Quality, Metaphor Accuracy.",
    "Return JSON schema: {\"total_score\":number,\"dimensions\":{\"readability\":number,\"aesthetics\":number,\"alignment\":number},\"critical_issue\":string,\"fix_suggestion\":string}."
  ].join("\n");

  const content: Array<Record<string, unknown>> = [{ type: "text", text: userText }];
  for (const slide of params.slides.slice(0, 8)) {
    content.push({
      type: "text",
      text: `Slide #${slide.slide_id}\nCopy: ${slide.content_quote}\nVisual prompt: ${slide.visual_prompt ?? ""}`
    });
    if (params.includeImages && isImageRefUrl(slide.image_url)) {
      content.push({
        type: "image_url",
        image_url: { url: slide.image_url }
      });
    }
  }
  return content;
}

async function callAuditModel(params: {
  model: string;
  content: Array<Record<string, unknown>>;
  headers: Record<string, string>;
}): Promise<{ ok: true; parsed: AuditResponse } | { ok: false; error: string; status?: number }> {
  try {
    const response = await fetch(appConfig.llm.apiUrl, {
      method: "POST",
      headers: params.headers,
      cache: "no-store",
      body: JSON.stringify({
        model: params.model,
        temperature: 0.1,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: params.content }
        ]
      })
    });

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}`, status: response.status };
    }

    const payload = (await response.json()) as ChatResponse;
    recordUsageFromPayload({
      model: params.model,
      payload
    });
    const raw = extractText(payload);
    const parsed = safeParseJson<AuditResponse>(raw);
    if (!parsed) {
      return { ok: false, error: "Invalid JSON response" };
    }

    return { ok: true, parsed };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "fetch failed"
    };
  }
}

function heuristicScore(slides: AuditSlideInput[]): Omit<AuditModelScore, "model" | "status"> {
  const avgLen = slides.length
    ? slides.reduce((sum, slide) => sum + slide.content_quote.length, 0) / slides.length
    : 0;
  const readability = Math.max(45, Math.min(94, Math.round(95 - avgLen * 0.9)));
  const aesthetics = slides.every((slide) => /^https?:\/\//i.test(slide.image_url) || slide.image_url.startsWith("data:image/"))
    ? 78
    : 62;
  const alignment = Math.max(50, Math.min(90, Math.round((readability + aesthetics) / 2 + 4)));
  const total = Math.round((readability + aesthetics + alignment) / 3);

  return {
    total_score: total,
    dimensions: { readability, aesthetics, alignment },
    critical_issue: avgLen > 34 ? "Copy is too dense for mobile-first readability." : "No critical issue detected.",
    fix_suggestion: avgLen > 34
      ? "Shorten each slide punchline and reserve larger negative space on top area."
      : "Keep current structure and focus on visual consistency across slides."
  };
}

async function auditWithModel(params: {
  model: string;
  slides: AuditSlideInput[];
  outputLanguage: string;
  targetAudience: string;
  platform: string;
}): Promise<AuditModelScore> {
  if (!appConfig.llm.apiUrl) {
    const fallback = heuristicScore(params.slides);
    return {
      model: params.model,
      status: "failed",
      ...fallback,
      error: "LLM_API_URL is missing"
    };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (appConfig.llm.apiKey) {
    headers.Authorization = `Bearer ${appConfig.llm.apiKey}`;
  }
  if (appConfig.llm.httpReferer) {
    headers["HTTP-Referer"] = appConfig.llm.httpReferer;
  }
  if (appConfig.llm.xTitle) {
    headers["X-Title"] = appConfig.llm.xTitle;
  }

  const contentWithImage = serializeMessageBody({
    slides: params.slides,
    outputLanguage: params.outputLanguage,
    targetAudience: params.targetAudience,
    platform: params.platform,
    includeImages: true
  });
  const contentTextOnly = serializeMessageBody({
    slides: params.slides,
    outputLanguage: params.outputLanguage,
    targetAudience: params.targetAudience,
    platform: params.platform,
    includeImages: false
  });

  let executedModel = params.model;
  let response = await callAuditModel({
    model: params.model,
    content: contentWithImage,
    headers
  });

  if (!response.ok) {
    response = await callAuditModel({
      model: params.model,
      content: contentTextOnly,
      headers
    });
  }

  if (!response.ok && response.status === 403 && appConfig.llm.model && appConfig.llm.model !== params.model) {
    executedModel = appConfig.llm.model;
    response = await callAuditModel({
      model: executedModel,
      content: contentTextOnly,
      headers
    });
  }

  if (!response.ok) {
    const fallback = heuristicScore(params.slides);
    return {
      model: params.model,
      status: "failed",
      ...fallback,
      error: response.error
    };
  }

  const parsed = response.parsed;
  const fallbackSuffix = executedModel !== params.model ? ` (fallback model: ${executedModel})` : "";
  return {
    model: params.model,
    status: "completed",
    total_score: toIntScore(parsed.total_score, 60),
    dimensions: {
      readability: toIntScore(parsed.dimensions?.readability, 60),
      aesthetics: toIntScore(parsed.dimensions?.aesthetics, 60),
      alignment: toIntScore(parsed.dimensions?.alignment, 60)
    },
    critical_issue: (String(parsed.critical_issue ?? "No critical issue.").trim() || "No critical issue.") + fallbackSuffix,
    fix_suggestion: String(parsed.fix_suggestion ?? "No suggestion.").trim() || "No suggestion."
  };
}

export async function runMultiModelAudit(params: {
  slides: AuditSlideInput[];
  models?: string[];
  outputLanguage?: string;
  targetAudience?: string;
  platform?: string;
}): Promise<MultiModelAuditResult> {
  const models = sanitizeModelList(params.models);
  const tasks = models.map((model) =>
    auditWithModel({
      model,
      slides: params.slides,
      outputLanguage: params.outputLanguage ?? "zh-CN",
      targetAudience: params.targetAudience ?? "business readers",
      platform: params.platform ?? "Instagram"
    })
  );

  const results = await Promise.all(tasks);
  const succeeded = results.filter((item) => item.status === "completed" && item.total_score != null);
  const average = succeeded.length
    ? Math.round(succeeded.reduce((sum, item) => sum + (item.total_score ?? 0), 0) / succeeded.length)
    : 0;

  return {
    summary: {
      models_requested: models.length,
      models_succeeded: succeeded.length,
      overall_average_score: average
    },
    model_scores: results
  };
}
