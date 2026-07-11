/**
 * tests/compliance/po-market-context-core.test.ts — Task I (I6).
 *
 * Covers the PURE PO market-context shaping feeding the builder/detail pages
 * and the AI PO reviewer: conservative exact-then-brand matching, Port
 * Orchard-first provenance (area vs statewide evidence, out-of-area competitor
 * signals dropped), MIN-p25 aggregation, retail÷cost arithmetic gating, order
 * mix from the lines' OWN categories, junk coercion, digest formatting, and
 * the line-review parser's refusal to guess on malformed rows.
 */
import { describe, it, expect } from "vitest";
import {
  buildPoMarketContext,
  formatPoReviewDigest,
  type PoLineLike,
  type PoContextSignalLike,
  type PoContextRosterEntryLike,
} from "@/lib/purchasing/po-market-context-core";
import { parseLineReviews } from "@/lib/purchasing/po-review-ai";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function line(overrides: Partial<PoLineLike> = {}): PoLineLike {
  return {
    product_name: "Blue Dream 3.5g",
    brand: "Acme",
    category: "flower",
    order_qty: 10,
    unit_cost_minor_units: 1000,
    ...overrides,
  };
}

function sig(overrides: Partial<PoContextSignalLike> = {}): PoContextSignalLike {
  return {
    kind: "competitor_mover",
    license_number: "111111",
    inventory_type: "Usable Cannabis",
    product_name: "Blue Dream 3.5g",
    brand: "Acme",
    strain_name: "Blue Dream",
    units: 100,
    revenue_minor: 250_000,
    median_unit_price_minor: 2500,
    p25_unit_price_minor: 2200,
    vendor_name: "Evergreen Farms",
    vendor_license: "610001",
    ...overrides,
  };
}

const ROSTER: PoContextRosterEntryLike[] = [
  { license_number: "111111", tradename: "PO Pot Shop", area: "port_orchard", is_self: false },
  { license_number: "222222", tradename: "Bay Buds", area: "port_orchard", is_self: false },
  { license_number: "333333", tradename: "Bremerton Bud", area: "bremerton", is_self: false },
  { license_number: "413541", tradename: "Greenway Marijuana", area: "port_orchard", is_self: true },
];

// ---------------------------------------------------------------------------
// Matching + provenance
// ---------------------------------------------------------------------------

describe("buildPoMarketContext — matching & provenance", () => {
  it("exact name match wins and carries area evidence with store names", () => {
    const out = buildPoMarketContext([line()], [sig()], ROSTER);
    expect(out.lines).toHaveLength(1);
    const l = out.lines[0];
    expect(l.matchType).toBe("exact");
    expect(l.areaMatch).toBe(true);
    expect(l.areaStores).toEqual(["PO Pot Shop"]);
    expect(l.statewideMatch).toBe(false);
    expect(l.totalUnits).toBe(100);
    expect(l.totalRevenueMinor).toBe(250_000);
    expect(l.medianUnitPriceMinor).toBe(2500);
    expect(l.p25UnitPriceMinor).toBe(2200);
    expect(out.matchedCount).toBe(1);
    expect(out.exactCount).toBe(1);
  });

  it("matching is normalizeKey-insensitive (case/whitespace) — but never fuzzy", () => {
    const out = buildPoMarketContext(
      [line({ product_name: "  BLUE   dream 3.5G " })],
      [sig()],
      ROSTER,
    );
    expect(out.lines[0].matchType).toBe("exact");

    const nearMiss = buildPoMarketContext(
      [line({ product_name: "Blue Dream 3.5", brand: null })],
      [sig({ brand: null })],
      ROSTER,
    );
    expect(nearMiss.lines[0].matchType).toBe("none");
    expect(nearMiss.lines[0].p25UnitPriceMinor).toBeNull();
  });

  it("brand fallback matches when the exact name misses", () => {
    const out = buildPoMarketContext(
      [line({ product_name: "Acme New Drop 1g" })],
      [sig()],
      ROSTER,
    );
    const l = out.lines[0];
    expect(l.matchType).toBe("brand");
    expect(l.areaMatch).toBe(true);
    expect(out.matchedCount).toBe(1);
    expect(out.exactCount).toBe(0);
  });

  it("statewide/type movers count as statewide evidence, not area evidence", () => {
    const out = buildPoMarketContext(
      [line()],
      [
        sig({ kind: "statewide_mover", license_number: null }),
        sig({ kind: "type_mover", license_number: null, p25_unit_price_minor: 2100 }),
      ],
      ROSTER,
    );
    const l = out.lines[0];
    expect(l.matchType).toBe("exact");
    expect(l.areaMatch).toBe(false);
    expect(l.statewideMatch).toBe(true);
    // MIN p25 across the two statewide matches.
    expect(l.p25UnitPriceMinor).toBe(2100);
  });

  it("drops competitor movers from out-of-area or untracked stores entirely", () => {
    const out = buildPoMarketContext(
      [line()],
      [
        sig({ license_number: "333333" }), // bremerton — out of area
        sig({ license_number: "999999" }), // untracked
      ],
      ROSTER,
    );
    const l = out.lines[0];
    expect(l.matchType).toBe("none");
    expect(l.areaMatch).toBe(false);
    expect(l.statewideMatch).toBe(false);
  });

  it("multi-source evidence: MIN p25, median from the top-revenue match, stores deduped+sorted", () => {
    const out = buildPoMarketContext(
      [line()],
      [
        sig({ license_number: "111111", revenue_minor: 100_000, p25_unit_price_minor: 2300, median_unit_price_minor: 2600 }),
        sig({ license_number: "222222", revenue_minor: 300_000, p25_unit_price_minor: 2000, median_unit_price_minor: 2400 }),
        sig({ kind: "statewide_mover", license_number: null, revenue_minor: 900_000, p25_unit_price_minor: 2100, median_unit_price_minor: 2550 }),
      ],
      ROSTER,
    );
    const l = out.lines[0];
    expect(l.areaStores).toEqual(["Bay Buds", "PO Pot Shop"]);
    expect(l.statewideMatch).toBe(true);
    expect(l.totalUnits).toBe(300);
    expect(l.totalRevenueMinor).toBe(1_300_000);
    expect(l.p25UnitPriceMinor).toBe(2000); // MIN across all matches
    expect(l.medianUnitPriceMinor).toBe(2550); // from the top-revenue match
  });
});

// ---------------------------------------------------------------------------
// Retail÷cost arithmetic + coercion
// ---------------------------------------------------------------------------

describe("buildPoMarketContext — retail/cost multiple & coercion", () => {
  it("computes p25 ÷ cost to 1 decimal only when both are known and cost > 0", () => {
    const out = buildPoMarketContext([line({ unit_cost_minor_units: 1000 })], [sig()], ROSTER);
    expect(out.lines[0].retailCostMultiple).toBe(2.2);

    const zeroCost = buildPoMarketContext([line({ unit_cost_minor_units: 0 })], [sig()], ROSTER);
    expect(zeroCost.lines[0].retailCostMultiple).toBeNull();

    const noP25 = buildPoMarketContext([line()], [sig({ p25_unit_price_minor: null })], ROSTER);
    expect(noP25.lines[0].retailCostMultiple).toBeNull();
  });

  it("coerces junk line numbers to 0 and skips unnamed lines", () => {
    const out = buildPoMarketContext(
      [
        line({ order_qty: Number.NaN, unit_cost_minor_units: -5 }),
        line({ product_name: "   " }),
      ],
      [],
      ROSTER,
    );
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0].orderQty).toBe(0);
    expect(out.lines[0].unitCostMinor).toBe(0);
    expect(out.totalSpendMinor).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Order mix
// ---------------------------------------------------------------------------

describe("buildPoMarketContext — order mix", () => {
  it("aggregates by the lines' OWN categories with spend shares, spend desc", () => {
    const out = buildPoMarketContext(
      [
        line({ category: "flower", order_qty: 10, unit_cost_minor_units: 1000 }), // $100
        line({ product_name: "Gummies", category: "edible", order_qty: 20, unit_cost_minor_units: 500 }), // $100
        line({ product_name: "More Flower", category: "flower", order_qty: 20, unit_cost_minor_units: 1000 }), // $200
        line({ product_name: "Mystery", category: null, order_qty: 1, unit_cost_minor_units: 0 }),
      ],
      [],
      ROSTER,
    );
    expect(out.totalSpendMinor).toBe(40_000);
    expect(out.mix.map((m) => m.category)).toEqual(["flower", "edible", "(uncategorized)"]);
    const flower = out.mix[0];
    expect(flower.lineCount).toBe(2);
    expect(flower.orderQty).toBe(30);
    expect(flower.spendMinor).toBe(30_000);
    expect(flower.spendShare).toBeCloseTo(0.75, 10);
    expect(out.mix[2].spendShare).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Digest formatting
// ---------------------------------------------------------------------------

describe("formatPoReviewDigest", () => {
  it("labels wholesale vs retail bases and carries area evidence with store names", () => {
    const ctx = buildPoMarketContext([line()], [sig()], ROSTER);
    const digest = formatPoReviewDigest(
      { poNumber: "PO-0042", vendorName: "Evergreen Farms", subtotalMinor: 10_000, status: "draft" },
      ctx,
      "Port Orchard",
    );
    expect(digest).toContain("PO-0042");
    expect(digest).toContain("subtotal=$100.00");
    expect(digest).toContain("1 with market evidence (1 exact matches)");
    expect(digest).toContain("unit_cost=$10.00 (WHOLESALE)");
    expect(digest).toContain("PORT ORCHARD_EVIDENCE=yes (PO Pot Shop)");
    expect(digest).toContain("retail_price_to_beat_p25=$22.00");
    expect(digest).toContain("p25_retail_over_cost=2.2x");
    expect(digest).toContain("ORDER MIX");
    expect(digest).toContain("flower: 1 line(s), qty=10, spend=$100.00 (100% of order)");
  });

  it("renders unmatched lines without market fields and prices as n/a upstream", () => {
    const ctx = buildPoMarketContext(
      [line({ product_name: "Totally New Thing", brand: null })],
      [],
      ROSTER,
    );
    const digest = formatPoReviewDigest(
      { poNumber: null, vendorName: null, subtotalMinor: 10_000, status: "draft" },
      ctx,
      "Port Orchard",
    );
    expect(digest).toContain("(unnumbered)");
    expect(digest).toContain("vendor=not set");
    expect(digest).toContain("match=none");
    expect(digest).not.toContain("retail_price_to_beat_p25");
    expect(digest).not.toContain("PORT ORCHARD_EVIDENCE");
  });
});

// ---------------------------------------------------------------------------
// Line-review parser
// ---------------------------------------------------------------------------

describe("parseLineReviews", () => {
  it("parses well-formed lines and clamps confidence", () => {
    const out = parseLineReviews([
      "Blue Dream 3.5g | solid | 0.9 | Proven Port Orchard mover at both tracked stores.",
      "Mystery Dabs | reconsider | 7 | Observed p25 argues against this cost.",
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      name: "Blue Dream 3.5g",
      verdict: "solid",
      confidence: 0.9,
      rationale: "Proven Port Orchard mover at both tracked stores.",
    });
    expect(out[1].verdict).toBe("reconsider");
    expect(out[1].confidence).toBe(1); // clamped
  });

  it("defaults unknown verdicts to check_demand and drops malformed rows", () => {
    const out = parseLineReviews([
      "Thing | amazing | 0.5 | Unknown verdict downgrades.",
      "only two | cols",
      " | solid | 0.5 | empty name dropped",
      "Pipes | check_price | not-a-number | rationale | with | pipes",
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].verdict).toBe("check_demand");
    expect(out[1].name).toBe("Pipes");
    expect(out[1].confidence).toBe(0.5); // NaN → 0.5 default
    expect(out[1].rationale).toBe("rationale | with | pipes");
  });
});
