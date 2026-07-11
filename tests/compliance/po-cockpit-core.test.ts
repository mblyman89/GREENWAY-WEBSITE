/**
 * tests/compliance/po-cockpit-core.test.ts — Task I (I5).
 *
 * Covers the PURE purchase-manager cockpit shaping for the Leads page:
 * area-scoped head-to-head board, the deduped "they sell it, we don't" buy
 * list, and the undercut price-check board. Never-guess rules under test:
 * self exclusion, conservative exact-key menu matching, conflict-tombstoned
 * brand/strain/vendor on merged rows, MIN-p25 "price to beat", junk-number
 * coercion, and the conservative CCRS-type → lead-category map.
 */
import { describe, it, expect } from "vitest";
import {
  buildPoCockpit,
  suggestLeadCategory,
  buildBuyRowDemandSignal,
  MAX_BUY_ROWS,
  MAX_UNDERCUT_ROWS,
  type CockpitStatLike,
  type CockpitRosterEntryLike,
  type CockpitSignalLike,
  type CockpitMenuItemLike,
} from "@/lib/discovery/po-cockpit-core";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function stat(overrides: Partial<CockpitStatLike> = {}): CockpitStatLike {
  return {
    license_number: "111111",
    name: "PO POT SHOP L.L.C.",
    dba: "PO Pot Shop",
    city: "PORT ORCHARD",
    retail_units: 1000,
    retail_revenue_minor: 2_000_000,
    retail_line_count: 900,
    price_sample_size: 900,
    price_p25_minor: 1200,
    price_median_minor: 2000,
    price_p75_minor: 3500,
    by_type: [
      { inventoryType: "Usable Cannabis", units: 500, revenueMinor: 1_000_000 },
      { inventoryType: "Solid Edible", units: 300, revenueMinor: 600_000 },
      { inventoryType: "Cannabis Mix Packaged", units: 150, revenueMinor: 300_000 },
      { inventoryType: "Topical Ointment", units: 50, revenueMinor: 100_000 },
    ],
    wholesale_line_count: 120,
    wholesale_spend_minor: 800_000,
    top_suppliers: [{ licenseeId: "9001" }, { licenseeId: "9002" }],
    ...overrides,
  };
}

function roster(overrides: Partial<CockpitRosterEntryLike> = {}): CockpitRosterEntryLike {
  return {
    license_number: "111111",
    tradename: "PO Pot Shop",
    city: "Port Orchard",
    area: "port_orchard",
    is_self: false,
    ...overrides,
  };
}

function sig(overrides: Partial<CockpitSignalLike> = {}): CockpitSignalLike {
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

const GREENWAY: CockpitRosterEntryLike = {
  license_number: "413541",
  tradename: "Greenway Marijuana",
  city: "Port Orchard",
  area: "port_orchard",
  is_self: true,
};

const EMPTY_MENU: CockpitMenuItemLike[] = [];

// ---------------------------------------------------------------------------
// suggestLeadCategory — conservative CCRS-type map
// ---------------------------------------------------------------------------

describe("suggestLeadCategory", () => {
  it("maps the unambiguous WSLCB types (real May-2026 extract vocabulary)", () => {
    expect(suggestLeadCategory("Usable Cannabis")).toBe("flower");
    expect(suggestLeadCategory("Usable Marijuana")).toBe("flower");
    expect(suggestLeadCategory("Flower Lot")).toBe("flower");
    expect(suggestLeadCategory("Cannabis Mix Packaged")).toBe("preroll");
    expect(suggestLeadCategory("Cannabis Mix Infused")).toBe("preroll");
    expect(suggestLeadCategory("Hydrocarbon Concentrate")).toBe("concentrate");
    expect(suggestLeadCategory("Ethanol Concentrate")).toBe("concentrate");
    expect(suggestLeadCategory("CO2 Concentrate")).toBe("concentrate");
    expect(suggestLeadCategory("Non-Solvent based Concentrate")).toBe("concentrate");
    expect(suggestLeadCategory("Solid Edible")).toBe("edible");
    expect(suggestLeadCategory("Liquid Edible")).toBe("edible");
    expect(suggestLeadCategory("Topical Ointment")).toBe("topical");
  });

  it("is case/whitespace-insensitive (normalizeKey discipline)", () => {
    expect(suggestLeadCategory("  USABLE   CANNABIS ")).toBe("flower");
    expect(suggestLeadCategory("solid edible")).toBe("edible");
  });

  it("refuses to guess on ambiguous types — the manager picks", () => {
    // Carts OR dabs — never guess which.
    expect(suggestLeadCategory("Concentrate For Inhalation")).toBeNull();
    // Loose mix vs preroll input.
    expect(suggestLeadCategory("Cannabis Mix")).toBeNull();
    expect(suggestLeadCategory("Tincture")).toBeNull();
    expect(suggestLeadCategory("Capsule")).toBeNull();
    expect(suggestLeadCategory("Transdermal")).toBeNull();
    expect(suggestLeadCategory("Suppository")).toBeNull();
    expect(suggestLeadCategory("Something Brand New")).toBeNull();
    expect(suggestLeadCategory(null)).toBeNull();
    expect(suggestLeadCategory("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Head-to-head board
// ---------------------------------------------------------------------------

describe("buildPoCockpit — head-to-head board", () => {
  it("scopes to the requested area, excludes self, and sorts by revenue desc", () => {
    const out = buildPoCockpit(
      [
        stat(), // 111111 port orchard, $20k
        stat({ license_number: "222222", retail_revenue_minor: 5_000_000 }), // port orchard, $50k
        stat({ license_number: "333333" }), // bremerton — out of area
        stat({ license_number: "413541", retail_revenue_minor: 9_999_999 }), // SELF — never listed
      ],
      [
        roster(),
        roster({ license_number: "222222", tradename: "Bay Buds" }),
        roster({ license_number: "333333", tradename: "Bremerton Bud", area: "bremerton" }),
        GREENWAY,
      ],
      [],
      EMPTY_MENU,
    );
    expect(out.area).toBe("port_orchard");
    expect(out.competitorCount).toBe(2);
    expect(out.board.map((b) => b.displayName)).toEqual(["Bay Buds", "PO Pot Shop"]);
    expect(out.board.every((b) => b.licenseNumber !== "413541")).toBe(true);
  });

  it("supports a non-default area", () => {
    const out = buildPoCockpit(
      [stat({ license_number: "333333" })],
      [roster({ license_number: "333333", tradename: "Bremerton Bud", area: "bremerton" })],
      [],
      EMPTY_MENU,
      { area: "bremerton" },
    );
    expect(out.area).toBe("bremerton");
    expect(out.board).toHaveLength(1);
    expect(out.board[0].displayName).toBe("Bremerton Bud");
  });

  it("computes top-3 category mix with shares of typed revenue", () => {
    const out = buildPoCockpit([stat()], [roster()], [], EMPTY_MENU);
    const row = out.board[0];
    expect(row.topTypes).toHaveLength(3);
    expect(row.topTypes[0]).toEqual({
      inventoryType: "Usable Cannabis",
      revenueMinor: 1_000_000,
      share: 0.5,
    });
    expect(row.topTypes[1].inventoryType).toBe("Solid Edible");
    expect(row.topTypes[1].share).toBeCloseTo(0.3, 10);
    expect(row.topTypes[2].inventoryType).toBe("Cannabis Mix Packaged");
  });

  it("carries price bands and coerces junk numbers to 0/null, never a guess", () => {
    const junk = stat({
      retail_units: Number.NaN,
      retail_revenue_minor: -5,
      price_p25_minor: Number.POSITIVE_INFINITY as unknown as number,
      price_median_minor: null,
      by_type: [],
    });
    const out = buildPoCockpit([junk], [roster()], [], EMPTY_MENU);
    const row = out.board[0];
    expect(row.retailUnits).toBe(0);
    expect(row.retailRevenueMinor).toBe(0);
    expect(row.priceP25Minor).toBeNull();
    expect(row.priceMedianMinor).toBeNull();
    expect(row.priceP75Minor).toBe(3500);
    expect(row.topTypes).toEqual([]);
  });

  it("renders sourcing as null for pre-0107 rows (no wholesale fields)", () => {
    const pre0107 = stat();
    delete (pre0107 as Partial<CockpitStatLike>).wholesale_line_count;
    delete (pre0107 as Partial<CockpitStatLike>).wholesale_spend_minor;
    delete (pre0107 as Partial<CockpitStatLike>).top_suppliers;
    const out = buildPoCockpit([pre0107], [roster()], [], EMPTY_MENU);
    expect(out.board[0].wholesaleSpendMinor).toBeNull();
    expect(out.board[0].supplierCount).toBeNull();

    const with0107 = buildPoCockpit([stat()], [roster()], [], EMPTY_MENU);
    expect(with0107.board[0].wholesaleSpendMinor).toBe(800_000);
    expect(with0107.board[0].supplierCount).toBe(2);
  });

  it("counts our menu coverage of each store's movers (carried / brand / gap)", () => {
    const menu: CockpitMenuItemLike[] = [
      { name: "Blue Dream 3.5g", brand: "Acme", priceMinor: 2500 }, // exact carried
      { name: "Some Other Gummy", brand: "Chewy Co", priceMinor: 1500 }, // brand only
    ];
    const signals = [
      sig(), // carried (exact name)
      sig({ product_name: "Sour Gummies 100mg", brand: "Chewy Co", inventory_type: "Solid Edible" }), // brand_carried
      sig({ product_name: "Mystery Dabs 1g", brand: "Dab Lab", inventory_type: "Hydrocarbon Concentrate" }), // not_carried
    ];
    const out = buildPoCockpit([stat()], [roster()], signals, menu);
    const row = out.board[0];
    expect(row.moversTotal).toBe(3);
    expect(row.moversCarried).toBe(1);
    expect(row.moversBrandCarried).toBe(1);
    expect(row.moversNotCarried).toBe(1);
  });

  it("ignores statewide/type movers and out-of-area competitor movers", () => {
    const signals = [
      sig({ kind: "statewide_mover", license_number: null }),
      sig({ kind: "type_mover", license_number: null }),
      sig({ license_number: "333333" }), // bremerton store — out of area
    ];
    const out = buildPoCockpit(
      [stat()],
      [roster(), roster({ license_number: "333333", tradename: "Bremerton Bud", area: "bremerton" })],
      signals,
      EMPTY_MENU,
    );
    expect(out.board[0].moversTotal).toBe(0);
    expect(out.buyList).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Buy list — "they sell it, we don't"
// ---------------------------------------------------------------------------

describe("buildPoCockpit — buy list", () => {
  it("dedupes the same product across stores: sums, MIN p25, stores by revenue desc", () => {
    const signals = [
      sig({ license_number: "111111", units: 100, revenue_minor: 250_000, p25_unit_price_minor: 2200 }),
      sig({ license_number: "222222", units: 60, revenue_minor: 400_000, p25_unit_price_minor: 1900, median_unit_price_minor: 2100 }),
    ];
    const out = buildPoCockpit(
      [stat(), stat({ license_number: "222222" })],
      [roster(), roster({ license_number: "222222", tradename: "Bay Buds" })],
      signals,
      EMPTY_MENU,
    );
    expect(out.buyList).toHaveLength(1);
    const row = out.buyList[0];
    expect(row.productName).toBe("Blue Dream 3.5g");
    expect(row.storeCount).toBe(2);
    // Bay Buds contributed more revenue → listed first.
    expect(row.stores).toEqual(["Bay Buds", "PO Pot Shop"]);
    expect(row.totalUnits).toBe(160);
    expect(row.totalRevenueMinor).toBe(650_000);
    // MIN p25 across stores — beats ~75% at EVERY store.
    expect(row.priceToBeatMinor).toBe(1900);
    // Median from the top-revenue store (Bay Buds).
    expect(row.topStoreMedianMinor).toBe(2100);
    expect(row.menuStatus).toBe("not_carried");
  });

  it("carries vendor/brand/strain when stores agree; conflicts render null", () => {
    const agree = buildPoCockpit(
      [stat(), stat({ license_number: "222222" })],
      [roster(), roster({ license_number: "222222", tradename: "Bay Buds" })],
      [sig(), sig({ license_number: "222222" })],
      EMPTY_MENU,
    );
    expect(agree.buyList[0].vendorName).toBe("Evergreen Farms");
    expect(agree.buyList[0].vendorLicense).toBe("610001");
    expect(agree.buyList[0].strainName).toBe("Blue Dream");
    expect(agree.buyList[0].inventoryType).toBe("Usable Cannabis");

    const conflict = buildPoCockpit(
      [stat(), stat({ license_number: "222222" })],
      [roster(), roster({ license_number: "222222", tradename: "Bay Buds" })],
      [
        sig(),
        sig({
          license_number: "222222",
          vendor_name: "Rival Farms",
          vendor_license: "610002",
          strain_name: "Blueberry Dream",
          inventory_type: "Flower Lot",
        }),
      ],
      EMPTY_MENU,
    );
    const row = conflict.buyList[0];
    expect(row.vendorName).toBeNull();
    expect(row.vendorLicense).toBeNull();
    expect(row.strainName).toBeNull();
    expect(row.inventoryType).toBeNull();
    // Type conflict → no category suggestion either (built from the null type).
    expect(row.suggestedCategory).toBeNull();
  });

  it("a null field on one row does NOT erase a known value on another (not a conflict)", () => {
    const out = buildPoCockpit(
      [stat(), stat({ license_number: "222222" })],
      [roster(), roster({ license_number: "222222", tradename: "Bay Buds" })],
      [
        sig({ vendor_name: null, vendor_license: null, strain_name: null }),
        sig({ license_number: "222222" }),
      ],
      EMPTY_MENU,
    );
    const row = out.buyList[0];
    expect(row.vendorLicense).toBe("610001");
    expect(row.vendorName).toBe("Evergreen Farms");
    expect(row.strainName).toBe("Blue Dream");
  });

  it("pre-0110 signals (no vendor fields) render vendor null — never guessed", () => {
    const s = sig();
    delete (s as Partial<CockpitSignalLike>).vendor_name;
    delete (s as Partial<CockpitSignalLike>).vendor_license;
    const out = buildPoCockpit([stat()], [roster()], [s], EMPTY_MENU);
    expect(out.buyList[0].vendorName).toBeNull();
    expect(out.buyList[0].vendorLicense).toBeNull();
  });

  it("brand-carried movers stay on the buy list, flagged as brand_carried", () => {
    const menu: CockpitMenuItemLike[] = [{ name: "Acme Something Else", brand: "Acme", priceMinor: 2000 }];
    const out = buildPoCockpit([stat()], [roster()], [sig()], menu);
    expect(out.buyList).toHaveLength(1);
    expect(out.buyList[0].menuStatus).toBe("brand_carried");
  });

  it("exact-name-carried movers never appear on the buy list", () => {
    const menu: CockpitMenuItemLike[] = [{ name: "  blue   dream 3.5G ", brand: null, priceMinor: 2600 }];
    const out = buildPoCockpit([stat()], [roster()], [sig()], menu);
    expect(out.buyList).toHaveLength(0);
  });

  it("suggests a category from the CCRS type only when unambiguous", () => {
    const out = buildPoCockpit(
      [stat()],
      [roster()],
      [
        sig(), // Usable Cannabis → flower
        sig({ product_name: "Cart 1g", brand: "VapeCo", inventory_type: "Concentrate For Inhalation" }),
      ],
      EMPTY_MENU,
    );
    const byName = new Map(out.buyList.map((r) => [r.productName, r]));
    expect(byName.get("Blue Dream 3.5g")?.suggestedCategory).toBe("flower");
    expect(byName.get("Cart 1g")?.suggestedCategory).toBeNull();
  });

  it("sorts by total revenue desc, then units, then name, and honors the cap", () => {
    const signals: CockpitSignalLike[] = [
      sig({ product_name: "B Product", revenue_minor: 100, units: 5 }),
      sig({ product_name: "A Product", revenue_minor: 100, units: 5 }),
      sig({ product_name: "Big Product", revenue_minor: 900, units: 1 }),
    ];
    const out = buildPoCockpit([stat()], [roster()], signals, EMPTY_MENU);
    expect(out.buyList.map((r) => r.productName)).toEqual(["Big Product", "A Product", "B Product"]);

    const capped = buildPoCockpit([stat()], [roster()], signals, EMPTY_MENU, { maxBuyRows: 2 });
    expect(capped.buyList).toHaveLength(2);
    expect(MAX_BUY_ROWS).toBe(25);
  });

  it("coerces junk mover numbers and skips unnamed movers", () => {
    const out = buildPoCockpit(
      [stat()],
      [roster()],
      [
        sig({ units: Number.NaN, revenue_minor: -1, p25_unit_price_minor: Number.NaN }),
        sig({ product_name: "   " }),
        sig({ product_name: null }),
      ],
      EMPTY_MENU,
    );
    expect(out.buyList).toHaveLength(1);
    expect(out.buyList[0].totalUnits).toBe(0);
    expect(out.buyList[0].totalRevenueMinor).toBe(0);
    expect(out.buyList[0].priceToBeatMinor).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Undercut board
// ---------------------------------------------------------------------------

describe("buildPoCockpit — undercut board", () => {
  it("pairs our MIN exact-match menu price with their MIN p25; positive delta = above beat", () => {
    const menu: CockpitMenuItemLike[] = [
      { name: "Blue Dream 3.5g", brand: "Acme", priceMinor: 2600 },
      { name: "Blue Dream 3.5g", brand: "Acme", priceMinor: 2400 }, // cheaper duplicate wins
    ];
    const out = buildPoCockpit(
      [stat(), stat({ license_number: "222222" })],
      [roster(), roster({ license_number: "222222", tradename: "Bay Buds" })],
      [
        sig({ p25_unit_price_minor: 2200 }),
        sig({ license_number: "222222", p25_unit_price_minor: 2000 }),
      ],
      menu,
    );
    expect(out.buyList).toHaveLength(0);
    expect(out.undercuts).toHaveLength(1);
    const row = out.undercuts[0];
    expect(row.ourPriceMinor).toBe(2400);
    expect(row.theirP25Minor).toBe(2000);
    expect(row.deltaMinor).toBe(400);
    expect(row.storeCount).toBe(2);
  });

  it("emits nothing when our menu price or their p25 is unknown — never a guess", () => {
    // Menu item carried but unpriced (0 → unusable).
    const noOurPrice = buildPoCockpit(
      [stat()],
      [roster()],
      [sig()],
      [{ name: "Blue Dream 3.5g", brand: "Acme", priceMinor: 0 }],
    );
    expect(noOurPrice.undercuts).toHaveLength(0);
    expect(noOurPrice.buyList).toHaveLength(0); // carried — not a buy need either

    // Their p25 missing.
    const noTheirs = buildPoCockpit(
      [stat()],
      [roster()],
      [sig({ p25_unit_price_minor: null })],
      [{ name: "Blue Dream 3.5g", brand: "Acme", priceMinor: 2400 }],
    );
    expect(noTheirs.undercuts).toHaveLength(0);
  });

  it("sorts above-beat first (largest delta), then revenue; honors the cap", () => {
    const menu: CockpitMenuItemLike[] = [
      { name: "Way Over", brand: null, priceMinor: 3000 },
      { name: "Slightly Over", brand: null, priceMinor: 2100 },
      { name: "Under", brand: null, priceMinor: 1500 },
    ];
    const signals = [
      sig({ product_name: "Way Over", p25_unit_price_minor: 2000 }), // +1000
      sig({ product_name: "Slightly Over", p25_unit_price_minor: 2000 }), // +100
      sig({ product_name: "Under", p25_unit_price_minor: 2000 }), // -500
    ];
    const out = buildPoCockpit([stat()], [roster()], signals, menu);
    expect(out.undercuts.map((r) => r.productName)).toEqual(["Way Over", "Slightly Over", "Under"]);

    const capped = buildPoCockpit([stat()], [roster()], signals, menu, { maxUndercutRows: 1 });
    expect(capped.undercuts).toHaveLength(1);
    expect(capped.undercuts[0].productName).toBe("Way Over");
    expect(MAX_UNDERCUT_ROWS).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// Menu accounting + demand-signal copy
// ---------------------------------------------------------------------------

describe("buildPoCockpit — menu accounting", () => {
  it("counts only nameable menu items", () => {
    const out = buildPoCockpit(
      [],
      [],
      [],
      [
        { name: "Real Item", brand: null, priceMinor: 100 },
        { name: "   ", brand: "Ghost", priceMinor: 100 },
      ],
    );
    expect(out.menuItemCount).toBe(1);
    expect(out.board).toEqual([]);
    expect(out.buyList).toEqual([]);
    expect(out.undercuts).toEqual([]);
  });
});

describe("buildBuyRowDemandSignal", () => {
  it("writes a grounded this-drop-only signal with price to beat", () => {
    const s = buildBuyRowDemandSignal({
      stores: ["Bay Buds", "PO Pot Shop"],
      totalUnits: 160,
      totalRevenueMinor: 650_000,
      priceToBeatMinor: 1900,
      areaLabel: "Port Orchard",
    });
    expect(s).toBe(
      "Port Orchard CCRS: 2 stores (Bay Buds, PO Pot Shop) · 160 units · $6500.00 revenue this drop · price to beat $19.00",
    );
  });

  it("omits the beat price when unknown and singularizes one store", () => {
    const s = buildBuyRowDemandSignal({
      stores: ["PO Pot Shop"],
      totalUnits: 10.4,
      totalRevenueMinor: 12_345,
      priceToBeatMinor: null,
      areaLabel: "Port Orchard",
    });
    expect(s).toBe("Port Orchard CCRS: 1 store (PO Pot Shop) · 10 units · $123.45 revenue this drop");
  });
});
