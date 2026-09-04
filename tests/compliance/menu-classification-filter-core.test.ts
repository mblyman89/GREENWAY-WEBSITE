/**
 * SLICE 18B — the Shop sidebar's dynamic sales-limit classification facet.
 *
 * Michael: "Our filters are dynamic and appear in the list when there are
 * products with those traits in the menu." These pins lock the DATA-DRIVEN,
 * HONEST behavior so the sidebar can trust the core:
 *
 *   - lanes only exist for classifications actually present in the live menu
 *     (nothing qualifying → NO options → the section never renders),
 *   - a lane is earned by what the REGISTER would do, not by a raw boolean,
 *   - the matcher: null/blank/junk id passes everything; a lane keeps only its
 *     own qualifying products,
 *   - the back-office ↔ shop bridge (href + lane) can never drift.
 *
 * The single most important property proved here is AGREEMENT WITH THE TILL. A
 * facet that advertised "Low-THC Beverages" for a product the register still
 * counts in the 72 oz bucket would be a public, compliance-adjacent lie.
 */
import { describe, expect, it } from "vitest";

import type { GreenwayMenuItem } from "@/lib/leafly/types";
import {
  CLASSIFICATION_FILTER_HELP,
  CLASSIFICATION_FILTER_KINDS,
  CLASSIFICATION_FILTER_LABELS,
  CLASSIFICATION_FILTER_LOW_THC_ID,
  CLASSIFICATION_FILTER_OTHERWISE_TAKEN_ID,
  classificationBucketLabel,
  classificationFilterId,
  classificationKindForItem,
  classificationKindFromId,
  classificationShopHref,
  findClassificationFilterOption,
  itemHasClassification,
  itemMatchesClassificationFilter,
  menuItemToLimitLine,
  resolveClassificationFilterOptions,
} from "@/lib/menu/menu-classification-filter-core";
import {
  LIMIT_BUCKET_LABELS,
  LOW_THC_UNIT_MAX_MG,
  lineBucket,
  qualifiesAsLowThcLiquid,
  qualifiesAsOtherwiseTaken,
} from "@/lib/compliance/sales-limits-core";

const item = (over: Partial<GreenwayMenuItem> & { id: string }): GreenwayMenuItem =>
  ({
    name: "Test Item",
    brand: "Test Brand",
    // `edible-liquid` (NOT "drinks") — the liquid slugs are verified against
    // sales-limits-core categoryToBucket(). There is no `drinks` slug.
    category: "edible-liquid",
    priceMinorUnits: 3000,
    ...over,
  }) as GreenwayMenuItem;

/** A fully-qualifying low-THC beverage. */
const drink = (id: string, over: Partial<GreenwayMenuItem> = {}) =>
  item({ id, category: "edible-liquid", lowThcLiquid: true, unitThcMg: 4, ...over });

/** A fully-qualifying suppository. */
const supp = (id: string, over: Partial<GreenwayMenuItem> = {}) =>
  item({ id, category: "topical", otherwiseTaken: true, unitsPerPackage: 6, ...over });

describe("classification facet: resolve is dynamic + honest", () => {
  it("nothing qualifying → no options (the section never renders)", () => {
    expect(resolveClassificationFilterOptions([])).toHaveLength(0);
    expect(
      resolveClassificationFilterOptions([item({ id: "a" }), item({ id: "b", category: "flower" })]),
    ).toHaveLength(0);
  });

  it("a flag alone does NOT conjure a lane — the register's rules decide", () => {
    // Flag true, but no per-unit mg → the till still counts it as a 72 oz
    // liquid, so the shop must not advertise it as a low-THC beverage.
    expect(
      resolveClassificationFilterOptions([item({ id: "a", lowThcLiquid: true })]),
    ).toHaveLength(0);
    // Flag true, but over the 4 mg ceiling.
    expect(
      resolveClassificationFilterOptions([item({ id: "a", lowThcLiquid: true, unitThcMg: 9 })]),
    ).toHaveLength(0);
    // Flag true on the wrong bucket entirely (the statutory guard rail).
    expect(
      resolveClassificationFilterOptions([
        item({ id: "a", category: "flower", lowThcLiquid: true, unitThcMg: 4 }),
      ]),
    ).toHaveLength(0);
    expect(
      resolveClassificationFilterOptions([item({ id: "a", category: "flower", otherwiseTaken: true })]),
    ).toHaveLength(0);
  });

  it("only the lane that has qualifying products appears, with a real count", () => {
    const opts = resolveClassificationFilterOptions([
      drink("d1"),
      drink("d2"),
      item({ id: "p", category: "flower" }),
    ]);
    expect(opts).toHaveLength(1);
    expect(opts[0]).toMatchObject({
      id: CLASSIFICATION_FILTER_LOW_THC_ID,
      kind: "low_thc_liquid",
      label: CLASSIFICATION_FILTER_LABELS.low_thc_liquid,
      count: 2,
    });
    expect(opts[0].help).toBe(CLASSIFICATION_FILTER_HELP.low_thc_liquid);
  });

  it("both lanes present → stable order and independent counts, regardless of input order", () => {
    const opts = resolveClassificationFilterOptions([supp("s1"), drink("d1"), supp("s2")]);
    expect(opts.map((o) => o.kind)).toEqual(["low_thc_liquid", "otherwise_taken"]);
    expect(opts.map((o) => o.count)).toEqual([1, 2]);

    // Reversing the input must not reorder the lanes: the sidebar's order is a
    // product decision, not an accident of database ordering.
    const reversed = resolveClassificationFilterOptions([supp("s2"), drink("d1"), supp("s1")].reverse());
    expect(reversed.map((o) => o.kind)).toEqual(["low_thc_liquid", "otherwise_taken"]);
  });

  it("lane order matches the declared CLASSIFICATION_FILTER_KINDS", () => {
    const opts = resolveClassificationFilterOptions([drink("d"), supp("s")]);
    expect(opts.map((o) => o.kind)).toEqual([...CLASSIFICATION_FILTER_KINDS]);
  });
});

describe("classification facet: the lane agrees with the REGISTER", () => {
  it("itemHasClassification is exactly the register's predicate", () => {
    // Cross-check against sales-limits-core directly over a matrix, so the two
    // can never drift apart without this test failing.
    const cases: GreenwayMenuItem[] = [
      drink("a"),
      supp("b"),
      item({ id: "c", lowThcLiquid: true }),
      item({ id: "d", lowThcLiquid: true, unitThcMg: 5 }),
      item({ id: "e", lowThcLiquid: true, unitThcMg: 0 }),
      item({ id: "f", category: "flower", lowThcLiquid: true, unitThcMg: 4 }),
      item({ id: "g", category: "flower", otherwiseTaken: true }),
      item({ id: "h", category: "tincture", otherwiseTaken: true }),
      item({ id: "i" }),
    ];
    for (const candidate of cases) {
      const line = menuItemToLimitLine(candidate);
      expect(itemHasClassification(candidate, "low_thc_liquid")).toBe(qualifiesAsLowThcLiquid(line));
      expect(itemHasClassification(candidate, "otherwise_taken")).toBe(qualifiesAsOtherwiseTaken(line));
    }
  });

  it("the adapter asks about ONE product and normalizes absent fields to null", () => {
    expect(menuItemToLimitLine(item({ id: "a" }))).toMatchObject({
      quantity: 1,
      lowThcLiquid: null,
      unitThcMg: null,
      otherwiseTaken: null,
      unitsPerPackage: null,
    });
  });

  it("a flag that is not LITERALLY true never widens an allowance", () => {
    expect(
      itemHasClassification(
        item({ id: "a", category: "topical", otherwiseTaken: "true" as unknown as boolean }),
        "otherwise_taken",
      ),
    ).toBe(false);
    expect(
      itemHasClassification(
        item({ id: "a", lowThcLiquid: 1 as unknown as boolean, unitThcMg: 4 }),
        "low_thc_liquid",
      ),
    ).toBe(false);
  });

  it("classificationKindForItem resolves a dual-flagged product the way lineBucket does", () => {
    const both = item({
      id: "x",
      category: "topical",
      otherwiseTaken: true,
      lowThcLiquid: true,
      unitThcMg: 4,
    });
    // The register routes a both-flagged line to the ITEM-COUNTED bucket
    // because ten units is the tighter cap. The shop must agree.
    expect(lineBucket(menuItemToLimitLine(both))).toBe("otherwise_taken");
    expect(classificationKindForItem(both)).toBe("otherwise_taken");
  });

  it("classificationKindForItem is null for anything the register would not route", () => {
    expect(classificationKindForItem(item({ id: "a", category: "flower" }))).toBeNull();
    expect(classificationKindForItem(item({ id: "b", lowThcLiquid: true }))).toBeNull();
    expect(classificationKindForItem(drink("c"))).toBe("low_thc_liquid");
    expect(classificationKindForItem(supp("d"))).toBe("otherwise_taken");
  });
});

describe("classification facet: the matcher", () => {
  it("null / blank / unknown id passes everything (never an inexplicable empty grid)", () => {
    const flower = item({ id: "a", category: "flower" });
    expect(itemMatchesClassificationFilter(flower, null)).toBe(true);
    expect(itemMatchesClassificationFilter(flower, "")).toBe(true);
    expect(itemMatchesClassificationFilter(flower, "   ")).toBe(true);
    expect(itemMatchesClassificationFilter(flower, "bogus")).toBe(true);
  });

  it("a lane keeps only its own qualifying products", () => {
    expect(itemMatchesClassificationFilter(drink("d"), CLASSIFICATION_FILTER_LOW_THC_ID)).toBe(true);
    expect(itemMatchesClassificationFilter(supp("s"), CLASSIFICATION_FILTER_LOW_THC_ID)).toBe(false);
    expect(
      itemMatchesClassificationFilter(supp("s"), CLASSIFICATION_FILTER_OTHERWISE_TAKEN_ID),
    ).toBe(true);
    expect(
      itemMatchesClassificationFilter(drink("d"), CLASSIFICATION_FILTER_OTHERWISE_TAKEN_ID),
    ).toBe(false);
    expect(
      itemMatchesClassificationFilter(item({ id: "f", category: "flower" }), CLASSIFICATION_FILTER_LOW_THC_ID),
    ).toBe(false);
  });

  it("filtering a menu by a lane returns exactly the lane's count", () => {
    const menu = [drink("d1"), drink("d2"), supp("s1"), item({ id: "f", category: "flower" })];
    const opts = resolveClassificationFilterOptions(menu);
    for (const option of opts) {
      const kept = menu.filter((m) => itemMatchesClassificationFilter(m, option.id));
      // The count on the checkbox must equal what clicking it actually yields.
      // A mismatch here is the classic "filter says 5, grid shows 3" bug.
      expect(kept).toHaveLength(option.count);
    }
  });
});

describe("classification facet: ids, links and vocabulary", () => {
  it("ids round-trip and junk fails closed", () => {
    expect(classificationFilterId("low_thc_liquid")).toBe(CLASSIFICATION_FILTER_LOW_THC_ID);
    expect(classificationFilterId("otherwise_taken")).toBe(CLASSIFICATION_FILTER_OTHERWISE_TAKEN_ID);
    expect(classificationKindFromId(CLASSIFICATION_FILTER_LOW_THC_ID)).toBe("low_thc_liquid");
    expect(classificationKindFromId("  otherwise-taken ")).toBe("otherwise_taken");
    expect(classificationKindFromId("nope")).toBeNull();
    expect(classificationKindFromId(null)).toBeNull();
    expect(classificationKindFromId(undefined)).toBeNull();
    expect(classificationKindFromId("")).toBeNull();
  });

  it("the URL tokens are pinned (changing them breaks shared links)", () => {
    expect(CLASSIFICATION_FILTER_LOW_THC_ID).toBe("low-thc");
    expect(CLASSIFICATION_FILTER_OTHERWISE_TAKEN_ID).toBe("otherwise-taken");
  });

  it("the back-office shop link round-trips through the shop's own parser", () => {
    for (const kind of CLASSIFICATION_FILTER_KINDS) {
      const href = classificationShopHref(kind);
      expect(href.startsWith("/menu?classification=")).toBe(true);
      const token = new URL(href, "https://example.com").searchParams.get("classification");
      expect(classificationKindFromId(token)).toBe(kind);
    }
  });

  it("compliance wording comes from the register's own label table", () => {
    expect(classificationBucketLabel("low_thc_liquid")).toBe(LIMIT_BUCKET_LABELS.low_thc_liquid);
    expect(classificationBucketLabel("otherwise_taken")).toBe(LIMIT_BUCKET_LABELS.otherwise_taken);
  });

  it("shopper labels are plain language, and the help quotes the statutory ceiling", () => {
    expect(CLASSIFICATION_FILTER_LABELS.low_thc_liquid).toBe("Low-THC Beverages");
    expect(CLASSIFICATION_FILTER_LABELS.otherwise_taken).toBe("Suppositories");
    // Derived from the constant, so a rule change cannot leave stale copy.
    expect(CLASSIFICATION_FILTER_HELP.low_thc_liquid).toContain(String(LOW_THC_UNIT_MAX_MG));
  });

  it("find returns the option or null", () => {
    const opts = resolveClassificationFilterOptions([drink("d"), supp("s")]);
    expect(findClassificationFilterOption(opts, CLASSIFICATION_FILTER_LOW_THC_ID)?.kind).toBe(
      "low_thc_liquid",
    );
    expect(findClassificationFilterOption(opts, "nope")).toBeNull();
    expect(findClassificationFilterOption(opts, null)).toBeNull();
    expect(findClassificationFilterOption([], CLASSIFICATION_FILTER_LOW_THC_ID)).toBeNull();
  });
});
