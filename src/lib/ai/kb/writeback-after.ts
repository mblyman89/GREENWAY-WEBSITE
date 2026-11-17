import "server-only";

/**
 * D247 (owner: "we have to speed it up so a button click does not hold us back"):
 * the KB writeback that follows Publish / Accept an AI suggestion is ~20 sequential
 * database round trips (strain, brand, category, potency columns, the kb_products
 * upsert). It is best-effort and drafts-only, and its result was only ever written
 * into the audit row, so nothing on the page waits for it. It now runs AFTER the
 * response (Next `after()` via runAfterResponse) and records its own audit row
 * (`product.kb_writeback`) with the result, so the trail is unchanged in content -
 * it is just a second row instead of a field on the first one.
 *
 * Callers that SHOW the writeback result (or that tests pin as inline, such as
 * attachKbMatchFacts) keep calling writeBackOnPublish directly.
 */
import { runAfterResponse } from "@/lib/after-response";
import { recordAudit } from "@/lib/auth/audit";
import { writeBackOnPublish } from "@/lib/ai/kb/writeback";

export const KB_WRITEBACK_AFTER_ACTION = "product.kb_writeback";

export function writeBackOnPublishAfterResponse(
  key: string,
  actor: { userId: string; email?: string | null },
  reason: string,
): void {
  runAfterResponse("kb-writeback", async () => {
    let writeback: Awaited<ReturnType<typeof writeBackOnPublish>> = null;
    let error: string | undefined;
    try {
      writeback = await writeBackOnPublish(key, actor.userId);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    await recordAudit({
      actorId: actor.userId,
      actorEmail: actor.email ?? undefined,
      action: KB_WRITEBACK_AFTER_ACTION,
      entityType: "product",
      entityId: key,
      after: { reason, background: true, kb_writeback: writeback ?? undefined, error },
    });
  });
}
