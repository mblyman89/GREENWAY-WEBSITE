/**
 * tests/compliance/po-receive-core.test.ts
 *
 * W6 — pins the auto-receive matching/planning contract:
 *   - pos_product_key is THE matching key (audit rule 8); exact key match
 *     outranks the normalized-name fallback, and name matches are FLAGGED;
 *   - lots that match nothing are never force-received — listed for manual;
 *   - duplicate-key lines fill remaining need first; overflow is honest OVER;
 *   - prior partial receipts count toward exact/under/over outcomes;
 *   - the timeline note tells the human everything: name matches, variances,
 *     undelivered lines, unmatched lots. PURE — no writes here.
 */
import { describe, expect, it } from "vitest";
import {
  buildAutoReceivePlan,
  normalizeProductName,
  __runPoReceiveCoreTests,
  type ReceivableLot,
  type ReceivablePoLine,
} from "@/lib/inventory/po-receive-core";

function lot(over: Partial<ReceivableLot>): ReceivableLot {
  return {
    id: "lot1",
    pos_product_key: "SKU-1",
    product_name: "Blue Dream 1g",
    received_qty: 10,
    ...over,
  };
}

function line(over: Partial<ReceivablePoLine>): ReceivablePoLine {
  return {
    id: "line1",
    pos_product_key: "SKU-1",
    product_name: "Blue Dream 1g",
    order_qty: 10,
    received_qty: 0,
    unit: "each",
    ...over,
  };
}

describe("po-receive-core: matching", () => {
  it("receives an exact key match with an exact outcome", () => {
    const p = buildAutoReceivePlan([lot({})], [line({})]);
    expect(p.receipts).toHaveLength(1);
    expect(p.receipts[0]).toMatchObject({ lineId: "line1", qty: 10, matchedBy: "key" });
    expect(p.deltas[0].outcome).toBe("exact");
    expect(p.unmatchedLots).toHaveLength(0);
  });

  it("key match outranks a name match on a different line", () => {
    const p = buildAutoReceivePlan(
      [lot({ pos_product_key: "SKU-2" })],
      [
        line({ id: "byName", pos_product_key: "SKU-1" }),
        line({ id: "byKey", pos_product_key: "SKU-2", product_name: "Other Product" }),
      ],
    );
    expect(p.receipts[0].lineId).toBe("byKey");
  });

  it("falls back to a normalized name match when the lot has no key, and flags it", () => {
    const p = buildAutoReceivePlan(
      [lot({ pos_product_key: null, product_name: "BLUE-DREAM 1G!" })],
      [line({ pos_product_key: "SKU-9" })],
    );
    expect(p.receipts[0].matchedBy).toBe("name");
    expect(p.note).toContain("NAME");
  });

  it("never force-receives an unmatched lot — leaves it for manual", () => {
    const p = buildAutoReceivePlan(
      [lot({ pos_product_key: "ZZZ", product_name: "Mystery Item" })],
      [line({})],
    );
    expect(p.receipts).toHaveLength(0);
    expect(p.unmatchedLots).toEqual([{ lotId: "lot1", label: "Mystery Item", qty: 10 }]);
    expect(p.note).toContain("manually");
  });

  it("skips zero-quantity lots", () => {
    const p = buildAutoReceivePlan([lot({ received_qty: 0 })], [line({})]);
    expect(p.receipts).toHaveLength(0);
    expect(p.unmatchedLots).toHaveLength(0);
  });
});

describe("po-receive-core: allocation & deltas", () => {
  it("sums multiple lots with the same key onto one line and flags OVER", () => {
    const p = buildAutoReceivePlan(
      [lot({ id: "a", received_qty: 6 }), lot({ id: "b", received_qty: 6 })],
      [line({ order_qty: 10 })],
    );
    expect(p.receipts[0].qty).toBe(12);
    expect(p.deltas[0].outcome).toBe("over");
    expect(p.note).toContain("OVER");
  });

  it("prefers the duplicate-key line that still needs product", () => {
    const p = buildAutoReceivePlan(
      [lot({ received_qty: 5 })],
      [
        line({ id: "full", order_qty: 5, received_qty: 5 }),
        line({ id: "open", order_qty: 5 }),
      ],
    );
    expect(p.receipts).toHaveLength(1);
    expect(p.receipts[0].lineId).toBe("open");
  });

  it("counts prior partial receipts toward the outcome", () => {
    const p = buildAutoReceivePlan(
      [lot({ received_qty: 4 })],
      [line({ order_qty: 10, received_qty: 6 })],
    );
    expect(p.deltas[0]).toMatchObject({ previouslyReceived: 6, deliveredNow: 4, outcome: "exact" });
  });

  it("marks a short delivery under and lists undelivered lines in the note", () => {
    const p = buildAutoReceivePlan(
      [lot({ received_qty: 3 })],
      [line({ order_qty: 10 }), line({ id: "l2", pos_product_key: "SKU-9", product_name: "Sour OG" })],
    );
    expect(p.deltas[0].outcome).toBe("under");
    expect(p.deltas[1].outcome).toBe("none");
    expect(p.note).toContain("Sour OG");
  });

  it("plans nothing for empty inputs", () => {
    const p = buildAutoReceivePlan([], []);
    expect(p.receipts).toHaveLength(0);
    expect(p.deltas).toHaveLength(0);
  });
});

describe("po-receive-core: normalizeProductName", () => {
  it("lowercases, strips punctuation, collapses spaces", () => {
    expect(normalizeProductName("  BLUE-DREAM   1G! ")).toBe("blue dream 1g");
    expect(normalizeProductName(null)).toBe("");
  });
});

describe("po-receive-core: embedded self-tests", () => {
  it("pass", () => {
    expect(__runPoReceiveCoreTests().passed).toBeGreaterThan(0);
  });
});
