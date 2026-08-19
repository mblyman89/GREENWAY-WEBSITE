/**
 * src/app/admin/books/ledger/page.tsx   (slice F5-K; balance forward + mentor, books-08)
 *
 * THE GENERAL LEDGER — every line, in date order, with a running balance.
 * This is the first thing an auditor asks for, and the screen Michael will use
 * to answer "where did that number come from?".
 *
 * Reversed entries are SHOWN, clearly marked, never hidden. Hiding a mistake
 * is how a ledger becomes a story instead of a record; ASC 250 corrects by
 * reversal precisely so both the error and its correction stay visible.
 *
 * ---------------------------------------------------------------------------
 * BOOKS-08: THE BALANCE COLUMN USED TO BE WRONG. HERE IS EXACTLY HOW.
 * ---------------------------------------------------------------------------
 * `gl_general_ledger` computes its running balance as a window function over
 * ONLY the rows inside the requested date range. This page passed
 * `from = LINE_IN_THE_SAND` (2026-01-01), while migration 0172 REQUIRES the
 * opening-balance journal to be dated 2025-12-31 — so the page excluded, every
 * single time, the one entry that says what Michael owned on day one. Note that
 * the SQL function's own default for `p_from` is 2025-12-31: it was right, and
 * this page was overriding it.
 *
 * Proven against a real PostgreSQL 15 rather than reasoned about. With $4,000
 * of opening cash and a $3,000 payment in March, the column headed "Balance"
 * read (3,000.00) where the truth was 1,000.00.
 *
 * That is not cosmetic. "Negative cash" and "negative inventory" are two of the
 * owner's real documented disasters (standing rule 19), and a report that
 * manufactures them on CORRECT books trains him to ignore the exact signal this
 * slice exists to teach him to watch.
 *
 * THE FIX — what every ledger package has printed for fifty years: read
 * inception-to-date once, then fold everything before the window into a single
 * BALANCE FORWARD row. The period view is preserved exactly (you can still ask
 * "what happened in March?"), and the running balance becomes a real balance on
 * every row. The fold itself is pure and lives in books-ledger-guidance-core,
 * so it is tested without a database.
 *
 * No migration was needed for any of this.
 */
import { Fragment } from "react";
import Link from "next/link";

import { requireBooksAccess } from "@/lib/accounting/books-access";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  getGeneralLedgerToDate,
  listAccounts,
  ENTITY_LABELS,
  isEntityCode,
} from "@/lib/accounting/ledger-store";
import {
  formatCents,
  validateRange,
  LINE_IN_THE_SAND,
} from "@/lib/accounting/books-view-core";
import {
  foldBalanceForward,
  natureMapFrom,
  scanLedger,
  sortFindings,
  summariseFindings,
  type AccountFacts,
} from "@/lib/accounting/books-ledger-guidance-core";
import type { AccountType, NormalBalance } from "@/lib/accounting/ledger-core";
import { RefusalNotice } from "@/components/admin/books/RefusalNotice";
import { BooksToolbar } from "@/components/admin/books/BooksToolbar";
import { LedgerExplainer, LedgerFindings } from "./LedgerExplainer";

export const dynamic = "force-dynamic";

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{
    entity?: string;
    account?: string;
    from?: string;
    to?: string;
  }>;
}) {
  await requireBooksAccess();
  const sp = await searchParams;

  const entity = sp.entity && isEntityCode(sp.entity) ? sp.entity : "greenway";
  const account = (sp.account || "").trim();
  const from = sp.from || LINE_IN_THE_SAND;
  const to = sp.to || "2026-12-31";

  if (!isSupabaseServiceConfigured) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-sm text-white/50">
        Supabase isn&apos;t configured in this environment, so the books are unavailable.
      </div>
    );
  }

  const rangeCheck = validateRange(from, to);

  // INCEPTION-TO-DATE, deliberately. The window is applied by the pure fold
  // below, not by the query, because the query cannot carry a balance forward.
  const [result, accountsResult] = rangeCheck.ok
    ? await Promise.all([
        getGeneralLedgerToDate(entity, account || null, to),
        listAccounts(entity, true),
      ])
    : [null, null];

  // The scanner needs each account's normal balance and TYPE, neither of which
  // the ledger RPC returns. Both come from the chart instead. An account we
  // cannot find is SKIPPED rather than guessed at — inventing a normal balance
  // would be the same class of error as inventing a number.
  //
  // ORDER MATTERS HERE: the chart is read BEFORE the fold, because the fold now
  // needs to know which accounts are permanent and which are temporary.
  const facts: AccountFacts[] = (accountsResult?.ok ? accountsResult.data : []).map((a) => ({
    code: a.code,
    name: a.name,
    accountType: a.account_type as AccountType,
    normalBalance: a.normal_balance as NormalBalance,
  }));

  // Fold, then scan. Both are pure; neither touches the database.
  //
  // The nature map is what stops a 2027 ledger from folding 2026's revenue into
  // this year's sales figure. Assets, liabilities and equity carry from
  // inception; income and expenses carry only from January of the year being
  // viewed, because the prior year was closed out to Retained Earnings.
  const natures = natureMapFrom(facts);
  const sections = result?.ok ? foldBalanceForward(result.data, from, natures) : [];

  const findings = sortFindings(scanLedger(sections, facts));
  const summary = summariseFindings(findings);
  const rowCount = sections.reduce((n, s) => n + s.rows.length, 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black text-white">General ledger</h1>
        <p className="mt-1 text-sm text-white/50">
          {account ? `Account ${account}` : "Every account"} — {ENTITY_LABELS[entity]}.
        </p>
      </div>

      <BooksToolbar
        basePath="/admin/books/ledger"
        entity={entity}
        from={from}
        to={to}
        extraQuery={{ account: account || undefined }}
      />

      {account ? (
        <div className="flex items-center gap-3 text-sm">
          <span className="text-white/50">Filtered to account {account}.</span>
          <Link
            href={`/admin/books/ledger?entity=${entity}&from=${from}&to=${to}`}
            className="font-semibold text-[var(--admin-accent)] hover:underline"
          >
            Show every account
          </Link>
        </div>
      ) : null}

      {!rangeCheck.ok ? (
        <div className="rounded-2xl border border-[var(--admin-gold)]/35 bg-[var(--admin-gold)]/[0.06] p-5">
          <p className="text-sm font-bold text-white">That date range won&apos;t work.</p>
          <p className="mt-2 text-sm text-white/70">{rangeCheck.problem}</p>
        </div>
      ) : null}

      {result && !result.ok ? <RefusalNotice refusal={result.refusal} /> : null}

      {/*
        THE SCAN, ABOVE THE TABLE. Deliberately placed before the numbers: the
        whole point is that the interesting thing on a ledger is rarely the
        biggest number, and a reader who scrolls a thousand rows looking for
        trouble will not find it. This says where to look first.

        It is suppressed when the chart could not be read, because a scan run
        without normal balances would silently find nothing and look identical
        to a clean bill of health.
      */}
      {result?.ok && accountsResult?.ok ? (
        <LedgerFindings findings={findings} summary={summary} />
      ) : null}

      {result?.ok && !accountsResult?.ok ? (
        <div className="rounded-2xl border border-[var(--admin-gold)]/35 bg-[var(--admin-gold)]/[0.05] p-5">
          <p className="text-sm font-bold text-white">
            The lines below are real, but they have not been checked.
          </p>
          <p className="mt-2 text-sm text-white/70">
            Reading the chart of accounts failed, and without it there is no way to know
            which side each account normally sits on — so the wrong-side check could not
            run. It is saying nothing rather than saying &ldquo;all clear&rdquo;, because
            those two look identical on screen and only one of them is honest.
          </p>
        </div>
      ) : null}

      {result?.ok ? (
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-white/[0.04] text-left text-[11px] uppercase tracking-wide text-white/45">
              <tr>
                <th className="px-3 py-3 font-semibold">Date</th>
                <th className="px-3 py-3 font-semibold">No.</th>
                <th className="px-3 py-3 font-semibold">Account</th>
                <th className="px-3 py-3 font-semibold">Detail</th>
                <th className="px-3 py-3 text-right font-semibold">Debit</th>
                <th className="px-3 py-3 text-right font-semibold">Credit</th>
                <th className="px-3 py-3 text-right font-semibold">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rowCount === 0 && sections.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-white/40">
                    No entries in this period. Note that an empty ledger and a quiet
                    month look identical — check the dates above.
                  </td>
                </tr>
              ) : (
                sections.map((s) => (
                  // A FRAGMENT, NOT A NESTED <tbody>. A <tbody> inside a <tbody>
                  // is invalid HTML; React renders it, the browser silently
                  // re-parents it, and the result is a hydration mismatch that
                  // shows up as a blank table in production and nowhere else.
                  // Exactly the same class of defect as the <figure>-inside-<p>
                  // caught in books-07.
                  <Fragment key={s.accountCode}>
                    {/*
                      BALANCE FORWARD. Printed even when it is zero, because
                      "this account started at nothing" and "we forgot to carry
                      the balance in" are different statements and the reader is
                      entitled to know which one they are looking at.
                    */}
                    <tr className="border-t border-white/10 bg-white/[0.03]">
                      <td className="px-3 py-2.5 text-xs uppercase tracking-wide text-white/40" colSpan={3}>
                        {s.accountCode} {s.accountName}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-white/45" colSpan={3}>
                        Balance forward
                        {s.hasBalanceForward
                          ? ` — ${s.foldedLineCount.toLocaleString("en-US")} earlier ${
                              s.foldedLineCount === 1 ? "line" : "lines"
                            }, including anything dated before ${from}`
                          : " — nothing before this period"}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-white/70">
                        {formatCents(s.balanceForwardCents)}
                      </td>
                    </tr>

                    {s.rows.map((r, i) => {
                      const reversed = r.journal_status === "reversed";
                      return (
                        <tr
                          key={`${r.journal_no}-${r.account_code}-${i}`}
                          className={`border-t border-white/5 ${reversed ? "opacity-70" : ""}`}
                        >
                          <td className="px-3 py-2.5 tabular-nums text-white/70">
                            {r.journal_date}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums text-white/50">
                            {r.journal_no}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="tabular-nums text-white/50">{r.account_code}</span>{" "}
                            <span className="text-white/85">{r.account_name}</span>
                          </td>
                          <td className="px-3 py-2.5 text-white/60">
                            {reversed ? (
                              <span className="mr-2 rounded bg-[var(--admin-orange)]/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--admin-orange)]">
                                reversed
                              </span>
                            ) : null}
                            {r.description || r.memo || r.source_ref || "—"}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-white/85">
                            {r.debit_cents ? formatCents(r.debit_cents) : ""}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-white/85">
                            {r.credit_cents ? formatCents(r.credit_cents) : ""}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-white">
                            {formatCents(r.runningBalanceCents)}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {result?.ok && rowCount > 0 ? (
        <p className="text-xs text-white/35">
          {rowCount.toLocaleString("en-US")} lines across{" "}
          {sections.length.toLocaleString("en-US")}{" "}
          {sections.length === 1 ? "account" : "accounts"}. Each account opens with
          its balance forward, so the Balance column is a real balance on every row
          and not just a running total of this period. Entries marked{" "}
          <span className="font-semibold text-[var(--admin-orange)]">reversed</span> were
          cancelled — they are shown, not hidden, and their reversal supplies the
          opposite lines so the pair nets to zero.
        </p>
      ) : null}

      {result?.ok ? <LedgerExplainer /> : null}
    </div>
  );
}
