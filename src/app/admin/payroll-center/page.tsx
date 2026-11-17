import Link from "next/link";

import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { pacificToday } from "@/lib/reports/timezone";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { Breadcrumbs } from "@/components/admin/ux";
import { Badge, Card, CardHeader } from "@/components/admin/ui";
import { CalculateOnlyBanner, PayrollCenterNav } from "@/components/admin/payroll-center/PayrollCenterNav";
import { WEEKDAY_LONG, scheduleNow, shortDay, weekdayName, workweekAdvice } from "@/lib/payroll/pay-schedule-core";
import {
  loadPaySchedule,
  loadPayrollHubFacts,
  loadPeriodsForYear,
  loadWorkweek,
} from "@/lib/payroll/pay-schedule-store";

/**
 * D248 - the payroll command center (owner + admin).
 *
 * Owner (verbatim): "Please make sure I have the proper hub/ command center for
 * owner and admin to manage all things employee payroll."
 *
 * One page that says where payroll stands TODAY (which period we are in, when
 * payday is, who is ready to be calculated) and links every payroll tool the
 * back office already has. Calculate and compare only: nothing here books a
 * journal, files a form or pays anyone.
 */

export const dynamic = "force-dynamic";

type Tool = { label: string; href: string; what: string; ownerOnly?: boolean };

const TOOLS: Tool[] = [
  { label: "Pay schedule & calendar", href: "/admin/payroll-center/schedule", what: "Set the pay Friday and period, the workweek, and lay out the year's pay periods." },
  { label: "Time cards", href: "/admin/payroll-center/time-cards", what: "Every punch, break, overtime and sick hour for a pay period, by workweek - fix in place, approve when clean." },
  { label: "Time clock", href: "/admin/staffing", what: "Clock in and out, breaks, and manager punch fixes with a reason." },
  { label: "Hours", href: "/admin/staffing/hours", what: "Hours worked by employee." },
  { label: "Employees", href: "/admin/staffing/employees", what: "Employee files, pay rates and status." },
  { label: "Tip tracker", href: "/admin/staffing/tips", what: "Tips counted at each drawer close." },
  { label: "Direct deposit (ACH)", href: "/admin/payroll", what: "Type Sage's net pay and build the Timberland ACH file." },
  { label: "Timesheets & overtime", href: "/admin/books/timesheets", what: "Punches into payable hours, overtime per workweek, approve a period.", ownerOnly: true },
  { label: "Pay run (calculated)", href: "/admin/books/pay-run", what: "Gross, every tax and net for each employee, from the hours and the W-4.", ownerOnly: true },
  { label: "Payroll setup (W-4)", href: "/admin/books/payroll-setup", what: "Pay rates, W-4 elections and withholding inputs.", ownerOnly: true },
  { label: "Sick leave balances", href: "/admin/books/sick-leave-balances", what: "Accrued, used and available paid sick leave.", ownerOnly: true },
  { label: "Year to date", href: "/admin/books/ytd", what: "Wage bases (Social Security cap, FUTA, SUTA) so the ceilings are right.", ownerOnly: true },
  { label: "Garnishments", href: "/admin/books/garnishments", what: "Court and agency wage orders.", ownerOnly: true },
];

function fmtRange(a: string, b: string) {
  return `${weekdayName(a).slice(0, 3)} ${shortDay(a)} – ${weekdayName(b).slice(0, 3)} ${shortDay(b)}`;
}

export default async function PayrollCenterPage() {
  const session = await requirePermission("settings.manage");
  const isOwner = can(session.profile.role, "books.view");
  const today = pacificToday();
  const year = Number(today.slice(0, 4));

  let failure: string | null = null;
  let schedule: Awaited<ReturnType<typeof loadPaySchedule>> = null;
  let workweek: Awaited<ReturnType<typeof loadWorkweek>> | null = null;
  let facts: Awaited<ReturnType<typeof loadPayrollHubFacts>> | null = null;
  let periodsThisYear = 0;
  let periodsNextYear = 0;
  if (isSupabaseServiceConfigured) {
    try {
      [schedule, workweek, facts] = await Promise.all([loadPaySchedule(), loadWorkweek(), loadPayrollHubFacts()]);
      const [a, b] = await Promise.all([loadPeriodsForYear(year), loadPeriodsForYear(year + 1)]);
      periodsThisYear = a.length;
      periodsNextYear = b.length;
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    }
  } else {
    failure = "The database is not connected on this server.";
  }

  const now = schedule ? scheduleNow(schedule, today) : null;
  const advice = schedule && workweek ? workweekAdvice(schedule, workweek.startsOn) : null;

  return (
    <div>
      <AdminPageHeader
        title="Payroll command center"
        subtitle="Hours, time cards, gross pay and every payroll tax - calculated here to check against Sage. Nothing is booked, filed or paid."
        breadcrumbs={<Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Payroll command center" }]} />}
      />
      <div className="space-y-6 px-5 py-6 sm:px-8" data-testid="payroll-center-hub">
        <PayrollCenterNav current="hub" />
        <CalculateOnlyBanner />

        {failure ? (
          <Card>
            <CardHeader title="The command center could not load" />
            <p className="text-sm text-[var(--admin-danger)]">{failure}</p>
          </Card>
        ) : null}

        {/* Where we are today */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Next payday"
            value={now ? `${weekdayName(now.nextPayday.payDate).slice(0, 3)} ${shortDay(now.nextPayday.payDate)}` : "Not set"}
            hint={now ? (now.daysToPayday === 0 ? "Today" : `In ${now.daysToPayday} day${now.daysToPayday === 1 ? "" : "s"} · pays ${fmtRange(now.nextPayday.startDate, now.nextPayday.endDate)}`) : "Set the pay schedule"}
            accent={now ? "green" : "gold"}
            href="/admin/payroll-center/schedule"
          />
          <StatCard
            label="Current period"
            value={now ? fmtRange(now.current.startDate, now.current.endDate) : "—"}
            hint={now ? `Day ${now.dayOfPeriod} of ${now.periodLength} · paid ${shortDay(now.current.payDate)}` : undefined}
            accent="muted"
          />
          <StatCard
            label="Ready to calculate"
            value={facts ? `${Math.min(facts.withPayRate, facts.withW4)} / ${facts.activeEmployees}` : "—"}
            hint={facts ? `${facts.withPayRate} with a pay rate · ${facts.withW4} with a W-4` : undefined}
            accent={facts && facts.missingPayNames.length === 0 && facts.missingW4Names.length === 0 ? "green" : "gold"}
          />
          <StatCard
            label="Pay calendar"
            value={`${periodsThisYear} in ${year} · ${periodsNextYear} in ${year + 1}`}
            hint={periodsNextYear === 0 ? `Lay out ${year + 1} on the schedule tab` : undefined}
            accent={periodsNextYear > 0 ? "green" : "gold"}
            href="/admin/payroll-center/schedule"
          />
        </div>

        {/* Set-up checklist */}
        <Card>
          <CardHeader title="Set-up checklist" subtitle="Each step is needed before the hours can turn into a paycheck to compare with Sage." />
          <ul className="space-y-2 text-sm" data-testid="payroll-setup-checklist">
            <li className="flex flex-wrap items-center gap-2">
              <Badge tone={schedule ? "green" : "gold"}>{schedule ? "Done" : "To do"}</Badge>
              <span>
                Pay schedule:{" "}
                {schedule
                  ? `${schedule.frequency === "weekly" ? "every week" : "every two weeks"}, payday ${WEEKDAY_LONG[new Date(`${schedule.anchorPayDate}T12:00:00Z`).getUTCDay()]}, ${schedule.lagDays} day${schedule.lagDays === 1 ? "" : "s"} after the period ends`
                  : "not set"}
              </span>
            </li>
            <li className="flex flex-wrap items-center gap-2">
              <Badge tone={workweek?.startsOn != null ? (advice?.agrees === false ? "orange" : "green") : "gold"}>
                {workweek?.startsOn != null ? (advice?.agrees === false ? "Check" : "Done") : "To do"}
              </Badge>
              <span>
                Workweek: {workweek?.startsOn != null ? `starts ${WEEKDAY_LONG[workweek.startsOn]}` : "not set"}
                {advice ? <span className="text-[var(--admin-text-muted)]"> — {advice.message}</span> : null}
              </span>
            </li>
            <li className="flex flex-wrap items-center gap-2">
              <Badge tone={periodsThisYear + periodsNextYear > 0 ? "green" : "gold"}>{periodsThisYear + periodsNextYear > 0 ? "Done" : "To do"}</Badge>
              <span>Pay periods on the calendar</span>
            </li>
            <li className="flex flex-wrap items-center gap-2">
              <Badge tone={facts && facts.missingPayNames.length === 0 ? "green" : "gold"}>{facts && facts.missingPayNames.length === 0 ? "Done" : "To do"}</Badge>
              <span>
                Pay rate for every active employee
                {facts && facts.missingPayNames.length ? <span className="text-[var(--admin-text-muted)]"> — missing: {facts.missingPayNames.join(", ")}</span> : null}
              </span>
            </li>
            <li className="flex flex-wrap items-center gap-2">
              <Badge tone={facts && facts.missingW4Names.length === 0 ? "green" : "gold"}>{facts && facts.missingW4Names.length === 0 ? "Done" : "To do"}</Badge>
              <span>
                W-4 for every active employee
                {facts && facts.missingW4Names.length ? (
                  <span className="text-[var(--admin-text-muted)]"> — missing: {facts.missingW4Names.join(", ")} (federal tax falls back to single, no adjustments, as the IRS requires)</span>
                ) : null}
              </span>
            </li>
          </ul>
        </Card>

        {/* Every payroll tool */}
        <Card>
          <CardHeader title="Every payroll tool" subtitle={isOwner ? "All of it, in the order the work is done." : "The tools open to admins. The owner also sees the books-side payroll screens."} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="payroll-tools">
            {TOOLS.filter((t) => isOwner || !t.ownerOnly).map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4 transition hover:border-[var(--admin-accent)]"
              >
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--admin-text)]">
                  {t.label}
                  {t.ownerOnly ? <Badge tone="neutral">Owner</Badge> : null}
                </div>
                <p className="mt-1 text-xs text-[var(--admin-text-muted)]">{t.what}</p>
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
