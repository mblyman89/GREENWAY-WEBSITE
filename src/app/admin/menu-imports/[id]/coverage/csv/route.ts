/**
 * GET /admin/menu-imports/:id/coverage/csv[?source=&vendor=&undated=1]
 *
 * R74 S8 — the per-lot coverage report as a spreadsheet: every Cultivera lot, the manifest it will
 * sit on (Cultivera transfer / email / several emails / Unmatched Cultivera stock), why, and whether
 * its received date is blank. Same reads and filters as the page. Read-only.
 */
import { requirePermission } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { loadCoverage } from "@/lib/pos/cultivera-coverage-store";
import { coverageCsv, coverageFilterFromParams, filterCoverage } from "@/lib/pos/cultivera-coverage-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const bad = (m: string, status = 400) => new Response(m, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requirePermission("menu.import");
  if (!isSupabaseServiceConfigured) return bad("Supabase is not configured.", 503);
  const { id } = await ctx.params;
  const load = await loadCoverage(createSupabaseAdminClient(), id);
  if (!load.ok) return bad(load.error, 409);
  const u = new URL(req.url);
  const rows = filterCoverage(load.report.rows, coverageFilterFromParams((k) => u.searchParams.get(k)));
  return new Response("\uFEFF" + coverageCsv(rows), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cultivera-coverage-${id.slice(0, 8)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
