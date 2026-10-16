"use client";

/**
 * R41 S2 — small shared controls for the Banner Studio (bible PART 5.6).
 * Plain inputs styled with the admin tokens; no new dependencies.
 */
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { RECENT_COLORS_KEY, colorToHex, parseRecentColors, pushRecentColor } from "@/lib/cms/color-input-core";
import { BRAND_SWATCHES, normalizeHex } from "@/lib/cms/banner-design-core";

export const studioInput =
  "w-full rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-black/40 px-2 py-1.5 text-sm text-white outline-none focus:border-[var(--admin-accent)]";
export const studioLabel = "mb-1 block text-[0.68rem] font-semibold uppercase tracking-wide text-white/60";

export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <span className={studioLabel}>{label}</span>
      {children}
      {hint ? <p className="mt-1 text-[0.7rem] text-white/45">{hint}</p> : null}
    </div>
  );
}

/** Slider + number box (the number box is the precise / keyboard path). */
export function NumberSlider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "",
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
  hint?: string;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <Row label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(clamp(Number(e.target.value)))}
          className="h-2 flex-1 accent-[var(--admin-accent)]"
          aria-label={label}
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(clamp(n));
          }}
          className={`${studioInput} w-20`}
          aria-label={`${label} (number)`}
        />
        {unit ? <span className="w-6 text-xs text-white/50">{unit}</span> : null}
      </div>
    </Row>
  );
}

/** Segmented buttons (radio-like). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <Row label={label}>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              title={o.title}
              onClick={() => onChange(o.value)}
              className={
                active
                  ? "rounded-[var(--admin-radius-sm)] bg-[var(--admin-accent-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--admin-accent)] ring-1 ring-[var(--admin-accent)]/40"
                  : "rounded-[var(--admin-radius-sm)] bg-black/30 px-2.5 py-1 text-xs text-white/70 hover:bg-white/10"
              }
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </Row>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-white/80">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[var(--admin-accent)]" />
      {label}
    </label>
  );
}

/**
 * R56-S1 — any colour, anywhere. Brand swatches stay as one-tap picks, but the
 * owner can choose ANY colour: native picker, typed/pasted value in any common
 * format (#hex, rgb(), hsl(), or a CSS name like "tomato"), the eyedropper
 * (Chrome/Edge — pick a colour from anywhere on screen) and "Your colours",
 * the last 12 custom colours remembered on this device.
 */
type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };

/** Browser fallback for named colours ("tomato") — the canvas normalises any CSS colour. */
function browserColorToHex(v: string): string | null {
  if (typeof document === "undefined") return null;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#010203";
  ctx.fillStyle = v;
  const out = String(ctx.fillStyle).toLowerCase();
  return out === "#010203" && v.trim().toLowerCase() !== "#010203" ? null : colorToHex(out);
}

// "Your colours" live in localStorage; useSyncExternalStore keeps every field in sync.
const RECENT_EVENT = "gw-recent-colors";
function subscribeRecent(cb: () => void) {
  window.addEventListener(RECENT_EVENT, cb);
  window.addEventListener("storage", cb); // other tabs
  return () => {
    window.removeEventListener(RECENT_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}
const noopSubscribe = () => () => undefined;
function readRecent(): string | null {
  try {
    return window.localStorage.getItem(RECENT_COLORS_KEY);
  } catch {
    return null; // storage blocked (private mode)
  }
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  const rawRecent = useSyncExternalStore(subscribeRecent, readRecent, () => null);
  const recent = useMemo(() => parseRecentColors(rawRecent), [rawRecent]);
  const [bad, setBad] = useState(false);
  const pick = (hex: string, remember = true) => {
    setBad(false);
    onChange(hex);
    if (remember && !BRAND_SWATCHES.some((b) => b.hex === hex)) {
      const next = pushRecentColor(parseRecentColors(window.localStorage.getItem(RECENT_COLORS_KEY)), hex);
      window.localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(next));
      window.dispatchEvent(new Event(RECENT_EVENT)); // every colour field updates its "Yours" row
    }
  };
  const typed = (raw: string) => {
    if (raw.trim() === value) return;
    const hex = colorToHex(raw) ?? browserColorToHex(raw);
    if (hex) pick(hex);
    else setBad(true);
  };
  // Hydration-safe feature check (server renders "no eyedropper", client fills in).
  const hasEyeDropper = useSyncExternalStore(noopSubscribe, () => "EyeDropper" in window, () => false);
  const swatch = (hex: string, name: string) => (
    <button
      key={`${name}-${hex}`}
      type="button"
      title={`${name} ${hex}`}
      aria-label={`${label}: ${name}`}
      onClick={() => pick(hex, false)}
      className={`h-6 w-6 rounded-full border ${value === hex ? "border-[var(--admin-accent)] ring-2 ring-[var(--admin-accent)]/50" : "border-white/30"}`}
      style={{ backgroundColor: hex }}
    />
  );
  return (
    <Row label={label}>
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="color"
            value={normalizeHex(value, "#ffffff")}
            onChange={(e) => onChange(e.target.value)}
            onBlur={(e) => pick(e.target.value)}
            className="h-8 w-10 cursor-pointer rounded border border-white/20 bg-transparent"
            aria-label={`${label} picker — any colour`}
          />
          <input
            className={`${studioInput} w-36 font-mono ${bad ? "border-red-500" : ""}`}
            defaultValue={value}
            key={value}
            placeholder="#hex, rgb(), hsl(), name"
            onBlur={(e) => typed(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                typed((e.target as HTMLInputElement).value);
              }
            }}
            aria-label={`${label} colour code`}
            aria-invalid={bad}
          />
          {hasEyeDropper ? (
            <button
              type="button"
              className="rounded border border-white/20 px-2 py-1 text-xs text-white/80 hover:bg-white/10"
              title="Pick a colour from anywhere on your screen"
              onClick={() => {
                const Ctor = (window as unknown as { EyeDropper: EyeDropperCtor }).EyeDropper;
                new Ctor()
                  .open()
                  .then((r) => {
                    const hex = colorToHex(r.sRGBHex);
                    if (hex) pick(hex);
                  })
                  .catch(() => undefined); // user pressed Esc
              }}
            >
              💧 Eyedropper
            </button>
          ) : null}
        </div>
        {bad ? <p className="text-[0.68rem] text-red-300">Didn&apos;t recognise that colour. Try #ff7f00, rgb(255,127,0), hsl(30,100%,50%) or a name like tomato.</p> : null}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-12 text-[0.62rem] uppercase tracking-wide text-white/40">Brand</span>
          {BRAND_SWATCHES.map((b) => swatch(b.hex, b.name))}
        </div>
        {recent.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-12 text-[0.62rem] uppercase tracking-wide text-white/40">Yours</span>
            {recent.map((hex) => swatch(hex, "Your colour"))}
          </div>
        ) : null}
      </div>
    </Row>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <Row label={label}>
      <select className={studioInput} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Row>
  );
}
