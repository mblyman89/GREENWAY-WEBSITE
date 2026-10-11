"use client";

/**
 * R41 S2 — small shared controls for the Banner Studio (bible PART 5.6).
 * Plain inputs styled with the admin tokens; no new dependencies.
 */
import type { ReactNode } from "react";
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

/** Native color picker + brand swatches + hex box (bible Q18). */
export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  return (
    <Row label={label}>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          type="color"
          value={normalizeHex(value, "#ffffff")}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded border border-white/20 bg-transparent"
          aria-label={`${label} picker`}
        />
        <input
          className={`${studioInput} w-24 font-mono`}
          defaultValue={value}
          key={value}
          onBlur={(e) => onChange(normalizeHex(e.target.value, value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onChange(normalizeHex((e.target as HTMLInputElement).value, value));
            }
          }}
          aria-label={`${label} hex code`}
        />
        {BRAND_SWATCHES.map((s) => (
          <button
            key={s.hex}
            type="button"
            title={s.name}
            aria-label={`${label}: ${s.name}`}
            onClick={() => onChange(s.hex)}
            className={`h-6 w-6 rounded-full border ${value === s.hex ? "border-[var(--admin-accent)] ring-2 ring-[var(--admin-accent)]/50" : "border-white/30"}`}
            style={{ backgroundColor: s.hex }}
          />
        ))}
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
