import { appConfig } from "@/lib/config";
import { beginUsageScope, formatUsageSummary, snapshotUsage } from "@/lib/llm/usage-tracker";
import { resolveContentPipeline } from "@/lib/pipeline/registry";
import { runCopyPolishLoop, runCoverReviewPack, runFinalAuditRecovery, runPostCopyQualityLoop } from "@/lib/quality/loop";
import { skillInputProcessor } from "@/lib/skills/input-processor";
import { skillAssetGenerator } from "@/lib/skills/asset-generator";
import { skillViralOptimizer } from "@/lib/skills/viral-optimizer";
import { skillContentPlanner } from "@/lib/skills/content-planner";
import { skillVisualPromptPlanner } from "@/lib/skills/visual-prompt-planner";
import type { ConversionContext, ConversionRequest, ConversionResult } from "@/lib/types/skills";

type ProgressCallback = (step: string, progress: number, outputPreview?: string) => Promise<void> | void;

function createInitialContext(request: ConversionRequest): ConversionContext {
  return {
    request,
    corePoints: [],
    hooks: [],
    storyboard: [],
    slideCardPlans: [],
    visuals: [],
    visualStyleProfile: {
      visualDomain: "general",
      recommendedPreset: request.brand.stylePreset,
      recommendedTone: request.tone,
      styleKeywords: ["clean editorial storytelling visuals"],
      negativeKeywords: ["fantasy", "sci-fi", "landscape painting"],
      globalDirection: "Consistent editorial visual language across all slides.",
      rationale: "Default style profile."
    },
    theme: { cssVariables: {} },
    assetPromptPlans: [],
    assets: [],
    compositions: [],
    resizedOutputs: [],
    audits: [],
    sourceEvidence: [],
    trendSignals: [],
    cta: "",
    caption: "",
    hashtags: []
  };
}

function truncate(value: string, max = 200): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized;
}

function normalizeHashtags(tags: string[], limit = 5): string[] {
  const normalized = tags
    .map((tag) => String(tag).trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag.replace(/\s+/g, "")}`))
    .filter((tag) => /^#[\p{L}\p{N}_-]+$/u.test(tag));

  return Array.from(new Set(normalized)).slice(0, Math.max(1, limit));
}

function fallbackHashtags(input: string): string[] {
  const text = input.toLowerCase();
  if (text.includes("ai")) {
    return ["#AI", "#Automation", "#ContentMarketing", "#Productivity", "#CreatorEconomy", "#Growth"];
  }
  if (text.includes("startup")) {
    return ["#Startup", "#Founders", "#Growth", "#Execution", "#Business", "#BuildInPublic"];
  }
  return ["#ContentStrategy", "#SocialMedia", "#Marketing", "#Branding", "#Storytelling", "#Creator"];
}

function toSingleSentence(title: string): string {
  const normalized = title.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const sentence = normalized
    .split(/(?<=[。！？.!?])\s+|\n+/)
    .map((item) => item.trim())
    .find(Boolean) ?? normalized;
  return truncate(sentence, 90);
}

function normalizeCaptionLength(caption: string, fallbackText: string): string {
  const trimToNaturalBoundary = (value: string, maxChars: number): string => {
    if (value.length <= maxChars) return value;
    const head = value.slice(0, maxChars + 1);

    const sentenceMarks = Array.from(head.matchAll(/[。！？.!?](?=\s|$)/g));
    const lastSentenceMark = sentenceMarks[sentenceMarks.length - 1];
    if (lastSentenceMark?.index != null) {
      const cut = lastSentenceMark.index + 1;
      if (cut >= Math.floor(maxChars * 0.55)) {
        return head.slice(0, cut).trim();
      }
    }

    const wordCut = Math.max(head.lastIndexOf(" "), head.lastIndexOf("\n"), head.lastIndexOf("\t"));
    if (wordCut >= Math.floor(maxChars * 0.6)) {
      return head.slice(0, wordCut).trim();
    }

    return value.slice(0, maxChars).trim();
  };

  const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
  let content = normalize(caption);
  const fallback = normalize(fallbackText);
  if (!content) content = fallback;
  if (!content) return "";

  if (content.length > 300) {
    content = trimToNaturalBoundary(content, 300);
  }

  if (content.length < 100) {
    const pool = fallback && fallback !== content ? `${content} ${fallback}` : content;
    content = trimToNaturalBoundary(pool, 300);
    if (content.length < 100) {
      content = trimToNaturalBoundary(`${content} ${content}`, 300);
    }
  }

  return content;
}

function inferPlatformType(aspectRatio: ConversionRequest["aspectRatios"][number]): ConversionResult["platform_type"] {
  if (aspectRatio === "9:16") return "TikTok";
  if (aspectRatio === "1:1") return "Twitter";
  if (aspectRatio === "16:9") return "LinkedIn";
  return "Instagram";
}

function buildCoreSkillPreview(stage: string, context: ConversionContext): string {
  switch (stage) {
    case "skill_content_planner":
      return truncate(
        `title=${context.hooks[0] ?? "n/a"} slides=${context.storyboard.length} cards=${context.slideCardPlans.reduce((acc, item) => acc + item.cards.length, 0)}`
      );
    case "skill_visual_prompt_planner":
      return truncate(context.assetPromptPlans.slice(0, 2).map((item) => `#${item.index} ${item.prompt}`).join(" | "));
    case "skill_asset_generator":
      return truncate(context.assets.slice(0, 2).map((asset) => `#${asset.index} ${asset.prompt}`).join(" | "));
    case "skill_viral_optimizer":
      return truncate(`${context.caption} ${context.hashtags.join(" ")}`);
    default:
      return "stage completed";
  }
}

function buildBaseResult(context: ConversionContext, skillLogs: ConversionResult["skill_logs"]): ConversionResult {
  const aspectRatio = context.request.aspectRatios[0] ?? "4:5";
  const normalizedHashtags = normalizeHashtags(context.hashtags, 5);
  const defaultHashtags = fallbackHashtags(context.request.inputText);
  const hashtags =
    normalizedHashtags.length >= 1
      ? normalizedHashtags
      : normalizeHashtags([...normalizedHashtags, ...defaultHashtags], 5).slice(0, 5);

  const css = context.theme.cssVariables;
  const brandOverlayBase = {
    logo_position: "bottom-right",
    color_values: {
      primary: css["--vf-primary"] ?? "#22d3ee",
      secondary: css["--vf-secondary"] ?? "#34d399",
      background: css["--vf-bg"] ?? "#091322",
      text: css["--vf-text"] ?? "#e8f1ff"
    },
    font_name: context.request.brand.fonts?.[0] ?? "System Sans",
    logo_url: context.request.brand.logoUrl
  };

  return {
    post_title: context.hooks[0] ?? context.request.sourceTitle ?? context.corePoints[0] ?? "clawvisual AI Result",
    post_caption: context.caption || truncate(context.corePoints.join(" "), 500),
    hashtags,
    platform_type: inferPlatformType(aspectRatio),
    source_evidence: context.sourceEvidence.slice(0, 6),
    trend_signals: context.trendSignals.slice(0, 10),
    slides: context.storyboard.map((story) => {
      const isQuoteMode = context.request.generationMode === "quote_slides";
      const visual = context.visuals.find((item) => item.index === story.index);
      const asset = context.assets.find((item) => item.index === story.index);
      const composition = context.compositions.find((item) => item.index === story.index);

      return {
        slide_id: story.index,
        is_cover: story.index === 1,
        content_quote: isQuoteMode ? story.script : composition?.script ?? visual?.hierarchy.body ?? story.script,
        visual_prompt: asset?.prompt ?? visual?.metaphor ?? "",
        image_url: composition?.imageUrl ?? asset?.imageUrl ?? "",
        layout_template: composition?.layout ?? visual?.layout ?? "TEMPLATE_LIST",
        focus_keywords: visual?.hierarchy.highlightKeywords ?? [],
        metaphor_title: visual?.metaphorPlan?.metaphorName ?? asset?.metaphorConcept,
        ai_reasoning: visual?.metaphorPlan?.reasoning ?? asset?.designReasoning,
        text_overlay_position: asset?.negativeSpaceArea,
        style_tag: asset?.styleTag ?? visual?.metaphorPlan?.styleTag ?? context.visualStyleProfile.recommendedPreset,
        diagram_type: asset?.diagramType ?? visual?.metaphorPlan?.diagramType,
        entity_tags: asset?.entityTags ?? visual?.metaphorPlan?.entityTags,
        metric_tags: asset?.metricTags ?? visual?.metaphorPlan?.metricTags,
        prompt_logs: asset?.prompt,
        brand_overlay: { ...brandOverlayBase }
      };
    }),
    skill_logs: skillLogs,
    aspect_ratio: aspectRatio
  };
}

function stageProgress(index: number, total: number): number {
  if (total <= 0) return 99;
  return Math.max(5, Math.min(99, Math.round(((index + 1) / total) * 99)));
}

export async function runConversion(
  request: ConversionRequest,
  onProgress?: ProgressCallback
): Promise<ConversionResult> {
  const usageScope = beginUsageScope();
  const startedAt = Date.now();
  const pipelineMaxMs = Math.max(120000, Number(appConfig.pipeline.maxDurationMs || 300000));
  const deadlineAt = startedAt + pipelineMaxMs;
  const isTimedOut = () => Date.now() >= deadlineAt;
  const pipelineMode = appConfig.pipeline.mode === "fast" ? "fast" : "full";
  const stagePlan = resolveContentPipeline(request.contentMode)[pipelineMode];

  const skillLogs: ConversionResult["skill_logs"] = [];
  let activeRequest = request;
  let context: ConversionContext | null = null;
  let result: ConversionResult | null = null;

  const ensureContext = () => {
    if (!context) {
      throw new Error("Pipeline error: conversion context is not initialized.");
    }
    return context;
  };

  const ensureResult = () => {
    if (result) return result;
    const currentContext = ensureContext();
    result = buildBaseResult(currentContext, skillLogs);
    return result;
  };

  for (let index = 0; index < stagePlan.length; index += 1) {
    const stage = stagePlan[index];
    if (isTimedOut() && stage.startsWith("skill_quality_")) {
      break;
    }

    const progress = stageProgress(index, stagePlan.length);
    try {
      let outputPreview = "";

      switch (stage) {
        case "skill_input_processor": {
          activeRequest = await skillInputProcessor(activeRequest);
          context = createInitialContext(activeRequest);
          outputPreview = truncate(
            `mode=${activeRequest.contentMode} source=${activeRequest.sourceType ?? "text"} title=${activeRequest.sourceTitle ?? "n/a"} chars=${activeRequest.inputText.length}`
          );
          break;
        }
        case "skill_content_planner": {
          context = await skillContentPlanner(ensureContext());
          outputPreview = buildCoreSkillPreview(stage, ensureContext());
          break;
        }
        case "skill_visual_prompt_planner": {
          context = await skillVisualPromptPlanner(ensureContext());
          outputPreview = buildCoreSkillPreview(stage, ensureContext());
          break;
        }
        case "skill_asset_generator": {
          context = await skillAssetGenerator(ensureContext());
          outputPreview = buildCoreSkillPreview(stage, ensureContext());
          break;
        }
        case "skill_viral_optimizer": {
          context = await skillViralOptimizer(ensureContext());
          outputPreview = buildCoreSkillPreview(stage, ensureContext());
          break;
        }
        case "skill_quality_post_copy_loop": {
          const quality = await runPostCopyQualityLoop({
            result: ensureResult(),
            sourceText: activeRequest.inputText,
            outputLanguage: activeRequest.outputLanguage
          });
          result = { ...quality.result, skill_logs: skillLogs };
          outputPreview = truncate(quality.report.summary, 220);
          break;
        }
        case "skill_quality_copy_polish": {
          const polished = await runCopyPolishLoop({
            result: ensureResult(),
            sourceText: activeRequest.inputText,
            outputLanguage: activeRequest.outputLanguage
          });
          result = { ...polished.result, skill_logs: skillLogs };
          outputPreview = truncate(polished.report.summary, 220);
          break;
        }
        case "skill_quality_final_audit": {
          const finalAudit = await runFinalAuditRecovery({
            result: ensureResult(),
            sourceText: activeRequest.inputText,
            outputLanguage: activeRequest.outputLanguage
          });
          result = { ...finalAudit.result, skill_logs: skillLogs };
          outputPreview = truncate(finalAudit.report.summary, 220);
          break;
        }
        case "skill_quality_image_loop": {
          throw new Error("skill_quality_image_loop is not implemented yet.");
        }
        default: {
          throw new Error(`Unknown pipeline stage: ${stage}`);
        }
      }

      skillLogs.push({
        skill_name: stage,
        status: "completed",
        output_preview: outputPreview
      });
      if (onProgress) {
        await onProgress(stage, progress, outputPreview);
      }
    } catch (error) {
      const message = truncate(error instanceof Error ? error.message : "stage failed", 220);
      skillLogs.push({
        skill_name: stage,
        status: "failed",
        output_preview: message
      });
      throw error;
    }
  }

  result = ensureResult();

  if (activeRequest.reviewMode === "required" && !isTimedOut()) {
    try {
      const review = await runCoverReviewPack({
        result,
        sourceText: activeRequest.inputText
      });
      result.review = review;
    } catch (error) {
      result.review = {
        required: true,
        reason: `cover review pack failed: ${error instanceof Error ? truncate(error.message, 90) : "unknown"}`
      };
    }
  } else {
    result.review = {
      required: false,
      reason: isTimedOut() ? "skipped_due_to_pipeline_budget" : "auto mode"
    };
  }

  const finalContext = ensureContext();
  result = {
    ...result,
    post_title: toSingleSentence(result.post_title) || "核心结论在第1页",
    post_caption: normalizeCaptionLength(
      result.post_caption,
      [finalContext.corePoints.slice(0, 4).join(" "), finalContext.cta].filter(Boolean).join(" ")
    ),
    hashtags: normalizeHashtags(result.hashtags, 5),
    skill_logs: skillLogs
  };

  const usageSummary = formatUsageSummary(snapshotUsage(usageScope));
  skillLogs.push({
    skill_name: "llm_usage_summary",
    status: "completed",
    output_preview: truncate(usageSummary, 220)
  });
  if (onProgress) {
    await onProgress("llm_usage_summary", 100, truncate(usageSummary, 220));
  }
  result.skill_logs = skillLogs;

  return result;
}

