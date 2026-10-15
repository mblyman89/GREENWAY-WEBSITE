/**
 * GET /admin/reports/ach-payments/export?format=csv|xlsx&from=&to=
 *
 * ACH Payments report export. OWNER AND ADMIN ONLY (ach.request), the same
 * check as the page. No account numbers: names, dates, amounts, statuses and
 * bank descriptions only.
 */
import { requirePermission } from "@/lib/auth/session";
import { resolveRange } from "@/lib/reports/range";
import { pacificToday } from "@/lib/reports/timezone";
import { loadAchReportInputs } from "@/lib/reports/ach-payments-report-store";
import { buildAchReport, FILE_STAGE_LABEL, PAYMENT_STATUS_LABEL } from "@/lib/reports/ach-payments-report-core";
import { exportResponse, parseFormat, type TableColumn, type TableSheet, type WorkbookSpec } from "@/lib/reports/workbook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FILE_COLUMNS: TableColumn[] = [
  { key: "effectiveDate", header: "Effective", type: "text" },
  { key: "kind", header: "Type", type: "text" },
  { key: "filename", header: "File", type: "text" },
  { key: "entryCount", header: "Entries", type: "integer" },
  { key: "totalCents", header: "Amount", type: "currency" },
  { key: "stage", header: "Where it is", type: "text" },
  { key: "deadlineDay", header: "Upload + approve by", type: "text" },
  { key: "bankDate", header: "Bank date", type: "text" },
  { key: "bankCents", header: "Bank amount", type: "currency" },
];

const PAYMENT_COLUMNS: TableColumn[] = [
  { key: "date", header: "Date", type: "text" },
  { key: "payee", header: "Paid to", type: "text" },
  { key: "payeeKind", header: "Who", type: "text" },
  { key: "amountCents", header: "Amount", type: "currency" },
  { key: "method", header: "How", type: "text" },
  { key: "detail", header: "For", type: "text" },
  { key: "status", header: "Status", type: "text" },
  { key: "bankDate", header: "Bank posted", type: "text" },
];

const MATCH_COLUMNS: TableColumn[] = [
  { key: "bankDate", header: "Bank date", type: "text" },
  { key: "bankDescription", header: "Bank description", type: "text" },
  { key: "bankCents", header: "Bank amount", type: "currency" },
  { key: "expectedCents", header: "Expected", type: "currency" },
  { key: "differenceCents", header: "Difference", type: "currency" },
  { key: "matchedTo", header: "Matched to", type: "text" },
  { key: "basis", header: "How matched", type: "text" },
];

const OWED_COLUMNS: TableColumn[] = [
  { key: "vendorName", header: "Vendor", type: "text" },
  { key: "documentNumber", header: "Bill", type: "text" },
  { key: "sinceDate", header: "Since", type: "text" },
  { key: "ageDays", header: "Age (days)", type: "integer" },
  { key: "owedCents", header: "Bill total", type: "currency" },
  { key: "paidCents", header: "Paid", type: "currency" },
  { key: "remainingCents", header: "Still owed", type: "currency" },
];

export async function GET(request: Request) {
  await requirePermission("ach.request");
  const url = new URL(request.url);
  const range = resolveRange({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    range: url.searchParams.get("range") ?? undefined,
    year: url.searchParams.get("year") ?? undefined,
  });
  const format = parseFormat(url.searchParams.get("format"));
  const load = await loadAchReportInputs();
  const r = buildAchReport({ ...load.input, todayIso: pacificToday(), fromDate: range.fromDate, toDate: range.toDate });

  const sheets: TableSheet[] = [
    {
      name: "Files",
      caption: load.problems.length > 0 ? `Some data did not load: ${load.problems.join(" ")}` : undefined,
      columns: FILE_COLUMNS,
      rows: r.files.map((f) => ({
        effectiveDate: f.effectiveDate,
        kind: f.kind,
        filename: f.filename,
        entryCount: f.entryCount,
        totalCents: f.totalCents,
        stage: FILE_STAGE_LABEL[f.stage],
        deadlineDay: f.deadlineDay ?? "",
        bankDate: f.match?.bankDate ?? "",
        bankCents: f.match?.bankCents ?? null,
      })),
    },
    { name: "Payments", columns: PAYMENT_COLUMNS, rows: r.payments.map((p) => ({ ...p, payeeKind: p.payeeKind === "employee" ? "Employee" : "Vendor", status: PAYMENT_STATUS_LABEL[p.status], bankDate: p.bankDate ?? "" })) },
    { name: "Bank matches", columns: MATCH_COLUMNS, rows: r.bankMatches.map((m) => ({ ...m, bankDescription: m.bankDescription ?? "", pending: undefined })) },
    { name: "Still owed", columns: OWED_COLUMNS, rows: r.outstanding.map((o) => ({ ...o, sinceDate: o.sinceDate ?? "", ageDays: o.ageDays })) },
  ];
  const spec: WorkbookSpec = { filename: `ach-payments_${range.fromDate}_${range.toDate}`, title: "ACH payments report", sheets };
  return exportResponse(spec, format);
}
