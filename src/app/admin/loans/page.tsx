/**
 * src/app/admin/loans/page.tsx — Manual loans admin page (owner/admin only).
 *
 * Lists the owner's manually-entered loans with a plain-English summary and a
 * paid-off bar, lets you add/edit a loan, view its full amortization schedule
 * (generated in loan-core), and record payments (optionally tagged with the
 * matching Timberland transaction id for an audit trail).
 *
 * Money is shown from integer cents; rates from integer milli-percent. All
 * amortization math is the pure loan-core engine, verified against Michael's
 * real Sound CU statement.
 */
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { listLoans, getLoan, listLoanPayments } from "@/lib/loans/loan-store";
import { listPlaidAccounts } from "@/lib/plaid/store";
import {
  buildAmortizationSchedule,
  buildLoanSummaryView,
  formatLoanCents,
  formatRateMilliPct,
  type LoanInput,
} from "@/lib/loans/loan-core";
import {
  saveLoanAction,
  deleteLoanAction,
  addLoanPaymentAction,
  deleteLoanPaymentAction,
} from "./actions";

export const dynamic = "force-dynamic";

type Search = { id?: string; msg?: string; error?: string };

export default async function LoansPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}): Promise<React.JSX.Element> {
  await requirePermission("settings.manage");
  const sp = await searchParams;

  const dbReady = isSupabaseServiceConfigured;
  const loans = dbReady ? await listLoans() : [];
  const accounts = dbReady ? await listPlaidAccounts() : [];

  const selectedId = sp.id ?? (loans[0]?.id ?? "");
  const selected = selectedId ? await getLoan(selectedId) : null;
  const payments = selected ? await listLoanPayments(selected.id) : [];

  // Build amortization + summary for the selected loan.
  let schedule: ReturnType<typeof buildAmortizationSchedule> | null = null;
  let summary: ReturnType<typeof buildLoanSummaryView> | null = null;
  if (selected) {
    const loanInput: LoanInput = {
      id: selected.id,
      name: selected.name,
      kind: selected.kind,
      originalPrincipalCents: selected.originalPrincipalCents,
      rateMilliPct: selected.rateMilliPct,
      termMonths: selected.termMonths,
      firstPaymentDate: selected.firstPaymentDate,
      scheduledPaymentCents: selected.scheduledPaymentCents,
    };
    schedule = buildAmortizationSchedule(loanInput);
    summary = buildLoanSummaryView({
      name: selected.name,
      kind: selected.kind,
      originalPrincipalCents: selected.originalPrincipalCents,
      currentBalanceCents: selected.currentBalanceCents,
      rateMilliPct: selected.rateMilliPct,
      termMonths: selected.termMonths,
      firstPaymentDate: selected.firstPaymentDate,
      maturityDate: selected.maturityDate,
      scheduledPaymentCents: selected.scheduledPaymentCents,
    });
  }

  const inputCls =
    "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none";
  const labelCls = "block text-xs font-medium text-neutral-600 mb-1";

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Loans"
        subtitle="Track your loans and mortgages with an exact amortization schedule. Enter the loan terms once; the app generates every scheduled payment and remaining balance. Payments can be tagged with the matching Timberland transaction for an audit trail. Owner/admin eyes only."
        breadcrumbs={<Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Loans" }]} />}
        help={
          <HelpPanel
            id="loans-home"
            title="How Loans work"
            steps={[
              'Add a loan with its original amount, interest rate, term (in months), and first payment date. For an interest-free loan (like a promo card), choose "Interest-free".',
              "The app builds the full month-by-month schedule: scheduled payment, how much is interest vs. principal, and the remaining balance.",
              'Record each payment you make. Paste the matching Timberland transaction id in "Matched transaction" to keep an audit trail.',
              "Everything is stored in exact cents; rates keep full precision (e.g. 2.375%).",
            ]}
          />
        }
      />

      {sp.msg ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {sp.msg}
        </div>
      ) : null}
      {sp.error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {sp.error}
        </div>
      ) : null}

      {!dbReady ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          The database isn&apos;t connected yet, so loans can&apos;t be saved. Once Supabase is wired
          up, this page will store and load your loans.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* LEFT: loan list */}
        <div className="lg:col-span-1 space-y-3">
          <div className="rounded-lg border border-neutral-200 bg-white">
            <div className="border-b border-neutral-200 px-4 py-3 text-sm font-semibold text-neutral-800">
              Your loans
            </div>
            {loans.length === 0 ? (
              <div className="px-4 py-4 text-sm text-neutral-500">No loans yet. Add one below.</div>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {loans.map((l) => {
                  const isSel = l.id === selectedId;
                  return (
                    <li key={l.id}>
                      <a
                        href={`/admin/loans?id=${encodeURIComponent(l.id)}`}
                        className={`flex items-center justify-between px-4 py-3 text-sm hover:bg-neutral-50 ${
                          isSel ? "bg-emerald-50" : ""
                        }`}
                      >
                        <span className="font-medium text-neutral-800">{l.name}</span>
                        <span className="text-neutral-500">{formatLoanCents(l.currentBalanceCents)}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Add a new loan */}
          <details className="rounded-lg border border-neutral-200 bg-white">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-neutral-800">
              + Add a new loan
            </summary>
            <form action={saveLoanAction} className="space-y-3 px-4 pb-4">
              <div>
                <label className={labelCls}>Loan name</label>
                <input name="name" className={inputCls} placeholder="e.g. Sound CU mortgage" required />
              </div>
              <div>
                <label className={labelCls}>Type</label>
                <select name="kind" className={inputCls} defaultValue="amortizing">
                  <option value="amortizing">Amortizing (fixed rate)</option>
                  <option value="interest_free">Interest-free (0%)</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Original amount ($)</label>
                  <input name="original_principal" className={inputCls} placeholder="475588.75" required />
                </div>
                <div>
                  <label className={labelCls}>Current balance ($)</label>
                  <input name="current_balance" className={inputCls} placeholder="optional" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Rate (%)</label>
                  <input name="rate" className={inputCls} placeholder="2.375" />
                </div>
                <div>
                  <label className={labelCls}>Term (months)</label>
                  <input name="term_months" className={inputCls} placeholder="180" required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>First payment date</label>
                  <input name="first_payment_date" className={inputCls} placeholder="2022-06-01" required />
                </div>
                <div>
                  <label className={labelCls}>Maturity date</label>
                  <input name="maturity_date" className={inputCls} placeholder="2037-05-01" />
                </div>
              </div>
              <div>
                <label className={labelCls}>Scheduled P&amp;I payment ($) — optional</label>
                <input name="scheduled_payment" className={inputCls} placeholder="4276.16 (auto if blank)" />
              </div>
              <div>
                <label className={labelCls}>Funding account (Timberland)</label>
                <select name="funding_account_id" className={inputCls} defaultValue="">
                  <option value="">— none —</option>
                  {accounts.map((a) => (
                    <option key={a.accountId} value={a.accountId}>
                      {a.name ?? a.officialName ?? a.accountId}
                      {a.mask ? ` ••${a.mask}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Notes</label>
                <input name="notes" className={inputCls} placeholder="optional" />
              </div>
              <button
                type="submit"
                className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                Save loan
              </button>
            </form>
          </details>
        </div>

        {/* RIGHT: selected loan detail */}
        <div className="lg:col-span-2 space-y-6">
          {!selected ? (
            <div className="rounded-lg border border-neutral-200 bg-white px-4 py-8 text-center text-sm text-neutral-500">
              Select a loan on the left, or add one to get started.
            </div>
          ) : (
            <>
              {/* Summary card */}
              {summary ? (
                <div className="rounded-lg border border-neutral-200 bg-white p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-neutral-900">{summary.name}</h2>
                      <p className="text-sm text-neutral-500">{summary.kindText}</p>
                    </div>
                    <form action={deleteLoanAction}>
                      <input type="hidden" name="id" value={selected.id} />
                      <button
                        type="submit"
                        className="rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                      >
                        Delete loan
                      </button>
                    </form>
                  </div>

                  <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                    <Stat label="Current balance" value={summary.balanceText} />
                    <Stat label="Original amount" value={summary.originalText} />
                    <Stat label="Rate" value={summary.rateText} />
                    <Stat label="Scheduled P&I" value={summary.paymentText} />
                    <Stat label="Term" value={summary.termText} />
                    <Stat label="First payment" value={summary.firstPaymentText} />
                    <Stat label="Maturity" value={summary.maturityText} />
                    {schedule ? (
                      <Stat label="Total interest (life)" value={formatLoanCents(schedule.totalInterestCents)} />
                    ) : null}
                  </dl>

                  {summary.paidOffPercent !== null ? (
                    <div className="mt-4">
                      <div className="mb-1 flex justify-between text-xs text-neutral-500">
                        <span>Paid off</span>
                        <span>{summary.paidOffPercent}%</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100">
                        <div
                          className="h-full rounded-full bg-emerald-500"
                          style={{ width: `${summary.paidOffPercent}%` }}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Record a payment */}
              <div className="rounded-lg border border-neutral-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-neutral-800">Record a payment</h3>
                <form action={addLoanPaymentAction} className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <input type="hidden" name="loan_id" value={selected.id} />
                  <div>
                    <label className={labelCls}>Date</label>
                    <input name="paid_date" className={inputCls} placeholder="2026-08-05" required />
                  </div>
                  <div>
                    <label className={labelCls}>Amount ($)</label>
                    <input name="amount" className={inputCls} placeholder="5797.27" required />
                  </div>
                  <div>
                    <label className={labelCls}>Principal ($)</label>
                    <input name="principal" className={inputCls} placeholder="optional" />
                  </div>
                  <div>
                    <label className={labelCls}>Interest ($)</label>
                    <input name="interest" className={inputCls} placeholder="optional" />
                  </div>
                  <div>
                    <label className={labelCls}>Escrow ($)</label>
                    <input name="escrow" className={inputCls} placeholder="optional" />
                  </div>
                  <div>
                    <label className={labelCls}>Fees ($)</label>
                    <input name="fees" className={inputCls} placeholder="optional" />
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>Matched transaction id (Timberland)</label>
                    <input name="matched_transaction_id" className={inputCls} placeholder="optional — audit trail" />
                  </div>
                  <div className="col-span-2 flex items-end">
                    <button
                      type="submit"
                      className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                    >
                      Record payment
                    </button>
                  </div>
                </form>

                {payments.length > 0 ? (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="text-xs uppercase text-neutral-400">
                        <tr>
                          <th className="py-2">Date</th>
                          <th className="py-2">Amount</th>
                          <th className="py-2">Matched txn</th>
                          <th className="py-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {payments.map((p) => (
                          <tr key={p.id}>
                            <td className="py-2">{p.paidDate}</td>
                            <td className="py-2">{formatLoanCents(p.amountCents)}</td>
                            <td className="py-2 text-xs text-neutral-500">
                              {p.matchedTransactionId ? "✓ linked" : "—"}
                            </td>
                            <td className="py-2 text-right">
                              <form action={deleteLoanPaymentAction}>
                                <input type="hidden" name="id" value={p.id} />
                                <input type="hidden" name="loan_id" value={selected.id} />
                                <button
                                  type="submit"
                                  className="text-xs text-red-600 hover:underline"
                                >
                                  delete
                                </button>
                              </form>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>

              {/* Amortization schedule */}
              {schedule ? (
                <div className="rounded-lg border border-neutral-200 bg-white p-4">
                  <h3 className="text-sm font-semibold text-neutral-800">
                    Amortization schedule ({schedule.rows.length} payments)
                  </h3>
                  <div className="mt-3 max-h-[28rem] overflow-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 bg-white text-xs uppercase text-neutral-400">
                        <tr>
                          <th className="py-2 pr-3">#</th>
                          <th className="py-2 pr-3">Date</th>
                          <th className="py-2 pr-3">Payment</th>
                          <th className="py-2 pr-3">Principal</th>
                          <th className="py-2 pr-3">Interest</th>
                          <th className="py-2">Balance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {schedule.rows.map((r) => (
                          <tr key={r.number}>
                            <td className="py-1.5 pr-3 text-neutral-400">{r.number}</td>
                            <td className="py-1.5 pr-3">{r.date}</td>
                            <td className="py-1.5 pr-3">{formatLoanCents(r.paymentCents)}</td>
                            <td className="py-1.5 pr-3">{formatLoanCents(r.principalCents)}</td>
                            <td className="py-1.5 pr-3">{formatLoanCents(r.interestCents)}</td>
                            <td className="py-1.5">{formatLoanCents(r.balanceCents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-3 text-xs text-neutral-500">
                    Total paid over the life of the loan: {formatLoanCents(schedule.totalPaidCents)} ·
                    Total interest: {formatLoanCents(schedule.totalInterestCents)} · Rate{" "}
                    {formatRateMilliPct(selected.rateMilliPct)}.
                  </p>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="text-sm font-medium text-neutral-900">{value}</dd>
    </div>
  );
}
