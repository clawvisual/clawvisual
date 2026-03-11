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
  const englishStopwords = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "into",
    "your",
    "that",
    "this",
    "these",
    "those",
    "is",
    "are",
    "was",
    "were",
    "been",
    "being",
    "have",
    "has",
    "had",
    "will",
    "would",
    "should",
    "could",
    "about",
    "not",
    "isn",
    "aren",
    "wasn",
    "weren",
    "don",
    "doesn",
    "didn",
    "won",
    "can",
    "cant",
    "job"
  ]);
  const terms = (input.match(/[\p{Script=Han}]{2,8}|[A-Za-z][A-Za-z-]{2,}/gu) ?? [])
    .map((item) => item.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean)
    .filter((term) => {
      if (/^[a-z-]+$/.test(term)) {
        if (term.length < 4) return false;
        if (englishStopwords.has(term)) return false;
      }
      return true;
    });
  return Array.from(new Set(terms)).slice(0, 8);
}

function trimLineNoEllipsis(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;

  const sliced = normalized.slice(0, maxChars);
  const lastSpace = sliced.lastIndexOf(" ");
  if (lastSpace >= Math.floor(maxChars * 0.6)) {
    return sliced.slice(0, lastSpace).trim();
  }
  return sliced.trim();
}

function stripOuterQuotes(value: string): string {
  let text = value.trim();
  const pairs: Record<string, string> = {
    "\"": "\"",
    "'": "'",
    "“": "”",
    "‘": "’",
    "「": "」",
    "『": "』"
  };

  while (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if (pairs[first] && pairs[first] === last) {
      text = text.slice(1, -1).trim();
      continue;
    }
    break;
  }

  return text.replace(/^[`"'“”‘’]+/, "").replace(/[`"'“”‘’]+$/, "").trim();
}

function trimTrailingConnectorsForEnglish(value: string): string {
  const tokens = value.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return value.trim();

  const trailingConnectors = new Set([
    "a",
    "an",
    "the",
    "and",
    "or",
    "to",
    "of",
    "for",
    "with",
    "at",
    "by",
    "from",
    "in",
    "on",
    "where",
    "when",
    "that",
    "which",
    "who",
    "whose",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being"
  ]);

  while (tokens.length > 1) {
    const rawTail = tokens[tokens.length - 1]?.toLowerCase() ?? "";
    const tail = rawTail.replace(/^[^a-z]+|[^a-z]+$/g, "");
    if (!tail || !trailingConnectors.has(tail)) break;
    tokens.pop();
  }

  return tokens.join(" ").trim();
}

function looksTruncatedEnglishLine(value: string): boolean {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return true;
  if (!/[A-Za-z]/.test(text)) return false;
  if (/[.!?]$/.test(text)) return false;

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return true;

  const trailingConnectors = new Set([
    "a",
    "an",
    "the",
    "and",
    "or",
    "to",
    "of",
    "for",
    "with",
    "at",
    "by",
    "from",
    "in",
    "on",
    "where",
    "when",
    "that",
    "which",
    "who",
    "whose",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being"
  ]);
  const rawTail = words[words.length - 1]?.toLowerCase() ?? "";
  const tail = rawTail.replace(/^[^a-z]+|[^a-z]+$/g, "");
  if (tail && trailingConnectors.has(tail)) return true;

  const tailAfterColon = text.split(":").pop()?.trim() ?? "";
  const tailWords = tailAfterColon.split(/\s+/).filter(Boolean);
  if (text.includes(":") && tailWords.length > 0 && tailWords.length <= 3) return true;

  if (/[,:;\-]\s*$/.test(text)) return true;
  return false;
}

function shortenToCompleteLine(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;

  const clipWindow = normalized.slice(0, Math.min(normalized.length, maxChars + 24));

  const sentenceMatches = Array.from(clipWindow.matchAll(/[.!?。！？]/g));
  const sentenceCut = sentenceMatches
    .map((match) => (match.index == null ? -1 : match.index + 1))
    .filter((index) => index > 0 && index <= maxChars)
    .pop();
  if (sentenceCut && sentenceCut >= Math.floor(maxChars * 0.55)) {
    return clipWindow.slice(0, sentenceCut).trim();
  }

  const clauseMatches = Array.from(clipWindow.matchAll(/[:;，；：,]/g));
  const clauseCut = clauseMatches
    .map((match) => (match.index == null ? -1 : match.index))
    .filter((index) => index > 0 && index <= maxChars)
    .pop();
  if (clauseCut && clauseCut >= Math.floor(maxChars * 0.55)) {
    return clipWindow.slice(0, clauseCut).replace(/[:;，；：,]\s*$/g, "").trim();
  }

  const byWords = trimLineNoEllipsis(normalized, maxChars);
  const compacted = trimTrailingConnectorsForEnglish(byWords);
  if (compacted.split(/\s+/).filter(Boolean).length >= 3) {
    return compacted;
  }
  return "";
}

function cleanupIncompleteCardLine(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (!/[A-Za-z]/.test(normalized)) return normalized;

  let text = normalized;
  const sentenceComplete = /[.!?。！？]$/.test(text);

  if (!sentenceComplete) {
    text = trimTrailingConnectorsForEnglish(text);

    const separatorMatch = text.match(/^(.*?)([:;,\-])\s*([^:;,\-]{1,24})$/);
    if (separatorMatch?.[1] && separatorMatch?.[3]) {
      const tail = separatorMatch[3].trim();
      const tailWords = tail.split(/\s+/).filter(Boolean);
      const tailLooksWeak =
        tailWords.length <= 2 ||
        (tailWords.length <= 3 && /^(true|false|good|bad|more|less|better|worse)$/i.test(tailWords[tailWords.length - 1] ?? ""));
      if (tailLooksWeak) {
        text = separatorMatch[1].trim();
      }
    }
  }

  return text.replace(/[:;,\-]\s*$/g, "").trim();
}

function stripHierarchyLabelPrefix(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  const stripped = normalized
    .replace(/^(?:h[1-6]|heading|title|subtitle|subheading|body)\s*[:：-]\s*/i, "")
    .replace(/^h[1-6]\s+/i, "")
    .trim();

  if (/^(?:h[1-6]|heading|title|subtitle|subheading|body)$/i.test(stripped)) {
    return "";
  }
  return cleanupIncompleteCardLine(stripOuterQuotes(stripped));
}

function normalizeLockedTextLine(value: string, maxChars: number): string {
  const cleaned = stripHierarchyLabelPrefix(value);
  if (!cleaned) return "";
  const shortened = shortenToCompleteLine(cleaned, maxChars);
  if (!shortened) return "";
  const normalized = cleanupIncompleteCardLine(shortened);
  if (!normalized) return "";
  if (looksTruncatedEnglishLine(normalized)) return "";
  return normalized;
}

function splitDenseTextIntoLines(text: string, maxCharsPerLine: number): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  return normalized
    .split(/(?:[。！？!?；;]+|\.\s+|\n+)/g)
    .map((item) => item.trim())
    .map((item) => normalizeLockedTextLine(item, maxCharsPerLine))
    .filter(Boolean);
}

function buildLongformLockedTextLines(heading: string, bodyText: string, supplementalLines: string[] = []): string[] {
  const headingLine = normalizeLockedTextLine(heading, 48);
  const bodyLines = splitDenseTextIntoLines(bodyText, 72);
  const supplementLines = supplementalLines.map((item) => normalizeLockedTextLine(item, 72)).filter(Boolean);
  const merged = [headingLine, ...supplementLines, ...bodyLines]
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && /[\p{L}\p{N}]/u.test(item));
  return Array.from(new Set(merged)).slice(0, 5);
}

function buildLongformCardTopicHints(plan: PromptPlan): string {
  const fromAssociations = plan.visualAssociations
    .map((item) => item.keyword.trim())
    .filter(Boolean)
    .slice(0, 5);
  const fromCore = plan.coreKeywords.map((item) => item.trim()).filter(Boolean).slice(0, 5);
  const merged = Array.from(new Set([...fromAssociations, ...fromCore])).slice(0, 5);
  return merged.join(", ");
}

function pickLongformCardCount(isCoverSlide: boolean, lockedLineHints: string[]): number {
  if (isCoverSlide) {
    const requested = lockedLineHints.length || 5;
    return Math.max(4, Math.min(5, requested));
  }
  const requested = lockedLineHints.length || 3;
  return Math.max(2, Math.min(4, requested));
}

function resolveLongformStyleAnchor(plan: PromptPlan): string {
  const archetype = plan.styleArchetype.toLowerCase();
  if (archetype === "data_drama") return "clean data-forward infographic";
  if (archetype === "human_story") return "human-centered narrative infographic";
  if (archetype === "cinematic_minimal") return "minimal high-contrast editorial infographic";
  return "clean editorial infographic";
}

function composeLongformCompactPrompt(params: {
  plan: PromptPlan;
  aspectRatio: AspectRatio;
  lockedLineHints: string[];
}): string {
  const isCoverSlide = params.plan.index === 1;
  const cardCount = pickLongformCardCount(isCoverSlide, params.lockedLineHints);
  const topicHints = buildLongformCardTopicHints(params.plan) || "core ideas from the source text";
  const styleAnchor = resolveLongformStyleAnchor(params.plan);
  const styleHintKeywords = params.plan.styleKeywords
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(", ");
  const textLines = params.lockedLineHints
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, cardCount);

  const lines = [
    `A professional ${styleAnchor} layout with a single central anchor subject: ${truncate(params.plan.heroSubject, 120)}.`,
    `Around the center, ${cardCount} distinct rectangular information cards in a clean balanced grid, numbered 1 to ${cardCount}.`,
    `Each card should include a simple icon or micro-scene related to: ${truncate(topicHints, 180)}.`,
    `Style direction: ${truncate(styleHintKeywords || "high clarity, clean composition", 140)}.`,
    "High clarity, minimal decoration, consistent spacing, readable typography.",
    "Background should be plain white or light neutral with subtle texture; avoid complex scenery and photoreal cinematic effects.",
    `Aspect ratio ${params.aspectRatio}.`
  ];

  if (textLines.length) {
    lines.push(
      `Render exactly these text lines on the cards (no rewrite): ${JSON.stringify(textLines)}.`,
      "Distribute one text line per card when possible; keep copy concise and high-contrast."
    );
  } else {
    lines.push("Use concise, high-signal short text snippets on cards; avoid long paragraphs.");
  }

  lines.push(
    "Do not render random extra words, subtitles, code-like labels, or placeholder tokens.",
    "No watermark, no logo, no palette legend."
  );

  return lines.join("\n");
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

  const isLongformDigest = context.request.contentMode === "longform_digest";

  return {
    index: visual.index,
    coreKeywords,
    visualAssociations,
    diagramType: visual.metaphorPlan?.diagramType ?? "metaphor",
    entityTags: visual.metaphorPlan?.entityTags ?? [],
    metricTags: visual.metaphorPlan?.metricTags ?? [],
    subject: isLongformDigest
      ? isCoverSlide
        ? `An information-dense cover infographic that summarizes key ideas for: ${visual.hierarchy.body}`
        : `An explanatory, information-first visual for: ${visual.hierarchy.body}`
      : visual.metaphorPlan?.visualDescription || visual.metaphor || "A symbolic scene aligned with the slide meaning",
    sceneDirection: isLongformDigest
      ? isCoverSlide
        ? `simple central anchor icon/character with 3-5 clean information cards; plain background; minimal props; avoid complex scenery; ${associationText || "keyword-driven structure"}`
        : `simple central anchor with 2-4 structured information cards; plain background; avoid scenic details; ${associationText || "keyword-driven structure"}`
      : `${associationText || "keyword-driven symbolic scene"}, aligned with slide statement meaning`,
    composition: compositionHint.composition,
    artStyle: isLongformDigest
      ? "clean infographic poster style, flat or hand-drawn illustration, simple shapes, high readability, minimal decoration"
      : isCoverSlide
      ? `${context.request.brand.stylePreset} style, bold editorial cover composition, dramatic but clean, ${styleProfile.recommendedTone} tone`
      : `${context.request.brand.stylePreset} style, editorial illustration tuned to ${styleProfile.visualDomain} context, ${styleProfile.recommendedTone} tone`,
    lightingMood: isLongformDigest
      ? "flat even lighting, low visual noise, readability-first contrast"
      : "cinematic soft lighting, clear contrast, platform-ready social visual quality",
    colorDirection: colors
      ? isLongformDigest
        ? "light neutral background with 2-3 restrained accent colors and strong text contrast"
        : "cool cyan and emerald accents with deep navy contrast"
      : "balanced neutral tones with restrained accents",
    typography: {
      fontFamily: "Sans-serif",
      fontWeight: "Bold",
      position: "top-center"
    },
    technicalSpecs: isLongformDigest
      ? `clean infographic rendering, simple background, consistent card spacing, uncluttered, ${noTextSpec}, --ar ${aspectRatio}`
      : `hyper-realistic, sharp details, uncluttered, ${noTextSpec}, 8k, --ar ${aspectRatio}`,
    textOnImage,
    styleKeywords: styleProfile.styleKeywords,
    negativeStyleKeywords: styleProfile.negativeKeywords,
    globalDirection: styleProfile.globalDirection,
    styleArchetype: styleProfile.styleArchetype ?? "editorial_bold",
    heroSubject: isLongformDigest
      ? visual.metaphorPlan?.heroSubject || "one simple central anchor icon"
      : visual.metaphorPlan?.heroSubject || visual.metaphorPlan?.metaphorName || "single dominant symbolic hero",
    cameraAngle: isLongformDigest
      ? "frontal editorial view"
      : visual.metaphorPlan?.cameraAngle || "eye-level medium close shot",
    depthLayers: isLongformDigest
      ? "single foreground anchor with minimal background"
      : visual.metaphorPlan?.depthLayers || "foreground anchor, midground hero subject, soft background context",
    motionCue: isLongformDigest
      ? "static structured layout emphasis"
      : visual.metaphorPlan?.motionCue || "directional tension pointing to the hero subject",
    emotionalTrigger: visual.metaphorPlan?.emotionalTrigger || "high-stakes clarity",
    surpriseElement: isLongformDigest
      ? "none; prioritize clean informational structure"
      : isCoverSlide
      ? "cover-level visual hook with unexpected angle or dramatic perspective shift"
      : "one unexpected but relevant visual twist",
    firstGlanceRule: isLongformDigest
      ? isCoverSlide
        ? "viewer should grasp the topic plus 3-5 key points in one glance"
        : "viewer should understand core meaning in one glance without metaphor guessing"
      : isCoverSlide
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
  outputLanguage: string,
  contentMode: ConversionContext["request"]["contentMode"],
  exactTextLines: string[]
): string {
  const withAspect = plan.technicalSpecs.includes("--ar")
    ? plan.technicalSpecs
    : `${plan.technicalSpecs}, --ar ${aspectRatio}`;
  const lockedLineHints = exactTextLines
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 5);

  if (contentMode === "longform_digest") {
    return composeLongformCompactPrompt({
      plan,
      aspectRatio,
      lockedLineHints
    });
  }

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

  if (plan.textOnImage && lockedLineHints.length) {
    lines.push(
      `Render exactly these text lines without any translation or rewrite: ${JSON.stringify(lockedLineHints)}.`,
      `Typography rule: ${plan.typography.fontWeight} ${plan.typography.fontFamily}, position ${plan.typography.position}, high readability.`,
      "Do not add any other text, subtitle, or translation."
    );
  } else if (plan.textOnImage && quoteText && canLockQuote) {
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

  if (context.request.contentMode === "longform_digest") {
    return fallbackPlans;
  }

  const textOnImage = context.request.generationMode === "quote_slides";

  const llmResult = await callSkillLlmJson<{
    items?: RawPromptPlan[];
  }>({
    skill: "assetGenerator",
    input: {
      objective: textOnImage
        ? "Use four steps for each slide prompt: 1) intent parsing (core keywords), 2) context-aware visual association mapping, 3) strict text rendering rule (exact slide quote), 4) style treatment with professional consistency. Must satisfy feed-stopping composition and first-glance recognition in 0.3 seconds. For cover slide (index=1), apply extra-bold hook-first visual strategy."
        : "Use four steps for each slide prompt: context-aware intent parsing, visual association, typography-safe composition, style treatment. Must satisfy feed-stopping composition and first-glance recognition in 0.3 seconds. For cover slide (index=1), apply extra-bold hook-first visual strategy.",
      content_mode: context.request.contentMode,
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
        mode_rules: [],
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
      const lockedTexts: string[] = [];
      const compositionHint = compositionPlanToHint(visual.metaphorPlan?.compositionPlan ?? "centered");
      const styleTag =
        visual.metaphorPlan?.styleTag ||
        context.visualStyleProfile.recommendedPreset ||
        context.request.brand.stylePreset;

      if (plan.textOnImage && shouldLockTextForOutputLanguage(quote, outputLanguage)) {
        if (context.request.contentMode === "longform_digest") {
          const coverSupplement = visual.index === 1 ? context.corePoints.slice(0, 5) : [];
          lockedTexts.push(...buildLongformLockedTextLines(visual.hierarchy.heading, quote, coverSupplement));
        } else {
          // Keep slide text immutable on image generation.
          lockedTexts.push(quote);
        }
      }
      if (plan.textOnImage) {
        if (context.request.contentMode !== "longform_digest") {
          const supplementalLockedTexts = disallowHan ? [] : [...plan.entityTags, ...plan.metricTags];
          lockedTexts.push(...filterLockedTextsForOutputLanguage(supplementalLockedTexts, outputLanguage));
        }
      }
      const filteredLockedTexts = filterLockedTextsForOutputLanguage(lockedTexts, outputLanguage);
      const prompt = composePrompt(
        plan,
        quote,
        aspectRatio,
        outputLanguage,
        context.request.contentMode,
        filteredLockedTexts
      );

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
        lockedTexts: filteredLockedTexts
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
