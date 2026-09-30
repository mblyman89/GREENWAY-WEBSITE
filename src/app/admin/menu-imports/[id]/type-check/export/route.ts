/**
 * GET /admin/menu-imports/:id/type-check/export — R16b
 *
 * The Type & category check as a sheet for the owner's Cultivera rep: every
 * flagged product, its CCRS Inventory Type now, what it should be (the
 * category's measured CCRS type) or the category it should move to, and why.
 * The CCRS type is never rewritten on our side (owner rule E1), so this sheet
 * IS the fix path for a type mismatch. Same gate and completeness guard as the
 * missing-products export: a short sheet is refused (503), never sent.
 */
import { requirePermission } from "@/lib/auth/session";
import { getImport, listVersions, getVersionItems, countVersionItems } from "@/lib/pos/menu-version";
import {
  buildTypeCheckReport,
  typeCheckRepSheetCsv,
  TYPE_CHECK_BULK_ROW_LIMIT,
} from "@/lib/pos/cultivera-type-from-category-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TEXT = { "Content-Type": "text/plain; charset=utf-8" };

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  await requirePermission("menu.import");
  const { id } = await ctx.params;

  const imp = await getImport(id);
  if (!imp) return new Response("Import not found.", { status: 404, headers: TEXT });

  const versions = await listVersions(50);
  const version = versions.find((v) => v.import_id === id) ?? null;
  if (!version) return new Response("No staged menu version for this import yet.", { status: 404, headers: TEXT });

  const [items, expected] = await Promise.all([getVersionItems(version.id), countVersionItems(version.id)]);
  if (expected !== null && items.length !== expected) {
    return new Response(
      `Refusing to export an incomplete sheet: read ${items.length} staged row(s) but the database reports ${expected}. Reload and try again.`,
      { status: 503, headers: TEXT },
    );
  }

  const report = buildTypeCheckReport(
    items.map((i) => ({
      sourceItemId: i.source_item_id,
      name: i.name,
      productName: i.product_name,
      category: i.pos_inventory_category,
      inventoryType: i.pos_inventory_type,
    })),
    TYPE_CHECK_BULK_ROW_LIMIT,
  );
  let csv: string;
  try {
    csv = typeCheckRepSheetCsv(report);
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "Could not build the sheet.", { status: 503, headers: TEXT });
  }
  const stamp = imp.created_at.slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cultivera-type-fixes-${stamp}-${id.slice(0, 8)}.csv"`,
    },
  });
}
