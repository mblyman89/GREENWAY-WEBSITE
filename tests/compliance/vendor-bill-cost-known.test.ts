/**
 * tests/compliance/vendor-bill-cost-known.test.ts
 *
 * books-92 / D-72 — "cost UNKNOWN" is not "cost zero".
 *
 * Michael, verbatim: "the system needs to know that every product coming in
 * has a cost attached. Unless it is a sample. Those are zero cost, and the
 * system knows how to keep them separate from menu products."
 *
 * The old code asked "how much?" (`Number(lot.unit_cost_minor_units) || 0`)
 * without ever asking "do we KNOW?". A lawfully free trade sample and a lot
 * whose invoice price nobody keyed both evaluated to 0, and both were dropped
 * by `if (extended === 0) continue;`.
 *
 * Dropping the sample is right. Dropping the unpriced purchase understates the
 * payable AND the inventory value; understated inventory is understated COGS,
 * which under 280E is OVERSTATED taxable income. The books still balance, so
 * nothing looks wrong. That is the defect this file pins.
 *
 * These run under vitest (not the tsx pure-selftest runner) because
 * vendor-bill-service transitively imports supabase/admin, whose `server-only`
 * marker only resolves under the vitest alias. Documented precedent:
 * product-lookup-core, and journal-specimen-core in books-91.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import {
  translateLotsToBillLines,
  VENDOR_BILL_SERVICE_CODES,
  type BillLotRow,
} from "../../src/lib/accounting/vendor-bill-service";
import {
  classifyLotCost,
  lotIsBillable,
  __runLotCostClassificationTests,
} from "../../src/lib/accounting/lot-cost-classification-core";
import { aggregateLotCosts } from "../../src/lib/payments/vendor-payables-store";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** An ordinary PURCHASED lot. Samples must say `is_sample: true` explicitly. */
const lot = (over: Partial<BillLotRow> = {}): BillLotRow => ({
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  lot_code: "LOT-A",
  category: "Flower",
  received_qty: 10,
  unit_cost_minor_units: 1500,
  status: "active",
  is_sample: false,
  ...over,
});

/* ── 1) THE DANGEROUS CASE: a mixed manifest ──────────────────────────────── */

describe("D-72: a half-priced manifest must not post a half bill", () => {
  it("refuses the WHOLE bill when any purchased lot has no cost", () => {
    const res = translateLotsToBillLines([
      lot({ id: "p1", lot_code: "PRICED-1", unit_cost_minor_units: 1500 }),
      lot({ id: "u1", lot_code: "UNPRICED-1", unit_cost_minor_units: null }),
    ]);

    expect(res.kind).toBe("refused");
    if (res.kind !== "refused") throw new Error("unreachable");
    expect(res.code).toBe("BILL_LOT_COST_UNKNOWN");
    // It must NAME the lot Michael has to go fix.
    expect(res.message).toContain("UNPRICED-1");
    // ...and it must NOT name the priced one as a problem.
    expect(res.message).toContain("Nothing was recorded");
  });

  it("explains that posting only the priced half would overstate the tax", () => {
    const res = translateLotsToBillLines([
      lot({ id: "p1", lot_code: "PRICED-1" }),
      lot({ id: "u1", lot_code: "UNPRICED-1", unit_cost_minor_units: null }),
    ]);
    if (res.kind !== "refused") throw new Error("expected refusal");
    // The 280E consequence is the whole reason this refuses instead of posting.
    expect(res.message).toContain("cost of goods sold");
    expect(res.message).toContain("overstates the tax");
  });

  it("does NOT mention the priced-half warning when nothing was priced", () => {
    const res = translateLotsToBillLines([
      lot({ id: "u1", lot_code: "UNPRICED-1", unit_cost_minor_units: null }),
      lot({ id: "u2", lot_code: "UNPRICED-2", unit_cost_minor_units: null }),
    ]);
    if (res.kind !== "refused") throw new Error("expected refusal");
    expect(res.code).toBe("BILL_LOT_COST_UNKNOWN");
    expect(res.message).toContain("UNPRICED-1");
    expect(res.message).toContain("UNPRICED-2");
    // No priced lots exist, so the "other lot(s) here ARE priced" clause must
    // be absent. A message that cries wolf about a half it does not have is a
    // message Michael learns to ignore.
    expect(res.message).not.toContain("ARE priced");
  });

  it("counts the unpriced lots exactly", () => {
    const res = translateLotsToBillLines([
      lot({ id: "p1", lot_code: "P1" }),
      lot({ id: "u1", lot_code: "U1", unit_cost_minor_units: null }),
      lot({ id: "u2", lot_code: "U2", unit_cost_minor_units: null }),
      lot({ id: "u3", lot_code: "U3", unit_cost_minor_units: null }),
    ]);
    if (res.kind !== "refused") throw new Error("expected refusal");
    // Rule 89: the count is STATED, so it is asserted.
    expect(res.message).toContain("3 lot(s) on this delivery");
    expect(res.message).toContain("1 other lot(s) here ARE priced");
  });
});

/* ── 2) THE SAMPLE: lawfully free, and never called a missing cost ────────── */

describe("D-72: a free trade sample is not a missing price", () => {
  it("excludes a sample and still bills the purchased lots in full", () => {
    const res = translateLotsToBillLines([
      lot({ id: "p1", lot_code: "P1", received_qty: 10, unit_cost_minor_units: 1500 }),
      lot({ id: "s1", lot_code: "S1", unit_cost_minor_units: null, is_sample: true }),
    ]);

    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") throw new Error("unreachable");
    // 10 x 1500 = 15000, computed here, not read back from the engine.
    expect(res.totalCents).toBe(15_000);
    expect(res.lines).toHaveLength(1);
    expect(res.lines[0].description).toBe("Lot P1");
  });

  it("a sample-only delivery is a COMPLETE outcome, not a to-do", () => {
    const res = translateLotsToBillLines([
      lot({ id: "s1", lot_code: "S1", unit_cost_minor_units: null, is_sample: true }),
      lot({ id: "s2", lot_code: "S2", unit_cost_minor_units: null, is_sample: true }),
    ]);

    expect(res.kind).toBe("refused");
    if (res.kind !== "refused") throw new Error("unreachable");
    expect(res.code).toBe("BILL_NO_BILLABLE_LOTS");
    // It must say the outcome is CORRECT...
    expect(res.message).toContain("that is correct");
    expect(res.message).toContain("free trade samples");
    expect(res.message).toContain("2 lot(s)");
    // ...and must NOT send Michael hunting for prices that do not exist.
    expect(res.message).not.toContain("Add the unit costs");
    expect(res.message).not.toContain("Key the unit costs");
  });

  it("a sample is never reported as an unpriced lot", () => {
    const res = translateLotsToBillLines([
      lot({ id: "p1", lot_code: "P1" }),
      lot({ id: "s1", lot_code: "SAMPLE-1", unit_cost_minor_units: null, is_sample: true }),
    ]);
    // The whole point: this must NOT refuse for a missing cost.
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") throw new Error("unreachable");
    expect(JSON.stringify(res.lines)).not.toContain("SAMPLE-1");
  });

  it("a sample WITH a cost keyed on it is still not billed", () => {
    // Samples are free by law. If someone keys a price onto one, the price is
    // the error, not the sample flag. Billing it would invent a payable.
    const res = translateLotsToBillLines([
      lot({ id: "p1", lot_code: "P1", received_qty: 10, unit_cost_minor_units: 1500 }),
      lot({ id: "s1", lot_code: "S1", unit_cost_minor_units: 9999, is_sample: true }),
    ]);
    if (res.kind !== "ok") throw new Error("expected ok");
    expect(res.totalCents).toBe(15_000);
  });
});

/* ── 3) THE OLD BEHAVIOUR MUST NOT COME BACK ──────────────────────────────── */

describe("D-72: regression pins", () => {
  it("an all-purchased priced manifest is unaffected", () => {
    const res = translateLotsToBillLines([
      lot({ id: "p1", lot_code: "P1", received_qty: 10, unit_cost_minor_units: 1500 }),
      lot({ id: "p2", lot_code: "P2", received_qty: 4, unit_cost_minor_units: 2500 }),
    ]);
    if (res.kind !== "ok") throw new Error("expected ok");
    expect(res.totalCents).toBe(25_000); // 15000 + 10000
    expect(res.lines).toHaveLength(2);
  });

  it("a rejected-at-dock unpriced lot does NOT block the bill", () => {
    // Rejected lots are excluded before classification. A lot we refused at
    // the dock has no cost precisely because we are not buying it.
    const res = translateLotsToBillLines([
      lot({ id: "p1", lot_code: "P1", received_qty: 10, unit_cost_minor_units: 1500 }),
      lot({ id: "r1", lot_code: "R1", unit_cost_minor_units: null, status: "rejected" }),
    ]);
    if (res.kind !== "ok") throw new Error("expected ok");
    expect(res.totalCents).toBe(15_000);
  });

  it("undefined cost is treated as unknown, exactly like null", () => {
    const res = translateLotsToBillLines([
      lot({ id: "u1", lot_code: "U1", unit_cost_minor_units: undefined as unknown as null }),
    ]);
    if (res.kind !== "refused") throw new Error("expected refusal");
    expect(res.code).toBe("BILL_LOT_COST_UNKNOWN");
  });

  it("a genuine keyed zero on a purchase is still not a bill line", () => {
    // Zero that someone deliberately keyed is KNOWN. It moves no money, so it
    // adds no line, but it must not be reported as a missing cost either.
    const res = translateLotsToBillLines([
      lot({ id: "p1", lot_code: "P1", received_qty: 10, unit_cost_minor_units: 1500 }),
      lot({ id: "z1", lot_code: "Z1", received_qty: 5, unit_cost_minor_units: 0 }),
    ]);
    if (res.kind !== "ok") throw new Error("expected ok");
    expect(res.totalCents).toBe(15_000);
    expect(res.lines).toHaveLength(1);
  });

  it("the new refusal code is registered in the public code list", () => {
    expect(VENDOR_BILL_SERVICE_CODES).toContain("BILL_LOT_COST_UNKNOWN");
  });
});

/* ── 4) SOURCE PINS: the door is really wired (rule 133) ──────────────────── */

describe("D-72: the wiring, in the source", () => {
  const SERVICE = read("src/lib/accounting/vendor-bill-service.ts");
  const PAYABLES = read("src/lib/payments/vendor-payables-store.ts");

  const strip = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("the comment stripper actually strips (rule 48)", () => {
    // If the stripper silently did nothing, every 'not.toContain' below would
    // pass by reading a comment instead of code.
    expect(SERVICE).toContain("D-72");
    expect(strip(SERVICE)).not.toContain("D-72");
  });

  it("the bill engine SELECTS is_sample from the database", () => {
    // A classifier that never receives the column classifies nothing.
    expect(strip(SERVICE)).toContain("unit_cost_minor_units, status, is_sample");
  });

  it("the payables screen selects it too, so screen and ledger agree", () => {
    expect(strip(PAYABLES)).toContain("unit_cost_minor_units, status, is_sample");
  });

  it("the engine no longer coerces an unknown cost to zero", () => {
    const src = strip(SERVICE);
    // The exact defective expression, gone.
    expect(src).not.toContain("Number(lot.unit_cost_minor_units) || 0");
    // Replaced by a call to the ONE shared classifier.
    expect(src).toContain("classifyLotCost(lot)");
  });

  it("the payables screen no longer coerces an unknown cost to zero", () => {
    const src = strip(PAYABLES);
    expect(src).not.toContain("Number(lot.unit_cost_minor_units) || 0");
    expect(src).toMatch(/unpricedByManifest/);
  });

  it("BOTH callers use the SAME classifier, not two copies of the rule", () => {
    // Rule 25: extend, do not duplicate. Two copies of "what does this lot
    // cost" drift, and then the screen and the ledger disagree about money.
    const svc = strip(SERVICE);
    const pay = strip(PAYABLES);
    for (const src of [svc, pay]) {
      expect(src).toContain("lot-cost-classification-core");
      expect(src).toContain("classifyLotCost");
    }
    // Neither file may re-implement the null/undefined/NaN test locally.
    for (const src of [svc, pay]) {
      expect(src).not.toMatch(/rawCost\s*===\s*null\s*\|\|/);
    }
  });

  it("the unknown-cost refusal is returned BEFORE the empty-lines case", () => {
    // Otherwise a wholly unpriced manifest reports 'everything costs zero'
    // instead of 'nobody keyed the prices'.
    const src = strip(SERVICE);
    const unknownReturn = src.indexOf('code: "BILL_LOT_COST_UNKNOWN"');
    const emptyCase = src.indexOf("if (lines.length === 0)");
    expect(unknownReturn).toBeGreaterThan(-1);
    expect(emptyCase).toBeGreaterThan(-1);
    expect(unknownReturn).toBeLessThan(emptyCase);
  });

  it("the payables row exposes the unpriced count to the screen", () => {
    expect(strip(PAYABLES)).toContain("unpricedLotCount");
  });

  it("listVendorPayables maps the REAL tally onto the row, not a constant", () => {
    // DELIBERATE LIMIT (rule 133f): this one line sits inside
    // listVendorPayables, which needs a live Supabase connection, so no
    // behavioural test in this repo can execute it. The aggregation it reads
    // from IS behaviourally tested above via aggregateLotCosts(). What is
    // pinned here is the wiring between the two: that the row publishes the
    // computed tally rather than a hard-coded zero, which would make every
    // manifest look fully priced on the payment screen.
    expect(strip(PAYABLES)).toContain(
      "unpricedLotCount: unpricedByManifest.get(m.id) ?? 0",
    );
    expect(strip(PAYABLES)).not.toMatch(/unpricedLotCount:\s*0\s*,/);
  });
});

/* ── 5) THE SHARED CLASSIFIER, DIRECTLY ───────────────────────────────────── */

describe("D-72: the one classifier both callers use", () => {
  it("passes its own self-test", () => {
    expect(() => __runLotCostClassificationTests()).not.toThrow();
  });

  it("tells the three cases apart", () => {
    expect(classifyLotCost({ unit_cost_minor_units: null, is_sample: true })).toBe("sample");
    expect(classifyLotCost({ unit_cost_minor_units: null, is_sample: false })).toBe("unpriced");
    expect(classifyLotCost({ unit_cost_minor_units: 1500, is_sample: false })).toBe("priced");
  });

  it("never calls an unknown cost billable", () => {
    // This single assertion is the whole defect: if it ever returns true, an
    // unpriced lot silently becomes a $0.00 line again.
    expect(lotIsBillable({ unit_cost_minor_units: null, is_sample: false })).toBe(false);
    expect(lotIsBillable({ unit_cost_minor_units: undefined, is_sample: false })).toBe(false);
    expect(lotIsBillable({ unit_cost_minor_units: Number.NaN, is_sample: false })).toBe(false);
  });

  it("checks the sample flag BEFORE the missing-cost test", () => {
    // Behavioural, not textual: a sample with no cost must come back "sample".
    // If the order were reversed it would come back "unpriced" and every
    // sample delivery would block.
    expect(classifyLotCost({ unit_cost_minor_units: null, is_sample: true })).toBe("sample");
  });

  it("a keyed zero is knowledge, not absence", () => {
    expect(classifyLotCost({ unit_cost_minor_units: 0, is_sample: false })).toBe("priced");
    expect(lotIsBillable({ unit_cost_minor_units: 0, is_sample: false })).toBe(true);
  });
});

/* ── 6) THE PAYABLES SCREEN COMPUTES THE SAME WAY ─────────────────────────── */

describe("D-72: the screen cannot disagree with the ledger", () => {
  // Rule 39: a test that re-implements what it checks proves nothing. So this
  // calls the store's REAL roll-up, which is exported precisely so it can be
  // exercised without a database.
  const M = "manifest-1";
  const rows = [
    { manifest_id: M, received_qty: 10, unit_cost_minor_units: 1500, status: "active", is_sample: false },
    { manifest_id: M, received_qty: 2, unit_cost_minor_units: null, status: "active", is_sample: true },
    { manifest_id: M, received_qty: 5, unit_cost_minor_units: null, status: "active", is_sample: false },
  ];

  it("does not add an unknown cost in as zero", () => {
    const agg = aggregateLotCosts(rows);
    // Only the priced lot: 10 x 1500. The unpriced lot must NOT land as 0,
    // and the sample must not land at all.
    expect(agg.owedByManifest.get(M)).toBe(15_000);
  });

  it("counts the unpriced lot so the screen can say the total is incomplete", () => {
    // If this count is lost, the screen shows a total that looks final while
    // the bill engine refuses the very same manifest.
    const agg = aggregateLotCosts(rows);
    expect(agg.unpricedByManifest.get(M) ?? 0).toBe(1);
  });

  it("still counts every delivered lot, samples included", () => {
    const agg = aggregateLotCosts(rows);
    expect(agg.lotCountByManifest.get(M)).toBe(3);
  });

  it("a rejected lot is excluded from the roll-up entirely", () => {
    const agg = aggregateLotCosts([
      ...rows,
      { manifest_id: M, received_qty: 9, unit_cost_minor_units: null, status: "rejected", is_sample: false },
    ]);
    // The rejected lot must not inflate the unpriced count, or Michael would
    // be told to price something he refused at the dock.
    expect(agg.unpricedByManifest.get(M) ?? 0).toBe(1);
    expect(agg.lotCountByManifest.get(M)).toBe(3);
  });

  it("a fully priced manifest reports nothing unpriced", () => {
    const agg = aggregateLotCosts([
      { manifest_id: M, received_qty: 10, unit_cost_minor_units: 1500, status: "active", is_sample: false },
    ]);
    expect(agg.owedByManifest.get(M)).toBe(15_000);
    expect(agg.unpricedByManifest.get(M) ?? 0).toBe(0);
  });

  it("the engine REFUSES the very manifest whose total the screen shows", () => {
    // Same three lots, through the real engine. The screen showing $150.00
    // while the ledger posts nothing is the contradiction D-72 must prevent
    // being silent about.
    const res = translateLotsToBillLines([
      lot({ id: "p1", lot_code: "P1", received_qty: 10, unit_cost_minor_units: 1500 }),
      lot({ id: "s1", lot_code: "S1", unit_cost_minor_units: null, is_sample: true }),
      lot({ id: "u1", lot_code: "U1", received_qty: 5, unit_cost_minor_units: null }),
    ]);
    expect(res.kind).toBe("refused");
    if (res.kind !== "refused") throw new Error("unreachable");
    expect(res.code).toBe("BILL_LOT_COST_UNKNOWN");
    expect(res.message).toContain("U1");
    // and the sample is not blamed
    expect(res.message).not.toContain("S1");
  });
});

/* ── 7) REACHABILITY: the warning reaches the screen (rule 133) ───────────── */

describe("D-72: Michael can SEE that a total is incomplete", () => {
  const ACTIONS = read("src/app/admin/vendor-payments/actions.ts");
  const ACH = read("src/app/admin/vendor-payments/VendorAchForm.tsx");
  const MANUAL = read("src/app/admin/vendor-payments/ManualPaymentForm.tsx");
  const strip2 = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("the stripper strips (rule 48)", () => {
    expect(ACTIONS).toContain("D-72");
    expect(strip2(ACTIONS)).not.toContain("D-72");
  });

  it("the payable option carries the unpriced count out of the store", () => {
    const src = strip2(ACTIONS);
    expect(src).toContain("unpricedLotCount: number");
    // and it is POPULATED from the store row, not hard-coded for manifests
    expect(src).toContain("unpricedLotCount: r.unpricedLotCount");
  });

  it("both payment screens render the warning", () => {
    // A number that reaches no screen warns nobody. This is the door.
    for (const src of [strip2(ACH), strip2(MANUAL)]) {
      expect(src).toContain("unpricedLotCount > 0");
      expect(src).toContain("total incomplete");
    }
  });
});
