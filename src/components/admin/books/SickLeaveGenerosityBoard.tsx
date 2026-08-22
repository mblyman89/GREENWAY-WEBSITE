"use client";

/**
 * src/components/admin/books/SickLeaveGenerosityBoard.tsx   (books-36)
 *
 * "I WANT TO KEEP TRACK OF HOW GENEROUS I AM BEING."
 *
 * WHAT MICHAEL ASKED FOR, VERBATIM (standing rule 1)
 *
 *   "I use the legally required minimum, it's easier that way, I give extra on
 *    demand, I don't want to try and figure out a complex formula to accumulate
 *    sick time. I just need a smart and easy to use tool that tracks their sick
 *    time, including if it goes negative. I want to keep track of how generous
 *    I am being."
 *
 * Read carefully that is four requirements, and three of them were already
 * built and none of them were visible:
 *
 *   1. ACCRUE AT THE FLOOR - no custom formula.  Engine section 5. Done.
 *   2. GIVE EXTRA AD HOC, recorded AS extra.     Engine section 8. Done.
 *   3. TRACK THE GENEROSITY.                     Engine section 14. NEW.
 *   4. SHOW IT IF IT GOES NEGATIVE.              Engine section 14. NEW.
 *
 * This screen is the first place any of the four becomes visible to him.
 *
 * WHY THE GIFT COLUMN IS THE POINT OF THE WHOLE SCREEN
 *
 * The single most common way a generous small employer gets hurt is by giving
 * extra leave that silently becomes indistinguishable from earned leave. Earned
 * leave must be carried over at year end up to the cap in WAC 296-128-620(4).
 * Gifted leave need not be. If the two are mixed in one number, every gift
 * quietly converts into a permanent, compounding obligation - so being kind in
 * March costs money every January afterwards, forever, and nobody can see why.
 *
 * Keeping the buckets apart is what lets Michael be generous without being
 * punished for it. This screen makes that separation visible so he can trust it.
 *
 * WHY A NEGATIVE BALANCE IS SHOWN IN RED RATHER THAN CLAMPED TO ZERO
 *
 * He asked for it by name - "including if it goes negative". A negative balance
 * cannot happen by accruing or by taking approved leave; the engine refuses
 * both. So if one appears, it came from a correction, a forfeit or a payout,
 * which means somebody made an entry that needs looking at. `Math.max(0, n)`
 * would be one character of tidying that permanently conceals an error in a
 * wage record.
 *
 * NOTHING ON THIS SCREEN COMPUTES ANYTHING
 *
 * Every minute shown was summed by `sick-leave-core.ts`. This file formats and
 * arranges. The only arithmetic it performs is minutes-to-hours for display,
 * and that is asserted to be the only arithmetic by
 * `tests/compliance/generosity-board.test.ts`.
 */

import { Badge, Card, CardHeader } from "@/components/admin/ui";
import { SICK_LEAVE_AUTHORITIES } from "@/lib/payroll/sick-leave-authorities";
import { SICK_LEAVE_SCREEN_LESSONS } from "@/lib/payroll/sick-leave-mentor";
import type { GenerosityLine, GenerositySummary } from "@/lib/payroll/sick-leave-core";

export type SickLeaveGenerosityBoardProps = {
  readonly summary: GenerositySummary;
  readonly accruesAtStatutoryFloor: boolean | null;
  readonly policyNote: string;
};

/**
 * Minutes as hours, for DISPLAY only.
 *
 * The engine stores and reasons in whole minutes because hours-as-decimals lose
 * money to rounding when a 10-minute increment is priced. This function is the
 * boundary where that integer becomes something a human reads, and it is the
 * only arithmetic in this file.
 *
 * The sign is preserved deliberately. A negative balance must READ as negative.
 */
function hours(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(minutes);
  return `${sign}${(abs / 60).toFixed(2)} h`;
}

/**
 * The authorities that decide what this screen is showing.
 *
 * Three, not sixteen. Michael asked not to "get lost in the guidance helpers",
 * and a wall of regulation is the same as no guidance at all. These three are
 * the accrual floor he has chosen, the carryover rule that makes the two-bucket
 * separation worth money, and the cap on what must be carried.
 *
 * Resolved against the real registry by the test named "every selected
 * authority id resolves in the real registry" in
 * tests/compliance/generosity-board.test.ts, so a typo cannot silently render
 * a blank card.
 */
const SELECTED_AUTHORITY_IDS = [
  "wac-296-128-620-accrual",
  "wac-296-128-620-carryover",
  "wac-296-128-620-carryover-cap",
] as const;

/**
 * The lessons worth having on THIS screen.
 *
 * Selected by topic rather than by index, because an index would silently point
 * at a different lesson the moment somebody inserts one. Checked against the
 * real module by the gate.
 */
const SELECTED_LESSON_TOPICS = [
  "Two buckets, and why spending the earned one first is worth real money",
  "Balances are history, not a number somebody edits",
] as const;

export function SickLeaveGenerosityBoard({
  summary,
  accruesAtStatutoryFloor,
  policyNote,
}: SickLeaveGenerosityBoardProps) {
  const negatives = summary.lines.filter((l) => l.isNegative);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      {/* ══ LEFT: the work ══════════════════════════════════════════════ */}
      <div className="space-y-6">
        {/* THE ANSWER TO HIS QUESTION, IN ONE CARD, BEFORE ANY DETAIL. */}
        <Card>
          <CardHeader
            title="How generous have you been"
            subtitle="Leave you gave by hand, on top of everything the law required you to give."
            action={
              accruesAtStatutoryFloor === true ? (
                <Badge tone="green">At the legal minimum</Badge>
              ) : accruesAtStatutoryFloor === false ? (
                <Badge tone="gold">Above the legal minimum</Badge>
              ) : (
                <Badge tone="orange">Accrual rate unknown</Badge>
              )
            }
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--admin-text-muted)]">
                Given, all time
              </p>
              <p className="mt-1 text-2xl font-semibold text-[var(--admin-accent)]">
                {hours(summary.totalAwardedEverMinutes)}
              </p>
              <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                Every hour you handed out as a gift.
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--admin-text-muted)]">
                Of that, used
              </p>
              <p className="mt-1 text-2xl font-semibold text-[var(--admin-text)]">
                {hours(summary.totalAwardedUsedMinutes)}
              </p>
              <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                What the gift was actually worth to people.
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--admin-text-muted)]">
                Still outstanding
              </p>
              <p className="mt-1 text-2xl font-semibold text-[var(--admin-text)]">
                {hours(summary.totalAwardedOutstandingMinutes)}
              </p>
              <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                Gifted hours still sitting in balances.
              </p>
            </div>
          </div>

          {/* The engine's own sentence. Not re-worded here, so the number and
              the words describing it can never drift apart. */}
          <p className="mt-4 text-sm text-[var(--admin-text-muted)]">{summary.explanation}</p>

          <p className="mt-2 text-xs text-[var(--admin-text-muted)]">{policyNote}</p>

          <p className="mt-2 text-xs text-[var(--admin-text-muted)]">
            These totals cover people currently on the payroll. Leave gifted to someone
            who has since left is not counted here, so the all-time figure is a floor,
            not a ceiling.
          </p>
        </Card>

        {/* NEGATIVE BALANCES. Loud, first, and only when they exist. */}
        {negatives.length > 0 ? (
          <Card>
            <CardHeader
              title="Balances below zero"
              subtitle="These need looking at before the next pay run."
              action={<Badge tone="danger">{negatives.length} to check</Badge>}
            />
            <ul className="space-y-3">
              {negatives.map((l) => (
                <li
                  key={l.employeeId}
                  className="rounded-[var(--admin-radius-sm)] bg-[var(--admin-danger-soft)] p-3"
                >
                  <p className="text-sm text-[var(--admin-danger)]">{l.negativeExplanation}</p>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {/* THE PER-PERSON TABLE. */}
        <Card>
          <CardHeader
            title="Everyone's sick leave right now"
            subtitle="Earned and gifted kept apart, because only the earned column has to carry over at year end."
          />

          {summary.lines.length === 0 ? (
            <p className="text-sm text-[var(--admin-text-muted)]">
              No active employees are on file, so there are no balances to show.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--admin-border)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-muted)]">
                    <th className="pb-2 pr-4 font-medium">Employee</th>
                    <th className="pb-2 pr-4 text-right font-medium">Earned</th>
                    <th className="pb-2 pr-4 text-right font-medium">Gifted</th>
                    <th className="pb-2 pr-4 text-right font-medium">Available</th>
                    <th className="pb-2 text-right font-medium">Gifted, all time</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.lines.map((l: GenerosityLine) => (
                    <tr
                      key={l.employeeId}
                      className="border-b border-[var(--admin-border)] last:border-0"
                    >
                      <td className="py-2 pr-4 text-[var(--admin-text)]">
                        {l.employeeName}
                        {l.isNegative ? (
                          <span className="ml-2">
                            <Badge tone="danger">Below zero</Badge>
                          </span>
                        ) : null}
                      </td>
                      <td
                        className={`py-2 pr-4 text-right ${
                          l.statutoryMinutes < 0
                            ? "font-semibold text-[var(--admin-danger)]"
                            : "text-[var(--admin-text)]"
                        }`}
                      >
                        {hours(l.statutoryMinutes)}
                      </td>
                      <td
                        className={`py-2 pr-4 text-right ${
                          l.awardedMinutes < 0
                            ? "font-semibold text-[var(--admin-danger)]"
                            : "text-[var(--admin-text)]"
                        }`}
                      >
                        {hours(l.awardedMinutes)}
                      </td>
                      <td className="py-2 pr-4 text-right font-semibold text-[var(--admin-text)]">
                        {hours(l.totalMinutes)}
                      </td>
                      <td className="py-2 text-right text-[var(--admin-text-muted)]">
                        {l.awardedEverMinutes > 0 ? hours(l.awardedEverMinutes) : "\u2014"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-3 text-xs text-[var(--admin-text-muted)]">
            &ldquo;Available&rdquo; is earned plus gifted. When somebody takes leave, the earned
            hours are spent first &ndash; that is deliberate, and it is what stops a gift from
            turning into a permanent carryover obligation.
          </p>
        </Card>
      </div>

      {/* ══ RIGHT: the reason for the work ══════════════════════════════ */}
      <div className="space-y-6">
        <Card>
          <CardHeader
            title="Why you are on the legal minimum"
            subtitle="You said this was the easier way. It is also the safer way, and here is why."
          />
          <p className="text-xs text-[var(--admin-text-muted)]">
            Accruing at the floor and giving extra by hand keeps two things separate that
            look identical on a payslip: leave you OWE and leave you CHOSE to give. Only
            the leave you owe has to be carried into next year, up to forty hours.
          </p>
          <p className="mt-2 text-xs text-[var(--admin-text-muted)]">
            If you raised the accrual rate instead, the extra would become earned leave
            for everyone, automatically, forever &ndash; and it would carry over. Being kind
            once in March would cost you every January afterwards, and nothing on any
            screen would show you why the balances kept climbing.
          </p>
          <p className="mt-2 text-xs text-[var(--admin-text-muted)]">
            Giving it as a gift instead means you can be as generous as you like, on the
            day it is deserved, without signing up to anything permanent.
          </p>
        </Card>

        {/* THE VERBATIM SOURCE TEXT. Quoted, never paraphrased. */}
        <Card>
          <CardHeader
            title="The rules themselves, word for word"
            subtitle="Quoted exactly. The plain-English reading sits underneath, kept separate on purpose so you can always see which is the law and which is us."
          />
          <ul className="space-y-4">
            {SELECTED_AUTHORITY_IDS.map((id) => {
              const a = SICK_LEAVE_AUTHORITIES.find((x) => x.id === id);
              if (!a) return null;
              return (
                <li key={a.id}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                    {a.cite}
                  </p>
                  <blockquote className="mt-1 border-l-2 border-[var(--admin-accent)] pl-3 text-sm italic text-[var(--admin-text)]">
                    {a.quote}
                  </blockquote>
                  <p className="mt-1 text-xs text-[var(--admin-text-muted)]">{a.soWhat}</p>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card>
          <CardHeader
            title="Worth knowing about balances"
            subtitle="The two that explain what you are looking at."
          />
          <ul className="space-y-4">
            {SELECTED_LESSON_TOPICS.map((topic) => {
              const lesson = SICK_LEAVE_SCREEN_LESSONS.find((l) => l.topic === topic);
              if (!lesson) return null;
              return (
                <li key={lesson.topic}>
                  <p className="text-sm font-semibold text-[var(--admin-text)]">{lesson.topic}</p>
                  <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                    {lesson.plainEnglish}
                  </p>
                  <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                    <span className="font-semibold">Why it matters: </span>
                    {lesson.whyItMatters}
                  </p>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </div>
  );
}
