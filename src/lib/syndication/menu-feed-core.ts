/**
 * src/lib/syndication/menu-feed-core.ts
 *
 * PURE menu→syndication mapping (no server-only, no DB). Slice 40.
 *
 * Turns our published menu items into a normalized, channel-agnostic
 * SyndicationItem the Leafly / WeedMaps builders consume. Keeping this pure lets
 * us unit-test the mapping (price formatting, strain normalization, in-stock
 * logic, hidden filtering) without a DB or network.
 *
 * Grounded in the real menu_items schema (MenuItemRow) and our GreenwayMenuItem
 * field names — no invented fields.
 */

export type SyndicationVariant = {
  /** Stable source variant id. */
  id: string;
  /** e.g. "3.5g", "1g", "1oz". */
  label: string;
  priceMinorUnits: number;
  inStock: boolean;
};

export type SyndicationItem = {
  /** Stable source product key (maps to pos product key). */
  id: string;
  name: string;
  brand: string | null;
  category: string;
  /** indica | sativa | hybrid | cbd | unknown (normalized). */
  strainType: string;
  strainName: string | null;
  thc: string | null;
  cbd: string | null;
  description: string;
  priceMinorUnits: number;
  inStock: boolean;
  variants: SyndicationVariant[];
};

/** Minimal shape of a published menu item the mapper needs (subset of MenuItemRow + variants). */
export type FeedSourceItem = {
  source_item_id: string;
  name: string;
  brand_name: string | null;
  category: string;
  strain_type: string | null;
  strain_name: string | null;
  thc: string | null;
  cbd: string | null;
  description: string | null;
  price_minor_units: number;
  inventory_status: string | null;
  hidden: boolean;
  variants: { source_variant_id: string; label: string; price_minor_units: number; inventory_level: number }[];
};

// Our own (granular) strain vocabulary for the website + menu filters. The two
// "leaning" values are display-only classifications for shoppers; they are
// COLLAPSED to a CCRS-valid base (Indica/Sativa/Hybrid) on CCRS export — the
// CCRS batch normalizer already maps anything containing "hybrid" to Hybrid,
// so "indica-hybrid"/"sativa-hybrid" export correctly as Hybrid (verified
// against the CCRS Data Model Manual).
//
// Canonical machine values are the compact hyphen tokens (indica-hybrid /
// sativa-hybrid) used across the website menu, POS transform, and back office.
// This module stays intentionally standalone (no imports) so it remains
// unit-testable in isolation; we mirror the taxonomy's canonicalization here
// and still accept legacy spellings so older stored data never breaks.
const VALID_STRAIN = new Set(["indica", "sativa", "hybrid", "indica-hybrid", "sativa-hybrid", "cbd"]);

// Legacy / alternate spellings → canonical token. Keeps backward-compat with
// any menu row that still carries a space-spelled or "dominant" value.
const STRAIN_ALIASES = new Map<string, string>([
  ["indica leaning hybrid", "indica-hybrid"],
  ["indica-leaning hybrid", "indica-hybrid"],
  ["indica dominant hybrid", "indica-hybrid"],
  ["indica dominant", "indica-hybrid"],
  ["indica hybrid", "indica-hybrid"],
  ["sativa leaning hybrid", "sativa-hybrid"],
  ["sativa-leaning hybrid", "sativa-hybrid"],
  ["sativa dominant hybrid", "sativa-hybrid"],
  ["sativa dominant", "sativa-hybrid"],
  ["sativa hybrid", "sativa-hybrid"],
]);

export function normalizeStrainType(value: string | null | undefined): string {
  const v = (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (VALID_STRAIN.has(v)) return v;
  const aliased = STRAIN_ALIASES.get(v);
  if (aliased) return aliased;
  return "unknown";
}

/** A menu item is "in stock" when its status isn't unavailable and some variant has inventory. */
export function itemInStock(item: FeedSourceItem): boolean {
  if ((item.inventory_status ?? "").toLowerCase() === "unavailable") return false;
  if (item.variants.length === 0) return true; // no variant detail → trust item status
  return item.variants.some((v) => v.inventory_level > 0);
}

/** Map one source item → SyndicationItem. */
export function toSyndicationItem(item: FeedSourceItem): SyndicationItem {
  return {
    id: item.source_item_id,
    name: item.name,
    brand: item.brand_name && item.brand_name.trim() ? item.brand_name.trim() : null,
    category: item.category,
    strainType: normalizeStrainType(item.strain_type),
    strainName: item.strain_name && item.strain_name.trim() ? item.strain_name.trim() : null,
    thc: item.thc,
    cbd: item.cbd,
    description: (item.description ?? "").trim(),
    priceMinorUnits: item.price_minor_units,
    inStock: itemInStock(item),
    variants: item.variants.map((v) => ({
      id: v.source_variant_id,
      label: v.label,
      priceMinorUnits: v.price_minor_units,
      inStock: v.inventory_level > 0,
    })),
  };
}

/**
 * Build the full syndication feed from published menu items. Hidden items are
 * excluded (they must not appear on third-party menus). Returns items sorted by
 * brand then name for a stable, reviewable payload.
 */
export function buildSyndicationFeed(items: FeedSourceItem[]): SyndicationItem[] {
  return items
    .filter((i) => !i.hidden)
    .map(toSyndicationItem)
    .sort((a, b) => {
      const ab = (a.brand ?? "").localeCompare(b.brand ?? "");
      return ab !== 0 ? ab : a.name.localeCompare(b.name);
    });
}

export function dollarsFromMinor(minor: number): string {
  return (minor / 100).toFixed(2);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
export function __runMenuFeedTests(): void {
  let passed = 0;
  let failed = 0;
  function expect(name: string, cond: boolean) {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.log(`FAIL: ${name}`);
    }
  }

  expect("strain normalize hybrid", normalizeStrainType("Hybrid") === "hybrid");
  expect("strain normalize junk", normalizeStrainType("weird") === "unknown");
  expect("strain normalize null", normalizeStrainType(null) === "unknown");
  expect("strain normalize indica-hybrid token", normalizeStrainType("indica-hybrid") === "indica-hybrid");
  expect("strain normalize sativa-hybrid token", normalizeStrainType("sativa-hybrid") === "sativa-hybrid");
  expect("strain normalize legacy space spelling", normalizeStrainType("Indica Leaning Hybrid") === "indica-hybrid");
  expect("strain normalize dominant spelling", normalizeStrainType("Sativa Dominant") === "sativa-hybrid");

  const base: FeedSourceItem = {
    source_item_id: "k1",
    name: "Blue Dream",
    brand_name: " Acme ",
    category: "flower",
    strain_type: "Sativa",
    strain_name: "Blue Dream",
    thc: "22%",
    cbd: "0.1%",
    description: "  nice  ",
    price_minor_units: 1200,
    inventory_status: "in-stock",
    hidden: false,
    variants: [
      { source_variant_id: "v1", label: "3.5g", price_minor_units: 1200, inventory_level: 5 },
      { source_variant_id: "v2", label: "7g", price_minor_units: 2200, inventory_level: 0 },
    ],
  };

  const mapped = toSyndicationItem(base);
  expect("brand trimmed", mapped.brand === "Acme");
  expect("desc trimmed", mapped.description === "nice");
  expect("strain mapped", mapped.strainType === "sativa");
  expect("in stock true (one variant >0)", mapped.inStock === true);
  expect("variant1 in stock", mapped.variants[0].inStock === true);
  expect("variant2 out", mapped.variants[1].inStock === false);

  const unavailable: FeedSourceItem = { ...base, inventory_status: "unavailable" };
  expect("unavailable not in stock", itemInStock(unavailable) === false);

  const noVariants: FeedSourceItem = { ...base, variants: [], inventory_status: "in-stock" };
  expect("no variants trusts status", itemInStock(noVariants) === true);

  const feed = buildSyndicationFeed([
    { ...base, source_item_id: "z", name: "Zkittlez", brand_name: "Zed" },
    { ...base, source_item_id: "a", name: "Apple", brand_name: "Acme" },
    { ...base, source_item_id: "h", name: "Hidden", hidden: true },
  ]);
  expect("hidden excluded", feed.length === 2);
  expect("sorted by brand", feed[0].brand === "Acme");

  expect("dollars", dollarsFromMinor(1200) === "12.00");

  console.log(`menu-feed: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} menu-feed tests failed`);
}
