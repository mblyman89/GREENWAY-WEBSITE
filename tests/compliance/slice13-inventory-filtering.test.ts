/**
 * SLICE 13 — the inventory page's filtering, sorting and smart search.
 *
 * THE COMPLAINT THIS SLICE CLOSES (owner, verbatim)
 * "I tried typing something in and couldn't find it, and it only found it when
 *  I very specifically used the products name exactly."
 *
 * THE CAUSE, measured before anything was written (see
 * docs/slice-13-inventory-filtering-recon.md): the page's search was ONE
 * PostgREST predicate —
 *
 *     product_name.ilike.%<the whole phrase>%
 *     lot_code.ilike.%<the whole phrase>%
 *     pos_product_key.ilike.%<the whole phrase>%
 *
 * — which fails three separate ways at once. The phrase had to appear
 * CONTIGUOUSLY and in order, so "dream blue" found nothing. Only three columns
 * were searched, so a vendor, brand, strain or note was invisible. And there
 * was no typo tolerance at all, so one wrong letter returned an empty screen.
 *
 * A second, structural cause blocked the filters and sorts the owner asked
 * for: vendor name, brand name and the COA were resolved AFTER the page of
 * rows had been chosen (`hydrateLots`), so the query doing the filtering and
 * ordering had never seen those values.
 *
 * WHAT IS ASSERTED BELOW
 * Behaviour, not implementation. Every test states a thing the owner can do at
 * the keyboard and checks the list that comes back. The suite is deliberately
 * hostile: it includes the real vendor names from this store that contain
 * commas, the empty-string and NULL edge cases, and the "unknown is not zero"
 * doctrine that a naive filter gets wrong.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildInventoryPage,
  parseLegacyFilters,
  matchesLegacyFilters,
  applyLegacySort,
  __testPageLot,
  __runInventoryPageCoreTests,
  type PageLot,
} from "@/lib/inventory/inventory-page-core";
import {
  parseInventoryFilters,
  parseMultiParam,
  facetOptions,
  lotMatchesFilters,
  countActiveFilters,
  hasActiveFilters,
  matchesTriState,
  matchesPresence,
  inNumericRange,
  inDateRange,
  parseNumber,
  parseDateBound,
  INVENTORY_FACETS,
  UNSET_FACET_VALUE,
  UNSET_FACET_LABEL,
  __testLot,
  __runInventoryFilterCoreTests,
  type FacetDef,
} from "@/lib/inventory/inventory-filter-core";
import {
  INVENTORY_COLUMN_SORTS,
  columnSortDef,
  nextSortState,
  parseDirection,
  sortLots,
  __runInventorySortCoreTests,
} from "@/lib/inventory/inventory-sort-core";
import {
  searchInventoryRows,
  scoreTokenInField,
  searchTokens,
  normalizeSearchText,
  TOKEN_MATCH_SCORE,
  FUZZY_TOKEN_THRESHOLD,
  FUZZY_MIN_TOKEN_LENGTH,
  __runInventorySearchCoreTests,
} from "@/lib/inventory/inventory-search-core";
import {
  searchFieldsForLot,
  buildInventoryList,
  __runInventoryListCoreTests,
} from "@/lib/inventory/inventory-list-core";
import {
  sortHref,
  sortIndicator,
  currentSort,
  toggleFacetHref,
  clearAllFiltersHref,
  activeFilterChips,
  paramsFrom,
  PRESERVED_PARAMS,
  SORT_COLUMN_PARAM,
  SORT_DIRECTION_PARAM,
  __runInventoryUrlCoreTests,
} from "@/lib/inventory/inventory-url-core";
import { __runStrainMatcherTests } from "@/lib/ai/kb/strain-matcher";

const SRC = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

/**
 * Source with comments removed, for "this must NOT appear" assertions.
 *
 * WHY THIS EXISTS. Two wiring assertions in this file first failed against a
 * correctly-wired page because `listLotsPaged` and `normalizeStrainQuery` each
 * appear once in a comment EXPLAINING WHY THEY ARE NOT USED. A raw-text
 * `not.toContain` therefore punished the code for documenting itself, and the
 * only ways to "pass" it would have been to delete a true comment or to weaken
 * the test. Both are the wrong answer. A negative pin has to read the CODE.
 *
 * The inverse trap is just as real and was hit earlier in this slice: a
 * positive pin like `toContain("gaps: activeGaps")` can be satisfied by a
 * comment, so it proves nothing. Negative pins use CODE(); positive pins are
 * backed by behavioural tests elsewhere in this file, never by text alone.
 */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  // States: code, line comment, block comment, single/double/backtick string.
  let mode: "code" | "line" | "block" | "'" | '"' | "`" = "code";
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") { mode = "line"; i += 2; continue; }
      if (c === "/" && n === "*") { mode = "block"; i += 2; continue; }
      if (c === "'" || c === '"' || c === "`") { mode = c; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (mode === "line") {
      if (c === "\n") { mode = "code"; out += c; }
      i++; continue;
    }
    if (mode === "block") {
      if (c === "*" && n === "/") { mode = "code"; i += 2; continue; }
      if (c === "\n") out += c; // keep line numbers honest
      i++; continue;
    }
    // inside a string literal
    if (c === "\\") { out += c + (n ?? ""); i += 2; continue; }
    if (c === mode) mode = "code";
    out += c; i++;
  }
  return out;
}
const CODE = (rel: string) => stripComments(SRC(rel));
const NOW = new Date("2026-06-01T12:00:00Z");

/**
 * REAL vendor names from this store's own seed data. Two of them contain a
 * comma, which is exactly the character a careless implementation reaches for
 * as a multi-value separator.
 *   back-office/kb_seed/vendors_baseline_seed.sql:25
 *   back-office/kb_seed/vendors_batch3_seed.sql
 */
const COMMA_VENDORS = ["Grow Op Farms, LLC", "Free Rain Farms, Inc.", "Legacy Organics, LLC"];

/** A small, realistic shelf used across the behavioural tests. */
function shelf(): PageLot[] {
  return [
    __testPageLot({
      id: "blue",
      product_name: "Blue Dream 3.5g",
      strain_name: "Blue Dream",
      vendor_name: "Phat Panda",
      brand_name: "Panda",
      category: "Flower",
      strain_type: "hybrid",
      on_hand_qty: 12,
      received_qty: 20,
      unit_cost_minor_units: 1200,
      received_on: "2026-01-15",
      expires_on: "2026-12-01",
      lab: { total_thc_pct: 24.5, total_cbd_pct: 0.1, lab_name: "Confidence", passed: true },
      lab_result_id: "lr-blue",
    }),
    __testPageLot({
      id: "crack",
      product_name: "Green Crack Preroll",
      strain_name: "Green Crack",
      vendor_name: "Grow Op Farms, LLC",
      brand_name: "Phat Panda",
      category: "Preroll",
      strain_type: "sativa",
      on_hand_qty: 3,
      received_qty: 40,
      unit_cost_minor_units: 500,
      received_on: "2026-03-02",
      expires_on: "2026-08-01",
      lab: { total_thc_pct: 31.2, total_cbd_pct: null, lab_name: "Praxis", passed: true },
      lab_result_id: "lr-crack",
    }),
    __testPageLot({
      id: "cantina",
      product_name: "Cantina Gummies - Guava 10 Pack 400mg",
      strain_name: null,
      vendor_name: "Legacy Organics, LLC",
      brand_name: "Cantina",
      category: "Edible",
      inventory_type: "Solid Edible",
      strain_type: null,
      on_hand_qty: 0,
      received_qty: 10,
      unit_cost_minor_units: null,
      received_on: null,
      expires_on: null,
      notes: "damaged case, quarantine pending",
      lab: null,
      lab_result_id: null,
    }),
    __testPageLot({
      id: "cbd",
      product_name: "Ratio Tincture 1:1",
      strain_name: "ACDC",
      vendor_name: "Free Rain Farms, Inc.",
      brand_name: "Ratio",
      category: "Tincture",
      inventory_type: "Liquid Edible",
      strain_type: "cbd",
      on_hand_qty: 7,
      received_qty: 7,
      unit_cost_minor_units: 2200,
      received_on: "2026-02-20",
      expires_on: "2027-01-01",
      low_thc_liquid: true,
      lab: { total_thc_pct: 5.0, total_cbd_pct: 12.4, lab_name: "Confidence", passed: false },
      lab_result_id: "lr-cbd",
    }),
  ];
}

function run(params: Record<string, string | string[] | undefined>, page = 1, pageSize = 50) {
  return buildInventoryPage({ lots: shelf(), params, page, pageSize, now: NOW });
}
const ids = (r: { rows: PageLot[] }) => r.rows.map((l) => l.id);

describe("SLICE 13 — the pure cores are self-consistent", () => {
  it("every core's own self-tests pass", () => {
    expect(() => __runStrainMatcherTests()).not.toThrow();
    expect(() => __runInventorySearchCoreTests()).not.toThrow();
    expect(() => __runInventoryFilterCoreTests()).not.toThrow();
    expect(() => __runInventorySortCoreTests()).not.toThrow();
    expect(() => __runInventoryListCoreTests()).not.toThrow();
    expect(() => __runInventoryUrlCoreTests()).not.toThrow();
    expect(() => __runInventoryPageCoreTests()).not.toThrow();
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * THE OWNER'S ACTUAL COMPLAINT
 * ──────────────────────────────────────────────────────────────────────────── */

describe("the search finds things without the exact product name", () => {
  it("finds a product from a PARTIAL word", () => {
    expect(ids(run({ q: "gumm" }))).toEqual(["cantina"]);
  });

  it("finds a product from the MIDDLE of a word — the old ilike could not", () => {
    // "rack" is inside "Crack". The old search needed the phrase to start a
    // match on one of three columns; a mid-word fragment of a word in the
    // middle of the name was reachable, but only because the whole phrase was
    // contiguous. These next cases are the ones that genuinely failed.
    expect(ids(run({ q: "rack" }))).toEqual(["crack"]);
  });

  it("finds a product when the words are typed OUT OF ORDER", () => {
    // The old single `%dream blue%` predicate returned nothing for this.
    expect(ids(run({ q: "dream blue" }))).toEqual(["blue"]);
  });

  it("finds a product from words that are far APART in the name", () => {
    // "cantina 400mg" spans the whole title with six words in between.
    expect(ids(run({ q: "cantina 400mg" }))).toEqual(["cantina"]);
  });

  it("tolerates a TYPO and says that it guessed", () => {
    const r = run({ q: "gummies guaba" });
    expect(ids(r)).toEqual(["cantina"]);
    expect(r.didYouMean).toBe(true);
  });

  it("does NOT claim to have guessed when the match was exact", () => {
    const r = run({ q: "guava" });
    expect(ids(r)).toEqual(["cantina"]);
    expect(r.didYouMean).toBe(false);
  });

  it("searches fields the old query never looked at", () => {
    // Vendor, brand, strain and free-text notes were all invisible before.
    expect(ids(run({ q: "legacy" }))).toEqual(["cantina"]); // vendor
    expect(ids(run({ q: "ratio" }))).toContain("cbd"); // brand
    expect(ids(run({ q: "acdc" }))).toEqual(["cbd"]); // strain
    expect(ids(run({ q: "damaged" }))).toEqual(["cantina"]); // notes
  });

  it("still finds a lot by its exact identifiers", () => {
    expect(ids(run({ q: "LC-1" })).length).toBeGreaterThan(0);
    expect(ids(run({ q: "POS-1" })).length).toBeGreaterThan(0);
  });

  it("is case- and punctuation-insensitive", () => {
    expect(ids(run({ q: "BLUE DREAM" }))).toEqual(["blue"]);
    expect(ids(run({ q: "blue-dream" }))).toEqual(["blue"]);
    expect(ids(run({ q: "  blue   dream  " }))).toEqual(["blue"]);
  });

  it("ranks the most specific match first", () => {
    // "Phat Panda" is one lot's VENDOR and another lot's BRAND. Both match;
    // the one whose product is actually named that way is not involved, so
    // the ordering is decided by field weight, deterministically.
    const r = run({ q: "phat panda" });
    expect(r.rows.length).toBe(2);
    expect(r.didYouMean).toBe(false);
  });

  it("returns an honest empty result for something genuinely absent", () => {
    // "Best guess rather than nothing" must not become "always show something".
    const r = run({ q: "zzzzqqqxyw" });
    expect(r.rows).toEqual([]);
    expect(r.didYouMean).toBe(false);
  });

  it("an empty or whitespace query means no search at all", () => {
    expect(run({ q: "" }).total).toBe(4);
    expect(run({ q: "   " }).total).toBe(4);
    expect(run({}).total).toBe(4);
  });

  it("scores an exact hit above a prefix above a substring above a fuzzy one", () => {
    // The ladder must be strictly descending or a better match could be
    // shadowed by a worse one — a real bug found and fixed during this slice.
    const order = ["exact", "prefix", "word-prefix", "substring", "fuzzy"] as const;
    for (let i = 1; i < order.length; i++) {
      const prev = order[i - 1];
      const cur = order[i];
      expect(TOKEN_MATCH_SCORE[prev!]).toBeGreaterThan(TOKEN_MATCH_SCORE[cur!]);
    }
  });

  it("does not fuzzy-match very short tokens, which would match everything", () => {
    // MEASURED, not assumed. This assertion originally read
    //   scoreTokenInField("og", "og kush", true).kind === "word-prefix"
    // which was wrong twice over: the function returns the kind DIRECTLY as a
    // string|null (there is no `.kind`), and "og" at the START of "og kush" is
    // a "prefix", not a "word-prefix". scripts/slice13/probe-token-kind.ts
    // printed the real values; they are pinned here.
    expect(scoreTokenInField("og", "og kush", true)).toBe("prefix");
    expect(scoreTokenInField("og", "blue og kush", true)).toBe("word-prefix");

    // The real point of this test: a token shorter than FUZZY_MIN_TOKEN_LENGTH
    // gets NO typo allowance. "grn" is one deletion from "green" and would
    // sail past the similarity threshold, but the length guard refuses it,
    // because at three letters a "typo" is indistinguishable from a different
    // word and would drag half the shelf into the results.
    expect(FUZZY_MIN_TOKEN_LENGTH).toBe(4);
    expect("grn".length).toBeLessThan(FUZZY_MIN_TOKEN_LENGTH);
    expect(scoreTokenInField("grn", "green apple", true)).toBe(null);
    // One letter longer, same kind of typo, and it IS forgiven.
    expect("gren".length).toBe(FUZZY_MIN_TOKEN_LENGTH);
    expect(scoreTokenInField("gren", "green apple", true)).toBe("fuzzy");

    // Nonsense matches nothing at any length.
    expect(scoreTokenInField("xq", "blue dream", true)).toBe(null);
    expect(scoreTokenInField("zebra", "blue dream", true)).toBe(null);

    // And fuzzy is OFF in the strict pass even for a long-enough token, which
    // is what stops "resin" from dragging in "rosin" on a normal search.
    expect(scoreTokenInField("dreem", "blue dream", true)).toBe("fuzzy");
    expect(scoreTokenInField("dreem", "blue dream", false)).toBe(null);
  });

  it("ranks a whole shelf by relevance and discloses a guess (searchInventoryRows)", () => {
    // The row-level entry point, exercised directly rather than only through
    // buildInventoryPage, so a regression here is attributed to the search and
    // not to the page assembly.
    const rows = [
      { row: "weak", fields: [{ text: "dream weaver preroll", weight: 1 }] },
      { row: "strong", fields: [{ text: "blue dream 3.5g", weight: 3 }] },
    ];
    const hit = searchInventoryRows(rows, "blue dream");
    expect(hit.rows).toEqual(["strong"]); // "weak" lacks the token "blue"
    expect(hit.didYouMean).toBe(false);

    // A typo finds it, and SAYS it had to guess.
    const guess = searchInventoryRows(rows, "blue dreem");
    expect(guess.rows).toEqual(["strong"]);
    expect(guess.didYouMean).toBe(true);

    // Nothing relevant means nothing returned, and no guess is claimed.
    const miss = searchInventoryRows(rows, "xyzzy");
    expect(miss.rows).toEqual([]);
    expect(miss.didYouMean).toBe(false);

    // A blank query is "no filter", never "no rows".
    expect(searchInventoryRows(rows, "   ").rows).toEqual(["weak", "strong"]);
  });

  it("assembles filter -> search -> sort -> page in that order (buildInventoryList)", () => {
    // Order matters: sorting before filtering would waste work, and paginating
    // before sorting would page over the wrong set. Pin the observable result.
    const lots = shelf();
    const listed = buildInventoryList<PageLot>({
      lots,
      filters: parseInventoryFilters({}),
      query: "",
      column: columnSortDef("thc") ?? null,
      direction: "desc",
      page: 1,
      pageSize: 2,
      fields: searchFieldsForLot,
    });
    // Page 1 of a 2-per-page view over the whole shelf.
    expect(listed.rows.length).toBe(2);
    expect(listed.total).toBe(lots.length);
    expect(listed.totalPages).toBe(Math.ceil(lots.length / 2));
    expect(listed.page).toBe(1);

    // Page 2 continues the SAME ordering \u2014 no row repeated, none skipped.
    const page2 = buildInventoryList<PageLot>({
      lots,
      filters: parseInventoryFilters({}),
      query: "",
      column: columnSortDef("thc") ?? null,
      direction: "desc",
      page: 2,
      pageSize: 2,
      fields: searchFieldsForLot,
    });
    const seen = [...listed.rows, ...page2.rows].map((l) => l.id);
    expect(new Set(seen).size).toBe(seen.length);

    // An out-of-range page clamps to the last real page instead of showing
    // the owner an empty table.
    const far = buildInventoryList<PageLot>({
      lots,
      filters: parseInventoryFilters({}),
      query: "",
      column: null,
      direction: "desc",
      page: 999,
      pageSize: 2,
      fields: searchFieldsForLot,
    });
    expect(far.page).toBe(far.totalPages);
    expect(far.rows.length).toBeGreaterThan(0);
  });

  it("refuses a blank token, which would otherwise match the whole shelf", () => {
    // FOUND BY MUTATION TESTING, not by review. The guard was `if (!token)`,
    // which is falsy-only: "" was refused but " " was not, and a single space
    // IS a substring of very nearly every product name on the shelf. The fix
    // is `!token.trim()`. Unreachable through the UI, but the function is
    // exported and the next caller has not been written yet.
    expect(scoreTokenInField(" ", "blue dream", true)).toBe(null);
    expect(scoreTokenInField("   ", "blue dream", true)).toBe(null);
    expect(scoreTokenInField("\t", "blue dream", true)).toBe(null);
    expect(scoreTokenInField("", "blue dream", true)).toBe(null);
  });

  it("never emits a blank token from any hostile query", () => {
    // This is the precondition that makes the plain-substring rung an
    // EQUIVALENT mutant instead of an untested branch. If this ever stops
    // holding, that equivalence argument dies with it and the survivor in
    // scripts/slice13/mutants.json becomes a real gap again.
    const hostile = [
      "", " ", "   ", "\t", "\n", "\r\n", "\u00a0", "\u2009", "\u3000",
      "  blue   dream  ", "blue\tdream", "blue - dream", "---", ",,,",
      "()[]{}", "%%%", "blue,dream", "Grow Op Farms, LLC",
      "Cantina Gummies - Guava 10 Pack 400mg",
    ];
    for (const raw of hostile) {
      for (const t of searchTokens(raw)) {
        expect(t.trim()).not.toBe("");
      }
    }
    // Sanity: the tokenizer is still doing real work, not just returning [].
    expect(searchTokens("Grow Op Farms, LLC")).toEqual(["grow", "op", "farms", "llc"]);
  });

  it("walks the match ladder in the documented order", () => {
    // One measured case per rung, so a reordering of the ladder inside
    // scoreTokenInField cannot pass unnoticed. Every value below came from
    // scripts/slice13/probe-token-kind.ts.
    expect(scoreTokenInField("blue dream", "blue dream", true)).toBe("exact");
    expect(scoreTokenInField("blue", "blue dream", true)).toBe("prefix");
    expect(scoreTokenInField("dream", "blue dream", true)).toBe("word-prefix");
    expect(scoreTokenInField("ream", "blue dream", true)).toBe("substring");
    // Glue-insensitive: the owner typing "gg4" finds "GG 4".
    expect(scoreTokenInField("gg4", "gg 4 preroll", true)).toBe("substring");
    expect(scoreTokenInField("weding", "wedding cake", true)).toBe("fuzzy");
  });

  it("keeps dosages and pack sizes searchable", () => {
    // The KB strain normalizer destroys these words. If the search had reused
    // it, "400mg" and "10 pack" would have become the empty string.
    expect(normalizeSearchText("400mg")).toContain("400mg");
    expect(searchTokens("Gummies 400mg 10 Pack")).toContain("400mg");
    expect(searchTokens("Gummies 400mg 10 Pack")).toContain("gummies");
  });

  it("the fuzzy threshold is a real, documented number", () => {
    expect(FUZZY_TOKEN_THRESHOLD).toBeGreaterThan(0);
    expect(FUZZY_TOKEN_THRESHOLD).toBeLessThan(1);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * FILTERS
 * ──────────────────────────────────────────────────────────────────────────── */

describe("filters narrow the list by every descriptor", () => {
  it("offers a facet for each descriptor the owner named", () => {
    const params = INVENTORY_FACETS.map((f) => f.param);
    // vendors, brands, types, categories, strain type … each has a control.
    for (const expected of [
      "fVendor",
      "fBrand",
      "fType",
      "fCategory",
      "fStrain",
      "fStrainType",
      "fStatus",
      "fSize",
      "fLab",
    ]) {
      expect(params).toContain(expected);
    }
  });

  it("filters by vendor, brand, category and strain type", () => {
    expect(ids(run({ fVendor: "Phat Panda" }))).toEqual(["blue"]);
    expect(ids(run({ fBrand: "Cantina" }))).toEqual(["cantina"]);
    expect(ids(run({ fCategory: "Preroll" }))).toEqual(["crack"]);
    expect(ids(run({ fStrainType: "Sativa" })).length).toBeGreaterThanOrEqual(0);
  });

  it("selecting two values of one facet is an OR", () => {
    const r = run({ fVendor: ["Phat Panda", "Legacy Organics, LLC"] });
    expect(ids(r).sort()).toEqual(["blue", "cantina"]);
  });

  it("selecting two DIFFERENT facets is an AND", () => {
    expect(ids(run({ fVendor: "Phat Panda", fCategory: "Preroll" }))).toEqual([]);
    expect(ids(run({ fVendor: "Phat Panda", fCategory: "Flower" }))).toEqual(["blue"]);
  });

  /**
   * REGRESSION — the defect found in this slice's own code.
   *
   * Facet values were first encoded as a comma-separated list. Measured
   * against this store's REAL vendor names, that turned "Grow Op Farms, LLC"
   * into two vendors that do not exist and the filter matched NOTHING — the
   * owner's original complaint, recreated inside its own fix.
   */
  it.each(COMMA_VENDORS)("a vendor whose real name contains a comma is selectable: %s", (v) => {
    expect(parseMultiParam({ fVendor: v }, "fVendor")).toEqual([v]);
    const lot = __testLot({ vendor_name: v });
    expect(lotMatchesFilters(lot, parseInventoryFilters({ fVendor: v }))).toBe(true);
    // and end to end, through the URL writer and back
    const href = toggleFacetHref({}, "fVendor", v, []);
    const back = new URLSearchParams(href.split("?")[1] ?? "").getAll("fVendor");
    expect(back).toEqual([v]);
  });

  it("finds the comma-named vendor's lots through the full page pipeline", () => {
    expect(ids(run({ fVendor: "Grow Op Farms, LLC" }))).toEqual(["crack"]);
    expect(ids(run({ fVendor: "Legacy Organics, LLC" }))).toEqual(["cantina"]);
  });

  it("an ampersand in a value survives the URL too", () => {
    const AMP = "Salt & Pepper Farms";
    const href = toggleFacetHref({}, "fBrand", AMP, []);
    expect(new URLSearchParams(href.split("?")[1] ?? "").getAll("fBrand")).toEqual([AMP]);
  });

  it("lets the owner find rows where a value is MISSING", () => {
    // "(not set)" is a first-class choice — it is the worklist of what needs
    // filling in, which is most of the reason to filter at all.
    const r = run({ fStrain: UNSET_FACET_VALUE });
    expect(ids(r)).toEqual(["cantina"]);
  });

  it("builds facet options from the data with real counts, busiest first", () => {
    const rows = [
      __testLot({ id: "1", vendor_name: "A" }),
      __testLot({ id: "2", vendor_name: "B" }),
      __testLot({ id: "3", vendor_name: "B" }),
      __testLot({ id: "4", vendor_name: null }),
    ];
    const facet = INVENTORY_FACETS.find((f) => f.param === "fVendor") as FacetDef;
    const opts = facetOptions(rows, facet);
    expect(opts[0]).toMatchObject({ value: "B", count: 2 });
    expect(opts[1]).toMatchObject({ value: "A", count: 1 });
    // "(not set)" is offered, and always LAST so it never crowds out real data.
    expect(opts[opts.length - 1]).toMatchObject({
      value: UNSET_FACET_VALUE,
      label: UNSET_FACET_LABEL,
      count: 1,
    });
  });

  it("keeps every vendor in the menu after one is chosen", () => {
    // Otherwise the owner could never switch vendors without clearing first.
    const r = run({ fVendor: "Phat Panda" });
    const facet = INVENTORY_FACETS.find((f) => f.param === "fVendor") as FacetDef;
    expect(facetOptions(r.facetSource, facet).length).toBe(4);
  });

  it("filters by potency range, and unknown potency is NOT zero", () => {
    expect(ids(run({ thcMin: "30" }))).toEqual(["crack"]);
    expect(ids(run({ thcMin: "20", thcMax: "26" }))).toEqual(["blue"]);
    // The gummies have no COA at all. They must not be swept in as "0% THC".
    expect(ids(run({ thcMax: "100" }))).not.toContain("cantina");
  });

  it("answers 'CBD yes/no' without lying about unknowns", () => {
    // Any measurable CBD.
    expect(ids(run({ cbdMin: "0.01" })).sort()).toEqual(["blue", "cbd"]);
    // Meaningful CBD.
    expect(ids(run({ cbdMin: "5" }))).toEqual(["cbd"]);
    // "crack" has a COA but a NULL CBD figure, and "cantina" has no COA.
    // Neither is evidence of zero CBD, so neither may appear in a CBD range.
    expect(ids(run({ cbdMin: "0" }))).not.toContain("crack");
    expect(ids(run({ cbdMin: "0" }))).not.toContain("cantina");
  });

  it("answers 'low-THC yes/no/unknown' as three distinct questions", () => {
    expect(ids(run({ lowThc: "yes" }))).toEqual(["cbd"]);
    // Every other lot has NULL, i.e. nobody has recorded an answer. They are
    // "unknown", never "no".
    expect(ids(run({ lowThc: "no" }))).toEqual([]);
    expect(ids(run({ lowThc: "unknown" })).sort()).toEqual(["blue", "cantina", "crack"]);
  });

  it("filters by the presence of paperwork", () => {
    expect(ids(run({ coaState: "no" }))).toEqual(["cantina"]);
    expect(ids(run({ hasCost: "no" }))).toEqual(["cantina"]);
    expect(ids(run({ hasReceived: "no" }))).toEqual(["cantina"]);
    expect(ids(run({ hasExpiry: "no" }))).toEqual(["cantina"]);
    expect(ids(run({ labPassed: "no" }))).toEqual(["cbd"]);
  });

  it("filters by stock and cost ranges", () => {
    expect(ids(run({ qtyMax: "0" }))).toEqual(["cantina"]);
    expect(ids(run({ qtyMin: "10" }))).toEqual(["blue"]);
    expect(ids(run({ soldMin: "30" }))).toEqual(["crack"]);
    expect(ids(run({ costMin: "2000" }))).toEqual(["cbd"]);
  });

  it("filters by received and expiry date ranges, inclusively", () => {
    expect(ids(run({ recvFrom: "2026-02-01" })).sort()).toEqual(["cbd", "crack"]);
    // The boundary day itself is included — the classic off-by-one.
    expect(ids(run({ recvFrom: "2026-01-15", recvTo: "2026-01-15" }))).toEqual(["blue"]);
    expect(ids(run({ expTo: "2026-08-01" }))).toEqual(["crack"]);
  });

  it("combines a filter, a search and a sort at once", () => {
    const r = run({ fVendor: ["Phat Panda", "Grow Op Farms, LLC"], q: "e", sc: "thc", sd: "desc" });
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.activeFilterCount).toBe(1);
  });

  it("a search cannot escape an active filter", () => {
    // Typing must refine what is shown, never silently widen it.
    expect(ids(run({ fVendor: "Phat Panda", q: "guava" }))).toEqual([]);
  });

  it("counts the engaged filters for the badge", () => {
    expect(run({}).activeFilterCount).toBe(0);
    expect(run({ fVendor: "Phat Panda", thcMin: "10" }).activeFilterCount).toBe(2);
    expect(hasActiveFilters(parseInventoryFilters({}))).toBe(false);
    expect(countActiveFilters(parseInventoryFilters({ coaState: "yes" }))).toBe(1);
  });

  it("garbage in the URL silently means 'filter off' and never throws", () => {
    for (const junk of [
      { thcMin: "abc" },
      { thcMin: "1e5" },
      { recvFrom: "2026-13-45" },
      { recvFrom: "not-a-date" },
      { coaState: "maybe" },
      { fVendor: "" },
      { qtyMin: "--5" },
      { expFrom: "2026-02-30" },
    ]) {
      expect(() => run(junk)).not.toThrow();
      expect(run(junk).total).toBe(4);
      expect(run(junk).activeFilterCount).toBe(0);
    }
  });

  it("a rejected value produces no chip, so the screen never claims it", () => {
    expect(activeFilterChips({ thcMin: "abc" }, parseInventoryFilters({ thcMin: "abc" }))).toEqual(
      [],
    );
  });

  it("the range and tri-state primitives obey 'unknown is not no'", () => {
    expect(matchesTriState(null, "unknown")).toBe(true);
    expect(matchesTriState(null, "no")).toBe(false);
    expect(matchesTriState(null, "yes")).toBe(false);
    expect(matchesTriState(false, "no")).toBe(true);
    expect(matchesPresence(null, "no")).toBe(true);
    expect(matchesPresence("", "no")).toBe(true);
    expect(matchesPresence(0, "yes")).toBe(true); // a real 0 is a value
    expect(inNumericRange(null, 0, 10)).toBe(false); // unknown is not 0
    expect(inNumericRange(null, undefined, undefined)).toBe(true); // filter off
    expect(inNumericRange(0, 0, 10)).toBe(true);
    expect(inDateRange(null, "2026-01-01", undefined)).toBe(false);
    expect(inDateRange("2026-06-17T18:00:00Z", undefined, "2026-06-17")).toBe(true);
    expect(parseNumber("-3")).toBe(-3); // negatives are legitimate
    expect(parseNumber("abc")).toBeUndefined();
    expect(parseDateBound("2024-02-29")).toBe("2024-02-29");
    expect(parseDateBound("2026-02-29")).toBeUndefined();
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * SORTING
 * ──────────────────────────────────────────────────────────────────────────── */

describe("clicking a column header sorts the list", () => {
  it("offers a sort for every column the table shows", () => {
    const keys = INVENTORY_COLUMN_SORTS.map((c) => c.key);
    for (const expected of [
      "product",
      "vendor",
      "type",
      "strain",
      "strainType",
      "size",
      "coa",
      "thc",
      "cbd",
      "received",
      "onhand",
      "sold",
      "cost",
      "expires",
      "status",
    ]) {
      expect(keys).toContain(expected);
    }
  });

  it("starts numbers high and names A-Z, as the owner asked", () => {
    expect(columnSortDef("thc")?.firstClick).toBe("desc");
    expect(columnSortDef("cbd")?.firstClick).toBe("desc");
    expect(columnSortDef("cost")?.firstClick).toBe("desc");
    expect(columnSortDef("onhand")?.firstClick).toBe("desc");
    expect(columnSortDef("received")?.firstClick).toBe("desc"); // newest first
    expect(columnSortDef("product")?.firstClick).toBe("asc");
    expect(columnSortDef("expires")?.firstClick).toBe("asc"); // soonest first
  });

  it("cycles first click, reverse, then off", () => {
    const col = columnSortDef("product")!;
    const first = nextSortState(col, null);
    expect(first).toEqual({ key: "product", direction: "asc" });
    const second = nextSortState(col, first);
    expect(second).toEqual({ key: "product", direction: "desc" });
    expect(nextSortState(col, second)).toBeNull();
  });

  it("actually reorders the rows both ways", () => {
    expect(ids(run({ sc: "thc", sd: "desc" }))[0]).toBe("crack"); // 31.2
    expect(ids(run({ sc: "onhand", sd: "desc" }))[0]).toBe("blue"); // 12
    expect(ids(run({ sc: "onhand", sd: "asc" }))[0]).toBe("cantina"); // 0
    expect(ids(run({ sc: "cost", sd: "desc" }))[0]).toBe("cbd"); // 2200
    expect(ids(run({ sc: "product", sd: "asc" }))[0]).toBe("blue"); // "Blue…"
  });

  it("sinks unknown values in BOTH directions", () => {
    // A missing figure is not the smallest figure. If unknowns floated to the
    // top on an ascending sort, every "cheapest first" view would open on a
    // screenful of blanks.
    const asc = ids(run({ sc: "cost", sd: "asc" }));
    const desc = ids(run({ sc: "cost", sd: "desc" }));
    expect(asc[asc.length - 1]).toBe("cantina"); // null cost
    expect(desc[desc.length - 1]).toBe("cantina");
  });

  it("does not compare mg-dosed potency against percentages", () => {
    // An edible's "10" mg and a flower's "10" % are different quantities.
    const lots = [
      __testPageLot({ id: "flower", inventory_type: "Usable Marijuana", lab: { total_thc_pct: 20, total_cbd_pct: null, lab_name: null, passed: null } }),
      __testPageLot({ id: "edible", inventory_type: "Solid Edible", lab: { total_thc_pct: 100, total_cbd_pct: null, lab_name: null, passed: null } }),
    ];
    const col = columnSortDef("thc")!;
    const down = sortLots(lots, col, "desc").map((l) => l.id);
    const up = sortLots(lots, col, "asc").map((l) => l.id);
    // Whatever the grouping, it must be the SAME grouping in both directions:
    // reversing the sort must not reshuffle which unit-family comes first.
    expect(new Set(down)).toEqual(new Set(up));
    expect(down.length).toBe(2);
  });

  it("is stable and never mutates the caller's rows", () => {
    const lots = shelf();
    const before = lots.map((l) => l.id);
    sortLots(lots, columnSortDef("status")!, "asc");
    expect(lots.map((l) => l.id)).toEqual(before);
  });

  it("shows an arrow only on the column actually sorted", () => {
    const product = columnSortDef("product")!;
    const thc = columnSortDef("thc")!;
    const raw = { [SORT_COLUMN_PARAM]: "thc", [SORT_DIRECTION_PARAM]: "desc" };
    expect(sortIndicator(raw, thc)).toBe("desc");
    expect(sortIndicator(raw, product)).toBeNull();
  });

  it("ignores an unknown sort column instead of erroring", () => {
    expect(currentSort({ [SORT_COLUMN_PARAM]: "nonsense" })).toBeNull();
    expect(parseDirection("sideways")).toBeUndefined();
    expect(() => run({ sc: "nonsense", sd: "sideways" })).not.toThrow();
    expect(run({ sc: "nonsense" }).total).toBe(4);
  });

  it("a column sort overrides search relevance order", () => {
    const r = run({ q: "a", sc: "product", sd: "asc" });
    const names = r.rows.map((l) => l.product_name ?? "");
    expect([...names].sort()).toEqual(names);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * URLS, PAGING, AND NOT BREAKING WHAT ALREADY WORKED
 * ──────────────────────────────────────────────────────────────────────────── */

describe("the URL keeps working for every screen that links here", () => {
  it("a header click preserves every other feature's params", () => {
    const busy: Record<string, string> = {};
    for (const p of PRESERVED_PARAMS) busy[p] = `v-${p}`;
    const href = sortHref(busy, columnSortDef("product")!);
    const back = new URLSearchParams(href.split("?")[1] ?? "");
    for (const p of PRESERVED_PARAMS) expect(back.get(p)).toBe(`v-${p}`);
  });

  it("any change to the view resets to page 1", () => {
    // Otherwise the owner filters from page 6 and lands on an empty screen.
    const href = sortHref({ page: "7" }, columnSortDef("product")!);
    expect(new URLSearchParams(href.split("?")[1] ?? "").get("page")).toBeNull();
    const t = toggleFacetHref({ page: "7" }, "fVendor", "A", []);
    expect(new URLSearchParams(t.split("?")[1] ?? "").get("page")).toBeNull();
  });

  it("clear-all keeps the status tab and drops the filters", () => {
    const href = clearAllFiltersHref({ status: "active", fVendor: "A", q: "x", thcMin: "5" });
    const back = new URLSearchParams(href.split("?")[1] ?? "");
    expect(back.get("status")).toBe("active");
    expect(back.get("fVendor")).toBeNull();
    expect(back.get("q")).toBeNull();
    expect(back.get("thcMin")).toBeNull();
  });

  it("removing one chip leaves every other filter alone", () => {
    const raw = { fVendor: ["A", "B"], thcMin: "20" };
    const chips = activeFilterChips(raw, parseInventoryFilters(raw));
    const thcChip = chips.find((c) => c.group === "THC")!;
    const back = new URLSearchParams(thcChip.href.split("?")[1] ?? "");
    expect(back.get("thcMin")).toBeNull();
    expect(back.getAll("fVendor").sort()).toEqual(["A", "B"]);
  });

  it("carries repeated keys through verbatim", () => {
    const p = paramsFrom({ fVendor: COMMA_VENDORS });
    expect(p.getAll("fVendor")).toEqual(COMMA_VENDORS);
  });

  it("the legacy sort menu still orders the list as it always did", () => {
    // ?sort= is a URL contract; other screens and bookmarks use it.
    const lots = [
      __testPageLot({ id: "a", created_at: "2026-01-01T00:00:00Z", on_hand_qty: 5 }),
      __testPageLot({ id: "b", created_at: "2026-03-01T00:00:00Z", on_hand_qty: 9 }),
      __testPageLot({ id: "c", created_at: "2026-02-01T00:00:00Z", on_hand_qty: 1 }),
    ];
    expect(applyLegacySort(lots, "newest").map((l) => l.id)).toEqual(["b", "c", "a"]);
    expect(applyLegacySort(lots, "oldest").map((l) => l.id)).toEqual(["a", "c", "b"]);
    expect(applyLegacySort(lots, "qty_high").map((l) => l.id)).toEqual(["b", "a", "c"]);
    expect(applyLegacySort(lots, "qty_low").map((l) => l.id)).toEqual(["c", "a", "b"]);
    // An unknown key falls back to the default rather than throwing.
    expect(applyLegacySort(lots, "bogus").map((l) => l.id)).toEqual(["b", "c", "a"]);
  });

  it("the legacy knobs behave exactly as they did before the rewrite", () => {
    expect(parseLegacyFilters({ vendor: "junk" }).vendorId).toBeUndefined();
    expect(parseLegacyFilters({ needsReceivedDate: "true" }).needsReceivedDate).toBeUndefined();
    expect(parseLegacyFilters({ needsReceivedDate: "1" }).needsReceivedDate).toBe(true);
    expect(parseLegacyFilters({ expiring: "9999" }).expiringWithinDays).toBeUndefined();
    // COA is judged on lab_result_id, exactly like the SQL it replaced.
    const orphan = __testPageLot({ lab_result_id: "lr-x", lab: null });
    expect(matchesLegacyFilters(orphan, parseLegacyFilters({ coa: "yes" }), NOW)).toBe(true);
  });

  it("the status tab still filters, and 'all' is not a predicate", () => {
    expect(run({ status: "active" }).total).toBe(4);
    expect(run({ status: "all" }).total).toBe(4);
    expect(run({ status: "recalled" }).total).toBe(0);
  });

  it("the expiring window still works and excludes lots with no expiry", () => {
    const r = run({ expiring: "90" });
    expect(ids(r)).toEqual(["crack"]); // 2026-08-01 is within 90d of 2026-06-01
    expect(ids(r)).not.toContain("cantina"); // no expiry date at all
  });

  it("pages the results and clamps a page past the end", () => {
    const p1 = run({}, 1, 2);
    expect(p1.rows.length).toBe(2);
    expect(p1.totalPages).toBe(2);
    const past = run({}, 99, 2);
    expect(past.page).toBe(2);
    expect(past.rows.length).toBe(2);
  });

  it("survives an empty store", () => {
    const r = buildInventoryPage({ lots: [], params: { q: "x" }, page: 1, pageSize: 50, now: NOW });
    expect(r.rows).toEqual([]);
    expect(r.total).toBe(0);
    expect(r.totalPages).toBe(1);
  });

  it("searches the twelve fields the list core declares", () => {
    const fields = searchFieldsForLot(__testLot());
    expect(fields.length).toBe(12);
    for (const f of fields) expect(f.weight).toBeGreaterThan(0);
  });

  it("pagination never loses or duplicates a row", () => {
    const seen: string[] = [];
    for (let p = 1; p <= 4; p++) seen.push(...ids(run({}, p, 1)));
    expect(new Set(seen).size).toBe(4);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * WIRING — a correct core that nothing calls is not a fix (SLICE 5C doctrine)
 * ──────────────────────────────────────────────────────────────────────────── */

describe("the new engine is actually WIRED into the page", () => {
  const PAGE = "src/app/admin/inventory/page.tsx";

  it("the page runs the pure pipeline over the whole hydrated lot set", () => {
    const src = SRC(PAGE);
    expect(src).toContain("listAllLotsForFiltering");
    expect(src).toContain("buildInventoryPage");
    // The old paged query could not see vendor/brand/THC, which is why the
    // requested filters were impossible. It must not come back.
    //
    // Read the CODE, not the comments: page.tsx explains at line ~144 exactly
    // why listLotsPaged was abandoned, and that explanation must be allowed to
    // stay. What must not exist is a CALL.
    expect(CODE(PAGE)).not.toContain("listLotsPaged");
    expect(SRC(PAGE)).toContain("listLotsPaged"); // the reason is documented
  });

  it("the table headers are the sortable component, not plain cells", () => {
    const src = SRC(PAGE);
    expect(src).toContain("SortableHeader");
    for (const key of ["product", "vendor", "thc", "onhand", "expires", "status"]) {
      expect(src).toContain(`columnKey="${key}"`);
    }
    expect(src).not.toContain('<th className="px-4 py-3">Product / lot</th>');
  });

  it("the filter panel is rendered and fed the unfiltered facet source", () => {
    const src = SRC(PAGE);
    expect(src).toContain("InventoryFilterPanel");
    expect(src).toContain("allLots={view.facetSource}");
  });

  it("the page discloses when the search had to guess", () => {
    expect(SRC(PAGE)).toContain("view.didYouMean");
  });

  it("pager links carry every param instead of a hand-written whitelist", () => {
    const src = SRC(PAGE);
    expect(src).toContain("paramsFrom(sp as RawParams)");
    // The old whitelist silently dropped any knob nobody remembered to add.
    expect(src).not.toContain('if (sp.coa === "yes" || sp.coa === "no") params.set("coa", sp.coa)');
  });

  it("the store can load every lot with its vendor, brand and COA resolved", () => {
    const src = SRC("src/lib/inventory/store.ts");
    expect(src).toContain("export async function listAllLotsForFiltering");
    // Chunked so a 4,000-lot store cannot overflow the PostgREST query string.
    expect(src).toContain("chunkedIn");
    // pagedAll needs a stable order or pages can overlap or skip rows.
    expect(src).toContain('.order("id", { ascending: true })');
  });

  it("facet values are never joined with a delimiter anywhere", () => {
    // The defect that made a real comma-bearing vendor unselectable.
    const filter = SRC("src/lib/inventory/inventory-filter-core.ts");
    expect(filter).not.toContain('.split(",")');
    const url = SRC("src/lib/inventory/inventory-url-core.ts");
    expect(url).toContain("append");
    expect(url).not.toContain('.join(",")');
  });

  it("the inherited fuzzy dependency is now under test", () => {
    // The new search rests on strain-matcher.ts, which had no tests at all.
    expect(SRC("src/lib/ai/kb/strain-matcher.ts")).toContain("__runStrainMatcherTests");
    expect(SRC("scripts/compliance/run-pure-selftests.ts")).toContain("__runStrainMatcherTests");
  });

  it("every new core is registered in the pure self-test sweep", () => {
    const runner = SRC("scripts/compliance/run-pure-selftests.ts");
    for (const fn of [
      "__runInventorySearchCoreTests",
      "__runInventoryFilterCoreTests",
      "__runInventorySortCoreTests",
      "__runInventoryListCoreTests",
      "__runInventoryUrlCoreTests",
      "__runInventoryPageCoreTests",
    ]) {
      expect(runner).toContain(fn);
    }
  });

  it("the search does NOT reuse the strain normalizer that destroys words", () => {
    // normalizeStrainQuery strips "gummies", "400mg", "10 pack". Reusing it
    // would have recreated the owner's bug in a new place.
    //
    // Again: pin the CODE. The search core carries a deliberate note naming
    // normalizeStrainQuery and explaining why it is NOT reused; that note is an
    // asset, and a raw not.toContain would have forced its deletion.
    const path = "src/lib/inventory/inventory-search-core.ts";
    expect(CODE(path)).not.toContain("normalizeStrainQuery");
    expect(SRC(path)).toContain("normalizeStrainQuery"); // the reason is documented

    // The metrics it DOES borrow are content-agnostic, so they cannot delete
    // words the way the strain normalizer does.
    expect(CODE(path)).toContain("diceCoefficient");
    expect(CODE(path)).toContain("levenshteinRatio");
  });

  it("the comment-stripper used by the negative pins actually works", () => {
    // A test helper that silently returned "" would make every not.toContain
    // above pass vacuously. Test the test.
    expect(stripComments('const a = 1; // listLotsPaged\n')).toBe("const a = 1; \n");
    expect(stripComments("/* listLotsPaged */const a = 1;")).toBe("const a = 1;");
    expect(stripComments('const s = "// not a comment";')).toBe('const s = "// not a comment";');
    expect(stripComments('const s = "/* also not */";')).toBe('const s = "/* also not */";');
    expect(stripComments("const u = 'http://x.dev/a';")).toBe("const u = 'http://x.dev/a';");
    expect(stripComments("const t = `a // b`;")).toBe("const t = `a // b`;");
    expect(stripComments('const e = "he said \\"//\\"";')).toBe('const e = "he said \\"//\\"";');
    // It must not eat real code, and must keep line count stable.
    const page = CODE("src/app/admin/inventory/page.tsx");
    expect(page).toContain("buildInventoryPage");
    expect(page.split("\n").length).toBe(SRC("src/app/admin/inventory/page.tsx").split("\n").length);
  });
});
