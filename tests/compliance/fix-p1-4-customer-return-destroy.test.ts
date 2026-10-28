/**
 * Fix Phase 1.4 (G-44; F-15-6 S1, F-15-7) - a customer-returned unit marked
 * Destroy is never sellable, and the return is saved atomically.
 *
 * Owner basis: D62 (Michael, verbatim: "We will rarely use these features, but
 * they are necessary for our industry so we must have them and do them
 * properly and accurately."); the register's own words (SOP-01 §4.23):
 * "Product goes to the quarantine bin."
 *
 * Pins: the pure held-stock rule; the planner never draws held units (G-44
 * req 4: "a destroy return never raises sellable stock"); every sellable
 * reader subtracts held units; createCustomerReturn uses the one-transaction
 * RPC and, before 0308, undoes the add-back on any failure (req 4: "a failed
 * insert leaves no add-back"); completion consumes the hold, cancel releases
 * it; reductions never take held units; migration 0308; the guard.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  sellableQty,
  evaluateReductionAgainstHold,
  isMissingHeldQtyColumnError,
  __runHeldStockCoreTests,
} from "@/lib/inventory/held-stock-core";
import { buildLotDecrementPlan } from "@/lib/inventory/sale-decrement-core";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const DISPO = read("src/lib/inventory/disposition.ts");
const MIG = read("supabase/migrations/0308_customer_return_held_stock.sql");

function fnBody(src: string, name: string): string {
  const i = src.indexOf(`function ${name}(`);
  expect(i, name).toBeGreaterThan(-1);
  const j = src.indexOf("\nexport ", i + 10);
  const k = src.indexOf("\nasync function ", i + 10);
  const ends = [j, k].filter((x) => x > 0);
  return src.slice(i, ends.length ? Math.min(...ends) : undefined);
}

describe("held-stock core", () => {
  it("self-tests pass", () => {
    const r = __runHeldStockCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(24);
  });
  it("sellable = on hand - held, never below zero; nothing held before 0308", () => {
    expect(sellableQty(5, 1)).toBe(4);
    expect(sellableQty(1, 1)).toBe(0);
    expect(sellableQty(5, undefined)).toBe(5);
  });
  it("a reduction can never take held units", () => {
    expect(evaluateReductionAgainstHold({ qty: 1, onHand: 1, held: 1 }).ok).toBe(false);
    expect(evaluateReductionAgainstHold({ qty: 1, onHand: 2, held: 1 }).ok).toBe(true);
  });
  it("recognises only the held_qty missing-column error", () => {
    expect(isMissingHeldQtyColumnError({ code: "42703", message: "column inventory_lots.held_qty does not exist" })).toBe(true);
    expect(isMissingHeldQtyColumnError({ code: "42703", message: "column foo does not exist" })).toBe(false);
  });
});

describe("a destroy return never raises sellable stock (G-44 req 4)", () => {
  const line = { lineId: "L1", productId: "K", variantId: null, productName: "Gummy", quantity: 1 };
  it("a lot whose only unit is held is not drawn: the sale is a shortfall", () => {
    const lots = [{ id: "lot", posProductKey: "K", onHandQty: sellableQty(1, 1) }];
    const plan = buildLotDecrementPlan([line], lots);
    expect(plan.lotUpdates).toEqual([]);
    expect(plan.shortfalls.length).toBe(1);
  });
  it("with 3 on hand and 1 held, a sale of 3 draws only 2", () => {
    const lots = [{ id: "lot", posProductKey: "K", onHandQty: sellableQty(3, 1) }];
    const plan = buildLotDecrementPlan([{ ...line, quantity: 3 }], lots);
    expect(plan.lotUpdates[0].delta).toBe(-2);
  });
  it("the sale lot read, both planners, the POS menu and the sellability report subtract held units", () => {
    expect(read("src/lib/inventory/sale-lot-read.ts")).toMatch(/held_qty/);
    expect(read("src/lib/inventory/sale-decrement.ts")).toMatch(/onHandQty: sellableQty\(r\.on_hand_qty, r\.held_qty\)/);
    expect(read("src/lib/accounting/sale-posting-service.ts")).toMatch(/onHandQty: sellableQty\(r\.on_hand_qty, r\.held_qty\)/);
    expect(read("src/app/api/pos/menu/route.ts")).toMatch(/onHandQty: sellableQty\(l\.on_hand_qty, l\.held_qty\)/);
    expect(read("src/lib/inventory/register-sellability-store.ts")).toMatch(/sellableQty\(toQty\(r\.on_hand_qty\), r\.held_qty\)/);
  });
  it("the pre-0129 absolute fallback keeps held units on hand and never marks a holding lot Sold out", () => {
    const dec = read("src/lib/inventory/sale-decrement.ts");
    expect(dec).toMatch(/u\.soldOut && held <= 0/);
    expect(dec).toMatch(/onHandQty: u\.newOnHand \+ held/);
  });
  it("every reader degrades before 0308 (retries without held_qty)", () => {
    for (const f of [
      "src/lib/inventory/sale-lot-read.ts",
      "src/app/api/pos/menu/route.ts",
      "src/lib/inventory/register-sellability-store.ts",
      "src/lib/inventory/store.ts",
      "src/lib/inventory/disposition.ts",
    ]) {
      expect(read(f), f).toMatch(/isMissingHeldQtyColumnError\(/);
    }
  });
});

describe("the return is saved atomically (G-44 req 3; F-15-7)", () => {
  const body = fnBody(DISPO, "createCustomerReturn");
  it("calls record_customer_return with the hold for Destroy only", () => {
    expect(body).toMatch(/admin\.rpc\(RECORD_CUSTOMER_RETURN_RPC/);
    expect(body).toMatch(/p_hold: isDestroy/);
    expect(body).toMatch(/p_destruction: destruction/);
  });
  it("an RPC error that is not 'missing function' changes nothing and says so", () => {
    expect(body).toMatch(/if \(!isMissingDbFunctionError\(rpcErr\)\)/);
    expect(body).toMatch(/The return was not saved and nothing was changed/);
  });
  it("a held Destroy unit never moves menu stock; a Restock unit does", () => {
    expect(body).toMatch(/if \(!isDestroy\) await syncLotMenuStock\(admin, lotId, Math\.abs\(input\.quantity\)\)/);
  });
  it("pre-0308: a failed destruction event or a failed insert undoes the add-back (no orphan add-back)", () => {
    expect(body).toMatch(/if \(!scheduled\.ok\) \{\s*await undoAddition\(/);
    expect(body).toMatch(/if \(destructionEventId\) await admin\.from\("destruction_events"\)\.delete\(\)/);
    expect(body).toMatch(/await undoAddition\(admin, lotId, input\.quantity, posted\.adjustmentId, actorId, !isDestroy\)/);
    expect(body).not.toMatch(/reverse it manually/);
  });
  it("pre-0308: the caller is told the app could not hold the unit", () => {
    expect(body).toMatch(/notice: isDestroy \? HOLD_PENDING_MIGRATION_NOTE : undefined/);
  });
  it("the counter return and the register report where a Destroy unit stands", () => {
    expect(read("src/lib/pos/returns-store.ts")).toMatch(/stockNote: input\.disposition === "destroy" \? \(created\.notice \?\? DESTROY_RETURN_HELD_NOTE\) : null/);
    expect(read("src/app/api/pos/returns/route.ts")).toMatch(/stockNote: result\.stockNote/);
    expect(read("src/components/admin/registers/CounterReturnDesk.tsx")).toMatch(/done\.stockNote/);
  });
});

describe("completion consumes the hold; cancel releases it; nothing else takes it", () => {
  it("completeDestruction uses postHeldReduction for a held event", () => {
    const body = fnBody(DISPO, "completeDestruction");
    expect(body).toMatch(/heldReserved > 0\s*\? await postHeldReduction\(/);
  });
  it("postHeldReduction calls consume_lot_hold and removes the adjustment on refusal", () => {
    const body = fnBody(DISPO, "postHeldReduction");
    expect(body).toMatch(/admin\.rpc\(CONSUME_LOT_HOLD_RPC/);
    expect(body).toMatch(/inventory_adjustments"\)\.delete\(\)/);
  });
  it("cancelDestruction releases the held units and puts them back on the menu", () => {
    const body = fnBody(DISPO, "cancelDestruction");
    expect(body).toMatch(/admin\.rpc\(RELEASE_LOT_HOLD_RPC/);
    expect(body).toMatch(/syncLotMenuStock\(admin, event\.lot_id, heldReserved\)/);
    expect(body).toMatch(/heldMessage: heldReleased > 0 \? heldReleaseMessage\(heldReleased\) : null/);
  });
  it("postReduction (vendor return, ordinary destruction) and manual adjustments refuse held units", () => {
    expect(fnBody(DISPO, "postReduction")).toMatch(/evaluateReductionAgainstHold\(/);
    expect(read("src/lib/inventory/store.ts")).toMatch(/evaluateReductionAgainstHold\(\{ qty: Math\.abs\(delta\)/);
  });
  it("the cancel page shows the release message; the lot page shows held units", () => {
    expect(read("src/app/admin/inventory/disposition/page.tsx")).toMatch(/data-testid="held-release-message"/);
    expect(read("src/app/admin/inventory/[id]/page.tsx")).toMatch(/label="Held for destruction"/);
  });
});

describe("migration 0308", () => {
  it("is idempotent and adds held_qty with a non-negative check", () => {
    expect(MIG).toMatch(/add column if not exists held_qty numeric not null default 0/);
    expect(MIG).toMatch(/inventory_lots_held_nonneg/);
    expect(MIG).toMatch(/add column if not exists held_qty_reserved/);
  });
  it("record_customer_return does all four writes in one function (one transaction)", () => {
    const fn = MIG.slice(MIG.indexOf("create or replace function public.record_customer_return"), MIG.indexOf("create or replace function public.consume_lot_hold"));
    expect(fn).toMatch(/insert into public\.inventory_adjustments/);
    expect(fn).toMatch(/held_qty\s+= held_qty \+ case when p_hold then p_qty else 0 end/);
    expect(fn).toMatch(/insert into public\.destruction_events/);
    expect(fn).toMatch(/insert into public\.customer_returns/);
    expect(fn).toMatch(/'return'/);
  });
  it("consume_lot_hold only takes held units; release never changes on hand", () => {
    expect(MIG).toMatch(/and held_qty >= p_qty/);
    const rel = MIG.slice(MIG.indexOf("create or replace function public.release_lot_hold"));
    expect(rel).not.toMatch(/on_hand_qty\s*=/);
  });
  it("the RPCs are not callable by browser roles", () => {
    expect(MIG).toMatch(/revoke execute on function public\.record_customer_return/);
    expect(MIG).toMatch(/revoke execute on function public\.consume_lot_hold/);
    expect(MIG).toMatch(/revoke execute on function public\.release_lot_hold/);
  });
});

describe("guard", () => {
  it("check-activation-gate step 6 pins G-44", () => {
    const g = read("scripts/compliance/check-activation-gate.ts");
    expect(g).toMatch(/Fix Phase 1\.4 \(G-44/);
    expect(g).toMatch(/RECORD_CUSTOMER_RETURN_RPC/);
  });
});
