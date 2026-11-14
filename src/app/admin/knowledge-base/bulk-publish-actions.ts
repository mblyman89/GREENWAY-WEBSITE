"use server";
/**
 * src/app/admin/knowledge-base/bulk-publish-actions.ts  (D244 round 6, slice R-19)
 *
 * Owner (verbatim): "I need a way to approve all of the 20,000 records
 * awaiting me in the kb data pipeline. The bronze, silver, gold page. The
 * majority of it is good data, but too much of it to go through one by one
 * with system wait time from thinking and such."
 *
 * One page (500 drafts by id) per call; the browser keeps calling with the
 * returned cursor until done. Each draft must meet the chosen quality bar and
 * pass the compliance scan (statutory patterns + the live banned-phrase
 * list); the rest stay drafts. Dry run ("Check first") changes nothing.
 * One audit row per page that published something. No AI call, no cron.
 */
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { checkCompliance } from "@/lib/ai/compliance";
import { loadBannedPhrases } from "@/lib/ai/kb/retrieval";
import { listKbDraftPage, publishKbDraftIds } from "@/lib/ai/kb/store";
import {
  KB_BULK_PAGE,
  chunkIds,
  cleanCursor,
  cleanMinQuality,
  cleanSourceGroup,
  emptyKbTotals,
  kbBulkDecide,
  kbScanText,
  type KbBulkTotals,
} from "@/lib/ai/kb/kb-bulk-review-core";

export type KbBulkPageResult = { totals: KbBulkTotals; nextCursor: string; done: boolean; error: string | null };

export async function kbBulkPublishPageAction(input: { cursor?: string; minQuality?: number; source?: string; dryRun?: boolean }): Promise<KbBulkPageResult> {
  const session = await requirePermission("products.enrich");
  const cursor = cleanCursor(input?.cursor);
  const minQuality = cleanMinQuality(input?.minQuality);
  const source = cleanSourceGroup(input?.source);
  const dryRun = input?.dryRun !== false;
  const totals = emptyKbTotals();

  const page = await listKbDraftPage(cursor, KB_BULK_PAGE);
  if (page.error) return { totals, nextCursor: cursor, done: true, error: `The drafts could not be read: ${page.error}` };
  if (page.rows.length === 0) return { totals, nextCursor: cursor, done: true, error: null };

  const banned = await loadBannedPhrases().catch(() => []);
  const pass: string[] = [];
  for (const r of page.rows) {
    totals.scanned += 1;
    const text = kbScanText(r);
    const complianceOk = text ? checkCompliance(text, banned).blockingFlags.length === 0 : true;
    const d = kbBulkDecide(r, { minQuality, source }, complianceOk);
    if (d.publish) pass.push(r.id);
    else totals[d.reason] += 1;
  }

  if (dryRun) totals.published = pass.length;
  else {
    for (const c of chunkIds(pass)) {
      try {
        totals.published += await publishKbDraftIds(c, session.profile.id);
      } catch {
        totals.failed += c.length;
      }
    }
    if (totals.published > 0) {
      await recordAudit({
        actorId: session.profile.id,
        action: "kb.bulk.publish_passing",
        entityType: "kb_products",
        after: { minQuality, source, scanned: totals.scanned, published: totals.published, kept: { quality: totals.quality, compliance: totals.compliance, empty: totals.empty, source: totals.source }, failed: totals.failed },
      }).catch(() => {});
    }
  }

  const last = page.rows[page.rows.length - 1].id;
  const done = page.rows.length < KB_BULK_PAGE;
  if (done && !dryRun) {
    revalidatePath("/admin/knowledge-base/pipeline");
    revalidatePath("/admin/knowledge-base/review");
  }
  return { totals, nextCursor: last, done, error: null };
}
