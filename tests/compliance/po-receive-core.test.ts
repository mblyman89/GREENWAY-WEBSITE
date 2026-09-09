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
    expect(p.unmatchedLots).toEqual([
      { lotId: "lot1", label: "Mystery Item", qty: 10, reason: "no-match" },
    ]);
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

/**
 * DEFECT A (sweep 2026-09). buildAutoReceivePlan WRITES: po-receive-store
 * calls receivePoLine(lineId, qty) for every planned receipt with no human in
 * the loop. When a lot has no pos_product_key and its normalized name matches
 * SEVERAL PO lines, the old code took candidates[0] — silently crediting a
 * coin-flip line. Measured on the 1,707 real strain names in the back-office
 * database: 4 raw name collisions and 12 full-SKU collisions, including the
 * real pair used below, "Orange & Cream" vs "Orange Cream".
 */
describe("po-receive-core: defect A — ambiguous names are refused, not guessed", () => {
  const ambiguousLines = () => [
    line({ id: "l1", pos_product_key: "SKU-A", product_name: "Orange & Cream" }),
    line({ id: "l2", pos_product_key: "SKU-B", product_name: "Orange Cream" }),
  ];

  it("receives NOTHING when a keyless lot's name matches several PO lines", () => {
    const p = buildAutoReceivePlan(
      [lot({ pos_product_key: null, product_name: "Orange Cream" })],
      ambiguousLines(),
    );
    expect(p.receipts).toHaveLength(0);
    expect(p.deltas.every((d) => d.outcome === "none")).toBe(true);
  });

  it("hands the lot to a human with reason ambiguous-name and its full qty", () => {
    const p = buildAutoReceivePlan(
      [lot({ pos_product_key: null, product_name: "Orange Cream", received_qty: 7 })],
      ambiguousLines(),
    );
    expect(p.unmatchedLots).toEqual([
      { lotId: "lot1", label: "Orange Cream", qty: 7, reason: "ambiguous-name" },
    ]);
  });

  it("explains the refusal in the note without claiming the lot is off the PO", () => {
    const p = buildAutoReceivePlan(
      [lot({ pos_product_key: null, product_name: "Orange Cream" })],
      ambiguousLines(),
    );
    expect(p.note).toContain("SEVERAL");
    expect(p.note).toContain("Orange Cream");
    expect(p.note).not.toContain("Not on the PO");
  });

  it("still auto-receives when the name match is unambiguous", () => {
    const p = buildAutoReceivePlan(
      [lot({ pos_product_key: null, product_name: "Orange Cream" })],
      [
        line({ id: "l1", pos_product_key: "SKU-A", product_name: "Orange Cream" }),
        line({ id: "l2", pos_product_key: "SKU-B", product_name: "Grape Ape" }),
      ],
    );
    expect(p.receipts).toHaveLength(1);
    expect(p.receipts[0].lineId).toBe("l1");
    expect(p.receipts[0].matchedBy).toBe("name");
    expect(p.unmatchedLots).toHaveLength(0);
  });

  it("does NOT refuse duplicate lines that share a pos_product_key", () => {
    // Same product on two lines is a duplicate-line problem, not an identity
    // ambiguity — "fill the line that still needs product" stays correct.
    const p = buildAutoReceivePlan(
      [lot({ received_qty: 5 })],
      [
        line({ id: "full", order_qty: 5, received_qty: 5 }),
        line({ id: "open", order_qty: 5, received_qty: 0 }),
      ],
    );
    expect(p.receipts).toHaveLength(1);
    expect(p.receipts[0].lineId).toBe("open");
    expect(p.unmatchedLots).toHaveLength(0);
  });

  it("keeps ambiguous lots OUT of the 'Not on the PO' list even when both kinds occur", () => {
    // Both refusal reasons in one delivery. The 'Not on the PO' sentence must
    // name ONLY the genuine miss — an ambiguous lot IS on the PO (twice), and
    // listing it there would send the receiver hunting for a missing product.
    const p = buildAutoReceivePlan(
      [
        lot({ id: "miss", pos_product_key: "ZZZ", product_name: "Mystery Item" }),
        lot({ id: "amb", pos_product_key: null, product_name: "Orange Cream" }),
      ],
      ambiguousLines(),
    );
    expect(p.note).toContain("Not on the PO");
    expect(p.note).toContain("SEVERAL");
    // Isolate the "Not on the PO" sentence only — the ambiguity sentence
    // follows it and legitimately names the same product.
    const start = p.note.indexOf("Not on the PO");
    const notOnPo = p.note.slice(start, p.note.indexOf(".", start) + 1);
    expect(notOnPo).toContain("Mystery Item");
    expect(notOnPo).not.toContain("Orange Cream");
  });

  it("refuses per-lot: a clean lot in the same delivery still receives", () => {
    const p = buildAutoReceivePlan(
      [
        lot({ id: "good", pos_product_key: "SKU-1", received_qty: 4 }),
        lot({ id: "bad", pos_product_key: null, product_name: "Orange Cream", received_qty: 7 }),
      ],
      [
        line({ id: "l1", pos_product_key: "SKU-1", order_qty: 4, product_name: "Blue Dream 1g" }),
        line({ id: "l2", pos_product_key: "SKU-A", product_name: "Orange & Cream" }),
        line({ id: "l3", pos_product_key: "SKU-B", product_name: "Orange Cream" }),
      ],
    );
    expect(p.receipts.map((r) => r.lineId)).toEqual(["l1"]);
    expect(p.unmatchedLots.map((u) => u.lotId)).toEqual(["bad"]);
    expect(p.note).toContain("Auto-received");
    expect(p.note).toContain("SEVERAL");
  });
});

describe("po-receive-core: normalizeProductName", () => {
  it("lowercases, strips punctuation, collapses spaces", () => {
    expect(normalizeProductName("  BLUE-DREAM   1G! ")).toBe("blue dream 1g");
    expect(normalizeProductName(null)).toBe("");
  });

  /**
   * DEFECT B (sweep 2026-09). "Blue Dream 3.5 g" and "Blue Dream 3.5g" are one
   * product typed two ways, but they used to produce two different keys, so
   * the name fallback missed and the lot fell through to manual receiving.
   * Measured on the 2,615 real product records: this rule closes 2,026 of
   * 2,026 spacing misses and introduces 0 new collisions and 0 size merges.
   * A squeeze-out-all-spaces rule would instead CREATE a real collision.
   */
  it("joins a bare number to its unit so spacing variants share one key", () => {
    expect(normalizeProductName("Blue Dream 1 g")).toBe("blue dream 1g");
    expect(normalizeProductName("Gummies 100 mg")).toBe("gummies 100mg");
    expect(normalizeProductName("Pre-Rolls 10 pk")).toBe("pre rolls 10pk");
    expect(normalizeProductName("Blue Dream 3.5 g")).toBe(normalizeProductName("Blue Dream 3.5g"));
    expect(normalizeProductName("Tincture 30 ml")).toBe("tincture 30ml");
  });

  it("joins EVERY number/unit pair in a name, not just the first", () => {
    // Multi-pack edibles routinely carry two sizes in one name. A non-global
    // regex would join only the leading pair and leave the rest split.
    expect(normalizeProductName("Gummies 10 pk 100 mg")).toBe("gummies 10pk 100mg");
    expect(normalizeProductName("Sampler 5 pk 1 g 2 oz")).toBe("sampler 5pk 1g 2oz");
  });

  it("keeps SIZE as identity — different sizes never collapse together", () => {
    expect(normalizeProductName("Blue Dream 1 g")).not.toBe(normalizeProductName("Blue Dream 3.5 g"));
    expect(normalizeProductName("Gummies 10 mg")).not.toBe(normalizeProductName("Gummies 100 mg"));
  });

  it("only joins the closed unit list, never arbitrary words after a number", () => {
    expect(normalizeProductName("Batch 5 A")).toBe("batch 5 a");
    expect(normalizeProductName("Blue Dream 2 for 1")).toBe("blue dream 2 for 1");
    expect(normalizeProductName("Lot 7 Green")).toBe("lot 7 green");
  });

  it("does not squeeze all whitespace (that regresses on real data)", () => {
    // The measured squeeze-all collision, kept here as a live guard:
    // "Drops 1:1 CBD ... / MAC #4" vs "Drops1:1 CBD ... / MAC #4".
    expect(normalizeProductName("Drops 1:1 CBD Daydreamy Cranberry/MAC #4")).not.toBe(
      normalizeProductName("Drops1:1 CBD Daydreamy Cranberry / MAC #4"),
    );
  });

  it("lets a spacing variant match end to end through the planner", () => {
    const p = buildAutoReceivePlan(
      [lot({ pos_product_key: null, product_name: "Blue Dream 3.5 g" })],
      [line({ pos_product_key: "SKU-9", product_name: "Blue Dream 3.5g" })],
    );
    expect(p.receipts).toHaveLength(1);
    expect(p.receipts[0].matchedBy).toBe("name");
  });
});

describe("po-receive-core: embedded self-tests", () => {
  it("pass", () => {
    expect(__runPoReceiveCoreTests().passed).toBeGreaterThan(0);
  });
});
