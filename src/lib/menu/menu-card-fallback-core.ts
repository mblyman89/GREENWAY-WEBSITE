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
 *
 * D225 (owner, verbatim in the same file): "I want to be able to add many
 * fallback images to the categories, so that the menu has a variety of images
 * used ... the cards with fallback images, should rotate images."
 *   - a category now holds a LIST of pictures (owner order, capped at
 *     MAX_FALLBACKS_PER_CATEGORY);
 *   - each fallback card starts on a stable slot of that list (a hash of the
 *     card id, so the same product shows the same first picture on every
 *     surface), bumped by one when it would repeat the previous fallback card
 *     of the same category, so neighbouring cards differ;
 *   - the card records that slot (imageFallbackSlot) and the browser rotates
 *     through the same list from there (fallbackRotationOrder). The URL list
 *     itself travels ONCE per page (the layout provider), never per card.
 */
import { websiteCategoryDefinitions } from "@/lib/pos/category-taxonomy";

/** The admin page. */
export const MENU_CARD_FALLBACK_PAGE = "/admin/menu-card-fallbacks";
/** media_usages slot: entity_type / field_key (entity_id = the category). */
export const MENU_CARD_FALLBACK_ENTITY = "menu_card_fallback";
export const MENU_CARD_FALLBACK_FIELD = "image";
/** D225: the most pictures one category can hold. */
export const MAX_FALLBACKS_PER_CATEGORY = 12;
/** D225: how long each picture shows on a rotating card, and the stagger. */
export const ROTATION_DWELL_MS = 6000;
export const ROTATION_STAGGER_MS = 3000;
/** D225: the browser-stored "stop the picture rotation" choice (WCAG 2.2.2). */
export const ROTATION_PAUSE_STORAGE_KEY = "gw.menuCardRotation.paused";

/** D225: usage-ledger field key for one picture in a category list. */
export function fallbackUsageField(mediaId: string): string {
  return `${MENU_CARD_FALLBACK_FIELD}:${mediaId}`;
}
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
  id?: string;
  category?: string | null;
  imageUrl?: string;
  imageIsFallback?: boolean;
  /** D225: the owner-list slot this card shows first (set only here). */
  imageFallbackSlot?: number;
};

/** Trimmed, de-duplicated, non-empty URLs, capped. Accepts one URL or a list. */
export function normalizeFallbackList(raw: string | readonly string[] | null | undefined): string[] {
  const list = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  for (const u of list) {
    const v = typeof u === "string" ? u.trim() : "";
    if (v && !out.includes(v)) out.push(v);
    if (out.length >= MAX_FALLBACKS_PER_CATEGORY) break;
  }
  return out;
}

/** FNV-1a, 32 bit: a stable small hash for picking a starting slot. */
export function stableHash(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The slot a card with this key starts on, in a list of n pictures. */
export function stableSlot(key: string, n: number): number {
  if (!Number.isFinite(n) || n <= 1) return 0;
  return stableHash(key) % Math.floor(n);
}

/** The one picture for a single product (register card, admin page, product page). */
export function fallbackUrlForKey(key: string | null | undefined, list: readonly string[]): string | null {
  const clean = normalizeFallbackList(list);
  if (clean.length === 0) return null;
  return clean[stableSlot(String(key ?? ""), clean.length)] ?? null;
}

/**
 * D225: the order a rotating card shows pictures in: its own slot first, then
 * the rest of the list in owner order, wrapping. Empty when it should not
 * rotate (fewer than two pictures).
 */
export function fallbackRotationOrder(list: readonly string[], slot: number | null | undefined): string[] {
  const clean = normalizeFallbackList(list);
  if (clean.length < 2) return [];
  const start = Number.isInteger(slot) && (slot as number) >= 0 ? (slot as number) % clean.length : 0;
  return clean.slice(start).concat(clean.slice(0, start));
}

/** D225: the stagger before a card's first change, so the grid never flips in unison. */
export function rotationStaggerMs(key: string): number {
  return stableHash(`stagger:${key}`) % ROTATION_STAGGER_MS;
}

/**
 * D225 (WCAG 2.2 SC 2.2.2): rotate only when the shopper has not asked for
 * reduced motion, has not pressed the pause control, the card is on screen,
 * the tab is visible, and there is more than one picture.
 */
export function shouldRotate(env: {
  pictures: number;
  reducedMotion: boolean;
  paused: boolean;
  inView: boolean;
  hidden: boolean;
}): boolean {
  return env.pictures >= 2 && !env.reducedMotion && !env.paused && env.inView && !env.hidden;
}

/** The stored pause value: only the exact string "1" means paused. */
export function parsePausedFlag(raw: string | null | undefined): boolean {
  return raw === "1";
}

/** True when the card shows a photo of THIS product (own or S20-borrowed). */
export function hasOwnPhoto(item: FallbackableItem): boolean {
  return Boolean(item.imageUrl) && item.imageIsFallback !== true;
}

/**
 * Put the owner's per-category fallback on every card that has no photo of
 * its own. `urls` maps website category -> one public URL or (D225) the
 * owner-ordered list. Cards with their own photo, cards whose category has no
 * fallback, and empty URLs are returned unchanged (the same object). Order
 * and length are preserved.
 *
 * D225: each fallback card starts on stableSlot(card id); when that equals the
 * previous fallback card of the same category in this list, it moves one on,
 * so two neighbours never show the same picture. The slot is recorded as
 * imageFallbackSlot for the browser rotation.
 */
export function applyMenuCardFallbacks<T extends FallbackableItem>(
  items: readonly T[],
  urls: ReadonlyMap<string, string | readonly string[]>,
): T[] {
  if (urls.size === 0) return items.slice();
  const lists = new Map<string, string[]>();
  const lastSlot = new Map<string, number>();
  return items.map((item) => {
    if (hasOwnPhoto(item)) return item;
    const cat = parseFallbackCategory(item.category);
    if (!cat) return item;
    let list = lists.get(cat);
    if (!list) {
      list = normalizeFallbackList(urls.get(cat));
      lists.set(cat, list);
    }
    if (list.length === 0) return item;
    let slot = stableSlot(String(item.id ?? ""), list.length);
    if (list.length > 1 && lastSlot.get(cat) === slot) slot = (slot + 1) % list.length;
    lastSlot.set(cat, slot);
    const url = list[slot]!;
    if (item.imageUrl === url && item.imageIsFallback === true && item.imageFallbackSlot === slot) return item;
    return { ...item, imageUrl: url, imageIsFallback: true, imageFallbackSlot: slot };
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

export type FallbackRow = {
  website_category: string;
  media_id: string;
  updated_at: string | null;
  /** D225 (0356); absent before 0356 is applied. */
  id?: string | null;
  sort_order?: number | null;
};
export type FallbackMedia = { id: string; url: string | null; title: string | null; status: string | null };
/** Live cards per category: how many, and how many have no photo of their own. */
export type CategoryCoverage = { cards: number; withoutOwnPhoto: number };

export type FallbackPicture = {
  mediaId: string;
  url: string | null;
  title: string | null;
  /** The picture is a draft / archived copy (it still shows), or is missing. */
  statusNote: string | null;
  updatedAt: string | null;
};

export type FallbackPageRow = {
  category: FallbackCategory;
  label: string;
  helper: string;
  /** D225: every picture for this category, in owner order. */
  pictures: FallbackPicture[];
  /** Room for more pictures (MAX_FALLBACKS_PER_CATEGORY). */
  canAdd: boolean;
  coverage: CategoryCoverage | null;
  /** One sentence: what the shopper sees on this category right now. */
  effect: string;
};

function effectLine(count: number, cov: CategoryCoverage | null): string {
  const set = count > 0;
  const what = count > 1 ? `${count} pictures, rotating,` : "this picture";
  if (!cov) return set ? `Shows ${what} on every card in this category without its own photo.` : "Not set.";
  if (cov.cards === 0) return set ? "Set. No live cards in this category right now." : "Not set. No live cards in this category right now.";
  const n = cov.withoutOwnPhoto;
  const cards = `${n} of ${cov.cards} card${cov.cards === 1 ? "" : "s"}`;
  if (n === 0) return set ? `Set. Every card here has its own photo, so it is not showing.` : "Not needed yet: every card here has its own photo.";
  return set
    ? `Showing ${what} on ${cards} (no photo of their own).`
    : `${cards} ${n === 1 ? "has" : "have"} no photo of its own and ${n === 1 ? "shows" : "show"} a generic fallback or the mockup.`;
}

function statusNoteFor(m: FallbackMedia | null): string | null {
  if (!m) return "This picture could not be found in the media library.";
  if (m.status === "draft") return "Draft in the media library. It still shows on the cards.";
  if (m.status === "archived") return "Archived in the media library. It still shows on the cards.";
  return null;
}

/** Rows in owner order: sort_order, then oldest first, then id. */
export function orderFallbackRows<R extends FallbackRow>(rows: readonly R[]): R[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const so = (a.r.sort_order ?? 0) - (b.r.sort_order ?? 0);
      if (so !== 0) return so;
      return a.i - b.i;
    })
    .map((x) => x.r);
}

/** website category -> media ids in owner order (one each; unknown categories dropped). */
export function groupFallbackRows(rows: readonly FallbackRow[]): Map<FallbackCategory, string[]> {
  const out = new Map<FallbackCategory, string[]>();
  for (const r of orderFallbackRows(rows)) {
    const c = parseFallbackCategory(r.website_category);
    if (!c) continue;
    const list = out.get(c) ?? [];
    if (!list.includes(r.media_id) && list.length < MAX_FALLBACKS_PER_CATEGORY) list.push(r.media_id);
    out.set(c, list);
  }
  return out;
}

/**
 * D225: move one picture up or down in its category. Returns the new media id
 * order, or null when the move is not possible (not found, already at the end).
 */
export function movedOrder(order: readonly string[], mediaId: string, direction: "up" | "down"): string[] | null {
  const i = order.indexOf(mediaId);
  if (i < 0) return null;
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= order.length) return null;
  const next = order.slice();
  next[i] = order[j]!;
  next[j] = order[i]!;
  return next;
}

/** D225: how many of `wanted` new pictures fit, given `have` already. */
export function roomFor(have: number, wanted: number): number {
  return Math.max(0, Math.min(wanted, MAX_FALLBACKS_PER_CATEGORY - Math.max(0, have)));
}

export function fallbackPageRows(
  rows: readonly FallbackRow[],
  media: readonly FallbackMedia[],
  coverage: ReadonlyMap<string, CategoryCoverage> | null,
): FallbackPageRow[] {
  const grouped = groupFallbackRows(rows);
  const updatedById = new Map<string, string | null>();
  for (const r of orderFallbackRows(rows)) {
    const c = parseFallbackCategory(r.website_category);
    const k = `${c}|${r.media_id}`;
    if (c && !updatedById.has(k)) updatedById.set(k, r.updated_at ?? null);
  }
  const mediaById = new Map(media.map((m) => [m.id, m]));
  return websiteCategoryDefinitions.map((d) => {
    const ids = grouped.get(d.value) ?? [];
    const pictures: FallbackPicture[] = ids.map((id) => {
      const m = mediaById.get(id) ?? null;
      return {
        mediaId: id,
        url: m?.url ?? null,
        title: m?.title ?? null,
        statusNote: statusNoteFor(m),
        updatedAt: updatedById.get(`${d.value}|${id}`) ?? null,
      };
    });
    const cov = coverage ? coverage.get(d.value) ?? { cards: 0, withoutOwnPhoto: 0 } : null;
    return {
      category: d.value,
      label: d.label,
      helper: d.helper,
      pictures,
      canAdd: pictures.length < MAX_FALLBACKS_PER_CATEGORY,
      coverage: cov,
      effect: effectLine(pictures.length, cov),
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

  const urls = new Map<string, string | readonly string[]>([["flower", "https://cdn.test/flower.webp"], ["preroll", ["https://cdn.test/pr.webp"]]]);
  const own: FallbackableItem = { category: "flower", imageUrl: "https://cdn.test/own.webp", imageIsFallback: false };
  const borrowed: FallbackableItem = { category: "flower", imageUrl: "https://cdn.test/borrowed.webp" }; // S20: isFallback absent
  const generic: FallbackableItem = { category: "flower", imageUrl: "https://cdn.test/kb-sub.webp", imageIsFallback: true };
  const blank: FallbackableItem = { category: "flower" };
  const other: FallbackableItem = { category: "topical" };
  const [a, b, c, d, e] = applyMenuCardFallbacks([own, borrowed, generic, blank, other], urls);
  ok(a === own, "own photo untouched (same object)");
  ok(b === borrowed, "borrowed product photo untouched");
  ok(c!.imageUrl === "https://cdn.test/flower.webp" && c!.imageIsFallback === true, "owner fallback beats a generic substitute");
  ok(d!.imageUrl === "https://cdn.test/flower.webp" && d!.imageIsFallback === true, "blank card gets the fallback");
  ok(e === other, "category without a fallback untouched");
  ok(blank.imageUrl === undefined, "input never mutated");
  ok(applyMenuCardFallbacks([blank], new Map()).length === 1, "no fallbacks -> same length");
  ok(applyMenuCardFallbacks<FallbackableItem>([{ category: "flower" }], new Map<string, string>([["flower", "  "]]))[0]!.imageUrl === undefined, "empty URL ignored");
  ok(applyMenuCardFallbacks<FallbackableItem>([{ category: "Flower" }], urls)[0]!.imageUrl === "https://cdn.test/flower.webp", "category case-insensitive");
  ok(applyMenuCardFallbacks<FallbackableItem>([{ category: null }], urls)[0]!.imageUrl === undefined, "no category -> unchanged");

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
      { website_category: "flower", media_id: "m9", updated_at: null, sort_order: 1 },
      { website_category: "flower", media_id: "m1", updated_at: "2026-11-10", sort_order: 0 },
      { website_category: "flower", media_id: "m1", updated_at: null, sort_order: 2 },
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
  ok(rows[0]!.pictures.map((p) => p.mediaId).join(",") === "m1,m9", "pictures in sort order, a repeat dropped");
  ok(rows[0]!.pictures[0]!.url === "https://cdn.test/f.webp" && rows[0]!.pictures[0]!.updatedAt === "2026-11-10", "picture carries url + date");
  ok(/Showing 2 pictures, rotating, on 2 of 3 cards/.test(rows[0]!.effect), "effect line says rotating + counts cards");
  const pr = rows.find((r) => r.category === "preroll")!;
  ok(/Draft/.test(pr.pictures[0]!.statusNote ?? "") && /Showing this picture on/.test(pr.effect) === false, "draft picture is called out");
  ok(rows[0]!.pictures[1]!.statusNote !== null, "missing picture called out");
  const top = rows.find((r) => r.category === "topical")!;
  ok(top.pictures.length === 0 && /1 of 1 card has no photo/.test(top.effect), "unset category with blank cards says so");
  const merch = rows.find((r) => r.category === "merch")!;
  ok(/No live cards/.test(merch.effect) && merch.canAdd, "empty category says so, room to add");

  // ---- D225: many pictures, variety, rotation ----
  const list = ["u0", "u1", "u2"];
  ok(MAX_FALLBACKS_PER_CATEGORY === 12, "cap is 12 per category");
  ok(normalizeFallbackList(" u0 ").join() === "u0", "one URL becomes a one-item list");
  ok(normalizeFallbackList(["u0", " ", "u0", "u1"]).join() === "u0,u1", "list trimmed + de-duplicated");
  ok(normalizeFallbackList(Array.from({ length: 20 }, (_, i) => `u${i}`)).length === 12, "list capped");
  ok(normalizeFallbackList(null).length === 0, "null -> empty list");
  ok(stableHash("abc") === stableHash("abc") && stableHash("abc") !== stableHash("abd"), "hash stable and spread");
  ok(stableSlot("x", 1) === 0 && stableSlot("x", 0) === 0, "one picture -> slot 0");
  const slots = new Set(Array.from({ length: 60 }, (_, i) => stableSlot(`card-${i}`, 3)));
  ok(slots.size === 3, "60 cards use every one of 3 pictures");
  ok(fallbackUrlForKey("card-7", list) === list[stableSlot("card-7", 3)], "single product: stable pick");
  ok(fallbackUrlForKey("card-7", []) === null, "single product: no list -> null");
  const many = new Map<string, readonly string[]>([["flower", list]]);
  const grid = applyMenuCardFallbacks<FallbackableItem>(
    Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, category: "flower" })),
    many,
  );
  ok(new Set(grid.map((g) => g.imageUrl)).size === 3, "a grid of 30 cards shows variety");
  ok(grid.every((g, i) => i === 0 || g.imageUrl !== grid[i - 1]!.imageUrl), "neighbouring fallback cards never repeat");
  ok(grid.every((g) => g.imageUrl === list[g.imageFallbackSlot!]), "slot recorded matches the picture");
  ok(grid.every((g) => g.imageIsFallback === true), "every variety pick is still badged");
  const mixed = applyMenuCardFallbacks<FallbackableItem>([own, { id: "q1", category: "flower" }], many);
  ok(mixed[0] === own, "own photo still wins with many pictures");
  ok(fallbackRotationOrder(list, 1).join() === "u1,u2,u0", "rotation starts on the card slot and wraps");
  ok(fallbackRotationOrder(list, 7).join() === "u1,u2,u0", "rotation slot wraps past the end");
  ok(fallbackRotationOrder(["u0"], 0).length === 0, "one picture never rotates");
  ok(rotationStaggerMs("p1") >= 0 && rotationStaggerMs("p1") < ROTATION_STAGGER_MS, "stagger inside its window");
  const env = { pictures: 3, reducedMotion: false, paused: false, inView: true, hidden: false };
  ok(shouldRotate(env), "rotates when allowed");
  ok(!shouldRotate({ ...env, reducedMotion: true }), "reduced motion stops rotation");
  ok(!shouldRotate({ ...env, paused: true }), "pause control stops rotation (WCAG 2.2.2)");
  ok(!shouldRotate({ ...env, inView: false }) && !shouldRotate({ ...env, hidden: true }), "off screen / hidden tab stops rotation");
  ok(!shouldRotate({ ...env, pictures: 1 }), "one picture never rotates (env)");
  ok(parsePausedFlag("1") && !parsePausedFlag("true") && !parsePausedFlag(null), "only \"1\" means paused");
  ok(movedOrder(["a", "b", "c"], "b", "up")!.join() === "b,a,c", "move up");
  ok(movedOrder(["a", "b", "c"], "b", "down")!.join() === "a,c,b", "move down");
  ok(movedOrder(["a", "b"], "a", "up") === null && movedOrder(["a"], "z", "down") === null, "impossible moves refused");
  ok(roomFor(10, 5) === 2 && roomFor(12, 1) === 0 && roomFor(0, 3) === 3, "room left under the cap");
  ok(fallbackUsageField("m1") === "image:m1", "usage ledger slot per picture");
  ok(groupFallbackRows([{ website_category: "Flower", media_id: "a", updated_at: null }]).get("flower")?.join() === "a", "group normalizes category");

  return { passed, failed };
}
