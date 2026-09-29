/**
 * src/components/admin/inventory/ManifestAccountingPanel.tsx  (S29)
 *
 * The body of the Manifest page's Accounting tab. Server component, zero JS.
 * Reads ONLY the durable manifest timeline (manifest_events), so a books
 * refusal written at receiving time is still here after a reload (F-120) —
 * the URL banner covers just the immediate redirect.
 *
 * Owner decision D-R2-3: Accounts Payable belongs to the manager
 * (payables.manage), so its link renders for everyone who can see this page.
 * The books themselves are owner-only (books.view): a link into /admin/books
 * renders ONLY when `canBooks`, otherwise the plain sentence "The owner
 * reviews this in the books." — never a link that dead-ends in a refusal.
 */

import Link from "next/link";
import { fmtPacificDateTime } from "@/lib/inventory/manifest-table-core";
import { accountingEvents, accountingStatus, booksStepText } from "@/lib/inventory/manifest-event-labels-core";

type ManifestEvent = { id: string; event_type: string; note: string | null; created_at: string };

export function ManifestAccountingPanel({
  events,
  canBooks,
}: {
  events: readonly ManifestEvent[];
  /** can(role, "books.view") — owner only. */
  canBooks: boolean;
}) {
  const booksEvents = accountingEvents(events);
  const booksState = accountingStatus(events);
  return (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      <h2 className="mb-3 text-sm font-black uppercase tracking-[0.14em] text-[var(--admin-text-muted)]">
        Books for this delivery
      </h2>
      <ul className="space-y-1 text-sm text-[var(--admin-text)]" data-testid="books-steps">
        <li>{booksStepText("receipt", booksState.receipt)}</li>
        <li>{booksStepText("bill", booksState.bill)}</li>
      </ul>

      {booksEvents.length > 0 ? (
        <ul className="mt-4 space-y-2 border-t border-[var(--admin-border)] pt-3 text-xs" data-testid="books-events">
          {booksEvents.map((e) => (
            <li key={e.id}>
              <details>
                <summary className="cursor-pointer">
                  <span className={e.label.problem ? "font-bold text-[var(--admin-gold)]" : "font-bold text-[var(--admin-text)]"}>
                    {e.label.label}
                  </span>{" "}
                  <span className="text-[var(--admin-text-faint)]">{fmtPacificDateTime(e.created_at)}</span>
                </summary>
                {e.note ? (
                  <p className="mt-1 whitespace-pre-wrap break-words text-[var(--admin-text-muted)]">{e.note}</p>
                ) : null}
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-[var(--admin-text-faint)]">
          Nothing has been sent to the books for this delivery yet.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[var(--admin-border)] pt-3 text-sm">
        {/* D-R2-3: AP stays with the manager (payables.manage), so this link is safe for every viewer of this page. */}
        <Link href="/admin/vendor-payments" className="font-bold text-[var(--admin-accent)] hover:underline">
          Open Accounts Payable {"\u2192"}
        </Link>
        {canBooks ? (
          <Link href="/admin/books/drafts" className="text-[var(--admin-text-muted)] hover:underline" data-testid="books-owner-link">
            Waiting to Post (books) {"\u2192"}
          </Link>
        ) : (
          <span className="text-xs text-[var(--admin-text-faint)]" data-testid="books-owner-note">
            The owner reviews this in the books.
          </span>
        )}
      </div>
    </div>
  );
}
