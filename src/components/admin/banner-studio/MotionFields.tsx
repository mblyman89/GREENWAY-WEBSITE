"use client";

/**
 * R57-S2 — Motion controls (micro-interactions) for shapes/icons, text boxes
 * and the banner border beam. Everything is pure CSS on the site; each value
 * is written only when switched on. Visitors who ask their device for less
 * motion see everything still (WCAG 2.3.3).
 */
import type { DesignTextBox } from "@/lib/cms/banner-design-core";
import { SHAPE_KINDS, type DesignElement } from "@/lib/cms/banner-elements-core";
import {
  BEAM_WIDTH,
  BLOB_SHAPES,
  MORPH_SHAPES,
  ORBIT_SIZE,
  type Beam,
  type ElementHover,
  type ElementMotion,
  type MorphShape,
  type MotionSpeed,
  type TextHover,
  type TextMotion,
} from "@/lib/cms/banner-motion-core";
import { studioReplay } from "./EnterFields";
import { ColorField, NumberSlider, Segmented, SelectField, Toggle } from "./controls";

type Opt<T extends string> = T | "none";
type Speed = MotionSpeed | "normal";
const SPEEDS: { value: Speed; label: string }[] = [
  { value: "slow", label: "Slow" },
  { value: "normal", label: "Normal" },
  { value: "fast", label: "Fast" },
];
const speedPatch = (v: Speed) => ({ motionSpeed: v === "normal" ? undefined : v });
const box = "space-y-2 rounded-md border border-white/10 p-2";
const title = "text-[0.7rem] font-semibold uppercase tracking-wide text-white/60";
const hint = "text-[0.65rem] text-white/45";
const shapeLabel = (s: string) => SHAPE_KINDS.find((k) => k.id === s)?.label ?? s;

export function ElementMotionFields({ el, patch }: { el: DesignElement; patch: (p: Partial<DesignElement>) => void }) {
  const isIcon = el.kind === "icon";
  const canMorph = !isIcon && (MORPH_SHAPES as readonly string[]).includes(el.shape);
  const opts: { value: Opt<ElementMotion>; label: string }[] = [
    { value: "none", label: "None" },
    { value: "breathe", label: "Breathe (gentle grow)" },
    { value: "glow", label: "Glow softly" },
    { value: "float", label: "Float up and down" },
    { value: "spin", label: "Slow spin" },
    { value: "wiggle", label: "Wiggle now and then" },
    ...(!isIcon && BLOB_SHAPES.includes(el.shape) ? [{ value: "blob" as const, label: "Blob (organic morph)" }] : []),
    ...(canMorph ? [{ value: "morph" as const, label: "Morph into another shape" }] : []),
  ];
  const hovers: { value: Opt<ElementHover>; label: string }[] = [
    { value: "none", label: "None" },
    { value: "grow", label: "Grow" },
    { value: "lift", label: "Lift up" },
    { value: "spin", label: "Turn a little" },
    { value: "glow", label: "Glow" },
  ];
  const morphTargets = MORPH_SHAPES.filter((s) => s !== el.shape).map((s) => ({ value: s, label: shapeLabel(s) }));
  return (
    <div className={box}>
      <p className={title}>Motion</p>
      <SelectField<Opt<ElementMotion>>
        label="Moves on its own"
        value={el.motion ?? "none"}
        options={opts}
        onChange={(v) =>
          patch(
            v === "none"
              ? { motion: undefined, morphTo: undefined, ...(el.orbit ? {} : { motionSpeed: undefined }) }
              : v === "morph"
                ? { motion: v, morphTo: el.morphTo ?? (el.shape === "star" ? "burst" : "circle") }
                : { motion: v, morphTo: undefined },
          )
        }
      />
      {el.motion === "morph" ? (
        <SelectField<MorphShape> label="Morphs into" value={el.morphTo ?? "circle"} options={morphTargets} onChange={(morphTo) => patch({ morphTo })} />
      ) : null}
      {el.motion === "morph" && el.strokeWidth > 0 ? <p className={hint}>Borders aren&apos;t drawn while a shape morphs.</p> : null}
      {!isIcon && el.shape !== "line" ? (
        <Toggle label="Spark travels around the border" checked={!!el.orbit} onChange={(on) => patch(on ? { orbit: { color: "#ffd700", size: 10 } } : { orbit: undefined, ...(el.motion ? {} : { motionSpeed: undefined }) })} />
      ) : null}
      {el.orbit ? (
        <div className="grid grid-cols-2 gap-2">
          <ColorField label="Spark colour" value={el.orbit.color} onChange={(color) => patch({ orbit: { ...el.orbit!, color } })} />
          <NumberSlider label="Spark size" value={el.orbit.size} min={ORBIT_SIZE.min} max={ORBIT_SIZE.max} unit="px" onChange={(size) => patch({ orbit: { ...el.orbit!, size } })} />
        </div>
      ) : null}
      {el.motion || el.orbit ? <Segmented<Speed> label="Speed" value={el.motionSpeed ?? "normal"} options={SPEEDS} onChange={(v) => patch(speedPatch(v))} /> : null}
      <SelectField<Opt<ElementHover>> label="When the mouse is over the banner" value={el.hover ?? "none"} options={hovers} onChange={(v) => { patch({ hover: v === "none" ? undefined : v }); studioReplay(); }} />
      <p className={hint}>Hover effects show on the live site (computer mouse); the Studio keeps things still so you can drag them.</p>
    </div>
  );
}

export function TextMotionFields({ box: b, patch }: { box: DesignTextBox; patch: (p: Partial<DesignTextBox>) => void }) {
  const opts: { value: Opt<TextMotion>; label: string }[] = [
    { value: "none", label: "None" },
    { value: "breathe", label: "Breathe (gentle grow)" },
    { value: "glow", label: "Glow softly" },
    { value: "float", label: "Float up and down" },
    { value: "wiggle", label: "Wiggle now and then" },
    { value: "flicker", label: "Neon flicker" },
  ];
  const hovers: { value: Opt<TextHover>; label: string }[] = [
    { value: "none", label: "None" },
    { value: "grow", label: "Grow" },
    { value: "lift", label: "Lift up" },
    { value: "glow", label: "Glow" },
  ];
  return (
    <div className={box}>
      <p className={title}>Motion</p>
      <SelectField<Opt<TextMotion>> label="Moves on its own" value={b.motion ?? "none"} options={opts} onChange={(v) => patch(v === "none" ? { motion: undefined, motionSpeed: undefined } : { motion: v })} />
      {b.motion ? <Segmented<Speed> label="Speed" value={b.motionSpeed ?? "normal"} options={SPEEDS} onChange={(v) => patch(speedPatch(v))} /> : null}
      <SelectField<Opt<TextHover>> label="When the mouse is over the banner" value={b.hover ?? "none"} options={hovers} onChange={(v) => { patch({ hover: v === "none" ? undefined : v }); studioReplay(); }} />
      {b.motion === "flicker" ? <p className={hint}>Flicker is gentle (never more than 3 flashes a second).</p> : null}
    </div>
  );
}

export function BeamFields({ beam, onChange }: { beam: Beam | undefined; onChange: (b: Beam | undefined) => void }) {
  return (
    <div className="space-y-3 rounded-md border border-white/10 p-2">
      <p className={title}>Border light</p>
      <Toggle label="A light travels around the banner's edge" checked={!!beam} onChange={(on) => onChange(on ? { color: "#7ed957", color2: "#ffd700", width: 160 } : undefined)} />
      {beam ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <ColorField label="Light colour" value={beam.color} onChange={(color) => onChange({ ...beam, color })} />
            <ColorField label="Tail colour" value={beam.color2} onChange={(color2) => onChange({ ...beam, color2 })} />
          </div>
          <NumberSlider label="Light length" value={beam.width} min={BEAM_WIDTH.min} max={BEAM_WIDTH.max} step={10} unit="px" onChange={(width) => onChange({ ...beam, width })} />
          <Segmented<Speed> label="Speed" value={beam.speed ?? "normal"} options={SPEEDS} onChange={(v) => onChange({ ...beam, speed: v === "normal" ? undefined : v })} />
        </>
      ) : null}
    </div>
  );
}
