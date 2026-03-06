import { callSkillLlmJson } from "@/lib/llm/skill-client";
import type { ConversionContext, ThemeTokens } from "@/lib/types/skills";

const presetMap: Record<string, ThemeTokens> = {
  corporate: {
    cssVariables: {
      "--vf-bg": "#0f172a",
      "--vf-primary": "#1d4ed8",
      "--vf-secondary": "#0ea5e9",
      "--vf-text": "#e2e8f0"
    }
  },
  business: {
    cssVariables: {
      "--vf-bg": "#111827",
      "--vf-primary": "#2563eb",
      "--vf-secondary": "#14b8a6",
      "--vf-text": "#e5e7eb"
    }
  },
  "data-viz": {
    cssVariables: {
      "--vf-bg": "#0b1020",
      "--vf-primary": "#0ea5e9",
      "--vf-secondary": "#22c55e",
      "--vf-text": "#dbeafe"
    }
  },
  lifestyle: {
    cssVariables: {
      "--vf-bg": "#1f2937",
      "--vf-primary": "#f59e0b",
      "--vf-secondary": "#fb7185",
      "--vf-text": "#fff7ed"
    }
  },
  "personal-growth": {
    cssVariables: {
      "--vf-bg": "#0f172a",
      "--vf-primary": "#f97316",
      "--vf-secondary": "#22c55e",
      "--vf-text": "#f8fafc"
    }
  },
  emotion: {
    cssVariables: {
      "--vf-bg": "#1f1530",
      "--vf-primary": "#fb7185",
      "--vf-secondary": "#f59e0b",
      "--vf-text": "#fff7f3"
    }
  },
  education: {
    cssVariables: {
      "--vf-bg": "#0b132b",
      "--vf-primary": "#38bdf8",
      "--vf-secondary": "#a3e635",
      "--vf-text": "#e0f2fe"
    }
  },
  "editorial-neutral": {
    cssVariables: {
      "--vf-bg": "#111827",
      "--vf-primary": "#60a5fa",
      "--vf-secondary": "#f59e0b",
      "--vf-text": "#f3f4f6"
    }
  },
  "tech-minimal": {
    cssVariables: {
      "--vf-bg": "#091322",
      "--vf-primary": "#22d3ee",
      "--vf-secondary": "#34d399",
      "--vf-text": "#e8f1ff"
    }
  },
  cyberpunk: {
    cssVariables: {
      "--vf-bg": "#12001f",
      "--vf-primary": "#ff00aa",
      "--vf-secondary": "#6dff00",
      "--vf-text": "#fff0ff"
    }
  },
  "retro-newspaper": {
    cssVariables: {
      "--vf-bg": "#f0e4cf",
      "--vf-primary": "#4a3a2a",
      "--vf-secondary": "#7d6449",
      "--vf-text": "#2c241b"
    }
  }
};

function fallbackTheme(context: ConversionContext): ThemeTokens {
  const fallback = presetMap["tech-minimal"];
  const presetKey = context.request.brand.stylePreset.toLowerCase();
  const preset = presetMap[presetKey] ?? fallback;

  const custom = context.request.brand.colorPalette;
  return custom?.length
    ? {
        cssVariables: {
          ...preset.cssVariables,
          "--vf-primary": custom[0] ?? preset.cssVariables["--vf-primary"],
          "--vf-secondary": custom[1] ?? preset.cssVariables["--vf-secondary"]
        }
      }
    : preset;
}

function isCssVarMap(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).every(([key, val]) => key.startsWith("--") && typeof val === "string" && val.length > 0);
}

export async function skill07StyleMapper(context: ConversionContext): Promise<ConversionContext> {
  const llmResult = await callSkillLlmJson<{ cssVariables?: Record<string, string> }>({
    skill: "styleMapper",
    input: {
      style_preset: context.request.brand.stylePreset,
      brand_palette: context.request.brand.colorPalette ?? [],
      brand_fonts: context.request.brand.fonts ?? []
    },
    outputSchemaHint:
      '{"cssVariables":{"--vf-bg":"#091322","--vf-primary":"#22d3ee","--vf-secondary":"#34d399","--vf-text":"#e8f1ff"}}',
    outputLanguage: context.request.outputLanguage
  });

  const theme = isCssVarMap(llmResult?.cssVariables)
    ? { cssVariables: llmResult.cssVariables }
    : fallbackTheme(context);

  return { ...context, theme };
}
