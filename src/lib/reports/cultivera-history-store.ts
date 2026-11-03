/**
 * src/lib/reports/cultivera-history-store.ts  (CVB-8, server-only)
 *
 * Database side of Cultivera report history (migration 0338):
 *   - cvb_upsert_history_days (service_role function, batches of at most 1,000)
 *   - reads of cultivera_history_days (days between two dates, the stored span and check counts)
 *
 * Every call reads its { error } (rule 15) and names its columns.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { parseHistoryResult, type HistoryCheckStatus, type HistoryDayRow } from "@/lib/reports/cultivera-history-core";

const MIGRATION = "supabase/migrations/0338_cultivera_history_days.sql";
const PAGE = 1000;

export function explainHistoryError(e: { code?: string | null; message?: string | null } | null | undefined): string {
  const code = (e?.code ?? "").trim();
  const msg = (e?.message ?? "").trim();
  if (code === "42501") return `The server is not allowed to do this (${msg}). Run ${MIGRATION} in the Supabase SQL editor.`;
  if (code === "42883" || code === "PGRST202") return `The Cultivera history function is not installed. Run ${MIGRATION} in the Supabase SQL editor.`;
  if (code === "42P01" || code === "PGRST205" || code === "42703") return `The Cultivera history table is not installed. Run ${MIGRATION} in the Supabase SQL editor.`;
  return msg || code || "Unknown database error";
}

function admin() {
  if (!isSupabaseServiceConfigured) throw new Error("Supabase is not configured.");
  return createSupabaseAdminClient();
}

export async function upsertHistoryDays(runId: string, rows: HistoryDayRow[]): Promise<{ rows: number; written: number; keptNewer: number }> {
  const { data, error } = await admin().rpc("cvb_upsert_history_days", { p_run_id: runId, p_rows: rows });
  if (error) throw new Error(explainHistoryError(error));
  const r = parseHistoryResult(data);
  if (!r) throw new Error("cvb_upsert_history_days answered in an unexpected shape.");
  return r;
}

/** Stored history days between two Pacific days (inclusive), oldest first. */
export async function historyDays(from: string, to: string): Promise<HistoryDayRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const out: HistoryDayRow[] = [];
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await admin()
      .from("cultivera_history_days")
      .select("day, revenue_minor, returned_minor, orders, units, daily_check_minor, diff_minor, check_status")
      .gte("day", from)
      .lte("day", to)
      .order("day", { ascending: true })
      .range(off, off + PAGE - 1);
    if (error) throw new Error(explainHistoryError(error));
    const page = (data ?? []) as Record<string, unknown>[];
    for (const r of page) {
      out.push({
        day: String(r.day),
        revenue_minor: Number(r.revenue_minor),
        returned_minor: Number(r.returned_minor),
        orders: Number(r.orders),
        units: Number(r.units),
        daily_check_minor: r.daily_check_minor === null ? null : Number(r.daily_check_minor),
        diff_minor: r.diff_minor === null ? null : Number(r.diff_minor),
        check_status: String(r.check_status) as HistoryCheckStatus,
      });
    }
    if (page.length < PAGE) break;
  }
  return out;
}

/** First and last stored history day and how many days. */
export async function historyDaysSpan(): Promise<{ first: string | null; last: string | null; days: number }> {
  if (!isSupabaseServiceConfigured) return { first: null, last: null, days: 0 };
  const db = admin();
  const first = await db.from("cultivera_history_days").select("day").order("day", { ascending: true }).limit(1).maybeSingle();
  if (first.error) throw new Error(explainHistoryError(first.error));
  const last = await db.from("cultivera_history_days").select("day").order("day", { ascending: false }).limit(1).maybeSingle();
  if (last.error) throw new Error(explainHistoryError(last.error));
  const count = await db.from("cultivera_history_days").select("day", { count: "exact", head: true });
  if (count.error) throw new Error(explainHistoryError(count.error));
  return {
    first: first.data ? String((first.data as { day: string }).day) : null,
    last: last.data ? String((last.data as { day: string }).day) : null,
    days: count.count ?? 0,
  };
}
