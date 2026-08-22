"use client";

/**
 * src/components/admin/books/NetPayWorkbench.tsx   (books-37)
 *
 * THE NUMBER ON THE CHEQUE, WITH EVERY STEP THAT PRODUCED IT SHOWN.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT MICHAEL ASKED FOR, VERBATIM (standing rule 1)
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   "Keep adding all the mentoring and guidance walkthroughs from the PhD cpa
 *    we have been building. It is the single greatest thing we have included in
 *    this project in my opinion."
 *
 * and on how it must look:
 *
 *   "Please make sure you use our themes and colors and text and styles and
 *    such. I want the pages to match our style and to be as clean as possible
 *    so I don't get lost in the guidance helpers."
 *
 * So this is the same two-column shape as the timesheet, leave and garnishment
 * workbenches — work on the left, reasons on the right — with the same
 * `@/components/admin/ui` primitives and the same `--admin-*` tokens. Standing
 * rule 25: extend the established pattern rather than invent a rival one. A
 * third visual language is exactly what would turn guidance into clutter.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A WORKED CHEQUE AND NOT A LIST OF LAST FRIDAY'S PAY
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Because the database cannot honestly answer the question yet, and pretending
 * otherwise would reintroduce the exact defect this slice was opened to fix.
 * `payroll_run_lines` stores ONE column called `taxes_cents`. Disposable
 * earnings under 15 U.S.C. 1672(b) are gross less amounts REQUIRED BY LAW to be
 * withheld, and a single lump cannot answer that, because nothing records
 * whether a voluntary health premium is inside it. Treating the whole lump as
 * required by law would understate disposable earnings; ignoring it would
 * overstate them. One under-garnishes a support order — where the shortfall can
 * become Michael's own liability — and the other over-garnishes an employee.
 *
 * So the screen shows a cheque worked through the REAL engines, every line
 * derived and none typed in. When the itemised columns arrive, the same
 * `buildNetPayWorkedExample` reads them from the database instead and this file
 * does not change (standing rule 62e).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NOTHING ON THIS SCREEN COMPUTES ANYTHING
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Every cent came from `computePaycheckTaxes`, `computeAllOrders` and
 * `computeNetPay`. There is no percentage, no cap, no subtraction in this file.
 * If this file did its own sums they would eventually disagree with the
 * engine's — silently, on somebody's paycheque.
 */

import { AuthorityPanel } from "@/components/admin/books/AuthorityPanel";
import { Badge, Card, CardHeader } from "@/components/admin/ui";
import {
  NET_PAY_FIELD_LESSONS,
  NET_PAY_REFUSAL_LESSONS,
  NET_PAY_REVIEW_CHECKS,
  NET_PAY_SCREEN_LESSONS,
} from "@/lib/payroll/net-pay-mentor";
import type { NetPayWorkedExample } from "@/lib/payroll/net-pay-ui-core";
import {
  afterTaxVersusNetSentence,
  garnishmentSummary,
  orderingHolds,
} from "@/lib/payroll/net-pay-ui-core";
import { formatCentsPlain } from "@/lib/payroll/payroll-withholding-core";

export type NetPayWorkbenchProps = {
  readonly worked: NetPayWorkedExample;
  /** Where the scenario's facts came from, said plainly. Never invented. */
  readonly scenarioNote: string;
};

/**
 * The authorities behind the ORDER OF OPERATIONS, which is what this screen is
 * really teaching.
 *
 * Four, not forty. The statutory definition of the base, the enforcing agency's
 * test for what belongs in it, the mirror-image rule that keeps voluntary
 * deductions OUT of it, and the Washington statute that makes an unauthorised
 * deduction a crime. Every one is resolved against the real registry by the
 * screen test, so a typo cannot render a silently empty card.
 */
const SELECTED_AUTHORITY_IDS = [
  "net-pay-usc-15-1672-base",
  "net-pay-fs30-legally-required",
  "net-pay-fs30-voluntary-excluded",
  "net-pay-rcw-49-52-050-rebate",
] as const;

/**
 * The screen lessons that belong HERE.
 *
 * Chosen by topic string rather than by array index, because an index quietly
 * points at a different lesson the moment somebody inserts one above it. The
 * screen test asserts each of these resolves to exactly one real lesson.
 */
const SELECTED_LESSON_TOPICS = [
  "Every number can be right and the cheque still wrong",
  "Disposable earnings is not take-home pay, and the difference is the whole game",
  "The L&I premium was missing from the base, and that is not a rounding detail",
] as const;

/** Field lessons keyed by the exact field name, for the inline teaching rows. */
const LESSON_BY_FIELD = new Map(NET_PAY_FIELD_LESSONS.map((l) => [l.field, l]));

/**
 * One step of the waterfall.
 *
 * `emphasis` marks the two figures a reader must not confuse: disposable
 * earnings (what the law measures a garnishment against) and net pay (what the
 * employee is handed). Every other row is an ordinary subtraction.
 */
function Step({
  label,
  amountCents,
  note,
  emphasis,
}: {
  label: string;
  amountCents: number;
  note?: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={
        emphasis
          ? "flex flex-wrap items-baseline justify-between gap-2 border-t border-white/10 pt-2"
          : "flex flex-wrap items-baseline justify-between gap-2"
      }
    >
      <div className="min-w-0">
        <span
          className={
            emphasis
              ? "font-semibold text-[var(--admin-text)]"
              : "text-[var(--admin-text-muted)]"
          }
        >
          {label}
        </span>
        {note ? (
          <p className="mt-0.5 text-xs text-[var(--admin-text-muted)]">{note}</p>
        ) : null}
      </div>
      <span
        className={
          emphasis
            ? "shrink-0 font-semibold tabular-nums text-[var(--admin-text)]"
            : "shrink-0 tabular-nums text-[var(--admin-text-muted)]"
        }
      >
        {formatCentsPlain(amountCents)}
      </span>
    </div>
  );
}

export function NetPayWorkbench({ worked, scenarioNote }: NetPayWorkbenchProps) {
  const lessons = NET_PAY_SCREEN_LESSONS.filter((l) =>
    (SELECTED_LESSON_TOPICS as readonly string[]).includes(l.topic),
  );

  /* ── THE REFUSAL PATH ────────────────────────────────────────────────────
     A refusal is not an error message to be apologised for. It is the engine
     declining to produce a number it cannot stand behind, and each code has a
     lesson explaining why stopping beats computing anyway. Rendering the
     lesson beside the refusal is the difference between "it broke" and "here
     is what is missing and what to do about it". */
  if (!worked.ok) {
    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="This cheque was not calculated, on purpose"
              subtitle="The engine stopped rather than produce a figure it could not stand behind. Nothing has been withheld, remitted or paid."
              action={<Badge tone="orange">Stopped</Badge>}
            />
            <ul className="space-y-4 text-sm">
              {worked.refusals.map((r, i) => {
                const lesson = NET_PAY_REFUSAL_LESSONS.find((l) => l.code === r.code);
                return (
                  <li key={`${r.code}-${i}`} className="border-l-2 border-[var(--admin-orange)]/50 pl-4">
                    <p className="font-medium text-[var(--admin-text)]">
                      {lesson ? lesson.headline : r.code}
                    </p>
                    <p className="mt-1 text-[var(--admin-text-muted)]">{r.message}</p>
                    <p className="mt-1 text-[var(--admin-text-muted)]">
                      <span className="text-white/50">What to do: </span>
                      {r.whatToDo}
                    </p>
                    {lesson ? (
                      <p className="mt-2 text-xs leading-relaxed text-[var(--admin-text-muted)]">
                        <span className="text-white/50">Why stopping is the right answer: </span>
                        {lesson.whyWeStop}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Card>

          {worked.missingRates.length > 0 ? (
            <Card>
              <CardHeader
                title="Rates with no evidenced row for this pay date"
                subtitle="A rate is only usable here if a dated row and the notice it came from are both on file. Reusing last year's figure is how a paycheque comes out looking perfect and being wrong."
              />
              <ul className="space-y-3 text-sm">
                {worked.missingRates.map((m) => (
                  <li key={m.label}>
                    <span className="font-medium text-[var(--admin-text)]">{m.label}</span>
                    <p className="mt-0.5 text-[var(--admin-text-muted)]">{m.why}</p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader title="Where these figures came from" />
            <p className="text-sm leading-relaxed text-[var(--admin-text-muted)]">
              {scenarioNote}
            </p>
          </Card>
          <AuthorityPanel
            ids={SELECTED_AUTHORITY_IDS}
            intro="The exact words the calculation follows, quoted verbatim and checked against the mirrored source on every commit."
          />
        </aside>
      </div>
    );
  }

  const b = worked.breakdown;
  const ordering = orderingHolds(b);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      {/* ══ LEFT: the work ═══════════════════════════════════════════════ */}
      <div className="space-y-6">
        {/* THE WATERFALL. The order is the law: gross, less what the law
            requires (which GIVES disposable earnings), less garnishment capped
            on that figure, less voluntary deductions, equals net pay. Showing
            it as anything other than a sequence would hide the one thing that
            is easy to get wrong. */}
        <Card>
          <CardHeader
            title={`${worked.employeeName} — cheque dated ${worked.payDateIso}`}
            subtitle="Read top to bottom. Each line is subtracted from the one above it, and the order is set by statute rather than by preference."
            action={
              b.garnishment ? (
                <Badge tone="gold">Garnishment applies</Badge>
              ) : (
                <Badge tone="green">No orders attached</Badge>
              )
            }
          />

          <div className="space-y-3 text-sm">
            <Step label="Gross wages for the period" amountCents={b.grossWagesCents} />

            <div className="rounded-md border border-white/10 bg-white/[0.02] p-3">
              <p className="mb-2 text-[11px] uppercase tracking-wide text-white/40">
                Less — amounts required by law
              </p>
              <div className="space-y-2">
                {worked.requiredLines.map((l) => (
                  <div key={l.label}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-[var(--admin-text-muted)]">{l.label}</span>
                      <span className="shrink-0 tabular-nums text-[var(--admin-text-muted)]">
                        {formatCentsPlain(l.amountCents)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-white/35">{l.why}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 border-t border-white/10 pt-2">
                <span className="font-medium text-[var(--admin-text)]">
                  Total required by law
                </span>
                <span className="shrink-0 font-medium tabular-nums text-[var(--admin-text)]">
                  {formatCentsPlain(b.requiredByLaw.totalCents)}
                </span>
              </div>
            </div>

            <Step
              label="Disposable earnings"
              amountCents={b.disposableEarningsCents}
              note="This is the figure every garnishment ceiling is measured against. It is NOT take-home pay."
              emphasis
            />

            <Step
              label="Less — withheld under court or agency orders"
              amountCents={b.totalGarnishedCents}
              note={garnishmentSummary(b.garnishment)}
            />

            <Step
              label="Less — deductions the employee authorised in writing"
              amountCents={b.totalVoluntaryCents}
              note={
                b.voluntaryDeductions.length === 0
                  ? "None recorded. Voluntary deductions come off AFTER the garnishment, never before it."
                  : b.voluntaryDeductions.map((d) => d.label).join(", ")
              }
            />

            <Step label="Net pay — the number on the cheque" amountCents={b.netPayCents} emphasis />
          </div>

          <p className="mt-4 border-l-2 border-[var(--admin-accent)]/40 pl-3 text-sm leading-relaxed text-[var(--admin-text-muted)]">
            {afterTaxVersusNetSentence(b)}
          </p>
        </Card>

        {/* THE TWO SELF-CHECKS, RUN AND REPORTED — not asserted quietly.
            Standing rule 64a: detection is not explanation. Both of these can
            only fail if something upstream is wrong, which is exactly why they
            are worth showing rather than hiding behind a green tick. */}
        <Card>
          <CardHeader
            title="The cheque checked itself"
            subtitle="Two tests that cannot fail for an ordinary business reason. If either one does, the arithmetic is wrong somewhere above, not the circumstances."
          />
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[var(--admin-text-muted)]">
                Do the parts add back up to the net pay?
              </span>
              <Badge tone={worked.reconciliation.balanced ? "green" : "danger"}>
                {worked.reconciliation.balanced
                  ? "Balanced"
                  : `Out by ${formatCentsPlain(worked.reconciliation.differenceCents)}`}
              </Badge>
            </div>
            <p className="text-xs text-white/40">{worked.reconciliation.explanation}</p>

            <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-white/10 pt-3">
              <span className="text-[var(--admin-text-muted)]">
                Does disposable earnings sit between gross and net?
              </span>
              <Badge tone={ordering ? "green" : "danger"}>
                {ordering ? "In order" : "Out of order"}
              </Badge>
            </div>
            <p className="text-xs text-white/40">
              It has to, by definition — more is taken off it than gross and less than net. If it
              equalled net pay, voluntary deductions were wrongly included in the base; if it
              equalled gross, no tax came out at all.
            </p>
          </div>
        </Card>

        {/* THE ENGINE'S OWN WORDS. `explanation` is written by net-pay-core as
            it computes, so it describes what actually happened rather than what
            this component believes happened. */}
        {b.explanation.length > 0 ? (
          <Card>
            <CardHeader
              title="Every step, in the engine's own words"
              subtitle="Written by the calculation as it ran, not by this page."
            />
            <ol className="space-y-2 text-sm text-[var(--admin-text-muted)]">
              {b.explanation.map((line, i) => (
                <li key={i} className="flex gap-3">
                  <span className="shrink-0 text-[11px] tabular-nums text-white/30">{i + 1}</span>
                  <span>{line}</span>
                </li>
              ))}
            </ol>
          </Card>
        ) : null}

        {(b.notes.length > 0 || worked.engineNotes.length > 0 || worked.missingRates.length > 0) ? (
          <Card>
            <CardHeader
              title="Things worth knowing about this cheque"
              subtitle="Not errors. Conditions the calculation met and handled, reported rather than buried."
            />
            <ul className="space-y-2 text-sm text-[var(--admin-text-muted)]">
              {worked.missingRates.map((m) => (
                <li key={`rate-${m.label}`}>
                  <span className="text-[var(--admin-orange)]">{m.label}: </span>
                  {m.why}
                </li>
              ))}
              {b.notes.map((n, i) => (
                <li key={`note-${i}`}>{n}</li>
              ))}
              {worked.engineNotes.map((n, i) => (
                <li key={`engine-${i}`}>{n}</li>
              ))}
            </ul>
          </Card>
        ) : null}

        {/* BEFORE THE MONEY MOVES. Questions, deliberately, not assertions —
            a checklist that states conclusions gets ticked; one that asks
            questions gets read. */}
        <Card>
          <CardHeader
            title="Before the money moves"
            subtitle="What a reviewer asks. Worth five minutes now — every one of these is far cheaper to answer before a payment file is generated than after."
          />
          <ol className="space-y-4 text-sm">
            {NET_PAY_REVIEW_CHECKS.map((c, i) => (
              <li key={c.question} className="border-l-2 border-white/10 pl-4">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-[11px] font-semibold tabular-nums text-white/40">
                    {i + 1}
                  </span>
                  <span className="font-medium text-[var(--admin-text)]">{c.question}</span>
                </div>
                <p className="mt-1 text-[var(--admin-text-muted)]">{c.why}</p>
                <p className="mt-1 text-[var(--admin-text-muted)]">
                  <span className="text-white/50">How to check: </span>
                  {c.howToCheck}
                </p>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      {/* ══ RIGHT: the teaching ══════════════════════════════════════════ */}
      <aside className="space-y-6">
        <Card>
          <CardHeader title="Where these figures came from" />
          <p className="text-sm leading-relaxed text-[var(--admin-text-muted)]">{scenarioNote}</p>
        </Card>

        {lessons.map((l) => (
          <Card key={l.topic}>
            <CardHeader title={l.topic} />
            <p className="text-sm leading-relaxed text-[var(--admin-text-muted)]">
              {l.plainEnglish}
            </p>
            <p className="mt-3 border-l-2 border-[var(--admin-accent)]/40 pl-3 text-sm leading-relaxed text-[var(--admin-text-muted)]">
              {l.whyItMatters}
            </p>
          </Card>
        ))}

        {/* THE TRAP ON THE TWO FIGURES PEOPLE ACTUALLY CONFUSE. Pulled from the
            field lessons by exact field name so the teaching and the engine can
            never drift apart — the gate in net-pay-mentor-gates.ts fails the
            build if a field ships without a lesson. */}
        {["disposableEarningsCents", "netPayCents"].map((field) => {
          const lesson = LESSON_BY_FIELD.get(field);
          if (!lesson) return null;
          return (
            <Card key={field}>
              <CardHeader title={lesson.whatItIs} subtitle="The trap on this figure" />
              <p className="text-sm leading-relaxed text-[var(--admin-text-muted)]">
                {lesson.theTrap}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-[var(--admin-text-muted)]">
                <span className="text-white/50">How to be sure: </span>
                {lesson.howToBeSure}
              </p>
            </Card>
          );
        })}

        <AuthorityPanel
          ids={SELECTED_AUTHORITY_IDS}
          intro="The exact words the calculation follows, quoted verbatim and checked against the mirrored source on every commit."
        />
      </aside>
    </div>
  );
}
