"use client";

/**
 * HoursManager — Slice 70 [item 8]
 *
 * Owner/manager tool to adjust employee hours for a Pacific business day:
 *   • Edit an existing punch's clock-in / clock-out (a REASON is required).
 *   • Add a missing punch for someone who forgot to clock in entirely.
 *
 * Times are entered as Pacific wall-clock via <input type="datetime-local">.
 * The server converts them to UTC and recomputes worked minutes. Every change
 * is audited with the reason.
 */
import { useState, useTransition } from "react";
import { Button, Field, Select, Textarea, controlClassName, Badge } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import {
  editPunchAction,
  createPunchAction,
  type PunchActionResult,
} from "@/app/admin/staffing/actions";

export type HoursPunchRow = {
  id: string;
  employeeName: string;
  jobRole: string;
  source: string;
  minutes: number | null;
  /** Pacific datetime-local strings for the inputs. */
  inLocal: string;
  outLocal: string; // "" when still open
  note: string | null;
};

export type HoursEmployeeOption = { id: string; name: string };

function fmtMinutes(min: number | null): string {
  if (!min || min <= 0) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function fmtLocalTime(local: string): string {
  if (!local) return "—";
  const t = local.split("T")[1] ?? "";
  const [hh, mm] = t.split(":");
  const h = Number(hh);
  const h12 = ((h + 11) % 12) + 1;
  const ampm = h < 12 ? "AM" : "PM";
  return `${h12}:${mm} ${ampm}`;
}

export function HoursManager({
  punches,
  employees,
  dayLabel,
  defaultInLocal,
}: {
  punches: HoursPunchRow[];
  employees: HoursEmployeeOption[];
  dayLabel: string;
  /** A sensible default (e.g. 09:00 of the selected day) for the add form. */
  defaultInLocal: string;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Punches for {dayLabel}</h3>
        {!adding && (
          <Button variant="subtle" size="sm" onClick={() => setAdding(true)}>
            + Add missing punch
          </Button>
        )}
      </div>

      {adding && (
        <AddPunchForm
          employees={employees}
          defaultInLocal={defaultInLocal}
          onDone={() => setAdding(false)}
        />
      )}

      {punches.length === 0 ? (
        <p className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-6 text-center text-sm text-white/40">
          No punches recorded for this day.
        </p>
      ) : (
        <div className="space-y-2">
          {punches.map((p) =>
            editingId === p.id ? (
              <EditPunchForm key={p.id} row={p} onDone={() => setEditingId(null)} />
            ) : (
              <div
                key={p.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-3 text-sm"
              >
                <span className="min-w-[9rem] flex-1 font-semibold text-white">{p.employeeName}</span>
                <Badge tone="outline">{p.jobRole}</Badge>
                <span className="text-white/70">
                  {fmtLocalTime(p.inLocal)} → {p.outLocal ? fmtLocalTime(p.outLocal) : <span className="text-[#7ed957]">still in</span>}
                </span>
                <span className="text-white/40">{fmtMinutes(p.minutes)}</span>
                {p.source === "manager_edit" && <Badge tone="gold">edited</Badge>}
                <Button variant="ghost" size="sm" onClick={() => setEditingId(p.id)}>
                  Adjust
                </Button>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

function EditPunchForm({ row, onDone }: { row: HoursPunchRow; onDone: () => void }) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [inLocal, setInLocal] = useState(row.inLocal);
  const [outLocal, setOutLocal] = useState(row.outLocal);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  function submit() {
    setErrors([]);
    start(async () => {
      const res: PunchActionResult = await editPunchAction({
        id: row.id,
        clockInLocal: inLocal,
        clockOutLocal: outLocal || undefined,
        reason,
      });
      if (res.ok) {
        toast({ tone: "success", message: `Hours updated for ${row.employeeName}.` });
        onDone();
      } else if (res.errors) {
        setErrors(res.errors);
      } else {
        toast({ tone: "error", message: res.error ?? "Could not update hours." });
      }
    });
  }

  return (
    <div className="rounded-lg border border-[#7ed957]/30 bg-[#7ed957]/5 px-4 py-4">
      <p className="mb-3 text-sm font-semibold text-white">Adjust hours — {row.employeeName}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Clock in (Pacific)">
          <input type="datetime-local" className={controlClassName} value={inLocal} onChange={(e) => setInLocal(e.target.value)} />
        </Field>
        <Field label="Clock out (Pacific)" help="Leave blank to keep it open.">
          <input type="datetime-local" className={controlClassName} value={outLocal} onChange={(e) => setOutLocal(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Reason for change (required)">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Forgot to clock out; left at 5:00 PM." />
        </Field>
      </div>
      {errors.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-red-300">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={submit} disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function AddPunchForm({
  employees,
  defaultInLocal,
  onDone,
}: {
  employees: HoursEmployeeOption[];
  defaultInLocal: string;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [inLocal, setInLocal] = useState(defaultInLocal);
  const [outLocal, setOutLocal] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  function submit() {
    setErrors([]);
    start(async () => {
      const res: PunchActionResult = await createPunchAction({
        employeeId,
        clockInLocal: inLocal,
        clockOutLocal: outLocal || undefined,
        reason,
      });
      if (res.ok) {
        toast({ tone: "success", message: "Punch added." });
        onDone();
      } else if (res.errors) {
        setErrors(res.errors);
      } else {
        toast({ tone: "error", message: res.error ?? "Could not add punch." });
      }
    });
  }

  return (
    <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-4">
      <p className="mb-3 text-sm font-semibold text-white">Add a missing punch</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Employee">
          <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Clock in (Pacific)">
          <input type="datetime-local" className={controlClassName} value={inLocal} onChange={(e) => setInLocal(e.target.value)} />
        </Field>
        <Field label="Clock out (Pacific)" help="Optional">
          <input type="datetime-local" className={controlClassName} value={outLocal} onChange={(e) => setOutLocal(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Reason (required)">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Forgot to clock in this morning." />
        </Field>
      </div>
      {errors.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-red-300">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={submit} disabled={pending || !employeeId}>
          {pending ? "Adding…" : "Add punch"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
