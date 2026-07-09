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
});
