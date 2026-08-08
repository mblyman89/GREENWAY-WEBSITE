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
  fetchCultiveraProductDetail,
} from "@/lib/purchasing/cultivera-client";
import { fetchGrowflowMenu } from "@/lib/purchasing/growflow-client";
import {
  saveGrowflowSnapshot,
  getGrowflowSnapshot,
  getGrowflowSnapshotItems,
} from "@/lib/purchasing/growflow-store";
import { saveGrowflowItemMedia } from "@/lib/purchasing/growflow-media";
import { fetchLeaflinkMenu } from "@/lib/purchasing/leaflink-client";
import {
  saveLeaflinkSnapshot,
  getLeaflinkSnapshot,
  getLeaflinkSnapshotItems,
} from "@/lib/purchasing/leaflink-store";
import { saveLeaflinkItemMedia } from "@/lib/purchasing/leaflink-media";
import { unifiedVendorSearch } from "@/lib/purchasing/unified-search";
import {
  descriptionOutcomeSentence,
  strainDescriptionsSentence,
} from "@/lib/purchasing/save-assets-core";
import {
  buildMemoryUpsert,
  type UnifiedVendorHit,
  type VendorPlatform,
} from "@/lib/purchasing/unified-search-core";
import { rememberPlatform } from "@/lib/purchasing/vendor-platform-store";
import {
  saveSnapshot,
  getSnapshot,
  getSnapshotItems,
  getSnapshotItem,
  saveItemDetail,
} from "@/lib/purchasing/cultivera-store";
import {
  marketName,
  marketSlug,
  marketId,
  isFetchableMarket,
} from "@/lib/purchasing/cultivera-menus-ui-core";
import { normalizeProductDetail, detailFromItemRaw } from "@/lib/purchasing/cultivera-menu-core";
import {
  planMediaSaves,
  remainingMediaCount,
  bulkSaveSummary,
} from "@/lib/purchasing/cultivera-media-core";
import {
  saveItemMedia,
  saveCultiveraItemToKb,
  saveCultiveraDetailStrainsToKb,
} from "@/lib/purchasing/cultivera-media";

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

  // GF-5 smart memory: remember this vendor's menu came from Cultivera so
  // the unified search hits Cultivera FIRST for this vendor next time.
  const memory = buildMemoryUpsert({
    vendorName: sellerName,
    platform: "cultivera",
    nowIso: new Date().toISOString(),
    platformRef: marketIdIn || null,
    platformSlug: slugIn || null,
  });
  if (memory) await rememberPlatform(memory);

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
 * CH-2 — fetch ONE product line's per-variant DETAIL and persist it
 * onto the saved item row (inside raw jsonb — no schema change).
 * ------------------------------------------------------------------ */

export type FetchProductDetailResult = {
  ok: boolean;
  configured: boolean;
  variantCount: number;
  error: string;
};

/**
 * Fetch the per-size variants of one saved menu item (its Cultivera product
 * line) via the worker's pinned GET /listings/{productId}/market/{marketId},
 * and stash the RAW payload on the item row. W11: the ids come from OUR OWN
 * saved snapshot/item rows — never trusted from the URL.
 */
export async function fetchCultiveraProductDetailAction(
  formData: FormData,
): Promise<FetchProductDetailResult> {
  const session = await requirePermission("inventory.manage");

  const snapshotId = str(formData, "snapshot_id");
  const itemId = str(formData, "item_id");
  if (!snapshotId || !itemId) {
    return { ok: false, configured: true, variantCount: 0, error: "Missing snapshot or item id." };
  }

  const snap = await getSnapshot(snapshotId);
  if (!snap) return { ok: false, configured: true, variantCount: 0, error: "Snapshot not found." };
  const item = await getSnapshotItem(snapshotId, itemId);
  if (!item) {
    return { ok: false, configured: true, variantCount: 0, error: "Menu item not found in this snapshot." };
  }

  const marketId = (snap.cultivera_market_id ?? "").trim();
  const productId = (item.cultivera_item_id ?? "").trim();
  if (!marketId || !productId) {
    return {
      ok: false,
      configured: true,
      variantCount: 0,
      error:
        "This snapshot is missing its Cultivera market id or the item's product id — re-fetch the vendor's menu first.",
    };
  }

  const result = await fetchCultiveraProductDetail({ marketId, productId });
  if (!result.configured) {
    return { ok: false, configured: false, variantCount: 0, error: result.error };
  }
  if (!result.ok) {
    return {
      ok: false,
      configured: true,
      variantCount: 0,
      error: result.error || `Cultivera answered ${result.status}.`,
    };
  }

  const detail = normalizeProductDetail(result.raw);
  const saved = await saveItemDetail(itemId, item.raw ?? {}, result.raw, new Date().toISOString());
  if (!saved) {
    return {
      ok: false,
      configured: true,
      variantCount: detail.variantCount,
      error: "Fetched the sizes but saving them failed — check Supabase configuration and try again.",
    };
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "cultivera.product_detail.fetched",
    entityType: "cultivera_menu_item",
    entityId: itemId,
    after: {
      snapshot_id: snapshotId,
      market_id: marketId,
      product_id: productId,
      variant_count: detail.variantCount,
    },
  });

  revalidatePath(`${BASE}/${snapshotId}`);
  revalidatePath(`${BASE}/${snapshotId}/item/${itemId}`);

  return { ok: true, configured: true, variantCount: detail.variantCount, error: "" };
}

/* ------------------------------------------------------------------
 * CV-5 — save menu media (product images + COA PDFs) to the library.
 * ------------------------------------------------------------------ */

/** One bulk run downloads at most this many files (keeps the action snappy). */
const BULK_MEDIA_LIMIT = 20;

export type SaveMediaResult = {
  ok: boolean;
  message: string;
  /**
   * For bulk/background runs: how many images/COAs remain UNSAVED after this
   * batch. The client auto-loop calls the action again while this is > 0.
   * Undefined for single-item actions.
   */
  remaining?: number;
  /** True when there is nothing left to save (remaining === 0). */
  done?: boolean;
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
    return {
      ok: true,
      message: "Everything on this menu is already saved to the library.",
      remaining: 0,
      done: true,
    };
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
    // A batch that only hit failures (no progress AND nothing left it can do)
    // reports not-ok so the auto-loop stops instead of spinning forever.
    ok: failed === 0,
    message: bulkSaveSummary({ images, coas, deduped, failed, remaining }),
    remaining,
    done: remaining === 0,
  };
}

/* ------------------------------------------------------------------
 * CV-7 — save a product's image to the KB backbone (detail page).
 * ------------------------------------------------------------------ */

/**
 * Save ONE product's card image into the media library AND bind it to the
 * durable KB product backbone (kb_products) at the strain/product level. This
 * is the detail-page "Save image to KB" action: one image per strain, tagged
 * "cultivera" + vendor, attached to the vendor and the KB product's natural
 * identity so every size variant inherits it.
 */
export async function saveCultiveraItemToKbAction(formData: FormData): Promise<SaveMediaResult> {
  const session = await requirePermission("inventory.manage");

  const snapshotId = str(formData, "snapshot_id");
  const itemId = str(formData, "item_id");
  if (!snapshotId || !itemId) {
    return { ok: false, message: "Missing snapshot or item id." };
  }

  const snap = await getSnapshot(snapshotId);
  if (!snap) return { ok: false, message: "Snapshot not found." };
  const item = await getSnapshotItem(snapshotId, itemId);
  if (!item) return { ok: false, message: "Menu item not found in this snapshot." };

  const vendorLabel = (snap.seller_name ?? "").trim() || (snap.cultivera_market_slug ?? "").trim() || "";
  const res = await saveCultiveraItemToKb(item, vendorLabel, session.userId);

  if (!res.ok) return { ok: false, message: res.error ?? "Save failed." };

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "cultivera.kb.image_saved",
    entityType: "cultivera_menu_item",
    entityId: itemId,
    after: {
      assetId: res.assetId,
      deduped: res.deduped,
      boundToKb: res.boundToKb,
      // SLICE 90 — the description save is no longer silent: audit it too.
      descriptionOutcome: res.descriptionOutcome,
      snapshotId,
    },
  });

  revalidatePath(`${BASE}/${snapshotId}`);
  revalidatePath(`${BASE}/${snapshotId}/item/${itemId}`);

  const savedPart = res.deduped
    ? "Image already in the library"
    : "Image saved to the media library (draft, license pending review)";
  const kbPart = res.boundToKb
    ? " and attached to the product in the Knowledge Base."
    : " — but the Knowledge Base link could not be written (it stays available on the media library).";
  // SLICE 90 — report what happened to the vendor's description too.
  const descPart = res.boundToKb ? descriptionOutcomeSentence(res.descriptionOutcome, false) : "";
  return { ok: true, message: `${savedPart}${kbPart}${descPart}` };
}

/* ------------------------------------------------------------------
 * CV-7b — save ONE image per DISTINCT strain on the detail page.
 * ------------------------------------------------------------------ */

/**
 * Detail-page "Save all strain images to KB": a single Cultivera product LINE
 * (e.g. SUBX "Flower") holds MANY strains as size variants. This collapses the
 * sizes of each distinct strain to ONE image (its own photo when any size has
 * one, else the product-card image as a flagged fallback), saves each to the
 * media library, and binds it to the durable KB backbone at the strain level.
 *
 * One click saves every strain on the page. Idempotent + best-effort per
 * strain, so re-running only fills gaps and one bad image never aborts the run.
 */
export async function saveCultiveraDetailStrainsToKbAction(
  formData: FormData,
): Promise<SaveMediaResult> {
  const session = await requirePermission("inventory.manage");

  const snapshotId = str(formData, "snapshot_id");
  const itemId = str(formData, "item_id");
  if (!snapshotId || !itemId) {
    return { ok: false, message: "Missing snapshot or item id." };
  }

  const snap = await getSnapshot(snapshotId);
  if (!snap) return { ok: false, message: "Snapshot not found." };
  const item = await getSnapshotItem(snapshotId, itemId);
  if (!item) return { ok: false, message: "Menu item not found in this snapshot." };

  const detail = detailFromItemRaw(item.raw);
  const variants = detail?.variants ?? [];
  if (variants.length === 0) {
    return { ok: false, message: "This product has no strain variants to save." };
  }

  const vendorLabel = (snap.seller_name ?? "").trim() || (snap.cultivera_market_slug ?? "").trim() || "";
  const res = await saveCultiveraDetailStrainsToKb(
    variants,
    {
      brand: item.brand ?? null,
      lineImageUrl: item.image_url ?? null,
      category: item.category ?? null,
      // SLICE 85 — the product-line description stands in (flagged) for
      // strains whose sizes carry no lineage/description of their own.
      lineDescription: detail?.description ?? item.description ?? null,
    },
    vendorLabel,
    session.userId,
  );

  if (res.strains === 0) {
    return { ok: false, message: res.error ?? "This product's sizes have no strain images to save." };
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "cultivera.kb.strains_saved",
    entityType: "cultivera_menu_item",
    entityId: itemId,
    after: {
      snapshotId,
      strains: res.strains,
      saved: res.saved,
      deduped: res.deduped,
      boundToKb: res.boundToKb,
      fallbacks: res.fallbacks,
      descriptionFallbacks: res.descriptionFallbacks,
      // SLICE 90 — the description saves are no longer silent: audit them too.
      descriptionsSaved: res.descriptionsSaved,
      descriptionsKept: res.descriptionsKept,
      // PR-D1 — the KB write-back failures are no longer silent.
      kbWriteFailed: res.kbWriteFailed,
      kbWriteFailReason: res.kbWriteFailReason,
      failed: res.failed,
    },
  });

  revalidatePath(`${BASE}/${snapshotId}`);
  revalidatePath(`${BASE}/${snapshotId}/item/${itemId}`);

  // Human-friendly summary — plain, jargon-free.
  const parts: string[] = [];
  if (res.saved > 0) parts.push(`${res.saved} new image${res.saved === 1 ? "" : "s"} saved to the media library`);
  if (res.deduped > 0) parts.push(`${res.deduped} already in the library`);
  const kbPart = res.boundToKb > 0 ? `, and ${res.boundToKb} attached to the Knowledge Base` : "";
  const fbPart = res.fallbacks > 0
    ? ` ${res.fallbacks} strain${res.fallbacks === 1 ? "" : "s"} used the product-card image (no own photo yet).`
    : "";
  // SLICE 90 — descriptions are saved alongside the images; say so out loud.
  const descPart = strainDescriptionsSentence({
    saved: res.descriptionsSaved,
    kept: res.descriptionsKept,
    fallbacks: res.descriptionFallbacks,
    kbFailed: res.kbWriteFailed,
  });
  const failPart = res.failed > 0
    ? ` ${res.failed} could not be saved — you can try again to fill the gaps.`
    : "";
  const lead = parts.length ? parts.join(", ") : `${res.strains} strain${res.strains === 1 ? "" : "s"} processed`;
  return {
    ok: res.ok,
    message: `${lead}${kbPart}. Covered ${res.strains} distinct strain${res.strains === 1 ? "" : "s"}.${descPart}${fbPart}${failPart}`,
  };
}

/* ------------------------------------------------------------------
 * GF-5 — unified smart search + GrowFlow menu fetch
 * ------------------------------------------------------------------ */

/** What the unified search island receives — platform-tagged, safe strings. */
export type UnifiedSearchActionResult = {
  ok: boolean;
  configured: boolean;
  hits: UnifiedVendorHit[];
  searchedFirst: VendorPlatform;
  searchedSecond: boolean;
  notes: string[];
  error: string;
};

/**
 * ONE search box, both marketplaces. Sequential: the vendor's remembered /
 * preferred platform is searched FIRST; the other only when the first found
 * nothing. Every hit carries its platform for the badge + fetch routing.
 */
export async function unifiedVendorSearchAction(
  formData: FormData,
): Promise<UnifiedSearchActionResult> {
  await requirePermission("inventory.manage");

  const query = str(formData, "query");
  const res = await unifiedVendorSearch(query);
  return {
    ok: res.ok,
    configured: res.configured,
    hits: res.hits,
    searchedFirst: res.searchedFirst,
    searchedSecond: res.searchedSecond,
    notes: res.notes,
    error: res.error,
  };
}

/**
 * Fetch ONE GrowFlow storefront's LIVE menu via the worker, persist the RAW
 * getStoreListing payload with growflow-store.saveGrowflowSnapshot() (GF-1
 * normalizers; dollar floats → integer cents), remember the platform in the
 * smart memory, audit it, and revalidate the menus page.
 */
export async function fetchGrowflowMenuAction(
  formData: FormData,
): Promise<FetchMenuResult> {
  const session = await requirePermission("inventory.manage");

  const storeFrontId = str(formData, "store_front_id");
  const storeName = str(formData, "store_name");
  const licenseNumber = str(formData, "license_number");

  if (!storeFrontId) {
    return {
      ok: false,
      configured: true,
      snapshotId: null,
      itemCount: 0,
      error: "Pick a vendor first — a GrowFlow menu fetch needs the storefront id.",
    };
  }

  const result = await fetchGrowflowMenu({ storeFrontId });

  if (!result.configured) {
    return { ok: false, configured: false, snapshotId: null, itemCount: 0, error: result.error };
  }
  if (!result.ok) {
    return {
      ok: false,
      configured: true,
      snapshotId: null,
      itemCount: 0,
      error: result.error || `GrowFlow answered ${result.status}.`,
    };
  }

  const saved = await saveGrowflowSnapshot({
    payload: result.raw,
    storeId: storeFrontId,
    storeName: storeName || null,
    licenseNumber: licenseNumber || null,
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

  // GF-5 smart memory: remember this vendor's menu came from GrowFlow so the
  // unified search hits GrowFlow FIRST for this vendor next time.
  const memory = buildMemoryUpsert({
    vendorName: storeName,
    platform: "growflow",
    nowIso: new Date().toISOString(),
    licenseNumber: licenseNumber || null,
    platformRef: storeFrontId,
  });
  if (memory) await rememberPlatform(memory);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "growflow.menu.fetched",
    entityType: "growflow_menu_snapshot",
    entityId: saved.snapshotId,
    after: {
      store_name: storeName || null,
      store_front_id: storeFrontId,
      license_number: licenseNumber || null,
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
 * GF-6 — save GrowFlow menu media (product images + COA PDFs) to the library.
 * Mirrors the CV-5 actions above; same permission, same chunked bulk runs.
 * ------------------------------------------------------------------ */

/** Vendor label for a GrowFlow snapshot: store name, falling back to license. */
function growflowVendorLabelOf(snap: { store_name: string | null; license_number: string | null }): string {
  return (snap.store_name ?? "").trim() || (snap.license_number ?? "").trim() || "";
}

/**
 * Save ONE GrowFlow item's image or COA into the media library (drafts,
 * tagged "growflow" + vendor, provenance kept), link it back to the item.
 */
export async function saveGrowflowItemMediaAction(formData: FormData): Promise<SaveMediaResult> {
  const session = await requirePermission("inventory.manage");

  const snapshotId = str(formData, "snapshot_id");
  const itemId = str(formData, "item_id");
  const kind = str(formData, "kind");
  if (!snapshotId || !itemId || (kind !== "image" && kind !== "coa")) {
    return { ok: false, message: "Missing snapshot, item, or media kind." };
  }

  const snap = await getGrowflowSnapshot(snapshotId);
  if (!snap) return { ok: false, message: "Snapshot not found." };
  const items = await getGrowflowSnapshotItems(snapshotId);
  const item = items.find((it) => it.id === itemId);
  if (!item) return { ok: false, message: "Menu item not found in this snapshot." };

  const res = await saveGrowflowItemMedia(item, kind, growflowVendorLabelOf(snap), session.userId);

  if (!res.ok) return { ok: false, message: res.error ?? "Save failed." };

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "growflow.media.saved",
    entityType: "growflow_menu_item",
    entityId: itemId,
    after: {
      kind,
      assetId: res.assetId,
      deduped: res.deduped,
      // SLICE 90 — the description save is no longer silent: audit it too.
      descriptionOutcome: res.descriptionOutcome,
      snapshotId,
    },
  });

  revalidatePath(`${BASE}/growflow/${snapshotId}`);
  return {
    ok: true,
    message: res.deduped
      ? `Already in the library — reused the existing ${kind === "coa" ? "COA" : "image"}.`
      : `${kind === "coa" ? "COA" : "Image"} saved to the media library (draft, license pending review).${
          // SLICE 90 — image saves also bind the vendor's description to the
          // Knowledge Base; report what happened to it (COA saves say nothing).
          descriptionOutcomeSentence(res.descriptionOutcome, false)
        }`,
  };
}

/**
 * Bulk-save every unsaved image + COA in a GrowFlow snapshot (chunked: up to
 * BULK_MEDIA_LIMIT downloads per run; the summary says when to run again).
 */
export async function saveAllGrowflowSnapshotMediaAction(formData: FormData): Promise<SaveMediaResult> {
  const session = await requirePermission("inventory.manage");

  const snapshotId = str(formData, "snapshot_id");
  if (!snapshotId) return { ok: false, message: "Missing snapshot id." };

  const snap = await getGrowflowSnapshot(snapshotId);
  if (!snap) return { ok: false, message: "Snapshot not found." };
  const items = await getGrowflowSnapshotItems(snapshotId);
  const vendorLabel = growflowVendorLabelOf(snap);

  const plan = planMediaSaves(items, BULK_MEDIA_LIMIT);
  if (plan.length === 0) {
    return {
      ok: true,
      message: "Everything on this menu is already saved to the library.",
      remaining: 0,
      done: true,
    };
  }

  const byId = new Map(items.map((it) => [it.id, it]));
  let images = 0;
  let coas = 0;
  let deduped = 0;
  let failed = 0;

  for (const task of plan) {
    const item = byId.get(task.itemId);
    if (!item) continue;
    const res = await saveGrowflowItemMedia(item, task.kind, vendorLabel, session.userId);
    if (!res.ok) {
      failed += 1;
      continue;
    }
    if (res.deduped) deduped += 1;
    else if (task.kind === "image") images += 1;
    else coas += 1;
  }

  // Remaining work AFTER this run: what the plan couldn't fit, plus failures.
  const fresh = await getGrowflowSnapshotItems(snapshotId);
  const remaining = remainingMediaCount(fresh);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "growflow.media.bulk_saved",
    entityType: "growflow_menu_snapshot",
    entityId: snapshotId,
    after: { images, coas, deduped, failed, remaining },
  });

  revalidatePath(`${BASE}/growflow/${snapshotId}`);
  return {
    ok: failed === 0,
    message: bulkSaveSummary({ images, coas, deduped, failed, remaining }),
    remaining,
    done: remaining === 0,
  };
}

/* ------------------------------------------------------------------
 * SLICE 84 — LeafLink: fetch a brand menu + save its media.
 * Mirrors the GrowFlow actions above; same permission, same chunked
 * bulk runs, same smart-memory + audit + revalidate pattern.
 * ------------------------------------------------------------------ */

/**
 * Fetch ONE LeafLink brand's LIVE menu via the worker, persist the RAW
 * {brand, products} payload with leaflink-store.saveLeaflinkSnapshot()
 * (LL-1 normalizers; money strings/objects → integer cents), remember the
 * platform in the smart memory, audit it, and revalidate the menus page.
 */
export async function fetchLeaflinkMenuAction(
  formData: FormData,
): Promise<FetchMenuResult> {
  const session = await requirePermission("inventory.manage");

  const brandId = str(formData, "brand_id");
  const brandName = str(formData, "brand_name");
  const companyName = str(formData, "company_name");

  if (!brandId) {
    return {
      ok: false,
      configured: true,
      snapshotId: null,
      itemCount: 0,
      error: "Pick a vendor first — a LeafLink menu fetch needs the brand id.",
    };
  }

  const result = await fetchLeaflinkMenu({ brandId });

  if (!result.configured) {
    return { ok: false, configured: false, snapshotId: null, itemCount: 0, error: result.error };
  }
  if (!result.ok) {
    return {
      ok: false,
      configured: true,
      snapshotId: null,
      itemCount: 0,
      error: result.error || `LeafLink answered ${result.status}.`,
    };
  }

  const saved = await saveLeaflinkSnapshot({
    payload: result.raw,
    brandId,
    brandName: brandName || null,
    companyName: companyName || null,
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

  // Smart memory: remember this vendor's menu came from LeafLink so the
  // unified search hits LeafLink FIRST for this vendor next time.
  const memory = buildMemoryUpsert({
    vendorName: brandName,
    platform: "leaflink",
    nowIso: new Date().toISOString(),
    licenseNumber: null,
    platformRef: brandId,
  });
  if (memory) await rememberPlatform(memory);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "leaflink.menu.fetched",
    entityType: "leaflink_menu_snapshot",
    entityId: saved.snapshotId,
    after: {
      brand_name: brandName || null,
      brand_id: brandId,
      company_name: companyName || null,
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

/** Vendor label for a LeafLink snapshot: brand name, falling back to company. */
function leaflinkVendorLabelOf(snap: { brand_name: string | null; company_name: string | null }): string {
  return (snap.brand_name ?? "").trim() || (snap.company_name ?? "").trim() || "";
}

/**
 * Save ONE LeafLink item's image or COA into the media library (drafts,
 * tagged "leaflink" + vendor, provenance kept), link it back to the item.
 */
export async function saveLeaflinkItemMediaAction(formData: FormData): Promise<SaveMediaResult> {
  const session = await requirePermission("inventory.manage");

  const snapshotId = str(formData, "snapshot_id");
  const itemId = str(formData, "item_id");
  const kind = str(formData, "kind");
  if (!snapshotId || !itemId || (kind !== "image" && kind !== "coa")) {
    return { ok: false, message: "Missing snapshot, item, or media kind." };
  }

  const snap = await getLeaflinkSnapshot(snapshotId);
  if (!snap) return { ok: false, message: "Snapshot not found." };
  const items = await getLeaflinkSnapshotItems(snapshotId);
  const item = items.find((it) => it.id === itemId);
  if (!item) return { ok: false, message: "Menu item not found in this snapshot." };

  const res = await saveLeaflinkItemMedia(item, kind, leaflinkVendorLabelOf(snap), session.userId);

  if (!res.ok) return { ok: false, message: res.error ?? "Save failed." };

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "leaflink.media.saved",
    entityType: "leaflink_menu_item",
    entityId: itemId,
    after: {
      kind,
      assetId: res.assetId,
      deduped: res.deduped,
      // SLICE 85 — flags saves whose KB description was the category stand-in.
      descriptionWasFallback: res.descriptionWasFallback,
      // SLICE 90 — the description save is no longer silent: audit it too.
      descriptionOutcome: res.descriptionOutcome,
      snapshotId,
    },
  });

  revalidatePath(`${BASE}/leaflink/${snapshotId}`);
  return {
    ok: true,
    message: res.deduped
      ? `Already in the library — reused the existing ${kind === "coa" ? "COA" : "image"}.`
      : `${kind === "coa" ? "COA" : "Image"} saved to the media library (draft, license pending review).${
          // SLICE 90 — image saves also bind the vendor's description to the
          // Knowledge Base; report what happened to it (COA saves say nothing).
          descriptionOutcomeSentence(res.descriptionOutcome, res.descriptionWasFallback)
        }`,
  };
}

/**
 * Bulk-save every unsaved image + COA in a LeafLink snapshot (chunked: up to
 * BULK_MEDIA_LIMIT downloads per run; the summary says when to run again).
 */
export async function saveAllLeaflinkSnapshotMediaAction(formData: FormData): Promise<SaveMediaResult> {
  const session = await requirePermission("inventory.manage");

  const snapshotId = str(formData, "snapshot_id");
  if (!snapshotId) return { ok: false, message: "Missing snapshot id." };

  const snap = await getLeaflinkSnapshot(snapshotId);
  if (!snap) return { ok: false, message: "Snapshot not found." };
  const items = await getLeaflinkSnapshotItems(snapshotId);
  const vendorLabel = leaflinkVendorLabelOf(snap);

  const plan = planMediaSaves(items, BULK_MEDIA_LIMIT);
  if (plan.length === 0) {
    return {
      ok: true,
      message: "Everything on this menu is already saved to the library.",
      remaining: 0,
      done: true,
    };
  }

  const byId = new Map(items.map((it) => [it.id, it]));
  let images = 0;
  let coas = 0;
  let deduped = 0;
  let failed = 0;

  for (const task of plan) {
    const item = byId.get(task.itemId);
    if (!item) continue;
    const res = await saveLeaflinkItemMedia(item, task.kind, vendorLabel, session.userId);
    if (!res.ok) {
      failed += 1;
      continue;
    }
    if (res.deduped) deduped += 1;
    else if (task.kind === "image") images += 1;
    else coas += 1;
  }

  // Remaining work AFTER this run: what the plan couldn't fit, plus failures.
  const fresh = await getLeaflinkSnapshotItems(snapshotId);
  const remaining = remainingMediaCount(fresh);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "leaflink.media.bulk_saved",
    entityType: "leaflink_menu_snapshot",
    entityId: snapshotId,
    after: { images, coas, deduped, failed, remaining },
  });

  revalidatePath(`${BASE}/leaflink/${snapshotId}`);
  return {
    ok: failed === 0,
    message: bulkSaveSummary({ images, coas, deduped, failed, remaining }),
    remaining,
    done: remaining === 0,
  };
}
