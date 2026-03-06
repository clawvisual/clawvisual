export const LANGUAGE_LABELS = {
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  "en-US": "English",
  "ko-KR": "한국어",
  "ja-JP": "日本語",
  "vi-VN": "Tiếng Việt",
  "th-TH": "ไทย",
  "id-ID": "Indonesia",
  "de-DE": "Deutsch",
  "es-ES": "Español",
  "ru-RU": "Русский",
  "pt-BR": "Português",
  "fr-FR": "Français",
  "pl-PL": "Polski"
} as const;

export type SupportedLanguageCode = keyof typeof LANGUAGE_LABELS;

export const SUPPORTED_LANGUAGE_CODES = Object.keys(LANGUAGE_LABELS) as SupportedLanguageCode[];

export const DEFAULT_LANGUAGE: SupportedLanguageCode = "en-US";

const PRIMARY_LANGUAGE_FALLBACK: Record<string, SupportedLanguageCode> = {
  zh: "zh-CN",
  en: "en-US",
  ko: "ko-KR",
  ja: "ja-JP",
  vi: "vi-VN",
  th: "th-TH",
  id: "id-ID",
  de: "de-DE",
  es: "es-ES",
  ru: "ru-RU",
  pt: "pt-BR",
  fr: "fr-FR",
  pl: "pl-PL"
};

export function normalizeLanguage(input?: string | null): SupportedLanguageCode {
  if (!input) return DEFAULT_LANGUAGE;

  const normalized = input.trim();
  if (!normalized) return DEFAULT_LANGUAGE;

  const exact = SUPPORTED_LANGUAGE_CODES.find(
    (code) => code.toLowerCase() === normalized.toLowerCase()
  );
  if (exact) return exact;

  const primary = normalized.split("-")[0]?.toLowerCase();
  if (primary && PRIMARY_LANGUAGE_FALLBACK[primary]) {
    return PRIMARY_LANGUAGE_FALLBACK[primary];
  }

  return DEFAULT_LANGUAGE;
}

