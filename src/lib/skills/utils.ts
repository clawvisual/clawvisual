export function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function splitSentences(input: string): string[] {
  const cleaned = normalizeWhitespace(input);
  return cleaned
    .split(/(?<=[.!?。！？])\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function trimToMaxCharsNoEllipsis(input: string, maxChars: number): string {
  const normalized = normalizeWhitespace(input);
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    let built = "";
    for (const word of words) {
      const candidate = built ? `${built} ${word}` : word;
      if (candidate.length > maxChars) break;
      built = candidate;
    }
    if (built) return built.trim();
  }

  return normalized.slice(0, Math.max(0, maxChars)).trim();
}

export function pickKeywords(input: string, count: number): string[] {
  const words = input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 4)
    .slice(0, 40);

  return unique(words).slice(0, count);
}
