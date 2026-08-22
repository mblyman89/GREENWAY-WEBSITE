/**
 * src/app/admin/books/timesheets/page.tsx   (slice books-32)
 *
 * TIMESHEETS - punches in, payable hours out, with the overtime rule visible.
 *
 * WHAT MICHAEL ASKED FOR, VERBATIM (standing rule 1)
 *
 *   "Please make this full pipeline end to end incredible simple to use. I want
 *    the same verbatim text, the same mentorship, the same guidance. I love how
 *    the system knows what I've done so far and what's still left to complete.
 *    I want this behavior here too... I want to be on the same level as a
 *    seasoned expert cpa."
 *
 *   "Test everything, heavily. We can not mess up payroll and its reporting and
 *    payments. This one will bankrupt me if we aren't careful."
 *
 * THE DEFECT THIS WHOLE SLICE EXISTS TO PREVENT
 *
 * A biweekly pay period contains TWO workweeks. 29 CFR §778.104 says each
 * workweek stands alone and hours may not be averaged across weeks. So 45 hours
 * followed by 35 hours is 80 hours in total AND five hours of overtime. An
 * engine that asks "is the period total over 80?" answers "no" and underpays,
 * silently, every period, forever, on a screen that looks perfectly correct.
 * Everything here - the per-workweek table, the partial-week warning, the
 * refusals - is arranged so that failure cannot happen quietly.
 *
 * THE GATE
 *
 * `requireBooksAccess()` - `is_owner()` in application form. It is called here
 * AND again inside both server actions, because a server action is a public
 * endpoint reachable without ever loading this page. The store runs as the
 * service role and therefore bypasses the owner-only RLS policies migration
 * 0197 puts on `pay_periods` entirely; these calls are the real gate.
 *
 * WHY THE PAGE COMPUTES NOTHING ON LOAD WHEN NOTHING IS SELECTED
 *
 * Adding up hours for a period nobody asked about is wasted work, and worse, it
 * puts numbers on screen that Michael did not request and may not realise are
 * stale. The page loads the calendar and the progress panel; the hours arrive
 * when he asks for them.
 *
 * WHAT THE NEXT SLICES DO WITH THIS (standing rule 62e)
 *
 *   - The PAY RUN builder reads the approved regular/overtime split from
 *     `pay_periods` + the engine, instead of asking Michael to type a gross
 *     figure by hand as it does today.
 *   - The FORM 941 builder reads pay_periods.quarter and tax_year to decide
 *     which wages belong to which quarter.
 *   - The WASHINGTON quarterly reports (ESD and L&I) read the HOURS, not the
 *     money: RCW 50.12.070 asks for hours worked per employee and L&I charges
 *     premium per hour worked, which is why hours survive as integers all the
 *     way through.
 */

import { Card, CardHeader } from "@/components/admin/ui";
import { TimesheetWorkbench } from "@/components/admin/books/TimesheetWorkbench";
import { requireBooksAccess } from "@/lib/accounting/books-access";
import {
  loadPayPeriods,
  loadTimesheetProgress,
  loadWorkweekSettings,
} from "@/lib/payroll/timesheet-store";

import { approvePayPeriodAction, computeTimesheetAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function TimesheetsPage({
  searchParams,
}: {
  searchParams?: Promise<{ year?: string; period?: string }>;
}) {
  await requireBooksAccess();

  const sp = (await searchParams) ?? {};

  // The tax year comes from the URL when present and otherwise from the clock.
  // It is NOT defaulted to a hardcoded year: Michael's first payroll is
  // 2027-01-01 and this screen will still be here in 2031.
  const parsedYear = Number.parseInt(sp.year ?? "", 10);
  const taxYear = Number.isFinite(parsedYear)
    ? parsedYear
    : new Date().getUTCFullYear();

  const selectedPeriodId = sp.period ?? null;

  const settings = await loadWorkweekSettings();
  const periodsRes = await loadPayPeriods(taxYear);
  const progressRes = await loadTimesheetProgress(taxYear, selectedPeriodId);

  // A read failure is reported as a read failure. It is never rendered as an
  // empty calendar, because "no pay periods exist" and "the pay periods could
  // not be read" look identical on screen and mean opposite things.
  const failure = !settings.ok
    ? settings.message
    : !periodsRes.ok
      ? periodsRes.message
      : !progressRes.ok
        ? progressRes.message
        : null;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--admin-text)]">
          Timesheets and overtime
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--admin-text-muted)]">
          Time-clock punches become payable hours here. Overtime is worked out one
          workweek at a time, never by averaging a two-week period, because federal
          law does not allow the averaging and the difference is real money. Nothing
          on this screen is written to your books until you approve it.
        </p>
      </div>

      {failure ? (
        <Card>
          <CardHeader title="This screen could not load its data" />
          <p className="text-sm text-[var(--admin-danger)]">{failure}</p>
          <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
            No hours were computed and nothing was changed. This is a problem with
            reading the records, not with your data.
          </p>
        </Card>
      ) : settings.ok && periodsRes.ok && progressRes.ok ? (
        <TimesheetWorkbench
          periods={periodsRes.periods}
          initialPeriodId={selectedPeriodId}
          progress={progressRes.progress}
          workweekAnchor={settings.workweekStartsOn}
          workweekAtHour={settings.workweekStartsAtHour}
          initialComputation={null}
          computeAction={computeTimesheetAction}
          approveAction={approvePayPeriodAction}
        />
      ) : null}
    </div>
  );
}
