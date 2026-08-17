/**
 * src/app/admin/books/journal/page.tsx   (slice books-01)
 *
 * THE GENERAL JOURNAL. Owner-only, like every books screen.
 *
 * This page loads the chart of accounts and hands it to the form. It does not
 * write anything itself; the two server actions in ./actions.ts do that, and
 * they go through `gl_submit_journal` — the one door into the ledger.
 *
 * The gate is `requireBooksAccess()`, which is `is_owner()` in application form.
 * It is deliberately NOT the only protection: every accounting RPC is
 * `security definer` and re-checks `is_owner()` itself (migration 0179), so the
 * books stay shut even if this page were mis-gated.
 */

import Link from "next/link";

import { requireBooksAccess } from "@/lib/accounting/books-access";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { listAccounts, isEntityCode } from "@/lib/accounting/ledger-store";
import type { AdvisorEntityCode } from "@/lib/accounting/journal-advisor-core";
import { JournalEntryForm, type AccountOption } from "./JournalEntryForm";

export const dynamic = "force-dynamic";

/** Today in PACIFIC TIME — the business clock, not the server's clock. */
function pacificToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string }>;
}) {
  await requireBooksAccess();
  const sp = await searchParams;
  const entity: AdvisorEntityCode =
    sp.entity && isEntityCode(sp.entity) ? (sp.entity as AdvisorEntityCode) : "greenway";

  if (!isSupabaseServiceConfigured) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-sm text-white/50">
        Supabase isn&apos;t configured in this environment, so the books are unavailable.
      </div>
    );
  }

  const accountsResult = await listAccounts(null, false);
  const accounts: AccountOption[] = accountsResult.ok
    ? accountsResult.data.map((a) => ({
        code: a.code,
        name: a.name,
        type: a.account_type,
        allowedEntities: a.allowed_entity_codes,
      }))
    : [];

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-white">General journal</h1>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/50">
            owner only
          </span>
        </div>
        <p className="max-w-3xl text-sm text-white/55">
          For the handful of things that don&apos;t come in on their own — a cash purchase,
          a correction, an oddity. Sales, purchases, payroll, excise and bank activity are
          drafted for you automatically; you shouldn&apos;t need this page often.
        </p>
        <p className="max-w-3xl text-xs text-white/40">
          Everything you save here is a <strong className="text-white/60">draft</strong>.
          Nothing reaches the ledger until you post it, and nothing is ever posted on your
          behalf without you seeing it first.
        </p>
        <nav className="flex flex-wrap gap-3 pt-1 text-xs">
          <Link href="/admin/books/ledger" className="text-white/50 hover:text-white">
            General ledger →
          </Link>
          <Link href="/admin/books/trial-balance" className="text-white/50 hover:text-white">
            Trial balance →
          </Link>
          <Link href="/admin/books/accounts" className="text-white/50 hover:text-white">
            Chart of accounts →
          </Link>
        </nav>
      </header>

      {!accountsResult.ok && (
        <div className="rounded-xl border border-[var(--admin-orange)]/45 bg-[var(--admin-orange)]/[0.08] p-4 text-sm text-white/80">
          The chart of accounts didn&apos;t load, so there&apos;s nothing safe to post
          against yet. No entry can be written until it does.
        </div>
      )}

      {accountsResult.ok && accounts.length === 0 && (
        <div className="rounded-xl border border-[var(--admin-gold)]/45 bg-[var(--admin-gold)]/[0.07] p-4 text-sm text-white/80">
          There are no active accounts yet. The chart of accounts has to be seeded before
          a journal entry can be written.
        </div>
      )}

      {accountsResult.ok && accounts.length > 0 && (
        <JournalEntryForm
          accounts={accounts}
          defaultEntity={entity}
          defaultDate={pacificToday()}
        />
      )}
    </div>
  );
}
