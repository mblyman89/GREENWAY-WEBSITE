"use server";
/**
 * src/app/admin/products/bulk-ai/approve-actions.ts  (D244 round 4, slice R-12)
 *
 * Owner (verbatim): "on the bulk draft ai feature, to be able to select one or
 * all drafts waiting for me to approve. I want this page to auto approve the
 * ones that are over 80%. all 250 I am seeing in the list are 85%. so it
 * should be safe to approve these."
 *
 * The bar's two calls, made in small chunks by the browser so 250 products
 * never hit the time limit. Both need products.enrich; both run every draft
 * through the same compliance re-scan as one-by-one Accept; both write an
 * audit row per product. Neither publishes (a photo still does that).
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { writeBackOnPublish } from "@/lib/ai/kb/writeback";
import { acceptDraftWithEdit, acceptHighConfidenceForKey } from "@/lib/enrichment/accept-drafts-server";
import { ACCEPT_ALL_THRESHOLD } from "@/lib/enrichment/ai-draft-v2-core";
import { BULK_APPROVE_CHUNK, BULK_APPROVE_IDS_CHUNK, cleanApproveIds, cleanApproveKeys, emptyTotals, type ApproveTotals } from "@/lib/enrichment/bulk-approve-core";

/** One chunk of ticked products: each accepts its drafts at 80%+ (best guesses flagged). */
export async function approveProductsChunkAction(rawKeys: string[]): Promise<ApproveTotals> {
  const session = await requirePermission("products.enrich");
  const keys = cleanApproveKeys(rawKeys, BULK_APPROVE_CHUNK);
  const t = emptyTotals();
  for (const key of keys) {
    t.products += 1;
    const out = await acceptHighConfidenceForKey(key, session.userId).catch(() => null);
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
      after: { threshold: ACCEPT_ALL_THRESHOLD, via: "bulk-select", accepted: out.accepted, blocked: out.blocked, flagged_best_guesses: out.flagged, andPublish: false, kb_writeback: out.writeback ?? undefined },
    }).catch(() => {});
  }
  return t;
}

/** One chunk of single ticked drafts: each accepted as it is (a person chose it), through the compliance gate. */
export async function approveDraftsChunkAction(rawIds: string[]): Promise<ApproveTotals> {
  const session = await requirePermission("products.enrich");
  const ids = cleanApproveIds(rawIds, BULK_APPROVE_IDS_CHUNK);
  const t = emptyTotals();
  const keys = new Set<string>();
  for (const id of ids) {
    const out = await acceptDraftWithEdit(id, null, session.userId).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "failed", audit: undefined }));
    if (out.ok) {
      t.accepted += 1;
      keys.add(out.key);
    } else t.blocked += 1;
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: out.ok ? "product.bulk_ai_accepted" : "product.bulk_ai_accept_blocked",
      entityType: "product",
      entityId: out.ok ? out.key : null,
      after: out.ok ? { via: "bulk-select", ...out.audit } : { via: "bulk-select", suggestionId: id, error: out.error, ...(out.audit ?? {}) },
    }).catch(() => {});
  }
  for (const k of keys) await writeBackOnPublish(k, session.userId).catch(() => null);
  t.products = keys.size;
  return t;
}
