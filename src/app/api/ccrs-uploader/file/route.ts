/**
 * GET /api/ccrs-uploader/file?id=<run file id> - D253. The stored bytes of the
 * ONE file this paired browser was just handed (sha256 re-checked on read).
 * Any other file, or a file of a stopped run, is 404.
 */
import { NextResponse } from "next/server";
import { deviceFile } from "@/lib/compliance/ccrs-auto-upload-store";
import { NO_STORE, RUN_FILE_ID_RE, deviceOr401, json } from "@/lib/compliance/ccrs-auto-upload-http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ctx = await deviceOr401(req);
  if (ctx instanceof NextResponse) return ctx;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!RUN_FILE_ID_RE.test(id)) return json({ error: "bad id" }, 400);
  try {
    const f = await deviceFile(ctx.admin, ctx.device, id);
    if (!f) return json({ error: "This browser does not hold that file." }, 404);
    return new NextResponse(f.csv, {
      status: 200,
      headers: { ...NO_STORE, "Content-Type": "text/csv; charset=utf-8", "X-Ccrs-File-Name": f.fileName },
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
