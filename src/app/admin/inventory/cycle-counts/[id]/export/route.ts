/**
 * GET /admin/inventory/cycle-counts/[id]/export
 *
 * Export the OPEN (or any) cycle count's lines to a spreadsheet the owner can
 * scan physical counts into (Beautification B5). Honours the same filter/sort
 * query params the on-screen list uses, so "export exactly what I'm looking at"
 * works. The sheet carries a blank "Counted Qty" column plus identity columns
 * (Line ID / Lot Code / POS key) used to match rows on re-import.
 *
 * Formats: ?format=xlsx (default) or ?format=csv.
 */
import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/session";
import { getCycleCount, getCycleCountSheetLines } from "@/lib/inventory/cycle-counts";
import {
  filterLines,
  sortLines,
  toExportRows,
  SHEET_HEADERS,
  type SheetFilter,
  type SheetSort,
  type SheetSortKey,
} from "@/lib/inventory/cycle-count-sheet-core";
import { buildXlsx, buildCsv, type WorkbookSpec, type TableColumn } from "@/lib/reports/workbook";

export const dynamic = "force-dynamic";

const SORT_KEYS: SheetSortKey[] = ["product", "lot", "category", "vendor", "brand", "system", "counted", "variance"];

function safeName(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "cycle-count";
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await requirePermission("inventory.manage");
  const { id } = await ctx.params;
  const session = await getCycleCount(id);
  if (!session) return new Response("Not found", { status: 404 });

  const sp = req.nextUrl.searchParams;
  const filter: SheetFilter = {
    q: sp.get("q") ?? undefined,
    category: sp.get("category") || null,
    inventoryType: sp.get("type") || null,
    vendorName: sp.get("vendor") || null,
    brandName: sp.get("brand") || null,
    counted: (sp.get("counted") as SheetFilter["counted"]) ?? "all",
    sample: (sp.get("sample") as SheetFilter["sample"]) ?? "all",
    medical: (sp.get("medical") as SheetFilter["medical"]) ?? "all",
  };
  const sortKeyRaw = sp.get("sort") ?? "product";
  const sort: SheetSort = {
    key: (SORT_KEYS.includes(sortKeyRaw as SheetSortKey) ? sortKeyRaw : "product") as SheetSortKey,
    dir: sp.get("dir") === "desc" ? "desc" : "asc",
  };

  const all = await getCycleCountSheetLines(id);
  const rows = toExportRows(sortLines(filterLines(all, filter), sort));

  const columns: TableColumn[] = SHEET_HEADERS.map((h) => ({
    key: h,
    header: h,
    type: h === "Counted Qty" ? "number" : "text",
  }));

  const spec: WorkbookSpec = {
    filename: `${safeName(session.label)}-count-sheet`,
    title: `Cycle count — ${session.label}`,
    sheets: [
      {
        name: "Count Sheet",
        caption:
          "Scan physical units into the Counted Qty column, then import this file back into the open count. Do not change the Lot Code / POS Product Key / Line ID columns.",
        columns,
        rows,
      },
    ],
  };

  const format = sp.get("format") === "csv" ? "csv" : "xlsx";
  if (format === "csv") {
    const csv = buildCsv(spec);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${spec.filename}.csv"`,
      },
    });
  }
  const buf = await buildXlsx(spec);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${spec.filename}.xlsx"`,
    },
  });
}
