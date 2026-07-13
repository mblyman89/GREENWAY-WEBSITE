/**
 * src/lib/compliance/ccrs-week-store.ts  (Task W)
 *
 * Server glue for the WEEKLY CCRS submission ledger (ccrs_week_submissions,
 * migration 0118). All deadline math lives in the PURE ccrs-week-core; this
 * file only does I/O + assembly.
 *
 * Fails SAFE: when the DB is unavailable, reads return an empty resolution map
 * so every completed week shows as unresolved — the command center can only
 * nag MORE, never less.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pacificToday } from "@/lib/reports/timezone";
import {
  weekFromKey,
  weeklyDeadlineOverview,
  type WeekResolution,
  type WeeklyOverview,
} from "@/lib/compliance/ccrs-week-core";

export type WeekSubmissionRow = {
  id: string;
  week_key: string;
  week_start: string;
  week_end: string;
  due_date: string;
  resolution: WeekResolution;
  resolved_at: string;
  resolved_by_email: string | null;
  on_time: boolean;
  files_json: { type: string; fileName: string; recordCount: number }[] | null;
  total_records: number;
  error_status: "clean" | "errors_reported" | "resolved";
  error_notes: string | null;
  notes: string | null;
};

const ROW_COLUMNS =
  "id, week_key, week_start, week_end, due_date, resolution, resolved_at, " +
  "resolved_by_email, on_time, files_json, total_records, error_status, error_notes, notes";

/** Recent ledger rows, newest week first. */
export async function listWeekSubmissions(limit = 12): Promise<WeekSubmissionRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("ccrs_week_submissions")
      .select(ROW_COLUMNS)
      .order("week_start", { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 60));
    return (data as WeekSubmissionRow[] | null) ?? [];
  } catch {
    return [];
  }
}

/** week_key → resolution map for the deadline engine. */
export async function getWeekResolutions(lookbackWeeks = 8): Promise<Map<string, WeekResolution>> {
  const out = new Map<string, WeekResolution>();
  const rows = await listWeekSubmissions(Math.max(lookbackWeeks, 8));
  for (const r of rows) out.set(r.week_key, r.resolution);
  return out;
}

/** The full weekly deadline picture as of today (Pacific). */
export async function getWeeklyOverview(opts?: { lookbackWeeks?: number }): Promise<WeeklyOverview> {
  const lookbackWeeks = opts?.lookbackWeeks ?? 4;
  const resolutions = await getWeekResolutions(lookbackWeeks);
  return weeklyDeadlineOverview(pacificToday(), resolutions, { lookbackWeeks });
}

/**
 * Resolve a week: record 'submitted' (with the generated files summary) or
 * 'nothing_to_report'. Upserts on week_key so a correction overwrites the
 * previous resolution rather than duplicating it.
 */
export async function resolveWeek(opts: {
  weekKey: string;
  resolution: WeekResolution;
  byId: string | null;
  byEmail: string | null;
  files?: { type: string; fileName: string; recordCount: number }[];
  totalRecords?: number;
  notes?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  const week = weekFromKey(opts.weekKey);
  if (!week) return { ok: false, error: "Invalid week key." };
  // A week can only be resolved once it has COMPLETED (today past its end).
  const today = pacificToday();
  if (today <= week.end) {
    return { ok: false, error: "This reporting week is still in progress — it can be resolved after Saturday." };
  }
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("ccrs_week_submissions").upsert(
      {
        week_key: week.key,
        week_start: week.start,
        week_end: week.end,
        due_date: week.due,
        resolution: opts.resolution,
        resolved_at: new Date().toISOString(),
        resolved_by: opts.byId,
        resolved_by_email: opts.byEmail,
        on_time: today <= week.due,
        files_json: opts.resolution === "submitted" ? (opts.files ?? []) : null,
        total_records: opts.resolution === "submitted" ? (opts.totalRecords ?? 0) : 0,
        notes: opts.notes ?? null,
      },
      { onConflict: "week_key" },
    );
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

/** Un-resolve a week (undo a mistaken sign-off). */
export async function unresolveWeek(weekKey: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  if (!weekFromKey(weekKey)) return { ok: false, error: "Invalid week key." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("ccrs_week_submissions").delete().eq("week_key", weekKey);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed." };
  }
}

/** Flag / clear an error-email status on a submitted week. */
export async function setWeekErrorStatus(opts: {
  weekKey: string;
  errorStatus: "clean" | "errors_reported" | "resolved";
  errorNotes?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  if (!weekFromKey(opts.weekKey)) return { ok: false, error: "Invalid week key." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("ccrs_week_submissions")
      .update({ error_status: opts.errorStatus, error_notes: opts.errorNotes ?? null })
      .eq("week_key", opts.weekKey);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Update failed." };
  }
}
