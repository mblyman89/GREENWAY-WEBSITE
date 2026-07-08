/**
 * src/lib/media/classify-core.ts — Slice H10b (media classifier).
 *
 * PURE logic that decides what a media asset most likely IS — a vendor logo,
 * a brand logo, a product image, an icon, a banner, or something else — from
 * the signals we already hold on the row (filename, source URL, dimensions,
 * MIME, tags, title) plus an optional vision verdict from the model.
 *
 * This is the "tell the difference between a product image and a vendor/brand
 * logo" brain the owner asked for. It NEVER writes anything: callers get a
 * ranked suggestion (usage_type id from the media taxonomy + confidence +
 * human-readable reasons) and the human accepts or overrides it. Drafts-only.
 *
 * Design notes (all verified against the real data):
 *  • Harvested assets carry `source = "crawl:<imageUrl>"` — the crawl URL path
 *    is a strong signal (e.g. /edibles/, /logo/, /products/).
 *  • The harvest importers already stamp usage_type at import time
 *    ("vendor-logo" | "brand-logo" | "product"): we treat that as a PRIOR that
 *    can be OVERTURNED by stronger pixel evidence — the owner's screenshot
 *    shows a Rosinade product CAN imported as "Vendor logo", which is exactly
 *    the misfile this classifier exists to catch.
 *  • Vision (when available) sees the actual pixels: "a beverage can" is a
 *    product; "a wordmark on transparent background" is a logo.
 */

import { isValidPurpose } from "./taxonomy";

/** Everything the classifier may know about an asset. All fields optional. */
export type ClassifySignals = {
  filename?: string | null;
  /** media_assets.source, e.g. "crawl:https://site.com/edibles/gummy.jpg". */
  source?: string | null;
  title?: string | null;
  tags?: string[] | null;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  /** The usage_type stamped at import time (a PRIOR, not the verdict). */
  currentUsageType?: string | null;
  /**
   * Optional vision verdict from the model: what the pixels actually show.
   * One of the VISION_SUBJECTS ids, produced by the structured vision call.
   */
  visionSubject?: string | null;
  /** Vendor/brand display name, when the asset came from a harvest target. */
  entityName?: string | null;
};

/** What the vision model is allowed to say it sees (closed vocabulary). */
export const VISION_SUBJECTS = [
  "product-packaging", // a can/jar/bag/box/cart — a purchasable item
  "logo-wordmark",     // a logo, wordmark, or monogram (often flat/transparent)
  "product-in-scene",  // product shown in a lifestyle/scene photo
  "plant-or-flower",   // cannabis plant/bud photography
  "facility-or-people",// grow rooms, storefronts, staff, events
  "graphic-or-banner", // promotional graphic, banner art, illustration
  "icon-or-badge",     // small UI icon, certification seal, badge
  "document-or-text",  // a menu, COA, flyer — mostly text
  "other",
] as const;
export type VisionSubject = (typeof VISION_SUBJECTS)[number];

export type MediaClass = {
  /** Suggested taxonomy usage_type id (always a valid MEDIA_PURPOSES id). */
  usageType: string;
  /** 0..1 — how sure the combined signals are. */
  confidence: number;
  /** Human-readable reasons, strongest first (shown to the reviewer). */
  reasons: string[];
  /** True when the suggestion CONTRADICTS the current usage_type prior. */
  overturnsPrior: boolean;
};

// ---------------------------------------------------------------------------
// Signal keyword sets (lowercase substring matches on filename + crawl path)
// ---------------------------------------------------------------------------

const LOGO_WORDS = ["logo", "wordmark", "brandmark", "monogram", "favicon"];
const ICON_WORDS = ["icon", "badge", "seal", "sprite", "favicon"];
const BANNER_WORDS = ["banner", "hero", "header-bg", "cover", "billboard"];
// URL path segments that mark a PRODUCT page on vendor sites (mirrors the
// crawler's _INTEREST list — catalog/category pages carry the lineup).
const PRODUCT_PATH_WORDS = [
  "product", "products", "shop", "menu", "catalog", "store",
  "edible", "edibles", "gummies", "gummy", "chocolate", "beverage", "drink",
  "rosin", "flower", "vape", "cart", "cartridge", "concentrate", "extract",
  "preroll", "pre-roll", "joint", "eighth", "ounce", "gram",
];
// Filename words that mark PRODUCT PACKAGING shots.
const PRODUCT_FILE_WORDS = [
  ...PRODUCT_PATH_WORDS, "can", "jar", "bag", "box", "pouch", "bottle",
  "lemonade", "soda", "mockup", "packshot", "render",
];

function low(s: string | null | undefined): string {
  return (s ?? "").toLowerCase();
}

/** Extract the crawl URL path from `source = "crawl:<url>"` (or ""). */
export function crawlPath(source: string | null | undefined): string {
  const s = source ?? "";
  if (!s.startsWith("crawl:")) return "";
  try {
    return new URL(s.slice("crawl:".length)).pathname.toLowerCase();
  } catch {
    return "";
  }
}

function hasAny(hay: string, words: string[]): string | null {
  for (const w of words) if (hay.includes(w)) return w;
  return null;
}

// ---------------------------------------------------------------------------
// The classifier
// ---------------------------------------------------------------------------

/**
 * Classify an asset from every signal available. Pure + deterministic.
 *
 * Precedence (strongest first):
 *  1. VISION — the pixels themselves (when a vision verdict is supplied).
 *  2. Crawl-URL path + filename keywords (the site's own information scent).
 *  3. Shape/format heuristics (square SVG/transparent-ish tiny → logo/icon;
 *     tall portrait raster → packaging shot).
 *  4. The import-time usage_type PRIOR (kept only when nothing contradicts it).
 */
export function classifyMediaAsset(sig: ClassifySignals): MediaClass {
  const reasons: string[] = [];
  const fname = low(sig.filename);
  const path = crawlPath(sig.source);
  const title = low(sig.title);
  const hay = `${fname} ${path} ${title}`;
  const prior = isValidPurpose(sig.currentUsageType) ? (sig.currentUsageType as string) : "";

  // Scores per candidate class. Keys are taxonomy usage_type ids.
  const score: Record<string, number> = {
    product: 0, "vendor-logo": 0, "brand-logo": 0, logo: 0,
    icon: 0, banner: 0, other: 0,
  };

  // --- 1) VISION (strongest) -------------------------------------------------
  const vision = (sig.visionSubject ?? "") as VisionSubject | "";
  if (vision === "product-packaging" || vision === "product-in-scene") {
    score.product += 5;
    reasons.push(
      vision === "product-packaging"
        ? "Vision: the image shows product packaging (a purchasable item), not a logo."
        : "Vision: the image shows a product in a scene.",
    );
  } else if (vision === "logo-wordmark") {
    score.logo += 5;
    reasons.push("Vision: the image is a logo/wordmark.");
  } else if (vision === "icon-or-badge") {
    score.icon += 4;
    reasons.push("Vision: the image is a small icon or badge.");
  } else if (vision === "graphic-or-banner") {
    score.banner += 3;
    reasons.push("Vision: the image is promotional graphic/banner art.");
  } else if (vision === "plant-or-flower") {
    score.product += 2;
    reasons.push("Vision: cannabis plant/flower photography (product-adjacent).");
  } else if (vision === "document-or-text") {
    score.other += 3;
    reasons.push("Vision: mostly text/document content.");
  } else if (vision === "facility-or-people") {
    score.other += 3;
    reasons.push("Vision: facility/people photo (not a product or logo).");
  }

  // --- 2) URL path + filename keywords ---------------------------------------
  const pathProduct = hasAny(path, PRODUCT_PATH_WORDS);
  if (pathProduct) {
    score.product += 3;
    reasons.push(`Harvested from a product page (path contains “${pathProduct}”).`);
  }
  const fileProduct = hasAny(fname, PRODUCT_FILE_WORDS);
  if (fileProduct) {
    score.product += 2;
    reasons.push(`Filename suggests product packaging (“${fileProduct}”).`);
  }
  const logoWord = hasAny(hay, LOGO_WORDS);
  if (logoWord) {
    score.logo += 3;
    reasons.push(`Filename/path/title contains “${logoWord}”.`);
  }
  const iconWord = hasAny(fname, ICON_WORDS);
  if (iconWord) {
    score.icon += 2;
    reasons.push(`Filename suggests an icon/badge (“${iconWord}”).`);
  }
  const bannerWord = hasAny(hay, BANNER_WORDS);
  if (bannerWord) {
    score.banner += 2;
    reasons.push(`Filename/path suggests a banner/hero (“${bannerWord}”).`);
  }

  // --- 3) Shape / format heuristics ------------------------------------------
  const w = sig.width ?? 0;
  const h = sig.height ?? 0;
  const mime = low(sig.mimeType);
  if (mime === "image/svg+xml") {
    score.logo += 2;
    reasons.push("SVG vector — typical for logos/wordmarks.");
  }
  if (w > 0 && h > 0) {
    const ratio = w / h;
    if (ratio <= 0.75 && h >= 600) {
      // Tall portrait raster — cans, jars, bottles, vape carts.
      score.product += 2;
      reasons.push(`Tall portrait shape (${w}×${h}) — typical product packaging shot.`);
    } else if (ratio >= 2.5 && w >= 900) {
      score.banner += 2;
      reasons.push(`Very wide shape (${w}×${h}) — typical banner/hero.`);
    } else if (w <= 128 && h <= 128) {
      score.icon += 2;
      reasons.push(`Small square (${w}×${h}) — typical icon/badge size.`);
    }
  }

  // --- 4) Import-time prior (weakest — a tiebreaker only) --------------------
  if (prior) {
    const priorKey = prior === "vendor-logo" || prior === "brand-logo" ? "logo" : prior;
    if (priorKey in score) {
      score[priorKey] += 1;
      reasons.push(`Imported as “${prior}” (weak prior).`);
    }
  }

  // --- Pick the winner --------------------------------------------------------
  const entries = Object.entries(score).sort((a, b) => b[1] - a[1]);
  const [winner, winScore] = entries[0];
  const runnerUp = entries[1]?.[1] ?? 0;

  // Nothing scored: keep the prior if there is one, else "other", low conf.
  if (winScore === 0) {
    return {
      usageType: prior || "other",
      confidence: 0.2,
      reasons: ["No strong signals — kept the import-time category."],
      overturnsPrior: false,
    };
  }

  // Refine "logo" into vendor-logo/brand-logo using the prior (the importer
  // knows WHICH entity was being harvested; the pixels can't tell vendor from
  // brand). Without a prior, plain "logo" is the honest suggestion.
  let usageType = winner;
  if (winner === "logo") {
    if (prior === "vendor-logo" || prior === "brand-logo") usageType = prior;
    else usageType = "logo";
  }

  // Confidence: margin-based, calibrated to 0.35..0.95.
  const margin = winScore - runnerUp;
  const confidence = Math.max(0.35, Math.min(0.95, 0.35 + winScore * 0.07 + margin * 0.06));

  const priorAsWinnerKey = prior === "vendor-logo" || prior === "brand-logo" ? "logo" : prior;
  const overturnsPrior = Boolean(prior) && priorAsWinnerKey !== winner;
  if (overturnsPrior) {
    reasons.push(
      `Suggests re-categorising: imported as “${prior}” but the evidence points to “${usageType}”.`,
    );
  }

  return { usageType, confidence: Number(confidence.toFixed(2)), reasons, overturnsPrior };
}

// ---------------------------------------------------------------------------
// Placement-tag suggestions (the "where used" part)
// ---------------------------------------------------------------------------

/**
 * Suggest placement tags for a classified asset. Deterministic + conservative:
 * only tags that follow from the class and the known entity. The reviewer can
 * always add more; we never remove existing tags.
 */
export function suggestTags(cls: MediaClass, sig: ClassifySignals): string[] {
  const out: string[] = [];
  const add = (t: string) => {
    const n = t.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    if (n && !out.includes(n)) out.push(n);
  };
  // Keep provenance tags the importer stamped.
  for (const t of sig.tags ?? []) add(t);

  add(cls.usageType);
  if (sig.entityName) add(sig.entityName);

  const path = crawlPath(sig.source);
  const fname = low(sig.filename);
  const hay = `${path} ${fname}`;
  // Category tags from the strongest product-path words.
  for (const w of ["edibles", "rosin", "flower", "vape", "concentrate", "preroll", "beverage", "gummies", "chocolate"]) {
    if (hay.includes(w)) add(w);
  }
  if (cls.usageType === "product") add("product-image");
  if (cls.usageType === "vendor-logo" || cls.usageType === "brand-logo" || cls.usageType === "logo") {
    add("needs-logo-review");
  }
  return out.slice(0, 12);
}
