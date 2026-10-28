"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { parseDenoms, denomTotalMinor } from "@/lib/registers/cash";
import { tipsToMinor, SECOND_COUNT_REQUIRED_ERROR } from "@/lib/pos/till-core";
import {
  BACKOFFICE_TILL_THROTTLE_SCOPE,
  CLOSER_REQUIRED_ERROR,
  checkSecondCounter,
  compareCounts,
} from "@/lib/registers/second-count-core";
import { getEmployeeByPin } from "@/lib/staffing/store";
import { isValidPin } from "@/lib/staffing/time";
import { pinPadBlocked, notePinFailure, notePinSuccess } from "@/lib/security/pin-throttle-store";
import {
  openDrawer,
  closeDrawerBlind,
  recordDrop,
  reconcileDrawer,
  verifyTill,
} from "@/lib/registers/store";
import { loadDrawerFigure, assignReturnRefund, VOID_REFUND_ASSIGNED_ACTION, voidRefundState } from "@/lib/registers/drawer-figure-store";
import { figureReady, parsePaidFrom } from "@/lib/registers/drawer-figure-core";
import { isOverShortWarning } from "@/lib/registers/over-short-warning-core";
import { getSession } from "@/lib/registers/store";
import {
  postDrawerCloseForSession,
  describeDrawerPostOutcome,
} from "@/lib/registers/drawer-posting-service";

const BASE = "/admin/registers";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function dollarsToMinor(raw: string): number {
  const n = Number(raw.replace(/[^0-9.\-]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** The employees.id linked to a back-office login (employees.staff_id), or null. */
async function employeeIdForStaff(staffId: string | null | undefined): Promise<string | null> {
  if (!staffId || !isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("employees").select("id").eq("staff_id", staffId).limit(2);
  if (error) return null;
  const rows = (data as { id: string }[] | null) ?? [];
  return rows.length === 1 ? rows[0].id : null; // two linked rows = ambiguous, never guessed
}

/** Open a drawer (count-in). Any active staff can count their own drawer. */
export async function openDrawerAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");
  const registerId = str(formData, "register_id");
  const employeeId = str(formData, "employee_id") || null;
  const shiftId = str(formData, "shift_id") || null;
  if (!registerId) redirect(`${BASE}?error=` + encodeURIComponent("Missing register."));
  const denoms = parseDenoms((k) => formData.get(k) as string | null);
  const result = await openDrawer({ registerId, employeeId, shiftId, denoms });
  if (!result.ok) redirect(`${BASE}?error=` + encodeURIComponent(result.error));
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "drawer.opened",
    entityType: "drawer_session",
    entityId: result.sessionId,
  });
  revalidatePath(BASE);
  redirect(`${BASE}?opened=1`);
}

/** Record a cash drop. */
export async function recordDropAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");
  const sessionId = str(formData, "session_id");
  if (!sessionId) redirect(`${BASE}?error=` + encodeURIComponent("Missing session."));
  const window = str(formData, "drop_window");
  const result = await recordDrop({
    sessionId,
    amountMinor: dollarsToMinor(str(formData, "amount")),
    window: (["afternoon", "night", "other"].includes(window) ? window : "other") as "afternoon" | "night" | "other",
    droppedBy: str(formData, "dropped_by") || null,
    witnessedBy: str(formData, "witnessed_by") || null,
    notes: str(formData, "notes") || null,
  });
  if (!result.ok) redirect(`${BASE}?error=` + encodeURIComponent(result.error ?? "Failed."));
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "drawer.drop",
    entityType: "drawer_session",
    entityId: sessionId,
  });
  revalidatePath(BASE);
  redirect(`${BASE}?dropped=1`);
}

/** Close a drawer (BLIND count-out). */
export async function closeDrawerAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");
  const sessionId = str(formData, "session_id");
  const employeeId = str(formData, "employee_id") || null;
  if (!sessionId) redirect(`${BASE}?error=` + encodeURIComponent("Missing session."));
  const denoms = parseDenoms((k) => formData.get(k) as string | null);
  // Tips counted at close (employee money, kept OUT of drawer math).
  // Blank field = not recorded (NULL); a typed "0" = counted-zero jar.
  const tipsRaw = str(formData, "tips");
  const tipsParsed = tipsRaw ? tipsToMinor(tipsRaw) : null;
  // Fix Phase 2.2 (G-01, owner D2): a second employee's own count and PIN.
  const fail = (msg: string) => redirect(`${BASE}?error=` + encodeURIComponent(msg));
  if (!employeeId) fail(CLOSER_REQUIRED_ERROR);
  const secondPin = str(formData, "second_pin");
  if (!secondPin) fail(SECOND_COUNT_REQUIRED_ERROR);
  if (!isValidPin(secondPin)) fail("The second employee's PIN must be 4–6 digits.");
  const locked = await pinPadBlocked(BACKOFFICE_TILL_THROTTLE_SCOPE);
  if (locked) fail(locked);
  const second = await getEmployeeByPin(secondPin);
  if (!second) {
    await notePinFailure(BACKOFFICE_TILL_THROTTLE_SCOPE);
    fail("No active employee for the second PIN.");
  }
  await notePinSuccess(BACKOFFICE_TILL_THROTTLE_SCOPE);
  const secondEmp = second as NonNullable<typeof second>;
  const who = checkSecondCounter(employeeId, secondEmp.id);
  if (!who.ok) fail(who.error);
  const secondDenoms = parseDenoms((k) => formData.get(`second_${k}`) as string | null);

  const result = await closeDrawerBlind({
    sessionId,
    employeeId,
    denoms,
    ...(tipsRaw && tipsParsed !== null ? { tipsMinor: tipsParsed } : {}),
    second: { employeeId: secondEmp.id, denoms: secondDenoms },
  });
  if (!result.ok) redirect(`${BASE}?error=` + encodeURIComponent(result.error ?? "Failed."));
  const cmp = compareCounts(denomTotalMinor(denoms), denomTotalMinor(secondDenoms));
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "drawer.closed_blind",
    entityType: "drawer_session",
    entityId: sessionId,
    after: {
      via: "back_office",
      employeeId,
      secondCountedBy: secondEmp.id,
      secondCountedByName: secondEmp.full_name,
      countsAgree: cmp.state === "match",
      countDiffMinor: cmp.diffMinor,
      ...(result.countRowWarnings ? { countRowWarnings: result.countRowWarnings } : {}),
    },
  });
  revalidatePath(BASE);
  redirect(`${BASE}?closed=1${cmp.state === "match" ? "" : `&count_diff=${cmp.diffMinor}`}`);
}

/**
 * Reconcile (manager): reveal over/short.
 *
 * Fix Phase 2.1 (G-05, F-01-4): no typed cash sales. The server builds this
 * drawer's figure from its own records at the moment of the click (never
 * from a number the page sent) and refuses while anything is unknown.
 */
export async function reconcileDrawerAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const sessionId = str(formData, "session_id");
  if (!sessionId) redirect(`${BASE}?error=` + encodeURIComponent("Missing session."));
  const loaded = await loadDrawerFigure(sessionId);
  if (!loaded) redirect(`${BASE}?error=` + encodeURIComponent("Session not found."));
  const { figure } = loaded!;
  if (!figureReady(figure)) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "drawer.reconcile_refused",
      entityType: "drawer_session",
      entityId: sessionId,
      after: { blockers: figure.blockers },
    });
    redirect(`${BASE}?error=` + encodeURIComponent(`Not reconciled: ${figure.blockers.join(" ")}`));
  }
  const result = await reconcileDrawer({
    sessionId,
    cashSalesMinor: figure.cashSalesMinor,
    refundsPaidMinor: figure.refundsPaidMinor,
    // F-01-5: the column takes an employee id, so it is filled from the
    // signed-in manager's own employee record (never typed text). No linked
    // employee record -> left blank; the audit entry still names the login.
    reconciledBy: await employeeIdForStaff(session.profile.id),
    // Fix Phase 2.3 (G-03, owner D7 / D21): required when the drawer is more
    // than $5.00 over or short; reconcileDrawer checks it against its own
    // over/short (never the page's).
    overShortReason: str(formData, "over_short_reason"),
  });
  if (!result.ok && result.overShortMinor != null && isOverShortWarning(result.overShortMinor)) {
    // A refusal for a missing reason is recorded, so the owner can see it.
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "drawer.reconcile_refused",
      entityType: "drawer_session",
      entityId: sessionId,
      after: { reason_required: true, over_short_minor: result.overShortMinor, error: result.error ?? null },
    });
  }
  if (!result.ok) redirect(`${BASE}?error=` + encodeURIComponent(result.error ?? "Failed."));

  // Reconcile is the first moment over/short is a FACT rather than an unknown,
  // so it is the first honest moment to write to the ledger (books-94, D-39).
  // The post never blocks the reconcile: the count is already durable, and a
  // ledger problem must not make a manager re-count a drawer.
  const posted = await postDrawerCloseForSession(sessionId);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "drawer.reconciled",
    entityType: "drawer_session",
    entityId: sessionId,
    // Rule 134: an outcome that is not written down did not happen. Whatever
    // the ledger did — posted, duplicate, skipped, refused or failed — lands
    // in the audit trail, not only in a redirect that the next click erases.
    after: {
      ledger_kind: posted.kind,
      ledger_code: posted.code,
      // Fix Phase 2.1: the figure the reconcile used, so it can be checked later.
      cash_sales_minor: figure.cashSalesMinor,
      sale_count: figure.saleCount,
      employee_tab_minor: figure.employeeTabMinor,
      other_tender_minor: figure.otherTenderMinor,
      rounding_minor: figure.roundingMinor,
      refunds_paid_minor: figure.refundsPaidMinor,
      refunds_paid: figure.refundsPaid.map((r) => ({ source: r.source, id: r.sourceId, minor: r.refundMinor })),
      drops_minor: figure.dropsMinor,
      opening_minor: figure.openingMinor,
      expected_minor: result.expectedMinor ?? null,
      over_short_minor: result.overShortMinor ?? null,
      exceptions_not_counted: figure.exceptionCount,
      // Fix Phase 2.3 (G-03): the $5 warning and the reason, kept here too so
      // the reason survives even before migration 0315 adds its column.
      over_short_warning: result.warning ?? false,
      over_short_reason: result.reason ?? null,
      over_short_reason_saved: result.reasonSaved ?? true,
    },
  });
  if (result.warning) {
    // D7: "Just warnings for now." A separate, searchable audit action for
    // every drawer more than $5.00 over or short.
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "drawer.over_short_warning",
      entityType: "drawer_session",
      entityId: sessionId,
      after: { over_short_minor: result.overShortMinor ?? null, reason: result.reason ?? null },
    });
  }
  revalidatePath(BASE);
  revalidatePath(`${BASE}/over-short`);
  redirect(
    `${BASE}?reconciled=${result.overShortMinor ?? 0}&posted=` +
      encodeURIComponent(describeDrawerPostOutcome(posted)) +
      (result.warning ? "&warn=1" : "") +
      (result.reason && result.reasonSaved === false ? "&reason_unsaved=1" : ""),
  );
}

/** Manager till next-morning verify/validate. */
export async function verifyTillAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const sessionId = str(formData, "session_id");
  if (!sessionId) redirect(`${BASE}?error=` + encodeURIComponent("Missing session."));
  const denoms = parseDenoms((k) => formData.get(k) as string | null);
  const result = await verifyTill({
    sessionId,
    verifiedBy: str(formData, "verified_by") || null,
    denoms,
    agrees: formData.get("agrees") === "on" || formData.get("agrees") === "true",
    notes: str(formData, "notes") || null,
  });
  if (!result.ok) redirect(`${BASE}?error=` + encodeURIComponent(result.error ?? "Failed."));
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "till.verified",
    entityType: "drawer_session",
    entityId: sessionId,
  });
  revalidatePath(BASE);
  redirect(`${BASE}?verified=${result.varianceMinor ?? 0}`);
}

/**
 * Fix Phase 2.1 (G-05): say where an untied cash refund was paid from (a
 * drawer of that day, or the store safe). Manager only. A return is tied by
 * a compare-and-set on the row; a void (whose only record is its audit
 * entry) is tied by an audit entry of its own, and only while it is untied.
 */
export async function assignRefundAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const source = str(formData, "source");
  const sourceId = str(formData, "source_id");
  const businessDay = str(formData, "business_day");
  const choice = parsePaidFrom(str(formData, "paid_from"));
  const back = str(formData, "back") === "drawer" && str(formData, "session_id")
    ? `${BASE}/history/${encodeURIComponent(str(formData, "session_id"))}`
    : BASE;
  if (!sourceId || (source !== "void" && source !== "return") || !/^\d{4}-\d{2}-\d{2}$/.test(businessDay)) {
    redirect(`${back}?error=` + encodeURIComponent("Missing refund."));
  }
  if (!choice) redirect(`${back}?error=` + encodeURIComponent("Pick the drawer or the safe the cash came from."));
  if (choice!.paidFrom === "drawer") {
    const s = await getSession(choice!.drawerSessionId!);
    if (!s) redirect(`${back}?error=` + encodeURIComponent("That drawer was not found."));
    if (s!.status === "reconciled" || s!.status === "verified") {
      redirect(`${back}?error=` + encodeURIComponent("That drawer is already reconciled, so a refund can no longer be added to it."));
    }
  }
  if (source === "return") {
    const r = await assignReturnRefund({ returnId: sourceId, paidFrom: choice!.paidFrom, drawerSessionId: choice!.drawerSessionId });
    if (!r.ok) redirect(`${back}?error=` + encodeURIComponent(r.error));
  } else {
    const state = await voidRefundState(sourceId, businessDay);
    if (!state) redirect(`${back}?error=` + encodeURIComponent("That void was not found on that day."));
    if (state!.paidFrom !== null) {
      redirect(`${back}?error=` + encodeURIComponent("That void is already tied to a drawer or the safe. Reload the page."));
    }
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: VOID_REFUND_ASSIGNED_ACTION,
      entityType: "order",
      entityId: sourceId,
      after: {
        refundPaidFrom: choice!.paidFrom,
        drawerSessionId: choice!.drawerSessionId,
        refundMinor: state!.refundMinor,
        businessDay,
      },
    });
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "drawer.refund_assigned",
    entityType: source === "void" ? "order" : "customer_returns",
    entityId: sourceId,
    after: { source, paid_from: choice!.paidFrom, drawer_session_id: choice!.drawerSessionId, business_day: businessDay },
  });
  revalidatePath(BASE);
  redirect(`${back}?assigned=1`);
}
