/**
 * src/app/admin/reports/employees/page.tsx — Slice 29, enriched in Slice 52
 *
 * Employee performance report from the time clock (shifts + time_punches).
 * Slice 52 adds enterprise-grade depth for a small team: net worked vs break
 * time, days worked + avg shift length, schedule adherence (actual ÷ scheduled)
 * and on-time rate, orders handled (where an employee is linked to a back-office
 * login), shift-status + punch-source + role breakdowns, a daily labor-coverage
 * trend, and CSV/XLSX export.
 */
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { StatCard } from "@/components/admin/StatCard";
import { DateRangePicker } from "@/components/admin/reports/DateRangePicker";
import { ReportTable, type ReportColumn } from "@/components/admin/reports/ReportTable";
import { BarList, REPORT_COLORS } from "@/components/admin/reports/Charts";
import { ExportButtons } from "@/components/admin/reports/ExportButtons";
import { resolveRange } from "@/lib/reports/range";
import { getEmployeeReport, type EmployeeReportRow } from "@/lib/reports/operations";
import { formatMinutes } from "@/lib/staffing/time";

export const dynamic = "force-dynamic";

function pct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

function Section({
  title,
  subtitle,
  exportHref,
  children,
}: {
  title: string;
  subtitle?: string;
  exportHref?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/80">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-white/45">{subtitle}</p> : null}
        </div>
        {exportHref ? <ExportButtons baseHref={exportHref} /> : null}
      </div>
      {children}
    </section>
  );
}

const columns: ReportColumn<EmployeeReportRow & Record<string, unknown>>[] = [
  { key: "name", header: "Employee", emphasis: true, render: (r) => r.name },
  { key: "jobRole", header: "Role", render: (r) => (r.active ? r.jobRole : `${r.jobRole} (inactive)`) },
  { key: "shifts", header: "Shifts", align: "right", render: (r) => String(r.shifts) },
  { key: "daysWorked", header: "Days", align: "right", render: (r) => String(r.daysWorked) },
  { key: "minutesWorked", header: "Hours worked", align: "right", render: (r) => formatMinutes(r.minutesWorked) },
  { key: "breakMinutes", header: "Break", align: "right", render: (r) => formatMinutes(r.breakMinutes) },
  { key: "avgShiftMinutes", header: "Avg shift", align: "right", render: (r) => formatMinutes(r.avgShiftMinutes) },
  { key: "ordersHandled", header: "Orders", align: "right", render: (r) => String(r.ordersHandled) },
  { key: "lastActiveDay", header: "Last active", align: "right", render: (r) => r.lastActiveDay ?? "—" },
];

export default async function EmployeeReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; range?: string; year?: string }>;
}) {
  await requirePermission("reports.view");
  const sp = await searchParams;
  const range = resolveRange(sp);

  if (!isSupabaseServiceConfigured) {
    return <p className="text-sm text-white/50">Connect Supabase to view the employee report.</p>;
  }

  const r = await getEmployeeReport(range.fromDate, range.toDate);
  const qs = `from=${range.fromDate}&to=${range.toDate}`;

  return (
    <div className="space-y-5">
      <DateRangePicker />

      {/* Headline */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active employees"
          value={String(r.activeEmployees)}
          hint={r.inactiveEmployees > 0 ? `${r.inactiveEmployees} inactive` : undefined}
          accent="green"
        />
        <StatCard label="Total shifts" value={String(r.totalShifts)} hint={range.label} accent="gold" />
        <StatCard
          label="Hours worked"
          value={formatMinutes(r.totalMinutes)}
          hint={`${formatMinutes(r.totalBreakMinutes)} on break`}
          accent="muted"
        />
        <StatCard label="Avg shift length" value={formatMinutes(r.avgShiftMinutes)} accent="muted" />
      </div>

      {/* Schedule adherence */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Scheduled hours"
          value={formatMinutes(r.scheduledMinutes)}
          hint="From scheduled start/end"
          accent="muted"
        />
        <StatCard
          label="Schedule adherence"
          value={r.scheduledMinutes > 0 ? pct(r.scheduleAdherence) : "—"}
          hint="Actual ÷ scheduled hours"
          accent={r.scheduleAdherence > 1.1 ? "orange" : "green"}
        />
        <StatCard
          label="On-time rate"
          value={pct(r.onTimeRate)}
          hint="Shifts started within 5 min of schedule"
          accent="gold"
        />
      </div>

      {/* By employee */}
      <Section title="By employee" exportHref={`/admin/reports/employees/export?${qs}`}>
        <ReportTable
          columns={columns}
          rows={r.rows as (EmployeeReportRow & Record<string, unknown>)[]}
          emptyLabel="No shifts in this window."
        />
      </Section>

      {/* Breakdowns */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Hours by role" subtitle="Where labor is spent.">
          <BarList
            data={r.roleBreakdown.map((x) => ({ label: x.label, value: x.minutes }))}
            valueFormatter={formatMinutes}
            color={REPORT_COLORS.GREEN}
            emptyLabel="No labor recorded."
          />
        </Section>
        <Section title="Shifts by status" subtitle="Scheduled vs open vs closed.">
          <BarList
            data={r.shiftsByStatus.map((x) => ({ label: x.label, value: x.count }))}
            color={REPORT_COLORS.GOLD}
            emptyLabel="No shifts recorded."
          />
        </Section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Punch source" subtitle="Data-integrity signal: station vs web vs manager edits.">
          <BarList
            data={r.punchesBySource.map((x) => ({ label: x.label, value: x.count }))}
            color={REPORT_COLORS.ORANGE}
            emptyLabel="No punches recorded."
          />
        </Section>
        <Section title="Daily labor coverage" subtitle="Net worked hours per Pacific day.">
          <BarList
            data={r.dailyCoverage.map((x) => ({ label: x.date, value: x.minutes }))}
            valueFormatter={formatMinutes}
            color={REPORT_COLORS.GREEN}
            emptyLabel="No coverage recorded."
          />
        </Section>
      </div>
    </div>
  );
}
