/**
 * src/lib/reports/register-adjustments.ts  (Register round — S3)
 *
 * Server assembly for Reports → Register Adjustments: minus / remove / cancel
 * rows (pos_cart_adjustments, 0301) plus voids (audit register.sale_voided),
 * rolled up by the pure summarizer with employee names resolved.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { chunkedIn } from "@/lib/supabase/chunked-in";
import { pacificDayKey } from "@/lib/reports/timezone";
import {
  summarizeAdjustments,
  type AdjustReportSummary,
  type CartAdjustAction,
  type CartAdjustRow,
  type VoidRow,
} from "@/lib/pos/cart-adjust-core";

export type RecentAdjustment = {
  occurredAt: string;
  employeeId: string | null;
  action: CartAdjustAction;
  productName: string | null;
  unitsRemoved: number;
  valueMinor: number;
};

export type RegisterAdjustmentsReport = {
  summary: AdjustReportSummary;
  names: Record<string, string>;
  recent: RecentAdjustment[];
  migrationMissing: boolean;
};

const PAGE = 1000;

export async function getRegisterAdjustmentsReport(fromISO: string, toISO: string): Promise<RegisterAdjustmentsReport> {
  const admin = createSupabaseAdminClient();
  const rows: (CartAdjustRow & { productName: string | null })[] = [];
  let migrationMissing = false;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("pos_cart_adjustments")
      .select("employee_id, action, product_name, units_removed, value_minor, occurred_at")
      .gte("occurred_at", fromISO)
      .lt("occurred_at", toISO)
      .order("occurred_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) {
      migrationMissing = true;
      break;
    }
    const batch = (data ?? []) as {
      employee_id: string | null;
      action: CartAdjustAction;
      product_name: string | null;
      units_removed: number;
      value_minor: number;
      occurred_at: string;
    }[];
    for (const r of batch)
      rows.push({
        employeeId: r.employee_id,
        action: r.action,
        productName: r.product_name,
        unitsRemoved: r.units_removed,
        valueMinor: r.value_minor,
        occurredAt: r.occurred_at,
      });
    if (batch.length < PAGE) break;
  }

  const voids: VoidRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("audit_logs")
      .select("after_json, created_at")
      .eq("action", "register.sale_voided")
      .gte("created_at", fromISO)
      .lt("created_at", toISO)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) break;
    const batch = (data ?? []) as { after_json: Record<string, unknown> | null; created_at: string }[];
    for (const v of batch) {
      const a = v.after_json ?? {};
      voids.push({
        approverId: typeof a.approvedByEmployeeId === "string" ? a.approvedByEmployeeId : null,
        processedByName: typeof a.processedByName === "string" ? a.processedByName : null,
        refundMinor: Number.isInteger(a.refundMinor) ? (a.refundMinor as number) : 0,
        occurredAt: v.created_at,
      });
    }
    if (batch.length < PAGE) break;
  }

  const summary = summarizeAdjustments(rows, voids, (iso) => pacificDayKey(iso));
  const ids = [
    ...new Set(
      [...summary.byEmployee.map((e) => e.employeeId), ...summary.voidsByApprover.map((v) => v.employeeId)].filter(
        (id) => id !== "unknown",
      ),
    ),
  ];
  const names: Record<string, string> = { unknown: "Unknown" };
  if (ids.length) {
    const found = await chunkedIn(ids, async (chunk) => {
      const { data } = await admin.from("employees").select("id, full_name").in("id", chunk);
      return (data as { id: string; full_name: string | null }[] | null) ?? [];
    });
    for (const r of found) names[r.id] = r.full_name?.trim() || "Employee";
  }
  return { summary, names, recent: rows.slice(0, 100), migrationMissing };
}
