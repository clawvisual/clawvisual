import { NextResponse } from "next/server";
import { z } from "zod";
import { appConfig } from "@/lib/config";
import { validateApiKey } from "@/lib/auth/api-key";
import { createJob, createRevisionJob, getJob, serializeJob } from "@/lib/queue/job-store";
import { DEFAULT_NEGATIVE_PROMPT, generateNanoBananaImage } from "@/lib/images/nano-banana";
import type { RevisePayload } from "@/lib/types/job";

export const runtime = "nodejs";

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
};

type ToolCallRequest = {
  name: string;
  arguments?: unknown;
};

const convertArgsSchema = z.object({
  session_id: z.string().uuid().optional(),
  input_text: z.string().min(20),
  max_slides: z.number().int().min(1).max(8).optional(),
  target_slides: z.number().int().min(1).max(8).optional(),
  aspect_ratios: z.array(z.enum(["4:5", "9:16", "1:1"])).default(["4:5", "1:1"]),
  style_preset: z.string().default("auto"),
  tone: z.string().default("auto"),
  generation_mode: z.enum(["standard", "quote_slides"]).default("quote_slides"),
  output_language: z.string().default("en-US"),
  review_mode: z.enum(["auto", "required"]).default("auto")
}).transform((value) => ({
  ...value,
  max_slides: value.max_slides ?? value.target_slides ?? 8
}));

const jobStatusArgsSchema = z.object({
  job_id: z.string().min(1)
});

const reviseArgsSchema = z.object({
  job_id: z.string().min(1),
  intent: z.enum(["rewrite_copy_style", "regenerate_cover", "regenerate_slides"]).default("rewrite_copy_style"),
  instruction: z.string().trim().min(1).default("Refine output quality"),
  editable_fields: z.array(z.enum(["post_title", "post_caption", "hashtags", "slides"])).optional(),
  preserve_facts: z.boolean().default(true),
  preserve_slide_structure: z.boolean().default(true),
  slide_ids: z.array(z.number().int().positive()).optional(),
  fields: z.array(z.string().trim().min(1)).optional(),
  mode: z.enum(["same_prompt_new_seed", "reprompt"]).optional(),
  seed: z.number().int().optional(),
  preserve_layout: z.boolean().default(true)
});

const regenerateCoverArgsSchema = z.object({
  job_id: z.string().min(1).optional(),
  instruction: z.string().trim().min(1).optional(),
  prompt: z.string().trim().min(8).optional(),
  aspect_ratio: z.enum(["4:5", "9:16", "1:1"]).default("4:5"),
  negative_prompt: z.string().optional(),
  mode: z.enum(["same_prompt_new_seed", "reprompt"]).default("reprompt"),
  seed: z.number().int().optional()
});

const TOOL_DEFINITIONS = [
  {
    name: "convert",
    description: "Start long-text to short-carousel conversion and return job id.",
    inputSchema: {
      type: "object",
      required: ["input_text"],
      properties: {
        session_id: { type: "string", format: "uuid" },
        input_text: { type: "string", minLength: 20 },
        max_slides: {
          type: "integer",
          minimum: 1,
          maximum: 8,
          default: 8,
          description: "Maximum slide count. System auto-selects final slide count up to this cap."
        },
        target_slides: {
          type: "integer",
          minimum: 1,
          maximum: 8,
          default: 8,
          description: "Deprecated alias of max_slides for backward compatibility."
        },
        aspect_ratios: {
          type: "array",
          items: { type: "string", enum: ["4:5", "9:16", "1:1"] },
          default: ["4:5", "1:1"]
        },
        style_preset: { type: "string", default: "auto" },
        tone: { type: "string", default: "auto" },
        generation_mode: { type: "string", enum: ["standard", "quote_slides"], default: "quote_slides" },
        output_language: { type: "string", default: "en-US" },
        review_mode: { type: "string", enum: ["auto", "required"], default: "auto" }
      }
    }
  },
  {
    name: "job_status",
    description: "Get latest status and result of a conversion/revision job.",
    inputSchema: {
      type: "object",
      required: ["job_id"],
      properties: {
        job_id: { type: "string" }
      }
    }
  },
  {
    name: "revise",
    description: "Create a revision job for copy rewrite or image regeneration.",
    inputSchema: {
      type: "object",
      required: ["job_id", "instruction"],
      properties: {
        job_id: { type: "string" },
        intent: { type: "string", enum: ["rewrite_copy_style", "regenerate_cover", "regenerate_slides"] },
        instruction: { type: "string" },
        editable_fields: {
          type: "array",
          items: { type: "string", enum: ["post_title", "post_caption", "hashtags", "slides"] }
        },
        preserve_facts: { type: "boolean", default: true },
        preserve_slide_structure: { type: "boolean", default: true },
        slide_ids: { type: "array", items: { type: "integer" } },
        fields: { type: "array", items: { type: "string" } },
        mode: { type: "string", enum: ["same_prompt_new_seed", "reprompt"] },
        seed: { type: "integer" },
        preserve_layout: { type: "boolean", default: true }
      }
    }
  },
  {
    name: "regenerate_cover",
    description: "Regenerate cover either from an existing job or by direct prompt.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        instruction: { type: "string" },
        prompt: { type: "string", minLength: 8 },
        aspect_ratio: { type: "string", enum: ["4:5", "9:16", "1:1"], default: "4:5" },
        negative_prompt: { type: "string" },
        mode: { type: "string", enum: ["same_prompt_new_seed", "reprompt"], default: "reprompt" },
        seed: { type: "integer" }
      }
    }
  }
] as const;

function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data })
    }
  };
}

function toolResult(payload: unknown, isError = false) {
  // MCP tool responses include both text content and machine-readable structuredContent.
  return {
    content: [
      {
        type: "text",
        text: typeof payload === "string" ? payload : JSON.stringify(payload)
      }
    ],
    structuredContent: payload,
    isError
  };
}

function normalizeRevisePayload(input: z.infer<typeof reviseArgsSchema>): RevisePayload {
  // Normalize MCP args into internal revision payload consumed by createRevisionJob.
  return {
    intent: input.intent,
    instruction: input.instruction,
    sourceText: "",
    editableFields: input.editable_fields ?? (input.intent === "rewrite_copy_style" ? ["post_title", "post_caption", "hashtags"] : ["slides"]),
    preserveFacts: input.preserve_facts,
    preserveSlideStructure: input.preserve_slide_structure,
    scope: {
      slideIds: input.slide_ids ?? (input.intent === "regenerate_cover" ? [1] : []),
      fields: input.fields ?? []
    },
    options: {
      mode: input.mode ?? (input.intent === "rewrite_copy_style" ? "same_prompt_new_seed" : "reprompt"),
      seed: input.seed,
      preserveLayout: input.preserve_layout
    }
  };
}

async function handleToolCall(params: ToolCallRequest) {
  // Tool router for MCP methods exposed via tools/call.
  if (params.name === "convert") {
    const parsed = convertArgsSchema.safeParse(params.arguments ?? {});
    if (!parsed.success) {
      return toolResult({ error: "Invalid arguments", details: parsed.error.flatten() }, true);
    }

    const payload = parsed.data;
    const job = createJob(
      {
        inputText: payload.input_text,
        targetSlides: payload.max_slides,
        aspectRatios: payload.aspect_ratios,
        stylePreset: payload.style_preset,
        tone: payload.tone,
        outputLanguage: payload.output_language,
        generationMode: payload.generation_mode,
        reviewMode: payload.review_mode
      },
      { sessionId: payload.session_id }
    );

    return toolResult({
      job_id: job.id,
      session_id: job.sessionId,
      status_url: `/api/v1/jobs/${job.id}`
    });
  }

  if (params.name === "job_status") {
    const parsed = jobStatusArgsSchema.safeParse(params.arguments ?? {});
    if (!parsed.success) {
      return toolResult({ error: "Invalid arguments", details: parsed.error.flatten() }, true);
    }

    const job = getJob(parsed.data.job_id);
    if (!job) {
      return toolResult({ error: "Job not found", job_id: parsed.data.job_id }, true);
    }

    return toolResult(serializeJob(job));
  }

  if (params.name === "revise") {
    const parsed = reviseArgsSchema.safeParse(params.arguments ?? {});
    if (!parsed.success) {
      return toolResult({ error: "Invalid arguments", details: parsed.error.flatten() }, true);
    }

    const revision = createRevisionJob(parsed.data.job_id, normalizeRevisePayload(parsed.data));
    if (!revision) {
      return toolResult({ error: "Failed to create revision job. Ensure parent job exists and is completed." }, true);
    }

    return toolResult({
      revision_id: revision.id,
      session_id: revision.sessionId,
      parent_job_id: parsed.data.job_id,
      status_url: `/api/v1/jobs/${revision.id}`,
      job: serializeJob(revision)
    });
  }

  if (params.name === "regenerate_cover") {
    const parsed = regenerateCoverArgsSchema.safeParse(params.arguments ?? {});
    if (!parsed.success) {
      return toolResult({ error: "Invalid arguments", details: parsed.error.flatten() }, true);
    }

    if (parsed.data.job_id) {
      const revision = createRevisionJob(parsed.data.job_id, {
        intent: "regenerate_cover",
        instruction: parsed.data.instruction ?? "Regenerate cover with stronger first-glance impact.",
        sourceText: "",
        editableFields: ["slides"],
        preserveFacts: true,
        preserveSlideStructure: true,
        scope: {
          slideIds: [1],
          fields: ["image"]
        },
        options: {
          mode: parsed.data.mode,
          seed: parsed.data.seed,
          preserveLayout: true
        }
      });

      if (!revision) {
        return toolResult({ error: "Failed to create cover revision. Ensure parent job exists and is completed." }, true);
      }

      return toolResult({
        revision_id: revision.id,
        session_id: revision.sessionId,
        parent_job_id: parsed.data.job_id,
        status_url: `/api/v1/jobs/${revision.id}`,
        job: serializeJob(revision)
      });
    }

    if (!parsed.data.prompt) {
      return toolResult({ error: "Provide either job_id or prompt for regenerate_cover." }, true);
    }

    const generated = await generateNanoBananaImage({
      prompt: parsed.data.prompt,
      aspectRatio: parsed.data.aspect_ratio,
      negativePrompt: parsed.data.negative_prompt || DEFAULT_NEGATIVE_PROMPT,
      seed: parsed.data.seed
    });

    return toolResult({
      image_url: generated.imageUrl,
      used_fallback: generated.usedFallback,
      provider: generated.provider,
      error: generated.error
    });
  }

  return toolResult({ error: `Unknown tool: ${params.name}` }, true);
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export async function POST(request: Request) {
  // JSON-RPC transport endpoint: initialize, tools/list, tools/call.
  const auth = validateApiKey(request.headers.get("x-api-key"));
  if (!auth.ok) {
    return NextResponse.json(rpcError(null, -32001, auth.reason ?? "Unauthorized"), { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }

  const rpc = body as JsonRpcRequest;
  const id = rpc.id ?? null;

  if (!rpc || rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") {
    return NextResponse.json(rpcError(id, -32600, "Invalid Request"), { status: 400 });
  }

  if (rpc.method === "notifications/initialized") {
    return new NextResponse(null, { status: 204 });
  }

  if (rpc.method === "initialize") {
    // MCP handshake: advertise protocol version and server capabilities.
    return NextResponse.json({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: "clawvisual-mcp",
          version: appConfig.version
        }
      }
    });
  }

  if (rpc.method === "tools/list") {
    return NextResponse.json({
      jsonrpc: "2.0",
      id,
      result: {
        tools: TOOL_DEFINITIONS
      }
    });
  }

  if (rpc.method === "tools/call") {
    // Validate `tools/call` params envelope before dispatching to tool router.
    const paramsObj = asObject(rpc.params);
    if (!paramsObj || typeof paramsObj.name !== "string") {
      return NextResponse.json(rpcError(id, -32602, "Invalid params for tools/call"), { status: 400 });
    }

    const callResult = await handleToolCall({
      name: paramsObj.name,
      arguments: paramsObj.arguments
    });

    return NextResponse.json({
      jsonrpc: "2.0",
      id,
      result: callResult
    });
  }

  return NextResponse.json(rpcError(id, -32601, `Method not found: ${rpc.method}`), { status: 404 });
}

export async function GET() {
  return NextResponse.json({
    name: "clawvisual-mcp",
    endpoint: "/api/mcp",
    transport: "JSON-RPC over HTTP POST",
    methods: ["initialize", "tools/list", "tools/call"]
  });
}
