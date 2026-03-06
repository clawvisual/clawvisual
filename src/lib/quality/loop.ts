import { appConfig } from "@/lib/config";
import { shouldLockTextForOutputLanguage } from "@/lib/i18n/text-guard";
import { runMultiModelAudit } from "@/lib/audit/multimodal-audit";
import { callGenericLlmJson } from "@/lib/llm/skill-client";
import { trimToMaxCharsNoEllipsis } from "@/lib/skills/utils";
import { applyCoverStrategy, selectCoverStrategies } from "@/lib/quality/cover-strategies";
import {
  DEFAULT_NEGATIVE_PROMPT,
  NEGATIVE_PROMPT_WITH_TEXT_ON_IMAGE,
  generateNanoBananaImage
} from "@/lib/images/nano-banana";
import type { ConversionContext, ConversionResult } from "@/lib/types/skills";

type StoryboardAudit = {
  score: number;
  issues: string[];
  changed: boolean;
  hook?: string;
  storyboard?: Array<{ index?: number; script?: string }>;
};

type PostAudit = {
  score: number;
  issues: string[];
  changed: boolean;
  post_title?: string;
  post_caption?: string;
  hashtags?: string[];
};

type PromptAudit = {
  score: number;
  issue: string;
  suggestion: string;
  optimized_prompt?: string;
  firstGlanceScore?: number;
  noveltyScore?: number;
  conflictVisualHook?: string;
  should_regenerate: boolean;
};

type Candidate = {
  round: number;
  prompt: string;
  imageUrl: string;
  score: number;
  firstGlanceScore?: number;
  noveltyScore?: number;
  issue: string;
  suggestion: string;
};

export type QualityStepReport = {
  step: string;
  summary: string;
};

export type ImageQualityLoopDecision = {
  shouldRun: boolean;
  reason: string;
};

type QualityConfig = {
  enabled: boolean;
  threshold: number;
  imageCoverThreshold: number;
  imageInnerThreshold: number;
  coverFirstGlanceThreshold: number;
  coverNoveltyThreshold: number;
  coverCandidateCount: number;
  copyRounds: number;
  imageRounds: number;
  maxExtraImages: number;
  imageLoopMaxMs: number;
  imageAuditScope: "cover" | "all";
  finalAuditRecoveryThreshold: number;
  reviewCoverCandidates: number;
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function toBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}

function getQualityConfig(): QualityConfig {
  const defaultThreshold = clampInt(process.env.QUALITY_AUDIT_THRESHOLD ?? appConfig.quality.threshold, 55, 95, 78);
  return {
    enabled: toBool(process.env.QUALITY_LOOP_ENABLED ?? appConfig.quality.enabled, true),
    threshold: defaultThreshold,
    imageCoverThreshold: clampInt(
      process.env.QUALITY_IMAGE_COVER_THRESHOLD ?? appConfig.quality.imageCoverThreshold ?? 85,
      60,
      96,
      85
    ),
    imageInnerThreshold: clampInt(
      process.env.QUALITY_IMAGE_INNER_THRESHOLD ?? appConfig.quality.imageInnerThreshold ?? defaultThreshold,
      55,
      95,
      78
    ),
    coverFirstGlanceThreshold: clampInt(process.env.QUALITY_COVER_FIRST_GLANCE_THRESHOLD ?? 82, 55, 95, 82),
    coverNoveltyThreshold: clampInt(process.env.QUALITY_COVER_NOVELTY_THRESHOLD ?? 80, 50, 95, 80),
    coverCandidateCount: clampInt(process.env.QUALITY_COVER_CANDIDATE_COUNT ?? 1, 1, 6, 1),
    copyRounds: clampInt(process.env.QUALITY_MAX_COPY_ROUNDS ?? appConfig.quality.copyRounds, 1, 1, 1),
    imageRounds: clampInt(process.env.QUALITY_MAX_IMAGE_ROUNDS ?? appConfig.quality.imageRounds, 0, 1, 0),
    maxExtraImages: clampInt(process.env.QUALITY_MAX_EXTRA_IMAGES ?? appConfig.quality.maxExtraImages, 0, 8, 1),
    imageLoopMaxMs: clampInt(process.env.QUALITY_IMAGE_LOOP_MAX_MS ?? appConfig.quality.imageLoopMaxMs ?? 120000, 30000, 300000, 120000),
    imageAuditScope:
      (String(process.env.QUALITY_IMAGE_AUDIT_SCOPE ?? appConfig.quality.imageAuditScope ?? "cover").trim().toLowerCase() === "all"
        ? "all"
        : "cover"),
    finalAuditRecoveryThreshold: clampInt(process.env.QUALITY_FINAL_AUDIT_RECOVERY_THRESHOLD ?? 75, 55, 95, 75),
    reviewCoverCandidates: clampInt(process.env.QUALITY_REVIEW_COVER_CANDIDATES ?? 2, 2, 5, 2)
  };
}

function getImageThreshold(config: QualityConfig, slideId: number): number {
  return slideId === 1 ? config.imageCoverThreshold : config.imageInnerThreshold;
}

export function decideImageQualityLoopExecution(
  context: Pick<ConversionContext, "assets">,
  options?: { fastMode?: boolean }
): ImageQualityLoopDecision {
  const config = getQualityConfig();
  if (!config.enabled) {
    return { shouldRun: false, reason: "disabled" };
  }

  const assets = Array.isArray(context.assets) ? context.assets : [];
  if (!assets.length) {
    return { shouldRun: false, reason: "no_assets" };
  }

  const hasCoverAsset = assets.some((asset) => asset.index === 1);
  if (config.imageAuditScope === "cover" && !hasCoverAsset) {
    return { shouldRun: false, reason: "no_cover_asset" };
  }

  const canGenerateCoverCandidates = hasCoverAsset && config.coverCandidateCount > 1 && config.maxExtraImages > 0;
  const canRegenerateByRounds = config.imageRounds > 0 && config.maxExtraImages > 0;
  const hasRegenerationPath = canGenerateCoverCandidates || canRegenerateByRounds;

  if (options?.fastMode && !hasRegenerationPath) {
    return { shouldRun: false, reason: "fast_mode_no_regen_path" };
  }

  return { shouldRun: true, reason: "enabled" };
}

function normalizeOptionalScore(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function isAuditPassing(params: {
  audit: Pick<PromptAudit, "score" | "firstGlanceScore" | "noveltyScore">;
  threshold: number;
  isCover: boolean;
  config: QualityConfig;
}): boolean {
  if (params.audit.score < params.threshold) return false;
  if (!params.isCover) return true;
  return (
    (params.audit.firstGlanceScore ?? 0) >= params.config.coverFirstGlanceThreshold &&
    (params.audit.noveltyScore ?? 0) >= params.config.coverNoveltyThreshold
  );
}

function candidateRank(candidate: Candidate, isCover: boolean): number {
  if (!isCover) return candidate.score;
  const firstGlance = candidate.firstGlanceScore ?? 0;
  const novelty = candidate.noveltyScore ?? 0;
  return candidate.score * 0.7 + firstGlance * 0.2 + novelty * 0.1;
}

async function rewriteCoverPromptByConflict(params: {
  sourceText: string;
  outputLanguage: string;
  quote: string;
  prompt: string;
  issue: string;
}): Promise<{ prompt: string; conflictHook: string }> {
  const rewritten = await callGenericLlmJson<{ conflict_visual_hook?: string; prompt?: string }>({
    instruction: [
      "Rewrite cover-slide image prompt by prioritizing one strong visual conflict hook.",
      "The conflict must be visible immediately in social feed and remain relevant to source meaning.",
      "Return strict JSON only."
    ].join(" "),
    input: {
      source_excerpt: buildContextExcerpt(params.sourceText),
      slide_quote: params.quote,
      previous_prompt: params.prompt,
      current_issue: params.issue,
      constraints: {
        keep_fact_alignment: true,
        feed_stopping_cover: true,
        first_glance_under_0_3s: true
      }
    },
    outputSchemaHint: '{"conflict_visual_hook":"...","prompt":"..."}',
    outputLanguage: params.outputLanguage,
    temperature: 0.25
  });

  const conflictHook = compact(String(rewritten?.conflict_visual_hook ?? "").trim(), 180);
  const prompt = String(rewritten?.prompt ?? "").trim();
  if (prompt) {
    return { prompt, conflictHook };
  }

  if (conflictHook) {
    return {
      prompt: `${params.prompt}\nCover conflict hook: ${conflictHook}.`,
      conflictHook
    };
  }

  return {
    prompt: params.prompt,
    conflictHook: ""
  };
}

function normalizeScript(script: string, maxWords: number, maxChars: number): string {
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

function mergeUniqueStoryboardSlides(
  primary: Array<{ index: number; script: string }>,
  backup: Array<{ index: number; script: string }>,
  targetCount: number
): Array<{ index: number; script: string }> {
  const merged: Array<{ index: number; script: string }> = [];
  const seen = new Set<string>();
  const pushUnique = (item: { script: string }) => {
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

function normalizeHashtags(tags: string[]): string[] {
  return Array.from(
    new Set(
      tags
        .map((tag) => String(tag).trim())
        .filter(Boolean)
        .map((tag) => (tag.startsWith("#") ? tag : `#${tag.replace(/\s+/g, "")}`))
        .filter((tag) => /^#[\p{L}\p{N}_-]+$/u.test(tag))
    )
  ).slice(0, 8);
}

function compact(value: string, max = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized;
}

function buildContextExcerpt(text: string, max = 2400): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

async function auditStoryboard(params: {
  sourceText: string;
  outputLanguage: string;
  hook: string;
  storyboard: Array<{ index: number; script: string }>;
  maxWordsPerSlide: number;
  maxCharsPerSlide: number;
}): Promise<StoryboardAudit | null> {
  return callGenericLlmJson<StoryboardAudit>({
    instruction: [
      "You are a strict social-carousel copy auditor and editor.",
      "Audit cover hook + storyboard for virality, clarity, rhythm, and factual faithfulness.",
      "If weak, rewrite minimally but effectively while preserving core facts.",
      "Keep slide count and index unchanged.",
      "Ensure each slide conveys a distinct idea; do not duplicate the same claim across slides.",
      "Return strict JSON only."
    ].join(" "),
    input: {
      source_excerpt: buildContextExcerpt(params.sourceText),
      hook: params.hook,
      storyboard: params.storyboard,
      constraints: {
        words_per_slide_max: params.maxWordsPerSlide,
        chars_per_slide_max: params.maxCharsPerSlide,
        preserve_slide_count: true,
        preserve_facts: true,
        keep_language: params.outputLanguage
      }
    },
    outputSchemaHint:
      '{"score":82,"issues":["..."],"changed":true,"hook":"...","storyboard":[{"index":1,"script":"..."}]}',
    outputLanguage: params.outputLanguage,
    temperature: 0.2,
    fallbackModels: [appConfig.llm.copyFallbackModel]
  });
}

async function auditPostCopy(params: {
  sourceText: string;
  outputLanguage: string;
  result: ConversionResult;
}): Promise<PostAudit | null> {
  return callGenericLlmJson<PostAudit>({
    instruction: [
      "You are a social post quality auditor and copy editor.",
      "Audit title/caption/hashtags for shareability, factual alignment, and language quality.",
      "Rewrite only when it improves quality; keep meaning and facts consistent.",
      "Return strict JSON only."
    ].join(" "),
    input: {
      source_excerpt: buildContextExcerpt(params.sourceText),
      post_title: params.result.post_title,
      post_caption: params.result.post_caption,
      hashtags: params.result.hashtags
    },
    outputSchemaHint:
      '{"score":80,"issues":["..."],"changed":true,"post_title":"...","post_caption":"...","hashtags":["#tag"]}',
    outputLanguage: params.outputLanguage,
    temperature: 0.2,
    fallbackModels: [appConfig.llm.copyFallbackModel]
  });
}

async function auditPromptAndSlide(params: {
  sourceText: string;
  outputLanguage: string;
  quote: string;
  prompt: string;
  imageUrl: string;
  styleHint: string;
  aspectRatio: string;
  previousIssue?: string;
}): Promise<PromptAudit> {
  const audited = await callGenericLlmJson<PromptAudit>({
    instruction: [
      "You are a creative quality gate for social-slide image generation.",
      "Evaluate prompt-image-copy alignment, composition safety, readability risk, visual specificity, first-glance recognizability, novelty, and emotional impact.",
      "Provide a better prompt when quality is weak.",
      "Return strict JSON only."
    ].join(" "),
    input: {
      source_excerpt: buildContextExcerpt(params.sourceText),
      slide_quote: params.quote,
      current_prompt: params.prompt,
      current_image_url: params.imageUrl,
      style_hint: params.styleHint,
      aspect_ratio: params.aspectRatio,
      previous_issue: params.previousIssue ?? ""
    },
    outputSchemaHint:
      '{"score":74,"first_glance_score":81,"novelty_score":76,"issue":"...","suggestion":"...","optimized_prompt":"...","conflict_visual_hook":"...","should_regenerate":true}',
    outputLanguage: params.outputLanguage,
    temperature: 0.2
  });

  if (!audited) {
    return {
      score: 65,
      issue: "Prompt auditor unavailable.",
      suggestion: "Keep current prompt and avoid over-editing.",
      optimized_prompt: params.prompt,
      should_regenerate: false
    };
  }

  const score = clampInt(audited.score, 0, 100, 65);
  const firstGlanceScore = normalizeOptionalScore((audited as { first_glance_score?: unknown }).first_glance_score ?? audited.firstGlanceScore);
  const noveltyScore = normalizeOptionalScore((audited as { novelty_score?: unknown }).novelty_score ?? audited.noveltyScore);
  const issue = compact(String(audited.issue ?? "").trim() || "No critical issue.", 180);
  const suggestion = compact(String(audited.suggestion ?? "").trim() || "No suggestion.", 220);
  const optimizedPrompt = String(audited.optimized_prompt ?? "").trim();
  const conflictVisualHook = compact(
    String((audited as { conflict_visual_hook?: unknown }).conflict_visual_hook ?? audited.conflictVisualHook ?? "").trim(),
    180
  );

  return {
    score,
    firstGlanceScore,
    noveltyScore,
    issue,
    suggestion,
    optimized_prompt: optimizedPrompt || params.prompt,
    conflictVisualHook,
    should_regenerate: Boolean(audited.should_regenerate) && optimizedPrompt.length > 0
  };
}

async function chooseBestCandidate(params: {
  sourceText: string;
  outputLanguage: string;
  quote: string;
  isCover: boolean;
  candidates: Candidate[];
}): Promise<Candidate> {
  if (params.candidates.length === 1) {
    return params.candidates[0];
  }

  const sorted = [...params.candidates].sort((a, b) => candidateRank(b, params.isCover) - candidateRank(a, params.isCover));
  const top = sorted[0];
  const second = sorted[1];

  if (candidateRank(top, params.isCover) - candidateRank(second, params.isCover) >= 4) {
    return top;
  }

  const judged = await callGenericLlmJson<{ chosen_round?: number; reason?: string }>({
    instruction: [
      "You are selecting the best final image candidate for one social slide.",
      "Prioritize semantic alignment with quote, visual clarity, and social appeal.",
      "Choose one candidate round id.",
      "Return strict JSON only."
    ].join(" "),
    input: {
      source_excerpt: buildContextExcerpt(params.sourceText),
      slide_quote: params.quote,
      candidates: sorted.map((item) => ({
        round: item.round,
        score: item.score,
        first_glance_score: item.firstGlanceScore,
        novelty_score: item.noveltyScore,
        weighted_rank: candidateRank(item, params.isCover),
        issue: item.issue,
        prompt_preview: compact(item.prompt, 260),
        image_url: item.imageUrl.startsWith("http") ? item.imageUrl : ""
      }))
    },
    outputSchemaHint: '{"chosen_round":1,"reason":"..."}',
    outputLanguage: params.outputLanguage,
    temperature: 0
  });

  const chosen = sorted.find((item) => item.round === Number(judged?.chosen_round));
  return chosen ?? top;
}

export async function runStoryboardQualityLoop(context: ConversionContext): Promise<{
  context: ConversionContext;
  report: QualityStepReport;
}> {
  const config = getQualityConfig();
  if (!config.enabled) {
    return {
      context,
      report: {
        step: "quality_storyboard_loop",
        summary: "disabled"
      }
    };
  }

  const isQuoteMode = context.request.generationMode === "quote_slides";
  const maxWordsPerSlide = isQuoteMode ? 14 : 28;
  const maxCharsPerSlide = isQuoteMode ? 64 : 86;

  let hook = context.hooks[0] ?? "";
  let storyboard = context.storyboard.map((slide) => ({ ...slide }));
  let lastScore = 0;
  let changes = 0;

  for (let round = 1; round <= config.copyRounds; round += 1) {
    const audited = await auditStoryboard({
      sourceText: context.request.inputText,
      outputLanguage: context.request.outputLanguage,
      hook,
      storyboard,
      maxWordsPerSlide,
      maxCharsPerSlide
    });

    if (!audited) break;
    lastScore = clampInt(audited.score, 0, 100, 0);

    if (audited.changed) {
      if (audited.hook?.trim()) {
        hook = audited.hook.trim();
      }

      const updatedSlides = Array.isArray(audited.storyboard)
        ? audited.storyboard
            .map((item, idx) => ({
              index: Number(item.index ?? idx + 1),
              script: normalizeScript(String(item.script ?? ""), maxWordsPerSlide, maxCharsPerSlide)
            }))
            .filter((item) => Number.isFinite(item.index) && item.index > 0 && item.script.length > 0)
            .sort((a, b) => a.index - b.index)
        : [];

      if (updatedSlides.length === storyboard.length) {
        storyboard = mergeUniqueStoryboardSlides(updatedSlides, storyboard, storyboard.length);
        changes += 1;
      }
    }

    if (lastScore >= config.threshold || !audited.changed) {
      break;
    }
  }

  const nextContext: ConversionContext = {
    ...context,
    hooks: hook ? [hook, ...context.hooks.slice(1)] : context.hooks,
    storyboard
  };

  return {
    context: nextContext,
    report: {
      step: "quality_storyboard_loop",
      summary: `score=${lastScore}; rounds<=${config.copyRounds}; changed=${changes}`
    }
  };
}

export async function runImageQualityLoop(context: ConversionContext): Promise<{
  context: ConversionContext;
  report: QualityStepReport;
}> {
  const config = getQualityConfig();
  if (!config.enabled) {
    return {
      context,
      report: {
        step: "quality_image_loop",
        summary: "disabled"
      }
    };
  }

  const aspectRatio = context.request.aspectRatios[0] ?? "4:5";
  const textOnImage = context.request.generationMode === "quote_slides";
  let extraImagesBudget = config.maxExtraImages;
  let regenerated = 0;
  const changedSlideIds: number[] = [];
  const startedAt = Date.now();
  const deadlineAt = startedAt + config.imageLoopMaxMs;

  const nextAssets = [...context.assets];

  for (let i = 0; i < nextAssets.length; i += 1) {
    if (Date.now() >= deadlineAt) {
      break;
    }

    const asset = nextAssets[i];
    const isCoverSlide = asset.index === 1;
    if (config.imageAuditScope === "cover" && !isCoverSlide) {
      continue;
    }
    const slideThreshold = getImageThreshold(config, asset.index);
    const visual = context.visuals.find((item) => item.index === asset.index);
    const quote = context.storyboard.find((item) => item.index === asset.index)?.script ?? visual?.hierarchy.body ?? "";

    const candidates: Candidate[] = [];
    let candidateRound = 0;
    const pushCandidate = (audit: PromptAudit, prompt: string, imageUrl: string) => {
      candidates.push({
        round: candidateRound,
        prompt,
        imageUrl,
        score: audit.score,
        firstGlanceScore: audit.firstGlanceScore,
        noveltyScore: audit.noveltyScore,
        issue: audit.issue,
        suggestion: audit.suggestion
      });
      candidateRound += 1;
    };

    let currentPrompt = asset.prompt;
    let currentImageUrl = asset.imageUrl;
    let previousIssue = "";
    let skipRegeneration = false;

    if (isCoverSlide) {
      const baseAudit = await auditPromptAndSlide({
        sourceText: context.request.inputText,
        outputLanguage: context.request.outputLanguage,
        quote,
        prompt: currentPrompt,
        imageUrl: currentImageUrl,
        styleHint: context.visualStyleProfile.globalDirection,
        aspectRatio,
        previousIssue
      });
      pushCandidate(baseAudit, currentPrompt, currentImageUrl);

      const strategyCount = Math.max(0, config.coverCandidateCount - 1);
      const coverStrategies = selectCoverStrategies({
        sourceText: context.request.inputText,
        corePoints: context.corePoints,
        trendTags: context.trendSignals.map((item) => item.tag),
        count: strategyCount
      });
      for (const strategy of coverStrategies) {
        if (extraImagesBudget <= 0) break;
        const strategyPrompt = applyCoverStrategy(asset.prompt, strategy.directive);
        const negativePrompt = textOnImage ? NEGATIVE_PROMPT_WITH_TEXT_ON_IMAGE : DEFAULT_NEGATIVE_PROMPT;
        const lockedTexts =
          textOnImage && shouldLockTextForOutputLanguage(quote, context.request.outputLanguage) ? [quote] : [];
        const strategyGenerated = await generateNanoBananaImage({
          prompt: strategyPrompt,
          aspectRatio,
          negativePrompt,
          seed: asset.index * 1000 + candidateRound + 11,
          textOnImage,
          lockedTexts
        });
        extraImagesBudget -= 1;
        regenerated += 1;

        const strategyAudit = await auditPromptAndSlide({
          sourceText: context.request.inputText,
          outputLanguage: context.request.outputLanguage,
          quote,
          prompt: strategyPrompt,
          imageUrl: strategyGenerated.imageUrl,
          styleHint: context.visualStyleProfile.globalDirection,
          aspectRatio,
          previousIssue
        });
        pushCandidate(strategyAudit, strategyPrompt, strategyGenerated.imageUrl);
      }

      const initialBest = await chooseBestCandidate({
        sourceText: context.request.inputText,
        outputLanguage: context.request.outputLanguage,
        quote,
        isCover: true,
        candidates
      });
      currentPrompt = initialBest.prompt;
      currentImageUrl = initialBest.imageUrl;
      previousIssue = initialBest.issue;
      skipRegeneration = isAuditPassing({
        audit: {
          score: initialBest.score,
          firstGlanceScore: initialBest.firstGlanceScore,
          noveltyScore: initialBest.noveltyScore
        },
        threshold: slideThreshold,
        isCover: true,
        config
      });
    }

    const roundStart = isCoverSlide ? 1 : 0;
    for (let round = roundStart; round <= config.imageRounds && !skipRegeneration; round += 1) {
      if (Date.now() >= deadlineAt) {
        break;
      }
      const audit = await auditPromptAndSlide({
        sourceText: context.request.inputText,
        outputLanguage: context.request.outputLanguage,
        quote,
        prompt: currentPrompt,
        imageUrl: currentImageUrl,
        styleHint: context.visualStyleProfile.globalDirection,
        aspectRatio,
        previousIssue
      });

      pushCandidate(audit, currentPrompt, currentImageUrl);

      if (isAuditPassing({
        audit,
        threshold: slideThreshold,
        isCover: isCoverSlide,
        config
      }) || !audit.should_regenerate || round === config.imageRounds) {
        break;
      }

      if (extraImagesBudget <= 0) {
        break;
      }

      let rewrittenPrompt = (audit.optimized_prompt ?? "").trim();
      if (!rewrittenPrompt || rewrittenPrompt === currentPrompt) {
        break;
      }

      if (isCoverSlide) {
        const conflictRewrite = await rewriteCoverPromptByConflict({
          sourceText: context.request.inputText,
          outputLanguage: context.request.outputLanguage,
          quote,
          prompt: rewrittenPrompt,
          issue: [audit.issue, audit.conflictVisualHook].filter(Boolean).join(" | ")
        });
        rewrittenPrompt = conflictRewrite.prompt.trim() || rewrittenPrompt;
      }

      const negativePrompt = textOnImage ? NEGATIVE_PROMPT_WITH_TEXT_ON_IMAGE : DEFAULT_NEGATIVE_PROMPT;
      const lockedTexts =
        textOnImage && shouldLockTextForOutputLanguage(quote, context.request.outputLanguage) ? [quote] : [];

      const generated = await generateNanoBananaImage({
        prompt: rewrittenPrompt,
        aspectRatio,
        negativePrompt,
        seed: asset.index * 100 + round + 1,
        textOnImage,
        lockedTexts
      });

      extraImagesBudget -= 1;
      regenerated += 1;
      previousIssue = [audit.issue, audit.conflictVisualHook].filter(Boolean).join(" | ");
      currentPrompt = rewrittenPrompt;
      currentImageUrl = generated.imageUrl;
    }

    if (!candidates.length) {
      continue;
    }
    const chosen = await chooseBestCandidate({
      sourceText: context.request.inputText,
      outputLanguage: context.request.outputLanguage,
      quote,
      isCover: isCoverSlide,
      candidates
    });

    if (chosen.prompt !== asset.prompt || chosen.imageUrl !== asset.imageUrl) {
      changedSlideIds.push(asset.index);
    }

    nextAssets[i] = {
      ...asset,
      prompt: chosen.prompt,
      imageUrl: chosen.imageUrl
    };
  }

  return {
    context: {
      ...context,
      assets: nextAssets
    },
    report: {
      step: "quality_image_loop",
      summary: `scope=${config.imageAuditScope}; regen=${regenerated}; changed_slides=${changedSlideIds.join(",") || "none"}; thresholds=cover:${config.imageCoverThreshold}/inner:${config.imageInnerThreshold}; budget_left=${extraImagesBudget}; elapsed_ms=${Date.now() - startedAt}/${config.imageLoopMaxMs}`
    }
  };
}

export async function runPostCopyQualityLoop(params: {
  result: ConversionResult;
  sourceText: string;
  outputLanguage: string;
}): Promise<{
  result: ConversionResult;
  report: QualityStepReport;
}> {
  const config = getQualityConfig();
  if (!config.enabled) {
    return {
      result: params.result,
      report: {
        step: "quality_post_copy_loop",
        summary: "disabled"
      }
    };
  }

  const result = JSON.parse(JSON.stringify(params.result)) as ConversionResult;
  let changes = 0;
  let lastScore = 0;

  for (let round = 1; round <= config.copyRounds; round += 1) {
    const audited = await auditPostCopy({
      sourceText: params.sourceText,
      outputLanguage: params.outputLanguage,
      result
    });
    if (!audited) break;

    lastScore = clampInt(audited.score, 0, 100, 0);
    if (audited.changed) {
      const nextTitle = String(audited.post_title ?? "").trim();
      const nextCaption = String(audited.post_caption ?? "").trim();
      const nextTags = normalizeHashtags(audited.hashtags ?? []);

      if (nextTitle) {
        result.post_title = nextTitle;
      }
      if (nextCaption) {
        result.post_caption = nextCaption;
      }
      if (nextTags.length) {
        result.hashtags = nextTags;
      }
      changes += 1;
    }

    if (lastScore >= config.threshold || !audited.changed) {
      break;
    }
  }

  return {
    result,
    report: {
      step: "quality_post_copy_loop",
      summary: `score=${lastScore}; rounds<=${config.copyRounds}; changed=${changes}`
    }
  };
}

type CopyPolishAudit = {
  changed: boolean;
  reason?: string;
  post_title?: string;
  post_caption?: string;
};

export async function runCopyPolishLoop(params: {
  result: ConversionResult;
  sourceText: string;
  outputLanguage: string;
}): Promise<{
  result: ConversionResult;
  report: QualityStepReport;
}> {
  const model = appConfig.llm.copyPolishModel.trim();
  if (!model) {
    return {
      result: params.result,
      report: {
        step: "quality_copy_polish",
        summary: "skipped:no_model"
      }
    };
  }

  const polished = await callGenericLlmJson<CopyPolishAudit>({
    instruction: [
      "Polish social media title (hook) and caption for higher shareability.",
      "Preserve factual meaning and avoid adding new claims.",
      "Keep title concise and feed-stopping.",
      "Keep caption clear, rhythmic, and actionable.",
      "Return strict JSON only."
    ].join(" "),
    input: {
      source_excerpt: buildContextExcerpt(params.sourceText),
      post_title: params.result.post_title,
      post_caption: params.result.post_caption,
      hashtags: params.result.hashtags
    },
    outputSchemaHint:
      '{"changed":true,"reason":"...","post_title":"...","post_caption":"..."}',
    outputLanguage: params.outputLanguage,
    temperature: 0.3,
    model,
    fallbackModels: [appConfig.llm.model, appConfig.llm.copyFallbackModel]
  });

  if (!polished) {
    return {
      result: params.result,
      report: {
        step: "quality_copy_polish",
        summary: `skipped:llm_unavailable(model=${model})`
      }
    };
  }

  const nextTitle = compact(String(polished.post_title ?? "").trim(), 120);
  const nextCaption = compact(String(polished.post_caption ?? "").trim(), 560);
  const changed = Boolean(polished.changed) && Boolean(nextTitle || nextCaption);

  if (!changed) {
    return {
      result: params.result,
      report: {
        step: "quality_copy_polish",
        summary: `unchanged(model=${model})`
      }
    };
  }

  const nextResult: ConversionResult = {
    ...params.result,
    post_title: nextTitle || params.result.post_title,
    post_caption: nextCaption || params.result.post_caption
  };

  return {
    result: nextResult,
    report: {
      step: "quality_copy_polish",
      summary: `changed(model=${model}); reason=${compact(String(polished.reason ?? ""), 90) || "n/a"}`
    }
  };
}

async function runFinalAudit(params: {
  result: ConversionResult;
  outputLanguage: string;
}): Promise<number> {
  const audit = await runMultiModelAudit({
    slides: params.result.slides.map((slide) => ({
      slide_id: slide.slide_id,
      content_quote: slide.content_quote,
      image_url: slide.image_url,
      visual_prompt: slide.visual_prompt
    })),
    outputLanguage: params.outputLanguage,
    targetAudience: "social media readers",
    platform: params.result.platform_type
  });

  return Number(audit.summary.overall_average_score);
}

async function rewriteCoverPromptForFinalAudit(params: {
  sourceText: string;
  outputLanguage: string;
  quote: string;
  prompt: string;
}): Promise<string> {
  const rewritten = await callGenericLlmJson<{ prompt?: string }>({
    instruction: [
      "Rewrite cover image prompt to improve social feed stopping power and readability.",
      "Preserve semantic alignment with source text.",
      "Prioritize one dominant subject, strong contrast, and 0.3s first-glance clarity.",
      "Return strict JSON only."
    ].join(" "),
    input: {
      source_excerpt: buildContextExcerpt(params.sourceText),
      slide_quote: params.quote,
      previous_prompt: params.prompt
    },
    outputSchemaHint: '{"prompt":"..."}',
    outputLanguage: params.outputLanguage,
    temperature: 0.2
  });

  const nextPrompt = String(rewritten?.prompt ?? "").trim();
  return nextPrompt || params.prompt;
}

export async function runFinalAuditRecovery(params: {
  result: ConversionResult;
  sourceText: string;
  outputLanguage: string;
}): Promise<{
  result: ConversionResult;
  report: QualityStepReport;
}> {
  const config = getQualityConfig();
  if (!config.enabled) {
    return {
      result: params.result,
      report: {
        step: "quality_final_audit",
        summary: "disabled"
      }
    };
  }

  try {
    const firstScore = await runFinalAudit({
      result: params.result,
      outputLanguage: params.outputLanguage
    });
    if (firstScore >= config.finalAuditRecoveryThreshold) {
      return {
        result: params.result,
        report: {
          step: "quality_final_audit",
          summary: `avg=${Math.round(firstScore)}; recovered=no`
        }
      };
    }

    const cover = params.result.slides.find((slide) => slide.slide_id === 1);
    if (!cover) {
      return {
        result: params.result,
        report: {
          step: "quality_final_audit",
          summary: `avg=${Math.round(firstScore)}; recovered=no_cover`
        }
      };
    }

    const rewrittenPrompt = await rewriteCoverPromptForFinalAudit({
      sourceText: params.sourceText,
      outputLanguage: params.outputLanguage,
      quote: cover.content_quote,
      prompt: cover.visual_prompt
    });
    const regenerated = await generateNanoBananaImage({
      prompt: rewrittenPrompt,
      aspectRatio: params.result.aspect_ratio,
      negativePrompt: DEFAULT_NEGATIVE_PROMPT,
      textOnImage: false,
      seed: 100001
    });

    const nextResult: ConversionResult = {
      ...params.result,
      slides: params.result.slides.map((slide) =>
        slide.slide_id === 1
          ? {
              ...slide,
              visual_prompt: rewrittenPrompt,
              image_url: regenerated.imageUrl
            }
          : slide
      )
    };

    const recoveredScore = await runFinalAudit({
      result: nextResult,
      outputLanguage: params.outputLanguage
    });

    return {
      result: recoveredScore > firstScore ? nextResult : params.result,
      report: {
        step: "quality_final_audit",
        summary: `avg=${Math.round(firstScore)}=>${Math.round(recoveredScore)}; recovered=${recoveredScore > firstScore ? "cover" : "no_gain"}`
      }
    };
  } catch (error) {
    return {
      result: params.result,
      report: {
        step: "quality_final_audit",
        summary: `failed: ${error instanceof Error ? compact(error.message, 120) : "unknown"}`
      }
    };
  }
}

export async function runCoverReviewPack(params: {
  result: ConversionResult;
  sourceText: string;
}): Promise<ConversionResult["review"]> {
  const config = getQualityConfig();
  const cover = params.result.slides.find((slide) => slide.slide_id === 1);
  if (!cover) {
    return {
      required: true,
      reason: "Cover slide missing; manual review required."
    };
  }

  const candidates: Array<{ label: string; visual_prompt: string; image_url: string }> = [
    {
      label: "current",
      visual_prompt: cover.visual_prompt,
      image_url: cover.image_url
    }
  ];

  const strategies = selectCoverStrategies({
    sourceText: params.sourceText,
    corePoints: [cover.content_quote],
    trendTags: (params.result.trend_signals ?? []).map((item) => item.tag),
    count: Math.max(1, config.reviewCoverCandidates - 1)
  });

  for (const strategy of strategies) {
    const prompt = applyCoverStrategy(cover.visual_prompt, strategy.directive);
    const generated = await generateNanoBananaImage({
      prompt,
      aspectRatio: params.result.aspect_ratio,
      negativePrompt: DEFAULT_NEGATIVE_PROMPT,
      textOnImage: false,
      seed: 200000 + candidates.length
    });
    candidates.push({
      label: strategy.id,
      visual_prompt: prompt,
      image_url: generated.imageUrl
    });
  }

  return {
    required: true,
    reason: "High-value mode enabled. Please confirm one cover candidate before distribution.",
    cover_candidates: candidates
  };
}

export async function runAutoFinalAudit(params: {
  result: ConversionResult;
  outputLanguage: string;
}): Promise<QualityStepReport> {
  const audited = await runFinalAuditRecovery({
    result: params.result,
    sourceText: "",
    outputLanguage: params.outputLanguage
  });
  return audited.report;
}
