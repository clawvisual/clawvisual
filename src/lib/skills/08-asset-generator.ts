import { callSkillLlmJson } from "@/lib/llm/skill-client";
import {
  filterLockedTextsForOutputLanguage,
  shouldLockTextForOutputLanguage,
  targetLanguageDisallowsHan
} from "@/lib/i18n/text-guard";
import {
  DEFAULT_NEGATIVE_PROMPT,
  NEGATIVE_PROMPT_WITH_TEXT_ON_IMAGE,
  generateNanoBananaImage
} from "@/lib/images/nano-banana";
import type { AspectRatio, CompositionPlan, ConversionContext, DiagramType, SlideVisual } from "@/lib/types/skills";

type PromptPlan = {
  index: number;
  coreKeywords: string[];
  visualAssociations: Array<{ keyword: string; visual: string }>;
  diagramType: DiagramType;
  entityTags: string[];
  metricTags: string[];
  subject: string;
  sceneDirection: string;
  composition: string;
  artStyle: string;
  lightingMood: string;
  colorDirection: string;
  typography: {
    fontFamily: string;
    fontWeight: string;
    position: string;
  };
  technicalSpecs: string;
  textOnImage: boolean;
  styleKeywords: string[];
  negativeStyleKeywords: string[];
  globalDirection: string;
  styleArchetype: string;
  heroSubject: string;
  cameraAngle: string;
  depthLayers: string;
  motionCue: string;
  emotionalTrigger: string;
  surpriseElement: string;
  firstGlanceRule: string;
  allowLabelAnchors: boolean;
};

type RawPromptPlan = {
  index?: number;
  coreKeywords?: string[];
  visualAssociations?: Array<{ keyword?: string; visual?: string }>;
  diagramType?: string;
  entityTags?: string[];
  metricTags?: string[];
  subject?: string;
  sceneDirection?: string;
  composition?: string;
  artStyle?: string;
  lightingMood?: string;
  colorDirection?: string;
  typography?: {
    fontFamily?: string;
    fontWeight?: string;
    position?: string;
  };
  technicalSpecs?: string;
  styleArchetype?: string;
  heroSubject?: string;
  cameraAngle?: string;
  depthLayers?: string;
  motionCue?: string;
  emotionalTrigger?: string;
  surpriseElement?: string;
  firstGlanceRule?: string;
  allowLabelAnchors?: boolean;
};

function truncate(value: string, max = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized;
}

function sanitizeColorDirection(value: string): string {
  const withoutHex = value.replace(/#[0-9a-fA-F]{3,8}\b/g, " ");
  const normalized = withoutHex
    .replace(/,\s*,/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/^,\s*|\s*,$/g, "")
    .trim();
  return normalized || "high-contrast cool-toned palette with deep neutral background";
}

function tokenizeCoreKeywords(input: string): string[] {
  const terms = (input.match(/[\p{Script=Han}]{2,8}|[A-Za-z][A-Za-z-]{2,}/gu) ?? [])
    .map((item) => item.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(terms)).slice(0, 8);
}

function buildNeutralAssociations(keywords: string[]): Array<{ keyword: string; visual: string }> {
  return keywords.slice(0, 5).map((keyword) => ({
    keyword,
    visual: `context-aware symbolic visual representation of "${keyword}"`
  }));
}

function normalizeDiagramType(value: unknown): DiagramType {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "comparison_pillar") return "comparison_pillar";
  if (raw === "concentric_moat") return "concentric_moat";
  if (raw === "process_flow") return "process_flow";
  if (raw === "metric_trend") return "metric_trend";
  return "metaphor";
}

function normalizeTagArray(value: unknown, max = 8): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, max);
}

function normalizeBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return fallback;
}

function compositionPlanToHint(plan: CompositionPlan): {
  composition: string;
  negativeSpaceArea: "top" | "left" | "right" | "bottom" | "center";
} {
  if (plan === "left-heavy") {
    return {
      composition: "main subject on left side, keep right side soft and clean for text overlay",
      negativeSpaceArea: "right"
    };
  }
  if (plan === "right-heavy") {
    return {
      composition: "main subject on right side, keep left side soft and clean for text overlay",
      negativeSpaceArea: "left"
    };
  }
  if (plan === "bottom-heavy") {
    return {
      composition: "main subject in lower area, keep upper third empty and clean for text overlay",
      negativeSpaceArea: "top"
    };
  }
  if (plan === "top-heavy") {
    return {
      composition: "main subject in upper area, keep bottom third simple for text overlay",
      negativeSpaceArea: "bottom"
    };
  }
  return {
    composition: "single centered focal subject with side negative space for safe text placement",
    negativeSpaceArea: "center"
  };
}

function fallbackPromptPlan(
  context: ConversionContext,
  visual: SlideVisual,
  aspectRatio: AspectRatio
): PromptPlan {
  const colors = [
    context.theme.cssVariables["--vf-primary"],
    context.theme.cssVariables["--vf-secondary"],
    context.theme.cssVariables["--vf-bg"]
  ]
    .filter(Boolean)
    .join(", ");

  const textOnImage = context.request.generationMode === "quote_slides";
  const isCoverSlide = visual.index === 1;
  const noTextSpec = textOnImage ? "no watermark" : "no text, no watermark, no letters";
  const styleProfile = context.visualStyleProfile;
  const compositionHint = compositionPlanToHint(visual.metaphorPlan?.compositionPlan ?? "centered");
  const keywordSeed = [
    ...visual.hierarchy.highlightKeywords,
    ...tokenizeCoreKeywords(visual.hierarchy.body),
    ...tokenizeCoreKeywords(visual.metaphor)
  ];
  const coreKeywords = Array.from(new Set(keywordSeed.map((item) => item.trim()).filter(Boolean))).slice(0, 8);
  const visualAssociations = buildNeutralAssociations(coreKeywords);
  const associationText = visualAssociations.map((item) => `${item.keyword} -> ${item.visual}`).join("; ");

  return {
    index: visual.index,
    coreKeywords,
    visualAssociations,
    diagramType: visual.metaphorPlan?.diagramType ?? "metaphor",
    entityTags: visual.metaphorPlan?.entityTags ?? [],
    metricTags: visual.metaphorPlan?.metricTags ?? [],
    subject: visual.metaphorPlan?.visualDescription || visual.metaphor || "A symbolic scene aligned with the slide meaning",
    sceneDirection: `${associationText || "keyword-driven symbolic scene"}, aligned with slide statement meaning`,
    composition: compositionHint.composition,
    artStyle: isCoverSlide
      ? `${context.request.brand.stylePreset} style, bold editorial cover composition, dramatic but clean, ${styleProfile.recommendedTone} tone`
      : `${context.request.brand.stylePreset} style, editorial illustration tuned to ${styleProfile.visualDomain} context, ${styleProfile.recommendedTone} tone`,
    lightingMood: "cinematic soft lighting, clear contrast, platform-ready social visual quality",
    colorDirection: colors
      ? "cool cyan and emerald accents with deep navy contrast"
      : "balanced neutral tones with restrained accents",
    typography: {
      fontFamily: "Sans-serif",
      fontWeight: "Bold",
      position: "top-center"
    },
    technicalSpecs: `hyper-realistic, sharp details, uncluttered, ${noTextSpec}, 8k, --ar ${aspectRatio}`,
    textOnImage,
    styleKeywords: styleProfile.styleKeywords,
    negativeStyleKeywords: styleProfile.negativeKeywords,
    globalDirection: styleProfile.globalDirection,
    styleArchetype: styleProfile.styleArchetype ?? "editorial_bold",
    heroSubject: visual.metaphorPlan?.heroSubject || visual.metaphorPlan?.metaphorName || "single dominant symbolic hero",
    cameraAngle: visual.metaphorPlan?.cameraAngle || "eye-level medium close shot",
    depthLayers: visual.metaphorPlan?.depthLayers || "foreground anchor, midground hero subject, soft background context",
    motionCue: visual.metaphorPlan?.motionCue || "directional tension pointing to the hero subject",
    emotionalTrigger: visual.metaphorPlan?.emotionalTrigger || "high-stakes clarity",
    surpriseElement: isCoverSlide
      ? "cover-level visual hook with unexpected angle or dramatic perspective shift"
      : "one unexpected but relevant visual twist",
    firstGlanceRule: isCoverSlide
      ? "cover headline intent must be instantly readable in under 0.3 seconds while scrolling"
      : "main idea recognizable within 0.3 seconds at mobile feed speed",
    allowLabelAnchors: false
  };
}

function normalizePromptPlan(
  raw: RawPromptPlan,
  fallback: PromptPlan,
  aspectRatio: AspectRatio
): PromptPlan {
  const rawAssociations = Array.isArray(raw.visualAssociations)
    ? raw.visualAssociations
        .map((item) => ({
          keyword: String(item?.keyword ?? "").trim(),
          visual: String(item?.visual ?? "").trim()
        }))
        .filter((item) => item.keyword && item.visual)
        .slice(0, 6)
    : [];

  const rawKeywords = Array.isArray(raw.coreKeywords)
    ? raw.coreKeywords.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, 8)
    : [];

  let technicalSpecs = String(raw.technicalSpecs ?? "").trim() || fallback.technicalSpecs;
  if (fallback.textOnImage) {
    technicalSpecs = technicalSpecs.replace(/\bno\s+text\b/gi, "").replace(/,+\s*,/g, ",").trim();
  }
  if (!technicalSpecs.includes("--ar")) {
    technicalSpecs = `${technicalSpecs}, --ar ${aspectRatio}`;
  }

  return {
    index: Number(raw.index ?? fallback.index),
    coreKeywords: rawKeywords.length ? rawKeywords : fallback.coreKeywords,
    visualAssociations: rawAssociations.length ? rawAssociations : fallback.visualAssociations,
    diagramType: normalizeDiagramType(raw.diagramType ?? fallback.diagramType),
    entityTags: normalizeTagArray(raw.entityTags).length ? normalizeTagArray(raw.entityTags) : fallback.entityTags,
    metricTags: normalizeTagArray(raw.metricTags).length ? normalizeTagArray(raw.metricTags) : fallback.metricTags,
    subject: String(raw.subject ?? "").trim() || fallback.subject,
    sceneDirection: String(raw.sceneDirection ?? "").trim() || fallback.sceneDirection,
    composition: String(raw.composition ?? "").trim() || fallback.composition,
    artStyle: String(raw.artStyle ?? "").trim() || fallback.artStyle,
    lightingMood: String(raw.lightingMood ?? "").trim() || fallback.lightingMood,
    colorDirection: sanitizeColorDirection(String(raw.colorDirection ?? "").trim() || fallback.colorDirection),
    typography: {
      fontFamily: String(raw.typography?.fontFamily ?? "").trim() || fallback.typography.fontFamily,
      fontWeight: String(raw.typography?.fontWeight ?? "").trim() || fallback.typography.fontWeight,
      position: String(raw.typography?.position ?? "").trim() || fallback.typography.position
    },
    technicalSpecs,
    textOnImage: fallback.textOnImage,
    styleKeywords: fallback.styleKeywords,
    negativeStyleKeywords: fallback.negativeStyleKeywords,
    globalDirection: fallback.globalDirection,
    styleArchetype: String(raw.styleArchetype ?? "").trim() || fallback.styleArchetype,
    heroSubject: String(raw.heroSubject ?? "").trim() || fallback.heroSubject,
    cameraAngle: String(raw.cameraAngle ?? "").trim() || fallback.cameraAngle,
    depthLayers: String(raw.depthLayers ?? "").trim() || fallback.depthLayers,
    motionCue: String(raw.motionCue ?? "").trim() || fallback.motionCue,
    emotionalTrigger: String(raw.emotionalTrigger ?? "").trim() || fallback.emotionalTrigger,
    surpriseElement: String(raw.surpriseElement ?? "").trim() || fallback.surpriseElement,
    firstGlanceRule: String(raw.firstGlanceRule ?? "").trim() || fallback.firstGlanceRule,
    allowLabelAnchors: normalizeBool(raw.allowLabelAnchors, fallback.allowLabelAnchors)
  };
}

function composePrompt(
  plan: PromptPlan,
  quoteText: string,
  aspectRatio: AspectRatio,
  outputLanguage: string
): string {
  const withAspect = plan.technicalSpecs.includes("--ar")
    ? plan.technicalSpecs
    : `${plan.technicalSpecs}, --ar ${aspectRatio}`;
  const canLockQuote = shouldLockTextForOutputLanguage(quoteText, outputLanguage);

  const associationLine = plan.visualAssociations
    .map((item) => `${truncate(item.keyword, 28)} => ${truncate(item.visual, 64)}`)
    .join("; ");

  const diagramDirective: Record<DiagramType, string> = {
    metaphor: "Use one cinematic symbolic subject with high conceptual clarity.",
    comparison_pillar:
      "Generate a split-screen business comparison infographic with clear left/right contrast and pillar-like center divider.",
    concentric_moat:
      "Generate a concentric-rings moat diagram style composition showing core capability and surrounding protective layers.",
    process_flow:
      "Generate a process-flow visual with directional progression and explicit stage separation.",
    metric_trend:
      "Generate a metric-trend visual with chart-like direction, arrows, and data-driven business cues."
  };

  const lines = [
    `Create a high-quality social-slide image. Subject: ${truncate(plan.subject, 220)}.`,
    `Hero subject: ${truncate(plan.heroSubject, 140)}.`,
    `First-glance rule: ${truncate(plan.firstGlanceRule, 160)}.`,
    `Intent keywords: ${plan.coreKeywords.map((item) => truncate(item, 32)).join(", ") || "insight, clarity, transformation"}.`,
    `Keyword visual mapping: ${associationLine || "context-aware symbolic mapping inferred from slide meaning"}.`,
    `Scene direction: ${truncate(plan.sceneDirection, 280)}.`,
    `Composition: ${truncate(plan.composition, 240)}.`,
    `Camera angle: ${truncate(plan.cameraAngle, 120)}.`,
    `Depth layering: ${truncate(plan.depthLayers, 180)}.`,
    `Motion cue: ${truncate(plan.motionCue, 150)}.`,
    `Emotional trigger: ${truncate(plan.emotionalTrigger, 120)}.`,
    `Surprise element: ${truncate(plan.surpriseElement, 150)}.`,
    `Art style: ${truncate(plan.artStyle, 220)}.`,
    `Style archetype: ${truncate(plan.styleArchetype, 80)}.`,
    `Lighting and mood: ${truncate(plan.lightingMood, 180)}.`,
    `Color direction: ${truncate(plan.colorDirection, 160)}.`,
    `Global style consistency: ${truncate(plan.globalDirection, 220)}.`,
    `Style tags: ${[...plan.styleKeywords.map((item) => truncate(item, 42)), "editorial storytelling style", "clean high-clarity composition"].join(", ")}.`,
    `Technical quality: ${truncate(withAspect, 180)}.`,
    `Diagram mode: ${plan.diagramType}. ${diagramDirective[plan.diagramType]}`,
    "CRITICAL CONTRAST RULE: keep text-background separation strong and readability-first.",
    "When text is present, target contrast equivalent to >=4.5:1 using dark overlay, gradient vignette, or semi-transparent text box.",
    "When text is absent, reserve a low-noise area suitable for high-contrast text overlay in post.",
    "Never render hex color codes (for example #22d3ee), palette legends, swatches, or technical annotation text.",
    "No watermark, no logo, no extra random letters."
  ];

  if (plan.index === 1) {
    lines.push(
      "COVER SLIDE PRIORITY: use extra-bold feed-stopping composition and dramatic yet clean visual hierarchy.",
      "COVER SLIDE HOOK: emphasize conflict, tension, or curiosity in the scene without adding random text."
    );
  }

  if (plan.textOnImage && quoteText && canLockQuote) {
    lines.push(
      `Render exactly this original slide text without any translation or rewrite: ${JSON.stringify(quoteText)}.`,
      `Typography rule: ${plan.typography.fontWeight} ${plan.typography.fontFamily}, position ${plan.typography.position}, high readability.`,
      "Do not add any other text, subtitle, or translation."
    );
  } else if (plan.textOnImage) {
    lines.push("Do not render non-target-language characters. If uncertain, render no visible text.");
  } else {
    lines.push("Do not render visible text on image.");
  }

  if (plan.allowLabelAnchors && (plan.entityTags.length || plan.metricTags.length)) {
    lines.push(
      `Optional labels only when composition naturally supports clean typography: ${JSON.stringify([
        ...plan.entityTags,
        ...plan.metricTags
      ])}.`,
      "If adding labels, keep count <=2, avoid dense signage, and use only specified anchors."
    );
  }

  return lines.join("\n");
}

async function buildPromptPlans(context: ConversionContext, aspectRatio: AspectRatio): Promise<Map<number, PromptPlan>> {
  const fallbackPlans = new Map(
    context.visuals.map((visual) => [visual.index, fallbackPromptPlan(context, visual, aspectRatio)] as const)
  );

  const textOnImage = context.request.generationMode === "quote_slides";

  const llmResult = await callSkillLlmJson<{
    items?: RawPromptPlan[];
  }>({
    skill: "assetGenerator",
    input: {
      objective: textOnImage
        ? "Use four steps for each slide prompt: 1) intent parsing (core keywords), 2) context-aware visual association mapping, 3) strict text rendering rule (exact slide quote), 4) style treatment with professional consistency. Must satisfy feed-stopping composition and first-glance recognition in 0.3 seconds. For cover slide (index=1), apply extra-bold hook-first visual strategy."
        : "Use four steps for each slide prompt: context-aware intent parsing, visual association, typography-safe composition, style treatment. Must satisfy feed-stopping composition and first-glance recognition in 0.3 seconds. For cover slide (index=1), apply extra-bold hook-first visual strategy.",
      source_text: context.request.inputText,
      ratio: aspectRatio,
      style: {
        preset: context.request.brand.stylePreset,
        theme_tokens: context.theme.cssVariables,
        profile: context.visualStyleProfile
      },
      slides: context.visuals.map((visual) => ({
        index: visual.index,
        is_cover: visual.index === 1,
        cover_goal: visual.index === 1 ? "feed-stopping cover with high contrast and visual hook" : "inner slide",
        metaphor: visual.metaphor,
        metaphor_plan: visual.metaphorPlan,
        quote: visual.hierarchy.body,
        layout: visual.layout,
        highlight_keywords: visual.hierarchy.highlightKeywords,
        domain_context_hint: `domain=${context.visualStyleProfile.visualDomain}`
      })),
      constraints: {
        text_on_image: textOnImage,
        keep_quote_exact: textOnImage,
        no_extra_text: true,
        preferred_font: "Bold Sans-serif",
        preferred_text_position: "top-center",
        domain: context.visualStyleProfile.visualDomain,
        style_archetype: context.visualStyleProfile.styleArchetype ?? "editorial_bold",
        surprise_policy: context.visualStyleProfile.surprisePolicy ?? "one controlled surprise element",
        style_keywords: context.visualStyleProfile.styleKeywords,
        context_rule:
          "Do not use fixed keyword heuristics. Infer meaning from full slide quote + source context before deciding visual metaphor.",
        image_appeal_rules: [
          "single dominant hero subject",
          "foreground/midground/background depth",
          "high-contrast visual hierarchy",
          "one controlled surprise element",
          "avoid generic stock-photo composition"
        ],
        cover_rules: [
          "index=1 must be extra bold, hook-first, and visually explosive but clean",
          "index=1 should prioritize curiosity and instant recognition in social feed",
          "index=1 should avoid looking like a generic inner content slide"
        ]
      }
    },
    outputSchemaHint:
      '{"items":[{"index":1,"coreKeywords":["internet","future"],"visualAssociations":[{"keyword":"core","visual":"tree roots and gears"}],"diagramType":"comparison_pillar","entityTags":["美团","阿里"],"metricTags":["30分钟送达"],"subject":"...","sceneDirection":"...","composition":"...","artStyle":"...","lightingMood":"...","colorDirection":"...","heroSubject":"...","cameraAngle":"...","depthLayers":"...","motionCue":"...","emotionalTrigger":"...","surpriseElement":"...","firstGlanceRule":"...","allowLabelAnchors":false,"typography":{"fontFamily":"Sans-serif","fontWeight":"Bold","position":"top-center"},"technicalSpecs":"... --ar 4:5"}]}',
    outputLanguage: "en-US"
  });

  const result = new Map<number, PromptPlan>();
  for (const visual of context.visuals) {
    const fallback = fallbackPlans.get(visual.index) ?? fallbackPromptPlan(context, visual, aspectRatio);
    const fromLlm = (llmResult?.items ?? []).find((item) => Number(item.index) === visual.index);
    result.set(visual.index, normalizePromptPlan(fromLlm ?? {}, fallback, aspectRatio));
  }

  return result;
}

export async function skill08AssetGenerator(context: ConversionContext): Promise<ConversionContext> {
  const aspectRatio = context.request.aspectRatios[0] ?? "4:5";
  const promptPlans = await buildPromptPlans(context, aspectRatio);
  const outputLanguage = context.request.outputLanguage;
  const disallowHan = targetLanguageDisallowsHan(outputLanguage);

  const assets = await Promise.all(
    context.visuals.map(async (visual) => {
      const plan = promptPlans.get(visual.index) ?? fallbackPromptPlan(context, visual, aspectRatio);
      const storyboardQuote =
        context.storyboard.find((item) => item.index === visual.index)?.script ?? visual.hierarchy.body;
      const quote = storyboardQuote.replace(/\s+/g, " ").trim();
      const prompt = composePrompt(plan, quote, aspectRatio, outputLanguage);
      const lockedTexts: string[] = [];
      const compositionHint = compositionPlanToHint(visual.metaphorPlan?.compositionPlan ?? "centered");
      const styleTag =
        visual.metaphorPlan?.styleTag ||
        context.visualStyleProfile.recommendedPreset ||
        context.request.brand.stylePreset;

      if (plan.textOnImage && shouldLockTextForOutputLanguage(quote, outputLanguage)) {
        // Keep slide text immutable on image generation.
        lockedTexts.push(quote);
      }
      if (plan.textOnImage) {
        const supplementalLockedTexts = disallowHan ? [] : [...plan.entityTags, ...plan.metricTags];
        lockedTexts.push(...filterLockedTextsForOutputLanguage(supplementalLockedTexts, outputLanguage));
      }

      const negativePrompt = plan.textOnImage
        ? NEGATIVE_PROMPT_WITH_TEXT_ON_IMAGE
        : DEFAULT_NEGATIVE_PROMPT;
      const negativePromptWithStyle = [
        negativePrompt,
        ...plan.negativeStyleKeywords
      ]
        .map((item) => item.trim())
        .filter(Boolean)
        .join(", ");

      const imageResult = await generateNanoBananaImage({
        prompt,
        negativePrompt: negativePromptWithStyle,
        aspectRatio,
        seed: visual.index,
        textOnImage: plan.textOnImage,
        lockedTexts
      });

      return {
        index: visual.index,
        prompt,
        imageUrl: imageResult.imageUrl,
        styleTag,
        diagramType: plan.diagramType,
        entityTags: plan.entityTags,
        metricTags: plan.metricTags,
        negativeSpaceArea: compositionHint.negativeSpaceArea,
        metaphorConcept: visual.metaphorPlan?.metaphorName,
        designReasoning: visual.metaphorPlan?.reasoning
      };
    })
  );

  return { ...context, assets };
}
