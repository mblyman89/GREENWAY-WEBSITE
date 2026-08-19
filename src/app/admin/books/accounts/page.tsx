/**
 * src/app/admin/books/accounts/page.tsx   (slice F5-K)
 *
 * THE CHART OF ACCOUNTS — the list of buckets everything gets sorted into.
 *
 * Grouped in balance-sheet order (assets, liabilities, equity, revenue,
 * expenses) rather than alphabetically, because that is how the chart is read.
 * Accounts with an unexpected type are still shown, at the end: an account
 * that quietly vanishes from this list is an account nobody remembers to
 * reconcile.
 *
 * BOOKS-08 adds the guidance layer below the list. The chart itself was already
 * solid — coa-core enforces blocks, derives normal balances, handles contra
 * accounts and refuses auto-posting — so what was missing was never enforcement.
 * It was the explanation of why the choice matters: in a §280E business the
 * account decides whether a dollar is deductible, and that cannot be enforced,
 * only taught.
 */
import Link from "next/link";

import { requireBooksAccess } from "@/lib/accounting/books-access";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { listAccounts, ENTITY_LABELS, ENTITY_CODES, isEntityCode } from "@/lib/accounting/ledger-store";
import { groupAccountsByType, costClassBadgeLabel } from "@/lib/accounting/books-view-core";
import { RefusalNotice } from "@/components/admin/books/RefusalNotice";
import { AccountsExplainer } from "./AccountsExplainer";

export const dynamic = "force-dynamic";

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; inactive?: string }>;
}) {
  await requireBooksAccess();
  const sp = await searchParams;

  const entity = sp.entity && isEntityCode(sp.entity) ? sp.entity : "greenway";
  const includeInactive = sp.inactive === "1";

  if (!isSupabaseServiceConfigured) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-sm text-white/50">
        Supabase isn&apos;t configured in this environment, so the books are unavailable.
      </div>
    );
  }

  const result = await listAccounts(entity, includeInactive);
  const groups = result.ok ? groupAccountsByType(result.data) : [];
  const total = result.ok ? result.data.length : 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black text-white">Chart of accounts</h1>
        <p className="mt-1 text-sm text-white/50">
          The buckets every transaction gets sorted into — {ENTITY_LABELS[entity]}.
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <p className="text-[11px] uppercase tracking-wide text-white/40">Set of books</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {ENTITY_CODES.map((code) => (
            <Link
              key={code}
              href={`/admin/books/accounts?entity=${code}${includeInactive ? "&inactive=1" : ""}`}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                code === entity
                  ? "border-[var(--admin-accent)]/50 bg-[var(--admin-accent)]/15 text-white"
                  : "border-white/10 bg-white/[0.03] text-white/60 hover:text-white"
              }`}
            >
              {ENTITY_LABELS[code]}
            </Link>
          ))}
        </div>
        <div className="mt-4">
          <Link
            href={`/admin/books/accounts?entity=${entity}${includeInactive ? "" : "&inactive=1"}`}
            className="text-xs font-semibold text-[var(--admin-accent)] hover:underline"
          >
            {includeInactive ? "Hide retired accounts" : "Show retired accounts too"}
          </Link>
        </div>
      </div>

      {!result.ok ? <RefusalNotice refusal={result.refusal} /> : null}

      {result.ok ? (
        <>
          <p className="text-xs text-white/40">
            {total.toLocaleString("en-US")} accounts. Accounts shared across all four sets
            of books are included here too.
          </p>

          {groups.map((g) => (
            <div key={g.type} className="overflow-hidden rounded-2xl border border-white/10">
              <div className="bg-white/[0.04] px-4 py-3">
                <p className="text-sm font-bold text-white">{g.label}</p>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {g.accounts.map((a) => (
                    <tr key={a.code} className="border-t border-white/5">
                      <td className="w-24 px-4 py-2.5 tabular-nums text-white/50">
                        {a.code}
                      </td>
                      <td className="px-4 py-2.5 text-white/85">
                        {a.name}
                        {!a.active ? (
                          <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white/50">
                            retired
                          </span>
                        ) : null}
                        {costClassBadgeLabel(a.cost_class, entity) ? (
                          <span className="ml-2 rounded bg-[var(--admin-gold)]/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--admin-gold)]">
                            {costClassBadgeLabel(a.cost_class, entity)}
                          </span>
                        ) : null}
                      </td>
                      <td className="w-40 px-4 py-2.5 text-right">
                        <Link
                          href={`/admin/books/ledger?entity=${entity}&account=${a.code}`}
                          className="text-xs font-semibold text-white/50 hover:text-[var(--admin-accent)]"
                        >
                          View ledger →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {groups.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-sm text-white/50">
              No accounts found for this set of books.
            </div>
          ) : null}

          <AccountsExplainer />
        </>
      ) : null}
    </div>
  );
}
