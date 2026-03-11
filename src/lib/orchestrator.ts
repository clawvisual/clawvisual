import type { ConversionContext, ConversionRequest, ConversionResult } from "@/lib/types/skills";
import { skill01Distiller } from "@/lib/skills/01-distiller";
import { skill02HookArchitect } from "@/lib/skills/02-hook-architect";
import { skill03ScriptSplitter } from "@/lib/skills/03-script-splitter";
import { skill04Metaphorist } from "@/lib/skills/04-metaphorist";
import { skill05LayoutSelector } from "@/lib/skills/05-layout-selector";
import { skill06HierarchyMapper } from "@/lib/skills/06-hierarchy-mapper";
import { skill07StyleMapper } from "@/lib/skills/07-style-mapper";
import { skill08AssetGenerator } from "@/lib/skills/08-asset-generator";
import { skill09Typographer } from "@/lib/skills/09-typographer";
import { skill10AutoResizer } from "@/lib/skills/10-auto-resizer";
import { skill11AttentionAuditor } from "@/lib/skills/11-attention-auditor";
import { skill12ViralOptimizer } from "@/lib/skills/12-viral-optimizer";
import { skill00InputProcessor } from "@/lib/skills/00-input-processor";
import { skill13StyleRecommender } from "@/lib/skills/13-style-recommender";
import { skill14SourceGrounder } from "@/lib/skills/14-source-grounder";
import { skill15TrendMiner } from "@/lib/skills/15-trend-miner";
import { skill16AttentionFixer } from "@/lib/skills/16-attention-fixer";
import {
  decideImageQualityLoopExecution,
  runCopyPolishLoop,
  runCoverReviewPack,
  runFinalAuditRecovery,
  runImageQualityLoop,
  runPostCopyQualityLoop,
  runStoryboardQualityLoop
} from "@/lib/quality/loop";
import { appConfig } from "@/lib/config";
import { beginUsageScope, formatUsageSummary, snapshotUsage } from "@/lib/llm/usage-tracker";

type ProgressCallback = (step: string, progress: number, outputPreview?: string) => Promise<void> | void;

function createInitialContext(request: ConversionRequest): ConversionContext {
  // Shared mutable context passed through all skills in the pipeline.
  return {
    request,
    corePoints: [],
    hooks: [],
    storyboard: [],
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

function shouldForceTrendIntel(mode: ConversionRequest["contentMode"]): boolean {
  return mode === "trend_hotspot";
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

function buildSkillPreview(stage: string, context: ConversionContext): string {
  switch (stage) {
    case "skill_01_distiller":
      return truncate(context.corePoints.slice(0, 2).join(" | "));
    case "skill_14_source_grounder":
      return truncate(
        context.sourceEvidence
          .slice(0, 2)
          .map((item) => `${item.title} (${item.credibilityScore})`)
          .join(" | ")
      );
    case "skill_02_hook_architect":
      return truncate(context.hooks[0] ?? "");
    case "skill_03_script_splitter":
      return truncate(context.storyboard.slice(0, 2).map((slide) => `#${slide.index} ${slide.script}`).join(" | "));
    case "skill_04_metaphorist":
      return truncate(context.visuals.slice(0, 2).map((item) => item.metaphor).join(" | "));
    case "skill_05_layout_selector":
      return truncate(context.visuals.slice(0, 3).map((item) => `#${item.index} ${item.layout}`).join(" | "));
    case "skill_06_hierarchy_mapper":
      return truncate(
        context.visuals
          .slice(0, 2)
          .map((item) => `#${item.index} [${item.hierarchy.highlightKeywords.join(", ")}]`)
          .join(" | ")
      );
    case "skill_07_style_mapper":
      return truncate(JSON.stringify(context.theme.cssVariables));
    case "skill_13_style_recommender":
      return truncate(
        `domain=${context.visualStyleProfile.visualDomain} preset=${context.visualStyleProfile.recommendedPreset} tone=${context.visualStyleProfile.recommendedTone}`
      );
    case "skill_08_asset_generator":
      return truncate(context.assets.slice(0, 2).map((asset) => `#${asset.index} ${asset.prompt}`).join(" | "));
    case "skill_09_typographer":
      return truncate(context.compositions.slice(0, 2).map((slide) => `#${slide.index} ${slide.layout}`).join(" | "));
    case "skill_10_auto_resizer":
      return truncate(`generated ${context.resizedOutputs.length} resized outputs`);
    case "skill_11_attention_auditor":
      return truncate(
        context.audits
          .slice(0, 3)
          .map((audit) => `#${audit.index} readability:${audit.readabilityScore}`)
          .join(" | ")
      );
    case "skill_16_attention_fixer":
      return truncate(context.assets.slice(0, 2).map((asset) => `#${asset.index} ${asset.imageUrl}`).join(" | "));
    case "skill_15_trend_miner":
      return truncate(context.trendSignals.slice(0, 5).map((item) => `#${item.tag}`).join(" "));
    case "skill_12_viral_optimizer":
      return truncate(`${context.caption} ${context.hashtags.join(" ")}`);
    default:
      return "stage completed";
  }
}

export async function runConversion(
  request: ConversionRequest,
  onProgress?: ProgressCallback
): Promise<ConversionResult> {
  // Track request-level token usage and enforce a hard pipeline deadline.
  const usageScope = beginUsageScope();
  const startedAt = Date.now();
  const pipelineMaxMs = Math.max(120000, Number(appConfig.pipeline.maxDurationMs || 300000));
  const deadlineAt = startedAt + pipelineMaxMs;
  const isFastMode = appConfig.pipeline.mode === "fast";
  const isTimedOut = () => Date.now() >= deadlineAt;

  const skillLogs: ConversionResult["skill_logs"] = [];
  const enrichedRequest = await skill00InputProcessor(request);
  const inputProcessorPreview = truncate(
    `mode=${enrichedRequest.contentMode} source=${enrichedRequest.sourceType ?? "text"} title=${enrichedRequest.sourceTitle ?? "n/a"} chars=${enrichedRequest.inputText.length}`
  );
  skillLogs.push({
    skill_name: "skill_00_input_processor",
    status: "completed",
    output_preview: inputProcessorPreview
  });
  if (onProgress) {
    await onProgress("skill_00_input_processor", 4, inputProcessorPreview);
  }

  let context = createInitialContext(enrichedRequest);

  const pushSkipLog = async (step: string, progress: number, reason: string) => {
    const preview = truncate(`skipped:${reason}`, 220);
    skillLogs.push({
      skill_name: step,
      status: "completed",
      output_preview: preview
    });
    if (onProgress) {
      await onProgress(step, progress, preview);
    }
  };

  const pushQualityLog = async (
    step: string,
    status: "completed" | "failed",
    outputPreview: string,
    progress: number
  ) => {
    const preview = truncate(outputPreview, 220);
    skillLogs.push({
      skill_name: step,
      status,
      output_preview: preview
    });
    if (onProgress) {
      await onProgress(step, progress, preview);
    }
  };

  const run = async (
    step: string,
    progress: number,
    fn: (ctx: ConversionContext) => Promise<ConversionContext>
  ) => {
    // Uniform stage runner: executes a skill, writes preview logs, and emits progress.
    try {
      context = await fn(context);
      const outputPreview = buildSkillPreview(step, context);
      skillLogs.push({
        skill_name: step,
        status: "completed",
        output_preview: outputPreview
      });
      if (onProgress) {
        await onProgress(step, progress, outputPreview);
      }
    } catch (error) {
      skillLogs.push({
        skill_name: step,
        status: "failed",
        output_preview: truncate(error instanceof Error ? error.message : "stage failed")
      });
      throw error;
    }
  };

  // Stage order is intentionally linear: extract signal -> structure narrative -> design -> audit -> finalize.
  await run("skill_01_distiller", 8, skill01Distiller);
  const forceTrendIntel = shouldForceTrendIntel(enrichedRequest.contentMode);
  if ((appConfig.pipeline.enableSourceIntel || !isFastMode || forceTrendIntel) && !isTimedOut()) {
    await run("skill_14_source_grounder", 12, skill14SourceGrounder);
    await run("skill_15_trend_miner", 14, skill15TrendMiner);
  } else {
    await pushSkipLog("skill_14_source_grounder", 12, isTimedOut() ? "pipeline_budget" : "fast_mode");
    await pushSkipLog("skill_15_trend_miner", 14, isTimedOut() ? "pipeline_budget" : "fast_mode");
  }
  await run("skill_02_hook_architect", 18, skill02HookArchitect);
  await run("skill_03_script_splitter", 24, skill03ScriptSplitter);
  if ((appConfig.pipeline.enableStoryboardQuality || !isFastMode) && !isTimedOut()) {
    try {
      const quality = await runStoryboardQualityLoop(context);
      context = quality.context;
      await pushQualityLog(quality.report.step, "completed", quality.report.summary, 28);
    } catch (error) {
      await pushQualityLog(
        "quality_storyboard_loop",
        "failed",
        error instanceof Error ? error.message : "storyboard quality loop failed",
        28
      );
    }
  } else {
    await pushSkipLog("quality_storyboard_loop", 28, isTimedOut() ? "pipeline_budget" : "fast_mode");
  }
  await run("skill_04_metaphorist", 32, skill04Metaphorist);
  await run("skill_05_layout_selector", 40, skill05LayoutSelector);
  await run("skill_06_hierarchy_mapper", 48, skill06HierarchyMapper);
  if ((appConfig.pipeline.enableStyleRecommender || !isFastMode || context.request.contentMode === "longform_digest") && !isTimedOut()) {
    await run("skill_13_style_recommender", 56, skill13StyleRecommender);
  } else {
    await pushSkipLog("skill_13_style_recommender", 56, isTimedOut() ? "pipeline_budget" : "fast_mode");
  }
  await run("skill_07_style_mapper", 62, skill07StyleMapper);
  await run("skill_08_asset_generator", 74, skill08AssetGenerator);
  const imageQualityLoopDecision = decideImageQualityLoopExecution(context, { fastMode: isFastMode });
  if (!isTimedOut() && imageQualityLoopDecision.shouldRun) {
    try {
      const quality = await runImageQualityLoop(context);
      context = quality.context;
      await pushQualityLog(quality.report.step, "completed", quality.report.summary, 78);
    } catch (error) {
      await pushQualityLog(
        "quality_image_loop",
        "failed",
        error instanceof Error ? error.message : "image quality loop failed",
        78
      );
    }
  } else {
    await pushSkipLog(
      "quality_image_loop",
      78,
      isTimedOut() ? "pipeline_budget" : imageQualityLoopDecision.reason
    );
  }
  await run("skill_09_typographer", 84, skill09Typographer);
  await run("skill_10_auto_resizer", 90, skill10AutoResizer);
  if ((appConfig.pipeline.enableAttentionAuditor || !isFastMode) && !isTimedOut()) {
    await run("skill_11_attention_auditor", 96, skill11AttentionAuditor);
  } else {
    await pushSkipLog("skill_11_attention_auditor", 96, isTimedOut() ? "pipeline_budget" : "fast_mode");
  }
  if ((appConfig.pipeline.enableAttentionFixer || !isFastMode) && !isTimedOut()) {
    await run("skill_16_attention_fixer", 97, skill16AttentionFixer);
  } else {
    await pushSkipLog("skill_16_attention_fixer", 97, isTimedOut() ? "pipeline_budget" : "fast_mode");
  }
  await run("skill_12_viral_optimizer", 99, skill12ViralOptimizer);

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

  // Convert internal context into API-facing result payload.
  let result: ConversionResult = {
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

  if ((appConfig.pipeline.enablePostCopyQuality || !isFastMode) && !isTimedOut()) {
    try {
      const quality = await runPostCopyQualityLoop({
        result,
        sourceText: context.request.inputText,
        outputLanguage: context.request.outputLanguage
      });
      result = quality.result;
      await pushQualityLog(quality.report.step, "completed", quality.report.summary, 99);
    } catch (error) {
      await pushQualityLog(
        "quality_post_copy_loop",
        "failed",
        error instanceof Error ? error.message : "post copy quality loop failed",
        99
      );
    }
  } else {
    await pushSkipLog("quality_post_copy_loop", 99, isTimedOut() ? "pipeline_budget" : "fast_mode");
  }

  try {
    const polished = await runCopyPolishLoop({
      result,
      sourceText: context.request.inputText,
      outputLanguage: context.request.outputLanguage
    });
    result = polished.result;
    await pushQualityLog(polished.report.step, "completed", polished.report.summary, 99);
  } catch (error) {
    await pushQualityLog(
      "quality_copy_polish",
      "failed",
      error instanceof Error ? error.message : "copy polish failed",
      99
    );
  }

  if ((appConfig.pipeline.enableFinalAudit || !isFastMode) && !isTimedOut()) {
    try {
      const finalAudit = await runFinalAuditRecovery({
        result,
        sourceText: context.request.inputText,
        outputLanguage: context.request.outputLanguage
      });
      result = finalAudit.result;
      await pushQualityLog(finalAudit.report.step, "completed", finalAudit.report.summary, 100);
    } catch (error) {
      await pushQualityLog(
        "quality_final_audit",
        "failed",
        error instanceof Error ? error.message : "final audit failed",
        100
      );
    }
  } else {
    await pushSkipLog("quality_final_audit", 100, isTimedOut() ? "pipeline_budget" : "fast_mode");
  }

  if (context.request.reviewMode === "required" && !isTimedOut()) {
    try {
      const review = await runCoverReviewPack({
        result,
        sourceText: context.request.inputText
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

  // Enforce public output constraints regardless of upstream skill behavior.
  result = {
    ...result,
    post_title: toSingleSentence(result.post_title) || "核心结论在第1页",
    post_caption: normalizeCaptionLength(
      result.post_caption,
      [context.corePoints.slice(0, 4).join(" "), context.cta].filter(Boolean).join(" ")
    ),
    hashtags: normalizeHashtags(result.hashtags, 5)
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

  return result;
}
