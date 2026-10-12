"use client";

/**
 * FilterRangeSlider — R49 S3 dual-thumb (min–max) range slider.
 *
 * Pattern: W3C WAI-ARIA APG "Slider (Multi-Thumb)" implemented with TWO NATIVE
 * <input type="range"> stacked on one track (CSS-Tricks "two-thumb case").
 * Native inputs give keyboard (arrows / Page Up/Down / Home / End), touch and
 * screen-reader support for free; each thumb carries its own aria-label and
 * aria-valuetext. The inputs themselves ignore pointer events and only their
 * THUMBS accept them (globals.css `.gw-range-dual`), so both thumbs stay
 * grabbable even where they overlap. The thumbs can never cross: min is
 * clamped to ≤ max and vice versa.
 *
 * Fully controlled; the parent owns the {min,max} value and the bounds.
 */

type FilterRangeSliderProps = {
  /** e.g. "THC" — used in aria labels. */
  label: string;
  unit: string;
  boundsMin: number;
  boundsMax: number;
  valueMin: number;
  valueMax: number;
  step?: number;
  onChange: (next: { min: number; max: number }) => void;
};

export function FilterRangeSlider({
  label,
  unit,
  boundsMin,
  boundsMax,
  valueMin,
  valueMax,
  step = 1,
  onChange,
}: FilterRangeSliderProps) {
  const span = Math.max(boundsMax - boundsMin, 1);
  const lo = Math.min(Math.max(valueMin, boundsMin), boundsMax);
  const hi = Math.max(Math.min(valueMax, boundsMax), boundsMin);
  const leftPct = ((lo - boundsMin) / span) * 100;
  const rightPct = ((hi - boundsMin) / span) * 100;

  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex min-w-0 items-center justify-between gap-3 text-xs font-black uppercase tracking-[0.16em] text-[var(--greenway)]">
        <span className="min-w-0 break-words [overflow-wrap:anywhere]">
          {label} (mg)
        </span>
        <span className="shrink-0 text-white" aria-live="polite">
          {lo === hi ? `${lo} ${unit}` : `${lo}–${hi} ${unit}`}
        </span>
      </div>
      <div className="gw-range-dual relative h-6 min-w-0">
        <div
          className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-zinc-700"
          aria-hidden="true"
        />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--orange)]"
          style={{ left: `${leftPct}%`, right: `${100 - rightPct}%` }}
          aria-hidden="true"
        />
        <input
          type="range"
          min={boundsMin}
          max={boundsMax}
          step={step}
          value={lo}
          aria-label={`Minimum ${label} mg`}
          // When both thumbs meet near the top, lift the MIN thumb so it stays
          // grabbable (otherwise the max input, painted later, covers it).
          style={{ zIndex: lo - boundsMin > span / 2 ? 3 : 2 }}
          aria-valuetext={`${lo} ${unit}`}
          onChange={(event) =>
            onChange({ min: Math.min(Number(event.target.value), hi), max: hi })
          }
          className="absolute inset-0 w-full accent-[var(--orange)]"
        />
        <input
          type="range"
          min={boundsMin}
          max={boundsMax}
          step={step}
          value={hi}
          aria-label={`Maximum ${label} mg`}
          style={{ zIndex: 2 }}
          aria-valuetext={`${hi} ${unit}`}
          onChange={(event) =>
            onChange({ min: lo, max: Math.max(Number(event.target.value), lo) })
          }
          className="absolute inset-0 w-full accent-[var(--orange)]"
        />
      </div>
      <span className="flex justify-between text-xs text-zinc-500">
        <span>
          {boundsMin} {unit}
        </span>
        <span>
          {boundsMax} {unit}
        </span>
      </span>
    </div>
  );
}
