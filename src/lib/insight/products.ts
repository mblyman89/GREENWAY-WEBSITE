/**
 * src/lib/insight/products.ts
 *
 * Read-only analytics + a weighted "what's missing" model for the live product
 * menu. Pure functions (no DB, no React) so they can run on the server and be
 * unit-tested. Built on the existing GapFlags + MenuItemRow shapes — this does
 * NOT change POS price/inventory source of truth; it only computes insight.
 *
 * Part of POS Slice 1 (page insight upgrade). See back-office/pos/PAGE_ENHANCEMENT_PLAN.md.
 */
import type { MenuItemRow } from "@/lib/pos/db-types";
import type { GapFlags } from "@/lib/enrichment/store";

/** A single counted, deep-linkable gap for the "what's missing" panel. */
export type GapInsight = {
  key: string;
  label: string;
  count: number;
  /** Optional href to jump to a filtered view that fixes this gap. */
  href?: string;
  /** Relative importance for ranking (higher = more important). */
  weight: number;
};

/** Aggregate statistics across the live product menu. */
export type ProductStats = {
  total: number;
  visible: number;
  hidden: number;
  enrichedLive: number;
  /** Counts of products missing each enrichment field. */
  missing: {
    description: number;
    image: number;
    brandLink: number;
  };
  /** Distribution of products by category, sorted desc by count. */
  byCategory: { label: string; count: number }[];
  /** Distribution by strain type (indica/sativa/hybrid/unknown…). */
  byStrainType: { label: string; count: number }[];
  /** Distribution by POS inventory status. */
  byStockStatus: { label: string; count: number }[];
  /** Price summary in minor units (cents). 0-priced rows excluded from min. */
  price: { minMinor: number | null; medianMinor: number | null; maxMinor: number | null };
  /** Average enrichment completeness across all products (0–100). */
  avgCompleteness: number;
};

/** A product's weighted completeness (mirrors the vendor/brand model). */
export function productCompletenessPercent(g: GapFlags): number {
  // Weights mirror the editorial importance used elsewhere.
  const checks: { done: boolean; weight: number }[] = [
    { done: g.hasImage, weight: 3 },
    { done: g.hasDescription, weight: 3 },
    { done: g.hasBrandLink, weight: 1 },
  ];
  const total = checks.reduce((s, c) => s + c.weight, 0);
  const done = checks.reduce((s, c) => (c.done ? s + c.weight : s), 0);
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

function distribution(values: string[]): { label: string; count: number }[] {
  const map = new Map<string, number>();
  for (const v of values) {
    const key = v && v.trim().length > 0 ? v : "—";
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

/**
 * Compute aggregate product statistics from the menu rows + their gap flags.
 * `items` and `gaps` are expected to be index-aligned (gaps[i] derived from items[i]).
 */
export function computeProductStats(items: MenuItemRow[], gaps: GapFlags[]): ProductStats {
  const visible = items.filter((i) => !i.hidden).length;
  const hidden = items.length - visible;

  const missingDescription = gaps.filter((g) => !g.hasDescription).length;
  const missingImage = gaps.filter((g) => !g.hasImage).length;
  const missingBrandLink = gaps.filter((g) => !g.hasBrandLink).length;
  const enrichedLive = gaps.filter((g) => g.enrichmentStatus === "published").length;

  const prices = items.map((i) => i.price_minor_units).filter((p) => p > 0);
  const minMinor = prices.length ? Math.min(...prices) : null;
  const maxMinor = prices.length ? Math.max(...prices) : null;

  const completenessValues = gaps.map((g) => productCompletenessPercent(g));
  const avgCompleteness =
    completenessValues.length === 0
      ? 0
      : Math.round(completenessValues.reduce((s, v) => s + v, 0) / completenessValues.length);

  return {
    total: items.length,
    visible,
    hidden,
    enrichedLive,
    missing: { description: missingDescription, image: missingImage, brandLink: missingBrandLink },
    byCategory: distribution(items.map((i) => i.category)).slice(0, 12),
    byStrainType: distribution(items.map((i) => i.strain_type)),
    byStockStatus: distribution(items.map((i) => i.inventory_status)),
    price: { minMinor, medianMinor: median(prices), maxMinor },
    avgCompleteness,
  };
}

/** Build the ranked "what's missing" gap list for the product menu. */
export function productGapInsights(stats: ProductStats): GapInsight[] {
  const gaps: GapInsight[] = [
    { key: "image", label: "missing a photo", count: stats.missing.image, href: "/admin/products?gap=image", weight: 3 },
    { key: "description", label: "missing a description", count: stats.missing.description, href: "/admin/products?gap=description", weight: 3 },
    { key: "brand", label: "missing a brand link", count: stats.missing.brandLink, href: "/admin/products?gap=brand", weight: 1 },
  ];
  return gaps
    .filter((g) => g.count > 0)
    .sort((a, b) => b.weight - a.weight || b.count - a.count);
}
