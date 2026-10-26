/**
 * GET /admin/menu-imports/count/roster/sheet?roster=<id>&sheet=<n>&platform=windows|mac[&prefill=1]
 *
 * R74 S50 — one roster sheet's workbook, made for the person it is assigned to and the computer they
 * use (Windows: Excel desktop + Protected View; Mac: Excel for Mac, not Numbers). Both platforms
 * carry the SAME workbook id, so whichever copy comes back is checked off against the same line;
 * two copies of one sheet are refused as a duplicate. prefill=1 (practice rosters only) writes the
 * practice lots in as if scanned, with deliberate discrepancies the practice check must catch.
 * Every download is recorded on the roster and in the audit log.
 */
import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildRosterWorkbook, isRosterId, loadRoster, rosterLotList, saveRoster } from "@/lib/pos/count-roster-store";
import { platformOf, pushEvent } from "@/lib/pos/count-roster-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const bad = (m: string, status = 400) => new Response(m, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(req: NextRequest) {
  const session = await requirePermission("menu.import");
  const u = new URL(req.url);
  const rosterId = u.searchParams.get("roster") ?? "";
  const number = Number(u.searchParams.get("sheet"));
  const platform = platformOf(u.searchParams.get("platform"));
  const prefill = u.searchParams.get("prefill") === "1";
  if (!isRosterId(rosterId)) return bad("Unknown roster.");
  const admin = createSupabaseAdminClient();
  const r = await loadRoster(admin, rosterId);
  if (!r) return bad("That roster was not found.", 404);
  const s = r.sheets.find((x) => x.number === number);
  if (!s) return bad("That sheet is not on the roster.", 404);
  if (s.voidedAt) return bad(`Sheet ${s.number} was voided; it cannot be downloaded.`, 409);
  if (r.archived) return bad("This roster is archived.", 409);

  let out;
  try {
    out = await buildRosterWorkbook(r, s, platform, await rosterLotList(admin, r), prefill);
  } catch (e) {
    return bad(`The workbook could not be built: ${e instanceof Error ? e.message : String(e)}`, 409);
  }
  const at = new Date().toISOString();
  s.downloads.push({ at, platform, prefilled: prefill });
  if (s.downloads.length > 20) s.downloads.splice(0, s.downloads.length - 20);
  if (r.mode === "test") s.practice = prefill ? out.practice : null;
  pushEvent(r, at, session.email ?? "", `Sheet ${s.number} (${s.assignee || "unassigned"}) downloaded for ${platform === "mac" ? "Mac" : "Windows"}${prefill ? ", pre-filled for practice" : ""}.`);
  await saveRoster(admin, r);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "cultivera_count.workbook_downloaded",
    entityType: "count_roster",
    entityId: rosterId,
    after: { workbookId: s.workbookId, sheet: s.number, assignee: s.assignee, platform, prefill, mode: r.mode, countDate: r.countDate, bytes: out.buffer.length },
  });
  return new Response(new Uint8Array(out.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${out.fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
