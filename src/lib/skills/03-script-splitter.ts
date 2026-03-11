import { callGenericLlmJson, callSkillLlmJson } from "@/lib/llm/skill-client";
import { appConfig } from "@/lib/config";
import { listHasUnexpectedHan } from "@/lib/i18n/text-guard";
import { clampNumber, trimToMaxCharsNoEllipsis } from "@/lib/skills/utils";
import type { ConversionContext, SlideScript } from "@/lib/types/skills";

function getScriptSplitPolicy(mode: ConversionContext["request"]["contentMode"]) {
  if (mode === "product_marketing") {
    return {
      autoMinSlides: 4,
      autoMaxSlides: 6,
      charsPerSlideEstimate: 300,
      quoteWordsMax: 14,
      quoteCharsMax: 72,
      standardWordsMax: 24,
      standardCharsMax: 100,
      goal: "Drive conversion with clear pain->benefit->proof->CTA progression."
    };
  }

  if (mode === "trend_hotspot") {
    return {
      autoMinSlides: 3,
      autoMaxSlides: 5,
      charsPerSlideEstimate: 420,
      quoteWordsMax: 12,
      quoteCharsMax: 58,
      standardWordsMax: 20,
      standardCharsMax: 84,
      goal: "Deliver fast, opinionated, timeline-ready takes."
    };
  }

  return {
    autoMinSlides: 1,
    autoMaxSlides: 8,
    charsPerSlideEstimate: 560,
    quoteWordsMax: 26,
    quoteCharsMax: 150,
    standardWordsMax: 42,
    standardCharsMax: 220,
    goal:
      "Cover source information with high fidelity and low redundancy. Prefer fewer slides with denser information."
  };
}

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

function mergeAdjacentToTarget(
  storyboard: SlideScript[],
  targetCount: number,
  maxWordsPerSlide: number,
  maxCharsPerSlide: number
): SlideScript[] {
  const list = storyboard.map((item) => ({ ...item }));
  while (list.length > targetCount && list.length > 1) {
    let bestIdx = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < list.length - 1; i += 1) {
      const left = list[i]?.script ?? "";
      const right = list[i + 1]?.script ?? "";
      const score = left.length + right.length;
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    const mergedScript = compactScript(
      `${list[bestIdx]?.script ?? ""} ${list[bestIdx + 1]?.script ?? ""}`,
      maxWordsPerSlide,
      maxCharsPerSlide
    );
    list.splice(bestIdx, 2, { index: bestIdx + 1, script: mergedScript });
    for (let i = 0; i < list.length; i += 1) {
      list[i].index = i + 1;
    }
  }
  return list;
}

function splitLongestToTarget(
  storyboard: SlideScript[],
  targetCount: number,
  maxWordsPerSlide: number,
  maxCharsPerSlide: number
): SlideScript[] {
  const list = storyboard.map((item) => ({ ...item }));
  while (list.length < targetCount && list.length > 0) {
    let longestIdx = 0;
    let longestWords = -1;
    for (let i = 0; i < list.length; i += 1) {
      const words = (list[i]?.script ?? "").split(/\s+/).filter(Boolean).length;
      if (words > longestWords) {
        longestWords = words;
        longestIdx = i;
      }
    }

    const source = list[longestIdx]?.script ?? "";
    const words = source.split(/\s+/).filter(Boolean);
    if (words.length < 2) break;

    const half = Math.max(1, Math.floor(words.length / 2));
    const head = compactScript(words.slice(0, half).join(" "), maxWordsPerSlide, maxCharsPerSlide);
    const tail = compactScript(words.slice(half).join(" "), maxWordsPerSlide, maxCharsPerSlide);
    if (!head || !tail) break;

    list.splice(
      longestIdx,
      1,
      { index: longestIdx + 1, script: head },
      { index: longestIdx + 2, script: tail }
    );
    for (let i = 0; i < list.length; i += 1) {
      list[i].index = i + 1;
    }
  }
  return list;
}

function forceStoryboardCount(
  storyboard: SlideScript[],
  targetCount: number,
  maxWordsPerSlide: number,
  maxCharsPerSlide: number
): SlideScript[] {
  const target = clampNumber(targetCount, 1, 8);
  const compacted = mergeAdjacentToTarget(storyboard, target, maxWordsPerSlide, maxCharsPerSlide);
  const expanded = splitLongestToTarget(compacted, target, maxWordsPerSlide, maxCharsPerSlide);
  return expanded.slice(0, target).map((item, idx) => ({ index: idx + 1, script: item.script }));
}

function estimateDynamicSlideCount(
  context: ConversionContext,
  slideLimit: number,
  charsPerSlideEstimate: number,
  mode: ConversionContext["request"]["contentMode"]
): number {
  const sourceChars = context.request.inputText.replace(/\s+/g, "").length;
  const byLength = clampNumber(Math.ceil(sourceChars / charsPerSlideEstimate), 1, 8);
  const byCorePoints = clampNumber(context.corePoints.length || 1, 1, 8);

  if (mode === "longform_digest") {
    const compressedByLength = clampNumber(Math.ceil(sourceChars / Math.max(charsPerSlideEstimate * 1.5, 1)), 1, 8);
    const compressedByPoints = clampNumber(Math.ceil(byCorePoints * 0.6), 1, 8);
    return clampNumber(Math.min(slideLimit, Math.max(compressedByLength, compressedByPoints)), 1, 8);
  }

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
const getSkill03Objective = (
  insights: string[],
  maxSlides: number,
  recommendedSlides: number,
  language: string,
  tone: string,
  modeGoal: string
) => {
  return `Context:
  - Raw Insights: ${JSON.stringify(insights)}
  - Max Slide Count: ${maxSlides}
  - Recommended Slide Count: ${recommendedSlides}
  - Desired Tone: ${tone}
  - Language: ${language}
  - Mode Goal: ${modeGoal}

  Objective: 
  1. Map the raw insights into a sequence of 1..${maxSlides} slides (do NOT exceed ${maxSlides}).
  2. Prefer around ${recommendedSlides} slides. Fewer slides are better when information coverage is still preserved.
  3. Cover key points with minimal redundancy.
  4. Compress information into dense but readable slide copy; each slide should be semantically rich.
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
  const policy = getScriptSplitPolicy(context.request.contentMode);
  const requestedSlideCount = Number.isFinite(context.request.targetSlides)
    ? clampNumber(Number(context.request.targetSlides), 1, 8)
    : undefined;
  const autoSlideCount = requestedSlideCount == null;
  const maxSlides = requestedSlideCount ?? policy.autoMaxSlides;
  const isQuoteMode = context.request.generationMode === "quote_slides";
  const maxWordsPerSlide = isQuoteMode ? policy.quoteWordsMax : policy.standardWordsMax;
  const maxCharsPerSlide = isQuoteMode ? policy.quoteCharsMax : policy.standardCharsMax;
  const recommendedSlides = clampNumber(
    estimateDynamicSlideCount(context, maxSlides, policy.charsPerSlideEstimate, context.request.contentMode),
    autoSlideCount ? policy.autoMinSlides : 1,
    maxSlides
  );

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
      content_mode: context.request.contentMode,
      objective: getSkill03Objective(
        context.corePoints,
        maxSlides,
        recommendedSlides,
        context.request.outputLanguage,
        context.request.tone,
        policy.goal
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
  const preferredAutoCount = clampNumber(Math.min(recommendedSlides, finalStoryboard.length || recommendedSlides), 1, maxSlides);
  const desiredCount = autoSlideCount ? preferredAutoCount : maxSlides;
  const uniqueStoryboard = mergeUniqueStoryboard(finalStoryboard, backupStoryboard, maxSlides);
  const fixedCountStoryboard = forceStoryboardCount(uniqueStoryboard, desiredCount, maxWordsPerSlide, maxCharsPerSlide);

  const languageSafeStoryboard = await enforceStoryboardLanguage({
    storyboard: fixedCountStoryboard.slice(0, maxSlides),
    sourceText: context.request.inputText,
    outputLanguage: context.request.outputLanguage,
    maxWordsPerSlide,
    maxCharsPerSlide
  });
  const uniqueLanguageSafeStoryboard = mergeUniqueStoryboard(
    languageSafeStoryboard,
    backupStoryboard,
    maxSlides
  );
  const finalCountStoryboard = forceStoryboardCount(
    uniqueLanguageSafeStoryboard,
    desiredCount,
    maxWordsPerSlide,
    maxCharsPerSlide
  );

  return {
    ...context,
    storyboard: finalCountStoryboard
  };
}
