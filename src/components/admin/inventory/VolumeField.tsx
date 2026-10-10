"use client";

/**
 * R37 S3 - net volume in ml OR US fl oz, with the conversion shown as you
 * type and a table of standard sizes (owner: "select between ml and fl oz.
 * And I want standard conversion rates so it's easy to know without needing
 * to google it first").
 *
 * Posts `netVolumeMl` (the number as typed) + `netVolumeUnit` ("ml" |
 * "floz"); the server converts once (volume-input-core parseVolumeInput) and
 * stores millilitres. The saved value always comes back in ml.
 */
import { useId, useState } from "react";
import {
  VOLUME_RATE_TEXT,
  VOLUME_UNIT_LABEL,
  isVolumeInputUnit,
  volumeConversionText,
  volumeReferenceRows,
  type VolumeInputUnit,
} from "@/lib/compliance/volume-input-core";

const inputCls =
  "admin-focus mt-1 w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1.5 text-xs text-[var(--admin-text)]";
const labelCls = "block text-[11px] uppercase tracking-wide text-[var(--admin-text-muted)]";

export function VolumeField({
  id,
  defaultMl,
  prefill,
  hint,
}: {
  id?: string;
  /** The saved / pre-filled figure, always in ml. */
  defaultMl?: string;
  /** data-prefill marker ("coa" | "derived" | "assumed") when the value was not typed by a person. */
  prefill?: string;
  /** A small line under the field (e.g. "from the lab certificate"). */
  hint?: string | null;
}) {
  const auto = useId();
  const inputId = id ?? `vol-${auto}`;
  const [value, setValue] = useState(defaultMl ?? "");
  const [unit, setUnit] = useState<VolumeInputUnit>("ml");
  const n = Number(value);
  const line = value.trim() !== "" && Number.isFinite(n) && n > 0 ? volumeConversionText(n, unit) : null;
  return (
    <div data-testid="volume-field">
      <label className={labelCls} htmlFor={inputId}>Net volume</label>
      <div className="flex gap-1">
        <input
          id={inputId}
          name="netVolumeMl"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={inputCls}
          data-prefill={prefill}
          aria-describedby={`${inputId}-conv`}
        />
        <select
          name="netVolumeUnit"
          value={unit}
          onChange={(e) => {
            if (isVolumeInputUnit(e.target.value)) setUnit(e.target.value);
          }}
          className={`${inputCls} w-auto`}
          aria-label="Volume unit"
          data-testid="volume-unit"
        >
          <option value="ml">{VOLUME_UNIT_LABEL.ml}</option>
          <option value="floz">{VOLUME_UNIT_LABEL.floz}</option>
        </select>
      </div>
      {hint && <span className="mt-0.5 block text-[10px] text-[var(--admin-accent)]">{hint}</span>}
      <span id={`${inputId}-conv`} className="mt-0.5 block text-[10px] text-[var(--admin-text-muted)]" data-testid="volume-conversion">
        {line ?? VOLUME_RATE_TEXT}
      </span>
      <details className="mt-0.5 text-[10px] text-[var(--admin-text-muted)]">
        <summary className="cursor-pointer">Standard sizes</summary>
        <table className="mt-1 w-full" data-testid="volume-reference">
          <thead>
            <tr><th className="text-left">fl oz</th><th className="text-left">ml</th><th /></tr>
          </thead>
          <tbody>
            {volumeReferenceRows().map((r) => (
              <tr key={`${r.flOz}-${r.ml}`}>
                <td>{r.flOz}</td>
                <td>{r.ml}</td>
                <td className="text-[var(--admin-text-faint)]">{r.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1">Saved in ml. {VOLUME_RATE_TEXT} (US fluid ounce).</p>
      </details>
    </div>
  );
}
