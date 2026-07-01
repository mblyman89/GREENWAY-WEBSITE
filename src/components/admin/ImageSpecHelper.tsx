"use client";

/**
 * ImageSpecHelper — the Canva-ready sizing hint shown next to an editable image
 * upload. Tells a non-technical editor exactly what canvas to create so the art
 * fills the slot perfectly the first time.
 *
 * Pure presentational: it takes an ImageSpec (resolved from the block_key or a
 * named slot) and renders the aspect ratio, recommended pixel size(s), a
 * one-click "copy Canva size" button, and a to-scale aspect preview.
 */
import { useState } from "react";
import type { ImageSpec } from "@/lib/cms/image-spec-core";
import { canvaLine } from "@/lib/cms/image-spec-core";

export function ImageSpecHelper({ spec }: { spec: ImageSpec }) {
  const [copied, setCopied] = useState(false);
  const primary = spec.presets[0];

  // Clamp the preview box to a sensible width while keeping the true ratio.
  const previewW = 132;
  const previewH = Math.max(18, Math.round(previewW / spec.aspectRatio));

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${primary.width} x ${primary.height}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the size is still shown on screen */
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-[#7ed957]/25 bg-[#7ed957]/[0.06] p-3 text-xs text-white/80">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <span aria-hidden>🎨</span>
          <span className="font-bold text-[#7ed957]">Canva size</span>
        </div>

        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-sm font-bold text-white">
            {primary.width} × {primary.height}px
          </span>
          <span className="text-[0.65rem] uppercase tracking-wide text-white/45">
            {spec.aspectLabel} aspect · {primary.label}
          </span>
        </div>

        {/* To-scale preview of the slot's shape */}
        <div
          className="shrink-0 rounded border border-white/25 bg-gradient-to-br from-[#7ed957]/25 to-white/5"
          style={{ width: previewW, height: previewH }}
          aria-hidden
          title={`${spec.aspectLabel} shape`}
        />

        <button
          type="button"
          onClick={copy}
          className="ml-auto rounded-lg border border-white/20 px-2.5 py-1 text-[0.7rem] font-bold text-white/80 transition hover:bg-white/10"
        >
          {copied ? "✓ Copied" : "Copy size"}
        </button>
      </div>

      {/* Extra presets (e.g. desktop + mobile / extra-wide) */}
      {spec.presets.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {spec.presets.slice(1).map((p) => (
            <span
              key={`${p.width}x${p.height}`}
              className="rounded border border-white/12 bg-black/30 px-2 py-0.5 font-mono text-[0.65rem] text-white/60"
            >
              {p.label}: {p.width}×{p.height}
            </span>
          ))}
        </div>
      )}

      <p className="mt-2 leading-relaxed text-white/55">
        {spec.tip} <span className="text-white/40">{spec.formatNote}</span>
      </p>
      <p className="mt-1 text-[0.65rem] text-white/35">{canvaLine(spec)}</p>
    </div>
  );
}
