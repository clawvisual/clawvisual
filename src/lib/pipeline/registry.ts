export type PipelineMode = "fast" | "full";

export type PipelineStage =
  | "skill_input_processor"
  | "skill_content_planner"
  | "skill_visual_prompt_planner"
  | "skill_asset_generator"
  | "skill_viral_optimizer"
  | "skill_quality_image_loop"
  | "skill_quality_post_copy_loop"
  | "skill_quality_copy_polish"
  | "skill_quality_final_audit";

export type ContentPipelineDefinition = Record<PipelineMode, PipelineStage[]>;

const LONGFORM_FAST: PipelineStage[] = [
  "skill_input_processor",
  "skill_content_planner",
  "skill_visual_prompt_planner",
  "skill_asset_generator",
  "skill_viral_optimizer",
  "skill_quality_copy_polish"
];

const LONGFORM_FULL: PipelineStage[] = [
  "skill_input_processor",
  "skill_content_planner",
  "skill_visual_prompt_planner",
  "skill_asset_generator",
  "skill_viral_optimizer",
  "skill_quality_post_copy_loop",
  "skill_quality_copy_polish",
  "skill_quality_final_audit"
];

// Content mode router. Add new mode pipelines here, e.g. videos_to_digest.
export const CONTENT_PIPELINES: Record<string, ContentPipelineDefinition> = {
  longform_digest: {
    fast: LONGFORM_FAST,
    full: LONGFORM_FULL
  },
  videos_to_digest: {
    fast: LONGFORM_FAST,
    full: LONGFORM_FULL
  }
};

export function resolveContentPipeline(contentMode: string): ContentPipelineDefinition {
  return CONTENT_PIPELINES[contentMode] ?? CONTENT_PIPELINES.longform_digest;
}

