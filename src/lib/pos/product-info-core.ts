/**
 * POS Slice B42 — product info on demand (pure core).
 *
 * Cova's register pattern: the grid stays fast and text-first, but tapping
 * an item's info affordance opens a DETAIL CARD — potency, strain type,
 * terpenes, description — so the budtender can answer "what's the THC on
 * this?" without leaving the sale.
 *
 * Design decisions (owner-approved):
 *  - NO per-product images on the grid. The catalog is large, the register
 *    is an offline-first PWA with a localStorage-cached bundle, and images
 *    would multiply the cache cost and the curation burden for near-zero
 *    speed benefit at the counter. The ONE image lives on this card, fetched
 *    ONLINE-ONLY when the card opens (the DF-3 resolver, server-side) — an
 *    offline register still shows every fact, just no photo.
 *  - Info facts RIDE THE BUNDLE (thc/cbd/terpenes/description on the menu
 *    product, all optional so pre-B42 cached bundles still parse) — the card
 *    works fully offline. Descriptions are TRIMMED server-side via
 *    trimDescription() so a wordy catalog can't bloat the device cache.
 *  - SENSORY/descriptive facts only — no effects or medical claims, matching
 *    the website's posture (WAC 314-55-155 advertising rules).
 *
 * Pure: no I/O, no React. Self-tested below (registered in
 * scripts/compliance/run-pure-selftests.ts) and mirrored in vitest.
 */

import type { PosMenuProduct } from "./sale-flow-core";

/**
 * Server-side cap for descriptions shipped in the bundle. Enough for a menu
 * blurb; a 5,000-character vendor essay gets cut at a word boundary with an
 * ellipsis so the cached bundle stays small.
 */
export const MAX_INFO_DESCRIPTION = 400;

/** Cap on terpenes shown (display order = curation order, most dominant first). */
export const MAX_INFO_TERPENES = 4;

/**
 * Trim a description to `max` characters at a WORD boundary, appending "…"
 * when cut. Whitespace is collapsed first (menu blurbs arrive with stray
 * newlines). Empty/blank input returns "".
 */
export function trimDescription(text: string | null | undefined, max: number = MAX_INFO_DESCRIPTION): string {
  const collapsed = (text ?? "").replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  const cut = collapsed.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.!?-]+$/, "")}…`;
}

/** Human label for the strain type slug the menu carries. */
export function strainTypeLabel(slug: string | null | undefined): string | null {
  switch ((slug ?? "").trim().toLowerCase()) {
    case "indica":
      return "Indica";
    case "sativa":
      return "Sativa";
    case "hybrid":
      return "Hybrid";
    case "indica-hybrid":
      return "Indica hybrid";
    case "sativa-hybrid":
      return "Sativa hybrid";
    case "cbd":
      return "CBD";
    default:
      return null; // "unknown", blank, or garbage — show nothing, never "Unknown".
  }
}

/** One "FACT: value" row on the card. */
export type ProductInfoRow = { label: string; value: string };

export type ProductInfoView = {
  name: string;
  brand: string | null;
  variantLabel: string | null;
  category: string;
  priceMinor: number;
  /** Potency / strain facts, in display order. Empty rows are omitted. */
  rows: ProductInfoRow[];
  /** Dominant terpenes (display-capped). Empty = row hidden. */
  terpenes: string[];
  /** Trimmed description ("" = hidden). */
  description: string;
};

/**
 * Build the card's view model from a menu product. Missing/blank facts are
 * OMITTED (a merch line shows just name/brand/price — never "THC: —").
 */
export function buildProductInfo(product: PosMenuProduct): ProductInfoView {
  const rows: ProductInfoRow[] = [];
  const strain = strainTypeLabel(product.strainType);
  if (strain) rows.push({ label: "Type", value: strain });
  const thc = (product.thc ?? "").trim();
  if (thc) rows.push({ label: "THC", value: thc });
  const cbd = (product.cbd ?? "").trim();
  if (cbd) rows.push({ label: "CBD", value: cbd });

  const terpenes = (product.terpenes ?? [])
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, MAX_INFO_TERPENES);

  return {
    name: product.name,
    brand: product.brand,
    variantLabel: product.variantLabel,
    category: product.category,
    priceMinor: product.regularPriceMinor,
    rows,
    terpenes,
    description: trimDescription(product.description),
  };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runProductInfoCoreTests(): void {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      failures.push(name);
    }
  };

  // trimDescription
  ok(trimDescription("short blurb") === "short blurb", "short text untouched");
  ok(trimDescription("") === "" && trimDescription(null) === "" && trimDescription(undefined) === "", "blank/null/undefined -> empty");
  ok(trimDescription("a\n\nb   c\t d") === "a b c d", "whitespace collapsed");
  const long = "word ".repeat(200); // 1000 chars
  const trimmed = trimDescription(long);
  ok(trimmed.length <= MAX_INFO_DESCRIPTION + 1, "long text capped (plus ellipsis)");
  ok(trimmed.endsWith("…"), "cut text ends with ellipsis");
  ok(!trimmed.includes("  "), "no double spaces after trim");
  ok(trimDescription("abcdef", 4) === "abcd…", "no word boundary -> hard cut");
  ok(trimDescription("one two three", 8) === "one two…", "cut lands on word boundary");
  ok(trimDescription("one two, three", 9) === "one two…", "trailing punctuation stripped before ellipsis");

  // strainTypeLabel
  ok(strainTypeLabel("indica") === "Indica", "indica label");
  ok(strainTypeLabel("SATIVA") === "Sativa", "casing normalized");
  ok(strainTypeLabel("indica-hybrid") === "Indica hybrid", "leaning hybrid label");
  ok(strainTypeLabel("cbd") === "CBD", "cbd label");
  ok(strainTypeLabel("unknown") === null, "unknown -> null (row omitted)");
  ok(strainTypeLabel("") === null && strainTypeLabel(null) === null && strainTypeLabel(undefined) === null, "blank -> null");
  ok(strainTypeLabel("garbage") === null, "garbage -> null");

  // buildProductInfo
  const base: PosMenuProduct = {
    productId: "p1",
    variantId: "v1",
    name: "Blue Dream",
    brand: "Greenway",
    category: "flower",
    categories: ["flower"],
    variantLabel: "3.5g",
    regularPriceMinor: 2500,
    costMinorUnits: null,
    inventoryStatus: "in-stock",
    strainType: "hybrid",
    thc: "24.1%",
    cbd: "0.3%",
    terpenes: ["myrcene", "limonene", " ", "pinene", "linalool", "humulene"],
    description: "  A classic.  ",
  };
  const view = buildProductInfo(base);
  ok(view.rows.length === 3, "type + thc + cbd rows present");
  ok(view.rows[0].label === "Type" && view.rows[0].value === "Hybrid", "type row first");
  ok(view.rows[1].label === "THC" && view.rows[1].value === "24.1%", "thc row");
  ok(view.terpenes.length === MAX_INFO_TERPENES, "terpenes display-capped");
  ok(!view.terpenes.includes(" ") && !view.terpenes.includes(""), "blank terpenes dropped");
  ok(view.description === "A classic.", "description trimmed");
  ok(view.priceMinor === 2500 && view.variantLabel === "3.5g", "price + variant carried");

  const merch: PosMenuProduct = {
    ...base,
    category: "merch",
    strainType: undefined,
    thc: null,
    cbd: undefined,
    terpenes: undefined,
    description: undefined,
  };
  const merchView = buildProductInfo(merch);
  ok(merchView.rows.length === 0, "merch: no potency rows invented");
  ok(merchView.terpenes.length === 0 && merchView.description === "", "merch: no terpenes/description");

  console.log(`product-info-core: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    throw new Error(`product-info-core self-tests failed: ${failures.join("; ")}`);
  }
}
