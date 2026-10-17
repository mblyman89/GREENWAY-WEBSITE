"use client";

/**
 * R70 S2 - "Add" sub-tab: text presets, artwork upload (kept on this device)
 * and the same searchable Shapes / Icons / Objects libraries as the Banner
 * Studio (only the picked path is copied into the design).
 */
import { useState } from "react";
import { BANNER_ICON_CATS, BANNER_ICON_DATA, BANNER_ICON_LIST } from "@/lib/cms/banner-icons-data";
import { BANNER_OBJECT_CATS, BANNER_OBJECT_DATA, BANNER_OBJECT_LIST } from "@/lib/cms/banner-objects-data";
import { SHAPE_KINDS, shapePoints, type ShapeKind } from "@/lib/cms/banner-elements-core";
import { LibraryPicker, type LibraryItem } from "@/components/admin/banner-studio/LibraryPicker";
import { Row, Segmented, studioInput } from "@/components/admin/banner-studio/controls";
import type { Method, Placement } from "@/lib/merch-studio/garment-catalog-core";

export interface TextPreset { id: string; label: string; text: string; letterIn: number; curve?: number; weight?: 400 | 700 | 900; hint: string }
export function textPresets(p: Placement): TextPreset[] {
  const small = Math.min(p.widthIn, p.heightIn) <= 4;
  return [
    { id: "headline", label: "Headline", text: "GREENWAY", letterIn: small ? 0.45 : 1.25, weight: 900, hint: small ? "Bold wordmark sized for this small area" : "Big, bold front/back headline" },
    { id: "wordmark", label: "Wordmark", text: "Greenway", letterIn: small ? 0.35 : 0.8, weight: 700, hint: "Mixed-case brand name" },
    { id: "arch", label: "Arched text", text: "GREENWAY", letterIn: small ? 0.35 : 1, curve: 35, weight: 900, hint: "Collegiate-style arch" },
    { id: "tag", label: "Small tagline", text: "Glass & Goods", letterIn: 0.3, weight: 700, hint: "Supporting line - stays above the 0.25\" minimum" },
  ];
}

const SHAPE_ITEMS: LibraryItem[] = SHAPE_KINDS.filter((s) => !["rect", "circle", "line"].includes(s.id)).map((s) => ({ id: s.id, label: s.label }));
const pathThumb = (d: string | undefined) => (
  <svg viewBox="0 0 256 256" className="h-full w-full" aria-hidden="true" focusable="false">{d ? <path d={d} fill="currentColor" /> : null}</svg>
);

export function AddPanel({ placement, method, disabled, onText, onShape, onIcon, onFile, busy }: {
  placement: Placement;
  method: Method;
  disabled: boolean;
  busy: boolean;
  onText: (text: string, letterIn: number, curve: number, weight: 400 | 700 | 900) => void;
  onShape: (shape: string) => void;
  onIcon: (path: string, label: string) => void;
  onFile: (f: File) => void;
}) {
  const [lib, setLib] = useState<"shapes" | "icons" | "objects">("icons");
  const [txt, setTxt] = useState("");
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-white">Text</h3>
        <div className="flex gap-2">
          <input className={studioInput} value={txt} maxLength={120} placeholder="Type your text..." onChange={(e) => setTxt(e.target.value)} disabled={disabled}
            onKeyDown={(e) => { if (e.key === "Enter" && txt.trim()) { onText(txt.trim(), Math.min(1, placement.heightIn / 4), 0, 700); setTxt(""); } }} />
          <button type="button" disabled={disabled || !txt.trim()} className="shrink-0 rounded-[var(--admin-radius-sm)] bg-[var(--admin-accent)] px-3 text-xs font-bold text-black disabled:opacity-40"
            onClick={() => { onText(txt.trim(), Math.min(1, placement.heightIn / 4), 0, 700); setTxt(""); }}>Add</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {textPresets(placement).map((p) => (
            <button key={p.id} type="button" disabled={disabled} title={p.hint} onClick={() => onText(p.text, p.letterIn, p.curve ?? 0, p.weight ?? 700)}
              className="rounded-[var(--admin-radius-sm)] border border-white/15 bg-black/30 px-2 py-2 text-left text-xs text-white/85 hover:border-[var(--admin-accent)] disabled:opacity-40">
              <b className="block text-white">{p.label}</b>
              <span className="text-white/50">{p.letterIn}&quot; letters{p.curve ? ", arched" : ""}</span>
            </button>
          ))}
        </div>
        <h3 className="pt-2 text-sm font-semibold text-white">Artwork</h3>
        <Row label="Upload art" hint="Stays in this browser (not uploaded yet). Best: transparent PNG at 300 DPI at print size, or SVG. 12 in wide = 3600 px.">
          <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" disabled={disabled || busy} className="text-xs text-white/80"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = ""; }} />
        </Row>
        {method === "embroidery" ? <p className="text-[0.72rem] text-[var(--admin-gold)]">Embroidery: Printful digitizes your art into stitches. Flat colours only, no gradients or photos - the checks will tell you.</p> : null}
        {busy ? <p className="text-xs text-white/60">Reading image...</p> : null}
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-white">Shapes, icons & objects</h3>
        <div className="flex flex-wrap gap-1">
          {(["rect", "circle", "line"] as const).map((s) => (
            <button key={s} type="button" disabled={disabled} onClick={() => onShape(s)} className="rounded-[var(--admin-radius-sm)] bg-white/10 px-2.5 py-1 text-xs text-white/85 hover:bg-white/20 disabled:opacity-40">
              {s === "rect" ? "\u25ad Rectangle" : s === "circle" ? "\u25ef Circle" : "\u2501 Line"}
            </button>
          ))}
        </div>
        <Segmented label="Library" value={lib} options={[{ value: "icons", label: "Icons" }, { value: "objects", label: "Objects" }, { value: "shapes", label: "Shapes" }]} onChange={setLib} />
        {lib === "shapes" ? (
          <LibraryPicker key="s" items={SHAPE_ITEMS} noun="shapes" placeholder="Search shapes (star, badge, shield...)" disabled={disabled} cols="grid-cols-6 sm:grid-cols-8" maxH="max-h-48"
            thumb={(i) => { const pts = shapePoints(i.id as ShapeKind); return <svg viewBox="-4 -4 108 108" className="h-full w-full" aria-hidden="true">{pts ? <polygon points={pts} fill="#7ed957" /> : null}</svg>; }}
            onPick={(i) => onShape(i.id)} />
        ) : null}
        {lib === "icons" ? (
          <LibraryPicker key="i" items={BANNER_ICON_LIST} cats={BANNER_ICON_CATS} noun="icons" placeholder="Search icons (leaf, mountains, fire...)" disabled={disabled} cols="grid-cols-8 sm:grid-cols-10" maxH="max-h-48"
            thumb={(i) => pathThumb(BANNER_ICON_DATA[i.id]?.fill?.[0])}
            onPick={(i) => { const d = BANNER_ICON_DATA[i.id]?.fill?.join(" "); if (d) onIcon(d, i.label); }}
            footer="Filled style - solid shapes print and stitch best." />
        ) : null}
        {lib === "objects" ? (
          <LibraryPicker key="o" items={BANNER_OBJECT_LIST} cats={BANNER_OBJECT_CATS} noun="objects" placeholder="Search objects (leaf, badge, frame...)" disabled={disabled} cols="grid-cols-8 sm:grid-cols-10" maxH="max-h-48"
            thumb={(i) => pathThumb(BANNER_OBJECT_DATA[i.id])}
            onPick={(i) => { const d = BANNER_OBJECT_DATA[i.id]; if (d) onIcon(d, i.label); }} />
        ) : null}
      </section>
    </div>
  );
}
