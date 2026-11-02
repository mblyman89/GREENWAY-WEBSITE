/**
 * register-sell-sold-out-stock - the owner, verbatim: "The register needs to
 * stop rejecting it and allow it ... These items are not in active status
 * even though the detail page shows them as active. I need to sell these
 * products right now."
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  isRegisterSellableLotStatus,
  reconcileRegisterAvailability,
  keysWithSellableLot,
} from "@/lib/pos/register-availability-core";
import { wantsRestockToActive, fallbackStatusAfter, wantsAutoSoldOut } from "@/lib/inventory/manual-adjustment-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("register-sell-sold-out-stock", () => {
  it("Active and Sold out lots are register-sellable; holds are not", () => {
    for (const s of ["active", "sold_out", " SOLD_OUT "]) expect(isRegisterSellableLotStatus(s)).toBe(true);
    for (const s of ["quarantine", "recalled", "destroyed", "", null]) expect(isRegisterSellableLotStatus(s)).toBe(false);
  });

  it("a card whose only lot is Sold out at 0 stays on the register", () => {
    const r = reconcileRegisterAvailability({
      cards: [{ productId: "pos-79750c4bd619", lotKeys: ["pos-79750c4bd619"], inventoryStatus: "unavailable", hidden: false, recalled: false }],
      lots: [{ id: "l", posProductKey: "pos-79750c4bd619", status: "sold_out", onHandQty: 0 }],
    });
    expect(r.cards[0].sellable).toBe(true);
    expect(r.cards[0].reason).toBe("sell_anyway_zero_count");
    expect(keysWithSellableLot([{ id: "l", posProductKey: "K", status: "quarantine", onHandQty: 5 }]).size).toBe(0);
  });

  it("a count added to a Sold out lot puts it back to Active (Black Haze +3 stayed Sold out)", () => {
    expect(wantsRestockToActive("sold_out", 3)).toBe(true);
    expect(wantsRestockToActive("quarantine", 3)).toBe(false);
    expect(wantsRestockToActive("recalled", 3)).toBe(false);
    expect(wantsAutoSoldOut("active", -1)).toBe(true);
    expect(fallbackStatusAfter("sold_out", 3, true)).toBe("active");
    const store = read("src/lib/inventory/store.ts");
    expect(store).toMatch(/wantsAutoSoldOut\(status, delta\) \|\| wantsRestockToActive\(status, delta\)/);
  });

  it("the menu route, scan index and the sale draw all use Active + Sold out", () => {
    const route = read("src/app/api/pos/menu/route.ts");
    expect(route).not.toMatch(/=== SELLABLE_LOT_STATUS/);
    expect(route).toContain("isRegisterSellableLotStatus(l.status)");
    const saleRead = read("src/lib/inventory/sale-lot-read.ts");
    expect(saleRead).toContain('.in("status", ["active", "sold_out"])');
    expect(saleRead).toContain('.eq("is_sample", false)');
  });
});
