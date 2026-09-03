/**
 * SLICE 15 — vitest mirror of the oversold-variance core self-tests, plus the
 * wiring assertions that prove the register actually renders the researched
 * behaviour.
 *
 * The behaviour under test is NOT invented. It comes from
 * docs/slice-15-research-oversold-industry-standard.md:
 *   - Shopify POS: warns BEFORE the sale, never blocks it
 *   - Lightspeed: attributed record in a back-office negative-inventory list
 *   - NetSuite: an oversell is a short-pick and TRIGGERS a count ("zero count")
 *   - WAC 314-55-087(2)(a)(b): the POS must trace a transaction to its source
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  __runOversoldVarianceCoreTests,
  countPromptMessage,
  oversoldVariances,
  type OversoldCartLine,
} from "../../src/lib/pos/oversold-variance-core";

const line = (
  productName: string,
  quantity: number,
  unitsLeft: number | null | undefined,
  variantLabel: string | null = null,
): OversoldCartLine => ({ productName, variantLabel, quantity, unitsLeft });

const saleFlow = readFileSync("src/app/pos/SaleFlow.tsx", "utf8");

/** Comments describe intent; assertions about WIRING must read real code. */
const stripLineComments = (s: string) =>
  s
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
    .join("\n");
const saleFlowCode = stripLineComments(saleFlow);

describe("oversold-variance-core self-tests", () => {
  it("passes its own in-module suite", () => {
    expect(() => __runOversoldVarianceCoreTests()).not.toThrow();
  });
});

describe("oversoldVariances — what counts as a variance", () => {
  it("reports nothing for a sale inside the tracked count", () => {
    expect(oversoldVariances([line("A", 3, 5)])).toEqual([]);
    expect(oversoldVariances([line("A", 5, 5)])).toEqual([]);
  });

  it("reports the shortfall when more left the shelf than was tracked", () => {
    const v = oversoldVariances([line("Blue Dream", 2, 1, "1g")]);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ tracked: 1, sold: 2, shortfall: 1, label: "Blue Dream (1g)" });
  });

  it("never manufactures a variance from an untrustworthy count", () => {
    for (const unknown of [null, undefined, -1, 2.5, NaN, Infinity]) {
      expect(oversoldVariances([line("U", 99, unknown as number | null | undefined)])).toEqual([]);
    }
  });

  it("is driven by the numbers, not by whether an override toggle was flipped", () => {
    // Override ON but nothing sold past the count => no count task.
    expect(oversoldVariances([line("A", 1, 4)])).toEqual([]);
    // Override never touched but a refresh lowered the count => real variance.
    expect(oversoldVariances([line("A", 4, 1)])).toHaveLength(1);
  });
});

describe("countPromptMessage — NetSuite's zero-count command", () => {
  it("renders nothing when there is nothing to recount", () => {
    expect(countPromptMessage([])).toBeNull();
  });

  it("names the product and states the arithmetic", () => {
    const msg = countPromptMessage(oversoldVariances([line("Gone", 3, 0)]))!;
    expect(msg).toContain("Recount Gone");
    expect(msg).toContain("3 sold");
    expect(msg).toContain("off by 3");
  });

  it("totals the shortfall across several products", () => {
    const msg = countPromptMessage(oversoldVariances([line("A", 2, 1), line("B", 5, 2)]))!;
    expect(msg).toContain("these 2 products");
    expect(msg).toContain("off by 4");
  });

  it("is a count command, never a block or a reprimand", () => {
    const msg = countPromptMessage(oversoldVariances([line("A", 2, 1)]))!.toLowerCase();
    for (const bad of ["error", "denied", "not allowed", "cannot", "violation"]) {
      expect(msg).not.toContain(bad);
    }
  });
});

describe("the audit trail lives server-side, and the register does not duplicate it", () => {
  // This block replaced an earlier one that tested a client-side
  // buildOversoldAuditRecords helper. Building the slice proved that helper
  // was the wrong design: the durable, attributed record already exists,
  // written by the server during the decrement. Keeping a second, unused
  // client implementation would have implied the register writes audit rows
  // when it does not \u2014 so it was deleted rather than left as decoration.
  //
  // What the regulation actually demands is still tested, just against the
  // real mechanism: WAC 314-55-087(2)(a) an audit trail underlying the
  // summary data, and (b) the ability to trace a transaction to its source.

  it("the register computes the variance only to command a count", () => {
    const v = oversoldVariances([line("Blue Dream", 2, 1, "1g")]);
    expect(v).toHaveLength(1);
    expect(countPromptMessage(v)).toContain("Recount");
  });

  it("the variance keeps the numbers the clamp would otherwise destroy", () => {
    // sale-decrement-core clamps the stored level to 0, so "sold 2 against 1
    // tracked" is unrecoverable from the level alone. The variance is where
    // that magnitude survives.
    const v = oversoldVariances([line("Gone", 3, 0)])[0]!;
    expect(v).toMatchObject({ tracked: 0, sold: 3, shortfall: 3 });
  });
});

describe("FIX A — the override must be reachable at the moment of refusal", () => {
  it("offers the override inside the refusal notice, not only in the tender-time panel", () => {
    // The Slice 14 bug: the ONLY 'Sell anyway' button lived inside a panel
    // gated on stockBlocks.length > 0, which the clamp makes unreachable.
    // The refusal notice must now carry its own way to lift the block.
    expect(saleFlowCode).toContain("stockOverrideOffer");
  });

  it("no longer tells staff to use a button that is not on screen", () => {
    // The dead-end instruction string from Slice 14 must be gone.
    expect(saleFlow).not.toContain('Use "Sell anyway" if the unit is on the shelf.');
  });

  it("keeps the override open to ANY staff member (no PIN gate on it)", () => {
    // Owner decision Q2: every staff member may lift a stock block. Scan-required
    // and price overrides stay manager-locked.
    //
    // This reads the StockOverrideOffer COMPONENT itself rather than a window of
    // characters around the state variable. An earlier version of this test
    // sliced from the useState declaration and ran on past unrelated
    // scan-unlock markup, which made it report a PIN gate that does not exist.
    // The component body is the honest place to prove there is no gate.
    const start = saleFlowCode.indexOf("function StockOverrideOffer(");
    expect(start, "StockOverrideOffer component must exist").toBeGreaterThan(-1);
    const body = saleFlowCode.slice(start, saleFlowCode.indexOf("\nfunction ", start + 10));

    // No manager-approval machinery anywhere inside the offer.
    expect(body).not.toContain("onApprove");
    expect(body).not.toContain("setScanUnlockOpen");
    expect(body).not.toContain("ManagerPin");
    expect(body).not.toContain("pin");
    // It must actually be a button staff can press.
    expect(body).toContain("data-stock-override-offer");
  });

  it("the override button lifts the block directly, with no approval step between", () => {
    // Both refusal sites must wire the offer's callback straight to the state
    // change. If a modal were ever inserted, this proves it.
    const sites = saleFlowCode.split("<StockOverrideOffer");
    expect(sites.length - 1, "the offer must render at BOTH refusal sites").toBe(2);
    for (const site of sites.slice(1)) {
      const props = site.slice(0, site.indexOf("/>"));
      expect(props).toContain("setStockOverride(true)");
      expect(props).not.toContain("onApprove");
    }
  });

  it("still shows the last-refreshed context the owner asked for (decision Q3)", () => {
    expect(saleFlowCode).toContain("menuAgeLabel");
  });
});

describe("FIX B / research finding 1 — the sale completes, and the receipt stays clean", () => {
  it("prompts for a count on the Sale-complete screen", () => {
    expect(saleFlowCode).toContain("countPromptMessage");
    expect(saleFlowCode).toContain("oversoldVariances");
  });

  it("never blocks completion behind the count prompt", () => {
    // Shopify POS + Lightspeed both warn BEFORE and never gate completion.
    // The lock button must not become conditional on the prompt.
    const done = saleFlowCode.slice(saleFlowCode.indexOf("Sale complete"));
    const lockBtn = done.indexOf("Done \u2014 lock register");
    expect(lockBtn).toBeGreaterThan(-1);
    const around = done.slice(Math.max(0, lockBtn - 600), lockBtn);
    expect(around).not.toContain("disabled={");
  });

  it("puts nothing about the discrepancy on the customer receipt", () => {
    // No source examined places this on the receipt; it is internal.
    const receiptBuild = saleFlowCode.slice(
      saleFlowCode.indexOf("const frozen: PosReceiptInput = {"),
      saleFlowCode.indexOf("setReceipt(frozen)"),
    );
    expect(receiptBuild.length).toBeGreaterThan(100);
    expect(receiptBuild).not.toContain("oversold");
    expect(receiptBuild).not.toContain("Recount");
  });

  it("keeps ONE durable record of the variance, written server-side", () => {
    // This assertion was rewritten during the build, and the reason matters.
    //
    // It originally demanded that the register itself write an audit record.
    // Building it proved that wrong: the durable record ALREADY exists. The
    // server writes it during the decrement (sale-decrement.ts, the
    // summarizeDecrement note carrying the OVERSOLD: section), from the
    // authoritative inventory levels at the moment of the sale.
    //
    // A second copy written by the register would be a second record of one
    // event, derived from the register's CACHED counts. The two could disagree,
    // and WAC 314-55-087(2)(a) requires an audit trail whose details can be
    // identified — not two conflicting versions of one variance. So the
    // register computes the variance ONLY to tell staff what to recount, and
    // the single source of truth stays server-side.
    expect(saleFlowCode).not.toContain("buildOversoldAuditRecords");
    expect(saleFlowCode).not.toContain("inventory_count_variance");
  });

  it("the server still writes the oversold section the back-office report reads", () => {
    // The report is only as real as this write. If the decrement ever stops
    // emitting the summary note, the recount list silently empties.
    const decrement = readFileSync("src/lib/inventory/sale-decrement.ts", "utf8");
    expect(decrement).toContain("summarizeDecrement");
    expect(decrement).toContain("order_events");
  });
});
