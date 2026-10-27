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
  saveHomeSettings,
  saveHomeSectionSettings,
  getHomeSectionByKey,
  type SectionDraftInput,
} from "@/lib/cms/page-sections-store";
import {
  clampHomeCardCount,
  DAILY_DEALS_COUNT_KEY,
  LANE_IMAGES_KEY,
  HOME_TYPE_LANE_KEYS,
  readLaneImages,
  writeLaneImage,
} from "@/lib/cms/home-section-settings-core";
import {
  isValidPageSlug,
  PAGE_SECTION_CONFIG,
  type SectionButton,
  type SectionButtonVariant,
  type SectionImageFocus,
  type SectionTextAlign,
} from "@/lib/cms/page-sections-types";
import { normalizeDesign, writeDesign } from "@/lib/cms/banner-design-core";
import { laneImagesFromCards, normalizeTypeCards, TYPE_CARDS_KEY } from "@/lib/cms/type-cards-core";

function routeFor(slug: string): string {
  return `/admin/pages/${slug}`;
}

/**
 * R61 S2: the Home editor has tabs (Main / Types / Brands / Types cards /
 * More). Section forms send return_tab so the owner lands back on the same
 * tab. Only known tab ids pass; anything else is dropped.
 */
const RETURN_TABS = new Set(["types", "brands", "more", "sections"]);
const VENDOR_RETURN_TABS = new Set(["grow", "brands", "more"]);
function backFor(slug: string, formData: FormData): string {
  const t = String(formData.get("return_tab") ?? "");
  if (slug === "home" && RETURN_TABS.has(t)) return `${routeFor(slug)}?tab=${t}&`;
  // R64: the Vendors editor's banner tabs.
  if (slug === "vendors" && VENDOR_RETURN_TABS.has(t)) return `${routeFor(slug)}?tab=${t}&`;
  return `${routeFor(slug)}?`;
}

/** Refresh the manager + the public page after a change. */
function revalidateForSlug(slug: string): void {
  revalidatePath(routeFor(slug));
  const path = PAGE_SECTION_CONFIG[slug]?.previewPath;
  if (path) revalidatePath(path);
  // Safety net so published values reliably appear on the live (non-preview) site.
  revalidatePath("/(site)", "layout") /* PERF-S6: public site only, not /admin */;
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
    // R41 S2: never store a script / protocol-relative link (narrow on purpose
    // so existing buttons with unusual-but-safe links keep working).
    if (isDangerousHref(href)) continue;
    const variant: SectionButtonVariant =
      r.variant === "outline" ? "outline" : r.variant === "ghost" ? "ghost" : "solid";
    out.push({ label, href, variant, enabled: r.enabled === false ? false : true });
    if (out.length >= 4) break;
  }
  return out;
}

/**
 * Parse the section SETTINGS JSON (SLICE 112). The editor sends the FULL,
 * already-merged settings object (existing keys like lanes/titleClassName are
 * preserved client-side), so we simply validate it's a plain object. Returns
 * undefined when absent/invalid so saveSectionDraft leaves settings untouched.
 */
function parseSettings(
  formData: FormData,
): Record<string, unknown> | undefined {
  const raw = formData.get("settings_json");
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  const obj = parsed as Record<string, unknown>;
  // R41 S2: never trust the client's Banner Studio JSON — re-normalize it
  // (clamps, enums, caps, unsafe links dropped) or drop it when invalid.
  if ("design" in obj) {
    const design = normalizeDesign(obj.design);
    return writeDesign(obj, design);
  }
  return obj;
}

export async function seedSectionsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const slug = String(formData.get("page_slug") ?? "");
  if (!isValidPageSlug(slug)) redirect("/admin/website-sync");
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
  redirect(`${backFor(slug, formData)}seeded=${inserted}`);
}

export async function addSectionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const slug = String(formData.get("page_slug") ?? "");
  if (!isValidPageSlug(slug)) redirect("/admin/website-sync");

  const result = await createSection(slug, session.userId);
  if ("error" in result) {
    revalidatePath(routeFor(slug));
    redirect(`${backFor(slug, formData)}error=${encodeURIComponent(result.error)}`);
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
  redirect(`${backFor(slug, formData)}added=1#section-${result.id}`);
}

/**
 * R41 S2: eyebrow / title / subtitle / body are textareas now (Enter = new
 * line). Browsers submit textarea line breaks as CRLF; store plain "\n" so the
 * public `whitespace-pre-line` renders exactly one break per Enter.
 */
function multiline(v: FormDataEntryValue | null): string | null {
  return String(v ?? "").replace(/\r\n?/g, "\n").trim() || null;
}

function isDangerousHref(href: string): boolean {
  const compact = href.replace(/[\s\u0000-\u001f]+/g, "").toLowerCase();
  return /^(javascript|data|vbscript):/.test(compact) || compact.startsWith("//") || compact.startsWith("\\");
}

export async function saveSectionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const slug = String(formData.get("page_slug") ?? "");
  const id = String(formData.get("section_id") ?? "");
  if (!isValidPageSlug(slug) || !id) redirect("/admin/website-sync");

  const input: SectionDraftInput = {
    image: String(formData.get("image") ?? "").trim() || null,
    image_alt: String(formData.get("image_alt") ?? "").trim() || null,
    image_focus: (String(formData.get("image_focus") ?? "center") ||
      "center") as SectionImageFocus,
    text_align: (String(formData.get("text_align") ?? "left") ||
      "left") as SectionTextAlign,
    eyebrow: multiline(formData.get("eyebrow")),
    title: multiline(formData.get("title")),
    subtitle: multiline(formData.get("subtitle")),
    body: multiline(formData.get("body")),
    buttons: parseButtons(formData),
    draft_enabled: formData.get("draft_enabled") === "on",
  };

  // SLICE 112: only include settings when the form sent a valid object, so
  // sections without a settings control keep whatever they already had.
  const settings = parseSettings(formData);
  if (settings !== undefined) input.settings = settings;

  const res = await saveSectionDraft(id, input, session.userId);
  if (res.error) {
    revalidatePath(routeFor(slug));
    redirect(`${backFor(slug, formData)}error=${encodeURIComponent(res.error)}#section-${id}`);
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "page_section.draft",
    entityType: "page_section",
    entityId: id,
  });
  revalidatePath(routeFor(slug));
  redirect(`${backFor(slug, formData)}saved=1#section-${id}`);
}

export async function publishSectionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const slug = String(formData.get("page_slug") ?? "");
  const id = String(formData.get("section_id") ?? "");
  if (!isValidPageSlug(slug) || !id) redirect("/admin/website-sync");

  const res = await publishSection(id, session.userId);
  if (res.error) {
    revalidatePath(routeFor(slug));
    redirect(`${backFor(slug, formData)}error=${encodeURIComponent(res.error)}#section-${id}`);
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "page_section.publish",
    entityType: "page_section",
    entityId: id,
  });
  revalidateForSlug(slug);
  redirect(`${backFor(slug, formData)}published=1#section-${id}`);
}

export async function deleteSectionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const slug = String(formData.get("page_slug") ?? "");
  const id = String(formData.get("section_id") ?? "");
  if (!isValidPageSlug(slug) || !id) redirect("/admin/website-sync");

  const res = await deleteSection(id);
  if (res.error) {
    revalidatePath(routeFor(slug));
    redirect(`${backFor(slug, formData)}error=${encodeURIComponent(res.error)}`);
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "page_section.delete",
    entityType: "page_section",
    entityId: id,
  });
  revalidateForSlug(slug);
  redirect(`${backFor(slug, formData)}deleted=1`);
}

/**
 * SLICE 112 — save the "Home page display" settings (currently the daily-deal
 * highlights card count) onto the locked home.settings config row. Publishes
 * immediately since it's a plain display setting.
 */
export async function saveHomeSettingsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const count = clampHomeCardCount(formData.get("daily_deals_count"));
  const res = await saveHomeSettings(
    { [DAILY_DEALS_COUNT_KEY]: count },
    session.userId,
  );
  if (res.error) {
    revalidatePath(routeFor("home"));
    redirect(`${routeFor("home")}?tab=more&error=${encodeURIComponent(res.error)}`);
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "page_section.home_settings",
    entityType: "page_section",
    entityId: "home.settings",
    after: { dailyDealsCount: count },
  });
  revalidateForSlug("home");
  redirect(`${routeFor("home")}?tab=more&saved=1`);
}

/**
 * Save the six "Shop by Category" tile images onto the home.category section's
 * settings JSON (settings.laneImages). Each lane arrives as a form field
 * `lane_image_<key>` carrying a Media Library URL/path (or blank to clear).
 * Publishes immediately — these are display images, not banner copy — and
 * merges so existing settings (lanes / cardCount) are never dropped. Blank
 * lanes render the clean text-only fallback (byte-identical to the shipped
 * card), so nothing changes on the live site until an image is chosen.
 */
export async function saveTypeCardImagesAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  // R41 S3: the Type Cards editor posts the whole card list as JSON. It is
  // re-normalized here (caps, unsafe links → /menu, image URL rules), never
  // trusted. Legacy laneImages is mirrored for the six default ids so anything
  // still reading it keeps working. A plain object patch is used because
  // saveHomeSectionSettings shallow-merges (an empty map clears old images).
  const rawCards = formData.get("type_cards_json");
  if (typeof rawCards === "string" && rawCards.trim() !== "") {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(rawCards);
    } catch {
      parsed = null;
    }
    if (!Array.isArray(parsed)) {
      redirect(`${routeFor("home")}?tab=typecards&error=${encodeURIComponent("Those cards could not be read. Please try again.")}`);
    }
    const typeCards = normalizeTypeCards(parsed);
    const laneImagesMirror = laneImagesFromCards(typeCards);
    const saved = await saveHomeSectionSettings(
      "home.category",
      { [TYPE_CARDS_KEY]: typeCards, [LANE_IMAGES_KEY]: laneImagesMirror },
      session.userId,
    );
    if (saved.error) {
      revalidatePath(routeFor("home"));
      redirect(`${routeFor("home")}?tab=typecards&error=${encodeURIComponent(saved.error)}`);
    }
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "page_section.type_cards",
      entityType: "page_section",
      entityId: "home.category",
      after: { typeCards },
    });
    revalidateForSlug("home");
    redirect(`${routeFor("home")}?tab=typecards&saved=1`);
  }
  // Legacy form (six lane images only). Start from the existing settings so we merge rather than replace.
  const row = await getHomeSectionByKey("home.category");
  let settings = (row?.settings as Record<string, unknown> | undefined) ?? {};
  for (const lane of HOME_TYPE_LANE_KEYS) {
    const value = formData.get(`lane_image_${lane}`);
    settings = writeLaneImage(settings, lane, typeof value === "string" ? value : "");
  }
  const laneImages = readLaneImages(settings);
  const res = await saveHomeSectionSettings(
    "home.category",
    { [LANE_IMAGES_KEY]: settings[LANE_IMAGES_KEY] },
    session.userId,
  );
  if (res.error) {
    revalidatePath(routeFor("home"));
    redirect(`${routeFor("home")}?tab=typecards&error=${encodeURIComponent(res.error)}`);
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "page_section.type_card_images",
    entityType: "page_section",
    entityId: "home.category",
    after: { laneImages },
  });
  revalidateForSlug("home");
  redirect(`${routeFor("home")}?tab=typecards&saved=1`);
}

export async function moveSectionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const slug = String(formData.get("page_slug") ?? "");
  const id = String(formData.get("section_id") ?? "");
  const direction = String(formData.get("direction") ?? "") === "up" ? "up" : "down";
  if (!isValidPageSlug(slug) || !id) redirect("/admin/website-sync");

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
  redirect(`${backFor(slug, formData)}moved=1#section-${id}`);
}
