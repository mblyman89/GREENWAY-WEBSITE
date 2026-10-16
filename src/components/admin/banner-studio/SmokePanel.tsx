"use client";

/**
 * R58-S1 — "💨 Smoke & fog" tab: one-click presets (joint/blunt, pipe/bowl,
 * bong hit blown across, psychedelic cloud, spooky fog, haze) + full control of
 * each layer. Click the mini-map to place where the smoke comes from (the tip
 * of the joint, the bowl, the mouth for an exhale). "▶ Play again" replays
 * one-time effects and the words reveal.
 */
import { useSyncExternalStore } from "react";
import {
  MAX_SMOKE_LAYERS,
  REVEAL,
  SMOKE_AMOUNT,
  SMOKE_DELAY_MAX,
  SMOKE_KINDS,
  SMOKE_PRESETS,
  SMOKE_SIZE,
  presetLayer,
  type SmokeKind,
  type SmokeLayer,
} from "@/lib/cms/banner-atmos-core";
import type { BannerDesign, DesignDevice } from "@/lib/cms/banner-design-core";
import { ColorField, NumberSlider, Segmented, SelectField, Toggle } from "./controls";

type Speed = "slow" | "normal" | "fast";
const SPEEDS: { value: Speed; label: string }[] = [
  { value: "slow", label: "Slow" },
  { value: "normal", label: "Normal" },
  { value: "fast", label: "Fast" },
];
const box = "space-y-3 rounded-md border border-white/10 p-2";
const hint = "text-[0.7rem] text-white/50";
const noop = () => () => {};
const hasGpu = () => typeof navigator !== "undefined" && "gpu" in navigator;

export function SmokePanel({
  design,
  device,
  onChange,
  onReplay,
  imageSrc,
}: {
  design: BannerDesign;
  device: DesignDevice;
  imageSrc?: string;
  onChange: (d: BannerDesign) => void;
  onReplay: () => void;
}) {
  const layers = design.smoke ?? [];
  const mobile = device === "mobile";
  const gpu = useSyncExternalStore(noop, hasGpu, () => false);
  const set = (next: SmokeLayer[]) => onChange({ ...design, smoke: next.length ? next : undefined });
  const patch = (id: string, p: Partial<SmokeLayer>) => set(layers.map((l) => (l.id === id ? { ...l, ...p } : l)));
  const newId = () => {
    const used = new Set(layers.map((l) => l.id));
    let i = layers.length + 1;
    while (used.has(`smoke-${i}`)) i += 1;
    return `smoke-${i}`;
  };
  const full = layers.length >= MAX_SMOKE_LAYERS;

  function addPreset(i: number) {
    if (full) return;
    const p = SMOKE_PRESETS[i];
    const next = { ...design, smoke: [...layers, presetLayer(p, newId())] };
    if (p.reveal && !design.reveal) next.reveal = p.reveal;
    onChange(next);
    window.setTimeout(onReplay, 50);
  }

  return (
    <div className="space-y-3">
      <div className={box}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-white/80">Add smoke, fog or haze</p>
          <button type="button" onClick={onReplay} className="rounded-full bg-[var(--admin-accent)] px-3 py-1 text-xs font-bold text-black">
            ▶ Play again
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {SMOKE_PRESETS.map((p, i) => (
            <button
              key={p.id}
              type="button"
              disabled={full}
              onClick={() => addPreset(i)}
              className="rounded-md bg-white/5 px-2 py-2 text-left text-xs text-white/85 hover:bg-white/15 disabled:opacity-40"
            >
              <span className="mr-1">{p.emoji}</span>
              {p.label}
            </button>
          ))}
        </div>
        <p className={hint}>
          Up to {MAX_SMOKE_LAYERS} layers. Fog, haze and wisps work everywhere (phones too). The bong hit uses a real smoke simulation in browsers
          with WebGPU {gpu ? "(✓ this browser has it)" : "(this browser doesn't — you see the lighter version shoppers without it get)"}. Smoke
          stops when the banner is off screen, and visitors who ask for less motion see still fog or none.
        </p>
      </div>

      <div className={box}>
        <NumberSlider
          label="Words + buttons fade in after"
          value={design.reveal ?? 0}
          min={0}
          max={REVEAL.max}
          step={0.1}
          unit="s"
          onChange={(v) => onChange({ ...design, reveal: v === 0 ? undefined : Math.max(REVEAL.min, v) })}
          hint="0 = shown straight away. Great with a bong hit: the cloud blows across, then the words appear. Replays each time the slide comes round."
        />
      </div>

      {layers.map((l, i) => (
        <div key={l.id} className={box}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-white/80">
              Layer {i + 1} · {SMOKE_KINDS.find((k) => k.id === l.kind)?.label}
            </p>
            <button type="button" className="text-xs text-red-300 underline" onClick={() => set(layers.filter((x) => x.id !== l.id))}>
              Remove
            </button>
          </div>
          <SelectField<SmokeKind>
            label="Type"
            value={l.kind}
            options={SMOKE_KINDS.map((k) => ({ value: k.id, label: `${k.label} — ${k.hint}` }))}
            onChange={(kind) => patch(l.id, { kind, once: kind === "hit" || kind === "wisp" ? l.once : undefined, interactive: kind === "hit" ? l.interactive : undefined })}
          />
          {l.kind === "wisp" || l.kind === "hit" ? (
            <SpotPicker layer={l} mobile={mobile} imageSrc={imageSrc} onPick={(x, y) => patch(l.id, mobile ? { mx: x, my: y } : { x, y })} />
          ) : null}
          {l.kind !== "fog" ? (
            <NumberSlider
              label={l.kind === "haze" ? "Drift direction" : "Direction"}
              value={l.dir}
              min={-180}
              max={180}
              step={5}
              unit="°"
              onChange={(dir) => patch(l.id, { dir })}
              hint="0° = straight up · 90° = to the right · -90° = to the left"
            />
          ) : null}
          <Toggle label="Psychedelic rainbow colours" checked={!!l.rainbow} onChange={(on) => patch(l.id, { rainbow: on ? true : undefined })} />
          {!l.rainbow ? (
            <div className="grid grid-cols-2 gap-2">
              <ColorField label="Fresh smoke colour" value={l.color} onChange={(color) => patch(l.id, { color })} />
              <ColorField label="Fades to" value={l.color2} onChange={(color2) => patch(l.id, { color2 })} />
            </div>
          ) : null}
          <NumberSlider label="Thickness" value={l.amount} min={SMOKE_AMOUNT.min} max={SMOKE_AMOUNT.max} unit="%" onChange={(amount) => patch(l.id, { amount })} />
          <NumberSlider
            label={l.kind === "fog" ? "Fog height" : l.kind === "wisp" ? "How high it rises" : l.kind === "hit" ? "Size of the cloud" : "Size of the swirls"}
            value={l.size}
            min={SMOKE_SIZE.min}
            max={SMOKE_SIZE.max}
            unit="%"
            onChange={(size) => patch(l.id, { size })}
          />
          <Segmented<Speed> label="Speed" value={l.speed ?? "normal"} options={SPEEDS} onChange={(v) => patch(l.id, { speed: v === "normal" ? undefined : v })} />
          {l.kind === "hit" || l.kind === "wisp" ? (
            <Toggle label="Play once each time the slide shows (instead of looping)" checked={!!l.once} onChange={(on) => patch(l.id, { once: on ? true : undefined })} />
          ) : null}
          {l.kind === "hit" ? (
            <Toggle label="Shoppers can push the smoke with the mouse" checked={!!l.interactive} onChange={(on) => patch(l.id, { interactive: on ? true : undefined })} />
          ) : null}
          <NumberSlider label="Start after" value={l.delay ?? 0} min={0} max={SMOKE_DELAY_MAX} step={0.1} unit="s" onChange={(d) => patch(l.id, { delay: d ? d : undefined })} />
          <Toggle label="In front of the words (default: behind them)" checked={!!l.front} onChange={(on) => patch(l.id, { front: on ? true : undefined })} />
          <Toggle label="Hide on phones" checked={!!l.hideOnMobile} onChange={(on) => patch(l.id, { hideOnMobile: on ? true : undefined })} />
        </div>
      ))}
    </div>
  );
}

/** Click (or arrow keys) to place where the smoke comes from. */
function SpotPicker({ layer, mobile, imageSrc, onPick }: { layer: SmokeLayer; mobile: boolean; imageSrc?: string; onPick: (x: number, y: number) => void }) {
  const x = mobile && layer.mx !== null ? layer.mx : layer.x;
  const y = mobile && layer.my !== null ? layer.my : layer.y;
  const r = (n: number) => Math.round(Math.min(100, Math.max(0, n)) * 2) / 2;
  return (
    <div className="space-y-1">
      <p className="text-xs text-white/70">
        Where it comes from {mobile ? "(phone)" : ""} — click the spot: the tip of the joint, the bowl, the mouth…
      </p>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Smoke starting point"
        aria-valuetext={`${x}% across, ${y}% down`}
        aria-valuenow={x}
        className={`relative w-full cursor-crosshair rounded-md border border-white/20 bg-white/5 bg-cover bg-center ${mobile ? "aspect-[4/5] max-w-[180px]" : "aspect-[16/5]"}`}
        style={imageSrc && !/\.(mp4|webm|mov)(\?|$)/i.test(imageSrc) ? { backgroundImage: `url("${imageSrc.replace(/"/g, "")}")` } : undefined}
        onPointerDown={(e) => {
          const b = e.currentTarget.getBoundingClientRect();
          onPick(r(((e.clientX - b.left) / b.width) * 100), r(((e.clientY - b.top) / b.height) * 100));
        }}
        onKeyDown={(e) => {
          const st = e.shiftKey ? 5 : 1;
          const d: Record<string, [number, number]> = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] };
          const m = d[e.key];
          if (!m) return;
          e.preventDefault();
          onPick(r(x + m[0]), r(y + m[1]));
        }}
      >
        <span
          className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--admin-accent)] shadow"
          style={{ left: `${x}%`, top: `${y}%` }}
        />
      </div>
      <p className={hint}>
        {x}% across · {y}% down
      </p>
    </div>
  );
}
