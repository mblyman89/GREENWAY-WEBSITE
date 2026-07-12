"use server";

/**
 * Employee file actions (Task S-b) — the onboarding wizard checkboxes, the
 * document tracker, the training log, hire-info edits, and lifecycle
 * transitions (activate / terminate / rehire). All gated on staffing.manage,
 * all audited, all enforced through the pure lifecycle core (RCW 49.94
 * ordering, activation gate) via the store.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  setTaskDone,
  setDocumentStatus,
  addTrainingEntry,
  setEmploymentStatus,
} from "@/lib/staffing/employee-lifecycle-store";
import type { DocumentStatus, EmploymentStatus } from "@/lib/staffing/employee-lifecycle-core";
import { generateHrAdvice, isAiConfigured, type HrAdvice } from "@/lib/staffing/hr-advisor";
import { rosterOverview } from "@/lib/staffing/employee-lifecycle-store";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function fileUrl(employeeId: string): string {
  return `/admin/staffing/employees/${employeeId}`;
}

function bounce(employeeId: string, param: "error" | "ok", message: string): never {
  redirect(`${fileUrl(employeeId)}?${param}=` + encodeURIComponent(message));
}

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

export async function toggleTaskAction(formData: FormData): Promise<void> {
  const session = await requirePermission("staffing.manage");
  const employeeId = str(formData, "employee_id");
  const taskKey = str(formData, "task_key");
  const done = formData.get("done") === "true";
  if (!employeeId || !taskKey) redirect("/admin/staffing/employees");

  const res = await setTaskDone({
    employeeId,
    taskKey,
    done,
    actor: session.email ?? session.userId,
  });
  if (!res.ok) bounce(employeeId, "error", res.error);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: done ? "employee.task_done" : "employee.task_undone",
    entityType: "employee",
    entityId: employeeId,
    after: { task_key: taskKey },
  });
  revalidatePath(fileUrl(employeeId));
  redirect(fileUrl(employeeId));
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export async function setDocumentAction(formData: FormData): Promise<void> {
  const session = await requirePermission("staffing.manage");
  const employeeId = str(formData, "employee_id");
  const docKey = str(formData, "doc_key");
  const status = str(formData, "status") as DocumentStatus;
  if (!employeeId || !docKey) redirect("/admin/staffing/employees");
  if (!["missing", "on_file", "signed"].includes(status)) {
    bounce(employeeId, "error", "Pick a document status.");
  }

  const receivedOn = str(formData, "received_on") || null;
  const expiresOn = str(formData, "expires_on") || null;
  const res = await setDocumentStatus({
    employeeId,
    docKey,
    status,
    receivedOn,
    expiresOn,
    notes: str(formData, "notes") || null,
  });
  if (!res.ok) bounce(employeeId, "error", res.error);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "employee.document_updated",
    entityType: "employee",
    entityId: employeeId,
    after: { doc_key: docKey, status, received_on: receivedOn, expires_on: expiresOn },
  });
  revalidatePath(fileUrl(employeeId));
  bounce(employeeId, "ok", "Document updated.");
}

// ---------------------------------------------------------------------------
// Training log
// ---------------------------------------------------------------------------

export async function addTrainingAction(formData: FormData): Promise<void> {
  const session = await requirePermission("staffing.manage");
  const employeeId = str(formData, "employee_id");
  if (!employeeId) redirect("/admin/staffing/employees");

  const res = await addTrainingEntry({
    employeeId,
    topic: str(formData, "topic"),
    trainedOn: str(formData, "trained_on"),
    trainer: str(formData, "trainer") || null,
    notes: str(formData, "notes") || null,
  });
  if (!res.ok) bounce(employeeId, "error", res.error);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "employee.training_logged",
    entityType: "employee",
    entityId: employeeId,
    after: { topic: str(formData, "topic"), trained_on: str(formData, "trained_on") },
  });
  revalidatePath(fileUrl(employeeId));
  bounce(employeeId, "ok", "Training logged (kept 5 years).");
}

// ---------------------------------------------------------------------------
// Hire info (hire date, badge number, 21+ verification)
// ---------------------------------------------------------------------------

export async function updateHireInfoAction(formData: FormData): Promise<void> {
  const session = await requirePermission("staffing.manage");
  const employeeId = str(formData, "employee_id");
  if (!employeeId) redirect("/admin/staffing/employees");

  const hireDate = str(formData, "hire_date");
  if (hireDate && !/^\d{4}-\d{2}-\d{2}$/.test(hireDate)) {
    bounce(employeeId, "error", "Enter the hire date as a calendar date.");
  }
  const update: Record<string, unknown> = {
    hire_date: hireDate || null,
    badge_number: str(formData, "badge_number") || null,
    age_21_verified: formData.get("age_21_verified") === "on",
  };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("employees").update(update).eq("id", employeeId);
  if (error) {
    const msg =
      error.code === "42703" || /column .* does not exist/i.test(error.message ?? "")
        ? "Apply migration 0117 first (see the banner above)."
        : error.message;
    bounce(employeeId, "error", msg);
  }

  // Verifying 21+ also checks the wizard step so progress stays consistent.
  if (formData.get("age_21_verified") === "on") {
    await setTaskDone({
      employeeId,
      taskKey: "age_21_verified",
      done: true,
      actor: session.email ?? session.userId,
    });
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "employee.hire_info_updated",
    entityType: "employee",
    entityId: employeeId,
    after: update,
  });
  revalidatePath(fileUrl(employeeId));
  bounce(employeeId, "ok", "Hire info saved.");
}

// ---------------------------------------------------------------------------
// Lifecycle transitions
// ---------------------------------------------------------------------------

export async function setStatusAction(formData: FormData): Promise<void> {
  const session = await requirePermission("staffing.manage");
  const employeeId = str(formData, "employee_id");
  const to = str(formData, "to") as EmploymentStatus;
  if (!employeeId) redirect("/admin/staffing/employees");
  if (!["candidate", "onboarding", "active", "terminated"].includes(to)) {
    bounce(employeeId, "error", "Pick a valid status.");
  }

  const res = await setEmploymentStatus({
    employeeId,
    to,
    terminationDate: str(formData, "termination_date") || null,
    terminationReason: str(formData, "termination_reason") || null,
  });
  if (!res.ok) bounce(employeeId, "error", res.error);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: `employee.status_${to}`,
    entityType: "employee",
    entityId: employeeId,
    after: {
      to,
      termination_date: str(formData, "termination_date") || null,
      termination_reason: str(formData, "termination_reason") || null,
    },
  });
  revalidatePath(fileUrl(employeeId));
  revalidatePath("/admin/staffing/employees");
  const messages: Record<EmploymentStatus, string> = {
    candidate: "Marked as candidate.",
    onboarding: "Onboarding started — work through the checklist below.",
    active: "Employee is ACTIVE — welcome aboard!",
    terminated:
      "Employee terminated. PIN cleared. Work the offboarding checklist below — and deactivate any back-office login on Admin → Users.",
  };
  bounce(employeeId, "ok", messages[to]);
}

// ---------------------------------------------------------------------------
// HR advisor (drafts-only AI)
// ---------------------------------------------------------------------------

export type HrAdvisorResult = { ok: true; advice: HrAdvice } | { ok: false; error: string };

export async function generateHrAdviceAction(question?: string): Promise<HrAdvisorResult> {
  await requirePermission("staffing.manage");
  if (!isAiConfigured) {
    return { ok: false, error: "AI is not configured — set AI_API_KEY to enable the HR helper." };
  }
  try {
    const overview = await rosterOverview();
    const advice = await generateHrAdvice(overview, question ?? null);
    return { ok: true, advice };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The HR helper failed. Try again." };
  }
}
