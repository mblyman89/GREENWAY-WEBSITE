"use client";

/**
 * R47 — Google store listing hours editor (weekly + holiday / special hours).
 * Posts one hidden JSON field "hours"; the server re-validates everything with
 * normalizeStoreHours, so this UI is only a friendly front end.
 */
import { useState } from "react";
import {
  LATEST_CLOSE,
  MAX_SPECIAL_HOURS,
  hmLabel,
  hoursProblem,
  weeklySummary,
  type DayHours,
  type SpecialHours,
  type StoreHours,
} from "@/lib/seo/store-hours-core";

type Props = {
  initial: StoreHours;
  saveAction: (formData: FormData) => Promise<void>;
};

const field =
  "rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1 text-sm text-[var(--admin-text)]";

function TimeRange({
  opens,
  closes,
  disabled,
  onChange,
  idPrefix,
}: {
  opens: string;
  closes: string;
  disabled: boolean;
  onChange: (next: { opens: string; closes: string }) => void;
  idPrefix: string;
}) {
  const midnight = closes === LATEST_CLOSE;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`${idPrefix}-opens`}>Opens</label>
      <input
        id={`${idPrefix}-opens`}
        type="time"
        className={field}
        value={opens}
        min="08:00"
        disabled={disabled}
        onChange={(e) => onChange({ opens: e.target.value, closes })}
      />
      <span className="text-xs text-[var(--admin-muted)]">to</span>
      <label className="sr-only" htmlFor={`${idPrefix}-closes`}>Closes</label>
      <input
        id={`${idPrefix}-closes`}
        type="time"
        className={field}
        value={midnight ? "" : closes}
        disabled={disabled || midnight}
        onChange={(e) => onChange({ opens, closes: e.target.value })}
      />
      <label className="flex items-center gap-1 text-xs text-[var(--admin-muted)]">
        <input
          type="checkbox"
          checked={midnight}
          disabled={disabled}
          onChange={(e) => onChange({ opens, closes: e.target.checked ? LATEST_CLOSE : "23:00" })}
        />
        Midnight
      </label>
    </div>
  );
}

export function StoreHoursEditor({ initial, saveAction }: Props) {
  const [weekly, setWeekly] = useState<DayHours[]>(initial.weekly);
  const [special, setSpecial] = useState<SpecialHours[]>(initial.special);
  const [nextId, setNextId] = useState(1);

  const hours: StoreHours = { weekly, special };
  const weeklyProblems = weekly.map((d) => (d.closed ? "" : hoursProblem(d.opens, d.closes)));
  const specialProblems = special.map((s) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.from)) return "Pick the first day.";
    if (s.through && s.through < s.from) return "The last day can't be before the first day.";
    return s.closed ? "" : hoursProblem(s.opens, s.closes);
  });
  const hasProblem = weeklyProblems.some(Boolean) || specialProblems.some(Boolean);

  function setDay(i: number, patch: Partial<DayHours>) {
    setWeekly((w) => w.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  }
  function setSp(i: number, patch: Partial<SpecialHours>) {
    setSpecial((s) => s.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  }
  function addSpecial() {
    if (special.length >= MAX_SPECIAL_HOURS) return;
    setSpecial((s) => [
      ...s,
      { id: `new-${Date.now().toString(36)}-${nextId}`, label: "", from: "", through: "", closed: true, opens: "08:00", closes: "23:00" },
    ]);
    setNextId((n) => n + 1);
  }

  return (
    <div className="space-y-6">
      <form action={saveAction} className="space-y-6">
        <input type="hidden" name="hours" value={JSON.stringify({ weekly, special: special.map((s) => ({ ...s, through: s.through || s.from })) })} />

        <section className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
          <h2 className="text-base font-semibold text-[var(--admin-text)]">Regular weekly hours</h2>
          <p className="mt-1 text-xs text-[var(--admin-muted)]">
            Washington law (WAC 314-55-147) allows sales between 8:00 AM and midnight only.
          </p>
          <div className="mt-3 divide-y divide-[var(--admin-border)]">
            {weekly.map((d, i) => (
              <div key={d.day} className="flex flex-wrap items-center gap-3 py-2">
                <div className="w-24 text-sm font-medium text-[var(--admin-text)]">{d.day}</div>
                <label className="flex items-center gap-1 text-xs text-[var(--admin-muted)]">
                  <input type="checkbox" checked={d.closed} onChange={(e) => setDay(i, { closed: e.target.checked })} />
                  Closed all day
                </label>
                <TimeRange
                  idPrefix={`day-${i}`}
                  opens={d.opens}
                  closes={d.closes}
                  disabled={d.closed}
                  onChange={(v) => setDay(i, v)}
                />
                {weeklyProblems[i] && <p className="w-full text-xs text-[var(--admin-danger)]">{weeklyProblems[i]}</p>}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
          <h2 className="text-base font-semibold text-[var(--admin-text)]">Holiday &amp; special hours</h2>
          <p className="mt-1 text-xs text-[var(--admin-muted)]">
            Closed or short hours for a holiday or event. Use one day, or a first and last day for a range.
            Past dates drop out of Google&apos;s listing automatically. Up to {MAX_SPECIAL_HOURS}.
          </p>
          {special.length === 0 && <p className="mt-3 text-sm text-[var(--admin-muted)]">No holiday hours yet.</p>}
          <div className="mt-3 space-y-3">
            {special.map((s, i) => (
              <div key={s.id} className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="text"
                    className={`${field} w-48`}
                    placeholder="Name, e.g. Thanksgiving"
                    maxLength={60}
                    value={s.label}
                    aria-label="Holiday name"
                    onChange={(e) => setSp(i, { label: e.target.value })}
                  />
                  <label className="flex items-center gap-1 text-xs text-[var(--admin-muted)]">
                    First day
                    <input type="date" className={field} value={s.from} onChange={(e) => setSp(i, { from: e.target.value })} />
                  </label>
                  <label className="flex items-center gap-1 text-xs text-[var(--admin-muted)]">
                    Last day (optional)
                    <input type="date" className={field} value={s.through} min={s.from || undefined} onChange={(e) => setSp(i, { through: e.target.value })} />
                  </label>
                  <button
                    type="button"
                    className="ml-auto text-xs text-[var(--admin-danger)] underline"
                    onClick={() => setSpecial((all) => all.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1 text-xs text-[var(--admin-muted)]">
                    <input type="checkbox" checked={s.closed} onChange={(e) => setSp(i, { closed: e.target.checked })} />
                    Closed all day
                  </label>
                  <TimeRange
                    idPrefix={`sp-${s.id}`}
                    opens={s.opens}
                    closes={s.closes}
                    disabled={s.closed}
                    onChange={(v) => setSp(i, v)}
                  />
                </div>
                {specialProblems[i] && <p className="mt-1 text-xs text-[var(--admin-danger)]">{specialProblems[i]}</p>}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addSpecial}
            disabled={special.length >= MAX_SPECIAL_HOURS}
            className="mt-3 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] px-3 py-1.5 text-sm text-[var(--admin-text)] disabled:opacity-50"
          >
            + Add holiday / special hours
          </button>
        </section>

        <section className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2,var(--admin-surface))] p-4 text-sm">
          <div className="font-semibold text-[var(--admin-text)]">What Google will read</div>
          <p className="mt-1 text-[var(--admin-muted)]">{weeklySummary(hours) || "Closed every day"}</p>
          {special.filter((s) => s.from).map((s) => (
            <p key={s.id} className="text-xs text-[var(--admin-muted)]">
              {s.label || "Special hours"}: {s.from}
              {s.through && s.through !== s.from ? ` – ${s.through}` : ""} ·{" "}
              {s.closed ? "Closed" : `${hmLabel(s.opens)} – ${hmLabel(s.closes)}`}
            </p>
          ))}
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={hasProblem}
            className="rounded-[var(--admin-radius-sm)] bg-[var(--admin-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Save hours
          </button>
          {hasProblem && <span className="text-xs text-[var(--admin-danger)]">Fix the red notes above before saving.</span>}
        </div>
      </form>

      <form
        action={saveAction}
        onSubmit={(e) => {
          if (!window.confirm("Reset to 8 AM – 11 PM every day and remove all holiday hours?")) e.preventDefault();
        }}
      >
        <input type="hidden" name="reset" value="1" />
        <button type="submit" className="text-xs text-[var(--admin-muted)] underline">
          Reset to 8 AM – 11 PM daily (removes holiday hours)
        </button>
      </form>
    </div>
  );
}
