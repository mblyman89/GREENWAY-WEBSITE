/**
 * src/lib/purchasing/leaflink-store.ts
 *
 * SLICE 84 — server-side store for LeafLink vendor-menu snapshots. Mirrors
 * growflow-store.ts exactly, over the two tables added in migration 0145:
 *
 *   - public.leaflink_menu_snapshots  (one row per fetch of one brand's menu)
 *   - public.leaflink_menu_items      (the normalized lines of a snapshot)
 *
 * Money is INTEGER MINOR UNITS (cents) end-to-end (wholesale_price_minor,
 * msrp_minor) — LeafLink's dollar amounts (pinned: object/number/string) were
 * already converted by the LL-1 normalizers. Best-effort: returns null/[]/false
 * when the Supabase service role isn't configured, mirroring growflow-store.ts.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  normalizeSnapshot,
  type LeaflinkSnapshot,
  type LeaflinkMenuItem,
} from "@/lib/purchasing/leaflink-menu-core";

/** A snapshot row as stored (mirrors public.leaflink_menu_snapshots). */
export type LeaflinkSnapshotRow = {
  id: string;
  vendor_id: string | null;
  leaflink_brand_id: string | null;
  brand_name: string | null;
  company_name: string | null;
  brand_description: string | null;
  status: string;
  error_message: string | null;
  item_count: number;
  raw: Record<string, unknown>;
  fetched_by: string | null;
  fetched_at: string;
  created_at: string;
  updated_at: string;
};

/** A menu-item row as stored (mirrors public.leaflink_menu_items). */
export type LeaflinkMenuItemRow = {
  id: string;
  snapshot_id: string;
  leaflink_item_id: string | null;
  name: string | null;
  brand: string | null;
  category: string | null;
  inventory_type: string | null;
  strain_type: string | null;
  size_label: string | null;
  unit_count: number | null;
  wholesale_price_minor: number | null;
  msrp_minor: number | null;
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
  product_line: string | null;
  sku: string | null;
  raw: Record<string, unknown>;
  position: number;
  created_at: string;
  updated_at: string;
};

/** Input to saveLeaflinkSnapshot: the raw worker payload + provenance. */
export type SaveLeaflinkSnapshotInput = {
  /** Raw payload from the worker ({brand, products}) — normalized here. */
  payload: unknown;
  /** Local vendor id, if the buyer has already matched it. */
  vendorId?: string | null;
  /** Staff id that triggered the fetch (provenance). */
  fetchedBy?: string | null;
  /** Overrides — used when the search hit knows more than the payload. */
  brandId?: string | null;
  brandName?: string | null;
  companyName?: string | null;
};

export type SaveLeaflinkSnapshotResult = {
  ok: boolean;
  snapshotId: string | null;
  itemCount: number;
  status: "fetched" | "empty" | "error";
  error: string | null;
};

/** Map a normalized item to the DB column shape for one snapshot. */
function itemToRow(snapshotId: string, item: LeaflinkMenuItem): Record<string, unknown> {
  return {
    snapshot_id: snapshotId,
    leaflink_item_id: item.leaflinkItemId,
    name: item.name,
    brand: item.brand,
    category: item.category,
    inventory_type: item.inventoryType,
    strain_type: item.strainType === "unknown" ? null : item.strainType,
    size_label: item.sizeLabel,
    unit_count: item.unitCount,
    wholesale_price_minor: item.wholesalePriceMinor,
    msrp_minor: item.msrpMinor,
    available_qty: item.availableQty,
    thc_pct: item.thcPct,
    cbd_pct: item.cbdPct,
    total_cannabinoids_pct: item.totalCannabinoidsPct,
    potency_raw: item.potencyRaw ?? {},
    description: item.description,
    image_url: item.imageUrl,
    coa_url: item.coaUrl,
    product_line: item.productLine,
    sku: item.sku,
    raw: item.raw ?? {},
    position: item.position,
  };
}

/**
 * Normalize + persist one live LeafLink menu fetch. Writes the snapshot header
 * then bulk-inserts its items. Returns the new snapshot id + counts.
 *
 * Best-effort: if Supabase service role isn't configured, returns ok:false with
 * the normalized counts so callers can still show a dry-run summary.
 */
export async function saveLeaflinkSnapshot(
  input: SaveLeaflinkSnapshotInput,
): Promise<SaveLeaflinkSnapshotResult> {
  const snap: LeaflinkSnapshot = normalizeSnapshot(input.payload);
  const status: SaveLeaflinkSnapshotResult["status"] = snap.itemCount > 0 ? "fetched" : "empty";

  if (!isSupabaseServiceConfigured) {
    return { ok: false, snapshotId: null, itemCount: snap.itemCount, status, error: "supabase-not-configured" };
  }

  const admin = createSupabaseAdminClient();

  const { data: header, error: headerErr } = await admin
    .from("leaflink_menu_snapshots")
    .insert({
      vendor_id: input.vendorId ?? null,
      leaflink_brand_id: input.brandId ?? snap.leaflinkBrandId,
      brand_name: input.brandName ?? snap.brandName,
      company_name: input.companyName ?? snap.companyName,
      brand_description: snap.brandDescription,
      status,
      item_count: snap.itemCount,
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
    const { error: itemsErr } = await admin.from("leaflink_menu_items").insert(rows);
    if (itemsErr) {
      // Record the partial failure on the header so the buyer sees it.
      await admin
        .from("leaflink_menu_snapshots")
        .update({ status: "error", error_message: itemsErr.message })
        .eq("id", snapshotId);
      return { ok: false, snapshotId, itemCount: 0, status: "error", error: itemsErr.message };
    }
  }

  return { ok: true, snapshotId, itemCount: snap.itemCount, status, error: null };
}

/** List recent LeafLink snapshots (newest first), optionally for one vendor. */
export async function listLeaflinkSnapshots(opts?: {
  vendorId?: string;
  limit?: number;
}): Promise<LeaflinkSnapshotRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  let q = admin
    .from("leaflink_menu_snapshots")
    .select("*")
    .order("fetched_at", { ascending: false })
    .limit(opts?.limit ?? 50);
  if (opts?.vendorId) q = q.eq("vendor_id", opts.vendorId);
  const { data, error } = await q;
  if (error || !data) return [];
  return data as LeaflinkSnapshotRow[];
}

/** Fetch one LeafLink snapshot header by id (or null). */
export async function getLeaflinkSnapshot(snapshotId: string): Promise<LeaflinkSnapshotRow | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("leaflink_menu_snapshots")
    .select("*")
    .eq("id", snapshotId)
    .single();
  if (error || !data) return null;
  return data as LeaflinkSnapshotRow;
}

/** Fetch the items of one LeafLink snapshot, ordered by position. */
export async function getLeaflinkSnapshotItems(snapshotId: string): Promise<LeaflinkMenuItemRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("leaflink_menu_items")
    .select("*")
    .eq("snapshot_id", snapshotId)
    .order("position", { ascending: true });
  if (error || !data) return [];
  return data as LeaflinkMenuItemRow[];
}

/** Link a saved media asset back to a LeafLink menu item (image or COA). */
export async function linkLeaflinkItemMedia(
  itemId: string,
  patch: { mediaAssetId?: string | null; coaMediaAssetId?: string | null },
): Promise<boolean> {
  if (!isSupabaseServiceConfigured) return false;
  const admin = createSupabaseAdminClient();
  const update: Record<string, unknown> = {};
  if ("mediaAssetId" in patch) update.media_asset_id = patch.mediaAssetId ?? null;
  if ("coaMediaAssetId" in patch) update.coa_media_asset_id = patch.coaMediaAssetId ?? null;
  if (Object.keys(update).length === 0) return true;
  const { error } = await admin.from("leaflink_menu_items").update(update).eq("id", itemId);
  return !error;
}
