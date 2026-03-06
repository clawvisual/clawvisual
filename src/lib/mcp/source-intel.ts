import { appConfig } from "@/lib/config";

export type EvidenceCandidate = {
  url: string;
  title: string;
  excerpt: string;
  provider: "tavily" | "serper" | "input" | "fallback";
  publishedAt?: string;
  score?: number;
};

type TavilyResult = {
  url?: string;
  title?: string;
  content?: string;
  published_date?: string;
  score?: number;
};

type SerperResult = {
  link?: string;
  title?: string;
  snippet?: string;
  date?: string;
  position?: number;
};

function compact(value: string, max = 320): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized;
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`;
  return "";
}

function dedupeEvidence(items: EvidenceCandidate[]): EvidenceCandidate[] {
  const map = new Map<string, EvidenceCandidate>();
  for (const item of items) {
    const url = normalizeUrl(item.url);
    if (!url) continue;
    if (!map.has(url)) {
      map.set(url, { ...item, url });
      continue;
    }

    const existing = map.get(url);
    if (!existing) continue;
    if ((item.score ?? 0) > (existing.score ?? 0)) {
      map.set(url, { ...item, url });
    }
  }

  return [...map.values()].slice(0, 12);
}

function normalizeHashtagSeed(value: string): string {
  return value
    .replace(/[#]/g, "")
    .replace(/[^\p{L}\p{N}_-]+/gu, "")
    .trim();
}

function createAbortTimeout(timeoutMs = 8000): { controller: AbortController; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    controller,
    cleanup: () => clearTimeout(timer)
  };
}

async function tavilySearch(query: string): Promise<EvidenceCandidate[]> {
  if (!appConfig.externalKeys.tavily) return [];

  const timeout = createAbortTimeout(8000);
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        api_key: appConfig.externalKeys.tavily,
        query,
        max_results: 6,
        include_answer: false,
        include_images: false
      }),
      cache: "no-store",
      signal: timeout.controller.signal
    });

    if (!response.ok) return [];

    const payload = (await response.json()) as { results?: TavilyResult[] };
    return (payload.results ?? [])
      .map((item) => ({
        url: String(item.url ?? "").trim(),
        title: compact(String(item.title ?? "").trim(), 120),
        excerpt: compact(String(item.content ?? "").trim(), 260),
        publishedAt: String(item.published_date ?? "").trim() || undefined,
        score: Number(item.score),
        provider: "tavily" as const
      }))
      .filter((item) => item.url && item.title && item.excerpt);
  } catch {
    return [];
  } finally {
    timeout.cleanup();
  }
}

async function serperSearch(query: string): Promise<EvidenceCandidate[]> {
  if (!appConfig.externalKeys.serper) return [];

  const timeout = createAbortTimeout(8000);
  try {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": appConfig.externalKeys.serper
      },
      body: JSON.stringify({ q: query, num: 8 }),
      cache: "no-store",
      signal: timeout.controller.signal
    });

    if (!response.ok) return [];
    const payload = (await response.json()) as { organic?: SerperResult[] };

    return (payload.organic ?? [])
      .map((item) => ({
        url: String(item.link ?? "").trim(),
        title: compact(String(item.title ?? "").trim(), 120),
        excerpt: compact(String(item.snippet ?? "").trim(), 260),
        publishedAt: String(item.date ?? "").trim() || undefined,
        score: Number.isFinite(Number(item.position)) ? Math.max(0, 1 - (Number(item.position) - 1) * 0.08) : undefined,
        provider: "serper" as const
      }))
      .filter((item) => item.url && item.title && item.excerpt);
  } catch {
    return [];
  } finally {
    timeout.cleanup();
  }
}

export function extractInputUrlEvidence(sourceText: string): EvidenceCandidate[] {
  const urls = Array.from(new Set(sourceText.match(/https?:\/\/\S+/gi) ?? []));
  return urls.slice(0, 4).map((url) => ({
    url,
    title: "Input referenced source",
    excerpt: compact(sourceText.replace(/\s+/g, " "), 220),
    provider: "input"
  }));
}

export async function gatherEvidenceFromQueries(queries: string[]): Promise<EvidenceCandidate[]> {
  const normalized = queries.map((item) => compact(item, 120)).filter((item) => item.length >= 6).slice(0, 3);
  if (!normalized.length) return [];

  const collected: EvidenceCandidate[] = [];
  for (const query of normalized) {
    const [tavily, serper] = await Promise.all([tavilySearch(query), serperSearch(query)]);
    collected.push(...tavily, ...serper);
  }

  return dedupeEvidence(collected);
}

export async function gatherTrendingTags(params: {
  topic: string;
  corePoints: string[];
  sourceTitle?: string;
}): Promise<Array<{ tag: string; score: number; source: "tavily" | "serper" | "fallback"; reason: string }>> {
  const seed = [params.sourceTitle, params.topic, ...params.corePoints.slice(0, 3)]
    .map((item) => compact(String(item ?? ""), 80))
    .filter(Boolean)
    .join(" ");

  const query = `social media trend keywords ${seed}`;
  const [tavily, serper] = await Promise.all([tavilySearch(query), serperSearch(query)]);
  const snippets = [...tavily, ...serper]
    .map((item) => `${item.title} ${item.excerpt}`)
    .join(" ")
    .toLowerCase();

  const tokens = (snippets.match(/[a-z][a-z0-9-]{2,}|[\p{Script=Han}]{2,8}/gu) ?? [])
    .map((item) => normalizeHashtagSeed(item.toLowerCase()))
    .filter(Boolean)
    .filter((item) => item.length >= 2 && item.length <= 24);

  const banned = new Set([
    "http",
    "https",
    "www",
    "com",
    "this",
    "that",
    "with",
    "from",
    "about",
    "social",
    "media",
    "trend",
    "trends"
  ]);

  const freq = new Map<string, number>();
  for (const token of tokens) {
    if (banned.has(token)) continue;
    freq.set(token, (freq.get(token) ?? 0) + 1);
  }

  const dominantSource: "tavily" | "serper" | "fallback" =
    tavily.length || serper.length ? (tavily.length >= serper.length ? "tavily" : "serper") : "fallback";

  const ranked = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([tag, count]) => ({
      tag,
      score: Math.min(100, 55 + count * 8),
      source: dominantSource,
      reason: count >= 3 ? "appears repeatedly in trend search snippets" : "related to topic context"
    }));

  if (ranked.length) return ranked;

  const fallbackSeeds = [params.sourceTitle, params.topic, ...params.corePoints]
    .join(" ")
    .match(/[a-z][a-z0-9-]{2,}|[\p{Script=Han}]{2,8}/gu) ?? [];

  const deduped = Array.from(new Set(fallbackSeeds.map((item) => normalizeHashtagSeed(item.toLowerCase())).filter(Boolean))).slice(0, 8);
  return deduped.map((tag, index) => ({
    tag,
    score: 62 - index * 3,
    source: "fallback" as const,
    reason: "derived from source topic keywords"
  }));
}
