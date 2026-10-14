/**
 * GET /admin/menu-imports/reconcile/csv?import=<id>[&kind=&vendor=&category=&q=&open=1]
 *
 * R50 A2 - every difference line (or the filtered ones) as a spreadsheet, with
 * what each means, what to do, the owner's note and the lot ids. Same reads
 * and same filters as the page. Read-only.
 */
import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { loadReconcile } from "@/lib/pos/cultivera-reconcile";
import { filterLines, parseKind, reconcileCsv } from "@/lib/pos/cultivera-reconcile-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const bad = (m: string, status = 400) => new Response(m, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(req: NextRequest) {
  await requirePermission("menu.import");
  if (!isSupabaseServiceConfigured) return bad("Supabase is not configured.", 503);
  const u = new URL(req.url);
  const importId = u.searchParams.get("import") ?? "";
  const load = await loadReconcile(createSupabaseAdminClient(), importId);
  if (!load.ok) return bad(load.error, 409);
  const lines = filterLines(
    load.report.mismatches,
    {
      kind: parseKind(u.searchParams.get("kind")) || undefined,
      vendor: u.searchParams.get("vendor") || undefined,
      category: u.searchParams.get("category") || undefined,
      q: u.searchParams.get("q") || undefined,
      open: u.searchParams.get("open") === "1",
    },
    load.explanations,
  );
  const body = "\uFEFF" + reconcileCsv(lines, load.explanations);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cultivera-reconcile-${load.imp.id.slice(0, 8)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
