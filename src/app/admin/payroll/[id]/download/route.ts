/**
 * GET /admin/payroll/[id]/download
 *
 * R41 S3: serves the payroll run's RELEASED ACH file, the exact bytes stored
 * in ach_files when the owner generated it. The SHA-256 is re-checked before
 * a byte is served. This route WRITES NOTHING and BUILDS NOTHING: it never
 * re-runs the guardrails and never re-stamps who approved the run (before
 * R41 S3 every download rebuilt the file and overwrote approved_by). A
 * voided file is never served. Owner/admin only (settings.manage); the
 * download is audited without bank numbers.
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { readLiveFileForSource } from "@/lib/payments/ach-file-ledger-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requirePermission("settings.manage");
  const { id } = await params;
  const res = await readLiveFileForSource("payroll", id);
  if (!res.ok) {
    return new Response(`Could not serve the ACH file: ${res.error}`, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ach.file.downloaded",
    entityType: "ach_files",
    entityId: res.row.id,
    after: { kind: "payroll", run_id: id, filename: res.row.filename, file_id_modifier: res.row.file_id_modifier, sha256: res.row.sha256 },
  }).catch(() => {});
  return new Response(res.body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=us-ascii",
      "Content-Disposition": `attachment; filename="${res.row.filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
