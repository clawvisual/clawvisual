import type { ConversionContext } from "@/lib/types/skills";

export async function skill10AutoResizer(context: ConversionContext): Promise<ConversionContext> {
  const resizedOutputs = context.request.aspectRatios.flatMap((ratio) =>
    context.compositions.map((composition) => ({
      ratio,
      index: composition.index,
      imageUrl: `${composition.imageUrl}?ratio=${encodeURIComponent(ratio)}`
    }))
  );

  return { ...context, resizedOutputs };
}
