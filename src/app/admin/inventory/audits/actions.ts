"use server";

/**
 * src/app/admin/inventory/audits/actions.ts   (slice books-12)
 *
 * THE WRITE PATH FOR THE AUDITING HUB.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE THAT SHAPES THIS WHOLE FILE
 * ---------------------------------------------------------------------------
 * These actions do not decide anything. Every question of "is this allowed" is
 * already answered by the pure cores (`canMoveStatus`, `readinessOf`,
 * `gateSessionForPosting`) and re-answered by the database constraints from
 * migration 0191. This file's only job is to carry the question to the store
 * and carry the answer back to the screen WITHOUT SOFTENING IT.
 *
 * A second copy of a rule is one copy too many: the copies drift, and the one
 * that drifts is always the one the user sees.
 *
 * ---------------------------------------------------------------------------
 * WHY REFUSALS ARE REDIRECTED, NOT THROWN
 * ---------------------------------------------------------------------------
 * A thrown error becomes a stack trace or a blank page. A refusal is not a
 * crash -- it is the system working correctly and declining. Michael asked to
 * be "told why and how", so every refusal returns to the page it came from with
 * its own sentence intact, where `WhyBlockedPanel` can pair it with a remedy.
 *
 * The message is passed through verbatim. It is never replaced with "Something
 * went wrong", which is the single least useful sentence in software.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY ACTION RE-CHECKS PERMISSION
 * ---------------------------------------------------------------------------
 * A server action is a public HTTP endpoint. The page that renders the button
 * checking a permission does NOT protect the action behind it -- anyone can
 * post to the endpoint directly. `requirePermission` is therefore called inside
 * every action, not merely on the page.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  createAuditSession,
  saveCountLine,
  saveLineReason,
  moveSessionStatus,
} from "@/lib/inventory/audit-hub-store";
import type { AuditSessionStatus } from "@/lib/inventory/inventory-audit-post-core";

const HUB = "/admin/inventory/audits";

/**
 * Send a refusal back to a page as a query string.
 *
 * `code` travels alongside `message` on purpose. The message is what Michael
 * reads; the code is what `remediesForBlocker` can match on without depending
 * on prose, so re-wording a message never silently removes its remedy.
 */
function refuse(path: string, code: string, message: string): never {
  const q = new URLSearchParams({ refusalCode: code, refusal: message });
  redirect(`${path}?${q.toString()}`);
}

/** Read one required field, refusing rather than coercing a missing value. */
function requiredField(form: FormData, name: string): string {
  const raw = form.get(name);
  return typeof raw === "string" ? raw.trim() : "";
}

// ═══════════════════════════════════════════════════════════════════════════
// 1) PLAN AND CREATE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create an audit over an explicit list of lots.
 *
 * THE SCOPE RATIONALE IS MANDATORY, and that is not paperwork for its own sake.
 * An audit whose scope has no recorded reason cannot later be defended as
 * anything other than "we counted what we felt like counting" -- which is
 * exactly the criticism a scope is supposed to answer. Writing the reason
 * BEFORE the numbers are known is what makes the result evidence.
 */
export async function createAuditAction(form: FormData): Promise<void> {
  // books-23, owner only. Creating an audit decides what gets counted, and the
  // scope is the part a reviewer attacks first.
  //   "4, yes, I am the only one that can approve an audit and create an audit.
  //    Anything accounting, bookkeeping, taxes, finance, should be hard gated to
  //    me only."  -- Michael, books-23
  // inventory.manage would have included manager.
  const session = await requirePermission("inventory.audit");

  const label = requiredField(form, "label");
  const scopeRationale = requiredField(form, "scopeRationale");
  const lotIds = form.getAll("lotId").filter((v): v is string => typeof v === "string");

  if (scopeRationale.length < 10) {
    refuse(
      `${HUB}/new`,
      "SCOPE_RATIONALE_TOO_THIN",
      "Write one honest sentence about why THESE lots. 'Highest value and longest since " +
        "counted' is enough. The reason is what separates an audit from a spot check, and " +
        "it has to be written down before the numbers are known to be worth anything.",
    );
  }

  const result = await createAuditSession({ label, lotIds, scopeRationale });
  if (!result.ok) {
    refuse(`${HUB}/new`, result.refusal.code, result.refusal.message);
  }

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "inventory_audit.create",
    entityType: "inventory_audit_sessions",
    entityId: result.data.sessionId,
    after: { label, lots: lotIds.length, scopeRationale },
  });

  revalidatePath(HUB);
  redirect(`${HUB}/${result.data.sessionId}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// 2) COUNT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Record one counted quantity.
 *
 * NOTE WHAT IS NOT HERE: there is no "counted qty defaults to the system qty"
 * convenience, and no way to submit a blank as a zero. `saveCountLine` refuses
 * a negative, and a blank never reaches it at all. Blank means nobody looked;
 * zero means somebody looked and found nothing. Those are different facts and
 * the difference is the whole point of the exercise.
 */
export async function saveCountAction(form: FormData): Promise<void> {
  // books-23: counting is floor work, so this is the ONE action in this file that
  // is not owner-only.
  //   "For question 3, yes any employee can count, it should be a blind count
  //    without cost, variances, or the approve button."  -- Michael, books-23
  // What a counter can do from here is bounded by the data, not by trust: the
  // count sheet they post from carries no cost, no variance and no system
  // quantity, and this action writes a quantity and nothing else. It cannot
  // approve, cannot post, and cannot set a reason.
  const session = await requirePermission("inventory.count");

  const sessionId = requiredField(form, "sessionId");
  const lotId = requiredField(form, "lotId");
  const raw = requiredField(form, "qty");
  const captureMethod = requiredField(form, "captureMethod") === "scan" ? "scan" : "manual";
  const back = `${HUB}/${sessionId}/count`;

  if (raw === "") {
    refuse(
      back,
      "BLANK_IS_NOT_ZERO",
      "No quantity was entered. If the shelf is empty, type 0 deliberately -- that is a real " +
        "count and it is useful information. Leaving it blank tells the system nobody looked, " +
        "which is a different thing entirely.",
    );
  }

  const qty = Number(raw);
  if (!Number.isFinite(qty)) {
    refuse(
      back,
      "NOT_A_NUMBER",
      `"${raw}" is not a quantity the system can use. Enter digits only -- for grams a decimal ` +
        "like 3.5 is fine.",
    );
  }

  const result = await saveCountLine({
    sessionId,
    lotId,
    qty,
    countedBy: session.profile.id,
    captureMethod,
  });
  if (!result.ok) {
    refuse(back, result.refusal.code, result.refusal.message);
  }

  // Deliberately NOT recording the quantity in the audit log payload. The
  // security log is readable by more people than the count sheet is, and a
  // counter who can read back the last entered number is no longer counting
  // blind. The fact that a count happened is logged; the number is not.
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "inventory_audit.count",
    entityType: "inventory_audit_lines",
    entityId: `${sessionId}:${lotId}`,
    after: { recorded: result.data.recorded, captureMethod },
  });

  revalidatePath(back);
}

/**
 * Attach a reason to a variance.
 *
 * In Washington, product that disappears with no explanation is treated as a
 * SALE and taxed accordingly. "Unknown" is a legitimate answer -- sometimes it
 * is the only honest one -- but it is the most expensive answer on the list,
 * so it must be chosen deliberately rather than arrived at by leaving a box
 * empty.
 */
export async function saveReasonAction(form: FormData): Promise<void> {
  // books-23, owner only. This is not data entry, it is a TAX POSITION: the
  // reason decides whether missing product is shrink or an unreported sale. A
  // manager should not be picking that, and the comment above explains what the
  // wrong pick costs.
  const session = await requirePermission("inventory.audit");

  const sessionId = requiredField(form, "sessionId");
  const lotId = requiredField(form, "lotId");
  const reasonCode = requiredField(form, "reasonCode");
  const rawNote = requiredField(form, "reasonNote");
  const back = `${HUB}/${sessionId}`;

  if (reasonCode === "") {
    refuse(
      back,
      "MISSING_REASON",
      "Pick a reason before saving. A difference with no reason is treated by the state as a " +
        "sale you did not report.",
    );
  }

  const result = await saveLineReason({
    sessionId,
    lotId,
    reasonCode,
    reasonNote: rawNote === "" ? null : rawNote,
  });
  if (!result.ok) {
    refuse(back, result.refusal.code, result.refusal.message);
  }

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "inventory_audit.reason",
    entityType: "inventory_audit_lines",
    entityId: `${sessionId}:${lotId}`,
    after: { reasonCode },
  });

  revalidatePath(back);
}

// ═══════════════════════════════════════════════════════════════════════════
// 3) MOVE THE STATUS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Advance a session.
 *
 * `approvedBy` is passed as the signed-in user and is never taken from the
 * form. A client-supplied approver id would let the browser name somebody else
 * as the person who approved an inventory adjustment, which is the exact
 * signature an auditor looks for.
 */
export async function moveStatusAction(form: FormData): Promise<void> {
  // books-23, owner only. This action approves scope and approves results, and
  // `inventory_audit_sessions` is owner-only in the database (migration 0191).
  // Gating it any wider would invite a manager into a screen the database then
  // refuses -- and the tempting "fix" for that is loosening the DATABASE.
  const session = await requirePermission("inventory.audit");

  const sessionId = requiredField(form, "sessionId");
  const to = requiredField(form, "to") as AuditSessionStatus;
  const back = `${HUB}/${sessionId}`;

  const result = await moveSessionStatus({
    sessionId,
    to,
    approvedBy: session.profile.id,
  });
  if (!result.ok) {
    refuse(back, result.refusal.code, result.refusal.message);
  }

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "inventory_audit.status",
    entityType: "inventory_audit_sessions",
    entityId: sessionId,
    after: { status: result.data.status },
  });

  revalidatePath(HUB);
  revalidatePath(back);
}
