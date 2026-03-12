import { callSkillLlmJson } from "@/lib/llm/skill-client";
import { filterLockedTextsForOutputLanguage } from "@/lib/i18n/text-guard";
import type {
  ConversionContext,
  DiagramType,
  SlideCardPlan,
  AssetPromptPlan
} from "@/lib/types/skills";

type RawVisualPromptPlan = {
  global_style?: {
    style_theme?: string;
    style_anchor?: string;
    visual_direction?: string;
    style_flavor?: string;
    icon_direction?: string;
    typography_direction?: string;
    color_direction?: string;
    texture_direction?: string;
    background_direction?: string;
    consistency_rule?: string;
    negative_keywords?: string[];
  };
  slides?: Array<{
    index?: number;
    prompt?: string;
    locked_texts?: string[];
    style_tag?: string;
    diagram_type?: string;
    negative_space_area?: "top" | "left" | "right" | "bottom" | "center";
  }>;
};

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, max = 220): string {
  const normalized = compact(value);
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized;
}

function normalizeDiagramType(value: unknown): DiagramType {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "comparison_pillar") return "comparison_pillar";
  if (raw === "concentric_moat") return "concentric_moat";
  if (raw === "process_flow") return "process_flow";
  if (raw === "metric_trend") return "metric_trend";
  return "metaphor";
}

function normalizeSpaceArea(value: unknown): "top" | "left" | "right" | "bottom" | "center" {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "top") return "top";
  if (raw === "left") return "left";
  if (raw === "right") return "right";
  if (raw === "bottom") return "bottom";
  return "center";
}

function normalizeKeywords(values: unknown, max = 12): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((item) => compact(String(item ?? "")))
    .filter(Boolean)
    .slice(0, max);
}

function normalizeLockedTexts(values: unknown, outputLanguage: string): string[] {
  if (!Array.isArray(values)) return [];
  const normalized = values
    .map((item) => compact(String(item ?? "")))
    .map((item) => item.replace(/\bLOCKED_TEXT(?:_\d+)?\b/gi, "").replace(/\bTEXT_LOCK\b/gi, ""))
    .map((item) => compact(item))
    .filter(Boolean)
    .slice(0, 5);

  return filterLockedTextsForOutputLanguage(Array.from(new Set(normalized)), outputLanguage).slice(0, 5);
}

function pickSlideCards(context: ConversionContext, index: number): SlideCardPlan | undefined {
  return context.slideCardPlans.find((item) => item.index === index);
}

function splitSentenceCandidates(value: string): string[] {
  const normalized = compact(value);
  if (!normalized) return [];
  return normalized
    .split(/(?<=[.!?。！？])\s+|(?:\n+)/g)
    .map((item) => compact(item).replace(/[:;,\-]\s*$/g, ""))
    .filter(Boolean)
    .slice(0, 8);
}

function buildDenseCardSentences(params: {
  heading: string;
  summary: string;
  cards: SlideCardPlan["cards"];
  isLongform: boolean;
  slideIndex: number;
}): string[] {
  const { heading, summary, cards, isLongform, slideIndex } = params;
  const minCount = isLongform ? (slideIndex === 1 ? 4 : 3) : 1;
  const maxCount = 5;
  const fromCards = cards.map((card) => compact(card.sentence)).filter(Boolean);
  const fromSummary = splitSentenceCandidates(summary);
  const fromHeading = splitSentenceCandidates(heading);

  const merged = Array.from(new Set([...fromCards, ...fromSummary, ...fromHeading]))
    .map((item) => item.replace(/\bLOCKED_TEXT(?:_\d+)?\b/gi, "").replace(/\bTEXT_LOCK\b/gi, "").trim())
    .filter(Boolean)
    .slice(0, maxCount);

  if (merged.length >= minCount) return merged;

  const padded = [...merged];
  while (padded.length < minCount) {
    padded.push(padded[padded.length - 1] || compact(summary) || compact(heading) || "Core insight.");
  }
  return padded.slice(0, maxCount);
}

function inferCardTitleFromLine(line: string, index: number): string {
  const words = compact(line)
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3);
  if (!words.length) return `Card ${index + 1}`;
  return truncate(words.join(" "), 26) || `Card ${index + 1}`;
}

function buildFallbackPrompt(params: {
  slideIndex: number;
  heading: string;
  summary: string;
  cards: SlideCardPlan["cards"];
  textLines: string[];
  cardPayload: Array<{ title: string; sub_title: string }>;
  isLongform: boolean;
  aspectRatio: string;
  styleTheme: string;
  styleAnchor: string;
  visualDirection: string;
  styleFlavor: string;
  iconDirection: string;
  typographyDirection: string;
  colorDirection: string;
  textureDirection: string;
  backgroundDirection: string;
  consistencyRule: string;
}): string {
  const {
    slideIndex,
    heading,
    summary,
    cards,
    textLines,
    cardPayload,
    isLongform,
    aspectRatio,
    styleTheme,
    styleAnchor,
    visualDirection,
    styleFlavor,
    iconDirection,
    typographyDirection,
    colorDirection,
    textureDirection,
    backgroundDirection,
    consistencyRule
  } = params;

  const cardCount = isLongform
    ? Math.max(slideIndex === 1 ? 4 : 3, Math.min(5, textLines.length || cards.length || 3))
    : Math.max(1, Math.min(5, cards.length || 1));
  const topics = cards.map((card) => card.title).filter(Boolean).slice(0, cardCount).join(", ") || "core points";

  const lines = [
    `A ${styleAnchor}, featuring ${truncate(heading || "central anchor subject", 90)} in the center.`,
    `Style theme: ${truncate(styleTheme, 80)}.`,
    `Visual rendering direction: ${truncate(visualDirection, 180)}.`,
    `Icon direction: ${truncate(iconDirection, 160)}.`,
    `Typography direction: ${truncate(typographyDirection, 160)}.`,
    `Around the center, ${cardCount} distinct rectangular information cards numbered 1 to ${cardCount}.`,
    `Each card contains specific illustration elements related to: ${truncate(topics, 160)}.`,
    "Each card should present a concise title plus one short subtitle line.",
    `Card copy payload (must preserve card structure): ${JSON.stringify(cardPayload.slice(0, cardCount))}.`,
    `Slide focus: ${truncate(summary, 180)}.`,
    `Style direction: ${truncate(styleFlavor, 180)}.`,
    `Texture direction: ${truncate(textureDirection, 120)}.`,
    `Color direction: ${truncate(colorDirection, 140)}.`,
    `Background: ${truncate(backgroundDirection, 140)}.`,
    `Global consistency rule: ${truncate(consistencyRule, 180)}.`,
    "High clarity, professional graphic design, educational poster style.",
    `Aspect ratio ${aspectRatio}.`,
    `Slide index ${slideIndex}.`,
    "Do not render random extra words, subtitles, placeholder tokens, watermark, or logo.",
    "No H1/LOCKED_TEXT token or code-like labels."
  ];

  if (isLongform && textLines.length) {
    lines.push(
      `Render exactly these text lines on cards (no rewrite): ${JSON.stringify(textLines.slice(0, cardCount))}.`,
      "LONGFORM_INFOGRAPHIC RULE: prioritize information-dense explanatory cards over mood scenery.",
      "Use one central anchor + surrounding structured cards; avoid minimalist poster style.",
      "Render card numbers 1..N with clear spacing and readable hierarchy (title above subtitle).",
      "Distribute one complete text line per card; never truncate, split, or paraphrase."
    );
  }

  return lines.join("\n");
}

function fallbackGlobalStyle(context: ConversionContext): {
  styleTheme: string;
  styleAnchor: string;
  visualDirection: string;
  styleFlavor: string;
  iconDirection: string;
  typographyDirection: string;
  colorDirection: string;
  textureDirection: string;
  backgroundDirection: string;
  consistencyRule: string;
  negativeKeywords: string[];
} {
  const corpus = [
    context.visualStyleProfile.styleArchetype || "",
    context.visualStyleProfile.globalDirection,
    ...context.visualStyleProfile.styleKeywords
  ]
    .join(" ")
    .toLowerCase();

  let styleAnchor = "professional infographic layout, clean editorial illustration style";
  let styleTheme = "editorial_clean";
  let visualDirection = "clean editorial infographic rendering with topic-matched visual language";
  let iconDirection = "minimal, clear icons consistent with the main illustration style";
  let typographyDirection = "high-legibility sans-serif style aligned with topic tone";
  if (/(playful|cartoon|hand[- ]drawn|watercolor|lifestyle|human)/i.test(corpus)) {
    styleTheme = "playful_educational";
    styleAnchor = "professional hand-drawn infographic layout, playful editorial illustration style";
    visualDirection = "hand-drawn or soft illustrated educational poster style";
    iconDirection = "rounded hand-drawn icons with friendly outlines";
    typographyDirection = "rounded, friendly sans-serif typography with strong legibility";
  } else if (/(tech|data|corporate|minimal|analytical)/i.test(corpus)) {
    styleTheme = "tech_editorial";
    styleAnchor = "professional infographic layout, clean modern editorial illustration style";
    visualDirection = "modern technology editorial illustration with crisp geometric forms";
    iconDirection = "geometric line or duotone icons with precise edges";
    typographyDirection = "geometric grotesk/sans-serif typography with clean spacing";
  } else if (/(monochrome|high-contrast|dark)/i.test(corpus)) {
    styleTheme = "serious_editorial";
    styleAnchor = "professional infographic layout, high-contrast editorial illustration style";
    visualDirection = "serious editorial visual language with restrained drama";
    iconDirection = "simple monochrome icons with strong silhouette contrast";
    typographyDirection = "neutral news/editorial sans-serif style";
  }

  return {
    styleTheme,
    styleAnchor,
    visualDirection,
    styleFlavor: "topic-matched professional infographic layout with clear central anchor and structured numbered cards",
    iconDirection,
    typographyDirection,
    colorDirection: "topic-appropriate color direction with readability-first contrast",
    textureDirection: "texture style should match topic (clean vector, hand-drawn, or subtle material texture)",
    backgroundDirection: "background should support readability and match topic tone",
    consistencyRule:
      "All slides must keep one coherent visual language, card style, icon style, typography personality, and color logic",
    negativeKeywords: context.visualStyleProfile.negativeKeywords.slice(0, 10)
  };
}

export async function skillVisualPromptPlanner(context: ConversionContext): Promise<ConversionContext> {
  const aspectRatio = context.request.aspectRatios[0] ?? "4:5";
  const isLongform = true;
  const textOnImage = context.request.generationMode === "quote_slides" || isLongform;
  const fallbackGlobal = fallbackGlobalStyle(context);

  const llmResult = await callSkillLlmJson<RawVisualPromptPlan>({
    skill: "visualPromptPlanner",
    input: {
      source_text: context.request.inputText,
      content_mode: "longform_digest",
      ratio: aspectRatio,
      text_on_image: textOnImage,
      style_profile: context.visualStyleProfile,
      good_case_rules: {
        style: "professional topic-matched infographic layout with one coherent style family",
        style_selection: [
          "children/education -> playful illustrated or hand-drawn style",
          "technology/reporting -> modern clean tech editorial style",
          "business/finance/news -> serious editorial style with restrained visuals"
        ],
        center_anchor: "one clear central anchor subject",
        cards: "1-5 distinct rectangular information cards, numbered and clearly separated",
        card_content: "each card has specific visual element tied to topic and one concise subtitle",
        quality: "high clarity, professional graphic design, educational poster style",
        texture: "texture should follow selected topic style and remain consistent across all slides",
        palette: "palette should match topic mood while preserving text readability",
        background: "background should be readable and style-consistent (not always cartoon/hand-drawn)",
        icons: "icon style must match selected visual style and remain consistent across slides",
        typography: "text style personality should match topic and remain consistent across slides",
        consistency: "all slides share one global visual language",
        forbidden: [
          "placeholder tokens like H1 / LOCKED_TEXT",
          "random extra text",
          "truncated sentence fragments",
          "style drift between slide 1 and others",
          "forcing cartoon style for serious technology/news topics"
        ]
      },
      slides: context.storyboard.map((story) => {
        const cards = pickSlideCards(context, story.index)?.cards ?? [];
        const heading = pickSlideCards(context, story.index)?.heading ?? `Slide ${story.index}`;
        const summary = pickSlideCards(context, story.index)?.summary ?? story.script;
        const visual = context.visuals.find((item) => item.index === story.index);
        return {
          index: story.index,
          heading,
          summary,
          slide_cards: cards.map((card) => ({
            title: card.title,
            sub_title: card.sentence
          })),
          script: story.script,
          visual_hint: visual?.metaphor,
          hero_subject: visual?.metaphorPlan?.heroSubject,
          diagram_type: visual?.metaphorPlan?.diagramType
        };
      }),
      constraints: {
        same_style_across_all_slides: true,
        preserve_information_density: true,
        cards_per_slide_max: 5,
        cards_per_slide_min: 3,
        one_complete_sentence_per_card: true,
        no_text_truncation: true,
        longform_infographic_only: true,
        avoid_minimal_poster_for_longform: true,
        avoid_cinematic_mood_shot_for_longform: true,
        style_must_match_topic: true,
        icon_style_consistency: true,
        typography_style_consistency: true
      }
    },
    outputSchemaHint:
      '{"global_style":{"style_theme":"...","style_anchor":"...","visual_direction":"...","style_flavor":"...","icon_direction":"...","typography_direction":"...","color_direction":"...","texture_direction":"...","background_direction":"...","consistency_rule":"...","negative_keywords":["..."]},"slides":[{"index":1,"prompt":"...","locked_texts":["..."],"style_tag":"...","diagram_type":"metaphor|comparison_pillar|concentric_moat|process_flow|metric_trend","negative_space_area":"top|left|right|bottom|center"}]}',
    outputLanguage: "en-US"
  });

  const global = {
      styleTheme: compact(String(llmResult?.global_style?.style_theme ?? "")) || fallbackGlobal.styleTheme,
      styleAnchor: compact(String(llmResult?.global_style?.style_anchor ?? "")) || fallbackGlobal.styleAnchor,
      visualDirection: compact(String(llmResult?.global_style?.visual_direction ?? "")) || fallbackGlobal.visualDirection,
      styleFlavor: compact(String(llmResult?.global_style?.style_flavor ?? "")) || fallbackGlobal.styleFlavor,
      iconDirection: compact(String(llmResult?.global_style?.icon_direction ?? "")) || fallbackGlobal.iconDirection,
      typographyDirection:
        compact(String(llmResult?.global_style?.typography_direction ?? "")) || fallbackGlobal.typographyDirection,
      colorDirection: compact(String(llmResult?.global_style?.color_direction ?? "")) || fallbackGlobal.colorDirection,
    textureDirection:
      compact(String(llmResult?.global_style?.texture_direction ?? "")) || fallbackGlobal.textureDirection,
    backgroundDirection:
      compact(String(llmResult?.global_style?.background_direction ?? "")) || fallbackGlobal.backgroundDirection,
    consistencyRule:
      compact(String(llmResult?.global_style?.consistency_rule ?? "")) || fallbackGlobal.consistencyRule,
    negativeKeywords:
      normalizeKeywords(llmResult?.global_style?.negative_keywords, 12).length > 0
        ? normalizeKeywords(llmResult?.global_style?.negative_keywords, 12)
        : fallbackGlobal.negativeKeywords
  };

  if (!/infographic/i.test(global.styleAnchor)) {
    global.styleAnchor = fallbackGlobal.styleAnchor;
  }

  const planByIndex = new Map(
    (llmResult?.slides ?? [])
      .map((slide) => ({
        index: Number(slide?.index),
        prompt: compact(String(slide?.prompt ?? "")),
        lockedTexts: normalizeLockedTexts(slide?.locked_texts, context.request.outputLanguage),
        styleTag: compact(String(slide?.style_tag ?? "")),
        diagramType: normalizeDiagramType(slide?.diagram_type),
        negativeSpaceArea: normalizeSpaceArea(slide?.negative_space_area)
      }))
      .filter((slide) => Number.isFinite(slide.index) && slide.index > 0)
      .map((slide) => [slide.index, slide] as const)
  );

  const assetPromptPlans: AssetPromptPlan[] = context.storyboard.map((story) => {
    const slidePlan = pickSlideCards(context, story.index);
    const cards = slidePlan?.cards ?? [{ title: "Core", sentence: story.script }];
    const denseLines = buildDenseCardSentences({
      heading: slidePlan?.heading || `Slide ${story.index}`,
      summary: slidePlan?.summary || story.script,
      cards,
      isLongform,
      slideIndex: story.index
    });
    const cardPayload = denseLines.map((line, idx) => ({
      title: compact(cards[idx]?.title || inferCardTitleFromLine(line, idx)),
      sub_title: compact(line)
    }));

    const fallbackPrompt = buildFallbackPrompt({
      slideIndex: story.index,
      heading: slidePlan?.heading || `Slide ${story.index}`,
      summary: slidePlan?.summary || story.script,
      cards,
      textLines: denseLines,
      cardPayload,
      isLongform,
      aspectRatio,
      styleTheme: global.styleTheme,
      styleAnchor: global.styleAnchor,
      visualDirection: global.visualDirection,
      styleFlavor: global.styleFlavor,
      iconDirection: global.iconDirection,
      typographyDirection: global.typographyDirection,
      colorDirection: global.colorDirection,
      textureDirection: global.textureDirection,
      backgroundDirection: global.backgroundDirection,
      consistencyRule: global.consistencyRule
    });

    const raw = planByIndex.get(story.index);
    const prompt = fallbackPrompt;
    const lockedTextsFromCards = denseLines;
    const lockedTexts = textOnImage
      ? normalizeLockedTexts(
          lockedTextsFromCards,
          context.request.outputLanguage
        )
      : [];

    const visual = context.visuals.find((item) => item.index === story.index);

    return {
      index: story.index,
      prompt,
      lockedTexts,
      styleTag:
        raw?.styleTag ||
        global.styleTheme ||
        visual?.metaphorPlan?.styleTag ||
        context.visualStyleProfile.recommendedPreset ||
        context.request.brand.stylePreset,
      diagramType: raw?.diagramType || visual?.metaphorPlan?.diagramType || "metaphor",
      negativeSpaceArea: raw?.negativeSpaceArea || "center",
      negativeKeywords: global.negativeKeywords
    } satisfies AssetPromptPlan;
  });

  return {
    ...context,
    assetPromptPlans
  };
}
