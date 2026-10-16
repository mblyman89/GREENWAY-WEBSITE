"use client";

/**
 * R55-S2 — Shapes tab: add decorative shapes (rectangle, circle, line,
 * triangle, star, sale burst, arrow, diamond) and style the selected one.
 * Shapes are decorative only (hidden from screen readers on the site).
 */
import { nextId, type BannerDesign, type DesignDevice } from "@/lib/cms/banner-design-core";
import { MAX_ELEMENTS, SHAPE_KINDS, defaultElement, type DesignElement, type ShapeKind } from "@/lib/cms/banner-elements-core";
import { DesignShape } from "@/components/site/DesignShape";
import { ColorField, NumberSlider, Toggle } from "./controls";
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

  const patch = (id: string, p: Partial<DesignElement>) =>
    onChange({ ...design, elements: elements.map((e) => (e.id === id ? { ...e, ...p } : e)) });

  function add(shape: ShapeKind) {
    if (elements.length >= MAX_ELEMENTS) return;
    const id = nextId(design, shape);
    const ne = defaultElement(shape, { id });
    onChange({ ...design, elements: [...elements, ne], ...(design.order ? { order: [...design.order, id] } : {}) });
    onSelect({ target: "element", id });
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

      {el ? (
        <div className="space-y-3 rounded-lg border border-white/10 bg-black/30 p-3">
          <p className="text-xs font-semibold text-white/80">
            {SHAPE_KINDS.find((k) => k.id === el.shape)?.label}
            {el.locked ? " 🔒" : ""}
          </p>
          {el.shape !== "line" ? (
            <>
              <ColorField label="Fill colour" value={el.fill} onChange={(fill) => patch(el.id, { fill })} />
              <NumberSlider label="Fill strength" value={el.fillOpacity} min={0} max={100} unit="%" onChange={(fillOpacity) => patch(el.id, { fillOpacity })} hint="0% = outline only" />
            </>
          ) : null}
          <ColorField label={el.shape === "line" ? "Line colour" : "Border colour"} value={el.stroke} onChange={(stroke) => patch(el.id, { stroke })} />
          <NumberSlider label={el.shape === "line" ? "Thickness" : "Border width"} value={el.strokeWidth} min={el.shape === "line" ? 1 : 0} max={24} unit="px" onChange={(strokeWidth) => patch(el.id, { strokeWidth })} />
          {el.shape === "rect" ? <NumberSlider label="Rounded corners" value={el.radius} min={0} max={200} unit="px" onChange={(radius) => patch(el.id, { radius })} /> : null}
          <NumberSlider label="Rotate" value={el.rotate} min={-180} max={180} unit="°" onChange={(rotate) => patch(el.id, { rotate })} />
          <NumberSlider label="See-through" value={el.opacity} min={5} max={100} unit="%" onChange={(opacity) => patch(el.id, { opacity })} />
          <div className="rounded-md border border-white/10 p-2">
            <p className="mb-2 text-[0.7rem] font-semibold uppercase tracking-wide text-white/60">Size &amp; position {mobile ? "— phone layout" : "— computer layout"}</p>
            <div className="grid grid-cols-2 gap-2">
              <NumberSlider label="Across (X)" value={mobile ? (el.mx ?? el.x) : el.x} min={0} max={100} step={0.5} unit="%" onChange={(x) => patch(el.id, mobile ? { mx: x } : { x })} />
              <NumberSlider label="Down (Y)" value={mobile ? (el.my ?? el.y) : el.y} min={0} max={100} step={0.5} unit="%" onChange={(y) => patch(el.id, mobile ? { my: y } : { y })} />
              <NumberSlider label="Width" value={mobile ? (el.mw ?? el.w) : el.w} min={1} max={100} step={0.5} unit="%" onChange={(w) => patch(el.id, mobile ? { mw: w } : { w })} />
              {el.h !== null && el.shape !== "line" ? (
                <NumberSlider label="Height" value={mobile ? (el.mh ?? el.h) : el.h} min={1} max={100} step={0.5} unit="%" onChange={(h) => patch(el.id, mobile ? { mh: h } : { h })} />
              ) : null}
            </div>
            {el.shape !== "line" ? (
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
              Delete shape
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
