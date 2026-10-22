/**
 * GET /admin/settings/banking/policies/packet
 *
 * R41 S18: the printable written ACH policies (plain text) with every source
 * quote, the adoption record, this quarter's access review and this year's
 * key checks. WRITES NOTHING but the audit line. Owner/admin
 * (settings.manage); never cached. No account numbers are in the packet.
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { pacificToday } from "@/lib/reports/timezone";
import { policiesPacket } from "@/lib/payments/ach-policies-core";
import { readControlRecords, readStaffLite } from "@/lib/payments/ach-policies-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function refuse(msg: string): Response {
  return new Response(`Could not make the policy packet: ${msg}`, {
    status: 400,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function GET() {
  const session = await requirePermission("settings.manage");
  const today = pacificToday();
  const [records, staff] = await Promise.all([readControlRecords(), readStaffLite()]);
  if (!records.ok) return refuse(records.error);
  if (!staff.ok) return refuse(staff.error);
  const nameOf = (id: string) => {
    const s = staff.rows.find((x) => x.id === id);
    return (s?.full_name ?? "").trim() || s?.email || "Unknown staff";
  };
  const text = policiesPacket({
    generatedAt: new Date(),
    generatedBy: (session.profile.full_name ?? "").trim() || session.email || "Unknown staff",
    todayIso: today,
    rows: records.rows,
    staff: staff.rows,
    nameOf,
  });
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ach.control.packet",
    entityType: "ach_control_records",
    entityId: today,
    after: { records: records.rows.length },
  }).catch(() => {});
  return new Response(text, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `inline; filename="ach-policies-${today}.txt"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
