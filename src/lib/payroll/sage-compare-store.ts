/**
 * src/lib/payroll/sage-compare-store.ts   (D248 slice 4)
 *
 * Reads and saves the Sage amounts typed in for one pay period
 * (public.payroll_sage_comparisons, migration 0367, service role only).
 * Comparison notes only: never a pay record, journal or filing.
 */

import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { parseSageDoc, type SageCompareDoc, type SageEntries } from "@/lib/payroll/sage-compare-core";

const short = (e: unknown) =>
  (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e)).slice(0, 240);

/** True when the error means migration 0367 has not been applied yet. */
export function isMissingTable(e: unknown): boolean {
  const m = short(e);
  const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
  return code === "42P01" || code === "PGRST205" || (/payroll_sage_comparisons/.test(m) && /(does not exist|schema cache|not find)/i.test(m));
}

export const MIGRATION_MISSING =
  "The table that keeps typed Sage amounts is not in the database yet. Apply migration 0367_payroll_sage_compare.sql (see docs/MIGRATIONS_TO_RUN.md), then come back. The calculated side below works without it.";

export type SageLoad =
  | { ok: true; doc: SageCompareDoc; dropped: number }
  | { ok: false; missingTable: boolean; message: string };

export async function loadSageEntries(periodId: string): Promise<SageLoad> {
  if (!isSupabaseServiceConfigured) return { ok: false, missingTable: false, message: "The database is not configured." };
  const { data, error } = await createSupabaseAdminClient()
    .from("payroll_sage_comparisons")
    .select("entries, updated_at")
    .eq("pay_period_id", periodId)
    .maybeSingle();
  if (error) {
    return isMissingTable(error)
      ? { ok: false, missingTable: true, message: MIGRATION_MISSING }
      : { ok: false, missingTable: false, message: `The Sage amounts could not be read: ${short(error)}` };
  }
  const row = data as { entries?: unknown; updated_at?: string } | null;
  const { doc, dropped } = parseSageDoc({ entries: row?.entries ?? {}, updatedAt: row?.updated_at ?? null });
  return { ok: true, doc, dropped };
}

/** Upsert the whole entries object for a period. Throws a plain-English error. */
export async function saveSageEntries(periodId: string, entries: SageEntries, actorId: string): Promise<void> {
  if (!isSupabaseServiceConfigured) throw new Error("The database is not configured.");
  const { error } = await createSupabaseAdminClient()
    .from("payroll_sage_comparisons")
    .upsert({ pay_period_id: periodId, entries, updated_by: actorId, updated_at: new Date().toISOString() }, { onConflict: "pay_period_id" });
  if (error) throw new Error(isMissingTable(error) ? MIGRATION_MISSING : `The Sage amounts were not saved: ${short(error)}`);
}
