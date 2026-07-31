/**
 * src/lib/cms/shop-carousel-core.ts
 *
 * SLICE A (SHOP-1) — the PURE single source of truth for how the Shop (/menu)
 * TOP BANNER CAROUSEL is presented. Historically /menu had a single hardcoded
 * static banner (an orange/green radial-gradient blob with the menu.hero title +
 * subtitle from Site Content). This module replaces it with a CAROUSEL of up to
 * ten fully-editable "special" slides — each slide has the SAME rich powers as
 * the loyalty hero banner (SLICE 123):
 *
 *   • a TEXTLESS background image (desktop) + a separate mobile image, each with
 *     its own focus,
 *   • THREE independently styled overlay text blocks (eyebrow / title / subtitle),
 *     each with its OWN font (bold display / clean sans / cursive script),
 *     on-brand COLOR, show/hide, hard-line-break stacking, and an optional
 *     bigger "script size" for a cursive flourish,
 *   • text horizontal align + vertical align,
 *   • per-slide CTA BUTTONS (up to two), and
 *   • an OPTIONAL schedule window (startsAt / endsAt) so a promo slide can be
 *     staged to auto-appear and auto-retire (fully wired in a later slice; the
 *     fields are stored + honored here so nothing needs a second migration).
 *
 * WHY REUSE THE LOYALTY CORE: the font list, color list, alignment vocabulary,
 * line-splitting, and script handling are IDENTICAL to the loyalty hero, so we
 * import them straight from @/lib/loyalty/loyalty-hero-core rather than
 * re-declaring them. That guarantees the editor preview and the public render
 * use the exact same next/font stacks and brand hexes site-wide.
 *
 * STORAGE (OPTION A, owner-approved): a NEW table `public.shop_carousel_slides`
 * (migration 0148), mirroring `home_carousel_slides` (migration 0011). Each row
 * stores the slide's presentation as JSON in a published column + a draft
 * column, so a slide can be edited and previewed before it goes live — exactly
 * like the home carousel and content_blocks. Code ships WORKING PRE-MIGRATION:
 * the store falls back to a single default slide that matches TODAY'S look, so
 * the Shop banner never blanks and stays effectively identical until staff
 * edit + publish.
 */

import {
  // Alignment + focus vocabularies (shared, identical to the loyalty hero).
  type TextAlign,
  type TextVAlign,
  type ImageFocus,
  isTextAlign,
  isTextVAlign,
  isImageFocus,
  // Per-block font/color helpers (shared library ids → real next/font stacks).
  type HeroTextBlock,
  isHeroFont,
  isHeroColor,
  clampScriptScale,
  SCRIPT_SCALE_DEFAULT,
} from "@/lib/loyalty/loyalty-hero-core";

/** Up to ten slides shown publicly + the editor's add cap (owner request). */
export const MAX_SHOP_CAROUSEL_SLIDES = 10;

/** Auto-rotate interval for the public carousel (ms). Kept here so the render + tests agree. */
export const SHOP_CAROUSEL_AUTOPLAY_MS = 6500;

// ── Per-slide CTA buttons (value-add) ────────────────────────────────────────

/** A slide can point shoppers somewhere with up to two styled buttons. */
export const CTA_VARIANTS = ["solid", "outline"] as const;
export type ShopCtaVariant = (typeof CTA_VARIANTS)[number];
export function isCtaVariant(v: unknown): v is ShopCtaVariant {
  return typeof v === "string" && (CTA_VARIANTS as readonly string[]).includes(v);
}

export type ShopSlideCta = {
  href: string;
  label: string;
  variant: ShopCtaVariant;
};

export const MAX_SLIDE_CTAS = 2;

/** Coerce an unknown array into at most two valid CTAs (drop blanks). */
export function normalizeCtas(value: unknown): ShopSlideCta[] {
  if (!Array.isArray(value)) return [];
  const out: ShopSlideCta[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const href = typeof r.href === "string" ? r.href.trim() : "";
    const label = typeof r.label === "string" ? r.label.trim() : "";
    if (!href || !label) continue;
    out.push({ href, label, variant: isCtaVariant(r.variant) ? r.variant : "solid" });
    if (out.length >= MAX_SLIDE_CTAS) break;
  }
  return out;
}

// ── Sale link (SLICE B / SHOP-2) ────────────────────────────────────────────

/**
 * A slide can be LINKED to a published promotion (a one-off sale) and, when the
 * owner opts in, that link AUTO-CREATES a matching "sale filter" checkbox in the
 * Shop sidebar (the actual sidebar render lands in Slice C). The link + the
 * owner-chosen filter NAME live inside the slide's presentation JSON, so no new
 * migration is ever needed.
 */
export type ShopSlidePromotion = {
  /** The linked promotion's id (from getPublishedPromotions), or null = none. */
  promotionId: string | null;
  /**
   * The label shown on the sidebar sale-filter checkbox (owner-chosen). Blank =
   * fall back to the promotion's own title at render time.
   */
  filterName: string;
  /** When true, this sale appears as its own checkbox in the Shop filter sidebar. */
  autoFilter: boolean;
};

/** No promotion linked. */
export function defaultShopSlidePromotion(): ShopSlidePromotion {
  return { promotionId: null, filterName: "", autoFilter: false };
}

/** Coerce an unknown value into a valid ShopSlidePromotion (never throws). */
export function normalizeShopSlidePromotion(raw: unknown): ShopSlidePromotion {
  const base = defaultShopSlidePromotion();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  const promotionId =
    typeof o.promotionId === "string" && o.promotionId.trim() ? o.promotionId.trim() : null;
  const filterName = typeof o.filterName === "string" ? o.filterName.trim().slice(0, 40) : "";
  // A filter with no linked promotion is meaningless, so autoFilter needs a link.
  const autoFilter = o.autoFilter === true && promotionId !== null;
  return { promotionId, filterName, autoFilter };
}

/**
 * A stable, URL/DOM-safe id for one sale filter, derived from its label. Pure so
 * the sidebar (client) and any server callers agree. Falls back to the
 * promotion id when the name slugs to nothing (e.g. all punctuation).
 */
export function slugifyShopFilter(name: string, fallback: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `sale-${fallback}`;
}

// ── One overlay text block (mirrors the loyalty hero block) ──────────────────

/**
 * Build the default for one overlay text block. Kept local (not imported) so a
 * slide's defaults are explicit + independent of the loyalty hero's defaults.
 */
function defaultBlock(
  text: string,
  font: string,
  color: string,
  opts?: { show?: boolean; scriptScale?: number },
): HeroTextBlock {
  return {
    text,
    font,
    color,
    show: opts?.show ?? true,
    scriptScale: opts?.scriptScale ?? SCRIPT_SCALE_DEFAULT,
  };
}

/**
 * Coerce a raw object into a valid HeroTextBlock. Font/color ids fall back to
 * the supplied default block's ids when unknown, so a slide never renders
 * garbage. (Same shape + rules as the loyalty hero's normalizeBlock.)
 */
function normalizeBlock(raw: unknown, def: HeroTextBlock): HeroTextBlock {
  if (!raw || typeof raw !== "object") return { ...def };
  const o = raw as Record<string, unknown>;
  return {
    text: typeof o.text === "string" ? o.text : def.text,
    font: isHeroFont(o.font) ? (o.font as string) : def.font,
    color: isHeroColor(o.color) ? (o.color as string) : def.color,
    show: typeof o.show === "boolean" ? o.show : def.show,
    scriptScale:
      o.scriptScale === undefined ? def.scriptScale : clampScriptScale(o.scriptScale),
  };
}

// ── The full per-slide presentation ──────────────────────────────────────────

/**
 * Everything about ONE Shop carousel slide's look + behavior. This is the JSON
 * stored (published + draft) per row in shop_carousel_slides.
 */
export type ShopHeroPresentation = {
  /** Desktop background image (textless art); "" = plain dark panel. */
  image: string;
  /** Mobile background image (textless art); "" = plain dark panel. */
  imageMobile: string;
  /** Where the desktop image sits, independent of the text. */
  imageFocus: ImageFocus;
  /** Where the mobile image sits, independent of the text. */
  imageFocusMobile: ImageFocus;
  /** Horizontal placement of the overlay text. */
  textAlign: TextAlign;
  /** Vertical placement of the overlay text. */
  verticalAlign: TextVAlign;
  /** The small kicker above the title. */
  eyebrow: HeroTextBlock;
  /** The headline (stackable via hard line breaks). */
  title: HeroTextBlock;
  /** The supporting line (great with a cursive font). */
  subtitle: HeroTextBlock;
  /** Up to two call-to-action buttons. */
  ctas: ShopSlideCta[];
  /**
   * Optional link to a published promotion (a one-off sale) + the sidebar sale
   * filter it can auto-create (SLICE B). Stored in the same JSON blob so no new
   * migration is needed. Defaults to "no sale linked".
   */
  promotion: ShopSlidePromotion;
  /**
   * Optional schedule window (ISO strings). When set, the slide is only shown
   * publicly inside the window. null = always shown. (Honored by isSlideLiveAt;
   * the editor UI + auto-link land in a later slice — the field is stored now so
   * no second migration is ever needed.)
   */
  scheduleStart: string | null;
  scheduleEnd: string | null;
};

/**
 * The owner-approved DEFAULT slide: recreates TODAY'S static Shop banner look as
 * closely as an editable banner can — the eyebrow off, a bold white title
 * ("Shop the Menu"), and a soft-light subtitle. No background image by default
 * (today's banner is a gradient blob, not a photo), so it renders on the same
 * dark charcoal panel. This keeps the Shop page effectively unchanged until
 * staff pick a picture / edit the words and Publish.
 */
export function defaultShopHeroPresentation(): ShopHeroPresentation {
  return {
    image: "",
    imageMobile: "",
    imageFocus: "center",
    imageFocusMobile: "center",
    textAlign: "left",
    verticalAlign: "center",
    eyebrow: defaultBlock("Greenway Marijuana", "montserrat", "green", { show: false }),
    title: defaultBlock("Shop the Menu", "anton", "white"),
    subtitle: defaultBlock(
      "Browse our full selection with live prices and stock.",
      "montserrat",
      "muted",
    ),
    ctas: [],
    promotion: defaultShopSlidePromotion(),
    scheduleStart: null,
    scheduleEnd: null,
  };
}

// ── Normalize / serialize / parse ────────────────────────────────────────────

function cleanImage(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  return v.trim();
}

/** Coerce an ISO-ish schedule value to a trimmed string or null. */
function cleanSchedule(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

/**
 * Coerce an unknown object into a valid, complete ShopHeroPresentation. Missing
 * / malformed fields fall back to the default so a slide NEVER blanks.
 */
export function normalizeShopHeroPresentation(input: unknown): ShopHeroPresentation {
  const base = defaultShopHeroPresentation();
  if (!input || typeof input !== "object") return base;
  const obj = input as Record<string, unknown>;

  return {
    image: cleanImage(obj.image, base.image),
    imageMobile: cleanImage(obj.imageMobile, base.imageMobile),
    imageFocus: isImageFocus(obj.imageFocus) ? obj.imageFocus : base.imageFocus,
    imageFocusMobile: isImageFocus(obj.imageFocusMobile)
      ? obj.imageFocusMobile
      : base.imageFocusMobile,
    textAlign: isTextAlign(obj.textAlign) ? obj.textAlign : base.textAlign,
    verticalAlign: isTextVAlign(obj.verticalAlign) ? obj.verticalAlign : base.verticalAlign,
    eyebrow: normalizeBlock(obj.eyebrow, base.eyebrow),
    title: normalizeBlock(obj.title, base.title),
    subtitle: normalizeBlock(obj.subtitle, base.subtitle),
    ctas: normalizeCtas(obj.ctas),
    promotion: normalizeShopSlidePromotion(obj.promotion),
    scheduleStart: cleanSchedule(obj.scheduleStart),
    scheduleEnd: cleanSchedule(obj.scheduleEnd),
  };
}

function serializeBlock(b: HeroTextBlock): Record<string, unknown> {
  return { text: b.text, font: b.font, color: b.color, show: b.show, scriptScale: b.scriptScale };
}

/** Serialize to the stored JSON string (stable key order for clean diffs). */
export function serializeShopHeroPresentation(p: ShopHeroPresentation): string {
  const n = normalizeShopHeroPresentation(p);
  return JSON.stringify({
    image: n.image,
    imageMobile: n.imageMobile,
    imageFocus: n.imageFocus,
    imageFocusMobile: n.imageFocusMobile,
    textAlign: n.textAlign,
    verticalAlign: n.verticalAlign,
    eyebrow: serializeBlock(n.eyebrow),
    title: serializeBlock(n.title),
    subtitle: serializeBlock(n.subtitle),
    ctas: n.ctas,
    promotion: n.promotion,
    scheduleStart: n.scheduleStart,
    scheduleEnd: n.scheduleEnd,
  });
}

/**
 * Parse a stored JSON string. Returns null on missing/invalid JSON so callers
 * fall back to the default (never blank the banner).
 */
export function parseShopHeroPresentation(
  json: string | null | undefined,
): ShopHeroPresentation | null {
  if (!json || !json.trim()) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  return normalizeShopHeroPresentation(raw);
}

/**
 * Resolve the presentation to render: the parsed stored value when valid,
 * otherwise the default. This is what the store's render path calls per slide.
 */
export function resolveShopHeroPresentation(
  storedJson: string | null | undefined,
): ShopHeroPresentation {
  return parseShopHeroPresentation(storedJson) ?? defaultShopHeroPresentation();
}

// ── Schedule gate (value-add) ────────────────────────────────────────────────

/**
 * Is this slide live at the given instant, per its optional schedule window?
 * null bounds are open. Invalid dates are treated as "no bound" so a typo never
 * hides a slide forever. Pure so the store + tests agree.
 */
export function isSlideLiveAt(p: ShopHeroPresentation, whenMs: number): boolean {
  const startMs = p.scheduleStart ? Date.parse(p.scheduleStart) : NaN;
  const endMs = p.scheduleEnd ? Date.parse(p.scheduleEnd) : NaN;
  if (Number.isFinite(startMs) && whenMs < startMs) return false;
  if (Number.isFinite(endMs) && whenMs > endMs) return false;
  return true;
}

/** Does a presentation carry anything worth rendering (image or any shown text)? */
export function slideHasContent(p: ShopHeroPresentation): boolean {
  const anyText =
    (p.eyebrow.show && p.eyebrow.text.trim() !== "") ||
    (p.title.show && p.title.text.trim() !== "") ||
    (p.subtitle.show && p.subtitle.text.trim() !== "");
  return p.image.trim() !== "" || p.imageMobile.trim() !== "" || anyText;
}

// ── Sale-filter collection (SLICE B bridge → Slice C sidebar) ────────────────

/** The linked promotion id for a slide, or null. */
export function slideLinkedPromotionId(p: ShopHeroPresentation): string | null {
  return p.promotion.promotionId;
}

/**
 * The sidebar sale-filter label for a slide: the owner's chosen name, else the
 * supplied promotion title fallback, else a generic "Sale". Pure + trimmed.
 */
export function slideFilterName(p: ShopHeroPresentation, promotionTitle?: string | null): string {
  const chosen = p.promotion.filterName.trim();
  if (chosen) return chosen;
  const fromPromo = (promotionTitle ?? "").trim();
  return fromPromo || "Sale";
}

/** One resolved sale filter to render in the Shop sidebar. */
export type ShopSaleFilter = {
  /** Stable id (slug of the label) used as the checkbox key + URL token. */
  id: string;
  /** Display label on the checkbox. */
  name: string;
  /** The promotion this filter selects. */
  promotionId: string;
};

/**
 * From the live carousel slides (+ a promotion-id → title map for name
 * fallbacks), collect the dynamic sale filters to show in the Shop sidebar:
 * every slide that links a promotion AND opts into auto-filter. Deduped by
 * promotion id (first slide wins), capped at MAX_SHOP_CAROUSEL_SLIDES (10), in
 * slide order. Pure so the server + client + tests all agree.
 */
export function collectShopSaleFilters(
  slides: Array<{ presentation: ShopHeroPresentation }>,
  promotionTitles?: Record<string, string | null | undefined>,
): ShopSaleFilter[] {
  const out: ShopSaleFilter[] = [];
  const seenPromotions = new Set<string>();
  const seenIds = new Set<string>();
  for (const slide of slides) {
    const promo = slide.presentation.promotion;
    if (!promo.autoFilter || !promo.promotionId) continue;
    if (seenPromotions.has(promo.promotionId)) continue;
    const name = slideFilterName(slide.presentation, promotionTitles?.[promo.promotionId]);
    let id = slugifyShopFilter(name, promo.promotionId);
    // Guarantee a unique DOM/URL token even if two labels slug identically.
    if (seenIds.has(id)) id = `${id}-${seenPromotions.size + 1}`;
    seenPromotions.add(promo.promotionId);
    seenIds.add(id);
    out.push({ id, name, promotionId: promo.promotionId });
    if (out.length >= MAX_SHOP_CAROUSEL_SLIDES) break;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure self-tests (throw on failure). Registered in the pure-selftest runner.
// ─────────────────────────────────────────────────────────────────────────────
export function __runShopCarouselCoreTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`shop-carousel-core: ${msg}`);
    passed += 1;
  };

  ok(MAX_SHOP_CAROUSEL_SLIDES === 10, "cap is ten slides (owner request)");

  // Default recreates today's look (no photo; bold white title; muted subtitle).
  const def = defaultShopHeroPresentation();
  ok(def.image === "" && def.imageMobile === "", "default has no background photo");
  ok(def.textAlign === "left" && def.verticalAlign === "center", "default text left/middle");
  ok(def.eyebrow.show === false, "default eyebrow hidden");
  ok(def.title.text === "Shop the Menu" && def.title.color === "white" && def.title.font === "anton", "default title bold white");
  ok(def.subtitle.color === "muted" && def.subtitle.show, "default subtitle soft light");
  ok(def.ctas.length === 0, "default has no CTA buttons");
  ok(def.scheduleStart === null && def.scheduleEnd === null, "default always-on (no schedule)");
  ok(slideHasContent(def), "default slide has content");

  // CTA normalization: drop blanks, cap at two, default variant solid.
  const ctas = normalizeCtas([
    { href: "/menu", label: "Shop" },
    { href: "", label: "nope" },
    { href: "/specials", label: "Deals", variant: "outline" },
    { href: "/x", label: "Third" },
  ]);
  ok(ctas.length === 2, "CTAs capped at two");
  ok(ctas[0].variant === "solid", "CTA default variant is solid");
  ok(ctas[1].href === "/specials" && ctas[1].variant === "outline", "blank CTA dropped, outline kept");
  ok(normalizeCtas("nope").length === 0, "non-array CTAs -> empty");
  ok(isCtaVariant("outline") && !isCtaVariant("ghost"), "cta variant guard");

  // Normalize coerces bad data back to safe values (shared with loyalty rules).
  const norm = normalizeShopHeroPresentation({
    image: "  /shop/x.png  ",
    imageFocus: "nope",
    textAlign: "center",
    verticalAlign: "top",
    eyebrow: { text: "Hi", font: "bogus", color: "bogus", show: false, scriptScale: 99 },
    title: { text: 42 },
    subtitle: "not an object",
    ctas: [{ href: "/a", label: "A" }],
    scheduleStart: "  2026-08-01T00:00:00Z ",
    scheduleEnd: "",
  });
  ok(norm.image === "/shop/x.png", "image trimmed");
  ok(norm.imageFocus === "center", "bad image focus -> default center");
  ok(norm.textAlign === "center" && norm.verticalAlign === "top", "valid align applied");
  ok(norm.eyebrow.text === "Hi" && norm.eyebrow.show === false, "eyebrow text + show applied");
  ok(norm.eyebrow.font === def.eyebrow.font, "bad eyebrow font -> default");
  ok(norm.eyebrow.scriptScale === 2, "eyebrow script scale clamped to 2");
  ok(norm.title.text === def.title.text, "non-string title -> default");
  ok(norm.subtitle.text === def.subtitle.text, "non-object subtitle -> full default block");
  ok(norm.ctas.length === 1 && norm.ctas[0].href === "/a", "ctas normalized");
  ok(norm.scheduleStart === "2026-08-01T00:00:00Z", "schedule start trimmed");
  ok(norm.scheduleEnd === null, "empty schedule end -> null");

  // Serialize -> parse round-trip (including \n stacking + cursive + schedule + ctas).
  const custom = normalizeShopHeroPresentation({
    image: "/shop/a.png",
    imageMobile: "/shop/b.png",
    imageFocus: "right",
    imageFocusMobile: "top",
    textAlign: "right",
    verticalAlign: "bottom",
    eyebrow: { text: "Sale", font: "oswald", color: "orange", show: true, scriptScale: 1 },
    title: { text: "Big\nSale", font: "bebas", color: "gold", show: true, scriptScale: 1 },
    subtitle: { text: "This weekend only", font: "great-vibes", color: "green", show: true, scriptScale: 1.4 },
    ctas: [{ href: "/menu?special=weekend", label: "Shop the sale", variant: "solid" }],
    scheduleStart: "2026-08-01T00:00:00Z",
    scheduleEnd: "2026-08-03T23:59:59Z",
  });
  const json = serializeShopHeroPresentation(custom);
  const round = parseShopHeroPresentation(json)!;
  ok(round.image === "/shop/a.png" && round.imageMobile === "/shop/b.png", "round-trip keeps images");
  ok(round.imageFocus === "right" && round.imageFocusMobile === "top", "round-trip keeps focuses");
  ok(round.textAlign === "right" && round.verticalAlign === "bottom", "round-trip keeps align");
  ok(round.title.text === "Big\nSale", "round-trip keeps line breaks");
  ok(round.subtitle.font === "great-vibes" && round.subtitle.scriptScale === 1.4, "round-trip keeps cursive");
  ok(round.ctas.length === 1 && round.ctas[0].label === "Shop the sale", "round-trip keeps CTA");
  ok(round.scheduleStart === "2026-08-01T00:00:00Z" && round.scheduleEnd === "2026-08-03T23:59:59Z", "round-trip keeps schedule");

  // Bad JSON / empty -> null (caller falls back).
  ok(parseShopHeroPresentation("not json") === null, "bad JSON -> null");
  ok(parseShopHeroPresentation("") === null, "empty -> null");
  ok(parseShopHeroPresentation(null) === null, "null -> null");

  // resolve() never returns null; serialized default resolves back byte-identical.
  const resolvedDefault = resolveShopHeroPresentation(null);
  ok(resolvedDefault.title.text === def.title.text, "resolve(null) -> full default");
  const resolvedRound = resolveShopHeroPresentation(serializeShopHeroPresentation(def));
  ok(
    JSON.stringify(resolvedRound) === JSON.stringify(def),
    "serialized default resolves back to the default",
  );

  // Schedule gate.
  const scheduled = normalizeShopHeroPresentation({
    scheduleStart: "2026-08-01T00:00:00Z",
    scheduleEnd: "2026-08-03T00:00:00Z",
  });
  ok(!isSlideLiveAt(scheduled, Date.parse("2026-07-31T00:00:00Z")), "before window -> not live");
  ok(isSlideLiveAt(scheduled, Date.parse("2026-08-02T00:00:00Z")), "inside window -> live");
  ok(!isSlideLiveAt(scheduled, Date.parse("2026-08-04T00:00:00Z")), "after window -> not live");
  ok(isSlideLiveAt(def, Date.parse("2030-01-01T00:00:00Z")), "no schedule -> always live");
  const openStart = normalizeShopHeroPresentation({ scheduleEnd: "2026-08-03T00:00:00Z" });
  ok(isSlideLiveAt(openStart, Date.parse("2000-01-01T00:00:00Z")), "open start bound honored");
  const badDates = normalizeShopHeroPresentation({ scheduleStart: "not-a-date" });
  ok(isSlideLiveAt(badDates, Date.now()), "invalid start date treated as no bound");

  // slideHasContent.
  const blank = normalizeShopHeroPresentation({
    eyebrow: { text: "", show: false },
    title: { text: "", show: false },
    subtitle: { text: "", show: false },
  });
  ok(!slideHasContent(blank), "fully blank slide has no content");

  // ── Sale link + filter collection (SLICE B) ──────────────────────────────
  ok(def.promotion.promotionId === null && def.promotion.autoFilter === false, "default links no sale");

  // autoFilter requires a promotion id (a filter with no sale is meaningless).
  const noLink = normalizeShopSlidePromotion({ autoFilter: true, filterName: "50% Off" });
  ok(noLink.autoFilter === false, "autoFilter without a promotion id is dropped");
  const linked = normalizeShopSlidePromotion({ promotionId: " p1 ", autoFilter: true, filterName: "  50% Off  " });
  ok(linked.promotionId === "p1" && linked.autoFilter === true, "linked+auto kept; id trimmed");
  ok(linked.filterName === "50% Off", "filter name trimmed");
  const longName = normalizeShopSlidePromotion({ promotionId: "p", filterName: "x".repeat(80) });
  ok(longName.filterName.length === 40, "filter name capped at 40 chars");

  // Promotion field survives the presentation round-trip.
  const withSale = normalizeShopHeroPresentation({
    promotion: { promotionId: "promo-9", filterName: "Weekend Blowout", autoFilter: true },
  });
  const saleRound = resolveShopHeroPresentation(serializeShopHeroPresentation(withSale));
  ok(saleRound.promotion.promotionId === "promo-9" && saleRound.promotion.autoFilter, "sale link round-trips");

  // slugify.
  ok(slugifyShopFilter("50% Off!", "x") === "50-off", "slug lowercases + hyphenates");
  ok(slugifyShopFilter("!!!", "abc") === "sale-abc", "slug falls back when empty");

  // slideFilterName fallback chain: chosen name → promo title → "Sale".
  const namedSlide = normalizeShopHeroPresentation({ promotion: { promotionId: "p", filterName: "Doorbuster", autoFilter: true } });
  ok(slideFilterName(namedSlide, "Ignored Title") === "Doorbuster", "chosen name wins");
  const unnamedSlide = normalizeShopHeroPresentation({ promotion: { promotionId: "p", filterName: "", autoFilter: true } });
  ok(slideFilterName(unnamedSlide, "Promo Title") === "Promo Title", "falls back to promo title");
  ok(slideFilterName(unnamedSlide, null) === "Sale", "falls back to generic Sale");

  // collectShopSaleFilters: only auto+linked slides, deduped by promotion, capped, in order.
  const mk = (promotionId: string | null, autoFilter: boolean, filterName = "") =>
    ({ presentation: normalizeShopHeroPresentation({ promotion: { promotionId, autoFilter, filterName } }) });
  const collected = collectShopSaleFilters(
    [
      mk("a", true, "Alpha"),
      mk("b", false, "Bravo"), // not auto → skipped
      mk(null, true, "Nope"), // no promo → skipped
      mk("a", true, "Alpha again"), // dup promo → skipped
      mk("c", true, ""), // uses title fallback
    ],
    { c: "Charlie Sale" },
  );
  ok(collected.length === 2, "collect keeps only distinct auto-linked sales");
  ok(collected[0].id === "alpha" && collected[0].promotionId === "a", "first filter alpha");
  ok(collected[1].name === "Charlie Sale", "unnamed uses promo-title fallback");
  // Duplicate labels → unique ids.
  const dupNames = collectShopSaleFilters([mk("x", true, "Sale"), mk("y", true, "Sale")]);
  ok(dupNames.length === 2 && dupNames[0].id !== dupNames[1].id, "duplicate labels get unique ids");
  // Cap at ten even with more linked slides.
  const many = Array.from({ length: 14 }, (_, i) => mk(`p${i}`, true, `F${i}`));
  ok(collectShopSaleFilters(many).length === MAX_SHOP_CAROUSEL_SLIDES, "collect caps at ten filters");

  return { passed };
}
