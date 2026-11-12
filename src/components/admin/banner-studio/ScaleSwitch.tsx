"use client";

/**
 * D234 slice C-3 (SOP-11b, G-96; Q-11-10 / Q-11-11 / Q-11-13).
 *
 * Shows whether the banner is in Scale mode (text and buttons grow and shrink
 * with the banner, like a picture) or on the old fixed sizes. Existing banners
 * switch only when the owner presses "Switch to Scale" after seeing a
 * before / after at a real width. "Switch back" restores the old design
 * exactly (`withoutScale`). Cards keep their own card scaling: no switch.
 */
import { useState, type CSSProperties } from "react";
import { DesignedBanner } from "@/components/site/DesignedBanner";
import { DESKTOP_REF_PX, sizingOf, withScale, withoutScale, type BannerDesign } from "@/lib/cms/banner-design-core";
import { stillDesign } from "@/lib/brand/brand-sizes-core";
import { useStudioFontVars } from "./StudioSiteFonts";

/** Before / after widths: big screen, 1024 laptop, 360 phone (SOP-11b §9.3). */
const COMPARE = [
  { w: 1856, label: "Big screen" },
  { w: 960, label: "Laptop" },
  { w: 328, label: "Phone" },
] as const;
const SHOW_PX = 300; // each preview is drawn at this width

const chip = (on: boolean) =>
  on
    ? "rounded-full bg-[var(--admin-accent)] px-2 py-0.5 text-[0.7rem] font-bold text-black"
    : "rounded-full bg-white/10 px-2 py-0.5 text-[0.7rem] text-white/75 hover:bg-white/20";

function Preview({ design, w, imageSrc, imageAlt, legacy, title }: { design: BannerDesign; w: number; imageSrc: string; imageAlt: string; legacy: { eyebrow?: string; title?: string; subtitle?: string }; title: string }) {
  const fontVars = useStudioFontVars();
  const k = SHOW_PX / w;
  return (
    <figure className="space-y-1">
      <figcaption className="text-[0.7rem] font-semibold text-white/75">{title}</figcaption>
      <div style={{ width: SHOW_PX, overflow: "hidden" }} aria-hidden>
        <div style={{ width: w, transform: `scale(${k})`, transformOrigin: "top left", pointerEvents: "none", ...(fontVars as CSSProperties) }}>
          <DesignedBanner design={stillDesign(design)} imageSrc={imageSrc} imageAlt={imageAlt} legacy={legacy} headingLevel={2} frameClassName="" />
        </div>
      </div>
    </figure>
  );
}

export function ScaleSwitch({
  design,
  imageSrc,
  imageAlt,
  legacy,
  onChange,
}: {
  design: BannerDesign;
  imageSrc: string;
  imageAlt: string;
  legacy: { eyebrow?: string; title?: string; subtitle?: string };
  onChange: (d: BannerDesign) => void;
}) {
  const [open, setOpen] = useState(false);
  const [w, setW] = useState<number>(COMPARE[0].w);
  const mode = sizingOf(design);
  if (mode === "card") return null;
  const scaled = mode === "scale";
  const before = scaled ? withoutScale(design) : design;
  const after = scaled ? design : withScale(design);
  return (
    <div className="space-y-1.5 rounded-md border border-white/10 px-2 py-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-white/80">Sizing:</span>
        {scaled ? (
          <span className="text-white/75">
            <b className="text-[var(--admin-accent)]">Scale</b>: words and buttons grow and shrink with the banner, so they stay where you put them at every width. Text never goes under 12 px.
          </span>
        ) : (
          <span className="text-white/75">
            <b>Fixed sizes</b> (older banners): the banner&apos;s shape and the text size change differently from the width, so items can look moved on other screens.
          </span>
        )}
        <button type="button" className={chip(open)} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {scaled ? "Compare / switch back" : "Switch to Scale…"}
        </button>
      </div>
      {open ? (
        <div className="space-y-2 rounded-md bg-black/30 p-2">
          <div role="group" aria-label="Compare at" className="flex flex-wrap items-center gap-1">
            <span className="text-white/60">Compare at:</span>
            {COMPARE.map((c) => (
              <button key={c.w} type="button" className={chip(w === c.w)} onClick={() => setW(c.w)}>
                {c.label} · {c.w}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <Preview design={before} w={w} imageSrc={imageSrc} imageAlt={imageAlt} legacy={legacy} title="Before: fixed sizes" />
            <Preview design={after} w={w} imageSrc={imageSrc} imageAlt={imageAlt} legacy={legacy} title="After: Scale" />
          </div>
          <p className="text-white/55">
            In Scale mode the banner keeps the shape you designed at {DESKTOP_REF_PX} px (computer) and 390 px (phone), so at {w} px it is {w < 768 ? "the phone shape" : "the computer shape"}. Your Phone layout stays separate.
          </p>
          {scaled ? (
            <button type="button" className="rounded-full bg-white/10 px-3 py-1 text-white/85 hover:bg-white/20" onClick={() => { onChange(withoutScale(design)); setOpen(false); }}>
              Switch back to fixed sizes
            </button>
          ) : (
            <button type="button" className="rounded-full bg-[var(--admin-accent)] px-3 py-1 font-bold text-black" onClick={() => { onChange(withScale(design)); setOpen(false); }}>
              Switch to Scale
            </button>
          )}
          <p className="text-white/45">Undo (Ctrl+Z) also works. Nothing changes on the website until you save and publish.</p>
        </div>
      ) : null}
    </div>
  );
}
