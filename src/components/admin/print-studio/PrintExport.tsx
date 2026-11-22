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

export function PrintExport({ design, imageSrc, name, preset, dpi }: { design: BannerDesign; imageSrc: string; name: string; preset: PrintPreset; dpi: number }) {
  const print = design.frame.print;
  const formats = useMemo(() => formatsFor(preset.vendor, preset.placement), [preset.vendor, preset.placement]);
  const [format, setFormat] = useState<PrintFormat>(formats[0]);
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
  const warnings = printChecks(design, { viewFt: preset.viewFt, pictureDpi: picDpi, plan, placement: preset.placement });
  const tiles = tilesOnLetter(print);
  const isPdf = format.startsWith("pdf");

  async function run() {
    if (!print) return;
    setRendering(true);
    try {
      setStatus({ kind: "busy", step: "Loading fonts and picture…" });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await document.fonts.ready;
      await wait(900); // still smoke + picture decode
      const node = holder.current?.querySelector<HTMLElement>("[data-print-root] > *");
      if (!node) throw new Error("Couldn't prepare the design — try again.");
      setStatus({ kind: "busy", step: `Rendering ${plan.outW.toLocaleString()} x ${plan.outH.toLocaleString()} px…` });
      const { domToBlob } = await import("modern-screenshot");
      const jpeg = format === "jpg" || isPdf;
      const blob = await domToBlob(node, {
        width: plan.renderW,
        height: plan.renderH,
        scale: plan.scale,
        backgroundColor: format === "png" ? null : "#ffffff",
        type: jpeg ? "image/jpeg" : "image/png",
        quality: 0.95,
        timeout: 60_000,
      });
      if (!blob?.size) throw new Error("The render came out empty — try a lower DPI.");
      const file = printFilename(name, print, format);
      if (!isPdf) {
        save(blob, file);
        setStatus({ kind: "ok", file, kb: Math.round(blob.size / 1024) });
        return;
      }
      setStatus({ kind: "busy", step: "Building the PDF…" });
      const { PDFDocument, StandardFonts, rgb, cmyk } = await import("pdf-lib");
      const L = pdfLayout(print, format);
      const pdf = await PDFDocument.create();
      pdf.setTitle(name || "Print design");
      pdf.setCreator("Greenway Print Studio");
      pdf.setProducer("pdf-lib");
      pdf.setSubject(`${print.w} x ${print.h} in trim, ${print.bleed} in bleed, ${plan.dpi} DPI`);
      const page = pdf.addPage([L.pageW, L.pageH]);
      const img = await pdf.embedJpg(await blob.arrayBuffer());
      page.drawImage(img, { x: L.art.x, y: L.art.y, width: L.art.w, height: L.art.h });
      page.setTrimBox(L.trim.x, L.trim.y, L.trim.w, L.trim.h);
      page.setBleedBox(L.bleed.x, L.bleed.y, L.bleed.w, L.bleed.h);
      page.setArtBox(L.trim.x, L.trim.y, L.trim.w, L.trim.h);
      // Registration colour (100% of every ink) so marks show on every plate.
      const reg = cmyk(1, 1, 1, 1);
      for (const m of L.marks) page.drawLine({ start: { x: m.x1, y: m.y1 }, end: { x: m.x2, y: m.y2 }, thickness: 0.25, color: reg });
      if (L.slug) {
        const font = await pdf.embedFont(StandardFonts.Helvetica);
        page.drawText(`${name || "Print design"} · ${print.w}" x ${print.h}" trim · ${print.bleed}" bleed · ${plan.dpi} DPI · ${new Date().toLocaleDateString()}`, { x: L.slug.x, y: L.slug.y, size: 6, font, color: rgb(0.3, 0.3, 0.3) });
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
        {FORMAT_INFO[format].help} · {plan.outW.toLocaleString()} x {plan.outH.toLocaleString()} px at {plan.dpi} DPI
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
          Downloaded {status.file} ({status.kb.toLocaleString()} KB).
        </p>
      ) : null}
      {status.kind === "err" ? <p className="text-red-400">{status.msg}</p> : null}
      {rendering ? (
        <div aria-hidden="true" ref={holder} style={{ position: "fixed", left: -30000, top: 0, pointerEvents: "none" }}>
          <PrintFontFaces design={design} />
          <div data-print-root style={{ width: plan.renderW }}>
            <DesignedBanner design={stillDesign(design)} imageSrc={imageSrc} imageAlt="" legacy={{}} frameClassName="" priority />
          </div>
        </div>
      ) : null}
    </div>
  );
}
