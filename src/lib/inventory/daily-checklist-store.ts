/**
 * src/lib/inventory/daily-checklist-store.ts  (Fix Phase 4.4b · G-38)
 *
 * Reads and writes for the Daily Checklists screen. Every write is made here,
 * by the server (service role), after the server action has checked the
 * permission and the rule in daily-checklist-core.ts, and before it records
 * the audit row. Migration 0327 gives staff read only (is_staff()) and no
 * write policy, so there is no other way in. The triggers in 0327 refuse a
 * delete, a changed tick, and a tick on a signed-off sheet.
 *
 * Rule 46: a failed read is returned as an error, never as "nothing yet".
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import type { ChecklistKind, TaskDraft } from "@/lib/inventory/daily-checklist-core";

export type ChecklistTask = {
  id: string;
  kind: ChecklistKind;
  section: string;
  label: string;
  sopRef: string | null;
  sortOrder: number;
  liveLine: string | null;
  active: boolean;
  seedKey: string | null;
};

export type ChecklistRun = {
  id: string;
  kind: ChecklistKind;
  periodKey: string;
  openedAt: string;
  signedOffAt: string | null;
  signedOffName: string | null;
  signoffNote: string | null;
  openTasksAtSignoff: number | null;
};

export type ChecklistTick = {
  id: string;
  runId: string;
  taskId: string;
  taskLabel: string;
  taskSection: string;
  doneByName: string;
  initials: string;
  doneAt: string;
  note: string | null;
};

/** "The 0327 tables are not there yet" (the owner has not applied the migration). */
export function isMissingChecklistSchema(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "42703" || err.code === "42P01" || err.code === "PGRST204" || err.code === "PGRST205") return true;
  return /column .* does not exist|Could not find the .* column|relation .* does not exist|Could not find the table/i.test(err.message ?? "");
}

export const CHECKLIST_MIGRATION_PENDING =
  "CHECKLIST_MIGRATION_PENDING: apply migration 0327_daily_checklists.sql in the Supabase SQL editor (after 0326). Until then use paper forms 8.5-8.8 (SOP-06 \u00a74.23). Nothing was saved.";

export type Read<T> = { ok: true; data: T } | { ok: false; missingSchema: boolean; error: string };

type Pg = { code?: string; message: string } | null;

function fail<T>(error: Pg): Read<T> {
  return { ok: false, missingSchema: isMissingChecklistSchema(error), error: error?.message ?? "read failed" };
}

const TASK_COLS = "id, kind, section, label, sop_ref, sort_order, live_line, active, seed_key";
const RUN_COLS = "id, kind, period_key, opened_at, signed_off_at, signed_off_name, signoff_note, open_tasks_at_signoff";
const TICK_COLS = "id, run_id, task_id, task_label, task_section, done_by_name, initials, done_at, note";

type DbTask = { id: string; kind: ChecklistKind; section: string; label: string; sop_ref: string | null; sort_order: number; live_line: string | null; active: boolean; seed_key: string | null };
type DbRun = { id: string; kind: ChecklistKind; period_key: string; opened_at: string; signed_off_at: string | null; signed_off_name: string | null; signoff_note: string | null; open_tasks_at_signoff: number | null };
type DbTick = { id: string; run_id: string; task_id: string; task_label: string; task_section: string; done_by_name: string; initials: string; done_at: string; note: string | null };

const toTask = (d: DbTask): ChecklistTask => ({
  id: d.id, kind: d.kind, section: d.section, label: d.label, sopRef: d.sop_ref, sortOrder: d.sort_order,
  liveLine: d.live_line, active: d.active, seedKey: d.seed_key,
});
const toRun = (d: DbRun): ChecklistRun => ({
  id: d.id, kind: d.kind, periodKey: d.period_key, openedAt: d.opened_at, signedOffAt: d.signed_off_at,
  signedOffName: d.signed_off_name, signoffNote: d.signoff_note, openTasksAtSignoff: d.open_tasks_at_signoff,
});
const toTick = (d: DbTick): ChecklistTick => ({
  id: d.id, runId: d.run_id, taskId: d.task_id, taskLabel: d.task_label, taskSection: d.task_section,
  doneByName: d.done_by_name, initials: d.initials, doneAt: d.done_at, note: d.note,
});

function notConfigured<T>(): Read<T> {
  return { ok: false, missingSchema: false, error: "Supabase is not configured." };
}

/** Every task on one list (active and retired), in order. Paged (rule 46). */
export async function listChecklistTasks(kind: ChecklistKind | null): Promise<Read<ChecklistTask[]>> {
  if (!isSupabaseServiceConfigured) return notConfigured();
  const admin = createSupabaseAdminClient();
  let firstError: Pg = null;
  const read = await pagedAllChecked<DbTask>(async (a, b) => {
    let q = admin.from("checklist_tasks").select(TASK_COLS);
    if (kind) q = q.eq("kind", kind);
    const { data, error } = await q.order("kind").order("sort_order").order("id").range(a, b);
    if (error) {
      firstError ??= error;
      return { rows: [], ok: false };
    }
    return { rows: (data as DbTask[] | null) ?? [], ok: true };
  });
  if (firstError) return fail(firstError);
  if (!read.verdict.complete) return { ok: false, missingSchema: false, error: read.verdict.message };
  return { ok: true, data: read.rows.map(toTask) };
}

export async function getChecklistTask(id: string): Promise<Read<ChecklistTask | null>> {
  if (!isSupabaseServiceConfigured) return notConfigured();
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("checklist_tasks").select(TASK_COLS).eq("id", id).maybeSingle();
  if (error) return fail(error);
  return { ok: true, data: data ? toTask(data as unknown as DbTask) : null };
}

/** The sheet for one list and period, or null when nobody has initialled anything yet. */
export async function getChecklistRun(kind: ChecklistKind, periodKey: string): Promise<Read<ChecklistRun | null>> {
  if (!isSupabaseServiceConfigured) return notConfigured();
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("checklist_runs").select(RUN_COLS).eq("kind", kind).eq("period_key", periodKey).maybeSingle();
  if (error) return fail(error);
  return { ok: true, data: data ? toRun(data as unknown as DbRun) : null };
}

export async function getChecklistRunById(id: string): Promise<Read<ChecklistRun | null>> {
  if (!isSupabaseServiceConfigured) return notConfigured();
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("checklist_runs").select(RUN_COLS).eq("id", id).maybeSingle();
  if (error) return fail(error);
  return { ok: true, data: data ? toRun(data as unknown as DbRun) : null };
}

export async function listChecklistTicks(runId: string): Promise<Read<ChecklistTick[]>> {
  if (!isSupabaseServiceConfigured) return notConfigured();
  const admin = createSupabaseAdminClient();
  let firstError: Pg = null;
  const read = await pagedAllChecked<DbTick>(async (a, b) => {
    const { data, error } = await admin.from("checklist_ticks").select(TICK_COLS).eq("run_id", runId).order("done_at").order("id").range(a, b);
    if (error) {
      firstError ??= error;
      return { rows: [], ok: false };
    }
    return { rows: (data as DbTick[] | null) ?? [], ok: true };
  });
  if (firstError) return fail(firstError);
  if (!read.verdict.complete) return { ok: false, missingSchema: false, error: read.verdict.message };
  return { ok: true, data: read.rows.map(toTick) };
}

/** Recent sheets (history), newest first. One page of 60 is enough for the screen. */
export async function listRecentRuns(): Promise<Read<ChecklistRun[]>> {
  if (!isSupabaseServiceConfigured) return notConfigured();
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("checklist_runs")
    .select(RUN_COLS)
    .order("period_key", { ascending: false })
    .order("kind")
    .range(0, 59);
  if (error) return fail(error);
  return { ok: true, data: ((data as DbRun[] | null) ?? []).map(toRun) };
}

export type Write<T = null> = { ok: true; data: T } | { ok: false; message: string };

function writeFail(error: Pg): { ok: false; message: string } {
  if (isMissingChecklistSchema(error)) return { ok: false, message: CHECKLIST_MIGRATION_PENDING };
  return { ok: false, message: error?.message ?? "The database refused the write. Nothing was saved." };
}

/** The sheet for this list and period, created on the first initial. */
export async function ensureChecklistRun(kind: ChecklistKind, periodKey: string, openedBy: string): Promise<Write<ChecklistRun>> {
  if (!isSupabaseServiceConfigured) return { ok: false, message: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const found = await getChecklistRun(kind, periodKey);
  if (!found.ok) return found.missingSchema ? { ok: false, message: CHECKLIST_MIGRATION_PENDING } : { ok: false, message: found.error };
  if (found.data) return { ok: true, data: found.data };
  const { data, error } = await admin
    .from("checklist_runs")
    .insert({ kind, period_key: periodKey, opened_by: openedBy })
    .select(RUN_COLS)
    .single();
  if (error) {
    // Two people pressed at once: the unique (kind, period) index kept one.
    if (error.code === "23505") {
      const again = await getChecklistRun(kind, periodKey);
      if (again.ok && again.data) return { ok: true, data: again.data };
    }
    return writeFail(error);
  }
  return { ok: true, data: toRun(data as unknown as DbRun) };
}

export async function insertChecklistTick(input: {
  runId: string;
  task: ChecklistTask;
  doneBy: string;
  doneByName: string;
  initials: string;
  note: string | null;
}): Promise<Write<{ id: string }>> {
  if (!isSupabaseServiceConfigured) return { ok: false, message: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("checklist_ticks")
    .insert({
      run_id: input.runId,
      task_id: input.task.id,
      task_label: input.task.label,
      task_section: input.task.section,
      task_sop_ref: input.task.sopRef,
      done_by: input.doneBy,
      done_by_name: input.doneByName,
      initials: input.initials,
      note: input.note,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: false, message: "CHECKLIST_ALREADY_DONE: that task is already initialled on this sheet. Nothing was saved." };
    return writeFail(error);
  }
  return { ok: true, data: { id: (data as { id: string }).id } };
}

/** Manager sign-off; filled once (the 0327 trigger refuses a second). */
export async function signOffChecklistRun(input: {
  runId: string;
  by: string;
  byName: string;
  note: string | null;
  openTasks: number;
}): Promise<Write> {
  if (!isSupabaseServiceConfigured) return { ok: false, message: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("checklist_runs")
    .update({
      signed_off_at: new Date().toISOString(),
      signed_off_by: input.by,
      signed_off_name: input.byName,
      signoff_note: input.note,
      open_tasks_at_signoff: input.openTasks,
    })
    .eq("id", input.runId)
    .is("signed_off_at", null)
    .select("id");
  if (error) return writeFail(error);
  if (!data || (data as unknown[]).length !== 1) {
    return { ok: false, message: "CHECKLIST_SIGNED_OFF: this sheet is already signed off. Nothing was saved." };
  }
  return { ok: true, data: null };
}

export async function insertChecklistTask(draft: TaskDraft, by: string): Promise<Write<{ id: string }>> {
  if (!isSupabaseServiceConfigured) return { ok: false, message: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("checklist_tasks")
    .insert({ kind: draft.kind, section: draft.section, label: draft.label, sop_ref: draft.sopRef, sort_order: draft.sortOrder, created_by: by })
    .select("id")
    .single();
  if (error) return writeFail(error);
  return { ok: true, data: { id: (data as { id: string }).id } };
}

export async function updateChecklistTask(
  id: string,
  patch: { section: string; label: string; sopRef: string | null; sortOrder: number; active: boolean },
  by: string,
): Promise<Write> {
  if (!isSupabaseServiceConfigured) return { ok: false, message: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("checklist_tasks")
    .update({
      section: patch.section,
      label: patch.label,
      sop_ref: patch.sopRef,
      sort_order: patch.sortOrder,
      active: patch.active,
      updated_at: new Date().toISOString(),
      updated_by: by,
    })
    .eq("id", id)
    .select("id");
  if (error) return writeFail(error);
  if (!data || (data as unknown[]).length !== 1) return { ok: false, message: "That task was not found. Nothing was saved." };
  return { ok: true, data: null };
}
