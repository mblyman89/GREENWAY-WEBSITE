/**
 * GET /admin/compliance/ccrs/records/<id>/export[?problems=1] - R74 S40: every
 * finding of one CCRS copy comparison as CSV (formula-injection safe).
 */
import { requirePermission } from "@/lib/auth/session";
import { getCopy } from "@/lib/compliance/ccrs-records-store";
import { itemsCsv } from "@/lib/compliance/ccrs-records-compare-core";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  await requirePermission("reports.view");
  const { id } = await ctx.params;
  const copy = await getCopy(id);
  if (!copy?.summary) return new Response("No comparison for this copy yet.", { status: 404 });
  const problemsOnly = new URL(req.url).searchParams.get("problems") === "1";
  const items = problemsOnly ? copy.summary.items.filter((i) => i.problem) : copy.summary.items;
  return new Response(itemsCsv(items), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ccrs-compare-${copy.as_of}${problemsOnly ? "-needs-action" : ""}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
