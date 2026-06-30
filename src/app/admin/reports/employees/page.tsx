/**
 * src/app/admin/reports/employees/page.tsx — Slice 29
 *
 * Employee performance report: shifts worked and hours by employee, derived
 * from the time clock (shifts + time_punches). Pacific business days.
 */
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { StatCard } from "@/components/admin/StatCard";
import { DateRangePicker } from "@/components/admin/reports/DateRangePicker";
import { ReportTable, type ReportColumn } from "@/components/admin/reports/ReportTable";
import { resolveRange } from "@/lib/reports/range";
import { getEmployeeReport, type EmployeeReportRow } from "@/lib/reports/operations";
import { formatMinutes } from "@/lib/staffing/time";

export const dynamic = "force-dynamic";

const columns: ReportColumn<EmployeeReportRow & Record<string, unknown>>[] = [
  { key: "name", header: "Employee", emphasis: true, render: (r) => r.name },
  { key: "shifts", header: "Shifts", align: "right", render: (r) => String(r.shifts) },
  { key: "minutesWorked", header: "Hours worked", align: "right", render: (r) => formatMinutes(r.minutesWorked) },
];

export default async function EmployeeReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; range?: string }>;
}) {
  await requirePermission("reports.view");
  const sp = await searchParams;
  const range = resolveRange(sp);

  if (!isSupabaseServiceConfigured) {
    return <p className="text-sm text-white/50">Connect Supabase to view the employee report.</p>;
  }

  const r = await getEmployeeReport(range.fromDate, range.toDate);

  return (
    <div className="space-y-5">
      <DateRangePicker />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Active employees" value={String(r.rows.length)} accent="green" />
        <StatCard label="Total shifts" value={String(r.totalShifts)} hint={range.label} accent="gold" />
        <StatCard label="Total hours" value={formatMinutes(r.totalMinutes)} accent="muted" />
      </div>

      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="mb-4 text-sm font-black uppercase tracking-[0.14em] text-white/80">
          By employee
        </h2>
        <ReportTable
          columns={columns}
          rows={r.rows as (EmployeeReportRow & Record<string, unknown>)[]}
          emptyLabel="No shifts in this window."
        />
      </section>
    </div>
  );
}
