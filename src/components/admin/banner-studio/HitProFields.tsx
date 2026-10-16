"use client";

/**
 * R60-S1 — pro controls for the big clouds (bong hit / exhale): a "look"
 * picker (8 styles, each a bundle of settings) + every setting as its own
 * slider: how long it pours, how many puffs, blow power, cone width, source
 * size, swirl, rise/sink, how long it hangs. Sliders show the style's value
 * until you move them; "Reset to style" clears your overrides.
 */
import { HIT_EMIT, HIT_PUFFS, HIT_STYLES, HIT_TUNE_KEYS, hitTimeline, hitTuning, type HitStyle, type SmokeLayer } from "@/lib/cms/banner-atmos-core";
import { NumberSlider } from "./controls";

const hint = "text-[0.7rem] text-white/50";

export function HitProFields({ layer, onPatch }: { layer: SmokeLayer; onPatch: (p: Partial<SmokeLayer>) => void }) {
  const t = hitTuning(layer);
  const tl = hitTimeline(layer);
  const custom = HIT_TUNE_KEYS.some((k) => layer[k] !== undefined);
  const style = layer.style ?? "billow";
  const reset: Partial<SmokeLayer> = Object.fromEntries(HIT_TUNE_KEYS.map((k) => [k, undefined]));
  return (
    <div className="space-y-3 rounded-md border border-[var(--admin-accent)]/30 bg-white/[0.03] p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-white/80">Cloud look (pro)</p>
        {custom ? (
          <button type="button" className="text-xs text-white/60 underline" onClick={() => onPatch(reset)}>
            Reset to style
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {HIT_STYLES.map((s) => (
          <button
            key={s.id}
            type="button"
            title={s.hint}
            aria-pressed={style === s.id}
            onClick={() => onPatch({ ...reset, style: s.id === "billow" ? undefined : (s.id as HitStyle) })}
            className={`rounded-md px-2 py-1.5 text-left text-[0.72rem] ${style === s.id ? "bg-[var(--admin-accent)] font-bold text-black" : "bg-white/5 text-white/80 hover:bg-white/15"}`}
          >
            {s.label}
            <span className={`block text-[0.65rem] ${style === s.id ? "text-black/70" : "text-white/45"}`}>{s.hint}</span>
          </button>
        ))}
      </div>
      <NumberSlider
        label="How long smoke pours out"
        value={t.emit}
        min={HIT_EMIT.min}
        max={HIT_EMIT.max}
        step={0.1}
        unit="s"
        onChange={(emit) => onPatch({ emit })}
        hint={`Then it hangs ~${tl.hang}s and clears — about ${tl.total}s in all.`}
      />
      <NumberSlider label="Puffs" value={t.puffs} min={HIT_PUFFS.min} max={HIT_PUFFS.max} onChange={(puffs) => onPatch({ puffs })} hint="1 = one steady stream · 2–6 = separate bursts" />
      <NumberSlider label="Blow power" value={t.power} min={0} max={100} unit="%" onChange={(power) => onPatch({ power })} hint="How hard it's blown — how far and fast it shoots out" />
      <NumberSlider label="Spread (cone width)" value={t.spread} min={0} max={100} unit="%" onChange={(spread) => onPatch({ spread })} />
      <NumberSlider label="Source size" value={t.source} min={0} max={100} unit="%" onChange={(source) => onPatch({ source })} hint="Small = a mouth · big = a bong or a smoke machine" />
      <NumberSlider label="Swirl / turbulence" value={t.swirl} min={0} max={100} unit="%" onChange={(swirl) => onPatch({ swirl })} />
      <NumberSlider label="Rise or sink" value={t.rise} min={-100} max={100} onChange={(rise) => onPatch({ rise })} hint="+ floats up like warm smoke · − sinks like dry ice" />
      <NumberSlider label="How long it hangs in the air" value={t.linger} min={0} max={100} unit="%" onChange={(linger) => onPatch({ linger })} />
      <p className={hint}>Press ▶ Play again to watch your changes.</p>
    </div>
  );
}
