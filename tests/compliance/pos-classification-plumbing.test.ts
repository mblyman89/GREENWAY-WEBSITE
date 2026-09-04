/**
 * SLICE 18D — PLUMBING.
 *
 * The core tests prove the LOGIC. These prove the register actually renders and
 * uses it. A logic-only suite would stay green while the chip was computed and
 * thrown away — which is exactly the class of defect 18C found on the product
 * detail page, where withDohCompliance() had been called for months and its
 * result never displayed.
 *
 * TECHNIQUE NOTES, both learned the hard way:
 *
 *  1. Comments are stripped before asserting. A source-reading test that
 *     matches its own explanatory prose is a false positive.
 *  2. Text matching alone is NOT sufficient. 18B's and 18C's first mutation
 *     rounds each produced a survivor that kept the identifiers and broke the
 *     VALUE. So anything that can be proven behaviourally is proven
 *     behaviourally, and the source reads are confined to what only a source
 *     read can establish — that the wiring exists at all.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  posClassificationChips,
  productClassifications,
} from "@/lib/pos/classification-search-core";
import { filterMenuProducts } from "@/lib/pos/sale-grid-core";
import type { PosMenuProduct } from "@/lib/pos/sale-flow-core";

const repoRoot = process.cwd();
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ") // {/* jsx */}
    .replace(/\/\*[\s\S]*?\*\//g, " ") // /* block */
    .replace(/^\s*\/\/.*$/gm, " "); // // line
}

/** Assert the stripper produced usable code, not an empty string. */
function guardStripped(code: string, original: string, mustContain: string) {
  expect(code).toContain(mustContain);
  expect(code.length).toBeGreaterThan(original.length / 3);
}

/**
 * A LINE comment containing the two characters that open a block comment is a
 * trap: the block-comment pass then runs from that `/`+`*` all the way to the
 * next `*`+`/`, silently deleting real code in between. It cost this slice a
 * red test — a doc comment mentioning a wildcard import path blanked 80,000
 * characters and made a genuine import look absent.
 *
 * The length guard in guardStripped() does not reliably catch it, because
 * deleting a few hundred lines out of five thousand still leaves plenty of
 * text. So assert it directly on every file these tests read.
 */
function assertNoCommentTraps(rel: string) {
  const lines = read(rel).split("\n");
  const offenders: string[] = [];
  lines.forEach((line, i) => {
    const lineComment = line.match(/(^|[^:"'`\\])\/\/(.*)$/);
    if (lineComment && lineComment[2].includes("/*")) {
      offenders.push(`${rel}:${i + 1}`);
    }
  });
  expect(offenders).toEqual([]);
}

const SALE_FLOW = "src/app/pos/SaleFlow.tsx";
const GRID_CORE = "src/lib/pos/sale-grid-core.ts";
const SEARCH_CORE = "src/lib/pos/classification-search-core.ts";
const SELFTESTS = "scripts/compliance/run-pure-selftests.ts";

describe("18D plumbing — the sale screen derives and renders the chips", () => {
  it("imports the register core, not the storefront's", () => {
    const original = read(SALE_FLOW);
    const code = stripComments(original);
    guardStripped(code, original, "SaleFlow");
    expect(code).toContain("@/lib/pos/classification-search-core");
    // The import is multi-line, so assert the specifiers individually rather
    // than trying to match one formatted block.
    for (const symbol of [
      "posClassificationChips",
      "productClassifications",
      "POS_CLASSIFICATION_LABELS",
      "POS_CLASSIFICATION_TITLES",
      "PosClassificationKind",
    ]) {
      expect(code).toContain(symbol);
    }
  });

  /**
   * THE IMPORT-DIRECTION RULE (recon F9). The register must not start
   * depending on the storefront for its own vocabulary. If this ever fails,
   * the fix is to move the shared fact into sales-limits-core — never to
   * relax the assertion.
   */
  it("does not import anything from the storefront menu modules", () => {
    const code = stripComments(read(SALE_FLOW));
    expect(code).not.toMatch(/from\s+["']@\/lib\/menu\//);
  });

  it("derives the chips from the bundle and passes the lane to the filter", () => {
    const code = stripComments(read(SALE_FLOW));
    expect(code).toContain("posClassificationChips(bundle.products)");
    // The grid filter must receive a classification argument, not three args.
    expect(code).toMatch(
      /filterMenuProducts\(\s*bundle\.products,\s*query,\s*category,\s*activeClassification\s*\)/,
    );
  });

  /**
   * AM-A, preserved. The main-screen quick search must keep passing NO
   * classification: an invisible filter there would look like missing stock.
   */
  it("leaves the main-screen quick search unfiltered", () => {
    const code = stripComments(read(SALE_FLOW));
    expect(code).toMatch(
      /quickResults[\s\S]{0,200}filterMenuProducts\(\s*bundle\.products,\s*query,\s*null\s*\)/,
    );
  });

  it("renders a chip row with a count, a title and a toggle", () => {
    const code = stripComments(read(SALE_FLOW));
    expect(code).toContain("classificationChips.length > 0");
    expect(code).toContain("classificationChips.map");
    expect(code).toContain("setClassification(active ? null : chip.kind)");
    expect(code).toContain("chip.title");
    expect(code).toContain("chip.count");
    expect(code).toContain("aria-pressed={active}");
  });

  /**
   * Touch-target rule (recon F8): the category chips are min-h-11 because the
   * codebase explicitly cites Apple HIG 44pt / WCAG 2.5.5. A new chip on the
   * same screen must not be smaller.
   */
  it("uses a 44px-minimum touch target like every other chip", () => {
    const code = stripComments(read(SALE_FLOW));
    const chipBlock = code.slice(
      code.indexOf("classificationChips.map"),
      code.indexOf("classificationChips.map") + 1200,
    );
    expect(chipBlock).toContain("min-h-11");
  });

  it("renders the tile marker inside the tile, from the shared core", () => {
    const code = stripComments(read(SALE_FLOW));
    expect(code).toContain("function ClassificationBadge");
    expect(code).toContain("productClassifications(product)");
    expect(code).toContain("<ClassificationBadge product={product} />");
    // Null-means-silence, exactly like StockBadge.
    expect(code).toMatch(/kinds\.length === 0\)\s*return null/);
  });

  it("labels the marker from the core rather than hand-typed strings", () => {
    const code = stripComments(read(SALE_FLOW));
    expect(code).toContain("POS_CLASSIFICATION_LABELS[kind]");
    expect(code).toContain("POS_CLASSIFICATION_TITLES[kind]");

    /**
     * Scoped to the badge component, deliberately. SaleFlow.tsx is 5,200+
     * lines and legitimately cites WAC 314-55-095/147/150 in code comments
     * that survive stripping (the limit meter, sales hours, the audit trail).
     * A file-wide assertion here would be a false positive — the SLICE 18B
     * lesson about blocklists that match honest prose. What actually matters
     * is that the marker itself invents no statutory copy and hard-codes no
     * label.
     */
    const badgeStart = code.indexOf("function ClassificationBadge");
    expect(badgeStart).toBeGreaterThan(-1);
    const badge = code.slice(badgeStart, code.indexOf("function StockBadge"));
    expect(badge.length).toBeGreaterThan(100);
    expect(badge).not.toMatch(/WAC\s*314/);
    expect(badge).not.toMatch(/RECREATIONAL_LIMITS|MEDICAL_LIMITS/);
    expect(badge).not.toMatch(/"Low-THC"|"Suppository"/);
    // And the marker must never state a number on a tile; the limit meter
    // owns quantity arithmetic and it depends on the whole cart.
    expect(badge).not.toMatch(/\b200 mg\b|\b10 units\b|\b72 oz\b/);
  });

  /**
   * The self-healing filter. If the active lane sells out and the bundle
   * re-syncs, the chip disappears — a raw state read would leave an invisible,
   * unclearable filter. The applied value must be DERIVED against the chips
   * that actually render.
   */
  it("never applies a classification whose chip is not on screen", () => {
    const code = stripComments(read(SALE_FLOW));
    expect(code).toContain("const activeClassification");
    expect(code).toMatch(
      /classificationChips\.some\(\s*\(c\)\s*=>\s*c\.kind === classification\s*\)/,
    );
    // The raw state value must NOT be what reaches the grid filter.
    expect(code).not.toMatch(
      /filterMenuProducts\(\s*bundle\.products,\s*query,\s*category,\s*classification\s*\)/,
    );
  });
});

describe("18D plumbing — the filter knob is genuinely optional", () => {
  it("declares a defaulted fourth parameter", () => {
    const original = read(GRID_CORE);
    const code = stripComments(original);
    guardStripped(code, original, "filterMenuProducts");
    expect(code).toMatch(/classification:\s*PosClassificationKind \| null = null/);
  });

  it("delegates to the register predicate instead of reading raw flags", () => {
    const code = stripComments(read(GRID_CORE));
    expect(code).toContain("productHasClassification(p, classification)");
    expect(code).not.toMatch(/lowThcLiquid\s*===\s*true/);
    expect(code).not.toMatch(/otherwiseTaken\s*===\s*true/);
  });

  /**
   * BEHAVIOURAL, not textual. 18B and 18C each lost a mutation round to a
   * survivor that kept the identifier and broke the value, so the guarantee
   * that matters — every pre-existing three-argument call is unaffected — is
   * proven by calling it.
   */
  it("is backward compatible: three-argument calls are unchanged", () => {
    const menu: PosMenuProduct[] = [
      {
        productId: "a",
        variantId: "a1",
        name: "Blue Dream",
        brand: "F",
        category: "flower",
        categories: ["flower"],
        variantLabel: "3.5g",
        regularPriceMinor: 3000,
        costMinorUnits: null,
        inventoryStatus: "in-stock",
      },
      {
        productId: "b",
        variantId: "b1",
        name: "Seltzer",
        brand: "F",
        category: "edible-liquid",
        categories: ["edible-liquid"],
        variantLabel: "12oz",
        regularPriceMinor: 800,
        costMinorUnits: null,
        inventoryStatus: "in-stock",
        lowThcLiquid: true,
        unitThcMg: 4,
      },
    ];

    // Identical results with the argument omitted, explicitly null, or absent.
    expect(filterMenuProducts(menu, "", null)).toHaveLength(2);
    expect(filterMenuProducts(menu, "", null, null)).toHaveLength(2);
    expect(filterMenuProducts(menu, "", "flower")).toHaveLength(1);
    expect(filterMenuProducts(menu, "blue", null)).toHaveLength(1);

    // And the new knob actually does something, so the above is not vacuous.
    expect(filterMenuProducts(menu, "", null, "low_thc_liquid")).toHaveLength(1);
    expect(filterMenuProducts(menu, "", null, "otherwise_taken")).toHaveLength(0);
  });

  it("keeps the chips and the filter in agreement", () => {
    const menu: PosMenuProduct[] = [
      {
        productId: "b",
        variantId: "b1",
        name: "Seltzer",
        brand: "F",
        category: "edible-liquid",
        categories: ["edible-liquid"],
        variantLabel: "12oz",
        regularPriceMinor: 800,
        costMinorUnits: null,
        inventoryStatus: "in-stock",
        lowThcLiquid: true,
        unitThcMg: 4,
      },
      {
        productId: "c",
        variantId: "c1",
        name: "Insert",
        brand: "F",
        category: "topical",
        categories: ["topical"],
        variantLabel: "6ct",
        regularPriceMinor: 4000,
        costMinorUnits: null,
        inventoryStatus: "in-stock",
        otherwiseTaken: true,
        unitsPerPackage: 6,
      },
    ];

    // EVERY chip must lead to a non-empty grid whose size equals its count,
    // and every product in that grid must wear the matching marker.
    const chips = posClassificationChips(menu);
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      const hits = filterMenuProducts(menu, "", null, chip.kind);
      expect(hits).toHaveLength(chip.count);
      expect(hits.length).toBeGreaterThan(0);
      for (const hit of hits) {
        expect(productClassifications(hit)).toContain(chip.kind);
      }
    }
  });
});

describe("18D plumbing — purity, registration, and staying additive", () => {
  /**
   * An import ALLOWLIST that fails closed. A blocklist scanning for the word
   * "server-only" produces false positives, because doc comments legitimately
   * discuss it — that mistake cost a round in 18B.
   */
  it("keeps the register core pure", () => {
    const code = stripComments(read(SEARCH_CORE));
    const allowed = new Set(["@/lib/compliance/sales-limits-core"]);
    const specifiers = [...code.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const spec of specifiers) {
      expect(allowed.has(spec)).toBe(true);
    }
    expect(code).not.toMatch(/^\s*["']server-only["']\s*;?\s*$/m);
    expect(code).not.toMatch(/^\s*["']use client["']\s*;?\s*$/m);
    expect(code).not.toMatch(/\bfrom\s+["']react["']/);
  });

  it("keeps the grid core free of I/O and framework imports", () => {
    const code = stripComments(read(GRID_CORE));
    const allowed = new Set(["./sale-flow-core", "./classification-search-core"]);
    const specifiers = [...code.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const spec of specifiers) {
      expect(allowed.has(spec)).toBe(true);
    }
    expect(code).not.toMatch(/^\s*["']server-only["']\s*;?\s*$/m);
  });

  it("runs both touched cores in CI", () => {
    const code = stripComments(read(SELFTESTS));
    expect(code).toContain("__runPosClassificationSearchTests");
    expect(code).toContain("__runSaleGridCoreTests");
    // The classification core's registration keeps its anti-vacuity guard.
    expect(code).toMatch(/__runPosClassificationSearchTests\(\)[\s\S]{0,120}passed < 1/);
  });

  /**
   * 18D adds visibility only. If this slice ever needed a migration or a new
   * column, that would be a different slice with a different review.
   */
  it("adds no migration and no new persisted field", () => {
    const code = stripComments(read(SEARCH_CORE)) + stripComments(read(GRID_CORE));
    expect(code).not.toMatch(/\bfrom\s+["']@\/lib\/supabase/);
    expect(code).not.toMatch(/\bcreateClient\b/);
    expect(code).not.toMatch(/\bfetch\(/);
  });

  it("leaves 18B's search keywords untouched", () => {
    const code = stripComments(read(SEARCH_CORE));
    expect(code).toContain("LOW_THC_SEARCH_KEYWORDS");
    expect(code).toContain("OTHERWISE_TAKEN_SEARCH_KEYWORDS");
    expect(code).toContain("classificationSearchText");
  });

  /**
   * Protects every source-reading assertion in this file from silently
   * passing (or failing) because a comment ate the code it was inspecting.
   */
  it("contains no line comment that opens a block comment", () => {
    for (const rel of [SALE_FLOW, GRID_CORE, SEARCH_CORE]) {
      assertNoCommentTraps(rel);
    }
  });
});
