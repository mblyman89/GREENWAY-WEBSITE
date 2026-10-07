/**
 * src/lib/compliance/obligation-waiver-store.ts  (CCRS Bible v2 S-12d)
 *
 * Server glue for the two "stop nagging me about that" tools:
 *   1. the FIRST DAY OF SALES (site_settings key compliance_obligation_start,
 *      value_json { startDate: "YYYY-MM-DD" }; no migration), and
 *   2. DISMISSALS: one CCRS week or LIQ-1295 month checked off with a written
 *      reason (table obligation_waivers, migration 0250).
 *
 * All the rules live in the PURE obligation-waiver-core. This file only reads
 * and writes.
 *
 * FAILS SAFE: if the database cannot be read, the context is EMPTY (no start
 * date, no dismissals), so every reminder, banner and calendar entry shows as
 * before. A database problem can only make the app nag MORE, never hide a
 * real deadline. A partial read can only drop dismissals (more nagging), never
 * invent one.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { pacificToday } from "@/lib/reports/timezone";
import {
  EMPTY_CONTEXT,
  buildContext,
  startDateFromSetting,
  validateDismissal,
  validateReason,
  validateStartDate,
  type ObligationContext,
  type WaivableObligation,
} from "./obligation-waiver-core";

export const START_SETTING_KEY = "compliance_obligation_start";
const START_SETTING_LABEL = "First day of sales: State deadlines before it stop nagging (S-12d)";

const WAIVER_COLUMNS =
  "id, obligation, period_key, reason, waived_at, waived_by_email, revoked_at, revoked_by_email";

export type WaiverRow = {
  id: string;
  obligation: WaivableObligation;
  period_key: string;
  reason: string;
  waived_at: string;
  waived_by_email: string | null;
  revoked_at: string | null;
  revoked_by_email: string | null;
};

type Result = { ok: true } | { ok: false; error: string };

async function readStartDate(): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("site_settings")
    .select("value_json")
    .eq("key", START_SETTING_KEY)
    .maybeSingle();
  if (error) return null;
  return startDateFromSetting(data?.value_json ?? null);
}

async function readLiveWaivers(): Promise<WaiverRow[]> {
  const admin = createSupabaseAdminClient();
  const page = await pagedAllChecked<WaiverRow>(async (from, to) => {
    const res = await admin
      .from("obligation_waivers")
      .select(WAIVER_COLUMNS)
      .is("revoked_at", null)
      .order("id", { ascending: true })
      .range(from, to);
    return { rows: (res.data ?? []) as unknown as WaiverRow[], ok: !res.error };
  });
  return page.rows;
}

/**
 * The context every deadline engine takes. EMPTY_CONTEXT when the database
 * is unavailable (fails safe: nags as before).
 */
export async function getObligationContext(): Promise<ObligationContext> {
  if (!isSupabaseServiceConfigured) return EMPTY_CONTEXT;
  try {
    const [start, rows] = await Promise.all([
      readStartDate().catch(() => null),
      readLiveWaivers().catch(() => [] as WaiverRow[]),
    ]);
    return buildContext(start, rows);
  } catch {
    return EMPTY_CONTEXT;
  }
}

/** Recent dismissals INCLUDING undone ones (history for the CCRS page). */
export async function listRecentWaivers(limit = 40): Promise<WaiverRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("obligation_waivers")
      .select(WAIVER_COLUMNS)
      .order("waived_at", { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 100));
    return (data as WaiverRow[] | null) ?? [];
  } catch {
    return [];
  }
}

/** Set (or clear, with "") the first day of sales. */
export async function setObligationStartDate(opts: {
  raw: unknown;
  byId: string | null;
}): Promise<Result & { value?: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  const v = validateStartDate(opts.raw, pacificToday());
  if (!v.ok) return v;
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("site_settings").upsert(
      {
        key: START_SETTING_KEY,
        label: START_SETTING_LABEL,
        value_json: { startDate: v.value === "" ? null : v.value },
        updated_by: opts.byId,
      },
      { onConflict: "key" },
    );
    if (error) return { ok: false, error: error.message };
    return { ok: true, value: v.value };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

/** Check one ended period off with a written reason. */
export async function dismissPeriod(opts: {
  obligation: unknown;
  periodKey: unknown;
  reason: unknown;
  byId: string | null;
  byEmail: string | null;
}): Promise<Result & { obligation?: WaivableObligation; periodKey?: string; reason?: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  const d = validateDismissal(opts.obligation, opts.periodKey, pacificToday());
  if (!d.ok) return d;
  const r = validateReason(opts.reason);
  if (!r.ok) return r;
  const obligation = opts.obligation as WaivableObligation;
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("obligation_waivers").insert({
      obligation,
      period_key: d.value,
      reason: r.value,
      waived_by: opts.byId,
      waived_by_email: opts.byEmail,
    });
    if (error) {
      // 23505 = the partial unique index obligation_waivers_one_live
      if (error.code === "23505") return { ok: false, error: "That period is already dismissed." };
      return { ok: false, error: error.message };
    }
    return { ok: true, obligation, periodKey: d.value, reason: r.value };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

/**
 * Undo a live dismissal (the period nags again). The row is kept with who and
 * when it was undone; the database refuses any other change.
 */
export async function undoDismissal(opts: {
  id: unknown;
  byId: string | null;
  byEmail: string | null;
}): Promise<Result & { row?: WaiverRow }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  const id = typeof opts.id === "string" ? opts.id.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return { ok: false, error: "Invalid dismissal." };
  }
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("obligation_waivers")
      .update({ revoked_at: new Date().toISOString(), revoked_by: opts.byId, revoked_by_email: opts.byEmail })
      .eq("id", id)
      .is("revoked_at", null)
      .select(WAIVER_COLUMNS);
    if (error) return { ok: false, error: error.message };
    const rows = (data as WaiverRow[] | null) ?? [];
    if (rows.length !== 1) return { ok: false, error: "That dismissal was not found or was already undone." };
    return { ok: true, row: rows[0] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Undo failed." };
  }
}
