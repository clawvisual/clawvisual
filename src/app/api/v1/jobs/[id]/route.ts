import { NextResponse } from "next/server";
import { getJob, serializeJob } from "@/lib/queue/job-store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  // Read path param lazily (Next.js app router params are async in route handlers).
  const { id } = await context.params;
  const job = getJob(id);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json(serializeJob(job));
}
