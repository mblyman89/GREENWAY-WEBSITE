"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  createSection,
  saveSectionDraft,
  publishSection,
  deleteSection,
  moveSection,
  ensureSectionsSeeded,
  type SectionDraftInput,
} from "@/lib/cms/page-sections-store";
import {
  isValidPageSlug,
  PAGE_SECTION_CONFIG,
  type SectionButton,
  type SectionButtonVariant,
  type SectionImageFocus,
  type SectionTextAlign,
} from "@/lib/cms/page-sections-types";

function routeFor(slug: string): string {
  return `/admin/pages/${slug}`;
}

/** Refresh the manager + the public page after a change. */
function revalidateForSlug(slug: string): void {
  revalidatePath(routeFor(slug));
  const path = PAGE_SECTION_CONFIG[slug]?.previewPath;
  if (path) revalidatePath(path);
  // Safety net so published values reliably appear on the live (non-preview) site.
  revalidatePath("/", "layout");
}

/** Parse the dynamic buttons list from the submitted JSON (up to 4). */
function parseButtons(formData: FormData): SectionButton[] {
  const raw = String(formData.get("buttons_json") ?? "[]");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: SectionButton[] = [];
  for (const b of parsed) {
    if (!b || typeof b !== "object") continue;
    const r = b as Record<string, unknown>;
    const label = typeof r.label === "string" ? r.label.trim() : "";
    const href = typeof r.href === "string" ? r.href.trim() : "";
    if (!label) continue;
    const variant: SectionButtonVariant =
      r.variant === "outline" ? "outline" : r.variant === "ghost" ? "ghost" : "solid";
    out.push({ label, href, variant, enabled: r.enabled === false ? false : true });
    if (out.length >= 4) break;
  }
  return out;
}

export async function seedSectionsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const slug = String(formData.get("page_slug") ?? "");
  if (!isValidPageSlug(slug)) redirect("/admin/content");
  const inserted = await ensureSectionsSeeded(slug);
  if (inserted > 0) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "page_section.seed",
      entityType: "page_section",
      entityId: slug,
      after: { inserted },
    });
  }
  revalidatePath(routeFor(slug));
  redirect(`${routeFor(slug)}?seeded=${inserted}`);
}

export async function addSectionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const slug = String(formData.get("page_slug") ?? "");
  if (!isValidPageSlug(slug)) redirect("/admin/content");

  const result = await createSection(slug, session.userId);
  if ("error" in result) {
    revalidatePath(routeFor(slug));
    redirect(`${routeFor(slug)}?error=${encodeURIComponent(result.error)}`);
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "page_section.create",
    entityType: "page_section",
    entityId: result.id,
    after: { page_slug: slug },
  });
  revalidatePath(routeFor(slug));
  redirect(`${routeFor(slug)}?added=1#section-${result.id}`);
}

export async function saveSectionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const slug = String(formData.get("page_slug") ?? "");
  const id = String(formData.get("section_id") ?? "");
  if (!isValidPageSlug(slug) || !id) redirect("/admin/content");

  const input: SectionDraftInput = {
    image: String(formData.get("image") ?? "").trim() || null,
    image_alt: String(formData.get("image_alt") ?? "").trim() || null,
    image_focus: (String(formData.get("image_focus") ?? "center") ||
      "center") as SectionImageFocus,
    text_align: (String(formData.get("text_align") ?? "left") ||
      "left") as SectionTextAlign,
    eyebrow: String(formData.get("eyebrow") ?? "").trim() || null,
    title: String(formData.get("title") ?? "").trim() || null,
    subtitle: String(formData.get("subtitle") ?? "").trim() || null,
    body: String(formData.get("body") ?? "").trim() || null,
    buttons: parseButtons(formData),
    draft_enabled: formData.get("draft_enabled") === "on",
  };

  const res = await saveSectionDraft(id, input, session.userId);
  if (res.error) {
    revalidatePath(routeFor(slug));
    redirect(`${routeFor(slug)}?error=${encodeURIComponent(res.error)}#section-${id}`);
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "page_section.draft",
    entityType: "page_section",
    entityId: id,
  });
  revalidatePath(routeFor(slug));
  redirect(`${routeFor(slug)}?saved=1#section-${id}`);
}

export async function publishSectionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const slug = String(formData.get("page_slug") ?? "");
  const id = String(formData.get("section_id") ?? "");
  if (!isValidPageSlug(slug) || !id) redirect("/admin/content");

  const res = await publishSection(id, session.userId);
  if (res.error) {
    revalidatePath(routeFor(slug));
    redirect(`${routeFor(slug)}?error=${encodeURIComponent(res.error)}#section-${id}`);
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "page_section.publish",
    entityType: "page_section",
    entityId: id,
  });
  revalidateForSlug(slug);
  redirect(`${routeFor(slug)}?published=1#section-${id}`);
}

export async function deleteSectionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const slug = String(formData.get("page_slug") ?? "");
  const id = String(formData.get("section_id") ?? "");
  if (!isValidPageSlug(slug) || !id) redirect("/admin/content");

  const res = await deleteSection(id);
  if (res.error) {
    revalidatePath(routeFor(slug));
    redirect(`${routeFor(slug)}?error=${encodeURIComponent(res.error)}`);
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "page_section.delete",
    entityType: "page_section",
    entityId: id,
  });
  revalidateForSlug(slug);
  redirect(`${routeFor(slug)}?deleted=1`);
}

export async function moveSectionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const slug = String(formData.get("page_slug") ?? "");
  const id = String(formData.get("section_id") ?? "");
  const direction = String(formData.get("direction") ?? "") === "up" ? "up" : "down";
  if (!isValidPageSlug(slug) || !id) redirect("/admin/content");

  await moveSection(id, direction);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "page_section.reorder",
    entityType: "page_section",
    entityId: id,
    after: { direction },
  });
  revalidateForSlug(slug);
  redirect(`${routeFor(slug)}?moved=1#section-${id}`);
}
