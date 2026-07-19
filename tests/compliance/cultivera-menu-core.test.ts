/**
 * tests/compliance/cultivera-menu-core.test.ts
 *
 * CV-1: mirror of the pure cultivera-menu-core self-tests, plus a few extra
 * edge cases vitest is good at expressing.
 *
 * NEVER GUESS contract under test:
 *  - Money is INTEGER minor units (cents), rounded half-up; floats never leak.
 *  - Percentages are NOT rescaled (0.5 stays 0.5 — Cultivera reports percents).
 *  - Normalizers are tolerant of field-name drift and junk input (nulls, never
 *    throws), because the exact Cultivera shape is pinned later (CV-2/CV-3).
 */
import { describe, expect, it } from "vitest";

import {
  __runCultiveraMenuCoreTests,
  asText,
  intOrNull,
  numOrNull,
  moneyToMinor,
  formatMinor,
  pctToNumber,
  normalizeStrainType,
  packCountFromLabel,
  normalizeMenuItem,
  normalizeSnapshot,
  parseVariantName,
  sizeLabelFromGrams,
  normalizeVariant,
  normalizeProductDetail,
  detailFromItemRaw,
  ITEM_DETAIL_RAW_KEY,
} from "@/lib/purchasing/cultivera-menu-core";

describe("cultivera-menu-core embedded self-tests", () => {
  it("passes the embedded pure self-tests", () => {
    expect(() => __runCultiveraMenuCoreTests()).not.toThrow();
  });
});

describe("primitive coercers", () => {
  it("asText trims and nulls empties", () => {
    expect(asText("  x ")).toBe("x");
    expect(asText("")).toBeNull();
    expect(asText(null)).toBeNull();
    expect(asText(7)).toBe("7");
  });

  it("numOrNull strips currency/percent/commas junk", () => {
    expect(numOrNull("$1,999.50")).toBe(1999.5);
    expect(numOrNull("22.5%")).toBe(22.5);
    expect(numOrNull("free")).toBeNull();
  });

  it("intOrNull truncates toward zero", () => {
    expect(intOrNull("2.9")).toBe(2);
    expect(intOrNull("10pk")).toBe(10);
    expect(intOrNull("")).toBeNull();
  });
});

describe("moneyToMinor (cents, never floats)", () => {
  it("dollars number -> cents", () => {
    expect(moneyToMinor(12.5)).toBe(1250);
  });
  it("dollar string -> cents", () => {
    expect(moneyToMinor("$12.50")).toBe(1250);
  });
  it("rounds half up", () => {
    expect(moneyToMinor("12.505")).toBe(1251);
    expect(moneyToMinor(0.005)).toBe(1);
  });
  it("object with minor units is taken as-is", () => {
    expect(moneyToMinor({ minor: 1250 })).toBe(1250);
    expect(moneyToMinor({ cents: 999 })).toBe(999);
  });
  it("object with dollar amount is scaled", () => {
    expect(moneyToMinor({ amount: 12.5 })).toBe(1250);
  });
  it("junk/empty -> null", () => {
    expect(moneyToMinor(null)).toBeNull();
    expect(moneyToMinor("free")).toBeNull();
    expect(moneyToMinor({})).toBeNull();
  });
});

describe("formatMinor", () => {
  it("formats and pads", () => {
    expect(formatMinor(1250)).toBe("$12.50");
    expect(formatMinor(5)).toBe("$0.05");
    expect(formatMinor(0)).toBe("$0.00");
  });
  it("negative + null", () => {
    expect(formatMinor(-1250)).toBe("-$12.50");
    expect(formatMinor(null)).toBe("");
  });
});

describe("pctToNumber does NOT rescale", () => {
  it("keeps percent numbers", () => {
    expect(pctToNumber("22.5%")).toBe(22.5);
    expect(pctToNumber(0.5)).toBe(0.5);
    expect(pctToNumber("n/a")).toBeNull();
  });
});

describe("normalizeStrainType", () => {
  it("buckets known strains", () => {
    expect(normalizeStrainType("Sativa-dominant")).toBe("sativa");
    expect(normalizeStrainType("Indica")).toBe("indica");
    expect(normalizeStrainType("Hybrid")).toBe("hybrid");
    expect(normalizeStrainType("High CBD")).toBe("cbd");
    expect(normalizeStrainType("mystery")).toBe("unknown");
    expect(normalizeStrainType(null)).toBe("unknown");
  });
});

describe("packCountFromLabel", () => {
  it("reads counts", () => {
    expect(packCountFromLabel("10pk")).toBe(10);
    expect(packCountFromLabel("5 pack")).toBe(5);
    expect(packCountFromLabel("2-count")).toBe(2);
    expect(packCountFromLabel("2 x 1g")).toBe(2);
  });
  it("no count -> null", () => {
    expect(packCountFromLabel("3.5g")).toBeNull();
    expect(packCountFromLabel("")).toBeNull();
  });
});

describe("normalizeMenuItem", () => {
  it("normalizes tolerant field spellings, cents, nested potency", () => {
    const item = normalizeMenuItem(
      {
        listing_id: "L-9",
        title: "Blue Dream",
        producer: "Acme",
        product_type: "Flower",
        classification: "Sativa",
        packageSize: "3.5g 10pk",
        unitPrice: "$14.99",
        qty: "42",
        cannabinoids: { thc: "22.5%", cbd: "0.3%", totalActive: "24.1%" },
        longDescription: "  fresh  ",
        thumbnailUrl: "https://x/i.jpg",
        labResultUrl: "https://x/c.pdf",
      },
      2,
    );
    expect(item.cultiveraItemId).toBe("L-9");
    expect(item.name).toBe("Blue Dream");
    expect(item.brand).toBe("Acme");
    expect(item.category).toBe("Flower");
    expect(item.strainType).toBe("sativa");
    expect(item.wholesalePriceMinor).toBe(1499);
    expect(item.availableQty).toBe(42);
    expect(item.unitCount).toBe(10);
    expect(item.thcPct).toBe(22.5);
    expect(item.cbdPct).toBe(0.3);
    expect(item.totalCannabinoidsPct).toBe(24.1);
    expect(item.description).toBe("fresh");
    expect(item.imageUrl).toBe("https://x/i.jpg");
    expect(item.coaUrl).toBe("https://x/c.pdf");
    expect(item.position).toBe(2);
  });

  it("stays safe on null/junk", () => {
    const empty = normalizeMenuItem(undefined, 0);
    expect(empty.name).toBeNull();
    expect(empty.wholesalePriceMinor).toBeNull();
    expect(empty.strainType).toBe("unknown");
    expect(empty.potencyRaw).toEqual({});
    expect(empty.raw).toEqual({});
  });
});

describe("normalizeSnapshot", () => {
  it("reads an envelope with a listings key", () => {
    const snap = normalizeSnapshot({
      marketId: "M-9",
      slug: "acme-farms",
      sellerName: "Acme Farms",
      locationId: "LOC-1",
      listings: [
        { name: "A", price: 10 },
        { name: "B", price: 20 },
      ],
    });
    expect(snap.cultiveraMarketId).toBe("M-9");
    expect(snap.cultiveraMarketSlug).toBe("acme-farms");
    expect(snap.sellerName).toBe("Acme Farms");
    expect(snap.locationId).toBe("LOC-1");
    expect(snap.itemCount).toBe(2);
    expect(snap.items[0].wholesalePriceMinor).toBe(1000);
    expect(snap.items[1].position).toBe(1);
  });

  it("accepts a bare array of items", () => {
    const snap = normalizeSnapshot([{ name: "X", price: 5 }]);
    expect(snap.itemCount).toBe(1);
    expect(snap.items[0].wholesalePriceMinor).toBe(500);
    expect(snap.sellerName).toBeNull();
  });

  it("unwraps a nested envelope (data.items)", () => {
    const snap = normalizeSnapshot({ data: { items: [{ name: "Z" }] }, name: "Nested Co" });
    expect(snap.itemCount).toBe(1);
    expect(snap.items[0].name).toBe("Z");
    expect(snap.sellerName).toBe("Nested Co");
  });

  it("stays safe on null", () => {
    const snap = normalizeSnapshot(null);
    expect(snap.itemCount).toBe(0);
    expect(snap.items).toEqual([]);
  });
});

describe("CH-2 product-detail normalizers (pinned live shape)", () => {
  it("parses bracketed variant names", () => {
    const p = parseVariantName("Wedding Cake [3.5g] [Indica] [D.O.H. COMPLIANT]");
    expect(p.cleanName).toBe("Wedding Cake");
    expect(p.sizeLabel).toBe("3.5g");
    expect(p.strainType).toBe("indica");
    expect(p.dohTagged).toBe(true);
  });

  it("handles names without tags and empty names", () => {
    expect(parseVariantName("Plain")).toEqual({
      cleanName: "Plain",
      sizeLabel: null,
      strainType: "unknown",
      dohTagged: false,
    });
    expect(parseVariantName("").cleanName).toBeNull();
    expect(parseVariantName(null).cleanName).toBeNull();
  });

  it("derives size labels from grams", () => {
    expect(sizeLabelFromGrams(1.0)).toBe("1g");
    expect(sizeLabelFromGrams(3.5)).toBe("3.5g");
    expect(sizeLabelFromGrams(0)).toBeNull();
    expect(sizeLabelFromGrams("junk")).toBeNull();
  });

  it("normalizes a live-probed variant (dollars -> cents)", () => {
    const v = normalizeVariant(
      {
        Id: 447772,
        Name: "Luxor [1g] [Sativa] [D.O.H. COMPLIANT]",
        Description: "Gorilla Butter F2 (Vegas Cut) x Alien Apple Kush",
        UnitPrice: 4.5,
        AvailableQuantity: 20,
        UnitSize: 1.0,
        MaxOrderLimit: null,
        IsDOHComplaint: true,
        ImageUrl: "https://cdn1.s2solutions.com/x/ProductImages/LUXOR.jpg",
      },
      6,
    );
    expect(v.variantId).toBe("447772");
    expect(v.cleanName).toBe("Luxor");
    expect(v.strainType).toBe("sativa");
    expect(v.sizeLabel).toBe("1g");
    expect(v.unitPriceMinor).toBe(450);
    expect(v.availableQty).toBe(20);
    expect(v.maxOrderLimit).toBeNull();
    expect(v.isDohCompliant).toBe(true);
    expect(v.position).toBe(6);
  });

  it("falls back to UnitSize grams when the name has no size tag", () => {
    const v = normalizeVariant({ Name: "Loose Flower", UnitSize: 3.5, UnitPrice: 14 }, 0);
    expect(v.sizeLabel).toBe("3.5g");
    expect(v.unitPriceMinor).toBe(1400);
  });

  it("stays safe on junk variants", () => {
    const v = normalizeVariant(null, 0);
    expect(v.name).toBeNull();
    expect(v.unitPriceMinor).toBeNull();
    expect(v.strainType).toBe("unknown");
  });

  it("normalizes a whole detail payload", () => {
    const d = normalizeProductDetail({
      Id: 4462,
      Name: "Signature Flower Line",
      IsDOHComplaint: true,
      Products: [
        { Id: 1, Name: "A [1g] [Indica]", UnitPrice: 4.5, AvailableQuantity: 20 },
        { Id: 2, Name: "B [3.5g] [Sativa]", UnitPrice: 14, AvailableQuantity: 1471, MaxOrderLimit: 75 },
      ],
    });
    expect(d.productId).toBe("4462");
    expect(d.variantCount).toBe(2);
    expect(d.variants[0].unitPriceMinor).toBe(450);
    expect(d.variants[1].maxOrderLimit).toBe(75);
    expect(normalizeProductDetail(null).variantCount).toBe(0);
  });

  it("round-trips a stored detail through the reserved raw key", () => {
    const stored = detailFromItemRaw({
      Id: 4462,
      [ITEM_DETAIL_RAW_KEY]: { Id: 4462, Products: [{ Id: 9, Name: "C [1g] [Hybrid]", UnitPrice: 5 }] },
    });
    expect(stored).not.toBeNull();
    expect(stored?.variantCount).toBe(1);
    expect(stored?.variants[0].unitPriceMinor).toBe(500);
    expect(detailFromItemRaw({ Id: 1 })).toBeNull();
    expect(detailFromItemRaw(null)).toBeNull();
  });
});
