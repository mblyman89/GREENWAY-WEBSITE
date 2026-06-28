"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  createCarouselSlide,
  saveCarouselDraft,
  publishCarouselSlide,
  deleteCarouselSlide,
  moveCarouselSlide,
  ensureCarouselSeeded,
  type SlideDraftInput,
} from "@/lib/cms/carousel-store";
import type {
  SlideCta,
  SlideImageFocus,
  SlideTextAlign,
} from "@/lib/cms/carousel-types";

const ROUTE = "/admin/content/carousel";

/** Refresh both the manager and the public homepage after a change. */
function revalidateAll(): void {
  revalidatePath(ROUTE);
  revalidatePath("/");
}

/** Parse up to two CTAs out of the submitted form fields. */
function parseCtas(formData: FormData): SlideCta[] {
  const ctas: SlideCta[] = [];
  for (let i = 0; i < 2; i++) {
    const label = String(formData.get(`cta${i}_label`) ?? "").trim();
    const href = String(formData.get(`cta${i}_href`) ?? "").trim();
    const variant =
      String(formData.get(`cta${i}_variant`) ?? "solid") === "outline"
        ? "outline"
        : "solid";
    if (label && href) ctas.push({ label, href, variant });
  }
  return ctas;
}

/** Lazily seed the existing 3 slides on first manager visit (idempotent). */
export async function seedCarouselAction(): Promise<void> {
  const session = await requirePermission("content.edit");
  const inserted = await ensureCarouselSeeded();
  if (inserted > 0) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "carousel.seed",
      entityType: "home_carousel_slide",
      after: { inserted },
    });
  }
  revalidatePath(ROUTE);
  redirect(`${ROUTE}?seeded=${inserted}`);
}

export async function addCarouselSlideAction(): Promise<void> {
  const session = await requirePermission("content.edit");
  const result = await createCarouselSlide(session.userId);
  if ("error" in result) {
    revalidatePath(ROUTE);
    redirect(`${ROUTE}?error=${encodeURIComponent(result.error)}`);
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "carousel.create",
    entityType: "home_carousel_slide",
    entityId: result.id,
  });
  revalidatePath(ROUTE);
  redirect(`${ROUTE}?added=1#slide-${result.id}`);
}

export async function saveCarouselSlideAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const id = String(formData.get("slide_id") ?? "");
  if (!id) redirect(ROUTE);

  const input: SlideDraftInput = {
    image: String(formData.get("image") ?? "").trim() || null,
    image_alt: String(formData.get("image_alt") ?? "").trim() || null,
    image_focus: (String(formData.get("image_focus") ?? "right") ||
      "right") as SlideImageFocus,
    text_align: (String(formData.get("text_align") ?? "left") ||
      "left") as SlideTextAlign,
    eyebrow: String(formData.get("eyebrow") ?? "").trim() || null,
    title: String(formData.get("title") ?? "").trim() || null,
    description: String(formData.get("description") ?? "").trim() || null,
    ctas: parseCtas(formData),
    draft_enabled: formData.get("draft_enabled") === "on",
  };

  await saveCarouselDraft(id, input, session.userId);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "carousel.draft",
    entityType: "home_carousel_slide",
    entityId: id,
  });
  revalidatePath(ROUTE);
  redirect(`${ROUTE}?saved=1#slide-${id}`);
}

export async function publishCarouselSlideAction(
  formData: FormData,
): Promise<void> {
  const session = await requirePermission("content.edit");
  const id = String(formData.get("slide_id") ?? "");
  if (!id) redirect(ROUTE);

  await publishCarouselSlide(id, session.userId);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "carousel.publish",
    entityType: "home_carousel_slide",
    entityId: id,
  });
  revalidateAll();
  redirect(`${ROUTE}?published=1#slide-${id}`);
}

export async function deleteCarouselSlideAction(
  formData: FormData,
): Promise<void> {
  const session = await requirePermission("content.edit");
  const id = String(formData.get("slide_id") ?? "");
  if (!id) redirect(ROUTE);

  await deleteCarouselSlide(id);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "carousel.delete",
    entityType: "home_carousel_slide",
    entityId: id,
  });
  revalidateAll();
  redirect(`${ROUTE}?deleted=1`);
}

export async function moveCarouselSlideAction(
  formData: FormData,
): Promise<void> {
  const session = await requirePermission("content.edit");
  const id = String(formData.get("slide_id") ?? "");
  const direction = String(formData.get("direction") ?? "") === "up" ? "up" : "down";
  if (!id) redirect(ROUTE);

  await moveCarouselSlide(id, direction);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "carousel.reorder",
    entityType: "home_carousel_slide",
    entityId: id,
    after: { direction },
  });
  revalidateAll();
  redirect(`${ROUTE}?moved=1#slide-${id}`);
}
