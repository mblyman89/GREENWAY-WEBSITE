import "server-only";

/**
 * src/lib/leafly/outbound-history-server.ts  (SLICE L-49)
 *
 * Reads `leafly_outbound_attempts` for the order page's call-history panel
 * and for the evidence export. Explicit column list (never `select("*")`),
 * bounded by the attempt-log DB deadline, and NEVER throws: a failure here
 * must not break the order page or the export.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { dbDeadline } from "./db-deadline";
import { OUTBOUND_HISTORY_COLUMNS, type OutboundHistoryRow } from "./outbound-history-core";

export type OutboundHistoryLoad = { ok: true; rows: OutboundHistoryRow[] } | { ok: false; problem: string };

/** The newest `limit` attempts for one Leafly order (index 0226: order id + attempted_at desc). */
export async function loadRecentOutboundAttempts(leaflyOrderId: string, limit = 5): Promise<OutboundHistoryLoad> {
  const id = (leaflyOrderId ?? "").trim();
  if (id === "") return { ok: true, rows: [] };
  if (!isSupabaseServiceConfigured) return { ok: false, problem: "The database is not connected." };
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("leafly_outbound_attempts")
      .select(OUTBOUND_HISTORY_COLUMNS)
      .eq("leafly_order_id", id)
      .order("attempted_at", { ascending: false })
      .limit(Math.max(1, Math.min(limit, 25)))
      .abortSignal(dbDeadline("order_read"));
    if (error) return { ok: false, problem: error.message };
    return { ok: true, rows: (data as unknown as OutboundHistoryRow[] | null) ?? [] };
  } catch (err) {
    return { ok: false, problem: err instanceof Error ? err.message : "unknown error" };
  }
}

/** The newest `limit` attempts across every order, for the evidence export. */
export async function loadOutboundAttemptsForExport(limit = 500): Promise<OutboundHistoryLoad> {
  if (!isSupabaseServiceConfigured) return { ok: false, problem: "The database is not connected." };
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("leafly_outbound_attempts")
      .select(OUTBOUND_HISTORY_COLUMNS)
      .order("attempted_at", { ascending: false })
      .limit(Math.max(1, Math.min(limit, 2000)));
    if (error) return { ok: false, problem: error.message };
    return { ok: true, rows: (data as unknown as OutboundHistoryRow[] | null) ?? [] };
  } catch (err) {
    return { ok: false, problem: err instanceof Error ? err.message : "unknown error" };
  }
}
