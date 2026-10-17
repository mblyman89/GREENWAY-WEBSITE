"use client";

/**
 * R70 S2 - "Selected" sub-tab: precise inch controls for the selected
 * element (position, size, rotation, opacity, outline), typography for text
 * (font, weight, size BY LETTER HEIGHT, spacing, arch), colours from brand
 * swatches or - for embroidery - Printful's 15 thread colours, and the
 * image facts (DPI at this size, detected colours, photo/gradient flags).
 */
import { FONT_OPTIONS } from "@/lib/cms/fonts";
import { ColorField, NumberSlider, Row, Segmented, Toggle, studioInput } from "@/components/admin/banner-studio/controls";
import { THREAD_PALETTE, nearestThread, type Method, type Placement } from "@/lib/merch-studio/garment-catalog-core";
import { DPI_IDEAL, DPI_MIN, effectiveDpi, maxInchesAt300 } from "@/lib/merch-studio/print-rules-core";
import { CAP_HEIGHT_EM, X_HEIGHT_EM, letterHeightIn, type MElement } from "@/lib/merch-studio/merch-design-core";

const r2 = (n: number) => Math.round(n * 100) / 100;

function ThreadPicker({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  const near = nearestThread(value);
  return (
    <Row label={label} hint={`Printful thread ${near.code} ${near.name}${near.hex.toLowerCase() === value.toLowerCase() ? "" : " (nearest)"}`}>
      <div className="flex flex-wrap gap-1.5">
        {THREAD_PALETTE.map((t) => (
          <button key={t.code} type="button" title={`${t.code} ${t.name}`} aria-label={`${label}: ${t.name}`} onClick={() => onChange(t.hex)}
            className={`h-6 w-6 rounded-full border ${t.hex.toLowerCase() === value.toLowerCase() ? "border-[var(--admin-accent)] ring-2 ring-[var(--admin-accent)]/50" : "border-white/30"}`}
            style={{ backgroundColor: t.hex }} />
        ))}
      </div>
    </Row>
  );
}

export function ElementPanel({ el, placement, method, onChange, onRemeasure }: {
  el: MElement;
  placement: Placement;
  method: Method;
  onChange: (patch: Partial<MElement>) => void;
  /** Text changed in a way that needs re-measuring (text/font/weight/spacing/size). */
  onRemeasure: (patch: Partial<MElement>) => void;
}) {
  const emb = method === "embroidery";
  const Color = emb ? ThreadPicker : ColorField;
  const fs = el.fontSizeIn ?? 0.6;
  const caps = /[A-Z0-9]/.test(el.text ?? "");
  const lh = letterHeightIn(el);
  const dpi = el.kind === "image" && el.pxW && el.pxH && !el.vector ? effectiveDpi(el.pxW, el.pxH, el.w, el.h) : null;

  return (
    <div className="grid gap-x-6 gap-y-2 lg:grid-cols-2">
      <section className="space-y-2">
        <Row label="Name (layers list)">
          <input className={studioInput} value={el.name ?? ""} maxLength={60} onChange={(e) => onChange({ name: e.target.value })} />
        </Row>
        <div className="grid grid-cols-2 gap-2">
          <NumberSlider label="From left" value={r2(el.x)} min={-2} max={placement.widthIn} step={0.0625} unit="in" onChange={(v) => onChange({ x: v })} />
          <NumberSlider label="From top" value={r2(el.y)} min={-2} max={placement.heightIn} step={0.0625} unit="in" onChange={(v) => onChange({ y: v })} />
        </div>
        {el.kind === "text" ? (
          <p className="text-[0.72rem] text-white/55">Box {r2(el.w)}&quot; x {r2(el.h)}&quot; (measured from the font). Size text by letter height below.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <NumberSlider label="Width" value={r2(el.w)} min={0.05} max={placement.widthIn} step={0.0625} unit="in"
              onChange={(v) => onChange(el.kind === "shape" ? { w: v } : { w: v, h: r2((v * el.h) / el.w) })} />
            <NumberSlider label="Height" value={r2(el.h)} min={0.05} max={placement.heightIn} step={0.0625} unit="in"
              onChange={(v) => onChange(el.kind === "shape" ? { h: v } : { h: v, w: r2((v * el.w) / el.h) })} />
          </div>
        )}
        <div className="flex flex-wrap gap-1">
          {([["Center H", { x: r2((placement.widthIn - el.w) / 2) }], ["Center V", { y: r2((placement.heightIn - el.h) / 2) }], ["Top", { y: 0 }], ["Fill width", el.kind === "text" ? null : { x: 0, w: placement.widthIn, h: el.kind === "shape" ? el.h : r2((placement.widthIn * el.h) / el.w) }]] as const).map(([lab, patch]) =>
            patch ? <button key={lab} type="button" className="rounded bg-white/10 px-2 py-0.5 text-[0.7rem] text-white/80 hover:bg-white/20" onClick={() => onChange(patch)}>{lab}</button> : null)}
        </div>
        <NumberSlider label="Rotate" value={el.rotate} min={-180} max={180} step={1} unit="deg" onChange={(v) => onChange({ rotate: v })} hint="Drag the round handle; hold Shift for 15 deg steps." />
        <NumberSlider label="Opacity" value={el.opacity} min={0} max={100} step={1} unit="%" onChange={(v) => onChange({ opacity: v })} hint={emb ? "Thread is never see-through - keep 100%." : undefined} />
        <div className="flex gap-4">
          <Toggle label="Lock" checked={!!el.locked} onChange={(v) => onChange({ locked: v })} />
          <Toggle label="Hide" checked={!!el.hidden} onChange={(v) => onChange({ hidden: v })} />
        </div>
      </section>

      <section className="space-y-2">
        {el.kind === "text" ? (
          <>
            <Row label="Text" hint="Enter = new line. Arched text uses the first line only.">
              <textarea className={`${studioInput} min-h-[3.5rem]`} value={el.text ?? ""} maxLength={400} onChange={(e) => onRemeasure({ text: e.target.value })} />
            </Row>
            <Row label="Font">
              <select className={studioInput} value={el.fontId ?? "system"} onChange={(e) => onRemeasure({ fontId: e.target.value })}>
                {FONT_OPTIONS.map((f) => <option key={f.id} value={f.id}>{f.label} - {f.category}</option>)}
              </select>
            </Row>
            <div className="flex flex-wrap items-end gap-3">
              <Segmented label="Weight" value={String(el.weight ?? 700) as "400" | "700" | "900"} options={[{ value: "400", label: "Regular" }, { value: "700", label: "Bold" }, { value: "900", label: "Black" }]}
                onChange={(v) => onRemeasure({ weight: Number(v) as 400 | 700 | 900 })} />
              <Toggle label="Italic" checked={!!el.italic} onChange={(v) => onRemeasure({ italic: v })} />
            </div>
            <NumberSlider label={caps ? "Letter height (capitals)" : "Letter height (lowercase x-height)"} value={r2(lh)} min={0.1} max={Math.max(1, placement.heightIn)} step={0.01} unit="in"
              onChange={(v) => onRemeasure({ fontSizeIn: Math.round((v / (caps ? CAP_HEIGHT_EM : X_HEIGHT_EM)) * 10000) / 10000 })}
              hint={`Estimate: ${caps ? "cap" : "x"}-height ~${caps ? CAP_HEIGHT_EM : X_HEIGHT_EM} em (font size ${r2(fs)}"). Minimum 0.25" (beanies 0.3" capitals).`} />
            <NumberSlider label="Letter spacing" value={el.letterSpacingEm ?? 0} min={-0.1} max={0.6} step={0.01} unit="em" onChange={(v) => onRemeasure({ letterSpacingEm: v })} />
            {(el.text ?? "").includes("\n") ? <NumberSlider label="Line spacing" value={el.lineHeight ?? 1.1} min={0.7} max={2} step={0.05} unit="x" onChange={(v) => onRemeasure({ lineHeight: v })} /> : null}
            {(el.text ?? "").includes("\n") ? (
              <Segmented label="Align" value={el.align ?? "center"} options={[{ value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" }]} onChange={(v) => onChange({ align: v })} />
            ) : (
              <NumberSlider label="Arch" value={el.curve ?? 0} min={-100} max={100} step={1} onChange={(v) => onRemeasure({ curve: v })} hint="Up = rainbow arch, down = smile. 0 = straight." />
            )}
          </>
        ) : null}
        {el.kind !== "image" ? (
          <>
            <Color label="Colour" value={el.fill} onChange={(hex) => onChange({ fill: hex })} />
            {el.kind === "shape" && el.shape === "rect" ? <NumberSlider label="Corner radius" value={el.radiusIn ?? 0} min={0} max={Math.min(el.w, el.h) / 2} step={0.0625} unit="in" onChange={(v) => onChange({ radiusIn: v })} /> : null}
            <NumberSlider label="Outline" value={el.strokeIn} min={0} max={0.5} step={0.01} unit="in" onChange={(v) => onChange({ strokeIn: v })}
              hint={emb ? "Embroidery needs outlines >= 0.05\"." : "Print: >= 1 pt (0.014\") or it may wash out."} />
            {el.strokeIn > 0 ? <Color label="Outline colour" value={el.strokeColor} onChange={(hex) => onChange({ strokeColor: hex })} /> : null}
          </>
        ) : (
          <>
            <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-2 text-xs text-white/75">
              <p><b className="text-white">{el.name}</b> - {el.vector ? "vector (SVG): sharp at any size" : `${el.pxW} x ${el.pxH} px`}</p>
              {dpi !== null ? (
                <p className={dpi < DPI_MIN ? "text-[var(--admin-danger)]" : dpi < DPI_IDEAL ? "text-[var(--admin-gold)]" : "text-[var(--admin-accent)]"}>
                  {dpi} DPI at {r2(el.w)}&quot; wide - sharp (300 DPI) up to {maxInchesAt300(el.pxW!)}&quot;.
                </p>
              ) : null}
              {el.imgColors?.length ? (
                <p className="mt-1 flex flex-wrap items-center gap-1">Main colours (estimate):
                  {el.imgColors.map((c) => <span key={c} title={c} className="inline-block h-4 w-4 rounded-full border border-white/30" style={{ background: c }} />)}
                </p>
              ) : null}
              {el.autoPhoto ? <p className="text-[var(--admin-gold)]">Looks photographic / has gradients (auto-detected - override below).</p> : null}
            </div>
            <Toggle label="Contains gradients / soft shadows" checked={!!el.hasGradient} onChange={(v) => onChange({ hasGradient: v })} />
            <Toggle label="Is a photo / photographic detail" checked={!!el.isPhoto} onChange={(v) => onChange({ isPhoto: v })} />
          </>
        )}
      </section>
    </div>
  );
}
