/**
 * GET /admin/menu-imports/fetch/[runId]/report
 *
 * R74 S3 — the one-click crawler report (owner, round 3: "walk me through the steps to getting you
 * the crawler data you need"). Staff-gated (menu.import, same as the run page).
 *
 *   - default:            ONE plain-text file (cultivera-run-<runId>-report.txt) with the stage
 *                         summary, vendor-file coverage, errors grouped by stage, the file list and
 *                         the raw state.json + errors.jsonl (pure cultivera-run-report-core).
 *   - ?file=state.json | errors.jsonl | manifest.json
 *                         the raw crawler file, byte-for-byte (allowlist; anything else is 400).
 *
 * Every download writes a `pos_fetch.report_download` audit row. Nothing is written to the crawler.
 */
import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { getPosRunFile, isValidRunId } from "@/lib/pos/cultivera-fetch-client";
import { PHASE_A_STAGES } from "@/lib/pos/cultivera-fetch-button-core";
import { buildRunReport, isRawReportFile, reportFilename, type RawReportFile } from "@/lib/pos/cultivera-run-report-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ runId: string }> }) {
  const session = await requirePermission("menu.import");
  const { runId } = await ctx.params;
  if (!isValidRunId(runId)) return new Response("Not a harvest run id.", { status: 404 });

  const fileParam = new URL(req.url).searchParams.get("file");
  const audit = (after: Record<string, unknown>) =>
    recordAudit({ actorId: session.userId, actorEmail: session.email, action: "pos_fetch.report_download", entityType: "cultivera_pos_run", entityId: runId, after });

  if (fileParam !== null) {
    if (!isRawReportFile(fileParam)) return new Response("Only state.json, errors.jsonl or manifest.json can be downloaded here.", { status: 400 });
    let buf: Buffer | null;
    try {
      buf = await getPosRunFile(runId, fileParam);
    } catch (e) {
      return new Response(`Could not read ${fileParam} from the crawler: ${e instanceof Error ? e.message : "unknown error"}`, { status: 502 });
    }
    if (!buf) return new Response(`${fileParam} is not in this run (the crawler only writes errors.jsonl when a fetch fails; a running harvest has no manifest.json yet).`, { status: 404 });
    await audit({ file: fileParam, bytes: buf.length });
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": fileParam.endsWith(".jsonl") ? "application/x-ndjson; charset=utf-8" : "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="cultivera-run-${runId}-${fileParam}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const readProblems: string[] = [];
  const read = async (name: RawReportFile): Promise<string | null> => {
    try {
      const b = await getPosRunFile(runId, name);
      return b ? b.toString("utf8") : null;
    } catch (e) {
      readProblems.push(e instanceof Error ? e.message : `${name}: unknown error`);
      return null;
    }
  };
  const parse = (name: string, text: string | null): unknown => {
    if (text === null) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      readProblems.push(`${name}: not valid JSON`);
      return null;
    }
  };
  const [stateText, manifestText, errorsText] = await Promise.all([read("state.json"), read("manifest.json"), read("errors.jsonl")]);
  if (stateText === null && !readProblems.some((p) => p.startsWith("state.json"))) readProblems.push("state.json: not in this run");
  const text = buildRunReport({
    runId,
    state: parse("state.json", stateText),
    manifest: parse("manifest.json", manifestText),
    errorsText,
    readProblems,
    generatedAtIso: new Date().toISOString(),
    stageOrder: PHASE_A_STAGES,
  });
  await audit({ file: "report", bytes: Buffer.byteLength(text), readProblems: readProblems.length });
  return new Response(text, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${reportFilename(runId)}"`,
      "Cache-Control": "no-store",
    },
  });
}
