/**
 * src/lib/compliance/ccrs-preflight-core.ts — CCRS bible slice S-02
 * (docs/ccrs-bible/09-slice-plan.md § S-02; closes Part 04 gaps E7–E13)
 *
 * PURE. No I/O, no Supabase, no Date.now(). Every function here takes plain
 * data and returns plain data so the whole pre-flight surface is unit-testable
 * and can run in the browser (the hub) and on the server (the zip route)
 * without divergence.
 *
 * WHY THIS FILE EXISTS
 * The LCB rejects an upload FILE-WIDE on a single bad row, and it reports the
 * rejection only by email to whoever uploaded it [FAQ L0102]. A row that will
 * be rejected is therefore worse than a missing row with a blocking error in
 * front of it — we must catch these BEFORE the zip is built.
 *
 * GROUND (verbatim, verified against lcb/guide.txt + lcb/faq.txt at the md5s
 * recorded in docs/ccrs-bible/13-sources.md):
 *   E7  [G L0614]  "TotalCost cannot equal 0"
 *       [FAQ L0035] "CCRS requires a value above $0.00 to be entered on the
 *                   Total Cost field for an inventory ID to be reported. While
 *                   the provided Trade Samples do not have a value, a value of
 *                   $0.01 needs to be entered into the Total Cost field for
 *                   Trade Samples. Please ensure you are including in the name
 *                   and Description: Trade Sample."
 *   E8  [G L0597]  "QuanityOnHand is greater than InitialQuantity"  (sic — the
 *                  guide misspells "Quantity"; quoted exactly as printed)
 *   E9  [G L0434]  "If Useable Cannabis is selected, Unit Weight Gram cannot be 0"
 *       [G L0489-L0490] "Note: required when InventoryType = Useable cannabis,
 *                  or Cannabis Mix Packaged All other product types weight can
 *                  be reported as 0"
 *   E10 [G L0482-L0483] "Note: required when inventorytype = Useable cannabis,
 *                  or Cannabis Mix Packaged"   ← the Description field
 *       [G L0480]  "Data Field Type (character limit): text (250)"
 *   E11 [G L0358]  "Strain name is invalid, cannot be Unknown, THC, or Other."
 *   E12 [G L1377]  "CannabisExciseTax does not equal 37% of UnitPrice"
 *       [FAQ L0155-L0160] worked example: QTY 3, Unit Price $5.00,
 *                  Discount $3.00, Sales Tax (10%) $1.20, Other Tax (37%) $4.44
 *   E13 [G L1111]  "Inventory AdjustmentDetail missing"
 *
 * SPELLING NOTE: the guide writes "Useable cannabis"; CCRS Table 2 (the
 * enum-of-record, see ccrs-batch-core.ts L204-L209) spells it "Usable
 * Cannabis". We match on the CANONICAL Table 2 value that our own builder
 * emits, and tolerate the guide's spelling on input. Never re-spell an enum
 * from memory of the prose.
 */

/* ------------------------------------------------------------------ *
 * Issue codes — the stable contract consumed by the hub (Part 08 §C).
 * ------------------------------------------------------------------ */

export const CCRS_ISSUE_CODES = [
  "E7_TOTALCOST_ZERO",
  "E7_SAMPLE_DESCRIPTION",
  "E8_ONHAND_GT_INITIAL",
  "E9_UNITWEIGHT_ZERO_USABLE",
  "E10_DESCRIPTION_REQUIRED",
  "E10_DESCRIPTION_TOO_LONG",
  "E11_STRAIN_NAME_RESERVED",
  "E12_EXCISE_NOT_37PCT",
  "E13_ADJUSTMENT_DETAIL_MISSING",
] as const;

export type CcrsIssueCode = (typeof CCRS_ISSUE_CODES)[number];

/** One offending row, surfaced to the operator so it is fixable. Never capped. */
export type CcrsIssueRow = {
  /** Stable internal id (lot id, order id, product key) for the fix-link. */
  id: string;
  /** Human label an employee will recognise (lot code, order number, name). */
  label: string;
  /** What exactly is wrong, with the numbers. */
  detail?: string;
};

export type CcrsPreflightIssue = {
  code: CcrsIssueCode;
  severity: "error" | "warning";
  /** The LCB pin this check is grounded in — shown in the hub tooltip. */
  specPin: string;
  message: string;
  rows: CcrsIssueRow[];
};

/**
 * The two InventoryTypes for which the guide makes Description and
 * UnitWeightGrams mandatory [G L0482-L0483], [G L0489-L0490].
 * Compared case-insensitively and whitespace-collapsed so both the guide's
 * "Useable cannabis" and Table 2's "Usable Cannabis" resolve.
 */
const WEIGHT_AND_DESCRIPTION_REQUIRED_TYPES = ["usable cannabis", "cannabis mix packaged"];

/** Normalize an InventoryType for comparison. Tolerates Useable/Usable. */
export function normalizeInventoryTypeKey(type: string | null | undefined): string {
  return (type ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/^useable /, "usable ");
}

export function requiresWeightAndDescription(type: string | null | undefined): boolean {
  return WEIGHT_AND_DESCRIPTION_REQUIRED_TYPES.includes(normalizeInventoryTypeKey(type));
}

/* ------------------------------------------------------------------ *
 * E11 — reserved strain names  [G L0358]
 * ------------------------------------------------------------------ */

/**
 * "Strain name is invalid, cannot be Unknown, THC, or Other." [G L0358]
 *
 * EXACT-match only (case-insensitive, trimmed). "Other Kush" is a legitimate
 * strain name and MUST pass — a substring test would reject real inventory,
 * which is why this compares the whole normalized string.
 */
export const RESERVED_STRAIN_NAMES = ["unknown", "thc", "other"] as const;

export function isReservedStrainName(name: string | null | undefined): boolean {
  const n = (name ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  return (RESERVED_STRAIN_NAMES as readonly string[]).includes(n);
}

/* ------------------------------------------------------------------ *
 * E7 — TotalCost  [G L0614] + trade samples [FAQ L0035]
 * ------------------------------------------------------------------ */

/** The exact value the FAQ requires for a trade sample: one cent. [FAQ L0035] */
export const TRADE_SAMPLE_TOTAL_COST = "0.01";

/** The token the FAQ requires in the Name and Description. [FAQ L0035] */
export const TRADE_SAMPLE_TOKEN = "Trade Sample";

export type LotCostInput = {
  id: string;
  label: string;
  /** unit_cost_minor_units × received_qty, in cents. Null/0 means unknown. */
  totalCostMinorUnits: number | null;
  isSample?: boolean;
};

/**
 * Decide the TotalCost string for one inventory row.
 *
 * A trade sample has no value, but CCRS still requires a positive number, and
 * the FAQ dictates exactly $0.01 [FAQ L0035]. Anything else that is <= 0 is an
 * E7 error and the row must NOT be emitted: the LCB rejects the whole file on
 * one bad row, so a missing row with a blocking error in front of it is
 * strictly safer than a row we know will be rejected.
 */
export function totalCostForLot(lot: LotCostInput): { value: string | null; ok: boolean } {
  if (lot.isSample) return { value: TRADE_SAMPLE_TOTAL_COST, ok: true };
  const minor = lot.totalCostMinorUnits;
  if (minor == null || !Number.isFinite(minor) || minor <= 0) return { value: null, ok: false };
  return { value: (minor / 100).toFixed(2), ok: true };
}

/* ------------------------------------------------------------------ *
 * E12 — excise must equal 37% of the taxable base  [G L1377]
 * ------------------------------------------------------------------ */

/** 37% expressed in basis points, per [G L1377] / [FAQ L0160]. */
export const CCRS_EXCISE_BPS = 3700;

/**
 * Half-up rounding on minor units — identical to `applyBps` in
 * src/lib/reports/tax.ts L80-L81 and src/lib/medical/tax.ts L43-L44
 * (`Math.round((amountMinor * bps) / 10000)`). Duplicated here ONLY so this
 * core stays dependency-free; the test asserts the two agree, so they cannot
 * drift apart silently.
 */
export function exciseFromBaseMinor(baseMinorUnits: number, bps: number = CCRS_EXCISE_BPS): number {
  return Math.round((baseMinorUnits * bps) / 10000);
}

/**
 * The taxable base the LCB's own example uses [FAQ L0155-L0160]:
 *   QTY 3 × Unit Price $5.00 − Discount $3.00 = $12.00
 *   Other Tax (37%) = $4.44   Sales Tax (10%) = $1.20
 * All inputs are MINOR units (cents) to avoid float drift.
 */
export function taxableBaseMinor(
  quantity: number,
  unitPriceMinorUnits: number,
  discountMinorUnits: number,
): number {
  return Math.max(0, quantity * unitPriceMinorUnits - discountMinorUnits);
}

export type ExciseCheckInput = {
  id: string;
  label: string;
  quantity: number;
  unitPriceMinorUnits: number;
  discountMinorUnits: number;
  /** What the POS actually stored / what we are about to report, in cents. */
  storedExciseMinorUnits: number;
  /**
   * A medical-exempt line legitimately reports 0 tax, but ONLY when the sale is
   * RecreationalMedical [G L1378]. Part 10 governs when that can occur; today
   * IsMedical is always FALSE, so this defaults to false and the check applies.
   */
  isMedicalExempt?: boolean;
};

/**
 * Tolerance of one cent. The LCB compares a rounded currency value, and our
 * own half-up rounding can legitimately differ from a POS that rounded a
 * fraction the other way. Anything beyond a cent is a real mismatch.
 */
export const EXCISE_TOLERANCE_MINOR_UNITS = 1;

export function checkExciseRow(input: ExciseCheckInput): CcrsIssueRow | null {
  if (input.isMedicalExempt) return null; // [G L1378] "Only Medical … 0"
  const base = taxableBaseMinor(
    input.quantity,
    input.unitPriceMinorUnits,
    input.discountMinorUnits,
  );
  const expected = exciseFromBaseMinor(base);
  const delta = Math.abs(expected - input.storedExciseMinorUnits);
  if (delta <= EXCISE_TOLERANCE_MINOR_UNITS) return null;
  return {
    id: input.id,
    label: input.label,
    detail: `stored ${(input.storedExciseMinorUnits / 100).toFixed(2)} expected ${(
      expected / 100
    ).toFixed(2)} (37% of ${(base / 100).toFixed(2)})`,
  };
}

/* ------------------------------------------------------------------ *
 * E13 — InventoryAdjustment detail  [G L1111]
 * ------------------------------------------------------------------ */

/**
 * Reasons for which CCRS requires a free-text AdjustmentDetail. "Other" and
 * "Theft" carry no self-evident explanation, so the LCB errors with
 * "Inventory AdjustmentDetail missing" [G L1111] when the field is blank.
 */
export const DETAIL_REQUIRED_REASONS = ["Other", "Theft"] as const;

export function adjustmentDetailRequired(ccrsReason: string): boolean {
  return (DETAIL_REQUIRED_REASONS as readonly string[]).includes((ccrsReason ?? "").trim());
}

/** Stable prefix so the I/O wrapper maps a skip to the CODED issue, not W16. */
export const E13_SKIP_PREFIX = "E13:";

/* ------------------------------------------------------------------ *
 * Row-level decisions used by the REAL builders.
 *
 * `ccrs-batch.ts` is `server-only` and its per-file builders are private, so
 * they cannot be imported by a unit test. Rather than export them (which would
 * drag `server-only` into the test runner) or mock Supabase, the actual
 * decision for each row lives HERE and the builder calls it. The test then
 * exercises the same code path production does — not a copy of it.
 * ------------------------------------------------------------------ */

export type InventoryRowFacts = {
  id: string;
  label: string;
  initialQty: number;
  onHandQty: number;
  totalCostMinorUnits: number | null;
  isSample?: boolean;
};

export type InventoryRowVerdict =
  | { emit: true; totalCost: string }
  | { emit: false; code: CcrsIssueCode; row: CcrsIssueRow };

/**
 * Decide whether one Inventory row may be emitted.
 *
 * ORDER MATTERS: E8 is evaluated before E7. A lot with a bad count AND no cost
 * is reported as the count problem first, because fixing the count is what the
 * operator must do to the physical lot; the cost is a data-entry fix.
 */
export function inventoryRowVerdict(f: InventoryRowFacts): InventoryRowVerdict {
  if (f.onHandQty > f.initialQty) {
    return {
      emit: false,
      code: "E8_ONHAND_GT_INITIAL",
      row: {
        id: f.id,
        label: f.label,
        detail: `on_hand ${f.onHandQty} > received ${f.initialQty}`,
      },
    };
  }
  const cost = totalCostForLot({
    id: f.id,
    label: f.label,
    totalCostMinorUnits: f.totalCostMinorUnits,
    isSample: f.isSample,
  });
  if (!cost.ok || cost.value == null) {
    return {
      emit: false,
      code: "E7_TOTALCOST_ZERO",
      row: {
        id: f.id,
        label: f.label,
        detail:
          f.totalCostMinorUnits == null
            ? "no unit cost recorded"
            : `unit cost × qty = ${f.totalCostMinorUnits}`,
      },
    };
  }
  return { emit: true, totalCost: cost.value };
}

export type ProductRowFacts = {
  id: string;
  label: string;
  /** The CANONICAL Table 2 InventoryType resolved by the builder. */
  inventoryType: string;
  unitWeightGrams: string;
  description: string;
};

/** E9 + E10 for one Product row. Returns every code that fired (never just the first). */
export function productRowIssues(f: ProductRowFacts): Array<{
  code: CcrsIssueCode;
  row: CcrsIssueRow;
}> {
  const out: Array<{ code: CcrsIssueCode; row: CcrsIssueRow }> = [];
  if (!requiresWeightAndDescription(f.inventoryType)) return out;

  const grams = Number(f.unitWeightGrams);
  if (!f.unitWeightGrams.trim() || !Number.isFinite(grams) || grams <= 0) {
    out.push({
      code: "E9_UNITWEIGHT_ZERO_USABLE",
      row: {
        id: f.id,
        label: f.label,
        detail: `InventoryType "${f.inventoryType}" requires a unit weight; none recorded`,
      },
    });
  }
  if (!f.description.trim()) {
    out.push({
      code: "E10_DESCRIPTION_REQUIRED",
      row: {
        id: f.id,
        label: f.label,
        detail: `InventoryType "${f.inventoryType}" requires a Description`,
      },
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Aggregation helpers
 * ------------------------------------------------------------------ */

const PINS: Record<CcrsIssueCode, string> = {
  E7_TOTALCOST_ZERO: "[G L0614]",
  E7_SAMPLE_DESCRIPTION: "[FAQ L0035]",
  E8_ONHAND_GT_INITIAL: "[G L0597]",
  E9_UNITWEIGHT_ZERO_USABLE: "[G L0434]",
  E10_DESCRIPTION_REQUIRED: "[G L0482-L0483]",
  E10_DESCRIPTION_TOO_LONG: "[G L0480]",
  E11_STRAIN_NAME_RESERVED: "[G L0358]",
  E12_EXCISE_NOT_37PCT: "[G L1377]",
  E13_ADJUSTMENT_DETAIL_MISSING: "[G L1111]",
};

export function specPinFor(code: CcrsIssueCode): string {
  return PINS[code];
}

/** Build a coded issue with its pin already attached. Rows are never capped. */
export function makeIssue(
  code: CcrsIssueCode,
  message: string,
  rows: CcrsIssueRow[],
  severity: "error" | "warning" = "error",
): CcrsPreflightIssue {
  return { code, severity, specPin: specPinFor(code), message, rows };
}

/* ------------------------------------------------------------------ *
 * Embedded pure self-tests (registered in pure-selftests.test.ts).
 * ------------------------------------------------------------------ */

export function __runCcrsPreflightCoreTests(): string {
  let passed = 0;
  const fail: string[] = [];
  const ok = (cond: boolean, what: string) => {
    if (cond) passed += 1;
    else fail.push(what);
  };

  // E11 — exact match only.
  ok(isReservedStrainName("Unknown"), "Unknown reserved");
  ok(isReservedStrainName(" thc "), "thc trimmed reserved");
  ok(isReservedStrainName("OTHER"), "OTHER reserved");
  ok(!isReservedStrainName("Other Kush"), "Other Kush allowed");
  ok(!isReservedStrainName("Blue Dream"), "Blue Dream allowed");

  // E7 — trade sample vs zero cost.
  ok(totalCostForLot({ id: "1", label: "L1", totalCostMinorUnits: 50000 }).value === "500.00",
    "cost 500.00");
  ok(totalCostForLot({ id: "1", label: "L1", totalCostMinorUnits: null }).ok === false,
    "null cost is E7");
  ok(totalCostForLot({ id: "1", label: "L1", totalCostMinorUnits: 0 }).ok === false,
    "zero cost is E7");
  ok(
    totalCostForLot({ id: "1", label: "L1", totalCostMinorUnits: null, isSample: true }).value ===
      "0.01",
    "sample is 0.01",
  );

  // E12 — the LCB's own worked example [FAQ L0155-L0160].
  const base = taxableBaseMinor(3, 500, 300);
  ok(base === 1200, "FAQ base is 12.00");
  ok(exciseFromBaseMinor(base) === 444, "FAQ excise is 4.44");
  ok(exciseFromBaseMinor(base, 1000) === 120, "FAQ sales tax is 1.20");
  ok(
    checkExciseRow({
      id: "o1",
      label: "#1",
      quantity: 3,
      unitPriceMinorUnits: 500,
      discountMinorUnits: 300,
      storedExciseMinorUnits: 444,
    }) === null,
    "matching excise passes",
  );
  ok(
    checkExciseRow({
      id: "o1",
      label: "#1",
      quantity: 3,
      unitPriceMinorUnits: 500,
      discountMinorUnits: 300,
      storedExciseMinorUnits: 120,
    }) !== null,
    "mismatched excise fails",
  );

  // E9/E10 type gate.
  ok(requiresWeightAndDescription("Usable Cannabis"), "Usable Cannabis gated");
  ok(requiresWeightAndDescription("Useable cannabis"), "guide spelling gated");
  ok(requiresWeightAndDescription("Cannabis Mix Packaged"), "Mix Packaged gated");
  ok(!requiresWeightAndDescription("Concentrate"), "Concentrate not gated");

  // E13.
  ok(adjustmentDetailRequired("Other"), "Other needs detail");
  ok(adjustmentDetailRequired("Theft"), "Theft needs detail");
  ok(!adjustmentDetailRequired("Destruction"), "Destruction does not");

  if (fail.length) throw new Error(`FAIL: ${fail.join("; ")}`);
  return `ccrs-preflight-core: ${passed} passed, 0 failed`;
}
