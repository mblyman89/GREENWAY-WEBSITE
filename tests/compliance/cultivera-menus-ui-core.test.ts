/**
 * Vitest mirror of the cultivera-menus-ui-core pure self-tests (CV-4).
 * Locks the display/selection helpers for the vendor menus command center.
 */
import { describe, expect, it } from "vitest";

import {
  agoLabel,
  distinctBrands,
  distinctCategories,
  filterByCategory,
  filterMenuItems,
  isFetchableMarket,
  marketId,
  marketName,
  marketSlug,
  pctLabel,
  potencyLabel,
  priceLabel,
  snapshotSummary,
  type MenuItemLike,
} from "@/lib/purchasing/cultivera-menus-ui-core";

const ITEM: MenuItemLike = {
  name: "Blue Dream",
  brand: "Acme",
  category: "Flower",
  strain_type: "hybrid",
  size_label: "3.5g",
  wholesale_price_minor: 1250,
  available_qty: 10,
  thc_pct: 24.5,
  cbd_pct: 0.3,
  total_cannabinoids_pct: null,
  image_url: null,
  coa_url: null,
};

const OTHER: MenuItemLike = {
  ...ITEM,
  name: "Sour Diesel",
  brand: "Rebel",
  category: "Pre-Rolls",
  strain_type: "sativa",
  size_label: "1g",
};

describe("priceLabel (money is CENTS)", () => {
  it("formats cents as dollars", () => {
    expect(priceLabel(1250)).toBe("$12.50");
    expect(priceLabel(0)).toBe("$0.00");
    expect(priceLabel(5)).toBe("$0.05");
  });
  it("handles negatives and nulls", () => {
    expect(priceLabel(-995)).toBe("-$9.95");
    expect(priceLabel(null)).toBe("—");
    expect(priceLabel(Number.NaN)).toBe("—");
  });
});

describe("pctLabel", () => {
  it("keeps one decimal, trims integers", () => {
    expect(pctLabel(24.5)).toBe("24.5%");
    expect(pctLabel(21)).toBe("21%");
    expect(pctLabel(0.34)).toBe("0.3%");
  });
  it("empty for null", () => {
    expect(pctLabel(null)).toBe("");
  });
});

describe("potencyLabel", () => {
  it("joins THC and CBD", () => {
    expect(potencyLabel(ITEM)).toBe("THC 24.5% · CBD 0.3%");
  });
  it("falls back to total cannabinoids only when THC/CBD absent", () => {
    expect(potencyLabel({ thc_pct: null, cbd_pct: null, total_cannabinoids_pct: 27.1 })).toBe("Total 27.1%");
    expect(potencyLabel({ thc_pct: 20, cbd_pct: null, total_cannabinoids_pct: 25 })).toBe("THC 20%");
  });
  it("empty when nothing known", () => {
    expect(potencyLabel({ thc_pct: null, cbd_pct: null, total_cannabinoids_pct: null })).toBe("");
  });
});

describe("filterMenuItems", () => {
  const items = [ITEM, OTHER];
  it("empty query keeps all", () => {
    expect(filterMenuItems(items, "")).toHaveLength(2);
  });
  it("matches name/brand/category/strain case-insensitively", () => {
    expect(filterMenuItems(items, "blue")).toHaveLength(1);
    expect(filterMenuItems(items, "REBEL")).toHaveLength(1);
    expect(filterMenuItems(items, "pre-rolls")).toHaveLength(1);
    expect(filterMenuItems(items, "sativa")).toHaveLength(1);
    expect(filterMenuItems(items, "zzz")).toHaveLength(0);
  });
});

describe("filterByCategory", () => {
  const items = [ITEM, OTHER];
  it("exact case-insensitive match; empty keeps all; no substrings", () => {
    expect(filterByCategory(items, "")).toHaveLength(2);
    expect(filterByCategory(items, "flower")).toHaveLength(1);
    expect(filterByCategory(items, "flow")).toHaveLength(0);
  });
});

describe("distinct lists", () => {
  const three = [ITEM, OTHER, { ...ITEM, category: null, brand: "" }];
  it("sorted unique categories, skips empties", () => {
    expect(distinctCategories(three)).toEqual(["Flower", "Pre-Rolls"]);
  });
  it("sorted unique brands, skips empties", () => {
    expect(distinctBrands(three)).toEqual(["Acme", "Rebel"]);
  });
});

describe("agoLabel (deterministic via injected now)", () => {
  const now = new Date("2026-01-10T12:00:00Z").getTime();
  it("buckets minutes/hours/days", () => {
    expect(agoLabel("2026-01-10T11:59:40Z", now)).toBe("just now");
    expect(agoLabel("2026-01-10T11:45:00Z", now)).toBe("15m ago");
    expect(agoLabel("2026-01-10T09:00:00Z", now)).toBe("3h ago");
    expect(agoLabel("2026-01-08T12:00:00Z", now)).toBe("2d ago");
  });
  it("empty for invalid dates", () => {
    expect(agoLabel("not-a-date", now)).toBe("");
  });
});

describe("snapshotSummary", () => {
  const now = new Date("2026-01-10T12:00:00Z").getTime();
  it("name + plural items + time", () => {
    expect(
      snapshotSummary(
        { seller_name: "Acme Farms", cultivera_market_slug: "acme", status: "fetched", item_count: 42, fetched_at: "2026-01-10T09:00:00Z" },
        now,
      ),
    ).toBe("Acme Farms — 42 items · 3h ago");
  });
  it("slug fallback, singular, omits bad time", () => {
    expect(
      snapshotSummary(
        { seller_name: null, cultivera_market_slug: "acme", status: "fetched", item_count: 1, fetched_at: "bad" },
        now,
      ),
    ).toBe("acme — 1 item");
  });
  it("unknown vendor fallback", () => {
    expect(
      snapshotSummary(
        { seller_name: "", cultivera_market_slug: null, status: "fetched", item_count: 0, fetched_at: "bad" },
        now,
      ),
    ).toBe("Unknown vendor — 0 items");
  });
});

describe("tolerant market record readers (never guess field names)", () => {
  it("marketName across key variants, slug fallback", () => {
    expect(marketName({ displayName: "Acme Farms" })).toBe("Acme Farms");
    expect(marketName({ seller_name: "Acme" })).toBe("Acme");
    expect(marketName({ slug: "acme" })).toBe("acme");
    expect(marketName({})).toBe("");
  });
  it("marketSlug and marketId variants, numeric ids stringified", () => {
    expect(marketSlug({ slug: "acme" })).toBe("acme");
    expect(marketSlug({ market_slug: "acme2" })).toBe("acme2");
    expect(marketId({ id: "m1" })).toBe("m1");
    expect(marketId({ market_id: 42 })).toBe("42");
  });
  it("fetchable needs a slug or id", () => {
    expect(isFetchableMarket({ slug: "acme" })).toBe(true);
    expect(isFetchableMarket({ id: "m1" })).toBe(true);
    expect(isFetchableMarket({ name: "No handles" })).toBe(false);
  });
});
