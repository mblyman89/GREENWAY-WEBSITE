"use client";

/**
 * R56-S4 — button upgrades: icon (left / right / icon-only), gradient fill,
 * shadow, corner rounding, hover effect and an optional attention animation.
 * Any colours. Each value is written only when switched on.
 */
import { useState } from "react";
import { BANNER_ICON_CATS, BANNER_ICON_DATA, BANNER_ICON_LIST } from "@/lib/cms/banner-icons-data";
import { LibraryPicker } from "./LibraryPicker";
import { BUTTON_CORNER_MAX, BUTTON_SHADOW_MAX, type ButtonAttention, type ButtonClick, type ButtonHover, type ButtonIconPos } from "@/lib/cms/button-fx-core";
import type { DesignButton } from "@/lib/cms/banner-design-core";
import { ColorField, NumberSlider, Segmented, SelectField, Toggle } from "./controls";

type Opt<T extends string> = T | "none";
const HOVER: { value: Opt<ButtonHover>; label: string }[] = [
  { value: "none", label: "None" },
  { value: "lift", label: "Lift up" },
  { value: "grow", label: "Grow" },
  { value: "glow", label: "Glow" },
  { value: "darken", label: "Darken" },
];
const ATTN: { value: Opt<ButtonAttention>; label: string }[] = [
  { value: "none", label: "None" },
  { value: "pulse", label: "Gentle pulse" },
  { value: "wiggle", label: "Wiggle now and then" },
  { value: "shine", label: "Shine sweep" },
  { value: "breathe", label: "Breathing glow" },
];
const CLICK: { value: Opt<ButtonClick>; label: string }[] = [
  { value: "none", label: "None" },
  { value: "press", label: "Press in" },
  { value: "pop", label: "Bounce out" },
];

export function ButtonFxFields({ btn, patch }: { btn: DesignButton; patch: (p: Partial<DesignButton>) => void }) {
  const [open, setOpen] = useState(false);
  const g = btn.gradient;
  function setIcon(id: string) {
    const path = BANNER_ICON_DATA[id]?.bold?.[0];
    if (path) patch({ icon: id, iconPath: path, iconPos: btn.iconPos ?? "right" });
    setOpen(false);
  }
  return (
    <div className="space-y-2 rounded-md border border-white/10 p-2">
      <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-white/60">Extras</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/85 hover:bg-white/20" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {btn.iconPath ? "Change icon" : "Add an icon"}
        </button>
        {btn.iconPath ? (
          <button type="button" className="text-xs text-white/60 underline" onClick={() => patch({ icon: undefined, iconPath: undefined, iconPos: undefined })}>
            Remove icon
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="rounded-md bg-black/30 p-1.5">
          <LibraryPicker
            items={BANNER_ICON_LIST}
            cats={BANNER_ICON_CATS}
            noun="icons"
            placeholder="Search icons (cart, arrow, gift…)"
            cols="grid-cols-8 sm:grid-cols-10"
            maxH="max-h-44"
            thumb={(i) => (
              <svg viewBox="0 0 256 256" className={`h-full w-full ${btn.icon === i.id ? "text-[var(--admin-accent)]" : ""}`} aria-hidden="true" focusable="false">
                <path d={BANNER_ICON_DATA[i.id].bold[0]} fill="currentColor" />
              </svg>
            )}
            onPick={(i) => setIcon(i.id)}
          />
        </div>
      ) : null}
      {btn.iconPath ? (
        <Segmented<ButtonIconPos>
          label="Icon position"
          value={btn.iconPos ?? "left"}
          options={[
            { value: "left", label: "Before text" },
            { value: "right", label: "After text" },
            { value: "only", label: "Icon only" },
          ]}
          onChange={(iconPos) => patch({ iconPos })}
        />
      ) : null}
      {btn.iconPos === "only" && btn.iconPath ? <p className="text-[0.65rem] text-white/45">The button text is still read out to screen readers.</p> : null}

      {btn.style === "solid" ? (
        <Toggle label="Gradient fill" checked={!!g} onChange={(on) => patch({ gradient: on ? { from: btn.bg, to: "#ff7f00", angle: 90 } : undefined })} />
      ) : null}
      {g && btn.style === "solid" ? (
        <>
          <div className="h-4 rounded" style={{ backgroundImage: `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})` }} aria-hidden />
          <ColorField label="Gradient start" value={g.from} onChange={(from) => patch({ gradient: { ...g, from } })} />
          <ColorField label="Gradient end" value={g.to} onChange={(to) => patch({ gradient: { ...g, to } })} />
          <NumberSlider label="Direction" value={g.angle} min={0} max={360} step={15} unit="°" onChange={(angle) => patch({ gradient: { ...g, angle } })} />
        </>
      ) : null}
      <NumberSlider
        label="Shadow"
        value={btn.shadow ?? 0}
        min={0}
        max={BUTTON_SHADOW_MAX}
        unit="px"
        onChange={(v) => patch(v > 0 ? { shadow: v, shadowColor: btn.shadowColor ?? "#000000" } : { shadow: undefined, shadowColor: undefined })}
      />
      {btn.shadow ? <ColorField label="Shadow colour" value={btn.shadowColor ?? "#000000"} onChange={(shadowColor) => patch({ shadowColor })} /> : null}
      <Toggle label="Custom corner rounding" checked={btn.corner !== undefined} onChange={(on) => patch({ corner: on ? 8 : undefined })} />
      {btn.corner !== undefined ? <NumberSlider label="Corners" value={btn.corner} min={0} max={BUTTON_CORNER_MAX} unit="px" onChange={(corner) => patch({ corner })} /> : null}
      <SelectField<Opt<ButtonHover>> label="When the mouse is over it" value={btn.hover ?? "none"} options={HOVER} onChange={(v) => patch({ hover: v === "none" ? undefined : v })} />
      <SelectField<Opt<ButtonAttention>> label="Draw attention" value={btn.attention ?? "none"} options={ATTN} onChange={(v) => patch({ attention: v === "none" ? undefined : v })} />
      <SelectField<Opt<ButtonClick>> label="When clicked or tapped" value={btn.click ?? "none"} options={CLICK} onChange={(v) => patch({ click: v === "none" ? undefined : v })} />
      {btn.attention ? <p className="text-[0.65rem] text-white/45">Turned off automatically for visitors who ask their device for less motion. Use on one button at most.</p> : null}
    </div>
  );
}
