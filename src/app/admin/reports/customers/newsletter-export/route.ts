/**
 * GET /admin/reports/customers/newsletter-export?format=csv|xlsx&from=&to=
 *
 * Export the newsletter statistics suite (Slice 50) as CSV or styled XLSX:
 * one sheet of per-campaign stats + a totals row. Staff-gated (reports.view).
 * Rates are emitted as percent cells via the shared workbook helper.
 */
import { requirePermission } from "@/lib/auth/session";
import { resolveRange } from "@/lib/reports/range";
import { getNewsletterStats } from "@/lib/reports/newsletter-stats";
import {
  exportResponse,
  parseFormat,
  type TableColumn,
  type TableRow,
  type WorkbookSpec,
} from "@/lib/reports/workbook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const COLUMNS: TableColumn[] = [
  { key: "subject", header: "Newsletter", type: "text" },
  { key: "sentAt", header: "Sent", type: "text" },
  { key: "recipients", header: "Audience", type: "integer" },
  { key: "delivered", header: "Delivered", type: "integer" },
  { key: "opened", header: "Opened (read)", type: "integer" },
  { key: "openRate", header: "Open rate", type: "percent" },
  { key: "clicked", header: "Clicked", type: "integer" },
  { key: "clickRate", header: "Click rate", type: "percent" },
  { key: "returnToSender", header: "Return to sender", type: "integer" },
  { key: "bounced", header: "Hard bounce", type: "integer" },
  { key: "bounceRate", header: "Bounce rate", type: "percent" },
  { key: "complained", header: "Rejected (spam)", type: "integer" },
  { key: "unsubscribed", header: "Unsubscribed", type: "integer" },
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

  const stats = await getNewsletterStats(range.fromISO, range.toISO);

  const rows: TableRow[] = stats.campaigns.map((c) => ({
    subject: c.subject,
    sentAt: c.sentAt ? new Date(c.sentAt).toLocaleDateString("en-US") : "",
    recipients: c.recipients,
    delivered: c.delivered,
    opened: c.opened,
    openRate: c.openRate,
    clicked: c.clicked,
    clickRate: c.clickRate,
    returnToSender: c.returnToSender,
    bounced: c.bounced,
    bounceRate: c.bounceRate,
    complained: c.complained,
    unsubscribed: c.unsubscribed,
  }));

  const totals: TableRow = {
    subject: "TOTAL",
    sentAt: "",
    recipients: stats.totals.recipients,
    delivered: stats.totals.delivered,
    opened: stats.totals.opened,
    openRate: stats.totals.openRate,
    clicked: stats.totals.clicked,
    clickRate: stats.totals.clickRate,
    returnToSender: stats.totals.returnToSender,
    bounced: stats.totals.bounced,
    bounceRate: stats.totals.bounceRate,
    complained: stats.totals.complained,
    unsubscribed: stats.totals.unsubscribed,
  };

  const spec: WorkbookSpec = {
    filename: `newsletter-stats_${range.fromISO.slice(0, 10)}_${range.toISO.slice(0, 10)}`,
    title: "Newsletter statistics",
    sheets: [
      {
        name: "Campaigns",
        caption: `${range.fromISO.slice(0, 10)} → ${range.toISO.slice(0, 10)}`,
        columns: COLUMNS,
        rows,
        totals,
      },
    ],
  };

  return exportResponse(spec, format);
}
