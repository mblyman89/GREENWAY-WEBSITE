/**
 * R73 S3 - the greenwaymerch.com editable content, ONE source of truth.
 *
 * Imported by BOTH apps (no imports here on purpose, so either build can use it):
 *   - the cannabis admin seeds these as content_blocks rows and edits them in
 *     Website -> Merchandise (Header & Footer, Banners, Product cards, Order
 *     emails) with the same draft -> publish -> revision machinery;
 *   - greenwaymerch.com reads the PUBLISHED values from the cannabis site's
 *     read-only /api/merch-content endpoint and falls back to these defaults.
 *
 * Every default below is byte-identical to the copy the merch site rendered
 * before R73 S3, so seeding changes nothing until the owner publishes an edit.
 * Banner images default BLANK = no banner (exactly today's pages).
 * Legal lines (seller name, dba, country, WA-only notice, "card NOT charged")
 * stay fixed in code on purpose - they are never editable.
 */

export type MerchFieldType = "plain" | "url" | "image";

export interface MerchBlockDef {
  key: string;
  /** content_blocks.page - one per admin editor. */
  page: MerchSitePage;
  section: string;
  label: string;
  help: string;
  type: MerchFieldType;
  defaultValue: string;
}

export const MERCH_SITE_PAGES = ["merch-header-footer", "merch-banners", "merch-cards", "merch-emails"] as const;
export type MerchSitePage = (typeof MERCH_SITE_PAGES)[number];

/** The merch catalogue slugs + labels (mirrors catalog-core MERCH_CATEGORIES; parity-tested there). */
export const MERCH_BANNER_CATEGORIES: readonly { slug: string; label: string }[] = [
  { slug: "tees", label: "Tees" },
  { slug: "long-sleeves", label: "Long Sleeves" },
  { slug: "hoodies", label: "Hoodies" },
  { slug: "sweatshirts", label: "Sweatshirts" },
  { slug: "zip-hoodies", label: "Zip Hoodies" },
  { slug: "jackets", label: "Jackets" },
  { slug: "hats", label: "Hats" },
  { slug: "beanies", label: "Beanies" },
];

/** Category blurbs before S3 (mirrors catalog-core; parity-tested there). */
const CATEGORY_BLURBS: Readonly<Record<string, string>> = {
  tees: "Heavyweight and everyday tees, printed to order.",
  "long-sleeves": "Garment-dyed long sleeves for in-between weather.",
  hoodies: "Heavyweight pullover hoodies for cold Washington mornings.",
  sweatshirts: "Classic garment-dyed crewneck sweatshirts.",
  "zip-hoodies": "Full-zip hoodies you can layer over anything.",
  jackets: "Lightweight zip windbreakers.",
  hats: "Snapbacks, dad hats and truckers with embroidered logos.",
  beanies: "Cuffed knit beanies, embroidered.",
};

const HF = "merch-header-footer" as const;
const BN = "merch-banners" as const;
const CD = "merch-cards" as const;
const EM = "merch-emails" as const;

const bannerDefs = (scope: string, where: string, section: string): MerchBlockDef[] => [
  { key: `merch.banner.${scope}.image`, page: BN, section, label: `${where} banner - desktop image`, help: "Attach a finished banner from Digital Assets (tip: make it in Branding -> Brand hub and save it to the Merch folder). Leave blank for no banner.", type: "image", defaultValue: "" },
  { key: `merch.banner.${scope}.image_mobile`, page: BN, section, label: `${where} banner - phone image`, help: "Optional taller version for phones. Blank = the desktop image is used on phones too.", type: "image", defaultValue: "" },
  { key: `merch.banner.${scope}.alt`, page: BN, section, label: `${where} banner - description`, help: "Describe the banner for screen readers and Google (e.g. \"New fall hoodies\"). Put any words that are IN the picture here too.", type: "plain", defaultValue: "" },
  { key: `merch.banner.${scope}.link`, page: BN, section, label: `${where} banner - link (optional)`, help: "Where a click on the banner goes - a page on greenwaymerch.com like /hoodies, or a full https:// address. Blank = not clickable.", type: "url", defaultValue: "" },
];

export const MERCH_SITE_BLOCKS: readonly MerchBlockDef[] = [
  // ---- Header & Footer -----------------------------------------------------
  { key: "merch.header.announcement", page: HF, section: "topbar", label: "Top bar - announcement text", help: "A thin message bar above the header on every page (e.g. \"Free shipping over $75\"). Leave blank to hide the bar.", type: "plain", defaultValue: "" },
  { key: "merch.header.announcement_link", page: HF, section: "topbar", label: "Top bar - announcement link (optional)", help: "Where the announcement goes when clicked - a page like /hoodies or a full https:// address. Blank = plain text.", type: "url", defaultValue: "" },
  { key: "merch.header.wordmark", page: HF, section: "header", label: "Header - wordmark (white part)", help: "The first word of the text logo in the header and footer.", type: "plain", defaultValue: "Greenway" },
  { key: "merch.header.wordmark_accent", page: HF, section: "header", label: "Header - wordmark (green part)", help: "The green word after it.", type: "plain", defaultValue: "Merch" },
  { key: "merch.header.tagline", page: HF, section: "header", label: "Header - small line under the logo", help: "The tiny line under the wordmark.", type: "plain", defaultValue: "Greenway Glass & Goods" },
  { key: "merch.header.shop_label", page: HF, section: "header", label: "Header - Shop button text", help: "The text on the header's Shop button.", type: "plain", defaultValue: "Shop" },
  { key: "merch.header.cart_label", page: HF, section: "header", label: "Header - Cart button text", help: "The text on the green cart button.", type: "plain", defaultValue: "Cart" },
  { key: "merch.footer.note", page: HF, section: "footer", label: "Footer - product note", help: "The line about what the store sells. Keep it clear that no cannabis is sold here.", type: "plain", defaultValue: "Apparel and accessories only. This store does not sell cannabis or any cannabis product." },
  { key: "merch.footer.social.instagram.url", page: HF, section: "follow", label: "Footer - Instagram link", help: "Full https:// address. Blank = no Instagram button.", type: "url", defaultValue: "" },
  { key: "merch.footer.social.facebook.url", page: HF, section: "follow", label: "Footer - Facebook link", help: "Full https:// address. Blank = no Facebook button.", type: "url", defaultValue: "" },
  { key: "merch.footer.social.tiktok.url", page: HF, section: "follow", label: "Footer - TikTok link", help: "Full https:// address. Blank = no TikTok button.", type: "url", defaultValue: "" },

  // ---- Banners (attach finished art) ---------------------------------------
  ...bannerDefs("home", "Home page", "home"),
  ...MERCH_BANNER_CATEGORIES.flatMap((c) => bannerDefs(c.slug, `${c.label} catalogue`, `catalog-${c.slug}`)),

  // ---- Product + category cards --------------------------------------------
  { key: "merch.card.brand", page: CD, section: "product", label: "Product card - top line", help: "The bold line at the top of every product card.", type: "plain", defaultValue: "Greenway" },
  { key: "merch.card.cta", page: CD, section: "product", label: "Product card - button text", help: "The button on an in-stock product card.", type: "plain", defaultValue: "Choose options" },
  { key: "merch.card.cta_soldout", page: CD, section: "product", label: "Product card - button text when sold out", help: "The button when every option is sold out.", type: "plain", defaultValue: "View" },
  { key: "merch.card.soldout_badge", page: CD, section: "product", label: "Product card - sold-out badge", help: "The small badge on the picture when sold out.", type: "plain", defaultValue: "Sold out" },
  { key: "merch.card.category_cta", page: CD, section: "category", label: "Category card - button word", help: "The word before the category name on category-card buttons (\"Shop\" -> \"Shop Hoodies ->\").", type: "plain", defaultValue: "Shop" },
  ...MERCH_BANNER_CATEGORIES.flatMap((c): MerchBlockDef[] => [
    { key: `merch.card.category.${c.slug}.image`, page: CD, section: `category-${c.slug}`, label: `${c.label} card - picture`, help: "Blank = the standard blank-garment photo.", type: "image", defaultValue: "" },
    { key: `merch.card.category.${c.slug}.blurb`, page: CD, section: `category-${c.slug}`, label: `${c.label} card - description`, help: "The short line on the card (also the catalogue page's Google description).", type: "plain", defaultValue: CATEGORY_BLURBS[c.slug] ?? "" },
  ]),

  // ---- Customer order emails -----------------------------------------------
  { key: "merch.email.shipped.subject", page: EM, section: "shipped", label: "Shipped email - subject", help: "Use {order} for the order number.", type: "plain", defaultValue: "Your Greenway Merch order {order} has shipped" },
  { key: "merch.email.shipped.note", page: EM, section: "shipped", label: "Shipped email - extra note", help: "The line after the tracking details. Blank = left out.", type: "plain", defaultValue: "If your order had several items, they may arrive in separate packages." },
  { key: "merch.email.cancelled.subject", page: EM, section: "cancelled", label: "Out-of-state cancel email - subject", help: "Sent when an order ships outside Washington and is cancelled automatically. Use {order} and {site}.", type: "plain", defaultValue: "Your {site} order {order} was cancelled (Washington only)" },
  { key: "merch.email.signoff", page: EM, section: "common", label: "All emails - sign-off", help: "The last line of every customer email. Use {site} for the store name.", type: "plain", defaultValue: "- {site}" },
];

export const MERCH_BLOCK_KEYS: ReadonlySet<string> = new Set(MERCH_SITE_BLOCKS.map((b) => b.key));
const DEFAULTS = new Map(MERCH_SITE_BLOCKS.map((b) => [b.key, b.defaultValue] as const));
const TYPES = new Map(MERCH_SITE_BLOCKS.map((b) => [b.key, b.type] as const));

export type MerchContent = Readonly<Record<string, string>>;

const SAFE_IMAGE = /^https:\/\/[^\s"'<>]+$/i;
/** Site-relative path (/hoodies) or an absolute https:// URL; nothing else. */
const SAFE_LINK = /^(\/(?!\/)[^\s"'<>]*|https:\/\/[^\s"'<>]+)$/i;

/** Clean one published value: unknown keys dropped, unsafe URLs blanked, length-capped. */
export function cleanMerchValue(key: string, raw: unknown): string | null {
  const type = TYPES.get(key);
  if (!type || typeof raw !== "string") return null;
  const v = raw.trim().slice(0, type === "plain" ? 600 : 2000);
  if (!v) return "";
  if (type === "image") return SAFE_IMAGE.test(v) ? v : "";
  if (type === "url") return SAFE_LINK.test(v) ? v : "";
  return v;
}

/** Merge published rows over the defaults (what the merch site renders). */
export function resolveMerchContent(published: unknown): MerchContent {
  const out: Record<string, string> = Object.fromEntries(DEFAULTS);
  if (published && typeof published === "object") {
    for (const [k, raw] of Object.entries(published as Record<string, unknown>)) {
      const v = cleanMerchValue(k, raw);
      if (v !== null) out[k] = v;
    }
  }
  return out;
}

export const merchDefaults = (): MerchContent => resolveMerchContent(null);

/** {order} / {site} / {first} placeholder fill (plain text; callers escape for HTML). */
export function fillTemplate(t: string, vars: Readonly<Record<string, string>>): string {
  return t.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

export interface MerchBannerView { image: string; imageMobile: string; alt: string; link: string }
export function bannerFor(c: MerchContent, scope: string): MerchBannerView | null {
  const image = c[`merch.banner.${scope}.image`] ?? "";
  const imageMobile = c[`merch.banner.${scope}.image_mobile`] ?? "";
  if (!image && !imageMobile) return null;
  return { image: image || imageMobile, imageMobile: imageMobile || image, alt: c[`merch.banner.${scope}.alt`] ?? "", link: c[`merch.banner.${scope}.link`] ?? "" };
}

/** Header props (shape of components/Header HeaderCopy). */
export function headerCopy(c: MerchContent) {
  return {
    wordmark: c["merch.header.wordmark"] || "Greenway",
    accent: c["merch.header.wordmark_accent"] ?? "",
    tagline: c["merch.header.tagline"] ?? "",
    shop: c["merch.header.shop_label"] || "Shop",
    cart: c["merch.header.cart_label"] || "Cart",
    announcement: c["merch.header.announcement"] ?? "",
    announcementLink: c["merch.header.announcement_link"] ?? "",
  };
}

const SOCIAL: readonly [string, string][] = [["instagram", "Instagram"], ["facebook", "Facebook"], ["tiktok", "TikTok"]];
/** Footer props (shape of components/Footer FooterCopy). Only https social links render. */
export function footerCopy(c: MerchContent) {
  return {
    wordmark: c["merch.header.wordmark"] || "Greenway",
    accent: c["merch.header.wordmark_accent"] ?? "",
    note: c["merch.footer.note"] ?? "",
    social: SOCIAL.map(([id, label]) => ({ label, href: c[`merch.footer.social.${id}.url`] ?? "" })).filter((s) => s.href.startsWith("https://")),
  };
}

/** Product / category card wording (ShopBrowser). */
export interface CardCopy { brand: string; cta: string; ctaSoldOut: string; soldOutBadge: string; categoryCta: string }
export function cardCopy(c: MerchContent): CardCopy {
  return {
    brand: c["merch.card.brand"] ?? "",
    cta: c["merch.card.cta"] || "Choose options",
    ctaSoldOut: c["merch.card.cta_soldout"] || "View",
    soldOutBadge: c["merch.card.soldout_badge"] || "Sold out",
    categoryCta: c["merch.card.category_cta"] || "Shop",
  };
}

/** Owner overrides for a category card picture + blurb (blank = the built-in one). */
export function categoryOverride<T extends { slug: string; image: string; blurb: string }>(c: MerchContent, cat: T): T {
  const image = c[`merch.card.category.${cat.slug}.image`] || cat.image;
  const blurb = c[`merch.card.category.${cat.slug}.blurb`] || cat.blurb;
  return { ...cat, image, blurb };
}

// ---------------------------------------------------------------------------
export function __runSiteContentCoreTests(): { passed: number; failed: number } {
  let passed = 0; let failed = 0;
  const ok = (c: boolean, m: string) => { if (c) passed += 1; else { failed += 1; console.error(`FAIL merch-site site-content-core: ${m}`); } };
  ok(MERCH_BLOCK_KEYS.size === MERCH_SITE_BLOCKS.length, "block keys unique");
  ok(MERCH_SITE_BLOCKS.every((b) => b.key.startsWith("merch.") && b.key !== "merch.ad" && (MERCH_SITE_PAGES as readonly string[]).includes(b.page)), "every key merch.* (not the cannabis-site ad) on a known page");
  ok(MERCH_SITE_PAGES.every((p) => MERCH_SITE_BLOCKS.some((b) => b.page === p)), "every editor page has blocks");
  const d = merchDefaults();
  ok(d["merch.header.wordmark"] === "Greenway" && d["merch.header.shop_label"] === "Shop" && d["merch.card.cta"] === "Choose options" && d["merch.banner.home.image"] === "", "defaults = pre-S3 copy, banners blank");
  const r = resolveMerchContent({ "merch.header.wordmark": " Greenway Goods ", "merch.unknown": "x", "merch.banner.home.image": "javascript:alert(1)", "merch.banner.home.link": "//evil.com", "merch.banner.tees.link": "/tees", "merch.card.cta": 42 });
  ok(r["merch.header.wordmark"] === "Greenway Goods" && !("merch.unknown" in r), "trims, drops unknown keys");
  ok(r["merch.banner.home.image"] === "" && r["merch.banner.home.link"] === "" && r["merch.banner.tees.link"] === "/tees", "unsafe image/link blanked, site path kept");
  ok(r["merch.card.cta"] === "Choose options", "non-string ignored -> default");
  ok(resolveMerchContent("nope")["merch.header.cart_label"] === "Cart" && resolveMerchContent(null)["merch.footer.note"].includes("does not sell cannabis"), "garbage input -> defaults");
  ok(fillTemplate("Order {order} at {site} {x}", { order: "gm-1", site: "S" }) === "Order gm-1 at S {x}", "template fill, unknown kept");
  ok(bannerFor(d, "home") === null, "no image -> no banner");
  const b = bannerFor(resolveMerchContent({ "merch.banner.hats.image_mobile": "https://x.supabase.co/a.png" }), "hats");
  ok(!!b && b.image === "https://x.supabase.co/a.png" && b.imageMobile === b.image, "mobile-only banner fills desktop");
  ok(MERCH_BANNER_CATEGORIES.every((c) => typeof CATEGORY_BLURBS[c.slug] === "string" && d[`merch.card.category.${c.slug}.blurb`] === CATEGORY_BLURBS[c.slug]), "category blurbs seeded");
  const h = headerCopy(d); const f = footerCopy(d); const k = cardCopy(d);
  ok(h.wordmark === "Greenway" && h.accent === "Merch" && h.tagline === "Greenway Glass & Goods" && h.announcement === "" && f.social.length === 0 && k.categoryCta === "Shop", "header/footer/card props = pre-S3 render");
  ok(footerCopy(resolveMerchContent({ "merch.footer.social.instagram.url": "https://instagram.com/g", "merch.footer.social.facebook.url": "/fb" })).social.map((s) => s.label).join() === "Instagram", "only https social links render");
  const cat = { slug: "hats", label: "Hats", image: "/categories/hats.webp", blurb: "B" };
  ok(categoryOverride(d, cat).image === "/categories/hats.webp" && categoryOverride(resolveMerchContent({ "merch.card.category.hats.image": "https://x.co/h.png", "merch.card.category.hats.blurb": "New" }), cat).blurb === "New", "category override + fallback");
  return { passed, failed };
}
