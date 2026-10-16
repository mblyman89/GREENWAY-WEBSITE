"use client";

/**
 * R60-S2 — the engine-specific settings of a selected Lottie / Rive layer.
 * Every dropdown is filled from what the loaded file actually contains
 * (AnimInfo from the player): dotLottie animations, themes, state machines,
 * markers and slots; Rive artboards, state machines + their inputs, data
 * binding (view model) properties. Nothing is guessed — when the file has no
 * such thing, the control isn't shown.
 */
import { useState } from "react";
import { ANIM_SPEED, LOTTIE_MODES, type AnimSpec, type LottieMode } from "@/lib/cms/banner-anim-core";
import type { AnimInfo } from "@/components/site/anim/AnimPlayer";
import { ColorField, NumberSlider, SelectField, Toggle, studioInput } from "./controls";

const box = "space-y-2 rounded-md border border-white/10 p-2";
const title = "text-[0.7rem] font-semibold uppercase tracking-wide text-white/60";
const hint = "text-[0.65rem] text-white/45";
const opts = (xs: string[], none: string) => [{ value: "", label: none }, ...xs.map((x) => ({ value: x, label: x }))];

function without<T>(m: Record<string, T> | undefined, k: string): Record<string, T> | undefined {
  if (!m) return undefined;
  const { [k]: _gone, ...rest } = m;
  void _gone;
  return Object.keys(rest).length ? rest : undefined;
}

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block text-xs text-white/70">
      {label}
      <input className={studioInput} value={value} placeholder={placeholder} maxLength={200} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void }) {
  return (
    <label className="block text-xs text-white/70">
      {label}
      <input
        type="number"
        className={studioInput}
        value={value ?? ""}
        onChange={(e) => {
          const n = e.target.value === "" ? undefined : Number(e.target.value);
          onChange(n === undefined || Number.isFinite(n) ? n : undefined);
        }}
      />
    </label>
  );
}

// ── Lottie ───────────────────────────────────────────────────────────────────
export function LottieFields({ a, info, set }: { a: AnimSpec; info: AnimInfo | null; set: (p: Partial<AnimSpec>) => void }) {
  const l = info?.lottie;
  const last = Math.max(1, (info?.frames ?? 1) - 1);
  const [from, to] = a.seg ?? [0, last];
  return (
    <>
      <div className={box}>
        <p className={title}>Timeline</p>
        {l && l.animations.length > 1 ? <SelectField label="Animation in this file" value={a.anim ?? ""} options={opts(l.animations, "First one")} onChange={(v) => set({ anim: v || undefined })} /> : null}
        <SelectField label="Direction" value={a.mode ?? "forward"} options={LOTTIE_MODES.map((m) => ({ value: m.id, label: m.label }))} onChange={(v) => set({ mode: v as LottieMode })} />
        <NumberSlider label="Speed" value={a.speed ?? 1} min={ANIM_SPEED.min} max={ANIM_SPEED.max} step={0.05} unit="×" onChange={(speed) => set({ speed })} hint="1× = as designed" />
        <Toggle label="Play once (don't loop)" checked={!!a.once} onChange={(v) => set({ once: v || undefined })} />
        {l?.markers.length ? (
          <SelectField label="Play only this part (marker)" value={a.marker ?? ""} options={opts(l.markers, "Whole animation")} onChange={(v) => set({ marker: v || undefined })} />
        ) : null}
        {!a.marker && info?.frames ? (
          <div className="grid grid-cols-2 gap-2">
            <NumberSlider label="From frame" value={from} min={0} max={last} step={1} onChange={(f) => set({ seg: f === 0 && to === last ? undefined : [f, Math.max(f + 1, to)] })} />
            <NumberSlider label="To frame" value={to} min={1} max={last} step={1} onChange={(t) => set({ seg: from === 0 && t === last ? undefined : [Math.min(from, t - 1), t] })} />
          </div>
        ) : null}
        {info?.frames ? <p className={hint}>{info.frames} frames in this animation.</p> : null}
      </div>
      {l && (l.themes.length || l.machines.length) ? (
        <div className={box}>
          <p className={title}>Built into this file</p>
          {l.themes.length ? <SelectField label="Theme (colour set)" value={a.theme ?? ""} options={opts(l.themes, "As designed")} onChange={(v) => set({ theme: v || undefined })} /> : null}
          {l.machines.length ? (
            <>
              <SelectField label="Interactive state machine" value={a.sm ?? ""} options={opts(l.machines, "None (use the settings above)")} onChange={(v) => set({ sm: v || undefined })} />
              <p className={hint}>A state machine runs the file&apos;s own hover / click logic; the timeline settings above are then ignored.</p>
            </>
          ) : null}
        </div>
      ) : null}
      {l?.slots.length ? (
        <div className={box}>
          <p className={title}>Customise (slots)</p>
          {l.slots.map((s) =>
            s.type === "color" ? (
              <ColorField key={s.id} label={s.id} value={a.colors?.[s.id] ?? (typeof s.value === "string" ? s.value : "#ffffff")} onChange={(hex) => set({ colors: { ...a.colors, [s.id]: hex } })} />
            ) : s.type === "text" ? (
              <TextField key={s.id} label={s.id} value={a.texts?.[s.id] ?? ""} placeholder="As designed" onChange={(t) => set({ texts: t ? { ...a.texts, [s.id]: t } : without(a.texts, s.id) })} />
            ) : s.type === "scalar" ? (
              <NumberField key={s.id} label={s.id} value={a.nums?.[s.id] ?? (typeof s.value === "number" ? s.value : undefined)} onChange={(n) => set({ nums: n === undefined ? without(a.nums, s.id) : { ...a.nums, [s.id]: n } })} />
            ) : null,
          )}
          {a.colors || a.texts || a.nums ? (
            <button type="button" className="text-xs text-white/60 underline" onClick={() => set({ colors: undefined, texts: undefined, nums: undefined })}>
              Reset all slots to the designer&apos;s values
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

// ── Rive ─────────────────────────────────────────────────────────────────────
export function RiveFields({ a, info, set }: { a: AnimSpec; info: AnimInfo | null; set: (p: Partial<AnimSpec>) => void }) {
  const r = info?.rive;
  const boards = r?.artboards ?? [];
  const board = boards.find((b) => b.name === a.artboard) ?? boards[0];
  const machine = board?.machines.find((m) => m.name === a.machine) ?? (a.machine ? undefined : board?.machines[0]);
  const inputs = machine?.inputs ?? [];
  const vm = r?.vm ?? [];
  const bools = [...inputs.filter((i) => i.type === "boolean").map((i) => i.name), ...vm.filter((p) => p.type === "boolean").map((p) => p.name)];
  const triggers = [...inputs.filter((i) => i.type === "trigger").map((i) => i.name), ...vm.filter((p) => p.type === "trigger").map((p) => p.name)];
  const [runName, setRunName] = useState("");
  return (
    <>
      <div className={box}>
        <p className={title}>Rive file</p>
        {boards.length > 1 ? <SelectField label="Artboard" value={a.artboard ?? ""} options={opts(boards.map((b) => b.name), "Default artboard")} onChange={(v) => set({ artboard: v || undefined, machine: undefined, inputs: undefined })} /> : null}
        {board?.machines.length ? (
          <SelectField label="State machine" value={a.machine ?? ""} options={opts(board.machines.map((m) => m.name), board.animations.length ? "None — play the first animation" : "Default")} onChange={(v) => set({ machine: v || undefined, inputs: undefined })} />
        ) : null}
        {board && !board.machines.length ? <p className={hint}>This artboard has no state machine, so it plays its first animation on a loop.</p> : null}
        <Toggle label="Let the file react to the pointer itself (Rive listeners)" checked={!!a.interactive} onChange={(v) => set({ interactive: v || undefined })} />
        {a.start === "hover" && bools.length ? <SelectField label="While hovered, switch on" value={a.hoverInput ?? ""} options={opts(bools, "Just play / pause")} onChange={(v) => set({ hoverInput: v || undefined })} /> : null}
        {a.start === "click" && triggers.length ? <SelectField label="On click / tap, fire" value={a.clickFire ?? ""} options={opts(triggers, "Restart from the beginning")} onChange={(v) => set({ clickFire: v || undefined })} /> : null}
      </div>
      {inputs.some((i) => i.type !== "trigger") ? (
        <div className={box}>
          <p className={title}>Starting values (state machine inputs)</p>
          {inputs.map((i) =>
            i.type === "boolean" ? (
              <Toggle key={i.name} label={i.name} checked={a.inputs?.[i.name] === true} onChange={(v) => set({ inputs: { ...a.inputs, [i.name]: v } })} />
            ) : i.type === "number" ? (
              <NumberField key={i.name} label={i.name} value={typeof a.inputs?.[i.name] === "number" ? (a.inputs[i.name] as number) : undefined} onChange={(n) => set({ inputs: n === undefined ? without(a.inputs, i.name) : { ...a.inputs, [i.name]: n } })} />
            ) : null,
          )}
        </div>
      ) : null}
      {vm.some((p) => ["boolean", "number", "integer", "string", "color", "enumType"].includes(p.type)) ? (
        <div className={box}>
          <p className={title}>Data binding (view model)</p>
          {vm.map((p) => {
            const v = a.vm?.[p.name];
            const put = (nv: string | number | boolean | undefined) => set({ vm: nv === undefined || nv === "" ? without(a.vm, p.name) : { ...a.vm, [p.name]: nv } });
            if (p.type === "boolean") return <Toggle key={p.name} label={p.name} checked={v === true} onChange={put} />;
            if (p.type === "number" || p.type === "integer") return <NumberField key={p.name} label={p.name} value={typeof v === "number" ? v : undefined} onChange={put} />;
            if (p.type === "color") return <ColorField key={p.name} label={p.name} value={typeof v === "string" ? v : "#ffffff"} onChange={put} />;
            if (p.type === "string" || p.type === "enumType") return <TextField key={p.name} label={`${p.name}${p.type === "enumType" ? " (option name)" : ""}`} value={typeof v === "string" ? v : ""} placeholder="As designed" onChange={put} />;
            return null;
          })}
        </div>
      ) : null}
      <div className={box}>
        <p className={title}>Text runs</p>
        <p className={hint}>Change words inside the Rive file. Type the run&apos;s exact name (set in the Rive editor), then the new words.</p>
        {Object.entries(a.runs ?? {}).map(([n, t]) => (
          <div key={n} className="flex items-end gap-2">
            <div className="flex-1">
              <TextField label={n} value={t} onChange={(nt) => set({ runs: { ...a.runs, [n]: nt } })} />
            </div>
            <button type="button" className="pb-1 text-xs text-red-300 underline" onClick={() => set({ runs: without(a.runs, n) })}>
              Remove
            </button>
          </div>
        ))}
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <TextField label="Run name" value={runName} onChange={setRunName} placeholder="e.g. headline" />
          </div>
          <button
            type="button"
            disabled={!runName.trim()}
            className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/80 disabled:opacity-40"
            onClick={() => {
              set({ runs: { ...a.runs, [runName.trim()]: "" } });
              setRunName("");
            }}
          >
            Add
          </button>
        </div>
      </div>
    </>
  );
}
