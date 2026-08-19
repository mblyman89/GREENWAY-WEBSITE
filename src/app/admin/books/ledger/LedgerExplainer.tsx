/**
 * src/app/admin/books/ledger/LedgerExplainer.tsx   (slice books-08)
 *
 * HOW TO READ A GENERAL LEDGER LIKE SOMEBODY WHO IS LOOKING FOR TROUBLE.
 *
 * Michael, recorded verbatim (standing rule 1):
 *   "For this slice, please pay extra close attention to the general ledger."
 *   "I need the system needs to be able to teach and guide me and hold my hand."
 *   "I have always needed a mentor, a cpa or cfo to shadow."
 *
 * ---------------------------------------------------------------------------
 * WHY THE LEDGER IS THE PAGE THAT DESERVED THE MOST CARE
 * ---------------------------------------------------------------------------
 * Every other screen in the books SUMMARISES. The trial balance shows totals.
 * The financial statements show totals of totals. This is the only report in
 * the system that shows TRANSACTIONS — and there is a whole class of failure
 * that is invisible in any summary and obvious here:
 *
 *   - A pair of backwards entries nets to zero in a monthly total. In the
 *     ledger they are two rows pointing the wrong way.
 *   - An account can go negative in the middle of a month and recover by the
 *     31st. No summary anywhere will ever show it.
 *   - The $4,624,697.31 plug had a memo nobody would write on purpose. Only
 *     the ledger shows memos.
 *
 * So this page does not explain what a ledger is. It teaches the SCAN — the
 * specific things a CPA looks for, in the order they look for them, and what
 * goes wrong when each step is skipped.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS SLICE FOUND, WHICH IS ALSO LESSON ONE
 * ---------------------------------------------------------------------------
 * While writing this page it turned out the Balance column was wrong. The
 * running balance was computed only over the rows inside the chosen date range,
 * and the page's default range started 1 January 2026 — while the opening
 * balances are dated 31 December 2025, because that is the only date the schema
 * allows them. So the column headed "Balance" was showing a month's activity
 * with the opening balance thrown away.
 *
 * Executed against a real PostgreSQL, not reasoned about: $4,000 of opening
 * cash and a $3,000 payment displayed as NEGATIVE $3,000.00 instead of POSITIVE
 * $1,000.00. That is Michael's own "negative ATM cash" disaster, manufactured by
 * our own report on correct books.
 *
 * It is fixed (balance forward), and the fix became step 1 of the lesson,
 * because "check the window before you trust the balance" is a real thing that
 * really happened here rather than a textbook warning.
 *
 * ---------------------------------------------------------------------------
 * ARCHITECTURE
 * ---------------------------------------------------------------------------
 * Every word of substance below is DATA exported from
 * books-ledger-guidance-core.ts. This file only lays it out. A diagram that
 * drifts from the engine is worse than no diagram: it teaches the wrong thing
 * with confidence.
 */

import {
  LEDGER_READING_STEPS,
  ACCOUNT_CHOICE_CONSEQUENCES,
  LEDGER_SEVERITY_MEANING,
  natureOf,
  type LedgerFinding,
  type LedgerSeverity,
} from "@/lib/accounting/books-ledger-guidance-core";
import type { AccountType } from "@/lib/accounting/ledger-core";
import { formatCents } from "@/lib/accounting/books-view-core";
import {
  AuthorityPanel,
  InlineAuthority,
} from "@/components/admin/books/AuthorityPanel";

const CARD = "rounded-2xl border border-white/10 bg-white/[0.02] p-5";
const H2 = "text-sm font-semibold text-white/85";
const P = "text-sm leading-relaxed text-white/70";
const MUTED = "text-xs leading-relaxed text-white/45";

/** Derived, never hand-listed, so a new citation cannot go missing from the panel. */
const LEDGER_AUTHORITY_IDS: readonly string[] = Array.from(
  new Set([
    ...LEDGER_READING_STEPS.flatMap((s) => s.authorityIds),
    ...ACCOUNT_CHOICE_CONSEQUENCES.flatMap((c) => c.authorityIds),
  ]),
);

const SEVERITY_STYLE: Record<LedgerSeverity, { ring: string; chip: string; label: string }> = {
  stop: {
    ring: "border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/[0.07]",
    chip: "bg-[var(--admin-orange)]/20 text-[var(--admin-orange)]",
    label: "stop and look",
  },
  check: {
    ring: "border-[var(--admin-gold)]/35 bg-[var(--admin-gold)]/[0.05]",
    chip: "bg-[var(--admin-gold)]/20 text-[var(--admin-gold)]",
    label: "check it",
  },
  look: {
    ring: "border-white/10 bg-white/[0.02]",
    chip: "bg-white/10 text-white/60",
    label: "worth a glance",
  },
};

// ===========================================================================
// THE FINDINGS PANEL — shown above the table when the scan has something to say
// ===========================================================================

/**
 * WHAT THE SCAN FOUND, IN PLAIN ENGLISH, WITH THE NEXT ACTION ATTACHED.
 *
 * This panel is the one genuinely NEW capability in the slice. Until now the
 * trial balance could tell Michael "3 accounts are abnormal" and nothing in the
 * system could tell him WHICH LINE did it. Totals cannot answer that question;
 * only this report can.
 *
 * It advises and never blocks. The hard refusals live in the posting service,
 * where a bad entry can still be stopped before it exists. By the time a line
 * is on this screen it is already posted, and shouting at somebody about a
 * thing they cannot un-do is not mentoring.
 */
export function LedgerFindings({
  findings,
  summary,
}: {
  findings: readonly LedgerFinding[];
  summary: { tone: "clean" | "notice" | "warning"; headline: string };
}) {
  if (findings.length === 0) {
    return (
      <section className={`${CARD} border-white/10`}>
        <h2 className={H2}>Nothing on this ledger is sitting on the wrong side</h2>
        <p className={`${P} mt-2`}>{summary.headline}</p>
        <p className={`${MUTED} mt-3`}>
          That last sentence is the important one and it is not modesty. This check
          reads what IS here and asks whether it makes sense. A sale you never wrote
          down is not faint on this report &mdash; it is absent, and its absence leaves
          out a debit <em>and</em> a credit, so the books still balance perfectly.
          Completeness is settled by comparing to something outside the books:
          the bank statement, the cash count, the CCRS report{" "}
          <InlineAuthority id="AS_1105_11_COMPLETENESS" />.
        </p>
      </section>
    );
  }

  return (
    <section
      className={`rounded-2xl border p-5 ${
        summary.tone === "warning"
          ? "border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/[0.06]"
          : "border-[var(--admin-gold)]/35 bg-[var(--admin-gold)]/[0.05]"
      }`}
    >
      <h2 className={H2}>What stands out on this ledger</h2>
      <p className={`${P} mt-2`}>{summary.headline}</p>

      <ul className="mt-4 space-y-3">
        {findings.map((f, i) => {
          const style = SEVERITY_STYLE[f.severity];
          return (
            <li key={`${f.code}-${f.accountCode}-${f.journalNo ?? i}`} className={`rounded-xl border p-4 ${style.ring}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${style.chip}`}>
                  {style.label}
                </span>
                <span className="text-sm font-semibold text-white/90">
                  {f.accountCode} {f.accountName}
                </span>
                {f.journalDate ? (
                  <span className="text-xs tabular-nums text-white/40">
                    entry {f.journalNo} &middot; {f.journalDate}
                  </span>
                ) : null}
                <span className="text-xs tabular-nums text-white/55">{formatCents(f.balanceCents)}</span>
              </div>

              <p className={`${P} mt-2`}>{f.headline}</p>

              <p className={`${P} mt-2`}>
                <span className="font-semibold text-white/85">What to do:</span> {f.whatToDo}
              </p>

              {f.authorityIds.length > 0 ? (
                <p className={`${MUTED} mt-2`}>
                  {f.authorityIds.map((id, n) => (
                    <span key={id}>
                      {n > 0 ? " " : ""}
                      <InlineAuthority id={id} />
                    </span>
                  ))}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <p className={`${MUTED} mt-4`}>
        None of these is an accusation and none of them blocks anything &mdash; every
        line here is already posted. They are questions you should be able to answer,
        and the answer is nearly always &ldquo;yes, because &hellip;&rdquo;. Writing that
        because into the memo today is what makes the question go away permanently.
        {" "}
        <span className="text-white/55">
          {LEDGER_SEVERITY_MEANING.stop}
        </span>
      </p>
    </section>
  );
}

// ===========================================================================
// THE LESSON
// ===========================================================================

/** The seven-step scan, in order, because the order IS the teaching. */
export function HowToReadALedger() {
  return (
    <section className={CARD}>
      <h2 className={H2}>How to read this page like someone looking for trouble</h2>
      <p className={`${P} mt-2`}>
        This is the only report in the books that shows individual transactions.
        Everything else &mdash; the trial balance, the financial statements &mdash;
        shows totals, and there is a whole family of mistakes that totals cannot
        see. Two backwards entries cancel out in a monthly figure. An account can
        go negative on the 12th and recover by the 31st. A plug looks exactly like
        every other number once it has been added up. All three are plainly visible
        here and nowhere else.
      </p>
      <p className={`${P} mt-2`}>
        So it is worth learning the scan. It takes about a minute once you know the
        order, and the order matters more than the speed.
      </p>

      <ol className="mt-4 space-y-4">
        {LEDGER_READING_STEPS.map((s) => (
          <li key={s.step} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-baseline gap-3">
              <span className="text-xs font-black tabular-nums text-[var(--admin-accent)]">
                {s.step}
              </span>
              <p className="text-sm font-semibold text-white/90">{s.action}</p>
            </div>
            <p className={`${P} mt-2`}>{s.why}</p>
            <p className={`${MUTED} mt-2`}>
              <span className="font-semibold text-white/60">Skip it and:</span> {s.ifSkipped}
            </p>
            {s.authorityIds.length > 0 ? (
              <p className={`${MUTED} mt-2`}>
                {s.authorityIds.map((id, n) => (
                  <span key={id}>
                    {n > 0 ? " " : ""}
                    <InlineAuthority id={id} />
                  </span>
                ))}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * WHAT "BALANCE FORWARD" MEANS AND WHY IT APPEARED.
 *
 * Told honestly, including that our own screen had it wrong. Michael's standing
 * instruction is that drift is catastrophic and that he wants to be taught, not
 * managed. A system that quietly fixes its own mistakes teaches nothing; a
 * system that says "here is what was wrong, here is how you would spot it" turns
 * a defect into the most memorable lesson on the page.
 */
export function AboutBalanceForward() {
  return (
    <section className={CARD}>
      <h2 className={H2}>Why the first line says &ldquo;Balance forward&rdquo;</h2>
      <p className={`${P} mt-2`}>
        A ledger only ever shows you a window &mdash; the dates in the toolbar above.
        But an account does not start over when a window starts. Whatever it held
        going in has to be carried in, or the first number you read is not a balance
        at all, it is a subtotal of one period wearing a balance&rsquo;s clothes.
        That carried-in figure is the balance forward, and every general ledger
        package ever written has printed it at the top of the page.
      </p>
      <p className={`${P} mt-2`}>
        It is worth knowing that this screen did not always have one, because the
        failure is a perfect example of what step 1 is protecting you from. Your
        opening balances are dated 31 December 2025 &mdash; the schema requires that,
        since it is the only date allowed before the line in the sand. This page used
        to default its window to 1 January 2026, so it excluded them, every time.
      </p>
      <p className={`${P} mt-2`}>
        The effect was not subtle. Tested with $4,000.00 of opening cash and a
        $3,000.00 payment in March, the Balance column read{" "}
        <span className="font-semibold text-[var(--admin-orange)]">
          ({formatCents(300_000)})
        </span>{" "}
        when the business actually held{" "}
        <span className="font-semibold text-white/90">{formatCents(100_000)}</span>.
        Correct books, correct entries, and a screen reporting negative cash &mdash;
        which is one of the exact failures we are trying to teach you to catch.
      </p>
      <p className={`${MUTED} mt-3`}>
        Fixed by folding everything before the window into that one opening figure,
        so the running balance is a real balance on every row while the period view
        still shows only the period. If you ever see an account here whose first row
        has no balance forward and you know it existed last year, that is worth
        asking about.
      </p>
    </section>
  );
}

/**
 * PERMANENT vs TEMPORARY.
 *
 * The single idea that explains why two accounts on the same screen carry
 * different amounts of history. Rendered from the engine's own classification
 * (`natureOf`) rather than a hand-written list, so the page cannot teach one
 * rule while the arithmetic follows another.
 */
export function AboutPermanentAndTemporary() {
  // DERIVED FROM THE ENGINE, NOT RETYPED.
  //
  // These two lists are produced by asking `natureOf()` — the same function the
  // fold uses to decide how far back to carry a balance. If the classification
  // ever changes, this teaching card changes with it automatically. A diagram
  // that drifts from the engine is worse than no diagram: it teaches the wrong
  // thing with confidence.
  const ALL_TYPES: readonly AccountType[] = [
    "asset",
    "liability",
    "equity",
    "income",
    "cogs",
    "expense",
    "other_income",
    "other_expense",
  ];
  const permanent = ALL_TYPES.filter((t) => natureOf(t) === "permanent");
  const temporary = ALL_TYPES.filter((t) => natureOf(t) === "temporary");
  const LABEL: Record<string, string> = {
    asset: "Assets \u2014 cash, inventory, equipment",
    liability: "Liabilities \u2014 what you owe",
    equity: "Equity \u2014 your stake and accumulated profit",
    income: "Income \u2014 sales",
    cogs: "Cost of goods sold",
    expense: "Operating expenses",
    other_income: "Other income",
    other_expense: "Other expenses",
  };

  return (
    <section className={CARD}>
      <h2 className={H2}>
        Why some accounts remember forever and others start over each year
      </h2>
      <p className={`${P} mt-2`}>
        Accounts come in two kinds, and the difference is not bookkeeping trivia
        &mdash; it changes what the number on this screen means.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-xs font-black uppercase tracking-wide text-[var(--admin-accent)]">
            Permanent &mdash; they remember everything
          </p>
          <ul className="mt-2 space-y-1">
            {permanent.map((t) => (
              <li key={t} className="text-sm text-white/70">
                {LABEL[t]}
              </li>
            ))}
          </ul>
          <p className={`${MUTED} mt-3`}>
            The cash in your vault today is every dollar that ever came in, minus
            every dollar that ever went out, going all the way back to the
            cut-over. It does not reset because the calendar turned over. So on
            these accounts the balance forward reaches back to the beginning.
          </p>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-xs font-black uppercase tracking-wide text-[var(--admin-gold)]">
            Temporary &mdash; they measure one year, then reset
          </p>
          <ul className="mt-2 space-y-1">
            {temporary.map((t) => (
              <li key={t} className="text-sm text-white/70">
                {LABEL[t]}
              </li>
            ))}
          </ul>
          <p className={`${MUTED} mt-3`}>
            &ldquo;Sales&rdquo; means sales <em>this year</em>. That is the whole
            point of an income statement: it answers &ldquo;how did we do in
            2026?&rdquo;, and it cannot answer that if it is still carrying 2025.
            So on these accounts the balance forward reaches back only to 1
            January of the year you are looking at.
          </p>
        </div>
      </div>

      <p className={`${P} mt-3`}>
        The reason they can reset is that on the last day of the year one entry
        &mdash; the <span className="font-semibold text-white/90">closing entry</span>{" "}
        &mdash; sweeps every income and expense account into Retained Earnings.
        That is how a year&rsquo;s profit stops being a hundred separate figures
        and becomes one number in your equity. The accounts go to zero, and the
        profit is not lost, it has just moved to where it belongs.
      </p>
      <p className={`${MUTED} mt-3`}>
        If that entry never gets made, nothing breaks loudly. The trial balance
        still foots, because the missing entry is missing from both sides at
        once. What actually happens is that your balance sheet quietly understates
        Retained Earnings by exactly one year&rsquo;s profit. That is why this
        screen raises a note when it sees income lines from a year you are not
        looking at &mdash; it is asking whether that year was ever closed.
      </p>
    </section>
  );
}

/**
 * WHAT PICKING AN ACCOUNT ACTUALLY DECIDES.
 *
 * Shared with the chart of accounts page, because it is the same lesson read
 * from two directions: here you see the consequence after the fact, there you
 * see it before choosing.
 */
export function WhatChoosingAnAccountDecides() {
  return (
    <section className={CARD}>
      <h2 className={H2}>What picking an account actually decides</h2>
      <p className={`${P} mt-2`}>
        Choosing an account feels like filing. It is not. The regulation is explicit
        that expenditures have to be <em>properly classified</em>, and in a cannabis
        business the classification is frequently worth more than the transaction:
        the same dollar is deductible in one account and permanently non-deductible
        in another <InlineAuthority id="REG_1_446_1_A_4_II_CAPITAL_VS_EXPENSE" />.
      </p>

      <ul className="mt-4 space-y-3">
        {ACCOUNT_CHOICE_CONSEQUENCES.map((c) => (
          <li key={c.family} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <p className="text-sm font-semibold text-white/90">{c.family}</p>
            <p className={`${P} mt-2`}>
              <span className="font-semibold text-white/85">Decides:</span> {c.decides}
            </p>
            <p className={`${P} mt-2`}>
              <span className="font-semibold text-white/85">The mistake people make:</span>{" "}
              {c.commonMistake}
            </p>
            <p className={`${P} mt-2`}>
              <span className="font-semibold text-white/85">How to tell:</span> {c.tellTale}
            </p>
            {c.authorityIds.length > 0 ? (
              <p className={`${MUTED} mt-2`}>
                {c.authorityIds.map((id, n) => (
                  <span key={id}>
                    {n > 0 ? " " : ""}
                    <InlineAuthority id={id} />
                  </span>
                ))}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Everything, in the order it should be read. */
export function LedgerExplainer() {
  return (
    <div className="space-y-5">
      <HowToReadALedger />
      <AboutBalanceForward />
      <AboutPermanentAndTemporary />
      <WhatChoosingAnAccountDecides />
      <AuthorityPanel
        ids={LEDGER_AUTHORITY_IDS}
        title="The rules behind this page, in full"
        intro="Quoted word for word from the primary sources, so you are reading what the regulation actually says rather than somebody's summary of it. Where a document is persuasive rather than binding, the badge says so."
      />
    </div>
  );
}
