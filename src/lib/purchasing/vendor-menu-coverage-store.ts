/**
 * src/lib/purchasing/vendor-menu-coverage-store.ts
 *
 * D209 — the reads behind the Vendor Menus coverage tables. Decisions live in
 * vendor-menu-coverage-core.ts (pure); this file only reads rows.
 *
 * Rule 18 (speed) — every read here:
 *   - selects NAMED columns (never `*`);
 *   - is paged with a UNIQUE order (`pagedAll`) or chunked by key (`chunkedIn`),
 *     so PostgREST's silent 1,000-row cap can never shorten a table;
 *   - menu ITEMS are read only for the newest usable snapshot per vendor and
 *     source (`latestUsableSnapshotIds`), never for the whole history.
 * The page calls `loadVendorMenuCoverage()` through React `cache()`, so the
 * two streamed sections share ONE set of reads per request.
 *
 * Rule 15 — every call reads its `{ error }`. A failed read never throws the
 * page away: it becomes a plain-English warning (dbErrorForStaff) shown above
 * the tables, and the tables say they may be incomplete.
 */
import "server-only";

import { cache } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { chunkedIn, pagedAll, ADMIN_PAGED_CONCURRENCY } from "@/lib/supabase/chunked-in";
import { dbErrorForStaff } from "@/lib/db/rpc-fallback-core";
import {
  buildVendorMatcher,
  buildSurvivorResolver,
  mergedIntoFromNotes,
  buildSearchedRows,
  buildNeededRows,
  coverageKpis,
  latestUsableSnapshotIds,
  rollupLots,
  type CoverageAlias,
  type CoverageBrand,
  type CoverageItem,
  type CoverageKpis,
  type CoverageLot,
  type CoverageMemory,
  type CoverageSnapshot,
  type CoverageVendor,
  type MenuSource,
  type NeededRow,
  type SearchedRow,
  type VendorPickOption,
  isListableVendor,
} from "@/lib/purchasing/vendor-menu-coverage-core";
import { missingLogoQueue } from "@/lib/purchasing/vendor-logo-core";
import { publicMediaUrl } from "@/lib/vendors/store";

export type VendorMenuCoverage = {
  searched: SearchedRow[];
  needed: NeededRow[];
  kpis: CoverageKpis;
  /** D212 — vendor id → public logo URL (only vendors whose logo resolved). */
  logos: Record<string, string>;
  /** D212 — vendors we carry with no logo yet (what "Fetch all missing logos" works through). */
  missingLogos: number;
  /** D213 — every live vendor card, for the "Link to vendor" picker. */
  linkOptions: VendorPickOption[];
  /** D213 — names of the duplicate cards rows point at (id → "Name · Lic n"). */
  duplicateNames: Record<string, string>;
  /** Plain-English problems from reads that failed; empty when everything loaded. */
  warnings: string[];
  configured: boolean;
};

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type DbErr = { code?: string | null; message?: string | null } | null;

/** One paged read; a failure stops paging and is reported, never swallowed. */
async function readAll<Row>(
  what: string,
  warnings: string[],
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: DbErr }>,
): Promise<Row[]> {
  let failed = false;
  const rows = await pagedAll<Row>(
    async (from, to) => {
      if (failed) return [];
      const { data, error } = await page(from, to);
      if (error) {
        failed = true;
        warnings.push(`${what}: ${dbErrorForStaff(error, "the read failed")}`);
        return [];
      }
      return (data as Row[] | null) ?? [];
    },
    { concurrency: ADMIN_PAGED_CONCURRENCY },
  );
  return rows;
}

/* ------------------------------------------------------------------
 * Snapshot headers (all four sources) — named columns, paged
 * ------------------------------------------------------------------ */

async function readSnapshots(admin: Admin, warnings: string[]): Promise<CoverageSnapshot[]> {
  type Cv = { id: string; vendor_id: string | null; seller_name: string | null; cultivera_market_slug: string | null; status: string; item_count: number; fetched_at: string; error_message: string | null };
  type Gf = { id: string; vendor_id: string | null; store_name: string | null; license_number: string | null; status: string; item_count: number; fetched_at: string; error_message: string | null };
  type Ll = { id: string; vendor_id: string | null; brand_name: string | null; company_name: string | null; status: string; item_count: number; fetched_at: string; error_message: string | null };
  type Em = { id: string; vendor_id: string | null; from_name: string | null; from_address: string | null; subject: string | null; status: string; item_count: number; received_at: string; error_message: string | null };

  const [cv, gf, ll, em] = await Promise.all([
    readAll<Cv>("Cultivera menus", warnings, (f, t) =>
      admin.from("cultivera_menu_snapshots")
        .select("id, vendor_id, seller_name, cultivera_market_slug, status, item_count, fetched_at, error_message")
        .order("fetched_at", { ascending: false }).order("id", { ascending: true }).range(f, t)),
    readAll<Gf>("GrowFlow menus", warnings, (f, t) =>
      admin.from("growflow_menu_snapshots")
        .select("id, vendor_id, store_name, license_number, status, item_count, fetched_at, error_message")
        .order("fetched_at", { ascending: false }).order("id", { ascending: true }).range(f, t)),
    readAll<Ll>("LeafLink menus", warnings, (f, t) =>
      admin.from("leaflink_menu_snapshots")
        .select("id, vendor_id, brand_name, company_name, status, item_count, fetched_at, error_message")
        .order("fetched_at", { ascending: false }).order("id", { ascending: true }).range(f, t)),
    readAll<Em>("Emailed menus", warnings, (f, t) =>
      admin.from("emailed_menu_snapshots")
        .select("id, vendor_id, from_name, from_address, subject, status, item_count, received_at, error_message")
        .order("received_at", { ascending: false }).order("id", { ascending: true }).range(f, t)),
  ]);

  const str = (s: string | null | undefined) => (s ?? "").trim();
  return [
    ...cv.map((s): CoverageSnapshot => ({
      source: "cultivera", id: s.id, vendorId: s.vendor_id,
      label: str(s.seller_name) || str(s.cultivera_market_slug) || "Unknown vendor",
      altLabel: str(s.seller_name) ? str(s.cultivera_market_slug).replace(/-/g, " ") || null : null,
      license: null, status: s.status, itemCount: s.item_count ?? 0, fetchedAt: s.fetched_at, errorMessage: s.error_message,
    })),
    ...gf.map((s): CoverageSnapshot => ({
      source: "growflow", id: s.id, vendorId: s.vendor_id,
      label: str(s.store_name) || str(s.license_number) || "Unknown vendor", altLabel: null,
      license: s.license_number, status: s.status, itemCount: s.item_count ?? 0, fetchedAt: s.fetched_at, errorMessage: s.error_message,
    })),
    ...ll.map((s): CoverageSnapshot => ({
      source: "leaflink", id: s.id, vendorId: s.vendor_id,
      label: str(s.brand_name) || str(s.company_name) || "Unknown vendor", altLabel: str(s.company_name) || null,
      license: null, status: s.status, itemCount: s.item_count ?? 0, fetchedAt: s.fetched_at, errorMessage: s.error_message,
    })),
    ...em.map((s): CoverageSnapshot => ({
      source: "email", id: s.id, vendorId: s.vendor_id,
      label: str(s.from_name) || str(s.from_address) || "Unknown sender", altLabel: null,
      license: null, status: s.status, itemCount: s.item_count ?? 0, fetchedAt: s.received_at, errorMessage: s.error_message,
    })),
  ];
}

/* ------------------------------------------------------------------
 * Item facts — ONLY the newest usable snapshot per vendor + source
 * ------------------------------------------------------------------ */

const ITEM_TABLE: Record<MenuSource, string> = {
  cultivera: "cultivera_menu_items",
  growflow: "growflow_menu_items",
  leaflink: "leaflink_menu_items",
  email: "emailed_menu_items",
};

type ItemRow = {
  id: string;
  snapshot_id: string;
  wholesale_price_minor: number | null;
  thc_pct: number | null;
  category: string | null;
  image_url: string | null;
  media_asset_id: string | null;
  coa_url?: string | null;
  coa_media_asset_id?: string | null;
  available_qty: number | null;
};

async function readItems(admin: Admin, ids: Record<MenuSource, string[]>, warnings: string[]): Promise<Map<string, CoverageItem[]>> {
  const out = new Map<string, CoverageItem[]>();
  const runs = (Object.keys(ids) as MenuSource[]).map(async (source) => {
    const list = ids[source];
    if (list.length === 0) return;
    // Emailed items have no COA columns (migration 0144).
    const cols =
      source === "email"
        ? "id, snapshot_id, wholesale_price_minor, thc_pct, category, image_url, media_asset_id, available_qty"
        : "id, snapshot_id, wholesale_price_minor, thc_pct, category, image_url, media_asset_id, coa_url, coa_media_asset_id, available_qty";
    let failed = false;
    const rows = await chunkedIn<string, ItemRow>(list, async (chunk, from, to) => {
      if (failed) return [];
      const { data, error } = await admin
        .from(ITEM_TABLE[source])
        .select(cols)
        .in("snapshot_id", chunk)
        .order("id", { ascending: true })
        .range(from, to);
      if (error) {
        failed = true;
        warnings.push(`Menu items (${source}): ${dbErrorForStaff(error, "the read failed")}`);
        return [];
      }
      return (data as unknown as ItemRow[] | null) ?? [];
    });
    for (const r of rows) {
      const item: CoverageItem = {
        snapshotId: r.snapshot_id,
        priceMinor: r.wholesale_price_minor,
        thcPct: r.thc_pct === null || r.thc_pct === undefined ? null : Number(r.thc_pct),
        category: r.category,
        hasImage: Boolean((r.image_url ?? "").trim() || r.media_asset_id),
        hasCoa: Boolean((r.coa_url ?? "").trim() || r.coa_media_asset_id),
        availableQty: r.available_qty === null || r.available_qty === undefined ? null : Number(r.available_qty),
      };
      const arr = out.get(r.snapshot_id);
      if (arr) arr.push(item);
      else out.set(r.snapshot_id, [item]);
    }
  });
  await Promise.all(runs);
  return out;
}

/* ------------------------------------------------------------------
 * The loader
 * ------------------------------------------------------------------ */

async function loadUncached(nowMs: number): Promise<VendorMenuCoverage> {
  const empty: VendorMenuCoverage = {
    searched: [],
    needed: [],
    kpis: coverageKpis([], [], new Map()),
    logos: {},
    missingLogos: 0,
    linkOptions: [],
    duplicateNames: {},
    warnings: [],
    configured: false,
  };
  if (!isSupabaseServiceConfigured) return empty;
  const admin = createSupabaseAdminClient();
  const warnings: string[] = [];

  type VendorRow = CoverageVendor & { internal_notes: string | null };
  const [vendorRows, aliases, brands, lots, memories, snapshots] = await Promise.all([
    readAll<VendorRow>("Vendors", warnings, (f, t) =>
      admin.from("vendors")
        .select("id, display_name, slug, dba, legal_name, license_number, email, phone, website, is_active, total_accepted_ytd_cents, last_accepted_at, status, logo_media_id, internal_notes")
        .order("id", { ascending: true }).range(f, t)),
    readAll<CoverageAlias>("Vendor aliases", warnings, (f, t) =>
      admin.from("vendor_aliases").select("id, vendor_id, source_name, source_system").order("id", { ascending: true }).range(f, t)),
    readAll<CoverageBrand>("Brands", warnings, (f, t) =>
      admin.from("brands").select("id, vendor_id, display_name").not("vendor_id", "is", null).order("id", { ascending: true }).range(f, t)),
    readAll<CoverageLot>("Inventory lots", warnings, (f, t) =>
      admin.from("inventory_lots")
        .select("id, vendor_id, on_hand_qty, status, received_on, created_at, category")
        .not("vendor_id", "is", null).order("id", { ascending: true }).range(f, t)),
    readAll<CoverageMemory>("Platform memory", warnings, (f, t) =>
      admin.from("vendor_platform_map")
        .select("id, vendor_key, vendor_name, license_number, platform, last_seen_at")
        .order("id", { ascending: true }).range(f, t)),
    readSnapshots(admin, warnings),
  ]);

  // D213 — merged (archived) cards resolve to their survivor: parse the
  // "Merged into … (<uuid>)" note merge_vendors() writes, then drop the notes.
  const vendors: CoverageVendor[] = vendorRows.map(({ internal_notes, ...v }) => ({
    ...v,
    merged_into_id: (v.status ?? "").toLowerCase() === "archived" ? mergedIntoFromNotes(internal_notes) : null,
  }));
  const lotsByVendor = rollupLots(lots, buildSurvivorResolver(vendors));
  const carried = new Set([...lotsByVendor.entries()].filter(([, l]) => l.lotsTotal > 0).map(([id]) => id));
  const match = buildVendorMatcher(vendors, aliases, brands, { carried });
  const itemsBySnapshot = await readItems(admin, latestUsableSnapshotIds(snapshots, match), warnings);
  const searched = buildSearchedRows({ snapshots, vendors, match, itemsBySnapshot, lotsByVendor, memories, nowMs });
  const needed = buildNeededRows({ vendors, lotsByVendor, searched, memories, nowMs });
  const logos = await readLogoUrls(admin, vendors, warnings);
  const missingLogos = missingLogoQueue(
    vendors.map((v) => ({ ...v, status: v.status ?? null, logo_media_id: v.logo_media_id ?? null })),
    lotsByVendor,
    Number.MAX_SAFE_INTEGER,
  ).length;
  const vendorLabel = (v: CoverageVendor) => {
    const extra = [v.dba && v.dba.toLowerCase() !== v.display_name.toLowerCase() ? `DBA ${v.dba}` : "", v.license_number ? `Lic ${v.license_number}` : ""]
      .filter(Boolean)
      .join(" · ");
    return extra ? `${v.display_name} — ${extra}` : v.display_name;
  };
  const linkOptions = vendors
    .filter(isListableVendor)
    .map((v) => ({ id: v.id, label: vendorLabel(v) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const byId = new Map(vendors.map((v) => [v.id, v]));
  const duplicateNames: Record<string, string> = {};
  for (const r of searched) {
    for (const d of r.duplicateIds) {
      const v = byId.get(d);
      if (v) duplicateNames[d] = vendorLabel(v);
    }
  }
  return {
    searched,
    needed,
    kpis: coverageKpis(searched, needed, lotsByVendor, vendors),
    logos,
    missingLogos,
    linkOptions,
    duplicateNames,
    warnings,
    configured: true,
  };
}

/** D212 — logo thumbnails: media_assets.storage_key → public bucket URL. */
async function readLogoUrls(admin: Admin, vendors: readonly CoverageVendor[], warnings: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(vendors.map((v) => v.logo_media_id).filter((x): x is string => Boolean(x)))];
  const out: Record<string, string> = {};
  if (ids.length === 0) return out;
  let failed = false;
  const rows = await chunkedIn<string, { id: string; storage_key: string | null }>(ids, async (chunk, from, to) => {
    if (failed) return [];
    const { data, error } = await admin
      .from("media_assets")
      .select("id, storage_key")
      .in("id", chunk)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) {
      failed = true;
      warnings.push(`Vendor logos: ${dbErrorForStaff(error, "the read failed")}`);
      return [];
    }
    return (data as { id: string; storage_key: string | null }[] | null) ?? [];
  });
  const keyById = new Map(rows.map((r) => [r.id, r.storage_key]));
  for (const v of vendors) {
    if (!v.logo_media_id) continue;
    const url = publicMediaUrl(keyById.get(v.logo_media_id));
    if (url) out[v.id] = url;
  }
  return out;
}

/**
 * One load per request, shared by every streamed section (rule 18). The page
 * passes a minute-rounded `nowMs` so both sections hit the same cache entry.
 * Not cross-request cached: menus are fetched live and should show at once.
 */
export const loadVendorMenuCoverage = cache(loadUncached);
