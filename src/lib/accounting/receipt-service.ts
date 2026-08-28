/**
 * src/lib/accounting/receipt-service.ts   (books-81)
 *
 * THE WIRE. This is the file the census kept scoring `reachable: MISSING`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IT DOES, AND WHY IT IS THE NEXT SLICE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * books-78 built `buildReceiptJournal` and nothing called it. books-77 built
 * `buildSaleJournal`, which REFUSES with `UNIT_COST_UNKNOWN` whenever a lot has
 * no `unit_cost_minor_units` — and the only event that can legitimately write
 * that number is a goods receipt. So the largest number in the business (the
 * retail sale) was blocked behind a builder with no caller. This module is the
 * caller.
 *
 * Three things happen, in this order, and the order is the design:
 *
 *   1. READ the lots that arrived on a manifest and map each free-text
 *      category to a ledger account slug (`receipt-category-core`), refusing
 *      rather than guessing.
 *   2. POST the capitalisation entry — debit the category inventory accounts,
 *      credit 20800 Goods Received Not Invoiced — through the real SQL door
 *      (`posting-service#submitJournal`), which is what makes the database the
 *      final authority rather than this file.
 *   3. STAMP each lot's `unit_cost_minor_units`, which is what unblocks
 *      `buildSaleJournal`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE ORDERING DECISION, STATED BECAUSE IT IS A REAL RISK
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * There is no cross-system transaction available here: the journal is written
 * by a Postgres function through one RPC, and the lot costs are a separate
 * UPDATE. Something has to go first, and either order can be interrupted.
 *
 * POST FIRST, STAMP SECOND — chosen deliberately:
 *
 *   - If the post succeeds and the stamp fails, the books are correct and the
 *     lots are missing a cost. `buildSaleJournal` then REFUSES the sale with
 *     UNIT_COST_UNKNOWN. That is loud, immediate, and safe: nothing is
 *     mis-stated, somebody notices within a day, and re-running is harmless
 *     because the journal is idempotent on `entity:source_kind:source_ref`.
 *
 *   - The reverse order fails silently and expensively: lots would carry costs
 *     that no journal supports, sales would compute COGS off them, and the
 *     inventory account on the balance sheet would never agree with the lots
 *     underneath it. Nothing would refuse. The books would simply be wrong in a
 *     way that still balances.
 *
 * Standing rule 14 (when in doubt, refuse) applied to failure ORDER: prefer the
 * failure mode that stops the next transaction over the one that quietly
 * corrupts it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY IT REFUSES AS A UNIT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * If ANY lot on the manifest has an unrecognised category, nothing posts. A
 * partial receipt would capitalise some of a delivery and leave the rest
 * uncosted, and the difference would be invisible: the entry still balances,
 * 20800 is still credited, and the shortfall only surfaces when the vendor's
 * bill does not match. Refusing the whole delivery keeps the failure legible
 * and the fix cheap (add one table entry, receive again).
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { buildReceiptJournal, type ReceiptLineInput } from "./receipt-journal-core";
import { mapReceiptCategory } from "./receipt-category-core";
import { submitJournal } from "./posting-service";

/* ═══════════════════════════════════════════════════════════════════════════
 * 1) SHAPES
 * ═══════════════════════════════════════════════════════════════════════════ */

/** One lot as it comes out of the database. Only the columns that exist. */
export type ManifestLotRow = {
  readonly id: string;
  readonly lot_code: string | null;
  readonly category: string | null;
  readonly received_qty: number | null;
  readonly unit_cost_minor_units: number | null;
};

export const RECEIPT_SERVICE_CODES = [
  "RECEIPT_OK",
  "RECEIPT_NOT_CONFIGURED",
  "RECEIPT_MANIFEST_NOT_FOUND",
  "RECEIPT_NO_LOTS",
  "RECEIPT_CATEGORY_REFUSED",
  "RECEIPT_BUILD_REFUSED",
  "RECEIPT_POST_FAILED",
  "RECEIPT_COST_STAMP_FAILED",
  "RECEIPT_READ_FAILED",
] as const;
export type ReceiptServiceCode = (typeof RECEIPT_SERVICE_CODES)[number];

export type ReceiptServiceResult = {
  readonly ok: boolean;
  readonly code: ReceiptServiceCode;
  /** Plain English, written for Michael. */
  readonly message: string;
  readonly journalId: string | null;
  /** 'created' | 'duplicate' from the ledger, when it got that far. */
  readonly outcome: string | null;
  readonly totalCostCents: number | null;
  readonly quarantinedCostCents: number | null;
  readonly lotsCosted: number;
};

function fail(
  code: ReceiptServiceCode,
  message: string,
  extra?: Partial<ReceiptServiceResult>,
): ReceiptServiceResult {
  return {
    ok: false,
    code,
    message,
    journalId: null,
    outcome: null,
    totalCostCents: null,
    quarantinedCostCents: null,
    lotsCosted: 0,
    ...extra,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 2) THE PURE HALF — testable without a database
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Deliberately split out. The books-70 census finding was that a flawless pure
 * core with no caller posts nothing; the mirror-image mistake is a service so
 * entangled with I/O that its judgement cannot be tested at all. The decisions
 * live here; the round trips live below.
 */

export type LotTranslation =
  | { readonly kind: "ok"; readonly lines: readonly ReceiptLineInput[] }
  | {
      readonly kind: "refused";
      readonly code: "RECEIPT_CATEGORY_REFUSED" | "RECEIPT_NO_LOTS";
      readonly message: string;
    };

/**
 * Turn database rows into receipt lines, or refuse.
 *
 * A lot whose cost is already known still contributes its cost: re-receiving
 * the same manifest must produce the SAME journal, which the ledger then
 * recognises as a duplicate and ignores. Skipping already-costed lots would
 * produce a DIFFERENT, smaller journal on the second run — a different
 * fingerprint on the same source ref, which the ledger reports as a CONFLICT
 * rather than a duplicate. That is the idempotency trap described in
 * posting-core: the entry that quietly merges two events.
 */
export function translateLotsToReceiptLines(
  lots: readonly ManifestLotRow[],
): LotTranslation {
  if (lots.length === 0) {
    return {
      kind: "refused",
      code: "RECEIPT_NO_LOTS",
      message:
        "No lots are recorded against this manifest, so there is nothing to " +
        "capitalise. Add the lots that arrived, then mark it received.",
    };
  }

  const lines: ReceiptLineInput[] = [];
  const refusals: string[] = [];

  for (const lot of lots) {
    const mapping = mapReceiptCategory(lot.category);
    if (mapping.kind === "refused") {
      refusals.push(
        `lot ${lot.lot_code ?? lot.id}: ${mapping.explanation} ${mapping.resolution}`,
      );
      continue;
    }

    // `unknown` becomes a null slug, which the builder routes to quarantine
    // 20890 on purpose. `mapped` carries a slug already proven to exist.
    const categorySlug = mapping.kind === "mapped" ? mapping.slug : null;

    lines.push({
      categorySlug,
      // The builder validates these itself and refuses on a non-positive
      // quantity or an absent cost. They are passed through UNCHANGED rather
      // than defaulted here, so that its refusals stay the single source of
      // truth instead of being pre-empted by a quieter one in this file.
      quantityReceived: Number(lot.received_qty ?? 0),
      unitCostCents: lot.unit_cost_minor_units,
      lotCode: lot.lot_code,
    });
  }

  if (refusals.length > 0) {
    return {
      kind: "refused",
      code: "RECEIPT_CATEGORY_REFUSED",
      message:
        `Nothing was posted. ${refusals.length} lot(s) on this delivery have a ` +
        `product category the books do not recognise, and each category has its ` +
        `own inventory account — three of them are non-cannabis, so guessing ` +
        `would change the tax you owe. ${refusals.join(" ")}`,
    };
  }

  return { kind: "ok", lines };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 3) THE WIRE
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Capitalise a received manifest into the books and stamp its lot costs.
 *
 * Safe to call twice: the journal is keyed on `greenway:inventory:<ref>` and a
 * second call returns `duplicate` without writing anything, while the cost
 * stamp is an idempotent UPDATE to the same values.
 */
export async function postManifestReceipt(
  manifestId: string,
  receivedDateIso: string,
): Promise<ReceiptServiceResult> {
  if (!isSupabaseServiceConfigured) {
    return fail(
      "RECEIPT_NOT_CONFIGURED",
      "The books are not connected, so this delivery was not capitalised. The " +
        "delivery is still marked received; run it again once the connection is set up.",
    );
  }

  const admin = createSupabaseAdminClient();

  const { data: manifest, error: mErr } = await admin
    .from("inbound_manifests")
    .select("id, manifest_number, vendor_label")
    .eq("id", manifestId)
    .maybeSingle();

  if (mErr) {
    return fail("RECEIPT_READ_FAILED", `Could not read the manifest: ${mErr.message}`);
  }
  if (!manifest) {
    return fail(
      "RECEIPT_MANIFEST_NOT_FOUND",
      "That delivery could not be found, so nothing was posted to the books.",
    );
  }

  const { data: lotRows, error: lErr } = await admin
    .from("inventory_lots")
    .select("id, lot_code, category, received_qty, unit_cost_minor_units")
    .eq("manifest_id", manifestId);

  if (lErr) {
    return fail("RECEIPT_READ_FAILED", `Could not read the lots: ${lErr.message}`);
  }

  const lots = (lotRows ?? []) as ManifestLotRow[];
  const translated = translateLotsToReceiptLines(lots);
  if (translated.kind === "refused") {
    return fail(translated.code, translated.message);
  }

  // The manifest number is the natural key an auditor can follow back to the
  // paper. Falling back to the row id keeps the entry idempotent even when the
  // number was never captured.
  const receiptRef = (manifest.manifest_number ?? "").trim() || `manifest:${manifestId}`;

  const built = buildReceiptJournal({
    receivedDate: receivedDateIso,
    receiptRef,
    vendorName: (manifest.vendor_label ?? "").trim() || "Unknown vendor",
    lines: translated.lines,
  });

  if (built.kind === "refused") {
    return fail(
      "RECEIPT_BUILD_REFUSED",
      `Nothing was posted. ${built.explanation} ${built.resolution}`,
    );
  }

  // ── STEP 2: post first (see the ordering note at the top of this file) ──
  const posted = await submitJournal({
    entityCode: built.journal.entityCode,
    journalDate: built.journal.journalDate,
    sourceKind: built.journal.sourceKind,
    sourceRef: built.journal.sourceRef ?? receiptRef,
    memo: built.journal.memo,
    lines: built.journal.lines.map((l) => ({
      accountCode: l.accountCode,
      amountCents: l.amountCents,
      costClass: l.costClass,
      description: l.description ?? undefined,
    })),
  });

  if (!posted.ok) {
    return fail(
      "RECEIPT_POST_FAILED",
      `The books refused this delivery, so no cost was recorded: ${posted.message}`,
    );
  }

  // ── STEP 3: stamp the lot costs, which is what unblocks the first sale ──
  // Only lots that do not already carry the cost are written, so a re-run is a
  // no-op rather than a churn of updated_at timestamps.
  // The value written is the one the LEDGER used, taken from `built.lotCosts`
  // rather than re-read from the row, so the lot and the journal cannot drift.
  // A lot already carrying that exact value is skipped, so a re-run is a no-op
  // rather than a churn of updated_at timestamps.
  let lotsCosted = 0;
  const stampFailures: string[] = [];

  for (const entry of built.lotCosts) {
    const target = lots.find((l) => (l.lot_code ?? "") === entry.lotCode);
    if (!target) continue;
    if (target.unit_cost_minor_units === entry.unitCostCents) {
      lotsCosted += 1;
      continue;
    }
    const { error } = await admin
      .from("inventory_lots")
      .update({ unit_cost_minor_units: entry.unitCostCents })
      .eq("id", target.id);
    if (error) {
      stampFailures.push(`${entry.lotCode}: ${error.message}`);
    } else {
      lotsCosted += 1;
    }
  }

  if (stampFailures.length > 0) {
    return {
      ok: false,
      code: "RECEIPT_COST_STAMP_FAILED",
      message:
        "The delivery WAS capitalised into the books correctly, but the unit " +
        "cost could not be written back onto " +
        `${stampFailures.length} lot(s): ${stampFailures.join("; ")}. Sales of ` +
        "those lots will refuse until this is fixed, which is the safe way round " +
        "— nothing is mis-stated. Running the receive again is harmless.",
      journalId: posted.journalId,
      outcome: posted.outcome,
      totalCostCents: built.totalCostCents,
      quarantinedCostCents: built.quarantinedCostCents,
      lotsCosted,
    };
  }

  const dup = posted.outcome === "duplicate";
  return {
    ok: true,
    code: "RECEIPT_OK",
    message: dup
      ? "This delivery was already on the books, so nothing was posted twice."
      : `Delivery capitalised: ${built.splits.length} product line(s) added to ` +
        `inventory against Goods Received Not Invoiced.` +
        (built.quarantinedCostCents > 0
          ? ` ${built.quarantinedCostCents} cents sits in quarantine until those lots are categorised.`
          : ""),
    journalId: posted.journalId,
    outcome: posted.outcome,
    totalCostCents: built.totalCostCents,
    quarantinedCostCents: built.quarantinedCostCents,
    lotsCosted,
  };
}
