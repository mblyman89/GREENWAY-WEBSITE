/**
 * GET /admin/menu-imports/count/roster/zip?roster=<id>[&platform=windows|mac|assigned]
 *
 * R74 S50 — every active sheet of a roster in one .zip, each named after its person, area and
 * platform, so the owner can attach each file to that person's email. "assigned" (the default) gives
 * every sheet in the platform chosen for its person. The product list is loaded once. A README in
 * the zip lists who gets which file.
 */
import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildRosterWorkbook, isRosterId, loadRoster, rosterLotList, saveRoster } from "@/lib/pos/count-roster-store";
import { platformOf, pushEvent, type CountPlatform } from "@/lib/pos/count-roster-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const bad = (m: string, status = 400) => new Response(m, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(req: NextRequest) {
  const session = await requirePermission("menu.import");
  const u = new URL(req.url);
  const rosterId = u.searchParams.get("roster") ?? "";
  const pick = u.searchParams.get("platform") ?? "assigned";
  if (!isRosterId(rosterId)) return bad("Unknown roster.");
  const admin = createSupabaseAdminClient();
  const r = await loadRoster(admin, rosterId);
  if (!r) return bad("That roster was not found.", 404);
  if (r.archived) return bad("This roster is archived.", 409);
  const sheets = r.sheets.filter((s) => !s.voidedAt);
  if (sheets.length === 0) return bad("No active sheet on this roster.", 409);

  const mod = await import("xlsx");
  const CFB = mod.CFB ?? (mod as unknown as { default: typeof mod }).default.CFB;
  if (!CFB) return bad("The zip writer is unavailable.", 500);
  const zip = CFB.utils.cfb_new();
  const readme: string[] = [`Greenway count workbooks — ${r.title} — count date ${r.countDate}${r.mode === "test" ? " (PRACTICE)" : ""}`, ""];
  const at = new Date().toISOString();
  try {
    const lots = await rosterLotList(admin, r);
    for (const s of sheets) {
      const platform: CountPlatform = pick === "assigned" ? s.platform : platformOf(pick);
      const out = await buildRosterWorkbook(r, s, platform, lots, false);
      CFB.utils.cfb_add(zip, out.fileName, out.buffer);
      s.downloads.push({ at, platform, prefilled: false });
      if (r.mode === "test") s.practice = null;
      readme.push(`Sheet ${s.number}: ${s.assignee || "(unassigned)"}${s.zone ? ` — ${s.zone}` : ""}${s.email ? ` <${s.email}>` : ""} → ${out.fileName}`);
    }
  } catch (e) {
    return bad(`The workbooks could not be built: ${e instanceof Error ? e.message : String(e)}`, 409);
  }
  readme.push("", "Email each person ONLY their own file. Ask them to send it back as an attachment, unrenamed.");
  CFB.utils.cfb_add(zip, "README - who gets which file.txt", Buffer.from(readme.join("\r\n"), "utf8"));
  const buffer = CFB.write(zip, { fileType: "zip", type: "buffer", compression: true }) as Buffer;
  pushEvent(r, at, session.email ?? "", `All ${sheets.length} sheet(s) downloaded as a zip (${pick === "assigned" ? "each person's platform" : pick}).`);
  await saveRoster(admin, r);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "cultivera_count.workbook_downloaded",
    entityType: "count_roster",
    entityId: rosterId,
    after: { zip: true, sheets: sheets.map((s) => ({ sheet: s.number, workbookId: s.workbookId, assignee: s.assignee })), platform: pick, mode: r.mode, bytes: buffer.length },
  });
  const name = `${r.mode === "test" ? "PRACTICE-" : ""}greenway-count-${r.countDate}-all-${sheets.length}-sheets.zip`;
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
}
