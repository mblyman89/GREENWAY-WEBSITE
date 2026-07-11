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
  formatMoverDigestLine,
  formatMarketMoversDigest,
  DEFAULT_STATEWIDE_MOVERS,
  DEFAULT_COMPETITOR_MOVERS,
  type MarketSignalLike,
  type MarketMoverLead,
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
