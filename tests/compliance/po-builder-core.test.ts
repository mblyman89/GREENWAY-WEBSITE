import { describe, expect, it } from "vitest";
import {
  classifyUrgency,
  builderRowKey,
  buildBuilderKpis,
  groupRowsByVendor,
  groupRowsByCategory,
  filterRowsByQuery,
  sortRows,
  presetRowKeys,
  countVendorMismatches,
  buildEmptyStateGuidance,
  type BuilderRowLike,
} from "@/lib/purchasing/po-builder-core";

// ---------------------------------------------------------------------------
// Fixtures — realistic suggestion rows (money in MINOR units).
// ---------------------------------------------------------------------------

function row(overrides: Partial<BuilderRowLike> = {}): BuilderRowLike {
  return {
    posProductKey: "sku-1",
    productName: "Blue Dream 3.5g",
    brand: "Phat Panda",
    category: "flower",
    vendorId: "v1",
    vendorName: "Grow Op Farms",
    onHand: 10,
    unit: "each",
    unitCostMinor: 1200,
    avgDaily: 2,
    reorderPoint: 24,
    suggestedQty: 30,
    belowReorderPoint: true,
    daysOfSupplyLeft: 5,
    ...overrides,
  };
}

const LEAD = 7;

describe("classifyUrgency", () => {
  it("flags a selling product with zero on hand as stockout", () => {
    expect(classifyUrgency(row({ onHand: 0, avgDaily: 1.5 }), LEAD)).toBe("stockout");
  });

  it("flags below-reorder rows that run out within the lead time as critical", () => {
    expect(
      classifyUrgency(row({ onHand: 6, daysOfSupplyLeft: 3, belowReorderPoint: true }), LEAD),
    ).toBe("critical");
  });

  it("flags below-reorder rows with more runway than the lead time as low", () => {
    expect(
      classifyUrgency(row({ onHand: 20, daysOfSupplyLeft: 10, belowReorderPoint: true }), LEAD),
    ).toBe("low");
  });

  it("treats rows above the reorder point as healthy", () => {
    expect(
      classifyUrgency(
        row({ onHand: 100, daysOfSupplyLeft: 50, belowReorderPoint: false }),
        LEAD,
      ),
    ).toBe("healthy");
  });

  it("NEVER flags urgency without demand evidence (zero velocity)", () => {
    // Dormant product, even at zero on hand: no sales ⇒ no purchase urgency.
    expect(
      classifyUrgency(
        row({ onHand: 0, avgDaily: 0, belowReorderPoint: true, daysOfSupplyLeft: Infinity }),
        LEAD,
      ),
    ).toBe("healthy");
  });

  it("treats a non-positive lead time defensively (still classifies)", () => {
    // lead 0 ⇒ nothing can be 'critical' via the runway rule, falls to low.
    expect(
      classifyUrgency(row({ onHand: 6, daysOfSupplyLeft: 3, belowReorderPoint: true }), 0),
    ).toBe("low");
  });
});

describe("builderRowKey", () => {
  it("uses the pos product key when present", () => {
    expect(builderRowKey(row({ posProductKey: "abc" }))).toBe("abc");
  });

  it("falls back to a normalized name key (matches the store's dedupe)", () => {
    expect(builderRowKey(row({ posProductKey: null, productName: "  Blue Dream 3.5g " }))).toBe(
      "name:blue dream 3.5g",
    );
  });
});

describe("buildBuilderKpis", () => {
  it("counts urgency bands, sums suggested units/spend, and dedupes vendors/categories", () => {
    const rows: BuilderRowLike[] = [
      row({ posProductKey: "a", onHand: 0, avgDaily: 1 }), // stockout
      row({ posProductKey: "b", onHand: 4, daysOfSupplyLeft: 2 }), // critical
      row({ posProductKey: "c", onHand: 20, daysOfSupplyLeft: 10 }), // low
      row({
        posProductKey: "d",
        belowReorderPoint: false,
        daysOfSupplyLeft: 40,
        suggestedQty: 0,
        vendorName: "grow op farms", // same vendor, different case
        category: "Flower",
      }), // healthy
    ];
    const k = buildBuilderKpis(rows, LEAD);
    expect(k.totalRows).toBe(4);
    expect(k.stockoutCount).toBe(1);
    expect(k.criticalCount).toBe(1);
    expect(k.lowCount).toBe(1);
    expect(k.needsActionCount).toBe(3);
    expect(k.suggestedUnits).toBe(90); // 30 × 3 rows with qty > 0
    expect(k.suggestedSpendMinor).toBe(90 * 1200);
    expect(k.vendorCount).toBe(1);
    expect(k.categoryCount).toBe(1);
  });

  it("returns zeros on an empty set", () => {
    const k = buildBuilderKpis([], LEAD);
    expect(k.totalRows).toBe(0);
    expect(k.needsActionCount).toBe(0);
    expect(k.suggestedSpendMinor).toBe(0);
  });
});

describe("groupRowsByVendor / groupRowsByCategory", () => {
  const rows: BuilderRowLike[] = [
    row({ posProductKey: "a", vendorName: "Acme", category: "flower" }), // low? onHand10 days5 -> critical (5<=7)
    row({ posProductKey: "b", vendorName: "Acme", category: "vape", belowReorderPoint: false, daysOfSupplyLeft: 30, suggestedQty: 0 }),
    row({
      posProductKey: "c",
      vendorName: null,
      category: null,
      belowReorderPoint: false,
      daysOfSupplyLeft: 30,
      suggestedQty: 0,
    }),
  ];

  it("groups by vendor with (unknown) bucket, needs-action counts, and spend", () => {
    const g = groupRowsByVendor(rows, LEAD);
    expect(g.map((x) => x.label)).toEqual(["Acme", "(unknown)"]);
    const acme = g[0];
    expect(acme.lineCount).toBe(2);
    expect(acme.needsActionCount).toBe(1);
    expect(acme.suggestedSpendMinor).toBe(30 * 1200);
  });

  it("groups by category the same way", () => {
    const g = groupRowsByCategory(rows, LEAD);
    expect(g.map((x) => x.label).sort()).toEqual(["(unknown)", "flower", "vape"]);
  });
});

describe("filterRowsByQuery", () => {
  const rows = [
    row({ posProductKey: "a", productName: "Blue Dream 3.5g", brand: "Phat Panda" }),
    row({ posProductKey: "b", productName: "GG4 Cart", brand: null, vendorName: "Fairwinds" }),
  ];

  it("matches name, brand, and vendor case-insensitively", () => {
    expect(filterRowsByQuery(rows, "blue dream")).toHaveLength(1);
    expect(filterRowsByQuery(rows, "PANDA")).toHaveLength(1);
    expect(filterRowsByQuery(rows, "fairwinds")).toHaveLength(1);
  });

  it("returns everything for a blank query", () => {
    expect(filterRowsByQuery(rows, "  ")).toHaveLength(2);
  });
});

describe("sortRows", () => {
  const rows: BuilderRowLike[] = [
    row({ posProductKey: "healthy", productName: "Zzz", belowReorderPoint: false, daysOfSupplyLeft: 40, suggestedQty: 2, unitCostMinor: 100 }),
    row({ posProductKey: "stockout", productName: "Aaa", onHand: 0, avgDaily: 1, daysOfSupplyLeft: 0, suggestedQty: 10, unitCostMinor: 5000 }),
    row({ posProductKey: "low", productName: "Mmm", onHand: 20, daysOfSupplyLeft: 10, suggestedQty: 5, unitCostMinor: 200 }),
  ];

  it("urgency sort puts stockout first and healthy last", () => {
    const sorted = sortRows(rows, "urgency", LEAD);
    expect(sorted.map((r) => r.posProductKey)).toEqual(["stockout", "low", "healthy"]);
  });

  it("value sort ranks by suggested order value desc", () => {
    const sorted = sortRows(rows, "value", LEAD);
    expect(sorted[0].posProductKey).toBe("stockout"); // 10 × 5000
    expect(sorted[2].posProductKey).toBe("healthy"); // 2 × 100
  });

  it("product sort is alphabetical and does not mutate the input", () => {
    const sorted = sortRows(rows, "product", LEAD);
    expect(sorted.map((r) => r.productName)).toEqual(["Aaa", "Mmm", "Zzz"]);
    expect(rows[0].posProductKey).toBe("healthy"); // original untouched
  });

  it("daysLeft sort treats Infinity as last", () => {
    const withInf = [...rows, row({ posProductKey: "inf", avgDaily: 0, daysOfSupplyLeft: Infinity })];
    const sorted = sortRows(withInf, "daysLeft", LEAD);
    expect(sorted[sorted.length - 1].posProductKey).toBe("inf");
  });
});

describe("presetRowKeys", () => {
  const rows: BuilderRowLike[] = [
    row({ posProductKey: "so", onHand: 0, avgDaily: 1 }),
    row({ posProductKey: "crit", onHand: 4, daysOfSupplyLeft: 2 }),
    row({ posProductKey: "low", onHand: 20, daysOfSupplyLeft: 10 }),
    row({ posProductKey: "ok", belowReorderPoint: false, daysOfSupplyLeft: 40 }),
    row({ posProductKey: "noqty", onHand: 0, avgDaily: 1, suggestedQty: 0 }),
  ];

  it("needs_action selects stockout+critical+low with qty > 0 only", () => {
    expect(presetRowKeys(rows, "needs_action", LEAD)).toEqual(["so", "crit", "low"]);
  });

  it("stockouts selects only stockout rows", () => {
    expect(presetRowKeys(rows, "stockouts", LEAD)).toEqual(["so"]);
  });

  it("critical selects stockout + critical", () => {
    expect(presetRowKeys(rows, "critical", LEAD)).toEqual(["so", "crit"]);
  });

  it("all/none behave as expected", () => {
    expect(presetRowKeys(rows, "all", LEAD)).toHaveLength(5);
    expect(presetRowKeys(rows, "none", LEAD)).toEqual([]);
  });
});

describe("countVendorMismatches", () => {
  it("counts selected lines whose inventory vendor differs from the PO vendor", () => {
    const lines = [
      { vendorName: "Acme" },
      { vendorName: "acme " }, // same vendor, case/space insensitive
      { vendorName: "Other Farms" },
      { vendorName: null }, // unknown vendor is never a mismatch
    ];
    expect(countVendorMismatches(lines, "Acme")).toBe(1);
  });

  it("returns 0 when no PO vendor is selected", () => {
    expect(countVendorMismatches([{ vendorName: "Acme" }], null)).toBe(0);
    expect(countVendorMismatches([{ vendorName: "Acme" }], "  ")).toBe(0);
  });
});

describe("buildEmptyStateGuidance", () => {
  it("explains filtered-to-nothing with a reset hint", () => {
    const g = buildEmptyStateGuidance({ hasActiveFilters: true, hasPrefill: false });
    expect(g.title).toContain("filters");
    expect(g.hints.length).toBeGreaterThan(0);
  });

  it("explains truly-empty inventory with next steps", () => {
    const g = buildEmptyStateGuidance({ hasActiveFilters: false, hasPrefill: false });
    expect(g.title).toContain("No active inventory");
    expect(g.description).toContain("ACTIVE inventory lots");
  });

  it("acknowledges the prefilled lead line when present", () => {
    const g = buildEmptyStateGuidance({ hasActiveFilters: false, hasPrefill: true });
    expect(g.title).toContain("lead line");
  });
});
