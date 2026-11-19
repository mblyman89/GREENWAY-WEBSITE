/**
 * POST /api/ccrs-uploader/next - D253. The Greenway Chrome extension checks
 * in (~every 30 s) with the CCRS tabs it sees; the answer is one decision:
 * idle, wait, or upload THIS one file (ccrs-auto-upload-store.deviceCheckIn).
 */
import { NextResponse } from "next/server";
import { deviceCheckIn } from "@/lib/compliance/ccrs-auto-upload-store";
import { deviceOr401, json, readJson } from "@/lib/compliance/ccrs-auto-upload-http";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const ctx = await deviceOr401(req);
  if (ctx instanceof NextResponse) return ctx;
  let body: { tabs?: unknown; version?: unknown };
  try {
    body = (await readJson(req)) as { tabs?: unknown; version?: unknown };
  } catch {
    return json({ error: "bad request" }, 400);
  }
  try {
    const answer = await deviceCheckIn(ctx.admin, ctx.device, body.tabs, typeof body.version === "string" ? body.version : null);
    return json(answer);
  } catch (e) {
    return json({ action: "wait", text: `The back office could not decide: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500), pollSeconds: 60 }, 500);
  }
}
