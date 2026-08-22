"use client";

/**
 * src/components/admin/books/YtdBoard.tsx   (books-37)
 *
 * WHERE EVERY EMPLOYEE STANDS FOR THE YEAR.
 *
 * WHY THIS SCREEN EXISTS
 *
 * `ytd-mentor.ts` has been 1,052 lines of careful teaching since books-34 and
 * no human being could reach a word of it. The accumulator table existed, the
 * pure engine existed, the authorities were mirrored and verbatim-checked - and
 * there was no page. Standing rule 50, dead code wearing a green check, and it
 * is the second-largest instance found in this repository after the garnishment
 * engine that books-36 finally surfaced.
 *
 * WHAT THE SCREEN IS ACTUALLY FOR
 *
 * Year-to-date is not a report. It is an INPUT. The Social Security ceiling and
 * the Additional Medicare threshold are annual tests, and a single pay run
 * looked at on its own cannot apply them - it has no idea what the employee has
 * already been paid. Until books-37, the one place in the app that computed
 * taxes passed a zeroed year-to-date record on every single call. For an
 * employee below the wage base that produces the right answer all year, which
 * is exactly why nothing ever looked wrong.
 *
 * So the column that matters most here is the ROOM REMAINING against the wage
 * base. It is the number that tells Michael when somebody's Social Security
 * withholding is about to stop - and therefore when their take-home, and any
 * garnishment measured against it, is about to jump for a reason that is
 * correct and will look alarming.
 *
 * ACTIVE EMPLOYEES ONLY, AND THE COUNT THAT IS NOT SHOWN
 *
 * Michael's instruction, verbatim: "The 16 inactive employees are no longer
 * working for me. I will keep their data in my sage backups, I only need the
 * active employees I currently have." So the board lists active staff. But
 * "the screen shows 8 people and the 941 shows 11" is a frightening thing to
 * discover in April, so the number of rows excluded is reported rather than
 * silently dropped. Nothing is deleted from the database.
 *
 * A FIELD PATH THAT WAS GUESSED, AND CAUGHT
 *
 * The first draft of this table read `row.oasdiWagesCents`. The real shape
 * nests the seven wage measures under `row.wages`, because there are seven
 * different legal definitions of "wages" and `ytd-core.ts` deliberately refuses
 * to offer a single field called `ytdWagesCents`. The compiler caught it. It is
 * recorded here because the lesson is the general one: a field name recalled
 * from a sibling type is a GUESS, and standing rule 1 does not make an
 * exception for field names.
 *
 * NOTHING ON THIS SCREEN COMPUTES ANYTHING. Every figure was produced by
 * `ytd-store.ts` over `ytd-core.ts`. This file formats and arranges; its only
 * arithmetic is cents-to-dollars for display.
 */

import { AuthorityPanel } from "@/components/admin/books/AuthorityPanel";
import { Badge, Card, CardHeader } from "@/components/admin/ui";
import { YTD_SCREEN_LESSONS, YTD_YEAR_END_CHECKS } from "@/lib/payroll/ytd-mentor";
import type { YtdBoard as YtdBoardData } from "@/lib/payroll/ytd-store";

export type YtdBoardProps = {
  readonly board: YtdBoardData;
};

/**
 * Cents as dollars, for DISPLAY only.
 *
 * The sign is preserved deliberately. A negative figure must READ as negative
 * rather than being tidied into a plausible-looking positive.
 */
function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * The authorities that decide what this screen is showing.
 *
 * Three, not thirty. Michael asked not to get lost in guidance helpers, and a
 * wall of regulation reads the same as no guidance at all. These three are the
 * ceiling itself, the deliberate ABSENCE of a Medicare ceiling, and the IRS's
 * own worked example - which is also the engine's test oracle.
 *
 * Resolved against the real registry by the screen test, so a typo cannot
 * silently render a blank card.
 */
const SELECTED_AUTHORITY_IDS = [
  "w2-box3-wage-base-ceiling",
  "w2-box5-no-medicare-limit",
  "w2-worked-example-199750",
] as const;

/**
 * The lessons worth having on THIS screen.
 *
 * Selected by topic rather than by index, because an index silently points at a
 * different lesson the moment somebody inserts one above it. The screen test
 * asserts each of these topics resolves to exactly one real lesson, so a
 * mistyped string fails a build rather than quietly rendering nothing.
 */
const SELECTED_LESSON_TOPICS = [
  "The one idea this whole table exists to protect: a ceiling you cannot see is a ceiling you cannot stop at",
  "One salary, two different wage figures on the same W-2, and both are right",
] as const;

export function YtdBoard({ board }: YtdBoardProps) {
  const lessons = YTD_SCREEN_LESSONS.filter((l) =>
    (SELECTED_LESSON_TOPICS as readonly string[]).includes(l.topic),
  );
  const atCeiling = board.lines.filter((l) => l.oasdiCeilingReached);
  const neverPaid = board.lines.filter((l) => l.neverPaidThisYear);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      {/* ══ LEFT: the work ═══════════════════════════════════════════════ */}
      <div className="space-y-6">
        {/* THE CAVEAT COMES FIRST, IF THERE IS ONE. A figure computed against
            a wage base from a different year is not wrong, but it is not what
            a reader will assume, and burying that under the table is exactly
            the silent drift this codebase refuses to ship. */}
        {board.wageBaseCaveat ? (
          <Card>
            <CardHeader title="About the Social Security ceiling used on this page" />
            <p className="text-sm text-[var(--admin-orange)]">{board.wageBaseCaveat}</p>
          </Card>
        ) : null}

        <Card>
          <CardHeader
            title={`Where everybody stands for ${board.taxYear}`}
            subtitle="Wages and tax withheld so far this calendar year, per employee, and how much room is left before Social Security withholding stops."
            action={
              atCeiling.length > 0 ? (
                <Badge tone="gold">{atCeiling.length} at the ceiling</Badge>
              ) : (
                <Badge tone="neutral">Nobody at the ceiling yet</Badge>
              )
            }
          />

          {board.lines.length === 0 ? (
            <p className="text-sm text-[var(--admin-text-muted)]">
              No active employees have year-to-date figures for {board.taxYear} yet. That is
              the expected state before the first pay run of the year - the first run
              creates each employee&rsquo;s row.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-wide text-white/40">
                    <th className="py-2 pr-3 font-semibold">Employee</th>
                    <th className="py-2 pr-3 text-right font-semibold">
                      Social Security wages
                    </th>
                    <th className="py-2 pr-3 text-right font-semibold">Medicare wages</th>
                    <th className="py-2 pr-3 text-right font-semibold">Room left</th>
                    <th className="py-2 pr-3 text-right font-semibold">Fed. tax withheld</th>
                    <th className="py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {board.lines.map((l) => (
                    <tr
                      key={l.employeeId}
                      className="border-b border-white/[0.06] text-[var(--admin-text)]"
                    >
                      <td className="py-2 pr-3">{l.employeeName}</td>
                      {/* `row.wages`, NOT `row`. Seven wage definitions, seven
                          fields, and no single "wages" figure on purpose. */}
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {money(l.row.wages.oasdiWagesCents)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {money(l.row.wages.medicareWagesCents)}
                      </td>
                      {/* THE COLUMN THIS SCREEN EXISTS FOR. */}
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {l.oasdiCeilingReached ? (
                          <span className="text-[var(--admin-accent)]">Ceiling reached</span>
                        ) : (
                          money(l.oasdiRoomCents)
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {money(l.row.federalIncomeTaxCents)}
                      </td>
                      <td className="py-2">
                        {l.neverPaidThisYear ? (
                          <Badge tone="outline">Not paid this year</Badge>
                        ) : l.oasdiCeilingReached ? (
                          <Badge tone="gold">Social Security stopped</Badge>
                        ) : (
                          <Badge tone="green">Accruing</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* WHAT IS NOT ON THIS PAGE, SAID OUT LOUD. Two different kinds of
            absence, and both are the sort of thing that is alarming to
            discover later rather than to be told now. */}
        {board.inactiveRowsNotShown > 0 || neverPaid.length > 0 ? (
          <Card>
            <CardHeader title="What this page is not showing you" />
            <ul className="space-y-2 text-sm text-[var(--admin-text-muted)]">
              {board.inactiveRowsNotShown > 0 ? (
                <li>
                  <strong className="text-[var(--admin-text)]">
                    {board.inactiveRowsNotShown} row
                    {board.inactiveRowsNotShown === 1 ? "" : "s"} for former employees
                  </strong>{" "}
                  {board.inactiveRowsNotShown === 1 ? "is" : "are"} excluded, because you asked
                  to see only current staff. Nothing has been deleted - those figures still
                  belong on the year&rsquo;s W-2s and quarterly returns, so the totals on this
                  page will be smaller than the totals on a 941.
                </li>
              ) : null}
              {neverPaid.length > 0 ? (
                <li>
                  <strong className="text-[var(--admin-text)]">
                    {neverPaid.length} active employee
                    {neverPaid.length === 1 ? " has" : "s have"} no figures for {board.taxYear}
                  </strong>{" "}
                  at all. That is different from having zero - it means no pay run has
                  touched them this year. Worth a look if you expected otherwise.
                </li>
              ) : null}
            </ul>
          </Card>
        ) : null}

        {/* THE PRE-FILING CHECKLIST. Six checks, and the ORDER is the point:
            everything after the first is only meaningful once the totals have
            been proven to match the lines beneath them. This list has existed
            in `ytd-mentor.ts` since books-34 with no way to read it. */}
        <Card>
          <CardHeader
            title="Before any W-2 leaves this building"
            subtitle="Six checks, in order. Each one is only meaningful after the one above it has passed - checking a wage base against a figure that has drifted tells you about the drift, not about the wage base."
          />
          <ol className="space-y-4 text-sm">
            {YTD_YEAR_END_CHECKS.map((c, i) => (
              <li key={c.key} className="border-l-2 border-white/10 pl-4">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-[11px] font-semibold tabular-nums text-white/40">
                    {i + 1}
                  </span>
                  <span className="font-medium text-[var(--admin-text)]">{c.label}</span>
                  {c.blocksFiling ? (
                    <Badge tone="danger">Stops the W-2</Badge>
                  ) : (
                    <Badge tone="outline">Worth confirming</Badge>
                  )}
                </div>
                <p className="mt-1 text-[var(--admin-text-muted)]">{c.theCheck}</p>
                <p className="mt-1 text-[var(--admin-text-muted)]">
                  <span className="text-white/50">If it fails: </span>
                  {c.ifItFails}
                </p>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      {/* ══ RIGHT: the teaching ══════════════════════════════════════════ */}
      <aside className="space-y-6">
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

        <AuthorityPanel
          ids={SELECTED_AUTHORITY_IDS}
          intro="The exact words behind the ceiling on this page, quoted verbatim from the IRS's own instructions and checked against the mirrored source on every commit."
        />
      </aside>
    </div>
  );
}
