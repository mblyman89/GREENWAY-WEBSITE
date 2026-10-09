/**
 * DismissDuplicateForm  (R36 #2)
 *
 * The owner's "manual button to dismiss a duplicate rather than rejecting it".
 * A <details> disclosure so it is never one stray click: open it, read what
 * will happen, then press the button. Plain server-action form (no client JS).
 *
 * Shown ONLY for a row that has a live twin (findDuplicateTwinsFor); the SQL
 * function re-checks everything in one transaction anyway.
 */
import Link from "next/link";

export function DismissDuplicateForm({
  action,
  keepId,
  keepLabel,
  compact = false,
}: {
  /** dismissDuplicateManifestAction bound to (duplicateId, keepId, back). */
  action: (formData: FormData) => void | Promise<void>;
  keepId: string;
  /** e.g. "the other 0000020830 row (pulled in 8/5 10:02)". */
  keepLabel: string;
  /** Table cell variant (smaller, no reason field). */
  compact?: boolean;
}) {
  return (
    <details className={compact ? "inline-block text-left" : "rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4"} data-testid="dismiss-duplicate">
      <summary
        className={
          compact
            ? "cursor-pointer list-none rounded border border-[var(--admin-gold)]/50 px-2 py-1 text-xs font-semibold text-[var(--admin-gold)] hover:bg-[var(--admin-gold-soft)]"
            : "cursor-pointer text-sm font-semibold text-[var(--admin-gold)]"
        }
        title="This row is a second copy of the same manifest (same manifest # and vendor). Dismiss it without rejecting."
      >
        ⧉ Dismiss duplicate
      </summary>
      <form action={action} className={compact ? "mt-2 w-72 space-y-2 rounded border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3 text-xs" : "mt-3 space-y-3 text-sm"}>
        <p className="text-[var(--admin-text-muted)]">
          This row is a second copy of the same manifest. Dismissing it keeps{" "}
          <Link href={`/admin/inventory/intake/${keepId}`} className="text-[var(--admin-accent)] underline-offset-2 hover:underline">
            {keepLabel}
          </Link>{" "}
          and:
        </p>
        <ul className="list-disc space-y-0.5 pl-5 text-[var(--admin-text-muted)]">
          <li>removes this copy&apos;s lines - they were never received, so nothing shows in Inventory;</li>
          <li>moves its invoice #, documents and any transport details the kept row is missing;</li>
          <li>is <strong>not</strong> a rejection - nothing is refused and nothing is filed with CCRS.</li>
        </ul>
        {!compact && (
          <label className="block">
            <span className="text-xs text-[var(--admin-text-faint)]">Note (optional)</span>
            <input
              name="reason"
              maxLength={500}
              placeholder="e.g. Same email arrived twice"
              className="mt-1 w-full max-w-md rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-1.5 text-sm text-[var(--admin-text)] focus:border-[var(--admin-accent)] focus:outline-none"
            />
          </label>
        )}
        <button
          type="submit"
          className="rounded border border-[var(--admin-gold)] bg-[var(--admin-gold-soft)] px-3 py-1.5 text-xs font-bold text-[var(--admin-gold)] hover:brightness-110"
        >
          ⧉ Dismiss this duplicate
        </button>
      </form>
    </details>
  );
}
