/**
 * GET /admin/inventory/export?scope=view|page|all&columns=visible|all&format=xlsx|csv&<every table param>
 *
 * R38 S4 — the inventory table's intelligent export.
 *
 * Owner: "an export feature. An intelligent one that allows me to export any
 * and all data I need and want."
 *
 *   scope=view    the filtered/searched/sorted view, EVERY page (default)
 *   scope=page    only the rows on the page being looked at (same page size)
 *   scope=all     every lot, ignoring filters and status tabs
 *   columns=visible  the columns on screen (view= / cols=), split flat
 *   columns=all      every field the registry knows
 *
 * The rows come from the SAME pipeline as the page (loadInventoryTableLots +
 * buildInventoryPage), so the file and the table can never disagree.
 *
 * FAIL CLOSED: if the onboarding read or the website-category resolve did
 * not finish, the file would carry blanks that look like real answers, so it
 * returns 503 and says why instead. Staff-gated (inventory.manage) and
 * recorded in the audit log (who exported what, how many rows).
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { exportResponse, parseFormat } from "@/lib/reports/workbook";
import { pacificToday } from "@/lib/reports/timezone";
import { buildInventoryPage, withDefaultStatus, type PageLot } from "@/lib/inventory/inventory-page-core";
import { parsePageParam } from "@/lib/admin/list-window-core";
import { activeFilterChips, type RawParams } from "@/lib/inventory/inventory-url-core";
import { inventoryTotals } from "@/lib/inventory/inventory-metrics-core";
import { loadInventoryTableLots } from "@/lib/inventory/inventory-table-server";
import {
  buildInventoryExport,
  effectivePageSize,
  parseColumnView,
  parseExportColumns,
  parseExportScope,
  parsePageSize,
  TABLE_COLUMN_IDS,
  type TableLot,
} from "@/lib/inventory/inventory-table-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function rawFrom(url: URL): RawParams {
  const raw: Record<string, string | string[]> = {};
  for (const [k, v] of url.searchParams) {
    const cur = raw[k];
    raw[k] = cur === undefined ? v : Array.isArray(cur) ? [...cur, v] : [cur, v];
  }
  return raw;
}

export async function GET(request: Request) {
  const session = await requirePermission("inventory.manage");
  const url = new URL(request.url);
  // The export panel's default is Excel (it carries the Summary + Columns
  // sheets); a bare link gets the same file, not a different default.
  const format = parseFormat(url.searchParams.get("format") ?? "xlsx");
  const scope = parseExportScope(url.searchParams.get("scope"));
  const columns = parseExportColumns(url.searchParams.get("columns"));
  if (!isSupabaseServiceConfigured) {
    return new Response("Supabase is not configured, so inventory data is unavailable.", { status: 503 });
  }

  // The export's own knobs are not table filters; strip them before the
  // pipeline sees the params (the page applies the same default status).
  const own = new Set(["scope", "columns", "format"]);
  const tableRaw = withDefaultStatus(
    Object.fromEntries(Object.entries(rawFrom(url)).filter(([k]) => !own.has(k))) as RawParams,
  );

  const data = await loadInventoryTableLots();
  if (!data.onboardingComplete || !data.categoriesComplete) {
    const what = [!data.onboardingComplete && "onboarding decisions", !data.categoriesComplete && "website categories"]
      .filter(Boolean)
      .join(" and ");
    return new Response(
      `Inventory export unavailable: the ${what} could not be fully loaded, so the file would contain blanks that look like real answers. Try again in a moment.`,
      { status: 503 },
    );
  }

  let lots: TableLot[];
  let filterLines: string[] = [];
  let sortLine: string | null = null;
  if (scope === "all") {
    lots = data.lots as unknown as TableLot[];
  } else {
    const choice = parsePageSize(tableRaw);
    const view = buildInventoryPage({
      lots: data.lots as unknown as PageLot[],
      params: tableRaw,
      page: parsePageParam(typeof tableRaw.page === "string" ? tableRaw.page : undefined),
      pageSize: effectivePageSize(choice, data.lots.length),
      now: new Date(),
      leaflyKeys: data.leafly.keys,
    });
    lots = (scope === "page" ? view.rows : view.matched) as unknown as TableLot[];
    const status = typeof tableRaw.status === "string" ? tableRaw.status : "all";
    filterLines = [
      `Status tab: ${status}`,
      ...(typeof tableRaw.q === "string" && tableRaw.q.trim() ? [`Search: ${tableRaw.q.trim()}`] : []),
      ...activeFilterChips(tableRaw, view.filters).map((c) => `${c.group}: ${c.label}`),
    ];
    if (view.column && view.direction) {
      sortLine = `${view.column.label}, ${view.direction === "asc" ? "ascending" : "descending"}`;
    }
  }

  const columnIds = columns === "all" ? TABLE_COLUMN_IDS : parseColumnView(tableRaw).ids;
  const today = pacificToday();
  const spec = buildInventoryExport({
    lots,
    scope,
    columnIds,
    ctx: { leaflyKeys: data.leafly.keys },
    today,
    generatedAt: new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC",
    filterLines,
    sortLine,
    byUnit: inventoryTotals(lots).onHandByUnit,
  });

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "inventory.export",
    entityType: "inventory_lots",
    entityId: null,
    after: { scope, columns, format, rows: lots.length, fields: spec.sheets[0].columns.length, filters: filterLines },
  });

  return exportResponse(spec, format);
}
