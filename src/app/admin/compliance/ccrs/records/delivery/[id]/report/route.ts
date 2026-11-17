/**
 * GET /admin/compliance/ccrs/records/delivery/<id>/report - D250 S3: the full
 * plain-text plan of one examiner-delivery load (every review row, no cap).
 */
import { requirePermission } from "@/lib/auth/session";
import { deliveryReportText, getDeliveryLoad } from "@/lib/compliance/ccrs-delivery-store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  await requirePermission("reports.view");
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Bad id.", { status: 400 });
  const load = await getDeliveryLoad(id);
  const report = load ? await deliveryReportText(id) : null;
  if (!load || !report) return new Response("No check for this load yet.", { status: 404 });
  return new Response(report, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="ccrs-delivery-${load.as_of}-plan.txt"`,
      "Cache-Control": "no-store",
    },
  });
}
