/**
 * GET /admin/customers/export?format=csv|xlsx&...  (customers-table-enterprise)
 *
 * Download the customers table exactly as filtered / searched / sorted on
 * screen, every column. Bulk customer PII leaves the building here, so:
 * customers.manage AND manager-or-above (customer-table-core.canExportCustomers),
 * and every download is audited (filters + row count, never a name, phone or
 * email).
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { exportResponse, parseFormat } from "@/lib/reports/workbook";
import { canExportCustomers, customerExportAudit, parseCustomerTableParams } from "@/lib/customers/customer-table-core";
import { exportCustomerWorkbook } from "@/lib/customers/customer-table-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const session = await requirePermission("customers.manage");
  if (!canExportCustomers(session.profile.role)) {
    return new Response("Downloading the customer list needs a manager, admin or owner.", { status: 403 });
  }
  const url = new URL(request.url);
  const params: Record<string, string> = {};
  for (const [k, v] of url.searchParams) if (!(k in params)) params[k] = v;
  const state = parseCustomerTableParams(params);
  const format = parseFormat(url.searchParams.get("format"));

  const result = await exportCustomerWorkbook(state);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "customers.exported",
    entityType: "customers",
    entityId: null,
    after: { ...customerExportAudit(state, result.rows, format), truncated: result.truncated, failed: Boolean(result.error) },
  });
  return exportResponse(result.spec, format);
}
