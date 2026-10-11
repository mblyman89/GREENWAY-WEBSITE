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

/** Cards that actually show on the live site. */
export function visibleTypeCards(cards: TypeCard[]): TypeCard[] {
  return cards.filter((c) => c.enabled);
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

  return { passed, failed };
}
