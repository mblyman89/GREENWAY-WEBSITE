"use server";

/**
 * Server actions for the Cultivera vendor-menus command center (CV-4).
 *
 * Two verbs, both behind inventory.manage:
 *   - searchCultiveraVendorsAction: ask the worker for the marketplace vendors
 *     the buyer account can see (optionally name-filtered) and map each record
 *     through the tolerant readers (marketName/Slug/Id) so the client island
 *     never touches unpinned Cultivera field names.
 *   - fetchCultiveraMenuAction: fetch ONE vendor's LIVE menu via the worker,
 *     persist the RAW payload with cultivera-store.saveSnapshot() (the shipped
 *     tolerant normalizers), stamp provenance (fetchedBy = staff id), audit it,
 *     and revalidate the page so the new snapshot appears.
 *
 * Both degrade gracefully: `configured:false` from the client means either the
 * crawler env is missing on the site or the worker has no Cultivera
 * credentials yet (its 503) — the UI shows a setup hint, never a crash.
 */

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  searchCultiveraMarkets,
  fetchCultiveraMenu,
} from "@/lib/purchasing/cultivera-client";
import { saveSnapshot, getSnapshot, getSnapshotItems } from "@/lib/purchasing/cultivera-store";
import {
  marketName,
  marketSlug,
  marketId,
  isFetchableMarket,
} from "@/lib/purchasing/cultivera-menus-ui-core";
import {
  planMediaSaves,
  remainingMediaCount,
  bulkSaveSummary,
} from "@/lib/purchasing/cultivera-media-core";
import { saveItemMedia } from "@/lib/purchasing/cultivera-media";

const BASE = "/admin/purchasing/menus";

function str(formData: FormData, key: string): string {
  return ((formData.get(key) as string | null) ?? "").trim();
}

/** One vendor row the search island renders — already-safe strings only. */
export type VendorHit = {
  name: string;
  slug: string;
  id: string;
  fetchable: boolean;
};

export type VendorSearchResult = {
  ok: boolean;
  configured: boolean;
  vendors: VendorHit[];
  error: string;
};

export async function searchCultiveraVendorsAction(
  formData: FormData,
): Promise<VendorSearchResult> {
  await requirePermission("inventory.manage");

  const query = str(formData, "query");
  const result = await searchCultiveraMarkets(query);

  if (!result.configured) {
    return { ok: false, configured: false, vendors: [], error: result.error };
  }
  if (!result.ok) {
    return {
      ok: false,
      configured: true,
      vendors: [],
      error: result.error || `Cultivera answered ${result.status}.`,
    };
  }

  const vendors: VendorHit[] = result.records.map((rec) => ({
    name: marketName(rec) || "(unnamed vendor)",
    slug: marketSlug(rec),
    id: marketId(rec),
    fetchable: isFetchableMarket(rec),
  }));

  return { ok: true, configured: true, vendors, error: "" };
}

export type FetchMenuResult = {
  ok: boolean;
  configured: boolean;
  snapshotId: string | null;
  itemCount: number;
  error: string;
};

export async function fetchCultiveraMenuAction(
  formData: FormData,
): Promise<FetchMenuResult> {
  const session = await requirePermission("inventory.manage");

  const marketIdIn = str(formData, "market_id");
  const slugIn = str(formData, "slug");
  const sellerName = str(formData, "seller_name");

  if (!marketIdIn && !slugIn) {
    return {
      ok: false,
      configured: true,
      snapshotId: null,
      itemCount: 0,
      error: "Pick a vendor first — a menu fetch needs the vendor's market id or slug.",
    };
  }

  const result = await fetchCultiveraMenu({ marketId: marketIdIn, slug: slugIn });

  if (!result.configured) {
    return { ok: false, configured: false, snapshotId: null, itemCount: 0, error: result.error };
  }
  if (!result.ok) {
    return {
      ok: false,
      configured: true,
      snapshotId: null,
      itemCount: 0,
      error: result.error || `Cultivera answered ${result.status}.`,
    };
  }

  const saved = await saveSnapshot({
    payload: result.raw,
    marketId: marketIdIn || null,
    marketSlug: slugIn || null,
    sellerName: sellerName || null,
    fetchedBy: session.userId,
  });

  if (!saved.ok) {
    return {
      ok: false,
      configured: true,
      snapshotId: saved.snapshotId,
      itemCount: saved.itemCount,
      error:
        saved.error === "supabase-not-configured"
          ? `Fetched ${saved.itemCount} items, but Supabase isn't configured so the snapshot wasn't saved.`
          : `Fetched the menu but saving failed: ${saved.error ?? "unknown error"}`,
    };
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "cultivera.menu.fetched",
    entityType: "cultivera_menu_snapshot",
    entityId: saved.snapshotId,
    after: {
      seller_name: sellerName || null,
      market_id: marketIdIn || null,
      market_slug: slugIn || null,
      item_count: saved.itemCount,
      status: saved.status,
    },
  });

  revalidatePath(BASE);

  return {
    ok: true,
    configured: true,
    snapshotId: saved.snapshotId,
    itemCount: saved.itemCount,
    error: "",
  };
}

/* ------------------------------------------------------------------
 * CV-5 — save menu media (product images + COA PDFs) to the library.
 * ------------------------------------------------------------------ */

/** One bulk run downloads at most this many files (keeps the action snappy). */
const BULK_MEDIA_LIMIT = 20;

export type SaveMediaResult = {
  ok: boolean;
  message: string;
};

/**
 * Save ONE item's image or COA into the media library (drafts, tagged
 * "cultivera" + vendor, provenance kept), link it back to the item.
 */
export async function saveItemMediaAction(formData: FormData): Promise<SaveMediaResult> {
  const session = await requirePermission("inventory.manage");

  const snapshotId = str(formData, "snapshot_id");
  const itemId = str(formData, "item_id");
  const kind = str(formData, "kind");
  if (!snapshotId || !itemId || (kind !== "image" && kind !== "coa")) {
    return { ok: false, message: "Missing snapshot, item, or media kind." };
  }

  const snap = await getSnapshot(snapshotId);
  if (!snap) return { ok: false, message: "Snapshot not found." };
  const items = await getSnapshotItems(snapshotId);
  const item = items.find((it) => it.id === itemId);
  if (!item) return { ok: false, message: "Menu item not found in this snapshot." };

  const vendorLabel = (snap.seller_name ?? "").trim() || (snap.cultivera_market_slug ?? "").trim() || "";
  const res = await saveItemMedia(item, kind, vendorLabel, session.userId);

  if (!res.ok) return { ok: false, message: res.error ?? "Save failed." };

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "cultivera.media.saved",
    entityType: "cultivera_menu_item",
    entityId: itemId,
    after: { kind, assetId: res.assetId, deduped: res.deduped, snapshotId },
  });

  revalidatePath(`${BASE}/${snapshotId}`);
  return {
    ok: true,
    message: res.deduped
      ? `Already in the library — reused the existing ${kind === "coa" ? "COA" : "image"}.`
      : `${kind === "coa" ? "COA" : "Image"} saved to the media library (draft, license pending review).`,
  };
}

/**
 * Bulk-save every unsaved image + COA in a snapshot (chunked: up to
 * BULK_MEDIA_LIMIT downloads per run; the summary says when to run again).
 */
export async function saveAllSnapshotMediaAction(formData: FormData): Promise<SaveMediaResult> {
  const session = await requirePermission("inventory.manage");

  const snapshotId = str(formData, "snapshot_id");
  if (!snapshotId) return { ok: false, message: "Missing snapshot id." };

  const snap = await getSnapshot(snapshotId);
  if (!snap) return { ok: false, message: "Snapshot not found." };
  const items = await getSnapshotItems(snapshotId);
  const vendorLabel = (snap.seller_name ?? "").trim() || (snap.cultivera_market_slug ?? "").trim() || "";

  const plan = planMediaSaves(items, BULK_MEDIA_LIMIT);
  if (plan.length === 0) {
    return { ok: true, message: "Everything on this menu is already saved to the library." };
  }

  const byId = new Map(items.map((it) => [it.id, it]));
  let images = 0;
  let coas = 0;
  let deduped = 0;
  let failed = 0;

  for (const task of plan) {
    const item = byId.get(task.itemId);
    if (!item) continue;
    const res = await saveItemMedia(item, task.kind, vendorLabel, session.userId);
    if (!res.ok) {
      failed += 1;
      continue;
    }
    if (res.deduped) deduped += 1;
    else if (task.kind === "image") images += 1;
    else coas += 1;
  }

  // Remaining work AFTER this run: what the plan couldn't fit, plus failures.
  const fresh = await getSnapshotItems(snapshotId);
  const remaining = remainingMediaCount(fresh);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "cultivera.media.bulk_saved",
    entityType: "cultivera_menu_snapshot",
    entityId: snapshotId,
    after: { images, coas, deduped, failed, remaining },
  });

  revalidatePath(`${BASE}/${snapshotId}`);
  return {
    ok: failed === 0,
    message: bulkSaveSummary({ images, coas, deduped, failed, remaining }),
  };
}
