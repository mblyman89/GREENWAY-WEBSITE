/**
 * src/app/admin/books/trial-balance/page.tsx   (slice F5-K)
 *
 * THE TRIAL BALANCE, ON SCREEN. The first page in this application where the
 * books can be LOOKED AT rather than only written to.
 *
 * THE ONE THING THIS PAGE MUST NEVER DO is congratulate the reader for a
 * balanced trial balance. "Debits equal credits" proves the arithmetic holds
 * and nothing else: an empty set of books balances, and so does a set of books
 * missing half its entries, because every journal individually sums to zero.
 * The wording of the banner is deliberate and is asserted in the tests for
 * `describeBooks()`.
 *
 * -----------------------------------------------------------------------------
 * WHAT THE "BALANCE" COLUMN ACTUALLY MEANS (books-08)
 * -----------------------------------------------------------------------------
 * This page originally summed only the lines inside the requested window, whose
 * default start is 2026-01-01. The cut-over opening balances are dated
 * 2025-12-31 — the single pre-2026 date the schema allows (0172's
 * line-in-the-sand check constraint) — so they fell outside every default view.
 *
 * Consequences, all confirmed by executing against Postgres rather than by
 * reading the code:
 *   • every account opened at cut-over was understated by its opening balance;
 *   • accounts were reported as sitting on the "unusual side" purely because
 *     the opening balance that put them on the normal side was excluded;
 *   • and the report STILL footed and STILL certified, because excluding an
 *     entire balanced journal removes equal debits and credits. A report that is
 *     wrong AND self-certifying is worse than one that is merely wrong.
 *
 * The fix reads inception-to-date and applies the requested window in a pure
 * fold (`foldBalanceForward`), which is the SAME function the general ledger
 * screen uses. Sharing the function is the point: two screens that each run
 * their own query eventually disagree, and the first anyone hears of it is a
 * number that will not tie.
 *
 * The fold is NATURE-AWARE. Assets, liabilities and equity carry from inception;
 * income and expenses carry only from the start of the fiscal year being viewed,
 * because a year-end closing entry sweeps them into Retained Earnings. Folding
 * everything from inception would be harmless in 2026 and would silently double
 * -count revenue from 2027 onward.
 */
import Link from "next/link";

import { requireBooksAccess } from "@/lib/accounting/books-access";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  getTrialBalanceCheck,
  getGeneralLedgerToDate,
  listAccounts,
  ENTITY_LABELS,
  isEntityCode,
} from "@/lib/accounting/ledger-store";
import type { AccountType, NormalBalance } from "@/lib/accounting/ledger-core";
import {
  foldBalanceForward,
  natureMapFrom,
  buildTrialBalance,
  type AccountFacts,
} from "@/lib/accounting/books-ledger-guidance-core";
import {
  describeBooks,
  formatCents,
  validateRange,
  LINE_IN_THE_SAND,
} from "@/lib/accounting/books-view-core";
import { RefusalNotice } from "@/components/admin/books/RefusalNotice";
import { BooksToolbar } from "@/components/admin/books/BooksToolbar";
import { TrialBalanceExplainer } from "./TrialBalanceExplainer";

export const dynamic = "force-dynamic";

const TONE_CLS: Record<string, string> = {
  good: "border-[var(--admin-accent)]/30 bg-[var(--admin-accent)]/[0.06]",
  warning: "border-[var(--admin-gold)]/35 bg-[var(--admin-gold)]/[0.06]",
  bad: "border-[var(--admin-orange)]/45 bg-[var(--admin-orange)]/[0.08]",
};

export default async function TrialBalancePage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; from?: string; to?: string }>;
}) {
  await requireBooksAccess();
  const sp = await searchParams;

  const entity = sp.entity && isEntityCode(sp.entity) ? sp.entity : "greenway";
  const from = sp.from || LINE_IN_THE_SAND;
  const to = sp.to || "2026-12-31";

  if (!isSupabaseServiceConfigured) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-sm text-white/50">
        Supabase isn&apos;t configured in this environment, so the books are unavailable.
      </div>
    );
  }

  // Check the range BEFORE the round trip, so an obvious mistake gets an
  // instant, readable answer. The database checks again regardless.
  const rangeCheck = validateRange(from, to);

  // READ INCEPTION-TO-DATE, NOT JUST THE WINDOW.
  //
  // This page used to read from `from` (default 2026-01-01), which excluded the
  // cut-over opening balances dated 2025-12-31 — the only pre-2026 date the
  // schema allows. Every asset therefore appeared short by its opening figure,
  // several accounts were reported as sitting on the "wrong side" purely because
  // their opening balance was missing, and the report STILL footed, so nothing
  // warned anybody. Proven by running it against Postgres, not by reading it.
  //
  // The window the reader asked for is still honoured — it is applied by the
  // pure fold below, which turns everything earlier into a balance forward.
  const [check, ledger, accountsResult] = await Promise.all([
    rangeCheck.ok ? getTrialBalanceCheck(entity, from, to) : Promise.resolve(null),
    rangeCheck.ok ? getGeneralLedgerToDate(entity, null, to) : Promise.resolve(null),
    rangeCheck.ok ? listAccounts(entity, true) : Promise.resolve(null),
  ]);

  // Roll the ledger lines up per account using THE SAME pure fold the general
  // ledger screen uses. Two screens sharing one function cannot drift apart;
  // two screens each running their own query eventually always do.
  const facts: AccountFacts[] = (accountsResult?.ok ? accountsResult.data : []).map((a) => ({
    code: a.code,
    name: a.name,
    accountType: a.account_type as AccountType,
    normalBalance: a.normal_balance as NormalBalance,
  }));

  const sections = ledger?.ok
    ? foldBalanceForward(ledger.data, from, natureMapFrom(facts))
    : [];
  const tb = buildTrialBalance(sections, facts);

  const rows = tb.lines;
  const totalDebit = tb.totalDebitCents;
  const totalCredit = tb.totalCreditCents;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black text-white">Trial balance</h1>
        <p className="mt-1 text-sm text-white/50">
          Every account with a balance, for one set of books, over one period.{" "}
          {ENTITY_LABELS[entity]}.
        </p>
      </div>

      <BooksToolbar basePath="/admin/books/trial-balance" entity={entity} from={from} to={to} />

      {!rangeCheck.ok ? (
        <div className="rounded-2xl border border-[var(--admin-gold)]/35 bg-[var(--admin-gold)]/[0.06] p-5">
          <p className="text-sm font-bold text-white">That date range won&apos;t work.</p>
          <p className="mt-2 text-sm text-white/70">{rangeCheck.problem}</p>
        </div>
      ) : null}

      {check && !check.ok ? <RefusalNotice refusal={check.refusal} /> : null}
      {ledger && !ledger.ok ? <RefusalNotice refusal={ledger.refusal} /> : null}

      {check?.ok ? (
        <>
          {(() => {
            const v = describeBooks({
              balanced: check.data.balanced,
              certified: check.data.certified,
              lineCount: Number(check.data.line_count ?? 0),
              accountCount: Number(check.data.account_count ?? 0),
              differenceCents: Number(check.data.difference_cents ?? 0),
              // ABNORMAL COUNT COMES FROM THE FOLD, NOT FROM THE RPC.
              //
              // The RPC counts abnormal accounts over the requested WINDOW, and
              // the default window begins after the cut-over opening balances.
              // Every asset opened by the cut-over therefore looked abnormal on
              // day one. Counting from the folded closing balances — opening
              // carried forward plus the period's activity — asks the question
              // the reader thinks is being asked.
              abnormalCount: tb.abnormalCount,
            });
            return (
              <div className={`rounded-2xl border p-5 ${TONE_CLS[v.tone]}`}>
                <p className="text-sm font-black text-white">{v.headline}</p>
                <p className="mt-2 text-sm leading-relaxed text-white/70">{v.detail}</p>
              </div>
            );
          })()}

          {tb.unmappedAccountCodes.length > 0 ? (
            <div className="rounded-2xl border border-[var(--admin-orange)]/45 bg-[var(--admin-orange)]/[0.08] p-5">
              <p className="text-sm font-black text-white">
                {tb.unmappedAccountCodes.length} account
                {tb.unmappedAccountCodes.length === 1 ? "" : "s"} on this report
                {tb.unmappedAccountCodes.length === 1 ? " is" : " are"} not in the
                chart for this entity.
              </p>
              <p className="mt-2 text-sm leading-relaxed text-white/75">
                Their money is included in the totals below, so the report still
                adds up — but nothing here knows whether they belong on the debit
                or the credit side, so they have not been checked for being on the
                wrong side. This is usually a mistyped entity code: it is how
                eighteen accounts, including the whole of payroll, once went
                missing from a report that looked perfectly healthy. Codes:{" "}
                <span className="tabular-nums font-semibold text-white">
                  {tb.unmappedAccountCodes.join(", ")}
                </span>
              </p>
            </div>
          ) : null}

          <div className="overflow-hidden rounded-2xl border border-white/10">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.04] text-left text-[11px] uppercase tracking-wide text-white/45">
                <tr>
                  <th className="px-4 py-3 font-semibold">Account</th>
                  <th className="px-4 py-3 text-right font-semibold">Debit</th>
                  <th className="px-4 py-3 text-right font-semibold">Credit</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-sm text-white/40">
                      No account has a balance in this period.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.accountCode} className="border-t border-white/5">
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/admin/books/ledger?entity=${entity}&account=${r.accountCode}&from=${from}&to=${to}`}
                          className="font-medium text-white hover:text-[var(--admin-accent)]"
                        >
                          <span className="tabular-nums text-white/50">{r.accountCode}</span>{" "}
                          {r.accountName}
                        </Link>
                        {r.isAbnormal ? (
                          <span className="ml-2 rounded-full bg-[var(--admin-gold)]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--admin-gold)]">
                            unusual side
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-white/85">
                        {r.debitCents ? formatCents(r.debitCents) : ""}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-white/85">
                        {r.creditCents ? formatCents(r.creditCents) : ""}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {rows.length > 0 ? (
                <tfoot>
                  <tr className="border-t-2 border-white/20 bg-white/[0.03]">
                    <td className="px-4 py-3 text-sm font-black text-white">Total</td>
                    <td className="px-4 py-3 text-right text-sm font-black tabular-nums text-white">
                      {formatCents(totalDebit)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-black tabular-nums text-white">
                      {formatCents(totalCredit)}
                    </td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>

          <p className="text-xs text-white/35">
            Figures are taken from posted and reversed entries only — drafts are never
            included. A reversed entry keeps its lines and its reversal supplies the
            opposite lines, so a cancelled transaction nets to zero rather than
            disappearing.
          </p>
        </>
      ) : null}

      {/*
        The guidance sits BELOW the numbers deliberately. Michael came here to
        read a trial balance; the explainer's job is to change what he concludes
        from it, which only works after he has seen it.
      */}
      <TrialBalanceExplainer />
    </div>
  );
}
