"use client";

/**
 * R55-S2 — Shapes tab: add decorative shapes (rectangle, circle, line,
 * triangle, star, sale burst, arrow, diamond) and style the selected one.
 * R55-S3 — plus icons (45 curated Phosphor icons, 3 weights, searchable).
 * Shapes and icons are decorative only (hidden from screen readers on the site).
 */
import { useState } from "react";
import { BANNER_ICON_DATA, BANNER_ICON_LIST, BANNER_ICON_WEIGHTS, type BannerIconWeight } from "@/lib/cms/banner-icons-data";
import { nextId, type BannerDesign, type DesignDevice } from "@/lib/cms/banner-design-core";
import { MAX_ELEMENTS, SHAPE_KINDS, defaultElement, defaultIcon, elementLabel, type DesignElement, type ShapeKind } from "@/lib/cms/banner-elements-core";
import { DesignShape } from "@/components/site/DesignShape";
import { ColorField, NumberSlider, Toggle } from "./controls";
import { ElementFxFields } from "./ElementFxFields";
import { ElementMotionFields } from "./MotionFields";
import { BadgeStickers } from "./BadgeStickers";
import type { StudioSelection } from "./StudioCanvas";

export function ShapePanel({
  design,
  device,
  selection,
  onSelect,
  onChange,
  onRequestDelete,
}: {
  design: BannerDesign;
  device: DesignDevice;
  selection: StudioSelection;
  onSelect: (s: StudioSelection) => void;
  onChange: (d: BannerDesign) => void;
  onRequestDelete: (s: NonNullable<StudioSelection>) => void;
}) {
  const elements = design.elements ?? [];
  const el = selection?.target === "element" ? elements.find((e) => e.id === selection.id) : undefined;
  const mobile = device === "mobile";
  const [q, setQ] = useState("");
  const [weight, setWeight] = useState<BannerIconWeight>("fill");
  const iconLabels = Object.fromEntries(BANNER_ICON_LIST.map((i) => [i.id, i.label]));
  const query = q.trim().toLowerCase();
  const icons = query ? BANNER_ICON_LIST.filter((i) => i.label.toLowerCase().includes(query) || i.id.includes(query)) : BANNER_ICON_LIST;
  const full = elements.length >= MAX_ELEMENTS;

  const patch = (id: string, p: Partial<DesignElement>) =>
    onChange({ ...design, elements: elements.map((e) => (e.id === id ? { ...e, ...p } : e)) });

  function push(ne: DesignElement) {
    onChange({ ...design, elements: [...elements, ne], ...(design.order ? { order: [...design.order, ne.id] } : {}) });
    onSelect({ target: "element", id: ne.id });
  }
  function add(shape: ShapeKind) {
    if (full) return;
    push(defaultElement(shape, { id: nextId(design, shape) }));
  }
  function addIcon(icon: string) {
    if (full) return;
    const path = BANNER_ICON_DATA[icon]?.[weight]?.[0];
    if (!path) return;
    push(defaultIcon(icon, weight, path, { id: nextId(design, icon) }));
  }
  /** Swap the selected icon's weight (keeps size/colour/position). */
  function setIconWeight(el: DesignElement, w: BannerIconWeight) {
    const path = el.icon ? BANNER_ICON_DATA[el.icon]?.[w]?.[0] : undefined;
    if (path) patch(el.id, { iconWeight: w, iconPath: path });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-white/70">
          Shapes ({elements.length}/{MAX_ELEMENTS})
        </span>
        <span className="text-[0.7rem] text-white/45">Decoration only — screen readers skip shapes.</span>
      </div>
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
        {SHAPE_KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            disabled={elements.length >= MAX_ELEMENTS}
            onClick={() => add(k.id)}
            title={`Add ${k.label.toLowerCase()}`}
            className="flex flex-col items-center gap-1 rounded-md border border-white/10 bg-black/30 p-1.5 text-[0.65rem] text-white/70 hover:border-[var(--admin-accent)] disabled:opacity-40"
          >
            <span className="flex h-7 w-7 items-center">
              <span className={k.id === "line" ? "block h-[3px] w-full" : k.id === "arrow" || k.id === "rect" ? "block h-4 w-full" : "block h-7 w-full"}>
                <DesignShape el={defaultElement(k.id, { radius: 4 })} />
              </span>
            </span>
            {k.label}
          </button>
        ))}
      </div>

      <BadgeStickers design={design} onChange={onChange} onSelect={onSelect} />

      <div className="space-y-2 rounded-lg border border-white/10 p-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-white/70">Icons</span>
          <input
            className="min-w-0 flex-1 rounded-md border border-white/15 bg-black/40 px-2 py-1 text-xs text-white outline-none focus:border-[var(--admin-accent)]"
            placeholder="Search icons (leaf, gift, clock…)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search icons"
          />
          <div role="radiogroup" aria-label="Icon style" className="flex gap-1">
            {BANNER_ICON_WEIGHTS.map((w) => (
              <button
                key={w}
                type="button"
                role="radio"
                aria-checked={weight === w}
                onClick={() => setWeight(w)}
                className={weight === w ? "rounded-full bg-[var(--admin-accent)] px-2 py-0.5 text-[0.65rem] font-bold text-black" : "rounded-full bg-white/10 px-2 py-0.5 text-[0.65rem] text-white/70"}
              >
                {w === "regular" ? "Thin" : w === "bold" ? "Bold" : "Solid"}
              </button>
            ))}
          </div>
        </div>
        <div className="grid max-h-40 grid-cols-8 gap-1 overflow-y-auto sm:grid-cols-12">
          {icons.map((i) => (
            <button
              key={i.id}
              type="button"
              disabled={full}
              onClick={() => addIcon(i.id)}
              title={`Add ${i.label.toLowerCase()} icon`}
              aria-label={`Add ${i.label} icon`}
              className="flex aspect-square items-center justify-center rounded-md bg-black/30 p-1.5 text-white/85 hover:bg-white/10 disabled:opacity-40"
            >
              <svg viewBox="0 0 256 256" className="h-full w-full" aria-hidden="true" focusable="false">
                <path d={BANNER_ICON_DATA[i.id][weight][0]} fill="currentColor" />
              </svg>
            </button>
          ))}
          {icons.length === 0 ? <p className="col-span-full text-xs text-white/45">No icon matches “{q}”.</p> : null}
        </div>
        <p className="text-[0.65rem] text-white/35">Icons by Phosphor (MIT). Only the icon you pick is saved into the banner.</p>
      </div>

      {el ? (
        <div className="space-y-3 rounded-lg border border-white/10 bg-black/30 p-3">
          <p className="text-xs font-semibold text-white/80">
            {elementLabel(el, iconLabels)}
            {el.locked ? " 🔒" : ""}
          </p>
          {el.kind === "icon" ? (
            <>
              <ColorField label="Icon colour" value={el.fill} onChange={(fill) => patch(el.id, { fill })} />
              <div className="flex gap-1">
                {BANNER_ICON_WEIGHTS.map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setIconWeight(el, w)}
                    aria-pressed={el.iconWeight === w}
                    className={el.iconWeight === w ? "rounded-full bg-[var(--admin-accent)] px-3 py-1 text-xs font-bold text-black" : "rounded-full bg-white/10 px-3 py-1 text-xs text-white/75"}
                  >
                    {w === "regular" ? "Thin" : w === "bold" ? "Bold" : "Solid"}
                  </button>
                ))}
              </div>
            </>
          ) : null}
          {el.kind !== "icon" && el.shape !== "line" ? (
            <>
              <ColorField label="Fill colour" value={el.fill} onChange={(fill) => patch(el.id, { fill })} />
              <NumberSlider label="Fill strength" value={el.fillOpacity} min={0} max={100} unit="%" onChange={(fillOpacity) => patch(el.id, { fillOpacity })} hint="0% = outline only" />
            </>
          ) : null}
          {el.kind !== "icon" ? (
            <>
              <ColorField label={el.shape === "line" ? "Line colour" : "Border colour"} value={el.stroke} onChange={(stroke) => patch(el.id, { stroke })} />
              <NumberSlider label={el.shape === "line" ? "Thickness" : "Border width"} value={el.strokeWidth} min={el.shape === "line" ? 1 : 0} max={24} unit="px" onChange={(strokeWidth) => patch(el.id, { strokeWidth })} />
            </>
          ) : null}
          {el.kind !== "icon" && el.shape === "rect" ? <NumberSlider label="Rounded corners" value={el.radius} min={0} max={200} unit="px" onChange={(radius) => patch(el.id, { radius })} /> : null}
          <ElementFxFields el={el} patch={(p) => patch(el.id, p)} />
          <ElementMotionFields el={el} patch={(p) => patch(el.id, p)} />
          <NumberSlider label="Rotate" value={el.rotate} min={-180} max={180} unit="°" onChange={(rotate) => patch(el.id, { rotate })} />
          <NumberSlider label="See-through" value={el.opacity} min={5} max={100} unit="%" onChange={(opacity) => patch(el.id, { opacity })} />
          <div className="rounded-md border border-white/10 p-2">
            <p className="mb-2 text-[0.7rem] font-semibold uppercase tracking-wide text-white/60">Size &amp; position {mobile ? "— phone layout" : "— computer layout"}</p>
            <div className="grid grid-cols-2 gap-2">
              <NumberSlider label="Across (X)" value={mobile ? (el.mx ?? el.x) : el.x} min={0} max={100} step={0.5} unit="%" onChange={(x) => patch(el.id, mobile ? { mx: x } : { x })} />
              <NumberSlider label="Down (Y)" value={mobile ? (el.my ?? el.y) : el.y} min={0} max={100} step={0.5} unit="%" onChange={(y) => patch(el.id, mobile ? { my: y } : { y })} />
              <NumberSlider label="Width" value={mobile ? (el.mw ?? el.w) : el.w} min={1} max={100} step={0.5} unit="%" onChange={(w) => patch(el.id, mobile ? { mw: w } : { w })} />
              {el.h !== null && el.shape !== "line" && el.kind !== "icon" ? (
                <NumberSlider label="Height" value={mobile ? (el.mh ?? el.h) : el.h} min={1} max={100} step={0.5} unit="%" onChange={(h) => patch(el.id, mobile ? { mh: h } : { h })} />
              ) : null}
            </div>
            {el.shape !== "line" && el.kind !== "icon" ? (
              <div className="mt-2">
                <Toggle label="Keep square (circles stay round)" checked={el.h === null} onChange={(sq) => patch(el.id, sq ? { h: null, mh: null } : { h: 20 })} />
              </div>
            ) : null}
            {mobile && (el.mx !== null || el.my !== null || el.mw !== null || el.mh !== null) ? (
              <button type="button" className="mt-2 text-xs text-white/60 underline" onClick={() => patch(el.id, { mx: null, my: null, mw: null, mh: null })}>
                Use computer size &amp; position on phones
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-3">
            <Toggle label="Show" checked={!el.hidden} onChange={(v) => patch(el.id, { hidden: !v })} />
            <Toggle label="Hide on phones" checked={el.hideOnMobile} onChange={(hideOnMobile) => patch(el.id, { hideOnMobile })} />
            <Toggle label="Lock in place" checked={!!el.locked} onChange={(v) => patch(el.id, { locked: v || undefined })} />
          </div>
          <div className="border-t border-white/10 pt-2">
            <button type="button" className="rounded-full bg-[var(--admin-danger)]/80 px-3 py-1 text-xs font-semibold text-white hover:bg-[var(--admin-danger)]" onClick={() => onRequestDelete({ target: "element", id: el.id })}>
              Delete {el.kind === "icon" ? "icon" : "shape"}
            </button>
          </div>
        </div>
      ) : elements.length ? (
        <p className="text-xs text-white/45">Click a shape in the preview (or the Layers tab) to style it.</p>
      ) : (
        <p className="text-xs text-white/45">Pick a shape above to add it. Tip: a soft dark rectangle behind text makes it easier to read.</p>
      )}
    </div>
  );
}
