/**
 * src/lib/pos/refunds-store.ts  (POS AN-4)
 *
 * One query for "how much cash was refunded OUT of drawers on a Pacific
 * business day" — shared by the X/Z day-report route and the back-office
 * reconcile screen so both print the same number.
 *
 * Two flows pay cash out, and neither writes to pos_sale_events:
 *   - same-day VOIDS   -> audit_logs action "register.sale_voided"
 *                         (refundMinor in after_json)
 *   - counter RETURNS  -> customer_returns.refund_minor_units
 *
 * Neither record carries register attribution (void audits only name the
 * device in actor_email; customer_returns has no register column), so this
 * is a STORE-WIDE total — callers must present it as such, never as one
 * register's number. Money is MINOR UNITS (cents).
 *
 * Best-effort: a read failure returns the all-zeros summary rather than
 * blocking the caller (a slip without a refund section beats no slip).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pacificWallTimeToUtcISO } from "@/lib/reports/timezone";
import {
  summarizeRefunds,
  auditRefundMinor,
  type RefundRow,
  type RefundSummary,
} from "@/lib/pos/day-report-core";

/** Store-wide cash refunded out during one Pacific business day. */
export async function refundsForBusinessDay(businessDay: string): Promise<RefundSummary> {
  if (!isSupabaseServiceConfigured) return summarizeRefunds([]);
  const admin = createSupabaseAdminClient();
  const dayStart = pacificWallTimeToUtcISO(businessDay, "start");
  const dayEnd = pacificWallTimeToUtcISO(businessDay, "end");

  const rows: RefundRow[] = [];
  const [{ data: voidAudits }, { data: returnRows }] = await Promise.all([
    admin
      .from("audit_logs")
      .select("after_json")
      .eq("action", "register.sale_voided")
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd),
    admin
      .from("customer_returns")
      .select("refund_minor_units")
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd),
  ]);
  for (const v of (voidAudits as { after_json: unknown }[] | null) ?? []) {
    rows.push({ source: "void", refundMinor: auditRefundMinor(v.after_json) });
  }
  for (const cr of (returnRows as { refund_minor_units: number }[] | null) ?? []) {
    rows.push({ source: "return", refundMinor: cr.refund_minor_units });
  }
  return summarizeRefunds(rows);
}
