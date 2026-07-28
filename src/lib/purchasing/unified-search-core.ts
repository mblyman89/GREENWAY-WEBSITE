/**
 * src/lib/purchasing/unified-search-core.ts
 *
 * GF-4 — PURE logic for the UNIFIED smart vendor search across BOTH wholesale
 * marketplaces (Cultivera Market + GrowFlow). No I/O, no Date.now() (callers
 * pass timestamps), so everything is deterministically testable.
 *
 * The owner wants ONE search box that:
 *   1. remembers which platform each vendor's menu was last found on
 *      (vendor_platform_map, migration 0125),
 *   2. searches the PREFERRED / last-used platform FIRST,
 *   3. searches the OTHER platform only when the first found nothing,
 *   4. shows a platform badge on every result.
 *
 * This module decides the order, maps each platform's tolerant records into
 * ONE UnifiedVendorHit shape, and builds the memory upsert. The Supabase
 * reads/writes live in vendor-platform-store.ts; the worker calls live in
 * cultivera-client.ts / growflow-client.ts; the server action wires them.
 *
 * Field access stays DEFENSIVE: Cultivera market records go through the
 * shipped multi-key getters (cultivera-menus-ui-core); GrowFlow store records
 * go through the GF-1 normalizeStore (keys pinned from the live probe).
 */
import {
  marketName,
  marketSlug,
  marketId,
  isFetchableMarket,
} from "./cultivera-menus-ui-core";
import { normalizeStore, type VendorPlatform } from "./growflow-menu-core";
import { normalizeBrandHit } from "./leaflink-menu-core";

export type { VendorPlatform } from "./growflow-menu-core";

/** All platforms, in the DEFAULT search order (no memory: Cultivera first —
 * it was the first integration and most of the owner's vendors live there;
 * LeafLink last — its brand discovery is a broader product-catalog search). */
export const ALL_PLATFORMS: readonly VendorPlatform[] = ["cultivera", "growflow", "leaflink"] as const;

/* --------------------------------------------------------------------------
 * Vendor key normalization (the memory's lookup key)
 * ------------------------------------------------------------------------ */

/**
 * Normalize a vendor name into the vendor_platform_map lookup key:
 * lowercase, trimmed, whitespace collapsed. "" when nothing usable.
 * Punctuation is KEPT (so "B&B Farms" ≠ "BB Farms" — never guess equality).
 */
export function normalizeVendorKey(name: string | null | undefined): string {
  if (typeof name !== "string") return "";
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

/* --------------------------------------------------------------------------
 * Preferred platform choice (from remembered rows)
 * ------------------------------------------------------------------------ */

/** The subset of a vendor_platform_map row the chooser needs (structural). */
export type PlatformMemoryLike = {
  platform: string;
  last_seen_at: string;
  hit_count: number;
};

function isKnownPlatform(p: string): p is VendorPlatform {
  return p === "cultivera" || p === "growflow" || p === "leaflink";
}

/**
 * Pick the platform to search FIRST from the remembered rows for one vendor
 * key: most recent last_seen_at wins; hit_count breaks ties; null when no
 * usable memory exists (caller falls back to the default order).
 */
export function choosePreferredPlatform(rows: PlatformMemoryLike[]): VendorPlatform | null {
  let best: PlatformMemoryLike | null = null;
  for (const row of rows) {
    if (!isKnownPlatform(row.platform)) continue;
    if (!best) {
      best = row;
      continue;
    }
    const bestMs = Date.parse(best.last_seen_at);
    const rowMs = Date.parse(row.last_seen_at);
    const a = Number.isFinite(rowMs) ? rowMs : 0;
    const b = Number.isFinite(bestMs) ? bestMs : 0;
    if (a > b || (a === b && row.hit_count > best.hit_count)) best = row;
  }
  return best && isKnownPlatform(best.platform) ? best.platform : null;
}

/**
 * The sequential search order: preferred platform first (when remembered),
 * then the others in their default relative order. With no memory, the
 * default order (ALL_PLATFORMS).
 */
export function searchOrder(preferred: VendorPlatform | null): VendorPlatform[] {
  if (!preferred) return [...ALL_PLATFORMS];
  return [preferred, ...ALL_PLATFORMS.filter((p) => p !== preferred)];
}

/**
 * Sequential-search rule: only hit the NEXT platform when everything searched
 * so far found nothing. (One platform answering means the vendor was found —
 * stop there.)
 */
export function shouldSearchSecondary(primaryHitCount: number): boolean {
  return primaryHitCount <= 0;
}

/* --------------------------------------------------------------------------
 * Unified hit shape (what the one search box renders)
 * ------------------------------------------------------------------------ */

/** One vendor result, platform-tagged, with already-safe strings only. */
export type UnifiedVendorHit = {
  /** Which marketplace answered — drives the badge and the fetch route. */
  platform: VendorPlatform;
  name: string;
  /** The id to fetch the menu with: Cultivera market Id / GrowFlow store Id. */
  refId: string;
  /** Cultivera vendor slug ("" for GrowFlow — it fetches by store id). */
  slug: string;
  license: string;
  city: string;
  /** GrowFlow AccessStatus === "Locked" (menu likely gated); false for Cultivera. */
  locked: boolean;
  /** True when we have what the fetch endpoint needs (id or slug). */
  fetchable: boolean;
};

/** Map ONE tolerant Cultivera market record into the unified hit shape. */
export function cultiveraHit(rec: Record<string, unknown>): UnifiedVendorHit {
  return {
    platform: "cultivera",
    name: marketName(rec) || "(unnamed vendor)",
    refId: marketId(rec),
    slug: marketSlug(rec),
    license: firstString(rec, ["LicenseNumber", "licenseNumber", "License", "license"]),
    city: firstString(rec, ["City", "city"]),
    locked: false,
    fetchable: isFetchableMarket(rec),
  };
}

/** Map ONE GrowFlow store record (getStoreFronts item) into the unified hit. */
export function growflowHit(rec: Record<string, unknown>): UnifiedVendorHit {
  const store = normalizeStore(rec);
  return {
    platform: "growflow",
    name: store.name ?? "(unnamed vendor)",
    refId: store.storeId ?? "",
    slug: "",
    license: store.licenseNumber ?? "",
    city: store.city ?? "",
    locked: (store.accessStatus ?? "").toLowerCase() === "locked",
    fetchable: Boolean(store.storeId),
  };
}

/**
 * Map ONE LeafLink brand hit (the worker's grouped product-search record:
 * brand_id/brand_name/company_name/product_count — see crawler leaflink_api
 * group_products_by_brand, pinned in LEAFLINK_PINNED.md) into the unified hit.
 * LeafLink search rows don't carry the seller's license or city, so those are
 * blank; the brand name is suffixed with the selling company when it differs
 * (e.g. a house brand sold by a distributor).
 */
export function leaflinkHit(rec: Record<string, unknown>): UnifiedVendorHit {
  const hit = normalizeBrandHit(rec);
  const brand = (hit.brandName ?? "").trim();
  const company = (hit.companyName ?? "").trim();
  const name =
    brand && company && brand.toLowerCase() !== company.toLowerCase()
      ? `${brand} — ${company}`
      : brand || company || "(unnamed vendor)";
  return {
    platform: "leaflink",
    name,
    refId: hit.brandId ?? "",
    slug: "",
    license: "",
    city: "",
    locked: false,
    fetchable: Boolean(hit.brandId),
  };
}

/** Tolerant multi-key string getter (same pattern as cultivera-menus-ui-core). */
function firstString(rec: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

/**
 * Merge the platform result lists in SEARCH ORDER (primary first). Secondary
 * hits that duplicate a primary hit's license number are dropped (same real
 * vendor listed on both marketplaces — the primary/remembered one wins).
 * Hits without a license are never treated as duplicates.
 */
export function mergeHits(primary: UnifiedVendorHit[], secondary: UnifiedVendorHit[]): UnifiedVendorHit[] {
  const seenLicenses = new Set(
    primary.map((h) => h.license.trim()).filter((license) => license !== ""),
  );
  const merged = [...primary];
  for (const hit of secondary) {
    const license = hit.license.trim();
    if (license && seenLicenses.has(license)) continue;
    merged.push(hit);
  }
  return merged;
}

/* --------------------------------------------------------------------------
 * Memory upsert (what a successful menu fetch remembers)
 * ------------------------------------------------------------------------ */

/** The row vendor-platform-store upserts into vendor_platform_map. */
export type PlatformMemoryUpsert = {
  vendor_key: string;
  vendor_name: string;
  license_number: string | null;
  platform: VendorPlatform;
  platform_ref: string | null;
  platform_slug: string | null;
  last_seen_at: string;
};

/**
 * Build the memory upsert after a vendor's menu was successfully found on a
 * platform. Returns null when the vendor name is unusable (no key to remember).
 * `nowIso` is injected for determinism.
 */
export function buildMemoryUpsert(input: {
  vendorName: string;
  platform: VendorPlatform;
  nowIso: string;
  licenseNumber?: string | null;
  platformRef?: string | null;
  platformSlug?: string | null;
}): PlatformMemoryUpsert | null {
  const key = normalizeVendorKey(input.vendorName);
  if (!key) return null;
  return {
    vendor_key: key,
    vendor_name: input.vendorName.trim(),
    license_number: strOrNull(input.licenseNumber),
    platform: input.platform,
    platform_ref: strOrNull(input.platformRef),
    platform_slug: strOrNull(input.platformSlug),
    last_seen_at: input.nowIso,
  };
}

function strOrNull(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s ? s : null;
}

/* --------------------------------------------------------------------------
 * Self-tests (pure runner)
 * ------------------------------------------------------------------------ */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`unified-search-core self-test failed: ${msg}`);
}

export function __runUnifiedSearchCoreTests(): void {
  // normalizeVendorKey — lowercase, collapse, trim; punctuation kept
  assert(normalizeVendorKey("  Bonsai   GARDENS  ") === "bonsai gardens", "key collapse");
  assert(normalizeVendorKey("B&B Farms") === "b&b farms", "key keeps punctuation");
  assert(normalizeVendorKey("") === "", "key empty");
  assert(normalizeVendorKey(null) === "", "key null");
  assert(normalizeVendorKey(undefined) === "", "key undefined");

  // choosePreferredPlatform — recency wins, hit_count breaks ties, junk skipped
  const older = { platform: "cultivera", last_seen_at: "2026-01-01T00:00:00Z", hit_count: 9 };
  const newer = { platform: "growflow", last_seen_at: "2026-02-01T00:00:00Z", hit_count: 1 };
  assert(choosePreferredPlatform([older, newer]) === "growflow", "recency wins");
  assert(choosePreferredPlatform([newer, older]) === "growflow", "order-independent");
  const tieA = { platform: "cultivera", last_seen_at: "2026-02-01T00:00:00Z", hit_count: 3 };
  const tieB = { platform: "growflow", last_seen_at: "2026-02-01T00:00:00Z", hit_count: 5 };
  assert(choosePreferredPlatform([tieA, tieB]) === "growflow", "hit_count tie-break");
  assert(choosePreferredPlatform([]) === null, "no rows -> null");
  assert(
    choosePreferredPlatform([{ platform: "leaflink", last_seen_at: "2026-02-01T00:00:00Z", hit_count: 2 }]) === "leaflink",
    "leaflink is a known platform (SLICE 84)",
  );
  assert(
    choosePreferredPlatform([{ platform: "weedmaps", last_seen_at: "2026-02-01T00:00:00Z", hit_count: 2 }]) === null,
    "unknown platform skipped",
  );
  assert(
    choosePreferredPlatform([
      { platform: "cultivera", last_seen_at: "not-a-date", hit_count: 1 },
      { platform: "growflow", last_seen_at: "2026-01-01T00:00:00Z", hit_count: 1 },
    ]) === "growflow",
    "invalid date loses to valid",
  );

  // searchOrder — preferred first, others keep default relative order
  assert(JSON.stringify(searchOrder("growflow")) === JSON.stringify(["growflow", "cultivera", "leaflink"]), "order growflow first");
  assert(JSON.stringify(searchOrder("cultivera")) === JSON.stringify(["cultivera", "growflow", "leaflink"]), "order cultivera first");
  assert(JSON.stringify(searchOrder("leaflink")) === JSON.stringify(["leaflink", "cultivera", "growflow"]), "order leaflink first");
  assert(JSON.stringify(searchOrder(null)) === JSON.stringify(["cultivera", "growflow", "leaflink"]), "order default");

  // shouldSearchSecondary — only when the first platform found nothing
  assert(shouldSearchSecondary(0) === true, "secondary when 0");
  assert(shouldSearchSecondary(1) === false, "no secondary when found");
  assert(shouldSearchSecondary(25) === false, "no secondary when many");

  // cultiveraHit — via the shipped tolerant getters (lowercase key lists in
  // cultivera-menus-ui-core: name/slug/id — pinned there, reused here).
  const cvRec = { name: "Fine Detail Greenway Growers", slug: "fine-detail", id: "m-123", City: "Spokane" };
  const cv = cultiveraHit(cvRec);
  assert(cv.platform === "cultivera", "cv platform");
  assert(cv.name === "Fine Detail Greenway Growers", "cv name");
  assert(cv.refId === "m-123", "cv refId");
  assert(cv.slug === "fine-detail", "cv slug");
  assert(cv.city === "Spokane", "cv city");
  assert(cv.locked === false, "cv never locked");
  assert(cv.fetchable === true, "cv fetchable");
  const cvEmpty = cultiveraHit({});
  assert(cvEmpty.name === "(unnamed vendor)", "cv unnamed fallback");
  assert(cvEmpty.fetchable === false, "cv empty not fetchable");

  // growflowHit — from the live-probed getStoreFronts shape (license 413541 probe)
  const gfRec = {
    Id: 1211,
    LicenseNumber: "424905",
    VendorId: 2368,
    Name: "Bonsai Gardens",
    AccessStatus: "Unlocked",
    City: "East Wenatchee",
    Region: "WA",
  };
  const gf = growflowHit(gfRec);
  assert(gf.platform === "growflow", "gf platform");
  assert(gf.name === "Bonsai Gardens", "gf name");
  assert(gf.refId === "1211", "gf refId is store id");
  assert(gf.slug === "", "gf no slug");
  assert(gf.license === "424905", "gf license");
  assert(gf.city === "East Wenatchee", "gf city");
  assert(gf.locked === false, "gf unlocked");
  assert(gf.fetchable === true, "gf fetchable");
  const gfLocked = growflowHit({ ...gfRec, AccessStatus: "Locked" });
  assert(gfLocked.locked === true, "gf locked flag");
  assert(gfLocked.fetchable === true, "locked still fetchable (id known)");
  const gfEmpty = growflowHit({});
  assert(gfEmpty.fetchable === false, "gf empty not fetchable");
  assert(gfEmpty.name === "(unnamed vendor)", "gf unnamed fallback");

  // leaflinkHit — from the worker's grouped brand record (pinned live shape)
  const llRec = {
    brand_id: 11765,
    brand_name: "Blazy Susan",
    company_id: 20774,
    company_name: "Blazy Susan LLC",
    product_count: 16,
    sample_image: "https://d3nec6hp1jgjd8.cloudfront.net/media/x.png",
  };
  const ll = leaflinkHit(llRec);
  assert(ll.platform === "leaflink", "ll platform");
  assert(ll.name === "Blazy Susan — Blazy Susan LLC", "ll brand + company name");
  assert(ll.refId === "11765", "ll refId is brand id");
  assert(ll.slug === "" && ll.license === "" && ll.city === "", "ll no slug/license/city");
  assert(ll.locked === false, "ll never locked");
  assert(ll.fetchable === true, "ll fetchable");
  const llSame = leaflinkHit({ brand_id: 1, brand_name: "Wyld", company_name: "wyld" });
  assert(llSame.name === "Wyld", "ll no suffix when brand == company");
  const llEmpty = leaflinkHit({});
  assert(llEmpty.name === "(unnamed vendor)", "ll unnamed fallback");
  assert(llEmpty.fetchable === false, "ll empty not fetchable");

  // mergeHits — primary first; secondary deduped by license; no-license kept
  const p1: UnifiedVendorHit = { ...gf };
  const sDup: UnifiedVendorHit = { ...cv, license: "424905" };
  const sNew: UnifiedVendorHit = { ...cv, license: "999999" };
  const sNoLic: UnifiedVendorHit = { ...cv, license: "" };
  const merged = mergeHits([p1], [sDup, sNew, sNoLic]);
  assert(merged.length === 3, "merge dedupes by license");
  assert(merged[0] === p1, "primary stays first");
  assert(merged.includes(sNew) && merged.includes(sNoLic) && !merged.includes(sDup), "merge membership");
  assert(mergeHits([], [sNew]).length === 1, "merge empty primary");

  // buildMemoryUpsert — key from name; blanks -> null; unusable name -> null
  const up = buildMemoryUpsert({
    vendorName: "  Bonsai Gardens ",
    platform: "growflow",
    nowIso: "2026-03-01T10:00:00Z",
    licenseNumber: "424905",
    platformRef: "1211",
    platformSlug: "",
  });
  assert(up !== null, "upsert built");
  assert(up!.vendor_key === "bonsai gardens", "upsert key");
  assert(up!.vendor_name === "Bonsai Gardens", "upsert display name trimmed");
  assert(up!.license_number === "424905", "upsert license");
  assert(up!.platform === "growflow", "upsert platform");
  assert(up!.platform_ref === "1211", "upsert ref");
  assert(up!.platform_slug === null, "blank slug -> null");
  assert(up!.last_seen_at === "2026-03-01T10:00:00Z", "upsert now injected");
  assert(buildMemoryUpsert({ vendorName: "   ", platform: "cultivera", nowIso: "x" }) === null, "unusable name -> null");

  console.log("unified-search-core: self-tests passed");
}
