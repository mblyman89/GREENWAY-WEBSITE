/**
 * GET /admin/settings/banking/test-day/sheet
 *
 * R41 S21: the printable test-day sheet for the Zoom call with Timberland
 * Cash Management (plain text): the timeline, the steps with tick boxes, the
 * Zoom script, what Brenda will see in the file, the questions with answer
 * lines and what to note from the portal. Reads the same live state as the
 * page (read only) and writes only the audit line. Owner/admin
 * (settings.manage); never cached. No account numbers are on the sheet (the
 * core refuses to print a run of 7+ digits).
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { pacificToday } from "@/lib/reports/timezone";
import { testDaySheet } from "@/lib/payments/ach-test-day-core";
import { readTestDayState } from "@/lib/payments/ach-test-day-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await requirePermission("settings.manage");
  const today = pacificToday();
  const state = await readTestDayState(today);
  const text = testDaySheet(state, new Date());
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ach.test_day.sheet",
    entityType: "ach_test_day",
    entityId: today,
  }).catch(() => {});
  return new Response(text, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `inline; filename="ach-test-day-${today}.txt"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
