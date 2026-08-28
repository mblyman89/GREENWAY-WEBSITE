/**
 * src/lib/accounting/vendor-bill-service.ts
 *
 * THE WIRE for the vendor bill (D-34), and the slice that finally closes D-61.
 *
 * WHAT EVENT THIS IS
 * ------------------
 * A delivery is finalised on the intake screen: the reviewer has accepted or
 * refused each lot, the accepted ones went live, and the manifest was stamped
 * `accepted` or `partially_accepted`. At that moment Greenway owes the vendor
 * money, so a payable belongs on the books.
 *
 * THERE IS NO SEPARATE BILL ENTITY, AND THAT IS DELIBERATE.
 * --------------------------------------------------------
 * The obvious design is a "enter a vendor bill" screen. This repo already
 * decided against it and the decision is written down in
 * `src/app/admin/vendor-payments/actions.ts`: a vendor payment "must now be
 * MARRIED to an ACCEPTED inbound manifest (the WCIA 'invoice')", and the amount
 * owed for a manifest is `SUM(received_qty * unit_cost_minor_units)` over its
 * non-rejected lots. `/admin/books/bills` is a teaching page with no form.
 *
 * So the manifest IS the invoice, and this service reads the SAME arithmetic
 * `vendor-payables-store.ts#listVendorPayables` uses, including its exclusion
 * of `rejected` lots. Inventing a second definition of "what we owe" would let
 * the payable a screen shows and the payable the ledger carries disagree, which
 * is the drift the census exists to catch.
 *
 * WHY THE FLAG IS NOT A PARAMETER
 * -------------------------------
 * `buildBillJournal`'s `goodsAlreadyReceived` decides whether a cannabis line
 * debits inventory or relieves 20800. Passing it from a caller's memory is D-61
 * waiting to happen — it defaults to false, so forgetting it capitalises every
 * delivery TWICE and overstates the one deduction §280E allows. It is therefore
 * DERIVED from the ledger by `receipt-evidence.ts#findReceiptJournal`, and when
 * that evidence cannot be read this service REFUSES rather than assuming. See
 * D-66 for why the evidence test is existence-minus-reversal and not
 * `status = 'posted'`.
 *
 * ORDER OF OPERATIONS, AND WHY THE PHYSICAL FACT WINS
 * ---------------------------------------------------
 * Same shape as books-81's receiving wire: the finalize already happened and
 * stands. A refusal here never rolls back an acceptance, because the goods
 * really did arrive and putting the warehouse out of step with reality is how
 * people start working around the system. The refusal is surfaced, never
 * swallowed.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { submitJournal } from "@/lib/accounting/posting-service";
import { findReceiptJournal } from "@/lib/accounting/receipt-evidence";
import { mapReceiptCategory } from "@/lib/accounting/receipt-category-core";
import { classifyLotCost } from "@/lib/accounting/lot-cost-classification-core";
import {
  evaluateVendorBill,
  buildBillJournal,
  type VendorBillInput,
  type VendorBillLineInput,
} from "@/lib/accounting/vendor-bill-core";

/* ═══════════════════════════════════════════════════════════════════════════
 * 1) SHAPES
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Lot columns this service reads. Mirrors `vendor-payables-store.ts` exactly —
 * same columns, same `status` used for the same exclusion — so the payable on
 * the screen and the payable in the ledger are the same number by construction.
 */
export type BillLotRow = {
  readonly id: string;
  readonly lot_code: string | null;
  readonly category: string | null;
  readonly received_qty: number | null;
  readonly unit_cost_minor_units: number | null;
  readonly status: string | null;
  /**
   * D-72. A free trade sample (WAC 314-55-096) is LAWFULLY zero-cost. An
   * ordinary lot whose cost has not been keyed yet is UNKNOWN. Before this
   * column was read, `Number(null) || 0` collapsed those two into the same
   * number and the unpriced lot was silently dropped from the bill.
   */
  readonly is_sample: boolean | null;
};

/**
 * Lot statuses excluded from cost basis. Copied in VALUE from
 * `vendor-payables-store.ts#EXCLUDED_LOT_STATUSES`; a test asserts the two
 * files still agree, because a lot refused at the dock that we nonetheless
 * billed ourselves for is money invented out of nothing.
 */
export const BILL_EXCLUDED_LOT_STATUSES = new Set(["rejected"]);

export const VENDOR_BILL_SERVICE_CODES = [
  "BILL_OK",
  "BILL_NOT_CONFIGURED",
  "BILL_MANIFEST_NOT_FOUND",
  "BILL_NO_BILLABLE_LOTS",
  "BILL_LOT_COST_UNKNOWN",
  "BILL_CATEGORY_REFUSED",
  "BILL_RECEIPT_EVIDENCE_UNKNOWN",
  "BILL_READ_FAILED",
  "BILL_BUILD_REFUSED",
  "BILL_POST_FAILED",
] as const;
export type VendorBillServiceCode = (typeof VENDOR_BILL_SERVICE_CODES)[number];

export type VendorBillServiceResult = {
  readonly ok: boolean;
  readonly code: VendorBillServiceCode;
  /** Plain English, written for Michael. */
  readonly message: string;
  readonly journalId: string | null;
  readonly outcome: "created" | "duplicate" | null;
  /** What the vendor is owed, in cents, as posted. */
  readonly totalCents: number | null;
  /** True when the bill relieved 20800 instead of debiting inventory again. */
  readonly relievedInTransit: boolean;
};

function fail(
  code: VendorBillServiceCode,
  message: string,
): VendorBillServiceResult {
  return {
    ok: false,
    code,
    message,
    journalId: null,
    outcome: null,
    totalCents: null,
    relievedInTransit: false,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 2) THE PURE HALF — testable without a database
 * ═══════════════════════════════════════════════════════════════════════════ */

export type LotBillTranslation =
  | { readonly kind: "ok"; readonly lines: readonly VendorBillLineInput[]; readonly totalCents: number }
  | {
      readonly kind: "refused";
      readonly code:
        | "BILL_NO_BILLABLE_LOTS"
        | "BILL_LOT_COST_UNKNOWN"
        | "BILL_CATEGORY_REFUSED";
      readonly message: string;
    };

/**
 * Turn manifest lots into bill lines, or refuse.
 *
 * ONE LINE PER LOT, not one per category. The bill journal groups by account
 * anyway, and keeping the lot grain means a reviewer comparing the entry to the
 * vendor's paperwork sees the same rows they see on the manifest.
 *
 * The extended cost is `qty * unit`, the identical arithmetic
 * `vendor-payables-store.ts` uses. Both quantity and unit cost are integers in
 * practice, but `received_qty` is a plain number column, so the product is
 * rounded exactly as that store rounds it rather than truncated differently
 * here — two roundings of the same money that disagree is a reconciliation
 * nobody can close.
 *
 * A category the books do not recognise REFUSES the whole bill. It does not
 * quarantine, and that asymmetry with the receipt is deliberate: the receipt
 * has somewhere honest to put an unknown category (20890, visible), whereas a
 * bill that quarantines a line would credit A/P for money whose §280E character
 * is unknown. D-64 is the underlying defect; this refuses rather than guesses.
 */
export function translateLotsToBillLines(
  lots: readonly BillLotRow[],
): LotBillTranslation {
  const billable = lots.filter(
    (l) => !BILL_EXCLUDED_LOT_STATUSES.has((l.status ?? "").toLowerCase()),
  );

  if (billable.length === 0) {
    return {
      kind: "refused",
      code: "BILL_NO_BILLABLE_LOTS",
      message:
        "Every lot on this delivery was refused at the dock, so there is nothing " +
        "to owe the vendor and no bill was recorded. That is the correct outcome " +
        "for a fully rejected manifest.",
    };
  }

  const lines: VendorBillLineInput[] = [];
  const refusals: string[] = [];
  /** D-72: lots that are lawfully free (samples) — never a missing cost. */
  const sampleLots: string[] = [];
  /** D-72: lots whose cost is UNKNOWN — the bill must refuse, never guess. */
  const unpricedLots: string[] = [];
  let total = 0;
  let lineNo = 0;

  for (const lot of billable) {
    const mapping = mapReceiptCategory(lot.category);
    if (mapping.kind === "refused") {
      refusals.push(`lot ${lot.lot_code ?? lot.id}: ${mapping.explanation} ${mapping.resolution}`);
      continue;
    }
    // `unknown` means intake never captured a category at all. The bill engine
    // BLOCKS on that (BILL_CANNABIS_NO_CATEGORY) rather than posting it, which
    // is what we want — so it is passed through as null and the engine's own
    // refusal stands, instead of being pre-empted by a quieter one here.
    const categorySlug = mapping.kind === "mapped" ? mapping.slug : null;

    // ── D-72: WHY the cost is zero decides everything ───────────────────
    // `Number(null) || 0` used to answer "how much?" without ever asking
    // "do we KNOW?". A free trade sample and a lot nobody has keyed the
    // invoice price for both came out 0, and both were dropped. Dropping a
    // sample is correct. Dropping an unpriced purchase understates A/P AND
    // inventory, and understated inventory is understated COGS, which under
    // 280E is OVERSTATED taxable income. Michael would overpay, and the
    // entry would still balance, so nothing would look wrong.
    // The verdict comes from the SHARED core so the payables screen and this
    // ledger posting can never disagree about what a lot costs.
    const costClass = classifyLotCost(lot);

    if (costClass === "sample") {
      // Lawfully free. It carries no money, so it belongs on no bill. It is
      // NOT a missing cost and must never be reported as one.
      sampleLots.push(lot.lot_code ?? lot.id);
      continue;
    }

    if (costClass === "unpriced") {
      unpricedLots.push(lot.lot_code ?? lot.id);
      continue;
    }

    const qty = Number(lot.received_qty) || 0;
    const unit = Number(lot.unit_cost_minor_units);
    const extended = Math.round(qty * unit);
    if (extended === 0) continue; // a known, genuinely zero line moves no money

    lineNo += 1;
    total += extended;
    lines.push({
      lineNo,
      purchaseKindCode: "cannabis_product",
      amountCents: extended,
      description: lot.lot_code ? `Lot ${lot.lot_code}` : null,
      categorySlug,
    });
  }

  if (refusals.length > 0) {
    return {
      kind: "refused",
      code: "BILL_CATEGORY_REFUSED",
      message:
        `Nothing was recorded. ${refusals.length} lot(s) on this delivery have a ` +
        `product category the books do not recognise, and each category has its ` +
        `own inventory account — three of them are non-cannabis, so guessing ` +
        `would change the tax you owe. ${refusals.join(" ")}`,
    };
  }

  // D-72: an UNKNOWN cost refuses the WHOLE bill, before any partial posts.
  // This is checked ahead of the empty-lines case because a manifest that is
  // half priced and half unpriced would otherwise post the priced half and
  // look perfectly balanced while understating what we owe.
  if (unpricedLots.length > 0) {
    const priced = lines.length;
    return {
      kind: "refused",
      code: "BILL_LOT_COST_UNKNOWN",
      message:
        `Nothing was recorded. ${unpricedLots.length} lot(s) on this delivery ` +
        `have no unit cost yet: ${unpricedLots.join(", ")}. The cost is on the ` +
        `vendor's invoice or the JSON, not always on the manifest. ` +
        (priced > 0
          ? `${priced} other lot(s) here ARE priced, and recording only those ` +
            `would understate both the payable and the inventory value — which ` +
            `understates cost of goods sold and overstates the tax owed. So the ` +
            `whole bill waits. `
          : "") +
        `Key the unit costs, then finalize again. (If any of these were free ` +
        `trade samples, mark them as samples at intake and they will be ` +
        `excluded instead.)`,
    };
  }

  if (lines.length === 0) {
    // Every remaining lot was a lawful free sample. That is a COMPLETE and
    // correct outcome, not a missing cost, so it must not tell Michael to go
    // find prices that do not exist.
    if (sampleLots.length > 0) {
      return {
        kind: "refused",
        code: "BILL_NO_BILLABLE_LOTS",
        message:
          `No payable was recorded, and that is correct. All ` +
          `${sampleLots.length} lot(s) on this delivery are free trade samples ` +
          `(${sampleLots.join(", ")}), so nothing is owed to the vendor. The ` +
          `goods are in inventory at zero cost and no bill is due.`,
      };
    }
    return {
      kind: "refused",
      code: "BILL_NO_BILLABLE_LOTS",
      message:
        "Every billable lot on this delivery carries a cost of zero, so there is " +
        "nothing to owe. Add the unit costs from the vendor's invoice, then " +
        "finalize again.",
    };
  }

  return { kind: "ok", lines, totalCents: total };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 3) THE WIRE
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Record the vendor's bill for an accepted manifest.
 *
 * Safe to call twice: the journal is keyed on the manifest number
 * (`billSourceRef` prefers it), so a second finalize returns `duplicate`
 * without writing anything.
 */
export async function postManifestVendorBill(
  manifestId: string,
  invoiceDateIso: string,
): Promise<VendorBillServiceResult> {
  if (!isSupabaseServiceConfigured) {
    return fail(
      "BILL_NOT_CONFIGURED",
      "The books are not connected, so no payable was recorded for this " +
        "delivery. The delivery is still accepted; run it again once the " +
        "connection is set up.",
    );
  }

  const admin = createSupabaseAdminClient();

  const { data: manifest, error: mErr } = await admin
    .from("inbound_manifests")
    .select("id, manifest_number, vendor_id, vendor_label")
    .eq("id", manifestId)
    .maybeSingle();

  if (mErr) {
    return fail("BILL_READ_FAILED", `Could not read the manifest: ${mErr.message}`);
  }
  if (!manifest) {
    return fail(
      "BILL_MANIFEST_NOT_FOUND",
      "That delivery could not be found, so no payable was recorded.",
    );
  }

  const { data: lotRows, error: lErr } = await admin
    .from("inventory_lots")
    .select("id, lot_code, category, received_qty, unit_cost_minor_units, status, is_sample")
    .eq("manifest_id", manifestId);

  if (lErr) {
    return fail("BILL_READ_FAILED", `Could not read the lots: ${lErr.message}`);
  }

  const translated = translateLotsToBillLines((lotRows ?? []) as BillLotRow[]);
  if (translated.kind === "refused") {
    return fail(translated.code, translated.message);
  }

  // ── D-61: ask the LEDGER whether the goods were already capitalised ──────
  // Not the manifest status, not a caller's flag, not an assumption. And on a
  // read failure this REFUSES: `unknown` coerced to "no receipt" would debit
  // inventory a second time on every transient database error, which is the
  // exact defect this slice closes.
  const evidence = await findReceiptJournal(manifest.manifest_number, manifestId);
  if (evidence.kind === "unknown") {
    return fail(
      "BILL_RECEIPT_EVIDENCE_UNKNOWN",
      "No payable was recorded, because the books could not confirm whether this " +
        "delivery's goods-receipt entry already exists. Recording the bill without " +
        "knowing that risks counting the same product into inventory twice, which " +
        `overstates cost of goods sold. Reason: ${evidence.reason}`,
    );
  }
  const goodsAlreadyReceived = evidence.kind === "raised";

  const invoiceNumber =
    (manifest.manifest_number ?? "").trim() || `manifest:${manifestId}`;

  const bill: VendorBillInput = {
    entityCode: "greenway",
    vendorName: (manifest.vendor_label ?? "").trim() || "Unknown vendor",
    vendorId: manifest.vendor_id ?? null,
    invoiceNumber,
    invoiceDate: invoiceDateIso,
    statedTotalCents: translated.totalCents,
    lines: translated.lines,
    fromAcceptedManifest: true,
    manifestNumber: manifest.manifest_number ?? null,
    goodsAlreadyReceived,
  };

  // The vendor supplied cannabis product on a state manifest, so the licensed
  // context is a fact of the transfer, not an assumption about the vendor.
  const verdict = evaluateVendorBill(bill, { vendorIsLicensedCannabis: true });
  const journal = buildBillJournal(bill, verdict);

  if (journal === null) {
    const blocks = verdict.findings
      .filter((f) => f.severity === "block")
      .map((f) => `${f.concern} ${f.fix}`)
      .join(" ");
    return fail(
      "BILL_BUILD_REFUSED",
      "No payable was recorded, because the books refused this bill: " +
        (blocks || "the bill was not postable."),
    );
  }

  const posted = await submitJournal({
    entityCode: journal.entityCode,
    journalDate: journal.journalDate,
    sourceKind: journal.sourceKind,
    sourceRef: journal.sourceRef,
    memo: journal.memo,
    lines: journal.lines.map((l) => ({
      accountCode: l.accountCode,
      amountCents: l.amountCents,
      costClass: l.costClass,
      description: l.description ?? undefined,
    })),
  });

  if (!posted.ok) {
    return fail(
      "BILL_POST_FAILED",
      `The books refused this payable, so nothing was recorded: ${posted.message}`,
    );
  }

  const dup = posted.outcome === "duplicate";
  return {
    ok: true,
    code: "BILL_OK",
    message: dup
      ? "This vendor bill was already on the books, so nothing was recorded twice."
      : goodsAlreadyReceived
        ? `Payable recorded: ${translated.lines.length} line(s) owed to the vendor. ` +
          "The goods were already capitalised when they arrived, so this entry " +
          "clears Goods Received Not Invoiced rather than adding the product to " +
          "inventory a second time."
        : `Payable recorded: ${translated.lines.length} line(s) owed to the vendor, ` +
          "and the product was added to inventory by this entry because no " +
          "goods-receipt entry exists for it.",
    journalId: posted.journalId,
    outcome: posted.outcome,
    totalCents: translated.totalCents,
    relievedInTransit: goodsAlreadyReceived,
  };
}
