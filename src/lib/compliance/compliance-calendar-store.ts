/**
 * src/lib/compliance/compliance-calendar-store.ts  (S-18)
 *
 * Server glue for the compliance calendar. Persists the "done" map in the
 * EXISTING `site_settings` KV table (same pattern as sales-hours-store) — no
 * migration required. Reads degrade to an empty map (everything shows due),
 * which fails SAFE: a lost row can only make the calendar nag MORE.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pacificParts, storeNow } from "@/lib/reports/timezone";
import {
  evaluateCalendar,
  normalizeDoneMap,
  overdueCount,
  CALENDAR_TASKS,
  type CalendarEntry,
  type CalendarTaskId,
  type DoneMap,
  type PlainDate,
} from "./compliance-calendar-core";

export const CALENDAR_KEY = "compliance_calendar_done";
const CALENDAR_LABEL = "Compliance calendar — completed periods (S-18)";

/** Today as a plain Pacific calendar date (the store's wall clock). */
export function todayPacific(): PlainDate {
  const p = pacificParts(storeNow());
  return { y: p.year, m: p.month, d: p.day };
}

/** Read the done map; empty (everything pending) when unset/unavailable. */
export async function getDoneMap(): Promise<DoneMap> {
  if (!isSupabaseServiceConfigured) return {};
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("site_settings")
      .select("value_json")
      .eq("key", CALENDAR_KEY)
      .maybeSingle();
    return normalizeDoneMap(data?.value_json ?? null);
  } catch {
    return {};
  }
}

/** The evaluated calendar for today. */
export async function getCalendarEntries(): Promise<CalendarEntry[]> {
  const doneMap = await getDoneMap();
  return evaluateCalendar(todayPacific(), doneMap);
}

/** Overdue count for the dashboard nag (0 when DB unavailable = quiet). */
export async function getOverdueComplianceCount(): Promise<number> {
  if (!isSupabaseServiceConfigured) return 0;
  try {
    return overdueCount(await getCalendarEntries());
  } catch {
    return 0;
  }
}

/**
 * Mark a task's period done (or undo). Validates the task id against the
 * definitions and stores who/when for the audit story.
 */
export async function setPeriodDone(opts: {
  taskId: string;
  periodKey: string;
  done: boolean;
  byEmail: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  if (!CALENDAR_TASKS.some((t) => t.id === opts.taskId)) {
    return { ok: false, error: "Unknown compliance task." };
  }
  if (!opts.periodKey || opts.periodKey.length > 40) {
    return { ok: false, error: "Invalid period." };
  }
  try {
    const admin = createSupabaseAdminClient();
    const current = await getDoneMap();
    const taskId = opts.taskId as CalendarTaskId;
    const periods = { ...(current[taskId] ?? {}) };
    if (opts.done) {
      periods[opts.periodKey] = { doneAt: new Date().toISOString(), byEmail: opts.byEmail };
    } else {
      delete periods[opts.periodKey];
    }
    const next: DoneMap = { ...current, [taskId]: periods };
    const { error } = await admin.from("site_settings").upsert(
      {
        key: CALENDAR_KEY,
        label: CALENDAR_LABEL,
        value_json: next as unknown as Record<string, unknown>,
        updated_by: null,
      },
      { onConflict: "key" },
    );
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}
