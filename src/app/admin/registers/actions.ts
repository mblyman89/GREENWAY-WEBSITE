"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { parseDenoms, denomTotalMinor } from "@/lib/registers/cash";
import { tipsToMinor } from "@/lib/pos/till-core";
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
  recordSecondCount,
} from "@/lib/registers/store";
import { loadDrawerFigure, assignReturnRefund, VOID_REFUND_ASSIGNED_ACTION, voidRefundState } from "@/lib/registers/drawer-figure-store";
import { figureReady, parsePaidFrom } from "@/lib/registers/drawer-figure-core";
import { isOverShortWarning } from "@/lib/registers/over-short-warning-core";
import { getSession, getRegister } from "@/lib/registers/store";
import { floatCheck, splitTipPool, tipPoolSentence } from "@/lib/registers/shift-end-core";
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
  // Fix Phase 6 (G-62, owner D85 "Warn please"): saved either way; flagged.
  const reg = await getRegister(registerId);
  const fc = floatCheck(denomTotalMinor(denoms), reg?.default_float_minor ?? null);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "drawer.opened",
    entityType: "drawer_session",
    entityId: result.sessionId,
    after: { via: "back_office", employeeId, openingMinor: denomTotalMinor(denoms), standardFloatMinor: reg?.default_float_minor ?? null, floatCheck: fc.state, floatDiffMinor: fc.diffMinor },
  });
  if (fc.state === "over" || fc.state === "short") {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "drawer.float_warning",
      entityType: "drawer_session",
      entityId: result.sessionId,
      after: { via: "back_office", employeeId, standardFloatMinor: reg?.default_float_minor ?? null, diffMinor: fc.diffMinor },
    });
  }
  revalidatePath(BASE);
  redirect(`${BASE}?opened=1` + (fc.sentence ? `&float_warn=` + encodeURIComponent(fc.sentence) : ""));
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
  const tipsParsedRaw = tipsRaw ? tipsToMinor(tipsRaw) : null;
  // Fix Phase 6 (G-64, owner D89 / Q-E-10): "pooled for the morning crew, and
  // pooled for the night crew ... evenly distributed to the two employees."
  // tip_mode=pool -> the typed figure is the crew's pool; this cashier's
  // share (pool / people, whole cents) is what goes on their close.
  const tipPoolMode = str(formData, "tip_mode") !== "own";
  let tipPoolSplit: ReturnType<typeof splitTipPool> | null = null;
  if (tipPoolMode && tipsRaw && tipsParsedRaw !== null) {
    tipPoolSplit = splitTipPool(tipsParsedRaw, Number(str(formData, "tip_people") || "2"));
    if (!tipPoolSplit.ok) redirect(`${BASE}?error=` + encodeURIComponent(tipPoolSplit.error));
  }
  const tipsParsed = tipPoolSplit && tipPoolSplit.ok ? tipPoolSplit.shareMinor : tipsParsedRaw;
  // Owner D121: closing is one person. The closer must be named (so the
  // second count, done later in the office per D122, can be checked against
  // them). A second count typed here at the same time is optional.
  const fail = (msg: string) => redirect(`${BASE}?error=` + encodeURIComponent(msg));
  if (!employeeId) fail(CLOSER_REQUIRED_ERROR);
  const secondPin = str(formData, "second_pin");
  let secondEmp: { id: string; full_name: string } | null = null;
  let secondDenoms: ReturnType<typeof parseDenoms> | null = null;
  if (secondPin) {
    if (!isValidPin(secondPin)) fail("The second employee's PIN must be 4–6 digits.");
    const locked = await pinPadBlocked(BACKOFFICE_TILL_THROTTLE_SCOPE);
    if (locked) fail(locked);
    const second = await getEmployeeByPin(secondPin);
    if (!second) {
      await notePinFailure(BACKOFFICE_TILL_THROTTLE_SCOPE);
      fail("No active employee for the second PIN.");
    }
    await notePinSuccess(BACKOFFICE_TILL_THROTTLE_SCOPE);
    secondEmp = second as NonNullable<typeof second>;
    const who = checkSecondCounter(employeeId, secondEmp.id);
    if (!who.ok) fail(who.error);
    secondDenoms = parseDenoms((k) => formData.get(`second_${k}`) as string | null);
  }

  const result = await closeDrawerBlind({
    sessionId,
    employeeId,
    denoms,
    ...(tipsRaw && tipsParsed !== null ? { tipsMinor: tipsParsed } : {}),
    ...(secondEmp && secondDenoms ? { second: { employeeId: secondEmp.id, denoms: secondDenoms } } : {}),
  });
  if (!result.ok) redirect(`${BASE}?error=` + encodeURIComponent(result.error ?? "Failed."));
  const cmp = secondDenoms ? compareCounts(denomTotalMinor(denoms), denomTotalMinor(secondDenoms)) : null;
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "drawer.closed_blind",
    entityType: "drawer_session",
    entityId: sessionId,
    after: {
      via: "back_office",
      employeeId,
      ...(tipsRaw && tipsParsed !== null ? { tipsMinor: tipsParsed } : {}),
      ...(tipPoolSplit && tipPoolSplit.ok
        ? { tipPool: { poolMinor: tipPoolSplit.poolMinor, people: tipPoolSplit.people, shareMinor: tipPoolSplit.shareMinor, leftoverMinor: tipPoolSplit.leftoverMinor } }
        : {}),
      ...(secondEmp && cmp
        ? {
            secondCountedBy: secondEmp.id,
            secondCountedByName: secondEmp.full_name,
            countsAgree: cmp.state === "match",
            countDiffMinor: cmp.diffMinor,
          }
        : { secondCount: "pending_back_office" }),
      ...(result.countRowWarnings ? { countRowWarnings: result.countRowWarnings } : {}),
    },
  });
  revalidatePath(BASE);
  redirect(
    `${BASE}?closed=1${!cmp || cmp.state === "match" ? "" : `&count_diff=${cmp.diffMinor}`}` +
      (tipPoolSplit && tipPoolSplit.ok ? `&tip_pool=` + encodeURIComponent(tipPoolSentence(tipPoolSplit)) : ""),
  );
}

/**
 * Owner D122: the SECOND COUNT, done in the office on the computer.
 *
 * Owner: "The second count happens in the office on the computer via the
 * back office app." After the cashier closes the drawer on the iPad (one
 * person, D121), a different employee counts the drawer again here, enters
 * the bill quantities and their own PIN. Any employee, any job role, just
 * not the person who closed it (D2's "any second employee" still holds).
 * Both counts are kept; if they differ it is a warning, never a block, and
 * over / short still uses the closer's count.
 */
export async function secondCountAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");
  const fail = (msg: string) => redirect(`${BASE}?error=` + encodeURIComponent(msg));
  const sessionId = str(formData, "session_id");
  if (!sessionId) fail("Missing session.");
  const pin = str(formData, "second_pin");
  if (!isValidPin(pin)) fail("Enter your own 4–6 digit PIN (the person doing the second count).");
  const locked = await pinPadBlocked(BACKOFFICE_TILL_THROTTLE_SCOPE);
  if (locked) fail(locked);
  const emp = await getEmployeeByPin(pin);
  if (!emp) {
    await notePinFailure(BACKOFFICE_TILL_THROTTLE_SCOPE);
    fail("No active employee for that PIN.");
  }
  await notePinSuccess(BACKOFFICE_TILL_THROTTLE_SCOPE);
  const counter = emp as NonNullable<typeof emp>;
  const denoms = parseDenoms((k) => formData.get(`second_${k}`) as string | null);
  if (denomTotalMinor(denoms) <= 0) fail("Enter the bill quantities you counted.");

  const result = await recordSecondCount({ sessionId, employeeId: counter.id, denoms });
  if (!result.ok) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "drawer.second_count_refused",
      entityType: "drawer_session",
      entityId: sessionId,
      after: { employeeId: counter.id, error: result.error ?? null },
    });
    fail(result.error ?? "Second count not saved.");
  }
  const cmp = compareCounts(result.closingMinor ?? null, result.secondMinor ?? null);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "drawer.second_counted",
    entityType: "drawer_session",
    entityId: sessionId,
    after: {
      via: "back_office",
      secondCountedBy: counter.id,
      secondCountedByName: counter.full_name,
      secondCountMinor: result.secondMinor ?? null,
      countsAgree: cmp.state === "match",
      countDiffMinor: cmp.diffMinor,
      ...(result.countRowWarning ? { countRowWarning: result.countRowWarning } : {}),
    },
  });
  revalidatePath(BASE);
  redirect(`${BASE}?second=1${cmp.state === "match" ? "" : `&count_diff=${cmp.diffMinor}`}`);
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
  // Owner D123 (professional call, flagged to the owner): the second count
  // moved off the iPad and into the office (D121 / D122), so reconcile waits
  // for it. That keeps "two people count every drawer" without slowing the
  // cash-drawer change at the register.
  const toReconcile = await getSession(sessionId);
  if (toReconcile && toReconcile.status === "closed" && toReconcile.second_count_minor == null) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "drawer.reconcile_refused",
      entityType: "drawer_session",
      entityId: sessionId,
      after: { second_count_missing: true },
    });
    redirect(
      `${BASE}?error=` +
        encodeURIComponent("Not reconciled: do the second count first (Second count form on this drawer's card). A different employee counts the drawer and enters their PIN."),
    );
  }
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

/**
 * RETIRED (Fix Phase 6, G-63, owner D83 / Q-E-5: "Yes please do this.").
 * The morning blind recount of the deposit bag (Deposit bags, SOP-03 §4.10)
 * is now the official morning verify for every drawer in that bag. The old
 * step saved $0 and wrote a typed name into an id column (F-00-3, F-00-4) and
 * could run before reconcile (F-01-12). This action now refuses and writes
 * nothing, so an old bookmarked form cannot write a till_verifications row.
 * Old "verified" drawers keep their history and still read as verified.
 */
export async function verifyTillAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "till.verify_retired",
    entityType: "drawer_session",
    entityId: str(formData, "session_id") || null,
  });
  redirect(
    `${BASE}?error=` +
      encodeURIComponent(
        "Verify till is retired (owner rule D83). The morning recount on Deposit bags is the verify now. Nothing was saved.",
      ),
  );
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
