"use client";

/**
 * R56-S4 — one-click badge stickers (sale burst, % off seal, new star …).
 * Each sticker = a normal shape + a centred badge text box, so every part
 * stays fully editable (any colour, words, size, rotation) afterwards.
 */
import { MAX_TEXT_BOXES, defaultTextBox, frameRefPx, nextId, type BannerDesign } from "@/lib/cms/banner-design-core";
import { MAX_ELEMENTS, defaultElement } from "@/lib/cms/banner-elements-core";
import { BADGE_PRESETS, badgeParts, type BadgePreset } from "@/lib/cms/button-fx-core";
import { DesignShape } from "@/components/site/DesignShape";
import type { StudioSelection } from "./StudioCanvas";

export function BadgeStickers({ design, onChange, onSelect }: { design: BannerDesign; onChange: (d: BannerDesign) => void; onSelect: (s: StudioSelection) => void }) {
  const elements = design.elements ?? [];
  const full = elements.length >= MAX_ELEMENTS || design.boxes.length >= MAX_TEXT_BOXES;

  function add(p: BadgePreset) {
    if (full) return;
    // R61-S3: cards use their own reference size (frameRefPx).
    const d0 = frameRefPx(design, "desktop");
    const m0 = frameRefPx(design, "mobile");
    const parts = badgeParts(p, 100 - p.w - 4, 8, { height: d0.h, heightMobile: m0.h, refW: d0.w, refWm: m0.w });
    const el = defaultElement(parts.element.shape, { ...parts.element, id: nextId(design, p.id) });
    const withEl = { ...design, elements: [...elements, el] };
    const box = defaultTextBox("badge", { ...parts.box, id: nextId(withEl, `${p.id}-text`), backdrop: "none", weight: 900, lineHeight: 1.1, wrap: "nowrap" });
    onChange({ ...withEl, boxes: [...design.boxes, box], ...(design.order ? { order: [...design.order, el.id, box.id] } : {}) });
    onSelect({ target: "box", id: box.id });
  }

  return (
    <div className="space-y-2 rounded-lg border border-white/10 p-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-white/70">Badge stickers</span>
        <span className="text-[0.65rem] text-white/45">Shape + words, both editable</span>
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {BADGE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={full}
            onClick={() => add(p)}
            title={`Add ${p.label.toLowerCase()}`}
            className="relative flex flex-col items-center gap-1 rounded-md border border-white/10 bg-black/30 p-1.5 text-[0.6rem] text-white/70 hover:border-[var(--admin-accent)] disabled:opacity-40"
          >
            <span className="relative flex h-9 w-full items-center justify-center" style={{ rotate: `${p.rotate}deg` }}>
              <span className={p.shape === "rect" ? "absolute inset-x-0 top-2 h-5" : "absolute h-9 w-9"}>
                <DesignShape el={defaultElement(p.shape, { fill: p.fill, radius: 4, ...(p.stroke ? { stroke: p.stroke, strokeWidth: 1 } : {}) })} />
              </span>
              <span className="relative text-[0.5rem] font-black leading-none" style={{ color: p.color }}>
                {p.text}
              </span>
            </span>
            {p.label}
          </button>
        ))}
      </div>
      {full ? <p className="text-[0.65rem] text-white/45">Banner is full — remove a shape or text box to add a sticker.</p> : null}
    </div>
  );
}
