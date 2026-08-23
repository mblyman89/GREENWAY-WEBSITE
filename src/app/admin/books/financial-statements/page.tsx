/**
 * src/app/admin/books/financial-statements/page.tsx   (books-42)
 *
 * THE FINANCIAL STATEMENTS, ON SCREEN — AT LAST.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PAGE IS, AND WHAT IT IS DELIBERATELY NOT
 * ─────────────────────────────────────────────────────────────────────────────
 * `financial-statements-core.ts` has been finished, correct and fully tested
 * since it was written — and completely unreachable. Nothing in `src/app` or
 * `src/components` imported it. Its 132 tests passed every night while Michael
 * could not see a single number it produced. The books-38 gap report named it
 * as the largest gap in the system. This page is the thing that closes it.
 *
 * THIS FILE CONTAINS NO ARITHMETIC AND NO DECISIONS. Every total, every ratio,
 * every tone, every refusal message and every piece of guidance comes from
 * `financial-statements-ui-core.ts`, which is pure and has 105 tests against it.
 * The reason is blunt: `tests/compliance` cannot render a server component, so
 * a rule expressed in JSX is a rule nothing checks. If you find yourself wanting
 * to write `.reduce()` or a ternary about money in this file, it belongs in the
 * UI core instead, where a test can reach it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE PAGE LEADS WITH FOUR CARDS INSTEAD OF FOUR STATEMENTS
 * ─────────────────────────────────────────────────────────────────────────────
 * Only two of the four can honestly be produced today. The cash flow statement
 * needs an operating/investing/financing split that nothing in this system
 * computes yet, and the statement of equity needs three documents that have not
 * been supplied — Form 2553 with the CP261 acceptance letter, the prior year's
 * Schedule M-2 line 8, and Form 7203 for each shareholder.
 *
 * The tempting alternative was to render all four and quietly default the
 * missing facts: everything current, no accumulated E&P, opening AAA of zero.
 * Every one of those defaults produces a statement that looks finished and
 * states something false, and a false balance sheet handed to a lender is a
 * materially different problem from a missing one.
 *
 * So the page opens with a status card per statement, each one leading with the
 * QUESTION that statement answers, and each blocked one naming the exact
 * document that unblocks it. A blocked card is GOLD, not red — waiting on a
 * document is the system working correctly, not a fault.
 */
import Link from "next/link";

import { requireBooksAccess } from "@/lib/accounting/books-access";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { ENTITY_LABELS, isEntityCode } from "@/lib/accounting/ledger-store";
import {
  loadFinancialStatementSource,
  loadFactsOnFile,
  loadNonCurrentAccountCodes,
} from "@/lib/accounting/financial-statements-store";
import {
  buildFsScreen,
  incomeRows,
  incomeRatios,
  balanceRatios,
  refusalCard,
  readingStepsFor,
  trustMoneyHeldCents,
  disallowedSpendCents,
  losingMoneyButStillTaxed,
  STATEMENT_SCOPE_NOTE,
  type FsRatio,
  type FsRow,
  type FsStatementCard,
  type FsTone,
} from "@/lib/accounting/financial-statements-ui-core";
import { formatCents } from "@/lib/accounting/financial-statements-core";
import { validateRange, LINE_IN_THE_SAND } from "@/lib/accounting/books-view-core";
import { RefusalNotice } from "@/components/admin/books/RefusalNotice";
import { BooksToolbar } from "@/components/admin/books/BooksToolbar";
import { StatementsMentor } from "./StatementsMentor";

export const dynamic = "force-dynamic";

/** The house tones, in the house's own CSS variables. */
const TONE_CLS: Record<FsTone, string> = {
  green: "border-[var(--admin-accent)]/30 bg-[var(--admin-accent)]/[0.06]",
  gold: "border-[var(--admin-gold)]/35 bg-[var(--admin-gold)]/[0.06]",
  orange: "border-[var(--admin-orange)]/45 bg-[var(--admin-orange)]/[0.08]",
  danger: "border-red-500/45 bg-red-500/[0.08]",
  neutral: "border-white/10 bg-white/[0.02]",
};

const TONE_TEXT: Record<FsTone, string> = {
  green: "text-[var(--admin-accent)]",
  gold: "text-[var(--admin-gold)]",
  orange: "text-[var(--admin-orange)]",
  danger: "text-red-400",
  neutral: "text-white/60",
};

export default async function FinancialStatementsPage({
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

  const rangeCheck = validateRange(from, to);

  const [source, factsOnFile, nonCurrentAccountCodes] = await Promise.all([
    rangeCheck.ok
      ? loadFinancialStatementSource(entity, from, to)
      : Promise.resolve(null),
    loadFactsOnFile(),
    loadNonCurrentAccountCodes(),
  ]);

  const screen = source
    ? buildFsScreen({
        view: source.view,
        facts: source.facts,
        entityCode: entity,
        fromDate: from,
        toDate: to,
        nonCurrentAccountCodes,
        factsOnFile,
      })
    : null;

  const income = screen?.income ?? null;
  const balance = screen?.balance ?? null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black text-white">Financial statements</h1>
        <p className="mt-1 text-sm text-white/50">
          The four statements, built from your own ledger. {ENTITY_LABELS[entity]}.
        </p>
      </div>

      <BooksToolbar
        basePath="/admin/books/financial-statements"
        entity={entity}
        from={from}
        to={to}
      />

      {/* THE SCOPE NOTE IS NOT SMALL PRINT AND IT IS NOT AT THE BOTTOM.
          A well-formatted page headed "Balance Sheet" gets handed to landlords,
          lenders and insurers as though it were an audited document. Saying so
          once, at the top, in the same size text as everything else, is the
          cheapest protection available. */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <p className="text-sm font-bold text-white">Before you send this to anybody</p>
        <p className="mt-2 text-sm leading-relaxed text-white/70">{STATEMENT_SCOPE_NOTE}</p>
      </div>

      {!rangeCheck.ok ? (
        <div className="rounded-2xl border border-[var(--admin-gold)]/35 bg-[var(--admin-gold)]/[0.06] p-5">
          <p className="text-sm font-bold text-white">That date range won&apos;t work.</p>
          <p className="mt-2 text-sm text-white/70">{rangeCheck.problem}</p>
        </div>
      ) : null}

      {source?.refusal ? <RefusalNotice refusal={source.refusal} /> : null}

      {/* ───────────────────────── THE FOUR CARDS ───────────────────────── */}
      {screen ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {screen.cards.map((c) => (
            <StatementCard key={c.id} card={c} />
          ))}
        </div>
      ) : null}

      {/* ─────────────────── THE ADAPTER REFUSED OUTRIGHT ─────────────────── */}
      {screen && !screen.adapted.ok ? (
        <div className="rounded-2xl border border-[var(--admin-orange)]/45 bg-[var(--admin-orange)]/[0.08] p-5">
          <p className="text-sm font-black text-white">
            {screen.adapted.unmappedAccountCodes.length} account
            {screen.adapted.unmappedAccountCodes.length === 1 ? "" : "s"} on the ledger{" "}
            {screen.adapted.unmappedAccountCodes.length === 1 ? "is" : "are"} not in the chart
            for this entity, so no statement can be built.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-white/75">
            Nothing here knows whether those accounts are cost of goods sold or operating
            expense, and under §280E that distinction is the difference between deductible and
            not. Dropping them would keep the statements balanced while silently omitting money;
            defaulting them to expense would put them below the §280E wall, which is the most
            expensive possible guess. So the statements refuse instead.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-white/75">
            This is usually a mistyped entity code — GRNWY in place of GRWNY — rather than a
            missing account.
          </p>
          <p className="mt-3 font-mono text-xs text-white/60">
            {screen.adapted.unmappedAccountCodes.join(", ")}
          </p>
          <p className="mt-3 text-sm text-white/60">
            <Link
              href={`/admin/books/chart-of-accounts?entity=${entity}`}
              className="underline underline-offset-4"
            >
              Open the chart of accounts
            </Link>{" "}
            to add them, or fix the entity code on the journals.
          </p>
        </div>
      ) : null}

      {/* ─────────────────────── THE INCOME STATEMENT ─────────────────────── */}
      {income && !income.ok
        ? income.refusals.map((r) => <RefusalCardView key={r.code} card={refusalCard(r)} />)
        : null}

      {income?.ok ? (
        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <header className="mb-4">
            <h2 className="text-base font-black text-white">Income statement</h2>
            <p className="mt-1 text-sm text-white/50">
              For the period {income.statement.fromDate} to {income.statement.toDate}. Read it
              from the §280E wall outwards, not from the top down.
            </p>
          </header>

          <table className="w-full text-sm">
            <tbody>
              {incomeRows(income.statement).map((r) => (
                <IncomeRowView key={r.key} row={r} />
              ))}
            </tbody>
          </table>

          {/* THE ONE NUMBER THAT EXISTS ON NO OTHER REPORT IN THE BUILDING. */}
          <div className="mt-5 rounded-xl border border-[var(--admin-orange)]/45 bg-[var(--admin-orange)]/[0.08] p-4">
            <p className="text-sm font-black text-white">
              Spending §280E does not let you deduct:{" "}
              {formatCents(disallowedSpendCents(income.statement))}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-white/75">
              That is real money that left the business this period and reduced your tax bill by
              nothing at all. An ordinary retailer would have deducted every cent of it. This is
              the figure to keep in your head when you look at net income below — and the figure
              to quote when anyone asks why a cannabis shop needs bigger margins than a grocery.
            </p>
          </div>

          {losingMoneyButStillTaxed(income.statement) ? (
            <div className="mt-3 rounded-xl border border-red-500/45 bg-red-500/[0.08] p-4">
              <p className="text-sm font-black text-white">
                The books show a loss this period, and tax is still owed.
              </p>
              <p className="mt-2 text-sm leading-relaxed text-white/75">
                §280E taxes gross income, which is positive, while your operating expenses — which
                are what turned the period into a loss — are denied entirely. This is the single
                cruellest piece of arithmetic in the industry and it is why a cannabis retailer
                cannot read an income statement the way anyone else reads one. Set the cash aside
                anyway.
              </p>
            </div>
          ) : null}

          <RatioPanel title="What these numbers say" ratios={incomeRatios(income.statement)} />
          <ReadingPanel statement="income" />
        </section>
      ) : null}

      {/* ───────────────────────── THE BALANCE SHEET ───────────────────────── */}
      {balance && !balance.ok
        ? balance.refusals.map((r) => <RefusalCardView key={r.code} card={refusalCard(r)} />)
        : null}

      {balance?.ok ? (
        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <header className="mb-4">
            <h2 className="text-base font-black text-white">Balance sheet</h2>
            <p className="mt-1 text-sm text-white/50">
              As of {balance.statement.asOfDate}. An instant, not a period — this is a photograph
              taken at close of business on that one day.
            </p>
          </header>

          <table className="w-full text-sm">
            <tbody>
              {[
                balance.statement.currentAssets,
                balance.statement.nonCurrentAssets,
                balance.statement.currentLiabilities,
                balance.statement.nonCurrentLiabilities,
                balance.statement.equity,
              ].map((section) => (
                <SectionView key={section.key} label={section.label} lines={section.lines} total={section.totalCents} />
              ))}
              <tr className="border-t-2 border-white/25">
                <td className="py-2 font-black text-white">Total liabilities and equity</td>
                <td className="py-2 text-right font-mono font-black text-white">
                  {formatCents(balance.statement.totalLiabilitiesAndEquityCents)}
                </td>
              </tr>
              <tr>
                <td className="py-1 font-black text-white">Total assets</td>
                <td className="py-1 text-right font-mono font-black text-white">
                  {formatCents(balance.statement.totalAssetsCents)}
                </td>
              </tr>
            </tbody>
          </table>

          {/* TRUST MONEY, CALLED OUT SEPARATELY.
              Under RCW 69.50.535(4) the 37% excise is held in trust for the
              state. It sits in current liabilities and it is not yours. */}
          {screen && screen.trustAccountCodes.length > 0 ? (
            <div className="mt-5 rounded-xl border border-[var(--admin-gold)]/35 bg-[var(--admin-gold)]/[0.06] p-4">
              <p className="text-sm font-black text-white">
                Money held in trust, which is not yours:{" "}
                {formatCents(trustMoneyHeldCents(balance.statement, screen.trustAccountCodes))}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-white/75">
                Under RCW 69.50.535(4) the 37% excise you collect belongs to the state from the
                moment the customer pays it. It sits inside current liabilities above, and it is
                sitting in your bank account right now, which is exactly why it gets spent by
                accident. When you read the current ratio below, remember that a chunk of the
                liabilities it counts is money you are merely holding.
              </p>
            </div>
          ) : null}

          {balance.statement.abnormalBalances.length > 0 ? (
            <div className="mt-3 rounded-xl border border-[var(--admin-orange)]/45 bg-[var(--admin-orange)]/[0.08] p-4">
              <p className="text-sm font-black text-white">
                {balance.statement.abnormalBalances.length} account
                {balance.statement.abnormalBalances.length === 1 ? "" : "s"} sitting on the wrong
                side.
              </p>
              <p className="mt-2 text-sm leading-relaxed text-white/75">
                Cash in credit, or inventory negative, is impossible in the real world — so it
                means the books are wrong rather than the business is. Look here before you read
                a single total, because every number on this page is built on these.
              </p>
              <p className="mt-3 font-mono text-xs text-white/60">
                {balance.statement.abnormalBalances.map((a) => `${a.accountCode} ${a.accountName}`).join(", ")}
              </p>
            </div>
          ) : null}

          <RatioPanel title="What these numbers say" ratios={balanceRatios(balance.statement)} />
          <ReadingPanel statement="balance" />
        </section>
      ) : null}

      {/* ───────────────────── THE TEACHING, IN FULL ───────────────────── */}
      <StatementsMentor />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PRESENTATION PIECES. Markup only — every value arrives pre-decided.
// ---------------------------------------------------------------------------

function StatementCard({ card }: { card: FsStatementCard }) {
  return (
    <div className={`rounded-2xl border p-5 ${TONE_CLS[card.tone]}`}>
      <p className="text-sm font-black text-white">{card.title}</p>
      {/* THE QUESTION COMES BEFORE THE STATUS, ON PURPOSE. Michael asked to be
          taught to use these as a tool. A statement you cannot state the
          question for is a piece of paper with numbers on it. */}
      <p className="mt-2 text-sm italic leading-relaxed text-white/70">{card.question}</p>
      <p className={`mt-3 text-xs font-bold uppercase tracking-wide ${TONE_TEXT[card.tone]}`}>
        {card.readiness}
      </p>
      <p className="mt-1 text-sm leading-relaxed text-white/70">{card.status}</p>

      {card.blockers.map((b) => (
        <div key={b.what} className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
          <p className="text-xs font-black text-white">{b.what}</p>
          <p className="mt-1 text-xs leading-relaxed text-white/65">{b.why}</p>
          <p className="mt-1 text-xs leading-relaxed text-white/80">
            <span className="font-bold">Where to get it: </span>
            {b.whereToGetIt}
          </p>
        </div>
      ))}
    </div>
  );
}

function IncomeRowView({ row }: { row: FsRow }) {
  // THE WALL IS A RULE ACROSS THE PAGE, NOT A NUMBER.
  // Everything above it reduces taxable income. Everything below it does not.
  // Drawing it as a line is the entire reason this layout exists.
  if (row.isWall) {
    return (
      <tr>
        <td colSpan={2} className="pt-4 pb-1">
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-[var(--admin-orange)]/60" />
            <span className="text-[11px] font-black uppercase tracking-widest text-[var(--admin-orange)]">
              {row.label}
            </span>
            <div className="h-px flex-1 bg-[var(--admin-orange)]/60" />
          </div>
          <p className="mt-2 text-center text-xs leading-relaxed text-white/50">
            Everything above this line reduces the income you are taxed on. Nothing below it does.
          </p>
        </td>
      </tr>
    );
  }

  return (
    <tr className={row.isSubtotal ? "border-t border-white/15" : ""}>
      <td
        className={`py-1 ${row.isSubtotal ? "font-black text-white" : "text-white/75"}`}
        style={{ paddingLeft: `${row.indent * 16}px` }}
      >
        {row.label}
      </td>
      <td
        className={`py-1 text-right font-mono ${
          row.isSubtotal ? "font-black text-white" : "text-white/75"
        }`}
      >
        {row.amount}
      </td>
    </tr>
  );
}

function SectionView({
  label,
  lines,
  total,
}: {
  label: string;
  lines: readonly { key: string; label: string; amountCents: number; indent: number }[];
  total: number;
}) {
  return (
    <>
      <tr>
        <td colSpan={2} className="pt-4 pb-1 text-xs font-black uppercase tracking-wide text-white/45">
          {label}
        </td>
      </tr>
      {lines.map((l) => (
        <tr key={l.key}>
          <td className="py-1 text-white/75" style={{ paddingLeft: `${(l.indent + 1) * 12}px` }}>
            {l.label}
          </td>
          <td className="py-1 text-right font-mono text-white/75">{formatCents(l.amountCents)}</td>
        </tr>
      ))}
      <tr className="border-t border-white/15">
        <td className="py-1 font-bold text-white">Total {label.toLowerCase()}</td>
        <td className="py-1 text-right font-mono font-bold text-white">{formatCents(total)}</td>
      </tr>
    </>
  );
}

function RatioPanel({ title, ratios }: { title: string; ratios: readonly FsRatio[] }) {
  return (
    <div className="mt-5">
      <h3 className="text-sm font-black text-white">{title}</h3>
      <div className="mt-3 space-y-3">
        {ratios.map((r) => (
          <div key={r.key} className={`rounded-xl border p-4 ${TONE_CLS[r.tone]}`}>
            <div className="flex items-baseline justify-between gap-4">
              <p className="text-sm font-bold text-white">{r.label}</p>
              <p className={`font-mono text-lg font-black ${TONE_TEXT[r.tone]}`}>{r.display}</p>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-white/70">{r.meaning}</p>
            <p className="mt-1 text-sm leading-relaxed text-white/55">
              <span className="font-bold">Good looks like: </span>
              {r.goodLooksLike}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReadingPanel({ statement }: { statement: "income" | "balance" }) {
  const steps = readingStepsFor(statement);
  if (steps.length === 0) return null;

  return (
    <details className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4">
      <summary className="cursor-pointer text-sm font-black text-white">
        How to read this one — {steps.length} step{steps.length === 1 ? "" : "s"}
      </summary>
      <div className="mt-3 space-y-3">
        {steps.map((s) => (
          <div key={s.step}>
            <p className="text-sm font-bold text-white">
              {s.step}. {s.look}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-white/70">{s.ask}</p>
            <p className="mt-1 text-sm leading-relaxed text-white/55">{s.ifItLooksWrong}</p>
          </div>
        ))}
      </div>
    </details>
  );
}

function RefusalCardView({
  card,
}: {
  card: { code: string; headline: string; body: string; whatToDo: string };
}) {
  return (
    <div className="rounded-2xl border border-[var(--admin-gold)]/35 bg-[var(--admin-gold)]/[0.06] p-5">
      <p className="text-sm font-black text-white">{card.headline}</p>
      <p className="mt-2 text-sm leading-relaxed text-white/75">{card.body}</p>
      <p className="mt-2 text-sm leading-relaxed text-white/85">
        <span className="font-bold">What to do: </span>
        {card.whatToDo}
      </p>
      <p className="mt-3 font-mono text-[11px] uppercase tracking-wide text-white/35">
        {card.code}
      </p>
    </div>
  );
}
