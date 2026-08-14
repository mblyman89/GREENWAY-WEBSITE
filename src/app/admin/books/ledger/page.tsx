/**
 * src/app/admin/books/ledger/page.tsx   (slice F5-K)
 *
 * THE GENERAL LEDGER — every line, in date order, with a running balance.
 * This is the first thing an auditor asks for, and the screen Michael will use
 * to answer "where did that number come from?".
 *
 * Reversed entries are SHOWN, clearly marked, never hidden. Hiding a mistake
 * is how a ledger becomes a story instead of a record; ASC 250 corrects by
 * reversal precisely so both the error and its correction stay visible.
 */
import Link from "next/link";

import { requireBooksAccess } from "@/lib/accounting/books-access";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  getGeneralLedger,
  ENTITY_LABELS,
  isEntityCode,
} from "@/lib/accounting/ledger-store";
import {
  formatCents,
  validateRange,
  LINE_IN_THE_SAND,
} from "@/lib/accounting/books-view-core";
import { RefusalNotice } from "@/components/admin/books/RefusalNotice";
import { BooksToolbar } from "@/components/admin/books/BooksToolbar";

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
  const result = rangeCheck.ok
    ? await getGeneralLedger(entity, account || null, from, to)
    : null;

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
              {result.data.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-white/40">
                    No entries in this period. Note that an empty ledger and a quiet
                    month look identical — check the dates above.
                  </td>
                </tr>
              ) : (
                result.data.map((r, i) => {
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
                        {formatCents(r.running_balance_cents)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {result?.ok && result.data.length > 0 ? (
        <p className="text-xs text-white/35">
          {result.data.length.toLocaleString("en-US")} lines. Entries marked{" "}
          <span className="font-semibold text-[var(--admin-orange)]">reversed</span> were
          cancelled — they are shown, not hidden, and their reversal supplies the
          opposite lines so the pair nets to zero.
        </p>
      ) : null}
    </div>
  );
}
