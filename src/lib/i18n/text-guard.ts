const LANGUAGES_ALLOW_HAN = new Set(["zh", "ja"]);

function primaryLanguageCode(language: string): string {
  return String(language ?? "").trim().toLowerCase().split("-")[0] ?? "";
}

export function containsHanScript(text: string): boolean {
  return /[\p{Script=Han}]/u.test(String(text ?? ""));
}

export function targetLanguageDisallowsHan(outputLanguage: string): boolean {
  const primary = primaryLanguageCode(outputLanguage);
  if (!primary) return true;
  return !LANGUAGES_ALLOW_HAN.has(primary);
}

export function hasUnexpectedHan(text: string, outputLanguage: string): boolean {
  return targetLanguageDisallowsHan(outputLanguage) && containsHanScript(text);
}

export function listHasUnexpectedHan(values: string[], outputLanguage: string): boolean {
  if (!Array.isArray(values) || !values.length) return false;
  return values.some((value) => hasUnexpectedHan(value, outputLanguage));
}

export function shouldLockTextForOutputLanguage(text: string, outputLanguage: string): boolean {
  const normalized = String(text ?? "").trim();
  if (!normalized) return false;
  return !hasUnexpectedHan(normalized, outputLanguage);
}

export function filterLockedTextsForOutputLanguage(values: string[], outputLanguage: string): string[] {
  if (!Array.isArray(values) || !values.length) return [];
  return values
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .filter((value) => shouldLockTextForOutputLanguage(value, outputLanguage));
}
