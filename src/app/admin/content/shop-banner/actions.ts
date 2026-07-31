"use server";

/**
 * Server actions for the Shop banner carousel editor
 * (Admin → Content → Shop Banner), SLICE A / SHOP-1.
 *
 * Store-backed (table shop_carousel_slides), mirroring the home carousel actions
 * but operating on the per-slide JSON ShopHeroPresentation. Each action requires
 * content.edit, records an audit entry, revalidates the manager + the public
 * /menu route, and redirects back with a status flag.
 *
 * SLICE 106 LESSON: this "use server" module only exports async functions; all
 * constants + parsing helpers live in the pure core (shop-carousel-core).
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  createShopCarouselSlide,
  saveShopCarouselDraft,
  publishShopCarouselSlide,
  deleteShopCarouselSlide,
  moveShopCarouselSlide,
  ensureShopCarouselSeeded,
} from "@/lib/cms/shop-carousel-store";
import { normalizeShopHeroPresentation } from "@/lib/cms/shop-carousel-core";

const ROUTE = "/admin/content/shop-banner";

/** Refresh both the manager and the public Shop page after a change. */
function revalidateAll(): void {
  revalidatePath(ROUTE);
  revalidatePath("/menu");
  // Safety net for shared chrome / force-dynamic pages.
  revalidatePath("/", "layout");
}

/** Lazily seed the starter slide on first manager visit (idempotent). */
export async function seedShopBannerAction(): Promise<void> {
  const session = await requirePermission("content.edit");
  const inserted = await ensureShopCarouselSeeded();
  if (inserted > 0) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "shop_carousel.seed",
      entityType: "shop_carousel_slide",
      after: { inserted },
    });
  }
  revalidatePath(ROUTE);
  redirect(`${ROUTE}?seeded=${inserted}`);
}

export async function addShopBannerSlideAction(): Promise<void> {
  const session = await requirePermission("content.edit");
  const result = await createShopCarouselSlide(session.userId);
  if ("error" in result) {
    revalidatePath(ROUTE);
    redirect(`${ROUTE}?error=${encodeURIComponent(result.error)}`);
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "shop_carousel.create",
    entityType: "shop_carousel_slide",
    entityId: result.id,
  });
  revalidatePath(ROUTE);
  redirect(`${ROUTE}?added=1#slide-${result.id}`);
}

export async function saveShopBannerSlideAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const id = String(formData.get("slide_id") ?? "");
  if (!id) redirect(ROUTE);

  const rawJson = String(formData.get("presentation") ?? "");
  let parsed: unknown = null;
  try {
    parsed = rawJson ? JSON.parse(rawJson) : null;
  } catch {
    parsed = null;
  }
  const presentation = normalizeShopHeroPresentation(parsed);
  const draftEnabled = String(formData.get("draft_enabled") ?? "1") === "1";

  await saveShopCarouselDraft(id, presentation, draftEnabled, session.userId);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "shop_carousel.draft",
    entityType: "shop_carousel_slide",
    entityId: id,
  });
  revalidatePath(ROUTE);
  redirect(`${ROUTE}?saved=1#slide-${id}`);
}

export async function publishShopBannerSlideAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const id = String(formData.get("slide_id") ?? "");
  if (!id) redirect(ROUTE);

  // Save the current draft first (so Publish captures the latest edits), then
  // promote draft → published in one step.
  const rawJson = String(formData.get("presentation") ?? "");
  if (rawJson) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      parsed = null;
    }
    const presentation = normalizeShopHeroPresentation(parsed);
    const draftEnabled = String(formData.get("draft_enabled") ?? "1") === "1";
    await saveShopCarouselDraft(id, presentation, draftEnabled, session.userId);
  }

  await publishShopCarouselSlide(id, session.userId);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "shop_carousel.publish",
    entityType: "shop_carousel_slide",
    entityId: id,
  });
  revalidateAll();
  redirect(`${ROUTE}?published=1#slide-${id}`);
}

export async function deleteShopBannerSlideAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const id = String(formData.get("slide_id") ?? "");
  if (!id) redirect(ROUTE);

  await deleteShopCarouselSlide(id);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "shop_carousel.delete",
    entityType: "shop_carousel_slide",
    entityId: id,
  });
  revalidateAll();
  redirect(`${ROUTE}?deleted=1`);
}

export async function moveShopBannerSlideAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const id = String(formData.get("slide_id") ?? "");
  const direction = String(formData.get("direction") ?? "") === "up" ? "up" : "down";
  if (!id) redirect(ROUTE);

  await moveShopCarouselSlide(id, direction);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "shop_carousel.reorder",
    entityType: "shop_carousel_slide",
    entityId: id,
    after: { direction },
  });
  revalidateAll();
  redirect(`${ROUTE}?moved=1#slide-${id}`);
}
