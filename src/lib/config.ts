export const appConfig = {
  name: "clawvisual AI",
  version: "0.1.0",
  llm: {
    apiUrl: process.env.LLM_API_URL ?? "",
    apiKey: process.env.LLM_API_KEY ?? "",
    model: process.env.LLM_MODEL ?? "google/gemini-3-flash-preview",
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 25000),
    copyFallbackModel: process.env.LLM_COPY_FALLBACK_MODEL ?? "google/gemini-2.5-flash",
    copyPolishModel: process.env.LLM_COPY_POLISH_MODEL ?? "openai/gpt-5.1-mini",
    httpReferer: process.env.LLM_HTTP_REFERER ?? process.env.NEXT_PUBLIC_APP_URL ?? "",
    xTitle: process.env.LLM_X_TITLE ?? "clawvisual AI"
  },
  image: {
    model: process.env.NANO_BANANA_MODEL ?? "gemini-3.1-flash-image-preview",
    responseFormat: process.env.NANO_BANANA_RESPONSE_FORMAT ?? "",
    timeoutMs: Number(process.env.NANO_BANANA_TIMEOUT_MS ?? 60000),
    transientRetryMax: Number(process.env.NANO_BANANA_TRANSIENT_RETRY_MAX ?? 2),
    transientRetryBaseDelayMs: Number(process.env.NANO_BANANA_RETRY_BASE_DELAY_MS ?? 450)
  },
  quality: {
    enabled: (process.env.QUALITY_LOOP_ENABLED ?? "true") === "true",
    threshold: Number(process.env.QUALITY_AUDIT_THRESHOLD ?? 78),
    imageCoverThreshold: Number(process.env.QUALITY_IMAGE_COVER_THRESHOLD ?? 85),
    imageInnerThreshold: Number(process.env.QUALITY_IMAGE_INNER_THRESHOLD ?? 78),
    copyRounds: Number(process.env.QUALITY_MAX_COPY_ROUNDS ?? 1),
    imageRounds: Number(process.env.QUALITY_MAX_IMAGE_ROUNDS ?? 0),
    maxExtraImages: Number(process.env.QUALITY_MAX_EXTRA_IMAGES ?? 1),
    imageLoopMaxMs: Number(process.env.QUALITY_IMAGE_LOOP_MAX_MS ?? 120000),
    imageAuditScope: (process.env.QUALITY_IMAGE_AUDIT_SCOPE ?? "cover").trim().toLowerCase() === "all" ? "all" : "cover"
  },
  pipeline: {
    mode: (process.env.PIPELINE_MODE ?? "fast").trim().toLowerCase() === "full" ? "full" : "fast",
    maxDurationMs: Number(process.env.PIPELINE_MAX_DURATION_MS ?? 300000),
    enableSourceIntel: (process.env.PIPELINE_ENABLE_SOURCE_INTEL ?? "false").trim().toLowerCase() === "true",
    enableStoryboardQuality: (process.env.PIPELINE_ENABLE_STORYBOARD_QUALITY ?? "false").trim().toLowerCase() === "true",
    enableStyleRecommender: (process.env.PIPELINE_ENABLE_STYLE_RECOMMENDER ?? "false").trim().toLowerCase() === "true",
    enableAttentionFixer: (process.env.PIPELINE_ENABLE_ATTENTION_FIXER ?? "false").trim().toLowerCase() === "true",
    enablePostCopyQuality: (process.env.PIPELINE_ENABLE_POST_COPY_QUALITY ?? "false").trim().toLowerCase() === "true",
    enableFinalAudit: (process.env.PIPELINE_ENABLE_FINAL_AUDIT ?? "false").trim().toLowerCase() === "true"
  },
  externalKeys: {
    openrouter: process.env.OPENROUTER_API_KEY ?? "",
    tavily: process.env.TAVILY_API_KEY ?? "",
    serper: process.env.SERPER_API_KEY ?? "",
    jina: process.env.JINA_API_KEY ?? "",
    gemini: process.env.GEMINI_API_KEY ?? ""
  },
  security: {
    acceptedApiKeys: (process.env.CLAWVISUAL_API_KEYS ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    allowWithoutKey: (process.env.CLAWVISUAL_ALLOW_NO_KEY ?? "true") === "true"
  }
};
