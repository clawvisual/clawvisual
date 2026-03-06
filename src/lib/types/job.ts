import type { ConversionResult } from "@/lib/types/skills";

export type JobStatus = "queued" | "running" | "completed" | "failed";
export type SessionVisibility = "private" | "public";
export type JobMode = "generate" | "revise";
export type ReviseIntent = "rewrite_copy_style" | "regenerate_cover" | "regenerate_slides";
export type ReviseImageMode = "same_prompt_new_seed" | "reprompt";
export type ReviseEditableField = "post_title" | "post_caption" | "hashtags" | "slides";

export interface RerunPlan {
  selectedSkills: string[];
  reusedSkills: string[];
  reason: string;
}

export interface SkillArtifact {
  artifactId: string;
  skillName: string;
  inputHash: string;
  output: unknown;
  version: number;
  dependsOn: string[];
  revision: number;
  updatedAt: string;
  provenance: {
    jobId: string;
    baseJobId: string;
    parentJobId?: string;
    intent?: ReviseIntent;
  };
}

export interface RevisePayload {
  intent: ReviseIntent;
  instruction: string;
  sourceText: string;
  editableFields: ReviseEditableField[];
  preserveFacts: boolean;
  preserveSlideStructure: boolean;
  scope: {
    slideIds?: number[];
    fields?: string[];
  };
  options: {
    mode: ReviseImageMode;
    seed?: number;
    preserveLayout: boolean;
  };
}

export interface SessionRecord {
  id: string;
  ownerUserId?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastJobId?: string;
}

export interface ShareRecord {
  id: string;
  sessionId: string;
  token: string;
  visibility: SessionVisibility;
  expiresAt?: string;
  createdAt: string;
}

export interface JobEvent {
  id: string;
  index: number;
  stage: string;
  title: string;
  thought: string;
  action: string;
  outputPreview?: string;
  durationSec: number;
  costUsd: number;
  tokenInput?: number;
  tokenOutput?: number;
  tokenTotal?: number;
  createdAt: string;
}

export interface JobRecord {
  id: string;
  sessionId: string;
  turnIndex: number;
  revision: number;
  mode: JobMode;
  baseJobId: string;
  parentJobId?: string;
  revisionIntent?: ReviseIntent;
  status: JobStatus;
  progress: number;
  stage: string;
  events: JobEvent[];
  rerunPlan?: RerunPlan;
  changedArtifacts?: string[];
  artifacts: SkillArtifact[];
  payload: {
    inputText: string;
    sourceInputText?: string;
    targetSlides: number;
    aspectRatios: Array<"4:5" | "9:16" | "1:1">;
    stylePreset: string;
    tone: string;
    outputLanguage: string;
    generationMode: "standard" | "quote_slides";
    reviewMode?: "auto" | "required";
    revisePayload?: RevisePayload;
  };
  result?: ConversionResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
