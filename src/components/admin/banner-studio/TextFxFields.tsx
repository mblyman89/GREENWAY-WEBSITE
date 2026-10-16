"use client";

/**
 * R55-S4 — font picker (grouped by vibe) + advanced text effects for Banner
 * Studio: sticker outline (width + colour, painted BEHIND the letters),
 * gradient letters (solid colour kept as the fallback) and extra shadows.
 * All values are written only when used, so older designs never change.
 */
import { DEFAULT_FONT_ID, STROKE_MAX, designFontFamily, type DesignShadow, type DesignTextBox } from "@/lib/cms/banner-design-core";
import { CURVE } from "@/lib/cms/banner-curve-core";
import { FONT_OPTIONS, type FontCategory } from "@/lib/cms/fonts";
import { ColorField, NumberSlider, Row, Segmented, Toggle, studioInput } from "./controls";
import { useCustomFonts } from "@/components/admin/fonts/custom-fonts-client";
import { CustomFontFaces, CustomFontUpload } from "@/components/admin/fonts/CustomFontUpload";

const GROUPS: { cat: FontCategory; label: string }[] = [
  { cat: "sans", label: "Clean sans" },
  { cat: "display", label: "Bold display" },
  { cat: "serif", label: "Serif" },
  { cat: "script", label: "Script & handwritten" },
  { cat: "mono", label: "Mono" },
];

export function FontSelect({ value, onChange, preview = false }: { value: string; onChange: (id: string) => void; preview?: boolean }) {
  const style = (id: string) => (preview && designFontFamily(id) ? { fontFamily: designFontFamily(id) ?? undefined } : undefined);
  const mine = useCustomFonts();
  // R56-S2: a font picked in another editor but not (yet) in the list still shows.
  const unknownCustom = value.startsWith("custom:") && !mine.some((f) => f.id === value);
  return (
    <Row label="Font">
      <CustomFontFaces />
      <select className={studioInput} value={value} onChange={(e) => onChange(e.target.value)} style={style(value)}>
        <option value={DEFAULT_FONT_ID}>Site font (default)</option>
        {mine.length || unknownCustom ? (
          <optgroup label="Your fonts">
            {mine.map((f) => (
              <option key={f.id} value={f.id} style={style(f.id)}>
                {f.label}
              </option>
            ))}
            {unknownCustom ? <option value={value}>Uploaded font</option> : null}
          </optgroup>
        ) : null}
        {GROUPS.map((g) => (
          <optgroup key={g.cat} label={g.label}>
            {FONT_OPTIONS.filter((f) => f.category === g.cat).map((f) => (
              <option key={f.id} value={f.id} style={style(f.id)} title={f.note}>
                {f.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <div className="mt-1">
        <CustomFontUpload onUploaded={onChange} />
      </div>
    </Row>
  );
}

const CURVE_PRESETS: [number, string][] = [[0, "Straight"], [25, "Gentle arch"], [55, "Arch"], [100, "Ring"], [-30, "Smile"], [-60, "Deep smile"]];

const SHADOW_OPTIONS: { value: DesignShadow; label: string; title?: string }[] = [
  { value: "none", label: "None" },
  { value: "soft", label: "Soft" },
  { value: "strong", label: "Strong" },
  { value: "glow", label: "Glow" },
  { value: "lift", label: "3D", title: "Hard offset shadow — retro poster look" },
  { value: "neon", label: "Neon", title: "Glows in the letter colour" },
];

export function TextFxFields({ box, patch }: { box: DesignTextBox; patch: (p: Partial<DesignTextBox>) => void }) {
  const stroke = box.strokeWidth ?? 0;
  const g = box.gradient;
  const gradientBlocked = box.backdrop !== "none";
  return (
    <>
      <NumberSlider
        label="Curve (− smile · + arch)"
        value={box.curve ?? 0}
        min={CURVE.min}
        max={CURVE.max}
        onChange={(v) => patch({ curve: v || undefined })}
      />
      <div className="-mt-2 flex flex-wrap gap-1" role="group" aria-label="Curve presets">
        {CURVE_PRESETS.map(([v, l]) => (
          <button key={l} type="button" onClick={() => patch({ curve: v || undefined })} className={`rounded border px-2 py-0.5 text-[11px] ${(box.curve ?? 0) === v ? "border-[#ffd700] text-[#ffd700]" : "border-white/15 text-white/70 hover:border-white/40"}`}>
            {l}
          </button>
        ))}
      </div>
      {box.curve ? <p className="-mt-2 text-[11px] text-white/50">Curved text sits on one line along the curve — if letters go missing at the ends, drag the box wider. Double-click types it flat; it curves again when you finish.</p> : null}
      <Segmented<DesignShadow> label="Shadow" value={box.shadow} options={SHADOW_OPTIONS} onChange={(shadow) => patch({ shadow })} />
      <NumberSlider
        label="Letter outline"
        value={stroke}
        min={0}
        max={STROKE_MAX}
        step={0.5}
        unit="px"
        onChange={(w) => patch(w > 0 ? { strokeWidth: w, strokeColor: box.strokeColor ?? "#000000", outline: false } : { strokeWidth: undefined, strokeColor: undefined })}
      />
      {stroke > 0 ? (
        <ColorField label="Outline color" value={box.strokeColor ?? "#000000"} onChange={(strokeColor) => patch({ strokeColor })} />
      ) : null}
      <Toggle
        label={gradientBlocked ? "Gradient letters (turn off the box behind text first)" : "Gradient letters"}
        checked={!!g}
        onChange={(on) => patch({ gradient: on ? { from: box.color, to: "#7ed957", angle: 90 } : undefined })}
      />
      {g ? (
        <div className="space-y-2 rounded-md border border-white/10 p-2">
          <div className="h-5 rounded" style={{ backgroundImage: `linear-gradient(90deg, ${g.from}, ${g.to})` }} aria-hidden />
          <ColorField label="Gradient start" value={g.from} onChange={(from) => patch({ gradient: { ...g, from } })} />
          <ColorField label="Gradient end" value={g.to} onChange={(to) => patch({ gradient: { ...g, to } })} />
          <NumberSlider label="Direction" value={g.angle} min={0} max={360} step={15} unit="°" onChange={(angle) => patch({ gradient: { ...g, angle } })} />
          <p className="text-[0.68rem] text-white/50">The solid text colour is kept as a backup for very old browsers. Check contrast at both ends of the gradient.</p>
        </div>
      ) : null}
    </>
  );
}
