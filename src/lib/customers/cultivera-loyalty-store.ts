/**
 * src/lib/customers/cultivera-loyalty-store.ts  (CVL, server-only)
 *
 * Database side of applying crawled Cultivera loyalty (migration 0336).
 * Every call reads its { error } (rule 15) and names its columns.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { parseApplyResult, type ApplyResult, type ApplyRow } from "@/lib/customers/cultivera-loyalty-core";

const PAGE = 500; // ids per .in() lookup (keeps the request URL short)
const MIGRATION = "supabase/migrations/0336_cultivera_loyalty_import.sql";
/** loyalty_ledger.import_key of the one opening row per customer (0336). */
export const OPENING_KEY_PREFIX = "cultivera-opening:";

/** Plain meaning of a database error (rule 15). */
export function explainDbError(e: { code?: string | null; message?: string | null } | null | undefined): string {
  const code = (e?.code ?? "").trim();
  const msg = (e?.message ?? "").trim();
  if (code === "42501") return `The server is not allowed to do this (${msg}). Run ${MIGRATION} in the Supabase SQL editor.`;
  if (code === "42883" || code === "PGRST202") return `The loyalty import function is not installed. Run ${MIGRATION} in the Supabase SQL editor.`;
  if (code === "42P01" || code === "PGRST205" || code === "42703") return `The loyalty import table is not installed. Run ${MIGRATION} in the Supabase SQL editor.`;
  return msg || code || "Unknown database error";
}

/** Cultivera id (customers.external_id) -> our customer id, for the ids that are customers here. */
export async function matchCultiveraIds(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!isSupabaseServiceConfigured || ids.length === 0) return out;
  const admin = createSupabaseAdminClient();
  for (let i = 0; i < ids.length; i += PAGE) {
    const chunk = ids.slice(i, i + PAGE);
    const { data, error } = await admin.from("customers").select("id, external_id").in("external_id", chunk);
    if (error) throw new Error(explainDbError(error));
    for (const r of (data as { id: string; external_id: string | null }[] | null) ?? []) if (r.external_id) out.set(r.external_id, r.id);
  }
  return out;
}

/** Cultivera ids (customers.external_id) that are customers here, among `ids`. */
export async function ourCultiveraIds(ids: string[]): Promise<Set<string>> {
  return new Set((await matchCultiveraIds(ids)).keys());
}

/**
 * Cultivera ids whose opening balance was already credited: the customer has
 * the loyalty_ledger row with import_key 'cultivera-opening:<customer id>'.
 */
export async function creditedCultiveraIds(matches: Map<string, string>): Promise<Set<string>> {
  const out = new Set<string>();
  if (!isSupabaseServiceConfigured || matches.size === 0) return out;
  const admin = createSupabaseAdminClient();
  const byKey = new Map<string, string>();
  for (const [ext, cid] of matches) byKey.set(`${OPENING_KEY_PREFIX}${cid}`, ext);
  const keys = [...byKey.keys()];
  const KEYS_PAGE = 200; // uuid keys are long; keep the request URL short
  for (let i = 0; i < keys.length; i += KEYS_PAGE) {
    const chunk = keys.slice(i, i + KEYS_PAGE);
    const { data, error } = await admin.from("loyalty_ledger").select("import_key").in("import_key", chunk);
    if (error) throw new Error(explainDbError(error));
    for (const r of (data as { import_key: string | null }[] | null) ?? []) {
      const ext = r.import_key ? byKey.get(r.import_key) : undefined;
      if (ext) out.add(ext);
    }
  }
  return out;
}

/** One batch (<= 500 rows) in one transaction. */
export async function applyLoyaltyBatch(runId: string, capturedAt: string, actorId: string | null, rows: ApplyRow[]): Promise<ApplyResult> {
  if (!isSupabaseServiceConfigured) throw new Error("Supabase is not configured.");
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("apply_cultivera_loyalty", {
    p_run_id: runId,
    p_captured_at: capturedAt,
    p_actor: actorId,
    p_rows: rows,
  });
  if (error) throw new Error(explainDbError(error));
  const parsed = parseApplyResult(data);
  if (!parsed) throw new Error("The database gave an answer the import could not read.");
  return parsed;
}

export type CustomerCultiveraLoyalty = {
  balance_points: number;
  spent_points: number;
  spent_amount_minor_units: number;
  earned_order_points: number | null;
  initial_points: number | null;
  adjusted_points: number | null;
  opening_points: number;
  captured_at: string;
};

/** The customer page's "Cultivera loyalty" line. null = none, or migration not applied yet. */
export async function getCustomerCultiveraLoyalty(customerId: string): Promise<CustomerCultiveraLoyalty | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("customer_cultivera_loyalty")
    .select("balance_points, spent_points, spent_amount_minor_units, earned_order_points, initial_points, adjusted_points, opening_points, captured_at")
    .eq("customer_id", customerId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    // The customer page must still load before 0336 is applied; say why in the server log.
    console.warn("[cultivera-loyalty] customer read failed:", explainDbError(error));
    return null;
  }
  if (!data) return null;
  const d = data as Record<string, unknown>;
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    balance_points: Number(d.balance_points),
    spent_points: Number(d.spent_points),
    spent_amount_minor_units: Number(d.spent_amount_minor_units),
    earned_order_points: num(d.earned_order_points),
    initial_points: num(d.initial_points),
    adjusted_points: num(d.adjusted_points),
    opening_points: Number(d.opening_points),
    captured_at: String(d.captured_at),
  };
}
