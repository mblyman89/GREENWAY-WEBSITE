"use client";

/**
 * src/components/admin/books/TimesheetWorkbench.tsx   (slice books-32)
 *
 * THE TIMESHEET SCREEN, WITH THE CPA SITTING NEXT TO IT.
 *
 * WHAT MICHAEL ASKED FOR, VERBATIM (standing rule 1)
 *
 *   "Please make this full pipeline end to end incredible simple to use. I want
 *    the same verbatim text, the same mentorship, the same guidance. I love how
 *    the system knows what I've done so far and what's still left to complete.
 *    I want this behavior here too, if there is a way to hold my hand here,
 *    then I'm all for it. It's another way to teach me the proper way, the way
 *    the enterprise players do it."
 *
 * So this screen is built the same way the company information screen is: the
 * left column is the work, the right column is the reason for the work. It is
 * not a tooltip - a tooltip is guidance you have to already suspect you need.
 *
 * THE ONE IDEA THIS SCREEN EXISTS TO PROTECT
 *
 * A biweekly pay period contains TWO workweeks, and overtime is owed per
 * WORKWEEK. 45 hours one week and 35 the next is 80 hours in total, and 5 of
 * them are overtime. A screen that shows one total for the period, and one
 * "is it over 40" test, underpays silently, every period, forever, and looks
 * perfectly correct while doing it. That is why the table below shows each
 * workweek on its own line BEFORE it shows a period total. The breakdown is not
 * a detail view: it is the evidence that the rule was followed.
 *
 * FOUR THINGS ON SCREEN AT ONCE, ON PURPOSE
 *
 *   1. THE PROGRESS PANEL - what is done, what is left, and the single next
 *      thing to do. Same vocabulary as the payroll onboarding tracker
 *      (standing rule 25: extend the pattern, do not invent a rival).
 *   2. THE PERIOD PICKER and the compute button.
 *   3. THE HOURS TABLE, workweek by workweek, with every refusal shown against
 *      the person it belongs to.
 *   4. THE LESSON, for whatever is selected, with the verbatim quote and the
 *      plain-English reading beside it.
 *
 * NOTHING ON THIS SCREEN COMPUTES ANYTHING
 *
 * Every number rendered here arrives from the server, from `timesheet-core.ts`.
 * There is no arithmetic in this file - not a multiplication, not a rounding,
 * not a "just divide by 100 for display". A second implementation of the
 * overtime rule living in a React component would eventually disagree with the
 * first, and the disagreement would surface on a paycheck. Formatting is done
 * by `formatHundredthHours` and `formatCents` imported from the engine, which
 * are the same functions the tests are written against.
 */

import { useMemo, useState, useTransition } from "react";

import { Badge, Button, Card, CardHeader, Select } from "@/components/admin/ui";
import {
  formatCents,
  formatHundredthHours,
  type TimesheetRefusalCode,
} from "@/lib/payroll/timesheet-core";
import {
  TIMESHEET_FIELD_LESSONS,
  TIMESHEET_REFUSAL_LESSONS,
  TIMESHEET_SCREEN_LESSONS,
  describeWorkweek,
  type TimesheetProgress,
} from "@/lib/payroll/timesheet-mentor";
import {
  TIMESHEET_AUTHORITIES,
  type TimesheetAuthority,
} from "@/lib/payroll/timesheet-authorities";
import type {
  EmployeeTimesheet,
  PayPeriodRow,
  TimesheetComputation,
} from "@/lib/payroll/timesheet-store";

/* ─────────────────────────────────────────────────────────────────────────
 * Props. Everything is DATA from the server. This component holds no
 * knowledge of its own, for the reason given in AuthorityPanel.tsx: "a
 * diagram that drifts from the engine is worse than no diagram: it teaches
 * the wrong thing with confidence."
 * ───────────────────────────────────────────────────────────────────────── */

export type TimesheetWorkbenchProps = {
  readonly periods: readonly PayPeriodRow[];
  readonly initialPeriodId: string | null;
  readonly progress: TimesheetProgress;
  readonly workweekAnchor: number | null;
  readonly workweekAtHour: number;
  readonly initialComputation: TimesheetComputation | null;
  readonly computeAction: (
    periodId: string,
  ) => Promise<
    { ok: true; computation: TimesheetComputation } | { ok: false; message: string }
  >;
  readonly approveAction: (
    periodId: string,
  ) => Promise<{ ok: boolean; message: string }>;
};

const LABEL =
  "text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]";

function authoritiesFor(ids: readonly string[]): TimesheetAuthority[] {
  // Resolve by lookup rather than by index, and DROP nothing silently: an id
  // that does not resolve would be a broken citation, and the gate in
  // timesheet-mentor.ts already fails the build for that. Here we simply do not
  // invent a placeholder for one.
  return ids
    .map((id) => TIMESHEET_AUTHORITIES.find((a) => a.id === id))
    .filter((a): a is TimesheetAuthority => Boolean(a));
}

/** The verbatim block. Someone else's words must never be mistaken for ours. */
function Quote({ authority }: { authority: TimesheetAuthority }) {
  return (
    <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
      <div className="flex items-center gap-2">
        <Badge tone={authority.kind === "regulation" ? "gold" : "green"}>
          {authority.kind === "regulation" ? "Federal regulation" : "Washington law"}
        </Badge>
        <span className="text-[0.7rem] text-[var(--admin-text-muted)]">
          {authority.cite}
        </span>
      </div>
      {/* ITALIC AND BORDERED: this is the source speaking, not us. */}
      <p className="mt-2 border-l-2 border-[var(--admin-gold)] pl-3 text-sm italic leading-relaxed text-[var(--admin-text)]">
        {authority.quote}
      </p>
      {/* OUTSIDE the quote block, plainly labelled as our reading of it. */}
      <p className={`${LABEL} mt-3`}>What that means for Greenway</p>
      <p className="text-sm leading-relaxed text-[var(--admin-text)]">
        {authority.soWhat}
      </p>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * The progress panel
 * ───────────────────────────────────────────────────────────────────────── */

function ProgressPanel({ progress }: { progress: TimesheetProgress }) {
  return (
    <Card>
      <CardHeader
        title={`Setup: ${progress.completeCount} of ${progress.totalCount} done`}
        subtitle={progress.summary}
      />
      <ol className="space-y-3">
        {progress.steps.map((step, i) => {
          const tone = step.complete
            ? "green"
            : step.blockedByPrerequisite
              ? "neutral"
              : "gold";
          return (
            <li key={step.key} className="flex gap-3">
              <div className="pt-0.5">
                <Badge tone={tone}>
                  {step.complete ? "Done" : step.blockedByPrerequisite ? "Waiting" : i + 1}
                </Badge>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--admin-text)]">
                  {step.label}
                </p>
                {/* WAITING IS NOT FAILING. A step blocked by a prerequisite is
                    not something Michael has done wrong, and it must not read
                    like a complaint. */}
                {step.blockedByPrerequisite && !step.complete ? (
                  <p className="text-sm text-[var(--admin-text-muted)]">
                    Waiting on an earlier step. Nothing to do here yet.
                  </p>
                ) : null}
                {step.outstanding.length > 0 ? (
                  <ul className="mt-1 space-y-1">
                    {step.outstanding.map((o) => (
                      <li key={o} className="text-sm text-[var(--admin-text-muted)]">
                        {o}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {progress.nextAction ? (
        <div className="mt-4 rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-3">
          <p className={LABEL}>Your next step</p>
          <p className="text-sm text-[var(--admin-text)]">{progress.nextAction}</p>
        </div>
      ) : (
        <p className="mt-4 text-sm text-[var(--admin-accent)]">
          Setup is complete. Hours can be computed and approved.
        </p>
      )}
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * One employee's row: the workweek breakdown FIRST, then the period total.
 * ───────────────────────────────────────────────────────────────────────── */

function EmployeeRow({ sheet }: { sheet: EmployeeTimesheet }) {
  const refused = sheet.refusals.length > 0;

  return (
    <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-[var(--admin-text)]">
            {sheet.employee.fullName}
          </p>
          <Badge tone={sheet.employee.flsaStatus === "exempt" ? "neutral" : "green"}>
            {sheet.employee.flsaStatus === "exempt"
              ? "Exempt - no overtime"
              : "Non-exempt - earns overtime"}
          </Badge>
        </div>
        {refused ? (
          <Badge tone="danger">
            {sheet.refusals.length}{" "}
            {sheet.refusals.length === 1 ? "problem" : "problems"} - not counted
          </Badge>
        ) : null}
      </div>

      {/* THE REFUSALS. Each one says what is wrong and what to do, never a
          code on its own. A refusal Michael cannot act on is just a wall. */}
      {refused ? (
        <ul className="mt-3 space-y-2">
          {sheet.refusals.map((r, i) => {
            const lesson = TIMESHEET_REFUSAL_LESSONS.find(
              (l) => l.code === (r.code as TimesheetRefusalCode),
            );
            return (
              <li
                key={`${r.code}-${r.subjectId ?? i}`}
                className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] p-3"
              >
                <p className="text-sm font-semibold text-[var(--admin-text)]">
                  {lesson ? lesson.headline : r.message}
                </p>
                <p className="mt-1 text-sm text-[var(--admin-text)]">{r.message}</p>
                <p className="mt-1 text-sm text-[var(--admin-text-muted)]">{r.fix}</p>
                {lesson ? (
                  <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
                    {lesson.whyWeStop}
                  </p>
                ) : null}
                <p className="mt-2 text-[11px] uppercase tracking-wide text-[var(--admin-text-muted)]">
                  {r.code}
                </p>
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* THE WORKWEEK BREAKDOWN. This is shown BEFORE the period total, and it
          is shown even when there is only one week, because the habit of
          reading hours a week at a time is the thing that keeps the overtime
          rule visible. */}
      {sheet.hours ? (
        <>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--admin-text-muted)]">
                <th className="py-1 font-medium">Workweek</th>
                <th className="py-1 text-right font-medium">Regular</th>
                <th className="py-1 text-right font-medium">Overtime</th>
                <th className="py-1 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {sheet.hours.weeks.map((w) => (
                <tr key={w.index} className="border-t border-[var(--admin-border)]">
                  <td className="py-1 text-[var(--admin-text)]">
                    {w.startDate} to {w.endDate}
                    {/* A PARTIAL WEEK IS SAID OUT LOUD. A pay period that starts
                        mid-workweek shows fewer than 7 days here, and the hours
                        from the other part of that same workweek sit in the
                        NEIGHBOURING period. Overtime is still owed on the whole
                        week, so this label is a warning, not decoration. */}
                    {w.isPartial ? (
                      <span className="ml-2 text-[var(--admin-gold)]">
                        part of a workweek that continues outside this period
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1 text-right tabular-nums text-[var(--admin-text)]">
                    {formatHundredthHours(w.regularHundredthHours)}
                  </td>
                  <td className="py-1 text-right tabular-nums text-[var(--admin-text)]">
                    {w.overtimeHundredthHours > 0 ? (
                      <span className="text-[var(--admin-gold)]">
                        {formatHundredthHours(w.overtimeHundredthHours)}
                      </span>
                    ) : (
                      formatHundredthHours(0)
                    )}
                  </td>
                  <td className="py-1 text-right tabular-nums text-[var(--admin-text)]">
                    {formatHundredthHours(w.totalHundredthHours)}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-[var(--admin-border)] font-semibold">
                <td className="py-1 text-[var(--admin-text)]">Period total</td>
                <td className="py-1 text-right tabular-nums text-[var(--admin-text)]">
                  {formatHundredthHours(sheet.hours.regularHundredthHours)}
                </td>
                <td className="py-1 text-right tabular-nums text-[var(--admin-text)]">
                  {formatHundredthHours(sheet.hours.overtimeHundredthHours)}
                </td>
                {/* The engine's own total, NOT regular+overtime added up here.
                    Re-deriving it in the view would be a second implementation
                    that agrees today and drifts later. */}
                <td className="py-1 text-right tabular-nums text-[var(--admin-text)]">
                  {formatHundredthHours(sheet.hours.totalHundredthHours)}
                </td>
              </tr>
            </tbody>
          </table>

          {/* THE §778.110(a) SPLIT, SHOWN THE WAY THE REGULATION COMPUTES IT:
              straight time on every hour worked, PLUS one-half the rate on the
              hours over forty. Michael will have to reconcile these figures to
              a Form 941 one day, and a single "gross" number cannot be checked
              against anything. */}
          <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
            Straight time on all hours {formatCents(sheet.hours.straightTimeCents)}
            {" + "}
            the extra half-rate on the overtime hours{" "}
            {formatCents(sheet.hours.overtimePremiumCents)} = gross for this period{" "}
            <span className="font-semibold text-[var(--admin-text)]">
              {formatCents(sheet.hours.grossCents)}
            </span>
          </p>

          {/* A partial workweek can UNDER-report overtime, because the rest of
              that same workweek sits in the neighbouring pay period. The engine
              writes the warning; the screen must not swallow it. */}
          {sheet.hours.partialWeekWarning ? (
            <div className="mt-3 rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] p-3">
              <p className={LABEL}>A workweek is split across two pay periods</p>
              <p className="text-sm text-[var(--admin-text)]">
                {sheet.hours.partialWeekWarning}
              </p>
            </div>
          ) : null}

          {/* THE VARIANCE (standing rule 63d). The time clock stores a
              `minutes` column AND the two timestamps. When they disagree the
              disagreement is PRINTED rather than reconciled, because whichever
              one this system silently preferred would be wrong sometimes. */}
          {sheet.hours.variances.length > 0 ? (
            <div className="mt-3 rounded-[var(--admin-radius)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange-soft)] p-3">
              <p className={LABEL}>
                The stored minutes and the clock times do not agree
              </p>
              <p className="text-sm text-[var(--admin-text)]">
                The engine used the clock times. These punches are worth a look
                before you approve - the difference is shown so you can see
                exactly how big it is rather than being told there is &ldquo;a
                discrepancy&rdquo;.
              </p>
              <ul className="mt-2 space-y-1">
                {sheet.hours.variances.map((v) => (
                  <li key={v.punchId} className="text-sm text-[var(--admin-text-muted)]">
                    Punch {v.punchId}: stored {v.storedMinutes} minutes, clock times
                    say {v.computedMinutes} minutes, a difference of{" "}
                    {v.varianceMinutes} minutes.
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * The workbench
 * ───────────────────────────────────────────────────────────────────────── */

export function TimesheetWorkbench({
  periods,
  initialPeriodId,
  progress,
  workweekAnchor,
  workweekAtHour,
  initialComputation,
  computeAction,
  approveAction,
}: TimesheetWorkbenchProps) {
  const [periodId, setPeriodId] = useState<string>(initialPeriodId ?? "");
  const [computation, setComputation] = useState<TimesheetComputation | null>(
    initialComputation,
  );
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [topic, setTopic] = useState<string>(
    TIMESHEET_SCREEN_LESSONS[0]?.topic ?? "",
  );

  const selectedPeriod = useMemo(
    () => periods.find((p) => p.id === periodId) ?? null,
    [periods, periodId],
  );

  const lesson = useMemo(
    () => TIMESHEET_SCREEN_LESSONS.find((l) => l.topic === topic) ?? null,
    [topic],
  );

  const approved =
    selectedPeriod?.status === "approved" || selectedPeriod?.status === "locked";
  const locked = selectedPeriod?.status === "locked";

  function onCompute() {
    setMessage(null);
    startTransition(async () => {
      const res = await computeAction(periodId);
      if (!res.ok) {
        setComputation(null);
        setMessage({ ok: false, text: res.message });
        return;
      }
      setComputation(res.computation);
      setMessage(null);
    });
  }

  function onApprove() {
    setMessage(null);
    startTransition(async () => {
      const res = await approveAction(periodId);
      setMessage({ ok: res.ok, text: res.message });
      if (res.ok) {
        const again = await computeAction(periodId);
        if (again.ok) setComputation(again.computation);
      }
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      {/* ── THE WORK ─────────────────────────────────────────────────── */}
      <div className="space-y-6">
        <Card>
          <CardHeader
            title="Choose a pay period"
            subtitle={describeWorkweek(
              workweekAnchor as Parameters<typeof describeWorkweek>[0],
              workweekAtHour,
            )}
          />

          {periods.length === 0 ? (
            <p className="text-sm text-[var(--admin-text-muted)]">
              There are no pay periods on the calendar for this year yet. Until they
              exist there is nothing to add hours up for. Nothing is wrong - this is
              simply the step before this one.
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[18rem] flex-1">
                <label className={LABEL} htmlFor="period">
                  Pay period
                </label>
                <Select
                  id="period"
                  value={periodId}
                  onChange={(e) => {
                    setPeriodId(e.target.value);
                    // The old numbers belong to the old period. Leaving them on
                    // screen under a new heading is how the wrong period gets
                    // approved.
                    setComputation(null);
                    setMessage(null);
                  }}
                >
                  <option value="">Select a pay period...</option>
                  {periods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} ({p.start_date} to {p.end_date}) - {p.status}
                    </option>
                  ))}
                </Select>
              </div>

              <Button onClick={onCompute} disabled={pending || !periodId}>
                {pending ? "Working..." : "Add up the hours"}
              </Button>

              <Button
                variant="confirm"
                onClick={onApprove}
                disabled={
                  pending ||
                  !periodId ||
                  !computation ||
                  computation.refusedCount > 0 ||
                  approved
                }
              >
                {locked
                  ? "Locked"
                  : approved
                    ? "Already approved"
                    : "Approve these hours"}
              </Button>
            </div>
          )}

          {message ? (
            <p
              className={`mt-3 text-sm ${
                message.ok
                  ? "text-[var(--admin-accent)]"
                  : "text-[var(--admin-danger)]"
              }`}
            >
              {message.text}
            </p>
          ) : null}

          {/* WHY THE BUTTON IS OFF. A disabled control with no explanation is
              the exact Sage behaviour Michael objected to. */}
          {!pending && computation && computation.refusedCount > 0 && !approved ? (
            <p className="mt-3 text-sm text-[var(--admin-text-muted)]">
              Approval is switched off because {computation.refusedCount}{" "}
              {computation.refusedCount === 1 ? "employee has" : "employees have"}{" "}
              time-clock problems listed below. Fix those on the time-clock screen,
              add the hours up again, and the button will come back on.
            </p>
          ) : null}

          {locked ? (
            <p className="mt-3 text-sm text-[var(--admin-text-muted)]">
              This period is locked. A period locks once payroll has been filed
              against it, and the lock is what keeps the filed return and the
              underlying records in agreement.
            </p>
          ) : null}
        </Card>

        {computation ? (
          <Card>
            <CardHeader
              title={`Hours for ${computation.period.label}`}
              subtitle={`${computation.period.start_date} to ${computation.period.end_date}. Each workweek is shown on its own line, because overtime is owed a week at a time.`}
            />

            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-3">
                <p className={LABEL}>Regular hours</p>
                <p className="text-lg font-semibold tabular-nums text-[var(--admin-text)]">
                  {formatHundredthHours(computation.totalRegularHundredthHours)}
                </p>
              </div>
              <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-3">
                <p className={LABEL}>Overtime hours</p>
                <p className="text-lg font-semibold tabular-nums text-[var(--admin-gold)]">
                  {formatHundredthHours(computation.totalOvertimeHundredthHours)}
                </p>
              </div>
              <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-3">
                <p className={LABEL}>Gross pay</p>
                <p className="text-lg font-semibold tabular-nums text-[var(--admin-text)]">
                  {formatCents(computation.totalGrossCents)}
                </p>
              </div>
            </div>

            {/* THE TOTALS EXCLUDE ANYONE REFUSED, AND SAY SO. A total that
                quietly omits people is worse than no total. */}
            {computation.refusedCount > 0 ? (
              <p className="mb-4 text-sm text-[var(--admin-danger)]">
                These totals leave out {computation.refusedCount}{" "}
                {computation.refusedCount === 1 ? "employee" : "employees"} whose
                punches the system will not guess its way past. They are listed
                below with what to do. Do not treat the figures above as the
                period&rsquo;s payroll until that count is zero.
              </p>
            ) : null}

            <div className="space-y-3">
              {computation.sheets.map((s) => (
                <EmployeeRow key={s.employee.employeeId} sheet={s} />
              ))}
            </div>
          </Card>
        ) : null}
      </div>

      {/* ── THE REASON FOR THE WORK ──────────────────────────────────── */}
      <div className="space-y-6">
        <ProgressPanel progress={progress} />

        <Card>
          <CardHeader
            title="Your CPA, on this screen"
            subtitle="Pick a topic. Every claim below carries the source it comes from."
          />
          <Select
            aria-label="Choose a topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          >
            {TIMESHEET_SCREEN_LESSONS.map((l) => (
              <option key={l.topic} value={l.topic}>
                {l.topic}
              </option>
            ))}
          </Select>

          {lesson ? (
            <div className="mt-3 space-y-3 text-sm">
              <div>
                <p className={LABEL}>In plain English</p>
                <p className="leading-relaxed text-[var(--admin-text)]">
                  {lesson.plainEnglish}
                </p>
              </div>
              <div>
                <p className={LABEL}>Why it matters to you</p>
                <p className="leading-relaxed text-[var(--admin-text)]">
                  {lesson.whyItMatters}
                </p>
              </div>
              {authoritiesFor(lesson.authorityIds).map((a) => (
                <Quote key={a.id} authority={a} />
              ))}
            </div>
          ) : null}
        </Card>

        <Card>
          <CardHeader
            title="What each setting means"
            subtitle="The fields behind this screen, and the filings that read them."
          />
          <div className="space-y-4">
            {TIMESHEET_FIELD_LESSONS.map((l) => (
              <details key={l.field} className="group">
                <summary className="cursor-pointer text-sm font-semibold text-[var(--admin-text)]">
                  {l.field}
                </summary>
                <div className="mt-2 space-y-2 text-sm">
                  <div>
                    <p className={LABEL}>What it is</p>
                    <p className="text-[var(--admin-text)]">{l.whatItIs}</p>
                  </div>
                  <div>
                    <p className={LABEL}>Where it is used</p>
                    <p className="text-[var(--admin-text)]">{l.whereItIsUsed}</p>
                  </div>
                  <div>
                    <p className={LABEL}>Why it matters</p>
                    <p className="text-[var(--admin-text)]">{l.whyItMatters}</p>
                  </div>
                  <div>
                    <p className={LABEL}>The trap</p>
                    <p className="text-[var(--admin-text)]">{l.theTrap}</p>
                  </div>
                  <div>
                    <p className={LABEL}>How to be sure</p>
                    <p className="text-[var(--admin-text)]">{l.howToBeSure}</p>
                  </div>
                </div>
              </details>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
