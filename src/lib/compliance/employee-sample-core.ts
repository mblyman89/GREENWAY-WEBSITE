/**
 * src/lib/compliance/employee-sample-core.ts  (Task K)
 *
 * PURE logic for the rebuilt Employee Samples page (no server-only imports →
 * tsx/vitest-testable).
 *
 * WHAT A WA RETAILER MUST DO (WAC 314-55-096, WSR 25-08-032 eff. 4/26/25):
 *   • Track all incoming AND outgoing trade sample inventory in the state
 *     traceability system by product type. [096(1)(j)(iv)]
 *   • Record the amount of sample provided to each employee, including the
 *     product type AND the employee's name. [096(1)(j)(v)]
 *   • Give no more than 30 units per employee per calendar quarter (sample-jar
 *     leftovers COUNT toward the 30). [096(1)(j)(vi), 096(4)(d)(i)]
 *   • Per-unit caps: 3.5 g useable / 1 g concentrate / 100 mg infused
 *     (≤ 10 mg THC per serving). [096(1)(e)]
 *   • Samples go only to CURRENT PAID employees; never to customers. [096(2)]
 *
 * HOW THE "MARK IT OUT" WORKS (CCRS): the LCB has confirmed that employee
 * samples are reported to CCRS via an INVENTORY ADJUSTMENT — reason "Other",
 * detail naming the employee — plus the retailer's own log of samples and
 * recipients. This module builds that adjustment note; the trade_sample_events
 * ledger is the retailer's own log.
 *
 * This core takes RAW inventory-lot rows (queried server-side), classifies each
 * into the three-value sample product type, derives the per-unit size from the
 * lot's unit weight, and validates a proposed assignment against BOTH the
 * remaining quarterly allowance and the lot's on-hand quantity.
 */
import type { SampleProductType, SampleSettings } from "@/lib/compliance/trade-samples-core";
import { validateUnitSize, quarterKeyFromYmd, WAC_CITATION } from "@/lib/compliance/trade-samples-core";
import { sampleProductTypeForLine } from "@/lib/compliance/sample-product-type-core";

export { WAC_CITATION };

// ---------------------------------------------------------------------------
// Available sample lots → selectable table rows
// ---------------------------------------------------------------------------

/** Raw shape of an inventory_lots row relevant to the samples table. */
export type RawSampleLot = {
  id: string;
  product_name: string | null;
  strain_name: string | null;
  lot_code: string | null;
  inventory_type: string | null;
  on_hand_qty: number | null;
  unit: string | null;
  unit_weight: number | null;
  unit_weight_uom: string | null; // g | mg | oz (migration 0024)
  created_at: string | null;
  vendor_label: string | null; // joined from inbound_manifests
};

/** One selectable row in the "available samples" table. */
export type AvailableSampleRow = {
  lotId: string;
  productName: string;
  strainName: string | null;
  lotCode: string | null;
  vendorLabel: string | null;
  /** Three-value sample type (drives the per-unit size caps). */
  productType: SampleProductType;
  onHandQty: number;
  unit: string;
  /** Per-unit size derived from the lot (null when the lot has no unit weight). */
  unitSizeGrams: number | null;
  unitSizeMg: number | null;
  receivedAt: string | null;
};

/** A lot we CANNOT lawfully assign (shown nowhere; counted for honesty). */
export type SkippedSampleLot = {
  lotId: string;
  productName: string;
  reason: string;
};

// GW-016: real measured weights use the true avoirdupois conversion (shared module).
import { AVOIRDUPOIS_GRAMS_PER_OUNCE as GRAMS_PER_OUNCE } from "@/lib/compliance/grams-per-ounce";

/** Derive per-unit grams from a lot's unit weight (g | mg | oz). Null if unknown. */
export function unitWeightToGrams(weight: number | null | undefined, uom: string | null | undefined): number | null {
  if (weight == null || !Number.isFinite(weight) || weight <= 0) return null;
  const u = (uom ?? "").trim().toLowerCase();
  if (u === "g" || u === "") return weight;
  if (u === "mg") return weight / 1000;
  if (u === "oz") return weight * GRAMS_PER_OUNCE;
  return null;
}

/** Derive per-unit milligrams (for infused) from a lot's unit weight. Null if unknown. */
export function unitWeightToMg(weight: number | null | undefined, uom: string | null | undefined): number | null {
  const g = unitWeightToGrams(weight, uom);
  return g == null ? null : g * 1000;
}

export type BuildRowsResult = {
  rows: AvailableSampleRow[];
  skipped: SkippedSampleLot[];
};

/**
 * Map raw sample lots to selectable table rows. Lots that do not classify to a
 * lawful cannabis sample product type (accessories/merch/unmappable) are
 * SKIPPED with a reason — they cannot be assigned under 096(1)(e)/(j).
 * Lots with zero on-hand are skipped (nothing left to give).
 */
export function buildAvailableSampleRows(lots: RawSampleLot[]): BuildRowsResult {
  const rows: AvailableSampleRow[] = [];
  const skipped: SkippedSampleLot[] = [];
  for (const lot of lots) {
    const name = (lot.product_name ?? "").trim() || "(unnamed sample)";
    const onHand = Math.max(0, Math.trunc(Number(lot.on_hand_qty) || 0));
    if (onHand <= 0) {
      skipped.push({ lotId: lot.id, productName: name, reason: "No units left on hand." });
      continue;
    }
    const productType = sampleProductTypeForLine({
      productName: lot.product_name,
      inventoryType: lot.inventory_type,
    });
    if (!productType) {
      skipped.push({
        lotId: lot.id,
        productName: name,
        reason: "Not a lawful cannabis sample product type (cannot be assigned under WAC 314-55-096).",
      });
      continue;
    }
    const grams = unitWeightToGrams(lot.unit_weight, lot.unit_weight_uom);
    const mg = unitWeightToMg(lot.unit_weight, lot.unit_weight_uom);
    rows.push({
      lotId: lot.id,
      productName: name,
      strainName: (lot.strain_name ?? "").trim() || null,
      lotCode: (lot.lot_code ?? "").trim() || null,
      vendorLabel: (lot.vendor_label ?? "").trim() || null,
      productType,
      onHandQty: onHand,
      unit: (lot.unit ?? "").trim() || "ea",
      unitSizeGrams: productType === "infused" ? null : grams,
      unitSizeMg: productType === "infused" ? mg : null,
      receivedAt: lot.created_at,
    });
  }
  // Freshest first so new arrivals surface at the top of the table.
  rows.sort((a, b) => (b.receivedAt ?? "").localeCompare(a.receivedAt ?? ""));
  return { rows, skipped };
}

// ---------------------------------------------------------------------------
// Assignment validation (the ONLY fields compliance requires)
// ---------------------------------------------------------------------------

/** The minimal assignment form: WHO, WHAT (selected row), HOW MANY, WHEN. */
export type AssignmentDraft = {
  lotId: string;
  employeeId: string;
  unitCount: string; // form input
  ymd: string; // event date, YYYY-MM-DD
  fromSampleJar?: boolean; // jar leftovers count toward the 30-cap [096(4)(d)(i)]
  note?: string;
  /** Manual per-unit size — required ONLY when the lot carries no unit weight. */
  unitSizeGrams?: string;
  unitSizeMg?: string;
  thcMgPerServing?: string;
};

export type ParsedAssignment = {
  lotId: string;
  employeeId: string;
  productType: SampleProductType;
  unitCount: number;
  unitSizeGrams: number | null;
  unitSizeMg: number | null;
  thcMgPerServing: number | null;
  quarterKey: string;
  fromSampleJar: boolean;
  note: string | null;
  sourceProductName: string;
  sourceLotRef: string | null;
};

export type AssignmentParse =
  | { ok: true; value: ParsedAssignment }
  | { ok: false; errors: string[] };

/**
 * Validate a proposed assignment against the selected lot row + settings.
 * Checks (all must pass):
 *   • the row exists and the employee is chosen
 *   • unit count ≥ 1 and ≤ the lot's on-hand quantity
 *   • per-unit size within the 096(1)(e) caps (from the lot, or manual when
 *     the lot carries no unit weight)
 *   • valid event date (drives the quarter key)
 * The QUARTERLY 30-cap is enforced server-side at record time (hard block) —
 * this parse only shapes + size-checks the draft.
 */
export function parseAssignmentDraft(
  draft: AssignmentDraft,
  row: AvailableSampleRow | null,
  settings: SampleSettings,
): AssignmentParse {
  const errors: string[] = [];

  if (!row) errors.push("Select a sample from the table.");
  if (!(draft.employeeId ?? "").trim()) errors.push("Choose the receiving employee.");

  const unitCount = Math.trunc(Number(draft.unitCount));
  if (!Number.isFinite(unitCount) || unitCount <= 0) errors.push("Enter a unit count of 1 or more.");
  if (row && Number.isFinite(unitCount) && unitCount > row.onHandQty) {
    errors.push(`Only ${row.onHandQty} unit(s) of this sample are on hand.`);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.ymd ?? "")) errors.push("Enter a valid date.");

  if (!row) return { ok: false, errors };

  // Per-unit size: prefer the lot's own weight; fall back to the manual field.
  const manualG = draft.unitSizeGrams ? Number(draft.unitSizeGrams) : null;
  const manualMg = draft.unitSizeMg ? Number(draft.unitSizeMg) : null;
  const thc = draft.thcMgPerServing ? Number(draft.thcMgPerServing) : null;
  const grams = row.productType === "infused" ? null : (row.unitSizeGrams ?? manualG);
  const mg = row.productType === "infused" ? (row.unitSizeMg ?? manualMg) : null;

  const sizeCheck = validateUnitSize(
    { productType: row.productType, category: "trade", unitSizeGrams: grams, unitSizeMg: mg, thcMgPerServing: thc },
    settings,
  );
  if (!sizeCheck.ok) errors.push(...sizeCheck.errors);

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      lotId: row.lotId,
      employeeId: (draft.employeeId ?? "").trim(),
      productType: row.productType,
      unitCount,
      unitSizeGrams: grams,
      unitSizeMg: mg,
      thcMgPerServing: row.productType === "infused" ? thc : null,
      quarterKey: quarterKeyFromYmd(draft.ymd),
      fromSampleJar: Boolean(draft.fromSampleJar),
      note: (draft.note ?? "").trim() || null,
      sourceProductName: row.productName,
      sourceLotRef: row.lotCode,
    },
  };
}

// ---------------------------------------------------------------------------
// Remaining quarterly allowance (advisory display; server hard-enforces)
// ---------------------------------------------------------------------------

export type EmployeeAllowance = {
  used: number;
  cap: number;
  remaining: number;
};

export function employeeAllowance(used: number, cap: number): EmployeeAllowance {
  const u = Math.max(0, Math.trunc(Number(used) || 0));
  const c = Math.max(0, Math.trunc(Number(cap) || 0));
  return { used: u, cap: c, remaining: Math.max(0, c - u) };
}

// ---------------------------------------------------------------------------
// CCRS adjustment note (the "mark it out of the system" record)
// ---------------------------------------------------------------------------

/**
 * Build the InventoryAdjustment detail naming the employee — the LCB-confirmed
 * CCRS reporting shape for employee samples (reason "Other" + a detail that
 * names the recipient). Clamped later to the 250-char CCRS limit by the
 * exporter; keep it tight here.
 */
export function buildEmployeeSampleAdjustmentNote(args: {
  employeeName: string;
  productName: string;
  lotCode: string | null;
  unitCount: number;
}): string {
  const lot = args.lotCode ? ` (lot ${args.lotCode})` : "";
  return `Trade sample provided to ${args.employeeName}: ${args.unitCount} unit(s) of ${args.productName}${lot}. ${WAC_CITATION}.`;
}

// ---------------------------------------------------------------------------
// Self-tests (tsx/vitest-runnable; PURE module)
// ---------------------------------------------------------------------------

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
}

const TEST_SETTINGS: SampleSettings = {
  enforce: true,
  hardBlock: true,
  incomingUnitsPerQuarter: 120,
  outgoingUnitsPerEmployee: 30,
  maxFlowerGrams: 3.5,
  maxConcentrateGrams: 1,
  maxInfusedMg: 100,
  maxThcMgPerServing: 10,
};

function rawLot(over: Partial<RawSampleLot> = {}): RawSampleLot {
  return {
    id: "lot-1",
    product_name: "Blue Dream Sample 3.5g",
    strain_name: "Blue Dream",
    lot_code: "WAL-123",
    inventory_type: "Usable Cannabis",
    on_hand_qty: 4,
    unit: "ea",
    unit_weight: 3.5,
    unit_weight_uom: "g",
    created_at: "2026-01-05T12:00:00Z",
    vendor_label: "Fairwinds",
    ...over,
  };
}

export function __runEmployeeSampleCoreTests(): string {
  // unit weight conversions
  assert(unitWeightToGrams(3.5, "g") === 3.5, "g passthrough");
  assert(unitWeightToGrams(500, "mg") === 0.5, "mg → g");
  assert(Math.abs((unitWeightToGrams(1, "oz") ?? 0) - 28.3495) < 1e-9, "oz → g");
  assert(unitWeightToGrams(null, "g") === null, "null weight → null");
  assert(unitWeightToGrams(0, "g") === null, "zero weight → null");
  assert(unitWeightToGrams(3.5, "lbs") === null, "unknown uom → null");
  assert(unitWeightToMg(0.1, "g") === 100, "g → mg");

  // buildAvailableSampleRows: classify + derive sizes, skip zero-on-hand + non-cannabis
  const built = buildAvailableSampleRows([
    rawLot(),
    rawLot({ id: "lot-2", product_name: "Live Resin Sample", inventory_type: "Concentrate for Inhalation", unit_weight: 1, created_at: "2026-01-06T12:00:00Z" }),
    rawLot({ id: "lot-3", product_name: "Gummy Sample", inventory_type: "Solid Edible", unit_weight: 100, unit_weight_uom: "mg", created_at: "2026-01-04T12:00:00Z" }),
    rawLot({ id: "lot-4", product_name: "Branded Lighter", inventory_type: "Paraphernalia" }),
    rawLot({ id: "lot-5", on_hand_qty: 0 }),
  ]);
  assert(built.rows.length === 3, "3 assignable rows");
  assert(built.skipped.length === 2, "2 skipped");
  assert(built.rows[0]!.lotId === "lot-2", "freshest first");
  assert(built.rows.find((r) => r.lotId === "lot-1")!.productType === "useable", "flower → useable");
  assert(built.rows.find((r) => r.lotId === "lot-2")!.productType === "concentrate", "resin → concentrate");
  const gummy = built.rows.find((r) => r.lotId === "lot-3")!;
  assert(gummy.productType === "infused", "edible → infused");
  assert(gummy.unitSizeMg === 100 && gummy.unitSizeGrams === null, "infused carries mg not g");
  const flower = built.rows.find((r) => r.lotId === "lot-1")!;
  assert(flower.unitSizeGrams === 3.5 && flower.unitSizeMg === null, "useable carries g not mg");
  assert(built.skipped.some((s) => s.lotId === "lot-4"), "paraphernalia skipped");
  assert(built.skipped.some((s) => s.lotId === "lot-5"), "zero on-hand skipped");

  // parseAssignmentDraft — happy path
  const row = built.rows.find((r) => r.lotId === "lot-1")!;
  const ok = parseAssignmentDraft(
    { lotId: "lot-1", employeeId: "emp-1", unitCount: "2", ymd: "2026-01-10", fromSampleJar: true, note: " left over jar " },
    row,
    TEST_SETTINGS,
  );
  assert(ok.ok, "happy assignment parses");
  if (ok.ok) {
    assert(ok.value.unitCount === 2, "unit count");
    assert(ok.value.quarterKey === "2026-Q1", "quarter from date");
    assert(ok.value.fromSampleJar === true, "jar flag");
    assert(ok.value.note === "left over jar", "note trimmed");
    assert(ok.value.sourceProductName === "Blue Dream Sample 3.5g", "product identity");
    assert(ok.value.sourceLotRef === "WAL-123", "lot identity");
    assert(ok.value.unitSizeGrams === 3.5, "size from lot");
  }

  // parseAssignmentDraft — failures
  const noRow = parseAssignmentDraft({ lotId: "x", employeeId: "emp-1", unitCount: "1", ymd: "2026-01-10" }, null, TEST_SETTINGS);
  assert(!noRow.ok, "no row → error");
  const noEmp = parseAssignmentDraft({ lotId: "lot-1", employeeId: "", unitCount: "1", ymd: "2026-01-10" }, row, TEST_SETTINGS);
  assert(!noEmp.ok, "no employee → error");
  const overHand = parseAssignmentDraft({ lotId: "lot-1", employeeId: "emp-1", unitCount: "5", ymd: "2026-01-10" }, row, TEST_SETTINGS);
  assert(!overHand.ok && overHand.errors.some((e) => e.includes("on hand")), "over on-hand blocked");
  const zeroUnits = parseAssignmentDraft({ lotId: "lot-1", employeeId: "emp-1", unitCount: "0", ymd: "2026-01-10" }, row, TEST_SETTINGS);
  assert(!zeroUnits.ok, "zero units → error");
  const badDate = parseAssignmentDraft({ lotId: "lot-1", employeeId: "emp-1", unitCount: "1", ymd: "Jan 10" }, row, TEST_SETTINGS);
  assert(!badDate.ok, "bad date → error");

  // Oversize lot blocked by 096(1)(e): a 5 g "useable" unit can never go out.
  const bigRow: AvailableSampleRow = { ...row, unitSizeGrams: 5 };
  const oversize = parseAssignmentDraft({ lotId: "lot-1", employeeId: "emp-1", unitCount: "1", ymd: "2026-01-10" }, bigRow, TEST_SETTINGS);
  assert(!oversize.ok && oversize.errors.some((e) => e.includes("3.5")), "oversize unit blocked");

  // Lot without a unit weight: manual size is REQUIRED and validated.
  const noSizeRow: AvailableSampleRow = { ...row, unitSizeGrams: null };
  const needSize = parseAssignmentDraft({ lotId: "lot-1", employeeId: "emp-1", unitCount: "1", ymd: "2026-01-10" }, noSizeRow, TEST_SETTINGS);
  assert(!needSize.ok, "missing size → error");
  const manualSize = parseAssignmentDraft(
    { lotId: "lot-1", employeeId: "emp-1", unitCount: "1", ymd: "2026-01-10", unitSizeGrams: "3.5" },
    noSizeRow,
    TEST_SETTINGS,
  );
  assert(manualSize.ok, "manual size accepted");

  // Infused THC/serving cap
  const infRow = built.rows.find((r) => r.lotId === "lot-3")!;
  const hotServing = parseAssignmentDraft(
    { lotId: "lot-3", employeeId: "emp-1", unitCount: "1", ymd: "2026-01-10", thcMgPerServing: "25" },
    infRow,
    TEST_SETTINGS,
  );
  assert(!hotServing.ok && hotServing.errors.some((e) => e.includes("10")), "hot serving blocked");

  // employeeAllowance
  const a = employeeAllowance(12, 30);
  assert(a.remaining === 18 && a.used === 12 && a.cap === 30, "allowance math");
  assert(employeeAllowance(45, 30).remaining === 0, "remaining floors at 0");

  // CCRS note
  const note = buildEmployeeSampleAdjustmentNote({ employeeName: "Jane Budtender", productName: "Blue Dream Sample 3.5g", lotCode: "WAL-123", unitCount: 2 });
  assert(note.includes("Jane Budtender"), "note names employee (LCB-confirmed CCRS shape)");
  assert(note.includes("2 unit(s)") && note.includes("WAL-123"), "note carries units + lot");
  const noLotNote = buildEmployeeSampleAdjustmentNote({ employeeName: "Jane", productName: "Gummy", lotCode: null, unitCount: 1 });
  assert(!noLotNote.includes("lot "), "no lot ref when lot code missing");

  return "OK: employee-sample-core tests passed";
}
