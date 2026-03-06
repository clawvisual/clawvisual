import { callSkillLlmJson } from "@/lib/llm/skill-client";
import { hasUnexpectedHan } from "@/lib/i18n/text-guard";
import { pickKeywords } from "@/lib/skills/utils";
import type { ConversionContext } from "@/lib/types/skills";

export async function skill06HierarchyMapper(context: ConversionContext): Promise<ConversionContext> {
  const isQuoteMode = context.request.generationMode === "quote_slides";
  const llmResult = await callSkillLlmJson<{
    items?: Array<{
      index?: number;
      heading?: string;
      subheading?: string;
      body?: string;
      highlightKeywords?: string[];
    }>;
  }>({
    skill: "hierarchyMapper",
    input: {
      slides: context.visuals.map((visual) => ({
        index: visual.index,
        text: visual.hierarchy.body
      })),
      mode: context.request.generationMode,
      rule: isQuoteMode
        ? "Each slide has one sentence. Select exactly 2 highlight keywords."
        : "Standard hierarchy mapping."
    },
    outputSchemaHint:
      '{"items":[{"index":1,"heading":"...","subheading":"...","body":"...","highlightKeywords":["..."]}]}',
    outputLanguage: context.request.outputLanguage
  });

  const byIndex = new Map<number, {
    heading: string;
    subheading?: string;
    body: string;
    highlightKeywords: string[];
  }>();

  for (const item of llmResult?.items ?? []) {
    const index = Number(item.index);
    if (!Number.isFinite(index)) continue;

    const body = String(item.body ?? "").trim();
    const heading = String(item.heading ?? "").trim();
    const subheading = String(item.subheading ?? "").trim();
    const keywords = Array.isArray(item.highlightKeywords)
      ? item.highlightKeywords
          .map((keyword) => String(keyword).trim())
          .filter(Boolean)
          .slice(0, isQuoteMode ? 2 : 5)
      : [];
    const normalizedKeywords =
      isQuoteMode && keywords.length < 2
        ? Array.from(
            new Set([
              ...keywords,
              ...pickKeywords(body, 4)
            ])
          ).slice(0, 2)
        : keywords;

    const languageProbe = [heading, body, ...normalizedKeywords].join(" ");
    if (hasUnexpectedHan(languageProbe, context.request.outputLanguage)) {
      continue;
    }

    if (!body || !heading) continue;
    byIndex.set(index, {
      heading,
      subheading: subheading || undefined,
      body,
      highlightKeywords: normalizedKeywords
    });
  }

  const visuals = context.visuals.map((visual) => {
    const llmHierarchy = byIndex.get(visual.index);
    if (llmHierarchy) {
      return {
        ...visual,
        hierarchy: llmHierarchy
      };
    }

    const words = visual.hierarchy.body.split(/\s+/);
    const fallbackKeywords = pickKeywords(visual.hierarchy.body, isQuoteMode ? 2 : 3);
    return {
      ...visual,
      hierarchy: {
        heading: isQuoteMode ? visual.hierarchy.body : words.slice(0, 8).join(" "),
        subheading: isQuoteMode ? undefined : words.slice(8, 18).join(" "),
        body: visual.hierarchy.body,
        highlightKeywords: fallbackKeywords
      }
    };
  });

  return { ...context, visuals };
}
