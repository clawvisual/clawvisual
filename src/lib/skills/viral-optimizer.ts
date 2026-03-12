import { callSkillLlmJson } from "@/lib/llm/skill-client";
import { appConfig } from "@/lib/config";
import type { ConversionContext } from "@/lib/types/skills";

function fallbackCTA(input: string): string {
  const text = input.toLowerCase();
  if (text.includes("strategy") || text.includes("framework")) {
    return "Save this framework and send it to your team.";
  }
  if (text.includes("data") || text.includes("metric")) {
    return "Comment DATA and I will share the full benchmark.";
  }
  return "Save for later and tag a friend who needs this.";
}

function fallbackCaption(corePoints: string[], cta: string): string {
  const summary = corePoints.slice(0, 3).join(" ");
  return `${summary}\n\n${cta}`.trim();
}

function fallbackHashtags(input: string): string[] {
  const text = input.toLowerCase();
  if (text.includes("ai")) {
    return ["#AI", "#Productivity", "#ContentStrategy", "#Marketing", "#CreatorEconomy", "#Automation"];
  }
  if (text.includes("startup")) {
    return ["#Startup", "#Growth", "#Founders", "#Execution", "#Business", "#BuildInPublic"];
  }
  return ["#Productivity", "#SelfImprovement", "#Learning", "#ContentCreation", "#Mindset", "#CareerGrowth"];
}

function normalizeTag(raw: string): string {
  const cleaned = String(raw)
    .trim()
    .replace(/^#+/, "")
    .replace(/[^\p{L}\p{N}_-]+/gu, "");
  return cleaned ? `#${cleaned}` : "";
}

function scoreTag(params: {
  tag: string;
  trendScore: number;
  corpus: string;
  cooccurTokens: Map<string, number>;
}): number {
  const token = params.tag.replace(/^#/, "").toLowerCase();
  const semantic = params.corpus.includes(token) ? 82 : token.length >= 8 ? 66 : 58;
  const cooccur = Math.min(100, 48 + (params.cooccurTokens.get(token) ?? 0) * 14);
  const trendWeight = 0.55;
  const semanticWeight = 0.3;
  const cooccurWeight = 1 - trendWeight - semanticWeight;
  return Math.round(params.trendScore * trendWeight + semantic * semanticWeight + cooccur * cooccurWeight);
}

function rankHashtags(context: ConversionContext, llmTags: string[]): string[] {
  const trendMap = new Map(
    context.trendSignals.map((item) => [normalizeTag(item.tag).toLowerCase(), Math.max(40, Math.min(100, item.score))] as const)
  );

  const corpus = [context.request.sourceTitle, context.request.inputText, ...context.corePoints]
    .join(" ")
    .toLowerCase();
  const cooccurTokens = new Map<string, number>();
  for (const trend of context.trendSignals) {
    const token = trend.tag.toLowerCase();
    cooccurTokens.set(token, (cooccurTokens.get(token) ?? 0) + 1);
  }

  const candidates = Array.from(
    new Set([
      ...llmTags.map((tag) => normalizeTag(tag)),
      ...context.trendSignals.map((item) => normalizeTag(item.tag)),
      ...fallbackHashtags(context.request.inputText).map((tag) => normalizeTag(tag))
    ])
  ).filter(Boolean);

  return candidates
    .map((tag) => ({
      tag,
      score: scoreTag({
        tag,
        trendScore: trendMap.get(tag.toLowerCase()) ?? 60,
        corpus,
        cooccurTokens
      })
    }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.tag)
    .slice(0, 5);
}

export async function skillViralOptimizer(context: ConversionContext): Promise<ConversionContext> {
  const llmResult = await callSkillLlmJson<{ cta?: string; caption?: string; hashtags?: string[] }>({
    skill: "viralOptimizer",
    input: {
      hooks: context.hooks,
      core_points: context.corePoints,
      trend_signals: context.trendSignals,
      source_evidence: context.sourceEvidence.map((item) => ({
        title: item.title,
        credibility_score: item.credibilityScore
      })),
      tone: context.request.tone,
      source_title: context.request.sourceTitle,
      mode: context.request.generationMode,
      content_mode: context.request.contentMode,
      requirement:
        "Generate CTA plus a short social caption and 1-5 hashtags. Prioritize semantic relevance and retention. Hashtags must start with #."
    },
    outputSchemaHint:
      '{"cta":"Save for later and tag a friend.","caption":"...","hashtags":["#AI","#Productivity","#Growth"]}',
    outputLanguage: context.request.outputLanguage,
    fallbackModels: [appConfig.llm.copyFallbackModel]
  });

  const cta = String(llmResult?.cta ?? "").trim();
  const caption = String(llmResult?.caption ?? "").trim();
  const rankedHashtags = rankHashtags(context, llmResult?.hashtags ?? []);
  const fallbackCta = fallbackCTA(context.request.inputText);
  const preferExistingCaption = context.caption.replace(/\s+/g, " ").trim();
  const preferExistingHashtags = (context.hashtags ?? []).filter(Boolean);

  return {
    ...context,
    cta: cta || fallbackCta,
    caption: preferExistingCaption || caption || fallbackCaption(context.corePoints, cta || fallbackCta),
    hashtags: preferExistingHashtags.length ? preferExistingHashtags.slice(0, 5) : rankedHashtags
  };
}
