/**
 * studio-widths-core — D234 slice C-2 (SOP-11b, G-97 / G-98; F-11-22 /
 * F-11-24). Pure.
 *
 * Before C-2 the studio showed a banner at only two widths (1408 computer,
 * 390 phone; `frameRefPx`), while visitors see it at every width in between.
 * The banner's height and text use `interpPx` (a clamp between those two
 * widths), so the shape changes at each width (SOP-11b Appendix B.3). These
 * rules let the canvas lay the banner out at any real width with the SAME
 * formula, list the widths the site really uses, and build the link that opens
 * the real page in Website Sync (right size, Move mode on).
 *
 * Banner width = the page's content width. Home and Shop: `max-w-[88rem]`
 * (1408) inside `px-4 md:px-8` (`Hero.tsx` L94–96; the Shop is capped to the
 * same 1408 in slice C-3, Q-11-12, `ShopBannerCarousel.tsx`); Specials and Loyalty: 1408 − 2×32 = 1344
 * (`SpecialsContent.tsx` L531, `LoyaltySignupForm.tsx` L144). Below 768 px the
 * page margin is 16 px a side, and the banner uses its phone layout
 * (`@container gwb (max-width: 767px)`, MOBILE_BREAKPOINT_PX).
 */
import { DESKTOP_REF_PX, MOBILE_BREAKPOINT_PX, MOBILE_REF_PX, frameRefPx, type BannerDesign, type DesignDevice } from "./banner-design-core";

export type WidthStop = { w: number; label: string; device: DesignDevice };

/** Banner widths the site really shows (see the header for where each comes from). */
export const WIDTH_STOPS: readonly WidthStop[] = [
  { w: 1408, label: "Home & Shop, full width", device: "desktop" },
  { w: 1344, label: "Specials & Loyalty, full width", device: "desktop" },
  { w: 1216, label: "1280 px laptop", device: "desktop" },
  { w: 960, label: "1024 px laptop", device: "desktop" },
  { w: 770, label: "Tablet (834)", device: "desktop" },
  { w: 398, label: "Big phone (430)", device: "mobile" },
  { w: 358, label: "Phone (390)", device: "mobile" },
  { w: 328, label: "Small phone (360)", device: "mobile" },
];

export const MIN_STUDIO_WIDTH = 320;
export const MAX_STUDIO_WIDTH = 1920;

/** The banner width on a screen of `screenPx` (home / Shop placement). */
export function bannerWidthForScreen(screenPx: number, maxPx = DESKTOP_REF_PX): number {
  const pad = screenPx >= MOBILE_BREAKPOINT_PX ? 64 : 32;
  return Math.max(0, Math.min(maxPx, screenPx - pad));
}

/** The layout a banner of this width uses (same rule as the container query). */
export function layoutForWidth(w: number): DesignDevice {
  return w < MOBILE_BREAKPOINT_PX ? "mobile" : "desktop";
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** `interpPx(mobilePx, desktopPx)` evaluated at a banner width (same math, same rounding of the slope). */
export function fluidPxAt(mobilePx: number, desktopPx: number, w: number): number {
  if (mobilePx === desktopPx) return desktopPx;
  const lo = Math.min(mobilePx, desktopPx);
  const hi = Math.max(mobilePx, desktopPx);
  const slope = r4((desktopPx - mobilePx) / (DESKTOP_REF_PX - MOBILE_REF_PX));
  return Math.min(hi, Math.max(lo, mobilePx + slope * (w - MOBILE_REF_PX)));
}

/**
 * Canvas layout size. `width` null = the reference size (today's behaviour,
 * unchanged). Card designs always use their own reference (cards sit in grids
 * of many widths; the slider is for banners).
 */
export function canvasRefPx(design: Pick<BannerDesign, "frame">, device: DesignDevice, width: number | null | undefined): { w: number; h: number } {
  if (!width || design.frame.card) return frameRefPx(design, device);
  const w = Math.round(Math.min(MAX_STUDIO_WIDTH, Math.max(MIN_STUDIO_WIDTH, width)));
  // D234 C-3: Scale mode keeps the design's shape (1408 × height / 390 × phone height).
  if (design.frame.scale) return { w, h: Math.round(device === "mobile" ? (w * design.frame.heightMobile) / MOBILE_REF_PX : (w * design.frame.height) / DESKTOP_REF_PX) };
  return { w, h: Math.round(fluidPxAt(design.frame.heightMobile, design.frame.height, w)) };
}

/** The public page an admin editor's banners appear on (null = no single page, e.g. Branding). */
export function livePathForAdmin(adminPath: string): string | null {
  const p = adminPath.replace(/\/+$/, "");
  if (p === "/admin/pages/home") return "/";
  if (p === "/admin/specials") return "/specials";
  if (p === "/admin/loyalty-page") return "/loyalty";
  if (p === "/admin/content/shop-banner") return "/menu";
  const m = /^\/admin\/pages\/([a-z0-9-]+)$/.exec(p);
  if (m) return m[1] === "vendors" ? "/vendor-delivery" : `/${m[1]}`;
  return null;
}

export type PreviewDevice = "desktop" | "tablet" | "phone";

/** Website Sync → Live preview at that page and size, Move mode on. */
export function realPageHref(livePath: string, device: PreviewDevice): string {
  const q = new URLSearchParams({ tab: "preview", path: livePath, device, move: "1" });
  return `/admin/website-sync?${q.toString()}`;
}

/** The preview size that matches a studio width (phone layout → Phone; under 1100 → Tablet). */
export function previewDeviceForWidth(w: number | null, device: DesignDevice): PreviewDevice {
  if (device === "mobile" || (w !== null && w < MOBILE_BREAKPOINT_PX)) return "phone";
  if (w !== null && w < 1100) return "tablet";
  return "desktop";
}

export function parsePreviewDevice(v: unknown): PreviewDevice | undefined {
  return v === "desktop" || v === "tablet" || v === "phone" ? v : undefined;
}

export function __runStudioWidthsCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL studio-widths-core: ${m}`);
    }
  };
  // SOP-11b Appendix B.3 (home 1408×360, phone 200): 1216 → 330, 1024 → 300, 768 → 259.
  ok(Math.round(fluidPxAt(200, 360, 1216)) === 330, "B.3 1216 → 330");
  ok(Math.round(fluidPxAt(200, 360, 1024)) === 300, "B.3 1024 → 300");
  ok(Math.round(fluidPxAt(200, 360, 768)) === 259, "B.3 768 → 259");
  ok(fluidPxAt(200, 360, 1920) === 360 && fluidPxAt(200, 360, 300) === 200, "clamped at both ends");
  ok(fluidPxAt(240, 240, 900) === 240, "flat size");
  const d = { frame: { height: 360, heightMobile: 200, radius: 16 } };
  ok(canvasRefPx(d, "desktop", null).w === DESKTOP_REF_PX && canvasRefPx(d, "desktop", null).h === 360, "no width = reference (unchanged)");
  ok(canvasRefPx(d, "mobile", undefined).w === MOBILE_REF_PX && canvasRefPx(d, "mobile", null).h === 200, "phone reference unchanged");
  ok(canvasRefPx(d, "desktop", 1216).w === 1216 && canvasRefPx(d, "desktop", 1216).h === 330, "width 1216");
  ok(canvasRefPx(d, "desktop", 5000).w === MAX_STUDIO_WIDTH, "width clamped");
  const card = { frame: { height: 200, heightMobile: 160, radius: 16, card: { ratio: 0.75, ratioMobile: 0.75 } } };
  ok(canvasRefPx(card, "desktop", 1216).w === frameRefPx(card, "desktop").w, "cards ignore the slider");
  const sc = { frame: { ...d.frame, scale: true as const } };
  ok(canvasRefPx(sc, "desktop", 704).h === 180 && canvasRefPx(sc, "mobile", 351).h === 180, "C-3: scale keeps the shape at any width");
  ok(canvasRefPx(sc, "desktop", null).h === 360, "C-3: scale reference = design height");
  ok(bannerWidthForScreen(1280) === 1216 && bannerWidthForScreen(1920) === 1408 && bannerWidthForScreen(390) === 358 && bannerWidthForScreen(834) === 770, "screen → banner width");
  ok(WIDTH_STOPS.every((s) => layoutForWidth(s.w) === s.device), "each stop's layout matches the container query");
  ok(WIDTH_STOPS.some((s) => s.w === 1344) && WIDTH_STOPS.some((s) => s.w === 1408), "both full-width placements listed");
  ok(livePathForAdmin("/admin/pages/home") === "/" && livePathForAdmin("/admin/content/shop-banner") === "/menu", "home + shop");
  ok(livePathForAdmin("/admin/specials") === "/specials" && livePathForAdmin("/admin/loyalty-page/") === "/loyalty", "specials + loyalty");
  ok(livePathForAdmin("/admin/pages/about") === "/about" && livePathForAdmin("/admin/pages/vendors") === "/vendor-delivery", "pages");
  ok(livePathForAdmin("/admin/settings/branding") === null, "Branding has no single page");
  const h = realPageHref("/menu", "phone");
  ok(h.startsWith("/admin/website-sync?") && h.includes("tab=preview") && h.includes("path=%2Fmenu") && h.includes("device=phone") && h.includes("move=1"), "real page link");
  ok(previewDeviceForWidth(null, "mobile") === "phone" && previewDeviceForWidth(960, "desktop") === "tablet" && previewDeviceForWidth(1408, "desktop") === "desktop" && previewDeviceForWidth(null, "desktop") === "desktop", "preview size");
  ok(parsePreviewDevice("tablet") === "tablet" && parsePreviewDevice("x") === undefined, "parse device");
  return { passed, failed };
}
