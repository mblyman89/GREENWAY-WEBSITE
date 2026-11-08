/**
 * GET /admin/purchasing/menus/csv?table=searched|needed&<same filters as page>
 *
 * D209: the Vendor Menus coverage tables as a spreadsheet. Same filters and
 * sort the owner has applied on the page (sq/ssrc/sfresh/slink/ssort for the
 * searched table, nq/ngrp/nsort for the needed table). Read only. Managers and
 * up (inventory.manage), like the page. An unknown table is refused, never
 * guessed (rule 3). An incomplete read is refused (409), never shipped as a
 * short file that looks complete.
 */
import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pacificDayKey } from "@/lib/reports/timezone";
import {
  filterSortNeeded,
  filterSortSearched,
  neededCsv,
  parseCoverageParams,
  searchedCsv,
} from "@/lib/purchasing/vendor-menu-coverage-core";
import { loadVendorMenuCoverage } from "@/lib/purchasing/vendor-menu-coverage-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bad = (m: string, status = 400) =>
  new Response(m, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(req: NextRequest) {
  await requirePermission("inventory.manage");
  if (!isSupabaseServiceConfigured) return bad("Supabase is not configured.", 503);
  const u = new URL(req.url);
  const table = u.searchParams.get("table");
  if (table !== "searched" && table !== "needed") return bad('Table must be "searched" or "needed".');

  const sp: Record<string, string> = {};
  u.searchParams.forEach((v, k) => {
    sp[k] = v;
  });
  const p = parseCoverageParams(sp);
  const nowMs = Math.floor(Date.now() / 60_000) * 60_000;
  const cov = await loadVendorMenuCoverage(nowMs);
  if (cov.warnings.length > 0) {
    return bad(`The coverage read is incomplete, so no file was made: ${cov.warnings.join(" ")}`, 409);
  }

  const body =
    table === "searched"
      ? searchedCsv(filterSortSearched(cov.searched, p), nowMs)
      : neededCsv(filterSortNeeded(cov.needed, p));
  const day = pacificDayKey(new Date(nowMs));
  const name = table === "searched" ? "vendor-menus-searched" : "vendors-needing-menus";
  return new Response("\uFEFF" + body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
