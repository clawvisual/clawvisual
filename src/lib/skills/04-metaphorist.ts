import { callSkillLlmJson } from "@/lib/llm/skill-client";
import type { CompositionPlan, ConversionContext, DiagramType, SlideVisual } from "@/lib/types/skills";

function normalizeCompositionPlan(value: unknown): CompositionPlan {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "left-heavy") return "left-heavy";
  if (raw === "right-heavy") return "right-heavy";
  if (raw === "bottom-heavy") return "bottom-heavy";
  if (raw === "top-heavy") return "top-heavy";
  return "centered";
}

function normalizeDiagramType(value: unknown): DiagramType {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "comparison_pillar") return "comparison_pillar";
  if (raw === "concentric_moat") return "concentric_moat";
  if (raw === "process_flow") return "process_flow";
  if (raw === "metric_trend") return "metric_trend";
  return "metaphor";
}

function normalizeStringArray(value: unknown, max = 8): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, max);
}

function normalizeCompact(value: unknown, max = 120): string {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized;
}

function inferDiagramType(text: string): DiagramType {
  const source = text.toLowerCase();
  if (/(对比|比较|vs|versus|competition|差异|二选一)/i.test(source)) return "comparison_pillar";
  if (/(护城河|moat|飞轮|同心|ecosystem|壁垒)/i.test(source)) return "concentric_moat";
  if (/(流程|链路|路径|步骤|process|workflow|pipeline)/i.test(source)) return "process_flow";
  if (/(增长|下滑|份额|占比|同比|环比|%|趋势|metric|kpi|gmv|roi)/i.test(source)) return "metric_trend";
  return "metaphor";
}

function inferEntityTags(sourceText: string, slideScript: string): string[] {
  const corpus = `${sourceText}\n${slideScript}`;
  const extra = Array.from(new Set(corpus.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,30}/g) ?? []))
    .filter((token) => /[A-Za-z]{2,}|[\u4e00-\u9fa5]{2,}/.test(token))
    .filter((token) => /(集团|公司|品牌|平台|学校|课程|关系|情绪|习惯|目标|成长|community|relationship|education|course|team|company|brand|platform)/i.test(token))
    .slice(0, 8);
  return Array.from(new Set(extra)).slice(0, 8);
}

function inferMetricTags(slideScript: string): string[] {
  const direct = Array.from(new Set(slideScript.match(/\d+(?:\.\d+)?%|\d+\s*(分钟|小时|天|倍|亿|万)/g) ?? []));
  return direct.slice(0, 6);
}

const COMPOSITION_CYCLE: CompositionPlan[] = [
  "left-heavy",
  "right-heavy",
  "top-heavy",
  "bottom-heavy",
  "centered"
];

function fallbackCompositionPlan(index: number): CompositionPlan {
  return COMPOSITION_CYCLE[(index - 1) % COMPOSITION_CYCLE.length] ?? "centered";
}

function fallbackCameraAngle(index: number): string {
  const variants = [
    "eye-level close medium shot",
    "low-angle wide shot",
    "high-angle editorial shot",
    "three-quarter dynamic perspective",
    "centered symmetrical framing"
  ];
  return variants[(index - 1) % variants.length] ?? "eye-level close medium shot";
}

function fallbackDepthLayers(index: number): string {
  const variants = [
    "foreground anchor, midground hero subject, soft background context",
    "foreground framing shape, midground active subject, deep atmospheric background",
    "foreground data cue, midground narrative object, minimal background gradient",
    "foreground motion cue, midground symbolic subject, abstract background structure",
    "clean foreground surface, centered midground subject, subtle vignette background"
  ];
  return variants[(index - 1) % variants.length] ?? variants[0];
}

function fallbackMotionCue(index: number): string {
  const variants = [
    "subtle directional movement toward main insight",
    "diagonal motion tension implying urgency",
    "radial pull focusing attention on the hero subject",
    "layered parallax feel that suggests progression",
    "controlled stillness with one directional accent"
  ];
  return variants[(index - 1) % variants.length] ?? variants[0];
}

function fallbackEmotionalTrigger(index: number): string {
  const variants = [
    "clarity through contrast",
    "surprise through scale shift",
    "urgency through directional tension",
    "confidence through structural order",
    "curiosity through asymmetry"
  ];
  return variants[(index - 1) % variants.length] ?? variants[0];
}

function fallbackMetaphorName(slideScript: string, index: number): string {
  const trimmed = slideScript.replace(/\s+/g, " ").trim();
  if (!trimmed) return `Visual Metaphor ${index}`;
  return trimmed.length > 28 ? `${trimmed.slice(0, 27)}…` : trimmed;
}

function fallbackVisualDescription(slideScript: string, index: number): string {
  const summary = slideScript.replace(/\s+/g, " ").trim();
  const variant = [
    "editorial high-contrast",
    "cinematic asymmetric",
    "diagram-led analytical",
    "dynamic depth-rich",
    "minimal dramatic"
  ][(index - 1) % 5] ?? "editorial high-contrast";
  return summary
    ? `A ${variant} symbolic scene that conveys: ${summary}`
    : "A clean symbolic scene with one strong focal subject and clear negative space.";
}

function fallbackReasoning(slideScript: string): string {
  const summary = slideScript.replace(/\s+/g, " ").trim();
  return summary
    ? `This visual uses a concrete symbolic scene to express the core meaning of: ${summary}`
    : "This visual keeps one dominant subject plus negative space to improve readability and semantic focus.";
}

function fallbackVisuals(context: ConversionContext): SlideVisual[] {
  return context.storyboard.map((slide) => ({
    index: slide.index,
    metaphor: fallbackVisualDescription(slide.script, slide.index),
    metaphorPlan: {
      metaphorName: fallbackMetaphorName(slide.script, slide.index),
      visualDescription: fallbackVisualDescription(slide.script, slide.index),
      reasoning: fallbackReasoning(slide.script),
      compositionPlan: fallbackCompositionPlan(slide.index),
      diagramType: inferDiagramType(slide.script),
      entityTags: inferEntityTags(context.request.inputText, slide.script),
      metricTags: inferMetricTags(slide.script),
      styleTag: "conceptual-symbolism",
      heroSubject: fallbackMetaphorName(slide.script, slide.index),
      cameraAngle: fallbackCameraAngle(slide.index),
      depthLayers: fallbackDepthLayers(slide.index),
      motionCue: fallbackMotionCue(slide.index),
      emotionalTrigger: fallbackEmotionalTrigger(slide.index)
    },
    layout: "TEMPLATE_LIST",
    hierarchy: {
      heading: slide.script.split(".")[0]?.slice(0, 70) ?? `Slide ${slide.index}`,
      body: slide.script,
      highlightKeywords: []
    }
  }));
}

export async function skill04Metaphorist(context: ConversionContext): Promise<ConversionContext> {
  const llmResult = await callSkillLlmJson<{
    items?: Array<{
      index?: number;
      metaphor_name?: string;
      visual_description?: string;
      reasoning?: string;
      composition_plan?: string;
      diagram_type?: string;
      entity_tags?: string[];
      metric_tags?: string[];
      heading?: string;
      body?: string;
      style_tag?: string;
      hero_subject?: string;
      camera_angle?: string;
      depth_layers?: string;
      motion_cue?: string;
      emotional_trigger?: string;
    }>;
  }>({
    skill: "metaphorist",
    input: {
      article_topic: context.request.sourceTitle || context.request.inputText.slice(0, 220),
      source_text: context.request.inputText,
      storyboard: context.storyboard.map((slide) => ({
        index: slide.index,
        slide_content: slide.script
      })),
      objective:
        "Create conceptual visual metaphors (not literal keyword repetition). Also classify diagram_type and extract entity_tags/metric_tags for domain-adaptive visual storytelling (business, personal growth, emotion, education, lifestyle, tech). Each slide must explicitly define hero_subject, camera_angle, depth_layers, motion_cue, and emotional_trigger. Every slide must have distinctive metaphor and composition; do not repeat similar scenes across slides. Vary camera language, color mood direction, and composition style across the sequence. Output visual_description in English and reasoning in target language. Keep strong text-safe composition."
    },
    outputSchemaHint:
      '{"items":[{"index":1,"metaphor_name":"...","visual_description":"...","reasoning":"...","composition_plan":"left-heavy|right-heavy|bottom-heavy|top-heavy|centered","hero_subject":"...","camera_angle":"...","depth_layers":"foreground/midground/background ...","motion_cue":"...","emotional_trigger":"...","diagram_type":"metaphor|comparison_pillar|concentric_moat|process_flow|metric_trend","entity_tags":["community","habit"],"metric_tags":["30%","90 days"],"heading":"...","body":"...","style_tag":"..."}]}',
    outputLanguage: context.request.outputLanguage
  });

  const byIndex = new Map(
    (llmResult?.items ?? [])
      .map((item) => ({
        index: Number(item.index),
        metaphorName: String(item.metaphor_name ?? "").trim(),
        visualDescription: String(item.visual_description ?? "").trim(),
        reasoning: String(item.reasoning ?? "").trim(),
        compositionPlan: normalizeCompositionPlan(item.composition_plan),
        diagramType: normalizeDiagramType(item.diagram_type),
        entityTags: normalizeStringArray(item.entity_tags, 8),
        metricTags: normalizeStringArray(item.metric_tags, 8),
        heading: String(item.heading ?? "").trim(),
        body: String(item.body ?? "").trim(),
        styleTag: String(item.style_tag ?? "").trim(),
        heroSubject: normalizeCompact(item.hero_subject, 80),
        cameraAngle: normalizeCompact(item.camera_angle, 60),
        depthLayers: normalizeCompact(item.depth_layers, 140),
        motionCue: normalizeCompact(item.motion_cue, 100),
        emotionalTrigger: normalizeCompact(item.emotional_trigger, 80)
      }))
      .filter((item) => Number.isFinite(item.index) && item.index > 0)
      .map((item) => [item.index, item] as const)
  );

  const visuals: SlideVisual[] = context.storyboard.map((slide) => {
    const item = byIndex.get(slide.index);
    const fallbackDescription = fallbackVisualDescription(slide.script, slide.index);
    const fallbackName = fallbackMetaphorName(slide.script, slide.index);
    return {
      index: slide.index,
      metaphor: item?.visualDescription || fallbackDescription,
      metaphorPlan: {
        metaphorName: item?.metaphorName || fallbackName,
        visualDescription: item?.visualDescription || fallbackDescription,
        reasoning: item?.reasoning || fallbackReasoning(slide.script),
        compositionPlan: item?.compositionPlan || fallbackCompositionPlan(slide.index),
        diagramType: item?.diagramType || inferDiagramType(slide.script),
        entityTags: item?.entityTags?.length ? item.entityTags : inferEntityTags(context.request.inputText, slide.script),
        metricTags: item?.metricTags?.length ? item.metricTags : inferMetricTags(slide.script),
        styleTag: item?.styleTag || "conceptual-symbolism",
        heroSubject: item?.heroSubject || fallbackName,
        cameraAngle: item?.cameraAngle || fallbackCameraAngle(slide.index),
        depthLayers: item?.depthLayers || fallbackDepthLayers(slide.index),
        motionCue: item?.motionCue || fallbackMotionCue(slide.index),
        emotionalTrigger: item?.emotionalTrigger || fallbackEmotionalTrigger(slide.index)
      },
      layout: "TEMPLATE_LIST",
      hierarchy: {
        heading: item?.heading || slide.script.split(".")[0]?.slice(0, 70) || `Slide ${slide.index}`,
        body: item?.body || slide.script,
        highlightKeywords: []
      }
    };
  });

  return {
    ...context,
    visuals: visuals.length ? visuals : fallbackVisuals(context)
  };
}
