export type AspectRatio = "4:5" | "9:16" | "1:1" | "16:9";
export type GenerationMode = "standard" | "quote_slides";
export type PlatformType = "RedBook" | "Twitter" | "Instagram" | "TikTok" | "LinkedIn";
export type SkillStatus = "running" | "completed" | "failed";

export type LayoutTemplate =
  | "TEMPLATE_COVER"
  | "TEMPLATE_LIST"
  | "TEMPLATE_QUOTE"
  | "TEMPLATE_COMPARISON"
  | "TEMPLATE_STEPS"
  | "TEMPLATE_DATA";
export type CompositionPlan = "left-heavy" | "right-heavy" | "bottom-heavy" | "top-heavy" | "centered";
export type DiagramType = "metaphor" | "comparison_pillar" | "concentric_moat" | "process_flow" | "metric_trend";

export interface BrandConfig {
  logoUrl?: string;
  colorPalette?: string[];
  fonts?: string[];
  stylePreset: string;
}

export interface SlideScript {
  index: number;
  script: string;
}

export interface SlideVisual {
  index: number;
  metaphor: string;
  metaphorPlan?: {
    metaphorName: string;
    visualDescription: string;
    reasoning: string;
    compositionPlan: CompositionPlan;
    heroSubject?: string;
    cameraAngle?: string;
    depthLayers?: string;
    motionCue?: string;
    emotionalTrigger?: string;
    diagramType?: DiagramType;
    entityTags?: string[];
    metricTags?: string[];
    styleTag?: string;
  };
  layout: LayoutTemplate;
  hierarchy: {
    heading: string;
    subheading?: string;
    body: string;
    highlightKeywords: string[];
  };
}

export interface ThemeTokens {
  cssVariables: Record<string, string>;
}

export interface VisualStyleProfile {
  visualDomain: "business" | "tech" | "lifestyle" | "data-viz" | "personal-growth" | "emotion" | "education" | "general";
  recommendedPreset: string;
  recommendedTone: string;
  styleArchetype?: "editorial_bold" | "cinematic_minimal" | "data_drama" | "human_story";
  surprisePolicy?: string;
  styleKeywords: string[];
  negativeKeywords: string[];
  globalDirection: string;
  rationale: string;
}

export interface SlideComposition {
  index: number;
  imageUrl: string;
  script: string;
  layout: LayoutTemplate;
  renderPayload: {
    h1: string;
    h2?: string;
    body: string;
  };
}

export interface AttentionAudit {
  index: number;
  readabilityScore: number;
  contrastScore: number;
  hookStrength?: number;
  novelty?: number;
  emotionalImpact?: number;
  overlapRisk: "low" | "medium" | "high";
  action: "none" | "add-overlay" | "darken-background";
}

export interface SourceEvidence {
  url: string;
  title: string;
  excerpt: string;
  credibilityScore: number;
  provider: "input" | "tavily" | "serper" | "jina" | "origin" | "fallback";
  reason?: string;
}

export interface TrendSignal {
  tag: string;
  score: number;
  source: "tavily" | "serper" | "llm" | "fallback";
  reason: string;
}

export interface ConversionRequest {
  inputText: string;
  targetSlides: number;
  aspectRatios: AspectRatio[];
  brand: BrandConfig;
  tone: string;
  outputLanguage: string;
  generationMode: GenerationMode;
  sourceType?: "url" | "text";
  sourceUrl?: string;
  sourceTitle?: string;
  reviewMode?: "auto" | "required";
}

export interface ConversionContext {
  request: ConversionRequest;
  corePoints: string[];
  hooks: string[];
  storyboard: SlideScript[];
  visuals: SlideVisual[];
  visualStyleProfile: VisualStyleProfile;
  theme: ThemeTokens;
  assets: Array<{
    index: number;
    prompt: string;
    imageUrl: string;
    styleTag?: string;
    diagramType?: DiagramType;
    entityTags?: string[];
    metricTags?: string[];
    negativeSpaceArea?: "top" | "left" | "right" | "bottom" | "center";
    metaphorConcept?: string;
    designReasoning?: string;
  }>;
  compositions: SlideComposition[];
  resizedOutputs: Array<{ ratio: AspectRatio; index: number; imageUrl: string }>;
  audits: AttentionAudit[];
  sourceEvidence: SourceEvidence[];
  trendSignals: TrendSignal[];
  cta: string;
  caption: string;
  hashtags: string[];
}

export interface ConversionResult {
  post_title: string;
  post_caption: string;
  hashtags: string[];
  platform_type: PlatformType;
  slides: Array<{
    slide_id: number;
    is_cover: boolean;
    content_quote: string;
    visual_prompt: string;
    image_url: string;
    layout_template: LayoutTemplate | string;
    focus_keywords: string[];
    metaphor_title?: string;
    ai_reasoning?: string;
    text_overlay_position?: "top" | "left" | "right" | "bottom" | "center";
    style_tag?: string;
    diagram_type?: DiagramType;
    entity_tags?: string[];
    metric_tags?: string[];
    prompt_logs?: string;
    brand_overlay: {
      logo_position: string;
      color_values: {
        primary: string;
        secondary: string;
        background: string;
        text: string;
      };
      font_name: string;
      logo_url?: string;
    };
  }>;
  skill_logs: Array<{
    skill_name: string;
    status: SkillStatus;
    output_preview: string;
  }>;
  aspect_ratio: AspectRatio;
  source_evidence?: SourceEvidence[];
  trend_signals?: TrendSignal[];
  review?: {
    required: boolean;
    reason: string;
    cover_candidates?: Array<{
      label: string;
      visual_prompt: string;
      image_url: string;
    }>;
  };
}
