"use server";

/**
 * src/app/admin/media/embed-actions.ts  (D244 R-4)
 *
 * The buttons of the "Semantic photo search" card on /admin/media. Each
 * needs media.manage and writes an audit row. None calls the AI: the
 * indexing itself runs on the idle tick of /api/cron/lookup-jobs.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { retryFailedEmbeddings, setMediaEmbedPaused } from "@/lib/media/media-embed-server";

const enc = encodeURIComponent;

/** Pause or resume the background indexer. */
export async function setMediaEmbedPausedAction(formData: FormData) {
  const session = await requirePermission("media.manage");
  const paused = String(formData.get("to") ?? "") === "paused";
  const r = await setMediaEmbedPaused(paused, session.userId);
  if (!r.ok) redirect(`/admin/media?error=${enc(r.error ?? "Could not change the indexer.")}`);
  await recordAudit({ actorId: session.userId, actorEmail: session.email, action: paused ? "media.embed_paused" : "media.embed_resumed", entityType: "site_setting", entityId: "media_embed_state", after: { paused } });
  revalidatePath("/admin/media");
  redirect(`/admin/media?saved=1`);
}

/** Put every photo that could not be indexed back in the queue. */
export async function retryFailedEmbeddingsAction() {
  const session = await requirePermission("media.manage");
  const r = await retryFailedEmbeddings(session.userId);
  if (!r.ok) redirect(`/admin/media?error=${enc(r.error ?? "Could not retry.")}`);
  await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "media.embed_retry_failed", entityType: "site_setting", entityId: "media_embed_state", after: { n: r.n } });
  revalidatePath("/admin/media");
  redirect(`/admin/media?saved=1&note=${enc(`${r.n} photo embedding(s) put back in the queue.`)}`);
}
