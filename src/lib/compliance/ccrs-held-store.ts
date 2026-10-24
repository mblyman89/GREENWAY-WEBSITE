/**
 * src/lib/compliance/ccrs-held-store.ts - R74 S39 (owner, Round 19).
 *
 * The "still owed to CCRS" list (migration 0297, ccrs_held_sync). Written when
 * a batch is EMITTED (the export route): every record that batch held back is
 * upserted and every earlier record it no longer holds is resolved, in one
 * transaction (ccrs_record_held). Read by the CCRS hub so the owner sees what
 * is owed across weeks until it is reported.
 *
 * Missing migration = honest "not available" (the current week's held list
 * still shows on the hub); a real read/write error is reported, never hidden.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import type { LedgerEnv } from "./ccrs-ledger-core";
import type { HeldRecord, OwedRow } from "./ccrs-held-back-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const missingTable = (m: string | undefined, code?: string) =>
  code === "42P01" || code === "PGRST202" || code === "PGRST205" || (/ccrs_held_sync|ccrs_record_held/.test(m ?? "") && /does not exist|schema cache|Could not find/.test(m ?? ""));

export type RecordHeldOutcome = { available: boolean; held: number; resolved: number; error: string | null };

/** Record this emission's held-back records for (env, week). Never throws: the zip is already built. */
export async function recordHeldBack(admin: Admin, env: LedgerEnv, weekStart: string, records: readonly HeldRecord[]): Promise<RecordHeldOutcome> {
  const { data, error } = await admin.rpc("ccrs_record_held", {
    p_env: env,
    p_week_start: weekStart,
    p_records: records.map((r) => ({ t: r.t, id: r.id, label: r.label, code: r.code, reason: r.reason })),
  });
  if (error) {
    const missing = missingTable(error.message, error.code);
    return { available: !missing, held: 0, resolved: 0, error: missing ? null : `ccrs_record_held: ${error.message}` };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { held?: number; resolved?: number } | null;
  return { available: true, held: Number(row?.held ?? 0), resolved: Number(row?.resolved ?? 0), error: null };
}

export type OwedRead = { available: boolean; rows: OwedRow[]; error: string | null };

/** Every open owed record of one env, paged to the end. */
export async function readOwed(admin: Admin, env: LedgerEnv): Promise<OwedRead> {
  let missing = false;
  let firstError: string | null = null;
  const { rows, verdict } = await pagedAllChecked<OwedRow>(
    async (from, to) => {
      const { data, error } = await admin
        .from("ccrs_held_sync")
        .select("week_start, record_type, record_id, label, code, reason, first_held_at")
        .eq("env", env)
        .is("resolved_at", null)
        .order("week_start", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to);
      if (error) {
        if (missingTable(error.message, error.code)) missing = true;
        else firstError ??= error.message;
      }
      return { rows: (data as OwedRow[] | null) ?? [], ok: !error };
    },
    { maxRows: 100_000 },
  );
  if (missing) return { available: false, rows: [], error: null };
  if (!verdict.complete) return { available: true, rows, error: `ccrs_held_sync: ${firstError ?? verdict.message}` };
  return { available: true, rows, error: null };
}
