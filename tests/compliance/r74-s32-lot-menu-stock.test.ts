/**
 * R74 S32 — a lot quantity change moves the menu stock Leafly and the website read.
 *
 * Owner request (round 13, verbatim in docs/roadmap/R74-CULTIVERA-MANIFEST-REBUILD.md):
 * "full price and quantity control of Cultivera products without waiting on
 * onboarding; cost stays locked". Sales and voids already moved both the lot
 * and the menu; adjustments, dispositions, return add-backs, the Cultivera
 * count and legacy-lot removals moved only the lot. S32 makes each of them move
 * the lot's own menu size (published + staged) by the same delta, through the
 * price writer's lot -> size finder (S30 link first; multi-size unlinked is
 * never guessed) and the atomic menu write (0129). Price and cost are never written.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as core from "../../src/lib/inventory/lot-menu-stock-core";

const read = (p: string) => readFileSync(p, "utf8");
const runner = read("scripts/compliance/run-pure-selftests.ts");

describe("R74 S32 A — pure self-test, pinned", () => {
  it("lot-menu-stock-core runs exactly 20, pinned", () => {
    expect(core.__runLotMenuStockCoreTests()).toEqual({ passed: 20, failed: 0 });
    expect(runner).toMatch(/__runLotMenuStockCoreTests\(\);\s*if \(r\.failed > 0 \|\| r\.passed < 20\)/);
  });
  it("the core is pure", () => {
    const src = read("src/lib/inventory/lot-menu-stock-core.ts");
    expect(src).not.toContain("process" + ".env");
    expect(src).not.toMatch(/from "@\/lib\/supabase/);
  });
});

describe("R74 S32 B — the plan", () => {
  const match = (levels: number[], status = "in-stock"): core.MenuStockMatch => ({
    kind: "linked",
    variantId: "v1",
    cardVariants: levels.map((l, i) => ({ id: `v${i}`, inventory_level: l })),
    itemStatus: status,
  });
  it("moves only the lot's own size by the same delta", () => {
    const s = core.planMenuStockStep(match([4, 6]), -2);
    expect(s).toEqual({ action: "write", variantId: "v1", delta: -2, fallbackLevel: 4, newStatus: null });
  });
  it("never guesses a size on a multi-size card the lot is not linked to", () => {
    expect(core.planMenuStockStep({ kind: "ambiguous", variantCount: 2 }, -1).action).toBe("ambiguous");
  });
  it("an addition wakes a sold-out card; a removal never flips an untracked one", () => {
    const up = core.planMenuStockStep(match([0, 0], "unavailable"), 5);
    expect(up.action === "write" && up.newStatus).toBe("in-stock");
    const down = core.planMenuStockStep(match([0, 0], "in-stock"), -1);
    expect(down.action === "write" && down.newStatus).toBeNull();
  });
});

describe("R74 S32 C — wiring", () => {
  const server = read("src/lib/inventory/lot-menu-stock.ts");
  it("reuses the price writer's size finder and the atomic menu write, never price/cost", () => {
    expect(server).toContain("findLotVariantOnVersion(");
    expect(server).toContain("applyVariantDelta(");
    expect(server).toContain("listIntakeStagedVersions(");
    expect(server).not.toMatch(/price_minor_units\s*:/);
    expect(server).not.toMatch(/unit_cost_minor_units/);
    expect(read("src/lib/inventory/price-write-store.ts")).toContain("export async function findLotVariantOnVersion(");
  });
  it("every lot-quantity writer outside the sale/void path calls it", () => {
    expect(read("src/lib/inventory/store.ts")).toMatch(/syncLotMenuStock\(admin, input\.lotId, input\.qtyDelta\)/);
    const disp = read("src/lib/inventory/disposition.ts");
    expect(disp).toMatch(/syncLotMenuStock\(admin, lotId, -Math\.abs\(qtyMagnitude\)\)/);
    expect(disp).toMatch(/if \(opts\.sellable\) await syncLotMenuStock\(admin, lotId, Math\.abs\(qtyMagnitude\)\)/);
    // Fix Phase 1.4 (G-44): a Restock return moves the menu, a Destroy return
    // never does (its units are held). Both the one-step RPC path and the
    // pre-0308 fallback keep that rule.
    expect(disp).toContain('const isDestroy = input.disposition === "destroy";');
    expect(disp).toContain("{ sellable: !isDestroy }");
    expect(disp).toMatch(/if \(!isDestroy\) await syncLotMenuStock\(admin, lotId, Math\.abs\(input\.quantity\)\)/);
    expect(read("src/lib/pos/cultivera-count-store.ts")).toMatch(/syncLotMenuStock\(admin, a\.lotId, a\.delta, \{ versions \}\)/);
    expect(read("src/lib/pos/legacy-lot-removal-store.ts")).toMatch(/syncLotMenuStock\(admin, r\.id, -r\.qty, \{ versions \}\)/);
  });
  it("problems reach the owner", () => {
    expect(read("src/app/admin/inventory/actions.ts")).toContain("result.menuStock");
    expect(read("src/app/admin/menu-imports/count/actions.ts")).toContain("out.menuStockProblems");
    expect(read("src/app/admin/menu-imports/fix-actions.ts")).toContain("r.menuStockProblems");
  });
});
