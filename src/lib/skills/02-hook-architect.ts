import { callSkillLlmJson } from "@/lib/llm/skill-client";
import { appConfig } from "@/lib/config";
import { getStyleHookMemoryHints } from "@/lib/memory/style-hook-memory";
import type { ConversionContext } from "@/lib/types/skills";

function fallbackHooks(topic: string): string[] {
  return [
    `Why most teams fail at this: ${topic.slice(0, 60)}`,
    "What if your current strategy is upside down?",
    "The fastest path to results nobody explains",
    "Steal this framework before your competitors do",
    "One shift that changes everything in 30 days"
  ];
}

const getHookObjective = (topic: string, target_count: number, styles: string[], language: string) => {
  return `Create ${target_count} high-impact headlines based on the topic: '${topic}'. 
    Apply these specific psychological frames: ${styles.join(', ')}.

    Logic for each style:
    - Controversy: Challenge a popular belief.
    - Question-based: Open a loop the reader MUST close.
    - Benefit-driven: Promise a massive result with zero effort.
    - Pattern-break: Use unexpected phrasing or juxtaposition.

    Constraints: Max 10-12 words per hook. No generic clickbait—must be grounded in the core points provided. 
    Language: ${language}.`;
};

export async function skill02HookArchitect(context: ConversionContext): Promise<ConversionContext> {
  const topic = context.request.sourceTitle ?? context.corePoints[0] ?? "your topic";
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
      target_count: 5,
      styles: ["controversy", "question-based", "benefit-driven", "pattern-break"],
      objective: getHookObjective(
        topic, 
        5, 
        ["controversy", "question-based", "benefit-driven", "pattern-break"], 
        context.request.outputLanguage
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
  const fallback = fallbackHooks(topic);
  const merged = Array.from(new Set([...hooks, ...memoryHints.hookHints, ...fallback])).slice(0, 5);

  return {
    ...context,
    hooks: merged
  };
}
