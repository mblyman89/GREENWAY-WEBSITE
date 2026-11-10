/**
 * src/lib/menu/menu-card-fallback-core.ts  (D224)
 *
 * Owner (D224, verbatim in docs/sop-program/00-OWNER-REQUEST-VERBATIM.md):
 * "There should be one image per website category, when set, automatically
 * shows on all cards in that category without a product image set."
 *
 * PURE. Every decision the feature makes lives here so it is provable:
 *   - which categories exist (the website categories, never POS ones);
 *   - which cards get the fallback (no photo of their own), and which never do
 *     (a card with its OWN photo, exact or borrowed from its product, S20);
 *   - where it sits in the image ladder: own photo > owner fallback for the
 *     card's website category > the older generic substitutes (brand, vendor,
 *     POS category, inventory type, global) > the mockup;
 *   - the admin page rows and the upload checks.
 *
 * The fallback is always marked imageIsFallback = true, so every card shows
 * the honest "Representative image" badge, the product page never emits an
 * ImageObject for it, and the image sitemap never lists it (D221 M8 rules).
 *
 * The category used is the card's FINAL website category, after the owner's
 * per-product re-file (withCategoryOverride), so a re-filed product shows the
 * fallback of the category it is actually listed under.
 */
import { websiteCategoryDefinitions } from "@/lib/pos/category-taxonomy";

/** The admin page. */
export const MENU_CARD_FALLBACK_PAGE = "/admin/menu-card-fallbacks";
/** media_usages slot: entity_type / field_key (entity_id = the category). */
export const MENU_CARD_FALLBACK_ENTITY = "menu_card_fallback";
export const MENU_CARD_FALLBACK_FIELD = "image";
/** The provenance label the admin product page shows. */
export const WEBSITE_CATEGORY_SOURCE = "website_category" as const;

/** Upload formats (the same images the product editor accepts). */
export const FALLBACK_UPLOAD_MIME: readonly string[] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export type FallbackCategory = (typeof websiteCategoryDefinitions)[number]["value"];

const CATEGORY_SET: ReadonlySet<string> = new Set(websiteCategoryDefinitions.map((d) => d.value));

/** Every website category, in the order the shop lists them. */
export const FALLBACK_CATEGORIES: readonly FallbackCategory[] = websiteCategoryDefinitions.map((d) => d.value);

/** A trimmed, lower-cased website category, or null when it is not one. */
export function parseFallbackCategory(raw: unknown): FallbackCategory | null {
  const v = String(raw ?? "").trim().toLowerCase();
  return CATEGORY_SET.has(v) ? (v as FallbackCategory) : null;
}

/** A media id shaped like a uuid, or null. */
export function parseMediaId(raw: unknown): string | null {
  const v = String(raw ?? "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v) ? v : null;
}

/** The card fields this module reads and writes. */
export type FallbackableItem = {
  category?: string | null;
  imageUrl?: string;
  imageIsFallback?: boolean;
};

/** True when the card shows a photo of THIS product (own or S20-borrowed). */
export function hasOwnPhoto(item: FallbackableItem): boolean {
  return Boolean(item.imageUrl) && item.imageIsFallback !== true;
}

/**
 * Put the owner's per-category fallback on every card that has no photo of
 * its own. `urls` maps website category -> public URL. Cards with their own
 * photo, cards whose category has no fallback, and empty URLs are returned
 * unchanged (the same object). Order and length are preserved.
 */
export function applyMenuCardFallbacks<T extends FallbackableItem>(
  items: readonly T[],
  urls: ReadonlyMap<string, string>,
): T[] {
  if (urls.size === 0) return items.slice();
  return items.map((item) => {
    if (hasOwnPhoto(item)) return item;
    const cat = parseFallbackCategory(item.category);
    const url = cat ? urls.get(cat)?.trim() : undefined;
    if (!url) return item;
    if (item.imageUrl === url && item.imageIsFallback === true) return item;
    return { ...item, imageUrl: url, imageIsFallback: true };
  });
}

/** The resolver result shape (image-resolver ResolvedImage, kept loose). */
export type ResolvedLike<S extends string = string> = { url: string; source: S; isFallback: boolean };

/**
 * One-product form of the same rule, for the register info card and the admin
 * product page: the product's own photo wins; otherwise the owner's fallback
 * (when set) replaces the generic substitute or fills the blank.
 */
export function pickWithCategoryFallback<S extends string>(
  resolved: ResolvedLike<S> | null,
  fallbackUrl: string | null | undefined,
): ResolvedLike<S | typeof WEBSITE_CATEGORY_SOURCE> | null {
  if (resolved && !resolved.isFallback) return resolved;
  const url = (fallbackUrl ?? "").trim();
  if (!url) return resolved;
  return { url, source: WEBSITE_CATEGORY_SOURCE, isFallback: true };
}

/** Plain-English provenance for the admin product page's "Fallback: ..." chip. */
export function fallbackSourceLabel(source: string): string {
  if (source === WEBSITE_CATEGORY_SOURCE) return "website category (Menu Card Fallbacks)";
  if (source === "inventory_type") return "inventory type";
  return source.replace(/[-_]/g, " ");
}

/** Upload checks before any bytes are read. Null = fine. */
export function fallbackUploadProblem(file: { type: string; size: number; name: string }, maxBytes: number): string | null {
  if (!file || file.size <= 0) return "Choose a picture to upload.";
  if (!FALLBACK_UPLOAD_MIME.includes(file.type)) {
    return `Unsupported type: ${file.type || file.name}. Use PNG, JPG, WEBP or GIF.`;
  }
  if (file.size > maxBytes) {
    const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);
    return `${file.name} is ${mb(file.size)} MB. The limit is ${mb(maxBytes)} MB per picture.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Admin page rows
// ---------------------------------------------------------------------------

export type FallbackRow = { website_category: string; media_id: string; updated_at: string | null };
export type FallbackMedia = { id: string; url: string | null; title: string | null; status: string | null };
/** Live cards per category: how many, and how many have no photo of their own. */
export type CategoryCoverage = { cards: number; withoutOwnPhoto: number };

export type FallbackPageRow = {
  category: FallbackCategory;
  label: string;
  helper: string;
  mediaId: string | null;
  url: string | null;
  title: string | null;
  /** The chosen picture is a draft / archived copy (it still shows). */
  statusNote: string | null;
  updatedAt: string | null;
  coverage: CategoryCoverage | null;
  /** One sentence: what the shopper sees on this category right now. */
  effect: string;
};

function effectLine(set: boolean, cov: CategoryCoverage | null): string {
  if (!cov) return set ? "Shows on every card in this category without its own photo." : "Not set.";
  if (cov.cards === 0) return set ? "Set. No live cards in this category right now." : "Not set. No live cards in this category right now.";
  const n = cov.withoutOwnPhoto;
  const cards = `${n} of ${cov.cards} card${cov.cards === 1 ? "" : "s"}`;
  if (n === 0) return set ? `Set. Every card here has its own photo, so it is not showing.` : "Not needed yet: every card here has its own photo.";
  return set
    ? `Showing on ${cards} (no photo of their own).`
    : `${cards} ${n === 1 ? "has" : "have"} no photo of its own and ${n === 1 ? "shows" : "show"} a generic fallback or the mockup.`;
}

export function fallbackPageRows(
  rows: readonly FallbackRow[],
  media: readonly FallbackMedia[],
  coverage: ReadonlyMap<string, CategoryCoverage> | null,
): FallbackPageRow[] {
  const byCat = new Map<string, FallbackRow>();
  for (const r of rows) {
    const c = parseFallbackCategory(r.website_category);
    if (c && !byCat.has(c)) byCat.set(c, r);
  }
  const mediaById = new Map(media.map((m) => [m.id, m]));
  return websiteCategoryDefinitions.map((d) => {
    const r = byCat.get(d.value) ?? null;
    const m = r ? mediaById.get(r.media_id) ?? null : null;
    const cov = coverage ? coverage.get(d.value) ?? { cards: 0, withoutOwnPhoto: 0 } : null;
    const status = m?.status ?? null;
    return {
      category: d.value,
      label: d.label,
      helper: d.helper,
      mediaId: r?.media_id ?? null,
      url: m?.url ?? null,
      title: m?.title ?? null,
      statusNote:
        r && !m
          ? "The chosen picture could not be found in the media library."
          : status === "draft"
            ? "This picture is a draft in the media library. It still shows on the cards."
            : status === "archived"
              ? "This picture is archived in the media library. It still shows on the cards."
              : null,
      updatedAt: r?.updated_at ?? null,
      coverage: cov,
      effect: effectLine(Boolean(r), cov),
    };
  });
}

/** Count live cards per website category, and those with no photo of their own. */
export function coverageByCategory(items: readonly FallbackableItem[]): Map<string, CategoryCoverage> {
  const out = new Map<string, CategoryCoverage>();
  for (const it of items) {
    const c = parseFallbackCategory(it.category);
    if (!c) continue;
    const cur = out.get(c) ?? { cards: 0, withoutOwnPhoto: 0 };
    cur.cards += 1;
    if (!hasOwnPhoto(it)) cur.withoutOwnPhoto += 1;
    out.set(c, cur);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runMenuCardFallbackTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[menu-card-fallback-core] FAIL: ${label}`);
    }
  };

  // categories
  ok(FALLBACK_CATEGORIES.length === 21, "21 website categories");
  ok(parseFallbackCategory(" Flower ") === "flower", "category trimmed + lower-cased");
  ok(parseFallbackCategory("pre-roll") === null, "a POS category is not a website category");
  ok(parseFallbackCategory("") === null && parseFallbackCategory(null) === null, "blank is refused");
  ok(parseFallbackCategory("edible-solid") === "edible-solid", "hyphenated category accepted");
  ok(parseMediaId("00000000-0000-4000-8000-000000035501") !== null, "uuid accepted");
  ok(parseMediaId("x; drop table") === null, "non-uuid refused");

  const urls = new Map([["flower", "https://cdn.test/flower.webp"], ["preroll", "https://cdn.test/pr.webp"]]);
  const own = { category: "flower", imageUrl: "https://cdn.test/own.webp", imageIsFallback: false };
  const borrowed = { category: "flower", imageUrl: "https://cdn.test/borrowed.webp" }; // S20: isFallback absent
  const generic = { category: "flower", imageUrl: "https://cdn.test/kb-sub.webp", imageIsFallback: true };
  const blank = { category: "flower" };
  const other = { category: "topical" };
  const [a, b, c, d, e] = applyMenuCardFallbacks([own, borrowed, generic, blank, other], urls);
  ok(a === own, "own photo untouched (same object)");
  ok(b === borrowed, "borrowed product photo untouched");
  ok(c!.imageUrl === "https://cdn.test/flower.webp" && c!.imageIsFallback === true, "owner fallback beats a generic substitute");
  ok(d!.imageUrl === "https://cdn.test/flower.webp" && d!.imageIsFallback === true, "blank card gets the fallback");
  ok(e === other, "category without a fallback untouched");
  ok(blank.imageUrl === undefined, "input never mutated");
  ok(applyMenuCardFallbacks([blank], new Map()).length === 1, "no fallbacks -> same length");
  ok(applyMenuCardFallbacks([{ category: "flower" }], new Map([["flower", "  "]]))[0]!.imageUrl === undefined, "empty URL ignored");
  ok(applyMenuCardFallbacks([{ category: "Flower" }], urls)[0]!.imageUrl === "https://cdn.test/flower.webp", "category case-insensitive");
  ok(applyMenuCardFallbacks([{ category: null }], urls)[0]!.imageUrl === undefined, "no category -> unchanged");

  // single-product form
  const exact = { url: "u-own", source: "exact", isFallback: false };
  const sub = { url: "u-sub", source: "category", isFallback: true };
  ok(pickWithCategoryFallback(exact, "u-fb") === exact, "single: own photo wins");
  ok(pickWithCategoryFallback(sub, "u-fb")?.url === "u-fb", "single: fallback beats substitute");
  ok(pickWithCategoryFallback(sub, "u-fb")?.source === WEBSITE_CATEGORY_SOURCE, "single: provenance website_category");
  ok(pickWithCategoryFallback(null, "u-fb")?.isFallback === true, "single: fills the blank as a fallback");
  ok(pickWithCategoryFallback(sub, null) === sub, "single: no fallback keeps the substitute");
  ok(pickWithCategoryFallback(null, "") === null, "single: nothing -> null");
  ok(fallbackSourceLabel("website_category").startsWith("website category"), "label for website_category");
  ok(fallbackSourceLabel("inventory_type") === "inventory type", "label for inventory_type");

  // upload checks
  const MB = 1024 * 1024;
  ok(fallbackUploadProblem({ type: "image/png", size: 10, name: "a.png" }, 4 * MB) === null, "png ok");
  ok(/Unsupported/.test(fallbackUploadProblem({ type: "application/pdf", size: 10, name: "a.pdf" }, 4 * MB) ?? ""), "pdf refused");
  ok(/limit/.test(fallbackUploadProblem({ type: "image/jpeg", size: 5 * MB, name: "a.jpg" }, 4 * MB) ?? ""), "too big refused");
  ok(/Choose/.test(fallbackUploadProblem({ type: "image/png", size: 0, name: "a.png" }, 4 * MB) ?? ""), "empty refused");

  // page rows + coverage
  const cov = coverageByCategory([own, blank, generic, other, { category: "nope" }]);
  ok(cov.get("flower")?.cards === 3 && cov.get("flower")?.withoutOwnPhoto === 2, "coverage counts flower");
  ok(cov.get("topical")?.withoutOwnPhoto === 1 && !cov.has("nope"), "coverage ignores unknown categories");
  const rows = fallbackPageRows(
    [
      { website_category: "flower", media_id: "m1", updated_at: "2026-11-10" },
      { website_category: "flower", media_id: "m9", updated_at: null },
      { website_category: "preroll", media_id: "m2", updated_at: null },
      { website_category: "bogus", media_id: "m3", updated_at: null },
    ],
    [
      { id: "m1", url: "https://cdn.test/f.webp", title: "Jar", status: "published" },
      { id: "m2", url: null, title: null, status: "draft" },
    ],
    cov,
  );
  ok(rows.length === 21 && rows[0]!.category === "flower", "one row per category, shop order");
  ok(rows[0]!.mediaId === "m1" && rows[0]!.url === "https://cdn.test/f.webp", "first row per category wins");
  ok(/Showing on 2 of 3 cards/.test(rows[0]!.effect), "effect line counts the cards it shows on");
  const pr = rows.find((r) => r.category === "preroll")!;
  ok(/draft/.test(pr.statusNote ?? ""), "draft picture is called out");
  const top = rows.find((r) => r.category === "topical")!;
  ok(top.mediaId === null && /1 of 1 card has no photo/.test(top.effect), "unset category with blank cards says so");
  const merch = rows.find((r) => r.category === "merch")!;
  ok(/No live cards/.test(merch.effect), "empty category says so");
  ok(fallbackPageRows([{ website_category: "flower", media_id: "gone", updated_at: null }], [], null)[0]!.statusNote !== null, "missing picture called out");

  return { passed, failed };
}
