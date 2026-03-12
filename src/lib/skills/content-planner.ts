import { callSkillLlmJson } from "@/lib/llm/skill-client";
import { appConfig } from "@/lib/config";
import { clampNumber, splitSentences } from "@/lib/skills/utils";
import type { ConversionContext, SlideCard, SlideCardPlan, SlideScript } from "@/lib/types/skills";

type RawContentPlan = {
  post_title?: string;
  post_caption?: string;
  hashtags?: string[];
  slide_cards?: Array<Array<{
    title?: string;
    sub_title?: string;
    sentence?: string;
  }>>;
  slides?: Array<{
    index?: number;
    heading?: string;
    summary?: string;
    cards?: Array<{
      title?: string;
      sub_title?: string;
      sentence?: string;
    }>;
  }>;
};

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, max = 180): string {
  const normalized = compact(value);
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized;
}

function normalizeCardTitle(value: string, fallback: string): string {
  const normalized = compact(value || fallback);
  return truncate(normalized, 36) || fallback;
}

function normalizeCardSentence(value: string): string {
  const cleaned = compact(value)
    .replace(/\bLOCKED_TEXT(?:_\d+)?\b/gi, "")
    .replace(/\bTEXT_LOCK\b/gi, "");
  const normalized = compact(cleaned);
  if (!normalized) return "";
  return truncate(normalized, 160);
}

function splitIntoCandidateLines(value: string): string[] {
  return Array.from(new Set(splitSentences(value).map((item) => normalizeCardSentence(item)).filter(Boolean))).slice(0, 12);
}

function inferCardTitleFromSentence(sentence: string, index: number): string {
  const words = compact(sentence)
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3);

  if (!words.length) {
    return `Point ${index + 1}`;
  }

  const label = words.join(" ");

  return truncate(label, 28) || `Point ${index + 1}`;
}

function ensureLongformCardDensity(params: {
  slide: SlideCardPlan;
  sourceText: string;
  slideIndex: number;
}): SlideCardPlan {
  const { slide, sourceText, slideIndex } = params;
  const minCards = slideIndex === 1 ? 4 : 3;
  const maxCards = 5;
  if (slide.cards.length >= minCards) {
    return {
      ...slide,
      cards: slide.cards.slice(0, maxCards)
    };
  }

  const globalCandidates = splitSentences(sourceText)
    .map((item) => normalizeCardSentence(item))
    .filter(Boolean);
  const seedOffset = Math.max(0, (slideIndex - 1) * 3);
  const seededCandidates = globalCandidates.slice(seedOffset, seedOffset + 8);

  const localCandidates = [
    ...slide.cards.map((card) => card.sentence),
    slide.summary,
    ...splitIntoCandidateLines(slide.summary),
    ...seededCandidates
  ]
    .map((item) => normalizeCardSentence(item))
    .filter(Boolean);

  const deduped = Array.from(new Set(localCandidates));
  const nextCards: SlideCard[] = [...slide.cards];

  for (const sentence of deduped) {
    if (nextCards.length >= maxCards) break;
    const key = sentence.toLowerCase();
    if (nextCards.some((card) => card.sentence.toLowerCase() === key)) continue;
    nextCards.push({
      title: inferCardTitleFromSentence(sentence, nextCards.length),
      sentence
    });
  }

  if (!nextCards.length) {
    const fallbackSentence = normalizeCardSentence(slide.summary) || truncate(sourceText, 140);
    nextCards.push({
      title: "Core Insight",
      sentence: fallbackSentence
    });
  }

  return {
    ...slide,
    summary: slide.summary || nextCards.map((card) => card.sentence).slice(0, 2).join(" "),
    cards: nextCards.slice(0, maxCards)
  };
}

function normalizeHashtags(values: string[], fallbackText: string): string[] {
  const fromValues = values
    .map((item) => compact(String(item ?? "")))
    .map((item) => item.replace(/^#+/, ""))
    .map((item) => item.replace(/[^\p{L}\p{N}_-]+/gu, ""))
    .filter(Boolean)
    .map((item) => `#${item}`);

  if (fromValues.length) {
    return Array.from(new Set(fromValues)).slice(0, 5);
  }

  const lower = fallbackText.toLowerCase();
  if (lower.includes("ai")) return ["#AI", "#Automation", "#SocialMedia", "#Creator", "#Growth"];
  if (lower.includes("product") || lower.includes("marketing")) {
    return ["#ProductMarketing", "#Growth", "#Conversion", "#Brand", "#Content"];
  }
  return ["#Content", "#Carousel", "#Storytelling", "#Learning", "#Growth"];
}

function fallbackSlideCount(context: ConversionContext): number {
  if (Number.isFinite(context.request.targetSlides)) {
    return clampNumber(Number(context.request.targetSlides), 1, 8);
  }
  const chars = context.request.inputText.replace(/\s+/g, "").length;
  return clampNumber(Math.ceil(chars / 700), 1, 8);
}

function buildFallbackSlides(context: ConversionContext, count: number): SlideCardPlan[] {
  const sentences = splitSentences(context.request.inputText)
    .map((item) => normalizeCardSentence(item))
    .filter(Boolean);

  const safeCount = clampNumber(count, 1, 8);
  const result: SlideCardPlan[] = [];

  for (let i = 0; i < safeCount; i += 1) {
    const sentenceA = sentences[i * 2] || sentences[i] || truncate(context.request.inputText, 140);
    const sentenceB = sentences[i * 2 + 1] || "";

    const cards: SlideCard[] = [
      {
        title: i === 0 ? "Core Insight" : `Point ${i + 1}`,
        sentence: sentenceA
      }
    ];

    if (sentenceB && cards.length < 5) {
      cards.push({
        title: `Detail ${i + 1}`,
        sentence: sentenceB
      });
    }

    const summary = cards.map((card) => card.sentence).join(" ");

    result.push({
      index: i + 1,
      heading: i === 0 ? "Overview" : `Slide ${i + 1}`,
      summary,
      cards
    });
  }

  return result;
}

function normalizeSlides(context: ConversionContext, raw: RawContentPlan | null): SlideCardPlan[] {
  const requestedFixed = Number.isFinite(context.request.targetSlides)
    ? clampNumber(Number(context.request.targetSlides), 1, 8)
    : null;

  const slideCards = Array.isArray(raw?.slide_cards) ? raw?.slide_cards ?? [] : [];
  const ordered = (raw?.slides ?? [])
    .map((item, idx) => ({
      index: Number.isFinite(Number(item?.index)) ? Number(item?.index) : idx + 1,
      heading: compact(String(item?.heading ?? "")),
      summary: compact(String(item?.summary ?? "")),
      cards: Array.isArray(item?.cards)
        ? item.cards ?? []
        : Array.isArray(slideCards[idx])
          ? slideCards[idx] ?? []
          : []
    }))
    .sort((a, b) => a.index - b.index)
    .slice(0, 8);

  const normalized = ordered
    .map((slide, idx) => {
      const cards = slide.cards
        .map((card, cardIdx) => {
          const sentence = normalizeCardSentence(String(card?.sub_title ?? card?.sentence ?? ""));
          if (!sentence) return null;
          const fallbackTitle = cardIdx === 0 ? "Core" : `Card ${cardIdx + 1}`;
          return {
            title: normalizeCardTitle(String(card?.title ?? ""), fallbackTitle),
            sentence
          } satisfies SlideCard;
        })
        .filter((card): card is SlideCard => Boolean(card))
        .slice(0, 5);

      const summaryFromCards = cards.map((card) => card.sentence).join(" ");
      const summary = normalizeCardSentence(slide.summary) || truncate(summaryFromCards, 180);
      const heading = normalizeCardTitle(slide.heading, idx === 0 ? "Overview" : `Slide ${idx + 1}`);

      if (!cards.length) {
        const fallbackSentence = summary || truncate(context.request.inputText, 140);
        return {
          index: idx + 1,
          heading,
          summary: fallbackSentence,
          cards: [
            {
              title: "Core",
              sentence: fallbackSentence
            }
          ]
        } satisfies SlideCardPlan;
      }

      return {
        index: idx + 1,
        heading,
        summary: summary || truncate(summaryFromCards, 180),
        cards
      } satisfies SlideCardPlan;
    })
    .slice(0, 8);

  const desiredCount = requestedFixed ?? clampNumber(normalized.length || fallbackSlideCount(context), 1, 8);

  if (!normalized.length && slideCards.length) {
    const fromSlideCards = slideCards
      .map((cardGroup, idx) => {
        const cards = (cardGroup ?? [])
          .map((card, cardIdx) => {
            const sentence = normalizeCardSentence(String(card?.sub_title ?? card?.sentence ?? ""));
            if (!sentence) return null;
            return {
              title: normalizeCardTitle(String(card?.title ?? ""), cardIdx === 0 ? "Core" : `Card ${cardIdx + 1}`),
              sentence
            } satisfies SlideCard;
          })
          .filter((card): card is SlideCard => Boolean(card))
          .slice(0, 5);

        if (!cards.length) return null;
        return {
          index: idx + 1,
          heading: idx === 0 ? "Overview" : `Slide ${idx + 1}`,
          summary: cards.map((card) => card.sentence).join(" "),
          cards
        } satisfies SlideCardPlan;
      })
      .filter((item): item is SlideCardPlan => Boolean(item))
      .slice(0, 8);

    if (fromSlideCards.length) {
      const aligned = fromSlideCards.map((item, idx) => ({ ...item, index: idx + 1 }));
      return aligned.map((slide, idx) =>
        ensureLongformCardDensity({
          slide: { ...slide, index: idx + 1 },
          sourceText: context.request.inputText,
          slideIndex: idx + 1
        })
      );
    }
  }

  if (!normalized.length) {
    return buildFallbackSlides(context, desiredCount);
  }

  let adjusted = normalized;
  if (adjusted.length > desiredCount) {
    adjusted = adjusted.slice(0, desiredCount).map((item, idx) => ({ ...item, index: idx + 1 }));
  } else if (adjusted.length < desiredCount) {
    const fallback = buildFallbackSlides(context, desiredCount);
    const merged = [...adjusted];
    for (const item of fallback) {
      if (merged.length >= desiredCount) break;
      merged.push({ ...item, index: merged.length + 1 });
    }
    adjusted = merged.slice(0, desiredCount).map((item, idx) => ({ ...item, index: idx + 1 }));
  }

  const byMode = adjusted.map((slide, idx) =>
    ensureLongformCardDensity({
      slide: { ...slide, index: idx + 1 },
      sourceText: context.request.inputText,
      slideIndex: idx + 1
    })
  );

  return byMode.map((item, idx) => ({ ...item, index: idx + 1 }));
}

function buildStoryboardFromSlides(slides: SlideCardPlan[]): SlideScript[] {
  return slides.map((slide) => ({
    index: slide.index,
    script: truncate(compact([slide.heading, ...slide.cards.map((card) => card.sentence)].join(". ")), 260)
  }));
}

function pickCorePoints(slides: SlideCardPlan[]): string[] {
  const pool = slides.flatMap((slide) => [slide.summary, ...slide.cards.map((card) => card.sentence)])
    .map((item) => compact(item))
    .filter(Boolean);
  return Array.from(new Set(pool)).slice(0, 8);
}

export async function skillContentPlanner(context: ConversionContext): Promise<ConversionContext> {
  const requestedFixedSlides = Number.isFinite(context.request.targetSlides)
    ? clampNumber(Number(context.request.targetSlides), 1, 8)
    : null;

  const llmResult = await callSkillLlmJson<RawContentPlan>({
    skill: "contentPlanner",
    input: {
      source_text: context.request.inputText,
      source_title: context.request.sourceTitle,
      tone: context.request.tone,
      output_language: context.request.outputLanguage,
      content_mode: "longform_digest",
      target_slides: requestedFixedSlides ?? "auto",
      constraints: {
        slides_min: 1,
        slides_max: 8,
        fixed_slides_when_user_set: requestedFixedSlides,
        cards_per_slide_min: 3,
        cards_per_slide_max: 5,
        card_format: "title + sub_title(one complete sentence)",
        longform_density_rule: "for longform_digest, each slide should have 3-5 cards (cover prefers 4-5)",
        no_truncated_sentences: true,
        no_placeholder_tokens: true,
        hashtags_max: 5,
        caption_chars: "100-300 preferred"
      }
    },
    outputSchemaHint:
      '{"post_title":"...","post_caption":"...","hashtags":["#..."],"slide_cards":[[{"title":"...","sub_title":"..."}]],"slides":[{"index":1,"heading":"...","summary":"...","cards":[{"title":"...","sub_title":"..."}]}]}',
    outputLanguage: context.request.outputLanguage,
    fallbackModels: [appConfig.llm.copyFallbackModel]
  });

  const slideCardPlans = normalizeSlides(context, llmResult);
  const storyboard = buildStoryboardFromSlides(slideCardPlans);
  const corePoints = pickCorePoints(slideCardPlans);

  const postTitle = truncate(compact(String(llmResult?.post_title ?? "")), 90) || storyboard[0]?.script || "Core insight";
  const postCaption =
    truncate(compact(String(llmResult?.post_caption ?? "")), 320) ||
    truncate(slideCardPlans.slice(0, 2).map((slide) => slide.summary).join(" "), 280);
  const hashtags = normalizeHashtags(llmResult?.hashtags ?? [], context.request.inputText);

  return {
    ...context,
    hooks: postTitle ? [postTitle] : context.hooks,
    caption: postCaption,
    hashtags,
    corePoints,
    storyboard,
    slideCardPlans
  };
}
