import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type HookMemoryItem = {
  topicKey: string;
  hook: string;
  avgScore: number;
  count: number;
  updatedAt: string;
};

type StyleMemoryItem = {
  topicKey: string;
  preset: string;
  tone: string;
  avgScore: number;
  count: number;
  updatedAt: string;
};

type MemoryStore = {
  hooks: HookMemoryItem[];
  styles: StyleMemoryItem[];
  updatedAt: string;
};

const MEMORY_DIR = join(process.cwd(), ".data");
const MEMORY_PATH = join(MEMORY_DIR, "style-hook-memory.json");

function nowIso(): string {
  return new Date().toISOString();
}

function compact(value: string, max = 120): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized;
}

function readStore(): MemoryStore {
  try {
    const raw = readFileSync(MEMORY_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<MemoryStore>;
    return {
      hooks: Array.isArray(parsed.hooks) ? parsed.hooks : [],
      styles: Array.isArray(parsed.styles) ? parsed.styles : [],
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : nowIso()
    };
  } catch {
    return {
      hooks: [],
      styles: [],
      updatedAt: nowIso()
    };
  }
}

function writeStore(store: MemoryStore): void {
  mkdirSync(MEMORY_DIR, { recursive: true });
  writeFileSync(MEMORY_PATH, JSON.stringify(store), "utf-8");
}

function toTopicKey(sourceTitle: string, sourceText: string): string {
  const basis = `${sourceTitle} ${sourceText}`.toLowerCase();
  const tokens = basis.match(/[a-z][a-z0-9-]{2,}|[\p{Script=Han}]{2,8}/gu) ?? [];
  const deduped = Array.from(new Set(tokens)).slice(0, 6);
  return deduped.join("|") || "general";
}

function topicOverlap(a: string, b: string): number {
  const left = new Set(a.split("|").filter(Boolean));
  const right = new Set(b.split("|").filter(Boolean));
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  return overlap / Math.max(left.size, right.size);
}

export function getStyleHookMemoryHints(params: {
  sourceTitle?: string;
  sourceText: string;
}): {
  hookHints: string[];
  styleHints: Array<{ preset: string; tone: string; confidence: number }>;
} {
  const store = readStore();
  const topicKey = toTopicKey(params.sourceTitle ?? "", params.sourceText);

  const hookHints = store.hooks
    .map((item) => ({ item, score: topicOverlap(item.topicKey, topicKey) * 0.6 + item.avgScore / 100 * 0.4 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((entry) => compact(entry.item.hook, 90));

  const styleHints = store.styles
    .map((item) => ({
      item,
      confidence: Math.round((topicOverlap(item.topicKey, topicKey) * 0.55 + item.avgScore / 100 * 0.45) * 100)
    }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3)
    .map((entry) => ({
      preset: entry.item.preset,
      tone: entry.item.tone,
      confidence: entry.confidence
    }));

  return {
    hookHints,
    styleHints
  };
}

export function recordStyleHookMemory(params: {
  sourceTitle?: string;
  sourceText: string;
  hook?: string;
  stylePreset?: string;
  tone?: string;
  score?: number;
}): void {
  const score = Number.isFinite(Number(params.score)) ? Math.max(0, Math.min(100, Math.round(Number(params.score)))) : 70;
  if (score < 60) return;

  const store = readStore();
  const topicKey = toTopicKey(params.sourceTitle ?? "", params.sourceText);

  const hook = compact(String(params.hook ?? ""), 90);
  if (hook) {
    const existing = store.hooks.find((item) => item.topicKey === topicKey && item.hook === hook);
    if (existing) {
      existing.avgScore = Math.round((existing.avgScore * existing.count + score) / (existing.count + 1));
      existing.count += 1;
      existing.updatedAt = nowIso();
    } else {
      store.hooks.push({
        topicKey,
        hook,
        avgScore: score,
        count: 1,
        updatedAt: nowIso()
      });
    }
  }

  const stylePreset = compact(String(params.stylePreset ?? ""), 40);
  const tone = compact(String(params.tone ?? ""), 24);
  if (stylePreset) {
    const existing = store.styles.find((item) => item.topicKey === topicKey && item.preset === stylePreset && item.tone === tone);
    if (existing) {
      existing.avgScore = Math.round((existing.avgScore * existing.count + score) / (existing.count + 1));
      existing.count += 1;
      existing.updatedAt = nowIso();
    } else {
      store.styles.push({
        topicKey,
        preset: stylePreset,
        tone,
        avgScore: score,
        count: 1,
        updatedAt: nowIso()
      });
    }
  }

  store.hooks = store.hooks
    .sort((a, b) => b.avgScore - a.avgScore)
    .slice(0, 200);
  store.styles = store.styles
    .sort((a, b) => b.avgScore - a.avgScore)
    .slice(0, 200);
  store.updatedAt = nowIso();

  writeStore(store);
}
