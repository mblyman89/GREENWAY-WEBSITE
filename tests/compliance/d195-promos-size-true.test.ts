/**
 * D195 (owner, 2026-11-07): "help me figure out why the promotions page is not
 * working correctly. i think it is not connected properly to the inventory
 * system." D197: "please complete all fixes required to get the promotions
 * page working correctly."
 *
 * Pins the four D195 steps:
 *  1. size-true: every guard row / preview row / audit / queue / clearance /
 *     simulator line is one SIZE at its own price and the register's size cost;
 *  2. unlinked stock: barcode-keyed lots on no card get a suggested card and a
 *     guarded (compare-and-set on the old key), audited relink that never
 *     touches the CCRS identity; standing warning on Inventory Issues and
 *     Promotions; receiving notes the no-SKU root cause;
 *  3. links open the exact inventory lot (not enrichment);
 *  4. inventory saves revalidate every Promotions page; pages show Checked at.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { __runSizeGuardCoreTests, expandCardSizes, inventoryHrefFor } from "@/lib/promotions/size-guard-core";
import {
  __runUnlinkedStockCoreTests,
  buildUnlinkedWorklist,
  checkRelink,
  UNLINKED_STOCK_HREF,
  type UnlinkedCardInput,
  type UnlinkedLotInput,
} from "@/lib/inventory/unlinked-stock-core";
import { sizeCostKey } from "@/lib/promotions/size-cost-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("D195 step 1: size-true", () => {
  it("size-guard-core self-tests", () => {
    const r = __runSizeGuardCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(32);
  });

  it("a multi-size card checks each size at its own price and cost (FDG Chem Trailz shape)", () => {
    const costs = new Map<string, number>([
      ["K", 527],
      [sizeCostKey("K", "K-1g"), 225],
      [sizeCostKey("K", "K-35"), 1189],
    ]);
    const rows = expandCardSizes(
      { key: "K", name: "Chem Trailz", brand: "FDG", categories: ["flower"], priceMinorUnits: 700, sizes: [
        { sourceVariantId: "K-1g", label: "1g", priceMinorUnits: 700 },
        { sourceVariantId: "K-35", label: "3.5g", priceMinorUnits: 3000 },
      ] },
      costs,
    );
    expect(rows.map((r) => [r.sizeLabel, r.priceMinorUnits, r.costMinorUnits])).toEqual([
      ["1g", 700, 225],
      ["3.5g", 3000, 1189],
    ]);
  });

  it("guard, preview, audit, queue, clearance and simulator use the size rows", () => {
    expect(read("src/lib/promotions/promo-guard.ts")).toContain("expandCardSizes(r, costs)");
    expect(read("src/app/admin/promotions/simulator/page.tsx")).toContain("expandCardSizes(");
    expect(read("src/lib/promotions/discount-engine.ts")).toContain("costForSize(costs, it.productKey, v.source_variant_id)");
    expect(read("src/lib/promotions/clearance-core.ts")).toContain("costFloorMinorUnits");
    expect(read("src/lib/promotions/bad-product-queue-core.ts")).toContain("costForSize");
  });
});

describe("D195 step 2: unlinked stock", () => {
  it("unlinked-stock-core self-tests", () => {
    const r = __runUnlinkedStockCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(43);
  });

  const lot: UnlinkedLotInput = {
    id: "197e46b3", posProductKey: "GF41918905566982", productName: "HTE HONEY - Face Off OG - Face Off OG - .7g",
    status: "active", onHandQty: 50, vendorName: "CANNA PROCESSING", brandName: null, unitCostMinorUnits: 226,
  };
  const card: UnlinkedCardInput = {
    key: "pos-e00093cb5259", name: "Face Off OG", productName: "HTE Honey - Face Off OG - .7g", vendorName: "CANNA PROCESSING",
    brandName: "Legit Mini", category: "infused-preroll", sizes: [{ sourceVariantId: "pos-e00093cb5259-a061daab2d68", label: "0.7g" }],
  };

  it("the production Face Off lot is suggested onto its card and size", () => {
    const [row] = buildUnlinkedWorklist([lot], [card]);
    expect(row.state).toBe("suggested");
    expect(row.candidates[0]).toMatchObject({ cardKey: "pos-e00093cb5259", sizeId: "pos-e00093cb5259-a061daab2d68" });
    expect(checkRelink(lot, [card], { expectedOldKey: "GF41918905566982", cardKey: "pos-e00093cb5259" }).ok).toBe(true);
    expect(checkRelink({ ...lot, status: "rejected" }, [card], { expectedOldKey: "GF41918905566982", cardKey: "pos-e00093cb5259" }).ok).toBe(false);
  });

  it("the write is a compare-and-set on the old key, never rejected/destroyed, with provenance", () => {
    const s = read("src/lib/inventory/unlinked-stock-store.ts");
    expect(s).toContain('.eq("pos_product_key", oldKey)');
    expect(s).toContain('.neq("status", "destroyed")');
    expect(s).toContain('.neq("status", "rejected")');
    expect(s).toContain('pos_product_key_source: "owner_entered"');
    expect(s).toContain('.select("id")');
    // CCRS identity is never rewritten by this door.
    const update = s.slice(s.indexOf("export async function relinkLotToCard"));
    expect(update).not.toContain("lot_code:");
    expect(update).not.toContain("ccrs_inventory_external_id:");
  });

  it("the action re-checks, audits, sets the size and revalidates Promotions", () => {
    const a = read("src/app/admin/inventory/unlinked/actions.ts");
    expect(a).toContain('requirePermission("inventory.manage")');
    expect(a).toContain("checkRelink(");
    expect(a).toContain('action: "inventory_lot.relinked_to_card"');
    expect(a).toContain("setLotSizeLink(lotId, s.sizeId)");
    expect(a).toContain("revalidatePromotionSurfaces()");
  });

  it("standing warnings on Inventory Issues and Promotions; page exists", () => {
    expect(read("src/app/admin/inventory/page.tsx")).toContain("unlinkedStockIssue(await unlinkedPromise)");
    const promo = read("src/app/admin/promotions/page.tsx");
    expect(promo).toContain('data-testid="promo-unlinked-warning"');
    expect(promo).toContain("UNLINKED_STOCK_HREF");
    expect(UNLINKED_STOCK_HREF).toBe("/admin/inventory/unlinked");
    const page = read("src/app/admin/inventory/unlinked/page.tsx");
    expect(page).toContain('data-testid="unlinked-confirm"');
    expect(page).toContain('data-testid="unlinked-checked-at"');
  });

  it("receiving notes the root cause (no SKU -> barcode key) as information", () => {
    expect(read("src/lib/inventory/intake-parser.ts")).toContain("if (!sku && lot_code) warnings.push(NO_SKU_LINE_WARNING)");
    expect(read("src/lib/inventory/intake-review-core.ts")).toContain('w === NO_SKU_LINE_WARNING ? "info" : "warning"');
  });
});

describe("D195 step 3: links open the inventory lot", () => {
  it("inventoryHrefFor: the lot, else the inventory search", () => {
    expect(inventoryHrefFor("L1", "K", "after_tax_price")).toBe("/admin/inventory/L1#after_tax_price");
    expect(inventoryHrefFor(null, "pos-1")).toBe("/admin/inventory?q=pos-1");
  });

  it("preview, audit and bad-products link to inventory", () => {
    expect(read("src/app/admin/promotions/[id]/page.tsx")).toContain('data-testid="promo-preview-lot-link"');
    expect(read("src/app/admin/promotions/page.tsx")).toContain('data-testid="promo-audit-lot-link"');
    expect(read("src/app/admin/promotions/bad-products/page.tsx")).toContain('data-testid="bpq-lot-link"');
  });
});

describe("D195 step 4: freshness", () => {
  it("every price/cost/size/link/status save in inventory revalidates Promotions", () => {
    const a = read("src/app/admin/inventory/actions.ts");
    expect((a.match(/revalidatePromotionSurfaces\(\)/g) ?? []).length).toBeGreaterThanOrEqual(10);
    expect(read("src/lib/promotions/revalidate-promotions.ts")).toContain('revalidatePath(PROMOTIONS_ROOT, "layout")');
  });

  it("preview and audit show Checked at", () => {
    expect(read("src/app/admin/promotions/[id]/page.tsx")).toContain('data-testid="promo-preview-checked-at"');
    expect(read("src/app/admin/promotions/page.tsx")).toContain('data-testid="promo-audit-checked-at"');
  });
});
