import { callGenericLlmJson } from "@/lib/llm/skill-client";
import type { ConversionResult } from "@/lib/types/skills";
import type { RevisePayload } from "@/lib/types/job";

export type RoutedIntent = RevisePayload["intent"] | "full_regenerate" | "ask_clarification";

export type RevisionRouteDecision = {
  intent: RoutedIntent;
  confidence: number;
  reason: string;
  scope: {
    slideIds: number[];
    fields: string[];
  };
  editableFields: RevisePayload["editableFields"];
  preserveFacts: boolean;
  preserveSlideStructure: boolean;
  options: {
    mode: RevisePayload["options"]["mode"];
    preserveLayout: boolean;
    seed?: number;
  };
  clarificationQuestion?: string;
};

function clampConfidence(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  if (parsed < 0) return 0;
  if (parsed > 1) return 1;
  return parsed;
}

function normalizeIntent(value: unknown): RoutedIntent {
  const raw = String(value ?? "").trim();
  if (raw === "rewrite_copy_style") return raw;
  if (raw === "regenerate_cover") return raw;
  if (raw === "regenerate_slides") return raw;
  if (raw === "full_regenerate") return raw;
  if (raw === "ask_clarification") return raw;
  return "ask_clarification";
}

function normalizeMode(value: unknown): RevisePayload["options"]["mode"] {
  const raw = String(value ?? "").trim();
  if (raw === "reprompt") return "reprompt";
  return "same_prompt_new_seed";
}

function normalizeEditableFields(value: unknown): RevisePayload["editableFields"] {
  if (!Array.isArray(value)) {
    return ["post_title", "post_caption", "hashtags"];
  }
  const accepted = new Set<RevisePayload["editableFields"][number]>();
  for (const item of value) {
    const raw = String(item ?? "").trim();
    if (raw === "post_title" || raw === "post_caption" || raw === "hashtags" || raw === "slides") {
      accepted.add(raw);
    }
  }
  return accepted.size ? [...accepted] : ["post_title", "post_caption", "hashtags"];
}

function normalizeSlideIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function parseSlideNumberToken(token: string): number | null {
  const normalized = token.trim();
  if (!normalized) return null;

  const digits = Number(normalized);
  if (Number.isInteger(digits) && digits > 0) {
    return digits;
  }

  const map: Record<string, number> = {
    "一": 1,
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
    "十": 10
  };

  if (map[normalized]) {
    return map[normalized];
  }

  const tenthMatch = normalized.match(/^([一二三四五六七八九])十([一二三四五六七八九])?$/);
  if (tenthMatch) {
    const head = map[tenthMatch[1]] ?? 0;
    const tail = tenthMatch[2] ? (map[tenthMatch[2]] ?? 0) : 0;
    return head * 10 + tail;
  }

  return null;
}

function extractRequestedSlideIds(userInstruction: string): number[] {
  const text = userInstruction.trim();
  const ids: number[] = [];
  const seen = new Set<number>();
  const add = (value: number | null) => {
    if (!value || value <= 0 || seen.has(value)) return;
    seen.add(value);
    ids.push(value);
  };

  if (/(封面|cover)/i.test(text)) {
    add(1);
  }

  for (const match of text.matchAll(/第\s*([一二三四五六七八九十两\d]+)\s*张/gi)) {
    add(parseSlideNumberToken(match[1] ?? ""));
  }

  for (const match of text.matchAll(/\bslide\s*#?\s*(\d+)\b/gi)) {
    add(parseSlideNumberToken(match[1] ?? ""));
  }

  return ids;
}

function alignImageDecisionWithExplicitSlides(
  decision: RevisionRouteDecision,
  userInstruction: string
): RevisionRouteDecision {
  if (decision.intent !== "regenerate_cover" && decision.intent !== "regenerate_slides") {
    return decision;
  }

  const explicitSlideIds = extractRequestedSlideIds(userInstruction);
  if (!explicitSlideIds.length) {
    return decision;
  }

  return {
    ...decision,
    intent: explicitSlideIds.length === 1 && explicitSlideIds[0] === 1 ? "regenerate_cover" : "regenerate_slides",
    scope: {
      slideIds: explicitSlideIds,
      fields: decision.scope.fields.length ? decision.scope.fields : ["image"]
    }
  };
}

function fallbackRoute(userInstruction: string): RevisionRouteDecision {
  const text = userInstruction.trim();
  const regenRegex = /(重生成|重新生成|重做|重画|重绘|再生成|换一张|换图|regenerate|redo)/i;
  const fullRegenRegex =
    /(重新.*全部.*生成|全部.*重新.*生成|全部.*生成|全量.*生成|整套.*生成|全部重做|重做全部|full\s*regenerate|regenerate\s*all|redo\s*all)/i;
  const styleRegex = /(风格|色调|背景|构图|人物|场景|更.+?|改成|换成|强调|突出|ugly|丑)/i;
  const copyRegex = /(文案|标题|caption|hashtags?|语气|改写|重写|润色|总结|copy|tone|style)/i;
  const fullRegex = /(整套|全部|全量|完整|重新来|重做全部|full)/i;
  const explicitSlideIds = extractRequestedSlideIds(text);

  if (fullRegenRegex.test(text) || (fullRegex.test(text) && regenRegex.test(text))) {
    return {
      intent: "full_regenerate",
      confidence: 0.78,
      reason: "Fallback keyword routing detected full regeneration request.",
      scope: { slideIds: [], fields: [] },
      editableFields: ["post_title", "post_caption", "hashtags", "slides"],
      preserveFacts: true,
      preserveSlideStructure: false,
      options: {
        mode: "reprompt",
        preserveLayout: false
      }
    };
  }

  if (explicitSlideIds.length && (regenRegex.test(text) || styleRegex.test(text))) {
    const isCoverOnly = explicitSlideIds.length === 1 && explicitSlideIds[0] === 1;
    return {
      intent: isCoverOnly ? "regenerate_cover" : "regenerate_slides",
      confidence: 0.74,
      reason: "Fallback keyword routing detected explicit slide-image regeneration request.",
      scope: { slideIds: explicitSlideIds, fields: ["image"] },
      editableFields: ["slides"],
      preserveFacts: true,
      preserveSlideStructure: true,
      options: {
        mode: styleRegex.test(text) ? "reprompt" : "same_prompt_new_seed",
        preserveLayout: true
      }
    };
  }

  if (copyRegex.test(text)) {
    return {
      intent: "rewrite_copy_style",
      confidence: 0.7,
      reason: "Fallback keyword routing detected copy rewrite request.",
      scope: { slideIds: [], fields: ["post_title", "post_caption", "hashtags"] },
      editableFields: ["post_title", "post_caption", "hashtags"],
      preserveFacts: true,
      preserveSlideStructure: true,
      options: {
        mode: "same_prompt_new_seed",
        preserveLayout: true
      }
    };
  }

  return {
    intent: "ask_clarification",
    confidence: 0.45,
    reason: "Fallback router cannot map instruction to a safe revision action.",
    scope: { slideIds: [], fields: [] },
    editableFields: ["post_title", "post_caption", "hashtags"],
    preserveFacts: true,
    preserveSlideStructure: true,
    options: {
      mode: "same_prompt_new_seed",
      preserveLayout: true
    },
    clarificationQuestion: "你是想改文案风格，还是重生成封面/某一页图片？"
  };
}

function normalizeLlmRoute(raw: {
  intent?: string;
  confidence?: number;
  reason?: string;
  scope?: { slide_ids?: number[]; fields?: string[] };
  editable_fields?: string[];
  preserve_facts?: boolean;
  preserve_slide_structure?: boolean;
  options?: { mode?: string; preserve_layout?: boolean; seed?: number };
  clarification_question?: string;
} | null): RevisionRouteDecision | null {
  if (!raw) return null;

  const intent = normalizeIntent(raw.intent);
  const confidence = clampConfidence(raw.confidence);
  const editableFields = normalizeEditableFields(raw.editable_fields);
  const slideIds = normalizeSlideIds(raw.scope?.slide_ids);
  const fields = Array.isArray(raw.scope?.fields)
    ? raw.scope.fields.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
  const reason = String(raw.reason ?? "").trim() || "LLM router decision.";
  const clarificationQuestion = String(raw.clarification_question ?? "").trim();

  return {
    intent,
    confidence,
    reason,
    scope: {
      slideIds,
      fields
    },
    editableFields,
    preserveFacts: raw.preserve_facts ?? true,
    preserveSlideStructure: raw.preserve_slide_structure ?? true,
    options: {
      mode: normalizeMode(raw.options?.mode),
      preserveLayout: raw.options?.preserve_layout ?? true,
      seed: raw.options?.seed
    },
    clarificationQuestion: clarificationQuestion || undefined
  };
}

export async function routeRevisionInstruction(params: {
  userInstruction: string;
  sourceText: string;
  previousOutput: ConversionResult;
  outputLanguage: string;
  conversationSnippet: Array<{ turn: number; revision: number; input_text: string }>;
}): Promise<RevisionRouteDecision> {
  const fastPath = fallbackRoute(params.userInstruction);
  if (fastPath.intent === "full_regenerate") {
    return fastPath;
  }

  const sourceExcerpt = params.sourceText.slice(0, 4000);
  const historyExcerpt = params.conversationSnippet.slice(-8);

  const llmRoute = await callGenericLlmJson<{
    intent?: string;
    confidence?: number;
    reason?: string;
    scope?: { slide_ids?: number[]; fields?: string[] };
    editable_fields?: string[];
    preserve_facts?: boolean;
    preserve_slide_structure?: boolean;
    options?: { mode?: string; preserve_layout?: boolean; seed?: number };
    clarification_question?: string;
  }>({
    instruction: [
      "You are an intent router for a social content revision pipeline.",
      "Classify user instruction into one action only: rewrite_copy_style, regenerate_cover, regenerate_slides, full_regenerate, ask_clarification.",
      "If user requests cover plus any other slide, use regenerate_slides and include all explicit slide_ids (cover=1).",
      "Prefer minimal, local edits over full regenerate unless user explicitly asks full redo.",
      "If intent is uncertain, return ask_clarification with a short question.",
      "Return strict JSON only."
    ].join(" "),
    input: {
      user_instruction: params.userInstruction,
      source_text: sourceExcerpt,
      previous_output: params.previousOutput,
      recent_conversation: historyExcerpt,
      allowed_fields: ["post_title", "post_caption", "hashtags", "slides"],
      defaults: {
        preserve_facts: true,
        preserve_slide_structure: true,
        preserve_layout: true
      }
    },
    outputSchemaHint:
      '{"intent":"rewrite_copy_style","confidence":0.91,"reason":"...","scope":{"slide_ids":[1],"fields":["image"]},"editable_fields":["post_title","post_caption"],"preserve_facts":true,"preserve_slide_structure":true,"options":{"mode":"reprompt","preserve_layout":true},"clarification_question":""}',
    outputLanguage: params.outputLanguage,
    temperature: 0
  });

  const normalized = normalizeLlmRoute(llmRoute);
  if (normalized) {
    const aligned = alignImageDecisionWithExplicitSlides(normalized, params.userInstruction);
    if (aligned.intent === "ask_clarification" && !aligned.clarificationQuestion) {
      return {
        ...aligned,
        clarificationQuestion: "你是想改文案，还是重生成封面/某一页图片？"
      };
    }
    if (aligned.confidence >= 0.58 || aligned.intent === "ask_clarification") {
      return aligned;
    }
  }

  return fallbackRoute(params.userInstruction);
}
