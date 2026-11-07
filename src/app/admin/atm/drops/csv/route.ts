/**
 * GET /admin/atm/drops/csv?from=YYYY-MM-DD&to=YYYY-MM-DD   (D198 S5)
 *
 * Every ATM drop in the window with its matched PAI cash load, the verdict, the risk score, the
 * signals and the owner's review - for the accountant, the insurer or a police report. OWNER ONLY
 * (finances.view). Cells are formula-injection safe (matchCsv). Downloading it is audited.
 */
import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { matchAtmDrops, matchCsv } from "@/lib/atm/atm-drop-match-core";
import { getAtmDropMatchInputs, resolveMatchWindow } from "@/lib/atm/atm-drop-match-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await requirePermission("finances.view");
  const u = new URL(req.url);
  const w = resolveMatchWindow(u.searchParams.get("from"), u.searchParams.get("to"));
  const inp = await getAtmDropMatchInputs(w);
  const result = matchAtmDrops({
    drops: inp.drops,
    loads: inp.loads,
    settlements: inp.settlements,
    deposits: inp.deposits,
    reviews: inp.reviews,
    options: {
      matchWindowMinutes: inp.settings.matchWindowMinutes,
      terminalId: inp.settings.terminalId,
      witnessPolicy: inp.settings.witness,
      nowIso: new Date().toISOString(),
      plaidLastSyncedAt: inp.plaidLastSyncedAt,
      hasAtmAccount: inp.hasAtmAccount,
    },
  });
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "atm.drop_match_export",
    entityType: "atm_drop_match",
    entityId: `${w.fromDay}..${w.toDay}`,
    after: { drops: result.summary.drops, problems: result.summary.problems },
  });
  return new Response("\uFEFF" + matchCsv(result), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="atm-drop-match-${w.fromDay}-to-${w.toDay}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
