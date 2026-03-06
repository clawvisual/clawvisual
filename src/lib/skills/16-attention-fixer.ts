import {
  DEFAULT_NEGATIVE_PROMPT,
  NEGATIVE_PROMPT_WITH_TEXT_ON_IMAGE,
  generateNanoBananaImage
} from "@/lib/images/nano-banana";
import { shouldLockTextForOutputLanguage } from "@/lib/i18n/text-guard";
import type { AttentionAudit, ConversionContext } from "@/lib/types/skills";

function shouldFix(audit: AttentionAudit): boolean {
  if (audit.overlapRisk === "high") return true;
  if (audit.readabilityScore < 0.72) return true;
  if (audit.contrastScore < 0.74) return true;
  if (audit.index === 1 && (audit.hookStrength ?? 0.7) < 0.72) return true;
  return false;
}

function buildFixDirective(audit: AttentionAudit, isCover: boolean): string {
  const overlay = audit.action === "add-overlay" ? "Use stronger dark overlay behind potential text area." : "";
  const darken = audit.action === "darken-background" ? "Darken high-noise regions and reduce distracting highlights." : "";
  const coverRule = isCover
    ? "Cover must be instantly readable in feed and keep one dominant visual hook."
    : "Keep inner slide readability stable with clean negative space.";

  return [
    "Attention fix pass:",
    `readability_score=${audit.readabilityScore.toFixed(2)}, contrast_score=${audit.contrastScore.toFixed(2)}, overlap_risk=${audit.overlapRisk}.`,
    overlay,
    darken,
    coverRule,
    "Preserve original semantics and core metaphor while improving readability safety."
  ]
    .filter(Boolean)
    .join("\n");
}

export async function skill16AttentionFixer(context: ConversionContext): Promise<ConversionContext> {
  if (!context.audits.length || !context.assets.length) {
    return context;
  }

  const textOnImage = context.request.generationMode === "quote_slides";
  const aspectRatio = context.request.aspectRatios[0] ?? "4:5";

  const nextAssets = [...context.assets];
  const nextCompositions = [...context.compositions];

  for (const audit of context.audits) {
    if (!shouldFix(audit)) continue;

    const assetIndex = nextAssets.findIndex((item) => item.index === audit.index);
    if (assetIndex < 0) continue;

    const asset = nextAssets[assetIndex];
    const quote = context.storyboard.find((slide) => slide.index === audit.index)?.script ?? "";
    const lockedTexts =
      textOnImage && shouldLockTextForOutputLanguage(quote, context.request.outputLanguage) ? [quote] : [];
    const fixPrompt = `${asset.prompt}\n${buildFixDirective(audit, audit.index === 1)}`;

    const image = await generateNanoBananaImage({
      prompt: fixPrompt,
      aspectRatio,
      negativePrompt: textOnImage ? NEGATIVE_PROMPT_WITH_TEXT_ON_IMAGE : DEFAULT_NEGATIVE_PROMPT,
      seed: audit.index * 10000 + 7,
      textOnImage,
      lockedTexts
    });

    nextAssets[assetIndex] = {
      ...asset,
      prompt: fixPrompt,
      imageUrl: image.imageUrl
    };

    const compositionIndex = nextCompositions.findIndex((item) => item.index === audit.index);
    if (compositionIndex >= 0) {
      nextCompositions[compositionIndex] = {
        ...nextCompositions[compositionIndex],
        imageUrl: image.imageUrl
      };
    }
  }

  return {
    ...context,
    assets: nextAssets,
    compositions: nextCompositions
  };
}
