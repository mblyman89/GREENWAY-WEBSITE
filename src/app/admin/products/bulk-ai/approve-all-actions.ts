"use server";
/**
 * src/app/admin/products/bulk-ai/approve-all-actions.ts  (D244 round 6, slice R-18)
 *
 * Owner (verbatim): "I need a way to select many/ all and approve many/ all
 * drafts awaiting my review on the bulk ai draft page in enrichment."
 *
 * "Approve every draft" — any confidence, not only 80%+. The browser first
 * asks for every product key with a pending draft (read in pages, so it is not
 * capped at what the grid shows), then sends small chunks one after the next.
 * Every draft still goes through the same compliance re-scan as one-by-one
 * Accept; a potency best guess is never auto-accepted; one audit row per
 * product. Nothing is published (a photo still does that).
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { acceptHighConfidenceForKey, listPendingDraftKeys } from "@/lib/enrichment/accept-drafts-server";
import { BULK_APPROVE_CHUNK, cleanApproveKeys, emptyTotals, type ApproveTotals } from "@/lib/enrichment/bulk-approve-core";

/** Every product key with a pending all-fields draft (not capped at the grid). */
export async function listEveryPendingDraftKeyAction(): Promise<string[]> {
  await requirePermission("products.enrich");
  return listPendingDraftKeys().catch(() => []);
}

/** One chunk of products: each accepts every pending draft at any confidence, through the compliance gate. */
export async function approveEveryDraftChunkAction(rawKeys: string[]): Promise<ApproveTotals> {
  const session = await requirePermission("products.enrich");
  const keys = cleanApproveKeys(rawKeys, BULK_APPROVE_CHUNK);
  const t = emptyTotals();
  for (const key of keys) {
    t.products += 1;
    const out = await acceptHighConfidenceForKey(key, session.userId, 0).catch(() => null);
    if (!out || !out.ok) {
      t.failed += 1;
      continue;
    }
    t.accepted += out.accepted.length;
    t.blocked += out.blocked.length;
    t.flagged += out.flagged.length;
    if (out.eligible === 0) continue;
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "product.bulk_ai_accepted_all",
      entityType: "product",
      entityId: key,
      after: { threshold: 0, via: "bulk-approve-every", accepted: out.accepted, blocked: out.blocked, flagged_best_guesses: out.flagged, andPublish: false, kb_writeback: out.writeback ?? undefined },
    }).catch(() => {});
  }
  return t;
}
