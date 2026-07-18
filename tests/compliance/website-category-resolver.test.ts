/**
 * tests/compliance/website-category-resolver.test.ts
 *
 * H16b-9 LCB CATEGORY MAP. Locks the LCB/CCRS inventory-type → OUR website
 * category resolver so nothing arrives "UNMAPPED". Grounded in the authoritative
 * CCRS Upload User Guide (2-26, Feb 2026) Table 2 "Valid InventoryCategory and
 * InventoryType values" plus the real-world types our manifest parsers observe
 * (pdf-transferlog-core INV_TYPES, incl. legacy "Marijuana" naming).
 *
 * Owner-confirmed mappings (verbatim, H16b-9):
 *   A) "Mix Infused" is MULTI-category → read the product NAME:
 *        pack → infused-preroll-pack; preroll/blunt → infused-preroll;
 *        moonrock/caviar/jar/flower/bud → infused-flower; ambiguous → infused-flower.
 *   B) "Mix Packaged" (non-infused) → trim.
 *   C) Suppository / Transdermal → topical.
 *   D) "Cannabis Mix" (intermediate trim mix) → trim.
 *   E) "Sample Jar" → resolve by underlying product FORM (flower/concentrate/…);
 *        smell/sniff jar is a distinct sub-type tracked as flower.
 */
import { describe, it, expect } from "vitest";
import {
  resolveWebsiteCategory,
  readMixInfusedByName,
  readSampleJarByName,
  readFormByName,
  readUsableMarijuanaByName,
  isMultiCategoryLcbType,
  __runWebsiteCategoryResolverTests,
} from "@/lib/inventory/website-category-resolver";

const cat = (inventoryType: string, productName: string) =>
  resolveWebsiteCategory({ inventoryType, productName }).websiteCategory;

describe("H16b-9 website-category-resolver", () => {
  it("passes the embedded self-test suite", () => {
    expect(() => __runWebsiteCategoryResolverTests()).not.toThrow();
  });

  it("A) Mix Infused resolves by product name (modern + legacy naming)", () => {
    expect(cat("Cannabis Mix Infused", "Infused Preroll 1g")).toBe("infused-preroll");
    expect(cat("Cannabis Mix Infused", "Infused Blunt 1.5g")).toBe("infused-preroll");
    expect(cat("Cannabis Mix Infused", "Infused Preroll 5-Pack")).toBe("infused-preroll-pack");
    expect(cat("Cannabis Mix Infused", "Infused 3pk Joints")).toBe("infused-preroll-pack");
    expect(cat("Cannabis Mix Infused", "Moon Rocks Jar 1g")).toBe("infused-flower");
    expect(cat("Cannabis Mix Infused", "Infused Flower Jar 7g")).toBe("infused-flower");
    // ambiguous infused product → infused-flower default
    expect(cat("Cannabis Mix Infused", "Special Reserve 1g")).toBe("infused-flower");
    // legacy "Marijuana" naming
    expect(cat("Marijuana Mix Infused", "Infused Blunt")).toBe("infused-preroll");
    expect(cat("Marijuana Mix Infused", "5pk Infused Prerolls")).toBe("infused-preroll-pack");
    expect(cat("Marijuana Mix Infused", "Moon Rocks 1g")).toBe("infused-flower");
  });

  it("A) name-reader: pack beats single preroll; empty → infused-flower", () => {
    expect(readMixInfusedByName("Infused Preroll 5 Pack")).toBe("infused-preroll-pack");
    expect(readMixInfusedByName("2-pack blunts")).toBe("infused-preroll-pack");
    expect(readMixInfusedByName("Joint")).toBe("infused-preroll");
    expect(readMixInfusedByName("")).toBe("infused-flower");
  });

  it("B) Mix Packaged (non-infused) → trim, not flower", () => {
    expect(cat("Cannabis Mix Packaged", "Mixed Flower Bag 14g")).toBe("trim");
    expect(cat("Marijuana Mix Packaged", "Shake 28g")).toBe("trim");
  });

  it("C) Suppository / Transdermal / Topical Ointment → topical", () => {
    expect(cat("Suppository", "Suppository 50mg")).toBe("topical");
    expect(cat("Transdermal", "Patch 20mg")).toBe("topical");
    expect(cat("Topical Ointment", "Balm")).toBe("topical");
  });

  it("D) Cannabis Mix (intermediate trim mix) → trim", () => {
    expect(cat("Cannabis Mix", "Trim Mix")).toBe("trim");
  });

  it("E) Sample Jar resolves by product form; smell/sniff jar tracked as flower", () => {
    expect(cat("Sample Jar", "Blue Dream 3.5g")).toBe("flower");
    expect(cat("Sample Jar", "Live Resin 1g")).toBe("concentrate");
    expect(cat("Sample Jar", "Gummies 100mg")).toBe("edible-solid");

    const smell = readSampleJarByName("Blue Dream Smell Jar");
    expect(smell.smellJar).toBe(true);
    expect(smell.formCategory).toBe("flower");

    const sniff = readSampleJarByName("Sniff Jar - Gelato");
    expect(sniff.smellJar).toBe(true);
    expect(sniff.formCategory).toBe("flower");

    const notSmell = readSampleJarByName("Live Resin 1g");
    expect(notSmell.smellJar).toBe(false);
    expect(notSmell.formCategory).toBe("concentrate");

    expect(readSampleJarByName("").formCategory).toBe("flower");
  });

  it("readFormByName reads product form from name (plurals included)", () => {
    expect(readFormByName("Gummies 100mg")).toBe("edible-solid");
    expect(readFormByName("Cartridges 1g")).toBe("cartridge");
    expect(readFormByName("Live Rosin 1g")).toBe("concentrate");
    expect(readFormByName("THC Soda")).toBe("edible-liquid");
    expect(readFormByName("Blue Dream 3.5g")).toBe("flower");
    expect(readFormByName("")).toBeNull();
  });

  it("existing coarse LCB types still resolve (no regression)", () => {
    expect(cat("Usable Cannabis", "Blue Dream 3.5g")).toBe("flower");
    expect(cat("Usable Marijuana", "Gelato 3.5g")).toBe("flower");
    expect(cat("Concentrate for Inhalation", "Live Resin 1g")).toBe("concentrate");
    expect(cat("Extract For Inhalation", "Shatter 1g")).toBe("concentrate");
    expect(cat("Solid Marijuana Infused Edible", "Chocolate 100mg")).toBe("edible-solid");
    expect(cat("Liquid Marijuana Infused Edible", "Punch 100mg")).toBe("edible-liquid");
    expect(cat("Capsule", "Capsules 10ct")).toBe("edible-solid");
    expect(cat("Tincture", "Tincture 300mg")).toBe("edible-liquid");
  });

  it("no real-world LCB/CCRS type falls to UNMAPPED", () => {
    const realWorld: Array<[string, string]> = [
      ["Usable Cannabis", "Blue Dream 3.5g"],
      ["Cannabis Mix Infused", "Infused Preroll 1g"],
      ["Cannabis Mix Packaged", "Mixed Flower Bag 14g"],
      ["Capsule", "Capsules 10ct"],
      ["CO2 Concentrate", "CO2 Oil"],
      ["Concentrate for Inhalation", "Live Resin 1g"],
      ["Ethanol Concentrate", "Distillate 1g"],
      ["Hydrocarbon Concentrate", "BHO Badder 1g"],
      ["Liquid Edible", "THC Soda 100mg"],
      ["Non-Solvent Based Concentrate", "Bubble Hash 1g"],
      ["Sample Jar", "Smell Jar Blue Dream"],
      ["Solid Edible", "Gummies 100mg"],
      ["Suppository", "Suppository 50mg"],
      ["Tincture", "MCT Tincture 300mg"],
      ["Topical Ointment", "Relief Balm 2oz"],
      ["Transdermal", "Transdermal Patch 20mg"],
      ["Cannabis Mix", "Trim Mix"],
      ["Usable Marijuana", "Gelato 3.5g"],
      ["Marijuana Mix Infused", "Infused Blunt 1.5g"],
      ["Marijuana Mix Packaged", "Shake Bag 14g"],
      ["Solid Marijuana Infused Edible", "Chocolate Bar 100mg"],
      ["Liquid Marijuana Infused Edible", "Fruit Punch 100mg"],
      ["Extract For Inhalation", "Shatter 1g"],
      ["Concentrate For Inhalation", "Sugar 1g"],
    ];
    for (const [type, name] of realWorld) {
      const r = resolveWebsiteCategory({ inventoryType: type, productName: name });
      expect(r.unmapped, `${type} / ${name} should be mapped`).toBe(false);
      expect(r.websiteCategory, `${type} / ${name} should have a category`).not.toBeNull();
    }
  });

  it("H17: 'Usable Marijuana' is multi-category — read the product NAME", () => {
    // Names are VERBATIM from the owner's real SPR manifest (ORD-24706): every
    // one of these arrived as inventory_type "Usable Marijuana" and the flat
    // mapping wrongly flattened joints/blunts/packs to flower.
    const usable = (name: string) =>
      resolveWebsiteCategory({ inventoryType: "Usable Marijuana", productName: name });

    expect(usable("SPR - Sour Diesel - 3.5g").websiteCategory).toBe("flower");
    expect(usable("SPR - Variety Pack - 5pk Joint Tin (5g) #1").websiteCategory).toBe("preroll-pack");
    expect(usable("House Joint 1g").websiteCategory).toBe("preroll");
    expect(usable("Classic Blunt 1.5g").websiteCategory).toBe("preroll");
    expect(usable("Gelato Pre-Roll 0.5g").websiteCategory).toBe("preroll");
    expect(usable("Popcorn Buds 7g").websiteCategory).toBe("popcorn-bud");
    expect(usable("Moon Rocks 3.5g").websiteCategory).toBe("infused-flower");
    // A numbered pack WITHOUT a preroll word stays flower (pack of jars).
    expect(usable("Fruity 2 Pack Jars 7g").websiteCategory).toBe("flower");
    // Modern CCRS naming reads the same way.
    expect(
      resolveWebsiteCategory({ inventoryType: "Usable Cannabis", productName: "5pk Joints Tin" })
        .websiteCategory,
    ).toBe("preroll-pack");
    // Precedence (a) menu_items still wins over the multi-category bypass.
    expect(
      resolveWebsiteCategory(
        { inventoryType: "Usable Marijuana", productName: "5pk Joint Tin" },
        { menuItemCategory: "preroll-pack" },
      ).source,
    ).toBe("menu_item");
  });

  it("H17: readUsableMarijuanaByName direct reads", () => {
    expect(readUsableMarijuanaByName("SPR - Variety Pack - 5pk Joint Tin (5g) #1")).toBe("preroll-pack");
    expect(readUsableMarijuanaByName("House Joint 1g")).toBe("preroll");
    expect(readUsableMarijuanaByName("Classic Blunt 1.5g")).toBe("preroll");
    expect(readUsableMarijuanaByName("Moon Rocks 3.5g")).toBe("infused-flower");
    expect(readUsableMarijuanaByName("Popcorn Buds 7g")).toBe("popcorn-bud");
    expect(readUsableMarijuanaByName("SPR - Sour Diesel - 3.5g")).toBe("flower");
    expect(readUsableMarijuanaByName(null)).toBe("flower");
  });

  it("H17: isMultiCategoryLcbType flags the right raw types", () => {
    expect(isMultiCategoryLcbType("Usable Marijuana")).toBe(true);
    expect(isMultiCategoryLcbType("Usable Cannabis")).toBe(true);
    expect(isMultiCategoryLcbType("Marijuana Mix Infused")).toBe(true);
    expect(isMultiCategoryLcbType("Cannabis Mix Infused")).toBe(true);
    expect(isMultiCategoryLcbType("Sample Jar")).toBe(true);
    expect(isMultiCategoryLcbType("Flower Lot")).toBe(true);
    // Single-category types keep using the flat inventory_types mapping.
    expect(isMultiCategoryLcbType("Marijuana Mix Packaged")).toBe(false);
    expect(isMultiCategoryLcbType("Solid Marijuana Infused Edible")).toBe(false);
    expect(isMultiCategoryLcbType("Extract For Inhalation")).toBe(false);
    expect(isMultiCategoryLcbType(null)).toBe(false);
  });
});
