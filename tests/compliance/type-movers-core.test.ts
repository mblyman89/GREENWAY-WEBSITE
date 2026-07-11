/**
 * tests/compliance/type-movers-core.test.ts
 *
 * Task I (I4) coverage for the PURE per-type product-leaderboard grouping
 * (`type-movers-core.ts`) behind the "Top products by type" benchmarks
 * section — the owner's request: "a list of the top 10 products from every
 * single type shown each in its own section with the ability to see which
 * vendor/ brand those products come from."
 *
 * NEVER GUESS: rows pass through untouched (vendor/brand included); grouping
 * and deterministic ordering only.
 */
import { describe, it, expect } from "vitest";

import { groupTypeMovers } from "@/lib/discovery/type-movers-core";
import type { DiscoveryMarketSignalRow } from "@/lib/discovery/types";

let nextId = 1;

function signal(over: Partial<DiscoveryMarketSignalRow>): DiscoveryMarketSignalRow {
  return {
    id: nextId++,
    dataset_id: "ds-1",
    kind: "type_mover",
    license_number: null,
    inventory_type: "Usable Marijuana",
    product_name: "Blue Dream 3.5g",
    brand: null,
    strain_name: null,
    units: 1,
    revenue_minor: 1000,
    median_unit_price_minor: null,
    p25_unit_price_minor: null,
    vendor_name: null,
    vendor_license: null,
    created_at: "2026-06-01T00:00:00Z",
    ...over,
  };
}

describe("groupTypeMovers (Task I I4)", () => {
  it("returns an empty list for no signals", () => {
    expect(groupTypeMovers([])).toEqual([]);
  });

  it("groups by inventory type with sections ordered by total revenue desc", () => {
    const groups = groupTypeMovers([
      signal({ inventory_type: "Concentrate", product_name: "Dab A", revenue_minor: 400 }),
      signal({ inventory_type: "Usable Marijuana", product_name: "Flower A", revenue_minor: 300 }),
      signal({ inventory_type: "Usable Marijuana", product_name: "Flower B", revenue_minor: 200 }),
      signal({ inventory_type: "Concentrate", product_name: "Dab B", revenue_minor: 350 }),
    ]);
    expect(groups.map((g) => g.inventoryType)).toEqual(["Concentrate", "Usable Marijuana"]);
    expect(groups[0].revenueMinor).toBe(750);
    expect(groups[1].revenueMinor).toBe(500);
  });

  it("ranks rows inside a section by revenue desc, then product name (deterministic)", () => {
    const groups = groupTypeMovers([
      signal({ product_name: "Zeta 1g", revenue_minor: 100 }),
      signal({ product_name: "Alpha 1g", revenue_minor: 100 }), // tie → name order
      signal({ product_name: "Big Mover 1g", revenue_minor: 900 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map((r) => r.product_name)).toEqual([
      "Big Mover 1g",
      "Alpha 1g",
      "Zeta 1g",
    ]);
  });

  it("ignores statewide/competitor mover kinds (callers may pass the full signal list)", () => {
    const groups = groupTypeMovers([
      signal({ kind: "statewide_mover", product_name: "Not Mine", revenue_minor: 99_999 }),
      signal({ kind: "competitor_mover", product_name: "Also Not Mine", revenue_minor: 99_999 }),
      signal({ product_name: "The Only Type Row", revenue_minor: 10 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(1);
    expect(groups[0].rows[0].product_name).toBe("The Only Type Row");
  });

  it("folds a null inventory type into '(unattributed)' — honest, never guessed", () => {
    const groups = groupTypeMovers([signal({ inventory_type: null })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].inventoryType).toBe("(unattributed)");
  });

  it("breaks equal-revenue section ties by type name (deterministic sections)", () => {
    const groups = groupTypeMovers([
      signal({ inventory_type: "Vapor Product", revenue_minor: 500 }),
      signal({ inventory_type: "Concentrate", revenue_minor: 500 }),
    ]);
    expect(groups.map((g) => g.inventoryType)).toEqual(["Concentrate", "Vapor Product"]);
  });

  it("passes vendor and brand fields through untouched (the owner's 'which vendor/brand' ask)", () => {
    const groups = groupTypeMovers([
      signal({
        product_name: "Phat Panda | Grape Ape 3.5g",
        brand: "Phat Panda",
        vendor_name: "GROW OP LLC",
        vendor_license: "620002",
      }),
    ]);
    const row = groups[0].rows[0];
    expect(row.brand).toBe("Phat Panda");
    expect(row.vendor_name).toBe("GROW OP LLC");
    expect(row.vendor_license).toBe("620002");
  });
});
