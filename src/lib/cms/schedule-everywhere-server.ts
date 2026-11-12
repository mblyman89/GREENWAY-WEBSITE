/**
 * D234 C-7 (SOP-11b G-102, G-103): the scheduled items of every banner area,
 * for the Schedule & Releases calendar and "Preview as of". Read-only; never
 * throws (an area that cannot be read is just empty).
 */
import "server-only";
import { listCarouselSlides } from "./carousel-store";
import { listShopCarouselSlides } from "./shop-carousel-store";
import { getHomeSectionByKey } from "./page-sections-store";
import { normalizeHomeSlideAdvanced } from "./home-slide-advanced-core";
import { hasCustomTypeCards, readTypeCards } from "./type-cards-core";
import type { AsOfItem, ScheduleFields } from "./schedule-everywhere-core";

function homeFields(raw: unknown): ScheduleFields | null {
  const a = normalizeHomeSlideAdvanced(raw ?? null);
  if (!a) return null;
  return {
    scheduleStart: a.scheduleStart,
    scheduleEnd: a.scheduleEnd,
    ...(a.scheduleDays?.length ? { scheduleDays: a.scheduleDays } : {}),
    ...(a.scheduleFrom && a.scheduleTo ? { scheduleFrom: a.scheduleFrom, scheduleTo: a.scheduleTo } : {}),
    ...(a.fallback ? { fallback: true } : {}),
  };
}

const firstLine = (s: string | null | undefined) => String(s ?? "").split("\n")[0]!.trim();

/** Every home slide, Shop slide and type card, with live + draft schedule. */
export async function listScheduledAreaItems(): Promise<AsOfItem[]> {
  const out: AsOfItem[] = [];
  const [home, shop, category] = await Promise.all([
    listCarouselSlides().catch(() => []),
    listShopCarouselSlides().catch(() => []),
    getHomeSectionByKey("home.category").catch(() => null),
  ]);
  for (const s of home) {
    out.push({
      kind: "carousel_slide",
      key: s.id,
      area: "Home carousel",
      label: firstLine(s.title || s.eyebrow) || s.slide_key,
      enabled: s.status === "published" && s.enabled,
      fields: homeFields(s.advanced),
      draftFields: homeFields(s.draft_advanced !== undefined ? s.draft_advanced : s.advanced),
      draftLabel: firstLine(s.draft_title || s.title) || undefined,
    });
  }
  for (const s of shop) {
    const draft = s.draft_presentation ?? s.presentation;
    out.push({
      kind: "shop_slide",
      key: s.id,
      area: "Shop banner",
      label: firstLine(s.presentation.title.text) || s.slide_key,
      enabled: s.status === "published" && s.enabled,
      fields: s.presentation,
      draftFields: draft,
      draftLabel: firstLine(draft.title.text) || undefined,
    });
  }
  // Type cards are saved live (no draft), and only show once the owner saved a list.
  if (hasCustomTypeCards(category?.settings)) {
    for (const c of readTypeCards(category?.settings)) {
      out.push({ kind: "type_card", key: c.id, area: "Type cards", label: c.label, enabled: c.enabled, fields: c.adv ?? null });
    }
  }
  return out;
}

/** Where each item is edited (calendar chips + preview rows link here). */
export function editHrefForItem(i: Pick<AsOfItem, "kind" | "key">): string {
  if (i.kind === "carousel_slide") return `/admin/pages/home?tab=carousel#slide-${i.key}`;
  if (i.kind === "shop_slide") return `/admin/content/shop-banner#slide-${i.key}`;
  return "/admin/pages/home?tab=typecards";
}
