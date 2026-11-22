/**
 * D263 S6 — print export plan (pure). Works out how many pixels to render,
 * what PDF page to build (trim + bleed + room for crop marks), where the
 * crop marks go, and the warn-only checks shown before a download.
 *
 * Units: inches in, PDF points out (72 pt = 1 in, origin bottom-left).
 * Nothing here ever blocks an export — every check is advice (owner rule).
 */
import { checkDesign, printPt, type BannerDesign, type DesignPrint } from "@/lib/cms/banner-design-core";

export const PT = 72;
/** Browser canvas safety: ~64 MP and 16k px a side work in Chrome, Edge and Firefox. */
export const EXPORT_MAX_MP = 64;
export const EXPORT_MAX_SIDE = 16000;
/** Offscreen layout width (text px are % of the width, so any width lays out the same). */
export const PRINT_RENDER_PX = 800;

export type PrintFormat = "pdf-vendor" | "pdf-marks" | "pdf-letter" | "sheet-avery" | "sheet-cut" | "png" | "jpg";

export const FORMAT_INFO: Record<PrintFormat, { label: string; help: string }> = {
  "pdf-vendor": { label: "PDF for Vistaprint", help: "Bleed included, no crop marks — what Vistaprint's uploader wants." },
  "pdf-marks": { label: "PDF for a print shop", help: "Bleed + crop marks + Trim/Bleed boxes, for any pro printer." },
  "pdf-letter": { label: "PDF to print at home (Letter)", help: "Centred on 8.5 x 11 paper with crop marks to cut along." },
  "sheet-avery": { label: "Avery business card sheet (10 per page)", help: "Letter page laid out for Avery 8371 / 8869 / 5371 perforated card stock. Two pages = fronts + backs for duplex." },
  "sheet-cut": { label: "Print-and-cut sheet (many per page)", help: "As many copies as fit on Letter, with cut marks. Two pages = fronts + backs lined up for duplex." },
  png: { label: "PNG picture", help: "Full-size picture with bleed (stickers, screens, sharing)." },
  jpg: { label: "JPG picture", help: "Smaller file, same size (no transparency)." },
};

/** Formats that make sense for who prints it / what it is (first = recommended). */
export function formatsFor(vendor: "vistaprint" | "self", placement: string, opts: { avery?: boolean; sheet?: boolean } = {}): PrintFormat[] {
  const sheets: PrintFormat[] = [...(opts.avery ? (["sheet-avery"] as const) : []), ...(opts.sheet ? (["sheet-cut"] as const) : [])];
  if (vendor === "self") return [...sheets, "pdf-letter", "pdf-marks", "png", "jpg"];
  if (placement === "sticker") return ["pdf-vendor", "png", "pdf-marks", ...sheets, "jpg"];
  return ["pdf-vendor", "pdf-marks", ...sheets, "png", "jpg"];
}

export type RenderPlan = { renderW: number; renderH: number; scale: number; outW: number; outH: number; dpi: number; wantDpi: number; capped: boolean };

/** Pixels to render the full canvas (trim + bleed) at `dpi`, capped for the browser. */
export function renderPlan(print: DesignPrint, dpi: number, ratio?: number): RenderPlan {
  const W = print.w + 2 * print.bleed;
  const H = print.h + 2 * print.bleed;
  const r = ratio && ratio > 0 ? ratio : W / H;
  const renderW = PRINT_RENDER_PX;
  const renderH = Math.round(renderW / r);
  let outW = Math.round(W * dpi);
  let capped = false;
  const maxW = Math.min(EXPORT_MAX_SIDE, Math.round(EXPORT_MAX_SIDE * r), Math.floor(Math.sqrt(EXPORT_MAX_MP * 1e6 * r)));
  if (outW > maxW) {
    outW = maxW;
    capped = true;
  }
  const scale = Math.round((outW / renderW) * 10000) / 10000;
  outW = Math.round(renderW * scale);
  const outH = Math.round(renderH * scale);
  return { renderW, renderH, scale, outW, outH, dpi: Math.round(outW / W), wantDpi: dpi, capped };
}

export type Box = { x: number; y: number; w: number; h: number };
export type Line = { x1: number; y1: number; x2: number; y2: number };
export type PdfLayout = { pageW: number; pageH: number; art: Box; trim: Box; bleed: Box; marks: Line[]; slug: { x: number; y: number } | null };

const MARK_LEN = 0.25;
const MARK_GAP = 0.0625;
const LETTER = { w: 8.5, h: 11 };

function marksFor(trim: Box, bleedPt: number): Line[] {
  const off = bleedPt + MARK_GAP * PT;
  const len = MARK_LEN * PT;
  const L = trim.x;
  const R = trim.x + trim.w;
  const B = trim.y;
  const T = trim.y + trim.h;
  const out: Line[] = [];
  for (const [cx, sx] of [[L, -1], [R, 1]] as const)
    for (const [cy, sy] of [[B, -1], [T, 1]] as const) {
      out.push({ x1: cx + sx * off, y1: cy, x2: cx + sx * (off + len), y2: cy }); // horizontal
      out.push({ x1: cx, y1: cy + sy * off, x2: cx, y2: cy + sy * (off + len) }); // vertical
    }
  return out.map((l) => ({ x1: r2(l.x1), y1: r2(l.y1), x2: r2(l.x2), y2: r2(l.y2) }));
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** PDF page geometry for a format (only the pdf-* formats). */
export function pdfLayout(print: DesignPrint, format: PrintFormat): PdfLayout {
  const b = print.bleed * PT;
  const tw = print.w * PT;
  const th = print.h * PT;
  if (format === "pdf-vendor") {
    const trim = { x: b, y: b, w: tw, h: th };
    const all = { x: 0, y: 0, w: tw + 2 * b, h: th + 2 * b };
    return { pageW: all.w, pageH: all.h, art: all, trim, bleed: all, marks: [], slug: null };
  }
  const margin = Math.max(b + (MARK_GAP + MARK_LEN + 0.125) * PT, 0.5 * PT);
  let pageW = tw + 2 * margin;
  let pageH = th + 2 * margin;
  if (format === "pdf-letter") {
    // Fit on Letter (either way round) when it can; bigger pieces get their own page size.
    const fits = (pw: number, ph: number) => tw + 2 * margin <= pw * PT && th + 2 * margin <= ph * PT;
    if (fits(LETTER.w, LETTER.h)) [pageW, pageH] = [LETTER.w * PT, LETTER.h * PT];
    else if (fits(LETTER.h, LETTER.w)) [pageW, pageH] = [LETTER.h * PT, LETTER.w * PT];
  }
  const trim = { x: r2((pageW - tw) / 2), y: r2((pageH - th) / 2), w: tw, h: th };
  const bleed = { x: trim.x - b, y: trim.y - b, w: tw + 2 * b, h: th + 2 * b };
  return { pageW: r2(pageW), pageH: r2(pageH), art: bleed, trim, bleed, marks: marksFor(trim, b), slug: { x: trim.x, y: r2(Math.max(6, trim.y - b - (MARK_GAP + MARK_LEN) * PT - 10)) } };
}

/** How many Letter sheets a piece would need when tiled for home printing (info only). */
export function tilesOnLetter(print: DesignPrint, overlap = 0.5): { cols: number; rows: number } {
  const usable = { w: LETTER.w - 0.5, h: LETTER.h - 0.5 };
  const step = (u: number) => u - overlap;
  return { cols: Math.max(1, Math.ceil((print.w - overlap) / step(usable.w))), rows: Math.max(1, Math.ceil((print.h - overlap) / step(usable.h))) };
}

export type PrintWarning = { code: string; message: string };

/** Warn-only checks before an export (never blocks). */
export function printChecks(design: BannerDesign, opts: { viewFt: number; pictureDpi?: number | null; plan?: RenderPlan | null; placement?: string }): PrintWarning[] {
  const print = design.frame.print;
  if (!print) return [];
  const out: PrintWarning[] = [];
  const W = print.w + 2 * print.bleed;
  const H = print.h + 2 * print.bleed;
  const sx = ((print.bleed + print.safe) / W) * 100;
  const sy = ((print.bleed + print.safe) / H) * 100;
  // Rule of thumb: 1 inch of capital height reads from ~10 ft; cap height ≈ 0.7 em.
  const minPt = Math.max(opts.placement === "handout" || opts.placement === "sticker" ? 6 : 0, ((opts.viewFt / 10) * 72) / 0.7 / 3);
  for (const b of design.boxes) {
    if (b.hidden || !b.text.trim()) continue;
    const pt = printPt(b.size, print);
    const name = `"${b.text.trim().slice(0, 24)}${b.text.trim().length > 24 ? "…" : ""}"`;
    if (pt < minPt) out.push({ code: "TEXT_SMALL", message: `${name} prints at about ${pt} pt — small to read from ${opts.viewFt} ft (aim for ${Math.ceil(minPt)} pt or more).` });
    if (b.x < sx || b.x + b.w > 100 - sx || b.y < sy || b.y > 100 - sy) out.push({ code: "OUTSIDE_SAFE", message: `${name} reaches past the green safe line — it may be trimmed off or sit in a grommet/fold.` });
  }
  for (const btn of design.buttons) if (btn.label.trim()) out.push({ code: "BUTTON_ON_PAPER", message: `The button "${btn.label.trim().slice(0, 24)}" can't be tapped on paper — add a QR code next to it or turn it into text.` });
  if (opts.pictureDpi && opts.pictureDpi < 100) out.push({ code: "PICTURE_LOW_DPI", message: `The background picture only has about ${opts.pictureDpi} DPI at this size, so it may look soft. Try AI upscale or a bigger picture.` });
  if (opts.plan?.capped) out.push({ code: "EXPORT_CAPPED", message: `This size is huge, so the browser renders it at ${opts.plan.dpi} DPI (asked ${opts.plan.wantDpi}). Text and shapes stay crisp at viewing distance; printers upscale large-format files fine.` });
  for (const w of checkDesign(design)) if (/LEGAL|CONTRAST|COMPLIANCE|WAC/i.test(w.code + w.message)) out.push({ code: w.code, message: w.message });
  return out;
}

/** "grand-opening-24x36in-print.pdf" */
export function printFilename(name: string, print: DesignPrint, format: PrintFormat): string {
  const slug =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "print-design";
  const ext = format === "png" ? "png" : format === "jpg" ? "jpg" : "pdf";
  const tag = format === "pdf-vendor" ? "vistaprint" : format === "pdf-marks" ? "cropmarks" : format === "pdf-letter" ? "letter" : format === "sheet-avery" ? "avery-sheet" : format === "sheet-cut" ? "cut-sheet" : "bleed";
  return `${slug}-${print.w}x${print.h}in-${tag}.${ext}`;
}

// -- Self-test ---------------------------------------------------------------

export function __runPrintExportTests(): { passed: number; failed: number; failures: string[] } {
  let passed = 0;
  const failures: string[] = [];
  const ok = (c: boolean, m: string) => (c ? passed++ : failures.push(m));
  const flyer: DesignPrint = { w: 8.5, h: 11, bleed: 0.125, safe: 0.25 };
  const p = renderPlan(flyer, 300);
  ok(Math.abs(p.outW - 2625) <= 2 && !p.capped && p.dpi === 300, `flyer plan ${JSON.stringify(p)}`);
  const big = renderPlan({ w: 144, h: 72, bleed: 0, safe: 1 }, 100);
  ok(big.capped && big.outW <= EXPORT_MAX_SIDE && big.outW * big.outH <= EXPORT_MAX_MP * 1e6 * 1.01, `big capped ${JSON.stringify(big)}`);
  const v = pdfLayout(flyer, "pdf-vendor");
  ok(v.pageW === 630 && v.pageH === 810 && v.marks.length === 0 && v.trim.x === 9, `vendor ${JSON.stringify(v).slice(0, 120)}`);
  const m = pdfLayout(flyer, "pdf-marks");
  ok(m.marks.length === 8 && m.pageW > 630 && m.trim.w === 612, "marks layout");
  ok(m.marks.every((l) => l.x1 >= 0 && l.y1 >= 0 && l.x2 <= m.pageW && l.y2 <= m.pageH), "marks on page");
  // marks never enter the bleed
  ok(m.marks.every((l) => l.x1 <= m.bleed.x || l.x1 >= m.bleed.x + m.bleed.w || l.y1 <= m.bleed.y || l.y1 >= m.bleed.y + m.bleed.h), "marks outside bleed");
  const card = pdfLayout({ w: 4, h: 6, bleed: 0.125, safe: 0.125 }, "pdf-letter");
  ok(card.pageW === 612 && card.pageH === 792 && card.trim.x === 162, `letter ${JSON.stringify(card.trim)}`);
  const land = pdfLayout({ w: 9, h: 6, bleed: 0.125, safe: 0.125 }, "pdf-letter");
  ok(land.pageW === 792 && land.pageH === 612, "letter landscape");
  ok(pdfLayout(flyer, "pdf-letter").pageW > 612, "flyer too big for letter w/ marks -> own page");
  ok(tilesOnLetter({ w: 24, h: 36, bleed: 0, safe: 0 }).cols === 4, "tiles");
  ok(printFilename("Grand Opening!", flyer, "pdf-vendor") === "grand-opening-8.5x11in-vistaprint.pdf", printFilename("Grand Opening!", flyer, "pdf-vendor"));
  ok(formatsFor("self", "handout")[0] === "pdf-letter" && formatsFor("vistaprint", "outdoor")[0] === "pdf-vendor", "formats");
  ok(formatsFor("self", "handout", { avery: true, sheet: true })[0] === "sheet-avery", "avery first for self cards");
  return { passed, failed: failures.length, failures };
}
