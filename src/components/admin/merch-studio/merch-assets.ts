"use client";

/**
 * R70 S2 - browser-only helpers for the Merch Studio design canvas.
 *
 *  - Artwork files live in THIS browser's IndexedDB (`gw-merch-assets`), keyed
 *    by asset id; nothing is uploaded yet. Slice 4 moves approved art to
 *    Supabase Storage when a design is listed for sale.
 *  - Drafts (small JSON) live in localStorage (`gw-merch-designs-v1`).
 *  - Text is MEASURED with the real font stack in a hidden DOM node, so the
 *    canvas box and every inch readout match the rendered glyphs.
 */
import { analyzePixels, normalizeDesign, type MerchDesign, type PixelAnalysis } from "@/lib/merch-studio/merch-design-core";

const DB = "gw-merch-assets";
const STORE = "blobs";
export const DESIGNS_KEY = "gw-merch-designs-v1";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function putAsset(id: string, blob: Blob): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
export async function getAsset(id: string): Promise<Blob | null> {
  const db = await open();
  const out = await new Promise<Blob | null>((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return out;
}

export function loadDesigns(): MerchDesign[] {
  try {
    const raw = window.localStorage.getItem(DESIGNS_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown[]) : [];
    return (Array.isArray(arr) ? arr : []).map(normalizeDesign).filter((d): d is MerchDesign => !!d);
  } catch {
    return [];
  }
}
/** Returns false when the browser refused (storage full / blocked). */
export function saveDesigns(list: MerchDesign[]): boolean {
  try {
    window.localStorage.setItem(DESIGNS_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** Width (em) of each line rendered in `stack` - multiply by font size (in) for inches. */
export function measureLinesEm(lines: string[], stack: string, weight: number, italic: boolean, letterSpacingEm: number): number[] {
  if (typeof document === "undefined") return lines.map((l) => l.length * 0.6);
  const span = document.createElement("span");
  span.style.cssText = `position:absolute;left:-99999px;top:0;white-space:pre;visibility:hidden;font-size:100px;line-height:1;font-family:${stack};font-weight:${weight};font-style:${italic ? "italic" : "normal"};letter-spacing:${letterSpacingEm}em`;
  document.body.appendChild(span);
  const out = lines.map((l) => {
    span.textContent = l || " ";
    return span.getBoundingClientRect().width / 100;
  });
  span.remove();
  return out;
}

/** Natural size + colour analysis of an image file (downscaled to <= 256 px for speed). */
export function inspectImage(url: string, isSvg: boolean): Promise<{ w: number; h: number; analysis: PixelAnalysis }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth; let h = img.naturalHeight;
      if (isSvg && (!w || !h)) { w = 1000; h = 1000; }
      const k = Math.min(1, 256 / Math.max(w, h));
      const cw = Math.max(1, Math.round(w * k)); const ch = Math.max(1, Math.round(h * k));
      const c = document.createElement("canvas");
      c.width = cw; c.height = ch;
      const ctx = c.getContext("2d");
      let analysis: PixelAnalysis = { coverage: 1, distinct: 0, colors: [], photoLikely: false };
      if (ctx) {
        ctx.drawImage(img, 0, 0, cw, ch);
        try { analysis = analyzePixels(ctx.getImageData(0, 0, cw, ch).data); } catch { /* tainted canvas: keep defaults */ }
      }
      resolve({ w, h, analysis });
    };
    img.onerror = () => reject(new Error("Could not read that image."));
    img.src = url;
  });
}
