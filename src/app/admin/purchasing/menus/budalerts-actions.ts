"use server";

/**
 * D241 — server actions for Budalerts on the Vendor Menus page.
 *
 * Kept in its own file (not menus/actions.ts) so it never collides with the
 * other agent's work in that file. Every action:
 *   - is behind `inventory.manage`;
 *   - writes an audit row (`budalerts.*`);
 *   - returns a plain-English message and never throws at the browser.
 *
 * Budalerts material is INTERNAL USE ONLY (owner's permission, D241).
 */

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { isValidBrandSlug } from "@/lib/purchasing/budalerts-core";
import {
  getMenuItemsByIds,
  getSnapshot,
  linkBrand,
  listSnapshotItems,
  unlinkBrand,
  vendorIdsForSlug,
} from "@/lib/purchasing/budalerts-store";
import {
  fetchBudalertsBrand,
  fetchDueBudalertsBrands,
  refreshBudalertsKnownSlugs,
} from "@/lib/purchasing/budalerts-fetch";
import { linkBudalertsItemToAsset, saveBudalertsItemImage } from "@/lib/purchasing/budalerts-media";

const BASE = "/admin/purchasing/menus";
/** Photos saved per click of "Save all photos" (each is one download; keeps the action inside its time limit). */
const IMAGES_PER_CALL = 12;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(fd: FormData, key: string): string {
  return ((fd.get(key) as string | null) ?? "").trim();
}

function errText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export type BudalertsActionResult = { ok: boolean; message: string };

/* ------------------------------------------------------------------
 * Link / unlink a Budalerts brand to a vendor
 * ------------------------------------------------------------------ */

export async function linkBudalertsBrandAction(fd: FormData): Promise<BudalertsActionResult> {
  const session = await requirePermission("inventory.manage");
  const vendorId = str(fd, "vendor_id");
  const slug = str(fd, "slug").toLowerCase();
  const brandName = str(fd, "brand_name") || null;
  if (!UUID_RE.test(vendorId)) return { ok: false, message: "Pick a vendor first." };
  if (!isValidBrandSlug(slug)) return { ok: false, message: "That is not a Budalerts brand slug (lower-case letters, numbers and dashes, as in budalerts.com/brands/phat-panda)." };
  try {
    await linkBrand(vendorId, slug, brandName, session.userId);
  } catch (err) {
    return { ok: false, message: errText(err, "Linking failed.") };
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "budalerts.brand.linked",
    entityType: "vendor",
    entityId: vendorId,
    after: { slug, brand_name: brandName },
  });
  revalidatePath(BASE);
  return { ok: true, message: `Linked Budalerts brand "${slug}". Click Fetch to gather its listings.` };
}

export async function unlinkBudalertsBrandAction(fd: FormData): Promise<BudalertsActionResult> {
  const session = await requirePermission("inventory.manage");
  const vendorId = str(fd, "vendor_id");
  const slug = str(fd, "slug").toLowerCase();
  if (!UUID_RE.test(vendorId) || !isValidBrandSlug(slug)) return { ok: false, message: "Nothing to unlink." };
  try {
    await unlinkBrand(vendorId, slug);
  } catch (err) {
    return { ok: false, message: errText(err, "Unlinking failed.") };
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "budalerts.brand.unlinked",
    entityType: "vendor",
    entityId: vendorId,
    after: { slug },
  });
  revalidatePath(BASE);
  return { ok: true, message: `Unlinked "${slug}". Its saved pulls stay on file.` };
}

/* ------------------------------------------------------------------
 * Fetch — one brand, the next due batch, the brand list
 * ------------------------------------------------------------------ */

export type FetchBudalertsActionResult = BudalertsActionResult & { snapshotId: string | null };

export async function fetchBudalertsBrandAction(fd: FormData): Promise<FetchBudalertsActionResult> {
  const session = await requirePermission("inventory.manage");
  const slug = str(fd, "slug").toLowerCase();
  if (!isValidBrandSlug(slug)) return { ok: false, message: "Not a valid Budalerts brand slug.", snapshotId: null };
  try {
    const r = await fetchBudalertsBrand(slug, session.userId);
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "budalerts.brand.fetched",
      entityType: "budalerts_brand_snapshot",
      entityId: r.snapshotId ?? slug,
      after: { slug, status: r.status, items: r.itemCount, images: r.imageCount, pages: r.pagesFetched, stopped: r.stopped },
    });
    revalidatePath(BASE);
    return { ok: r.status === "fetched" || r.status === "partial", message: r.message, snapshotId: r.snapshotId };
  } catch (err) {
    return { ok: false, message: errText(err, "The fetch failed."), snapshotId: null };
  }
}

export type FetchDueActionResult = BudalertsActionResult & { remaining: number; stopped: boolean; fetched: number };

export async function fetchDueBudalertsAction(): Promise<FetchDueActionResult> {
  const session = await requirePermission("inventory.manage");
  try {
    const r = await fetchDueBudalertsBrands(session.userId, 3);
    if (r.results.length > 0) {
      await recordAudit({
        actorId: session.userId,
        actorEmail: session.email,
        action: "budalerts.batch.fetched",
        entityType: "budalerts_fetch_state",
        entityId: "1",
        after: {
          brands: r.results.map((x) => ({ slug: x.slug, status: x.status, items: x.itemCount })),
          remaining: r.remaining,
          stopped: r.stopped,
        },
      });
      revalidatePath(BASE);
    }
    return { ok: !r.stopped, message: r.message, remaining: r.remaining, stopped: r.stopped, fetched: r.results.length };
  } catch (err) {
    return { ok: false, message: errText(err, "The batch fetch failed."), remaining: 0, stopped: true, fetched: 0 };
  }
}

export async function refreshBudalertsSlugsAction(): Promise<BudalertsActionResult> {
  const session = await requirePermission("inventory.manage");
  try {
    const r = await refreshBudalertsKnownSlugs();
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "budalerts.brand_list.refreshed",
      entityType: "budalerts_fetch_state",
      entityId: "1",
      after: { count: r.count },
    });
    revalidatePath(BASE);
    return { ok: true, message: `${r.message} Link suggestions are updated.` };
  } catch (err) {
    return { ok: false, message: errText(err, "Could not refresh the Budalerts brand list.") };
  }
}

/* ------------------------------------------------------------------
 * Photos — one listing, or a whole pull in batches
 * ------------------------------------------------------------------ */

async function vendorHint(slug: string): Promise<string | null> {
  const ids = await vendorIdsForSlug(slug).catch(() => [] as string[]);
  return ids.length === 1 ? ids[0] : null;
}

export async function saveBudalertsImageAction(fd: FormData): Promise<BudalertsActionResult> {
  const session = await requirePermission("inventory.manage");
  const itemId = str(fd, "item_id");
  if (!UUID_RE.test(itemId)) return { ok: false, message: "Pick a listing first." };
  try {
    const [item] = await getMenuItemsByIds([itemId]);
    if (!item) return { ok: false, message: "That listing is gone (the pull may have been replaced)." };
    const snap = await getSnapshot(item.snapshot_id);
    const res = await saveBudalertsItemImage(item, session.userId, snap ? await vendorHint(snap.slug) : null);
    if (res.ok) {
      await recordAudit({
        actorId: session.userId,
        actorEmail: session.email,
        action: "budalerts.media.saved",
        entityType: "budalerts_menu_item",
        entityId: itemId,
        after: { assetId: res.assetId, deduped: res.deduped, snapshotId: item.snapshot_id },
      });
      revalidatePath(`${BASE}/budalerts/${item.snapshot_id}`);
    }
    return {
      ok: res.ok,
      message: res.ok
        ? res.deduped
          ? "Already in the Media Library — linked to this listing (draft, internal use only)."
          : "Saved to the Media Library as a draft (internal use only)."
        : res.error ?? "Saving failed.",
    };
  } catch (err) {
    return { ok: false, message: errText(err, "Saving failed.") };
  }
}

export type SaveAllImagesResult = BudalertsActionResult & { saved: number; failed: number; remaining: number; failedIds: string[] };

/**
 * Save the next batch of photos for one pull. One photo per distinct URL is
 * downloaded (the library dedupes by content), listings sharing that photo are
 * linked too. The browser loops while `remaining > 0`.
 */
export async function saveAllBudalertsImagesAction(fd: FormData): Promise<SaveAllImagesResult> {
  const session = await requirePermission("inventory.manage");
  const snapshotId = str(fd, "snapshot_id");
  const skip = new Set(str(fd, "skip_ids").split(",").map((s) => s.trim()).filter(Boolean));
  if (!UUID_RE.test(snapshotId)) return { ok: false, message: "Pick a pull first.", saved: 0, failed: 0, remaining: 0, failedIds: [] };
  try {
    const snap = await getSnapshot(snapshotId);
    if (!snap) return { ok: false, message: "That pull is gone.", saved: 0, failed: 0, remaining: 0, failedIds: [] };
    const items = await listSnapshotItems(snapshotId);
    const hint = await vendorHint(snap.slug);
    const todo = items.filter((i) => i.image_url && !i.media_asset_id && !skip.has(i.id));
    let saved = 0;
    let failed = 0;
    const failedIds: string[] = [];
    const byUrl = new Map<string, string>();
    const badUrls = new Set<string>();
    let downloads = 0;
    for (const item of todo) {
      const url = item.image_url as string;
      if (badUrls.has(url)) {
        failed += 1;
        failedIds.push(item.id);
        continue;
      }
      const known = byUrl.get(url);
      if (!known && downloads >= IMAGES_PER_CALL) continue;
      if (!known) downloads += 1;
      const res = known ? await linkBudalertsItemToAsset(item, known) : await saveBudalertsItemImage(item, session.userId, hint);
      if (res.ok && res.assetId) {
        byUrl.set(url, res.assetId);
        saved += 1;
      } else {
        failed += 1;
        failedIds.push(item.id);
        if (!known) badUrls.add(url);
      }
    }
    const done = new Set([...skip, ...failedIds]);
    const after = await listSnapshotItems(snapshotId);
    const remaining = after.filter((i) => i.image_url && !i.media_asset_id && !done.has(i.id)).length;
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "budalerts.media.bulk_saved",
      entityType: "budalerts_brand_snapshot",
      entityId: snapshotId,
      after: { saved, failed, remaining },
    });
    revalidatePath(`${BASE}/budalerts/${snapshotId}`);
    const parts = [`Saved ${saved} photo link${saved === 1 ? "" : "s"} as drafts (internal use only).`];
    if (failed) parts.push(`${failed} could not be saved and will be skipped this run.`);
    if (remaining) parts.push(`${remaining} still to go.`);
    return { ok: failed === 0 || saved > 0, message: parts.join(" "), saved, failed, remaining, failedIds };
  } catch (err) {
    return { ok: false, message: errText(err, "Saving the photos failed."), saved: 0, failed: 0, remaining: 0, failedIds: [] };
  }
}
