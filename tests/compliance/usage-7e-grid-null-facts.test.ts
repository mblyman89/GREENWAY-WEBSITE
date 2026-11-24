/**
 * USAGE-7e · the shop grid stops shipping `"key":null` for optional facts.
 *
 * Owner request (2026-11-24, verbatim in docs/USAGE-BLEED-ROADMAP.md §USAGE-7):
 * "please begin fixing all issues, one slice at a time."
 *
 * Pins: the projection self-test (with its USAGE-7e assertions), that every
 * null-dropped field is OPTIONAL in GreenwayMenuItem (so absent is legal), and
 * that the readers that matter treat absent exactly like null: the card
 * classification filter, the cart limit meter, the size facet, the DOH badge.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  __runMenuGridProjectionTests,
  GRID_NULL_DROPPED_FIELDS,
  toMenuGridItems,
} from "@/lib/menu/menu-grid-projection-core";
import { isItemDohCompliant } from "@/lib/menu/menu-doh-core";
import type { GreenwayMenuItem } from "@/lib/leafly/types";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function item(extra: Record<string, unknown> = {}): GreenwayMenuItem {
  return {
    id: "x",
    name: "X",
    brand: "B",
    category: "edible-liquid",
    strainType: "hybrid",
    thc: null,
    cbd: null,
    description: "d",
    priceLabel: "$10",
    priceMinorUnits: 1000,
    inventoryStatus: "in-stock",
    variants: [],
    ...extra,
  } as unknown as GreenwayMenuItem;
}

describe("USAGE-7e projection", () => {
  it("self-test passes with the new assertions", () => {
    const r = __runMenuGridProjectionTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(47);
  });

  it("every null-dropped field is optional on GreenwayMenuItem", () => {
    const types = read("src/lib/leafly/types.ts");
    for (const f of GRID_NULL_DROPPED_FIELDS) {
      expect(types, f).toMatch(new RegExp(`\\n\\s*${f}\\?:\\s*[^\\n]*\\|\\s*null;`));
    }
  });

  it("all-null facts disappear; non-null facts survive", () => {
    const nulls = Object.fromEntries(GRID_NULL_DROPPED_FIELDS.map((f) => [f, null]));
    const [p] = toMenuGridItems([item(nulls)]);
    for (const f of GRID_NULL_DROPPED_FIELDS) expect(p).not.toHaveProperty(f);
    const [q] = toMenuGridItems([item({ lowThcLiquid: true, unitThcMg: 4, otherwiseTaken: false, dohCategory: "general_use" })]);
    expect(q).toMatchObject({ lowThcLiquid: true, unitThcMg: 4, otherwiseTaken: false, dohCategory: "general_use" });
  });

  it("DOH badge decision is identical for null and absent", () => {
    const withNull = item({ dohCompliant: false, dohCategory: null });
    const [absent] = toMenuGridItems([withNull]);
    expect(isItemDohCompliant(absent)).toBe(isItemDohCompliant(withNull));
  });

  it("the card / cart readers collapse absent to null (source pins)", () => {
    expect(read("src/lib/menu/menu-classification-filter-core.ts")).toContain("lowThcLiquid: item.lowThcLiquid ?? null");
    expect(read("src/lib/menu/cart-limit-meter-core.ts")).toContain("otherwiseTaken: item.otherwiseTaken ?? null");
    expect(read("src/lib/menu/menu-size-facet-core.ts")).toContain('typeof item.netVolumeMl === "number"');
    expect(read("src/lib/compliance/sales-limits-core.ts")).toMatch(/line\.otherwiseTaken === undefined \|\|\s*line\.otherwiseTaken === null/);
  });

  it("the shop still projects through toMenuGridItems", () => {
    expect(read("src/components/menu/ShopPage.tsx")).toContain("const menuItems = toMenuGridItems(enrichedMenuItems)");
  });
});
