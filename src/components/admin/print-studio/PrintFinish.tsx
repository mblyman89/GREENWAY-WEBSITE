"use client";

/**
 * D263 S9 - cut line (stickers / shaped cards) + Vistaprint upload helper.
 * The cut line shows pink on the canvas and goes into the PDFs as a
 * "CutContour" spot-colour path. Tips only - nothing blocks.
 */
import type { DesignCut, DesignPrint } from "@/lib/cms/banner-design-core";
import type { PrintPreset } from "@/lib/printing/print-sizes-core";
import { CUT_SHAPES, DEFAULT_CUT, VISTAPRINT_LOGIN_URL, cutTips, vistaprintHelp } from "@/lib/printing/print-finish-core";

const input = "rounded border border-white/15 bg-black/40 px-2 py-1 text-sm text-white";

export function PrintCutLine({ print, onChange }: { print: DesignPrint; onChange: (cut: DesignCut | null) => void }) {
  const cut = print.cut;
  const tips = cutTips(print);
  return (
    <div className="space-y-1 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Cut line</span>
        <select aria-label="Cut shape" className={input} value={cut?.shape ?? "none"} onChange={(e) => (e.target.value === "none" ? onChange(null) : onChange({ ...(cut ?? DEFAULT_CUT), shape: e.target.value as DesignCut["shape"] }))}>
          {CUT_SHAPES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        {cut?.shape === "rounded" ? (
          <label className="text-white/70">
            Corner
            <select aria-label="Corner radius" className={`${input} ml-1`} value={cut.radius} onChange={(e) => onChange({ ...cut, radius: Number(e.target.value) })}>
              {[0.0625, 0.125, 0.1875, 0.25, 0.375, 0.5].map((r) => (
                <option key={r} value={r}>
                  {`${r}in`}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {cut ? (
          <label className="text-white/70">
            Inset from edge
            <select aria-label="Cut inset" className={`${input} ml-1`} value={cut.offset} onChange={(e) => onChange({ ...cut, offset: Number(e.target.value) })}>
              {[0, 0.0625, 0.125, 0.25].map((r) => (
                <option key={r} value={r}>
                  {`${r}in`}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <p className="text-white/50">{cut ? "Pink line on the canvas = where the blade cuts. PDFs get it as a “CutContour” spot-colour line (cutters and print shops read it; it doesn’t print)." : "Stickers and shaped cards: add a cut line so the printer knows the shape."}</p>
      {tips.map((t) => (
        <p key={t} className="text-[var(--admin-gold)]">
          {t}
        </p>
      ))}
    </div>
  );
}

/** D263 S10: opens Vistaprint's sign-in / account page in a new tab. */
export function VistaprintLoginButton({ className = "" }: { className?: string }) {
  return (
    <a
      href={VISTAPRINT_LOGIN_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 rounded bg-[#0070e0] px-3 py-1 text-xs font-bold text-white hover:bg-[#1a82ec] ${className}`}
      title="Open Vistaprint's sign-in page in a new tab"
    >
      Sign in to Vistaprint ↗
    </a>
  );
}

export function VistaprintHelper({ preset, dpi }: { preset: PrintPreset; dpi: number }) {
  if (preset.vendor !== "vistaprint") return null;
  const h = vistaprintHelp(preset, dpi);
  return (
    <details className="rounded-md border border-white/10 p-2 text-xs">
      <summary className="cursor-pointer font-semibold">Ordering on Vistaprint - step by step</summary>
      <p className="mt-2">
        <VistaprintLoginButton />
      </p>
      <p className="mt-1">
        Product:{" "}
        <a className="underline" href={h.url} target="_blank" rel="noopener noreferrer">
          {h.product} on vistaprint.com
        </a>{" "}
        · upload file {h.uploadIn} ({h.uploadPx})
      </p>
      <ol className="mt-1 list-decimal space-y-0.5 pl-5">
        {h.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </details>
  );
}
