/**
 * R74 S31 — a sale takes stock (and cost) from the lots of the SIZE it sold.
 *
 * Owner request (round 13, verbatim in docs/roadmap/R74-CULTIVERA-MANIFEST-REBUILD.md):
 * full control of Cultivera products without waiting on onboarding. S30 gave
 * each lot its menu size (0294); S31 makes the sale path use it:
 *   - FIFO is restricted to the sold size's lots (then unplaced lots; never
 *     another size's lot unless no lot is linked to the sold size, and then
 *     the order note says so: SIZE MISMATCH);
 *   - each sale line stamps ITS lot's CCRS inventory id (Sale.csv);
 *   - the cost replan uses the SAME read and planner, costing each line from
 *     its own size's draws;
 *   - a void restocks a lot of the sold size;
 *   - the promotion / register cost floor uses the size's own cost.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as sale from "../../src/lib/inventory/sale-decrement-core";
import * as sizeCost from "../../src/lib/promotions/size-cost-core";
import { extractOversoldSection } from "../../src/lib/inventory/oversold-report-core";

const read = (p: string) => readFileSync(p, "utf8");
const runner = read("scripts/compliance/run-pure-selftests.ts");

describe("R74 S31 A — pure self-tests, pinned", () => {
  it("sale size-draw runs exactly 22, pinned", () => {
    expect(sale.__runSaleSizeDrawTests()).toEqual({ passed: 22, failed: 0 });
    expect(runner).toMatch(/__runSaleSizeDrawTests\(\);\s*if \(r\.failed > 0 \|\| r\.passed < 22\)/);
  });
  it("size-cost-core runs exactly 12, pinned", () => {
    expect(sizeCost.__runSizeCostCoreTests()).toEqual({ passed: 12, failed: 0 });
    expect(runner).toMatch(/__runSizeCostCoreTests\(\);\s*if \(r\.failed > 0 \|\| r\.passed < 12\)/);
  });
  it("the older sale-decrement self-test still passes unchanged", () => {
    expect(() => sale.__runSaleDecrementCoreTests()).not.toThrow();
  });
  it("cores are pure", () => {
    for (const f of ["src/lib/inventory/sale-decrement-core.ts", "src/lib/promotions/size-cost-core.ts"]) {
      const src = read(f);
      expect(src, f).not.toContain("process" + ".env");
      expect(src, f).not.toMatch(/from "@\/lib\/supabase/);
    }
  });
});

describe("R74 S31 B — the draw", () => {
  const L = (lineId: string, variantId: string | null, quantity: number) => ({ lineId, productId: "card", variantId, productName: lineId, quantity });
  it("a 1g sale never touches an older 3.5g lot", () => {
    const plan = sale.buildLotDecrementPlan(
      [L("a", "card-1g", 1)],
      [
        { id: "old35", posProductKey: "card", onHandQty: 5, sizeId: "card-35" },
        { id: "g1", posProductKey: "card", onHandQty: 5, sizeId: "card-1g" },
      ],
    );
    expect(plan.lotUpdates).toEqual([{ id: "g1", posProductKey: "card", newOnHand: 4, soldOut: false, delta: -1 }]);
  });
  it("with no size links the draw is the pre-S31 FIFO exactly", () => {
    const plan = sale.buildLotDecrementPlan(
      [L("a", "card-1g", 3)],
      [
        { id: "a", posProductKey: "card", onHandQty: 2 },
        { id: "b", posProductKey: "card", onHandQty: 5 },
      ],
    );
    expect(plan.lotUpdates).toEqual([
      { id: "a", posProductKey: "card", newOnHand: 0, soldOut: true, delta: -2 },
      { id: "b", posProductKey: "card", newOnHand: 4, soldOut: false, delta: -1 },
    ]);
    expect(plan.sizeNotes).toEqual([]);
  });
  it("the oversold report stops at the new SIZE MISMATCH section", () => {
    const note = "Inventory decremented. OVERSOLD: \"X\" sold 2, tracked 1. SIZE MISMATCH: Product key k: 1 unit(s) …";
    expect(extractOversoldSection(note)).not.toContain("SIZE MISMATCH");
  });
});

describe("R74 S31 C — the wiring", () => {
  const dec = read("src/lib/inventory/sale-decrement.ts");
  const post = read("src/lib/accounting/sale-posting-service.ts");
  const lotRead = read("src/lib/inventory/sale-lot-read.ts");
  it("decrement and cost replan share ONE lot read (same lots by construction)", () => {
    expect(dec).toContain("readSaleLots(admin, lotKeys)");
    expect(post).toContain("readSaleLots(admin, keys)");
    expect(lotRead).toContain('.eq("status", "active")');
    expect(lotRead).toContain('.gt("on_hand_qty", 0)');
    expect(lotRead).toContain('.order("created_at", { ascending: true })');
    expect(lotRead).toContain("menu_source_variant_id");
    expect(lotRead).toContain("isMissingSizeLinkColumnError");
  });
  it("each line stamps its own size's CCRS id; cost uses the group draws", () => {
    expect(dec).toContain("lotPlan.lineExternalIdsByLine?.get(line.lineId)");
    expect(dec).toContain("sizeId: r.menu_source_variant_id");
    expect(post).toContain("drawsFromLotUpdates(plan.groupDraws ?? plan.lotUpdates)");
    expect(post).toContain("plan.lineDrawKeys?.get(l.lineId) ?? lotKeyForSaleLine(l)");
    expect(post).toContain("sizeId: r.menu_source_variant_id");
  });
  it("a void restocks the sold size's lot", () => {
    const v = read("src/lib/pos/void-store.ts");
    expect(v).toContain("pickRestockLot(candidates, line.variantId)");
    expect(v).toContain('.neq("status", "quarantine")');
  });
  it("the cost floor is per size on every pricing path", () => {
    expect(read("src/lib/promotions/discount-engine.ts")).toContain("buildCostMap(data)");
    expect(read("src/lib/orders/order-pricing.ts")).toContain("costForLine(productCosts, item.id, w.resolved.variant.id)");
    expect(read("src/app/api/pos/menu/route.ts")).toContain("costForLine(costs, item.id, variant.id)");
    expect(read("src/app/api/pos/loyalty/route.ts")).toContain("costForLine(costs, key, l.variantId ?? null)");
    expect(read("src/lib/loyalty/loyalty-sale-store.ts")).toContain("costForLine(costs, key, l.variant_id)");
  });
});
