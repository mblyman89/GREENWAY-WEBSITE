/**
 * src/lib/marketing/creative-placements-core.ts
 *
 * PURE, dependency-light registry of every place a generated image can go —
 * website slots, social posts, email/newsletter, blog, and print/in-store —
 * each with the EXACT pixel size to generate so the art fits perfectly the
 * first time ("sized perfectly for where they will be displayed").
 *
 * GROUNDING (never guessed):
 *   - Website slots derive their dimensions from image-spec-core, which is
 *     itself grounded in how each slot actually renders on the storefront
 *     (single source of truth — if a slot's spec changes, this follows).
 *   - Social sizes verified against Buffer's 2026 social image size guide:
 *       square 1080×1080 · portrait 1080×1350 (4:5) · story/reel 1080×1920 ·
 *       FB link/OG 1200×630 · X post 1600×900 · FB cover 851×315 (we render
 *       at 2× = 1702×630 for crispness) · Pinterest pin 1000×1500 (2:3).
 *   - Email verified against beehiiv template guidance: 600px content width
 *     is the industry standard; we generate at 2× (1200 wide) for retina.
 *   - Print DPI vs viewing distance verified (ForestXL print guide):
 *       1–3 ft → 150–300 DPI (flyers) · 3–10 ft → 75–150 DPI (posters,
 *       in-store) · 10–25 ft → 50–75 DPI (large banners).
 *     FLUX.2 caps output at ~4 MP, so print slots generate the largest
 *     matching canvas and carry an explicit upscale note for the print shop.
 *   - FLUX.2 API accepts integer width/height ≥ 64 (docs.bfl.ai). Platform
 *     standard sizes (e.g. 1080×1080) take priority over the soft
 *     "multiples of 16" quality preference — exact fit beats theoretical
 *     sharpness that would then be resized by the platform anyway.
 *
 * PURE: no server-only imports, unit-testable via __runCreativePlacementsTests.
 */

import { resolveImageSpec, SECTION_BANNER_SPEC, SPECIALS_BANNER_SPEC } from "@/lib/cms/image-spec-core";

export type PlacementGroup = "website" | "social" | "email" | "blog" | "print";

export const PLACEMENT_GROUP_LABELS: Record<PlacementGroup, string> = {
  website: "Website",
  social: "Social media",
  email: "Email & newsletter",
  blog: "Blog",
  print: "Print & in-store",
};

/** Ordered groups for UI rendering. */
export const PLACEMENT_GROUPS: PlacementGroup[] = ["website", "social", "email", "blog", "print"];

export type CreativePlacement = {
  /** Stable id, e.g. "social-square". */
  id: string;
  group: PlacementGroup;
  /** Short friendly name, e.g. "Instagram/Facebook square post". */
  label: string;
  /** Plain-English: where exactly this image will be displayed. */
  where: string;
  /** Exact pixels to generate. */
  width: number;
  height: number;
  /** Best output format for this destination. */
  format: "jpeg" | "png" | "webp";
  /** Composition/usage tip shown as helper text. */
  tip: string;
  /**
   * Deterministic composition guidance appended to the FLUX prompt so the
   * art direction matches the destination (e.g. "leave the left third calm
   * for overlaid text"). Pure data — no AI involved.
   */
  promptHint: string;
  /** Print-only: final print size / DPI / upscale guidance. */
  printNote?: string;
};

// ---------------------------------------------------------------------------
// Website slots — dimensions come straight from image-spec-core (grounded in
// the live render), so the generator and the upload helper can never drift.
// ---------------------------------------------------------------------------

function primaryDims(blockKey: string): { width: number; height: number } {
  const spec = resolveImageSpec(blockKey);
  const p = spec.presets[0];
  return { width: p.width, height: p.height };
}

const WEBSITE_PLACEMENTS: CreativePlacement[] = [
  {
    id: "website-section-banner",
    group: "website",
    label: "Page section / carousel banner",
    where: "Full-width section backgrounds and carousel slides on Home, Menu, Loyalty, Specials, Vendors, and FAQ.",
    width: SECTION_BANNER_SPEC.presets[0].width,
    height: SECTION_BANNER_SPEC.presets[0].height,
    format: "jpeg",
    tip: "Wide and short. Keep the important art toward the right — headings and buttons are overlaid on the left with a dark fade.",
    promptHint:
      "very wide banner composition, key subject placed in the right two-thirds, left third calm and uncluttered for overlaid text, no text in the image",
  },
  {
    id: "website-specials-banner",
    group: "website",
    label: "Specials — Today's Deal banner",
    where: "The wide banner strip above the live \u201cToday's Deals\u201d products on the public Specials page.",
    width: SPECIALS_BANNER_SPEC.presets[0].width,
    height: SPECIALS_BANNER_SPEC.presets[0].height,
    format: "jpeg",
    tip: "Wide and short. The deal title & subtitle sit over a dark fade — keep the key art toward the side away from the text (you choose which side in the Specials editor).",
    promptHint:
      "very wide banner composition, key subject placed to one side, the opposite side calm and uncluttered for overlaid deal text, no text in the image",
  },
  {
    id: "website-loyalty-hero",
    group: "website",
    label: "Loyalty hero — desktop",
    where: "The very wide strip at the top of the public Loyalty page (desktop).",
    ...primaryDims("loyalty.hero.image"),
    format: "jpeg",
    tip: "Extremely wide and short (about 5.7:1). Textless — the signup form sits below it.",
    promptHint:
      "ultra-wide panoramic banner composition, subject spread horizontally, generous negative space, no text in the image",
  },
  {
    id: "website-mobile-banner",
    group: "website",
    label: "Loyalty hero — mobile",
    where: "The banner at the top of the Loyalty page on phones.",
    ...primaryDims("loyalty.hero.image_mobile"),
    format: "jpeg",
    tip: "A taller 3:1 crop reads better on phones. Textless.",
    promptHint: "wide 3:1 banner composition, subject centered, no text in the image",
  },
  {
    id: "website-storefront-photo",
    group: "website",
    label: "Locations — storefront image",
    where: "The 16:9 hero photo on the public Locations page.",
    ...primaryDims("locations.hero.image"),
    format: "jpeg",
    tip: "A wide 16:9 image. Text and a gradient are overlaid on the lower-left, so keep that corner calm.",
    promptHint:
      "wide 16:9 composition, lower-left corner kept simple and dark-friendly for overlaid text, no text in the image",
  },
  {
    id: "website-category-band",
    group: "website",
    label: "Homepage category/brand band",
    where: "The background band behind “Shop by Category” and “Shop by Brand” on the homepage.",
    ...primaryDims("home.category.image"),
    format: "jpeg",
    tip: "Wide and short background art. Textless — copy is layered on top.",
    promptHint:
      "very wide short banner composition, subtle background-style art that will not fight overlaid text, muted contrast, no text in the image",
  },
  {
    id: "website-og-share",
    group: "website",
    label: "Social share (Open Graph) image",
    where: "What shows when any page of the site is shared on Facebook, Instagram, or in messengers (set in the SEO editor).",
    width: 1200,
    height: 630,
    format: "jpeg",
    tip: "1200×630 is the Open Graph standard. Keep the subject centered — platforms crop the edges slightly.",
    promptHint: "1.91:1 landscape composition, key subject centered with safe margins on all sides",
  },
];

// ---------------------------------------------------------------------------
// Social — verified platform-standard sizes (Buffer 2026 guide).
// ---------------------------------------------------------------------------

const SOCIAL_PLACEMENTS: CreativePlacement[] = [
  {
    id: "social-square",
    group: "social",
    label: "Instagram / Facebook square post",
    where: "A standard 1:1 feed post on Instagram or Facebook.",
    width: 1080,
    height: 1080,
    format: "jpeg",
    tip: "The universal square. If in doubt about a feed post, use this.",
    promptHint: "square 1:1 composition, key subject centered",
  },
  {
    id: "social-portrait",
    group: "social",
    label: "Instagram / Facebook portrait post (4:5)",
    where: "A taller 4:5 feed post — takes up more screen on phones, so it usually performs better.",
    width: 1080,
    height: 1350,
    format: "jpeg",
    tip: "4:5 portrait fills more of the phone screen than a square post.",
    promptHint: "vertical 4:5 portrait composition, key subject centered",
  },
  {
    id: "social-story",
    group: "social",
    label: "Story / Reel / TikTok (9:16)",
    where: "Full-screen vertical: Instagram/Facebook Stories, Reels covers, TikTok.",
    width: 1080,
    height: 1920,
    format: "jpeg",
    tip: "Keep the middle safe: platform UI covers the top ~250px and bottom ~310px.",
    promptHint:
      "full-screen vertical 9:16 composition, key subject in the middle band, top and bottom kept simple (platform UI overlaps them)",
  },
  {
    id: "social-og-link",
    group: "social",
    label: "Facebook link preview (1200×630)",
    where: "The image on a link card when a URL is posted to Facebook or most messengers.",
    width: 1200,
    height: 630,
    format: "jpeg",
    tip: "Same 1.91:1 standard as the site's Open Graph image.",
    promptHint: "1.91:1 landscape composition, key subject centered with safe margins",
  },
  {
    id: "social-x-post",
    group: "social",
    label: "X (Twitter) post image (16:9)",
    where: "An image attached to a post on X — 1600×900 is the recommended size.",
    width: 1600,
    height: 900,
    format: "jpeg",
    tip: "16:9 landscape; X shows it uncropped in the timeline.",
    promptHint: "wide 16:9 landscape composition, key subject centered",
  },
  {
    id: "social-fb-cover",
    group: "social",
    label: "Facebook page cover",
    where: "The banner across the top of the Facebook business page (displays at 851×315).",
    width: 1702,
    height: 630,
    format: "jpeg",
    tip: "Generated at 2× (1702×630) so it stays crisp; Facebook scales it to 851×315. Mobile crops the sides — keep the subject centered.",
    promptHint:
      "very wide 2.7:1 banner composition, key subject centered (sides get cropped on phones), no text in the image",
  },
  {
    id: "social-pinterest",
    group: "social",
    label: "Pinterest pin (2:3)",
    where: "A standard vertical pin — 1000×1500 (2:3) is Pinterest's recommended ratio.",
    width: 1000,
    height: 1500,
    format: "jpeg",
    tip: "Vertical 2:3. Taller pins get cut off in feeds.",
    promptHint: "vertical 2:3 composition, key subject centered",
  },
];

// ---------------------------------------------------------------------------
// Email / blog — 600px content width is the industry standard (beehiiv);
// generate at 2× so images stay sharp on retina screens.
// ---------------------------------------------------------------------------

const EMAIL_PLACEMENTS: CreativePlacement[] = [
  {
    id: "email-banner",
    group: "email",
    label: "Newsletter banner (main image)",
    where: "The big image in an email newsletter (600px content width standard; displays ~600×400).",
    width: 1200,
    height: 800,
    format: "jpeg",
    tip: "Generated at 2× (1200×800) for retina sharpness. Keep the file lean — Gmail clips emails over ~102KB of HTML.",
    promptHint: "3:2 landscape composition, key subject centered, clean and legible at small sizes",
  },
  {
    id: "email-header",
    group: "email",
    label: "Newsletter header strip",
    where: "The slim branded strip at the top of an email (displays ~600×200).",
    width: 1200,
    height: 400,
    format: "jpeg",
    tip: "Generated at 2× (1200×400). Simple art reads best at this small display size.",
    promptHint: "wide 3:1 strip composition, simple bold art that reads at small sizes, no fine detail, no text in the image",
  },
];

const BLOG_PLACEMENTS: CreativePlacement[] = [
  {
    id: "blog-hero",
    group: "blog",
    label: "Blog post hero image",
    where: "The 16:9 hero at the top of a blog post (also reused as its share image).",
    width: 1600,
    height: 900,
    format: "jpeg",
    tip: "16:9 works both as the post hero and the social share card.",
    promptHint: "wide 16:9 editorial composition, key subject centered with safe margins",
  },
];

// ---------------------------------------------------------------------------
// Print & in-store — FLUX caps output at ~4 MP, so each print slot generates
// the largest canvas that matches the print ratio and carries an explicit
// note for the print shop (verified DPI-by-viewing-distance guidance).
// ---------------------------------------------------------------------------

const PRINT_PLACEMENTS: CreativePlacement[] = [
  {
    id: "print-flyer-letter",
    group: "print",
    label: "Flyer — 8.5×11″ (Letter)",
    where: "A handout flyer or counter sheet, read up close (1–3 ft → 150–300 DPI).",
    width: 1664,
    height: 2144,
    format: "png",
    tip: "Generated at FLUX's max matching canvas (≈3.6 MP). Full print quality at 300 DPI needs 2550×3300 — have the print shop upscale ~1.5×, or print at ~195 DPI which still looks sharp in hand.",
    promptHint: "vertical letter-page composition, clear focal hierarchy, generous margins for print bleed, no text in the image",
    printNote: "Print target: 8.5×11″ at 300 DPI = 2550×3300 px. Generated at 1664×2144 (FLUX ~4 MP cap) — upscale ~1.5× before print.",
  },
  {
    id: "print-poster-18x24",
    group: "print",
    label: "Poster — 18×24″",
    where: "A wall poster viewed from a few feet away (3–10 ft → 75–150 DPI).",
    width: 1664,
    height: 2224,
    format: "png",
    tip: "At poster viewing distance, ~92 DPI from this canvas already looks great. For gallery-close viewing ask the print shop to upscale 1.5–2×.",
    promptHint: "vertical 3:4 poster composition, bold focal subject readable from across a room, no text in the image",
    printNote: "Print target: 18×24″. This canvas prints at ~92 DPI — ideal for 3–10 ft viewing; upscale for closer viewing.",
  },
  {
    id: "print-instore-display",
    group: "print",
    label: "In-store digital display (16:9)",
    where: "TV menu boards and digital displays inside the store (1080p screens).",
    width: 1920,
    height: 1080,
    format: "png",
    tip: "Exact 1080p — fills a TV screen pixel-perfect. Keep art high-contrast so it reads across the room.",
    promptHint: "wide 16:9 composition, bold high-contrast art readable from across a room, no text in the image",
  },
  {
    id: "print-window-banner",
    group: "print",
    label: "Large banner — window / outdoor (2:1)",
    where: "A big vinyl banner seen from far away (10–25 ft → 50–75 DPI).",
    width: 2560,
    height: 1280,
    format: "png",
    tip: "At banner viewing distance this canvas covers up to ~6×3 ft at ~70 DPI. The print vendor can upscale further for bigger sizes.",
    promptHint: "very wide 2:1 banner composition, one bold focal subject, minimal detail (viewed from far away), no text in the image",
    printNote: "Covers ~6×3 ft at ~70 DPI (fine for 10–25 ft viewing). For larger banners, the print vendor upscales.",
  },
];

// ---------------------------------------------------------------------------
// Registry + helpers
// ---------------------------------------------------------------------------

export const CREATIVE_PLACEMENTS: CreativePlacement[] = [
  ...WEBSITE_PLACEMENTS,
  ...SOCIAL_PLACEMENTS,
  ...EMAIL_PLACEMENTS,
  ...BLOG_PLACEMENTS,
  ...PRINT_PLACEMENTS,
];

/** Look up a placement by id (null when unknown — callers must handle). */
export function placementById(id: string | null | undefined): CreativePlacement | null {
  if (!id) return null;
  return CREATIVE_PLACEMENTS.find((p) => p.id === id) ?? null;
}

/** Placements grouped and ordered for a grouped <select> / picker UI. */
export function placementsByGroup(): { group: PlacementGroup; label: string; placements: CreativePlacement[] }[] {
  return PLACEMENT_GROUPS.map((group) => ({
    group,
    label: PLACEMENT_GROUP_LABELS[group],
    placements: CREATIVE_PLACEMENTS.filter((p) => p.group === group),
  })).filter((g) => g.placements.length > 0);
}

/** One-line summary for helper text: "1080 × 1080 px · JPEG · Instagram / Facebook square post". */
export function placementSummaryLine(p: CreativePlacement): string {
  return `${p.width} × ${p.height} px · ${p.format.toUpperCase()} · ${p.label}`;
}

/** ~4 MP output ceiling on FLUX.2 endpoints (verified prompting guide). */
export const FLUX_MAX_OUTPUT_PIXELS = 4_194_304;

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runCreativePlacementsTests(): string {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
  };
  let n = 0;
  const ok = (c: boolean, m: string) => {
    assert(c, m);
    n++;
  };

  // Registry integrity: unique ids, valid dims, within the FLUX output cap.
  const ids = new Set<string>();
  for (const p of CREATIVE_PLACEMENTS) {
    ok(!ids.has(p.id), `unique id: ${p.id}`);
    ids.add(p.id);
    ok(Number.isInteger(p.width) && p.width >= 64, `${p.id} width >= 64`);
    ok(Number.isInteger(p.height) && p.height >= 64, `${p.id} height >= 64`);
    ok(p.width * p.height <= FLUX_MAX_OUTPUT_PIXELS, `${p.id} within 4MP cap`);
    ok(p.label.length > 0 && p.where.length > 0 && p.tip.length > 0, `${p.id} helper text present`);
    ok(p.promptHint.length > 0, `${p.id} prompt hint present`);
  }

  // Verified platform-standard sizes stay pinned (regression guards).
  ok(placementById("social-square")!.width === 1080 && placementById("social-square")!.height === 1080, "square 1080");
  ok(placementById("social-portrait")!.height === 1350, "portrait 4:5 = 1080x1350");
  ok(placementById("social-story")!.width === 1080 && placementById("social-story")!.height === 1920, "story 9:16");
  ok(placementById("social-og-link")!.width === 1200 && placementById("social-og-link")!.height === 630, "OG 1200x630");
  ok(placementById("website-og-share")!.height === 630, "site OG 630 tall");
  ok(placementById("social-pinterest")!.width === 1000 && placementById("social-pinterest")!.height === 1500, "pin 2:3");
  ok(placementById("email-banner")!.width === 1200, "email banner 2x of 600 standard");
  ok(placementById("print-instore-display")!.width === 1920, "in-store display is 1080p");

  // Website slots stay grounded in image-spec-core (single source of truth).
  const sectionSpec = SECTION_BANNER_SPEC.presets[0];
  const section = placementById("website-section-banner")!;
  ok(section.width === sectionSpec.width && section.height === sectionSpec.height, "section banner tracks image-spec-core");
  const loyaltySpec = resolveImageSpec("loyalty.hero.image").presets[0];
  const loyalty = placementById("website-loyalty-hero")!;
  ok(loyalty.width === loyaltySpec.width && loyalty.height === loyaltySpec.height, "loyalty hero tracks image-spec-core");
  const specialsSpec = SPECIALS_BANNER_SPEC.presets[0];
  const specials = placementById("website-specials-banner")!;
  ok(
    specials.width === specialsSpec.width && specials.height === specialsSpec.height,
    "specials banner tracks image-spec-core",
  );

  // Print slots carry explicit print notes.
  ok(Boolean(placementById("print-flyer-letter")!.printNote), "flyer has print note");
  ok(Boolean(placementById("print-window-banner")!.printNote), "banner has print note");

  // Grouping + lookups.
  const groups = placementsByGroup();
  ok(groups.length === 5, "five groups");
  ok(groups[0].group === "website", "website group first");
  ok(groups.every((g) => g.placements.length > 0), "no empty groups");
  ok(placementById("nope") === null, "unknown id -> null");
  ok(placementById(null) === null, "null id -> null");
  ok(placementSummaryLine(section).includes("px"), "summary line has px");

  return `OK creative-placements: ${n} assertions passed`;
}
