/**
 * SLICE E (SHOP-5) — the Shop sidebar's dynamic DOH filter.
 *
 * Michael: "dynamic DOH filter checkbox." These pins lock the DATA-DRIVEN,
 * HONEST behavior so the sidebar can trust the core:
 *   - options only exist for DOH states actually present in the live menu (so
 *     an empty medical registry → NO options → the section never renders),
 *   - a single present category collapses to the umbrella lane only (no
 *     redundant duplicate checkbox),
 *   - mixed categories add one lane each in canonical DOH order with real
 *     counts,
 *   - the matcher: null id passes everything; the umbrella keeps any compliant
 *     item; a per-category lane keeps only that category.
 */
import { describe, expect, it } from "vitest";

import type { GreenwayMenuItem } from "@/lib/leafly/types";
import {
  DOH_FILTER_ALL_ID,
  DOH_FILTER_ALL_LABEL,
  dohFilterCategoryFromId,
  dohFilterCategoryId,
  findDohFilterOption,
  itemMatchesDohFilter,
  resolveDohFilterOptions,
} from "@/lib/menu/menu-doh-filter-core";

const item = (over: Partial<GreenwayMenuItem> & { id: string }): GreenwayMenuItem =>
  ({
    name: "Test Item",
    brand: "Test Brand",
    category: "flower",
    priceMinorUnits: 3000,
    ...over,
  }) as GreenwayMenuItem;

describe("DOH filter: resolveDohFilterOptions is dynamic + honest", () => {
  it("no compliant items → no options (section never renders)", () => {
    expect(resolveDohFilterOptions([]).length).toBe(0);
    expect(
      resolveDohFilterOptions([item({ id: "a", dohCompliant: false, dohCategory: null })]).length,
    ).toBe(0);
  });

  it("a single present category collapses to the umbrella lane only", () => {
    const opts = resolveDohFilterOptions([
      item({ id: "a", dohCompliant: true, dohCategory: "high_thc" }),
      item({ id: "b", dohCompliant: true, dohCategory: "high_thc" }),
    ]);
    expect(opts).toHaveLength(1);
    expect(opts[0]).toMatchObject({ id: DOH_FILTER_ALL_ID, label: DOH_FILTER_ALL_LABEL, category: null, count: 2 });
  });

  it("mixed categories → umbrella + one lane each, canonical order, real counts", () => {
    const opts = resolveDohFilterOptions([
      item({ id: "a", dohCompliant: true, dohCategory: "high_cbd" }),
      item({ id: "b", dohCompliant: true, dohCategory: "high_thc" }),
      item({ id: "c", dohCompliant: true, dohCategory: "general_use" }),
      item({ id: "d", dohCompliant: true, dohCategory: "high_thc" }),
      item({ id: "e", dohCompliant: false, dohCategory: null }),
    ]);
    expect(opts.map((o) => o.id)).toEqual([
      DOH_FILTER_ALL_ID,
      "doh:general_use",
      "doh:high_thc",
      "doh:high_cbd",
    ]);
    expect(opts[0].count).toBe(4);
    expect(opts.find((o) => o.id === "doh:high_thc")?.count).toBe(2);
  });
});

describe("DOH filter: itemMatchesDohFilter", () => {
  it("null/blank active id passes everything", () => {
    expect(itemMatchesDohFilter(item({ id: "a", dohCompliant: false, dohCategory: null }), null)).toBe(true);
    expect(itemMatchesDohFilter(item({ id: "a", dohCompliant: false, dohCategory: null }), "  ")).toBe(true);
  });

  it("umbrella keeps any compliant, drops non-compliant", () => {
    expect(itemMatchesDohFilter(item({ id: "a", dohCompliant: true, dohCategory: "high_thc" }), DOH_FILTER_ALL_ID)).toBe(true);
    expect(itemMatchesDohFilter(item({ id: "a", dohCompliant: false, dohCategory: null }), DOH_FILTER_ALL_ID)).toBe(false);
  });

  it("a per-category lane keeps only that category", () => {
    expect(itemMatchesDohFilter(item({ id: "a", dohCompliant: true, dohCategory: "high_cbd" }), "doh:high_cbd")).toBe(true);
    expect(itemMatchesDohFilter(item({ id: "a", dohCompliant: true, dohCategory: "high_thc" }), "doh:high_cbd")).toBe(false);
  });
});

describe("DOH filter: id helpers + lookup", () => {
  it("category id round-trips and rejects junk", () => {
    expect(dohFilterCategoryId("high_thc")).toBe("doh:high_thc");
    expect(dohFilterCategoryFromId("doh:high_thc")).toBe("high_thc");
    expect(dohFilterCategoryFromId(DOH_FILTER_ALL_ID)).toBeNull();
    expect(dohFilterCategoryFromId("doh:nonsense")).toBeNull();
    expect(dohFilterCategoryFromId(null)).toBeNull();
  });

  it("findDohFilterOption locates by id (null when absent)", () => {
    const opts = resolveDohFilterOptions([
      item({ id: "a", dohCompliant: true, dohCategory: "high_thc" }),
      item({ id: "b", dohCompliant: true, dohCategory: "general_use" }),
    ]);
    expect(findDohFilterOption(opts, DOH_FILTER_ALL_ID)?.category).toBeNull();
    expect(findDohFilterOption(opts, "doh:high_thc")?.category).toBe("high_thc");
    expect(findDohFilterOption(opts, "nope")).toBeNull();
    expect(findDohFilterOption(opts, null)).toBeNull();
  });
});
