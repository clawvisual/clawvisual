import { appConfig } from "@/lib/config";
import { PROMPTS, buildPromptHeader } from "@/lib/prompts/index";
import { recordUsageFromPayload } from "@/lib/llm/usage-tracker";

type SkillPromptName = keyof typeof PROMPTS;

type ChatResponse = {
  choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string }> }>;
  usage?: unknown;
  model?: string;
};

type LlmCallParams = {
  systemPrompt: string;
  input: unknown;
  temperature?: number;
  model?: string;
  fallbackModels?: string[];
};

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(extractJson(raw)) as T;
  } catch {
    return null;
  }
}

function extractText(payload: ChatResponse): string {
  const choiceContent = payload.choices?.[0]?.message?.content;
  return (
    (typeof choiceContent === "string"
      ? choiceContent
      : choiceContent?.map((part) => part.text ?? "").join("")) ||
    payload.output_text ||
    payload.output?.[0]?.content?.map((part) => part.text ?? "").join("") ||
    ""
  );
}

function normalizeModels(primary?: string, fallbacks?: string[]): string[] {
  const merged = [primary || appConfig.llm.model, ...(fallbacks ?? [])]
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
  return Array.from(new Set(merged));
}

function createAbortTimeout(timeoutMs: number): { controller: AbortController; cleanup: () => void } | null {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    controller,
    cleanup: () => clearTimeout(timer)
  };
}

async function callLlmJson<T>(params: LlmCallParams): Promise<T | null> {
  if (!appConfig.llm.apiUrl) {
    return null;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (appConfig.llm.apiKey) {
    headers.Authorization = `Bearer ${appConfig.llm.apiKey}`;
  }

  const models = normalizeModels(params.model, params.fallbackModels);
  for (const model of models) {
    const timeout = createAbortTimeout(appConfig.llm.timeoutMs);
    try {
      const response = await fetch(appConfig.llm.apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          temperature: params.temperature ?? 0.2,
          messages: [
            { role: "system", content: params.systemPrompt },
            { role: "user", content: JSON.stringify(params.input) }
          ]
        }),
        cache: "no-store",
        signal: timeout?.controller.signal
      });

      if (!response.ok) {
        continue;
      }

      const payload = (await response.json()) as ChatResponse;
      recordUsageFromPayload({
        model,
        payload
      });
      const content = extractText(payload);
      if (!content) {
        continue;
      }

      const parsed = safeParse<T>(content);
      if (parsed) {
        return parsed;
      }
    } catch {
      continue;
    } finally {
      timeout?.cleanup();
    }
  }

  return null;
}

export async function callSkillLlmJson<T>(params: {
  skill: SkillPromptName;
  input: unknown;
  outputSchemaHint: string;
  outputLanguage?: string;
  temperature?: number;
  model?: string;
  fallbackModels?: string[];
}): Promise<T | null> {
  const systemPrompt = [
    buildPromptHeader(params.skill),
    `All textual output must be written in language code "${params.outputLanguage ?? "en"}".`,
    "Return strict JSON only. No markdown. No prose.",
    `JSON schema hint: ${params.outputSchemaHint}`
  ].join(" ");

  return callLlmJson<T>({
    systemPrompt,
    input: params.input,
    temperature: params.temperature,
    model: params.model,
    fallbackModels: params.fallbackModels
  });
}

export async function callGenericLlmJson<T>(params: {
  instruction: string;
  input: unknown;
  outputSchemaHint: string;
  outputLanguage?: string;
  temperature?: number;
  model?: string;
  fallbackModels?: string[];
}): Promise<T | null> {
  const systemPrompt = [
    params.instruction,
    `All textual output must be written in language code "${params.outputLanguage ?? "en"}".`,
    "Return strict JSON only. No markdown. No prose.",
    `JSON schema hint: ${params.outputSchemaHint}`
  ].join(" ");

  return callLlmJson<T>({
    systemPrompt,
    input: params.input,
    temperature: params.temperature,
    model: params.model,
    fallbackModels: params.fallbackModels
  });
}
