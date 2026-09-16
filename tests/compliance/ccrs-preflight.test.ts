/**
 * tests/compliance/ccrs-preflight.test.ts — CCRS bible slice S-02
 * (docs/ccrs-bible/09-slice-plan.md § S-02; closes Part 04 gaps E7–E13)
 *
 * Each describe() block carries the VERBATIM LCB pin it is grounded in. Every
 * quoted string below was verified against lcb/guide.txt / lcb/faq.txt at the
 * md5s recorded in docs/ccrs-bible/13-sources.md — not from memory.
 *
 * WHY THESE ARE BLOCKING ERRORS, NOT WARNINGS
 * CCRS rejects an upload FILE-WIDE on a single bad row and reports it only by
 * email to the uploader [FAQ L0102]. Catching these before the zip is built is
 * the difference between a 30-second fix and a missed Sunday deadline.
 */
import { describe, it, expect } from "vitest";
import {
  CCRS_ISSUE_CODES,
  isReservedStrainName,
  RESERVED_STRAIN_NAMES,
  totalCostForLot,
  TRADE_SAMPLE_TOTAL_COST,
  TRADE_SAMPLE_TOKEN,
  taxableBaseMinor,
  exciseFromBaseMinor,
  checkExciseRow,
  CCRS_EXCISE_BPS,
  EXCISE_TOLERANCE_MINOR_UNITS,
  requiresWeightAndDescription,
  normalizeInventoryTypeKey,
  adjustmentDetailRequired,
  DETAIL_REQUIRED_REASONS,
  E13_SKIP_PREFIX,
  specPinFor,
  makeIssue,
  inventoryRowVerdict,
  productRowIssues,
  __runCcrsPreflightCoreTests,
  type CcrsIssueCode,
} from "@/lib/compliance/ccrs-preflight-core";
import { applyBps } from "@/lib/reports/tax";
import { mapAdjustmentRow } from "@/lib/compliance/ccrs-inventory-adjustment-core";

describe("E7 — TotalCost  [G L0614] \"TotalCost cannot equal 0\"", () => {
  it("a lot with no cost is an error and emits NO value", () => {
    const r = totalCostForLot({ id: "lot-1", label: "LOT-A", totalCostMinorUnits: null });
    expect(r.ok).toBe(false);
    expect(r.value).toBeNull();
  });

  it("a lot costing exactly 0 is an error — the guide says cannot EQUAL 0", () => {
    expect(totalCostForLot({ id: "l", label: "L", totalCostMinorUnits: 0 }).ok).toBe(false);
  });

  it("a negative cost is an error too (never emit a negative TotalCost)", () => {
    expect(totalCostForLot({ id: "l", label: "L", totalCostMinorUnits: -500 }).ok).toBe(false);
  });

  it("a normal lot formats to 2dp", () => {
    expect(totalCostForLot({ id: "l", label: "L", totalCostMinorUnits: 50000 }).value).toBe(
      "500.00",
    );
  });

  it("a one-cent lot is valid — above $0.00 is the bar, not above $1", () => {
    // [FAQ L0035] "CCRS requires a value above $0.00"
    const r = totalCostForLot({ id: "l", label: "L", totalCostMinorUnits: 1 });
    expect(r.ok).toBe(true);
    expect(r.value).toBe("0.01");
  });

  it("a TRADE SAMPLE with no cost reports exactly 0.01, not an error  [FAQ L0035]", () => {
    // "While the provided Trade Samples do not have a value, a value of $0.01
    //  needs to be entered into the Total Cost field for Trade Samples."
    const r = totalCostForLot({
      id: "lot-s",
      label: "SAMPLE-A",
      totalCostMinorUnits: null,
      isSample: true,
    });
    expect(r.ok).toBe(true);
    expect(r.value).toBe(TRADE_SAMPLE_TOTAL_COST);
    expect(r.value).toBe("0.01");
  });

  it("the trade-sample token the FAQ requires in Name and Description is exact", () => {
    // "Please ensure you are including in the name and Description: Trade Sample."
    expect(TRADE_SAMPLE_TOKEN).toBe("Trade Sample");
  });
});

describe("E8 — [G L0597] \"QuanityOnHand is greater than InitialQuantity\"", () => {
  // NOTE: the guide misspells "Quantity" as "Quanity". Quoted exactly as printed;
  // do not "correct" the pin text.
  const onHandExceeds = (initial: number, onHand: number) => onHand > initial;

  it("on_hand 12 > received 10 is an error", () => {
    expect(onHandExceeds(10, 12)).toBe(true);
  });

  it("on_hand equal to initial is FINE (greater-than, not >=)", () => {
    expect(onHandExceeds(10, 10)).toBe(false);
  });

  it("a normally depleted lot is fine", () => {
    expect(onHandExceeds(100, 98)).toBe(false);
  });
});

describe("E9/E10 — the two InventoryTypes the guide gates on", () => {
  it("gates Usable Cannabis (Table 2 canonical spelling)", () => {
    expect(requiresWeightAndDescription("Usable Cannabis")).toBe(true);
  });

  it("also gates the GUIDE's spelling \"Useable cannabis\"  [G L0489]", () => {
    // The guide writes "Useable cannabis"; CCRS Table 2 writes "Usable
    // Cannabis". Both must resolve or the check silently misses rows.
    expect(requiresWeightAndDescription("Useable cannabis")).toBe(true);
    expect(normalizeInventoryTypeKey("Useable Cannabis")).toBe("usable cannabis");
  });

  it("gates Cannabis Mix Packaged  [G L0482-L0483]", () => {
    expect(requiresWeightAndDescription("Cannabis Mix Packaged")).toBe(true);
  });

  it("does NOT gate other types — \"All other product types weight can be reported as 0\" [G L0490]", () => {
    for (const t of ["Concentrate", "Solid Edible", "Liquid Edible", "Infused Mix", "Plant"]) {
      expect(requiresWeightAndDescription(t)).toBe(false);
    }
  });

  it("is whitespace and case tolerant but never matches a different type", () => {
    expect(requiresWeightAndDescription("  usable   cannabis ")).toBe(true);
    expect(requiresWeightAndDescription("Usable Cannabis Extract")).toBe(false);
  });
});

describe("E11 — [G L0358] \"Strain name is invalid, cannot be Unknown, THC, or Other.\"", () => {
  it("rejects each reserved name, case-insensitively and trimmed", () => {
    for (const n of ["Unknown", "unknown", " THC ", "thc", "Other", "OTHER"]) {
      expect(isReservedStrainName(n)).toBe(true);
    }
  });

  it("the reserved list is exactly the three the guide names", () => {
    expect([...RESERVED_STRAIN_NAMES]).toEqual(["unknown", "thc", "other"]);
  });

  it("ACCEPTS a real strain that merely CONTAINS a reserved word", () => {
    // This is the whole reason the check is exact-match. A substring test would
    // reject sellable inventory and block the upload for no reason.
    for (const n of ["Other Kush", "THC Bomb", "Unknown Pleasures OG", "Blue Dream"]) {
      expect(isReservedStrainName(n)).toBe(false);
    }
  });

  it("treats a blank strain as not-reserved (blank is a separate concern)", () => {
    expect(isReservedStrainName("")).toBe(false);
    expect(isReservedStrainName(null)).toBe(false);
  });
});

describe("E12 — [G L1377] \"CannabisExciseTax does not equal 37% of UnitPrice\"", () => {
  // The LCB's own worked example, copied verbatim from [FAQ L0155-L0160]:
  //   QTY = 3 / Unit Price = $5.00 / Discount = $3.00
  //   Sales Tax (10%) = $1.20 / Other Tax (37%) = $4.44
  const QTY = 3;
  const UNIT = 500; // $5.00 in cents
  const DISCOUNT = 300; // $3.00 in cents

  it("reproduces the FAQ's base of $12.00", () => {
    expect(taxableBaseMinor(QTY, UNIT, DISCOUNT)).toBe(1200);
  });

  it("reproduces the FAQ's Other Tax (37%) of $4.44 EXACTLY", () => {
    expect(exciseFromBaseMinor(taxableBaseMinor(QTY, UNIT, DISCOUNT))).toBe(444);
  });

  it("reproduces the FAQ's Sales Tax (10%) of $1.20 EXACTLY", () => {
    expect(exciseFromBaseMinor(taxableBaseMinor(QTY, UNIT, DISCOUNT), 1000)).toBe(120);
  });

  it("uses 3700 bps — 37%, per the guide", () => {
    expect(CCRS_EXCISE_BPS).toBe(3700);
  });

  it("rounds IDENTICALLY to applyBps() in src/lib/reports/tax.ts (no drift)", () => {
    // The excise math is duplicated in this pure core so it has no imports.
    // This test is the guard that the duplicate never diverges.
    for (const base of [0, 1, 7, 12, 1200, 1201, 3333, 99999, 123456]) {
      expect(exciseFromBaseMinor(base)).toBe(applyBps(base, CCRS_EXCISE_BPS));
    }
  });

  it("rounding edge: base 12.01 → 4.4437 → 4.44", () => {
    expect(exciseFromBaseMinor(1201)).toBe(444);
  });

  it("rounding edge: half-cent rounds half-up", () => {
    // base such that base*0.37 lands on exactly .5 of a cent:
    // 50 * 0.37 = 18.5 → 19 (half-up)
    expect(exciseFromBaseMinor(50)).toBe(19);
  });

  it("a correct row produces no issue", () => {
    expect(
      checkExciseRow({
        id: "o1",
        label: "#1001",
        quantity: QTY,
        unitPriceMinorUnits: UNIT,
        discountMinorUnits: DISCOUNT,
        storedExciseMinorUnits: 444,
      }),
    ).toBeNull();
  });

  it("a wrong row reports stored AND expected so it is fixable", () => {
    const issue = checkExciseRow({
      id: "o1",
      label: "#1001",
      quantity: QTY,
      unitPriceMinorUnits: UNIT,
      discountMinorUnits: DISCOUNT,
      storedExciseMinorUnits: 120, // sales tax written into the excise field
    });
    expect(issue).not.toBeNull();
    expect(issue?.id).toBe("o1");
    expect(issue?.label).toBe("#1001");
    expect(issue?.detail).toContain("stored 1.20");
    expect(issue?.detail).toContain("expected 4.44");
    expect(issue?.detail).toContain("12.00");
  });

  it("tolerates a one-cent rounding difference, but not two", () => {
    expect(EXCISE_TOLERANCE_MINOR_UNITS).toBe(1);
    const row = (stored: number) =>
      checkExciseRow({
        id: "o",
        label: "#1",
        quantity: QTY,
        unitPriceMinorUnits: UNIT,
        discountMinorUnits: DISCOUNT,
        storedExciseMinorUnits: stored,
      });
    expect(row(445)).toBeNull(); // +1c ok
    expect(row(443)).toBeNull(); // -1c ok
    expect(row(446)).not.toBeNull(); // +2c is a real mismatch
    expect(row(442)).not.toBeNull();
  });

  it("a discount larger than the line never produces a negative base", () => {
    expect(taxableBaseMinor(1, 500, 900)).toBe(0);
    expect(exciseFromBaseMinor(taxableBaseMinor(1, 500, 900))).toBe(0);
  });

  it("a MEDICAL-EXEMPT line may report 0 tax  [G L1378] \"Only Medical … 0\"", () => {
    // Part 10 governs when this can occur. Today IsMedical is always FALSE, so
    // the exemption must be explicit — it can never be inferred.
    expect(
      checkExciseRow({
        id: "o2",
        label: "#1002",
        quantity: QTY,
        unitPriceMinorUnits: UNIT,
        discountMinorUnits: DISCOUNT,
        storedExciseMinorUnits: 0,
        isMedicalExempt: true,
      }),
    ).toBeNull();
  });

  it("a NON-exempt line reporting 0 tax is STILL an error (the current world)", () => {
    expect(
      checkExciseRow({
        id: "o3",
        label: "#1003",
        quantity: QTY,
        unitPriceMinorUnits: UNIT,
        discountMinorUnits: DISCOUNT,
        storedExciseMinorUnits: 0,
      }),
    ).not.toBeNull();
  });
});

describe("E13 — [G L1111] \"Inventory AdjustmentDetail missing\"", () => {
  it("Other and Theft require a detail", () => {
    expect(adjustmentDetailRequired("Other")).toBe(true);
    expect(adjustmentDetailRequired("Theft")).toBe(true);
    expect([...DETAIL_REQUIRED_REASONS]).toEqual(["Other", "Theft"]);
  });

  it("self-evident reasons do not require one", () => {
    for (const r of ["Destruction", "Lost", "Reconciliation", "ReturnedLabSample", "Seizure"]) {
      expect(adjustmentDetailRequired(r)).toBe(false);
    }
  });

  it("the skip prefix is stable so the wrapper maps it to E13, not W16", () => {
    expect(E13_SKIP_PREFIX).toBe("E13:");
  });
});

describe("issue-code contract (Part 08 §C)", () => {
  it("every code carries a real spec pin", () => {
    for (const code of CCRS_ISSUE_CODES) {
      const pin = specPinFor(code);
      expect(pin, `${code} has no pin`).toBeTruthy();
      // Pins are [G L####] or [FAQ L####] / ranges — never a page reference.
      expect(pin).toMatch(/^\[(G|FAQ) L\d{4}(-L\d{4})?\]$/);
    }
  });

  it("codes are unique", () => {
    expect(new Set(CCRS_ISSUE_CODES).size).toBe(CCRS_ISSUE_CODES.length);
  });

  it("makeIssue attaches the pin and never caps rows", () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({ id: String(i), label: `L${i}` }));
    const issue = makeIssue("E7_TOTALCOST_ZERO", "1500 lots have no cost", rows);
    expect(issue.specPin).toBe("[G L0614]");
    expect(issue.severity).toBe("error");
    // Part 08: row lists are NEVER capped — a capped list hides the lot that
    // is blocking the upload.
    expect(issue.rows).toHaveLength(1500);
  });

  it("the codes named by the roadmap all exist", () => {
    const required: CcrsIssueCode[] = [
      "E7_TOTALCOST_ZERO",
      "E8_ONHAND_GT_INITIAL",
      "E9_UNITWEIGHT_ZERO_USABLE",
      "E10_DESCRIPTION_REQUIRED",
      "E11_STRAIN_NAME_RESERVED",
      "E12_EXCISE_NOT_37PCT",
      "E13_ADJUSTMENT_DETAIL_MISSING",
    ];
    for (const c of required) expect(CCRS_ISSUE_CODES).toContain(c);
  });
});

describe("row verdicts — the EXACT code path buildInventoryFile/buildProductFile run", () => {
  // These functions are not a copy of the builder logic; ccrs-batch.ts calls
  // them directly. Testing them is testing production.
  const lot = (over: Partial<Parameters<typeof inventoryRowVerdict>[0]> = {}) =>
    inventoryRowVerdict({
      id: "lot-1",
      label: "LOT-A",
      initialQty: 100,
      onHandQty: 98,
      totalCostMinorUnits: 50000,
      ...over,
    });

  it("a healthy lot is emitted with a formatted TotalCost", () => {
    const v = lot();
    expect(v.emit).toBe(true);
    if (v.emit) expect(v.totalCost).toBe("500.00");
  });

  it("E8 fires and the row is WITHHELD, not emitted", () => {
    const v = lot({ initialQty: 10, onHandQty: 12 });
    expect(v.emit).toBe(false);
    if (!v.emit) {
      expect(v.code).toBe("E8_ONHAND_GT_INITIAL");
      expect(v.row.detail).toBe("on_hand 12 > received 10");
    }
  });

  it("E7 fires when there is no cost, and the row is WITHHELD", () => {
    const v = lot({ totalCostMinorUnits: null });
    expect(v.emit).toBe(false);
    if (!v.emit) {
      expect(v.code).toBe("E7_TOTALCOST_ZERO");
      expect(v.row.detail).toBe("no unit cost recorded");
    }
  });

  it("a trade sample with no cost IS emitted, at 0.01", () => {
    const v = lot({ totalCostMinorUnits: null, isSample: true });
    expect(v.emit).toBe(true);
    if (v.emit) expect(v.totalCost).toBe("0.01");
  });

  it("E8 is reported BEFORE E7 when a lot trips both", () => {
    // Fixing the physical count is the operator's first action; the missing
    // cost is a data-entry fix. Reporting both at once is noise.
    const v = lot({ initialQty: 10, onHandQty: 12, totalCostMinorUnits: null });
    expect(v.emit).toBe(false);
    if (!v.emit) expect(v.code).toBe("E8_ONHAND_GT_INITIAL");
  });

  it("on_hand == initial is emitted (boundary, not an error)", () => {
    expect(lot({ initialQty: 50, onHandQty: 50 }).emit).toBe(true);
  });

  const product = (over: Partial<Parameters<typeof productRowIssues>[0]> = {}) =>
    productRowIssues({
      id: "PROD-1",
      label: "Blue Dream Flower 3.5g",
      inventoryType: "Usable Cannabis",
      unitWeightGrams: "3.5",
      description: "Indoor flower, 3.5 g jar",
      ...over,
    });

  it("a complete Usable Cannabis product raises nothing", () => {
    expect(product()).toEqual([]);
  });

  it("E9 fires for a gated type with no weight", () => {
    const out = product({ unitWeightGrams: "" });
    expect(out.map((o) => o.code)).toEqual(["E9_UNITWEIGHT_ZERO_USABLE"]);
  });

  it("E9 fires for a weight of literal 0", () => {
    // [G L0434] "If Useable Cannabis is selected, Unit Weight Gram cannot be 0"
    expect(product({ unitWeightGrams: "0" }).map((o) => o.code)).toEqual([
      "E9_UNITWEIGHT_ZERO_USABLE",
    ]);
  });

  it("E10 fires for a gated type with a blank description", () => {
    expect(product({ description: "   " }).map((o) => o.code)).toEqual([
      "E10_DESCRIPTION_REQUIRED",
    ]);
  });

  it("BOTH codes are returned when both are missing — never just the first", () => {
    const out = product({ unitWeightGrams: "", description: "" });
    expect(out.map((o) => o.code).sort()).toEqual([
      "E10_DESCRIPTION_REQUIRED",
      "E9_UNITWEIGHT_ZERO_USABLE",
    ]);
  });

  it("a NON-gated type with no weight and no description is fine  [G L0490]", () => {
    // "All other product types weight can be reported as 0"
    expect(product({ inventoryType: "Concentrate", unitWeightGrams: "", description: "" })).toEqual(
      [],
    );
  });

  it("the guide's own spelling is gated too", () => {
    expect(product({ inventoryType: "Useable cannabis", description: "" }).map((o) => o.code)).toEqual(
      ["E10_DESCRIPTION_REQUIRED"],
    );
  });
});

describe("E13 wired into the REAL mapAdjustmentRow  [G L1111]", () => {
  const src = (over: Partial<Parameters<typeof mapAdjustmentRow>[0]> = {}) => ({
    id: "adj-1",
    qty_delta: -3,
    reason: "employee_sample", // maps to CCRS "Other"
    note: "Trade sample provided to Jane Budtender.",
    created_at: "2025-06-15T20:00:00.000Z",
    lot: { id: "lot-1", lot_code: "LOT-A", pos_product_key: "SKU-1" },
    ...over,
  });
  const license = { licenseNumber: "413541", submittedBy: "Greenway Marijuana" };

  it("an Other adjustment WITH a detail still maps to a row", () => {
    const r = mapAdjustmentRow(src(), license);
    expect(r.row).not.toBeNull();
    expect(r.row?.[2]).toBe("Other");
    expect(r.row?.[3]).toContain("Jane Budtender");
  });

  it("an Other adjustment with NO detail is withheld with the E13 prefix", () => {
    const r = mapAdjustmentRow(src({ note: null }), license);
    expect(r.row).toBeNull();
    expect(r.skipReason).toContain(E13_SKIP_PREFIX);
    expect(r.skipReason).toContain("[G L1111]");
  });

  it("a whitespace-only detail counts as missing", () => {
    const r = mapAdjustmentRow(src({ note: "   \n  " }), license);
    expect(r.row).toBeNull();
    expect(r.skipReason).toContain(E13_SKIP_PREFIX);
  });

  it("a THEFT adjustment with no detail is withheld", () => {
    const r = mapAdjustmentRow(src({ reason: "theft", note: "" }), license);
    expect(r.row).toBeNull();
    expect(r.skipReason).toContain(E13_SKIP_PREFIX);
  });

  it("a DESTRUCTION adjustment needs no detail and still maps", () => {
    const r = mapAdjustmentRow(src({ reason: "destruction", note: null }), license);
    expect(r.row).not.toBeNull();
    expect(r.row?.[2]).toBe("Destruction");
  });

  it("a customer RETURN keeps working — it writes its own detail", () => {
    // disposition.ts L676-L684 writes the note; this is the regression guard
    // the roadmap called out for S-02.
    const r = mapAdjustmentRow(
      src({ reason: "customer_return", qty_delta: 2, note: "Customer return: added back 2 unit(s)." }),
      license,
    );
    expect(r.row).not.toBeNull();
    expect(r.row?.[3]).toContain("Customer return");
  });
});

describe("embedded pure self-test", () => {
  it("__runCcrsPreflightCoreTests passes", () => {
    const out = __runCcrsPreflightCoreTests();
    expect(out).toContain("0 failed");
  });
});
