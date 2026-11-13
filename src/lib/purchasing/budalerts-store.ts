/**
 * src/lib/purchasing/budalerts-store.ts
 *
 * D242 — reads and writes for the Budalerts brand menus (migration 0364).
 * Decisions live in budalerts-core.ts (pure); this file only moves rows.
 *
 * Standing rules:
 *   - NAMED columns only (never `*`).
 *   - Every list read is paged with a unique order (`pagedAll`) or chunked by
 *     key (`chunkedIn`), so PostgREST's 1,000-row cap can never cut a table.
 *   - Money is integer cents (`price_minor`, `price_per_gram_minor`).
 *   - Every call reads its `{ error }`. A missing table (42P01 / PGRST205)
 *     becomes the plain message "migration 0364 has not been run yet".
 *
 * Budalerts permission (owner, D242): internal use only. Nothing here is
 * ever shown on the public site or sold.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { chunkedIn, pagedAll } from "@/lib/supabase/chunked-in";
import { dbErrorForStaff } from "@/lib/db/rpc-fallback-core";
import {
  isValidBrandSlug,
  type BudalertsBrandPage,
  type BudalertsItem,
  type BudalertsLinkRow,
  type BudalertsSnapshotRow,
} from "@/lib/purchasing/budalerts-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type DbErr = { code?: string | null; message?: string | null } | null;

export const BUDALERTS_MIGRATION_MISSING =
  "The Budalerts tables are not in the database yet. Run migration 0364_budalerts_menus.sql (see docs/MIGRATIONS_TO_RUN.md).";

/** True when the error says the table does not exist (migration not run). */
export function isMissingTable(err: DbErr): boolean {
  const code = err?.code ?? "";
  if (code === "42P01" || code === "PGRST205") return true;
  return /relation .* does not exist|could not find the table/i.test(err?.message ?? "");
}

function staffError(err: DbErr, what: string): string {
  if (isMissingTable(err)) return BUDALERTS_MIGRATION_MISSING;
  return `${what}: ${dbErrorForStaff(err, "the database call failed")}`;
}

export class BudalertsStoreError extends Error {}

function admin(): Admin {
  if (!isSupabaseServiceConfigured) throw new BudalertsStoreError("The database is not configured.");
  return createSupabaseAdminClient();
}

/* ------------------------------------------------------------------
 * Column lists (named — never `*`)
 * ------------------------------------------------------------------ */

const LINK_COLS = "id, vendor_id, slug, brand_name, linked_by, linked_at";
const SNAP_COLS =
  "id, slug, brand_name, status, error_message, item_count, image_count, listing_count, dispensary_count, checked_text, logo_url, pages_fetched, categories, warnings, fetched_by, fetched_at";
const ITEM_COLS =
  "id, snapshot_id, product_id, name, brand, category, size_label, strain, price_minor, price_per_gram_minor, below_similar_pct, availability, seller_name, seller_url, product_url, image_url, description, media_asset_id, seen_on, position";
const STATE_COLS =
  "id, last_request_at, lease_owner, lease_until, auto_enabled, last_run_at, last_run_note, known_slugs, known_slugs_at, updated_at";

export type BudalertsLinkDbRow = {
  id: string;
  vendor_id: string;
  slug: string;
  brand_name: string | null;
  linked_by: string | null;
  linked_at: string;
};

export type BudalertsSnapshotDbRow = {
  id: string;
  slug: string;
  brand_name: string | null;
  status: string;
  error_message: string | null;
  item_count: number;
  image_count: number;
  listing_count: number | null;
  dispensary_count: number | null;
  checked_text: string | null;
  logo_url: string | null;
  pages_fetched: number;
  categories: unknown;
  warnings: unknown;
  fetched_by: string | null;
  fetched_at: string;
};

export type BudalertsMenuItemRow = {
  id: string;
  snapshot_id: string;
  product_id: string;
  name: string;
  brand: string | null;
  category: string | null;
  size_label: string | null;
  strain: string | null;
  price_minor: number | null;
  price_per_gram_minor: number | null;
  below_similar_pct: number | null;
  availability: string | null;
  seller_name: string | null;
  seller_url: string | null;
  product_url: string | null;
  image_url: string | null;
  description: string | null;
  media_asset_id: string | null;
  seen_on: string[] | null;
  position: number;
};

export type BudalertsFetchStateRow = {
  id: number;
  last_request_at: string | null;
  lease_owner: string | null;
  lease_until: string | null;
  auto_enabled: boolean;
  last_run_at: string | null;
  last_run_note: string | null;
  known_slugs: unknown;
  known_slugs_at: string | null;
  updated_at: string;
};

export function toSnapshotRow(r: BudalertsSnapshotDbRow): BudalertsSnapshotRow {
  return {
    id: r.id,
    slug: r.slug,
    status: r.status,
    itemCount: r.item_count ?? 0,
    fetchedAt: r.fetched_at,
    brandName: r.brand_name,
    listingCount: r.listing_count,
    imageCount: r.image_count ?? 0,
  };
}

/* ------------------------------------------------------------------
 * Paged read helper (a failure stops paging and is reported)
 * ------------------------------------------------------------------ */

async function readAllChecked<Row>(
  what: string,
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: DbErr }>,
): Promise<{ rows: Row[]; error: string | null; missing: boolean }> {
  let error: string | null = null;
  let missing = false;
  const rows = await pagedAll<Row>(async (from, to) => {
    if (error) return [];
    const res = await page(from, to);
    if (res.error) {
      missing = isMissingTable(res.error);
      error = staffError(res.error, what);
      return [];
    }
    return (res.data as Row[] | null) ?? [];
  });
  return { rows, error, missing };
}

/* ------------------------------------------------------------------
 * Overview — everything the Vendor Menus page needs, in a few reads
 * ------------------------------------------------------------------ */

export type BudalertsOverview = {
  /** false when migration 0364 has not been run — the page shows a notice. */
  available: boolean;
  links: BudalertsLinkDbRow[];
  snapshots: BudalertsSnapshotDbRow[];
  state: BudalertsFetchStateRow | null;
  knownSlugs: string[];
  warnings: string[];
};

export async function loadBudalertsOverview(): Promise<BudalertsOverview> {
  const empty: BudalertsOverview = { available: false, links: [], snapshots: [], state: null, knownSlugs: [], warnings: [] };
  if (!isSupabaseServiceConfigured) return empty;
  const db = createSupabaseAdminClient();
  const [links, snaps, state] = await Promise.all([
    readAllChecked<BudalertsLinkDbRow>("Budalerts brand links", (f, t) =>
      db.from("budalerts_brand_links").select(LINK_COLS)
        .order("linked_at", { ascending: true }).order("id", { ascending: true }).range(f, t)),
    readAllChecked<BudalertsSnapshotDbRow>("Budalerts pulls", (f, t) =>
      db.from("budalerts_brand_snapshots").select(SNAP_COLS)
        .order("fetched_at", { ascending: false }).order("id", { ascending: true }).range(f, t)),
    db.from("budalerts_fetch_state").select(STATE_COLS).eq("id", 1).maybeSingle(),
  ]);
  if (links.missing || snaps.missing || isMissingTable(state.error)) {
    return { ...empty, warnings: [BUDALERTS_MIGRATION_MISSING] };
  }
  const warnings: string[] = [];
  if (links.error) warnings.push(links.error);
  if (snaps.error) warnings.push(snaps.error);
  if (state.error) warnings.push(staffError(state.error, "Budalerts fetch state"));
  const st = (state.data as BudalertsFetchStateRow | null) ?? null;
  return {
    available: true,
    links: links.rows,
    snapshots: snaps.rows,
    state: st,
    knownSlugs: knownSlugsFrom(st?.known_slugs),
    warnings,
  };
}

export function knownSlugsFrom(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === "string" && isValidBrandSlug(s));
}

export function linkRowsFrom(rows: readonly BudalertsLinkDbRow[]): BudalertsLinkRow[] {
  return rows.map((r) => ({ vendorId: r.vendor_id, slug: r.slug }));
}

/* ------------------------------------------------------------------
 * Links
 * ------------------------------------------------------------------ */

export async function linkBrand(vendorId: string, slug: string, brandName: string | null, userId: string | null): Promise<void> {
  if (!isValidBrandSlug(slug)) throw new BudalertsStoreError("That is not a valid Budalerts brand slug.");
  const { error } = await admin()
    .from("budalerts_brand_links")
    .upsert(
      { vendor_id: vendorId, slug, brand_name: brandName, linked_by: userId },
      { onConflict: "vendor_id,slug", ignoreDuplicates: true },
    );
  if (error) throw new BudalertsStoreError(staffError(error, "Linking the brand"));
}

export async function unlinkBrand(vendorId: string, slug: string): Promise<void> {
  const { error } = await admin().from("budalerts_brand_links").delete().eq("vendor_id", vendorId).eq("slug", slug);
  if (error) throw new BudalertsStoreError(staffError(error, "Unlinking the brand"));
}

/* ------------------------------------------------------------------
 * Snapshots + items
 * ------------------------------------------------------------------ */

export type SaveSnapshotInput = {
  slug: string;
  page: BudalertsBrandPage | null;
  items: readonly BudalertsItem[];
  status: "fetched" | "partial" | "empty" | "error";
  errorMessage: string | null;
  pagesFetched: number;
  imageCount: number;
  warnings: readonly string[];
  fetchedBy: string | null;
};

const ITEM_INSERT_CHUNK = 200;

/** Map one parsed item to its DB row (cents already integers in the parser). */
export function itemInsertRow(snapshotId: string, it: BudalertsItem, position: number) {
  return {
    snapshot_id: snapshotId,
    product_id: it.productId,
    name: it.name.slice(0, 500),
    brand: it.brandName,
    category: it.category,
    size_label: it.sizeLabel,
    strain: it.strain,
    price_minor: it.priceMinor,
    price_per_gram_minor: it.pricePerGramMinor,
    below_similar_pct:
      it.belowSimilarPct !== null && it.belowSimilarPct >= 0 && it.belowSimilarPct <= 100 ? it.belowSimilarPct : null,
    availability: it.availability,
    seller_name: it.sellerName,
    seller_url: it.sellerUrl,
    product_url: it.productUrl,
    image_url: it.imageUrl,
    description: it.description,
    seen_on: it.seenOn,
    position,
  };
}

/** Save one pull: header first, then its items in chunks. Returns the snapshot id. */
export async function saveSnapshot(input: SaveSnapshotInput): Promise<string> {
  const db = admin();
  const p = input.page;
  const { data, error } = await db
    .from("budalerts_brand_snapshots")
    .insert({
      slug: input.slug,
      brand_name: p?.brandName ?? null,
      status: input.status,
      error_message: input.errorMessage ? input.errorMessage.slice(0, 1000) : null,
      item_count: input.items.length,
      image_count: input.imageCount,
      listing_count: p?.listingCount ?? null,
      dispensary_count: p?.dispensaryCount ?? null,
      checked_text: p?.checkedText ?? null,
      logo_url: p?.logoUrl ?? null,
      pages_fetched: input.pagesFetched,
      categories: p?.categories ?? [],
      warnings: input.warnings.slice(0, 50),
      fetched_by: input.fetchedBy,
    })
    .select("id")
    .single();
  if (error || !data) throw new BudalertsStoreError(staffError(error, "Saving the Budalerts pull"));
  const snapshotId = (data as { id: string }).id;

  const rows = input.items.map((it, i) => itemInsertRow(snapshotId, it, i));
  for (let i = 0; i < rows.length; i += ITEM_INSERT_CHUNK) {
    const { error: e2 } = await db.from("budalerts_menu_items").insert(rows.slice(i, i + ITEM_INSERT_CHUNK));
    if (e2) {
      // Keep the header honest: the pull is partial when items failed to save.
      await db
        .from("budalerts_brand_snapshots")
        .update({ status: "partial", error_message: staffError(e2, "Saving listings").slice(0, 1000), item_count: i })
        .eq("id", snapshotId);
      throw new BudalertsStoreError(staffError(e2, "Saving the Budalerts listings"));
    }
  }
  return snapshotId;
}

export async function getSnapshot(id: string): Promise<BudalertsSnapshotDbRow | null> {
  const { data, error } = await admin().from("budalerts_brand_snapshots").select(SNAP_COLS).eq("id", id).maybeSingle();
  if (error) throw new BudalertsStoreError(staffError(error, "Reading the Budalerts pull"));
  return (data as BudalertsSnapshotDbRow | null) ?? null;
}

export async function listSnapshotItems(snapshotId: string): Promise<BudalertsMenuItemRow[]> {
  const db = admin();
  const res = await readAllChecked<BudalertsMenuItemRow>("Budalerts listings", (f, t) =>
    db.from("budalerts_menu_items").select(ITEM_COLS).eq("snapshot_id", snapshotId)
      .order("position", { ascending: true }).order("id", { ascending: true }).range(f, t));
  if (res.error) throw new BudalertsStoreError(res.error);
  return res.rows;
}

export async function getMenuItemsByIds(ids: readonly string[]): Promise<BudalertsMenuItemRow[]> {
  if (ids.length === 0) return [];
  const db = admin();
  return chunkedIn<string, BudalertsMenuItemRow>(ids, async (chunk, from, to) => {
    const { data, error } = await db.from("budalerts_menu_items").select(ITEM_COLS).in("id", chunk)
      .order("id", { ascending: true }).range(from, to);
    if (error) throw new BudalertsStoreError(staffError(error, "Reading Budalerts listings"));
    return (data as BudalertsMenuItemRow[] | null) ?? [];
  });
}

export async function linkBudalertsItemMedia(itemId: string, mediaAssetId: string): Promise<void> {
  const { error } = await admin().from("budalerts_menu_items").update({ media_asset_id: mediaAssetId }).eq("id", itemId);
  if (error) throw new BudalertsStoreError(staffError(error, "Linking the saved image"));
}

/** Vendors linked to a slug (to name the saved images after the vendor). */
export async function vendorIdsForSlug(slug: string): Promise<string[]> {
  const { data, error } = await admin().from("budalerts_brand_links").select("vendor_id").eq("slug", slug).order("vendor_id").limit(50);
  if (error) throw new BudalertsStoreError(staffError(error, "Reading brand links"));
  return ((data as { vendor_id: string }[] | null) ?? []).map((r) => r.vendor_id);
}

/* ------------------------------------------------------------------
 * Fetch state — politeness clock, lease, sitemap cache
 * ------------------------------------------------------------------ */

export async function readFetchState(): Promise<BudalertsFetchStateRow | null> {
  const { data, error } = await admin().from("budalerts_fetch_state").select(STATE_COLS).eq("id", 1).maybeSingle();
  if (error) throw new BudalertsStoreError(staffError(error, "Reading the Budalerts fetch state"));
  return (data as BudalertsFetchStateRow | null) ?? null;
}

/** Stamp the moment we are about to make a request (shared clock across instances). */
export async function stampRequest(atIso: string): Promise<void> {
  const { error } = await admin().from("budalerts_fetch_state").update({ last_request_at: atIso, updated_at: atIso }).eq("id", 1);
  if (error) throw new BudalertsStoreError(staffError(error, "Updating the Budalerts clock"));
}

/**
 * Take the one fetch lease (so two tabs never fetch at the same time).
 * Succeeds only when nobody holds it or it has run out.
 */
export async function acquireLease(owner: string, nowIso: string, untilIso: string): Promise<boolean> {
  const { data, error } = await admin()
    .from("budalerts_fetch_state")
    .update({ lease_owner: owner, lease_until: untilIso, updated_at: nowIso })
    .eq("id", 1)
    .or(`lease_until.is.null,lease_until.lt.${nowIso},lease_owner.eq.${owner}`)
    .select("id");
  if (error) throw new BudalertsStoreError(staffError(error, "Taking the Budalerts fetch lease"));
  return Array.isArray(data) && data.length > 0;
}

export async function releaseLease(owner: string, note: string | null, nowIso: string): Promise<void> {
  const { error } = await admin()
    .from("budalerts_fetch_state")
    .update({ lease_owner: null, lease_until: null, last_run_at: nowIso, last_run_note: note ? note.slice(0, 1000) : null, updated_at: nowIso })
    .eq("id", 1)
    .eq("lease_owner", owner);
  if (error) throw new BudalertsStoreError(staffError(error, "Releasing the Budalerts fetch lease"));
}

export async function saveKnownSlugs(slugs: readonly string[], nowIso: string): Promise<void> {
  const clean = [...new Set(slugs.filter((s) => isValidBrandSlug(s)))].sort();
  const { error } = await admin()
    .from("budalerts_fetch_state")
    .update({ known_slugs: clean, known_slugs_at: nowIso, updated_at: nowIso })
    .eq("id", 1);
  if (error) throw new BudalertsStoreError(staffError(error, "Saving the Budalerts brand list"));
}
