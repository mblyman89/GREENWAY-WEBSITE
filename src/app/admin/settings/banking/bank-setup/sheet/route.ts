/**
 * GET /admin/settings/banking/bank-setup/sheet
 *
 * R41 S19: the printable bank-side checklist for the meeting with Timberland
 * Cash Management (plain text, with tick boxes and answer lines) and the ACH
 * glossary. Pure text from ach-bank-setup-core: READS NOTHING from the
 * database and writes only the audit line. Owner/admin (settings.manage);
 * never cached. No account numbers are on the sheet.
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { pacificToday } from "@/lib/reports/timezone";
import { meetingSheet } from "@/lib/payments/ach-bank-setup-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await requirePermission("settings.manage");
  const today = pacificToday();
  const text = meetingSheet(today);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ach.bank_setup.sheet",
    entityType: "ach_bank_setup",
    entityId: today,
  }).catch(() => {});
  return new Response(text, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `inline; filename="ach-bank-checklist-${today}.txt"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
