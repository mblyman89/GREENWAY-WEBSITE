/**
 * tests/compliance/assortment-gap-core.test.ts
 *
 * S12 (Task H, logged suggestion #4): assortment-gap analysis — statewide top
 * movers from the monthly CCRS drop crossed against Greenway's PUBLISHED menu.
 *
 * NEVER GUESS contract under test:
 *  - Matching is exact-after-conservative-normalization only (lowercase, trim,
 *    collapse whitespace). Punctuation/spelling near-misses must NOT match —
 *    they surface as gaps instead of being silently mis-matched.
 *  - Movers without a product name can't be compared → skipped, never guessed.
 *  - competitor_mover rows describe one store, not statewide demand → excluded.
 *  - Rows are capped for the UI, but counts cover ALL candidates.
 */
import { describe, expect, it } from "vitest";

import {
  buildAssortmentGapReport,
  MAX_GAP_ROWS,
  normalizeKey,
  type GapMenuItemLike,
  type GapSignalLike,
} from "@/lib/discovery/assortment-gap-core";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function mover(overrides: Partial<GapSignalLike> = {}): GapSignalLike {
  return {
    kind: "statewide_mover",
    product_name: "Blue Dream 3.5g",
    inventory_type: "Usable Marijuana",
    brand: "Phat Panda",
    strain_name: "Blue Dream",
    units: 1200,
    revenue_minor: 3_600_000,
    median_unit_price_minor: 3000,
    p25_unit_price_minor: 2500,
    ...overrides,
  };
}

function menuItem(overrides: Partial<GapMenuItemLike> = {}): GapMenuItemLike {
  return {
    name: "Blue Dream 3.5g",
    brand: "Phat Panda",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// normalizeKey — deliberately conservative
// ---------------------------------------------------------------------------

describe("normalizeKey (S12)", () => {
  it("lowercases, trims, and collapses internal whitespace", () => {
    expect(normalizeKey("  Blue   Dream\t3.5g  ")).toBe("blue dream 3.5g");
  });

  it("maps null/undefined/empty to the empty string", () => {
    expect(normalizeKey(null)).toBe("");
    expect(normalizeKey(undefined)).toBe("");
    expect(normalizeKey("   ")).toBe("");
  });

  it("does NOT strip punctuation — near-misses stay distinct (never guess)", () => {
    // Aggressive normalization would manufacture a false "carried" match here.
    expect(normalizeKey("Blue Dream 3.5g")).not.toBe(normalizeKey("Blue Dream 3,5g"));
    expect(normalizeKey("GMO Cookies")).not.toBe(normalizeKey("G.M.O. Cookies"));
  });
});

// ---------------------------------------------------------------------------
// buildAssortmentGapReport
// ---------------------------------------------------------------------------

describe("buildAssortmentGapReport (S12)", () => {
  it("marks an exact (case/whitespace-insensitive) name match as carried", () => {
    const report = buildAssortmentGapReport(
      [mover({ product_name: "BLUE  DREAM 3.5G" })],
      [menuItem({ name: "blue dream 3.5g" })],
    );
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].status).toBe("carried");
    expect(report.carriedCount).toBe(1);
    expect(report.brandCarriedCount).toBe(0);
    expect(report.notCarriedCount).toBe(0);
  });

  it("marks a brand-only match as brand_carried with the menu item count", () => {
    const report = buildAssortmentGapReport(
      [mover({ product_name: "Blue Dream 7g", brand: "Phat Panda" })],
      [
        menuItem({ name: "Blue Dream 3.5g", brand: "Phat Panda" }),
        menuItem({ name: "Grape Ape 1g", brand: "Phat Panda" }),
        menuItem({ name: "Other Thing", brand: "Someone Else" }),
      ],
    );
    expect(report.rows[0].status).toBe("brand_carried");
    expect(report.rows[0].brandItemCount).toBe(2);
    expect(report.brandCarriedCount).toBe(1);
  });

  it("marks unmatched name+brand as not_carried", () => {
    const report = buildAssortmentGapReport(
      [mover({ product_name: "Rainbow Belts 1g", brand: "Mystery Farms" })],
      [menuItem()],
    );
    expect(report.rows[0].status).toBe("not_carried");
    expect(report.notCarriedCount).toBe(1);
  });

  it("does NOT fuzzy-match near-miss names (punctuation variant → gap, not match)", () => {
    const report = buildAssortmentGapReport(
      [mover({ product_name: "Blue Dream 3.5g", brand: "Nobody" })],
      [menuItem({ name: "Blue Dream 3,5g", brand: "Nobody Else" })],
    );
    // A fuzzy matcher would call this "carried" — we honestly report the gap.
    expect(report.rows[0].status).toBe("not_carried");
  });

  it("a mover without a brand can only be name-matched", () => {
    const report = buildAssortmentGapReport(
      [
        mover({ product_name: "House Preroll 1g", brand: null }),
        mover({ product_name: "Blue Dream 3.5g", brand: null, revenue_minor: 100 }),
      ],
      [menuItem({ name: "Blue Dream 3.5g", brand: "Phat Panda" })],
    );
    expect(report.rows[0].status).toBe("not_carried"); // no brand to fall back to
    expect(report.rows[1].status).toBe("carried"); // exact name still matches
  });

  it("sorts rows by revenue descending", () => {
    const report = buildAssortmentGapReport(
      [
        mover({ product_name: "Small", revenue_minor: 100 }),
        mover({ product_name: "Big", revenue_minor: 9_000_000 }),
        mover({ product_name: "Mid", revenue_minor: 5000 }),
      ],
      [],
    );
    expect(report.rows.map((r) => r.productName)).toEqual(["Big", "Mid", "Small"]);
  });

  it("excludes competitor_mover rows but keeps kind-less rows (pre-kind data)", () => {
    const report = buildAssortmentGapReport(
      [
        mover({ kind: "competitor_mover", product_name: "Store-Specific Item" }),
        mover({ kind: undefined, product_name: "Legacy Row" }),
        mover({ product_name: "Statewide Row" }),
      ],
      [],
    );
    expect(report.moverCount).toBe(2);
    expect(report.rows.map((r) => r.productName).sort()).toEqual(["Legacy Row", "Statewide Row"]);
  });

  it("skips movers without a product name (never guessed)", () => {
    const report = buildAssortmentGapReport(
      [mover({ product_name: null }), mover({ product_name: "   " }), mover({ product_name: "Real" })],
      [],
    );
    expect(report.moverCount).toBe(1);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].productName).toBe("Real");
  });

  it("caps rows at max but counts ALL candidates in the totals", () => {
    const movers = Array.from({ length: 10 }, (_, i) =>
      mover({ product_name: `Item ${i}`, brand: "Nobody", revenue_minor: 1000 - i }),
    );
    const report = buildAssortmentGapReport(movers, [], { max: 3 });
    expect(report.rows).toHaveLength(3);
    expect(report.moverCount).toBe(10);
    expect(report.notCarriedCount).toBe(10); // counts are pre-cap
    expect(report.rows.map((r) => r.productName)).toEqual(["Item 0", "Item 1", "Item 2"]);
  });

  it("defaults the cap to MAX_GAP_ROWS", () => {
    const movers = Array.from({ length: MAX_GAP_ROWS + 5 }, (_, i) =>
      mover({ product_name: `Item ${i}` }),
    );
    const report = buildAssortmentGapReport(movers, []);
    expect(report.rows).toHaveLength(MAX_GAP_ROWS);
    expect(report.moverCount).toBe(MAX_GAP_ROWS + 5);
  });

  it("with an empty menu everything is not_carried and menuItemCount is 0", () => {
    const report = buildAssortmentGapReport([mover(), mover({ product_name: "Two" })], []);
    expect(report.menuItemCount).toBe(0);
    expect(report.carriedCount).toBe(0);
    expect(report.brandCarriedCount).toBe(0);
    expect(report.notCarriedCount).toBe(2);
  });

  it("coerces junk numeric fields instead of propagating NaN", () => {
    const report = buildAssortmentGapReport(
      [
        mover({
          product_name: "Junk",
          units: Number.NaN,
          revenue_minor: Number.POSITIVE_INFINITY,
          median_unit_price_minor: Number.NaN,
          p25_unit_price_minor: null,
        }),
      ],
      [],
    );
    expect(report.rows[0].units).toBe(0);
    expect(report.rows[0].revenueMinor).toBe(0);
    expect(report.rows[0].medianUnitPriceMinor).toBeNull();
    expect(report.rows[0].p25UnitPriceMinor).toBeNull();
  });
});
