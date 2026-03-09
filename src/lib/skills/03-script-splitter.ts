import { callGenericLlmJson, callSkillLlmJson } from "@/lib/llm/skill-client";
import { appConfig } from "@/lib/config";
import { listHasUnexpectedHan } from "@/lib/i18n/text-guard";
import { clampNumber, trimToMaxCharsNoEllipsis } from "@/lib/skills/utils";
import type { ConversionContext, SlideScript } from "@/lib/types/skills";

function chunkByWordLimit(sentence: string, maxWords: number): string[] {
  const words = sentence.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return [sentence];
  }

  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += maxWords) {
    chunks.push(words.slice(i, i + maxWords).join(" "));
  }

  return chunks;
}

function compactScript(script: string, maxWords: number, maxChars: number): string {
  const normalized = script.replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  const byWords = normalized.split(/\s+/).slice(0, maxWords).join(" ");
  return trimToMaxCharsNoEllipsis(byWords, maxChars);
}

function scriptDedupKey(script: string): string {
  return script
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "")
    .trim();
}

function mergeUniqueStoryboard(
  primary: SlideScript[],
  backup: SlideScript[],
  targetCount: number
): SlideScript[] {
  const merged: SlideScript[] = [];
  const seen = new Set<string>();
  const pushUnique = (item: SlideScript) => {
    const script = item.script.replace(/\s+/g, " ").trim();
    if (!script) return;
    const key = scriptDedupKey(script);
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push({ index: merged.length + 1, script });
  };

  for (const item of primary) {
    pushUnique(item);
    if (merged.length >= targetCount) break;
  }
  if (merged.length < targetCount) {
    for (const item of backup) {
      pushUnique(item);
      if (merged.length >= targetCount) break;
    }
  }
  return merged;
}

function estimateDynamicSlideCount(context: ConversionContext, slideLimit: number): number {
  const sourceChars = context.request.inputText.replace(/\s+/g, "").length;
  const byLength = clampNumber(Math.ceil(sourceChars / 240), 1, 8);
  const byCorePoints = clampNumber(context.corePoints.length || 1, 1, 8);
  return clampNumber(Math.min(slideLimit, Math.max(byLength, byCorePoints)), 1, 8);
}

function fallbackStoryboard(corePoints: string[], slideLimit: number, maxWordsPerSlide: number, maxCharsPerSlide: number): SlideScript[] {
  const bodyPool = corePoints.length ? corePoints : ["No content extracted from input."];
  const scripts: string[] = [];

  for (const point of bodyPool) {
    for (const chunk of chunkByWordLimit(point, maxWordsPerSlide)) {
      const compact = compactScript(chunk, maxWordsPerSlide, maxCharsPerSlide);
      if (!compact) continue;
      scripts.push(compact);
      if (scripts.length >= slideLimit) break;
    }
    if (scripts.length >= slideLimit) break;
  }

  if (!scripts.length) {
    scripts.push(compactScript(bodyPool[0] ?? "No content extracted from input.", maxWordsPerSlide, maxCharsPerSlide));
  }

  return scripts
    .filter(Boolean)
    .slice(0, slideLimit)
    .map((script, index) => ({
      index: index + 1,
      script
    }));
}

function normalizeStoryboard(
  items: Array<{ index?: number; script?: string }>,
  slideLimit: number,
  maxWordsPerSlide: number,
  maxCharsPerSlide: number
): SlideScript[] {
  const mapped = items
    .map((item, idx) => ({
      index: Number(item.index ?? idx + 1),
      script: compactScript(String(item.script ?? ""), maxWordsPerSlide, maxCharsPerSlide)
    }))
    .filter((item) => item.script.length > 0)
    .sort((a, b) => a.index - b.index)
    .slice(0, slideLimit);

  return mapped.map((item, idx) => ({
    index: idx + 1,
    script: item.script
  }));
}

async function enforceStoryboardLanguage(params: {
  storyboard: SlideScript[];
  sourceText: string;
  outputLanguage: string;
  maxWordsPerSlide: number;
  maxCharsPerSlide: number;
}): Promise<SlideScript[]> {
  if (!params.storyboard.length) return params.storyboard;
  if (!listHasUnexpectedHan(params.storyboard.map((item) => item.script), params.outputLanguage)) {
    return params.storyboard;
  }

  const translated = await callGenericLlmJson<{
    storyboard?: Array<{ index?: number; script?: string }>;
  }>({
    instruction: [
      "Rewrite slide scripts into the target language with concise social-ready punchline style.",
      "Preserve slide count and index order.",
      "Keep factual meaning; no new claims.",
      "When target language is not Chinese/Japanese, do not use Chinese characters.",
      "Return strict JSON only."
    ].join(" "),
    input: {
      source_excerpt: contextExcerpt(params.sourceText),
      target_language: params.outputLanguage,
      storyboard: params.storyboard,
      constraints: {
        preserve_slide_count: true,
        preserve_index: true,
        words_per_slide_max: params.maxWordsPerSlide,
        chars_per_slide_max: params.maxCharsPerSlide
      }
    },
    outputSchemaHint: '{"storyboard":[{"index":1,"script":"..."}]}',
    outputLanguage: params.outputLanguage,
    temperature: 0.1,
    fallbackModels: [appConfig.llm.copyFallbackModel]
  });

  const normalized = normalizeStoryboard(
    translated?.storyboard ?? [],
    params.storyboard.length,
    params.maxWordsPerSlide,
    params.maxCharsPerSlide
  );
  if (normalized.length !== params.storyboard.length) {
    return params.storyboard;
  }
  if (listHasUnexpectedHan(normalized.map((item) => item.script), params.outputLanguage)) {
    return params.storyboard;
  }
  return normalized;
}

function contextExcerpt(text: string, max = 2200): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}
/**
 * @param insights - 来自 Skill 01 的原子化金句数组
 * @param maxSlides - 用户期望的最大页数 (1-8)
 * @param language - 目标输出语言
 * @param tone - 风格调性 (如 "Professional", "Edgy", "Humorous")
 */
const getSkill03Objective = (insights: string[], maxSlides: number, recommendedSlides: number, language: string, tone: string) => {
  return `Context:
  - Raw Insights: ${JSON.stringify(insights)}
  - Max Slide Count: ${maxSlides}
  - Recommended Slide Count: ${recommendedSlides}
  - Desired Tone: ${tone}
  - Language: ${language}

  Objective: 
  1. Map the raw insights into a sequence of 1..${maxSlides} slides (do NOT exceed ${maxSlides}).
  2. Prefer around ${recommendedSlides} slides when it improves narrative clarity.
  3. Cover key points with minimal redundancy.
  4. Edit each insight into a high-impact summary punchline that works as a visual focal point.
  5. Ensure a clear "Before & After" or "Logic Chain" progression.
  6. Every slide must introduce a DISTINCT point; do not repeat the same claim across different slides.

  Required Output Schema (JSON):
  - storyboard: Array of {
      "index": number,
      "script": "The refined text for the slide",
      "role": "Optional narrative role (Hook, Buildup, Climax, Conclusion)"
    }`;
};

export async function skill03ScriptSplitter(context: ConversionContext): Promise<ConversionContext> {
  const requestedSlideCount = Number.isFinite(context.request.targetSlides)
    ? clampNumber(Number(context.request.targetSlides), 1, 8)
    : undefined;
  const autoSlideCount = requestedSlideCount == null;
  const maxSlides = requestedSlideCount ?? 8;
  const isQuoteMode = context.request.generationMode === "quote_slides";
  const maxWordsPerSlide = isQuoteMode ? 14 : 28;
  const maxCharsPerSlide = isQuoteMode ? 64 : 86;
  const recommendedSlides = estimateDynamicSlideCount(context, maxSlides);

  const llmResult = await callSkillLlmJson<{
    storyboard?: Array<{ index?: number; script?: string; role?: string }>;
    slides?: Array<{ index?: number; punchline?: string; role?: string }>;
  }>({
    skill: "scriptSplitter",
    input: {
      source_text: context.request.inputText,
      core_points: context.corePoints,
      hooks: context.hooks,
      slide_count: {
        min: 1,
        max: maxSlides,
        recommended: recommendedSlides
      },
      constraints: {
        each_slide_should_be: "segmented summary punchline distilled from source text",
        words_per_slide_max: maxWordsPerSlide,
        chars_per_slide_max: maxCharsPerSlide,
        concise: true
      },
      mode: context.request.generationMode,
      objective: getSkill03Objective(
        context.corePoints,
        maxSlides,
        recommendedSlides,
        context.request.outputLanguage,
        context.request.tone
      )
    },
    outputSchemaHint: '{"storyboard":[{"index":1,"script":"...","role":"Hook"}]}',
    outputLanguage: context.request.outputLanguage,
    fallbackModels: [appConfig.llm.copyFallbackModel]
  });

  const normalizedFromSlides = (llmResult?.slides ?? []).map((item) => ({
    index: item.index,
    script: item.punchline
  }));

  const storyboard = normalizeStoryboard(
    (llmResult?.storyboard?.length ? llmResult.storyboard : normalizedFromSlides) ?? [],
    maxSlides,
    maxWordsPerSlide,
    maxCharsPerSlide
  );

  const finalStoryboard = storyboard.length
    ? storyboard
    : fallbackStoryboard(context.corePoints, recommendedSlides, maxWordsPerSlide, maxCharsPerSlide);
  const backupStoryboard = fallbackStoryboard(context.corePoints, maxSlides, maxWordsPerSlide, maxCharsPerSlide);
  const desiredCount = autoSlideCount
    ? clampNumber(finalStoryboard.length || recommendedSlides, 1, maxSlides)
    : Math.min(maxSlides, Math.max(recommendedSlides, finalStoryboard.length || 1));
  const uniqueStoryboard = mergeUniqueStoryboard(finalStoryboard, backupStoryboard, desiredCount);

  const languageSafeStoryboard = await enforceStoryboardLanguage({
    storyboard: uniqueStoryboard.slice(0, maxSlides),
    sourceText: context.request.inputText,
    outputLanguage: context.request.outputLanguage,
    maxWordsPerSlide,
    maxCharsPerSlide
  });
  const uniqueLanguageSafeStoryboard = mergeUniqueStoryboard(
    languageSafeStoryboard,
    backupStoryboard,
    uniqueStoryboard.length || 1
  );

  return {
    ...context,
    storyboard: uniqueLanguageSafeStoryboard
  };
}
