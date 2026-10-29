"use server";

/**
 * /admin/registers/supply-runs — server actions (Fix Phase 2.7c · G-11 · F-02-11).
 *
 * Owner, verbatim: D17 "Q-02-4- id like the supply run screen built"
 * The store rule is still the shop card (books-99: "I don't want to use the
 * master till any more for petty cash."), so a cash run needs a reason.
 *
 * Who may press what:
 *   cash out  -> orders.manage (any staff login) + the taker's PIN + a
 *                manager or lead approver PIN, not the taker (the same rule
 *                as a register safe swap, till route SWAP_APPROVER_ROLES).
 *   settle    -> orders.manage + the receiver's PIN, not the taker (form 8.4:
 *                taker and receiver sign).
 *   retry     -> orders.manage. Idempotent by source ref.
 *
 * Every write goes through supply-run-store.ts (service role); every action
 * writes an audit row. The books entries are posted by
 * src/lib/accounting/supply-run-posting-service.ts.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { formatCents } from "@/lib/registers/cash";
import { getEmployeeByPin } from "@/lib/staffing/store";
import { isValidPin } from "@/lib/staffing/time";
import { pinPadBlocked, notePinFailure, notePinSuccess } from "@/lib/security/pin-throttle-store";
import { pacificToday } from "@/lib/reports/timezone";
import { SUPPLY_RUN_PIN_SCOPE, checkCashOut, checkSettle, supplyExpenseAccount, type PinPerson } from "@/lib/registers/supply-run-core";
import { getSupplyRun, insertCashOut, saveSettle } from "@/lib/registers/supply-run-store";
import { postAdvanceForRun, postSettleForRun, describeSupplyPost } from "@/lib/accounting/supply-run-posting-service";

const BASE = "/admin/registers/supply-runs";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function fail(msg: string): never {
  redirect(`${BASE}?error=` + encodeURIComponent(msg));
}

function done(msg: string): never {
  revalidatePath(BASE);
  revalidatePath("/admin/registers");
  revalidatePath("/admin/registers/safe");
  redirect(`${BASE}?done=` + encodeURIComponent(msg));
}

/** The employee behind a PIN, throttled like the till pad. */
async function personFromPin(pin: string, who: string): Promise<PinPerson> {
  if (!pin) fail(`Enter the PIN of ${who}. Nothing was saved.`);
  if (!isValidPin(pin)) fail("A PIN is 4–6 digits. Nothing was saved.");
  const locked = await pinPadBlocked(SUPPLY_RUN_PIN_SCOPE);
  if (locked) fail(locked);
  const emp = await getEmployeeByPin(pin);
  if (!emp) {
    await notePinFailure(SUPPLY_RUN_PIN_SCOPE);
    fail("No active employee has that PIN. Nothing was saved.");
  }
  await notePinSuccess(SUPPLY_RUN_PIN_SCOPE);
  const e = emp as NonNullable<typeof emp>;
  return { id: e.id, name: e.full_name, role: e.job_role };
}

/* ── 1. Cash out (form 8.4 top half) ────────────────────────────────────── */

export async function cashOutAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");
  const taker = await personFromPin(str(formData, "taker_pin"), "the employee taking the cash");
  const approver = await personFromPin(str(formData, "approver_pin"), "the manager or lead approving it");
  const chk = checkCashOut({ amountRaw: str(formData, "amount"), reason: str(formData, "reason"), taker, approver });
  if (!chk.ok) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "supply_run.cash_out_refused",
      entityType: "supply_run",
      entityId: null,
      after: { takerId: taker.id, approverId: approver.id, approverRole: approver.role, error: chk.error },
    });
    fail(chk.error);
  }
  const day = pacificToday();
  const saved = await insertCashOut({ businessDay: day, takerId: taker.id, approverId: approver.id, amountMinor: chk.run.amountMinor, reason: chk.run.reason });
  if (!saved.ok) fail(saved.error);

  // The cash has left the master till (a physical fact). Now the books.
  const post = await postAdvanceForRun(saved.id);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "supply_run.cash_out",
    entityType: "supply_run",
    entityId: saved.id,
    after: {
      businessDay: day,
      amountMinor: chk.run.amountMinor,
      reason: chk.run.reason,
      takenBy: taker.id,
      takenByName: taker.name,
      approvedBy: approver.id,
      approvedByName: approver.name,
      books: post.kind,
      ...(post.kind === "posted" ? { journalId: post.journalId, journalNo: post.journalNo, duplicate: post.duplicate, sourceRef: post.sourceRef } : { code: post.code, message: post.message }),
    },
  });
  done(
    `${formatCents(chk.run.amountMinor)} out of the master till with ${taker.name}, approved by ${approver.name}. ` +
      "Bring back the receipt and the change, and settle it here (SOP-02 §4.13). " +
      describeSupplyPost(post, "advance"),
  );
}

/* ── 2. Settle (form 8.4 bottom half) ───────────────────────────────────── */

export async function settleAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");
  const runId = str(formData, "run_id");
  if (!runId) fail("Missing supply run.");
  const got = await getSupplyRun(runId);
  if (!got.ok) fail(`The supply run could not be read: ${got.error}. Nothing was saved.`);
  if (!got.run) fail("That supply run was not found. Nothing was saved.");
  const run = got.run;
  const receiver = await personFromPin(str(formData, "receiver_pin"), "the employee receiving the receipt and change");
  const chk = checkSettle({
    amountMinor: run.amountMinor,
    takerId: run.takenBy,
    alreadySettled: run.settledAt !== null,
    receiptRaw: str(formData, "receipt"),
    changeRaw: str(formData, "change"),
    expenseAccount: str(formData, "expense_account"),
    note: str(formData, "note"),
    receiver,
  });
  if (!chk.ok) fail(chk.error);
  const day = pacificToday();
  const saved = await saveSettle({
    runId: run.id,
    settledDay: day,
    receiverId: receiver.id,
    receiptMinor: chk.settle.receiptMinor,
    changeMinor: chk.settle.changeMinor,
    expenseAccount: chk.settle.expenseAccount,
    note: chk.settle.note,
  });
  if (!saved.ok) fail(saved.error);

  const post = await postSettleForRun(run.id);
  const acct = chk.settle.expenseAccount ? supplyExpenseAccount(chk.settle.expenseAccount) : null;
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "supply_run.settled",
    entityType: "supply_run",
    entityId: run.id,
    after: {
      settledDay: day,
      amountMinor: run.amountMinor,
      receiptMinor: chk.settle.receiptMinor,
      changeMinor: chk.settle.changeMinor,
      expenseAccount: chk.settle.expenseAccount,
      note: chk.settle.note,
      receivedBy: receiver.id,
      receivedByName: receiver.name,
      books: post.kind,
      ...(post.kind === "posted" ? { journalId: post.journalId, journalNo: post.journalNo, duplicate: post.duplicate, sourceRef: post.sourceRef } : { code: post.code, message: post.message }),
    },
  });
  done(
    `Settled: receipt ${formatCents(chk.settle.receiptMinor)}${acct ? ` (${acct.code} ${acct.name})` : ""}, change ${formatCents(chk.settle.changeMinor)} back in the master till, received by ${receiver.name}. ` +
      "Give the receipt to the owner the same day. " +
      describeSupplyPost(post, "settle"),
  );
}

/* ── 3. Retry a books entry that did not post ───────────────────────────── */

export async function retrySupplyPostAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");
  const runId = str(formData, "run_id");
  const leg = str(formData, "leg") === "settle" ? "settle" : "advance";
  if (!runId) fail("Missing supply run.");
  const post = leg === "settle" ? await postSettleForRun(runId) : await postAdvanceForRun(runId);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "supply_run.post_retried",
    entityType: "supply_run",
    entityId: runId,
    after: { leg, books: post.kind, ...(post.kind === "posted" ? { journalId: post.journalId, duplicate: post.duplicate } : { code: post.code, message: post.message }) },
  });
  if (post.kind !== "posted") fail(describeSupplyPost(post, leg));
  done(describeSupplyPost(post, leg));
}
