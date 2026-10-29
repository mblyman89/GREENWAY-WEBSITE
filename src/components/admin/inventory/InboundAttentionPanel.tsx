/**
 * src/components/admin/inventory/InboundAttentionPanel.tsx  (Fix Phase 3.2a, G-17 / F-04-4)
 *
 * The "Needs attention" panel on Receiving -> Incoming (email). The owner
 * (verbatim): "In addition to a notice when an email fails, please add a
 * refetch button, or some intelligent way to manually ask the fetcher to look
 * again ... I need a way to ask the system to grab the ones it missed or
 * failed to get."
 *
 *   - the health line of the 15-minute vendor_intake@ mailbox check;
 *   - Check the mailbox now (the same check, at once, 14 days back);
 *   - Find an email (the owner's words -> a mailbox search; pulls in matches);
 *   - every email that did not make a manifest, with what happened, when the
 *     next automatic retry runs, Try again and Resolved (reason + note).
 *
 * Server component: plain forms posting to server actions, each submit button
 * a SaveButton (pending + disabled, so a slow fetch never looks like a hang and
 * a second press cannot fire twice). Text from the database is rendered as
 * text (React escapes it).
 */
import { SaveButton } from "@/components/admin/orders/SaveButton";
import { fmtPulledIn } from "@/lib/inventory/manifest-table-core";
import { healthLine, MAX_FIND_DAYS, RESOLVE_REASONS, sourceRefFor, type AttentionItem, type HealthTone } from "@/lib/inbound-email/inbound-reconcile-core";
import type { AttentionView } from "@/lib/inbound-email/inbound-reconcile-store";
import { CollapsedUntilLinked } from "@/components/admin/inventory/DismissibleBanner";

type RowAction = (logId: string) => Promise<void>;
type ResolveAction = (logId: string, formData: FormData) => Promise<void>;
type FormAction = (formData: FormData) => Promise<void>;

const TONE: Record<HealthTone, string> = {
  ok: "border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]",
  warn: "border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]",
  bad: "border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 text-[var(--admin-danger)]",
};

function nextRetryText(item: AttentionItem): string | null {
  if (item.person) {
    const n = Math.floor(item.row.retry_count ?? 0);
    return item.attention.category === "temporary" && n > 0 ? `Fetched again ${n} time${n === 1 ? "" : "s"} automatically; a person is needed now.` : null;
  }
  return item.nextRetryAt ? `The system fetches it again by itself at ${fmtPulledIn(item.nextRetryAt)} (or press Try again now).` : null;
}

export function InboundAttentionPanel({
  view,
  nowMs,
  checkAction,
  findAction,
  retryAction,
  resolveAction,
}: {
  view: AttentionView;
  nowMs: number;
  checkAction: FormAction;
  findAction: FormAction;
  retryAction: RowAction;
  resolveAction: ResolveAction;
}) {
  const health = healthLine(view.heartbeat, nowMs, view.migrationApplied);
  const { items, summary } = view;
  return (
    // Fix Phase 3.4 (F-04-25): collapsed when the page loads (owner: "the emails
    // that did not make a manifest section should be collapsed when landing on
    // the page"); the count shows on the closed bar, and the red banner's
    // "Open Needs attention" link (#needs-attention) opens it.
    <CollapsedUntilLinked
      id="needs-attention"
      testId="inbound-attention"
      className="scroll-mt-24 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5"
      summary={
        <h2 className="text-sm font-bold text-[var(--admin-text)]">
          <span aria-hidden="true">▸ </span>Emails that did not make a manifest{" "}
          {summary.total > 0 ? (
            <span className="ml-1 rounded-full bg-[var(--admin-danger)]/15 px-2 py-0.5 text-xs font-bold text-[var(--admin-danger)]" data-testid="attention-count">
              {summary.total}
            </span>
          ) : (
            <span className="ml-1 text-xs font-normal text-[var(--admin-text-faint)]">none</span>
          )}
          <span className="ml-2 text-xs font-normal text-[var(--admin-text-faint)]">(click to open)</span>
        </h2>
      }
    >
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mt-1 max-w-3xl text-xs text-[var(--admin-text-muted)]">
            Every manifest comes by email, so every email to vendor_intake@ must end up on the table. The system checks
            the mailbox every 15 minutes and pulls in anything the instant delivery missed; anything that still did not
            make a manifest is listed here until it is fixed or marked Resolved.
          </p>
        </div>
        <form action={checkAction} data-testid="check-mailbox-form">
          <SaveButton label="Check the mailbox now" busyLabel="Checking the mailbox..." variant="primary" />
        </form>
      </div>

      <p data-testid="mailbox-health" data-tone={health.tone} className={`mt-3 rounded-[var(--admin-radius)] border px-3 py-2 text-xs ${TONE[health.tone]}`}>
        {health.text}
      </p>

      <details className="mt-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] px-3 py-2" data-testid="find-email">
        <summary className="cursor-pointer text-xs font-semibold text-[var(--admin-text)]">
          Find an email you can see in the mailbox but not on the table
        </summary>
        <form action={findAction} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-xs text-[var(--admin-text-muted)]">
            Sender, subject words or manifest number
            <input
              name="q"
              required
              minLength={2}
              maxLength={200}
              placeholder='e.g. lilac  or  from:orders@vendor.com  or  "manifest 0123"'
              className="rounded border border-[var(--admin-border)] bg-[var(--admin-bg)] px-2 py-1.5 text-sm text-[var(--admin-text)]"
            />
          </label>
          <label className="flex w-28 flex-col gap-1 text-xs text-[var(--admin-text-muted)]">
            Days back
            <input
              name="days"
              type="number"
              min={1}
              max={MAX_FIND_DAYS}
              defaultValue={30}
              className="rounded border border-[var(--admin-border)] bg-[var(--admin-bg)] px-2 py-1.5 text-sm text-[var(--admin-text)]"
            />
          </label>
          <SaveButton label="Find and pull in" busyLabel="Searching the mailbox..." variant="special" />
        </form>
        <p className="mt-2 text-[11px] text-[var(--admin-text-faint)]">
          Searches vendor_intake@ (Spam and Trash included) the way Gmail search does. Any match not on the table is
          pulled in and read exactly as if it had just arrived; a match that failed before is fetched again. Nothing
          is ever staged twice.
        </p>
      </details>

      {!view.migrationApplied ? null : items.length === 0 ? (
        <p className="mt-4 text-xs text-[var(--admin-text-faint)]" data-testid="attention-empty">
          Nothing needs attention: every email in the mailbox check window made its manifest (or was marked Resolved).
        </p>
      ) : (
        <ul className="mt-4 space-y-3" data-testid="attention-list">
          {items.map((item) => {
            const r = item.row;
            const retry = retryAction.bind(null, r.id);
            const resolve = resolveAction.bind(null, r.id);
            const canRefetch = sourceRefFor(r) !== null;
            const next = nextRetryText(item);
            return (
              <li
                key={r.id}
                data-testid="attention-row"
                data-kind={item.attention.kind}
                className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] p-3"
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${item.person ? "bg-[var(--admin-danger)]/15 text-[var(--admin-danger)]" : "bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]"}`}
                  >
                    {item.attention.label}
                  </span>
                  <span className="font-semibold text-[var(--admin-text)]">{r.subject || "(no subject)"}</span>
                  <span className="text-xs text-[var(--admin-text-muted)]">from {r.from_address || "unknown sender"}</span>
                  <span className="text-xs text-[var(--admin-text-faint)]">{r.received_at ? fmtPulledIn(r.received_at) : ""}</span>
                </div>
                <p className="mt-1 text-xs text-[var(--admin-text-muted)]">{item.attention.advice}</p>
                {next ? <p className="mt-1 text-[11px] text-[var(--admin-text-faint)]">{next}</p> : null}
                {r.note ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[11px] text-[var(--admin-text-faint)]">What the fetch saw</summary>
                    <p className="mt-1 whitespace-pre-wrap break-words text-[11px] text-[var(--admin-text-faint)]">{r.note.slice(0, 1500)}</p>
                  </details>
                ) : null}
                <div className="mt-2 flex flex-wrap items-end gap-3">
                  {canRefetch ? (
                    <form action={retry} data-testid="retry-form">
                      <SaveButton label="Try again" busyLabel="Fetching again..." variant="confirm" />
                    </form>
                  ) : (
                    <span className="text-[11px] text-[var(--admin-text-faint)]">
                      Arrived before the mailbox check existed: use Find an email with its sender or subject.
                    </span>
                  )}
                  <form action={resolve} className="flex flex-wrap items-end gap-2" data-testid="resolve-form">
                    <select
                      name="reason"
                      required
                      defaultValue=""
                      aria-label="Why it is resolved"
                      className="rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1 text-xs text-[var(--admin-text)]"
                    >
                      <option value="" disabled>
                        Resolved because...
                      </option>
                      {RESOLVE_REASONS.map((x) => (
                        <option key={x.code} value={x.code}>
                          {x.label}
                        </option>
                      ))}
                    </select>
                    <input
                      name="note"
                      maxLength={500}
                      placeholder="Note (required for Other)"
                      className="w-48 rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1 text-xs text-[var(--admin-text)]"
                    />
                    <SaveButton label="Resolved" busyLabel="Saving..." variant="neutral" />
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </CollapsedUntilLinked>
  );
}
