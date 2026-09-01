/**
 * GET /admin/menu-imports/:id/missing-products/export
 *
 * Downloads the missing-product-master worklist as a CSV in the column layout
 * the owner's Cultivera rep already accepts (docs/CULTIVERA_PRODUCT_UPLOAD.md:
 * "Cultivera does not allow the owner to upload their own sheets — the rep does
 * the batch upload"). Gated on menu.import, same as the screen it mirrors.
 */
import { requirePermission } from "@/lib/auth/session";
import { getImport, listVersions, getVersionItems, countVersionItems } from "@/lib/pos/menu-version";
import {
  buildMissingProductMasterWorklist,
  menuItemRowToMissingMasterItem,
  missingMasterCsv,
} from "@/lib/pos/missing-product-master-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  await requirePermission("menu.import");
  const { id } = await ctx.params;

  const imp = await getImport(id);
  if (!imp) return new Response("Import not found.", { status: 404 });

  const versions = await listVersions(50);
  const version = versions.find((v) => v.import_id === id) ?? null;
  if (!version) {
    return new Response("No staged menu version for this import yet.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // SLICE 6B completeness guard, same doctrine as the SLICE 6A fact export.
  // The owner will work this sheet offline and send it to his rep, so a
  // silently-short file would mean products quietly never get created. A
  // server-side COUNT(*) is immune to PostgREST's db.max_rows ceiling, so it
  // is a trustworthy witness for what the paged read SHOULD have returned.
  const [items, expected] = await Promise.all([
    getVersionItems(version.id),
    countVersionItems(version.id),
  ]);

  if (expected !== null && items.length !== expected) {
    return new Response(
      `Refusing to export an incomplete worklist: read ${items.length} staged row(s) but the database reports ${expected}. ` +
        `Reload and try again; if this persists the read is being truncated and the list would understate what is missing.`,
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  const worklist = buildMissingProductMasterWorklist(
    items.map((row) => menuItemRowToMissingMasterItem(row, row.variants)),
  );

  const csv = missingMasterCsv(worklist);
  const stamp = imp.created_at.slice(0, 10);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="missing-product-masters-${stamp}-${id.slice(0, 8)}.csv"`,
    },
  });
}
