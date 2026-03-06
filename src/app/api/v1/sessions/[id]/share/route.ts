import { NextResponse } from "next/server";
import { z } from "zod";
import { validateApiKey } from "@/lib/auth/api-key";
import { createShare } from "@/lib/queue/job-store";

export const runtime = "nodejs";

const createShareSchema = z.object({
  visibility: z.enum(["private", "public"]).default("public"),
  expires_at: z.string().datetime().optional()
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = validateApiKey(request.headers.get("x-api-key"));
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason ?? "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsed = createShareSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const share = createShare(id, {
    visibility: parsed.data.visibility,
    expiresAt: parsed.data.expires_at
  });
  if (!share) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  return NextResponse.json({
    share_id: share.id,
    session_id: share.sessionId,
    share_token: share.token,
    share_url: `/share/${share.token}`,
    visibility: share.visibility,
    expires_at: share.expiresAt,
    created_at: share.createdAt
  });
}
