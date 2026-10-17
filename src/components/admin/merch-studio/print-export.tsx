"use client";

/**
 * R71 S3 - browser half of the print-file export.
 *
 * Why in the browser: the canvas already has the exact fonts (next/font +
 * owner-uploaded) and the artwork lives in this browser's IndexedDB. The
 * server never sees a half-finished design.
 *
 * Pipeline per file plan (print-export-core.planPrintFiles):
 *   1. React-render <PrintFileSvg> to markup (same MerchElementArt the canvas
 *      uses -> what you saw is what prints).
 *   2. Make it self-contained: CSS font variables are resolved to the real
 *      family names, the matching @font-face rules are inlined as data: URLs,
 *      and every image is inlined as a data: URL (an SVG drawn into a canvas
 *      cannot fetch anything).
 *   3. Draw it on a canvas at plan.pxW x plan.pxH (300 DPI, stepped down only
 *      for the Safari 16.7 MP canvas cap), export PNG, tag it sRGB + pHYs.
 *   4. Measure alpha in row strips (no 67 MB getImageData spike) for the
 *      semi-transparency warning.
 */
import type { ReactElement } from "react";
import { MerchElementArt } from "./MerchCanvas";
import { getAsset } from "./merch-assets";
import { customFontFamily, customFontUrl, isCustomFontId } from "@/lib/cms/custom-font-core";
import { assetIds, type MerchDesign } from "@/lib/merch-studio/merch-design-core";
import { alphaStats, planViewBox, tagPng, type AlphaStats, type PrintFilePlan } from "@/lib/merch-studio/print-export-core";

/** The print file as an SVG in inches (viewBox = trimmed art box). Also used for live previews. */
export function PrintFileSvg({ plan, urls, uid, widthPx, heightPx, className }: { plan: PrintFilePlan; urls: Record<string, string>; uid: string; widthPx?: number; heightPx?: number; className?: string }): ReactElement {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={planViewBox(plan)} width={widthPx} height={heightPx} className={className} preserveAspectRatio="xMidYMid meet">
      {plan.parts.flatMap((pt) => pt.elements.map((e) => (
        <g key={`${pt.placement.id}-${e.id}`} transform={`translate(${pt.dx + e.x} ${pt.dy + e.y}) rotate(${e.rotate} ${e.w / 2} ${e.h / 2})`} opacity={e.opacity / 100}>
          <MerchElementArt e={e} url={e.assetId ? urls[e.assetId] : undefined} uid={`${uid}${pt.placement.id.replace(/[^a-z0-9]/gi, "")}`} />
        </g>
      )))}
    </svg>
  );
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

/** Artwork for a design as data: URLs (missing assets are reported, never silently dropped). */
export async function assetDataUrls(d: MerchDesign): Promise<{ urls: Record<string, string>; missing: string[] }> {
  const urls: Record<string, string> = {}; const missing: string[] = [];
  for (const id of assetIds(d)) {
    const b = await getAsset(id).catch(() => null);
    if (b) urls[id] = await blobToDataUrl(b); else missing.push(id);
  }
  return { urls, missing };
}

const fontCache = new Map<string, string>();
async function inlineFontUrl(u: string): Promise<string> {
  if (fontCache.has(u)) return fontCache.get(u)!;
  const res = await fetch(u, { cache: "force-cache" });
  if (!res.ok) throw new Error(`font ${res.status}`);
  const d = await blobToDataUrl(await res.blob());
  fontCache.set(u, d);
  return d;
}
const unq = (s: string) => s.trim().replace(/^['"]|['"]$/g, "");

/** Split a CSS font-family list into bare family names. */
export function familyList(v: string): string[] {
  return v.split(",").map(unq).filter(Boolean);
}

/** @font-face CSS (fonts as data: URLs) for the given families, from this page's stylesheets + uploaded fonts. */
export async function fontFaceCss(families: ReadonlySet<string>, customFontIds: readonly string[] = []): Promise<{ css: string; warnings: string[] }> {
  const warnings: string[] = [];
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let list: CSSRuleList | null = null;
    try { list = sheet.cssRules; } catch { continue; } // cross-origin sheet
    for (const r of Array.from(list)) {
      if (!(r instanceof CSSFontFaceRule)) continue;
      const fam = unq(r.style.getPropertyValue("font-family"));
      if (!families.has(fam)) continue;
      let css = r.cssText;
      const base = sheet.href ?? location.href;
      for (const m of [...css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)]) {
        if (m[1].startsWith("data:")) continue;
        try { css = css.replace(m[0], `url("${await inlineFontUrl(new URL(m[1], base).href)}")`); } catch { warnings.push(`Font "${fam}" could not be embedded - the PNG may use a fallback font.`); }
      }
      rules.push(css);
    }
  }
  // Owner-uploaded fonts (gwf-<hex>) are injected per page; embed straight from their file.
  for (const id of customFontIds) {
    if (!isCustomFontId(id)) continue;
    const fam = customFontFamily(id);
    const url = customFontUrl(id);
    if (!fam || !url || !families.has(fam) || rules.some((r) => r.includes(fam))) continue;
    try { rules.push(`@font-face{font-family:"${fam}";src:url("${await inlineFontUrl(url)}");font-weight:100 900;font-style:normal}`); } catch { warnings.push(`Uploaded font ${fam} could not be embedded - the PNG may use a fallback font.`); }
  }
  return { css: rules.join("\n"), warnings };
}

/** Insert a <style> right after the opening <svg ...> tag. */
export function injectStyle(svg: string, css: string): string {
  if (!css) return svg;
  const i = svg.indexOf(">");
  return `${svg.slice(0, i + 1)}<style>${css.replace(/</g, "\\3c ")}</style>${svg.slice(i + 1)}`;
}

/**
 * Render a React element into a detached node, resolve CSS font variables on
 * the live DOM (var(--gw-font-x) -> the real family), and serialize it.
 */
async function elementMarkup(el: ReactElement): Promise<{ markup: string; families: Set<string> }> {
  const [{ createRoot }, { flushSync }] = await Promise.all([import("react-dom/client"), import("react-dom")]);
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-99999px;top:0;width:1px;height:1px;overflow:hidden";
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(el));
    const svg = host.querySelector("svg");
    if (!svg) throw new Error("Nothing rendered.");
    const rootStyle = getComputedStyle(document.documentElement);
    const families = new Set<string>();
    svg.querySelectorAll<SVGElement>("[style]").forEach((n) => {
      const ff = n.style.fontFamily;
      if (!ff) return;
      const resolved = ff.replace(/var\((--[a-zA-Z0-9-]+)\)/g, (_m, v: string) => rootStyle.getPropertyValue(v).trim() || "sans-serif");
      n.style.fontFamily = resolved;
      for (const f of familyList(resolved)) families.add(f);
    });
    return { markup: new XMLSerializer().serializeToString(svg), families };
  } finally {
    root.unmount();
    host.remove();
  }
}

/** React element -> standalone SVG markup with fonts embedded. */
export async function standaloneSvg(el: ReactElement, customFontIds: readonly string[] = []): Promise<{ svg: string; warnings: string[] }> {
  const { markup, families } = await elementMarkup(el);
  const { css, warnings } = await fontFaceCss(families, customFontIds);
  return { svg: injectStyle(markup, css), warnings };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The browser couldn't draw this design (SVG failed to load)."));
    img.src = src;
  });
}

export interface RenderedFile { plan: PrintFilePlan; png: Uint8Array; alpha: AlphaStats; warnings: string[] }

/** Render one plan to a tagged PNG. */
export async function renderPlanPng(plan: PrintFilePlan, urls: Record<string, string>): Promise<RenderedFile> {
  const fontIds = [...new Set(plan.parts.flatMap((pt) => pt.elements.map((e) => e.fontId ?? "")).filter(isCustomFontId))];
  const { svg, warnings } = await standaloneSvg(<PrintFileSvg plan={plan} urls={urls} uid="x" widthPx={plan.pxW} heightPx={plan.pxH} />, fontIds);
  const blobUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = await loadImage(blobUrl);
    // Fonts inside SVG-as-image load with the image; one extra frame lets the decoder settle.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const c = document.createElement("canvas");
    c.width = plan.pxW; c.height = plan.pxH;
    const ctx = c.getContext("2d", { willReadFrequently: false });
    if (!ctx) throw new Error("This browser refused to create a canvas that large. Try Chrome on a computer.");
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    // Alpha in strips of 256 rows (bounded memory).
    let acc = { clear: 0, semi: 0, opaque: 0 };
    for (let y = 0; y < c.height; y += 256) {
      const h = Math.min(256, c.height - y);
      const s = alphaStats(ctx.getImageData(0, y, c.width, h).data, 2);
      acc = { clear: acc.clear + s.clear, semi: acc.semi + s.semi, opaque: acc.opaque + s.opaque };
    }
    const inked = acc.semi + acc.opaque;
    const alpha: AlphaStats = { ...acc, semiShare: inked ? Math.round((acc.semi / inked) * 1000) / 1000 : 0 };
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
    c.width = 0; c.height = 0; // release GPU memory now
    if (!blob) throw new Error("The browser couldn't encode the PNG (canvas too large or out of memory).");
    const png = tagPng(new Uint8Array(await blob.arrayBuffer()), plan.dpi);
    if (inked === 0) warnings.push(`${plan.filename}: the file rendered empty. Reload the page and try again (fonts or art may not have loaded).`);
    return { plan, png, alpha, warnings };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/** Trigger a browser download. */
export function downloadBytes(name: string, data: Uint8Array | string, type: string): void {
  const part: BlobPart = typeof data === "string" ? data : (data.slice().buffer as ArrayBuffer);
  const url = URL.createObjectURL(new Blob([part], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Signed PUT to the private merch bucket (same request storage-js uploadToSignedUrl makes). */
export async function putSignedMerchFile(supabaseUrl: string, anonKey: string, bucket: string, key: string, token: string, png: Uint8Array): Promise<void> {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  const body = new FormData();
  body.append("cacheControl", "3600");
  body.append("", new File([png.slice().buffer as ArrayBuffer], key.split("/").pop() || "file.png", { type: "image/png" }));
  const res = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/upload/sign/${bucket}/${encoded}?token=${encodeURIComponent(token)}`, { method: "PUT", body, headers: { apikey: anonKey, "x-upsert": "false" } });
  if (!res.ok) throw new Error(`Upload failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`);
}
