import { createHash } from "node:crypto";
import { callGenericLlmJson } from "@/lib/llm/skill-client";
import {
  DEFAULT_NEGATIVE_PROMPT,
  NEGATIVE_PROMPT_WITH_TEXT_ON_IMAGE,
  generateNanoBananaImage
} from "@/lib/images/nano-banana";
import { shouldLockTextForOutputLanguage } from "@/lib/i18n/text-guard";
import type { ConversionResult } from "@/lib/types/skills";
import type {
  RerunPlan,
  ReviseIntent,
  RevisePayload,
  SkillArtifact
} from "@/lib/types/job";

const SKILL_ORDER = [
  "skill_00_input_processor",
  "skill_01_distiller",
  "skill_14_source_grounder",
  "skill_15_trend_miner",
  "skill_02_hook_architect",
  "skill_03_script_splitter",
  "skill_04_metaphorist",
  "skill_05_layout_selector",
  "skill_06_hierarchy_mapper",
  "skill_13_style_recommender",
  "skill_07_style_mapper",
  "skill_08_asset_generator",
  "skill_09_typographer",
  "skill_10_auto_resizer",
  "skill_11_attention_auditor",
  "skill_16_attention_fixer",
  "skill_12_viral_optimizer"
] as const;

// Dependency graph used to preserve provenance and recompute scope for artifacts.
const SKILL_DEP_GRAPH: Record<string, string[]> = {
  skill_00_input_processor: [],
  skill_01_distiller: ["skill_00_input_processor"],
  skill_14_source_grounder: ["skill_01_distiller"],
  skill_15_trend_miner: ["skill_14_source_grounder"],
  skill_02_hook_architect: ["skill_15_trend_miner"],
  skill_03_script_splitter: ["skill_02_hook_architect"],
  skill_04_metaphorist: ["skill_03_script_splitter"],
  skill_05_layout_selector: ["skill_04_metaphorist"],
  skill_06_hierarchy_mapper: ["skill_05_layout_selector"],
  skill_13_style_recommender: ["skill_06_hierarchy_mapper"],
  skill_07_style_mapper: ["skill_13_style_recommender"],
  skill_08_asset_generator: ["skill_07_style_mapper", "skill_13_style_recommender"],
  skill_09_typographer: ["skill_08_asset_generator"],
  skill_10_auto_resizer: ["skill_09_typographer"],
  skill_11_attention_auditor: ["skill_10_auto_resizer"],
  skill_16_attention_fixer: ["skill_11_attention_auditor"],
  skill_12_viral_optimizer: ["skill_16_attention_fixer", "skill_15_trend_miner"]
};

const COPY_STYLE_SKILLS = [
  "skill_01_distiller",
  "skill_14_source_grounder",
  "skill_02_hook_architect",
  "skill_03_script_splitter",
  "skill_09_typographer",
  "skill_15_trend_miner",
  "skill_12_viral_optimizer"
];

const TITLE_ARTIFACT_ID = "skill_02_hook_architect:title";
const SCRIPT_ARTIFACT_ID = "skill_03_script_splitter:slides";
const TYPOGRAPHY_ARTIFACT_ID = "skill_09_typographer:composition";
const CAPTION_ARTIFACT_ID = "skill_12_viral_optimizer:caption";
const DISTILLER_ARTIFACT_ID = "skill_01_distiller:source";
const STYLE_RECOMMENDER_ARTIFACT_ID = "skill_13_style_recommender:profile";

type RevisionEngineParams = {
  jobId: string;
  baseJobId: string;
  parentJobId?: string;
  revision: number;
  revise: RevisePayload;
  previousResult: ConversionResult;
  previousArtifacts: SkillArtifact[];
  outputLanguage: string;
  generationMode: "standard" | "quote_slides";
};

type RevisionEngineOutput = {
  result: ConversionResult;
  artifacts: SkillArtifact[];
  changedArtifacts: string[];
  rerunPlan: RerunPlan;
  diff: {
    changed_fields: string[];
    changed_slide_ids: number[];
  };
};

type CreateArtifactInput = {
  artifactId: string;
  skillName: string;
  output: unknown;
  inputHashPayload: unknown;
  revision: number;
  previousArtifacts: SkillArtifact[];
  jobId: string;
  baseJobId: string;
  parentJobId?: string;
  intent?: ReviseIntent;
};

function hashPayload(payload: unknown): string {
  const raw = JSON.stringify(payload) ?? "";
  return createHash("sha256").update(raw).digest("hex");
}

function normalizeHashtags(tags: string[]): string[] {
  const normalized = tags
    .map((tag) => String(tag).trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag.replace(/\s+/g, "")}`))
    .filter((tag) => /^#[\p{L}\p{N}_-]+$/u.test(tag));

  return Array.from(new Set(normalized)).slice(0, 8);
}

function deepCloneResult(result: ConversionResult): ConversionResult {
  return JSON.parse(JSON.stringify(result)) as ConversionResult;
}

function createArtifact(input: CreateArtifactInput): SkillArtifact {
  // Artifact versions are monotonic per artifactId across revisions.
  const previousVersion = input.previousArtifacts.find((item) => item.artifactId === input.artifactId)?.version ?? 0;

  return {
    artifactId: input.artifactId,
    skillName: input.skillName,
    inputHash: hashPayload(input.inputHashPayload),
    output: input.output,
    version: previousVersion + 1,
    dependsOn: SKILL_DEP_GRAPH[input.skillName] ?? [],
    revision: input.revision,
    updatedAt: new Date().toISOString(),
    provenance: {
      jobId: input.jobId,
      baseJobId: input.baseJobId,
      parentJobId: input.parentJobId,
      intent: input.intent
    }
  };
}

function mergeArtifacts(previousArtifacts: SkillArtifact[], updates: SkillArtifact[]): SkillArtifact[] {
  if (!updates.length) return previousArtifacts;
  const next = new Map<string, SkillArtifact>();
  for (const artifact of previousArtifacts) {
    next.set(artifact.artifactId, artifact);
  }
  for (const artifact of updates) {
    next.set(artifact.artifactId, artifact);
  }
  return [...next.values()];
}

function toAssetArtifactId(slideId: number): string {
  return `skill_08_asset_generator:slide:${slideId}`;
}

export function planRerun(intent: ReviseIntent, preserveLayout: boolean): RerunPlan {
  // Select the minimal skill subset required by the requested revision intent.
  let selectedSkills: string[] = [];
  if (intent === "rewrite_copy_style") {
    selectedSkills = [...COPY_STYLE_SKILLS];
  } else if (intent === "regenerate_cover" || intent === "regenerate_slides") {
    selectedSkills = ["skill_08_asset_generator"];
    if (!preserveLayout) {
      selectedSkills.push("skill_09_typographer");
    }
  }

  const reusedSkills = SKILL_ORDER.filter((item) => !selectedSkills.includes(item));
  const reason =
    intent === "rewrite_copy_style"
      ? "Copy-only revision requested; keep visual assets untouched."
      : "Image regeneration requested; rerun visual generation path only.";

  return { selectedSkills, reusedSkills, reason };
}

export function buildArtifactsForGenerate(params: {
  result: ConversionResult;
  inputText: string;
  revision: number;
  jobId: string;
  baseJobId: string;
  parentJobId?: string;
}): SkillArtifact[] {
  // Materialize baseline artifacts from a fresh generation so later revisions can diff/replace deterministically.
  const artifacts: SkillArtifact[] = [];
  const existingArtifacts: SkillArtifact[] = [];

  artifacts.push(
    createArtifact({
      artifactId: DISTILLER_ARTIFACT_ID,
      skillName: "skill_01_distiller",
      output: {
        source_excerpt: params.inputText.slice(0, 800)
      },
      inputHashPayload: {
        source_text: params.inputText
      },
      revision: params.revision,
      previousArtifacts: existingArtifacts,
      jobId: params.jobId,
      baseJobId: params.baseJobId,
      parentJobId: params.parentJobId
    })
  );

  artifacts.push(
    createArtifact({
      artifactId: STYLE_RECOMMENDER_ARTIFACT_ID,
      skillName: "skill_13_style_recommender",
      output: {
        visual_style_profile: (params.result.skill_logs.find((log) => log.skill_name === "skill_13_style_recommender")
          ?.output_preview ?? "n/a")
      },
      inputHashPayload: {
        style_recommender_preview: params.result.skill_logs.find((log) => log.skill_name === "skill_13_style_recommender")
          ?.output_preview
      },
      revision: params.revision,
      previousArtifacts: existingArtifacts,
      jobId: params.jobId,
      baseJobId: params.baseJobId,
      parentJobId: params.parentJobId
    })
  );

  artifacts.push(
    createArtifact({
      artifactId: TITLE_ARTIFACT_ID,
      skillName: "skill_02_hook_architect",
      output: { post_title: params.result.post_title },
      inputHashPayload: {
        title: params.result.post_title
      },
      revision: params.revision,
      previousArtifacts: existingArtifacts,
      jobId: params.jobId,
      baseJobId: params.baseJobId,
      parentJobId: params.parentJobId
    })
  );

  artifacts.push(
    createArtifact({
      artifactId: SCRIPT_ARTIFACT_ID,
      skillName: "skill_03_script_splitter",
      output: {
        slides: params.result.slides.map((slide) => ({
          slide_id: slide.slide_id,
          content_quote: slide.content_quote
        }))
      },
      inputHashPayload: {
        slides: params.result.slides.map((slide) => ({
          slide_id: slide.slide_id,
          content_quote: slide.content_quote
        }))
      },
      revision: params.revision,
      previousArtifacts: existingArtifacts,
      jobId: params.jobId,
      baseJobId: params.baseJobId,
      parentJobId: params.parentJobId
    })
  );

  artifacts.push(
    createArtifact({
      artifactId: TYPOGRAPHY_ARTIFACT_ID,
      skillName: "skill_09_typographer",
      output: {
        slides: params.result.slides.map((slide) => ({
          slide_id: slide.slide_id,
          layout_template: slide.layout_template
        }))
      },
      inputHashPayload: {
        slides: params.result.slides.map((slide) => ({
          slide_id: slide.slide_id,
          layout_template: slide.layout_template
        }))
      },
      revision: params.revision,
      previousArtifacts: existingArtifacts,
      jobId: params.jobId,
      baseJobId: params.baseJobId,
      parentJobId: params.parentJobId
    })
  );

  artifacts.push(
    createArtifact({
      artifactId: CAPTION_ARTIFACT_ID,
      skillName: "skill_12_viral_optimizer",
      output: {
        post_caption: params.result.post_caption,
        hashtags: params.result.hashtags
      },
      inputHashPayload: {
        post_caption: params.result.post_caption,
        hashtags: params.result.hashtags
      },
      revision: params.revision,
      previousArtifacts: existingArtifacts,
      jobId: params.jobId,
      baseJobId: params.baseJobId,
      parentJobId: params.parentJobId
    })
  );

  for (const slide of params.result.slides) {
    artifacts.push(
      createArtifact({
        artifactId: toAssetArtifactId(slide.slide_id),
        skillName: "skill_08_asset_generator",
        output: {
          slide_id: slide.slide_id,
          visual_prompt: slide.visual_prompt,
          image_url: slide.image_url
        },
        inputHashPayload: {
          slide_id: slide.slide_id,
          visual_prompt: slide.visual_prompt
        },
        revision: params.revision,
        previousArtifacts: existingArtifacts,
        jobId: params.jobId,
        baseJobId: params.baseJobId,
        parentJobId: params.parentJobId
      })
    );
  }

  return artifacts;
}

async function rewriteCopyStyle(params: {
  sourceText: string;
  previousResult: ConversionResult;
  instruction: string;
  outputLanguage: string;
  editableFields: RevisePayload["editableFields"];
  preserveFacts: boolean;
  preserveSlideStructure: boolean;
  scopeSlideIds: number[];
}): Promise<ConversionResult> {
  // LLM-based copy rewrite; applies only allowed editable fields and keeps the rest untouched.
  const editableFields = params.editableFields.length
    ? params.editableFields
    : ["post_title", "post_caption", "hashtags"];

  const llmResult = await callGenericLlmJson<{
    post_title?: string;
    post_caption?: string;
    hashtags?: string[];
    slides?: Array<{ slide_id?: number; content_quote?: string }>;
  }>({
    instruction:
      "Revise an existing social carousel copy based on user instruction. Keep factual alignment with source text. Return only fields that should be changed.",
    input: {
      user_instruction: params.instruction,
      source_text: params.sourceText,
      previous_output: params.previousResult,
      editable_fields: editableFields,
      constraints: {
        preserve_facts: params.preserveFacts,
        preserve_slide_structure: params.preserveSlideStructure
      }
    },
    outputSchemaHint:
      '{"post_title":"...","post_caption":"...","hashtags":["#tag"],"slides":[{"slide_id":1,"content_quote":"..."}]}',
    outputLanguage: params.outputLanguage,
    temperature: 0.35
  });

  const next = deepCloneResult(params.previousResult);
  const editableSet = new Set(editableFields);

  if (editableSet.has("post_title")) {
    const nextTitle = String(llmResult?.post_title ?? "").trim();
    if (nextTitle) {
      next.post_title = nextTitle;
    }
  }

  if (editableSet.has("post_caption")) {
    const nextCaption = String(llmResult?.post_caption ?? "").trim();
    if (nextCaption) {
      next.post_caption = nextCaption;
    }
  }

  if (editableSet.has("hashtags")) {
    const nextTags = normalizeHashtags(llmResult?.hashtags ?? []);
    if (nextTags.length) {
      next.hashtags = nextTags;
    }
  }

  const shouldUpdateSlides = editableSet.has("slides") && !params.preserveSlideStructure;
  if (shouldUpdateSlides && Array.isArray(llmResult?.slides)) {
    const updates = new Map(
      llmResult.slides
        .map((slide) => ({
          slideId: Number(slide.slide_id),
          quote: String(slide.content_quote ?? "").trim()
        }))
        .filter((item) => Number.isFinite(item.slideId) && item.quote.length > 0)
        .filter((item) => params.scopeSlideIds.length === 0 || params.scopeSlideIds.includes(item.slideId))
        .map((item) => [item.slideId, item.quote] as const)
    );

    next.slides = next.slides.map((slide) => {
      const quote = updates.get(slide.slide_id);
      return quote ? { ...slide, content_quote: quote } : slide;
    });
  }

  return next;
}

async function rewriteImagePrompt(basePrompt: string, instruction: string, outputLanguage: string): Promise<string> {
  const llm = await callGenericLlmJson<{ prompt?: string }>({
    instruction:
      "Rewrite image generation prompt according to user instruction while preserving topic relevance and composition constraints.",
    input: {
      previous_prompt: basePrompt,
      user_instruction: instruction
    },
    outputSchemaHint: '{"prompt":"..."}',
    outputLanguage,
    temperature: 0.4
  });

  const nextPrompt = String(llm?.prompt ?? "").trim();
  if (nextPrompt) return nextPrompt;
  if (!instruction.trim()) return basePrompt;
  return `${basePrompt}. ${instruction.trim()}`;
}

async function regenerateSlides(params: {
  previousResult: ConversionResult;
  instruction: string;
  outputLanguage: string;
  generationMode: "standard" | "quote_slides";
  slideIds: number[];
  mode: RevisePayload["options"]["mode"];
  seed?: number;
}): Promise<ConversionResult> {
  // Regenerate images for target slides only; optionally reprompt or keep prompt with new seed.
  const next = deepCloneResult(params.previousResult);
  const normalizedIds = params.slideIds.length ? params.slideIds : next.slides.map((slide) => slide.slide_id);
  const slideIdSet = new Set(normalizedIds);
  const nowSeedBase = Date.now() % 100000;

  for (let index = 0; index < next.slides.length; index += 1) {
    const slide = next.slides[index];
    if (!slideIdSet.has(slide.slide_id)) {
      continue;
    }

    const prompt =
      params.mode === "reprompt"
        ? await rewriteImagePrompt(slide.visual_prompt, params.instruction, params.outputLanguage)
        : slide.visual_prompt;

    const seed = params.seed != null ? params.seed + index : nowSeedBase + index + slide.slide_id;
    const lockedTexts =
      params.generationMode === "quote_slides" &&
      shouldLockTextForOutputLanguage(slide.content_quote, params.outputLanguage)
        ? [slide.content_quote]
        : [];

    const generated = await generateNanoBananaImage({
      prompt,
      aspectRatio: next.aspect_ratio,
      negativePrompt:
        params.generationMode === "quote_slides"
          ? NEGATIVE_PROMPT_WITH_TEXT_ON_IMAGE
          : DEFAULT_NEGATIVE_PROMPT,
      seed,
      textOnImage: params.generationMode === "quote_slides",
      lockedTexts
    });

    next.slides[index] = {
      ...slide,
      visual_prompt: prompt,
      image_url: generated.imageUrl
    };
  }

  return next;
}

export function buildResultDiff(previousResult: ConversionResult, nextResult: ConversionResult): {
  changed_fields: string[];
  changed_slide_ids: number[];
} {
  const changedFields: string[] = [];
  if (previousResult.post_title !== nextResult.post_title) changedFields.push("post_title");
  if (previousResult.post_caption !== nextResult.post_caption) changedFields.push("post_caption");
  if (JSON.stringify(previousResult.hashtags) !== JSON.stringify(nextResult.hashtags)) changedFields.push("hashtags");

  const slideDiffIds: number[] = [];
  const previousMap = new Map(previousResult.slides.map((slide) => [slide.slide_id, slide] as const));
  for (const slide of nextResult.slides) {
    const prev = previousMap.get(slide.slide_id);
    if (!prev) {
      slideDiffIds.push(slide.slide_id);
      continue;
    }
    if (
      prev.image_url !== slide.image_url ||
      prev.visual_prompt !== slide.visual_prompt ||
      prev.content_quote !== slide.content_quote
    ) {
      slideDiffIds.push(slide.slide_id);
    }
  }
  if (slideDiffIds.length) {
    changedFields.push("slides");
  }

  return {
    changed_fields: changedFields,
    changed_slide_ids: slideDiffIds
  };
}

export async function runRevisionEngine(params: RevisionEngineParams): Promise<RevisionEngineOutput> {
  // Revision entrypoint: execute intent branch, update artifacts, refresh skill logs, and return structured diff.
  const rerunPlan = planRerun(params.revise.intent, params.revise.options.preserveLayout);
  const scopeSlideIds = params.revise.scope.slideIds ?? [];

  let revisedResult = deepCloneResult(params.previousResult);
  if (params.revise.intent === "rewrite_copy_style") {
    revisedResult = await rewriteCopyStyle({
      sourceText: params.revise.sourceText,
      previousResult: revisedResult,
      instruction: params.revise.instruction,
      outputLanguage: params.outputLanguage,
      editableFields: params.revise.editableFields,
      preserveFacts: params.revise.preserveFacts,
      preserveSlideStructure: params.revise.preserveSlideStructure,
      scopeSlideIds
    });
  } else {
    let slideIds = scopeSlideIds;
    if (!slideIds.length && params.revise.intent === "regenerate_cover") {
      slideIds = [1];
    }

    revisedResult = await regenerateSlides({
      previousResult: revisedResult,
      instruction: params.revise.instruction,
      outputLanguage: params.outputLanguage,
      generationMode: params.generationMode,
      slideIds,
      mode: params.revise.options.mode,
      seed: params.revise.options.seed
    });
  }

  const updatedArtifacts: SkillArtifact[] = [];
  if (params.revise.intent === "rewrite_copy_style") {
    updatedArtifacts.push(
      createArtifact({
        artifactId: DISTILLER_ARTIFACT_ID,
        skillName: "skill_01_distiller",
        output: {
          source_excerpt: params.revise.sourceText.slice(0, 800),
          instruction: params.revise.instruction
        },
        inputHashPayload: {
          source_text: params.revise.sourceText,
          instruction: params.revise.instruction
        },
        revision: params.revision,
        previousArtifacts: params.previousArtifacts,
        jobId: params.jobId,
        baseJobId: params.baseJobId,
        parentJobId: params.parentJobId,
        intent: params.revise.intent
      })
    );
    updatedArtifacts.push(
      createArtifact({
        artifactId: TITLE_ARTIFACT_ID,
        skillName: "skill_02_hook_architect",
        output: {
          post_title: revisedResult.post_title
        },
        inputHashPayload: {
          post_title: revisedResult.post_title,
          instruction: params.revise.instruction
        },
        revision: params.revision,
        previousArtifacts: params.previousArtifacts,
        jobId: params.jobId,
        baseJobId: params.baseJobId,
        parentJobId: params.parentJobId,
        intent: params.revise.intent
      })
    );
    updatedArtifacts.push(
      createArtifact({
        artifactId: SCRIPT_ARTIFACT_ID,
        skillName: "skill_03_script_splitter",
        output: {
          slides: revisedResult.slides.map((slide) => ({
            slide_id: slide.slide_id,
            content_quote: slide.content_quote
          }))
        },
        inputHashPayload: {
          instruction: params.revise.instruction,
          slides: revisedResult.slides.map((slide) => ({
            slide_id: slide.slide_id,
            content_quote: slide.content_quote
          }))
        },
        revision: params.revision,
        previousArtifacts: params.previousArtifacts,
        jobId: params.jobId,
        baseJobId: params.baseJobId,
        parentJobId: params.parentJobId,
        intent: params.revise.intent
      })
    );
    updatedArtifacts.push(
      createArtifact({
        artifactId: TYPOGRAPHY_ARTIFACT_ID,
        skillName: "skill_09_typographer",
        output: {
          slides: revisedResult.slides.map((slide) => ({
            slide_id: slide.slide_id,
            layout_template: slide.layout_template,
            content_quote: slide.content_quote
          }))
        },
        inputHashPayload: {
          instruction: params.revise.instruction,
          preserve_slide_structure: params.revise.preserveSlideStructure
        },
        revision: params.revision,
        previousArtifacts: params.previousArtifacts,
        jobId: params.jobId,
        baseJobId: params.baseJobId,
        parentJobId: params.parentJobId,
        intent: params.revise.intent
      })
    );
    updatedArtifacts.push(
      createArtifact({
        artifactId: CAPTION_ARTIFACT_ID,
        skillName: "skill_12_viral_optimizer",
        output: {
          post_caption: revisedResult.post_caption,
          hashtags: revisedResult.hashtags
        },
        inputHashPayload: {
          instruction: params.revise.instruction,
          post_caption: revisedResult.post_caption,
          hashtags: revisedResult.hashtags
        },
        revision: params.revision,
        previousArtifacts: params.previousArtifacts,
        jobId: params.jobId,
        baseJobId: params.baseJobId,
        parentJobId: params.parentJobId,
        intent: params.revise.intent
      })
    );
  } else {
    const previousById = new Map(params.previousResult.slides.map((slide) => [slide.slide_id, slide] as const));
    for (const slide of revisedResult.slides) {
      const previousSlide = previousById.get(slide.slide_id);
      if (
        previousSlide &&
        previousSlide.image_url === slide.image_url &&
        previousSlide.visual_prompt === slide.visual_prompt
      ) {
        continue;
      }

      updatedArtifacts.push(
        createArtifact({
          artifactId: toAssetArtifactId(slide.slide_id),
          skillName: "skill_08_asset_generator",
          output: {
            slide_id: slide.slide_id,
            visual_prompt: slide.visual_prompt,
            image_url: slide.image_url
          },
          inputHashPayload: {
            slide_id: slide.slide_id,
            instruction: params.revise.instruction,
            mode: params.revise.options.mode,
            prompt: slide.visual_prompt
          },
          revision: params.revision,
          previousArtifacts: params.previousArtifacts,
          jobId: params.jobId,
          baseJobId: params.baseJobId,
          parentJobId: params.parentJobId,
          intent: params.revise.intent
        })
      );
    }
  }

  const mergedArtifacts = mergeArtifacts(params.previousArtifacts, updatedArtifacts);
  const existingLogs = revisedResult.skill_logs ?? [];
  const logMap = new Map(existingLogs.map((log) => [log.skill_name, log] as const));

  for (const skill of rerunPlan.selectedSkills) {
    logMap.set(skill, {
      skill_name: skill,
      status: "completed",
      output_preview: `rerun in revision #${params.revision}`
    });
  }
  revisedResult.skill_logs = [...logMap.values()];

  const diff = buildResultDiff(params.previousResult, revisedResult);

  return {
    result: revisedResult,
    artifacts: mergedArtifacts,
    changedArtifacts: updatedArtifacts.map((item) => item.artifactId),
    rerunPlan,
    diff
  };
}
