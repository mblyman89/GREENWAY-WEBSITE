/**
 * GET /admin/loyalty-signups/export — CSV download of the loyalty queue.
 * Staff-gated (loyalty.view). Honors ?status= and ?q= filters from the queue UI.
 */
import { requirePermission } from "@/lib/auth/session";
import { exportLoyaltyCsv, type LoyaltyStatus } from "@/lib/loyalty/signups-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  await requirePermission("loyalty.view");

  const url = new URL(request.url);
  const status = (url.searchParams.get("status") as LoyaltyStatus | "all" | null) ?? "all";
  const search = url.searchParams.get("q") ?? "";

  const csv = await exportLoyaltyCsv({ status, search });
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="greenway-loyalty-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
