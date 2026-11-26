import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { __runNcOnlineTests, onlineNcEnabledFrom } from "@/lib/noncannabis/online-core";
import { __runNcShopCardsTests } from "@/lib/noncannabis/shop-cards-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("OI-ACC S5/S6 - accessory cards + online toggle", () => {
  it("pure cores pass", () => {
    expect(__runNcShopCardsTests()).toBeGreaterThanOrEqual(12);
    expect(__runNcOnlineTests()).toBeGreaterThanOrEqual(12);
  });

  it("the online toggle is OFF unless explicitly true", () => {
    expect(onlineNcEnabledFrom(undefined)).toBe(false);
    expect(onlineNcEnabledFrom({ enabled: true })).toBe(true);
  });

  it("checkout prices nc- lines only through the toggle-gated store", () => {
    const src = read("src/lib/orders/order-pricing.ts");
    expect(src).toContain("priceNcOnlineLines");
    expect(read("src/lib/noncannabis/online-store.ts")).toContain("if (!(await readOnlineNcEnabled())) return { ok: false");
  });

  it("CCRS Sale.csv still skips Other Inventory (nc-) lines", () => {
    const ccrs = read("src/lib/compliance/ccrs-sales.ts");
    expect(ccrs).toMatch(/if \(isNonCannabisProductId\(l\.product_id\)\) \{\s*nonCannabisLines\+\+;\s*continue;/);
  });

  it("pickup completion moves Other Inventory On hand", () => {
    expect(read("src/lib/inventory/sale-decrement.ts")).toContain('moveNcStockForOrder(admin, orderId, allLines, "sale")');
  });

  it("the shop no longer renders the old In store list; cards come from data", () => {
    const shop = read("src/components/menu/ShopPage.tsx");
    expect(shop).not.toContain("<InStoreGoods");
    expect(shop).toContain("loadAccessoryShopCards");
  });
});
