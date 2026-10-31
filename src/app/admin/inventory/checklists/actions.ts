"use server";
/**
 * src/app/admin/inventory/checklists/actions.ts  (Fix Phase 4.4b · G-38)
 *
 * Three writes, each checked here and again by the database (migration 0327):
 *   1. initialTaskAction   one task, initials and time (inventory.count for the
 *                          daily lists, inventory.manage for weekly / monthly /
 *                          year end);
 *   2. signOffAction       manager sign-off, with a note when tasks are open;
 *   3. saveTaskAction /    the owner edits the catalog (inventory.audit, D57).
 *      addTaskAction
 * Every write records an audit_logs row. Nothing is ever deleted.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { pacificToday } from "@/lib/reports/timezone";
import {
  canEditCatalog,
  canInitial,
  canSignOff,
  checkInitials,
  checkSignOff,
  checkTaskDraft,
  checkTickNote,
  checklistPeriodKey,
  isChecklistKind,
  type ChecklistKind,
} from "@/lib/inventory/daily-checklist-core";
import {
  ensureChecklistRun,
  getChecklistRunById,
  getChecklistTask,
  insertChecklistTask,
  insertChecklistTick,
  listChecklistTasks,
  listChecklistTicks,
  signOffChecklistRun,
  updateChecklistTask,
  CHECKLIST_MIGRATION_PENDING,
} from "@/lib/inventory/daily-checklist-store";

const BASE = "/admin/inventory/checklists";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function back(kind: string, key: "error" | "ok", msg: string): never {
  revalidatePath(BASE);
  const k = isChecklistKind(kind) ? kind : "opening";
  redirect(`${BASE}?list=${k}&${key}=` + encodeURIComponent(msg));
}

function nameOf(session: { email: string; profile: { full_name?: string | null } }): string {
  return (session.profile.full_name ?? "").trim() || session.email;
}

/* ── 1. Initial one task ─────────────────────────────────────────────── */

export async function initialTaskAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.count");
  const taskId = str(formData, "task_id");
  const kindRaw = str(formData, "kind");
  if (!isChecklistKind(kindRaw)) back("opening", "error", "Unknown checklist. Nothing was saved.");
  const kind = kindRaw as ChecklistKind;
  if (!canInitial(session.profile.role, kind)) {
    back(kind, "error", "Only a manager, admin or the owner initials the weekly, monthly and year-end tasks (form 8.8). Nothing was saved.");
  }
  const initials = checkInitials(formData.get("initials"));
  if (!initials.ok) back(kind, "error", initials.message);
  const note = checkTickNote(formData.get("note"));
  if (!note.ok) back(kind, "error", note.message);

  const task = await getChecklistTask(taskId);
  if (!task.ok) back(kind, "error", task.missingSchema ? CHECKLIST_MIGRATION_PENDING : task.error);
  const t = task.ok ? task.data : null;
  if (!t || t.kind !== kind) back(kind, "error", "That task is not on this list. Nothing was saved.");
  if (!t!.active) back(kind, "error", "That task was retired by the owner. Nothing was saved.");

  // The sheet is the one for TODAY (Pacific), never one the browser names.
  const periodKey = checklistPeriodKey(kind, pacificToday());
  const run = await ensureChecklistRun(kind, periodKey, session.userId);
  if (!run.ok) back(kind, "error", run.message);
  const r = run.ok ? run.data : null;
  if (r!.signedOffAt) back(kind, "error", "This sheet is already signed off. Nothing more can be initialled on it.");

  const saved = await insertChecklistTick({
    runId: r!.id,
    task: t!,
    doneBy: session.userId,
    doneByName: nameOf(session),
    initials: initials.ok ? initials.value : "",
    note: note.ok ? note.value : null,
  });
  if (!saved.ok) back(kind, "error", saved.message);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "checklist.task_initialled",
    entityType: "checklist_run",
    entityId: r!.id,
    after: { kind, periodKey, taskId: t!.id, label: t!.label, initials: initials.ok ? initials.value : null, note: note.ok ? note.value : null },
  });
  back(kind, "ok", `Initialled: ${t!.label}`);
}

/* ── 2. Manager sign-off ─────────────────────────────────────────────── */

export async function signOffAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const runId = str(formData, "run_id");
  const kindRaw = str(formData, "kind");
  if (!canSignOff(session.profile.role)) back(kindRaw, "error", "Only a manager, admin or the owner signs off. Nothing was saved.");
  const run = await getChecklistRunById(runId);
  if (!run.ok) back(kindRaw, "error", run.missingSchema ? CHECKLIST_MIGRATION_PENDING : run.error);
  const r = run.ok ? run.data : null;
  if (!r) back(kindRaw, "error", "Nobody has initialled anything on this sheet yet, so there is nothing to sign off.");
  if (r!.signedOffAt) back(r!.kind, "error", "This sheet is already signed off. Nothing was saved.");

  // Count what is still open on the SERVER, never from the form.
  const [tasks, ticks] = await Promise.all([listChecklistTasks(r!.kind), listChecklistTicks(r!.id)]);
  if (!tasks.ok) back(r!.kind, "error", tasks.error);
  if (!ticks.ok) back(r!.kind, "error", ticks.error);
  const done = new Set((ticks.ok ? ticks.data : []).map((x) => x.taskId));
  const openTasks = (tasks.ok ? tasks.data : []).filter((t) => t.active && !done.has(t.id)).length;

  const chk = checkSignOff({ openTasks, note: formData.get("note") });
  if (!chk.ok) back(r!.kind, "error", chk.message);
  const saved = await signOffChecklistRun({ runId: r!.id, by: session.userId, byName: nameOf(session), note: chk.ok ? chk.value : null, openTasks });
  if (!saved.ok) back(r!.kind, "error", saved.message);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "checklist.signed_off",
    entityType: "checklist_run",
    entityId: r!.id,
    after: { kind: r!.kind, periodKey: r!.periodKey, openTasks, note: chk.ok ? chk.value : null },
  });
  back(r!.kind, "ok", openTasks === 0 ? "Signed off. Every task was initialled." : `Signed off with ${openTasks} task${openTasks === 1 ? "" : "s"} not done (note kept).`);
}

/* ── 3. The owner edits the catalog (D57) ────────────────────────────── */

export async function saveTaskAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.audit");
  const id = str(formData, "task_id");
  const before = await getChecklistTask(id);
  if (!before.ok) back("opening", "error", before.missingSchema ? CHECKLIST_MIGRATION_PENDING : before.error);
  const b = before.ok ? before.data : null;
  if (!b) back("opening", "error", "That task was not found. Nothing was saved.");
  if (!canEditCatalog(session.profile.role)) back(b!.kind, "error", "Only the owner edits the checklist tasks. Nothing was saved.");
  const draft = checkTaskDraft({
    kind: b!.kind,
    section: formData.get("section"),
    label: formData.get("label"),
    sopRef: formData.get("sop_ref"),
    sortOrder: formData.get("sort_order"),
  });
  if (!draft.ok) back(b!.kind, "error", draft.message);
  const d = draft.ok ? draft.value : null;
  const active = formData.get("active") === "on";
  const saved = await updateChecklistTask(id, { section: d!.section, label: d!.label, sopRef: d!.sopRef, sortOrder: d!.sortOrder, active }, session.userId);
  if (!saved.ok) back(b!.kind, "error", saved.message);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "checklist.task_edited",
    entityType: "checklist_task",
    entityId: id,
    before: { section: b!.section, label: b!.label, sopRef: b!.sopRef, sortOrder: b!.sortOrder, active: b!.active },
    after: { section: d!.section, label: d!.label, sopRef: d!.sopRef, sortOrder: d!.sortOrder, active },
  });
  back(b!.kind, "ok", active ? `Saved: ${d!.label}` : `Retired: ${d!.label} (kept on old sheets)`);
}

export async function addTaskAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.audit");
  const kindRaw = str(formData, "kind");
  if (!canEditCatalog(session.profile.role)) back(kindRaw, "error", "Only the owner adds checklist tasks. Nothing was saved.");
  const draft = checkTaskDraft({
    kind: kindRaw,
    section: formData.get("section"),
    label: formData.get("label"),
    sopRef: formData.get("sop_ref"),
    sortOrder: formData.get("sort_order"),
  });
  if (!draft.ok) back(kindRaw, "error", draft.message);
  const d = draft.ok ? draft.value : null;
  const saved = await insertChecklistTask(d!, session.userId);
  if (!saved.ok) back(d!.kind, "error", saved.message);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "checklist.task_added",
    entityType: "checklist_task",
    entityId: saved.ok ? saved.data.id : null,
    after: d,
  });
  back(d!.kind, "ok", `Added: ${d!.label}`);
}
