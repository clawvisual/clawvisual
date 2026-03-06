import { appConfig } from "@/lib/config";
import { recordUsageFromPayload } from "@/lib/llm/usage-tracker";

const TITLE_SUFFIX_PATTERNS: RegExp[] = [
  /\s*[-|｜]\s*[^-|｜]{1,24}(?:网|官网|首页|资讯|新闻|频道|博客|blog|news)\s*$/i,
  /\s*[-|｜]\s*[a-z0-9.-]+\.(?:com|cn|net|org|io|co|app|ai)\s*$/i,
  /\s*[-|｜]\s*(?:official\s+site|homepage|home)\s*$/i
];

const MAX_CONTENT_LENGTH = 20000;
type InputType = "text" | "url" | "mixed";

type InputClassification = {
  type: InputType;
  urls: string[];
  text: string;
};

const URL_PATTERN = /(https?:\/\/[^\s)]+|www\.[^\s)]+)/gi;

function cleanText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function normalizeMultilineText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim().replace(/[),.;]+$/, "");
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  if (trimmed.startsWith("www.")) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

function uniqueUrls(urls: string[]): string[] {
  return Array.from(new Set(urls.map(normalizeUrl).filter(Boolean)));
}

function extractUrls(input: string): string[] {
  const found = input.match(URL_PATTERN) ?? [];
  return uniqueUrls(found);
}

function removeUrls(input: string): string {
  return cleanText(input.replace(URL_PATTERN, " "));
}

function toClassificationByHeuristic(input: string): InputClassification {
  const urls = extractUrls(input);
  const text = removeUrls(input);

  if (!urls.length) {
    return { type: "text", urls: [], text: cleanText(input) };
  }

  if (text.length > 20) {
    return { type: "mixed", urls, text };
  }

  return { type: "url", urls, text: "" };
}

function stripHtml(html: string): string {
  const withoutScript = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ");

  const text = withoutScript
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  return cleanText(text);
}

function cleanTitleCandidate(rawTitle: string): string {
  let title = cleanText(rawTitle)
    .replace(/^#+\s*/, "")
    .replace(/[`*_]/g, "");

  for (const pattern of TITLE_SUFFIX_PATTERNS) {
    title = title.replace(pattern, "").trim();
  }

  return title;
}

function extractTitleFromHtml(html: string): string | undefined {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (!titleMatch) return undefined;

  const title = cleanTitleCandidate(titleMatch[1]);
  if (title.length >= 8 && title.length <= 140) {
    return title;
  }

  return undefined;
}

function extractReadableBodyFromJina(raw: string): string {
  const normalized = normalizeMultilineText(raw);
  const lines = normalized.split("\n");

  const markdownContentIndex = lines.findIndex((line) => /^Markdown Content:?$/i.test(line.trim()));
  const bodyLines = (markdownContentIndex >= 0 ? lines.slice(markdownContentIndex + 1) : lines).map((line) =>
    line
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );

  const NOISE_PATTERNS = [
    /^Title:\s*/i,
    /^Page Title:\s*/i,
    /^URL Source:\s*/i,
    /^URL:\s*/i,
    /^Published Time:\s*/i,
    /^Domain:\s*/i,
    /^Image:\s*/i,
    /^Warning:\s*/i,
    /^[=-]{3,}$/,
    /^[_*`~|]+$/,
    /javascript:/i,
    /^(关注|热搜词|相关文章|更多|首页)\s*$/i,
    /^(本文来自|作者[:：]|题图来自)/i
  ];

  const isNoiseLine = (line: string): boolean => {
    if (!line) return true;
    if (line.length < 6) return true;
    if (NOISE_PATTERNS.some((pattern) => pattern.test(line))) return true;
    return false;
  };

  const nonNoiseLines = bodyLines.filter((line) => !isNoiseLine(line));
  return cleanText(nonNoiseLines.join("\n"));
}

function tryExtractTitle(text: string): string | undefined {
  const lines = normalizeMultilineText(text).split("\n").map((line) => cleanText(line));

  const pageTitleLine = lines.find((line) => line.startsWith("Page Title:"));
  if (pageTitleLine) {
    const title = cleanTitleCandidate(pageTitleLine.replace(/^Page Title:\s*/, ""));
    if (title.length >= 8 && title.length <= 140) return title;
  }

  const jinaTitle = lines.find((line) => line.startsWith("Title:"));
  if (jinaTitle) {
    const title = cleanTitleCandidate(jinaTitle.replace(/^Title:\s*/, ""));
    if (title.length >= 8 && title.length <= 140) return title;
  }

  const firstReadable = lines.find((line) => line.length >= 8 && line.length <= 140);
  if (!firstReadable) return undefined;

  const fallback = cleanTitleCandidate(firstReadable);
  return fallback.length >= 8 && fallback.length <= 140 ? fallback : undefined;
}

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function extractJsonPayload(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

async function classifyInputWithLlm(input: string): Promise<InputClassification | null> {
  if (!appConfig.llm.apiUrl) return null;

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (appConfig.llm.apiKey) {
    headers.Authorization = `Bearer ${appConfig.llm.apiKey}`;
  }

  const system = [
    "You classify user input for content automation.",
    "Return strict JSON only:",
    '{"type":"text|url|mixed","urls":["https://..."],"text":"..."}.',
    "type=url means mostly URL(s) without meaningful prose.",
    "type=mixed means prose + URL(s).",
    "text must not include URLs."
  ].join(" ");

  try {
    const response = await fetch(appConfig.llm.apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: appConfig.llm.model,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: input }
        ]
      }),
      cache: "no-store"
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      output_text?: string;
      usage?: unknown;
      model?: string;
    };
    recordUsageFromPayload({
      model: appConfig.llm.model,
      payload: data
    });

    const llmContent = data.choices?.[0]?.message?.content ?? data.output_text;
    if (!llmContent) return null;

    const parsed = safeJsonParse<Partial<InputClassification>>(extractJsonPayload(llmContent));
    if (!parsed) return null;

    const mergedUrls = uniqueUrls([
      ...extractUrls(input),
      ...(Array.isArray(parsed.urls) ? parsed.urls.map((url) => String(url)) : [])
    ]);

    const parsedType: InputType = parsed.type === "url" || parsed.type === "mixed" ? parsed.type : "text";
    const parsedText = typeof parsed.text === "string" ? cleanText(parsed.text) : "";
    const text = parsedText || removeUrls(input);

    if (!mergedUrls.length) {
      return { type: "text", urls: [], text: cleanText(input) };
    }

    if (parsedType === "url" && text.length > 20) {
      return { type: "mixed", urls: mergedUrls, text };
    }

    return { type: parsedType, urls: mergedUrls, text };
  } catch {
    return null;
  }
}

async function fetchMarkdownFromUrl(url: string): Promise<string> {
  try {
    const response = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        Accept: "text/plain",
        Authorization: `Bearer ${process.env.JINA_API_KEY}`
      },
      cache: "no-store"
    });

    if (!response.ok) throw new Error(`Jina error: ${response.status}`);
    return await response.text();
  } catch (error) {
    console.error("[Jina] Fetch failed:", error);
    return "";
  }
}

async function fetchFromJinaReader(url: string): Promise<{ text: string; title?: string } | null> {
  const raw = normalizeMultilineText(await fetchMarkdownFromUrl(url));
  if (!raw || raw.replace(/\s+/g, "").length < 200) return null;

  const text = extractReadableBodyFromJina(raw) || cleanText(raw);
  if (!text || text.length < 120) return null;

  return {
    text: text.slice(0, MAX_CONTENT_LENGTH),
    title: tryExtractTitle(raw)
  };
}

async function fetchFromOrigin(url: string): Promise<{ text: string; title?: string } | null> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (clawvisualAI Bot)"
      },
      cache: "no-store"
    });

    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") ?? "";
    const raw = await response.text();
    const text = contentType.includes("text/html") ? stripHtml(raw) : cleanText(raw);

    if (!text || text.length < 120) return null;

    return {
      text: text.slice(0, MAX_CONTENT_LENGTH),
      title: contentType.includes("text/html") ? extractTitleFromHtml(raw) : undefined
    };
  } catch {
    return null;
  }
}

export async function resolveInputContent(input: string): Promise<{
  content: string;
  sourceType: "url" | "text";
  sourceUrl?: string;
  sourceTitle?: string;
}> {
  const raw = normalizeMultilineText(input);
  const classified = (await classifyInputWithLlm(raw)) ?? toClassificationByHeuristic(raw);

  if (classified.type === "text" || classified.urls.length === 0) {
    return {
      content: cleanText(classified.text || raw).slice(0, MAX_CONTENT_LENGTH),
      sourceType: "text"
    };
  }

  const contentParts: string[] = [];
  let sourceTitle: string | undefined;

  if (classified.type === "mixed" && classified.text) {
    contentParts.push(classified.text);
  }

  for (const url of classified.urls) {
    const jinaResult = await fetchFromJinaReader(url);
    const originResult = jinaResult ? null : await fetchFromOrigin(url);
    const picked = jinaResult ?? originResult;

    if (!picked) continue;
    if (!sourceTitle) sourceTitle = picked.title;

    contentParts.push(`Source URL: ${url}\n${picked.text}`);
  }

  const merged = cleanText(contentParts.join("\n\n")).slice(0, MAX_CONTENT_LENGTH);
  if (!merged) {
    throw new Error("Failed to fetch readable content from URL. Check that the link is accessible, or paste the full article text directly.");
  }

  return {
    content: merged,
    sourceType: "url",
    sourceUrl: classified.urls[0],
    sourceTitle: sourceTitle ?? tryExtractTitle(merged)
  };
}
