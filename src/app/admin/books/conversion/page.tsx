/**
 * src/app/admin/books/conversion/page.tsx   (slice books-02)
 *
 * THE CONVERSION SCREEN. One page that answers, at a glance, the only question
 * that matters between now and 1 January 2027: "is it safe to switch off Sage?"
 *
 * ---------------------------------------------------------------------------
 * WHAT THE OWNER SAID (Michael, 2026-08-17, verbatim)
 * ---------------------------------------------------------------------------
 *   "I am cutting over from Cultivera pos and sage on November 1st 2026. I will
 *    drop Cultivera completely. I will keep sage and run both books in parallel
 *    until year end. If all goes well, we will drop sage and use our platform
 *    exclusively."
 *
 * "If all goes well" is doing a lot of work in that sentence, and the whole
 * purpose of this page is to refuse to leave it undefined. `canRetireLegacySystem`
 * decides what it means, this page shows the answer, and the answer is allowed
 * to be "no" for months.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS PAGE IS READ-ONLY
 * ---------------------------------------------------------------------------
 * Nothing here posts anything. Blessing the opening balances is a `security
 * definer` database function (0176) that runs the real validations; a screen
 * that could bypass it would be the single most dangerous button in the
 * application, because a wrong opening balance can never be found again — every
 * number afterwards is measured from it, and it balances either way.
 *
 * OWNER-ONLY, like every other set of books, via `requireBooksAccess()` and
 * again in Postgres via `is_owner()` (migration 0185).
 */
import Link from "next/link";

import { requireBooksAccess } from "@/lib/accounting/books-access";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  getConversionConfig,
  getOpeningBalanceSummary,
  listOpeningBalanceRows,
  ENTITY_LABELS,
  isEntityCode,
  type OpeningBalanceRow,
} from "@/lib/accounting/ledger-store";
import {
  CUTOVER_DATE,
  OPENING_BALANCE_DATE,
  PARALLEL_RUN_END,
  formatCents,
  reviewOpeningBalances,
  type OpeningRow,
  type AccountType,
  type EvidenceKind,
  type CutoverSeverity,
} from "@/lib/accounting/cutover-core";
import { RefusalNotice } from "@/components/admin/books/RefusalNotice";

export const dynamic = "force-dynamic";

const SEVERITY_CLS: Record<CutoverSeverity, string> = {
  block: "border-[var(--admin-orange)]/45 bg-[var(--admin-orange)]/[0.08]",
  warn: "border-[var(--admin-gold)]/35 bg-[var(--admin-gold)]/[0.06]",
  note: "border-white/10 bg-white/[0.02]",
};

const SEVERITY_LABEL: Record<CutoverSeverity, string> = {
  block: "Must fix",
  warn: "Worth a look",
  note: "For the record",
};

/**
 * Map a stored worksheet row onto the pure reviewer's input shape.
 *
 * The account TYPE is not stored on the worksheet row — it lives on
 * `gl_accounts`. Rather than join, we infer it from the account code, because
 * the only check that needs it (`CUT_PANDL_ACCOUNT`) cares about one thing:
 * whether the code is in the 4xxxx-9xxxx income-statement range. Getting this
 * wrong in either direction produces a WARNING, never a block, so an inference
 * is an acceptable cost for not widening the query.
 */
function inferAccountType(code: string): AccountType {
  const first = code.trim().charAt(0);
  if (first === "1") return "asset";
  if (first === "2") return "liability";
  if (first === "3") return "equity";
  // 40300/40400 are equity in this chart despite the 4 prefix.
  if (code === "40300" || code === "40400") return "equity";
  if (first === "4") return "income";
  if (first === "5") return "cogs";
  if (first === "6" || first === "7") return "expense";
  if (first === "8") return "other_income";
  return "other_expense";
}

function toOpeningRow(r: OpeningBalanceRow): OpeningRow {
  return {
    accountCode: r.account_code,
    accountName: r.account_code,
    accountType: inferAccountType(r.account_code),
    amountCents: r.amount_cents,
    evidenceKind: r.evidence_kind as EvidenceKind,
    evidenceRef: r.evidence_ref,
    evidenceNote: r.evidence_note,
    status: (r.status === "excluded"
      ? "excluded"
      : r.status === "posted"
        ? "posted"
        : "staged") as OpeningRow["status"],
    exclusionReason: r.exclusion_reason,
  };
}

export default async function ConversionPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string }>;
}) {
  await requireBooksAccess();
  const sp = await searchParams;
  const entity = sp.entity && isEntityCode(sp.entity) ? sp.entity : "greenway";

  if (!isSupabaseServiceConfigured) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-sm text-white/50">
        Supabase isn&apos;t configured in this environment, so the conversion
        status is unavailable.
      </div>
    );
  }

  const [configResult, summaryResult, rowsResult] = await Promise.all([
    getConversionConfig(),
    getOpeningBalanceSummary(entity),
    listOpeningBalanceRows(entity),
  ]);

  const cutover =
    configResult.ok ? configResult.data.cutover_date : CUTOVER_DATE;
  const openingDate =
    configResult.ok ? configResult.data.opening_balance_date : OPENING_BALANCE_DATE;
  const runEnd =
    configResult.ok ? configResult.data.parallel_run_end : PARALLEL_RUN_END;

  const review = rowsResult.ok
    ? reviewOpeningBalances(rowsResult.data.map(toOpeningRow))
    : null;

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------------- */}
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-white">
          Leaving Cultivera and Sage
        </h1>
        <p className="max-w-3xl text-sm leading-relaxed text-white/60">
          You start keeping the books on this platform on{" "}
          <strong className="text-white/90">{cutover}</strong>. The opening
          balance sheet is dated{" "}
          <strong className="text-white/90">{openingDate}</strong> — the close
          of business the day before — because a balance sheet describes a
          moment, and the moment you want is the instant before the first new
          transaction. You then keep Sage running alongside until{" "}
          <strong className="text-white/90">{runEnd}</strong>, and the two are
          compared. Sage is not switched off until they agree.
        </p>
      </header>

      {/* Entity switcher --------------------------------------------------- */}
      <nav className="flex flex-wrap gap-2">
        {(Object.keys(ENTITY_LABELS) as Array<keyof typeof ENTITY_LABELS>).map(
          (code) => (
            <Link
              key={code}
              href={`/admin/books/conversion?entity=${code}`}
              className={`rounded-full border px-4 py-1.5 text-xs transition ${
                code === entity
                  ? "border-[var(--admin-accent)]/50 bg-[var(--admin-accent)]/10 text-white"
                  : "border-white/10 bg-white/[0.02] text-white/55 hover:text-white/80"
              }`}
            >
              {ENTITY_LABELS[code]}
            </Link>
          ),
        )}
      </nav>

      {!configResult.ok && <RefusalNotice refusal={configResult.refusal} />}

      {/* ---------------------------------------------------------------- */}
      {/* THE THREE STEPS                                                   */}
      {/* ---------------------------------------------------------------- */}
      <section className="grid gap-4 md:grid-cols-3">
        <article className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <p className="text-[11px] uppercase tracking-wide text-white/40">
            Step one
          </p>
          <h2 className="mt-1 text-base font-semibold text-white">
            Write down what you own and owe
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-white/55">
            One row per account, as at {openingDate}, each pointing at a
            document you could physically pick up. This is the only part of the
            conversion that cannot be checked afterwards, so it is the part with
            the most argument built into it.
          </p>
        </article>

        <article className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <p className="text-[11px] uppercase tracking-wide text-white/40">
            Step two
          </p>
          <h2 className="mt-1 text-base font-semibold text-white">
            Run both systems side by side
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-white/55">
            From {cutover} to {runEnd} every transaction is recorded in both
            places. It is genuinely double work for two months, and it is the
            only real evidence you will ever get that nothing was lost or
            counted twice in the move.
          </p>
        </article>

        <article className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <p className="text-[11px] uppercase tracking-wide text-white/40">
            Step three
          </p>
          <h2 className="mt-1 text-base font-semibold text-white">
            Switch Sage off — only if they agree
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-white/55">
            Account by account, to the cent, with no rounding allowance. If the
            two systems agree completely, they are <em>consistent</em>. That is
            not the same as <em>correct</em>, and this platform will never tell
            you it is.
          </p>
        </article>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* THE OPENING BALANCE WORKSHEET                                     */}
      {/* ---------------------------------------------------------------- */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-white">
          Your opening balance sheet — {ENTITY_LABELS[entity]}
        </h2>

        {!rowsResult.ok && <RefusalNotice refusal={rowsResult.refusal} />}

        {rowsResult.ok && review && (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="Rows entered" value={String(review.stagedCount)} />
              <Stat label="Total debits" value={formatCents(review.debitCents)} />
              <Stat
                label="Total credits"
                value={formatCents(review.creditCents)}
              />
              <Stat
                label="Out by"
                value={formatCents(Math.abs(review.differenceCents))}
                tone={review.differenceCents === 0 ? "good" : "warn"}
              />
            </div>

            {review.stagedCount === 0 ? (
              <p className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-sm leading-relaxed text-white/55">
                Nothing has been entered yet. That is exactly right for today —
                you cannot write down closing balances for {openingDate} until{" "}
                {openingDate} has happened. When it does, take the final Sage
                trial balance and enter it here one account at a time.
              </p>
            ) : (
              <div className="space-y-3">
                {review.findings.length === 0 && (
                  <p className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-sm leading-relaxed text-white/55">
                    Nothing to raise. The worksheet balances, every row has a
                    document behind it, and there are no income or expense
                    accounts on it. Read it once more against the Sage trial
                    balance before you post it — after that it becomes the
                    starting point for every number in the business.
                  </p>
                )}
                {review.findings.map((f) => (
                  <article
                    key={f.code}
                    className={`rounded-2xl border p-5 ${SEVERITY_CLS[f.severity]}`}
                  >
                    <p className="text-[11px] uppercase tracking-wide text-white/45">
                      {SEVERITY_LABEL[f.severity]}
                    </p>
                    <p className="mt-1.5 text-sm leading-relaxed text-white/80">
                      {f.concern}
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-white/55">
                      {f.suggestion}
                    </p>
                    {f.accountCodes.length > 0 && (
                      <p className="mt-2 font-mono text-xs text-white/40">
                        {f.accountCodes.join(", ")}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </>
        )}

        {summaryResult.ok && (
          <p className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-sm leading-relaxed text-white/55">
            <span className="text-white/75">The database&apos;s own view: </span>
            {summaryResult.data.verdict}
            {summaryResult.data.frozen && (
              <span className="mt-2 block text-white/75">
                These balances have been posted and are now frozen. That is
                intentional — an opening balance that can still be edited is not
                an opening balance.
              </span>
            )}
          </p>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      <footer className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="text-base font-semibold text-white">
          The one thing worth over-thinking
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/55">
          Inventory. Because of §280E, cost of goods sold is the deduction that
          actually survives for a cannabis retailer — most ordinary expenses do
          not. Your opening inventory feeds directly into that number, so
          understating it on {openingDate} overstates your taxable income for
          the rest of the year and there is no later entry that puts it right.
          Count it. Twice. Against a document, not against Sage.
        </p>
      </footer>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn";
}) {
  const cls =
    tone === "warn"
      ? "border-[var(--admin-gold)]/35 bg-[var(--admin-gold)]/[0.06]"
      : "border-white/10 bg-white/[0.02]";
  return (
    <div className={`rounded-2xl border p-4 ${cls}`}>
      <p className="text-[11px] uppercase tracking-wide text-white/40">{label}</p>
      <p className="mt-1 font-mono text-lg text-white/90">{value}</p>
    </div>
  );
}
