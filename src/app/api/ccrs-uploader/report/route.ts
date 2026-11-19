/**
 * POST /api/ccrs-uploader/report - D253. What CCRS's page said after the
 * browser posted the file ({ runFileId, report: { status, responseType,
 * text, networkError } }). Only the two answer pages seen on PREprod are
 * trusted; anything else stops the run (ccrs-auto-upload-core.classifyUpload).
 */
import { NextResponse } from "next/server";
import { deviceReport } from "@/lib/compliance/ccrs-auto-upload-store";
import { RUN_FILE_ID_RE, deviceOr401, json, readJson } from "@/lib/compliance/ccrs-auto-upload-http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const ctx = await deviceOr401(req);
  if (ctx instanceof NextResponse) return ctx;
  let body: { runFileId?: unknown; report?: unknown };
  try {
    body = (await readJson(req)) as { runFileId?: unknown; report?: unknown };
  } catch {
    return json({ error: "bad request" }, 400);
  }
  const id = typeof body.runFileId === "string" ? body.runFileId : "";
  if (!RUN_FILE_ID_RE.test(id)) return json({ error: "bad id" }, 400);
  try {
    return json(await deviceReport(ctx.admin, ctx.device, id, body.report));
  } catch (e) {
    return json({ ok: false, verdict: "unknown", text: e instanceof Error ? e.message : String(e) }, 500);
  }
}
