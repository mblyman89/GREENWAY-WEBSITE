/**
 * GET /admin/settings/banking/files/[id]/download
 *
 * R41 S3: serves one RELEASED ACH file from the ach_files ledger (payroll,
 * vendor, prenote or test credit): the exact stored bytes, after the SHA-256
 * and the header facts are re-checked. WRITES NOTHING and BUILDS NOTHING. A
 * voided file is never served. Owner/admin only (settings.manage); never
 * cached; the download is audited without bank numbers.
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { readAchFileForDownload } from "@/lib/payments/ach-file-ledger-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requirePermission("settings.manage");
  const { id } = await params;
  const res = await readAchFileForDownload(id);
  if (!res.ok) {
    return new Response(`Could not serve the ACH file: ${res.error}`, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ach.file.downloaded",
    entityType: "ach_files",
    entityId: res.row.id,
    after: { kind: res.row.kind, filename: res.row.filename, file_id_modifier: res.row.file_id_modifier, sha256: res.row.sha256 },
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
