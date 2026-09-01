/**
 * GET /admin/menu-imports/:id/facts/export
 *
 * Downloads the golden-record dry-run report (all three buckets --
 * auto-accepted / needs-review / rejected -- one row per product with facts,
 * sources, confidence, and plain-English notes) as a CSV spreadsheet.
 * Gated on menu.import, same as the review screen it mirrors.
 */
import { requirePermission } from "@/lib/auth/session";
import { getImport, getImportDiagnosticsChecked, listVersions, getVersionItems } from "@/lib/pos/menu-version";
import { listFactReviews, factReviewsToResolutions } from "@/lib/pos/fact-review-store";
import {
  buildFactReviewBuckets,
  buildFactReviewCsv,
  menuItemRowToFactReviewItem,
  posDiagnosticToFactReviewDiagnostic,
} from "@/lib/pos/fact-review-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  await requirePermission("menu.import");
  const { id } = await ctx.params;

  const imp = await getImport(id);
  if (!imp) return new Response("Import not found.", { status: 404 });

  // SLICE 6A: the exported spreadsheet is the owner's offline copy of the whole
  // dry-run report, so it must not be a silently-capped 1,000 of 6,603 rows.
  // `{ limit: 5000 }` never raised PostgREST's ceiling; this reads every row.
  const [versions, diag, reviews] = await Promise.all([
    listVersions(50),
    getImportDiagnosticsChecked(id),
    listFactReviews(id),
  ]);
  const diagnostics = diag.rows;
  // Refuse to hand over a spreadsheet that silently omits rows -- an owner
  // reconciling against this file would be reconciling against a subset.
  if (!diag.verdict.complete) {
    return new Response(
      `Refusing to export an incomplete report: ${diag.verdict.message}`,
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }
  const version = versions.find((v) => v.import_id === id) ?? null;
  const items = version ? await getVersionItems(version.id) : [];

  const buckets = buildFactReviewBuckets(
    items.map(menuItemRowToFactReviewItem),
    diagnostics.map(posDiagnosticToFactReviewDiagnostic),
    factReviewsToResolutions(reviews),
  );
  const csv = buildFactReviewCsv(buckets);
  const stamp = imp.created_at.slice(0, 10);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="fact-review-${stamp}-${id.slice(0, 8)}.csv"`,
    },
  });
}
