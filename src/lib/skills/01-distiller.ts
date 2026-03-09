import { callSkillLlmJson } from "@/lib/llm/skill-client";
import { appConfig } from "@/lib/config";
import { clampNumber } from "@/lib/skills/utils";
import { splitSentences } from "@/lib/skills/utils";
import type { ConversionContext } from "@/lib/types/skills";

function sanitizeSentence(sentence: string): string {
  return sentence
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNoiseSentence(sentence: string): boolean {
  const value = sanitizeSentence(sentence);
  if (!value) return true;
  if (value.length < 12) return true;
  if (/^(Title|URL|URL Source|Published Time|Domain|Image):/i.test(value)) return true;
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(value)) return true;
  if (/^(来源|作者[:：]|责任编辑|发布时间)/.test(value)) return true;
  if (/本文来自|题图来自|热搜词|关注\b/.test(value)) return true;
  if (/^(首页|更多|相关文章)$/.test(value)) return true;
  return false;
}

function fallbackDistill(inputText: string, target: number): string[] {
  const sentences = splitSentences(inputText)
    .map(sanitizeSentence)
    .filter((sentence) => !isNoiseSentence(sentence));

  if (sentences.length) {
    return sentences
      .sort((a, b) => b.length - a.length)
      .slice(0, target);
  }

  return ["No valid input provided."];
}

export async function skill01Distiller(context: ConversionContext): Promise<ConversionContext> {
  const requestedSlides = Number.isFinite(context.request.targetSlides)
    ? clampNumber(Number(context.request.targetSlides), 1, 8)
    : 8;
  const inputChars = context.request.inputText.replace(/\s+/g, "").length;
  const estimatedByLength = clampNumber(Math.ceil(inputChars / 240), 1, 8);
  const target = clampNumber(Math.min(requestedSlides, estimatedByLength), 1, 8);

  const llmResult = await callSkillLlmJson<{ core_points?: string[]; corePoints?: string[] }>({
    skill: "distiller",
    input: {
      input_text: context.request.inputText,
      target_points: target,
      tone: context.request.tone,
      mode: context.request.generationMode,
      objective:
        context.request.generationMode === "quote_slides"
          ? "Extract the 'Minimum Viable Insight' (MVI) from the source. Transform the input into sharp, rhythmic punchlines. Eliminate all transitional phrases (e.g., 'In conclusion', 'Another point is'). Ensure each point has a high signal-to-noise ratio and provides enough 'narrative tension' to sustain a standalone slide."
          : "Distill source text into concise segmented summaries for slides."
    },
    outputSchemaHint: '{"core_points": ["point1", "point2"]}',
    outputLanguage: context.request.outputLanguage,
    fallbackModels: [appConfig.llm.copyFallbackModel]
  });

  const llmPoints = llmResult?.core_points ?? llmResult?.corePoints ?? [];
  const corePoints = llmPoints
    .map((point) => sanitizeSentence(String(point)))
    .filter((point) => point.length > 0)
    .slice(0, target);

  return {
    ...context,
    corePoints: corePoints.length ? corePoints : fallbackDistill(context.request.inputText, target)
  };
}
