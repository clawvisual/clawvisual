import { callSkillLlmJson } from "@/lib/llm/skill-client";
import { appConfig } from "@/lib/config";
import { clampNumber } from "@/lib/skills/utils";
import { splitSentences } from "@/lib/skills/utils";
import type { ConversionContext } from "@/lib/types/skills";

function getDistillPolicy(mode: ConversionContext["request"]["contentMode"]) {
  if (mode === "product_marketing") {
    return {
      defaultSlides: 6,
      minPoints: 3,
      maxPoints: 7,
      charsPerPoint: 300,
      objective:
        "Extract conversion-critical points: user pain, differentiator, proof, and action trigger. Keep each point short and persuasive."
    };
  }

  if (mode === "trend_hotspot") {
    return {
      defaultSlides: 4,
      minPoints: 2,
      maxPoints: 5,
      charsPerPoint: 420,
      objective:
        "Extract high-signal hot takes: what happened, why it matters now, and what to do next. Prioritize speed and punch."
    };
  }

  return {
    defaultSlides: 4,
    minPoints: 2,
    maxPoints: 8,
    charsPerPoint: 560,
    objective:
      "Extract the source's key facts and logic with maximum information coverage while staying concise for slide storytelling."
  };
}

function sanitizeSentence(sentence: string): string {
  return sentence
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNoiseSentence(sentence: string): boolean {
  const value = sanitizeSentence(sentence);
  if (!value) return true;
  if (value.length < 12) return true;
  if (/^(Title|URL|URL Source|Published Time|Domain|Image):/i.test(value)) return true;
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(value)) return true;
  if (/^(来源|作者[:：]|责任编辑|发布时间)/.test(value)) return true;
  if (/本文来自|题图来自|热搜词|关注\b/.test(value)) return true;
  if (/^(首页|更多|相关文章)$/.test(value)) return true;
  return false;
}

function fallbackDistill(inputText: string, target: number): string[] {
  const sentences = splitSentences(inputText)
    .map(sanitizeSentence)
    .filter((sentence) => !isNoiseSentence(sentence));

  if (sentences.length) {
    return sentences
      .sort((a, b) => b.length - a.length)
      .slice(0, target);
  }

  return ["No valid input provided."];
}

export async function skill01Distiller(context: ConversionContext): Promise<ConversionContext> {
  const policy = getDistillPolicy(context.request.contentMode);
  const requestedSlides = Number.isFinite(context.request.targetSlides)
    ? clampNumber(Number(context.request.targetSlides), 1, policy.maxPoints)
    : policy.defaultSlides;
  const inputChars = context.request.inputText.replace(/\s+/g, "").length;
  const estimatedByLength = clampNumber(Math.ceil(inputChars / policy.charsPerPoint), policy.minPoints, policy.maxPoints);
  const target = clampNumber(
    Math.min(requestedSlides, Math.max(estimatedByLength, policy.minPoints)),
    policy.minPoints,
    policy.maxPoints
  );

  const llmResult = await callSkillLlmJson<{ core_points?: string[]; corePoints?: string[] }>({
    skill: "distiller",
    input: {
      input_text: context.request.inputText,
      target_points: target,
      tone: context.request.tone,
      mode: context.request.generationMode,
      content_mode: context.request.contentMode,
      objective: [
        policy.objective,
        context.request.generationMode === "quote_slides"
          ? "For quote_slides mode, keep points punchy and standalone with high signal-to-noise."
          : "For standard mode, keep each point compact but explanatory."
      ].join(" ")
    },
    outputSchemaHint: '{"core_points": ["point1", "point2"]}',
    outputLanguage: context.request.outputLanguage,
    fallbackModels: [appConfig.llm.copyFallbackModel]
  });

  const llmPoints = llmResult?.core_points ?? llmResult?.corePoints ?? [];
  const corePoints = llmPoints
    .map((point) => sanitizeSentence(String(point)))
    .filter((point) => point.length > 0)
    .slice(0, target);

  return {
    ...context,
    corePoints: corePoints.length ? corePoints : fallbackDistill(context.request.inputText, target)
  };
}
