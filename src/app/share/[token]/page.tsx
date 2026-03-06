import { notFound, redirect } from "next/navigation";
import { getShareByToken } from "@/lib/queue/job-store";

export const dynamic = "force-dynamic";

export default async function SharePage(
  props: { params: Promise<{ token: string }> }
) {
  const { token } = await props.params;
  const share = getShareByToken(token);

  if (!share || share.visibility !== "public") {
    notFound();
  }

  redirect(`/thread/${encodeURIComponent(share.sessionId)}`);
}
