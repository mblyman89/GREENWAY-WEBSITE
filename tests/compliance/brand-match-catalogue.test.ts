/**
 * tests/compliance/brand-match-catalogue.test.ts  (SLICE T1)
 *
 * The claims in brand-match-core.ts's header are MEASUREMENTS of the store's
 * real Cultivera export, not opinions. A measurement written into a comment
 * rots the moment somebody edits the code it describes, so this file re-takes
 * every one of those measurements against the committed workbook on each CI run
 * and fails if reality has moved.
 *
 * Specifically it proves, on all 194 real brand strings:
 *   1. brandKey() merges no two DIFFERENT vendors  (the money-safety direction:
 *      a false merge discounts a brand the owner never agreed to discount);
 *   2. every merge it does perform joins two spellings of ONE company;
 *   3. Thursday's advertised reach is the number the core asserts;
 *   4. the near-miss detector surfaces exactly the products that ring up at
 *      full price while their brand is on the shelf sign.
 *
 * Source of truth: normalized_cultivera/PRODUCTS_NORMALIZED.xlsx, which is
 * committed to this repository (2,676 product rows).
 */
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  brandKey,
  brandMatches,
  brandInList,
  findBrandNearMisses,
  BRAND_MATCH_TARGET_FIXTURES,
  BRAND_MATCH_FIXTURES,
  BRAND_KEY_EQUIVALENT_PAIRS,
} from "@/lib/promotions/brand-match-core";

const WORKBOOK = "normalized_cultivera/PRODUCTS_NORMALIZED.xlsx";

/** Read the REAL brand column: verbatim string -> product count. */
function readCatalogueBrands(): Map<string, number> {
  const wb = XLSX.readFile(WORKBOOK);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  const out = new Map<string, number>();
  for (const row of rows) {
    const brand = String(row["Brand"] ?? "");
    if (!brand.trim()) continue;
    out.set(brand, (out.get(brand) ?? 0) + 1);
  }
  return out;
}

/**
 * The measured same-company groups. Every entry is a set of verbatim spellings
 * that brandKey() is EXPECTED to unify because they are one vendor. Anything
 * the key merges that is not listed here is a regression, and the test says so
 * by name rather than by count.
 */
const EXPECTED_MERGES: readonly (readonly string[])[] = [
  ["Phat  Panda", "Phat Panda"],
  ["Fire Bros", "FIREBROS"],
  ["SUBX", "Sub X"],
  ["Green Revolution", "Green Revolution:"],
  ["High Tide", "HighTide"],
  ["Rays Lemonade", "Ray's Lemonade"],
  ["K Savage", "K-Savage"],
  ["420 Bar", "4.20 Bar"],
];

describe("SLICE T1: brand matching against the store's REAL catalogue", () => {
  const brands = readCatalogueBrands();

  it("reads the committed Cultivera export", () => {
    // Guards the test itself: if the workbook is ever moved, emptied or has its
    // Brand column renamed, every assertion below would vacuously pass.
    expect(brands.size).toBe(194);
    const totalRows = Array.from(brands.values()).reduce((s, n) => s + n, 0);
    expect(totalRows).toBeGreaterThan(2000);
  });

  it("merges no two DIFFERENT vendors (the money-safety direction)", () => {
    const groups = new Map<string, string[]>();
    for (const brand of brands.keys()) {
      const k = brandKey(brand);
      const g = groups.get(k);
      if (g) g.push(brand);
      else groups.set(k, [brand]);
    }
    const merged = Array.from(groups.values())
      .filter((g) => g.length > 1)
      .map((g) => [...g].sort());
    const expected = EXPECTED_MERGES.map((g) => [...g].sort());
    // Compare as sorted JSON so the failure message names the offending brands.
    const asText = (gs: string[][]) =>
      gs.map((g) => JSON.stringify(g)).sort().join("\n");
    expect(asText(merged)).toBe(asText(expected));
  });

  it("every brand key is non-empty and idempotent on real data", () => {
    for (const brand of brands.keys()) {
      const k = brandKey(brand);
      // A real, non-blank vendor name must never key to "" -- that would make
      // it unmatchable by any promotion.
      expect(k, `brand ${JSON.stringify(brand)} keyed to empty`).not.toBe("");
      expect(brandKey(k)).toBe(k);
    }
  });

  it("Thursday's featured brands reach exactly 339 catalogue products", () => {
    let reached = 0;
    const matchedBrands: string[] = [];
    for (const [brand, count] of brands) {
      if (brandInList(BRAND_MATCH_TARGET_FIXTURES, brand)) {
        reached += count;
        matchedBrands.push(brand);
      }
    }
    expect(matchedBrands.sort()).toEqual(
      [
        "Buddies",
        "Clarity Farms",
        "Constellation",
        "Lifted",
        "Phat  Panda",
        "Phat Panda",
      ].sort(),
    );
    expect(reached).toBe(339);
  });

  it("the OLD trim+lowercase rule reached 273 -- the 66 added are all one brand", () => {
    // Documents precisely what changed, so nobody has to trust the header.
    const oldMatch = (b: string) =>
      BRAND_MATCH_TARGET_FIXTURES.some(
        (t) => b.trim().toLowerCase() === t.trim().toLowerCase(),
      );
    let oldReach = 0;
    const gained: string[] = [];
    for (const [brand, count] of brands) {
      const now = brandInList(BRAND_MATCH_TARGET_FIXTURES, brand);
      const before = oldMatch(brand);
      if (before) oldReach += count;
      // Nothing may LOSE its discount.
      expect(before && !now, `brand ${JSON.stringify(brand)} lost its deal`).toBe(false);
      if (now && !before) gained.push(brand);
    }
    expect(oldReach).toBe(273);
    expect(gained).toEqual(["Phat  Panda"]);
    expect(brands.get("Phat  Panda")).toBe(66);
  });

  it("surfaces exactly the four near-misses, and never auto-matches them", () => {
    const misses = findBrandNearMisses(
      Array.from(brands.keys()),
      BRAND_MATCH_TARGET_FIXTURES,
    );
    const summary = misses
      .map((m) => `${m.brand}|${m.target}|${m.kind}`)
      .sort();
    expect(summary).toEqual(
      [
        "Constellation Cannabis|Constellation|corporate-suffix",
        "Lifted Cannabis|Lifted|corporate-suffix",
        "Lifted Luxury |Lifted|sub-brand-or-different",
        "Phat Panda Bong Buddies|Phat Panda|sub-brand-or-different",
      ].sort(),
    );
    // Detected, but deliberately NOT discounted -- a vendor-agreement question.
    for (const m of misses) {
      expect(brandInList(BRAND_MATCH_TARGET_FIXTURES, m.brand)).toBe(false);
    }
    const gap = misses.reduce((s, m) => s + (brands.get(m.brand) ?? 0), 0);
    expect(gap).toBe(12);
  });

  it("'Phat Yeti' is a real brand that must never join Phat Panda's sale", () => {
    // The concrete reason token/fuzzy matching is refused.
    expect(brands.get("Phat Yeti")).toBe(1);
    expect(brandMatches("Phat Yeti", "Phat Panda")).toBe(false);
    expect(brandInList(BRAND_MATCH_TARGET_FIXTURES, "Phat Yeti")).toBe(false);
  });

  it("every fixture in the core is a VERBATIM catalogue string", () => {
    // Stops the fixtures drifting into invented examples.
    for (const f of BRAND_MATCH_FIXTURES) {
      expect(brands.get(f.brand), `fixture ${JSON.stringify(f.brand)} not in catalogue`).toBe(
        f.products,
      );
    }
    for (const [a, b] of BRAND_KEY_EQUIVALENT_PAIRS) {
      expect(brands.has(a), `pair member ${JSON.stringify(a)} not in catalogue`).toBe(true);
      expect(brands.has(b), `pair member ${JSON.stringify(b)} not in catalogue`).toBe(true);
    }
  });
});
