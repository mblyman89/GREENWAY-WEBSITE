/**
 * GET /admin/menu-imports/count/workbook?run=<harvest run id>&counter=<name>&date=<YYYY-MM-DD>
 *
 * R50 S11 — one counter's scan workbook for the Oct 30 count (Cultivera menu upload pipeline).
 * The product list comes from a FINISHED harvest whose inventories.json matches its manifest
 * (bytes + sha256); otherwise the download is refused with the reason. Every download is audited
 * with the workbook id, so an uploaded copy can be traced to the counter it was made for.
 */
import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { isValidRunId, loadRunLotList } from "@/lib/pos/cultivera-fetch-client";
import { buildCountWorkbook } from "@/lib/pos/cultivera-count-workbook";
import { salesDayAfter } from "@/lib/pos/cultivera-count-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const bad = (m: string, status = 400) => new Response(m, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(req: NextRequest) {
  const session = await requirePermission("menu.import");
  const u = new URL(req.url);
  const runId = u.searchParams.get("run") ?? "";
  const counter = (u.searchParams.get("counter") ?? "").trim().replace(/\s+/g, " ");
  const date = u.searchParams.get("date") ?? "";
  if (!isValidRunId(runId)) return bad("Pick a finished harvest.");
  if (!counter || counter.length > 60) return bad("Type the counter's name (up to 60 characters).");
  if (!salesDayAfter(date)) return bad("The count date is not a real date (YYYY-MM-DD).");

  let list;
  try {
    list = await loadRunLotList(runId);
  } catch (e) {
    return bad(`That harvest cannot be used for workbooks: ${e instanceof Error ? e.message : String(e)}`, 409);
  }
  const out = await buildCountWorkbook({
    counter,
    countDate: date,
    lots: list.lots.map((l) => ({ barcode: String(l.Barcode ?? ""), productName: String(l.ProductName ?? ""), storage: String(l.StorageName ?? "") })),
    lotsSource: runId,
  });
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "cultivera_count.workbook_downloaded",
    entityType: "cultivera_pos_run",
    entityId: runId,
    after: { workbookId: out.workbookId, counter, countDate: date, lots: list.lots.length, inventoriesSha256: list.sha256, bytes: out.buffer.length },
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
