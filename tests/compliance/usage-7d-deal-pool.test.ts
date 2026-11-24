/**
 * USAGE-7d · home and specials ship the deal pool, not the whole catalog.
 *
 * Owner request (2026-11-24, verbatim in docs/USAGE-BLEED-ROADMAP.md §USAGE-7):
 * "please begin fixing all issues, one slice at a time."
 *
 * Pins: the pure core (incl. the exactness property over every active rule
 * subset), the REAL engine predicate on real seed rules (every weekday picks
 * the same cards from the pool as from the catalog), and the page wiring.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { __runDealPoolTests, buildDealPool, DEAL_POOL_PER_RULE } from "@/lib/specials/deal-pool-core";
import {
  activeSnapshotsFor,
  menuDiscountForItem,
  seedRuleSnapshots,
  selectOnDealItems,
} from "@/lib/promotions/published-rules-core";
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import type { StoreWeekday } from "@/lib/specials/daily-deals";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const CATS = ["flower", "preroll", "edible-solid", "cartridge", "concentrate", "topical", "edible-liquid", "tincture", "popcorn-bud", "blunt"];
const BRANDS = ["Alpha", "Lifted", "Bravo", "Phat Panda", "Charlie", "Delta", "Buddies"];
function fixture(n: number): GreenwayMenuItem[] {
  return Array.from({ length: n }, (_, i) => {
    const cat = CATS[i % CATS.length];
    return {
      id: `item-${i}`,
      name: `Item ${i}`,
      brand: BRANDS[i % BRANDS.length],
      category: cat,
      filterCategories: [cat],
      priceMinorUnits: 1000 + (i % 40) * 100,
    } as unknown as GreenwayMenuItem;
  });
}

describe("USAGE-7d core", () => {
  it("self-test passes", () => {
    const r = __runDealPoolTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(15);
  });
});

describe("USAGE-7d with the real engine predicate", () => {
  const items = fixture(2700);
  const rules = seedRuleSnapshots();
  const pool = buildDealPool(items, rules, (it, r) => menuDiscountForItem(it, [r]) !== undefined);
  const days: StoreWeekday[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

  it("the pool is a small fraction of the catalog", () => {
    expect(pool.length).toBeLessThanOrEqual(rules.length * DEAL_POOL_PER_RULE + 96);
    expect(pool.length).toBeLessThan(items.length / 2);
  });
  it.each(days)("%s: same on-deal cards from the pool as from the catalog", (day) => {
    const active = activeSnapshotsFor(rules, day);
    const fromCatalog = selectOnDealItems(items, active, { limit: 64 }).map((i) => i.id);
    const fromPool = selectOnDealItems(pool, active, { limit: 64 }).map((i) => i.id);
    expect(fromPool).toEqual(fromCatalog);
  });
  it("the comparison is not vacuous: some weekdays have per-item deals", () => {
    const nonEmpty = days.filter((d) => selectOnDealItems(items, activeSnapshotsFor(rules, d), { limit: 64 }).length > 0);
    expect(nonEmpty).toEqual(expect.arrayContaining(["monday", "thursday"]));
    expect(nonEmpty.length).toBeGreaterThanOrEqual(2);
  });
  it("never empty: the fallback sample is there for basket-only days", () => {
    expect(buildDealPool(items, [], () => false).length).toBeGreaterThan(24);
  });
});

describe("USAGE-7d wiring", () => {
  it("home passes the pool to HomeDailyDeals, the full list only to the vendor directory", () => {
    const s = read("src/app/(site)/page.tsx");
    expect(s).toContain("<HomeDailyDeals items={dealPool}");
    expect(s).not.toContain("<HomeDailyDeals items={dealItems}");
    expect(s).toContain("buildDealPool(dealItems, ruleSnapshots,");
    expect(s).toContain("menuDiscountForItem(item, [rule]) !== undefined");
  });
  it("specials passes the pool to SpecialsContent", () => {
    const s = read("src/app/(site)/specials/page.tsx");
    expect(s).toContain("menuItems={buildDealPool(menuItems, ruleSnapshots,");
    expect(s).not.toMatch(/menuItems=\{menuItems\}/);
  });
});
