/**
 * GET /admin/settings/banking/files/[id]/reversal-sheet
 *
 * R41 S13: the reversal call sheet for one file that went to Timberland
 * (status uploaded or bank_approved). Built from the exact stored bytes,
 * after readAchFileForDownload re-checks the SHA-256 and the header facts.
 * Plain text, printable, with NO account numbers (ach-reversal-sheet-core).
 * WRITES NOTHING but the audit line. Owner/admin only (settings.manage);
 * never cached.
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { readAchFileForDownload } from "@/lib/payments/ach-file-ledger-store";
import { reversalSheet } from "@/lib/payments/ach-reversal-sheet-core";

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
    return new Response(`Could not make the reversal call sheet: ${res.error}`, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const sheet = reversalSheet(res.body, res.row);
  if (!sheet.ok) {
    return new Response(`Could not make the reversal call sheet: ${sheet.error}`, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ach.file.reversal_sheet",
    entityType: "ach_files",
    entityId: res.row.id,
    after: { kind: res.row.kind, filename: res.row.filename, sha256: res.row.sha256 },
  }).catch(() => {});
  return new Response(sheet.text, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `inline; filename="reversal-sheet-${res.row.filename}.txt"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
