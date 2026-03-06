import { NextResponse } from "next/server";
import { z } from "zod";
import { validateApiKey } from "@/lib/auth/api-key";
import { createRevisionJob, getJob, listSessionJobs, serializeJob } from "@/lib/queue/job-store";
import { routeRevisionInstruction } from "@/lib/revision/router";
import type { RevisePayload } from "@/lib/types/job";

export const runtime = "nodejs";

const reviseSchema = z.object({
  intent: z.enum(["rewrite_copy_style", "regenerate_cover", "regenerate_slides"]).optional(),
  instruction: z.string().trim().min(1).optional(),
  instructions: z.string().trim().min(1).optional(),
  auto_route: z.boolean().optional(),
  scope: z
    .object({
      slide_ids: z.array(z.number().int().positive()).optional(),
      fields: z.array(z.string().trim().min(1)).optional()
    })
    .optional(),
  editable_fields: z.array(z.enum(["post_title", "post_caption", "hashtags", "slides"])).optional(),
  preserve_facts: z.boolean().optional(),
  preserve_slide_structure: z.boolean().optional(),
  options: z
    .object({
      seed: z.number().int().optional(),
      preserve_layout: z.boolean().optional(),
      mode: z.enum(["same_prompt_new_seed", "reprompt"]).optional()
    })
    .optional()
});

type ParsedReviseBody = z.infer<typeof reviseSchema>;

function normalizeRevisePayload(parsed: ParsedReviseBody, intent: RevisePayload["intent"]): RevisePayload {
  // Normalize optional request fields into a deterministic revision payload for the engine.
  const instruction = String(parsed.instructions ?? parsed.instruction ?? "").trim() || "Revise previous output";

  const editableFields: RevisePayload["editableFields"] =
    parsed.editable_fields && parsed.editable_fields.length
      ? parsed.editable_fields
      : intent === "rewrite_copy_style"
        ? ["post_title", "post_caption", "hashtags"]
        : ["slides"];

  const mode =
    parsed.options?.mode ??
    (intent === "rewrite_copy_style" ? "same_prompt_new_seed" : instruction ? "reprompt" : "same_prompt_new_seed");

  return {
    intent,
    instruction,
    sourceText: "",
    editableFields,
    preserveFacts: parsed.preserve_facts ?? true,
    preserveSlideStructure: parsed.preserve_slide_structure ?? true,
    scope: {
      slideIds: parsed.scope?.slide_ids ?? (intent === "regenerate_cover" ? [1] : []),
      fields: parsed.scope?.fields ?? []
    },
    options: {
      mode,
      seed: parsed.options?.seed,
      preserveLayout: parsed.options?.preserve_layout ?? true
    }
  };
}

function createClarificationResponse(payload: {
  sessionId: string;
  parentJobId: string;
  question: string;
  confidence: number;
  reason: string;
}) {
  return NextResponse.json({
    action: "ask_clarification",
    session_id: payload.sessionId,
    parent_job_id: payload.parentJobId,
    question: payload.question,
    route: {
      intent: "ask_clarification",
      confidence: payload.confidence,
      reason: payload.reason
    }
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  // 1) Validate auth + parent job readiness.
  const auth = validateApiKey(request.headers.get("x-api-key"));
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason ?? "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const parentJob = getJob(id);
  if (!parentJob) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (!parentJob.result) {
    return NextResponse.json({ error: "Job is not ready for revision yet" }, { status: 409 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = reviseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const requestPayload = parsed.data;
  const rawInstruction = String(requestPayload.instructions ?? requestPayload.instruction ?? "").trim();
  // Auto-route when explicit intent is absent (or caller opts in), otherwise use direct intent.
  const shouldAutoRoute = requestPayload.auto_route ?? !requestPayload.intent;

  let revisePayload: RevisePayload | null = null;

  if (requestPayload.intent && !shouldAutoRoute) {
    revisePayload = normalizeRevisePayload(requestPayload, requestPayload.intent);
  } else {
    // Route free-form instruction to an intent with context from recent session turns.
    const sessionJobs = listSessionJobs(parentJob.sessionId);
    const conversationSnippet = sessionJobs
      .slice(-10)
      .map((item) => ({
        turn: item.turnIndex,
        revision: item.revision ?? 1,
        input_text: item.payload.inputText
      }));

    const route = await routeRevisionInstruction({
      userInstruction: rawInstruction || parentJob.payload.inputText,
      sourceText: parentJob.payload.sourceInputText ?? parentJob.payload.inputText,
      previousOutput: parentJob.result,
      outputLanguage: parentJob.payload.outputLanguage,
      conversationSnippet
    });

    if (route.intent === "ask_clarification") {
      return createClarificationResponse({
        sessionId: parentJob.sessionId,
        parentJobId: id,
        question: route.clarificationQuestion ?? "你是想改文案风格，还是重生成封面/某一页图片？",
        confidence: route.confidence,
        reason: route.reason
      });
    }

    if (route.intent === "full_regenerate") {
      // Signal caller to trigger a new convert flow instead of in-place revision.
      const source = (parentJob.payload.sourceInputText ?? parentJob.payload.inputText).trim();
      const synthesized = `${source}\n\nRevision request: ${rawInstruction || "Create a full refreshed version."}`.trim();
      return NextResponse.json({
        action: "full_regenerate",
        session_id: parentJob.sessionId,
        parent_job_id: id,
        regenerate_input_text: synthesized,
        route
      });
    }

    revisePayload = {
      intent: route.intent,
      instruction: rawInstruction || "Apply revision based on route decision.",
      sourceText: "",
      editableFields: route.editableFields,
      preserveFacts: route.preserveFacts,
      preserveSlideStructure: route.preserveSlideStructure,
      scope: {
        slideIds: route.scope.slideIds,
        fields: route.scope.fields
      },
      options: {
        mode: route.options.mode,
        seed: route.options.seed,
        preserveLayout: route.options.preserveLayout
      }
    };
  }

  if (!revisePayload) {
    return NextResponse.json({ error: "Unable to resolve revision intent" }, { status: 400 });
  }

  const revision = createRevisionJob(id, revisePayload);
  if (!revision) {
    return NextResponse.json({ error: "Failed to create revision job" }, { status: 500 });
  }

  return NextResponse.json({
    action: "revised",
    revision_id: revision.id,
    session_id: revision.sessionId,
    parent_job_id: id,
    base_job_id: revision.baseJobId,
    turn_index: revision.turnIndex,
    revision: revision.revision,
    status_url: `/api/v1/jobs/${revision.id}`,
    changed_artifacts: revision.changedArtifacts ?? [],
    rerun_plan: revision.rerunPlan,
    job: serializeJob(revision)
  }, { status: 202 });
}
