/**
 * tests/compliance/brand-core.test.ts
 *
 * Task I (I3) — extractBrand v2. Every fixture below mirrors a REAL naming
 * convention verified against 300k product names from the May-2026 CCRS
 * delivery (see docs/ROADMAP_BACKOFFICE_FIXES.md, Task I root cause #3):
 * junk weight/size/count/generic prefixes must no longer poison the brand
 * benchmark, the common "… by <brand>" convention must attribute correctly,
 * and real brands — including all-numeric '2727' — must keep working.
 */
import { describe, it, expect } from "vitest";

import { extractBrand, isJunkBrandCandidate } from "@/lib/discovery/brand-core";

describe("extractBrand v2 — separator prefix (v1 behavior preserved)", () => {
  it("extracts the prefix before ' - ' / ' | ' / ': ' separators", () => {
    expect(extractBrand("Fairwinds - Flow CBD Gel")).toBe("Fairwinds");
    expect(extractBrand("Phat Panda | Grape Ape 3.5g")).toBe("Phat Panda");
    expect(extractBrand("Dutchberry: Sativa Preroll")).toBe("Dutchberry");
    // Real May-2026 names:
    expect(extractBrand("Regulator Classic - Berry Gelato")).toBe("Regulator Classic");
    expect(extractBrand("Regulator Sugar Wax (2.0) - Permanent Marker")).toBe(
      "Regulator Sugar Wax (2.0)",
    );
    expect(extractBrand("Torus: Mint Milkshake - 3.5g")).toBe("Torus");
  });

  it("keeps ALL-NUMERIC real brands ('2727' had 1,311 hits in the real file)", () => {
    expect(extractBrand("2727 - Blue Dream 3.5g")).toBe("2727");
  });

  it("returns null when there is no separator (never guesses)", () => {
    expect(extractBrand("Blue Dream 3.5g Flower")).toBeNull();
    expect(extractBrand("RIGBPS31")).toBeNull(); // real SKU-code name
    expect(extractBrand(null)).toBeNull();
    expect(extractBrand("")).toBeNull();
  });
});

describe("extractBrand v2 — junk-prefix blocklist (the verified leaks)", () => {
  it("blocks pure weight/size prefixes ('3.5g' leaked 712 times in v1)", () => {
    expect(extractBrand("3.5g - Blue Dream")).toBeNull();
    expect(extractBrand("1g | Gorilla Glue")).toBeNull();
    expect(extractBrand("100mg - Fruit Chews")).toBeNull();
    expect(extractBrand("1oz - Trim")).toBeNull();
  });

  it("blocks pure count/pack prefixes ('2pk' leaked in v1)", () => {
    expect(extractBrand("2pk - Cherry Prerolls")).toBeNull();
    expect(extractBrand("10 ct - Gummies")).toBeNull();
  });

  it("blocks pure generic-category prefixes ('Flower' leaked 642 times in v1)", () => {
    expect(extractBrand("Flower - Blueberry Muffin")).toBeNull();
    expect(extractBrand("Preroll - Dutchberry")).toBeNull();
    expect(extractBrand("Live Resin - GMO")).toBeNull();
    expect(extractBrand("Sample Jar - OG Kush")).toBeNull();
  });

  it("blocks combined junk but keeps brands that merely CONTAIN a generic word", () => {
    expect(extractBrand("3.5g Flower - Blue Dream")).toBeNull(); // all junk tokens
    // "Sugar" is generic but "Regulator Sugar Wax (2.0)" is a real product line.
    expect(extractBrand("Regulator Sugar Wax (2.0) - Dole Whip")).toBe(
      "Regulator Sugar Wax (2.0)",
    );
    expect(extractBrand("Good Earth Cannabis - Dank Czar Rosin")).toBe("Good Earth Cannabis");
  });
});

describe("extractBrand v2 — '… by <brand>' (verified real convention)", () => {
  it("attributes the brand after ' by ' (real May-2026 name shape)", () => {
    expect(extractBrand("Gelato x Dosidos by Mt Baker Homegrown - 14g")).toBe(
      "Mt Baker Homegrown",
    );
    expect(extractBrand("Blue Dream by Artizen")).toBe("Artizen");
  });

  it("prefers the by-brand when the would-be prefix is a strain-by-brand run", () => {
    // The prefix "Gelato x Dosidos by Mt Baker Homegrown" contains " by " —
    // it is a strain-by-brand, never itself a brand.
    expect(extractBrand("Sour Diesel by Fire Bros - 1g Preroll")).toBe("Fire Bros");
  });

  it("falls back to the by-brand when the prefix is junk", () => {
    expect(extractBrand("3.5g Flower by Royal Tree - Grape Ape")).toBe("Royal Tree");
  });

  it("returns null when the by-brand is itself junk (never guesses)", () => {
    expect(extractBrand("Grape Ape by Flower")).toBeNull();
  });

  it("does not treat 'by' inside a word as a separator", () => {
    expect(extractBrand("Dutchberry Farms - Tangie")).toBe("Dutchberry Farms");
    expect(extractBrand("Ruby Gummies")).toBeNull(); // no separator, no ' by '
  });
});

describe("isJunkBrandCandidate", () => {
  it("flags weights, counts, and generic words in any mix", () => {
    expect(isJunkBrandCandidate("3.5g")).toBe(true);
    expect(isJunkBrandCandidate("100mg")).toBe(true);
    expect(isJunkBrandCandidate("2pk")).toBe(true);
    expect(isJunkBrandCandidate("Flower")).toBe(true);
    expect(isJunkBrandCandidate("1g Preroll")).toBe(true);
    expect(isJunkBrandCandidate("")).toBe(true);
  });

  it("passes real brands, including numeric and mixed ones", () => {
    expect(isJunkBrandCandidate("2727")).toBe(false);
    expect(isJunkBrandCandidate("Phat Panda")).toBe(false);
    expect(isJunkBrandCandidate("NWCS Crystal Clear")).toBe(false);
    expect(isJunkBrandCandidate("Good Earth Cannabis")).toBe(false);
  });
});
