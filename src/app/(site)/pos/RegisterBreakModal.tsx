"use client";

/**
 * RegisterBreakModal (owner D211: "There needs to be an option to clock out for lunch, or, for an
 * “other” reason.")
 *
 * The reason picker the register shows before "Clock out for a break". Lunch needs nothing more;
 * Other asks for a few words. The rules (and the exact words of a refusal) come from the pure
 * break-clock-core, so the register and the server can never disagree about what is allowed.
 * A break does NOT close the drawer: it stays the cashier's, and the register locks behind them.
 */
import { useState } from "react";
import { BREAK_NOTE_MAX, BREAK_REASON_LABELS, parseBreakRequest, type BreakReason, type BreakRequest } from "@/lib/staffing/break-clock-core";

export function RegisterBreakModal({
  name,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  name: string;
  busy: boolean;
  error: string | null;
  onConfirm: (req: BreakRequest) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState<BreakReason | null>(null);
  const [note, setNote] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const confirm = () => {
    const parsed = parseBreakRequest(reason ?? "", note);
    if (!parsed.ok) {
      setLocalError(parsed.error);
      return;
    }
    setLocalError(null);
    onConfirm(parsed.value);
  };

  const shown = localError ?? error;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-label="Clock out for a break">
      <div className="w-full max-w-md rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-surface)] p-5 shadow-2xl">
        <h2 className="text-lg font-bold">🍽️ {name}: clock out for a break</h2>
        <p className="mt-1 text-sm text-[var(--pos-text-muted)]">
          Your drawer stays open and stays yours. The register locks behind you. When you come back, enter your PIN on
          &ldquo;Clock in / Clock out&rdquo; (or tap Back from break) to go back on the clock.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {(["lunch", "other"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                setReason(r);
                setLocalError(null);
              }}
              aria-pressed={reason === r}
              className={`pos-tile min-h-14 rounded-xl border-2 px-4 py-3 text-base font-bold ${
                reason === r
                  ? "border-[var(--pos-accent)] bg-[var(--pos-accent-soft)] text-[var(--pos-accent)]"
                  : "border-[var(--pos-border)] bg-[var(--pos-surface-2)]"
              }`}
            >
              {r === "lunch" ? "🥪 " : "📝 "}
              {BREAK_REASON_LABELS[r]}
            </button>
          ))}
        </div>
        {reason ? (
          <label className="mt-4 block text-sm">
            <span className="font-semibold">{reason === "other" ? "Why? (required)" : "Note (optional)"}</span>
            <input
              type="text"
              value={note}
              maxLength={BREAK_NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
              placeholder={reason === "other" ? "e.g. doctor call, family pickup" : ""}
              className="mt-1 w-full rounded-lg border border-[var(--pos-border)] bg-[var(--pos-surface-2)] px-3 py-2.5 text-base"
            />
          </label>
        ) : null}
        <p className="mt-3 text-xs text-[var(--pos-text-faint)]">
          Lunch is an unpaid meal break of at least 30 minutes (WA rule WAC 296-126-092). Paid 10-minute rest breaks stay on
          the clock, so you do not clock out for those.
        </p>
        {shown ? <p className="mt-3 rounded-lg bg-[var(--pos-danger-soft)] px-3 py-2 text-sm text-[var(--pos-danger)]">{shown}</p> : null}
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="px-4 py-2 text-sm underline">
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!reason || busy}
            className="pos-tile min-h-12 rounded-xl bg-[var(--pos-accent)] px-5 py-2 font-bold text-[var(--pos-accent-ink)] disabled:opacity-40"
          >
            {busy ? "…" : "Start break"}
          </button>
        </div>
      </div>
    </div>
  );
}
