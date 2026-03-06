import { callSkillLlmJson } from "@/lib/llm/skill-client";
import { getStyleHookMemoryHints } from "@/lib/memory/style-hook-memory";
import type { ConversionContext, VisualStyleProfile } from "@/lib/types/skills";

type VisualDomain = VisualStyleProfile["visualDomain"];

function compact(value: string, max = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized;
}

function fallbackDomainFromText(text: string): VisualDomain {
  const normalized = text.toLowerCase();
  if (/(investment|investor|finance|financial|fund|profit|cash flow|盈利|财务|商业|投资|公司|营收|估值)/i.test(normalized)) {
    return "business";
  }
  if (/(growth|habit|discipline|mindset|goal|self improvement|复盘|成长|习惯|自律|目标|效率)/i.test(normalized)) {
    return "personal-growth";
  }
  if (/(emotion|love|relationship|anxiety|healing|grief|empat|亲密|情绪|关系|焦虑|疗愈|沟通)/i.test(normalized)) {
    return "emotion";
  }
  if (/(learn|course|lesson|teacher|student|curriculum|教育|课程|学习|教学|知识点|考试)/i.test(normalized)) {
    return "education";
  }
  if (/(ai|agent|model|llm|automation|technology|tech|算法|模型|人工智能|科技)/i.test(normalized)) {
    return "tech";
  }
  if (/(data|report|chart|metric|kpi|benchmark|同比|环比|数据|图表|报告|指标)/i.test(normalized)) {
    return "data-viz";
  }
  if (/(fashion|lifestyle|travel|food|beauty|outfit|生活方式|时尚|美妆|旅行|餐饮)/i.test(normalized)) {
    return "lifestyle";
  }
  return "general";
}

function fallbackProfile(context: ConversionContext): VisualStyleProfile {
  const domain = fallbackDomainFromText(`${context.request.inputText}\n${context.corePoints.join("\n")}`);
  const map: Record<VisualDomain, Omit<VisualStyleProfile, "visualDomain" | "rationale">> = {
    business: {
      recommendedPreset: "corporate",
      recommendedTone: "professional",
      styleArchetype: "editorial_bold",
      surprisePolicy: "Use one strategic visual twist per slide while keeping business credibility.",
      styleKeywords: [
        "editorial business cover look",
        "high-contrast executive composition",
        "clean minimalist business slides",
        "decisive focal subject",
        "social-feed stopping business visual",
        "premium report aesthetic"
      ],
      negativeKeywords: ["sci-fi", "fantasy", "landscape painting", "storybook", "surrealism"],
      globalDirection: "Use business-oriented visuals with consistent corporate composition and restrained palette."
    },
    tech: {
      recommendedPreset: "tech-minimal",
      recommendedTone: "insightful",
      styleArchetype: "cinematic_minimal",
      surprisePolicy: "Use geometric tension and one unexpected framing choice without clutter.",
      styleKeywords: [
        "modern technology editorial",
        "cinematic minimal framing",
        "clean product-thinking composition",
        "high clarity infographics",
        "sharp edge lighting",
        "single dominant subject"
      ],
      negativeKeywords: ["fantasy", "oil painting", "storybook", "baroque"],
      globalDirection: "Maintain modern technical aesthetics with clean geometry and clear focal points."
    },
    "data-viz": {
      recommendedPreset: "data-viz",
      recommendedTone: "formal",
      styleArchetype: "data_drama",
      surprisePolicy: "Highlight one dramatic metric contrast while preserving analytical clarity.",
      styleKeywords: [
        "data visualization style",
        "analytical report visuals",
        "clean chart-like composition",
        "dramatic metric contrast",
        "editorial data storytelling",
        "dashboard-inspired precision"
      ],
      negativeKeywords: ["sci-fi", "landscape painting", "fantasy", "cartoonish"],
      globalDirection: "Emphasize analytical clarity and structured visual hierarchy."
    },
    "personal-growth": {
      recommendedPreset: "personal-growth",
      recommendedTone: "motivational",
      styleArchetype: "human_story",
      surprisePolicy: "Use one relatable personal symbol with clear forward momentum.",
      styleKeywords: [
        "human-centered editorial style",
        "progressive transformation visual",
        "clean motivational composition",
        "habit and milestone symbolism",
        "warm high-contrast storytelling",
        "focus on clarity and action"
      ],
      negativeKeywords: ["corporate dashboard", "cold infographic wall", "dense chart overload"],
      globalDirection: "Prioritize relatable transformation, momentum, and emotional clarity."
    },
    emotion: {
      recommendedPreset: "emotion",
      recommendedTone: "empathetic",
      styleArchetype: "human_story",
      surprisePolicy: "Keep emotional nuance subtle with one symbolic tension element.",
      styleKeywords: [
        "emotion-rich editorial visual",
        "soft cinematic portrait framing",
        "symbolic relationship cues",
        "clean negative space for reflection",
        "high readability with gentle gradients",
        "expressive but restrained storytelling"
      ],
      negativeKeywords: ["aggressive sales visual", "corporate KPI board", "hard sci-fi neon chaos"],
      globalDirection: "Use empathetic visual language with controlled contrast and intimate storytelling."
    },
    education: {
      recommendedPreset: "education",
      recommendedTone: "clear",
      styleArchetype: "editorial_bold",
      surprisePolicy: "Anchor each slide with one memorable teaching metaphor.",
      styleKeywords: [
        "educational editorial style",
        "concept-first visual explanation",
        "structured learning progression",
        "clean didactic composition",
        "high-clarity diagrammatic storytelling",
        "audience-friendly learning cues"
      ],
      negativeKeywords: ["cluttered classroom collage", "overly abstract art", "hard-to-read visual noise"],
      globalDirection: "Optimize for understanding speed, retention cues, and clean structure."
    },
    lifestyle: {
      recommendedPreset: "lifestyle",
      recommendedTone: "insightful",
      styleArchetype: "human_story",
      surprisePolicy: "Inject one emotionally resonant, human-centered detail per slide.",
      styleKeywords: [
        "editorial lifestyle visual style",
        "clean magazine composition",
        "soft natural lighting",
        "minimal but warm storytelling frame",
        "human-centric hero subject",
        "scroll-stopping emotional clarity"
      ],
      negativeKeywords: ["corporate dashboard", "hard sci-fi", "overly technical diagram"],
      globalDirection: "Keep visuals human-centered, polished, and cohesive across slides."
    },
    general: {
      recommendedPreset: "editorial-neutral",
      recommendedTone: "insightful",
      styleArchetype: "editorial_bold",
      surprisePolicy: "Favor clean clarity with one memorable contrast element.",
      styleKeywords: [
        "clean editorial storytelling",
        "professional but domain-neutral composition",
        "consistent presentation style",
        "clear visual hierarchy",
        "high-impact focal framing"
      ],
      negativeKeywords: ["fantasy", "sci-fi", "landscape painting"],
      globalDirection: "Favor domain-neutral editorial style with strong consistency and readability."
    }
  };

  const fallback = map[domain];
  return {
    visualDomain: domain,
    ...fallback,
    rationale: `Fallback classifier matched domain=${domain}.`
  };
}

function normalizeProfile(raw: Partial<VisualStyleProfile> | null, fallback: VisualStyleProfile): VisualStyleProfile {
  const domain: VisualDomain =
    raw?.visualDomain === "business" ||
    raw?.visualDomain === "tech" ||
    raw?.visualDomain === "lifestyle" ||
    raw?.visualDomain === "data-viz" ||
    raw?.visualDomain === "personal-growth" ||
    raw?.visualDomain === "emotion" ||
    raw?.visualDomain === "education" ||
    raw?.visualDomain === "general"
      ? raw.visualDomain
      : fallback.visualDomain;

  const styleKeywords = Array.isArray(raw?.styleKeywords)
    ? raw.styleKeywords.map((item) => compact(String(item))).filter(Boolean).slice(0, 6)
    : fallback.styleKeywords;

  const negativeKeywords = Array.isArray(raw?.negativeKeywords)
    ? raw.negativeKeywords.map((item) => compact(String(item))).filter(Boolean).slice(0, 6)
    : fallback.negativeKeywords;

  return {
    visualDomain: domain,
    recommendedPreset: compact(String(raw?.recommendedPreset ?? fallback.recommendedPreset), 40) || fallback.recommendedPreset,
    recommendedTone: compact(String(raw?.recommendedTone ?? fallback.recommendedTone), 30) || fallback.recommendedTone,
    styleArchetype: (() => {
      const value = String(raw?.styleArchetype ?? "").trim().toLowerCase();
      if (value === "editorial_bold") return "editorial_bold";
      if (value === "cinematic_minimal") return "cinematic_minimal";
      if (value === "data_drama") return "data_drama";
      if (value === "human_story") return "human_story";
      return fallback.styleArchetype;
    })(),
    surprisePolicy:
      compact(String(raw?.surprisePolicy ?? fallback.surprisePolicy ?? ""), 180) ||
      fallback.surprisePolicy,
    styleKeywords: styleKeywords.length ? styleKeywords : fallback.styleKeywords,
    negativeKeywords: negativeKeywords.length ? negativeKeywords : fallback.negativeKeywords,
    globalDirection: compact(String(raw?.globalDirection ?? fallback.globalDirection), 260) || fallback.globalDirection,
    rationale: compact(String(raw?.rationale ?? fallback.rationale), 260) || fallback.rationale
  };
}

export async function skill13StyleRecommender(context: ConversionContext): Promise<ConversionContext> {
  const fallback = fallbackProfile(context);
  const memoryHints = getStyleHookMemoryHints({
    sourceTitle: context.request.sourceTitle,
    sourceText: context.request.inputText
  });
  const llmResult = await callSkillLlmJson<VisualStyleProfile>({
    skill: "styleRecommender",
    input: {
      source_text: context.request.inputText,
      source_type: context.request.sourceType ?? "text",
      source_title: context.request.sourceTitle ?? "",
      core_points: context.corePoints,
      hooks: context.hooks,
      memory_style_hints: memoryHints.styleHints,
      current_style_preset: context.request.brand.stylePreset,
      current_tone: context.request.tone,
      goal: "Recommend one global visual style profile for image generation consistency and social-feed stopping power."
    },
    outputSchemaHint:
      '{"visualDomain":"business|tech|lifestyle|data-viz|personal-growth|emotion|education|general","recommendedPreset":"corporate","recommendedTone":"professional","styleArchetype":"editorial_bold|cinematic_minimal|data_drama|human_story","surprisePolicy":"...","styleKeywords":["domain-adaptive editorial style"],"negativeKeywords":["sci-fi"],"globalDirection":"...","rationale":"..."}',
    outputLanguage: "en-US",
    temperature: 0
  });

  const profile = normalizeProfile(llmResult, fallback);
  const originalPreset = context.request.brand.stylePreset.trim().toLowerCase();
  const originalTone = context.request.tone.trim().toLowerCase();
  const shouldOverridePreset = !originalPreset || originalPreset === "auto" || originalPreset === "tech-minimal";
  const shouldOverrideTone = !originalTone || originalTone === "auto" || originalTone === "insightful";
  const topMemoryStyle = memoryHints.styleHints[0];
  const recommendedPreset = shouldOverridePreset
    ? topMemoryStyle?.confidence && topMemoryStyle.confidence >= 72
      ? topMemoryStyle.preset
      : profile.recommendedPreset
    : context.request.brand.stylePreset;
  const recommendedTone = shouldOverrideTone
    ? topMemoryStyle?.confidence && topMemoryStyle.confidence >= 72
      ? topMemoryStyle.tone || profile.recommendedTone
      : profile.recommendedTone
    : context.request.tone;

  return {
    ...context,
    request: {
      ...context.request,
      brand: {
        ...context.request.brand,
        stylePreset: recommendedPreset
      },
      tone: recommendedTone
    },
    visualStyleProfile: {
      ...profile,
      recommendedPreset: recommendedPreset,
      recommendedTone: recommendedTone
    }
  };
}
