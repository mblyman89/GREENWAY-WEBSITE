/**
 * tests/compliance/receipt-wiring.test.ts   (books-81)
 *
 * Proves the RECEIVING WIRE, which the census scored `reachable: MISSING`
 * for three slices: a physical delivery now reaches a journal entry.
 *
 * Deliberately NOT exhaustive. The category table's own consistency is
 * asserted by the self-tests inside the module (run by run-pure-selftests.ts),
 * so this file tests the things a self-test structurally CANNOT:
 *
 *   1. that the wire actually exists in the app action (reachability), and
 *   2. that the safety-critical refusals are real refusals, probed by mutation
 *      rather than by reading the source.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { INVENTORY_CATEGORIES, inventoryAccountCode } from "../../src/lib/accounting/coa-core";
import {
  mapReceiptCategory,
  mappableSlugs,
  normaliseCategoryKey,
  __runReceiptCategoryCoreTests,
} from "../../src/lib/accounting/receipt-category-core";
import { translateLotsToReceiptLines, type ManifestLotRow } from "../../src/lib/accounting/receipt-service";
import { buildReceiptJournal } from "../../src/lib/accounting/receipt-journal-core";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const lot = (over: Partial<ManifestLotRow> = {}): ManifestLotRow => ({
  id: "11111111-1111-1111-1111-111111111111",
  lot_code: "LOT-A",
  category: "Flower",
  received_qty: 10,
  unit_cost_minor_units: 1500,
  ...over,
});

describe("the category mapper refuses instead of guessing", () => {
  it("passes its own self-tests", () => {
    expect(() => __runReceiptCategoryCoreTests()).not.toThrow();
  });

  it("reaches all 21 inventory accounts, so none is dark", () => {
    // An unreachable category is an account that can never receive stock,
    // which would silently push that product line into quarantine forever.
    const all = INVENTORY_CATEGORIES.map((c) => c.slug).sort();
    expect(mappableSlugs()).toEqual(all);
  });

  it("keeps every category on its OWN account — the reason this module exists", () => {
    // If two slugs ever shared an account, the mapper's precision would be
    // pointless and the POS map could have been reused.
    const codes = INVENTORY_CATEGORIES.map((c) => inventoryAccountCode(c.slot));
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("does NOT inherit the POS map's collapsing of rso/tincture/blunt", () => {
    // pos/transform.ts#CATEGORY_MAP sends RSO -> concentrate, Tincture ->
    // edible-liquid, Blunt -> preroll. Those three accounts (20150, 20180,
    // 20070) would never receive a cent if that map were reused here.
    expect(mapReceiptCategory("RSO")).toMatchObject({ kind: "mapped", slug: "rso" });
    expect(mapReceiptCategory("Tincture")).toMatchObject({ kind: "mapped", slug: "tincture" });
    expect(mapReceiptCategory("Blunt")).toMatchObject({ kind: "mapped", slug: "blunt" });
  });

  it("refuses an unrecognised category rather than defaulting it", () => {
    const m = mapReceiptCategory("Sparkling Unicorn Extract");
    expect(m.kind).toBe("refused");
    // The POS map's answer for anything unknown is "concentrate". If this ever
    // returns that, real money silently lands in account 20140.
    expect(m).not.toMatchObject({ kind: "mapped", slug: "concentrate" });
  });

  it("separates an honest blank from an unrecognised string", () => {
    // Blank = intake never captured it -> quarantine (a to-do list).
    // Unknown string = new vendor vocabulary -> refuse (a decision).
    // Collapsing these would bury new categories inside quarantine.
    expect(mapReceiptCategory(null).kind).toBe("unknown");
    expect(mapReceiptCategory("   ").kind).toBe("unknown");
    expect(mapReceiptCategory("Wobbleflange").kind).toBe("refused");
  });

  it("folds spelling variants so one product is not three accounts", () => {
    for (const v of ["Pre-Roll", "pre roll", "PREROLL"]) {
      expect(mapReceiptCategory(v)).toMatchObject({ slug: "preroll" });
    }
    expect(normaliseCategoryKey("  Pre-Roll  ")).toBe("pre roll");
  });
});

describe("translating real lot rows into receipt lines", () => {
  it("refuses the WHOLE delivery when any one lot is unrecognised", () => {
    // Partial capitalisation is the dangerous outcome: the entry still
    // balances and 20800 is still credited, so the shortfall is invisible
    // until the vendor's bill disagrees.
    const out = translateLotsToReceiptLines([
      lot({ lot_code: "GOOD" }),
      lot({ id: "2", lot_code: "BAD", category: "Wobbleflange" }),
    ]);
    expect(out.kind).toBe("refused");
    if (out.kind !== "refused") throw new Error("unreachable");
    expect(out.code).toBe("RECEIPT_CATEGORY_REFUSED");
    expect(out.message).toContain("BAD");
  });

  it("refuses an empty manifest instead of posting an empty entry", () => {
    const out = translateLotsToReceiptLines([]);
    expect(out).toMatchObject({ kind: "refused", code: "RECEIPT_NO_LOTS" });
  });

  it("sends a blank category to quarantine rather than refusing", () => {
    const out = translateLotsToReceiptLines([lot({ category: null })]);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") throw new Error("unreachable");
    expect(out.lines[0].categorySlug).toBeNull();
  });

  it("passes quantity and cost through UNCHANGED so the builder's refusals stand", () => {
    // If this file quietly defaulted a missing cost to 0, buildReceiptJournal's
    // UNIT_COST_UNKNOWN refusal could never fire and inventory would be
    // capitalised at nothing.
    const out = translateLotsToReceiptLines([lot({ unit_cost_minor_units: null })]);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") throw new Error("unreachable");
    expect(out.lines[0].unitCostCents).toBeNull();

    // ...and the builder then refuses, which is the point of passing it through.
    const built = buildReceiptJournal({
      receivedDate: "2026-11-01",
      receiptRef: "M-1",
      vendorName: "V",
      lines: out.lines,
    });
    expect(built).toMatchObject({ kind: "refused", code: "UNIT_COST_UNKNOWN" });
  });

  it("produces a balanced entry that reaches the right account, end to end", () => {
    const out = translateLotsToReceiptLines([
      lot({ lot_code: "L1", category: "Flower", received_qty: 10, unit_cost_minor_units: 1500 }),
      lot({ id: "2", lot_code: "L2", category: "RSO", received_qty: 2, unit_cost_minor_units: 5000 }),
    ]);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") throw new Error("unreachable");

    const built = buildReceiptJournal({
      receivedDate: "2026-11-01",
      receiptRef: "M-1",
      vendorName: "Acme",
      lines: out.lines,
    });
    expect(built.kind).toBe("built");
    if (built.kind !== "built") throw new Error("unreachable");

    const sum = built.journal.lines.reduce((s, l) => s + l.amountCents, 0);
    expect(sum).toBe(0);
    expect(built.totalCostCents).toBe(10 * 1500 + 2 * 5000);

    const codes = built.journal.lines.map((l) => l.accountCode);
    expect(codes).toContain("20010"); // flower
    expect(codes).toContain("20150"); // rso — NOT folded into concentrate
    expect(codes).toContain("20800"); // goods received not invoiced
  });
});

describe("the wire itself — reachability, which nothing pure can see", () => {
  const action = read("src/app/admin/inventory/intake/actions.ts");

  it("the receive action really calls the receipt service", () => {
    // This is the census's `reachable` layer expressed as a test. A builder
    // with no caller posts nothing, however good its arithmetic is.
    expect(action).toContain("postManifestReceipt");
    expect(action).toMatch(/if\s*\(\s*status\s*===\s*"received"\s*\)/);
  });

  it("the service is only invoked on 'received', not on 'in_transit'", () => {
    // Capitalising goods that are still on a truck would overstate inventory.
    const idx = action.indexOf("postManifestReceipt");
    const gate = action.lastIndexOf('status === "received"', idx);
    expect(gate).toBeGreaterThan(-1);
    expect(idx - gate).toBeLessThan(1200);
  });

  it("a refusal from the books is surfaced, never swallowed", () => {
    // A catch that discarded the error would recreate the exact defect this
    // slice closes: a wire that looks connected and posts nothing.
    expect(action).toContain("booksError");
    expect(action).not.toMatch(/catch\s*\{\s*\}/);
  });

  it("uses the Pacific business date, not toISOString()", () => {
    // A late-afternoon Pacific delivery is already tomorrow in UTC, which
    // would file the receipt in the wrong accounting period.
    expect(action).toContain("pacificParts");
  });

  it("the service posts through the real ledger door", () => {
    const svc = read("src/lib/accounting/receipt-service.ts");
    expect(svc).toContain("submitJournal");
    expect(svc).toContain("buildReceiptJournal");
    // It must write the cost the LEDGER used, which is what unblocks the sale.
    expect(svc).toContain("unit_cost_minor_units");
  });

  it("posts BEFORE stamping costs, so an interruption refuses the sale rather than corrupting it", () => {
    const svc = read("src/lib/accounting/receipt-service.ts");
    const post = svc.indexOf("await submitJournal");
    // Whitespace-tolerant on purpose: a reformat must not turn a real
    // ordering guarantee into a red build, nor a red build into a silent pass.
    const stampMatch = /\.from\(\s*"inventory_lots"\s*\)\s*\.update/.exec(svc);
    const stamp = stampMatch ? stampMatch.index : -1;
    expect(post).toBeGreaterThan(-1);
    expect(stamp).toBeGreaterThan(-1);
    expect(post).toBeLessThan(stamp);
  });

  it("no guard in the service has been short-circuited", () => {
    // Same lesson as books-80: assert the CONDITION, not the message text.
    const svc = read("src/lib/accounting/receipt-service.ts");
    expect(svc).not.toMatch(/if\s*\(\s*false\s*\)/);
    expect(svc).not.toMatch(/if\s*\(\s*true\s*\)/);
  });
});
