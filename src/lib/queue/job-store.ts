import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ConversionRequest } from "@/lib/types/skills";
import { callGenericLlmJson } from "@/lib/llm/skill-client";
import type {
  JobEvent,
  JobRecord,
  JobStatus,
  RevisePayload,
  SessionRecord,
  SessionVisibility,
  ShareRecord
} from "@/lib/types/job";
import { runConversion } from "@/lib/orchestrator";
import { buildArtifactsForGenerate, planRerun, runRevisionEngine } from "@/lib/revision/engine";
import { recordStyleHookMemory } from "@/lib/memory/style-hook-memory";
import { snapshotUsage } from "@/lib/llm/usage-tracker";

type PersistedState = {
  sessions: Record<string, SessionRecord>;
  jobs: Record<string, JobRecord>;
  sessionJobs: Record<string, string[]>;
  shares: Record<string, ShareRecord>;
};

type SessionPayload = JobRecord["payload"];

declare global {
  // Process-local singleton maps for dev/runtime environments where modules can reload.
  var __CLAWVISUAL_SESSIONS__: Map<string, SessionRecord> | undefined;
  var __CLAWVISUAL_JOBS__: Map<string, JobRecord> | undefined;
  var __CLAWVISUAL_SESSION_JOBS__: Map<string, string[]> | undefined;
  var __CLAWVISUAL_SHARES__: Map<string, ShareRecord> | undefined;
  var __CLAWVISUAL_STATE_LOADED__: boolean | undefined;
}

const sessions = globalThis.__CLAWVISUAL_SESSIONS__ ?? new Map<string, SessionRecord>();
if (!globalThis.__CLAWVISUAL_SESSIONS__) {
  globalThis.__CLAWVISUAL_SESSIONS__ = sessions;
}

const jobs = globalThis.__CLAWVISUAL_JOBS__ ?? new Map<string, JobRecord>();
if (!globalThis.__CLAWVISUAL_JOBS__) {
  globalThis.__CLAWVISUAL_JOBS__ = jobs;
}

const sessionJobs = globalThis.__CLAWVISUAL_SESSION_JOBS__ ?? new Map<string, string[]>();
if (!globalThis.__CLAWVISUAL_SESSION_JOBS__) {
  globalThis.__CLAWVISUAL_SESSION_JOBS__ = sessionJobs;
}

const shares = globalThis.__CLAWVISUAL_SHARES__ ?? new Map<string, ShareRecord>();
if (!globalThis.__CLAWVISUAL_SHARES__) {
  globalThis.__CLAWVISUAL_SHARES__ = shares;
}

const STORE_DIR = join(process.cwd(), ".data");
const STORE_PATH = join(STORE_DIR, "clawvisual-store.json");
const STALE_FINALIZING_MAX_MS = 3 * 60 * 1000;
const STALE_RUNNING_MAX_MS = 30 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function buildDefaultSessionTitle(index: number): string {
  return `Session ${index}`;
}

function isDefaultSessionTitle(title: string): boolean {
  return /^Session\s+\d+$/i.test(title.trim());
}

function sanitizeTitle(value: string, maxLength = 40): string {
  const normalized = value
    .replace(/\s+/g, " ")
    .replace(/\[[^\]]*]/g, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  if (!normalized) return "";
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function buildFallbackIntentTitle(inputText: string): string {
  const withoutUrl = inputText
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[#*_>`~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!withoutUrl) {
    const urlMatch = inputText.match(/https?:\/\/\S+/i)?.[0] ?? "";
    if (urlMatch) {
      try {
        const host = new URL(urlMatch).hostname.replace(/^www\./, "");
        return sanitizeTitle(`Analyze ${host}`);
      } catch {
        return "Content Session";
      }
    }
    return "Content Session";
  }

  return sanitizeTitle(withoutUrl, 34);
}

async function inferIntentTitleWithLlm(inputText: string, outputLanguage: string): Promise<string | null> {
  const inferred = await callGenericLlmJson<{ title?: string }>({
    instruction:
      "Infer user intent and generate one concise session title for conversation history. Keep it specific and actionable, 3-8 words, no punctuation at end.",
    input: {
      user_input: inputText
    },
    outputSchemaHint: '{"title":"AI Skills for Content Transformation"}',
    outputLanguage,
    temperature: 0
  });

  const title = sanitizeTitle(String(inferred?.title ?? ""), 40);
  return title || null;
}

function toRequest(payload: SessionPayload): ConversionRequest {
  return {
    inputText: payload.inputText,
    targetSlides: payload.targetSlides,
    aspectRatios: payload.aspectRatios,
    tone: payload.tone,
    outputLanguage: payload.outputLanguage,
    generationMode: payload.generationMode,
    reviewMode: payload.reviewMode,
    brand: {
      stylePreset: payload.stylePreset
    }
  };
}

function toObject<T>(map: Map<string, T>): Record<string, T> {
  return Object.fromEntries(map.entries());
}

function fromObject<T>(value: Record<string, T> | undefined): Map<string, T> {
  if (!value) return new Map<string, T>();
  return new Map<string, T>(Object.entries(value));
}

function persistState(): boolean {
  // Best-effort persistence: failures are non-fatal and should not crash request handling.
  try {
    mkdirSync(STORE_DIR, { recursive: true });
    const payload: PersistedState = {
      sessions: toObject(sessions),
      jobs: toObject(jobs),
      sessionJobs: toObject(sessionJobs),
      shares: toObject(shares)
    };
    writeFileSync(STORE_PATH, JSON.stringify(payload), "utf-8");
    return true;
  } catch (error) {
    console.warn("[job-store] persistState failed:", error instanceof Error ? error.message : String(error));
    return false;
  }
}

function loadStateIfNeeded(): void {
  // Idempotent bootstrap from disk into in-memory maps.
  if (globalThis.__CLAWVISUAL_STATE_LOADED__) {
    return;
  }
  globalThis.__CLAWVISUAL_STATE_LOADED__ = true;

  try {
    const raw = readFileSync(STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as PersistedState;

    for (const [id, session] of fromObject(parsed.sessions)) {
      sessions.set(id, session);
    }
    for (const [id, job] of fromObject(parsed.jobs)) {
      jobs.set(id, job);
    }
    for (const [id, list] of fromObject(parsed.sessionJobs)) {
      sessionJobs.set(id, Array.isArray(list) ? list : []);
    }
    for (const [id, share] of fromObject(parsed.shares)) {
      shares.set(id, share);
    }

    for (const [id, job] of jobs.entries()) {
      let changed = false;
      const normalized: JobRecord = { ...job };

      if (!normalized.baseJobId) {
        normalized.baseJobId = id;
        changed = true;
      }
      if (!normalized.revision || normalized.revision < 1) {
        normalized.revision = 1;
        changed = true;
      }
      if (!normalized.mode) {
        normalized.mode = "generate";
        changed = true;
      }
      if (!Array.isArray(normalized.artifacts)) {
        normalized.artifacts = [];
        changed = true;
      }

      if (changed) {
        jobs.set(id, normalized);
      }
    }
  } catch {
    // Ignore missing or malformed persisted file and start fresh.
  }
}

loadStateIfNeeded();

function patchJob(id: string, patch: Partial<JobRecord>): void {
  const current = jobs.get(id);
  if (!current) return;
  jobs.set(id, { ...current, ...patch, updatedAt: nowIso() });
  persistState();
}

function recoverJobStateIfNeeded(id: string): JobRecord | null {
  // Auto-heal stale/inconsistent jobs (e.g. process restart during finalization).
  const current = jobs.get(id);
  if (!current) return null;

  const now = Date.now();
  const updatedAtMs = new Date(current.updatedAt).getTime();
  const ageMs = Number.isFinite(updatedAtMs) ? Math.max(0, now - updatedAtMs) : STALE_RUNNING_MAX_MS + 1;

  let next: JobRecord | null = null;

  if (current.result) {
    if (current.status !== "completed" || current.stage !== "completed" || current.progress < 100) {
      next = {
        ...current,
        status: "completed",
        stage: "completed",
        progress: 100,
        error: undefined,
        updatedAt: nowIso()
      };
    }
  } else if (current.status === "completed") {
    next = {
      ...current,
      status: "failed",
      stage: "failed",
      progress: 100,
      error: current.error ?? "Task finished without result payload. Likely interrupted before final write.",
      updatedAt: nowIso()
    };
  } else if ((current.status === "running" || current.status === "queued") && ageMs >= STALE_RUNNING_MAX_MS) {
    const finalizingStuck = current.progress >= 100 && ageMs >= STALE_FINALIZING_MAX_MS;
    next = {
      ...current,
      status: "failed",
      stage: "failed",
      progress: Math.max(current.progress, finalizingStuck ? 100 : current.progress),
      error: current.error
        ?? (finalizingStuck
          ? "Task was stuck at finalization and has been auto-recovered as failed."
          : "Task exceeded stale timeout and has been auto-recovered as failed."),
      updatedAt: nowIso()
    };
  }

  if (!next) {
    return current;
  }

  jobs.set(id, next);
  return next;
}

function appendEvent(id: string, event: JobEvent): void {
  const current = jobs.get(id);
  if (!current) return;
  jobs.set(id, { ...current, events: [...current.events, event], updatedAt: nowIso() });
  persistState();
}

function ensureSession(sessionId?: string, title?: string): SessionRecord {
  const id = sessionId?.trim() || randomUUID();
  const existing = sessions.get(id);
  if (existing) {
    return existing;
  }

  const sessionIndex = sessions.size + 1;
  const created: SessionRecord = {
    id,
    title: title?.trim() || buildDefaultSessionTitle(sessionIndex),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  sessions.set(id, created);
  persistState();
  return created;
}

function updateSessionMeta(sessionId: string, patch: Partial<SessionRecord>): void {
  const existing = sessions.get(sessionId);
  if (!existing) return;
  sessions.set(sessionId, {
    ...existing,
    ...patch,
    updatedAt: nowIso()
  });
  persistState();
}

function updateSessionTitleFromIntent(sessionId: string, title: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;

  const nextTitle = sanitizeTitle(title, 40);
  if (!nextTitle) return;
  if (session.title === nextTitle) return;

  updateSessionMeta(sessionId, { title: nextTitle });
}

function maybeApplyFallbackTitle(sessionId: string, inputText: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;

  const fallback = buildFallbackIntentTitle(inputText);
  if (!fallback) return;
  if (!isDefaultSessionTitle(session.title) && session.title.trim().length > 0) {
    return;
  }
  updateSessionTitleFromIntent(sessionId, fallback);
}

function describeStage(stage: string): { title: string; thought: string; action: string } {
  const stageMap: Record<string, { title: string; thought: string; action: string }> = {
    skill_00_input_processor: {
      title: "parse user input",
      thought: "Classify whether input is text, url, or mixed text+url before downstream skills.",
      action: "Use LLM-based parser, fetch URL markdown, and output normalized pure text."
    },
    skill_01_distiller: {
      title: "distill core ideas",
      thought: "Find the smallest set of high-signal points from long-form content.",
      action: "Extract 1-8 core points and remove redundant details."
    },
    skill_14_source_grounder: {
      title: "ground sources",
      thought: "Evidence quality should be checked before copy and visual generation.",
      action: "Collect and rank source references by credibility and relevance."
    },
    skill_02_hook_architect: {
      title: "generate hooks",
      thought: "The first slide needs click-worthy title candidates for social distribution.",
      action: "Create multiple hook styles: controversy, question, and benefit-led."
    },
    skill_03_script_splitter: {
      title: "split storyboard",
      thought: "Each card must stay short and readable while preserving narrative flow.",
      action: "Split content into ordered slide scripts with compact wording."
    },
    skill_04_metaphorist: {
      title: "map metaphors",
      thought: "Abstract statements should be turned into concrete visual anchors.",
      action: "Attach one visual metaphor prompt per slide."
    },
    skill_05_layout_selector: {
      title: "choose layouts",
      thought: "Different semantics require different spatial structures.",
      action: "Select template types like cover, list, steps, quote, or data."
    },
    skill_06_hierarchy_mapper: {
      title: "define hierarchy",
      thought: "Typography weight and scale depend on semantic hierarchy labels.",
      action: "Generate heading/subheading/body and highlight keywords."
    },
    skill_07_style_mapper: {
      title: "apply style system",
      thought: "Slides must remain visually consistent across the full set.",
      action: "Build theme tokens from style preset and optional brand palette."
    },
    skill_13_style_recommender: {
      title: "recommend visual style",
      thought: "Source topic should drive a coherent visual language before image prompt generation.",
      action: "Infer domain and recommend global style preset, tone, and positive/negative style keywords."
    },
    skill_08_asset_generator: {
      title: "generate assets",
      thought: "Background imagery should reinforce the message without reducing readability.",
      action: "Generate image prompts and produce per-slide asset URLs."
    },
    skill_09_typographer: {
      title: "compose layout",
      thought: "Text and visuals need safe-area composition for final readability.",
      action: "Compose slide payloads with heading/body and selected template."
    },
    skill_10_auto_resizer: {
      title: "resize formats",
      thought: "Output needs cross-platform ratios for social distribution.",
      action: "Adapt all slides into 4:5, 1:1, and 9:16 variants."
    },
    skill_11_attention_auditor: {
      title: "audit attention",
      thought: "Before export, check readability, overlap risk, and contrast.",
      action: "Score each slide and flag high-risk readability cards."
    },
    skill_16_attention_fixer: {
      title: "repair readability",
      thought: "Risky slides should be regenerated with stronger contrast-safe composition.",
      action: "Apply overlay/contrast fixes and regenerate affected images."
    },
    skill_15_trend_miner: {
      title: "mine trend tags",
      thought: "Distribution quality depends on current topic tags, not static hashtags.",
      action: "Infer momentum tags from external signals and source context."
    },
    skill_12_viral_optimizer: {
      title: "optimize CTA",
      thought: "A strong CTA increases saves, comments, and share behavior.",
      action: "Generate final conversion-oriented CTA copy."
    }
  };

  return (
    stageMap[stage] ?? {
      title: stage,
      thought: "Process the next stage in the conversion chain.",
      action: `Execute ${stage}.`
    }
  );
}

export function createSession(options?: { id?: string; title?: string }): SessionRecord {
  return ensureSession(options?.id, options?.title);
}

export function getSession(id: string): SessionRecord | null {
  return sessions.get(id) ?? null;
}

export function listSessions(): SessionRecord[] {
  return [...sessions.values()].sort((a, b) => {
    const left = new Date(a.updatedAt).getTime();
    const right = new Date(b.updatedAt).getTime();
    return right - left;
  });
}

export function renameSession(id: string, title: string): SessionRecord | null {
  const existing = sessions.get(id);
  if (!existing) return null;

  const nextTitle = sanitizeTitle(title, 80);
  if (!nextTitle) return null;

  const updated: SessionRecord = {
    ...existing,
    title: nextTitle,
    updatedAt: nowIso()
  };
  sessions.set(id, updated);
  persistState();
  return updated;
}

export function deleteSession(id: string): boolean {
  const exists = sessions.has(id);
  if (!exists) return false;

  const relatedJobIds = sessionJobs.get(id) ?? [];
  for (const jobId of relatedJobIds) {
    jobs.delete(jobId);
  }
  sessionJobs.delete(id);
  sessions.delete(id);

  for (const [shareId, share] of shares.entries()) {
    if (share.sessionId === id) {
      shares.delete(shareId);
    }
  }

  persistState();
  return true;
}

export function listSessionJobs(sessionId: string): JobRecord[] {
  const ids = sessionJobs.get(sessionId) ?? [];
  const collected = ids
    .map((id) => recoverJobStateIfNeeded(id))
    .filter((item): item is JobRecord => Boolean(item))
    .sort((a, b) => {
      const turnDelta = a.turnIndex - b.turnIndex;
      if (turnDelta !== 0) return turnDelta;
      const revisionDelta = (a.revision ?? 1) - (b.revision ?? 1);
      if (revisionDelta !== 0) return revisionDelta;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  return collected;
}

function pushProgressEventFactory(jobId: string) {
  let lastTick = Date.now();
  let eventIndex = 0;
  let previousProgress = 0;
  let previousTokenInput = 0;
  let previousTokenOutput = 0;
  let previousTokenTotal = 0;

  return (stage: string, progress: number, outputPreview?: string) => {
    // Emit timeline events with rough cost/token deltas for UI observability.
    const now = Date.now();
    const durationSec = Math.max(1, Math.round((now - lastTick) / 1000));
    lastTick = now;
    eventIndex += 1;
    const details = describeStage(stage);
    const delta = Math.max(1, progress - previousProgress);
    previousProgress = progress;
    const costUsd = Number((0.002 + delta * 0.0006).toFixed(3));
    const usage = snapshotUsage();
    const tokenInput = Math.max(0, usage.inputTokens - previousTokenInput);
    const tokenOutput = Math.max(0, usage.outputTokens - previousTokenOutput);
    const tokenTotal = Math.max(0, usage.totalTokens - previousTokenTotal);
    previousTokenInput = usage.inputTokens;
    previousTokenOutput = usage.outputTokens;
    previousTokenTotal = usage.totalTokens;

    appendEvent(jobId, {
      id: randomUUID(),
      index: eventIndex,
      stage,
      title: details.title,
      thought: details.thought,
      action: details.action,
      outputPreview: outputPreview?.trim() || undefined,
      durationSec,
      costUsd,
      tokenInput: tokenTotal > 0 ? tokenInput : undefined,
      tokenOutput: tokenTotal > 0 ? tokenOutput : undefined,
      tokenTotal: tokenTotal > 0 ? tokenTotal : undefined,
      createdAt: nowIso()
    });
  };
}

function parseFinalAuditScore(result: JobRecord["result"]): number | undefined {
  if (!result) return undefined;
  const log = [...result.skill_logs].reverse().find((item) => item.skill_name === "quality_final_audit");
  if (!log) return undefined;
  const text = String(log.output_preview ?? "");
  const matches = Array.from(text.matchAll(/avg=(\d{1,3})/g));
  if (!matches.length) return undefined;
  const last = matches[matches.length - 1];
  const score = Number(last?.[1]);
  if (!Number.isFinite(score)) return undefined;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function createJobRecord(params: {
  id: string;
  sessionId: string;
  turnIndex: number;
  revision: number;
  mode: JobRecord["mode"];
  payload: SessionPayload;
  baseJobId: string;
  parentJobId?: string;
  revisionIntent?: JobRecord["revisionIntent"];
}): JobRecord {
  return {
    id: params.id,
    sessionId: params.sessionId,
    turnIndex: params.turnIndex,
    revision: params.revision,
    mode: params.mode,
    baseJobId: params.baseJobId,
    parentJobId: params.parentJobId,
    revisionIntent: params.revisionIntent,
    payload: params.payload,
    status: "queued",
    progress: 0,
    stage: "queued",
    events: [],
    rerunPlan: undefined,
    changedArtifacts: [],
    artifacts: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function getBaseSourceText(job: JobRecord): string {
  return job.payload.sourceInputText ?? job.payload.inputText;
}

function findLastRevisionForBase(sessionId: string, baseJobId: string, turnIndex: number): JobRecord | null {
  const all = listSessionJobs(sessionId).filter(
    (item) => (item.baseJobId || item.id) === baseJobId && item.turnIndex === turnIndex
  );
  if (!all.length) return null;
  const sorted = all.sort((a, b) => (b.revision ?? 1) - (a.revision ?? 1));
  return sorted.find((item) => Boolean(item.result)) ?? sorted[0] ?? null;
}

export function createJob(payload: SessionPayload, options?: { sessionId?: string }): JobRecord {
  // Create queued job record synchronously, then execute conversion asynchronously.
  const session = ensureSession(options?.sessionId);
  const existingIds = sessionJobs.get(session.id) ?? [];
  const turnIndex = existingIds.length + 1;
  const id = randomUUID();

  const job = createJobRecord({
    id,
    sessionId: session.id,
    turnIndex,
    revision: 1,
    mode: "generate",
    payload,
    baseJobId: id
  });

  jobs.set(id, job);
  sessionJobs.set(session.id, [...existingIds, id]);
  updateSessionMeta(session.id, { lastJobId: id });
  maybeApplyFallbackTitle(session.id, payload.inputText);
  persistState();

  void inferIntentTitleWithLlm(payload.inputText, payload.outputLanguage)
    .then((title) => {
      if (!title) return;
      updateSessionTitleFromIntent(session.id, title);
    })
    .catch(() => {
      // Ignore title inference failures and keep fallback title.
    });

  setTimeout(async () => {
    const pushStageEvent = pushProgressEventFactory(id);

    patchJob(id, { status: "running", stage: "starting", progress: 2 });
    try {
      const result = await runConversion(toRequest(payload), async (stage, progress, outputPreview) => {
        patchJob(id, { status: "running", stage, progress });
        pushStageEvent(stage, progress, outputPreview);
      });

      const artifacts = buildArtifactsForGenerate({
        result,
        inputText: payload.sourceInputText ?? payload.inputText,
        revision: 1,
        jobId: id,
        baseJobId: id
      });

      patchJob(id, {
        status: "completed",
        stage: "completed",
        progress: 100,
        result,
        artifacts
      });

      recordStyleHookMemory({
        sourceTitle: payload.inputText.slice(0, 90),
        sourceText: payload.sourceInputText ?? payload.inputText,
        hook: result.post_title,
        stylePreset: result.slides.find((slide) => slide.slide_id === 1)?.style_tag ?? payload.stylePreset,
        tone: payload.tone,
        score: parseFinalAuditScore(result)
      });
    } catch (error) {
      patchJob(id, {
        status: "failed",
        stage: "failed",
        progress: 100,
        error: error instanceof Error ? error.message : "Unknown processing error"
      });
    }
  }, 30);

  return job;
}

export function createRevisionJob(
  parentJobId: string,
  revisePayload: RevisePayload
): JobRecord | null {
  // Revisions keep the same turn index and increment revision number under the same base job.
  const parentJob = jobs.get(parentJobId);
  const parentResult = parentJob?.result;
  if (!parentJob || !parentResult) return null;

  const sourceText = getBaseSourceText(parentJob);
  const session = ensureSession(parentJob.sessionId);
  const baseJobId = parentJob.baseJobId || parentJob.id;
  const latest = findLastRevisionForBase(session.id, baseJobId, parentJob.turnIndex) ?? parentJob;
  const nextRevision = (latest.revision ?? 1) + 1;
  const id = randomUUID();

  const normalizedRevisePayload: RevisePayload = {
    ...revisePayload,
    sourceText,
    instruction: revisePayload.instruction.trim() || "Revise previous result",
    editableFields: revisePayload.editableFields,
    preserveFacts: revisePayload.preserveFacts,
    preserveSlideStructure: revisePayload.preserveSlideStructure,
    scope: {
      slideIds: revisePayload.scope.slideIds ?? [],
      fields: revisePayload.scope.fields ?? []
    },
    options: {
      ...revisePayload.options,
      preserveLayout: revisePayload.options.preserveLayout
    }
  };

  const displayInput = normalizedRevisePayload.instruction || `Revise ${normalizedRevisePayload.intent}`;
  const payload: SessionPayload = {
    ...parentJob.payload,
    inputText: displayInput,
    sourceInputText: sourceText,
    revisePayload: normalizedRevisePayload
  };

  const job = createJobRecord({
    id,
    sessionId: session.id,
    turnIndex: parentJob.turnIndex,
    revision: nextRevision,
    mode: "revise",
    payload,
    baseJobId,
    parentJobId: latest.id,
    revisionIntent: normalizedRevisePayload.intent
  });

  jobs.set(id, job);
  sessionJobs.set(session.id, [...(sessionJobs.get(session.id) ?? []), id]);
  updateSessionMeta(session.id, { lastJobId: id });
  persistState();

  const rerunPlan = planRerun(normalizedRevisePayload.intent, normalizedRevisePayload.options.preserveLayout);
  const pushStageEvent = pushProgressEventFactory(id);
  patchJob(id, {
    status: "running",
    stage: "revision_planning",
    progress: 0,
    rerunPlan
  });
  pushStageEvent("revision_planning", 0, rerunPlan.reason);

  setTimeout(async () => {
    try {
      patchJob(id, {
        status: "running",
        stage: "revision_executing",
        progress: 12
      });
      pushStageEvent("revision_executing", 12, rerunPlan.selectedSkills.join(", "));

      const previousResult = latest.result ?? parentResult;
      const engine = await runRevisionEngine({
        jobId: id,
        baseJobId,
        parentJobId: latest.id,
        revision: nextRevision,
        revise: normalizedRevisePayload,
        previousResult,
        previousArtifacts: latest.artifacts ?? [],
        outputLanguage: latest.payload.outputLanguage,
        generationMode: latest.payload.generationMode
      });

      patchJob(id, {
        status: "completed",
        stage: "completed",
        progress: 100,
        result: engine.result,
        artifacts: engine.artifacts,
        changedArtifacts: engine.changedArtifacts,
        rerunPlan: engine.rerunPlan
      });
    } catch (error) {
      patchJob(id, {
        status: "failed",
        stage: "failed",
        progress: 100,
        error: error instanceof Error ? error.message : "Revision failed"
      });
    }
  }, 30);

  return jobs.get(id) ?? job;
}

export function getJob(id: string): JobRecord | null {
  return recoverJobStateIfNeeded(id);
}

function isShareExpired(share: ShareRecord): boolean {
  if (!share.expiresAt) return false;
  return new Date(share.expiresAt).getTime() < Date.now();
}

export function createShare(
  sessionId: string,
  options?: { visibility?: SessionVisibility; expiresAt?: string }
): ShareRecord | null {
  const session = sessions.get(sessionId);
  if (!session) return null;

  const token = randomUUID().replace(/-/g, "");
  const share: ShareRecord = {
    id: randomUUID(),
    sessionId: session.id,
    token,
    visibility: options?.visibility ?? "public",
    expiresAt: options?.expiresAt,
    createdAt: nowIso()
  };

  shares.set(share.id, share);
  persistState();
  return share;
}

export function getShareByToken(token: string): ShareRecord | null {
  const normalized = token.trim();
  for (const share of shares.values()) {
    if (share.token !== normalized) continue;
    if (isShareExpired(share)) return null;
    return share;
  }
  return null;
}

export function serializeJob(job: JobRecord): {
  job_id: string;
  session_id: string;
  turn_index: number;
  revision: number;
  mode: JobRecord["mode"];
  base_job_id: string;
  parent_job_id?: string;
  revision_intent?: JobRecord["revisionIntent"];
  input_text: string;
  source_input_text?: string;
  status: JobStatus;
  progress: number;
  stage: string;
  events: JobEvent[];
  rerun_plan?: JobRecord["rerunPlan"];
  changed_artifacts?: string[];
  artifacts: JobRecord["artifacts"];
  error?: string;
  created_at: string;
  updated_at: string;
  result?: JobRecord["result"];
} {
  return {
    job_id: job.id,
    session_id: job.sessionId,
    turn_index: job.turnIndex,
    revision: job.revision ?? 1,
    mode: job.mode ?? "generate",
    base_job_id: job.baseJobId || job.id,
    parent_job_id: job.parentJobId,
    revision_intent: job.revisionIntent,
    input_text: job.payload.inputText,
    source_input_text: job.payload.sourceInputText,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    events: job.events,
    rerun_plan: job.rerunPlan,
    changed_artifacts: job.changedArtifacts,
    artifacts: job.artifacts ?? [],
    error: job.error,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
    result: job.result
  };
}

export function serializeSession(session: SessionRecord): {
  session_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_job_id?: string;
  jobs: ReturnType<typeof serializeJob>[];
} {
  return {
    session_id: session.id,
    title: session.title,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    last_job_id: session.lastJobId,
    jobs: listSessionJobs(session.id).map((job) => serializeJob(job))
  };
}

export function serializeSessionSummary(session: SessionRecord): {
  session_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_job_id?: string;
  job_count: number;
} {
  const jobCount = (sessionJobs.get(session.id) ?? []).length;
  return {
    session_id: session.id,
    title: session.title,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    last_job_id: session.lastJobId,
    job_count: jobCount
  };
}
