/**
 * GET /admin/staffing/employees/[id]/esign/record?session=<uuid>
 *
 * R39 S6: the signer's copy of the e-signed GW-ACH-E record, on the last
 * screen at the counter (disclosure B.iv "download or print it on the last
 * screen today"; RCW 1.80.070 a record the recipient can store and print).
 *
 * Owner/admin only (settings.manage). The file is re-hashed against the
 * SHA-256 stored at signing before it is served. no-store: the PDF holds the
 * full bank numbers, like the paper form, and must not stay in a cache.
 */
import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { getEsignSession, signedRecordBytes } from "@/lib/payments/ach-esign-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("settings.manage");
  const { id } = await ctx.params;
  const employeeId = String(id ?? "").toLowerCase();
  const sid = String(new URL(req.url).searchParams.get("session") ?? "").toLowerCase();
  if (!UUID.test(employeeId) || !UUID.test(sid)) return new Response("Not found.", { status: 404 });
  const s = await getEsignSession(sid);
  if (!s || s.employee_id !== employeeId) return new Response("Not found.", { status: 404 });
  const rec = await signedRecordBytes(s);
  if (!rec.ok) return new Response(rec.error, { status: 409 });
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "ach_esign.record_copy",
    entityType: "ach_esign_session",
    entityId: s.id,
    before: null,
    after: { record_document_id: s.record_document_id, sha256: rec.sha256 },
  });
  return new Response(Buffer.from(rec.bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="GW-ACH-E-esigned-${s.signed_at ? s.signed_at.slice(0, 10) : "copy"}.pdf"`,
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
