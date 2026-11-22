"use client";

/**
 * D263 S6 — print-ready downloads. Renders the SAME public <DesignedBanner>
 * offscreen (still copy, print fonts loaded, smoke frozen), rasterises it with
 * modern-screenshot at the print DPI, and builds a PDF with pdf-lib (MIT):
 * bleed, TrimBox/BleedBox and crop marks. Every check is a warning — the
 * download always goes ahead (owner rule: warn, never block).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { DesignedBanner } from "@/components/site/DesignedBanner";
import type { BannerDesign } from "@/lib/cms/banner-design-core";
import { stillDesign } from "@/lib/brand/brand-sizes-core";
import { pictureSharpness, type PrintPreset } from "@/lib/printing/print-sizes-core";
import { FORMAT_INFO, formatsFor, pdfLayout, printChecks, printFilename, renderPlan, tilesOnLetter, type PrintFormat } from "@/lib/printing/print-export-core";
import { isAveryCard, sheetLayout, type PrintPage } from "@/lib/printing/print-doc-core";
import { CUT_SPOT, cutPath, type Rect } from "@/lib/printing/print-finish-core";
import { PrintFontFaces } from "./PrintTypeFields";

type Status = { kind: "idle" } | { kind: "busy"; step: string } | { kind: "ok"; file: string; kb: number } | { kind: "err"; msg: string };
const input = "rounded border border-white/15 bg-black/40 px-2 py-1 text-sm text-white";

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

export function PrintExport({ pages, name, preset, dpi }: { pages: PrintPage[]; name: string; preset: PrintPreset; dpi: number }) {
  const design: BannerDesign = pages[0].design;
  const imageSrc = pages[0].imageSrc;
  const print = design.frame.print;
  const avery = !!print && isAveryCard(print);
  const canSheet = !!print && !!sheetLayout(print, "cut");
  const formats = useMemo(() => formatsFor(preset.vendor, preset.placement, { avery, sheet: canSheet }), [preset.vendor, preset.placement, avery, canSheet]);
  const [pick, setFormat] = useState<PrintFormat>(formats[0]);
  const format = formats.includes(pick) ? pick : formats[0];
  const [renderIdx, setRenderIdx] = useState(0);
  const [wantDpi, setWantDpi] = useState(dpi);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [rendering, setRendering] = useState(false);
  const [picPx, setPicPx] = useState<{ w: number; h: number } | null>(null);
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!imageSrc) return;
    const img = new Image();
    img.onload = () => setPicPx({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = imageSrc;
  }, [imageSrc]);

  if (!print) return null;
  const plan = renderPlan(print, wantDpi, design.frame.card?.ratio);
  const picDpi = imageSrc && picPx ? (pictureSharpness(picPx.w, picPx.h, print, dpi)?.dpi ?? null) : null;
  const warnings = pages.flatMap((pg, i) => printChecks(pg.design, { viewFt: preset.viewFt, pictureDpi: i === 0 ? picDpi : null, plan: i === 0 ? plan : null, placement: preset.placement }).map((w) => ({ ...w, message: pages.length > 1 ? `${pg.label}: ${w.message}` : w.message })));
  const tiles = tilesOnLetter(print);
  const isSheet = format.startsWith("sheet");
  const isPdf = format.startsWith("pdf") || isSheet;
  const multi = pages.length > 1;

  /** Render page i offscreen and return a JPEG/PNG blob. */
  async function capture(i: number, type: "image/jpeg" | "image/png"): Promise<Blob> {
    setRenderIdx(i);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await document.fonts.ready;
    await wait(900); // still smoke + picture decode
    const node = holder.current?.querySelector<HTMLElement>("[data-print-root] > *");
    if (!node) throw new Error("Couldn't prepare the design. Try again.");
    const { domToBlob } = await import("modern-screenshot");
    const blob = await domToBlob(node, { width: plan.renderW, height: plan.renderH, scale: plan.scale, backgroundColor: type === "image/png" ? null : "#ffffff", type, quality: 0.95, timeout: 60_000 });
    if (!blob?.size) throw new Error("The render came out empty. Try a lower DPI.");
    return blob;
  }

  async function run() {
    if (!print) return;
    setRendering(true);
    try {
      const file = printFilename(name, print, format);
      if (!isPdf) {
        // Pictures: one file per page.
        for (let i = 0; i < pages.length; i += 1) {
          setStatus({ kind: "busy", step: `Rendering ${pages[i].label}…` });
          const blob = await capture(i, format === "jpg" ? "image/jpeg" : "image/png");
          save(blob, multi ? file.replace(/\.(png|jpg)$/, `-${pages[i].label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.$1`) : file);
        }
        setStatus({ kind: "ok", file: multi ? `${pages.length} pictures` : file, kb: 0 });
        return;
      }
      const shots: ArrayBuffer[] = [];
      for (let i = 0; i < pages.length; i += 1) {
        setStatus({ kind: "busy", step: `Rendering ${pages[i].label} (${plan.outW.toLocaleString()} x ${plan.outH.toLocaleString()} px)…` });
        shots.push(await (await capture(i, "image/jpeg")).arrayBuffer());
      }
      setStatus({ kind: "busy", step: "Building the PDF…" });
      const lib = await import("pdf-lib");
      const { PDFDocument, StandardFonts, rgb, cmyk, clip, endPath, popGraphicsState, pushGraphicsState, rectangle } = lib;
      const pdf = await PDFDocument.create();
      pdf.setTitle(name || "Print design");
      pdf.setCreator("Greenway Print Studio");
      pdf.setProducer("pdf-lib");
      pdf.setSubject(`${print.w} x ${print.h} in trim, ${print.bleed} in bleed, ${plan.dpi} DPI, ${pages.length} page(s)`);
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      const reg = cmyk(1, 1, 1, 1);
      const imgs = await Promise.all(shots.map((b) => pdf.embedJpg(b)));
      // D263 S9: die-cut line as a "CutContour" spot colour (100% magenta alternate), overprinted, 0.5 pt.
      const cut = print.cut;
      const sepRef = cut
        ? pdf.context.register(pdf.context.obj([lib.PDFName.of("Separation"), lib.PDFName.of(CUT_SPOT), lib.PDFName.of("DeviceCMYK"), pdf.context.obj({ FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: [0, 1, 0, 0], N: 1 })]))
        : null;
      const opRef = cut ? pdf.context.register(pdf.context.obj({ Type: "ExtGState", OP: true, op: true, OPM: 1 })) : null;
      const drawCut = (page: import("pdf-lib").PDFPage, trims: Rect[]) => {
        if (!cut || !sepRef || !opRef) return;
        const res = page.node.normalizedEntries().Resources;
        let cs = res.lookupMaybe(lib.PDFName.of("ColorSpace"), lib.PDFDict);
        if (!cs) {
          cs = pdf.context.obj({});
          res.set(lib.PDFName.of("ColorSpace"), cs);
        }
        cs.set(lib.PDFName.of(CUT_SPOT), sepRef);
        const gs = page.node.newExtGState("GSCut", opRef);
        const N = lib.PDFOperatorNames;
        const ops = [pushGraphicsState(), lib.setGraphicsState(gs), lib.PDFOperator.of(N.StrokingColorspace, [lib.PDFName.of(CUT_SPOT)]), lib.PDFOperator.of(N.StrokingColorN, [lib.PDFNumber.of(1)]), lib.setLineWidth(0.5)];
        for (const t of trims)
          for (const o of cutPath(cut, t)) ops.push(o.op === "M" ? lib.moveTo(o.x, o.y) : o.op === "L" ? lib.lineTo(o.x, o.y) : o.op === "C" ? lib.appendBezierCurve(o.x1, o.y1, o.x2, o.y2, o.x, o.y) : lib.closePath());
        ops.push(lib.stroke(), popGraphicsState());
        page.pushOperators(...ops);
      };
      if (isSheet) {
        for (let i = 0; i < imgs.length; i += 1) {
          const L = sheetLayout(print, format === "sheet-avery" ? "avery" : "cut", i % 2 === 1);
          if (!L) throw new Error("This size doesn't fit that sheet. Pick another download.");
          const page = pdf.addPage([L.pageW, L.pageH]);
          for (const c of L.cells) {
            if (L.clip) {
              // Avery stock has no gaps: draw the full bleed image, but only the trim area shows.
              page.pushOperators(pushGraphicsState(), rectangle(c.trim.x, c.trim.y, c.trim.w, c.trim.h), clip(), endPath());
              page.drawImage(imgs[i], { x: c.x, y: c.y, width: c.w, height: c.h });
              page.pushOperators(popGraphicsState());
            } else page.drawImage(imgs[i], { x: c.x, y: c.y, width: c.w, height: c.h });
          }
          for (const m of L.marks) page.drawLine({ start: { x: m.x1, y: m.y1 }, end: { x: m.x2, y: m.y2 }, thickness: 0.25, color: reg });
          if (!L.clip) drawCut(page, L.cells.map((c) => c.trim));
          page.drawText(`${pages[i].label} · ${L.note}`, { x: 18, y: 8, size: 6, font, color: rgb(0.4, 0.4, 0.4) });
        }
      } else {
        const L = pdfLayout(print, format);
        imgs.forEach((img, i) => {
          const page = pdf.addPage([L.pageW, L.pageH]);
          page.drawImage(img, { x: L.art.x, y: L.art.y, width: L.art.w, height: L.art.h });
          page.setTrimBox(L.trim.x, L.trim.y, L.trim.w, L.trim.h);
          page.setBleedBox(L.bleed.x, L.bleed.y, L.bleed.w, L.bleed.h);
          page.setArtBox(L.trim.x, L.trim.y, L.trim.w, L.trim.h);
          drawCut(page, [L.trim]);
          for (const m of L.marks) page.drawLine({ start: { x: m.x1, y: m.y1 }, end: { x: m.x2, y: m.y2 }, thickness: 0.25, color: reg });
          if (L.slug) page.drawText(`${name || "Print design"} · ${pages[i].label} · ${print.w}" x ${print.h}" trim · ${print.bleed}" bleed · ${plan.dpi} DPI · ${new Date().toLocaleDateString()}`, { x: L.slug.x, y: L.slug.y, size: 6, font, color: rgb(0.3, 0.3, 0.3) });
        });
      }
      const bytes = await pdf.save();
      const out = new Blob([bytes as BlobPart], { type: "application/pdf" });
      save(out, file);
      setStatus({ kind: "ok", file, kb: Math.round(out.size / 1024) });
    } catch (e) {
      setStatus({ kind: "err", msg: (e as Error).message || "The download failed." });
    } finally {
      setRendering(false);
    }
  }

  return (
    <div className="space-y-2 text-xs text-[var(--admin-text)]">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-white/70">
          File
          <select aria-label="Download format" className={`${input} ml-2`} value={format} onChange={(e) => setFormat(e.target.value as PrintFormat)}>
            {formats.map((f, i) => (
              <option key={f} value={f}>
                {FORMAT_INFO[f].label}
                {i === 0 ? " (recommended)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="text-white/70">
          DPI
          <select aria-label="Print resolution" className={`${input} ml-2`} value={wantDpi} onChange={(e) => setWantDpi(Number(e.target.value))}>
            {[72, 100, 150, 200, 300].map((d) => (
              <option key={d} value={d}>
                {d}
                {d === dpi ? " (best for this size)" : ""}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={run} disabled={status.kind === "busy"} className="rounded bg-[var(--admin-accent)] px-3 py-1 text-sm font-bold text-black disabled:opacity-50">
          {status.kind === "busy" ? "Working…" : "Download"}
        </button>
      </div>
      <p className="text-white/60">
        {FORMAT_INFO[format].help}
        {multi ? ` · ${pages.length} pages` : ""} · {plan.outW.toLocaleString()} x {plan.outH.toLocaleString()} px at {plan.dpi} DPI
        {format === "pdf-letter" && (tiles.cols > 1 || tiles.rows > 1) ? ` · bigger than Letter: the PDF gets its own page size (home printers "Poster"/"Tile" mode splits it onto ${tiles.cols * tiles.rows} sheets)` : ""}
      </p>
      {warnings.length ? (
        <ul className="list-disc space-y-0.5 pl-5 text-[var(--admin-gold)]">
          {warnings.map((w, i) => (
            <li key={`${w.code}-${i}`}>{w.message}</li>
          ))}
        </ul>
      ) : (
        <p className="text-green-400">No print warnings.</p>
      )}
      {warnings.length ? <p className="text-white/50">These are tips only — the download always works.</p> : null}
      {status.kind === "busy" ? <p className="text-white/70">{status.step}</p> : null}
      {status.kind === "ok" ? (
        <p className="text-green-400">
          Downloaded {status.file}
          {status.kb ? ` (${status.kb.toLocaleString()} KB)` : ""}.
        </p>
      ) : null}
      {status.kind === "err" ? <p className="text-red-400">{status.msg}</p> : null}
      {rendering ? (
        <div aria-hidden="true" ref={holder} style={{ position: "fixed", left: -30000, top: 0, pointerEvents: "none" }}>
          <PrintFontFaces design={pages[renderIdx]?.design ?? design} />
          <div data-print-root style={{ width: plan.renderW }}>
            <DesignedBanner key={renderIdx} design={stillDesign(pages[renderIdx]?.design ?? design)} imageSrc={pages[renderIdx]?.imageSrc ?? imageSrc} imageAlt="" legacy={{}} frameClassName="" priority />
          </div>
        </div>
      ) : null}
    </div>
  );
}
