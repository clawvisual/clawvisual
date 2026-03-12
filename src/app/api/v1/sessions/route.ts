import { NextResponse } from "next/server";
import { z } from "zod";
import { validateApiKey } from "@/lib/auth/api-key";
import { clearAllSessions, createSession, listSessions, serializeSession, serializeSessionSummary } from "@/lib/queue/job-store";

export const runtime = "nodejs";

const createSessionSchema = z.object({
  title: z.string().trim().min(1).max(120).optional()
});

export async function GET(request: Request) {
  const auth = validateApiKey(request.headers.get("x-api-key"));
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason ?? "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    sessions: listSessions().map((item) => serializeSessionSummary(item))
  });
}

export async function POST(request: Request) {
  const auth = validateApiKey(request.headers.get("x-api-key"));
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason ?? "Unauthorized" }, { status: 401 });
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsed = createSessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const session = createSession({ title: parsed.data.title });
  return NextResponse.json(serializeSession(session), { status: 201 });
}

export async function DELETE(request: Request) {
  const auth = validateApiKey(request.headers.get("x-api-key"));
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason ?? "Unauthorized" }, { status: 401 });
  }

  const summary = clearAllSessions();
  return NextResponse.json({
    ok: true,
    deleted_sessions: summary.deletedSessions,
    deleted_jobs: summary.deletedJobs
  });
}
