/**
 * src/app/admin/books/bank/page.tsx   (slice books-05)
 *
 * BANK MATCHING & RECONCILIATION — owner-only, like every books screen.
 *
 * WHY THIS PAGE EXISTS
 * Michael asked for it in these words (standing rule 1 — record requests
 * verbatim):
 *
 *   "I learn best visually... I have always needed a mentor, a cpa or cfo to
 *    shadow, I want our platform to be that mentor."
 *   "I want verbatim text baked in just the same and the visual explanations
 *    and any other type of hand holding you can give me."
 *   "not just block, but explain why, and even better, show me a way to do it
 *    properly"
 *
 * WHAT MAKES THIS SCREEN DIFFERENT FROM EVERY OTHER ONE IN THE BOOKS
 * Everywhere else, a mistake announces itself: an unbalanced entry will not
 * post, a bill without a vendor will not post. Bank matching is the exception,
 * and it is the exception in the two worst possible ways:
 *
 *   1. A BACKWARDS MATCH STILL BALANCES. Flip the sign and both lines flip
 *      together. Debits still equal credits. Nothing turns red. The only
 *      symptom is a wrong tax return.
 *
 *   2. "IT TIES" IS NOT "IT IS FINISHED". A bank fee that never reached the
 *      books is already inside the bank's closing balance, so when the
 *      reconciliation brings it over to compare like with like it CANCELS
 *      ITSELF OUT. The difference comes to zero while the expense is missing
 *      from the P&L entirely.
 *
 * Neither of those can be taught with an error message, because in both cases
 * there is no error. They have to be drawn. That is what the explainer panels
 * on this page do, and it is why this page leads with teaching rather than a
 * form.
 *
 * WHY EVERY NUMBER HERE IS COMPUTED, NOT TYPED
 * A diagram that drifts away from the engine is worse than no diagram: it
 * teaches the wrong thing, confidently, forever. The only hard-coded values on
 * this page are the INPUTS to the worked example. Every figure downstream of
 * them comes out of `bank-match-core.ts` — the same functions that run at
 * posting time. Change a rule and the illustration re-computes, or a test
 * fails. Likewise the verbatim quotations are read from `BANK_AUTHORITIES`
 * rather than retyped here, because two copies of a federal regulation in one
 * codebase is how one of them quietly becomes wrong.
 *
 * THE GATE
 * `requireBooksAccess()` — `is_owner()` in application form. Michael was
 * explicit: "there is no reason anyone else needs to see my books or my
 * financials ever". It is deliberately not the only protection: the posting
 * functions in migration 0189 are `security definer` and re-check ownership
 * themselves, so the books stay shut even if this page were mis-gated. A screen
 * can be bypassed; a constraint cannot.
 */

import Link from "next/link";

import { requireBooksAccess } from "@/lib/accounting/books-access";
import {
  BANK_AUTHORITIES,
  findBankAuthority,
  buildLoanPaymentLines,
  plaidToLedgerCashCents,
  formatCents,
  formatSignedCents,
  MATCH_WINDOW_DAYS,
  MATCH_WINDOW_HARD_DAYS,
  CTR_THRESHOLD_CENTS,
  STRUCTURING_NEAR_MISS_CENTS,
  LINE_IN_THE_SAND,
} from "@/lib/accounting/bank-match-core";
import {
  SignWall,
  TiesIsNotDone,
  RefusalSandbox,
  EventKindMap,
} from "./BankMatchExplainer";

export const dynamic = "force-dynamic";

/**
 * The authorities to put in front of Michael first, in teaching order:
 * what an examiner is actually doing when he looks at your bank, the trap that
 * turns your own money into phantom income, the sentence that says an
 * unrecorded item must be posted, the sentence a plug pretends to satisfy, and
 * the case that saves the building and the ATM.
 *
 * Ids only. The text itself lives in the engine, once.
 */
const HEADLINE_AUTHORITY_IDS = [
  "IRM_BANK_ANALYSIS_PURPOSE",
  "IRM_TRANSFERS_IN",
  "BARS_UNRECORDED_ITEMS",
  "BARS_NO_FURTHER_DIFFERENCES",
  "CHAMP_SEPARATE_BUSINESS",
  "IRM_MISSTATEMENT_STAKES",
] as const;

/**
 * A WORKED EXAMPLE, COMPUTED BY THE ENGINE ITSELF.
 *
 * One mortgage payment on the building, run twice — once through the
 * landholding company (where it actually belongs) and once as if it had been
 * paid out of the store. Same payment, same split, same three lines. The ONLY
 * thing that changes is the entity, and the difference is the deduction.
 *
 * This is the clearest demonstration of CHAMP that can be put on a screen, and
 * the numbers are not chosen to flatter: a $1,847.00 payment split
 * $1,203.00 / $498.00 / $146.00 is an ordinary commercial mortgage payment.
 *
 * The split figures are inputs because they come off the servicer's statement —
 * nothing can compute them. Everything else, including which cost class each
 * line carries and therefore whether the interest is deductible, is decided by
 * `buildLoanPaymentLines()`.
 *
 * Computed once at module scope: the inputs are constants, so re-deriving this
 * on every request would be waste.
 */
const EXAMPLE_PAYMENT_CENTS = 184_700; // Plaid convention: positive = money OUT
const EXAMPLE_SPLIT = {
  interestCents: 120_300,
  principalCents: 49_800,
  escrowCents: 14_600,
};

const LANDHOLDING_LINES = buildLoanPaymentLines({
  bankAmountCents: EXAMPLE_PAYMENT_CENTS,
  entityCode: "landholding",
  cashAccountCode: "10200",
  loanLiabilityAccountCode: "34000",
  interestExpenseAccountCode: "85010",
  escrowAssetAccountCode: "12200",
  split: EXAMPLE_SPLIT,
});

const GREENWAY_LINES = buildLoanPaymentLines({
  bankAmountCents: EXAMPLE_PAYMENT_CENTS,
  entityCode: "greenway",
  cashAccountCode: "10200",
  loanLiabilityAccountCode: "34000",
  interestExpenseAccountCode: "85010",
  escrowAssetAccountCode: "12200",
  split: EXAMPLE_SPLIT,
});

/**
 * The naive treatment, for contrast: code the whole payment to an expense.
 *
 * Deliberately NOT computed by the engine, because the engine will not produce
 * it — that is the point. It is what a well-meaning person does when a $1,847
 * debit shows up in the feed and "mortgage" sounds like an expense.
 */
const NAIVE_OVERSTATEMENT_CENTS =
  EXAMPLE_PAYMENT_CENTS - EXAMPLE_SPLIT.interestCents;

/** Proof, on the page, that the three debits and the credit come to zero. */
const LANDHOLDING_BALANCE = LANDHOLDING_LINES.reduce(
  (sum, l) => sum + l.amountCents,
  0,
);

const COST_CLASS_PLAIN: Record<string, string> = {
  nondeductible_280e: "real expense, deduction denied by §280E",
  separate_business: "deductible in full — separate business under CHAMP",
  cogs_direct: "inventory cost",
  cogs_allocable: "inventory cost (allocable)",
  personal: "personal — not the company's",
  none: "not an expense at all",
};

export default async function BankBooksPage() {
  await requireBooksAccess();

  const headline = HEADLINE_AUTHORITY_IDS.map((id) => findBankAuthority(id)).filter(
    (a): a is NonNullable<typeof a> => a !== undefined,
  );

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-white">Bank matching &amp; reconciliation</h1>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/50">
            owner only
          </span>
        </div>
        <p className="max-w-3xl text-sm text-white/55">
          This is the screen where money leaving your bank becomes an entry in your
          books. It is also the only place in the system where a mistake can balance
          perfectly and still be wrong, so it is the one worth understanding properly
          before you touch it.
        </p>
      </header>

      {/* ── THE STRAIGHT ANSWER, FIRST ─────────────────────────────────────── */}
      <section className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.05] p-5">
        <h2 className="text-sm font-semibold text-amber-300">
          The two things that can go wrong silently
        </h2>
        <div className="mt-2 max-w-3xl space-y-3 text-sm leading-relaxed text-white/70">
          <p>
            <strong className="text-white/90">
              First: a backwards match still balances.
            </strong>{" "}
            Your bank feed and your ledger use exactly opposite signs for the same
            event. If that crossing is made in the wrong direction, both lines of the
            entry flip together — debits still equal credits, nothing turns red, no
            report complains. The books look immaculate and the tax return is wrong.
            This already happened once in the old books; it is in your history as{" "}
            <em>backwards card signs</em>.
          </p>
          <p>
            <strong className="text-white/90">
              Second: &ldquo;it ties&rdquo; is not the same as &ldquo;it is
              finished&rdquo;.
            </strong>{" "}
            Suppose the bank took a $77 service charge and your books never heard of
            it. That fee is <em>already inside</em> the closing balance the bank sent
            you. When the reconciliation brings it across to compare like with like, it{" "}
            <strong className="text-white/90">cancels itself out</strong> — so the
            difference comes to exactly zero while the expense is missing from your
            profit and loss entirely. A reconciliation that congratulates you here is
            worse than one that fails, because you would stop looking.
          </p>
          <p className="rounded-lg border border-emerald-400/25 bg-emerald-400/[0.06] p-3 text-white/80">
            <strong className="text-emerald-300">What the system does about it.</strong>{" "}
            Exactly one function in this entire codebase is allowed to convert a bank
            amount into a ledger amount, and the database independently refuses any
            bank entry whose cash line disagrees with it. And this screen asks{" "}
            <em>two separate questions</em> — &ldquo;does the arithmetic close?&rdquo;
            and &ldquo;is the month finished?&rdquo; — and will not let you sign off on
            the first one alone.
          </p>
        </div>
      </section>

      {/* ── THE SIGN WALL ──────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <div className="mb-4 max-w-3xl space-y-1">
          <h2 className="text-sm font-semibold text-white/85">
            Which way does the money go?
          </h2>
          <p className="text-xs leading-relaxed text-white/45">
            Drag the slider and watch the two sides disagree on purpose. Nothing here is
            illustrative — the ledger figure is produced by{" "}
            <code className="text-white/60">plaidToLedgerCashCents()</code>, the single
            sanctioned crossing between the two conventions. If this picture is ever
            wrong, the posting engine is wrong in exactly the same way.
          </p>
        </div>
        <SignWall />
      </section>

      {/* ── TIES vs COMPLETE ───────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <div className="mb-4 max-w-3xl space-y-1">
          <h2 className="text-sm font-semibold text-white/85">
            Watch a perfect reconciliation hide a missing expense
          </h2>
          <p className="text-xs leading-relaxed text-white/45">
            Press the button and watch the difference stay at zero either way. This is
            not a simulation of the bug — it is{" "}
            <code className="text-white/60">reconcile()</code>, the real function,
            running on a real unrecorded fee. Two different questions, asked separately,
            because they have two different answers.
          </p>
        </div>
        <TiesIsNotDone />
      </section>

      {/* ── THE WORKED EXAMPLE: ONE PAYMENT, TWO ENTITIES ──────────────────── */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <div className="mb-4 max-w-3xl space-y-1">
          <h2 className="text-sm font-semibold text-white/85">
            One mortgage payment, worth {formatCents(EXAMPLE_SPLIT.interestCents)} more
            in the right company
          </h2>
          <p className="text-xs leading-relaxed text-white/45">
            A {formatCents(EXAMPLE_PAYMENT_CENTS)} payment leaves the bank. It looks like
            one number and it is really three, and which company pays it decides whether
            the interest is deductible at all. Both tables below come out of{" "}
            <code className="text-white/60">buildLoanPaymentLines()</code> — the same
            function that will post your real payments.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* The right way */}
          <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/[0.05] p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
              Paid by the landholding company
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-white/50">
              Renting real estate is not trafficking in anything, so §280E does not
              reach it.
            </p>
            <table className="mt-3 w-full text-left text-xs">
              <thead className="text-white/40">
                <tr className="border-b border-white/10">
                  <th className="pb-2 pr-3 font-medium">Account</th>
                  <th className="pb-2 pr-3 text-right font-medium">Amount</th>
                  <th className="pb-2 font-medium">What it is</th>
                </tr>
              </thead>
              <tbody className="text-white/70">
                {LANDHOLDING_LINES.map((l) => (
                  <tr key={l.accountCode} className="border-b border-white/5 last:border-0">
                    <td className="py-2 pr-3 font-mono">{l.accountCode}</td>
                    <td className="py-2 pr-3 text-right font-mono">
                      {formatSignedCents(l.amountCents)}
                    </td>
                    <td className="py-2 text-white/50">
                      {COST_CLASS_PLAIN[l.costClass] ?? l.costClass}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-white/45">
              Three debits and one credit, summing to{" "}
              <span className="font-mono text-white/70">
                {formatCents(LANDHOLDING_BALANCE)}
              </span>
              . The interest is deductible in full under §163(a).
            </p>
          </div>

          {/* The same payment, wrong company */}
          <div className="rounded-xl border border-rose-400/25 bg-rose-400/[0.05] p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-rose-300">
              The same payment, paid by the store
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-white/50">
              Identical money, identical split. The store is the trafficking business, so
              the deduction is denied.
            </p>
            <table className="mt-3 w-full text-left text-xs">
              <thead className="text-white/40">
                <tr className="border-b border-white/10">
                  <th className="pb-2 pr-3 font-medium">Account</th>
                  <th className="pb-2 pr-3 text-right font-medium">Amount</th>
                  <th className="pb-2 font-medium">What it is</th>
                </tr>
              </thead>
              <tbody className="text-white/70">
                {GREENWAY_LINES.map((l) => (
                  <tr key={l.accountCode} className="border-b border-white/5 last:border-0">
                    <td className="py-2 pr-3 font-mono">{l.accountCode}</td>
                    <td className="py-2 pr-3 text-right font-mono">
                      {formatSignedCents(l.amountCents)}
                    </td>
                    <td className="py-2 text-white/50">
                      {COST_CLASS_PLAIN[l.costClass] ?? l.costClass}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-white/45">
              Same three lines, same balance. Only the label on the interest changed —
              and that label is worth {formatCents(EXAMPLE_SPLIT.interestCents)} of
              deduction a month.
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-black/25 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-white/60">
            And what happens if you just call the whole thing an expense
          </h3>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-white/50">
            This is the honest mistake: {formatCents(EXAMPLE_PAYMENT_CENTS)} leaves the
            bank, the word &ldquo;mortgage&rdquo; sounds like an expense, and the whole
            amount gets coded to one account. It balances. It is also{" "}
            <strong className="text-white/80">
              {formatCents(NAIVE_OVERSTATEMENT_CENTS)}
            </strong>{" "}
            of deduction you are not entitled to — every month — because principal is not
            an expense (it just reduces what you owe) and escrow is not an expense (it is
            still your money, sitting with the servicer). Over a year that is{" "}
            {formatCents(NAIVE_OVERSTATEMENT_CENTS * 12)} of overstated deductions and the
            same amount of understated equity. The engine will not build that entry.
          </p>
        </div>
      </section>

      {/* ── EVERY REFUSAL, WITH THE REASON ─────────────────────────────────── */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <div className="mb-4 max-w-3xl space-y-1">
          <h2 className="text-sm font-semibold text-white/85">
            Every way this screen will push back
          </h2>
          <p className="text-xs leading-relaxed text-white/45">
            Michael asked for push-back that helps rather than push-back that just says
            no. Each of these is a real check running on deliberately broken input, so
            the first time you meet a given block is here — with the reason and the fix
            beside it — and not on a live entry late at night.
          </p>
        </div>
        <RefusalSandbox />
      </section>

      {/* ── THE EVENT MAP ──────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <div className="mb-4 max-w-3xl space-y-1">
          <h2 className="text-sm font-semibold text-white/85">
            What kind of event is this?
          </h2>
          <p className="text-xs leading-relaxed text-white/45">
            This one field decides whether a dollar becomes income, an expense, a
            transfer, or nothing at all. Two of them are the classic silent errors and
            are called out rather than left in the list to be discovered the hard way.
          </p>
        </div>
        <EventKindMap />
      </section>

      {/* ── THE NUMBERS THE ENGINE ACTUALLY USES ───────────────────────────── */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="text-sm font-semibold text-white/85">
          The thresholds, so nothing is a surprise
        </h2>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-white/45">
          These are read from the engine, not typed here, so this table cannot fall out
          of step with what the software actually does.
        </p>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <dt className="text-xs uppercase tracking-wide text-white/40">
              Confident date window
            </dt>
            <dd className="mt-1 text-sm text-white/70">
              <strong className="text-white/90">{MATCH_WINDOW_DAYS} days</strong> between
              the entry and the bank date. Cards settle over a weekend; this is normal
              banking, not an error.
            </dd>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <dt className="text-xs uppercase tracking-wide text-white/40">
              Refused beyond
            </dt>
            <dd className="mt-1 text-sm text-white/70">
              <strong className="text-white/90">{MATCH_WINDOW_HARD_DAYS} days</strong>.
              Past a month apart, &ldquo;probably the same event&rdquo; becomes &ldquo;two
              events that happen to share a number&rdquo;.
            </dd>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <dt className="text-xs uppercase tracking-wide text-white/40">
              Currency report threshold
            </dt>
            <dd className="mt-1 text-sm text-white/70">
              <strong className="text-white/90">{formatCents(CTR_THRESHOLD_CENTS)}</strong>{" "}
              in cash. Your bank files the report, not you. A deposit over this is
              perfectly lawful and completely routine for a cash business.
            </dd>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <dt className="text-xs uppercase tracking-wide text-white/40">
              Pattern worth a look
            </dt>
            <dd className="mt-1 text-sm text-white/70">
              Repeated deposits within{" "}
              <strong className="text-white/90">
                {formatCents(STRUCTURING_NEAR_MISS_CENTS)}
              </strong>{" "}
              below that threshold. The system shows you the pattern and never calls it
              structuring — because the offence is the <em>purpose</em>, and only you know
              that.
            </dd>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <dt className="text-xs uppercase tracking-wide text-white/40">
              Nothing posts before
            </dt>
            <dd className="mt-1 text-sm text-white/70">
              <strong className="text-white/90">{LINE_IN_THE_SAND}</strong>. The line in
              the sand. Backdating into a closed year is refused by the database itself,
              not merely by this screen.
            </dd>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <dt className="text-xs uppercase tracking-wide text-white/40">
              One crossing, one function
            </dt>
            <dd className="mt-1 text-sm text-white/70">
              A {formatCents(25_000)} payment out of the bank always becomes{" "}
              <strong className="font-mono text-white/90">
                {formatSignedCents(plaidToLedgerCashCents(25_000))}
              </strong>{" "}
              on the cash line. Computed live, right now, by the posting engine.
            </dd>
          </div>
        </dl>
      </section>

      {/* ── THE AUTHORITIES, VERBATIM ──────────────────────────────────────── */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <div className="mb-4 max-w-3xl space-y-1">
          <h2 className="text-sm font-semibold text-white/85">
            The actual words, not my summary of them
          </h2>
          <p className="text-xs leading-relaxed text-white/45">
            Michael asked for &ldquo;verbatim text with regard to policy regulation tax
            GAAP&rdquo;. These are transcribed exactly from the primary sources and
            verified 2026-08-17. The quotation is theirs; the plain-English note beneath
            each one is mine, and the two are kept visibly apart on purpose.
          </p>
        </div>

        <div className="space-y-4">
          {headline.map((a) => (
            <figure
              key={a.id}
              className="rounded-xl border border-white/10 bg-black/20 p-4"
            >
              <figcaption className="text-xs font-semibold text-amber-300">
                {a.cite}
              </figcaption>
              <blockquote className="mt-2 border-l-2 border-amber-400/40 pl-3 text-sm italic leading-relaxed text-white/75">
                &ldquo;{a.quote}&rdquo;
              </blockquote>
              <p className="mt-3 text-xs leading-relaxed text-white/50">
                <span className="font-semibold text-white/70">In plain English: </span>
                {a.soWhat}
              </p>
              <p className="mt-2 font-mono text-[10px] leading-relaxed text-white/30">
                {a.source}
              </p>
            </figure>
          ))}
        </div>

        <p className="mt-4 max-w-3xl text-xs leading-relaxed text-white/45">
          {BANK_AUTHORITIES.length} authorities sit behind this screen in total; the{" "}
          {headline.length} above are the ones worth reading first. The rest are cited by
          name on the individual refusals, so whenever the system blocks something you can
          see precisely which sentence it is relying on.
        </p>
      </section>

      {/* ── THE HABIT ──────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.04] p-5">
        <h2 className="text-sm font-semibold text-emerald-300">
          What good looks like, once a month
        </h2>
        <div className="mt-2 max-w-3xl space-y-3 text-sm leading-relaxed text-white/70">
          <p>
            Match what you can, label what you cannot, post an entry for every settled
            bank line the books have never seen, and then look at the two questions at the
            top of the reconciliation. If the arithmetic closes{" "}
            <em>and</em> nothing is left unrecorded, the month is done and the system will
            let you sign it off. If only the first one is true, the month is not done, and
            no amount of staring at a zero will change that.
          </p>
          <p>
            When something will not tie, the answer is never to write a number into an
            account until it does. That has a name here — a plug — and there is a{" "}
            {formatCents(462_469_731)} one in the old books to prove how far it can go
            before anybody notices. Find the missing line instead. It is always a missing
            line.
          </p>
        </div>
      </section>

      {/*
        Route verification (standing rule: never guess a link).
        Each of these was confirmed to exist by walking the tree on 2026-08-18:
          src/app/admin/books/journal/page.tsx
          src/app/admin/books/bills/page.tsx
          src/app/admin/books/payroll/page.tsx
          src/app/admin/books/accounts/page.tsx
          src/app/admin/plaid/page.tsx
        A dead link on a teaching page is worse than no link: it teaches that the
        system is unreliable. tests/compliance/admin-dead-links.test.ts enforces
        this repo-wide.
      */}
      <nav className="flex flex-wrap gap-3 text-sm">
        <Link
          href="/admin/books/journal"
          className="rounded-lg border border-white/15 px-3 py-1.5 text-white/70 transition hover:bg-white/5"
        >
          General journal
        </Link>
        <Link
          href="/admin/books/bills"
          className="rounded-lg border border-white/15 px-3 py-1.5 text-white/70 transition hover:bg-white/5"
        >
          Bills &amp; 280E
        </Link>
        <Link
          href="/admin/books/payroll"
          className="rounded-lg border border-white/15 px-3 py-1.5 text-white/70 transition hover:bg-white/5"
        >
          Payroll &amp; 280E
        </Link>
        <Link
          href="/admin/books/accounts"
          className="rounded-lg border border-white/15 px-3 py-1.5 text-white/70 transition hover:bg-white/5"
        >
          Chart of accounts
        </Link>
        <Link
          href="/admin/plaid"
          className="rounded-lg border border-white/15 px-3 py-1.5 text-white/70 transition hover:bg-white/5"
        >
          Bank connections
        </Link>
      </nav>
    </div>
  );
}
