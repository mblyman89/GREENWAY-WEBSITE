import { requirePermission } from "@/lib/auth/session";
import { pacificToday } from "@/lib/reports/timezone";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Badge, Button, Card, CardHeader, Field, Input, Select } from "@/components/admin/ui";
import { CalculateOnlyBanner, PayrollCenterNav } from "@/components/admin/payroll-center/PayrollCenterNav";
import {
  WEEKDAY_LONG,
  periodsPerYear,
  scheduleNow,
  shortDay,
  weekdayName,
  workweekAdvice,
} from "@/lib/payroll/pay-schedule-core";
import { loadPaySchedule, loadWorkweek, planYearAgainstCalendar, type YearPlan } from "@/lib/payroll/pay-schedule-store";
import { generatePeriodsAction, savePayScheduleAction, saveWorkweekAction } from "../actions";

/**
 * D248 slice 1 - pay schedule & calendar (owner + admin).
 *
 * Owner (verbatim): "I need a way to set the pay Friday and pay period."
 *
 * Set ONE payday, the cadence and the lag; the page previews the whole year
 * (holiday moves flagged) against the calendar on file and adds the missing
 * periods as PLANNED. Existing periods are never changed here.
 */

export const dynamic = "force-dynamic";

const fmt = (iso: string) => `${weekdayName(iso).slice(0, 3)} ${shortDay(iso)}`;

export default async function PayScheduleSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string; year?: string }>;
}) {
  await requirePermission("settings.manage");
  const sp = await searchParams;
  const today = pacificToday();
  const thisYear = Number(today.slice(0, 4));
  const yearParam = Number(sp.year);
  const year = Number.isInteger(yearParam) && yearParam >= 2024 && yearParam <= 2035 ? yearParam : thisYear + 1;

  let failure: string | null = null;
  let schedule: Awaited<ReturnType<typeof loadPaySchedule>> = null;
  let workweek: Awaited<ReturnType<typeof loadWorkweek>> | null = null;
  let plan: YearPlan | null = null;
  if (isSupabaseServiceConfigured) {
    try {
      [schedule, workweek] = await Promise.all([loadPaySchedule(), loadWorkweek()]);
      if (schedule) plan = await planYearAgainstCalendar(schedule, year);
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    }
  } else {
    failure = "The database is not connected on this server.";
  }
  const now = schedule ? scheduleNow(schedule, today) : null;
  const advice = schedule && workweek ? workweekAdvice(schedule, workweek.startsOn) : null;
  const newCount = plan?.verdicts.filter((v) => v.kind === "new").length ?? 0;

  return (
    <div>
      <AdminPageHeader
        title="Pay schedule & calendar"
        subtitle="Set the pay Friday and the pay period once; every pay period of the year follows from it."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Admin", href: "/admin" },
              { label: "Payroll command center", href: "/admin/payroll-center" },
              { label: "Pay schedule" },
            ]}
          />
        }
      />
      <div className="space-y-6 px-5 py-6 sm:px-8" data-testid="pay-schedule-page">
        <PayrollCenterNav current="schedule" />
        <CalculateOnlyBanner />
        {sp.msg ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-text)]">{sp.msg}</div>
        ) : null}
        {sp.error ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]">{sp.error}</div>
        ) : null}
        {failure ? (
          <Card>
            <CardHeader title="This screen could not load" />
            <p className="text-sm text-[var(--admin-danger)]">{failure}</p>
          </Card>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* 1. The schedule */}
          <Card>
            <CardHeader
              title="1. Pay schedule"
              subtitle="One real payday is enough; every other payday is that date plus whole periods."
            />
            <form action={savePayScheduleAction} className="space-y-4" data-testid="pay-schedule-form">
              <Field label="How often you pay" required>
                <Select name="frequency" defaultValue={schedule?.frequency ?? ""} required>
                  <option value="" disabled>
                    Choose…
                  </option>
                  <option value="biweekly">Every two weeks (26 or 27 paydays a year)</option>
                  <option value="weekly">Every week (52 or 53 paydays a year)</option>
                </Select>
              </Field>
              <Field label="One payday (the pay Friday)" help="Any real payday, past or future, e.g. this period's payday." required>
                <Input type="date" name="anchor_pay_date" defaultValue={schedule?.anchorPayDate ?? ""} required />
              </Field>
              <Field
                label="Days from the end of the period to payday"
                help="Period ends Saturday and you pay the following Friday = 6. Paid on the last day of the period = 0."
                required
              >
                <Input type="number" name="lag_days" min={0} max={31} step={1} defaultValue={schedule ? String(schedule.lagDays) : ""} required />
              </Field>
              <Field label="When payday is a bank holiday" required>
                <Select name="holiday_rule" defaultValue={schedule?.holidayRule ?? ""} required>
                  <option value="" disabled>
                    Choose…
                  </option>
                  <option value="pay_banking_day_before">Pay on the banking day before (usual)</option>
                  <option value="keep_date_and_flag">Keep the date and flag it</option>
                </Select>
              </Field>
              <Button type="submit" variant="save">
                Save pay schedule
              </Button>
              {schedule?.updatedAt ? (
                <p className="text-xs text-[var(--admin-text-muted)]">Last saved {schedule.updatedAt.slice(0, 16).replace("T", " ")} UTC.</p>
              ) : null}
            </form>
          </Card>

          {/* 2. Workweek */}
          <Card>
            <CardHeader
              title="2. Workweek"
              subtitle="Overtime is owed per workweek (over 40 hours in that week), never averaged over a pay period."
            />
            <form action={saveWorkweekAction} className="space-y-4" data-testid="workweek-form">
              <Field label="Your workweek starts on" required>
                <Select
                  name="workweek_starts_on"
                  defaultValue={workweek?.startsOn != null ? String(workweek.startsOn) : advice ? String(advice.suggested) : ""}
                  required
                >
                  <option value="" disabled>
                    Choose…
                  </option>
                  {WEEKDAY_LONG.map((d, i) => (
                    <option key={d} value={String(i)}>
                      {d} at midnight
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Takes effect" help="The first day this workweek applies." required>
                <Input type="date" name="workweek_effective_date" defaultValue={workweek?.effectiveDate ?? (now ? now.current.startDate : "")} required />
              </Field>
              <Button type="submit" variant="save">
                Save workweek
              </Button>
              <p className="text-xs text-[var(--admin-text-muted)]">
                Now: {workweek?.startsOn != null ? `starts ${WEEKDAY_LONG[workweek.startsOn]}` : "not set (the timesheet engine will not count overtime until it is)"}.
              </p>
              {advice ? (
                <p className={`text-xs ${advice.agrees === false ? "text-[var(--admin-orange)]" : "text-[var(--admin-text-muted)]"}`} data-testid="workweek-advice">
                  {advice.message}
                </p>
              ) : null}
            </form>
          </Card>
        </div>

        {/* Today */}
        {now ? (
          <Card>
            <CardHeader title="Today" />
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <div className="text-xs text-[var(--admin-text-muted)]">Previous period</div>
                {fmt(now.previous.startDate)} – {fmt(now.previous.endDate)} · paid {fmt(now.previous.payDate)}
              </div>
              <div>
                <div className="text-xs text-[var(--admin-text-muted)]">Current period (day {now.dayOfPeriod} of {now.periodLength})</div>
                {fmt(now.current.startDate)} – {fmt(now.current.endDate)} · paid {fmt(now.current.payDate)}
              </div>
              <div>
                <div className="text-xs text-[var(--admin-text-muted)]">Next payday</div>
                {fmt(now.nextPayday.payDate)} ({now.daysToPayday === 0 ? "today" : `in ${now.daysToPayday} days`}) for {fmt(now.nextPayday.startDate)} – {fmt(now.nextPayday.endDate)}
              </div>
            </div>
          </Card>
        ) : null}

        {/* 3. The calendar */}
        <Card>
          <CardHeader
            title={`3. Pay calendar for ${year}`}
            subtitle={
              schedule
                ? `Paydays whose pay date falls in ${year} (wages are taxed in the year they are paid). Usually ${periodsPerYear(schedule.frequency)}.`
                : "Save the pay schedule to see the year."
            }
            action={
              <form method="get" className="flex items-center gap-2">
                <Select name="year" defaultValue={String(year)} aria-label="Year">
                  {[thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map((y) => (
                    <option key={y} value={String(y)}>
                      {y}
                    </option>
                  ))}
                </Select>
                <Button type="submit" variant="neutral" size="sm">
                  Show
                </Button>
              </form>
            }
          />
          {plan ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm" data-testid="pay-calendar-preview">
                  <thead className="text-xs text-[var(--admin-text-muted)]">
                    <tr>
                      <th className="py-2 pr-3">#</th>
                      <th className="py-2 pr-3">Work days</th>
                      <th className="py-2 pr-3">Payday</th>
                      <th className="py-2 pr-3">Qtr</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.verdicts.map((v) => (
                      <tr key={v.planned.scheduledPayDate} className="border-t border-[var(--admin-border)]">
                        <td className="py-2 pr-3">{v.planned.number}</td>
                        <td className="py-2 pr-3">
                          {fmt(v.planned.startDate)} – {fmt(v.planned.endDate)}
                        </td>
                        <td className="py-2 pr-3 font-medium">{fmt(v.planned.payDate)}</td>
                        <td className="py-2 pr-3">Q{v.planned.quarter}</td>
                        <td className="py-2 pr-3">
                          {v.kind === "new" ? (
                            <Badge tone="gold">Not on calendar</Badge>
                          ) : v.kind === "on_file" ? (
                            <Badge tone="green">On calendar · {v.existing.status}</Badge>
                          ) : (
                            <Badge tone="danger">Clash</Badge>
                          )}
                        </td>
                        <td className="py-2 text-xs text-[var(--admin-text-muted)]">
                          {[...v.planned.flags, v.kind === "conflict" ? v.why : ""].filter(Boolean).join(" ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <form action={generatePeriodsAction} className="mt-4 flex flex-wrap items-center gap-3">
                <input type="hidden" name="year" value={String(year)} />
                <Button type="submit" variant="primary" disabled={newCount === 0}>
                  {newCount === 0 ? `Every ${year} period is on the calendar` : `Add ${newCount} period${newCount === 1 ? "" : "s"} to the ${year} calendar`}
                </Button>
                <span className="text-xs text-[var(--admin-text-muted)]">
                  Added as <strong>planned</strong>. Periods already on file are never changed; clashes are skipped and listed.
                </span>
              </form>
            </>
          ) : (
            <p className="text-sm text-[var(--admin-text-muted)]">Nothing to show yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
