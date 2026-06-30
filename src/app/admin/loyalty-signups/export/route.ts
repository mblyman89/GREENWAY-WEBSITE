/**
 * GET /admin/loyalty-signups/export?format=csv|xlsx — download the loyalty queue.
 * Staff-gated (loyalty.view). Honors ?status= and ?q= filters from the queue UI.
 * Renders a clean CSV or styled .xlsx via the shared workbook helper.
 */
import { requirePermission } from "@/lib/auth/session";
import { exportLoyaltyWorkbook, type LoyaltyStatus } from "@/lib/loyalty/signups-store";
import { exportResponse, parseFormat } from "@/lib/reports/workbook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  await requirePermission("loyalty.view");

  const url = new URL(request.url);
  const status = (url.searchParams.get("status") as LoyaltyStatus | "all" | null) ?? "all";
  const search = url.searchParams.get("q") ?? "";
  const format = parseFormat(url.searchParams.get("format"));

  const spec = await exportLoyaltyWorkbook({ status, search });
  return exportResponse(spec, format);
}
