import { requirePermission } from "@/lib/auth/session";
import { pacificToday } from "@/lib/reports/timezone";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { Breadcrumbs } from "@/components/admin/ux";
import { Badge, Button, Card, CardHeader } from "@/components/admin/ui";
import { CalculateOnlyBanner, PayrollCenterNav } from "@/components/admin/payroll-center/PayrollCenterNav";
import { WEEKDAY_LONG, shortDay } from "@/lib/payroll/pay-schedule-core";
import { decimalHours } from "@/lib/payroll/time-card-core";
import { loadPayrollStats, type PayrollStatsView } from "@/lib/payroll/payroll-stats-store";

/**
 * D248 slice 5 - PAYROLL STATS & CHARTS (owner + admin).
 *
 * Owner (verbatim excerpt): "...stats, charts, graphs, anything that an
 * expert, professional enterprise grade system would have for managing
 * payroll. Sick time, breaks, overtime, total hours per week..."
 *
 * The last N workweeks from the punches: hours and overtime per week, labor
 * cost estimate, coverage by weekday and hour, break compliance, shift
 * lengths, sick balances, and a per-employee heat table. Read only.
 */

export const dynamic = "force-dynamic";

const RANGES = [4, 8, 13, 26];

function money(c: number | null) {
  if (c === null) return "—";
  return `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);
const h12 = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? "a" : "p"}`;

/** Background for the heat table: deeper green toward 40h, orange over 40. */
function heat(min: number): string {
  if (min <= 0) return "transparent";
  if (min > 2400) return "color-mix(in srgb, var(--admin-danger) 35%, transparent)";
  const a = Math.round(10 + (Math.min(min, 2400) / 2400) * 45);
  return `color-mix(in srgb, var(--admin-accent) ${a}%, transparent)`;
}

export default async function PayrollStatsPage({ searchParams }: { searchParams: Promise<{ weeks?: string }> }) {
  await requirePermission("settings.manage");
  const sp = await searchParams;
  const weeks = RANGES.includes(Number(sp.weeks)) ? Number(sp.weeks) : 8;
  const today = pacificToday();

  let view: PayrollStatsView | null = null;
  let failure: string | null = null;
  if (!isSupabaseServiceConfigured) failure = "The database is not connected on this server.";
  else {
    try {
      view = await loadPayrollStats(today, weeks);
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    }
  }

  const t = view?.totals;
  const maxWeek = view ? Math.max(1, ...view.weeks.map((w) => w.workMinutes)) : 1;
  const maxCost = view ? Math.max(1, ...view.weeks.map((w) => w.estLaborCents)) : 1;
  const maxWd = view ? Math.max(1, ...view.byWeekday.map((d) => d.avgMinutes)) : 1;
  const hours = view ? view.byHour.filter((h) => h.hour >= 6 && h.hour <= 23) : [];
  const maxHr = Math.max(1, ...hours.map((h) => h.workerMinutes));
  const active = view ? view.employees.filter((e) => e.workMinutes > 0 || e.sickBalanceMinutes !== 0) : [];

  return (
    <div>
      <AdminPageHeader
        title="Payroll stats"
        subtitle="Hours, overtime, labor cost, coverage, breaks and sick time across recent workweeks - for the store and for each person."
        breadcrumbs={<Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Payroll command center", href: "/admin/payroll-center" }, { label: "Stats" }]} />}
      />
      <div className="space-y-6 px-5 py-6 sm:px-8" data-testid="payroll-stats-page">
        <PayrollCenterNav current="stats" />
        <CalculateOnlyBanner />

        <div className="flex flex-wrap items-center gap-2" data-testid="stats-range">
          <span className="text-xs font-semibold text-[var(--admin-text-muted)]">Last</span>
          {RANGES.map((n) => (
            <Button key={n} href={`/admin/payroll-center/stats?weeks=${n}`} variant={n === weeks ? "primary" : "neutral"} size="sm">
              {n} weeks
            </Button>
          ))}
        </div>

        {failure ? (
          <Card>
            <CardHeader title="Stats could not load" />
            <p className="text-sm text-[var(--admin-danger)]">{failure}</p>
          </Card>
        ) : null}

        {view && t ? (
          <>
            {view.workweekStartsOn === null ? (
              <p className="rounded-[var(--admin-radius)] bg-[var(--admin-gold-soft)] px-4 py-2 text-sm text-[var(--admin-gold)]">
                The workweek is not set, so weeks are shown Sunday to Saturday and overtime is not split. Set it on the{" "}
                <a href="/admin/payroll-center/schedule" className="underline">
                  pay schedule
                </a>
                .
              </p>
            ) : (
              <p className="text-xs text-[var(--admin-text-muted)]">Workweek starts {WEEKDAY_LONG[view.workweekStartsOn]}. Overtime is over 40 hours in a workweek.</p>
            )}
            {t.excludedOpen + t.excludedImplausible > 0 ? (
              <p className="rounded-[var(--admin-radius)] bg-[var(--admin-danger-soft)] px-4 py-2 text-sm text-[var(--admin-danger)]" data-testid="stats-excluded">
                Not counted: {t.excludedOpen} open punch{t.excludedOpen === 1 ? "" : "es"} and {t.excludedImplausible} punch{t.excludedImplausible === 1 ? "" : "es"} over 24 hours (missed clock-outs). Fix them on the{" "}
                <a href="/admin/payroll-center/time-cards" className="underline">
                  time cards
                </a>{" "}
                and they will count.
              </p>
            ) : null}
            {view.sickWarning ? <p className="text-sm text-[var(--admin-gold)]">{view.sickWarning}</p> : null}

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="stats-kpis">
              <StatCard label="Hours worked" value={decimalHours(t.workMinutes)} hint={`${weeks} weeks · avg ${decimalHours(Math.round(t.workMinutes / weeks))}/week`} accent="green" />
              <StatCard
                label="Overtime"
                value={t.overtimeMinutes === null ? "—" : decimalHours(t.overtimeMinutes)}
                hint={t.overtimeSharePct === null ? "Set the workweek to split overtime" : `${pct(t.overtimeSharePct)} of hours`}
                accent={t.overtimeMinutes ? "orange" : "muted"}
              />
              <StatCard label="Labor cost (estimate)" value={money(t.estLaborCents)} hint="Wages at current rates, before employer taxes" accent="gold" />
              <StatCard label="Meal-break compliance" value={pct(t.breakCompliancePct)} hint={`Avg shift ${decimalHours(t.avgShiftMinutes)} h`} accent="muted" />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader title="Hours per workweek" subtitle="Regular in green, overtime in orange." />
                <div className="flex h-48 items-end gap-2" data-testid="chart-hours-week">
                  {view.weeks.map((w) => {
                    const ot = w.overtimeMinutes ?? 0;
                    const reg = w.workMinutes - ot;
                    return (
                      <div key={w.startDate} className="flex flex-1 flex-col items-center gap-1" title={`${w.startDate} - ${w.endDate}: ${decimalHours(w.workMinutes)} h, ${decimalHours(ot)} OT, ${w.employeesWorked} people`}>
                        <span className="text-[10px] tabular-nums text-[var(--admin-text-muted)]">{Math.round(w.workMinutes / 60)}</span>
                        <div className="flex w-full flex-col justify-end" style={{ height: "150px" }}>
                          <div style={{ height: `${(ot / maxWeek) * 150}px`, background: "var(--admin-danger)" }} className="w-full rounded-t" />
                          <div style={{ height: `${(reg / maxWeek) * 150}px`, background: "var(--admin-accent)" }} className={`w-full ${ot ? "" : "rounded-t"}`} />
                        </div>
                        <span className="text-[10px] text-[var(--admin-text-muted)]">{shortDay(w.startDate)}</span>
                      </div>
                    );
                  })}
                </div>
              </Card>

              <Card>
                <CardHeader title="Labor cost per workweek (estimate)" subtitle="Straight time plus the overtime premium at each person's current rate." />
                <div className="flex h-48 items-end gap-2" data-testid="chart-cost-week">
                  {view.weeks.map((w) => (
                    <div key={w.startDate} className="flex flex-1 flex-col items-center gap-1" title={`${w.startDate}: ${money(w.estLaborCents)}`}>
                      <span className="text-[10px] tabular-nums text-[var(--admin-text-muted)]">{w.estLaborCents ? `${Math.round(w.estLaborCents / 100000)}k` : ""}</span>
                      <div className="w-full rounded-t" style={{ height: `${(w.estLaborCents / maxCost) * 150}px`, background: "var(--admin-gold)" }} />
                      <span className="text-[10px] text-[var(--admin-text-muted)]">{shortDay(w.startDate)}</span>
                    </div>
                  ))}
                </div>
              </Card>

              <Card>
                <CardHeader title="Average hours by weekday" subtitle="Staff hours on a typical day of the week." />
                <ul className="space-y-1.5 text-sm" data-testid="chart-weekday">
                  {view.byWeekday.map((d) => (
                    <li key={d.weekday} className="flex items-center gap-3">
                      <span className="w-10 shrink-0 text-xs">{d.label}</span>
                      <span className="h-3 flex-1 rounded bg-[var(--admin-surface-2)]">
                        <span className="block h-3 rounded bg-[var(--admin-accent)]" style={{ width: `${(d.avgMinutes / maxWd) * 100}%` }} />
                      </span>
                      <span className="w-14 text-right text-xs tabular-nums">{decimalHours(d.avgMinutes)}</span>
                    </li>
                  ))}
                </ul>
              </Card>

              <Card>
                <CardHeader title="Coverage by hour" subtitle="Average people on the clock at each hour of the day (6a - 11p)." />
                <div className="flex h-40 items-end gap-0.5" data-testid="chart-hour">
                  {hours.map((h) => (
                    <div key={h.hour} className="flex flex-1 flex-col items-center gap-1" title={`${h12(h.hour)}: ${(h.workerMinutes / 60).toFixed(1)} people`}>
                      <div className="w-full rounded-t" style={{ height: `${(h.workerMinutes / maxHr) * 120}px`, background: "var(--admin-accent)" }} />
                      <span className="text-[9px] text-[var(--admin-text-muted)]">{h.hour % 2 === 0 ? h12(h.hour) : ""}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <Card>
              <CardHeader title="Hours by person and week" subtitle="Darker = closer to 40. Red = overtime week. Click a name for the time card." />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-xs" data-testid="stats-heat">
                  <thead>
                    <tr className="border-b border-[var(--admin-border)] text-left text-[var(--admin-text-muted)]">
                      <th className="py-2 pr-3">Employee</th>
                      {view.weeks.map((w) => (
                        <th key={w.startDate} className="py-2 pr-1 text-center font-normal">
                          {shortDay(w.startDate)}
                        </th>
                      ))}
                      <th className="py-2 pl-2 text-right">Total</th>
                      <th className="py-2 pl-2 text-right">OT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.map((e) => (
                      <tr key={e.employeeId} className="border-b border-[var(--admin-border)]">
                        <td className="py-1.5 pr-3">
                          <a href={`/admin/payroll-center/time-cards?emp=${e.employeeId}`} className="font-semibold underline-offset-2 hover:underline">
                            {e.name}
                          </a>
                        </td>
                        {e.byWeek.map((m, i) => (
                          <td key={i} className="px-1 py-1.5 text-center tabular-nums" style={{ background: heat(m) }}>
                            {m > 0 ? (m / 60).toFixed(1) : ""}
                          </td>
                        ))}
                        <td className="py-1.5 pl-2 text-right tabular-nums">{decimalHours(e.workMinutes)}</td>
                        <td className="py-1.5 pl-2 text-right tabular-nums">{e.overtimeMinutes === null ? "—" : decimalHours(e.overtimeMinutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card>
              <CardHeader title="Per employee" subtitle={`Last ${weeks} workweeks. Sick balance is the ledger balance to date.`} />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-xs" data-testid="stats-employees">
                  <thead>
                    <tr className="border-b border-[var(--admin-border)] text-left text-[var(--admin-text-muted)]">
                      <th className="py-2 pr-3">Employee</th>
                      <th className="py-2 pr-3 text-right">Avg / week</th>
                      <th className="py-2 pr-3 text-right">Peak week</th>
                      <th className="py-2 pr-3 text-right">Weeks &gt; 40</th>
                      <th className="py-2 pr-3 text-right">Weeks 36-40</th>
                      <th className="py-2 pr-3 text-right">Shifts</th>
                      <th className="py-2 pr-3 text-right">Avg shift</th>
                      <th className="py-2 pr-3 text-right">&gt; 12h</th>
                      <th className="py-2 pr-3 text-right">Break flags</th>
                      <th className="py-2 pr-3 text-right">Break compliance</th>
                      <th className="py-2 pr-3 text-right">Est. wages</th>
                      <th className="py-2 pr-3 text-right">Sick used</th>
                      <th className="py-2 pr-3 text-right">Sick balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.map((e) => (
                      <tr key={e.employeeId} className="border-b border-[var(--admin-border)]">
                        <td className="py-1.5 pr-3 font-semibold">{e.name}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{decimalHours(e.avgWeekMinutes)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{decimalHours(e.maxWeekMinutes)}</td>
                        <td className="py-1.5 pr-3 text-right">{e.weeksOver40 ? <Badge tone="danger">{e.weeksOver40}</Badge> : "0"}</td>
                        <td className="py-1.5 pr-3 text-right">{e.weeksNearOt ? <Badge tone="gold">{e.weeksNearOt}</Badge> : "0"}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{e.shifts}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{decimalHours(e.avgShiftMinutes)}</td>
                        <td className="py-1.5 pr-3 text-right">{e.longShifts ? <Badge tone="gold">{e.longShifts}</Badge> : "0"}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{e.breakFlags}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{pct(e.breakCompliancePct)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{e.estLaborCents === null ? (e.workMinutes > 0 ? <Badge tone="outline">no rate</Badge> : "—") : money(e.estLaborCents)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{decimalHours(e.sickUsedMinutes)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{decimalHours(e.sickBalanceMinutes)}</td>
                      </tr>
                    ))}
                    {active.length === 0 ? (
                      <tr>
                        <td colSpan={13} className="py-3 text-[var(--admin-text-muted)]">
                          No hours in this range.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              {t.employeesNoRate.length > 0 ? (
                <p className="mt-2 text-xs text-[var(--admin-text-muted)]">No hourly rate on file (not in the cost estimate): {t.employeesNoRate.join(", ")}.</p>
              ) : null}
            </Card>

            <Card>
              <CardHeader title="Weekly detail" />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-xs" data-testid="stats-weeks">
                  <thead>
                    <tr className="border-b border-[var(--admin-border)] text-left text-[var(--admin-text-muted)]">
                      <th className="py-2 pr-3">Workweek</th>
                      <th className="py-2 pr-3 text-right">People</th>
                      <th className="py-2 pr-3 text-right">Shifts</th>
                      <th className="py-2 pr-3 text-right">Hours</th>
                      <th className="py-2 pr-3 text-right">Overtime</th>
                      <th className="py-2 pr-3 text-right">Unpaid breaks</th>
                      <th className="py-2 pr-3 text-right">Break flags</th>
                      <th className="py-2 pr-3 text-right">Est. wages</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.weeks.map((w) => (
                      <tr key={w.startDate} className="border-b border-[var(--admin-border)]">
                        <td className="py-1.5 pr-3">
                          {w.startDate} → {w.endDate}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{w.employeesWorked}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{w.shifts}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{decimalHours(w.workMinutes)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{w.overtimeMinutes === null ? "—" : decimalHours(w.overtimeMinutes)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{decimalHours(w.breakMinutes)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{w.breakFlags}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{money(w.estLaborCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        ) : null}
      </div>
    </div>
  );
}
