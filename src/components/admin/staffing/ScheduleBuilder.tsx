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
import { useToast } from "@/components/admin/ux";
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
  const isScheduled = shift.status === "scheduled";
  const label =
    shift.start_hm && shift.end_hm ? `${formatHm(shift.start_hm)}–${formatHm(shift.end_hm)}` : shift.status;

  function onDelete() {
    if (!window.confirm("Remove this scheduled shift?")) return;
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
