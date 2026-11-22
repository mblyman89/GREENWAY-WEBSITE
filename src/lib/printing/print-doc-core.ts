/**
 * D263 S7 — multi-page print documents (front/back, multi-page flyers) and
 * home-print sheets (N-up with cut marks, Avery-style business card stock).
 * Pure: geometry in PDF points (72/in, origin bottom-left) and page helpers.
 */
import type { BannerDesign, DesignPrint } from "@/lib/cms/banner-design-core";

export type PrintPage = { label: string; design: BannerDesign; imageSrc: string };
export const MAX_PAGES = 12;

const PT = 72;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function pageLabel(i: number, total: number): string {
  if (total === 2) return i === 0 ? "Front" : "Back";
  return `Page ${i + 1}`;
}

/** Relabel the default names after adding/removing (custom names are kept). */
export function relabel(pages: PrintPage[]): PrintPage[] {
  const auto = /^(Front|Back|Page \d+)$/;
  return pages.map((p, i) => (auto.test(p.label) ? { ...p, label: pageLabel(i, pages.length) } : p));
}

export function addPage(pages: PrintPage[], at: number, page: PrintPage): PrintPage[] {
  if (pages.length >= MAX_PAGES) return pages;
  const out = [...pages];
  out.splice(Math.max(0, Math.min(out.length, at)), 0, page);
  return relabel(out);
}

export function removePage(pages: PrintPage[], i: number): PrintPage[] {
  if (pages.length <= 1) return pages;
  return relabel(pages.filter((_, k) => k !== i));
}

export function movePage(pages: PrintPage[], i: number, dir: -1 | 1): PrintPage[] {
  const j = i + dir;
  if (j < 0 || j >= pages.length) return pages;
  const out = [...pages];
  [out[i], out[j]] = [out[j], out[i]];
  return relabel(out);
}

/** A blank page in the same size/style family as `like` (keeps print size, clears content). */
export function blankLike(like: BannerDesign): BannerDesign {
  const d: BannerDesign = { ...like, boxes: [], buttons: [] };
  delete d.elements;
  delete d.order;
  delete d.smoke;
  return d;
}

// -- Sheets ------------------------------------------------------------------

export type SheetKind = "cut" | "avery";
export type SheetCell = { x: number; y: number; w: number; h: number; trim: { x: number; y: number; w: number; h: number } };
export type SheetLayout = { pageW: number; pageH: number; cols: number; rows: number; cells: SheetCell[]; marks: { x1: number; y1: number; x2: number; y2: number }[]; clip: boolean; note: string };

const LETTER = { w: 8.5, h: 11 };

/** Avery 8371 / 8869 / 5371 / 28371 business card stock: 2 x 5 cards, 3.5" x 2", 0.75" side, 0.5" top margins, no gaps. */
export function isAveryCard(print: DesignPrint): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.02;
  return (near(print.w, 3.5) && near(print.h, 2)) || (near(print.w, 2) && near(print.h, 3.5));
}

/**
 * How many copies fit on Letter and where. `back` mirrors the columns so a
 * long-edge duplex print lines the backs up with the fronts.
 */
export function sheetLayout(print: DesignPrint, kind: SheetKind, back = false): SheetLayout | null {
  if (kind === "avery") {
    if (!isAveryCard(print)) return null;
    const tall = print.h > print.w;
    const pageW = (tall ? LETTER.h : LETTER.w) * PT;
    const pageH = (tall ? LETTER.w : LETTER.h) * PT;
    const cols = tall ? 5 : 2;
    const rows = tall ? 2 : 5;
    const mx = tall ? 0.5 : 0.75;
    const my = tall ? 0.75 : 0.5;
    const cells: SheetCell[] = [];
    for (let r = 0; r < rows; r += 1)
      for (let c = 0; c < cols; c += 1) {
        const cc = back ? cols - 1 - c : c;
        const tx = (mx + cc * print.w) * PT;
        const ty = pageH - (my + (r + 1) * print.h) * PT;
        const b = print.bleed * PT;
        cells.push({ x: r2(tx - b), y: r2(ty - b), w: r2((print.w + 2 * print.bleed) * PT), h: r2((print.h + 2 * print.bleed) * PT), trim: { x: r2(tx), y: r2(ty), w: r2(print.w * PT), h: r2(print.h * PT) } });
      }
    return { pageW, pageH, cols, rows, cells, marks: [], clip: true, note: `Avery 8371 / 8869 / 5371 layout, ${cols * rows} cards per sheet. Print at "Actual size" (100%), not "Fit".` };
  }
  // Cut sheet: copies with full bleed, a gutter between them, crop marks in the margins.
  const margin = 0.5;
  const gutter = Math.max(0.125, 2 * print.bleed + 0.0625);
  const cw = print.w + 2 * print.bleed;
  const ch = print.h + 2 * print.bleed;
  const fit = (W: number, H: number) => ({ cols: Math.floor((W - 2 * margin + gutter) / (cw + gutter)), rows: Math.floor((H - 2 * margin + gutter) / (ch + gutter)) });
  const p = fit(LETTER.w, LETTER.h);
  const l = fit(LETTER.h, LETTER.w);
  const land = l.cols * l.rows > p.cols * p.rows;
  const { cols, rows } = land ? l : p;
  if (cols < 1 || rows < 1 || cols * rows < 2) return null;
  const pageW = (land ? LETTER.h : LETTER.w) * PT;
  const pageH = (land ? LETTER.w : LETTER.h) * PT;
  const gridW = (cols * cw + (cols - 1) * gutter) * PT;
  const gridH = (rows * ch + (rows - 1) * gutter) * PT;
  const ox = (pageW - gridW) / 2;
  const oy = (pageH - gridH) / 2;
  const cells: SheetCell[] = [];
  const xs = new Set<number>();
  const ys = new Set<number>();
  for (let r = 0; r < rows; r += 1)
    for (let c = 0; c < cols; c += 1) {
      const cc = back ? cols - 1 - c : c;
      const x = ox + cc * (cw + gutter) * PT;
      const y = oy + (rows - 1 - r) * (ch + gutter) * PT;
      const b = print.bleed * PT;
      const trim = { x: r2(x + b), y: r2(y + b), w: r2(print.w * PT), h: r2(print.h * PT) };
      xs.add(trim.x).add(r2(trim.x + trim.w));
      ys.add(trim.y).add(r2(trim.y + trim.h));
      cells.push({ x: r2(x), y: r2(y), w: r2(cw * PT), h: r2(ch * PT), trim });
    }
  // Crop marks: every trim line, drawn in the outer margin only (never over artwork).
  const len = 0.25 * PT;
  const gap = 0.0625 * PT;
  const marks: SheetLayout["marks"] = [];
  const left = ox - gap;
  const right = ox + gridW + gap;
  const bottom = oy - gap;
  const top = oy + gridH + gap;
  for (const x of xs) marks.push({ x1: x, y1: r2(bottom), x2: x, y2: r2(bottom - len) }, { x1: x, y1: r2(top), x2: x, y2: r2(top + len) });
  for (const y of ys) marks.push({ x1: r2(left), y1: y, x2: r2(left - len), y2: y }, { x1: r2(right), y1: y, x2: r2(right + len), y2: y });
  return { pageW, pageH, cols, rows, cells, marks, clip: false, note: `${cols * rows} per Letter sheet with cut marks. Print at "Actual size" (100%), then cut along the marks.` };
}

export function __runPrintDocTests(): { passed: number; failed: number; failures: string[] } {
  let passed = 0;
  const failures: string[] = [];
  const ok = (c: boolean, m: string) => (c ? passed++ : failures.push(m));
  const d = { v: 1 } as unknown as BannerDesign;
  const pg = (label: string): PrintPage => ({ label, design: d, imageSrc: "" });
  let pages = [pg("Front")];
  pages = addPage(pages, 1, pg("Page 2"));
  ok(pages.map((p) => p.label).join() === "Front,Back", "front/back labels");
  pages = addPage(pages, 2, pg("x"));
  ok(pages.map((p) => p.label).join() === "Page 1,Page 2,x", `3 pages ${pages.map((p) => p.label)}`);
  ok(removePage(pages, 2).map((p) => p.label).join() === "Front,Back", "remove relabels");
  ok(movePage(pages, 0, 1)[1].label === "Page 2", "move");
  ok(removePage([pg("Front")], 0).length === 1, "keeps last page");
  const card: DesignPrint = { w: 3.5, h: 2, bleed: 0.055, safe: 0.125 };
  const av = sheetLayout(card, "avery")!;
  ok(av.cells.length === 10 && av.clip && av.cells[0].trim.x === 54 && av.cells[0].trim.y === 792 - 36 - 144, `avery ${JSON.stringify(av.cells[0])}`);
  ok(sheetLayout(card, "avery", true)!.cells[0].trim.x === 54 + 252, "avery back mirrored");
  ok(sheetLayout({ w: 4, h: 6, bleed: 0.125, safe: 0.25 }, "avery") === null, "avery only for 3.5x2");
  const cut = sheetLayout(card, "cut")!;
  ok(cut.cells.length >= 8 && cut.marks.length > 0, `cut ${cut.cells.length}`);
  ok(cut.cells.every((c) => c.x >= 0 && c.y >= 0 && c.x + c.w <= cut.pageW && c.y + c.h <= cut.pageH), "cells on page");
  ok(sheetLayout({ w: 8.5, h: 11, bleed: 0.125, safe: 0.25 }, "cut") === null, "too big for a sheet");
  const st = sheetLayout({ w: 3, h: 3, bleed: 0.125, safe: 0.125 }, "cut")!;
  ok(st.cols * st.rows === 4, `stickers ${st.cols}x${st.rows}`);
  return { passed, failed: failures.length, failures };
}
