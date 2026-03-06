import { NextResponse } from "next/server";
import { getShareByToken, getSession, serializeSession } from "@/lib/queue/job-store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  const share = getShareByToken(token);

  if (!share) {
    return NextResponse.json({ error: "Share not found or expired" }, { status: 404 });
  }

  if (share.visibility !== "public") {
    return NextResponse.json({ error: "Share is not publicly accessible" }, { status: 403 });
  }

  const session = getSession(share.sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  return NextResponse.json({
    share_token: share.token,
    visibility: share.visibility,
    expires_at: share.expiresAt,
    session: serializeSession(session)
  });
}
