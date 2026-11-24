/**
 * src/lib/merch-studio/art-prep-core.ts
 *
 * D267 - Merch Studio "Artwork from library + Prep for Printful". PURE.
 *   - libraryArt(): logos first (Brand kit + Media usage logo/brand-logo/
 *     vendor-logo), then the rest of the library, de-duplicated by URL.
 *   - printVerdict(): effective DPI of a picture at the placement size vs
 *     Printful's 150 minimum / 300 ideal.
 *   - printUpscalePlan(): the pixel size to enlarge to so the art prints at
 *     300 DPI across the placement (capped per pass and overall, never shrinks).
 */
import { DPI_IDEAL, DPI_MIN } from "./print-rules-core";

export type ArtChoice = { id: string; url: string; title: string; logo: boolean; source: "brand" | "media" };
export type MediaLike = { id: string; url: string; title: string; usageType?: string | null; mimeType?: string | null };
export type BrandLogoLike = { id: string; name: string; src: string };

export const PREP_MAX_SIDE = 8000; // keeps the result well under Printful's file limits
export const PREP_MAX_PASS = 4; // never enlarge more than 4x in one go (quality)

const LOGO_USAGE = new Set(["logo", "vendor-logo", "brand-logo"]);
const PRINTABLE = /^image\/(png|jpeg|webp|svg\+xml)$/i;

export function libraryArt(media: MediaLike[], brandLogos: BrandLogoLike[]): ArtChoice[] {
  const seen = new Set<string>();
  const out: ArtChoice[] = [];
  const push = (c: ArtChoice) => {
    if (!c.url || seen.has(c.url)) return;
    seen.add(c.url);
    out.push(c);
  };
  for (const b of brandLogos) push({ id: `brand:${b.id}`, url: b.src, title: b.name || "Brand logo", logo: true, source: "brand" });
  const ok = media.filter((m) => !m.mimeType || PRINTABLE.test(m.mimeType));
  for (const m of ok) if (LOGO_USAGE.has((m.usageType ?? "").toLowerCase())) push({ id: m.id, url: m.url, title: m.title, logo: true, source: "media" });
  for (const m of ok) push({ id: m.id, url: m.url, title: m.title, logo: false, source: "media" });
  return out;
}

export type PrintVerdict = { dpi: number; level: "ideal" | "ok" | "low"; text: string };
export function printVerdict(pxW: number, pxH: number, wIn: number, hIn: number, vector = false): PrintVerdict {
  if (vector) return { dpi: Infinity, level: "ideal", text: "Vector (SVG) - prints sharp at any size." };
  if (!(pxW > 0 && pxH > 0 && wIn > 0 && hIn > 0)) return { dpi: 0, level: "low", text: "The picture size could not be read." };
  // Fit inside the placement keeping the aspect ratio, like the canvas does.
  const scale = Math.min(wIn / pxW, hIn / pxH);
  const dpi = Math.round(1 / scale);
  if (dpi >= DPI_IDEAL) return { dpi, level: "ideal", text: `${dpi} DPI at full size - ideal for Printful.` };
  if (dpi >= DPI_MIN) return { dpi, level: "ok", text: `${dpi} DPI at full size - prints, but enlarge to 300 DPI for crisp edges.` };
  return { dpi, level: "low", text: `${dpi} DPI at full size - too low (Printful needs 150+). Enlarge it, or print it smaller.` };
}

export type UpscalePlan = { ok: true; width: number; height: number; factor: number } | { ok: false; error: string };
export function printUpscalePlan(pxW: number, pxH: number, wIn: number, hIn: number): UpscalePlan {
  if (!(pxW > 0 && pxH > 0 && wIn > 0 && hIn > 0)) return { ok: false, error: "The picture size could not be read." };
  const scale = Math.min(wIn / pxW, hIn / pxH); // inches per px at full fit
  const want = 1 / scale / DPI_IDEAL; // <1 means it needs enlarging
  if (want >= 1) return { ok: false, error: "Already 300 DPI or better at this size - no enlarging needed." };
  let factor = Math.min(1 / want, PREP_MAX_PASS);
  factor = Math.min(factor, PREP_MAX_SIDE / Math.max(pxW, pxH));
  if (factor <= 1.01) return { ok: false, error: "The picture is already as large as we can make it." };
  return { ok: true, width: Math.round(pxW * factor), height: Math.round(pxH * factor), factor: Math.round(factor * 100) / 100 };
}

export function __runArtPrepTests(): { passed: number; failed: number; failures: string[] } {
  let passed = 0;
  const failures: string[] = [];
  const t = (name: string, cond: boolean) => (cond ? passed++ : failures.push(name));
  const media: MediaLike[] = [
    { id: "a", url: "https://x/a.jpg", title: "Photo", usageType: "product", mimeType: "image/jpeg" },
    { id: "b", url: "https://x/b.png", title: "Logo", usageType: "logo", mimeType: "image/png" },
    { id: "c", url: "https://x/c.gif", title: "Gif", usageType: "logo", mimeType: "image/gif" },
    { id: "d", url: "https://x/d.png", title: "Vendor", usageType: "Vendor-Logo", mimeType: "image/png" },
  ];
  const art = libraryArt(media, [{ id: "k", name: "Kit", src: "/brand/x.png" }, { id: "dup", name: "Dup", src: "https://x/b.png" }]);
  t("brand first", art[0]?.source === "brand" && art[0].logo);
  t("dedupe by url", art.filter((a) => a.url === "https://x/b.png").length === 1);
  t("gif excluded", !art.some((a) => a.id === "c"));
  t("vendor logo flagged (case-insensitive)", art.find((a) => a.id === "d")?.logo === true);
  t("photo not logo", art.find((a) => a.id === "a")?.logo === false);
  t("logos before photos", art.findIndex((a) => a.id === "d") < art.findIndex((a) => a.id === "a"));
  t("count", art.length === 4);
  t("empty", libraryArt([], []).length === 0);
  t("verdict ideal", printVerdict(3600, 3600, 12, 12).level === "ideal");
  t("verdict ok", printVerdict(2400, 2400, 12, 12).level === "ok");
  t("verdict low", printVerdict(1000, 1000, 12, 12).level === "low");
  t("verdict dpi", printVerdict(1200, 600, 12, 16).dpi === 100);
  t("verdict vector", printVerdict(0, 0, 12, 12, true).level === "ideal");
  t("verdict bad size", printVerdict(0, 10, 12, 12).level === "low");
  const p = printUpscalePlan(1200, 1200, 12, 12);
  t("plan 3x", p.ok && p.width === 3600 && p.height === 3600);
  const q = printUpscalePlan(500, 250, 12, 16);
  t("plan capped 4x", q.ok && q.factor === 4 && q.width === 2000);
  t("plan none when ideal", !printUpscalePlan(3600, 3600, 12, 12).ok);
  const big = printUpscalePlan(7000, 100, 30, 1);
  t("plan side cap", !big.ok || big.width <= PREP_MAX_SIDE);
  t("plan bad size", !printUpscalePlan(0, 0, 12, 12).ok);
  const small = printUpscalePlan(600, 600, 3, 3);
  t("plan small placement", small.ok && small.width === 900);
  return { passed, failed: failures.length, failures };
}
