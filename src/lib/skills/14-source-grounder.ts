import { callGenericLlmJson } from "@/lib/llm/skill-client";
import { extractInputUrlEvidence, gatherEvidenceFromQueries } from "@/lib/mcp/source-intel";
import type { ConversionContext, SourceEvidence } from "@/lib/types/skills";

function compact(value: string, max = 240): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized;
}

function buildQueries(context: ConversionContext): string[] {
  const topic = context.request.sourceTitle || context.request.inputText.slice(0, 120);
  const core = context.corePoints.slice(0, 3);
  return Array.from(new Set([
    `${topic} key claims analysis`,
    `${topic} market data latest`,
    ...core.map((point) => `${point} source verification`)
  ].map((item) => compact(item, 120).trim()).filter((item) => item.length >= 8)));
}

function hostCredibility(url: string): number {
  const host = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();

  if (!host) return 58;
  if (/(\.gov|\.edu|who\.int|oecd\.org|worldbank\.org|imf\.org)$/i.test(host)) return 92;
  if (/(reuters\.com|bloomberg\.com|ft\.com|wsj\.com|economist\.com|nytimes\.com)$/i.test(host)) return 88;
  if (/(wikipedia\.org|investopedia\.com|statista\.com)$/i.test(host)) return 78;
  return 66;
}

function fallbackReason(excerpt: string): string {
  if (excerpt.length > 120) return "contains concrete context relevant to core claims";
  return "supports topic context but needs manual check for numbers";
}

function normalizeProvider(value: string): SourceEvidence["provider"] {
  if (value === "input") return "input";
  if (value === "tavily") return "tavily";
  if (value === "serper") return "serper";
  return "fallback";
}

export async function skill14SourceGrounder(context: ConversionContext): Promise<ConversionContext> {
  const queries = buildQueries(context);
  const [external, inputUrls] = await Promise.all([
    gatherEvidenceFromQueries(queries),
    Promise.resolve(extractInputUrlEvidence(context.request.inputText))
  ]);

  const base = [...inputUrls, ...external].slice(0, 10);
  if (!base.length) {
    return {
      ...context,
      sourceEvidence: context.request.sourceUrl
        ? [{
            url: context.request.sourceUrl,
            title: context.request.sourceTitle || "Input source",
            excerpt: compact(context.request.inputText, 220),
            credibilityScore: hostCredibility(context.request.sourceUrl),
            provider: "fallback",
            reason: "using input source only because external retrieval returned no result"
          }]
        : []
    };
  }

  const llmSelection = await callGenericLlmJson<{
    evidence?: Array<{
      url?: string;
      title?: string;
      excerpt?: string;
      credibility_score?: number;
      reason?: string;
    }>;
  }>({
    instruction: [
      "Rank source evidence for factual grounding of social-carousel content.",
      "Keep only the most relevant 3-6 items.",
      "Prefer authoritative sources and concise excerpts.",
      "Return strict JSON only."
    ].join(" "),
    input: {
      source_title: context.request.sourceTitle,
      source_url: context.request.sourceUrl,
      core_points: context.corePoints,
      candidates: base
    },
    outputSchemaHint:
      '{"evidence":[{"url":"https://...","title":"...","excerpt":"...","credibility_score":86,"reason":"..."}]}',
    outputLanguage: context.request.outputLanguage,
    temperature: 0.1
  });

  const fromLlm = (llmSelection?.evidence ?? [])
    .map((item) => {
      const url = String(item.url ?? "").trim();
      if (!url) return null;
      const matched = base.find((candidate) => candidate.url === url);
      const credibility = Number(item.credibility_score);
      const provider = matched?.provider ?? "fallback";
      const evidence: SourceEvidence = {
        url,
        title: compact(String(item.title ?? matched?.title ?? "Source"), 120),
        excerpt: compact(String(item.excerpt ?? matched?.excerpt ?? ""), 260),
        credibilityScore: Number.isFinite(credibility)
          ? Math.max(0, Math.min(100, Math.round(credibility)))
          : hostCredibility(url),
        provider: normalizeProvider(provider),
        reason: compact(String(item.reason ?? matched?.excerpt ?? fallbackReason(String(item.excerpt ?? ""))), 160)
      };
      return evidence;
    })
    .filter((item): item is SourceEvidence => Boolean(item))
    .slice(0, 6);

  const selected = fromLlm.length
    ? fromLlm
    : base.slice(0, 5).map((item) => ({
        url: item.url,
        title: item.title,
        excerpt: item.excerpt,
        credibilityScore: hostCredibility(item.url),
        provider: normalizeProvider(item.provider),
        reason: fallbackReason(item.excerpt)
      }));

  return {
    ...context,
    sourceEvidence: selected
  };
}
