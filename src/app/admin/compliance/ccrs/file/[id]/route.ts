/**
 * GET /admin/compliance/ccrs/file/<ccrs_files.id>  — CCRS Bible v2 S-12c.
 *
 * Re-download ONE emitted file: the exact stored bytes, under the exact stored
 * name (readStoredFile re-hashes them against ccrs_files.sha256 and throws on
 * a mismatch, Part 05 §A). Never rebuilt: a rebuilt file could differ by one
 * byte and CCRS refuses "the same file name ... nor the same data" twice
 * [BRIAN A29], so the bytes that were recorded are the bytes handed out.
 */
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readStoredFile } from "@/lib/compliance/ccrs-ledger-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_NAME_RE = /^[A-Za-z]+_\d+_\d{14}\.csv$/;
const TEXT = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("reports.view");
  if (!can(session.profile.role, "settings.manage")) {
    return new Response("Downloading CCRS files requires the Change settings permission.", { status: 403, headers: TEXT });
  }
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return new Response("Not found", { status: 404, headers: TEXT });
  let file: { fileName: string; csv: string };
  try {
    file = await readStoredFile(createSupabaseAdminClient(), id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /not found|0 rows|no rows/i.test(msg) ? 404 : 500;
    return new Response(status === 404 ? "Not found" : `STOP: ${msg}. Do not upload this file; tell the developer.`, { status, headers: TEXT });
  }
  if (!SAFE_NAME_RE.test(file.fileName)) return new Response("Stored file name is not a CCRS name.", { status: 500, headers: TEXT });
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ccrs.file.download",
    entityType: "ccrs_files",
    entityId: id,
    after: { fileName: file.fileName },
  });
  return new Response(file.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file.fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
