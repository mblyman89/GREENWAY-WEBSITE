/**
 * GET /admin/reports/special-discounts/export?format=csv|xlsx&from=&to=
 *
 * Export the Special Discounts report (SLICE 29) as CSV or styled XLSX.
 * Staff-gated (reports.view). Sheets: Summary KPIs, By program, Cashiers
 * (who gives them), Employee buyers + approvers, Companies (industry), and
 * the newest-first Recent uses detail — the owner's printable paper trail
 * of who gave which discount to whom, and how often.
 */
import { requirePermission } from "@/lib/auth/session";
import { resolveRange } from "@/lib/reports/range";
import { getSpecialDiscountReport } from "@/lib/reports/special-discounts";
import { pacificDayKey } from "@/lib/reports/timezone";
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

const KIND_LABELS: Record<string, string> = {
  employee: "Employee",
  industry: "Industry",
  veteran: "Veteran",
};

const SUMMARY_COLUMNS: TableColumn[] = [
  { key: "metric", header: "Metric", type: "text" },
  { key: "value", header: "Value", type: "text" },
];

const KIND_COLUMNS: TableColumn[] = [
  { key: "program", header: "Program", type: "text" },
  { key: "uses", header: "Uses", type: "integer" },
  { key: "discountMinor", header: "Cents given", type: "currency" },
  { key: "subtotalMinor", header: "Pre-discount sales", type: "currency" },
];

const PERSON_COLUMNS: TableColumn[] = [
  { key: "name", header: "Employee", type: "text" },
  { key: "uses", header: "Uses", type: "integer" },
  { key: "discountMinor", header: "Cents given", type: "currency" },
  { key: "lastUsed", header: "Last used (PT)", type: "text" },
];

const COMPANY_COLUMNS: TableColumn[] = [
  { key: "name", header: "Company", type: "text" },
  { key: "uses", header: "Visits", type: "integer" },
  { key: "discountMinor", header: "Cents given", type: "currency" },
  { key: "lastUsed", header: "Last visit (PT)", type: "text" },
];

const RECENT_COLUMNS: TableColumn[] = [
  { key: "when", header: "When (PT)", type: "text" },
  { key: "program", header: "Program", type: "text" },
  { key: "recipient", header: "Given to", type: "text" },
  { key: "cashier", header: "Rung by", type: "text" },
  { key: "approver", header: "Approved by", type: "text" },
  { key: "register", header: "Register", type: "text" },
  { key: "subtotalMinor", header: "Pre-discount", type: "currency" },
  { key: "discountMinor", header: "Saved", type: "currency" },
];

function ptDay(iso: string): string {
  return iso && Number.isFinite(Date.parse(iso)) ? pacificDayKey(iso) : "";
}

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

  const r = await getSpecialDiscountReport(range.fromISO, range.toISO);
  const s = r.summary;
  const money = (m: number) => (m / 100).toFixed(2);

  const summaryRows: TableRow[] = [
    { metric: "Window", value: `${range.fromISO.slice(0, 10)} to ${range.toISO.slice(0, 10)}` },
    { metric: "Special discounts given", value: s.totalUses.toLocaleString("en-US") },
    { metric: "Total cents given away ($)", value: money(s.totalDiscountMinor) },
    { metric: "Pre-discount sales ($)", value: money(s.totalSubtotalMinor) },
    { metric: "Average per use ($)", value: money(s.avgDiscountMinor) },
    { metric: "Distinct cashiers", value: r.byCashier.length.toLocaleString("en-US") },
    { metric: "Distinct employee buyers", value: r.byBeneficiary.length.toLocaleString("en-US") },
    { metric: "Distinct companies", value: s.byCompany.length.toLocaleString("en-US") },
  ];

  const personRows = (people: typeof r.byCashier): TableRow[] =>
    people.map((p) => ({
      name: p.name,
      uses: p.uses,
      discountMinor: p.discountMinor,
      lastUsed: ptDay(p.lastUsedAt),
    }));

  const sheets: TableSheet[] = [
    { name: "Summary", caption: "Special discount KPIs", columns: SUMMARY_COLUMNS, rows: summaryRows },
    {
      name: "By program",
      columns: KIND_COLUMNS,
      rows: s.byKind.map((k) => ({
        program: KIND_LABELS[k.kind] ?? k.kind,
        uses: k.uses,
        discountMinor: k.discountMinor,
        subtotalMinor: k.subtotalMinor,
      })),
    },
    { name: "Cashiers", columns: PERSON_COLUMNS, rows: personRows(r.byCashier) },
    { name: "Employee buyers", columns: PERSON_COLUMNS, rows: personRows(r.byBeneficiary) },
    { name: "Approvers", columns: PERSON_COLUMNS, rows: personRows(r.byApprover) },
    {
      name: "Companies",
      columns: COMPANY_COLUMNS,
      rows: s.byCompany.map((c) => ({
        name: c.name,
        uses: c.uses,
        discountMinor: c.discountMinor,
        lastUsed: ptDay(c.lastUsedAt),
      })),
    },
    {
      name: "Recent uses",
      caption: "Newest first (up to 200)",
      columns: RECENT_COLUMNS,
      rows: r.recentUses.map((u) => ({
        when: ptDay(u.occurredAt),
        program: KIND_LABELS[u.kind] ?? u.kind,
        recipient: u.recipientLabel,
        cashier: u.cashierName,
        approver: u.approverName ?? "",
        register: u.registerName,
        subtotalMinor: u.subtotalMinor,
        discountMinor: u.discountMinor,
      })),
    },
  ];

  const spec: WorkbookSpec = {
    filename: `special-discounts_${range.fromISO.slice(0, 10)}_${range.toISO.slice(0, 10)}`,
    title: "Special discounts report",
    sheets,
  };

  return exportResponse(spec, format);
}
