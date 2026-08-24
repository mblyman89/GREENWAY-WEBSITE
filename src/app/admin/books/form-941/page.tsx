/**
 * src/app/admin/books/form-941/page.tsx   (books-40 phase F)
 *
 * THE QUARTERLY FEDERAL RETURN - Form 941.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS PAGE EXISTS, VERBATIM (standing rule 1)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   "books-40: quarterly filings. 941 first, since it is due first and is
 *    mostly summation... I want to be walked through this with my hand held.
 *    Plain english teaching. Examples. All that good stuff."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SHAPE OF THIS PAGE, AND WHY IT IS IN THIS ORDER
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   1. THE ONE NEXT ACTION.  One sentence, biggest thing on the page.
 *   2. The deadline.         Both dates, and which one Greenway may use.
 *   3. What is missing.      Refusal cards, grouped, each with the fix.
 *   4. The return.           Line by line, with the arithmetic shown.
 *   5. The checklist.        Seven questions, in the order they arrive.
 *   6. The worked examples.  Including Greenway's own filed Q2 2026.
 *   7. The law.              Verbatim, with the plain-English reading beside it.
 *
 * It answers "what do I do", then "by when", then "what is stopping me", then
 * "what does it say", then "how do I know it is right", then "show me one that
 * worked", then "prove it". That is the order the questions actually arrive in.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THERE IS ALMOST NO LOGIC IN THIS FILE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Every decision - the colour, the sentence, whether the button may be pressed,
 * what the single next action is - comes from `form-941-ui-core.ts`, which is
 * pure and unit tested. This file arranges the answers on screen.
 *
 * A `page.tsx` cannot be tested in this repository: the vitest include is
 * `tests/compliance/`, and this is a server component that reaches the
 * database. Any rule written into the JSX below would be a rule nothing checks,
 * and on a federal tax return an unchecked rule is how a wrong number gets
 * signed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS PAGE FILES NOTHING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * We replace the data-preparation half of Aatrix. We are NOT a filing agent and
 * nothing here transmits to the IRS. The note under the button says so in as
 * many words, because a button labelled "File" that does not file is the single
 * most dangerous control this system could ship.
 */

import Link from "next/link";

import { FormBoxExplorer } from "@/components/admin/books/FormBoxExplorer";
import { Badge, Card, CardHeader } from "@/components/admin/ui";
import { requireBooksAccess } from "@/lib/accounting/books-access";
import { form941Boxes } from "@/lib/payroll/form-box-adapters";
import { FORM_941_LESSONS } from "@/lib/payroll/form-box-lessons-941";
import { form941Authorities } from "@/lib/payroll/form-941-authorities";
import { lineOf } from "@/lib/payroll/form-941-core";
import {
  FORM_941_WORKED_EXAMPLES,
  form941ChecksInOrder,
} from "@/lib/payroll/form-941-mentor";
import { loadForm941 } from "@/lib/payroll/form-941-store";
import {
  emptyStateFor,
  fileButtonState,
  groupRefusals,
  lineRows,
  nextAction,
  refusalCard,
  statusLabel,
  statusMeaning,
  statusOf,
  statusTone,
  urgencyBand,
  urgencyMeaning,
  daysUntil,
  type Form941Tone,
} from "@/lib/payroll/form-941-ui-core";
import { formatCents, formatQuarter, type QuarterRef } from "@/lib/payroll/payroll-deposit-schedule-core";

export const dynamic = "force-dynamic";

/* ── colour, in one place ───────────────────────────────────────────────────
   Every tone on this page resolves through these maps, so a colour cannot
   drift between the banner and the cards. There is no `--admin-warning` token
   in this codebase; gold is the "attention" colour. */

const PANEL: Record<Form941Tone, string> = {
  green: "border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)]",
  gold: "border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)]",
  orange: "border-[var(--admin-orange)]/40 bg-[var(--admin-orange-soft)]",
  danger: "border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)]",
  neutral: "border-white/12 bg-white/[0.03]",
};

const TEXT: Record<Form941Tone, string> = {
  green: "text-[var(--admin-accent)]",
  gold: "text-[var(--admin-gold)]",
  orange: "text-[var(--admin-orange)]",
  danger: "text-[var(--admin-danger)]",
  neutral: "text-[var(--admin-text-muted)]",
};

const BADGE: Record<Form941Tone, "green" | "gold" | "orange" | "danger" | "neutral"> = {
  green: "green",
  gold: "gold",
  orange: "orange",
  danger: "danger",
  neutral: "neutral",
};

/** The quarter that most recently ENDED, which is the one normally being filed. */
function mostRecentlyClosedQuarter(today: Date): QuarterRef {
  const y = today.getUTCFullYear();
  const q = Math.floor(today.getUTCMonth() / 3) + 1;
  if (q === 1) return { year: y - 1, quarter: 4 };
  return { year: y, quarter: (q - 1) as 1 | 2 | 3 | 4 };
}

export default async function Form941Page({
  searchParams,
}: {
  searchParams?: Promise<{ year?: string; q?: string }>;
}) {
  await requireBooksAccess();

  const sp = (await searchParams) ?? {};
  const now = new Date();

  // The quarter comes from the URL when present, and otherwise defaults to the
  // one that has most recently closed. NOT hardcoded: this screen will still be
  // here in 2031, and a hardcoded quarter is a wrong answer with a long fuse.
  const parsedYear = Number.parseInt(sp.year ?? "", 10);
  const parsedQ = Number.parseInt(sp.q ?? "", 10);
  const fallback = mostRecentlyClosedQuarter(now);
  const quarter: QuarterRef =
    Number.isFinite(parsedYear) && parsedQ >= 1 && parsedQ <= 4
      ? { year: parsedYear, quarter: parsedQ as 1 | 2 | 3 | 4 }
      : fallback;

  const today = now.toISOString().slice(0, 10);
  const loaded = await loadForm941(quarter);

  if (!loaded.ok) {
    return (
      <Shell quarter={quarter}>
        <Card>
          <CardHeader title="This quarter could not be read" />
          <p className="text-sm text-[var(--admin-danger)]">{loaded.message}</p>
          <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
            Nothing was computed and nothing was changed. This is a problem reading the
            records, not a problem with your payroll or with a return you have already
            filed.
          </p>
        </Card>
      </Shell>
    );
  }

  const { result } = loaded;
  const action = nextAction(result, today);
  const status = statusOf(result);
  const button = fileButtonState(result);
  const empty = emptyStateFor(quarter);

  return (
    <Shell quarter={quarter}>
      {/* ── 1. THE ONE NEXT ACTION ─────────────────────────────────────── */}
      <section className={`rounded-[var(--admin-radius)] border p-5 ${PANEL[action.tone]}`}>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={BADGE[statusTone(status)]}>{statusLabel(status)}</Badge>
          <span className="text-xs text-[var(--admin-text-faint)]">
            {formatQuarter(quarter)} &middot; read on {today}
          </span>
        </div>
        <h2 className={`mt-3 text-lg font-semibold ${TEXT[action.tone]}`}>{action.headline}</h2>
        <p className="mt-2 max-w-3xl text-sm text-[var(--admin-text)]">{action.detail}</p>
        <p className="mt-3 max-w-3xl text-sm text-[var(--admin-text-muted)]">
          {statusMeaning(status)}
        </p>
      </section>

      {/* ── 2. THE DEADLINE ────────────────────────────────────────────── */}
      {result.ok ? (
        <Card>
          <CardHeader
            title="When this is due"
            subtitle="Two dates. The later one is earned by your deposit history, not requested."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <DueDate
              label="Ordinary deadline"
              date={result.due.ordinary}
              note={
                result.due.ordinaryWasShifted
                  ? "Moved off a weekend or federal holiday by 26 CFR 301.7503-1."
                  : "The last day of the month after the quarter ends."
              }
              tone={
                urgencyBand(daysUntil(today, result.due.ordinary)) === "overdue"
                  ? "danger"
                  : "neutral"
              }
            />
            <DueDate
              label="If every deposit was on time"
              date={result.due.ifDepositsWereTimely}
              note="Ten extra days, earned automatically when the quarter's deposits were all made in full and on time."
              tone="neutral"
            />
          </div>
          <p className="mt-4 text-sm text-[var(--admin-text-muted)]">{result.due.plain}</p>
          <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
            {urgencyMeaning(
              urgencyBand(daysUntil(today, result.due.ordinary)),
              daysUntil(today, result.due.ordinary),
              result.due.ordinary,
            )}
          </p>
        </Card>
      ) : null}

      {/* ── 3. WHAT IS MISSING ─────────────────────────────────────────── */}
      {!result.ok ? (
        <Card>
          <CardHeader
            title="What has to be resolved first"
            subtitle="Everything that is blocking this return, all at once - not one at a time."
          />
          <div className="space-y-4">
            {groupRefusals(result.refusals).map((group) => {
              const card = refusalCard(group.items[0]);
              return (
                <div
                  key={group.code}
                  className={`rounded-[var(--admin-radius-sm)] border p-4 ${PANEL[card.tone]}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={BADGE[card.tone]}>{card.code}</Badge>
                    {group.items.length > 1 ? (
                      <span className="text-xs text-[var(--admin-text-faint)]">
                        affects {group.items.length} people
                      </span>
                    ) : null}
                  </div>
                  <h3 className={`mt-2 text-sm font-semibold ${TEXT[card.tone]}`}>
                    {card.headline}
                  </h3>
                  <Labelled label="What happened">{card.whatHappened}</Labelled>
                  <Labelled label="How to fix it">{card.howToFix}</Labelled>
                  <Labelled label="Why we refuse rather than guess">{card.whyWeRefuse}</Labelled>
                  {group.items.length > 1 ? (
                    <ul className="mt-3 space-y-1">
                      {group.items.map((item, i) => (
                        <li key={`${item.subjectId ?? "x"}-${i}`} className="text-xs text-[var(--admin-text-muted)]">
                          &bull; {item.what}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      {/* ── 4. THE RETURN ──────────────────────────────────────────────── */}
      {result.ok && result.subjectCount === 0 ? (
        <Card>
          <CardHeader title={empty.title} />
          <p className="text-sm text-[var(--admin-text-muted)]">{empty.body}</p>
        </Card>
      ) : null}

      {result.ok && result.subjectCount > 0 ? (
        <Card>
          <CardHeader
            title={`Form 941 - ${result.quarterLabel}`}
            subtitle={`${result.periodStart} to ${result.periodEnd} - built from ${result.sourceLabel}.`}
          />
          <p className="mb-4 text-sm text-[var(--admin-text)]">{result.verdict}</p>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                  <th className="py-2 pr-3">Line</th>
                  <th className="py-2 pr-3">What it asks for</th>
                  <th className="py-2 pr-3 text-right">Amount</th>
                  <th className="py-2">Where it came from</th>
                </tr>
              </thead>
              <tbody>
                {lineRows(result).map((row) => (
                  <tr
                    key={row.line}
                    className={`border-b border-white/5 align-top ${
                      row.emphasise ? "bg-white/[0.03]" : ""
                    }`}
                  >
                    <td className="py-2 pr-3 font-mono text-xs text-[var(--admin-text-dim)]">
                      {row.line}
                    </td>
                    <td
                      className={`py-2 pr-3 ${
                        row.emphasise ? "font-semibold text-[var(--admin-text)]" : "text-[var(--admin-text-dim)]"
                      }`}
                    >
                      {row.caption}
                    </td>
                    <td
                      className={`py-2 pr-3 text-right font-mono ${TEXT[row.tone]} ${
                        row.emphasise ? "font-semibold" : ""
                      }`}
                    >
                      {row.display}
                    </td>
                    <td className="py-2 text-xs text-[var(--admin-text-muted)]">{row.derivation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Line 7 gets its own explanation, because it is the one place a
              wrong number looks completely normal. */}
          <div className="mt-5 rounded-[var(--admin-radius-sm)] border border-white/12 bg-white/[0.03] p-4">
            <h3 className="text-sm font-semibold text-[var(--admin-text)]">
              About line 7 &mdash; {formatCents(lineOf(result, "7")?.amountCents ?? 0)}
            </h3>
            <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
              {result.fractions.plain}
            </p>
          </div>

          {/* The honest button. */}
          <div className="mt-5">
            <button
              type="button"
              disabled={!button.enabled}
              className={`rounded-[var(--admin-radius-sm)] px-4 py-2 text-sm font-semibold ${
                button.enabled
                  ? "bg-[var(--admin-accent)] text-black"
                  : "cursor-not-allowed bg-white/10 text-[var(--admin-text-faint)]"
              }`}
            >
              {button.label}
            </button>
            {button.disabledReason ? (
              <p className="mt-2 text-xs text-[var(--admin-danger)]">{button.disabledReason}</p>
            ) : null}
            <p className="mt-2 max-w-3xl text-xs text-[var(--admin-text-muted)]">
              {button.honestyNote}
            </p>
          </div>
        </Card>
      ) : null}

      {/* ── TAKE ME TO SCHOOL (books-47 slice D) ───────────────────────────
          Michael, verbatim: "I want to be able to see the form, and click a
          box to have it teach me all there is to know about that box... When I
          say take me to school, I meant while I'm in the system working."

          The table above shows the RETURN. This shows the same figures as a
          teachable surface: click a line number and get the plain English, the
          worked examples, the verbatim IRS instruction, and the boxes on other
          forms that must agree with it. It computes nothing - `form941Boxes`
          only translates the engine's own result into the box model. */}
      {result.ok && result.subjectCount > 0 ? (
        <FormBoxExplorer
          title={`Form 941 - ${result.quarterLabel}, line by line`}
          subtitle="Employer's QUARTERLY Federal Tax Return. Click a line number to be taught it."
          boxes={form941Boxes(result)}
          lessons={FORM_941_LESSONS}
        />
      ) : null}

      {/* ── the read itself, so the numbers can be traced ──────────────── */}
      <Card>
        <CardHeader
          title="What was read to build this"
          subtitle="So that a figure you disagree with can be traced back to a pay run."
        />
        <dl className="grid gap-3 sm:grid-cols-2">
          <Fact
            label="Pay runs in this quarter"
            value={String(loaded.runCount)}
            note="Counted by PAY DATE, not by period end date. A period worked in June but paid in July is third-quarter wages."
          />
          <Fact
            label="Pay dates"
            value={loaded.payDates.length > 0 ? loaded.payDates.join(", ") : "none"}
            note="Tick these off against your own diary. A missing pay date here is a pay run that was never posted."
          />
          <Fact
            label="Line 1 measured on"
            value={loaded.twelfthDay.date}
            note={
              loaded.twelfthDay.periodFound
                ? "A pay period covering this date was found, so line 1 could be answered."
                : "NO pay period in the calendar covers this date, so line 1 cannot be answered and the return refuses. Build the pay period calendar for this quarter."
            }
          />
          <Fact
            label="Lines with no tax detail"
            value={String(loaded.linesMissingTaxDetail)}
            note="Pay run lines written before the per-tax columns existed. They are excluded rather than counted as zero, because zero would be a number nobody checked."
          />
          {loaded.voidedRunsExcluded > 0 ? (
            <Fact
              label="Voided runs excluded"
              value={String(loaded.voidedRunsExcluded)}
              note="A voided run is not a correction - it is a run that never happened. Including it would overstate every line."
            />
          ) : null}
        </dl>
      </Card>

      {/* ── 5. THE CHECKLIST ───────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Before you sign it - seven questions, in order"
          subtitle="Each one is a physical action, not an instruction to be careful."
        />
        <ol className="space-y-4">
          {form941ChecksInOrder().map((check) => (
            <li key={check.key} className="rounded-[var(--admin-radius-sm)] border border-white/12 bg-white/[0.02] p-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-[var(--admin-text-dim)]">
                  {check.order}
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--admin-text)]">
                    {check.question}
                  </h3>
                  <Labelled label="How to check it">{check.howToCheck}</Labelled>
                  <Labelled label="Why here and not later">{check.whyThisOrder}</Labelled>
                  <Labelled label="What it costs to get wrong">{check.ifItFails}</Labelled>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      {/* ── 6. WORKED EXAMPLES ─────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Worked examples"
          subtitle="Including your own Q2 2026 return - the one the IRS accepted - reproduced line for line."
        />
        <div className="space-y-4">
          {FORM_941_WORKED_EXAMPLES.map((ex) => (
            <details
              key={ex.key}
              className="rounded-[var(--admin-radius-sm)] border border-white/12 bg-white/[0.02] p-4"
            >
              <summary className="cursor-pointer text-sm font-semibold text-[var(--admin-text)]">
                {ex.title}
              </summary>
              <p className="mt-3 text-sm text-[var(--admin-text-muted)]">{ex.setup}</p>
              <ol className="mt-3 space-y-1">
                {ex.steps.map((step, i) => (
                  <li key={i} className="font-mono text-xs text-[var(--admin-text-dim)]">
                    {step}
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-sm text-[var(--admin-accent)]">{ex.theLesson}</p>
            </details>
          ))}
        </div>
      </Card>

      {/* ── 7. THE LAW, VERBATIM ───────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="The law this screen applies, word for word"
          subtitle="Transcribed from the source, never paraphrased. The plain-English reading sits beside it, clearly marked as ours."
        />
        <div className="space-y-4">
          {form941Authorities().map((a) => (
            <div
              key={a.id}
              className="rounded-[var(--admin-radius-sm)] border border-white/12 bg-white/[0.02] p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="outline">{a.kind}</Badge>
                <span className="text-xs font-semibold text-[var(--admin-text-dim)]">{a.cite}</span>
              </div>
              <blockquote className="mt-3 border-l-2 border-[var(--admin-gold)] pl-3 text-sm italic text-[var(--admin-text)]">
                {a.quote}
              </blockquote>
              <Labelled label="What that means here">{a.soWhat}</Labelled>
              <p className="mt-2 text-xs text-[var(--admin-text-faint)]">Source: {a.source}</p>
            </div>
          ))}
        </div>
      </Card>

      <p className="text-xs text-[var(--admin-text-faint)]">
        Related screens:{" "}
        <Link href="/admin/books/pay-run" className="underline">
          Pay Run
        </Link>{" "}
        &middot;{" "}
        <Link href="/admin/books/ytd" className="underline">
          Year-to-Date Totals
        </Link>{" "}
        &middot;{" "}
        <Link href="/admin/books/company" className="underline">
          Company Information
        </Link>
      </p>
    </Shell>
  );
}

/* ── small presentational helpers ──────────────────────────────────────── */

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
      <span className="font-semibold text-[var(--admin-text-dim)]">{label}: </span>
      {children}
    </p>
  );
}

function Fact({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">{label}</dt>
      <dd className="mt-1 font-mono text-sm text-[var(--admin-text)]">{value}</dd>
      <dd className="mt-1 text-xs text-[var(--admin-text-muted)]">{note}</dd>
    </div>
  );
}

function DueDate({
  label,
  date,
  note,
  tone,
}: {
  label: string;
  date: string;
  note: string;
  tone: Form941Tone;
}) {
  return (
    <div className={`rounded-[var(--admin-radius-sm)] border p-4 ${PANEL[tone]}`}>
      <p className="text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">{label}</p>
      <p className={`mt-1 font-mono text-lg font-semibold ${TEXT[tone]}`}>{date}</p>
      <p className="mt-1 text-xs text-[var(--admin-text-muted)]">{note}</p>
    </div>
  );
}

function Shell({ quarter, children }: { quarter: QuarterRef; children: React.ReactNode }) {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--admin-text)]">
          Form 941 &mdash; {formatQuarter(quarter)}
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--admin-text-muted)]">
          The quarterly federal employment tax return. This screen reads the pay runs whose
          pay date falls inside the quarter, adds them up, and shows the return line by line
          with the arithmetic in the open. Nothing here is transmitted to the IRS and nothing
          is written to your books &mdash; where a figure cannot be produced honestly, it says
          so instead of guessing.
        </p>
      </div>
      {children}
    </div>
  );
}
