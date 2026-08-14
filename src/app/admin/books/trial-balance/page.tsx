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
 */
import Link from "next/link";

import { requireBooksAccess } from "@/lib/accounting/books-access";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  getTrialBalanceCheck,
  getGeneralLedger,
  ENTITY_LABELS,
  isEntityCode,
} from "@/lib/accounting/ledger-store";
import {
  describeBooks,
  formatCents,
  splitDebitCredit,
  validateRange,
  LINE_IN_THE_SAND,
} from "@/lib/accounting/books-view-core";
import { RefusalNotice } from "@/components/admin/books/RefusalNotice";
import { BooksToolbar } from "@/components/admin/books/BooksToolbar";

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

  const [check, ledger] = await Promise.all([
    rangeCheck.ok ? getTrialBalanceCheck(entity, from, to) : Promise.resolve(null),
    rangeCheck.ok ? getGeneralLedger(entity, null, from, to) : Promise.resolve(null),
  ]);

  // Roll the ledger lines up per account. Done here rather than in SQL so the
  // page shows exactly the same lines the general ledger screen would show —
  // two different queries producing two different totals is precisely the kind
  // of drift this whole project exists to end.
  const perAccount = new Map<
    string,
    { code: string; name: string; balance: number; lines: number }
  >();
  if (ledger?.ok) {
    for (const r of ledger.data) {
      const key = r.account_code;
      const cur = perAccount.get(key) ?? {
        code: r.account_code,
        name: r.account_name,
        balance: 0,
        lines: 0,
      };
      cur.balance += r.debit_cents - r.credit_cents;
      cur.lines += 1;
      perAccount.set(key, cur);
    }
  }
  const rows = [...perAccount.values()]
    .filter((r) => r.balance !== 0)
    .sort((a, b) => a.code.localeCompare(b.code));

  const totalDebit = rows.reduce((n, r) => n + splitDebitCredit(r.balance).debit, 0);
  const totalCredit = rows.reduce((n, r) => n + splitDebitCredit(r.balance).credit, 0);

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
              abnormalCount: Number(check.data.abnormal_count ?? 0),
            });
            return (
              <div className={`rounded-2xl border p-5 ${TONE_CLS[v.tone]}`}>
                <p className="text-sm font-black text-white">{v.headline}</p>
                <p className="mt-2 text-sm leading-relaxed text-white/70">{v.detail}</p>
              </div>
            );
          })()}

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
                  rows.map((r) => {
                    const { debit, credit } = splitDebitCredit(r.balance);
                    return (
                      <tr key={r.code} className="border-t border-white/5">
                        <td className="px-4 py-2.5">
                          <Link
                            href={`/admin/books/ledger?entity=${entity}&account=${r.code}&from=${from}&to=${to}`}
                            className="font-medium text-white hover:text-[var(--admin-accent)]"
                          >
                            <span className="tabular-nums text-white/50">{r.code}</span>{" "}
                            {r.name}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-white/85">
                          {debit ? formatCents(debit) : ""}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-white/85">
                          {credit ? formatCents(credit) : ""}
                        </td>
                      </tr>
                    );
                  })
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
    </div>
  );
}
