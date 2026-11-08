/**
 * BreakReasonFields (owner D211: "There needs to be an option to clock out for lunch, or, for an
 * \u201cother\u201d reason.")
 *
 * Plain form fields (no client state, works without JS) that turn a back-office clock form into
 * "clock out for a break". Leave the reason blank for a normal clock in / out. The server checks
 * the words with break-clock-core.parseBreakRequest (Other needs a short note).
 */
import { BREAK_NOTE_MAX, BREAK_REASON_LABELS } from "@/lib/staffing/break-clock-core";

export function BreakReasonFields({ compact = false, blankLabel = "Clock in / out (no break)" }: { compact?: boolean; blankLabel?: string }) {
  return (
    <div className={compact ? "flex flex-wrap items-center gap-2" : "flex flex-wrap items-end gap-3"}>
      <label className="text-xs text-white/60">
        {compact ? null : <span className="mb-1 block">Break?</span>}
        <select
          name="break_reason"
          defaultValue=""
          aria-label="Break reason"
          className="rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1.5 text-sm text-white"
        >
          <option value="">{blankLabel}</option>
          <option value="lunch">{BREAK_REASON_LABELS.lunch} break (drawer stays open)</option>
          <option value="other">{BREAK_REASON_LABELS.other} break (say why)</option>
        </select>
      </label>
      <label className="text-xs text-white/60">
        {compact ? null : <span className="mb-1 block">Note (needed for Other)</span>}
        <input
          name="break_note"
          maxLength={BREAK_NOTE_MAX}
          placeholder="e.g. doctor call"
          aria-label="Break note"
          className="w-44 rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1.5 text-sm text-white"
        />
      </label>
    </div>
  );
}
