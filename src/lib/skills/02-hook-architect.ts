import { callSkillLlmJson } from "@/lib/llm/skill-client";
import { appConfig } from "@/lib/config";
import { getStyleHookMemoryHints } from "@/lib/memory/style-hook-memory";
import type { ConversionContext } from "@/lib/types/skills";

function fallbackHooks(topic: string, mode: ConversionContext["request"]["contentMode"]): string[] {
  if (mode === "product_marketing") {
    return [
      `Why this product solves ${topic.slice(0, 40)}`,
      "Stop wasting budget on the wrong approach",
      "The offer people click before they overthink",
      "One product angle that converts faster",
      "Turn curiosity into action in one swipe"
    ];
  }

  if (mode === "trend_hotspot") {
    return [
      `Hot take: ${topic.slice(0, 56)}`,
      "This trend matters more than it looks",
      "Everyone is missing the second-order effect",
      "What happens next if this keeps growing",
      "Use this angle before the timeline moves on"
    ];
  }

  return [
    `Core idea in one glance: ${topic.slice(0, 60)}`,
    "A practical framework you can apply this week",
    "The shortest path from signal to action",
    "Use this playbook before the next planning cycle",
    "One change that compounds over time"
  ];
}

const getStyleFrames = (mode: ConversionContext["request"]["contentMode"]): string[] => {
  if (mode === "product_marketing") {
    return ["benefit-driven", "urgency", "problem-solution", "social-proof"];
  }
  if (mode === "trend_hotspot") {
    return ["controversy", "contrarian", "prediction", "question-based"];
  }
  return ["clarity-first", "question-based", "benefit-driven", "pattern-break"];
};

const getHookObjective = (
  topic: string,
  target_count: number,
  styles: string[],
  language: string,
  mode: ConversionContext["request"]["contentMode"]
) => {
  const modeGoal =
    mode === "product_marketing"
      ? "Prioritize conversion intent and action."
      : mode === "trend_hotspot"
        ? "Prioritize timeliness, opinion, and shareability."
        : "Prioritize information clarity and memorability.";

  return `Create ${target_count} high-impact headlines based on the topic: '${topic}'.
    Apply these specific psychological frames: ${styles.join(', ')}.

    Logic for each style:
    - Controversy: Challenge a popular belief.
    - Question-based: Open a loop the reader MUST close.
    - Benefit-driven: Promise a massive result with zero effort.
    - Pattern-break: Use unexpected phrasing or juxtaposition.
    - Urgency: Signal why action should happen now.
    - Problem-solution: Make pain concrete, then show the path out.
    - Social-proof: Imply validated outcomes or trusted momentum.
    - Contrarian: Go against the default timeline narrative.
    - Prediction: State what is likely to happen next.
    - Clarity-first: Make the core thesis obvious in one read.

    Constraints: Max 10-12 words per hook. No generic clickbait—must be grounded in the core points provided.
    Mode goal: ${modeGoal}
    Language: ${language}.`;
};

export async function skill02HookArchitect(context: ConversionContext): Promise<ConversionContext> {
  const topic = context.request.sourceTitle ?? context.corePoints[0] ?? "your topic";
  const styleFrames = getStyleFrames(context.request.contentMode);
  const memoryHints = getStyleHookMemoryHints({
    sourceTitle: context.request.sourceTitle,
    sourceText: context.request.inputText
  });

  const llmResult = await callSkillLlmJson<{ hooks?: string[] }>({
    skill: "hookArchitect",
    input: {
      topic,
      core_points: context.corePoints,
      memory_hook_hints: memoryHints.hookHints,
      language: context.request.outputLanguage,
      content_mode: context.request.contentMode,
      target_count: 5,
      styles: styleFrames,
      objective: getHookObjective(
        topic, 
        5, 
        styleFrames,
        context.request.outputLanguage,
        context.request.contentMode
      )
    },
    outputSchemaHint: '{"hooks": ["hook1", "hook2", "hook3"]}',
    outputLanguage: context.request.outputLanguage,
    fallbackModels: [appConfig.llm.copyFallbackModel]
  });

  const hooks = (llmResult?.hooks ?? [])
    .map((hook) => String(hook).trim())
    .filter(Boolean)
    .slice(0, 5);
  const fallback = fallbackHooks(topic, context.request.contentMode);
  // Keep current-input fallbacks ahead of memory hints so prior successful hooks
  // never override the active topic when LLM output is missing or low quality.
  const merged = Array.from(new Set([...hooks, ...fallback, ...memoryHints.hookHints])).slice(0, 5);

  return {
    ...context,
    hooks: merged
  };
}
