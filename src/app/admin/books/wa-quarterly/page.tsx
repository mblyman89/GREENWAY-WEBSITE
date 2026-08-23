/**
 * src/app/admin/books/wa-quarterly/page.tsx   (books-41)
 *
 * THE WASHINGTON QUARTERLY RETURNS - four forms, three destinations.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS PAGE EXISTS, VERBATIM (standing rule 1)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   "The forms are an important step and I really want to make sure I
 *    understand everything that is happening on the forms in plain english."
 *
 * That sentence set the shape of this screen. Every box on every form carries
 * its own explanation: what goes in it, where the figure comes from, whose
 * money it is, and what happens if it is wrong. None of that is decoration -
 * on these particular returns, "whose money is this" is the difference between
 * a lawful deduction and a misdemeanour.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SHAPE OF THIS PAGE, AND WHY IT IS IN THIS ORDER
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   1. THE ONE NEXT ACTION.  One sentence, biggest thing on the page.
 *   2. The deadline.         One date, and the Washington trap beside it.
 *   3. Where these go.       THREE submissions, because two of them are ESD.
 *   4. Whose money it is.    Three totals, because the law treats them three ways.
 *   5. What is missing.      Refusal cards, each with the fix.
 *   6. The forms.            Box by box, with the arithmetic and the teaching.
 *   7. The checklist.        Eight steps, in the order they arrive.
 *   8. The worked examples.  Including Greenway's own filed Q2 2026.
 *   9. The law.              Verbatim, with the plain-English reading beside it.
 *
 * It answers "what do I do", then "by when", then "where do they go", then
 * "who is this money", then "what is stopping me", then "what does it say",
 * then "how do I know it is right", then "show me one that worked", then
 * "prove it". That is the order the questions actually arrive in.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY SECTION 3 IS NOT "GROUPED BY AGENCY"
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Two of the three submissions go to Employment Security. Grouping by agency
 * would merge them into one block, and that block would be a lie: Forms 5208A
 * and 5208B go in through EAMS, while Paid Leave and WA Cares go to the same
 * agency through a completely separate system. "I filed with ESD" is not a
 * statement that means anything, and the quarter Michael learns that is the
 * quarter he gets a late notice for a report he believes he filed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THERE IS ALMOST NO LOGIC IN THIS FILE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Every decision - the colour, the sentence, whether the button may be pressed,
 * how the quarter splits into submissions, whether a box renders as money or as
 * hours - comes from `wa-quarterly-ui-core.ts`, which is pure and unit tested.
 * This file arranges the answers on screen.
 *
 * A `page.tsx` cannot be tested in this repository: the vitest include is
 * `tests/compliance/`, and this is a server component that reaches the
 * database. Any rule written into the JSX below would be a rule nothing checks.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS PAGE FILES NOTHING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * We replace the data-preparation half of Aatrix. We are NOT a filing agent and
 * nothing here transmits to Employment Security or to Labor & Industries. The
 * note under the button says so in as many words, because a button labelled
 * "File" that does not file is the single most dangerous control this system
 * could ship.
 */

import Link from "next/link";

import { Badge, Card, CardHeader } from "@/components/admin/ui";
import { requireBooksAccess } from "@/lib/accounting/books-access";
import { waQuarterlyAuthorities } from "@/lib/payroll/wa-quarterly-authorities";
import {
  type WaQuarterFormId,
  waQuarterDueDate,
  waVersusFederalDeadlineNote,
} from "@/lib/payroll/wa-quarterly-core";
import {
  WA_WORKED_EXAMPLES,
  boxExplainer,
  waChecksInOrder,
  waFormGuide,
  waQuarterOrientation,
} from "@/lib/payroll/wa-quarterly-mentor";
import {
  type WaQuarterTone,
  formatMoneyCents,
  waAgencyGroups,
  waDaysUntil,
  waEmptyStateFor,
  waLineRows,
  waNextAction,
  waOwnershipSummary,
  waQuarterLabel,
  waRefusalCard,
  waStatusLabel,
  waStatusMeaning,
  waStatusOf,
  waStatusTone,
  waSubmitButtonState,
  waUrgencyBand,
  waRateAsOfDate,
  waResolveRates,
  waUrgencyMeaning,
  waWageDetailRows,
} from "@/lib/payroll/wa-quarterly-ui-core";
import { loadWaQuarter } from "@/lib/payroll/wa-quarterly-store";
import { GREENWAY_RATES } from "@/lib/payroll/payroll-rates-2026";
import { type QuarterRef } from "@/lib/payroll/payroll-deposit-schedule-core";

export const dynamic = "force-dynamic";

/* ── colour, in one place ───────────────────────────────────────────────────
   Every tone on this page resolves through these maps, so a colour cannot
   drift between the banner and the cards. There is no `--admin-warning` token
   in this codebase; gold is the "attention" colour. */

const PANEL: Record<WaQuarterTone, string> = {
  green: "border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)]",
  gold: "border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)]",
  orange: "border-[var(--admin-orange)]/40 bg-[var(--admin-orange-soft)]",
  danger: "border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)]",
  neutral: "border-white/12 bg-white/[0.03]",
};

const TEXT: Record<WaQuarterTone, string> = {
  green: "text-[var(--admin-accent)]",
  gold: "text-[var(--admin-gold)]",
  orange: "text-[var(--admin-orange)]",
  danger: "text-[var(--admin-danger)]",
  neutral: "text-[var(--admin-text-muted)]",
};

const BADGE: Record<WaQuarterTone, "green" | "gold" | "orange" | "danger" | "neutral"> = {
  green: "green",
  gold: "gold",
  orange: "orange",
  danger: "danger",
  neutral: "neutral",
};

const FORM_ORDER: readonly WaQuarterFormId[] = [
  "esd_5208a",
  "esd_5208b",
  "pfml_wa_cares",
  "lni_quarterly",
];

/** The quarter that most recently ENDED, which is the one normally being filed. */
function mostRecentlyClosedQuarter(today: Date): QuarterRef {
  const y = today.getUTCFullYear();
  const q = Math.floor(today.getUTCMonth() / 3) + 1;
  if (q === 1) return { year: y - 1, quarter: 4 };
  return { year: y, quarter: (q - 1) as 1 | 2 | 3 | 4 };
}

export default async function WaQuarterlyPage({
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
  const due = waQuarterDueDate(quarter);

  // THE RATES COME FROM THE REGISTRY, WHICH REFUSES WHEN IT DOES NOT KNOW.
  // The registry is keyed on the date a rate was in force. Where the 2027 rates
  // have not been entered yet it refuses rather than returning last year's, and
  // that refusal is shown to Michael as a first-class answer with the whole
  // list of what is missing - not one rate at a time.
  const asOf = waRateAsOfDate(quarter);
  const resolved = waResolveRates(GREENWAY_RATES, asOf);

  if (!resolved.ok) {
    return (
      <Shell quarter={quarter}>
        <Card>
          <CardHeader
            title="The rates for this quarter are not on file yet"
            subtitle={`${resolved.missing.length} of the seven rates these returns need have no evidenced entry covering ${asOf}.`}
          />
          <p className="mb-4 max-w-3xl text-sm text-[var(--admin-text-muted)]">
            Nothing was computed and nothing was changed. These returns are percentages of your
            payroll, so without the rate that was in force there is no honest figure to show. The
            system refuses rather than carrying last year&rsquo;s rate forward, because a stale rate
            produces a confident wrong number instead of an obvious missing one.
          </p>
          <div className="space-y-3">
            {resolved.missing.map((m) => (
              <div
                key={m.key}
                className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] p-4"
              >
                <p className="text-sm font-semibold text-[var(--admin-text)]">{m.label}</p>
                <Labelled label="Why this stopped">{m.message}</Labelled>
                <Labelled label="What to do">{m.whatToDo}</Labelled>
              </div>
            ))}
          </div>
        </Card>
      </Shell>
    );
  }

  const loaded = await loadWaQuarter(quarter, resolved.rates, {
    // RCW 50A.10.030(4): the employer share is owed only if ESD's 30 September
    // determination said fifty or more employees. That determination is not a
    // fact about this quarter's pay runs, so it is not inferred here - it is
    // passed as undetermined and the engine refuses if it matters.
    employerOwesEmployerShare: false,
    determinedAverageHeadcount: null,
  });

  if (!loaded.ok) {
    return (
      <Shell quarter={quarter}>
        <Card>
          <CardHeader title="This quarter could not be read" />
          <p className="text-sm text-[var(--admin-danger)]">{loaded.message}</p>
          <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
            Nothing was computed and nothing was changed. This is a problem reading the records,
            not a problem with your payroll or with a return you have already filed.
          </p>
        </Card>
      </Shell>
    );
  }

  const { result } = loaded;
  const action = waNextAction(result, today);
  const status = waStatusOf(result);
  const button = waSubmitButtonState(result);
  const daysLeft = waDaysUntil(today, due.dueDate);
  const band = waUrgencyBand(daysLeft);
  const empty = waEmptyStateFor(quarter);

  return (
    <Shell quarter={quarter}>
      {/* ── 1. THE ONE NEXT ACTION ─────────────────────────────────────── */}
      <section className={`rounded-[var(--admin-radius)] border p-5 ${PANEL[action.tone]}`}>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={BADGE[waStatusTone(status)]}>{waStatusLabel(status)}</Badge>
          <span className="text-xs text-[var(--admin-text-faint)]">
            {waQuarterLabel(quarter)} &middot; read on {today}
          </span>
        </div>
        <h2 className={`mt-3 text-lg font-semibold ${TEXT[action.tone]}`}>{action.headline}</h2>
        <p className="mt-2 max-w-3xl text-sm text-[var(--admin-text)]">{action.detail}</p>
        <p className="mt-3 max-w-3xl text-sm text-[var(--admin-text-muted)]">
          {waStatusMeaning(status)}
        </p>
      </section>

      {/* ── 2. THE DEADLINE, AND THE WASHINGTON TRAP ───────────────────── */}
      <Card>
        <CardHeader
          title="When these are due"
          subtitle="One date for all four forms. Washington has no second date you can earn."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <DueDate
            label="Due date"
            date={due.dueDate}
            note={due.why}
            tone={PANEL_TONE_FOR_BAND[band]}
          />
          <div className="rounded-[var(--admin-radius-sm)] border border-white/12 bg-white/[0.03] p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
              How long is left
            </p>
            <p className={`mt-1 font-mono text-lg font-semibold ${TEXT[PANEL_TONE_FOR_BAND[band]]}`}>
              {daysLeft >= 0 ? `${daysLeft} days` : `${Math.abs(daysLeft)} days overdue`}
            </p>
            <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
              {waUrgencyMeaning(band, daysLeft, due.dueDate)}
            </p>
          </div>
        </div>
        <p className="mt-4 max-w-3xl text-sm text-[var(--admin-text-muted)]">
          {waVersusFederalDeadlineNote()}
        </p>
      </Card>

      {/* ── 3. WHERE THESE ACTUALLY GO ─────────────────────────────────── */}
      {result.ok ? (
        <Card>
          <CardHeader
            title="Three submissions, not one"
            subtitle="Two of these go to Employment Security, and they still are not the same filing."
          />
          <div className="grid gap-4 lg:grid-cols-3">
            {waAgencyGroups(result.value).map((g) => (
              <div
                key={g.key}
                className="rounded-[var(--admin-radius-sm)] border border-white/12 bg-white/[0.03] p-4"
              >
                <p className="text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                  {g.agency}
                </p>
                <p className="mt-1 text-sm font-semibold text-[var(--admin-text)]">
                  Submit in {g.destination}
                </p>
                <p className="mt-2 font-mono text-lg text-[var(--admin-text)]">
                  {g.totalFormatted}
                </p>
                <ul className="mt-2 space-y-1">
                  {g.formTitles.map((t) => (
                    <li key={t} className="text-xs text-[var(--admin-text-dim)]">
                      &middot; {t}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-[var(--admin-text-muted)]">{g.why}</p>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* ── 4. WHOSE MONEY THIS IS ─────────────────────────────────────── */}
      {result.ok ? (
        <Card>
          <CardHeader
            title="Whose money each part of this is"
            subtitle="Three totals, because Washington law treats the three in opposite ways."
          />
          <div className="grid gap-4 lg:grid-cols-3">
            {waOwnershipSummary(result.value).map((b) => (
              <div
                key={b.whose}
                className={`rounded-[var(--admin-radius-sm)] border p-4 ${PANEL[b.tone]}`}
              >
                <p className="text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                  {b.label}
                </p>
                <p className={`mt-1 font-mono text-lg font-semibold ${TEXT[b.tone]}`}>
                  {b.totalFormatted}
                </p>
                <p className="mt-2 text-xs text-[var(--admin-text-muted)]">{b.meaning}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 max-w-3xl text-sm text-[var(--admin-text-muted)]">
            {waQuarterOrientation({
              grossWagesCents: result.value.grossWagesCents,
              totalHours: result.value.totalHours,
              headcount: result.value.headcount,
            })}
          </p>
        </Card>
      ) : null}

      {/* ── 5. WHAT IS MISSING ─────────────────────────────────────────── */}
      {!result.ok ? (
        <Card>
          <CardHeader
            title="What has to be resolved first"
            subtitle="Each of these stopped the return being produced. None of them was guessed past."
          />
          <div className="space-y-4">
            {result.refusals.map((r, i) => {
              const card = waRefusalCard(r);
              return (
                <div
                  key={`${card.code}-${i}`}
                  className={`rounded-[var(--admin-radius-sm)] border p-4 ${PANEL[card.tone]}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="danger">{card.code}</Badge>
                    {card.subjectId ? (
                      <span className="text-xs text-[var(--admin-text-faint)]">
                        {card.subjectId}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm font-semibold text-[var(--admin-text)]">
                    {card.title}
                  </p>
                  <Labelled label="What happened here">{card.because}</Labelled>
                  {card.whyItRefuses ? (
                    <Labelled label="Why it refuses instead of guessing">
                      {card.whyItRefuses}
                    </Labelled>
                  ) : null}
                  <Labelled label="How to fix it">{card.fix}</Labelled>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      {/* ── 6. THE FORMS, BOX BY BOX ───────────────────────────────────── */}
      {result.ok && result.value.lines.length > 0 ? (
        FORM_ORDER.map((form) => {
          const guide = waFormGuide(form);
          const rows = waLineRows(result.value, form);
          const wageRows = form === "esd_5208b" ? waWageDetailRows(result.value) : [];
          if (rows.length === 0 && wageRows.length === 0) return null;

          return (
            <Card key={form}>
              <CardHeader
                title={guide ? guide.officialName : form}
                subtitle={guide ? guide.purpose : undefined}
              />
              {guide ? (
                <div className="mb-4 space-y-2">
                  <Labelled label="What this form is charged on">{guide.chargedOn}</Labelled>
                  <Labelled label="The mistake people make">{guide.commonMistake}</Labelled>
                </div>
              ) : null}

              {/* The 5208B is one row per person, not a list of boxes. */}
              {wageRows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                        <th className="pb-2">Employee</th>
                        <th className="pb-2 text-right">Wages paid</th>
                        <th className="pb-2 text-right">Hours</th>
                      </tr>
                    </thead>
                    <tbody>
                      {wageRows.map((r) => (
                        <tr key={r.subjectId} className="border-t border-white/8">
                          <td className="py-2 text-[var(--admin-text)]">{r.displayName}</td>
                          <td className="py-2 text-right font-mono text-[var(--admin-text)]">
                            {r.wagesFormatted}
                          </td>
                          <td className="py-2 text-right font-mono text-[var(--admin-text)]">
                            {r.hoursFormatted}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-3 text-xs text-[var(--admin-text-muted)]">
                    These rows must total exactly to the wages and hours on the tax report above.
                    Employment Security reconciles the two halves, and a mismatch makes the filing
                    incomplete rather than merely wrong.
                  </p>
                </div>
              ) : null}

              {/* Every other form is a short list of boxes, each explained. */}
              <div className="space-y-4">
                {rows.map((row) => {
                  const ex = boxExplainer(row.id);
                  return (
                    <div
                      key={row.id}
                      className={`rounded-[var(--admin-radius-sm)] border p-4 ${
                        row.isTotal
                          ? "border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)]"
                          : "border-white/12 bg-white/[0.03]"
                      }`}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-[var(--admin-text)]">
                            {row.boxLabel}
                          </span>
                          <Badge tone="outline">{row.whoseMoneyLabel}</Badge>
                          {row.isTotal ? <Badge tone="gold">Total</Badge> : null}
                        </div>
                        <span className="font-mono text-lg text-[var(--admin-text)]">
                          {row.value}
                        </span>
                      </div>
                      <p className="mt-2 font-mono text-xs text-[var(--admin-text-dim)]">
                        {row.shownAs}
                      </p>
                      {ex ? (
                        <div className="mt-3 space-y-1">
                          <Labelled label="What goes here">{ex.whatGoesHere}</Labelled>
                          <Labelled label="Where the figure comes from">
                            {ex.whereItComesFrom}
                          </Labelled>
                          <Labelled label="Why whose money it is matters">
                            {ex.whyOwnershipMatters}
                          </Labelled>
                          <Labelled label="If it is wrong">{ex.ifItIsWrong}</Labelled>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })
      ) : null}

      {/* The empty state is NOT "nothing to see here" - a zero must be filed. */}
      {result.ok && result.value.lines.length === 0 ? (
        <Card>
          <CardHeader title={empty.title} />
          <p className="text-sm text-[var(--admin-text-muted)]">{empty.body}</p>
        </Card>
      ) : null}

      {/* ── the button that does not file ──────────────────────────────── */}
      <Card>
        <CardHeader title="Taking these figures to the State" />
        <button
          type="button"
          disabled={!button.enabled}
          className={`rounded-[var(--admin-radius-sm)] border px-4 py-2 text-sm font-semibold ${
            button.enabled
              ? "border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]"
              : "cursor-not-allowed border-white/12 bg-white/[0.03] text-[var(--admin-text-faint)]"
          }`}
        >
          {button.label}
        </button>
        {button.disabledReason ? (
          <p className="mt-2 text-sm text-[var(--admin-danger)]">{button.disabledReason}</p>
        ) : null}
        <p className="mt-3 max-w-3xl text-sm text-[var(--admin-text-muted)]">
          {button.honestyNote}
        </p>
      </Card>

      {/* ── 7. THE CHECKLIST ───────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Before you submit anything"
          subtitle="Eight steps, in the order the questions actually arrive."
        />
        <ol className="space-y-4">
          {waChecksInOrder().map((c) => (
            <li key={c.key} className="border-l-2 border-[var(--admin-gold)] pl-3">
              <p className="text-sm font-semibold text-[var(--admin-text)]">
                {c.order}. {c.title}
              </p>
              <Labelled label="Do this">{c.doThis}</Labelled>
              <Labelled label="Done when">{c.doneWhen}</Labelled>
              <Labelled label="If you skip it">{c.ifSkipped}</Labelled>
            </li>
          ))}
        </ol>
      </Card>

      {/* ── 8. WORKED EXAMPLES ─────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Worked examples"
          subtitle="Including the one cent that proves the two unemployment funds are separate."
        />
        <div className="space-y-5">
          {WA_WORKED_EXAMPLES.map((ex) => (
            <div key={ex.key}>
              <p className="text-sm font-semibold text-[var(--admin-text)]">{ex.title}</p>
              <p className="mt-1 text-sm text-[var(--admin-text-muted)]">{ex.setup}</p>
              <ol className="mt-2 space-y-1">
                {ex.steps.map((s, i) => (
                  <li key={i} className="font-mono text-xs text-[var(--admin-text-dim)]">
                    {i + 1}. {s}
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-sm text-[var(--admin-text)]">{ex.lesson}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* ── 9. THE LAW, VERBATIM ───────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="The law these returns come from"
          subtitle="Quoted exactly, with the plain-English reading beside it."
        />
        <div className="space-y-4">
          {waQuarterlyAuthorities().map((a) => (
            <div
              key={a.id}
              className="rounded-[var(--admin-radius-sm)] border border-white/12 bg-white/[0.03] p-4"
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
        <Link href="/admin/books/form-941" className="underline">
          Form 941 (Quarterly)
        </Link>{" "}
        &middot;{" "}
        <Link href="/admin/books/pay-run" className="underline">
          Pay Run
        </Link>{" "}
        &middot;{" "}
        <Link href="/admin/books/timesheets" className="underline">
          Timesheets &amp; Overtime
        </Link>
      </p>
    </Shell>
  );
}

/* ── small presentational helpers ─────────────────────────────────────────── */

const PANEL_TONE_FOR_BAND: Record<
  "overdue" | "due-now" | "due-soon" | "comfortable",
  WaQuarterTone
> = {
  overdue: "danger",
  "due-now": "orange",
  "due-soon": "gold",
  comfortable: "green",
};

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
      <span className="font-semibold text-[var(--admin-text-dim)]">{label}: </span>
      {children}
    </p>
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
  tone: WaQuarterTone;
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
          Washington quarterly returns &mdash; {waQuarterLabel(quarter)}
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--admin-text-muted)]">
          Four forms, three submissions, two agencies. This screen reads the pay runs whose pay
          date falls inside the quarter, adds them up, and shows every box with the arithmetic and
          the plain-English explanation beside it. Nothing here is transmitted to Employment
          Security or to Labor &amp; Industries and nothing is written to your books &mdash; where
          a figure cannot be produced honestly, it says so instead of guessing.
        </p>
      </div>
      {children}
    </div>
  );
}
