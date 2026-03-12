import { normalizeContentMode, type ConversionRequest } from "@/lib/types/skills";
import { normalizeLanguage } from "@/lib/i18n/languages";
import { resolveInputContent } from "@/lib/content/resolve-input";

export async function skillInputProcessor(request: ConversionRequest): Promise<ConversionRequest> {
  const resolved = await resolveInputContent(request.inputText);
  const normalizedLanguage = normalizeLanguage(request.outputLanguage);

  return {
    ...request,
    contentMode: normalizeContentMode(request.contentMode),
    outputLanguage: normalizedLanguage,
    inputText: resolved.content,
    sourceType: resolved.sourceType,
    sourceUrl: resolved.sourceUrl,
    sourceTitle: resolved.sourceTitle
  };
}
