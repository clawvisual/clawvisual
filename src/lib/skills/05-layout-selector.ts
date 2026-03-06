import { callSkillLlmJson } from "@/lib/llm/skill-client";
import type { ConversionContext, LayoutTemplate } from "@/lib/types/skills";

const ALLOWED_LAYOUTS: LayoutTemplate[] = [
  "TEMPLATE_COVER",
  "TEMPLATE_LIST",
  "TEMPLATE_QUOTE",
  "TEMPLATE_COMPARISON",
  "TEMPLATE_STEPS",
  "TEMPLATE_DATA"
];

function fallbackSelectLayout(script: string, index: number): LayoutTemplate {
  if (index === 1) return "TEMPLATE_COVER";
  if (script.includes("vs") || script.includes("versus")) return "TEMPLATE_COMPARISON";
  if (/\d+/.test(script)) return "TEMPLATE_DATA";
  if (script.includes("first") || script.includes("then") || script.includes("finally")) return "TEMPLATE_STEPS";
  if (script.split(" ").length < 16) return "TEMPLATE_QUOTE";
  return "TEMPLATE_LIST";
}

export async function skill05LayoutSelector(context: ConversionContext): Promise<ConversionContext> {
  const llmResult = await callSkillLlmJson<{
    items?: Array<{ index?: number; layout?: string }>;
  }>({
    skill: "layoutSelector",
    input: {
      slides: context.visuals.map((visual) => ({
        index: visual.index,
        text: visual.hierarchy.body
      }))
    },
    outputSchemaHint: '{"items":[{"index":1,"layout":"TEMPLATE_COVER"}]}',
    outputLanguage: context.request.outputLanguage
  });

  const layoutByIndex = new Map<number, LayoutTemplate>();
  for (const item of llmResult?.items ?? []) {
    const index = Number(item.index);
    const layout = String(item.layout ?? "") as LayoutTemplate;
    if (Number.isFinite(index) && ALLOWED_LAYOUTS.includes(layout)) {
      layoutByIndex.set(index, layout);
    }
  }

  const visuals = context.visuals.map((visual) => ({
    ...visual,
    layout: layoutByIndex.get(visual.index) ?? fallbackSelectLayout(visual.hierarchy.body, visual.index)
  }));

  return { ...context, visuals };
}
