"use client";

/**
 * D234 C-7 (SOP-11b G-102): repeat days, daily hours and the fallback tick,
 * the same controls as a home slide's schedule (CarouselSlideCard), for Shop
 * banner slides and type cards. Store time (Pacific).
 */
import { useState } from "react";
import { WEEKDAYS, WEEKDAY_LABEL, cleanDays, describeSchedule } from "@/lib/cms/banner-schedule-core";
import { scheduleOf, type ScheduleFields } from "@/lib/cms/schedule-everywhere-core";

export function ScheduleRepeatFields({
  value,
  onChange,
  noun,
  inputClass,
}: {
  value: ScheduleFields;
  /** Patch; `undefined` clears a field. */
  onChange: (patch: Partial<ScheduleFields>) => void;
  /** "slide" or "card", used in the wording. */
  noun: string;
  inputClass: string;
}) {
  const days = value.scheduleDays ?? [];
  // Typed times are held here until both ends are set (an editor that cleans
  // on every change would otherwise drop the first time straight away).
  const [from, setFrom] = useState(value.scheduleFrom ?? "");
  const [to, setTo] = useState(value.scheduleTo ?? "");
  const setTimes = (f: string, t: string) => {
    setFrom(f);
    setTo(t);
    onChange(f && t && f !== t ? { scheduleFrom: f, scheduleTo: t } : { scheduleFrom: undefined, scheduleTo: undefined });
  };
  const half = (!!from && !to) || (!from && !!to);
  const s = scheduleOf(value);
  const any = !!(s.start || s.end || s.days.length || (s.from && s.to));
  return (
    <div className="mt-3 space-y-3">
      <div>
        <span className="text-xs text-[var(--admin-text-muted)]">Repeat on (none ticked = every day)</span>
        <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label="Repeat on weekdays">
          {WEEKDAYS.map((d) => {
            const on = days.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const next = cleanDays(on ? days.filter((x) => x !== d) : [...days, d]);
                  onChange({ scheduleDays: next.length ? next : undefined });
                }}
                className={`rounded-full border px-3 py-1 text-xs ${on ? "border-[var(--admin-accent)] bg-[var(--admin-accent)] text-black" : "border-white/20 text-white/70 hover:border-white/50"}`}
              >
                {WEEKDAY_LABEL[d]}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-[var(--admin-text-muted)]">
          Each day from (optional)
          <input
            type="time"
            className={`mt-1 w-full ${inputClass}`}
            value={from}
            onChange={(e) => setTimes(e.target.value, e.target.value ? to : "")}
          />
        </label>
        <label className="text-xs text-[var(--admin-text-muted)]">
          Each day until (optional)
          <input
            type="time"
            className={`mt-1 w-full ${inputClass}`}
            value={to}
            onChange={(e) => setTimes(from, e.target.value)}
          />
        </label>
      </div>
      {half ? <p className="text-xs text-amber-300">⚠️ Set both times for a daily window. Half a window is ignored when saved.</p> : null}
      {from && to && from === to ? <p className="text-xs text-amber-300">⚠️ The two times are the same, so there is no daily window.</p> : null}
      <label className="flex items-start gap-2 text-sm text-white/80">
        <input
          type="checkbox"
          checked={value.fallback === true}
          onChange={(e) => onChange({ fallback: e.target.checked ? true : undefined })}
          className="mt-0.5 h-4 w-4 accent-[var(--admin-accent)]"
        />
        <span>
          Fallback {noun}{" "}
          <span className="text-xs text-white/50">
            — shows only when no other {noun} is live (for example, after a promo ends and nobody has updated it yet). Its own schedule is ignored.
          </span>
        </span>
      </label>
      {any ? (
        <p className="text-xs text-white/50">
          Summary: {describeSchedule(s)}. Outside this the {noun} is hidden from visitors; staff preview still shows it.
        </p>
      ) : null}
    </div>
  );
}
