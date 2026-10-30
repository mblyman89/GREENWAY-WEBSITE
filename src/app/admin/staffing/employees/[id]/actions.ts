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
import { can } from "@/lib/auth/roles";
import { openWorkPunch } from "@/lib/staffing/store";
import { deactivateSignIn } from "@/lib/auth/sign-in-deactivate";
import {
  getEmployeeSummary,
  getSignIn,
  employeeLinkedToSignIn,
  setEmployeeSignInLink,
  scheduledShiftsFrom,
  deleteScheduledShiftsByIds,
} from "@/lib/staffing/employee-login-link-store";
import {
  linkVerdict,
  unlinkVerdict,
  validateTermination,
  shiftsToDelete,
  offboardingTasksDone,
  offboardingMessage,
  type OffboardingOutcome,
  type SignInStep,
} from "@/lib/staffing/offboarding-core";

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
  // Phase 0.3 (G-59, D74): owner and admin only - "No manager access."
  const session = await requirePermission("staffing.lifecycle");
  const employeeId = str(formData, "employee_id");
  const to = str(formData, "to") as EmploymentStatus;
  if (!employeeId) redirect("/admin/staffing/employees");
  if (!["candidate", "onboarding", "active", "terminated"].includes(to)) {
    bounce(employeeId, "error", "Pick a valid status.");
  }
  if (to === "terminated") return terminateWithOffboarding(session, employeeId, formData);

  const before = await getEmployeeSummary(employeeId);
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
    before: before ? { status: before.status } : null,
    after: { to },
  });
  revalidatePath(fileUrl(employeeId));
  revalidatePath("/admin/staffing/employees");
  const messages: Record<Exclude<EmploymentStatus, "terminated">, string> = {
    candidate: "Marked as candidate.",
    onboarding: "Onboarding started \u2014 work through the checklist below.",
    active: "Employee is ACTIVE \u2014 welcome aboard!",
  };
  bounce(employeeId, "ok", messages[to as Exclude<EmploymentStatus, "terminated">]);
}

/**
 * Phase 5 (G-54, owner D71 "yes."): one-step offboarding. Order matters:
 *   1. check the form and the transition BEFORE anything is written;
 *   2. deactivate the linked sign-in FIRST (SOP-08 \u00a74.21: "for a dismissal,
 *      deactivate first") with the Users-page guard rails and ban;
 *   3. terminate the file (status, date, reason, active=false, PIN cleared);
 *   4. delete scheduled shifts after the last day (box ticked);
 *   5. flag a still-open punch for a manager to close on Hours with a reason
 *      (never closed here: the real clock-out time is a human fact);
 *   6. tick only the checklist boxes the app actually did.
 * Every step is audited; any step that fails is named on the page.
 */
async function terminateWithOffboarding(
  session: Awaited<ReturnType<typeof requirePermission>>,
  employeeId: string,
  formData: FormData,
): Promise<never> {
  const terminationDate = str(formData, "termination_date") || null;
  const terminationReason = str(formData, "termination_reason") || null;
  const check = validateTermination({ terminationDate, terminationReason });
  if (!check.ok) bounce(employeeId, "error", check.reason);
  const lastDay = terminationDate as string;

  const before = await getEmployeeSummary(employeeId);
  if (!before) bounce(employeeId, "error", "Employee not found.");
  if (before.status === "terminated") bounce(employeeId, "error", "Already terminated. Nothing changed.");

  const wantDeactivate = formData.get("deactivate_sign_in") === "on";
  const wantDeleteShifts = formData.get("delete_shifts") === "on";

  // 2. Sign-in first.
  let signIn: SignInStep = { kind: "none" };
  const linked = before.staffId ? await getSignIn(before.staffId) : null;
  if (linked) {
    if (!wantDeactivate) signIn = linked.active ? { kind: "kept", email: linked.email } : { kind: "already_inactive", email: linked.email };
    else if (!can(session.profile.role, "users.manage")) {
      signIn = { kind: "refused", email: linked.email, reason: "only an owner or admin can deactivate a sign-in." };
    } else {
      signIn = await deactivateSignIn({
        actorId: session.userId,
        actorEmail: session.email,
        actorRole: session.profile.role,
        targetId: linked.id,
        via: `terminate:${employeeId}`,
      });
    }
  }

  // 3. Terminate.
  const res = await setEmploymentStatus({ employeeId, to: "terminated", terminationDate, terminationReason });
  if (!res.ok) {
    const signInNote =
      signIn.kind === "deactivated" ? ` Their sign-in ${signIn.email} WAS deactivated; reactivate it on Admin \u2192 Users if that was a mistake.` : "";
    bounce(employeeId, "error", `${res.error}${signInNote}`);
  }

  // 4. Future shifts.
  const upcoming = await scheduledShiftsFrom(employeeId, lastDay);
  const plan = shiftsToDelete(upcoming, lastDay);
  let shiftsDeleted = 0;
  let shiftError: string | null = null;
  if (wantDeleteShifts && plan.deleteIds.length > 0) {
    const del = await deleteScheduledShiftsByIds(employeeId, plan.deleteIds);
    if (del.ok) shiftsDeleted = del.deleted;
    else shiftError = del.error;
  }
  if (shiftsDeleted > 0) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "shift.deleted_on_termination",
      entityType: "employee",
      entityId: employeeId,
      before: { shifts: upcoming.filter((s) => plan.deleteIds.includes(s.id)) },
      after: { deleted: shiftsDeleted, last_day: lastDay },
    });
  }

  // 5. Open punch (flag only).
  const punch = await openWorkPunch(employeeId);
  if (punch) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "employee.offboarding_open_punch",
      entityType: "time_punch",
      entityId: punch.id,
      after: { employee_id: employeeId, clock_in_at: punch.clock_in_at, note: "left open for a manager to close on Hours with a reason" },
    });
  }

  const outcome: OffboardingOutcome = {
    signIn,
    shiftsDeleted,
    shiftsKeptOnLastDay: plan.onLastDay.length,
    shiftsSkipped: wantDeleteShifts ? 0 : plan.deleteIds.length,
    shiftError,
    openPunchSince: punch?.clock_in_at ?? null,
  };

  // 6. Tick what the app really did.
  for (const taskKey of offboardingTasksDone(outcome)) {
    await setTaskDone({ employeeId, taskKey, done: true, actor: session.email ?? session.userId });
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "employee.status_terminated",
    entityType: "employee",
    entityId: employeeId,
    before: { status: before.status, staff_id: before.staffId },
    after: {
      to: "terminated",
      termination_date: terminationDate,
      termination_reason: terminationReason,
      sign_in: signIn,
      shifts_deleted: shiftsDeleted,
      shifts_left: outcome.shiftsSkipped + outcome.shiftsKeptOnLastDay,
      shift_error: shiftError,
      open_punch_since: outcome.openPunchSince,
    },
  });
  revalidatePath(fileUrl(employeeId));
  revalidatePath("/admin/staffing/employees");
  revalidatePath("/admin/users");
  revalidatePath("/admin/staffing/schedule");
  const msg = offboardingMessage(outcome);
  bounce(employeeId, msg.tone, msg.text);
}

// ---------------------------------------------------------------------------
// Phase 5 (G-53, owner D70): link / unlink a back-office sign-in
// ---------------------------------------------------------------------------

/**
 * Owner or admin points this employee file at an EXISTING sign-in. Never
 * creates or edits an employee or a sign-in (books-87); the one write is
 * employees.staff_id in employee-login-link-store.ts.
 */
export async function linkSignInAction(formData: FormData): Promise<void> {
  const session = await requirePermission("staffing.lifecycle");
  const employeeId = str(formData, "employee_id");
  const staffId = str(formData, "staff_id");
  if (!employeeId) redirect("/admin/staffing/employees");
  if (!can(session.profile.role, "users.manage")) bounce(employeeId, "error", "Owner or admin only. Nothing was linked.");
  if (!staffId) bounce(employeeId, "error", "Pick a sign-in to link. Nothing was linked.");

  const employee = await getEmployeeSummary(employeeId);
  if (!employee) bounce(employeeId, "error", "Employee not found.");
  const signIn = await getSignIn(staffId);
  const linkedElsewhere = signIn ? await employeeLinkedToSignIn(signIn.id, employeeId) : null;
  const verdict = linkVerdict({
    actorRole: session.profile.role,
    employee,
    signIn,
    linkedElsewhere,
    confirmedSamePerson: formData.get("confirm_same_person") === "on",
  });
  if (!verdict.ok) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "employee.login_link.blocked",
      entityType: "employee",
      entityId: employeeId,
      after: { staff_id: staffId, reason: verdict.reason },
    });
    bounce(employeeId, "error", verdict.reason);
  }
  if (employee.staffId) {
    bounce(employeeId, "error", "This file already has a sign-in. Unlink it first, then link the right one. Nothing was linked.");
  }

  const write = await setEmployeeSignInLink(employeeId, staffId, null);
  if (!write.ok) bounce(employeeId, "error", write.error);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "employee.login_linked",
    entityType: "employee",
    entityId: employeeId,
    before: { staff_id: null },
    after: { staff_id: staffId, email: signIn!.email, role: signIn!.role, note: verdict.note },
  });
  revalidatePath(fileUrl(employeeId));
  revalidatePath("/admin/staffing/employees");
  revalidatePath("/admin/users");
  bounce(
    employeeId,
    "ok",
    `Linked to sign-in ${signIn!.email}. The register now accepts that sign-in's handbook acknowledgment, and Terminate offers to deactivate it.${verdict.note ? ` ${verdict.note}` : ""}`,
  );
}

export async function unlinkSignInAction(formData: FormData): Promise<void> {
  const session = await requirePermission("staffing.lifecycle");
  const employeeId = str(formData, "employee_id");
  if (!employeeId) redirect("/admin/staffing/employees");
  if (!can(session.profile.role, "users.manage")) bounce(employeeId, "error", "Owner or admin only. Nothing changed.");

  const employee = await getEmployeeSummary(employeeId);
  if (!employee) bounce(employeeId, "error", "Employee not found.");
  const signIn = await getSignIn(employee.staffId);
  const verdict = unlinkVerdict({ actorRole: session.profile.role, employee, signIn });
  if (!verdict.ok) bounce(employeeId, "error", verdict.reason);

  const write = await setEmployeeSignInLink(employeeId, null, employee.staffId);
  if (!write.ok) bounce(employeeId, "error", write.error);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "employee.login_unlinked",
    entityType: "employee",
    entityId: employeeId,
    before: { staff_id: employee.staffId, email: signIn?.email ?? null },
    after: { staff_id: null },
  });
  revalidatePath(fileUrl(employeeId));
  revalidatePath("/admin/staffing/employees");
  revalidatePath("/admin/users");
  bounce(
    employeeId,
    "ok",
    `Sign-in ${signIn?.email ?? "(deleted sign-in)"} unlinked. The sign-in itself was not changed. ${verdict.note ?? ""}`.trim(),
  );
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
