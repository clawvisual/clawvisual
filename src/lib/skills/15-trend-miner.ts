import { callGenericLlmJson } from "@/lib/llm/skill-client";
import { gatherTrendingTags } from "@/lib/mcp/source-intel";
import type { ConversionContext, TrendSignal } from "@/lib/types/skills";

function compact(value: string, max = 120): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized;
}

function normalizeTag(raw: string): string {
  const cleaned = raw
    .replace(/^#+/, "")
    .replace(/[^\p{L}\p{N}_-]+/gu, "")
    .trim();
  return cleaned;
}

function fallbackTrendSignals(context: ConversionContext): TrendSignal[] {
  const text = [
    context.request.sourceTitle,
    ...context.corePoints,
    ...context.sourceEvidence.map((item) => item.title)
  ]
    .join(" ")
    .toLowerCase();

  const base = [
    "contentstrategy",
    "growth",
    "socialmedia",
    "marketing",
    "creator",
    "branding",
    "automation",
    "ai"
  ];

  const picks = base.filter((tag) => text.includes(tag.replace(/_/g, ""))).slice(0, 6);
  const tags = (picks.length ? picks : base.slice(0, 6)).map((tag, index) => ({
    tag,
    score: Math.max(52, 74 - index * 4),
    source: "fallback" as const,
    reason: "fallback topic relevance"
  }));

  return tags;
}

export async function skill15TrendMiner(context: ConversionContext): Promise<ConversionContext> {
  const fetched = await gatherTrendingTags({
    topic: context.request.inputText,
    corePoints: context.corePoints,
    sourceTitle: context.request.sourceTitle
  });

  const llmRanked = await callGenericLlmJson<{
    tags?: Array<{ tag?: string; score?: number; reason?: string }>;
  }>({
    instruction: [
      "Select 6-10 social tags for short-form carousel distribution.",
      "Balance trend momentum and semantic relevance to source.",
      "Avoid generic spam tags.",
      "Return strict JSON only."
    ].join(" "),
    input: {
      source_title: context.request.sourceTitle,
      core_points: context.corePoints,
      source_evidence: context.sourceEvidence.map((item) => ({
        title: item.title,
        credibility: item.credibilityScore
      })),
      fetched_trend_candidates: fetched
    },
    outputSchemaHint: '{"tags":[{"tag":"aiagents","score":83,"reason":"high relevance and current momentum"}]}',
    outputLanguage: context.request.outputLanguage,
    temperature: 0.2
  });

  const normalized = (llmRanked?.tags ?? [])
    .map((item) => {
      const tag = normalizeTag(String(item.tag ?? "").toLowerCase());
      const score = Number(item.score);
      if (!tag) return null;
      return {
        tag,
        score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 65,
        source: "llm" as const,
        reason: compact(String(item.reason ?? "topic fit and social share potential"), 110)
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 10);

  const trendSignals = normalized.length
    ? normalized
    : (fetched.length
        ? fetched.map((item) => ({
            tag: normalizeTag(item.tag.toLowerCase()),
            score: Math.max(0, Math.min(100, Math.round(item.score))),
            source: item.source,
            reason: compact(item.reason, 110)
          }))
        : fallbackTrendSignals(context)
      )
        .filter((item) => item.tag.length >= 2)
        .slice(0, 10);

  return {
    ...context,
    trendSignals
  };
}
