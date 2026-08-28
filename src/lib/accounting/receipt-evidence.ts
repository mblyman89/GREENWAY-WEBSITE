/**
 * src/lib/accounting/receipt-evidence.ts
 *
 * Answers ONE question, and answers it from the ledger rather than from an
 * opinion: **has a goods-receipt journal already been RAISED for this
 * delivery?**
 *
 * WHY THIS FILE EXISTS — it is the load-bearing half of closing D-61.
 * ------------------------------------------------------------------
 * `buildBillJournal` takes `goodsAlreadyReceived`. When false, a cannabis line
 * debits the category inventory account; when true it debits 20800 instead, so
 * the receipt and the bill net the clearing account to zero. Measured in
 * DEFECTS.md D-61 for one $150.00 delivery:
 *
 *     false ->  20010: 30000   20800: -15000   30000: -15000   (DOUBLE COUNT)
 *     true  ->  20010: 15000   20800:      0   30000: -15000   (correct)
 *
 * The flag defaults to FALSE, which is why books-79 recorded the defect as
 * "reachable BY OMISSION": a caller that simply forgets it capitalises every
 * delivery twice, and both journals look correct in isolation. Under §280E an
 * overstated inventory becomes an overstated COGS, which is the number an
 * examiner tests hardest.
 *
 * So the flag must not be something a caller remembers. It has to be DERIVED
 * from evidence. The contract in vendor-bill-core.ts is explicit that it is
 * true only when a receipt journal "ran and its entry reached the ledger" —
 * which is a fact recorded in `gl_journals`, not a state of mind.
 *
 * WHY NOT DERIVE IT FROM THE MANIFEST STATUS
 * ------------------------------------------
 * Because that is the exact substitution books-79 refused, and its mutation N4
 * catches. Migration 0059 lists manifest statuses as `pending | in_transit |
 * received | accepted | rejected | partially_accepted`. "accepted" is a
 * COMPLIANCE state — it says the traceability paperwork was accepted, not that
 * an accounting entry exists. A manifest can be accepted while the receipt
 * refused (an unrecognised category, D-64) and posted nothing at all. Reading
 * the status would then claim goods were capitalised when they were not, and
 * the bill would debit a clearing account that nothing ever credited, leaving a
 * permanent phantom balance in 20800.
 *
 * WHAT COUNTS AS EVIDENCE, AND WHY IT IS *NOT* `status = 'posted'`
 * ----------------------------------------------------------------
 * This is the correction books-83 had to make against the source, and it is
 * recorded as D-66 because the obvious reading is the wrong one.
 *
 * `gl_journals.status` is `draft | posted | reversed` (migration 0172), so
 * "has the receipt hit the books?" reads like `status = 'posted'`. It is not.
 * `receipt-service.ts#postManifestReceipt` calls `submitJournal` WITHOUT
 * `autoPost`, so `gl_submit_journal` receives `p_auto_post = false` and returns
 * at migration 0174 line 475 with `'status', 'draft'`. Even had it asked, a
 * `purchase` entry without a three-way match is refused automation outright
 * (0174 line 499). **Every goods receipt Greenway raises is therefore a DRAFT**
 * until a human approves it.
 *
 * A `posted`-only test would consequently answer "no receipt" for every real
 * delivery, hand the bill `goodsAlreadyReceived: false`, and reproduce D-61 in
 * full on every single manifest — while looking like the careful, conservative
 * choice. That is the trap this comment exists to keep shut.
 *
 * So the predicate is EXISTENCE, minus undoing:
 *   • `draft`    COUNTS. The entry is in the ledger and moves through the same
 *                approval queue the bill will. Both halves of the delivery are
 *                drafts together, so relieving 20800 keeps the pair consistent.
 *   • `posted`   COUNTS, obviously.
 *   • `reversed` DOES NOT. The debit was undone, so the goods are no longer
 *                capitalised and the bill must capitalise them itself.
 *
 * The residual risk is narrow and worth stating rather than hiding: a draft
 * receipt that a human never approves, paired with a bill that a human does.
 * That leaves a debit in 20800 with nothing crediting it. It is bounded by two
 * measured facts — a draft cannot silently disappear (no code path deletes from
 * `gl_journals`; only 0209's explicit factory reset does), and a residual 20800
 * balance is exactly the "shipments missing one half" worklist the account was
 * seeded to show (0173: "Received not invoiced, or invoiced not received.
 * Visible instead of absorbed."). A visible imbalance beats a silent double
 * count of inventory.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

/** The source-ref suffix `receipt-journal-core.ts` writes (its line 422). */
export const RECEIPT_REF_SUFFIX = "#receipt";

/**
 * Journal statuses that prove the goods were capitalised.
 *
 * Exported so the tests assert against the SAME list the query uses; a test
 * that retyped these strings would keep passing while the query drifted.
 */
export const RECEIPT_EVIDENCE_STATUSES = ["draft", "posted"] as const;

/**
 * Rebuild the receipt's source ref from the manifest, using the SAME rule
 * `receipt-service.ts` used when it posted: the manifest number when present,
 * otherwise `manifest:<id>`. Kept here as one exported function so the two
 * sides cannot drift into disagreeing about the key.
 */
export function receiptSourceRef(
  manifestNumber: string | null | undefined,
  manifestId: string,
): string {
  const base = (manifestNumber ?? "").trim() || `manifest:${manifestId}`;
  return `${base}${RECEIPT_REF_SUFFIX}`;
}

export type ReceiptEvidence =
  /** A receipt journal exists and stands. The bill must relieve 20800. */
  | { kind: "raised"; sourceRef: string; journalId: string; status: string }
  /** No receipt journal stands. The bill capitalises inventory itself. */
  | { kind: "absent"; sourceRef: string }
  /**
   * The question could not be answered. NOT the same as "absent" — guessing
   * "absent" on a read failure is precisely how the double count happens.
   */
  | { kind: "unknown"; sourceRef: string; reason: string };

/**
 * Look for a standing goods-receipt journal for this delivery.
 *
 * Returns `unknown` rather than `absent` when the ledger cannot be read. The
 * caller must refuse on `unknown`; defaulting it to `absent` would reintroduce
 * D-61 through the back door on any transient database error.
 */
export async function findReceiptJournal(
  manifestNumber: string | null | undefined,
  manifestId: string,
): Promise<ReceiptEvidence> {
  const sourceRef = receiptSourceRef(manifestNumber, manifestId);

  if (!isSupabaseServiceConfigured) {
    return {
      kind: "unknown",
      sourceRef,
      reason: "Supabase service credentials are not configured.",
    };
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("gl_journals")
    .select("id, status")
    .eq("source_ref", sourceRef)
    .in("status", [...RECEIPT_EVIDENCE_STATUSES])
    .limit(1);

  if (error) {
    return { kind: "unknown", sourceRef, reason: error.message };
  }

  const rows = (data as { id: string; status: string }[] | null) ?? [];
  if (rows.length === 0) return { kind: "absent", sourceRef };
  return { kind: "raised", sourceRef, journalId: rows[0].id, status: rows[0].status };
}
