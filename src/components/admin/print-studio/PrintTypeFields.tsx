"use client";

/**
 * D263 S4: print-only type tools inside the Text tab (shown when the design
 * has a print frame): the 120+ font Google library with live previews,
 * artistic type (3D, long shadow, retro, glitch, emboss, double outline,
 * glow ring), metal / colour gradient presets and picture-filled letters.
 */
import { useMemo, useState } from "react";
import type { BannerDesign, DesignTextBox } from "@/lib/cms/banner-design-core";
import {
  ART_DEPTH_MAX,
  GRADIENT_PRESETS,
  PRINT_FONTS,
  PRINT_FONT_CATS,
  TEXT_ART_KINDS,
  printFontHref,
  printFontId,
  printFontStack,
  safeArtImg,
  type PrintFontCat,
  type TextArt,
  type TextArtKind,
} from "@/lib/printing/print-type-core";
import { ColorField, NumberSlider } from "@/components/admin/banner-studio/controls";

/** Loads every Google font the design uses (plus extra ids for previews). */
export function PrintFontFaces({ design, extra = [] }: { design: BannerDesign; extra?: string[] }) {
  const ids = useMemo(() => {
    const set = new Set<string>(extra);
    for (const b of design.boxes) if (b.font.startsWith("gf:")) set.add(b.font);
    for (const b of design.buttons) if (b.font.startsWith("gf:")) set.add(b.font);
    return [...set];
  }, [design, extra]);
  return (
    <>
      {ids.map((id) => {
        const href = printFontHref(id);
        return href ? <link key={id} rel="stylesheet" href={href} /> : null;
      })}
    </>
  );
}

const chip = (on: boolean) => `rounded border px-2 py-0.5 text-[11px] ${on ? "border-[#ffd700] text-[#ffd700]" : "border-white/15 text-white/75 hover:border-white/40"}`;

export function PrintTypeFields({ box, design, imageSrc = "", patch }: { box: DesignTextBox; design: BannerDesign; imageSrc?: string; patch: (p: Partial<DesignTextBox>) => void }) {
  const [cat, setCat] = useState<PrintFontCat | null>(null);
  const [q, setQ] = useState("");
  const art = box.art;
  const setArt = (p: Partial<TextArt> | null) => patch({ art: p === null ? undefined : ({ kind: "extrude", depth: 6, color: "#000000", angle: 45, ...art, ...p } as TextArt) });
  const list = cat ? PRINT_FONTS.filter((f) => f.cat === cat && f.family.toLowerCase().includes(q.toLowerCase())) : [];
  const sample = (box.text || "Greenway").split("\n")[0].slice(0, 22);
  return (
    <div className="space-y-2 rounded-md border border-[#ffd700]/30 bg-[#ffd700]/5 p-2">
      <p className="text-xs font-semibold text-[#ffd700]">🖨️ Print type</p>

      <div className="space-y-1">
        <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-white/60">Font library ({PRINT_FONTS.length} fonts)</p>
        <div className="flex flex-wrap gap-1">
          {PRINT_FONT_CATS.map((c) => (
            <button key={c.cat} type="button" className={chip(cat === c.cat)} onClick={() => setCat(cat === c.cat ? null : c.cat)}>
              {c.label.replace("Print: ", "")}
            </button>
          ))}
        </div>
        {cat ? (
          <>
            <PrintFontFaces design={design} extra={list.map((f) => printFontId(f.family))} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search fonts…" className="w-full rounded border border-white/15 bg-black/40 px-2 py-1 text-xs text-white" />
            <div className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto pr-1 sm:grid-cols-2">
              {list.map((f) => {
                const id = printFontId(f.family);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => patch({ font: id })}
                    className={`truncate rounded border px-2 py-1 text-left ${box.font === id ? "border-[#ffd700] bg-[#ffd700]/10" : "border-white/10 hover:border-white/40"}`}
                    title={f.family}
                  >
                    <span className="block truncate text-lg leading-tight text-white" style={{ fontFamily: printFontStack(id) ?? undefined }}>
                      {sample}
                    </span>
                    <span className="text-[10px] text-white/50">{f.family}</span>
                  </button>
                );
              })}
            </div>
          </>
        ) : null}
      </div>

      <div className="space-y-1">
        <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-white/60">Artistic type</p>
        <div className="flex flex-wrap gap-1">
          <button type="button" className={chip(!art || (!art.depth && !art.img))} onClick={() => setArt(art?.img ? { depth: 0 } : null)}>
            None
          </button>
          {TEXT_ART_KINDS.map((k) => (
            <button key={k.id} type="button" title={k.help} className={chip(art?.kind === k.id && art.depth > 0)} onClick={() => setArt({ kind: k.id as TextArtKind, depth: art?.depth || 6 })}>
              {k.label}
            </button>
          ))}
        </div>
        {art && art.depth > 0 ? (
          <>
            <NumberSlider label="Depth / strength" value={art.depth} min={1} max={ART_DEPTH_MAX} step={0.5} onChange={(depth) => setArt({ depth })} />
            {art.kind === "extrude" || art.kind === "long" || art.kind === "retro" ? <NumberSlider label="Direction" value={art.angle} min={0} max={360} step={15} unit="°" onChange={(angle) => setArt({ angle })} /> : null}
            <ColorField label="Effect colour" value={art.color} onChange={(color) => setArt({ color })} />
            {art.kind === "retro" || art.kind === "glitch" || art.kind === "double" ? <ColorField label="Second colour" value={art.color2 ?? "#f2c14e"} onChange={(color2) => setArt({ color2 })} /> : null}
          </>
        ) : null}
      </div>

      <div className="space-y-1">
        <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-white/60">Metal & colour letters</p>
        <div className="flex flex-wrap gap-1">
          {GRADIENT_PRESETS.map((g) => (
            <button
              key={g.id}
              type="button"
              title={g.label}
              onClick={() => patch({ gradient: { from: g.from, to: g.to, angle: g.angle }, backdrop: "none" })}
              className="h-6 w-10 rounded border border-white/20"
              style={{ backgroundImage: `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})` }}
            />
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-white/60">Picture inside the letters</p>
        <div className="flex gap-1">
          <input
            value={art?.img ?? ""}
            onChange={(e) => {
              const img = safeArtImg(e.target.value);
              if (img) setArt({ img, depth: art?.depth ?? 0 });
              else if (!e.target.value) setArt(art && art.depth > 0 ? { img: undefined } : null);
            }}
            placeholder="Paste a picture link from Media (https://…)"
            className="w-full rounded border border-white/15 bg-black/40 px-2 py-1 text-xs text-white"
          />
          {safeArtImg(imageSrc) ? (
            <button type="button" className={chip(false)} onClick={() => setArt({ img: safeArtImg(imageSrc), depth: art?.depth ?? 0 })}>
              Use background
            </button>
          ) : null}
        </div>
        <p className="text-[10px] text-white/45">Works best with thick, bold fonts (Anton, Bebas Neue, Ultra).</p>
      </div>
    </div>
  );
}
