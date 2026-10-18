/**
 * R73 S6 — Brand hub "Saved designs": banners, cards AND custom sizes (blog,
 * newsletter, social, print …), plus the maths to export a finished design as
 * a PNG at an exact pixel size (saved to the Media Library, e.g. the Merch
 * folder, so Merch Banners can attach it).
 *
 * Reuse, not new engines:
 *   • Sizes come from creative-placements-core (already researched + cited).
 *   • A size whose shape fits the card range (CARD_RATIO_MIN–MAX, 0.4–2.5)
 *     becomes a CARD frame (everything scales with width → any export width
 *     is pixel-faithful). A wider size (website section 1600×560, FB cover)
 *     becomes a BANNER frame rendered at its desktop reference width
 *     (DESKTOP_REF_PX) with the matching height.
 *   • Export = the same <DesignedBanner> the site uses, made "still" (no
 *     entrances / curtain, square corners) and rasterised at a scale.
 *
 * Pure (no IO, no React).
 */
import {
  CARD_RATIO_MAX,
  CARD_RATIO_MIN,
  DESKTOP_REF_PX,
  cardDesign,
  defaultDesign,
  type BannerDesign,
} from "@/lib/cms/banner-design-core";
import { CREATIVE_PLACEMENTS, PLACEMENT_GROUP_LABELS, PLACEMENT_GROUPS } from "@/lib/marketing/creative-placements-core";

export type BrandSize = { w: number; h: number; label: string };

export const SIZE_MIN_PX = 64;
export const SIZE_MAX_PX = 6000;
/** Banner frames: the studio clamps frame height to 80–720 at the 1408px reference. */
const BANNER_H_MIN = 80;
const BANNER_H_MAX = 720;
/** Cards render offscreen at this CSS width (contents are width-relative). */
export const CARD_RENDER_PX = 800;
/** Never raster bigger than this many pixels (canvas limits on phones/Safari). */
export const EXPORT_MAX_PIXELS = 16_000_000;

/** The two "classic" shapes plus every researched placement. */
export const SIZE_BANNER: BrandSize = { w: 1600, h: 560, label: "Website banner (wide)" };
export const SIZE_CARD: BrandSize = { w: 960, h: 1280, label: "Card (tall)" };

export type SizeOption = { id: string; group: string; size: BrandSize };

export function sizeOptions(): SizeOption[] {
  const out: SizeOption[] = [
    { id: "banner", group: "Basic", size: SIZE_BANNER },
    { id: "card", group: "Basic", size: SIZE_CARD },
  ];
  for (const g of PLACEMENT_GROUPS) {
    for (const p of CREATIVE_PLACEMENTS.filter((x) => x.group === g)) {
      out.push({ id: p.id, group: PLACEMENT_GROUP_LABELS[g], size: { w: p.width, h: p.height, label: p.label } });
    }
  }
  return out;
}

export function sizeOptionById(id: string): SizeOption | null {
  return sizeOptions().find((o) => o.id === id) ?? null;
}

/** Validate an owner-typed custom size. */
export function checkCustomSize(w: number, h: number): { ok: true; size: BrandSize } | { ok: false; error: string } {
  if (!Number.isFinite(w) || !Number.isFinite(h)) return { ok: false, error: "Type a width and a height in pixels." };
  const W = Math.round(w);
  const H = Math.round(h);
  if (W < SIZE_MIN_PX || H < SIZE_MIN_PX) return { ok: false, error: `Each side must be at least ${SIZE_MIN_PX}px.` };
  if (W > SIZE_MAX_PX || H > SIZE_MAX_PX) return { ok: false, error: `Each side must be ${SIZE_MAX_PX}px or less.` };
  if (W / H < CARD_RATIO_MIN) return { ok: false, error: `Too tall and thin — the height can be at most ${1 / CARD_RATIO_MIN}× the width.` };
  if (W / H > DESKTOP_REF_PX / BANNER_H_MIN) return { ok: false, error: "Too wide and short for the designer." };
  return { ok: true, size: { w: W, h: H, label: `Custom ${W}×${H}` } };
}

/** Normalise a stored size (brand.kit JSON). Bad → undefined (= classic behaviour). */
export function normalizeSize(raw: unknown): BrandSize | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const c = checkCustomSize(Number(r.w), Number(r.h));
  if (!c.ok) return undefined;
  const label = typeof r.label === "string" && r.label.trim() ? r.label.trim().slice(0, 80) : c.size.label;
  return { ...c.size, label };
}

export function sizeFrame(size: BrandSize): "card" | "banner" {
  const r = size.w / size.h;
  return r >= CARD_RATIO_MIN && r <= CARD_RATIO_MAX ? "card" : "banner";
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** A fresh design shaped for this size (used when the owner ticks "design it"). */
export function newDesignForSize(size: BrandSize): BannerDesign {
  return applySize(sizeFrame(size) === "card" ? cardDesign({ ratio: size.w / size.h, subtitle: true }) : defaultDesign("section"), size);
}

/** Reshape an existing design's frame to this size (keeps every layer). */
export function applySize(design: BannerDesign, size: BrandSize): BannerDesign {
  const ratio = r4(size.w / size.h);
  if (sizeFrame(size) === "card") {
    return { ...design, frame: { ...design.frame, card: { ratio, ratioMobile: ratio } } };
  }
  const height = clamp(Math.round(DESKTOP_REF_PX / ratio), BANNER_H_MIN, BANNER_H_MAX);
  const { card: _drop, ...rest } = design.frame;
  void _drop;
  return { ...design, frame: { ...rest, height } };
}

/**
 * A "still" copy for a picture: no entrance animations, no intro curtain, no
 * reveal wait (so nothing renders hidden), and square corners (the place the
 * picture goes rounds it if it wants to).
 */
export function stillDesign(design: BannerDesign): BannerDesign {
  const out: BannerDesign = {
    ...design,
    enabled: true,
    frame: { ...design.frame, radius: 0 },
    boxes: design.boxes.map((b) => stripEnter(b)),
    buttons: design.buttons.map((b) => stripEnter(b)),
  };
  if (design.elements) out.elements = design.elements.map((e) => stripEnter(e));
  delete out.intro;
  delete out.reveal;
  return out;
}

function stripEnter<T extends object>(item: T): T {
  if (!("enter" in item)) return item;
  const copy = { ...item } as T & { enter?: unknown };
  delete copy.enter;
  return copy;
}

export type ExportPlan = { renderW: number; renderH: number; scale: number; outW: number; outH: number };

/**
 * How to rasterise a design. The PNG size follows the design's ACTUAL shape
 * (the owner may have reshaped it in the studio); the target width comes from
 * the saved size (or a sensible default).
 */
export function exportPlan(design: BannerDesign, size?: BrandSize): ExportPlan {
  const c = design.frame.card;
  let renderW: number;
  let renderH: number;
  let targetW: number;
  if (c) {
    renderW = CARD_RENDER_PX;
    renderH = Math.round(CARD_RENDER_PX / c.ratio);
    targetW = size?.w ?? SIZE_CARD.w;
  } else {
    renderW = DESKTOP_REF_PX;
    renderH = design.frame.height;
    targetW = size?.w ?? SIZE_BANNER.w;
  }
  let scale = targetW / renderW;
  if (renderW * renderH * scale * scale > EXPORT_MAX_PIXELS) scale = Math.sqrt(EXPORT_MAX_PIXELS / (renderW * renderH));
  scale = r4(scale);
  return { renderW, renderH, scale, outW: Math.round(renderW * scale), outH: Math.round(renderH * scale) };
}

/** Safe file name: "grand-opening-1600x560.png". */
export function exportFilename(name: string, plan: Pick<ExportPlan, "outW" | "outH">): string {
  const slug =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "brand-design";
  return `${slug}-${plan.outW}x${plan.outH}.png`;
}

/** Media Library folders a finished picture can go to (taxonomy purpose ids). */
export const EXPORT_FOLDERS: { id: string; label: string }[] = [
  { id: "merch", label: "Merch (greenwaymerch.com)" },
  { id: "banner", label: "Section banner" },
  { id: "blog", label: "Blog" },
  { id: "newsletter", label: "Newsletter" },
  { id: "other", label: "Other" },
];

export function __runBrandSizesTests(): { passed: number; failed: number; failures: string[] } {
  let passed = 0;
  const failures: string[] = [];
  const ok = (c: boolean, m: string) => (c ? passed++ : failures.push(m));

  const opts = sizeOptions();
  ok(opts[0].id === "banner" && opts[1].id === "card", "basic shapes first");
  ok(opts.length === CREATIVE_PLACEMENTS.length + 2, "every placement offered");
  ok(new Set(opts.map((o) => o.id)).size === opts.length, "unique option ids");
  ok(sizeOptionById("social-square")?.size.w === 1080, "lookup social square");

  ok(sizeFrame({ w: 1080, h: 1920, label: "" }) === "card", "story → card");
  ok(sizeFrame({ w: 1600, h: 560, label: "" }) === "banner", "section → banner");
  ok(sizeFrame({ w: 1200, h: 630, label: "" }) === "card", "OG 1.9 → card");

  ok(!checkCustomSize(10, 500).ok, "too small rejected");
  ok(!checkCustomSize(100, 1000).ok, "too thin rejected");
  ok(!checkCustomSize(7000, 1000).ok, "too big rejected");
  const cs = checkCustomSize(1200.4, 400);
  ok(cs.ok && cs.size.w === 1200 && cs.size.label === "Custom 1200×400", "custom ok + rounded");

  ok(normalizeSize(null) === undefined && normalizeSize({ w: 1, h: 1 }) === undefined, "normalize bad");
  ok(normalizeSize({ w: 1080, h: 1080, label: "Square" })?.label === "Square", "normalize keeps label");

  const card = newDesignForSize({ w: 1080, h: 1350, label: "" });
  ok(card.frame.card?.ratio === 0.8, "new card ratio 0.8");
  const ban = newDesignForSize(SIZE_BANNER);
  ok(!ban.frame.card && ban.frame.height === Math.round(DESKTOP_REF_PX / (1600 / 560)), "new banner height");
  const back = applySize(card, SIZE_BANNER);
  ok(!back.frame.card && back.boxes.length === card.boxes.length, "card → banner keeps layers");

  const animated = { ...ban, intro: { kind: "fade" }, reveal: 2, boxes: ban.boxes.map((b) => ({ ...b, enter: { fx: "rise" } })) } as unknown as BannerDesign;
  const still = stillDesign(animated);
  ok(!("intro" in still) && !("reveal" in still), "still drops intro/reveal");
  ok(still.boxes.every((b) => !("enter" in b)) && still.frame.radius === 0, "still drops enters + square");
  ok("enter" in animated.boxes[0], "still does not mutate input");

  const p1 = exportPlan(ban, SIZE_BANNER);
  ok(p1.renderW === DESKTOP_REF_PX && p1.outW === 1600 && Math.abs(p1.outH - 560) <= 2, "banner plan ≈1600×560");
  const p2 = exportPlan(card, { w: 1080, h: 1350, label: "" });
  ok(p2.outW === 1080 && p2.outH === 1350, "card plan exact");
  const p3 = exportPlan(card, { w: 6000, h: 7500, label: "" });
  ok(p3.outW * p3.outH <= EXPORT_MAX_PIXELS * 1.01, "pixel cap");

  ok(exportFilename("Grand Opening!", { outW: 1600, outH: 560 }) === "grand-opening-1600x560.png", "filename");
  ok(exportFilename("***", { outW: 1, outH: 1 }) === "brand-design-1x1.png", "filename fallback");
  ok(EXPORT_FOLDERS[0].id === "merch", "merch folder default");
  return { passed, failed: failures.length, failures };
}
