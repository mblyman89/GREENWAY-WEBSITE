/**
 * tests/compliance/deal-badge-core.test.ts  (SLICE 96 — owner: Michael)
 *
 * The deal badge Michael saw on ONE More-from rail card ("doobie Tuesday -
 * 20% off - or 4 for 3") now shows on EVERY product card the deal is relevant
 * for — driven by the PUBLISHED promotion rules, never hardcoded:
 *   Monday    -> edibles + liquids (Munchie Monday seed targets)
 *   Tuesday   -> prerolls/blunts incl. infused (Doobie Tuesday)
 *   Wednesday -> carts/concentrates (Wax Wednesday — Michael's "etc.")
 *   Thursday  -> the featured sale brands (Top Shelf Thursday)
 *   Friday    -> all flower (Ounce Friday)
 *   Sat + Sun -> ALL cannabis cards (storewide) — merch never badges
 * SLICE 40's struck-price policy (Fri/Sat/Sun show the regular price) is
 * UNTOUCHED: the badge advertises the deal; the cart reveals the savings.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import {
  menuCardBadgeForItem,
  __runDealBadgeCoreTests,
} from "@/lib/promotions/deal-badge-core";
import {
  activeSnapshotsFor,
  menuCardDiscountForItem,
  seedRuleSnapshots,
} from "@/lib/promotions/published-rules-core";
import type { StoreWeekday } from "@/lib/specials/daily-deals";

const mk = (id: string, over: Record<string, unknown> = {}): GreenwayMenuItem =>
  ({
    id,
    name: `Item ${id}`,
    brand: "",
    category: "flower",
    priceMinorUnits: 2000,
    variants: [],
    ...over,
  }) as unknown as GreenwayMenuItem;

const seeds = seedRuleSnapshots();
const rulesFor = (weekday: StoreWeekday) => activeSnapshotsFor(seeds, weekday);

describe("deal-badge-core (SLICE 96)", () => {
  it("embedded self-tests pass", () => {
    expect(() => __runDealBadgeCoreTests()).not.toThrow();
  });

  it("Michael's day matrix: Mon edibles+liquids, Tue prerolls incl. infused, Fri flower", () => {
    expect(menuCardBadgeForItem(mk("e", { category: "edible-solid" }), rulesFor("monday"), "monday")).toBe(
      "Munchie Monday · 25% off",
    );
    expect(menuCardBadgeForItem(mk("d", { category: "edible-liquid" }), rulesFor("monday"), "monday")).toBe(
      "Munchie Monday · 25% off",
    );
    // The EXACT badge Michael saw on the rail card — now on every Tuesday preroll/blunt.
    expect(menuCardBadgeForItem(mk("p", { category: "preroll" }), rulesFor("tuesday"), "tuesday")).toBe(
      "Doobie Tuesday · 20% off · or 4 for 3",
    );
    expect(
      menuCardBadgeForItem(mk("ib", { category: "infused-blunt" }), rulesFor("tuesday"), "tuesday"),
    ).toBe("Doobie Tuesday · 20% off · or 4 for 3");
    expect(menuCardBadgeForItem(mk("f"), rulesFor("friday"), "friday")).toBe(
      "Ounce Friday · up to 30% by the ounce",
    );
    // Irrelevant items stay badge-free.
    expect(menuCardBadgeForItem(mk("f2"), rulesFor("monday"), "monday")).toBeUndefined();
    expect(
      menuCardBadgeForItem(mk("e2", { category: "edible-solid" }), rulesFor("tuesday"), "tuesday"),
    ).toBeUndefined();
  });

  it("Thursday badges the featured sale brands only", () => {
    expect(
      menuCardBadgeForItem(mk("b", { brand: "Lifted" }), rulesFor("thursday"), "thursday"),
    ).toBe("Top Shelf Thursday · 25% off");
    expect(menuCardBadgeForItem(mk("nb"), rulesFor("thursday"), "thursday")).toBeUndefined();
  });

  it("Saturday + Sunday badge ALL cannabis cards (incl. the 0%-headline Sunday bundle); merch never badges", () => {
    expect(menuCardBadgeForItem(mk("t", { category: "topical" }), rulesFor("saturday"), "saturday")).toBe(
      "Super Saturday · 30% one item + 15% storewide",
    );
    expect(menuCardBadgeForItem(mk("t2", { category: "topical" }), rulesFor("sunday"), "sunday")).toBe(
      "Ice Cream Sunday · 3-for-2 equivalent savings",
    );
    expect(menuCardBadgeForItem(mk("m", { category: "merch" }), rulesFor("saturday"), "saturday")).toBeUndefined();
    expect(menuCardBadgeForItem(mk("m2", { category: "merch" }), rulesFor("sunday"), "sunday")).toBeUndefined();
  });

  it("SLICE 40 struck-price policy is untouched: Fri/Sat/Sun price stays regular while the badge shows", () => {
    const flower = mk("f3");
    expect(menuCardDiscountForItem(flower, rulesFor("friday"), "friday")).toBeUndefined();
    expect(menuCardBadgeForItem(flower, rulesFor("friday"), "friday")).toBe(
      "Ounce Friday · up to 30% by the ounce",
    );
    // Mon-Thu keep BOTH the struck price and the badge.
    const edible = mk("e3", { category: "edible-solid" });
    expect(menuCardDiscountForItem(edible, rulesFor("monday"), "monday")).toBeDefined();
    expect(menuCardBadgeForItem(edible, rulesFor("monday"), "monday")).toBeDefined();
  });

  it("hydration-safe: unresolved weekday/rules -> no badge (SSG markup matches)", () => {
    expect(menuCardBadgeForItem(mk("h"), undefined, "friday")).toBeUndefined();
    expect(menuCardBadgeForItem(mk("h2"), rulesFor("friday"), undefined)).toBeUndefined();
  });

  it("every card wrapper passes the shared badge (shop/home/specials + rail + detail panel)", () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
    for (const comp of [
      "src/components/menu/ProductCard.tsx",
      "src/components/menu/RelatedProductCard.tsx",
      "src/components/menu/ProductDetailPurchasePanel.tsx",
    ]) {
      const src = read(comp);
      expect(src, `${comp} uses the shared badge engine`).toContain("menuCardBadgeForItem");
    }
    // ProductCard (shop/home/specials) now forwards the badge to the visual.
    expect(read("src/components/menu/ProductCard.tsx")).toContain("saleBadgeLabel={badge}");
    expect(read("src/components/menu/RelatedProductCard.tsx")).toContain("saleBadgeLabel={badge}");
  });
});
