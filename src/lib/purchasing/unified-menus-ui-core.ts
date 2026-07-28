/**
 * src/lib/purchasing/unified-menus-ui-core.ts
 *
 * GF-5 — PURE display helpers for the UNIFIED vendor menus command center
 * (/admin/purchasing/menus). No imports with I/O, no Date.now() (callers pass
 * `now`), so everything here is deterministically testable.
 *
 * The menus page now serves BOTH marketplaces: Cultivera snapshots
 * (cultivera_menu_snapshots) and GrowFlow snapshots (growflow_menu_snapshots).
 * These helpers translate each platform's saved rows into ONE list shape the
 * page renders, newest first, with a platform badge per row.
 */

import type { VendorPlatform } from "./growflow-menu-core";

/* ------------------------------------------------------------------
 * Platform badges
 * ------------------------------------------------------------------ */

/** Human label for the platform badge next to a result or snapshot. */
export function platformLabel(platform: VendorPlatform): string {
  if (platform === "growflow") return "GrowFlow";
  if (platform === "leaflink") return "LeafLink";
  return "Cultivera";
}

/**
 * Badge tone per platform (matches the admin Badge component's tones):
 * Cultivera = green (its brand accent here), GrowFlow = gold,
 * LeafLink = orange (the third distinct tone the Badge component ships).
 */
export function platformTone(platform: VendorPlatform): "green" | "gold" | "orange" {
  if (platform === "growflow") return "gold";
  if (platform === "leaflink") return "orange";
  return "green";
}

/* ------------------------------------------------------------------
 * Unified snapshot rows (the "Saved menu snapshots" table)
 * ------------------------------------------------------------------ */

/** The subset of a Cultivera snapshot row these helpers need (structural). */
export type CultiveraSnapshotLike = {
  id: string;
  seller_name: string | null;
  cultivera_market_slug: string | null;
  status: string;
  item_count: number;
  fetched_at: string;
};

/** The subset of a GrowFlow snapshot row these helpers need (structural). */
export type GrowflowSnapshotLike = {
  id: string;
  store_name: string | null;
  license_number: string | null;
  status: string;
  item_count: number;
  fetched_at: string;
};

/** The subset of a LeafLink snapshot row these helpers need (structural). */
export type LeaflinkSnapshotLike = {
  id: string;
  brand_name: string | null;
  company_name: string | null;
  status: string;
  item_count: number;
  fetched_at: string;
};

/** One platform-tagged row for the unified snapshots table. */
export type UnifiedSnapshotRow = {
  platform: VendorPlatform;
  id: string;
  vendorLabel: string;
  /** Secondary identifier under the vendor name (slug or license). */
  subLabel: string;
  status: string;
  itemCount: number;
  fetchedAt: string;
  /** Where clicking the row goes (per-platform snapshot browser). */
  href: string;
};

/** Map one saved Cultivera snapshot into the unified table row. */
export function cultiveraSnapshotRow(s: CultiveraSnapshotLike): UnifiedSnapshotRow {
  const name = (s.seller_name ?? "").trim();
  const slug = (s.cultivera_market_slug ?? "").trim();
  return {
    platform: "cultivera",
    id: s.id,
    vendorLabel: name || slug || "Unknown vendor",
    subLabel: name ? slug : "",
    status: s.status,
    itemCount: s.item_count,
    fetchedAt: s.fetched_at,
    href: `/admin/purchasing/menus/${s.id}`,
  };
}

/** Map one saved GrowFlow snapshot into the unified table row. */
export function growflowSnapshotRow(s: GrowflowSnapshotLike): UnifiedSnapshotRow {
  const name = (s.store_name ?? "").trim();
  const license = (s.license_number ?? "").trim();
  return {
    platform: "growflow",
    id: s.id,
    vendorLabel: name || license || "Unknown vendor",
    subLabel: name ? license : "",
    status: s.status,
    itemCount: s.item_count,
    fetchedAt: s.fetched_at,
    href: `/admin/purchasing/menus/growflow/${s.id}`,
  };
}

/** Map one saved LeafLink snapshot into the unified table row. */
export function leaflinkSnapshotRow(s: LeaflinkSnapshotLike): UnifiedSnapshotRow {
  const brand = (s.brand_name ?? "").trim();
  const company = (s.company_name ?? "").trim();
  return {
    platform: "leaflink",
    id: s.id,
    vendorLabel: brand || company || "Unknown vendor",
    // Show the selling company under the brand when it adds information.
    subLabel: brand && company && brand.toLowerCase() !== company.toLowerCase() ? company : "",
    status: s.status,
    itemCount: s.item_count,
    fetchedAt: s.fetched_at,
    href: `/admin/purchasing/menus/leaflink/${s.id}`,
  };
}

/**
 * Merge all platforms' snapshot lists into ONE, newest fetch first.
 * Invalid dates sort as oldest (timestamp 0). Stable for equal times
 * (cultivera rows keep their relative order before growflow's, then
 * leaflink's, at the same ms). `leaflink` is optional so existing callers
 * keep compiling while the third platform rolls out.
 */
export function mergeSnapshotRows(
  cultivera: CultiveraSnapshotLike[],
  growflow: GrowflowSnapshotLike[],
  leaflink: LeaflinkSnapshotLike[] = [],
): UnifiedSnapshotRow[] {
  const rows: UnifiedSnapshotRow[] = [
    ...cultivera.map(cultiveraSnapshotRow),
    ...growflow.map(growflowSnapshotRow),
    ...leaflink.map(leaflinkSnapshotRow),
  ];
  const ts = (iso: string): number => {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : 0;
  };
  // Sort by fetchedAt desc; Array.prototype.sort is stable in modern JS.
  return rows.sort((a, b) => ts(b.fetchedAt) - ts(a.fetchedAt));
}

/** Count of distinct vendor labels across the unified rows (for the KPI). */
export function distinctVendorCount(rows: UnifiedSnapshotRow[]): number {
  return new Set(rows.map((r) => `${r.platform}:${r.vendorLabel.toLowerCase()}`)).size;
}

/* ------------------------------------------------------------------
 * Self-tests (pure runner)
 * ------------------------------------------------------------------ */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`unified-menus-ui-core self-test failed: ${msg}`);
}

export function __runUnifiedMenusUiCoreTests(): void {
  // platformLabel / platformTone
  assert(platformLabel("cultivera") === "Cultivera", "label cultivera");
  assert(platformLabel("growflow") === "GrowFlow", "label growflow");
  assert(platformLabel("leaflink") === "LeafLink", "label leaflink");
  assert(platformTone("cultivera") === "green", "tone cultivera");
  assert(platformTone("growflow") === "gold", "tone growflow");
  assert(platformTone("leaflink") === "orange", "tone leaflink");

  // cultiveraSnapshotRow — name preferred, slug as sub; slug fallback
  const cv = cultiveraSnapshotRow({
    id: "c1",
    seller_name: "Fine Detail Greenway",
    cultivera_market_slug: "fine-detail",
    status: "fetched",
    item_count: 42,
    fetched_at: "2026-01-02T00:00:00Z",
  });
  assert(cv.platform === "cultivera", "cv platform");
  assert(cv.vendorLabel === "Fine Detail Greenway", "cv vendorLabel");
  assert(cv.subLabel === "fine-detail", "cv subLabel");
  assert(cv.href === "/admin/purchasing/menus/c1", "cv href");
  const cvNoName = cultiveraSnapshotRow({
    id: "c2",
    seller_name: "  ",
    cultivera_market_slug: "slug-only",
    status: "empty",
    item_count: 0,
    fetched_at: "2026-01-01T00:00:00Z",
  });
  assert(cvNoName.vendorLabel === "slug-only", "cv slug fallback");
  assert(cvNoName.subLabel === "", "cv no dup sub");
  const cvUnknown = cultiveraSnapshotRow({
    id: "c3",
    seller_name: null,
    cultivera_market_slug: null,
    status: "error",
    item_count: 0,
    fetched_at: "bad-date",
  });
  assert(cvUnknown.vendorLabel === "Unknown vendor", "cv unknown vendor");

  // growflowSnapshotRow — name preferred, license as sub; license fallback
  const gf = growflowSnapshotRow({
    id: "g1",
    store_name: "Bud Bros",
    license_number: "412345",
    status: "fetched",
    item_count: 7,
    fetched_at: "2026-01-03T00:00:00Z",
  });
  assert(gf.platform === "growflow", "gf platform");
  assert(gf.vendorLabel === "Bud Bros", "gf vendorLabel");
  assert(gf.subLabel === "412345", "gf subLabel");
  assert(gf.href === "/admin/purchasing/menus/growflow/g1", "gf href");
  const gfNoName = growflowSnapshotRow({
    id: "g2",
    store_name: null,
    license_number: "413541",
    status: "fetched",
    item_count: 1,
    fetched_at: "2026-01-01T12:00:00Z",
  });
  assert(gfNoName.vendorLabel === "413541", "gf license fallback");

  // leaflinkSnapshotRow — brand preferred, company as sub when different
  const ll = leaflinkSnapshotRow({
    id: "l1",
    brand_name: "Blazy Susan",
    company_name: "Blazy Susan LLC",
    status: "fetched",
    item_count: 16,
    fetched_at: "2026-01-04T00:00:00Z",
  });
  assert(ll.platform === "leaflink", "ll platform");
  assert(ll.vendorLabel === "Blazy Susan", "ll vendorLabel");
  assert(ll.subLabel === "Blazy Susan LLC", "ll subLabel company");
  assert(ll.href === "/admin/purchasing/menus/leaflink/l1", "ll href");
  const llSame = leaflinkSnapshotRow({
    id: "l2",
    brand_name: "Wyld",
    company_name: "wyld",
    status: "fetched",
    item_count: 3,
    fetched_at: "2026-01-01T00:00:00Z",
  });
  assert(llSame.subLabel === "", "ll no dup sub when same name");
  const llNoBrand = leaflinkSnapshotRow({
    id: "l3",
    brand_name: null,
    company_name: "Fallback Co",
    status: "empty",
    item_count: 0,
    fetched_at: "2026-01-01T00:00:00Z",
  });
  assert(llNoBrand.vendorLabel === "Fallback Co", "ll company fallback");

  // mergeSnapshotRows — newest first across platforms; bad dates sink
  const merged = mergeSnapshotRows(
    [
      { id: "c1", seller_name: "A", cultivera_market_slug: "", status: "fetched", item_count: 1, fetched_at: "2026-01-02T00:00:00Z" },
      { id: "c3", seller_name: "C", cultivera_market_slug: "", status: "error", item_count: 0, fetched_at: "not-a-date" },
    ],
    [
      { id: "g1", store_name: "B", license_number: "", status: "fetched", item_count: 2, fetched_at: "2026-01-03T00:00:00Z" },
    ],
    [
      { id: "l1", brand_name: "L", company_name: "", status: "fetched", item_count: 4, fetched_at: "2026-01-05T00:00:00Z" },
    ],
  );
  assert(merged.length === 4, "merge count");
  assert(merged[0].id === "l1", "merge leaflink newest first");
  assert(merged[1].id === "g1", "merge growflow second");
  assert(merged[2].id === "c1", "merge cultivera third");
  assert(merged[3].id === "c3", "merge bad date last");
  // Two-arg call still works (leaflink optional — existing callers compile).
  assert(mergeSnapshotRows([], []).length === 0, "merge optional third arg");

  // distinctVendorCount — platform-scoped, case-insensitive
  assert(
    distinctVendorCount([
      { ...cv, vendorLabel: "Acme" },
      { ...cv, vendorLabel: "acme" },
      { ...gf, vendorLabel: "Acme" },
    ]) === 2,
    "distinct vendors",
  );

  console.log("unified-menus-ui-core: self-tests passed");
}
