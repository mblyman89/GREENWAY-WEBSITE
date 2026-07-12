/**
 * src/lib/staffing/employee-lifecycle-store.ts  (Task S-b)
 *
 * Server store for the Employee command center: lifecycle status, the
 * onboarding/offboarding checklists, the document tracker, the training log,
 * and sick-leave accrual from recorded punches. Sits on migration 0117 and
 * degrades gracefully before it is applied (missing columns/tables are
 * reported via `migrationApplied: false` instead of crashing).
 *
 * Rules enforced here (docs/EMPLOYEE_COMPLIANCE.md):
 *   - RCW 49.94.010 ordering: a task with `requires` cannot be checked before
 *     its prerequisites (background check only after the conditional offer).
 *   - Activation gate: an employee cannot go ACTIVE until every critical
 *     compliance task is done (21+ verified, I-9, W-4, handbook signed,
 *     training, badge).
 *   - Termination never deletes: status -> terminated, PIN cleared, roster
 *     row kept (WAC 314-55-087 five-year records).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { type Employee } from "@/lib/staffing/store";
import {
  type EmploymentStatus,
  type DocumentStatus,
  type TaskState,
  ONBOARDING_TASK_KEYS,
  OFFBOARDING_TASK_KEYS,
  DOCUMENT_KEYS,
  taskOrderViolation,
  activationBlockers,
  canTransition,
  sickLeaveAccruedMinutes,
} from "@/lib/staffing/employee-lifecycle-core";

// ---------------------------------------------------------------------------
// Graceful degradation before migration 0117 is applied.
// ---------------------------------------------------------------------------

function isMissingSchemaError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "42P01") return true;
  return /column .* does not exist|could not find .* column|relation .* does not exist|Could not find the table/i.test(
    error.message ?? "",
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Roster row + the 0117 lifecycle columns (optional pre-migration). */
export type EmployeeFileRow = Employee & {
  hire_date?: string | null;
  employment_status?: EmploymentStatus;
  termination_date?: string | null;
  termination_reason?: string | null;
  badge_number?: string | null;
  age_21_verified?: boolean;
};

export type OnboardingTaskRow = {
  id: string;
  employee_id: string;
  task_key: string;
  done: boolean;
  done_at: string | null;
  done_by: string | null;
  notes: string | null;
};

export type EmployeeDocumentRow = {
  id: string;
  employee_id: string;
  doc_key: string;
  status: DocumentStatus;
  received_on: string | null;
  expires_on: string | null;
  notes: string | null;
};

export type TrainingLogRow = {
  id: string;
  employee_id: string;
  topic: string;
  trained_on: string;
  trainer: string | null;
  notes: string | null;
};

export type EmployeeFile = {
  employee: EmployeeFileRow;
  tasks: OnboardingTaskRow[];
  documents: EmployeeDocumentRow[];
  training: TrainingLogRow[];
  /** All-time worked minutes from closed work punches. */
  workedMinutes: number;
  /** WA paid-sick-leave minutes accrued (1 per 40 worked). */
  sickLeaveAccruedMinutes: number;
  migrationApplied: boolean;
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The full employee file for the command center's detail page. */
export async function getEmployeeFile(employeeId: string): Promise<EmployeeFile | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();

  // `select("*")` keeps this working before 0117 (new columns simply absent).
  // S-10 note: the banking columns ride along on this internal read but are
  // NEVER passed to the UI or the AI advisor — the page renders named fields.
  const { data: emp, error: empError } = await admin
    .from("employees")
    .select("*")
    .eq("id", employeeId)
    .maybeSingle();
  if (empError || !emp) return null;
  const employee = emp as EmployeeFileRow;
  // Scrub banking columns defensively so they cannot leak past this module.
  delete (employee as Record<string, unknown>).bank_routing;
  delete (employee as Record<string, unknown>).bank_account_number;
  delete (employee as Record<string, unknown>).bank_account_type;

  const migrationApplied = employee.employment_status !== undefined;

  let tasks: OnboardingTaskRow[] = [];
  let documents: EmployeeDocumentRow[] = [];
  let training: TrainingLogRow[] = [];

  if (migrationApplied) {
    const [t, d, tr] = await Promise.all([
      admin
        .from("employee_onboarding_tasks")
        .select("id, employee_id, task_key, done, done_at, done_by, notes")
        .eq("employee_id", employeeId),
      admin
        .from("employee_documents")
        .select("id, employee_id, doc_key, status, received_on, expires_on, notes")
        .eq("employee_id", employeeId),
      admin
        .from("employee_training_log")
        .select("id, employee_id, topic, trained_on, trainer, notes")
        .eq("employee_id", employeeId)
        .order("trained_on", { ascending: false }),
    ]);
    if (!t.error) tasks = (t.data as OnboardingTaskRow[] | null) ?? [];
    if (!d.error) documents = (d.data as EmployeeDocumentRow[] | null) ?? [];
    if (!tr.error) training = (tr.data as TrainingLogRow[] | null) ?? [];
  }

  const workedMinutes = await totalWorkedMinutes(employeeId);

  return {
    employee,
    tasks,
    documents,
    training,
    workedMinutes,
    sickLeaveAccruedMinutes: sickLeaveAccruedMinutes(workedMinutes),
    migrationApplied,
  };
}

/** Sum of closed work-punch minutes for one employee (small-store scale). */
export async function totalWorkedMinutes(employeeId: string): Promise<number> {
  if (!isSupabaseServiceConfigured) return 0;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("time_punches")
    .select("minutes")
    .eq("employee_id", employeeId)
    .eq("punch_kind", "work")
    .not("minutes", "is", null);
  const rows = (data as { minutes: number | null }[] | null) ?? [];
  return rows.reduce((sum, r) => sum + (r.minutes ?? 0), 0);
}

/** Task rows -> { task_key: done } map for the pure-core helpers. */
export function taskStateOf(tasks: OnboardingTaskRow[]): TaskState {
  const state: TaskState = {};
  for (const t of tasks) state[t.task_key] = t.done;
  return state;
}

export type RosterOverview = {
  counts: Record<EmploymentStatus, number>;
  /** Active/onboarding employees missing a critical document (i9/w4/handbook). */
  missingDocs: { employeeId: string; name: string; missing: string[] }[];
  /** Consultant credentials expiring within 60 days (or already expired). */
  expiringCredentials: { employeeId: string; name: string; docKey: string; expiresOn: string }[];
  /** Total accrued sick-leave minutes across non-terminated employees. */
  totalSickLeaveMinutes: number;
  migrationApplied: boolean;
};

const CRITICAL_DOC_KEYS = ["i9", "w4", "handbook"] as const;

/** Aggregate roster health for the command center hub (and the AI advisor). */
export async function rosterOverview(): Promise<RosterOverview> {
  const empty: RosterOverview = {
    counts: { candidate: 0, onboarding: 0, active: 0, terminated: 0 },
    missingDocs: [],
    expiringCredentials: [],
    totalSickLeaveMinutes: 0,
    migrationApplied: false,
  };
  if (!isSupabaseServiceConfigured) return empty;
  const admin = createSupabaseAdminClient();

  const { data: emps, error } = await admin
    .from("employees")
    .select("*")
    .order("full_name", { ascending: true });
  if (error) return empty;
  const rows = ((emps as EmployeeFileRow[] | null) ?? []).map((e) => {
    delete (e as Record<string, unknown>).bank_routing;
    delete (e as Record<string, unknown>).bank_account_number;
    delete (e as Record<string, unknown>).bank_account_type;
    return e;
  });
  const migrationApplied = rows.length === 0 ? false : rows[0].employment_status !== undefined;

  const counts: RosterOverview["counts"] = { candidate: 0, onboarding: 0, active: 0, terminated: 0 };
  for (const e of rows) {
    const s = (e.employment_status ?? (e.active ? "active" : "terminated")) as EmploymentStatus;
    counts[s] = (counts[s] ?? 0) + 1;
  }

  let missingDocs: RosterOverview["missingDocs"] = [];
  let expiringCredentials: RosterOverview["expiringCredentials"] = [];

  if (migrationApplied) {
    const workingIds = rows
      .filter((e) => (e.employment_status ?? "active") === "active" || e.employment_status === "onboarding")
      .map((e) => e.id);
    if (workingIds.length > 0) {
      const { data: docs, error: docErr } = await admin
        .from("employee_documents")
        .select("employee_id, doc_key, status, expires_on")
        .in("employee_id", workingIds);
      if (!docErr) {
        const docRows =
          (docs as { employee_id: string; doc_key: string; status: DocumentStatus; expires_on: string | null }[] | null) ??
          [];
        const nameOf = new Map(rows.map((e) => [e.id, e.full_name]));
        const byEmployee = new Map<string, Map<string, DocumentStatus>>();
        for (const d of docRows) {
          const m = byEmployee.get(d.employee_id) ?? new Map<string, DocumentStatus>();
          m.set(d.doc_key, d.status);
          byEmployee.set(d.employee_id, m);
        }
        missingDocs = workingIds
          .map((id) => {
            const m = byEmployee.get(id);
            const missing = CRITICAL_DOC_KEYS.filter((k) => {
              const status = m?.get(k) ?? "missing";
              // Handbook must be SIGNED, not just on file.
              return k === "handbook" ? status !== "signed" : status === "missing";
            });
            return { employeeId: id, name: nameOf.get(id) ?? "", missing: [...missing] };
          })
          .filter((x) => x.missing.length > 0);

        const horizon = new Date();
        horizon.setDate(horizon.getDate() + 60);
        const horizonYmd = horizon.toISOString().slice(0, 10);
        expiringCredentials = docRows
          .filter((d) => d.expires_on && d.expires_on <= horizonYmd && workingIds.includes(d.employee_id))
          .map((d) => ({
            employeeId: d.employee_id,
            name: nameOf.get(d.employee_id) ?? "",
            docKey: d.doc_key,
            expiresOn: d.expires_on as string,
          }));
      }
    }
  }

  // Sick leave across non-terminated employees (closed work punches).
  const liveIds = rows
    .filter((e) => (e.employment_status ?? (e.active ? "active" : "terminated")) !== "terminated")
    .map((e) => e.id);
  let totalSickLeaveMinutes = 0;
  if (liveIds.length > 0) {
    const { data: punches } = await admin
      .from("time_punches")
      .select("employee_id, minutes")
      .in("employee_id", liveIds)
      .eq("punch_kind", "work")
      .not("minutes", "is", null);
    const perEmployee = new Map<string, number>();
    for (const p of (punches as { employee_id: string; minutes: number | null }[] | null) ?? []) {
      perEmployee.set(p.employee_id, (perEmployee.get(p.employee_id) ?? 0) + (p.minutes ?? 0));
    }
    for (const minutes of perEmployee.values()) {
      totalSickLeaveMinutes += sickLeaveAccruedMinutes(minutes);
    }
  }

  return { counts, missingDocs, expiringCredentials, totalSickLeaveMinutes, migrationApplied };
}

/** Roster with lifecycle columns for the hub list (graceful pre-0117). */
export async function listEmployeeFiles(): Promise<{ rows: EmployeeFileRow[]; migrationApplied: boolean }> {
  if (!isSupabaseServiceConfigured) return { rows: [], migrationApplied: false };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("employees")
    .select("*")
    .order("full_name", { ascending: true });
  if (error) return { rows: [], migrationApplied: false };
  const rows = ((data as EmployeeFileRow[] | null) ?? []).map((e) => {
    delete (e as Record<string, unknown>).bank_routing;
    delete (e as Record<string, unknown>).bank_account_number;
    delete (e as Record<string, unknown>).bank_account_type;
    return e;
  });
  const migrationApplied = rows.length === 0 ? true : rows[0].employment_status !== undefined;
  return { rows, migrationApplied };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

type WriteResult = { ok: true } | { ok: false; error: string };

/**
 * Check/uncheck an onboarding or offboarding task. Enforces the legal order
 * (RCW 49.94.010) via the pure core before writing.
 */
export async function setTaskDone(input: {
  employeeId: string;
  taskKey: string;
  done: boolean;
  actor: string;
}): Promise<WriteResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const known = ONBOARDING_TASK_KEYS.includes(input.taskKey) || OFFBOARDING_TASK_KEYS.includes(input.taskKey);
  if (!known) return { ok: false, error: "Unknown checklist task." };
  const admin = createSupabaseAdminClient();

  if (input.done) {
    // Ordering guard uses the CURRENT stored state.
    const { data, error } = await admin
      .from("employee_onboarding_tasks")
      .select("task_key, done")
      .eq("employee_id", input.employeeId);
    if (error) {
      return isMissingSchemaError(error)
        ? { ok: false, error: "Apply migration 0117 first (see the banner above)." }
        : { ok: false, error: error.message };
    }
    const state: TaskState = {};
    for (const t of (data as { task_key: string; done: boolean }[] | null) ?? []) state[t.task_key] = t.done;
    const violation = taskOrderViolation(input.taskKey, state);
    if (violation) return { ok: false, error: violation };
  }

  const { error } = await admin.from("employee_onboarding_tasks").upsert(
    {
      employee_id: input.employeeId,
      task_key: input.taskKey,
      done: input.done,
      done_at: input.done ? new Date().toISOString() : null,
      done_by: input.done ? input.actor : null,
    },
    { onConflict: "employee_id,task_key" },
  );
  if (error) {
    return isMissingSchemaError(error)
      ? { ok: false, error: "Apply migration 0117 first (see the banner above)." }
      : { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Set a document's tracker status (missing / on_file / signed) + dates. */
export async function setDocumentStatus(input: {
  employeeId: string;
  docKey: string;
  status: DocumentStatus;
  receivedOn?: string | null;
  expiresOn?: string | null;
  notes?: string | null;
}): Promise<WriteResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  if (!DOCUMENT_KEYS.includes(input.docKey)) return { ok: false, error: "Unknown document." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("employee_documents").upsert(
    {
      employee_id: input.employeeId,
      doc_key: input.docKey,
      status: input.status,
      received_on: input.status === "missing" ? null : (input.receivedOn ?? null),
      expires_on: input.expiresOn ?? null,
      notes: input.notes ?? null,
    },
    { onConflict: "employee_id,doc_key" },
  );
  if (error) {
    return isMissingSchemaError(error)
      ? { ok: false, error: "Apply migration 0117 first (see the banner above)." }
      : { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Append a training-log entry (RCW 69.50.357 / WAC 314-55-087 record). */
export async function addTrainingEntry(input: {
  employeeId: string;
  topic: string;
  trainedOn: string;
  trainer?: string | null;
  notes?: string | null;
}): Promise<WriteResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  if (!input.topic.trim()) return { ok: false, error: "Enter the training topic." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.trainedOn)) return { ok: false, error: "Enter the training date." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("employee_training_log").insert({
    employee_id: input.employeeId,
    topic: input.topic.trim(),
    trained_on: input.trainedOn,
    trainer: input.trainer?.trim() || null,
    notes: input.notes?.trim() || null,
  });
  if (error) {
    return isMissingSchemaError(error)
      ? { ok: false, error: "Apply migration 0117 first (see the banner above)." }
      : { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Lifecycle transition with the legal gates:
 *   - onboarding -> active requires every CRITICAL task done;
 *   - -> terminated stamps date + reason, clears the PIN, sets active=false;
 *   - terminated -> onboarding (rehire) reactivates the row for a fresh
 *     checklist run (sick leave reinstates if within 12 months — helper text).
 */
export async function setEmploymentStatus(input: {
  employeeId: string;
  to: EmploymentStatus;
  terminationDate?: string | null;
  terminationReason?: string | null;
}): Promise<WriteResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const admin = createSupabaseAdminClient();

  const { data: emp, error: empError } = await admin
    .from("employees")
    .select("*")
    .eq("id", input.employeeId)
    .maybeSingle();
  if (empError || !emp) return { ok: false, error: "Employee not found." };
  const row = emp as EmployeeFileRow;
  if (row.employment_status === undefined) {
    return { ok: false, error: "Apply migration 0117 first (see the banner above)." };
  }
  const from = row.employment_status as EmploymentStatus;
  if (!canTransition(from, input.to)) {
    return { ok: false, error: `Can't move from ${from} to ${input.to}.` };
  }

  if (input.to === "active") {
    const { data: taskRows } = await admin
      .from("employee_onboarding_tasks")
      .select("task_key, done")
      .eq("employee_id", input.employeeId);
    const state: TaskState = {};
    for (const t of (taskRows as { task_key: string; done: boolean }[] | null) ?? []) state[t.task_key] = t.done;
    const blockers = activationBlockers(state);
    if (blockers.length > 0) {
      return {
        ok: false,
        error: `Finish the required compliance steps first: ${blockers.join("; ")}.`,
      };
    }
  }

  const update: Record<string, unknown> = { employment_status: input.to };
  if (input.to === "terminated") {
    if (!input.terminationDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.terminationDate)) {
      return { ok: false, error: "Enter the termination date." };
    }
    if (!input.terminationReason?.trim()) {
      return { ok: false, error: "Enter the termination reason (kept 5 years with the file)." };
    }
    update.termination_date = input.terminationDate;
    update.termination_reason = input.terminationReason.trim();
    update.active = false;
    update.clock_pin = null; // access ends immediately
  } else if (input.to === "active") {
    update.active = true;
    update.termination_date = null;
    update.termination_reason = null;
  } else {
    // candidate / onboarding: on the books but not on the floor yet.
    update.active = false;
    if (from === "terminated") {
      update.termination_date = null;
      update.termination_reason = null;
    }
  }

  const { error } = await admin.from("employees").update(update).eq("id", input.employeeId);
  if (error) {
    return isMissingSchemaError(error)
      ? { ok: false, error: "Apply migration 0117 first (see the banner above)." }
      : { ok: false, error: error.message };
  }
  return { ok: true };
}
