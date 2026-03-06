import { NextResponse } from "next/server";
import { z } from "zod";
import { validateApiKey } from "@/lib/auth/api-key";
import { runMultiModelAudit } from "@/lib/audit/multimodal-audit";

export const runtime = "nodejs";

const auditSchema = z.object({
  slides: z
    .array(
      z.object({
        slide_id: z.number().int().min(1),
        content_quote: z.string().min(1),
        image_url: z.string().min(1),
        visual_prompt: z.string().optional()
      })
    )
    .min(1)
    .max(8),
  models: z.array(z.string().min(1)).max(5).optional(),
  output_language: z.string().optional(),
  target_audience: z.string().optional(),
  platform: z.string().optional()
});

export async function POST(request: Request) {
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

  const parsed = auditSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const payload = parsed.data;
  const result = await runMultiModelAudit({
    slides: payload.slides,
    models: payload.models,
    outputLanguage: payload.output_language,
    targetAudience: payload.target_audience,
    platform: payload.platform
  });

  return NextResponse.json(result);
}
