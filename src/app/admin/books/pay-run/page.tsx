/**
 * src/app/admin/books/pay-run/page.tsx   (books-39 phase G)
 *
 * THE PAY RUN — the screen where a real paycheque becomes visible.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS PAGE EXISTS, VERBATIM (standing rule 1)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   "I want check lists and blockers if things are right. I want it to tell me
 *    how to do it properly if I mess it up. I love the colors and presentation.
 *    Keep making it blatantly obvious how to proceed."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SHAPE OF THIS PAGE, AND WHY IT IS IN THIS ORDER
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   1. THE ONE NEXT ACTION.   Top of the page, biggest thing on it, one
 *                             sentence and one destination. Everything else is
 *                             detail underneath it.
 *   2. The three counts.      Ready / needs a fix / cannot be paid. All three
 *                             always shown, including the zeroes.
 *   3. The money.             Three totals, each with the sentence that stops
 *                             it being misread.
 *   4. The checklist.         Seven questions, in order, with what this run can
 *                             answer and what only Michael can.
 *   5. The people.            One card each, blocked first.
 *   6. The recovery ladder.   What to do if it has already gone wrong, by how
 *                             far the money has travelled.
 *
 * The order is deliberate: it answers "what do I do", then "how big is this",
 * then "how do I know it is right", then "who specifically", then "what if I
 * already messed it up". That is the order the questions actually arrive in.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THERE IS ALMOST NO LOGIC IN THIS FILE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Every decision — which colour, which sentence, whether the run may be
 * approved, what the single next action is — comes from `pay-run-ui-core.ts`,
 * which is pure and unit tested. This file arranges the answers on screen.
 *
 * That is not a style preference. A `page.tsx` cannot be tested in this
 * repository: the vitest include is `tests/compliance/`, and this is a server
 * component that reaches the database. Any rule written into the JSX below
 * would be a rule nothing checks — and on a payroll screen, an unchecked rule
 * is how somebody gets paid the wrong amount. So the JSX makes no decisions.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS PAGE WRITES NOTHING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `loadPayRun` reads and computes. It does not save, approve, or move money,
 * and neither does anything on this page — the approve control is rendered but
 * deliberately not wired, because approving is a write with its own audit
 * trail, its own permission and its own confirmation, and shipping a button
 * that half-works is worse than shipping one that says what it is waiting for.
 * The button therefore states plainly that it is not connected yet, rather than
 * appearing to work.
 */

import Link from "next/link";

import { Badge, Card, CardHeader } from "@/components/admin/ui";
import { requireBooksAccess } from "@/lib/accounting/books-access";
import { loadPayPeriods } from "@/lib/payroll/timesheet-store";
import { loadPayRun } from "@/lib/payroll/pay-run-store";
import { PAY_RUN_RECOVERIES } from "@/lib/payroll/pay-run-mentor";
import {
  checklistFor,
  employeeCard,
  moneyRows,
  nextAction,
  statusCounts,
  type PayRunTone,
} from "@/lib/payroll/pay-run-ui-core";

export const dynamic = "force-dynamic";

/* ── colour, in one place ──────────────────────────────────────────────────
   Every tone used on this page resolves through these two maps, so a colour
   cannot drift between the banner and the cards. There is no `--admin-warning`
   token in this codebase; gold is the "attention" colour. */

const PANEL: Record<PayRunTone, string> = {
  green: "border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)]",
  gold: "border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)]",
  orange: "border-[var(--admin-orange)]/40 bg-[var(--admin-orange-soft)]",
  danger: "border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)]",
  neutral: "border-white/12 bg-white/[0.03]",
};

const TEXT: Record<PayRunTone, string> = {
  green: "text-[var(--admin-accent)]",
  gold: "text-[var(--admin-gold)]",
  orange: "text-[var(--admin-orange)]",
  danger: "text-[var(--admin-danger)]",
  neutral: "text-[var(--admin-text-muted)]",
};

/** Badge accepts these names directly; the mapping is 1:1 by design. */
const BADGE: Record<PayRunTone, "green" | "gold" | "orange" | "danger" | "neutral"> = {
  green: "green",
  gold: "gold",
  orange: "orange",
  danger: "danger",
  neutral: "neutral",
};

export default async function PayRunPage({
  searchParams,
}: {
  searchParams?: Promise<{ year?: string; period?: string }>;
}) {
  await requireBooksAccess();

  const sp = (await searchParams) ?? {};

  // The tax year comes from the URL when present and otherwise from the clock.
  // NOT hardcoded to 2027: Michael's first payroll is 2027-01-01 and this
  // screen will still be here in 2031. Same reasoning as the Timesheets page.
  const parsedYear = Number.parseInt(sp.year ?? "", 10);
  const taxYear = Number.isFinite(parsedYear) ? parsedYear : new Date().getUTCFullYear();

  const periodsRes = await loadPayPeriods(taxYear);

  // A read failure is reported as a read failure, never as an empty calendar.
  // "No pay periods exist" and "the pay periods could not be read" look
  // identical on screen and mean opposite things.
  if (!periodsRes.ok) {
    return (
      <Shell taxYear={taxYear}>
        <Card>
          <CardHeader title="The pay period calendar could not be read" />
          <p className="text-sm text-[var(--admin-danger)]">{periodsRes.message}</p>
          <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
            Nothing was computed and nothing was changed. This is a problem reading the
            records, not a problem with your payroll.
          </p>
        </Card>
      </Shell>
    );
  }

  const periods = periodsRes.periods;

  if (periods.length === 0) {
    return (
      <Shell taxYear={taxYear}>
        <Card>
          <CardHeader title={`No pay periods exist for ${taxYear}`} />
          <p className="text-sm text-[var(--admin-text-muted)]">
            A pay run needs a pay period to run for: it is the period that carries the pay
            date, and the pay date is what decides which tax rates apply. Build the{" "}
            {taxYear} calendar first — biweekly Fridays, twenty-six of them, plus the single
            annual period for the owner&apos;s wage.
          </p>
          <Link
            href="/admin/books/timesheets"
            className="mt-4 inline-block rounded-[var(--admin-radius-sm)] bg-[var(--admin-accent)] px-4 py-2 text-sm font-semibold text-black"
          >
            Open Timesheets to set up the calendar
          </Link>
        </Card>
      </Shell>
    );
  }

  // No period chosen: show the picker rather than guessing one. Picking "the
  // most recent" would silently point at a period Michael was not thinking
  // about, and every number on this screen would be for the wrong fortnight.
  const selectedId = sp.period ?? null;
  if (!selectedId) {
    return (
      <Shell taxYear={taxYear}>
        <Card>
          <CardHeader
            title="Pick the pay period you want to run"
            subtitle="Nothing is selected by default, on purpose. Every figure on this screen belongs to one specific pay date, and quietly choosing one for you is how a fortnight gets paid twice."
          />
          <ul className="mt-2 divide-y divide-white/8">
            {periods.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-3">
                <div>
                  <Link
                    href={`/admin/books/pay-run?year=${taxYear}&period=${p.id}`}
                    className="text-sm font-semibold text-[var(--admin-accent)] hover:underline"
                  >
                    {p.label}
                  </Link>
                  <p className="text-xs text-[var(--admin-text-faint)]">
                    {p.start_date} to {p.end_date} &middot; paid {p.pay_date}
                  </p>
                </div>
                <Badge tone={p.status === "locked" ? "neutral" : "gold"}>{p.status}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </Shell>
    );
  }

  const load = await loadPayRun(selectedId);
  const action = nextAction(load);
  const checklist = checklistFor(load);

  return (
    <Shell taxYear={taxYear}>
      {/* ══ 1) THE ONE NEXT ACTION ══════════════════════════════════════════
          First, largest, and never more than one. A payroll screen showing
          eleven equally-weighted problems is a screen that gets scrolled
          past. */}
      <div className={`rounded-[var(--admin-radius-lg)] border p-6 ${PANEL[action.tone]}`}>
        <p className="text-[0.7rem] font-semibold uppercase tracking-widest text-[var(--admin-text-faint)]">
          Do this next
        </p>
        <h2 className={`mt-1 text-lg font-bold ${TEXT[action.tone]}`}>{action.headline}</h2>
        <p className="mt-2 max-w-4xl text-sm leading-relaxed text-[var(--admin-text)]">
          {action.detail}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {action.href ? (
            <Link
              href={action.href}
              className="rounded-[var(--admin-radius-sm)] bg-[var(--admin-accent)] px-4 py-2 text-sm font-semibold text-black"
            >
              {action.cta}
            </Link>
          ) : null}

          {/* The approve control. Rendered disabled with the reason attached
              rather than hidden: a button that vanishes teaches nothing, while
              a greyed one with a sentence next to it teaches exactly what is
              standing between here and payday. */}
          {action.canApprove ? (
            <>
              <button
                type="button"
                disabled
                className="cursor-not-allowed rounded-[var(--admin-radius-sm)] border border-white/15 px-4 py-2 text-sm font-semibold text-[var(--admin-text-dim)]"
              >
                {action.cta}
              </button>
              <span className="text-xs text-[var(--admin-text-faint)]">
                Not connected yet — approving is a write with its own audit trail and
                confirmation, and it lands in the next slice. This screen only reads.
              </span>
            </>
          ) : null}
        </div>
      </div>

      {load.ok ? (
        <>
          {/* ══ 2) THE THREE COUNTS ═════════════════════════════════════════
              Always all three, including the zeroes. "0 cannot be paid" is one
              of the most reassuring things this page can say, and it can only
              say it by being present. */}
          <div className="grid gap-4 sm:grid-cols-3">
            {statusCounts(load.result).map((c) => (
              <div
                key={c.status}
                className={`rounded-[var(--admin-radius-lg)] border p-4 ${PANEL[c.tone]}`}
              >
                <p className={`text-3xl font-bold ${TEXT[c.tone]}`}>{c.count}</p>
                <p className="mt-1 text-sm font-semibold text-[var(--admin-text)]">{c.label}</p>
              </div>
            ))}
          </div>

          {/* ══ 3) THE MONEY ════════════════════════════════════════════════ */}
          <Card>
            <CardHeader
              title={`${load.periodLabel} — the totals`}
              subtitle={`${load.periodStartDate} to ${load.periodEndDate}, paid ${load.payDateIso}.`}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              {moneyRows(load.result).map((row) => (
                <div key={row.label}>
                  <p className="text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                    {row.label}
                  </p>
                  <p className="mt-1 text-2xl font-bold text-[var(--admin-text)]">
                    {row.amount}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--admin-text-muted)]">
                    {row.note}
                  </p>
                </div>
              ))}
            </div>
          </Card>

          {/* ══ 4) THE CHECKLIST ════════════════════════════════════════════
              Some rows cannot be ticked by software and are never auto-ticked.
              A checklist that ticks itself is a checklist nobody reads. */}
          <Card>
            <CardHeader
              title="Before you approve — the seven checks, in order"
              subtitle="Three of these the software can answer from this run. Four of them it cannot, and it will not pretend to: those say so and wait for you."
            />
            <ol className="space-y-4">
              {checklist.map((row) => (
                <li
                  key={row.check.key}
                  className={`rounded-[var(--admin-radius-lg)] border p-4 ${PANEL[row.tone]}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="text-sm font-bold text-[var(--admin-text)]">
                      {row.check.order}. {row.check.question}
                    </p>
                    <Badge tone={BADGE[row.tone]}>
                      {row.answered === "yes"
                        ? "Answered"
                        : row.answered === "no"
                          ? "Not yet"
                          : "You must confirm"}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--admin-text)]">
                    {row.evidence}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-[var(--admin-text-muted)]">
                    <span className="font-semibold">How to check: </span>
                    {row.check.howToCheck}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--admin-text-muted)]">
                    <span className="font-semibold">If this one is wrong: </span>
                    {row.check.ifItFails}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--admin-text-faint)]">
                    <span className="font-semibold">Why it is {row.check.order}
                    {ordinalSuffix(row.check.order)}: </span>
                    {row.check.whyThisOrder}
                  </p>
                </li>
              ))}
            </ol>
          </Card>

          {/* ══ 5) THE PEOPLE ═══════════════════════════════════════════════
              Blocked first, then attention, then ready. Sorted here rather
              than in the engine because this is a presentation decision — the
              engine keeps its own order for the ledger. */}
          <Card>
            <CardHeader
              title="Everybody in this run"
              subtitle="Anyone who cannot be paid is listed first. Each card says what happened, why, and the exact next thing to do."
            />
            <div className="space-y-4">
              {[...load.result.lines]
                .sort((a, b) => rank(a.status) - rank(b.status))
                .map((line) => employeeCard(line))
                .map((card) => (
                  <div
                    key={card.employeeId}
                    className={`rounded-[var(--admin-radius-lg)] border p-5 ${PANEL[card.tone]}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-base font-bold text-[var(--admin-text)]">
                          {card.employeeName}
                        </p>
                        <p className={`text-xs font-semibold ${TEXT[card.tone]}`}>
                          {card.statusLabel}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold text-[var(--admin-text)]">
                          {card.netPay ?? "—"}
                        </p>
                        <p className="text-xs text-[var(--admin-text-faint)]">
                          {card.netPay ? "net pay" : "no honest figure"}
                        </p>
                      </div>
                    </div>

                    <p className="mt-3 text-sm leading-relaxed text-[var(--admin-text)]">
                      {card.statusMeaning}
                    </p>

                    {card.grossWages ? (
                      <p className="mt-2 text-xs text-[var(--admin-text-muted)]">
                        Gross {card.grossWages}
                        {card.garnished ? ` · ${card.garnished} withheld under orders` : ""}
                      </p>
                    ) : null}

                    {/* HOW THE WITHHOLDING WAS DECIDED. Always shown, including
                        for the ordinary case, because "a signed W-4 was used as
                        written" is information too — its absence is what makes
                        the statutory default easy to miss. */}
                    <div className="mt-4 rounded-[var(--admin-radius-sm)] border border-white/10 bg-black/20 p-3">
                      <p className="text-xs font-bold text-[var(--admin-text)]">
                        {card.w4Headline}
                      </p>
                      {card.w4WhatItMeans ? (
                        <p className="mt-1 text-xs leading-relaxed text-[var(--admin-text-muted)]">
                          {card.w4WhatItMeans}
                        </p>
                      ) : null}
                      {card.w4WhatToDo ? (
                        <p className="mt-1 text-xs leading-relaxed text-[var(--admin-text-muted)]">
                          <span className="font-semibold">What to do: </span>
                          {card.w4WhatToDo}
                        </p>
                      ) : null}
                    </div>

                    {card.problems.length > 0 ? (
                      <ul className="mt-4 space-y-3">
                        {card.problems.map((p, i) => (
                          <li
                            key={`${card.employeeId}-${i}`}
                            className={`rounded-[var(--admin-radius-sm)] border p-3 ${PANEL[p.tone]}`}
                          >
                            <p className={`text-sm font-bold ${TEXT[p.tone]}`}>{p.headline}</p>
                            {p.why ? (
                              <p className="mt-1 text-xs leading-relaxed text-[var(--admin-text)]">
                                {p.why}
                              </p>
                            ) : null}
                            {p.whatToDo ? (
                              <p className="mt-1 text-xs leading-relaxed text-[var(--admin-text)]">
                                <span className="font-semibold">What to do: </span>
                                {p.whatToDo}
                              </p>
                            ) : null}
                            {p.costOfGuessing ? (
                              <p className="mt-1 text-xs leading-relaxed text-[var(--admin-text-faint)]">
                                <span className="font-semibold">
                                  Why we stopped instead of guessing:{" "}
                                </span>
                                {p.costOfGuessing}
                              </p>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {card.explanation.length > 0 ? (
                      <details className="mt-4">
                        <summary className="cursor-pointer text-xs font-semibold text-[var(--admin-accent)]">
                          Show the gross-to-net walk for {card.employeeName}
                        </summary>
                        <ol className="mt-2 space-y-1 pl-4">
                          {card.explanation.map((step, i) => (
                            <li
                              key={`${card.employeeId}-step-${i}`}
                              className="list-decimal text-xs leading-relaxed text-[var(--admin-text-muted)]"
                            >
                              {step}
                            </li>
                          ))}
                        </ol>
                      </details>
                    ) : null}
                  </div>
                ))}
            </div>
          </Card>
        </>
      ) : null}

      {/* ══ 6) THE RECOVERY LADDER ══════════════════════════════════════════
          Shown whether or not the run loaded, because the moment Michael needs
          this is the moment something has already gone wrong — and that is
          exactly when a screen is least likely to be in a happy state. */}
      <Card>
        <CardHeader
          title="If you have already run it wrong"
          subtitle="What to do depends entirely on how far the money has travelled. Find the stage you are at; do not skip ahead, because the fix for a later stage is a filing, not an edit."
        />
        <ol className="space-y-4">
          {PAY_RUN_RECOVERIES.map((r, i) => (
            <li
              key={r.key}
              className="rounded-[var(--admin-radius-lg)] border border-white/12 bg-white/[0.03] p-4"
            >
              <p className="text-[0.7rem] font-semibold uppercase tracking-widest text-[var(--admin-text-faint)]">
                Stage {i + 1} — {r.when}
              </p>
              <p className="mt-1 text-sm font-bold text-[var(--admin-text)]">{r.headline}</p>
              <p className="mt-2 text-sm leading-relaxed text-[var(--admin-text)]">
                {r.whatToDo}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-[var(--admin-orange)]">
                <span className="font-semibold">The trap: </span>
                {r.theTrap}
              </p>
            </li>
          ))}
        </ol>
      </Card>
    </Shell>
  );
}

/** Blocked first, then attention, then ready. */
function rank(status: "ready" | "attention" | "blocked"): number {
  return status === "blocked" ? 0 : status === "attention" ? 1 : 2;
}

/** 1st, 2nd, 3rd, 4th. Only ever called with 1-7, but written correctly anyway. */
function ordinalSuffix(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  if (n % 10 === 1) return "st";
  if (n % 10 === 2) return "nd";
  if (n % 10 === 3) return "rd";
  return "th";
}

function Shell({ taxYear, children }: { taxYear: number; children: React.ReactNode }) {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--admin-text)]">
          Pay run &mdash; {taxYear}
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--admin-text-muted)]">
          Hours, W-4s, year-to-date totals, court orders and this year&apos;s rates are
          brought together here into one cheque per person. Nothing on this screen is
          written to your books and no money moves &mdash; it reads, it computes, and where
          it cannot produce an honest figure it says so instead of guessing.
        </p>
      </div>
      {children}
    </div>
  );
}
