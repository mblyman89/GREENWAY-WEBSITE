/**
 * tests/compliance/sale-posting-wiring.test.ts
 *
 * books-82. Two jobs, deliberately no more (budget):
 *
 *   1. The COGS arithmetic, which decides the 280E deduction, is exercised
 *      directly — including the cases where it must REFUSE.
 *   2. The WIRE is asserted, because nothing pure can see reachability. A
 *      correct builder with no caller posts exactly nothing, which is the
 *      defect this slice closes (D-31 / D-33).
 *
 * Every assertion here was mutation-probed: the source was deliberately broken
 * and each of these failed. A test that cannot fail is worse than no test.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  costSaleFromDraws,
  drawsFromLotUpdates,
  __runSaleCogsCoreTests,
} from "@/lib/accounting/sale-cogs-core";

const REPO = process.cwd();
const read = (rel: string) => readFileSync(join(REPO, rel), "utf8");

describe("cost of goods sold — the number the 280E deduction rests on", () => {
  it("its own self-tests pass", () => {
    expect(() => __runSaleCogsCoreTests()).not.toThrow();
  });

  it("costs a sale that spans two lots at the lots' own costs", () => {
    // The whole reason FIFO matters: the two lots cost different amounts, so
    // an average would produce a different (wrong) deduction.
    const out = costSaleFromDraws(
      [{ lineId: "L1", posProductKey: "k", quantity: 3 }],
      [
        { lotId: "old", posProductKey: "k", qty: 2 },
        { lotId: "new", posProductKey: "k", qty: 1 },
      ],
      [
        { lotId: "old", unitCostCents: 100 },
        { lotId: "new", unitCostCents: 250 },
      ],
    );
    expect(out.kind).toBe("costed");
    if (out.kind !== "costed") return;
    expect(out.totalCostCents).toBe(2 * 100 + 1 * 250);
    // NOT the average (3 * 175 = 525), which is what a careless fix would give.
    expect(out.totalCostCents).not.toBe(525);
  });

  it("REFUSES when a consumed lot has no cost, instead of averaging the rest", () => {
    const out = costSaleFromDraws(
      [{ lineId: "L1", posProductKey: "k", quantity: 2 }],
      [
        { lotId: "costed", posProductKey: "k", qty: 1 },
        { lotId: "uncosted", posProductKey: "k", qty: 1 },
      ],
      [
        { lotId: "costed", unitCostCents: 500 },
        { lotId: "uncosted", unitCostCents: null },
      ],
    );
    expect(out.kind).toBe("refused");
    if (out.kind !== "refused") return;
    expect(out.code).toBe("LOT_COST_MISSING");
  });

  it("splits a shared lot across lines with no cent lost or invented", () => {
    // 101c over 3 units across two lines does not divide evenly. The split
    // must still sum EXACTLY, or inventory and COGS drift by a cent a sale.
    const out = costSaleFromDraws(
      [
        { lineId: "A", posProductKey: "k", quantity: 1 },
        { lineId: "B", posProductKey: "k", quantity: 2 },
      ],
      [{ lotId: "L", posProductKey: "k", qty: 3 }],
      [{ lotId: "L", unitCostCents: 101 }],
    );
    expect(out.kind).toBe("costed");
    if (out.kind !== "costed") return;
    const sum = out.lines.reduce((s, l) => s + l.costCents, 0);
    expect(sum).toBe(303);
    expect(out.totalCostCents).toBe(303);
  });

  it("treats a POSITIVE lot delta as a refusal, not as a sale", () => {
    // A positive delta means stock went UP — a return. Costing it as a sale
    // would credit inventory for goods that came back in.
    const out = costSaleFromDraws(
      [{ lineId: "L1", posProductKey: "k", quantity: 1 }],
      drawsFromLotUpdates([{ id: "L", posProductKey: "k", delta: 2 }]),
      [{ lotId: "L", unitCostCents: 100 }],
    );
    expect(out).toMatchObject({ kind: "refused", code: "NEGATIVE_DRAW" });
  });

  it("reports stock-less lines as uncosted rather than silently zero", () => {
    const out = costSaleFromDraws([{ lineId: "custom", posProductKey: null, quantity: 1 }], [], []);
    expect(out.kind).toBe("costed");
    if (out.kind !== "costed") return;
    expect(out.uncostedLineIds).toEqual(["custom"]);
  });
});

describe("the wire itself — reachability, which nothing pure can see", () => {
  const store = read("src/lib/orders/orders-store.ts");
  const svc = read("src/lib/accounting/sale-posting-service.ts");

  it("completing an order really calls the sale posting service", () => {
    expect(store).toContain("postSaleForOrder");
  });

  it("it fires on the completion transition, not on any other status change", () => {
    // Posting revenue for an order that is merely `ready` would book money
    // nobody has collected.
    const idx = store.indexOf("postSaleForOrder");
    const gate = store.lastIndexOf('toStatus === "completed" && fromStatus !== "completed"', idx);
    expect(gate).toBeGreaterThan(-1);
    expect(idx - gate).toBeLessThan(1200);
  });

  it("posts BEFORE the inventory decrement, or cost cannot be established", () => {
    // The decrement reduces on_hand_qty. Replanning the FIFO draw afterwards
    // cannot see units a sale drained to zero, so the cost of exactly those
    // sales would refuse. Ordering is the fix; this asserts it stays.
    // Anchored to the CALL, not the import binding: renaming only the call
    // used to slip past this, because the destructured name still matched.
    const post = store.search(/await\s+postSaleForOrder\s*\(/);
    const dec = store.search(/await\s+decrementInventoryForOrder\s*\(/);
    expect(post).toBeGreaterThan(-1);
    expect(dec).toBeGreaterThan(-1);
    expect(post).toBeLessThan(dec);
  });

  it("a ledger refusal is carried back to the caller, never swallowed", () => {
    // The loyalty/decrement side-effects swallow deliberately. The ledger
    // must not: that is how books go quietly wrong.
    expect(store).toContain("ledgerWarning");
    expect(store).toMatch(/ledgerNote\s*=/);
  });

  it("but a ledger failure never blocks the completed sale", () => {
    // The customer already left with the product; refusing completion here
    // would strand the POS without un-selling anything.
    const idx = store.indexOf("postSaleForOrder");
    const tail = store.slice(idx, idx + 900);
    expect(tail).toMatch(/catch/);
    expect(tail).not.toMatch(/return\s*\{\s*ok:\s*false/);
  });

  it("the service posts both halves through the real ledger door", () => {
    expect(svc).toContain("submitJournal");
    expect(svc).toContain("revenueJournal");
    expect(svc).toContain("cogsJournal");
    // Distinct source refs, or the ledger's own (entity, kind, ref)
    // idempotency would collapse the two halves into one.
    expect(svc).toContain("#revenue");
    expect(svc).toContain("#cogs");
  });

  it("uses a source kind the ledger actually accepts", () => {
    // "sale" is not in the vocabulary; pos_sale is. This was a real compile
    // error, and it is cheap to keep it from coming back.
    expect(svc).toContain('sourceKind: "pos_sale"');
    expect(svc).not.toMatch(/sourceKind:\s*"sale"/);
  });

  it("claims the order_events latch before doing any work", () => {
    // Reuses the proven concurrency latch; two tills completing the same
    // order must not post the sale twice.
    expect(svc).toContain("SALE_POSTING_EVENT_TYPE");
    // Assert the GUARD, not a mention of the code in a comment. The unique
    // violation is what makes the insert a latch; if it stops being handled,
    // a concurrent completion returns an error instead of standing down.
    expect(svc).toMatch(/code\s*===\s*"23505"/);
    const claim = svc.indexOf(".insert({");
    const submit = svc.indexOf("await submitJournal");
    expect(claim).toBeGreaterThan(-1);
    expect(submit).toBeGreaterThan(-1);
    expect(claim).toBeLessThan(submit);
  });

  it("checks the POS total instead of trusting it", () => {
    expect(svc).toContain("posTotalCents");
    expect(svc).not.toContain("posTotalCents: null");
  });

  it("uses the Pacific business date, not toISOString()", () => {
    expect(svc).toContain("pacificParts");
  });

  it("refuses an unrecognised category rather than guessing an account", () => {
    // Same discipline as D-64 on the receiving side: three categories are
    // outside 280E, so a guessed account changes the tax owed.
    expect(svc).toContain("mapReceiptCategory");
    expect(svc).toContain("SALE_CATEGORY_REFUSED");
  });

  it("mirrors the decrement's lot filters, so both see the same lots", () => {
    // Same lines + same lots + same planner = the same draw. A divergence in
    // this query is a divergence between the stock move and its cost.
    expect(svc).toContain("buildLotDecrementPlan");
    expect(svc).toContain('.eq("status", "active")');
    expect(svc).toContain('.gt("on_hand_qty", 0)');
    expect(svc).toContain('.order("created_at", { ascending: true })');
  });

  it("surfaces the rounding residual rather than resolving it", () => {
    // D-10 stays uninvented; the entry reports what it rounded.
    expect(svc).toContain("roundingResidualCents");
  });

  it("no guard in the service has been short-circuited", () => {
    expect(svc).not.toMatch(/if\s*\(\s*false\s*\)/);
    expect(svc).not.toMatch(/if\s*\(\s*true\s*\)/);
  });
});
