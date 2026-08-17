/**
 * GET /admin/reports/accounting/sage-export?kind=&from=&to=
 *
 * Downloads a Sage-50-importable CSV for the chosen data type (Cash Receipts,
 * Purchases, Payments, Inventory-adjustment GJ, Vendor List). Admin-gated
 * (settings.manage). The formats match the official Sage 50 import specs and
 * the owner's real books — see docs/sage50-knowledge.md.
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { resolveRange } from "@/lib/reports/range";
import { buildSageExport, isSageExportKind } from "@/lib/accounting/sage-exports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await requirePermission("financials.view");
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") ?? "";
  if (!isSageExportKind(kind)) {
    return new Response("Unknown export kind.", { status: 400 });
  }
  const range = resolveRange({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    range: url.searchParams.get("range") ?? undefined,
    year: url.searchParams.get("year") ?? undefined,
  });

  const built = await buildSageExport(kind, range.fromISO, range.toISO);

  await recordAudit({
    actorId: session.profile.id,
    action: "sage50.export",
    entityType: "accounting",
    entityId: built.fileName,
    after: { kind, rows: built.rowCount, transactions: built.transactionCount },
  });

  return new Response(built.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${built.fileName}"`,
    },
  });
}
