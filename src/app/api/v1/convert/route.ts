import { NextResponse } from "next/server";
import { z } from "zod";
import { validateApiKey } from "@/lib/auth/api-key";
import { DEFAULT_LANGUAGE, normalizeLanguage } from "@/lib/i18n/languages";
import { createJob } from "@/lib/queue/job-store";

export const runtime = "nodejs";

const convertSchema = z.object({
  session_id: z.string().uuid().optional(),
  input_text: z.string().min(20, "input_text should be at least 20 chars"),
  max_slides: z.number().int().min(1).max(8).optional(),
  target_slides: z.number().int().min(1).max(8).optional(),
  aspect_ratios: z.array(z.enum(["4:5", "9:16", "1:1", "16:9"])).default(["4:5", "1:1"]),
  style_preset: z.string().default("auto"),
  tone: z.string().default("auto"),
  output_language: z.string().trim().default(DEFAULT_LANGUAGE).transform((value) => normalizeLanguage(value)),
  generation_mode: z.enum(["standard", "quote_slides"]).default("quote_slides"),
  review_mode: z.enum(["auto", "required"]).default("auto")
}).transform((value) => ({
  ...value,
  // Keep backward compatibility: support either max_slides or target_slides.
  max_slides: value.max_slides ?? value.target_slides ?? 8
}));

export async function POST(request: Request) {
  // API key gate is enforced before any payload parsing or job allocation.
  const auth = validateApiKey(request.headers.get("x-api-key"));
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason ?? "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = convertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const payload = parsed.data;
  // createJob immediately returns a queued record; actual conversion runs asynchronously.
  const job = createJob({
    inputText: payload.input_text,
    targetSlides: payload.max_slides,
    aspectRatios: payload.aspect_ratios,
    stylePreset: payload.style_preset,
    tone: payload.tone,
    outputLanguage: payload.output_language,
    generationMode: payload.generation_mode,
    reviewMode: payload.review_mode
  }, { sessionId: payload.session_id });

  return NextResponse.json(
    {
      job_id: job.id,
      session_id: job.sessionId,
      status_url: `/api/v1/jobs/${job.id}`
    },
    { status: 202 }
  );
}
