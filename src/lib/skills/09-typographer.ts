import type { ConversionContext } from "@/lib/types/skills";

export async function skill09Typographer(context: ConversionContext): Promise<ConversionContext> {
  const isQuoteMode = context.request.generationMode === "quote_slides";
  const compositions = context.visuals.map((visual) => {
    const asset = context.assets.find((item) => item.index === visual.index);
    const story = context.storyboard.find((item) => item.index === visual.index);
    const script = isQuoteMode ? story?.script || visual.hierarchy.body : visual.hierarchy.body;
    return {
      index: visual.index,
      imageUrl: asset?.imageUrl ?? "",
      script,
      layout: visual.layout,
      renderPayload: {
        h1: visual.hierarchy.heading,
        h2: visual.hierarchy.subheading,
        body: script
      }
    };
  });

  return { ...context, compositions };
}
