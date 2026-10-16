"use client";

/**
 * R55-S2 — Shapes tab: add decorative shapes (rectangle, circle, line,
 * triangle, star, sale burst, arrow, diamond) and style the selected one.
 * R55-S3 — plus icons (45 curated Phosphor icons, 3 weights, searchable).
 * R58-S4 — one tabbed, searchable, scrollable library: 30 shapes, 240+ icons
 * in 10 categories, 110+ objects (illustrations, frames, dividers).
 * Shapes and icons are decorative only (hidden from screen readers on the site).
 */
import { BANNER_ICON_DATA, BANNER_ICON_WEIGHTS, type BannerIconWeight } from "@/lib/cms/banner-icons-data";
import { nextId, type BannerDesign, type DesignDevice } from "@/lib/cms/banner-design-core";
import { MAX_ELEMENTS, defaultElement, defaultIcon, elementLabel, type DesignElement, type ShapeKind } from "@/lib/cms/banner-elements-core";
import { ColorField, NumberSlider, Toggle } from "./controls";
import { ElementFxFields } from "./ElementFxFields";
import { ElementMotionFields } from "./MotionFields";
import { EnterFields } from "./EnterFields";
import { BadgeStickers } from "./BadgeStickers";
import { LiveBadges } from "./LiveFields";
import { AddLibrary, LIBRARY_LABELS } from "./AddLibrary";
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
  // R60: animation layers are edited in the 🎞️ tab (AnimPanel).
  const el = selection?.target === "element" ? elements.find((e) => e.id === selection.id && e.kind !== "anim") : undefined;
  const mobile = device === "mobile";
  const iconLabels = LIBRARY_LABELS;
  /** Objects are single-style artwork — only Phosphor icons have Thin/Bold/Solid. */
  const hasWeights = !!(el?.icon && BANNER_ICON_DATA[el.icon]);
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
      <AddLibrary
        disabled={full}
        onShape={add}
        onIcon={(icon, weight, path) => !full && push(defaultIcon(icon, weight, path, { id: nextId(design, icon) }))}
        onObject={(id, path) => !full && push(defaultIcon(id, "fill", path, { id: nextId(design, id.replace(/^o-/, "")) }))}
      />
      {full ? <p className="text-xs text-amber-300/80">This banner already has {MAX_ELEMENTS} shapes/icons — delete one to add another.</p> : null}

      <BadgeStickers design={design} onChange={onChange} onSelect={onSelect} />
      <LiveBadges design={design} onChange={onChange} onSelect={onSelect} />

      {el ? (
        <div className="space-y-3 rounded-lg border border-white/10 bg-black/30 p-3">
          <p className="text-xs font-semibold text-white/80">
            {elementLabel(el, iconLabels)}
            {el.locked ? " 🔒" : ""}
          </p>
          {el.kind === "icon" ? (
            <>
              <ColorField label="Icon colour" value={el.fill} onChange={(fill) => patch(el.id, { fill })} />
              <div className={hasWeights ? "flex gap-1" : "hidden"}>
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
          <EnterFields enter={el.enter} reveal={design.reveal} onChange={(enter) => patch(el.id, { enter })} />
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
