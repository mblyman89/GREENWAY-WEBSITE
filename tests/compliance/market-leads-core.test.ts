/**
 * tests/compliance/market-leads-core.test.ts — Task H S4.
 *
 * Covers the PURE market-mover lead logic feeding the Leads page and the AI
 * leads advisor: signal → lead mapping, roster name resolution, deterministic
 * ordering, caps, junk coercion (never guess: bad numbers → 0/null, never a
 * fabricated price), and the AI digest formatting (p25 = undercut band).
 */
import { describe, it, expect } from "vitest";
import {
  buildMarketMoverLeads,
  buildSupplierLeads,
  formatMoverDigestLine,
  formatMarketMoversDigest,
  formatSupplierDigestLine,
  formatSupplierLeadsDigest,
  DEFAULT_STATEWIDE_MOVERS,
  DEFAULT_COMPETITOR_MOVERS,
  DEFAULT_SUPPLIER_LEADS,
  type MarketSignalLike,
  type MarketMoverLead,
  type CompetitorSupplierStatLike,
} from "@/lib/discovery/market-leads-core";

function sig(overrides: Partial<MarketSignalLike> = {}): MarketSignalLike {
  return {
    kind: "statewide_mover",
    license_number: null,
    inventory_type: "Usable Marijuana",
    product_name: "Blue Dream 3.5g",
    brand: "Acme",
    strain_name: "Blue Dream",
    units: 100,
    revenue_minor: 250_000,
    median_unit_price_minor: 2500,
    p25_unit_price_minor: 2200,
    ...overrides,
  };
}

const ROSTER = [
  { license_number: "111111", tradename: "Clear Choice Tacoma" },
  { license_number: "413541", tradename: "Greenway Marijuana" },
];

describe("buildMarketMoverLeads", () => {
  it("maps signals to lead rows and splits by kind", () => {
    const out = buildMarketMoverLeads(
      [
        sig(),
        sig({ kind: "competitor_mover", license_number: "111111", product_name: "OG Kush 1g" }),
      ],
      ROSTER,
    );
    expect(out.statewide).toHaveLength(1);
    expect(out.competitor).toHaveLength(1);
    const sw = out.statewide[0];
    expect(sw.productName).toBe("Blue Dream 3.5g");
    expect(sw.brand).toBe("Acme");
    expect(sw.strainName).toBe("Blue Dream");
    expect(sw.inventoryType).toBe("Usable Marijuana");
    expect(sw.units).toBe(100);
    expect(sw.revenueMinor).toBe(250_000);
    expect(sw.medianUnitPriceMinor).toBe(2500);
    expect(sw.undercutTargetMinor).toBe(2200);
    expect(sw.competitorName).toBeNull();
  });

  it("resolves competitor names from the roster and falls back to 'lic <n>'", () => {
    const out = buildMarketMoverLeads(
      [
        sig({ kind: "competitor_mover", license_number: "111111" }),
        sig({ kind: "competitor_mover", license_number: "999999", product_name: "Mystery Gummies" }),
      ],
      ROSTER,
    );
    const byLic = new Map(out.competitor.map((l) => [l.licenseNumber, l]));
    expect(byLic.get("111111")?.competitorName).toBe("Clear Choice Tacoma");
    expect(byLic.get("999999")?.competitorName).toBe("lic 999999");
  });

  it("drops signals without a product name (not actionable) and unknown kinds", () => {
    const out = buildMarketMoverLeads(
      [
        sig({ product_name: null }),
        sig({ product_name: "   " }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sig({ kind: "bogus" as any }),
        sig({ product_name: "Keeper" }),
      ],
      [],
    );
    expect(out.statewide).toHaveLength(1);
    expect(out.statewide[0].productName).toBe("Keeper");
  });

  it("never fabricates prices: null/negative/NaN price bands become null", () => {
    const out = buildMarketMoverLeads(
      [
        sig({
          median_unit_price_minor: null,
          p25_unit_price_minor: -5,
          units: Number.NaN,
          revenue_minor: -100,
        }),
      ],
      [],
    );
    const l = out.statewide[0];
    expect(l.medianUnitPriceMinor).toBeNull();
    expect(l.undercutTargetMinor).toBeNull();
    expect(l.units).toBe(0);
    expect(l.revenueMinor).toBe(0);
  });

  it("sorts by revenue desc, then units desc, then product name asc", () => {
    const out = buildMarketMoverLeads(
      [
        sig({ product_name: "B", revenue_minor: 100, units: 5 }),
        sig({ product_name: "A", revenue_minor: 100, units: 5 }),
        sig({ product_name: "C", revenue_minor: 100, units: 9 }),
        sig({ product_name: "D", revenue_minor: 900, units: 1 }),
      ],
      [],
    );
    expect(out.statewide.map((l) => l.productName)).toEqual(["D", "C", "A", "B"]);
  });

  it("caps each list (defaults 12 statewide / 15 competitor, override works)", () => {
    const many: MarketSignalLike[] = [];
    for (let i = 0; i < 40; i++) {
      many.push(sig({ product_name: `SW ${i}`, revenue_minor: 1000 + i }));
      many.push(
        sig({
          kind: "competitor_mover",
          license_number: "111111",
          product_name: `CM ${i}`,
          revenue_minor: 1000 + i,
        }),
      );
    }
    const dflt = buildMarketMoverLeads(many, ROSTER);
    expect(dflt.statewide).toHaveLength(DEFAULT_STATEWIDE_MOVERS);
    expect(dflt.competitor).toHaveLength(DEFAULT_COMPETITOR_MOVERS);
    // Caps keep the TOP rows (highest revenue first).
    expect(dflt.statewide[0].productName).toBe("SW 39");

    const custom = buildMarketMoverLeads(many, ROSTER, { maxStatewide: 3, maxCompetitor: 2 });
    expect(custom.statewide).toHaveLength(3);
    expect(custom.competitor).toHaveLength(2);
  });
});

describe("formatMoverDigestLine", () => {
  const lead: MarketMoverLead = {
    kind: "competitor_mover",
    competitorName: "Clear Choice Tacoma",
    licenseNumber: "111111",
    productName: "OG Kush 1g",
    brand: "Acme",
    strainName: "OG Kush",
    inventoryType: "Usable Marijuana",
    units: 42,
    revenueMinor: 123_456,
    medianUnitPriceMinor: 2999,
    undercutTargetMinor: 2500,
  };

  it("renders real dollars from minor units and names the undercut band", () => {
    const line = formatMoverDigestLine(lead);
    expect(line).toContain('store="Clear Choice Tacoma"');
    expect(line).toContain('product="OG Kush 1g"');
    expect(line).toContain("revenue=$1234.56");
    expect(line).toContain("median_price=$29.99");
    expect(line).toContain("undercut_at_or_below=$25.00");
  });

  it("shows n/a instead of inventing a price", () => {
    const line = formatMoverDigestLine({
      ...lead,
      medianUnitPriceMinor: null,
      undercutTargetMinor: null,
    });
    expect(line).toContain("median_price=n/a");
    expect(line).toContain("undercut_at_or_below=n/a");
  });
});

describe("formatMarketMoversDigest", () => {
  it("returns null when there are no movers", () => {
    expect(formatMarketMoversDigest({ statewide: [], competitor: [] })).toBeNull();
  });

  it("emits both blocks with the p25 framing", () => {
    const movers = buildMarketMoverLeads(
      [sig(), sig({ kind: "competitor_mover", license_number: "111111", product_name: "OG Kush 1g" })],
      ROSTER,
    );
    const digest = formatMarketMoversDigest(movers);
    expect(digest).toBeTruthy();
    expect(digest).toContain("STATEWIDE TOP MOVERS");
    expect(digest).toContain("COMPETITOR TOP MOVERS");
    expect(digest).toContain("25th-percentile");
    expect(digest).toContain('store="Clear Choice Tacoma"');
  });
});

// ---------------------------------------------------------------------------
// S7 — buildSupplierLeads + supplier digest
// ---------------------------------------------------------------------------

function supplierStat(
  overrides: Partial<CompetitorSupplierStatLike> = {},
): CompetitorSupplierStatLike {
  return {
    license_number: "111111",
    name: "CLEAR CHOICE LLC",
    dba: "CLEAR CHOICE",
    top_suppliers: [],
    ...overrides,
  };
}

function supplier(
  licenseeId: string,
  spendMinor: number,
  lineCount = 1,
  overrides: Partial<CompetitorSupplierStatLike["top_suppliers"][number]> = {},
) {
  return {
    licenseeId,
    licenseNumber: `7${licenseeId}`,
    name: `SUPPLIER ${licenseeId} LLC`,
    dba: null,
    lineCount,
    spendMinor,
    ...overrides,
  };
}

describe("buildSupplierLeads (S7)", () => {
  it("ranks multi-competitor suppliers first and flags them as priority", () => {
    const stats = [
      supplierStat({
        license_number: "111111",
        top_suppliers: [supplier("901", 50_000), supplier("902", 90_000)],
      }),
      supplierStat({
        license_number: "222222",
        top_suppliers: [supplier("901", 30_000)],
      }),
    ];
    const roster = [
      { license_number: "111111", tradename: "Clear Choice Tacoma" },
      { license_number: "222222", tradename: "Pot Zone" },
    ];
    const leads = buildSupplierLeads(stats, roster);
    expect(leads).toHaveLength(2);
    // 901 supplies BOTH competitors → first despite lower total spend.
    expect(leads[0].licenseeId).toBe("901");
    expect(leads[0].buyerCount).toBe(2);
    expect(leads[0].suppliesMultipleCompetitors).toBe(true);
    expect(leads[0].totalSpendMinor).toBe(80_000);
    expect(leads[0].totalLineCount).toBe(2);
    // Buyer names spend-desc: Clear Choice ($500) before Pot Zone ($300).
    expect(leads[0].buyerNames).toEqual(["Clear Choice Tacoma", "Pot Zone"]);
    expect(leads[1].licenseeId).toBe("902");
    expect(leads[1].buyerCount).toBe(1);
    expect(leads[1].suppliesMultipleCompetitors).toBe(false);
  });

  it("resolves display name dba → name → licensee id (never invents)", () => {
    const stats = [
      supplierStat({
        top_suppliers: [
          supplier("901", 100, 1, { dba: "B FARMS", name: "B LLC" }),
          supplier("902", 90, 1, { dba: null, name: "C LLC" }),
          supplier("903", 80, 1, { dba: null, name: null, licenseNumber: null }),
        ],
      }),
    ];
    const leads = buildSupplierLeads(stats, []);
    expect(leads.map((l) => l.displayName)).toEqual(["B FARMS", "C LLC", "Licensee 903"]);
    expect(leads[2].licenseNumber).toBeNull();
  });

  it("falls back to the stat row's dba/name for buyer names when off-roster", () => {
    const stats = [
      supplierStat({
        license_number: "333333",
        dba: null,
        name: "MYSTERY STORE LLC",
        top_suppliers: [supplier("901", 100)],
      }),
    ];
    const leads = buildSupplierLeads(stats, []);
    expect(leads[0].buyerNames).toEqual(["MYSTERY STORE LLC"]);
  });

  it("coerces junk numbers to zero and skips suppliers without a licensee id", () => {
    const stats = [
      supplierStat({
        top_suppliers: [
          supplier("901", Number.NaN as unknown as number, -5 as unknown as number),
          { ...supplier("", 100), licenseeId: "" },
        ],
      }),
    ];
    const leads = buildSupplierLeads(stats, []);
    expect(leads).toHaveLength(1);
    expect(leads[0].totalSpendMinor).toBe(0);
    expect(leads[0].totalLineCount).toBe(0);
  });

  it("caps output at the default and honors an explicit max", () => {
    const stats = [
      supplierStat({
        top_suppliers: Array.from({ length: 10 }, (_, i) => supplier(String(900 + i), 1000 - i)),
      }),
      supplierStat({
        license_number: "222222",
        top_suppliers: Array.from({ length: 10 }, (_, i) => supplier(String(950 + i), 500 - i)),
      }),
    ];
    expect(buildSupplierLeads(stats, [])).toHaveLength(DEFAULT_SUPPLIER_LEADS);
    expect(buildSupplierLeads(stats, [], { max: 3 })).toHaveLength(3);
    expect(buildSupplierLeads(stats, [], { max: 0 })).toHaveLength(0);
  });

  it("handles missing/empty top_suppliers arrays gracefully", () => {
    const stats = [
      supplierStat({ top_suppliers: [] }),
      supplierStat({
        license_number: "222222",
        top_suppliers: undefined as unknown as CompetitorSupplierStatLike["top_suppliers"],
      }),
    ];
    expect(buildSupplierLeads(stats, [])).toEqual([]);
  });
});

describe("supplier digest (S7)", () => {
  const stats = [
    supplierStat({
      license_number: "111111",
      top_suppliers: [supplier("901", 50_000, 12)],
    }),
    supplierStat({
      license_number: "222222",
      top_suppliers: [supplier("901", 30_000, 5)],
    }),
  ];
  const roster = [
    { license_number: "111111", tradename: "Clear Choice Tacoma" },
    { license_number: "222222", tradename: "Pot Zone" },
  ];

  it("marks multi-competitor suppliers as PRIORITY in the line format", () => {
    const [lead] = buildSupplierLeads(stats, roster);
    const line = formatSupplierDigestLine(lead);
    expect(line).toContain('supplier="SUPPLIER 901 LLC"');
    expect(line).toContain("supplies_competitors=2");
    expect(line).toContain('buyers="Clear Choice Tacoma; Pot Zone"');
    expect(line).toContain("observed_spend=$800.00");
    expect(line).toContain("PRIORITY=multi-competitor-supplier");
  });

  it("omits the PRIORITY marker for single-competitor suppliers", () => {
    const single = buildSupplierLeads([stats[0]], roster);
    const line = formatSupplierDigestLine(single[0]);
    expect(line).not.toContain("PRIORITY=");
  });

  it("returns null for an empty list, and frames the block honestly", () => {
    expect(formatSupplierLeadsDigest([])).toBeNull();
    const digest = formatSupplierLeadsDigest(buildSupplierLeads(stats, roster));
    expect(digest).toBeTruthy();
    expect(digest).toContain("COMPETITOR SUPPLIERS");
    expect(digest).toContain("this drop only");
    expect(digest).toContain("PRIORITY vendor leads");
  });
});
