/**
 * VendorReconcileSection — P7-a vendor payment ↔ bank reconciliation view.
 *
 * Novice-friendly, at-a-glance: one plain-English verdict banner, then a
 * line-item table (one row per recorded ACH/wire vendor payment) matched to the
 * withdrawal that left the Main operating (Timberland) account. Anything needing
 * attention is highlighted and spelled out. Payments made another way (cash /
 * check / other) are shown in a separate bucket so they never hang as
 * "unmatched" against the bank feed. Mirrors the P6b payroll section exactly.
 *
 * PURE display component: all judgment already happened in the vendor-reconcile
 * core; this only renders the result the page computed.
 */
import { centsToDollars } from "@/lib/payroll/payroll-core";
import {
  formatDiff,
  type VendorReconcileResult,
} from "@/lib/payments/vendor-reconcile-core";
import {
  vendorReconcileChip,
  vendorReconcileHeadline,
  vendorMethodLabel,
} from "@/lib/payments/vendor-reconcile-ui-core";
import { StatCard } from "@/components/admin/StatCard";
import { Badge } from "@/components/admin/ui";
import { EmptyState } from "@/components/admin/ux";

export function VendorReconcileSection({
  result,
  hasMainAccount,
  mainAccountNames,
}: {
  result: VendorReconcileResult;
  hasMainAccount: boolean;
  mainAccountNames: string[];
}) {
  const { payments, summary, unexplainedDebits, otherMethodPayments } = result;

  const headline = vendorReconcileHeadline({
    allClear: summary.allClear,
    paymentCount: summary.paymentCount,
    mismatch: summary.mismatch,
    unmatched: summary.unmatched,
    awaiting: summary.awaiting,
  });

  const bannerCls =
    headline.tone === "green"
      ? "border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)]"
      : headline.tone === "orange"
        ? "border-[var(--admin-orange)]/40 bg-[var(--admin-orange-soft)]"
        : "border-[var(--admin-border)] bg-white/[0.02]";
  const bannerTitleCls =
    headline.tone === "green"
      ? "text-[var(--admin-accent)]"
      : headline.tone === "orange"
        ? "text-[var(--admin-orange)]"
        : "text-[var(--admin-text)]";

  const hasReconcilable = summary.paymentCount > 0;
  const hasAnything = hasReconcilable || summary.otherMethodCount > 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-bold text-[var(--admin-text)]">Bank reconciliation</h2>
        <p className="text-xs text-[var(--admin-text-muted)]">
          Every vendor payment you record by ACH or wire pulls money out of your Main operating account. We match each
          one to the real bank withdrawal so you can prove every invoice you marked paid actually cleared for the right
          amount. Payments made by cash or check are listed separately below.
          {hasMainAccount && mainAccountNames.length > 0
            ? ` Watching: ${mainAccountNames.join(", ")}.`
            : ""}
        </p>
      </div>

      {!hasMainAccount ? (
        <EmptyState
          icon="🏦"
          title="Connect your Main operating account first"
          description='Reconciliation matches each vendor payment against the withdrawal that leaves your operating account. Go to Bank Feeds → the Health tab, find your Timberland operating account, and set its job to "Main operating." Then your payments will match up here automatically — you only do this once.'
        />
      ) : !hasAnything ? (
        <EmptyState
          icon="🧾"
          title="No vendor payments recorded yet"
          description="Once you record a payment against an accepted invoice, an ACH or wire payment's bank withdrawal will be matched here. Payments made by cash or check will be listed separately."
        />
      ) : (
        <>
          {/* Verdict banner — the whole point, in one glance. */}
          <div className={`rounded-[var(--admin-radius-lg)] border p-5 ${bannerCls}`}>
            <h3 className={`text-base font-bold ${bannerTitleCls}`}>{headline.title}</h3>
            <p className="mt-1 text-sm text-[var(--admin-text-muted)]">{headline.detail}</p>
          </div>

          {hasReconcilable ? (
            <>
              {/* Count summary. */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Cleared" value={summary.matched} accent="green" hint="Withdrew & ties out" />
                <StatCard label="Awaiting clearing" value={summary.awaiting} accent="muted" hint="Still within a day or two" />
                <StatCard label="Amount off" value={summary.mismatch} accent="orange" hint="Posted, wrong amount" />
                <StatCard label="Not cleared" value={summary.unmatched} accent="orange" hint="Window passed — please chase" />
              </div>

              {/* Money summary. */}
              <div className="grid gap-4 sm:grid-cols-3">
                <StatCard label="Total expected out" value={`$${centsToDollars(summary.totalExpectedCents)}`} accent="muted" hint="Sum of ACH/wire payments" />
                <StatCard label="Total withdrawn" value={`$${centsToDollars(summary.totalMatchedCents)}`} accent="muted" hint="Actually left the bank so far" />
                <StatCard
                  label="Difference"
                  value={formatDiff(summary.netDifferenceCents)}
                  accent={summary.netDifferenceCents === 0 ? "green" : "muted"}
                  hint={summary.netDifferenceCents === 0 ? "Ties out to the penny" : "Withdrawn minus expected"}
                />
              </div>

              {/* Line-item table — one row per recorded ACH/wire payment. */}
              <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                    <tr>
                      <th className="px-4 py-3">Vendor / invoice</th>
                      <th className="px-4 py-3">Paid on</th>
                      <th className="px-4 py-3">How</th>
                      <th className="px-4 py-3 text-right">Paid (expected)</th>
                      <th className="px-4 py-3 text-right">Withdrawn</th>
                      <th className="px-4 py-3">Posted on</th>
                      <th className="px-4 py-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--admin-border)]">
                    {payments.map((p) => {
                      const chip = vendorReconcileChip(p.status);
                      return (
                        <tr
                          key={p.paymentId}
                          className={`bg-[var(--admin-surface)] ${chip.needsAttention ? "bg-[var(--admin-orange-soft)]" : ""}`}
                        >
                          <td className="px-4 py-3 font-medium text-[var(--admin-text)]">
                            {p.vendorName || "(vendor)"}
                            <span className="block text-xs font-normal text-[var(--admin-text-faint)]">
                              {p.manifestNumber ? `Invoice ${p.manifestNumber}` : "—"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-[var(--admin-text-muted)]">{p.paidDate}</td>
                          <td className="px-4 py-3 text-[var(--admin-text-muted)]">{vendorMethodLabel(p.method)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-[var(--admin-text-muted)]">${centsToDollars(p.expectedCents)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-[var(--admin-text-muted)]">
                            {p.matchedCents === null ? "—" : `$${centsToDollars(p.matchedCents)}`}
                          </td>
                          <td className="px-4 py-3 text-[var(--admin-text-faint)]">{p.matchedDate ?? "—"}</td>
                          <td className="px-4 py-3 text-center">
                            <Badge tone={chip.tone}>{chip.label}</Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* What to check — attention rows spelled out. */}
              {payments.some((p) => vendorReconcileChip(p.status).needsAttention) ? (
                <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-orange)]/30 bg-[var(--admin-orange-soft)] p-5">
                  <h3 className="mb-2 text-sm font-bold text-[var(--admin-orange)]">What to check</h3>
                  <ul className="space-y-2">
                    {payments
                      .filter((p) => vendorReconcileChip(p.status).needsAttention)
                      .map((p) => (
                        <li key={`act-${p.paymentId}`} className="text-sm text-[var(--admin-text-muted)]">
                          <span className="font-semibold text-[var(--admin-text)]">
                            {p.vendorName || "(vendor)"} · {p.manifestNumber || "invoice"} · {p.paidDate}:
                          </span>{" "}
                          {p.status === "mismatch"
                            ? `a withdrawal posted, but for ${formatDiff(p.differenceCents ?? 0)} off the amount you recorded. Confirm the amount, or whether a fee is mixed in.`
                            : `no matching withdrawal has cleared and the posting window (through ${p.windowLatest}) has passed. Confirm the payment actually went out of Timberland for this invoice.`}
                        </li>
                      ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : null}

          {/* Paid another way — cash / check / other, not expected in the feed. */}
          {otherMethodPayments.length > 0 ? (
            <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
              <h3 className="mb-1 text-sm font-bold text-[var(--admin-text)]">Paid another way (not expected in the bank feed)</h3>
              <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
                These invoices were marked paid by cash, check, or another method, so we don&apos;t try to match them to
                an ACH withdrawal. They&apos;re listed here so nothing hangs unpaid — a check clears on its own timing,
                and cash leaves the vault, not the bank.
              </p>
              <div className="overflow-hidden rounded-[var(--admin-radius)] border border-[var(--admin-border)]">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                    <tr>
                      <th className="px-4 py-2">Paid on</th>
                      <th className="px-4 py-2">Vendor / invoice</th>
                      <th className="px-4 py-2">How</th>
                      <th className="px-4 py-2">Reference</th>
                      <th className="px-4 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--admin-border)]">
                    {otherMethodPayments.slice(0, 25).map((p) => (
                      <tr key={p.paymentId} className="bg-[var(--admin-surface)]">
                        <td className="px-4 py-2 text-[var(--admin-text-muted)]">{p.paidDate}</td>
                        <td className="px-4 py-2 text-[var(--admin-text-muted)]">
                          {(p.vendorName || "(vendor)") + (p.manifestNumber ? ` · ${p.manifestNumber}` : "")}
                        </td>
                        <td className="px-4 py-2 text-[var(--admin-text-muted)]">{vendorMethodLabel(p.method)}</td>
                        <td className="px-4 py-2 text-[var(--admin-text-faint)]">{p.reference ?? "—"}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-[var(--admin-text-muted)]">${centsToDollars(p.amountCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {otherMethodPayments.length > 25 ? (
                <p className="mt-2 text-xs text-[var(--admin-text-faint)]">Showing the first 25 of {otherMethodPayments.length}.</p>
              ) : null}
            </div>
          ) : null}

          {/* Withdrawals we couldn't tie to any payment (informational). */}
          {unexplainedDebits.length > 0 ? (
            <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
              <h3 className="mb-1 text-sm font-bold text-[var(--admin-text)]">Other withdrawals we couldn&apos;t match to a vendor payment</h3>
              <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
                These are money-out transactions on your operating account that didn&apos;t line up with any recorded
                vendor payment. They&apos;re probably normal (payroll, fees, transfers) — shown here only so nothing is hidden.
              </p>
              <div className="overflow-hidden rounded-[var(--admin-radius)] border border-[var(--admin-border)]">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                    <tr>
                      <th className="px-4 py-2">Date</th>
                      <th className="px-4 py-2">Description</th>
                      <th className="px-4 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--admin-border)]">
                    {unexplainedDebits.slice(0, 25).map((w) => (
                      <tr key={w.transactionId} className="bg-[var(--admin-surface)]">
                        <td className="px-4 py-2 text-[var(--admin-text-muted)]">{w.date}</td>
                        <td className="px-4 py-2 text-[var(--admin-text-muted)]">{w.description ?? "—"}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-[var(--admin-text-muted)]">${centsToDollars(w.amountCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {unexplainedDebits.length > 25 ? (
                <p className="mt-2 text-xs text-[var(--admin-text-faint)]">Showing the first 25 of {unexplainedDebits.length}.</p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
