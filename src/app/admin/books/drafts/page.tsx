/**
 * src/app/admin/books/drafts/page.tsx   (slice books-85, closes D-67)
 *
 * WAITING TO BE POSTED. The screen D-67 said did not exist.
 *
 * Michael asked, in books-84: "Do we have a screen built for me to review
 * journal entries waiting to be posted to the ledger?" The honest answer then
 * was no — six slices of builders had been quietly filling a queue with no
 * outlet, and every entry the system had ever written was stranded as a draft.
 * This is the outlet.
 *
 * The gate is `requireBooksAccess()` — is_owner() in application form. It is
 * deliberately not the only protection: the read goes through the session
 * client, so RLS on gl_journals (migration 0185) refuses anyone else even if
 * this page were mis-gated, and gl_post_journal re-checks every posting rule
 * from scratch.
 */

import Link from "next/link";

import { requireBooksAccess } from "@/lib/accounting/books-access";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { listDraftJournals } from "@/lib/accounting/approval-service";
import { DraftList } from "./DraftList";
// books-91: the worked example. Rendered ABOVE the list and collapsed, so the
// question "what am I actually looking at?" has an answer on this page even on
// a day when the list is empty. Pure: it needs no database and no session.
import { JournalSpecimen } from "./JournalSpecimen";

export const dynamic = "force-dynamic";

export default async function DraftsPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string }>;
}) {
  await requireBooksAccess();
  const sp = await searchParams;
  const entity = sp.entity && sp.entity.trim() !== "" ? sp.entity.trim() : null;

  if (!isSupabaseServiceConfigured) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-sm text-white/50">
          Supabase isn&apos;t configured in this environment, so the books are unavailable.
        </div>
        {/*
          The worked example needs no database: it is built by the same pure
          engine the real path uses. So it stays readable even here, which is
          the one screen state where a person most needs to know what they were
          supposed to be looking at.
        */}
        <JournalSpecimen />
      </div>
    );
  }

  const result = await listDraftJournals(entity);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-white">Waiting to be posted</h1>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/50">
            owner only
          </span>
        </div>
        <p className="max-w-3xl text-sm text-white/55">
          Everything the system has written and nobody has posted yet. Sales, purchases,
          bank activity and corrections all land here first. Nothing on this page has
          touched your ledger, your trial balance or your tax figures — a draft is a
          proposal, not a fact.
        </p>
        <p className="max-w-3xl text-xs text-white/40">
          Posting is one way. Once an entry is posted it gets a permanent number and
          becomes history that is never edited; if it turns out to be wrong, the fix is a
          reversal, which comes back to this page as a new draft for you to look at.
        </p>
        <nav className="flex flex-wrap gap-3 pt-1 text-xs">
          <Link href="/admin/books/ledger" className="text-white/50 hover:text-white">
            General ledger →
          </Link>
          <Link href="/admin/books/journal" className="text-white/50 hover:text-white">
            Write an entry →
          </Link>
          <Link href="/admin/books/trial-balance" className="text-white/50 hover:text-white">
            Trial balance →
          </Link>
        </nav>
      </header>

      <JournalSpecimen />

      {!result.ok ? (
        <div className="rounded-xl border border-[var(--admin-orange)]/45 bg-[var(--admin-orange)]/[0.08] p-4 text-sm text-white/80">
          {result.message}
        </div>
      ) : (
        <>
          <p className="text-xs text-white/45">{result.message}</p>
          <DraftList drafts={result.drafts} />
        </>
      )}
    </div>
  );
}
