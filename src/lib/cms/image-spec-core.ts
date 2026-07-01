/**
 * image-spec-core.ts — recommended image dimensions / aspect ratios for every
 * editable image slot in the page editors, plus Canva-ready helper text.
 *
 * WHY: our owner builds most marketing art in Canva. Knowing the exact canvas
 * size to create BEFORE designing means the art fills each slot perfectly the
 * first time (no awkward crops). This module maps each editable image slot to a
 * factual spec grounded in how that image actually renders on the storefront.
 *
 * PURE + framework-free so it is unit-testable with tsx (no React / server-only
 * imports). The UI helper (ImageSpecHelper) consumes `resolveImageSpec`.
 *
 * GROUNDING (verified against the live render + content-blocks seed):
 *   - loyalty.hero.image        → renders `aspect-[3200/563]` (seed says ~3200×563)
 *   - loyalty.hero.image_mobile → renders `aspect-[3/1]` (seed says ~1200×400)
 *   - locations.hero.image      → wide storefront hero (min-h ~19–31rem, fill)
 *   - home.category.image /
 *     home.brand.image          → SectionBanner band: wide + short, textless
 *   - footer.hours.image        → small transparent PNG graphic
 *   - page sections / carousel  → Hero/SectionBanner family: wide + short banner
 */

/** A single recommended output size an editor can create in Canva. */
export type ImageSizePreset = {
  /** Human label, e.g. "Desktop banner". */
  label: string;
  width: number;
  height: number;
};

/** The full spec shown next to an image upload control. */
export type ImageSpec = {
  /** Stable id (usually the block_key or a named slot id). */
  id: string;
  /** Short friendly name of the slot. */
  title: string;
  /** Simplified aspect ratio string, e.g. "16:9" or "~5.7:1". */
  aspectLabel: string;
  /** Numeric aspect (width / height) for programmatic use. */
  aspectRatio: number;
  /** One or more recommended pixel sizes to create in Canva. */
  presets: ImageSizePreset[];
  /** Whether a transparent background (PNG) is recommended. */
  transparent: boolean;
  /** File-format guidance. */
  formatNote: string;
  /** Plain-English tip about composition (e.g. "keep it textless"). */
  tip: string;
};

/** Reduce a width:height to a small integer ratio when it is clean, else ~x:1. */
export function aspectLabelFor(width: number, height: number): string {
  if (width <= 0 || height <= 0) return "—";
  const g = gcd(width, height);
  const w = width / g;
  const h = height / g;
  // If the reduced numbers are small and tidy, show them directly.
  if (w <= 40 && h <= 40) return `${w}:${h}`;
  // Otherwise express as a decimal multiple of 1 (wide banners like 5.7:1).
  const r = width / height;
  return `~${round1(r)}:1`;
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a || 1;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Build a spec from a single primary size (+ optional extra presets). */
function specFrom(
  id: string,
  title: string,
  width: number,
  height: number,
  opts?: {
    extraPresets?: ImageSizePreset[];
    transparent?: boolean;
    formatNote?: string;
    tip?: string;
    primaryLabel?: string;
  },
): ImageSpec {
  const presets: ImageSizePreset[] = [
    { label: opts?.primaryLabel ?? "Recommended", width, height },
    ...(opts?.extraPresets ?? []),
  ];
  return {
    id,
    title,
    aspectLabel: aspectLabelFor(width, height),
    aspectRatio: width / height,
    presets,
    transparent: opts?.transparent ?? false,
    formatNote:
      opts?.formatNote ??
      (opts?.transparent
        ? "Transparent PNG so it blends with the background."
        : "WebP or JPG. Keep it under ~500 KB for fast loading."),
    tip: opts?.tip ?? "Use textless art — headings and buttons are added on top automatically.",
  };
}

/**
 * The generic "wide short banner" family that most page sections, carousel
 * slides, and category/brand bands share. Renders full-width (~1408–1600px) at
 * a short height with copy overlaid. A 3:1 canvas crops well everywhere.
 */
const WIDE_BANNER: ImageSpec = specFrom("wide-banner", "Wide banner", 1600, 560, {
  primaryLabel: "Desktop banner",
  extraPresets: [{ label: "Extra-wide (safe)", width: 1920, height: 640 }],
  tip: "Wide and short. Keep the important art toward the right — text sits on the left with a dark fade.",
});

/** Named registry keyed by the real block_key values (from content-blocks seed). */
const BLOCK_SPECS: Record<string, ImageSpec> = {
  "loyalty.hero.image": specFrom(
    "loyalty.hero.image",
    "Loyalty hero — desktop",
    3200,
    563,
    {
      primaryLabel: "Desktop banner",
      tip: "Very wide and short (about 5.7:1). Textless — the signup form sits below it.",
    },
  ),
  "loyalty.hero.image_mobile": specFrom(
    "loyalty.hero.image_mobile",
    "Loyalty hero — mobile",
    1200,
    400,
    {
      primaryLabel: "Mobile banner",
      tip: "A taller 3:1 crop reads better on phones. Textless.",
    },
  ),
  "locations.hero.image": specFrom(
    "locations.hero.image",
    "Locations — storefront photo",
    1600,
    900,
    {
      primaryLabel: "Storefront photo",
      formatNote: "WebP or JPG photo. A real storefront photo works best.",
      tip: "A wide 16:9 photo. Text and gradient are overlaid on the lower-left.",
    },
  ),
  "home.category.image": specFrom(
    "home.category.image",
    "Homepage — category band",
    1600,
    420,
    {
      primaryLabel: "Category band",
      tip: "Wide and short background art for the \u201cShop by Category\u201d band. Textless — copy is layered on top.",
    },
  ),
  "home.brand.image": specFrom(
    "home.brand.image",
    "Homepage — brand band",
    1600,
    420,
    {
      primaryLabel: "Brand band",
      tip: "Wide and short background art for the \u201cShop by Brand\u201d band. Textless — copy is layered on top.",
    },
  ),
  "footer.hours.image": specFrom(
    "footer.hours.image",
    "Footer — store hours graphic",
    900,
    900,
    {
      primaryLabel: "Hours graphic",
      transparent: true,
      formatNote: "Transparent PNG so it blends with the black footer.",
      tip: "A square-ish \u201cOPEN / hours\u201d graphic on a transparent background.",
    },
  ),
};

/** Named specs for non-block slots (sections, carousel slides). */
export const SECTION_BANNER_SPEC: ImageSpec = { ...WIDE_BANNER, id: "section-banner", title: "Section background" };
export const CAROUSEL_SLIDE_SPEC: ImageSpec = {
  ...WIDE_BANNER,
  id: "carousel-slide",
  title: "Carousel slide",
  tip: "Wide and short. All slides share one size so the carousel doesn\u2019t jump — keep art on the right, text on the left.",
};

/**
 * Resolve the best spec for a given block_key. Falls back by category:
 *   *.image_mobile → mobile banner shape
 *   *.hero.*       → wide banner
 *   *              → wide banner (safest default for our layouts)
 */
export function resolveImageSpec(blockKey: string | null | undefined): ImageSpec {
  const key = (blockKey ?? "").trim();
  if (key && BLOCK_SPECS[key]) return BLOCK_SPECS[key];

  const lower = key.toLowerCase();
  if (lower.endsWith("image_mobile") || lower.includes("mobile")) {
    return { ...BLOCK_SPECS["loyalty.hero.image_mobile"], id: key || "mobile-banner", title: "Mobile banner" };
  }
  if (lower.includes("logo") || lower.includes("icon")) {
    return specFrom(key || "logo", "Logo / icon", 512, 512, {
      primaryLabel: "Logo",
      transparent: true,
      tip: "Square, transparent PNG.",
    });
  }
  // Default: the wide short banner family used across our layouts.
  return { ...WIDE_BANNER, id: key || "wide-banner" };
}

/**
 * A flat cheat-sheet of the common slot sizes, for a reference card in the
 * Media Library (where uploads aren't tied to a specific block). Grounded in
 * the same registry so the numbers always match the per-slot helpers.
 */
export function imageSpecCheatSheet(): ImageSpec[] {
  return [
    SECTION_BANNER_SPEC,
    BLOCK_SPECS["loyalty.hero.image"],
    BLOCK_SPECS["loyalty.hero.image_mobile"],
    BLOCK_SPECS["locations.hero.image"],
    BLOCK_SPECS["home.category.image"],
    BLOCK_SPECS["footer.hours.image"],
  ];
}

/** One-line Canva prompt an editor can copy, e.g. "Create a 1600 × 560 px canvas". */
export function canvaLine(spec: ImageSpec): string {
  const p = spec.presets[0];
  return `In Canva, create a custom ${p.width} \u00d7 ${p.height} px canvas (${spec.aspectLabel}).`;
}

// ---------------------------------------------------------------------------
// Self-tests (pure; run via tsx)
// ---------------------------------------------------------------------------
export function __runImageSpecTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error("FAIL:", msg);
    }
  };

  ok(aspectLabelFor(1600, 900) === "16:9", "16:9 reduces cleanly");
  ok(aspectLabelFor(1200, 400) === "3:1", "3:1 reduces cleanly");
  ok(aspectLabelFor(900, 900) === "1:1", "square is 1:1");
  ok(aspectLabelFor(3200, 563).startsWith("~5.7"), "very wide banner ~5.7:1");
  ok(aspectLabelFor(0, 10) === "—", "guards zero width");

  ok(resolveImageSpec("loyalty.hero.image").presets[0].width === 3200, "exact block match");
  ok(resolveImageSpec("loyalty.hero.image_mobile").presets[0].width === 1200, "exact mobile block match");
  ok(resolveImageSpec("footer.hours.image").transparent === true, "footer graphic transparent");

  const fb = resolveImageSpec("some.unknown.hero.image");
  ok(fb.presets[0].width === 1600 && fb.aspectRatio > 2, "unknown hero → wide banner fallback");

  const mob = resolveImageSpec("promo.banner.image_mobile");
  ok(mob.aspectLabel === "3:1", "unknown *_mobile → mobile shape");

  const logo = resolveImageSpec("vendor.logo");
  ok(logo.transparent === true && logo.presets[0].width === 512, "logo fallback");

  ok(resolveImageSpec("").presets.length >= 1, "empty key still returns a spec");
  ok(resolveImageSpec(null).presets[0].width === 1600, "null key → wide banner");

  ok(canvaLine(BLOCK_SPECS["home.category.image"]).includes("1600"), "canva line mentions width");
  ok(SECTION_BANNER_SPEC.aspectRatio > 2, "section banner is wide");
  ok(CAROUSEL_SLIDE_SPEC.aspectRatio > 2, "carousel slide is wide");
  ok(CAROUSEL_SLIDE_SPEC.id === "carousel-slide", "carousel slide id set");

  return { passed, failed };
}
