/**
 * GET /admin/reports/employees/export?format=csv|xlsx&from=&to=
 *
 * Export the enriched employee report (Slice 52) as CSV or styled XLSX.
 * Staff-gated (reports.view). Sheets: Summary, By employee, Shifts by status,
 * Punch source. Hours are emitted as decimal hours for spreadsheet math.
 */
import { requirePermission } from "@/lib/auth/session";
import { resolveRange } from "@/lib/reports/range";
import { getEmployeeReport } from "@/lib/reports/operations";
import {
  exportResponse,
  parseFormat,
  type TableColumn,
  type TableRow,
  type TableSheet,
  type WorkbookSpec,
} from "@/lib/reports/workbook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const hours = (m: number) => Math.round((m / 60) * 100) / 100;

const EMP_COLUMNS: TableColumn[] = [
  { key: "name", header: "Employee", type: "text" },
  { key: "jobRole", header: "Role", type: "text" },
  { key: "active", header: "Active", type: "text" },
  { key: "shifts", header: "Shifts", type: "integer" },
  { key: "daysWorked", header: "Days", type: "integer" },
  { key: "hoursWorked", header: "Hours worked", type: "number" },
  { key: "breakHours", header: "Break hrs", type: "number" },
  { key: "avgShiftHours", header: "Avg shift hrs", type: "number" },
  { key: "ordersHandled", header: "Orders handled", type: "integer" },
  { key: "lastActiveDay", header: "Last active", type: "text" },
];

const STATUS_COLUMNS: TableColumn[] = [
  { key: "label", header: "Shift status", type: "text" },
  { key: "count", header: "Shifts", type: "integer" },
];

const SOURCE_COLUMNS: TableColumn[] = [
  { key: "label", header: "Punch source", type: "text" },
  { key: "count", header: "Punches", type: "integer" },
];

const SUMMARY_COLUMNS: TableColumn[] = [
  { key: "metric", header: "Metric", type: "text" },
  { key: "value", header: "Value", type: "text" },
];

export async function GET(request: Request) {
  await requirePermission("reports.view");

  const url = new URL(request.url);
  const range = resolveRange({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    range: url.searchParams.get("range") ?? undefined,
    year: url.searchParams.get("year") ?? undefined,
  });
  const format = parseFormat(url.searchParams.get("format"));

  const r = await getEmployeeReport(range.fromDate, range.toDate);
  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

  const summaryRows: TableRow[] = [
    { metric: "Active employees", value: String(r.activeEmployees) },
    { metric: "Inactive employees", value: String(r.inactiveEmployees) },
    { metric: "Total shifts", value: String(r.totalShifts) },
    { metric: "Hours worked", value: String(hours(r.totalMinutes)) },
    { metric: "Break hours", value: String(hours(r.totalBreakMinutes)) },
    { metric: "Avg shift hours", value: String(hours(r.avgShiftMinutes)) },
    { metric: "Scheduled hours", value: String(hours(r.scheduledMinutes)) },
    { metric: "Schedule adherence", value: r.scheduledMinutes > 0 ? pct(r.scheduleAdherence) : "—" },
    { metric: "On-time rate", value: pct(r.onTimeRate) },
  ];

  const empRows: TableRow[] = r.rows.map((e) => ({
    name: e.name,
    jobRole: e.jobRole,
    active: e.active ? "Yes" : "No",
    shifts: e.shifts,
    daysWorked: e.daysWorked,
    hoursWorked: hours(e.minutesWorked),
    breakHours: hours(e.breakMinutes),
    avgShiftHours: hours(e.avgShiftMinutes),
    ordersHandled: e.ordersHandled,
    lastActiveDay: e.lastActiveDay ?? "—",
  }));

  const sheets: TableSheet[] = [
    { name: "Summary", caption: "Employee performance KPIs", columns: SUMMARY_COLUMNS, rows: summaryRows },
    { name: "By employee", columns: EMP_COLUMNS, rows: empRows },
    { name: "Shifts by status", columns: STATUS_COLUMNS, rows: r.shiftsByStatus },
    { name: "Punch source", columns: SOURCE_COLUMNS, rows: r.punchesBySource },
  ];

  const spec: WorkbookSpec = {
    filename: `employee-report_${range.fromDate}_${range.toDate}`,
    title: "Employee performance report",
    sheets,
  };

  return exportResponse(spec, format);
}
