import { NextResponse } from "next/server";
import { z } from "zod";
import { validateApiKey } from "@/lib/auth/api-key";
import { DEFAULT_NEGATIVE_PROMPT, generateNanoBananaImage } from "@/lib/images/nano-banana";

export const runtime = "nodejs";

const regenerateSchema = z.object({
  prompt: z.string().min(8, "prompt is too short"),
  aspect_ratio: z.enum(["4:5", "9:16", "1:1", "16:9"]).default("4:5"),
  negative_prompt: z.string().optional()
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

  const parsed = regenerateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const payload = parsed.data;
  const generated = await generateNanoBananaImage({
    prompt: payload.prompt,
    aspectRatio: payload.aspect_ratio,
    negativePrompt: payload.negative_prompt || DEFAULT_NEGATIVE_PROMPT
  });

  return NextResponse.json({
    image_url: generated.imageUrl,
    used_fallback: generated.usedFallback,
    provider: generated.provider,
    error: generated.error
  });
}
