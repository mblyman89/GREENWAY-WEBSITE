"use client";

/**
 * D248 slice 2 - punch adjustments from inside a time card.
 *
 * Reuses the audited time-clock actions (editPunchAction / createPunchAction,
 * staffing.manage, REASON REQUIRED, audited as timepunch.edited / .created).
 * Nothing new writes punches; this only puts those actions next to the hours
 * they change, and refreshes the card so the new totals show at once.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button, controlClassName } from "@/components/admin/ui";
import { createPunchAction, editPunchAction, type PunchActionResult } from "@/app/admin/staffing/actions";

function errText(res: PunchActionResult): string | null {
  if (res.ok) return null;
  return res.errors?.join(" ") ?? res.error ?? "The change was not saved.";
}

/** "Adjust" link on one punch, opening an inline edit with a required reason. */
export function AdjustPunch({ id, inLocal, outLocal, label }: { id: string; inLocal: string; outLocal: string; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [inV, setIn] = useState(inLocal);
  const [outV, setOut] = useState(outLocal);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[0.7rem] font-semibold text-[var(--admin-accent)] hover:underline"
        aria-label={`Adjust ${label}`}
      >
        Adjust
      </button>
    );
  }
  return (
    <div className="mt-2 w-full space-y-2 rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-surface-2)] p-3 text-xs" data-testid="adjust-punch-form">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-[var(--admin-text-muted)]">In (Pacific)</span>
          <input type="datetime-local" className={controlClassName} value={inV} onChange={(e) => setIn(e.target.value)} />
        </label>
        <label className="space-y-1">
          <span className="text-[var(--admin-text-muted)]">Out (Pacific, blank = still open)</span>
          <input type="datetime-local" className={controlClassName} value={outV} onChange={(e) => setOut(e.target.value)} />
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-[var(--admin-text-muted)]">Reason (required, saved to the audit log)</span>
        <input className={controlClassName} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Forgot to clock out; left at 5:00 PM" />
      </label>
      {err ? <p className="text-[var(--admin-danger)]">{err}</p> : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="save"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setErr(null);
              const res = await editPunchAction({ id, clockInLocal: inV, clockOutLocal: outV || undefined, reason });
              const e = errText(res);
              if (e) setErr(e);
              else {
                setOpen(false);
                setReason("");
                router.refresh();
              }
            })
          }
        >
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="neutral" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** "+ punch" on a day: add a forgotten work punch or break, reason required. */
export function AddPunch({ employeeId, day, name }: { employeeId: string; day: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [inV, setIn] = useState(`${day}T09:00`);
  const [outV, setOut] = useState(`${day}T17:00`);
  const [kind, setKind] = useState<"work" | "lunch" | "other">("work");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[0.7rem] font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
        aria-label={`Add a punch for ${name} on ${day}`}
      >
        + punch
      </button>
    );
  }
  return (
    <div className="mt-2 w-full space-y-2 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3 text-xs" data-testid="add-punch-form">
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="space-y-1">
          <span className="text-[var(--admin-text-muted)]">Type</span>
          <select className={controlClassName} value={kind} onChange={(e) => setKind(e.target.value as "work" | "lunch" | "other")}>
            <option value="work">Work</option>
            <option value="lunch">Lunch break (unpaid)</option>
            <option value="other">Other break (unpaid)</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[var(--admin-text-muted)]">In (Pacific)</span>
          <input type="datetime-local" className={controlClassName} value={inV} onChange={(e) => setIn(e.target.value)} />
        </label>
        <label className="space-y-1">
          <span className="text-[var(--admin-text-muted)]">Out (Pacific)</span>
          <input type="datetime-local" className={controlClassName} value={outV} onChange={(e) => setOut(e.target.value)} />
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-[var(--admin-text-muted)]">Reason (required, saved to the audit log)</span>
        <input className={controlClassName} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Forgot to clock in; schedule shows 9-5" />
      </label>
      {err ? <p className="text-[var(--admin-danger)]">{err}</p> : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="save"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setErr(null);
              const res = await createPunchAction({
                employeeId,
                clockInLocal: inV,
                clockOutLocal: outV || undefined,
                reason,
                breakReason: kind === "work" ? null : kind,
                breakNote: kind === "work" ? null : reason.slice(0, 200),
              });
              const e = errText(res);
              if (e) setErr(e);
              else {
                setOpen(false);
                setReason("");
                router.refresh();
              }
            })
          }
        >
          {pending ? "Saving…" : "Add punch"}
        </Button>
        <Button size="sm" variant="neutral" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
