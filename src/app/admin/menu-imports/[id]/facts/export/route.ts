/**
 * GET /admin/menu-imports/:id/facts/export
 *
 * Downloads the golden-record dry-run report (all three buckets --
 * auto-accepted / needs-review / rejected -- one row per product with facts,
 * sources, confidence, and plain-English notes) as a CSV spreadsheet.
 * Gated on menu.import, same as the review screen it mirrors.
 */
import { requirePermission } from "@/lib/auth/session";
import { getImport, getImportDiagnostics, listVersions, getVersionItems } from "@/lib/pos/menu-version";
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

  const [versions, diagnostics, reviews] = await Promise.all([
    listVersions(50),
    getImportDiagnostics(id, { limit: 5000 }),
    listFactReviews(id),
  ]);
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
