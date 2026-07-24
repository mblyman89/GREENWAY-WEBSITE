"use client";

/**
 * ScheduleBuilder (Slice 69 — item 4)
 *
 * A week-at-a-glance grid (employees × Mon–Sun) for building the schedule.
 * Managers add scheduled shifts to any cell, edit/remove them, see per-day
 * coverage totals, jump between weeks, and copy a whole week onto another.
 * Times are entered in Pacific wall-clock; the server converts to UTC.
 */
import { useMemo, useState, useTransition } from "react";
import { Button, Card, Badge, controlClassName } from "@/components/admin/ui";
import { ConfirmDialog, useToast } from "@/components/admin/ux";
import {
  weekDays,
  shortDayLabel,
  parseHhmm,
  formatHm,
  shiftDurationMinutes,
  formatDuration,
  weekCoverage,
} from "@/lib/staffing/schedule-core";
import {
  createShiftAction,
  updateShiftAction,
  deleteShiftAction,
  copyWeekAction,
  type ScheduleActionResult,
} from "@/app/admin/staffing/schedule/actions";

type EmployeeLite = { id: string; full_name: string; job_role: string };
type ShiftLite = {
  id: string;
  employee_id: string;
  business_day: string;
  shift_role: "sales" | "manager" | "lead" | "other";
  status: "scheduled" | "open" | "closed";
  start_hm: { h: number; m: number } | null;
  end_hm: { h: number; m: number } | null;
  notes: string | null;
};

const ROLE_TONE: Record<ShiftLite["shift_role"], "green" | "gold" | "orange" | "neutral"> = {
  manager: "gold",
  lead: "orange",
  sales: "green",
  other: "neutral",
};

/** Bar colors for the timeline view (Task S-b), matching the role tones. */
const ROLE_BAR: Record<ShiftLite["shift_role"], string> = {
  manager: "bg-[var(--admin-gold)]/70 border-[var(--admin-gold)]",
  lead: "bg-[var(--admin-orange)]/70 border-[var(--admin-orange)]",
  sales: "bg-[var(--admin-accent)]/70 border-[var(--admin-accent)]",
  other: "bg-white/30 border-white/50",
};

export function ScheduleBuilder({
  mondayYmd,
  employees,
  shifts,
  prevMonday,
  nextMonday,
}: {
  mondayYmd: string;
  employees: EmployeeLite[];
  shifts: ShiftLite[];
  prevMonday: string;
  nextMonday: string;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const days = useMemo(() => weekDays(mondayYmd), [mondayYmd]);

  const notify = (res: ScheduleActionResult, ok: string) => {
    if (res.ok && !res.error) {
      toast({ tone: "success", message: ok });
      return true;
    }
    const msg = res.errors?.length ? res.errors.join(" ") : res.error ?? "Couldn't save.";
    toast({ tone: res.ok ? "info" : "error", message: msg });
    return res.ok;
  };

  const coverage = useMemo(() => {
    const rows = shifts
      .filter((s) => s.start_hm && s.end_hm)
      .map((s) => ({
        businessDay: s.business_day,
        minutes: shiftDurationMinutes(s.start_hm as { h: number; m: number }, s.end_hm as { h: number; m: number }),
      }));
    return weekCoverage(days, rows);
  }, [shifts, days]);

  const shiftsByCell = useMemo(() => {
    const map = new Map<string, ShiftLite[]>();
    for (const s of shifts) {
      const key = `${s.employee_id}|${s.business_day}`;
      const arr = map.get(key) ?? [];
      arr.push(s);
      map.set(key, arr);
    }
    return map;
  }, [shifts]);

  function copyThisWeek(toMonday: string) {
    const fd = new FormData();
    fd.set("fromMonday", mondayYmd);
    fd.set("toMonday", toMonday);
    startTransition(async () => {
      const res = await copyWeekAction(fd);
      notify(res, "Week copied.");
    });
  }

  return (
    <div className="space-y-4">
      {/* Coverage timeline — Task S-b: at-a-glance BAR CHART of the week.
          Each day is a track; every shift is a colored bar positioned on a
          shared time axis, so gaps and overlaps jump out immediately. */}
      <CoverageTimeline days={days} shifts={shifts} employees={employees} />

      {/* Week nav + copy controls */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-2">
            <a href={`?week=${prevMonday}`} className="rounded-lg border border-[var(--admin-border)] px-3 py-1.5 text-sm text-white/80 hover:bg-white/5">
              ← Prev week
            </a>
            <span className="px-2 text-sm font-semibold text-white">
              {shortDayLabel(days[0])} – {shortDayLabel(days[6])}
            </span>
            <a href={`?week=${nextMonday}`} className="rounded-lg border border-[var(--admin-border)] px-3 py-1.5 text-sm text-white/80 hover:bg-white/5">
              Next week →
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="neutral" disabled={pending} onClick={() => copyThisWeek(nextMonday)}>
              Copy to next week
            </Button>
          </div>
        </div>
      </Card>

      {/* Grid */}
      <div className="overflow-x-auto rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
        <table className="w-full min-w-[64rem] border-collapse text-sm">
          <thead>
            <tr className="bg-white/[0.03] text-left text-[11px] uppercase tracking-wider text-white/40">
              <th className="sticky left-0 z-10 bg-[var(--admin-surface)] px-3 py-2">Employee</th>
              {days.map((d) => (
                <th key={d} className="px-3 py-2">
                  <div>{shortDayLabel(d)}</div>
                  <div className="mt-0.5 font-normal normal-case text-white/50">
                    {coverage[d]?.count ?? 0} shift{(coverage[d]?.count ?? 0) === 1 ? "" : "s"} ·{" "}
                    {formatDuration(coverage[d]?.minutes ?? 0)}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {employees.map((emp) => (
              <tr key={emp.id}>
                <td className="sticky left-0 z-10 bg-[var(--admin-surface)] px-3 py-2 align-top">
                  <div className="font-medium text-white/85">{emp.full_name}</div>
                  <div className="text-[11px] text-white/40">{emp.job_role}</div>
                </td>
                {days.map((d) => (
                  <td key={d} className="min-w-[9rem] px-2 py-2 align-top">
                    <div className="space-y-1.5">
                      {(shiftsByCell.get(`${emp.id}|${d}`) ?? []).map((s) => (
                        <ShiftChip key={s.id} shift={s} notify={notify} startTransition={startTransition} pending={pending} />
                      ))}
                      <AddShiftInline
                        employeeId={emp.id}
                        businessDay={d}
                        defaultRole={emp.job_role === "manager" ? "manager" : "sales"}
                        notify={notify}
                        startTransition={startTransition}
                        pending={pending}
                      />
                    </div>
                  </td>
                ))}
              </tr>
            ))}
            {employees.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-white/50">
                  No employees yet. Add employees first.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shift chip (view + inline edit / delete)
// ---------------------------------------------------------------------------
function ShiftChip({
  shift,
  notify,
  startTransition,
  pending,
}: {
  shift: ShiftLite;
  notify: (res: ScheduleActionResult, ok: string) => boolean;
  startTransition: React.TransitionStartFunction;
  pending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  // GW-035: friendly confirm dialog instead of the browser's window.confirm.
  const [confirmRemove, setConfirmRemove] = useState(false);
  const isScheduled = shift.status === "scheduled";
  const label =
    shift.start_hm && shift.end_hm ? `${formatHm(shift.start_hm)}–${formatHm(shift.end_hm)}` : shift.status;

  function onDelete() {
    setConfirmRemove(true);
  }

  function removeNow() {
    setConfirmRemove(false);
    const fd = new FormData();
    fd.set("id", shift.id);
    startTransition(async () => {
      const res = await deleteShiftAction(fd);
      notify(res, "Shift removed.");
    });
  }

  if (editing) {
    return (
      <ShiftForm
        mode="edit"
        shift={shift}
        onDone={() => setEditing(false)}
        notify={notify}
        startTransition={startTransition}
        pending={pending}
      />
    );
  }

  return (
    <div className="flex items-center justify-between gap-1 rounded-md border border-[var(--admin-border)] bg-black/20 px-2 py-1">
      <div className="flex items-center gap-1.5">
        <Badge tone={ROLE_TONE[shift.shift_role]}>{shift.shift_role}</Badge>
        <span className="text-[12px] text-white/80">{label}</span>
      </div>
      {isScheduled ? (
        <div className="flex gap-1">
          <button type="button" onClick={() => setEditing(true)} className="text-[11px] text-white/50 hover:text-white" disabled={pending}>
            edit
          </button>
          <button type="button" onClick={onDelete} className="text-[11px] text-[var(--admin-danger)] hover:underline" disabled={pending}>
            ×
          </button>
        </div>
      ) : (
        <span className="text-[10px] uppercase text-white/30">{shift.status}</span>
      )}
      <ConfirmDialog
        open={confirmRemove}
        title="Remove this scheduled shift?"
        description={`${shift.shift_role} · ${label}. The employee will no longer see it on the schedule.`}
        confirmLabel="Remove shift"
        tone="danger"
        onConfirm={removeNow}
        onCancel={() => setConfirmRemove(false)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add-shift inline trigger + form
// ---------------------------------------------------------------------------
function AddShiftInline({
  employeeId,
  businessDay,
  defaultRole,
  notify,
  startTransition,
  pending,
}: {
  employeeId: string;
  businessDay: string;
  defaultRole: ShiftLite["shift_role"];
  notify: (res: ScheduleActionResult, ok: string) => boolean;
  startTransition: React.TransitionStartFunction;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-md border border-dashed border-[var(--admin-border)] py-1 text-[11px] text-white/40 hover:border-[var(--admin-green)] hover:text-white/70"
      >
        + shift
      </button>
    );
  }
  return (
    <ShiftForm
      mode="create"
      employeeId={employeeId}
      businessDay={businessDay}
      defaultRole={defaultRole}
      onDone={() => setOpen(false)}
      notify={notify}
      startTransition={startTransition}
      pending={pending}
    />
  );
}

function toHhmm(hm: { h: number; m: number } | null): string {
  if (!hm) return "";
  return `${String(hm.h).padStart(2, "0")}:${String(hm.m).padStart(2, "0")}`;
}

function ShiftForm({
  mode,
  shift,
  employeeId,
  businessDay,
  defaultRole,
  onDone,
  notify,
  startTransition,
  pending,
}: {
  mode: "create" | "edit";
  shift?: ShiftLite;
  employeeId?: string;
  businessDay?: string;
  defaultRole?: ShiftLite["shift_role"];
  onDone: () => void;
  notify: (res: ScheduleActionResult, ok: string) => boolean;
  startTransition: React.TransitionStartFunction;
  pending: boolean;
}) {
  const day = shift?.business_day ?? businessDay ?? "";
  const [start, setStart] = useState(toHhmm(shift?.start_hm ?? { h: 9, m: 0 }));
  const [end, setEnd] = useState(toHhmm(shift?.end_hm ?? { h: 17, m: 0 }));

  const preview = useMemo(() => {
    const s = parseHhmm(start);
    const e = parseHhmm(end);
    if (!s || !e) return null;
    return formatDuration(shiftDurationMinutes(s, e));
  }, [start, end]);

  function onSubmit(evt: React.FormEvent<HTMLFormElement>) {
    evt.preventDefault();
    const fd = new FormData(evt.currentTarget);
    startTransition(async () => {
      const res = mode === "edit" ? await updateShiftAction(fd) : await createShiftAction(fd);
      if (notify(res, mode === "edit" ? "Shift updated." : "Shift added.")) onDone();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-1.5 rounded-md border border-[var(--admin-border)] bg-black/30 p-2">
      {mode === "edit" && shift ? <input type="hidden" name="id" value={shift.id} /> : null}
      {mode === "create" ? <input type="hidden" name="employeeId" value={employeeId ?? ""} /> : null}
      <input type="hidden" name="businessDay" value={day} />
      <div className="flex gap-1">
        <input
          className={`${controlClassName} px-1.5 py-1 text-[12px]`}
          type="time"
          name="start"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          required
        />
        <input
          className={`${controlClassName} px-1.5 py-1 text-[12px]`}
          type="time"
          name="end"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          required
        />
      </div>
      <select
        className={`${controlClassName} px-1.5 py-1 text-[12px]`}
        name="shiftRole"
        defaultValue={shift?.shift_role ?? defaultRole ?? "sales"}
      >
        <option value="sales">Sales</option>
        <option value="lead">Lead</option>
        <option value="manager">Manager</option>
        <option value="other">Other</option>
      </select>
      {preview && <p className="text-[10px] text-white/40">{preview}</p>}
      <div className="flex gap-1">
        <Button type="submit" size="sm" disabled={pending}>
          {mode === "edit" ? "Save" : "Add"}
        </Button>
        <Button type="button" size="sm" variant="neutral" disabled={pending} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Coverage timeline (Task S-b) — the "super easy to view" bar chart. One
// horizontal track per day; each scheduled shift renders as a colored bar on
// a shared hour axis, labeled with the employee's first name. Gaps in
// coverage and stacked-up overlaps are visible at a glance.
// ---------------------------------------------------------------------------
function CoverageTimeline({
  days,
  shifts,
  employees,
}: {
  days: string[];
  shifts: ShiftLite[];
  employees: EmployeeLite[];
}) {
  const [open, setOpen] = useState(true);
  const nameOf = useMemo(
    () => new Map(employees.map((e) => [e.id, e.full_name.split(" ")[0]])),
    [employees],
  );

  const timed = useMemo(() => shifts.filter((s) => s.start_hm && s.end_hm), [shifts]);

  // Shared hour axis: from the earliest start to the latest end (min 8–22).
  const [axisStart, axisEnd] = useMemo(() => {
    let lo = 8 * 60;
    let hi = 22 * 60;
    for (const s of timed) {
      const st = (s.start_hm as { h: number; m: number }).h * 60 + (s.start_hm as { h: number; m: number }).m;
      let en = (s.end_hm as { h: number; m: number }).h * 60 + (s.end_hm as { h: number; m: number }).m;
      if (en <= st) en = 24 * 60; // overnight shift: draw to midnight
      if (st < lo) lo = st;
      if (en > hi) hi = en;
    }
    return [Math.floor(lo / 60) * 60, Math.min(24 * 60, Math.ceil(hi / 60) * 60)];
  }, [timed]);
  const span = Math.max(1, axisEnd - axisStart);

  const hourTicks = useMemo(() => {
    const ticks: number[] = [];
    const step = span > 12 * 60 ? 120 : 60; // 2h ticks on long axes
    for (let m = axisStart; m <= axisEnd; m += step) ticks.push(m);
    return ticks;
  }, [axisStart, axisEnd, span]);

  const byDay = useMemo(() => {
    const map = new Map<string, ShiftLite[]>();
    for (const s of timed) {
      const arr = map.get(s.business_day) ?? [];
      arr.push(s);
      map.set(s.business_day, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const sa = (a.start_hm as { h: number; m: number }).h * 60 + (a.start_hm as { h: number; m: number }).m;
        const sb = (b.start_hm as { h: number; m: number }).h * 60 + (b.start_hm as { h: number; m: number }).m;
        return sa - sb;
      });
    }
    return map;
  }, [timed]);

  const hourLabel = (m: number) => {
    const h = Math.floor(m / 60) % 24;
    if (h === 0) return "12a";
    if (h === 12) return "12p";
    return h < 12 ? `${h}a` : `${h - 12}p`;
  };

  return (
    <Card>
      <div className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white">Week at a glance</h3>
            <p className="text-xs text-white/45">
              Every shift as a bar on the day&apos;s timeline — spot gaps and stack-ups instantly.
              Colors match roles: <span className="text-[var(--admin-accent)]">sales</span>,{" "}
              <span className="text-[var(--admin-gold)]">manager</span>,{" "}
              <span className="text-[var(--admin-orange)]">lead</span>.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-lg border border-[var(--admin-border)] px-3 py-1.5 text-xs text-white/70 hover:bg-white/5"
          >
            {open ? "Hide" : "Show"}
          </button>
        </div>

        {open && (
          <div className="mt-4 space-y-1.5">
            {/* Hour axis */}
            <div className="ml-24 relative h-4">
              {hourTicks.map((m) => (
                <span
                  key={m}
                  className="absolute -translate-x-1/2 text-[10px] text-white/35"
                  style={{ left: `${((m - axisStart) / span) * 100}%` }}
                >
                  {hourLabel(m)}
                </span>
              ))}
            </div>
            {days.map((d) => {
              const dayShifts = byDay.get(d) ?? [];
              return (
                <div key={d} className="flex items-stretch gap-2">
                  <div className="shrink-0 py-1 text-[11px] text-white/50" style={{ width: "5.5rem" }}>
                    {shortDayLabel(d)}
                  </div>
                  <div className="relative min-h-[1.9rem] flex-1 rounded-md border border-white/5 bg-black/20">
                    {/* Hour gridlines */}
                    {hourTicks.map((m) => (
                      <span
                        key={m}
                        className="absolute inset-y-0 w-px bg-white/5"
                        style={{ left: `${((m - axisStart) / span) * 100}%` }}
                      />
                    ))}
                    {dayShifts.length === 0 && (
                      <span className="absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-wide text-white/20">
                        no coverage
                      </span>
                    )}
                    <div className="relative flex flex-col gap-0.5 py-0.5">
                      {dayShifts.map((s) => {
                        const st =
                          (s.start_hm as { h: number; m: number }).h * 60 +
                          (s.start_hm as { h: number; m: number }).m;
                        let en =
                          (s.end_hm as { h: number; m: number }).h * 60 +
                          (s.end_hm as { h: number; m: number }).m;
                        if (en <= st) en = 24 * 60;
                        const left = ((Math.max(st, axisStart) - axisStart) / span) * 100;
                        const width = Math.max(2, ((Math.min(en, axisEnd) - Math.max(st, axisStart)) / span) * 100);
                        return (
                          <div key={s.id} className="relative h-5">
                            <div
                              className={`absolute inset-y-0 flex items-center overflow-hidden rounded border px-1.5 text-[10px] font-semibold text-black ${ROLE_BAR[s.shift_role]}`}
                              style={{ left: `${left}%`, width: `${width}%` }}
                              title={`${nameOf.get(s.employee_id) ?? "?"} · ${s.shift_role} · ${
                                s.start_hm && s.end_hm ? `${formatHm(s.start_hm)}–${formatHm(s.end_hm)}` : ""
                              }`}
                            >
                              <span className="truncate">{nameOf.get(s.employee_id) ?? "?"}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
