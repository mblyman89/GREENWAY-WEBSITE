/**
 * src/lib/purchasing/cultivera-store.ts
 *
 * Server-side store for Cultivera vendor-menu snapshots (CV-1). Re-exports the
 * pure cultivera-menu-core normalizers and adds Supabase-backed persistence for
 * the two tables added in migration 0124:
 *
 *   - public.cultivera_menu_snapshots  (one row per fetch of one vendor's menu)
 *   - public.cultivera_menu_items      (the normalized lines of a snapshot)
 *
 * Money is INTEGER MINOR UNITS (cents) end-to-end (wholesale_price_minor).
 * Best-effort: returns null/[] when the Supabase service role isn't configured,
 * mirroring po-store.ts. The crawler (CV-3) calls saveSnapshot after a live
 * fetch; the command center (CV-4) reads snapshots back for browsing.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  normalizeSnapshot,
  type CultiveraSnapshot,
  type CultiveraMenuItem,
} from "@/lib/purchasing/cultivera-menu-core";

export * from "@/lib/purchasing/cultivera-menu-core";

/** A snapshot row as stored (mirrors public.cultivera_menu_snapshots). */
export type CultiveraSnapshotRow = {
  id: string;
  vendor_id: string | null;
  cultivera_market_id: string | null;
  cultivera_market_slug: string | null;
  seller_name: string | null;
  status: string;
  error_message: string | null;
  item_count: number;
  location_id: string | null;
  raw: Record<string, unknown>;
  fetched_by: string | null;
  fetched_at: string;
  created_at: string;
  updated_at: string;
};

/** A menu-item row as stored (mirrors public.cultivera_menu_items). */
export type CultiveraMenuItemRow = {
  id: string;
  snapshot_id: string;
  cultivera_item_id: string | null;
  name: string | null;
  brand: string | null;
  category: string | null;
  inventory_type: string | null;
  strain_type: string | null;
  size_label: string | null;
  unit_count: number | null;
  wholesale_price_minor: number | null;
  available_qty: number | null;
  thc_pct: number | null;
  cbd_pct: number | null;
  total_cannabinoids_pct: number | null;
  potency_raw: Record<string, unknown>;
  description: string | null;
  image_url: string | null;
  coa_url: string | null;
  media_asset_id: string | null;
  coa_media_asset_id: string | null;
  raw: Record<string, unknown>;
  position: number;
  created_at: string;
  updated_at: string;
};

/** Input to saveSnapshot: the raw Cultivera payload + provenance. */
export type SaveSnapshotInput = {
  /** Raw payload from Cultivera (array or envelope) — normalized here. */
  payload: unknown;
  /** Local vendor id, if the buyer has already matched it. */
  vendorId?: string | null;
  /** Cultivera buyer location the fetch ran under (provenance). */
  locationId?: string | null;
  /** Staff id that triggered the fetch (provenance). */
  fetchedBy?: string | null;
  /** Optional overrides when the payload doesn't carry market identity. */
  marketId?: string | null;
  marketSlug?: string | null;
  sellerName?: string | null;
};

export type SaveSnapshotResult = {
  ok: boolean;
  snapshotId: string | null;
  itemCount: number;
  status: "fetched" | "empty" | "error";
  error: string | null;
};

/** Map a normalized item to the DB column shape for one snapshot. */
function itemToRow(snapshotId: string, item: CultiveraMenuItem): Record<string, unknown> {
  return {
    snapshot_id: snapshotId,
    cultivera_item_id: item.cultiveraItemId,
    name: item.name,
    brand: item.brand,
    category: item.category,
    inventory_type: item.inventoryType,
    strain_type: item.strainType === "unknown" ? null : item.strainType,
    size_label: item.sizeLabel,
    unit_count: item.unitCount,
    wholesale_price_minor: item.wholesalePriceMinor,
    available_qty: item.availableQty,
    thc_pct: item.thcPct,
    cbd_pct: item.cbdPct,
    total_cannabinoids_pct: item.totalCannabinoidsPct,
    potency_raw: item.potencyRaw ?? {},
    description: item.description,
    image_url: item.imageUrl,
    coa_url: item.coaUrl,
    raw: item.raw ?? {},
    position: item.position,
  };
}

/**
 * Normalize + persist one live Cultivera menu fetch. Writes the snapshot header
 * then bulk-inserts its items. Returns the new snapshot id + counts.
 *
 * Best-effort: if Supabase service role isn't configured, returns ok:false with
 * the normalized counts so callers can still show a dry-run summary.
 */
export async function saveSnapshot(input: SaveSnapshotInput): Promise<SaveSnapshotResult> {
  const snap: CultiveraSnapshot = normalizeSnapshot(input.payload);
  const status: SaveSnapshotResult["status"] = snap.itemCount > 0 ? "fetched" : "empty";

  if (!isSupabaseServiceConfigured) {
    return { ok: false, snapshotId: null, itemCount: snap.itemCount, status, error: "supabase-not-configured" };
  }

  const admin = createSupabaseAdminClient();

  const { data: header, error: headerErr } = await admin
    .from("cultivera_menu_snapshots")
    .insert({
      vendor_id: input.vendorId ?? null,
      cultivera_market_id: input.marketId ?? snap.cultiveraMarketId,
      cultivera_market_slug: input.marketSlug ?? snap.cultiveraMarketSlug,
      seller_name: input.sellerName ?? snap.sellerName,
      status,
      item_count: snap.itemCount,
      location_id: input.locationId ?? snap.locationId,
      raw: snap.raw ?? {},
      fetched_by: input.fetchedBy ?? null,
    })
    .select("id")
    .single();

  if (headerErr || !header) {
    return {
      ok: false,
      snapshotId: null,
      itemCount: snap.itemCount,
      status: "error",
      error: headerErr?.message ?? "insert-failed",
    };
  }

  const snapshotId = header.id as string;

  if (snap.items.length > 0) {
    const rows = snap.items.map((it) => itemToRow(snapshotId, it));
    const { error: itemsErr } = await admin.from("cultivera_menu_items").insert(rows);
    if (itemsErr) {
      // Record the partial failure on the header so the buyer sees it.
      await admin
        .from("cultivera_menu_snapshots")
        .update({ status: "error", error_message: itemsErr.message })
        .eq("id", snapshotId);
      return { ok: false, snapshotId, itemCount: 0, status: "error", error: itemsErr.message };
    }
  }

  return { ok: true, snapshotId, itemCount: snap.itemCount, status, error: null };
}

/** List recent snapshots (newest first), optionally filtered to one vendor. */
export async function listSnapshots(opts?: { vendorId?: string; limit?: number }): Promise<CultiveraSnapshotRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  let q = admin
    .from("cultivera_menu_snapshots")
    .select("*")
    .order("fetched_at", { ascending: false })
    .limit(opts?.limit ?? 50);
  if (opts?.vendorId) q = q.eq("vendor_id", opts.vendorId);
  const { data, error } = await q;
  if (error || !data) return [];
  return data as CultiveraSnapshotRow[];
}

/** Fetch one snapshot header by id (or null). */
export async function getSnapshot(snapshotId: string): Promise<CultiveraSnapshotRow | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("cultivera_menu_snapshots")
    .select("*")
    .eq("id", snapshotId)
    .single();
  if (error || !data) return null;
  return data as CultiveraSnapshotRow;
}

/** Fetch the items of one snapshot, ordered by position. */
export async function getSnapshotItems(snapshotId: string): Promise<CultiveraMenuItemRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("cultivera_menu_items")
    .select("*")
    .eq("snapshot_id", snapshotId)
    .order("position", { ascending: true });
  if (error || !data) return [];
  return data as CultiveraMenuItemRow[];
}

/** Link a saved media asset back to a menu item (image or COA). Used in CV-5. */
export async function linkItemMedia(
  itemId: string,
  patch: { mediaAssetId?: string | null; coaMediaAssetId?: string | null },
): Promise<boolean> {
  if (!isSupabaseServiceConfigured) return false;
  const admin = createSupabaseAdminClient();
  const update: Record<string, unknown> = {};
  if ("mediaAssetId" in patch) update.media_asset_id = patch.mediaAssetId ?? null;
  if ("coaMediaAssetId" in patch) update.coa_media_asset_id = patch.coaMediaAssetId ?? null;
  if (Object.keys(update).length === 0) return true;
  const { error } = await admin.from("cultivera_menu_items").update(update).eq("id", itemId);
  return !error;
}
