/**
 * src/lib/cms/type-cards-core.ts
 *
 * R41 S3 — Home "Shop by Category" Type Cards: rename, add, delete, reorder,
 * relink, per-card image and "Shop now →" line.
 *
 * Pure and dependency-light (imports only other pure cores) because it is used
 * by the client editor, the server action AND the public home render.
 *
 * Storage: page_sections(home.category).settings.typeCards — an array of
 * TypeCard (≤ 12). When the key is ABSENT the six original lanes render
 * (byte-identical to the site as shipped, images still taken from the legacy
 * settings.laneImages map). When it is an EMPTY array the owner deleted every
 * card and the tile grid hides.
 */
import { checkHref } from "@/lib/cms/link-target-core";
import { normalizeDesign, type BannerDesign } from "@/lib/cms/banner-design-core";
import {
  IMAGE_FOCUSES,
  isHeroColor,
  isHeroFont,
  isImageFocus,
  type ImageFocus,
} from "@/lib/loyalty/loyalty-hero-core";

export { IMAGE_FOCUSES };

/** R47: how the name sits on the card. */
export const TYPE_CARD_TEXT_STYLES = ["bar", "overlay", "hidden"] as const;
export type TypeCardTextStyle = (typeof TYPE_CARD_TEXT_STYLES)[number];

/**
 * R47 (owner: "advanced features for the category cards"). Every field is
 * optional; a card with no advanced settings stores NO `adv` key at all, so
 * saved lists and the public tile stay byte-identical to R41.
 */
export type TypeCardAdvanced = {
  /** Separate phone picture / video ("" = use the main one). */
  imageMobile?: string;
  /** Picture focus (5-way). Absent = centre (the classic object-cover). */
  imageFocus?: ImageFocus;
  imageFocusMobile?: ImageFocus;
  /** Picture zoom 100–200 (%). */
  zoom?: number;
  /** Darken the picture 0–80 (%), for legibility. */
  dim?: number;
  /** Hero font id for the card name (HERO_FONTS). */
  labelFont?: string;
  /** Hero colour ids for the name and the small line. */
  labelColor?: string;
  ctaColor?: string;
  /** "bar" (classic bottom bar) | "overlay" (text on the picture) | "hidden". */
  textStyle?: TypeCardTextStyle;
  /** Open the link in a new tab. */
  newTab?: boolean;
  /** Optional show window (ISO). */
  scheduleStart?: string;
  scheduleEnd?: string;
  /**
   * R61-S3: the owner's custom CARD design (the shared Banner Studio, card
   * frame). Stored even when switched off (so ticking it again restores it);
   * the public tile uses it only when `enabled`.
   */
  design?: BannerDesign;
};

export const TYPE_CARDS_KEY = "typeCards";
export const MAX_TYPE_CARDS = 12;
export const MAX_TYPE_CARD_LABEL = 40;
export const MAX_TYPE_CARD_CTA = 30;
export const MAX_TYPE_CARD_IMAGE = 600;
export const DEFAULT_TYPE_CARD_CTA = "Shop now →";
/** Where a card goes when its link is blank or unsafe (a card must link). */
export const TYPE_CARD_FALLBACK_HREF = "/menu";

export type TypeCard = {
  /** Stable id; the six defaults use their lane key (flower, prerolls, …). */
  id: string;
  /** Card name; one "\n" allowed (two lines max). */
  label: string;
  href: string;
  /** "" = clean text-only tile. */
  image: string;
  /** Small line under the name. */
  cta: string;
  enabled: boolean;
  /** R47: optional advanced look (absent = classic tile). */
  adv?: TypeCardAdvanced;
};

/**
 * COPY of the six lanes in src/lib/specials/daily-deal-presentation.ts
 * (`laneDefinitions` / `categoryLanes`). Copied rather than imported so this
 * core stays free of the specials module graph; the vitest drift guard
 * tests/compliance/r41-type-cards.test.ts fails if the two ever disagree.
 */
export const DEFAULT_TYPE_LANES: { key: string; label: string; href: string }[] = [
  { key: "flower", label: "Flower", href: "/menu?categories=flower,popcorn-bud,infused-flower" },
  {
    key: "prerolls",
    label: "Prerolls",
    href: "/menu?categories=preroll,blunt,preroll-pack,infused-preroll,infused-blunt,infused-preroll-pack",
  },
  { key: "concentrates", label: "Concentrates", href: "/menu?categories=concentrate,rso" },
  { key: "edibles", label: "Edibles", href: "/menu?categories=edible-solid" },
  { key: "liquids", label: "Liquids", href: "/menu?categories=edible-liquid,tincture" },
  { key: "topicals", label: "Topicals", href: "/menu?categories=topical" },
];

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** The six original cards, with any legacy lane images carried in. */
export function defaultTypeCards(
  laneImages?: Partial<Record<string, string>> | null,
): TypeCard[] {
  return DEFAULT_TYPE_LANES.map((lane) => ({
    id: lane.key,
    label: lane.label,
    href: lane.href,
    image: cleanImage(laneImages?.[lane.key]),
    cta: DEFAULT_TYPE_CARD_CTA,
    enabled: true,
  }));
}

/** Trim, normalize CRLF, keep at most one line break, clamp length. */
export function cleanLabel(v: unknown): string {
  if (typeof v !== "string") return "";
  const lines = v
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);
  const two = lines.length > 2 ? [lines[0], lines.slice(1).join(" ")] : lines;
  return two.join("\n").slice(0, MAX_TYPE_CARD_LABEL).trim();
}

function cleanCta(v: unknown): string {
  if (typeof v !== "string") return DEFAULT_TYPE_CARD_CTA;
  // Single line; "" is allowed (owner removed the line).
  return v.replace(/\s+/g, " ").trim().slice(0, MAX_TYPE_CARD_CTA);
}

/** Image path/URL or "": only site paths ("/…" not "//…") and http(s) URLs. */
export function cleanImage(v: unknown): string {
  if (typeof v !== "string") return "";
  const s = v.trim();
  if (!s || s.length > MAX_TYPE_CARD_IMAGE) return "";
  if (s.startsWith("/") && !s.startsWith("//") && !s.includes("\\")) return s;
  if (/^https?:\/\/[^\s"'<>]+$/i.test(s)) return s;
  return "";
}

function cleanIso(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t && Number.isFinite(Date.parse(t)) ? t : undefined;
}

function clampInt(v: unknown, lo: number, hi: number): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/**
 * R47: normalize the optional advanced block. Default values are DROPPED, and
 * an all-default block returns undefined (so no `adv` key is stored).
 */
export function normalizeTypeCardAdvanced(raw: unknown): TypeCardAdvanced | undefined {
  if (!isObj(raw)) return undefined;
  const out: TypeCardAdvanced = {};
  const im = cleanImage(raw.imageMobile);
  if (im) out.imageMobile = im;
  if (isImageFocus(raw.imageFocus) && raw.imageFocus !== "center") out.imageFocus = raw.imageFocus;
  if (isImageFocus(raw.imageFocusMobile)) out.imageFocusMobile = raw.imageFocusMobile;
  const zoom = clampInt(raw.zoom, 100, 200);
  if (zoom !== undefined && zoom !== 100) out.zoom = zoom;
  const dim = clampInt(raw.dim, 0, 80);
  if (dim !== undefined && dim !== 0) out.dim = dim;
  if (isHeroFont(raw.labelFont)) out.labelFont = raw.labelFont as string;
  if (isHeroColor(raw.labelColor)) out.labelColor = raw.labelColor as string;
  if (isHeroColor(raw.ctaColor)) out.ctaColor = raw.ctaColor as string;
  if (raw.textStyle === "overlay" || raw.textStyle === "hidden") out.textStyle = raw.textStyle;
  if (raw.newTab === true) out.newTab = true;
  const ss = cleanIso(raw.scheduleStart);
  if (ss) out.scheduleStart = ss;
  const se = cleanIso(raw.scheduleEnd);
  if (se) out.scheduleEnd = se;
  const design = normalizeDesign(raw.design);
  if (design && design.frame.card) out.design = design;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** R47: is the card inside its optional show window? Bad / absent dates = open. */
export function isTypeCardLiveAt(card: TypeCard, whenMs: number): boolean {
  const a = card.adv;
  if (!a) return true;
  const s = a.scheduleStart ? Date.parse(a.scheduleStart) : NaN;
  const e = a.scheduleEnd ? Date.parse(a.scheduleEnd) : NaN;
  if (Number.isFinite(s) && whenMs < s) return false;
  if (Number.isFinite(e) && whenMs > e) return false;
  return true;
}

/** A card must link somewhere safe; blank or blocked → /menu. */
export function cleanCardHref(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return TYPE_CARD_FALLBACK_HREF;
  return checkHref(s).level === "block" ? TYPE_CARD_FALLBACK_HREF : s;
}

function cleanId(v: unknown): string {
  if (typeof v !== "string") return "";
  return v
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Normalize any raw value into a safe list (≤ 12, unique ids). */
export function normalizeTypeCards(raw: unknown): TypeCard[] {
  if (!Array.isArray(raw)) return [];
  const out: TypeCard[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_TYPE_CARDS) break;
    if (!isObj(item)) continue;
    const label = cleanLabel(item.label) || "New card";
    let id = cleanId(item.id) || cleanId(label) || "card";
    if (seen.has(id)) {
      let n = 2;
      while (seen.has(`${id}-${n}`)) n++;
      id = `${id}-${n}`;
    }
    seen.add(id);
    out.push({
      id,
      label,
      href: cleanCardHref(item.href),
      image: cleanImage(item.image),
      cta: "cta" in item ? cleanCta(item.cta) : DEFAULT_TYPE_CARD_CTA,
      enabled: item.enabled !== false,
    });
    const adv = normalizeTypeCardAdvanced(item.adv);
    if (adv) out[out.length - 1].adv = adv;
  }
  return out;
}

/** True when the owner has saved a custom card list (key present). */
export function hasCustomTypeCards(
  settings: Record<string, unknown> | null | undefined,
): boolean {
  return isObj(settings) && Array.isArray(settings[TYPE_CARDS_KEY]);
}

/**
 * The card list to edit/render. Custom list when saved (may be empty), else
 * the six defaults with legacy `laneImages` carried in.
 */
export function readTypeCards(
  settings: Record<string, unknown> | null | undefined,
): TypeCard[] {
  if (hasCustomTypeCards(settings)) {
    return normalizeTypeCards((settings as Record<string, unknown>)[TYPE_CARDS_KEY]);
  }
  const li = isObj(settings) && isObj(settings.laneImages) ? settings.laneImages : {};
  const images: Record<string, string> = {};
  for (const [k, v] of Object.entries(li)) if (typeof v === "string") images[k] = v;
  return defaultTypeCards(images);
}

/**
 * Cards that actually show on the live site. R47: a card outside its optional
 * show window is hidden too (pass `whenMs`; omitted = ignore the window).
 */
export function visibleTypeCards(cards: TypeCard[], whenMs?: number): TypeCard[] {
  return cards.filter((c) => c.enabled && (whenMs === undefined || isTypeCardLiveAt(c, whenMs)));
}

/**
 * R47: drop cards outside their optional show window (visitors only). Staff
 * preview passes `preview=true` so every enabled card stays visible.
 * Reads the clock here (not in a component) so render stays pure.
 */
export function hideOutOfWindowTypeCards(
  cards: TypeCard[],
  preview: boolean,
  nowMs: number = Date.now(),
): TypeCard[] {
  return preview ? cards : cards.filter((c) => isTypeCardLiveAt(c, nowMs));
}

/**
 * The legacy laneImages map mirrored from a card list (default ids only), so
 * anything still reading settings.laneImages keeps working.
 */
export function laneImagesFromCards(cards: TypeCard[]): Record<string, string> {
  const out: Record<string, string> = {};
  const keys = new Set(DEFAULT_TYPE_LANES.map((l) => l.key));
  for (const c of cards) if (keys.has(c.id) && c.image) out[c.id] = c.image;
  return out;
}

/** New settings object with the card list written; sibling keys preserved. */
export function writeTypeCards(
  settings: Record<string, unknown> | null | undefined,
  cards: unknown,
): Record<string, unknown> {
  const base: Record<string, unknown> = isObj(settings) ? { ...settings } : {};
  const list = normalizeTypeCards(cards);
  base[TYPE_CARDS_KEY] = list;
  const li = laneImagesFromCards(list);
  if (Object.keys(li).length > 0) base.laneImages = li;
  else delete base.laneImages;
  return base;
}

/** Fresh id for a newly added card that won't collide with existing ones. */
export function nextTypeCardId(cards: TypeCard[]): string {
  const ids = new Set(cards.map((c) => c.id));
  let n = cards.length + 1;
  while (ids.has(`card-${n}`)) n++;
  return `card-${n}`;
}

/**
 * Tailwind classes for the grid at a given card count. Class names must be
 * literal strings (Tailwind v4 scans source; dynamic names are never
 * generated). Six cards = EXACTLY the class string the site shipped with.
 */
export function typeCardGridClass(count: number): string {
  const base = "grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4";
  switch (count) {
    case 1:
      return "grid grid-cols-1 gap-3 md:grid-cols-1 md:gap-4 lg:grid-cols-1";
    case 2:
      return "grid grid-cols-2 gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-2";
    case 3:
      return `${base} lg:grid-cols-3`;
    case 4:
      return "grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4 lg:grid-cols-4";
    case 5:
      return `${base} lg:grid-cols-5`;
    default:
      return `${base} lg:grid-cols-6`;
  }
}

// ---------------------------------------------------------------------------
// Self-tests (scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runTypeCardsTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`[type-cards-core] FAIL: ${msg}`);
    }
  };

  const d = defaultTypeCards();
  ok(d.length === 6, "six defaults");
  ok(d.map((c) => c.id).join() === "flower,prerolls,concentrates,edibles,liquids,topicals", "default order");
  ok(d.every((c) => c.cta === DEFAULT_TYPE_CARD_CTA && c.enabled && c.image === ""), "default shape");
  ok(d[4].label === "Liquids" && d[4].href === "/menu?categories=edible-liquid,tincture", "liquids lane");

  const withImg = readTypeCards({ laneImages: { flower: "/img/f.webp", bogus: "/x.webp" } });
  ok(withImg.length === 6 && withImg[0].image === "/img/f.webp", "legacy laneImages carried");
  ok(withImg[1].image === "", "unset lane image blank");
  ok(readTypeCards(null).length === 6, "null settings -> defaults");
  ok(readTypeCards({ typeCards: "nope" }).length === 6, "non-array -> defaults");
  ok(readTypeCards({ typeCards: [] }).length === 0, "empty array respected (owner deleted all)");
  ok(hasCustomTypeCards({ typeCards: [] }) && !hasCustomTypeCards({}), "hasCustom");

  const many = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, label: `C${i}`, href: "/menu" }));
  ok(normalizeTypeCards(many).length === MAX_TYPE_CARDS, "cap at 12");

  const dup = normalizeTypeCards([
    { id: "flower", label: "A", href: "/menu" },
    { id: "flower", label: "B", href: "/menu" },
    { id: "flower", label: "C", href: "/menu" },
  ]);
  ok(dup.map((c) => c.id).join() === "flower,flower-2,flower-3", "id de-dupe");

  const js = normalizeTypeCards([{ id: "x", label: "X", href: "javascript:alert(1)" }]);
  ok(js[0].href === TYPE_CARD_FALLBACK_HREF, "javascript: href -> /menu");
  ok(normalizeTypeCards([{ id: "x", label: "X", href: "" }])[0].href === "/menu", "blank href -> /menu");
  ok(
    normalizeTypeCards([{ id: "x", label: "X", href: "/menu?categories=flower&strainTypes=indica" }])[0].href ===
      "/menu?categories=flower&strainTypes=indica",
    "filtered menu href kept",
  );
  ok(normalizeTypeCards([{ id: "x", label: "X", href: "/blog/abc" }])[0].href === "/blog/abc", "blog href kept");

  ok(cleanLabel("  Drinks  ") === "Drinks", "label trimmed");
  ok(cleanLabel("Top\r\nShelf") === "Top\nShelf", "CRLF -> one newline kept");
  ok(cleanLabel("a\nb\nc") === "a\nb c", "max two lines");
  ok(cleanLabel("x".repeat(80)).length === MAX_TYPE_CARD_LABEL, "label clamp");
  ok(normalizeTypeCards([{ id: "x", label: "   " }])[0].label === "New card", "blank label -> New card");
  ok(normalizeTypeCards([{ id: "x", label: "X", cta: "" }])[0].cta === "", "empty cta allowed");
  ok(normalizeTypeCards([{ id: "x", label: "X" }])[0].cta === DEFAULT_TYPE_CARD_CTA, "missing cta -> default");
  ok(normalizeTypeCards([{ id: "x", label: "X", enabled: false }])[0].enabled === false, "hidden kept");
  ok(normalizeTypeCards([{ label: "Big Deals!" }])[0].id === "big-deals", "id from label");
  ok(normalizeTypeCards([null, 3, "s", { label: "Ok" }]).length === 1, "junk rows dropped");

  ok(cleanImage("/media/a.webp") === "/media/a.webp", "site image ok");
  ok(cleanImage("https://cdn.x.com/a.png") === "https://cdn.x.com/a.png", "https image ok");
  ok(cleanImage("javascript:alert(1)") === "", "js image dropped");
  ok(cleanImage("//evil.com/a.png") === "", "protocol-relative dropped");
  ok(cleanImage('https://x.com/a.png" onerror="x') === "", "quote injection dropped");

  const w = writeTypeCards({ lanes: "category", cardCount: 8, laneImages: { flower: "/old.webp" } }, [
    { id: "flower", label: "Flower", href: "/menu", image: "/new.webp" },
    { id: "card-7", label: "Drinks", href: "/menu", image: "/d.webp" },
  ]);
  ok(w.lanes === "category" && w.cardCount === 8, "write preserves siblings");
  ok(Array.isArray(w.typeCards) && (w.typeCards as TypeCard[]).length === 2, "write sets list");
  ok(JSON.stringify(w.laneImages) === JSON.stringify({ flower: "/new.webp" }), "laneImages mirrored (default ids only)");
  const w2 = writeTypeCards({ laneImages: { flower: "/old.webp" } }, []);
  ok(!("laneImages" in w2) && (w2.typeCards as unknown[]).length === 0, "empty list clears mirror");
  const orig = { lanes: "x" };
  writeTypeCards(orig, []);
  ok(!("typeCards" in orig), "write does not mutate input");

  ok(nextTypeCardId(d) === "card-7", "next id");
  ok(nextTypeCardId([...d, { ...d[0], id: "card-7" }]) === "card-8", "next id skips taken");
  ok(visibleTypeCards([{ ...d[0], enabled: false }, d[1]]).length === 1, "visible filter");

  ok(
    typeCardGridClass(6) === "grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-6",
    "six = shipped class string",
  );
  ok(typeCardGridClass(9).endsWith("lg:grid-cols-6"), ">6 wraps at 6");
  ok(typeCardGridClass(4).includes("lg:grid-cols-4"), "four columns");

  // R61-S3: card design (only card-shaped designs are kept)
  {
    const cd = { v: 1, enabled: true, frame: { height: 200, heightMobile: 160, radius: 16, card: { ratio: 0.75, ratioMobile: 1 } }, boxes: [], buttons: [] };
    const kept = normalizeTypeCards([{ id: "x", label: "X", adv: { design: cd } }])[0].adv;
    ok(!!kept?.design?.enabled && kept.design.frame.card?.ratioMobile === 1, "R61 card design kept");
    ok(!normalizeTypeCards([{ id: "x", label: "X", adv: { design: { ...cd, frame: { height: 200 } } } }])[0].adv, "R61 non-card design dropped");
  }
  // R47: advanced options
  ok(!("adv" in normalizeTypeCards([{ id: "x", label: "X" }])[0]), "no adv key by default");
  ok(!("adv" in normalizeTypeCards([{ id: "x", label: "X", adv: { zoom: 100, dim: 0, imageFocus: "center" } }])[0]), "all-default adv dropped");
  const av = normalizeTypeCards([
    {
      id: "x",
      label: "X",
      adv: {
        imageMobile: "/media/p.mp4",
        imageFocus: "top",
        imageFocusMobile: "left",
        zoom: 999,
        dim: -5,
        labelFont: "nope",
        textStyle: "overlay",
        newTab: true,
        scheduleStart: "2026-01-01T00:00:00Z",
        scheduleEnd: "garbage",
      },
    },
  ])[0].adv;
  ok(!!av && av.imageMobile === "/media/p.mp4" && av.imageFocus === "top" && av.imageFocusMobile === "left", "adv picture + focus kept");
  ok(!!av && av.zoom === 200 && av.dim === undefined, "zoom clamped, dim 0 dropped");
  ok(!!av && av.labelFont === undefined && av.textStyle === "overlay" && av.newTab === true, "bad font dropped, style kept");
  ok(!!av && av.scheduleStart === "2026-01-01T00:00:00Z" && av.scheduleEnd === undefined, "schedule cleaned");
  ok(normalizeTypeCardAdvanced({ imageMobile: "javascript:x" }) === undefined, "unsafe phone picture dropped");
  const sc: TypeCard = { ...d[0], adv: { scheduleStart: "2026-06-01T00:00:00Z", scheduleEnd: "2026-06-30T00:00:00Z" } };
  ok(!isTypeCardLiveAt(sc, Date.parse("2026-05-31T00:00:00Z")), "before window hidden");
  ok(isTypeCardLiveAt(sc, Date.parse("2026-06-10T00:00:00Z")), "inside window shown");
  ok(!isTypeCardLiveAt(sc, Date.parse("2026-07-01T00:00:00Z")), "after window hidden");
  ok(visibleTypeCards([sc], Date.parse("2026-07-01T00:00:00Z")).length === 0, "visible honours window");
  ok(visibleTypeCards([sc]).length === 1, "visible without time ignores window");

  return { passed, failed };
}
