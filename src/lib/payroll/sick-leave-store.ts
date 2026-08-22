/**
 * src/lib/payroll/sick-leave-store.ts   (books-35)
 *
 * Server-side persistence for the sick-leave approval inbox.
 *
 * MICHAEL'S DECISION THAT THIS FILE IMPLEMENTS, VERBATIM (standing rule 1):
 *
 *   "Thank you. I like option 1 as well. It should reach me in accounting
 *    somewhere logical."
 *
 * Option 1 was: a sick-leave request must be APPROVED BEFORE it appears on the
 * timesheet. Not entered and later reversed — approved first. That single
 * decision is why this file exists and why nothing here writes to the ledger
 * except through `decideRequest`.
 *
 * THE DIVISION OF LABOUR, AND WHY IT IS STRICT
 *
 * `sick-leave-core.ts` decides what the law allows. This file decides nothing.
 * It reads rows, maps them into the engine's input types, hands them over, and
 * writes back only what a human has approved. Every judgement about balances,
 * increments, the ninety-day rule and the rate of pay lives in the core, and a
 * second copy of any of it here would eventually disagree with the first —
 * silently, on a paycheque.
 *
 * THE MAPPING IS THE DANGEROUS PART (standing rule 63d)
 *
 * The handoff is where the defect lives. A database row and an engine input
 * look similar enough that a wrong column name, a null read as a zero, or a
 * date that lost its timezone all produce a plausible number rather than an
 * error. So the mappers below are deliberately explicit and REFUSE rather than
 * defaulting. In particular a missing `hire_date` stops the review and is never
 * treated as "hired long ago", because the waiting period before leave becomes
 * usable is measured from it. Guessing early denies leave the employee has
 * actually earned; guessing late approves leave they cannot yet spend. Both are
 * wrong and only one of them is visible.
 *
 * THE SERVICE ROLE BYPASSES EVERY DATABASE GATE
 *
 * These functions use createSupabaseAdminClient(), which runs as the service
 * role and ignores the owner-only RLS policies migration 0198 puts on
 * `sick_leave_ledger` and on deciding a request. So the SQL gate does NOT
 * protect anything reached through this file. Every caller must pass through
 * `requireBooksAccess()` first, which is `is_owner()` in application form.
 * That is stated here rather than assumed, because the migration's RLS is
 * genuinely inert on this path.
 *
 * WHAT THE NEXT SLICES DO WITH THIS (standing rule 62e)
 *
 *   - The TIMESHEET reads APPROVED requests only, which is the whole point of
 *     option 1: paid sick hours appear on the sheet because Michael said yes,
 *     not because somebody typed them.
 *   - NET PAY multiplies the approved minutes by the rate the engine already
 *     computed and stored on the ledger row, rather than recomputing a rate
 *     that might disagree with the one the employee was told.
 *   - The MONTHLY NOTIFICATION required by WAC 296-128-755(2) reads the same
 *     ledger this file writes, which is why every row carries a reason.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

import {
  computeBalance,
  planDraw,
  reviewRequest,
  type RequestReview,
  type SickLeaveBalance,
  type SickLeaveLedgerEntry,
  type SickLeavePolicy,
  type SickLeaveRefusal,
  type SickLeaveRefusalCode,
  type SickLeaveRequestFacts,
} from "./sick-leave-core";

const NOT_CONFIGURED =
  "Supabase is not configured in this environment, so nothing could be read. This is a deployment " +
  "problem, not a data problem - no leave records have been lost.";

export type StoreFailure = {
  readonly ok: false;
  readonly code: "NOT_CONFIGURED" | "READ_FAILED" | "WRITE_FAILED" | "NOT_FOUND" | "REFUSED";
  readonly message: string;
  /** Engine refusals, when the failure was a considered "no" rather than a fault. */
  readonly refusals?: readonly SickLeaveRefusal[];
};

/* ════════════════════════════════════════════════════════════════════════
 * ROW SHAPES
 * ════════════════════════════════════════════════════════════════════════ */

type RequestRow = {
  id: string;
  employee_id: string;
  leave_date: string;
  minutes_requested: number;
  purpose: string;
  notice_kind: string;
  status: string;
  employee_note: string | null;
  requested_at: string;
  decided_at: string | null;
  decision_note: string | null;
};

type EmployeeRow = {
  id: string;
  full_name: string | null;
  hire_date: string | null;
};

type PolicyRow = {
  accrual_hundredth_minutes_per_hour: number | null;
  carryover_cap_minutes: number | null;
  usable_after_days: number | null;
  usage_increment_minutes: number | null;
  verification_after_days: number | null;
  verification_required: boolean | null;
};

type LedgerRow = {
  id: string;
  entry_kind: string;
  minutes: number;
  drawn_from: string | null;
  entry_date: string;
};

/* ════════════════════════════════════════════════════════════════════════
 * MAPPERS - explicit, and they refuse rather than default
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * The policy singleton, mapped for the engine.
 *
 * Every field stays nullable all the way through. The engine has a refusal
 * code for each missing piece, and those refusals are the mentoring — turning
 * a null into a "sensible default" here would silence the one message that
 * tells Michael his policy is incomplete (standing rule 62d).
 */
export function toPolicy(row: PolicyRow): SickLeavePolicy {
  return {
    accrualHundredthMinutesPerHour: row.accrual_hundredth_minutes_per_hour,
    carryoverCapMinutes: row.carryover_cap_minutes,
    usableAfterDays: row.usable_after_days,
    usageIncrementMinutes: row.usage_increment_minutes,
    verificationAfterDays: row.verification_after_days,
    verificationRequired: row.verification_required,
  };
}

/**
 * A ledger row, mapped for the balance calculation.
 *
 * `drawn_from` is passed through as null when absent rather than being
 * defaulted to a bucket. The engine's documented rule is that an unexplained
 * correction counts as statutory, and that rule belongs in the engine where it
 * is tested, not here where it would be a second, untested copy.
 */
export function toLedgerEntry(row: LedgerRow): SickLeaveLedgerEntry {
  return {
    id: row.id,
    entryKind: row.entry_kind as SickLeaveLedgerEntry["entryKind"],
    minutes: row.minutes,
    drawnFrom: (row.drawn_from ?? null) as SickLeaveLedgerEntry["drawnFrom"],
    effectiveDate: row.entry_date,
  };
}

/**
 * A request row, mapped for the engine.
 *
 * NOTE ON DATES. The table stores ONE ROW PER LEAVE DAY, so start and end are
 * the same date for every row. That is deliberate in the migration — partial
 * approval of a multi-day absence is a real thing and a single row could not
 * express it — and it means `absenceDays` from the engine is always 1 here.
 * The inbox groups consecutive days for display, but each day is decided on
 * its own, which is what makes partial approval possible at all.
 */
export function toRequestFacts(
  row: RequestRow,
  submittedOn: string,
): SickLeaveRequestFacts {
  return {
    employeeId: row.employee_id,
    purpose: row.purpose as SickLeaveRequestFacts["purpose"],
    noticeKind: row.notice_kind as SickLeaveRequestFacts["noticeKind"],
    startDate: row.leave_date,
    endDate: row.leave_date,
    requestedMinutes: row.minutes_requested,
    submittedOn,
  };
}

/** The Pacific calendar day of a timestamp, as YYYY-MM-DD. */
export function pacificDayOf(iso: string): string {
  // `en-CA` formats as YYYY-MM-DD, which is the format the engine expects.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/* ════════════════════════════════════════════════════════════════════════
 * READING THE INBOX
 * ════════════════════════════════════════════════════════════════════════ */

export type PendingRequest = {
  readonly id: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly leaveDate: string;
  readonly minutesRequested: number;
  readonly purpose: string;
  readonly noticeKind: string;
  readonly employeeNote: string | null;
  readonly requestedAt: string;
  /** The engine's verdict, or null when the review itself could not be run. */
  readonly review: RequestReview | null;
  /** Why the engine will not approve this as it stands. Empty when it will. */
  readonly refusals: readonly SickLeaveRefusal[];
  /**
   * A DATA problem that stopped the engine from being asked at all.
   *
   * Deliberately NOT expressed as a `SickLeaveRefusal`. A refusal is something
   * the engine decided, and every refusal code is proven reachable from the
   * engine by `tests/compliance/sick-leave-core.test.ts` (standing rule 43).
   * Inventing a code here so the shape matched would have put a string in the
   * refusal channel that the engine can never emit, which is exactly the kind
   * of quiet fiction the mentor gates exist to catch.
   */
  readonly blockedBy: string | null;
  /** The employee's balance as at today, for context on screen. */
  readonly balance: SickLeaveBalance;
};

export type LeaveInbox = {
  readonly ok: true;
  readonly requests: readonly PendingRequest[];
  /** How many the engine would approve without complaint. */
  readonly clearCount: number;
  /** How many carry at least one refusal. */
  readonly blockedCount: number;
  /** Policy problems that block EVERY request, listed once instead of per row. */
  readonly policyRefusals: readonly SickLeaveRefusal[];
};

/**
 * Load every pending request, each already reviewed by the engine.
 *
 * WHY THE REVIEW HAPPENS HERE AND NOT IN THE COMPONENT. The screen must never
 * be the thing that decides whether leave is owed. It renders a verdict the
 * engine reached. That is also why a request the engine refuses is still
 * SHOWN, with its refusals: hiding it would leave an employee waiting on a
 * request Michael never knew existed.
 */
export async function loadLeaveInbox(): Promise<LeaveInbox | StoreFailure> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, code: "NOT_CONFIGURED", message: NOT_CONFIGURED };
  }

  const admin = createSupabaseAdminClient();

  const { data: polData, error: polErr } = await admin
    .from("sick_leave_policy")
    .select(
      "accrual_hundredth_minutes_per_hour, carryover_cap_minutes, usable_after_days, " +
        "usage_increment_minutes, verification_after_days, verification_required",
    )
    .eq("id", 1)
    .maybeSingle();
  if (polErr) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: `Could not read the sick leave policy: ${polErr.message}`,
    };
  }

  // NO POLICY ROW IS A REAL STATE, NOT AN ERROR. Before Michael has saved a
  // policy there is nothing on file, and the honest thing is to review every
  // request against an empty policy so the engine produces its own refusals
  // naming exactly which settings are missing.
  const policy: SickLeavePolicy = polData
    ? toPolicy(polData as unknown as PolicyRow)
    : {
        accrualHundredthMinutesPerHour: null,
        carryoverCapMinutes: null,
        usableAfterDays: null,
        usageIncrementMinutes: null,
        verificationAfterDays: null,
        verificationRequired: null,
      };

  const { data: reqData, error: reqErr } = await admin
    .from("sick_leave_requests")
    .select(
      "id, employee_id, leave_date, minutes_requested, purpose, notice_kind, status, " +
        "employee_note, requested_at, decided_at, decision_note",
    )
    .eq("status", "pending")
    .order("leave_date", { ascending: true });
  if (reqErr) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: `Could not read the pending leave requests: ${reqErr.message}`,
    };
  }
  const rows = (reqData ?? []) as unknown as RequestRow[];

  if (rows.length === 0) {
    return { ok: true, requests: [], clearCount: 0, blockedCount: 0, policyRefusals: [] };
  }

  const employeeIds = [...new Set(rows.map((r) => r.employee_id))];

  const { data: empData, error: empErr } = await admin
    .from("employees")
    .select("id, full_name, hire_date")
    .in("id", employeeIds);
  if (empErr) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: `Could not read the employee records: ${empErr.message}`,
    };
  }
  const employees = new Map(
    ((empData ?? []) as unknown as EmployeeRow[]).map((e) => [e.id, e]),
  );

  const { data: ledData, error: ledErr } = await admin
    .from("sick_leave_ledger")
    .select("employee_id, entry_kind, minutes, drawn_from")
    .in("employee_id", employeeIds);
  if (ledErr) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: `Could not read the sick leave ledger: ${ledErr.message}`,
    };
  }
  const ledgerByEmployee = new Map<string, LedgerRow[]>();
  for (const l of (ledData ?? []) as unknown as (LedgerRow & { employee_id: string })[]) {
    const list = ledgerByEmployee.get(l.employee_id) ?? [];
    list.push(l);
    ledgerByEmployee.set(l.employee_id, list);
  }

  const requests: PendingRequest[] = [];
  let clear = 0;
  let blocked = 0;

  for (const row of rows) {
    const emp = employees.get(row.employee_id);
    const balance = computeBalance(
      (ledgerByEmployee.get(row.employee_id) ?? []).map(toLedgerEntry),
    );

    // A MISSING HIRE DATE IS REFUSED, NEVER ASSUMED. The ninety-day rule is
    // measured from it, and guessing "hired long ago" would approve leave the
    // employee may not yet be able to use, while guessing "hired today" would
    // deny leave they have earned. Both are wrong; only one is visible.
    let review: RequestReview | null = null;
    let refusals: readonly SickLeaveRefusal[] = [];
    let blockedBy: string | null = null;

    if (!emp || !emp.hire_date) {
      blockedBy =
        `There is no hire date on file for ${emp?.full_name ?? "this employee"}, and the ` +
        "waiting period before sick leave can be used is measured from it. Without that date " +
        "I cannot tell whether this leave is usable yet, so I have not guessed either way. " +
        "Add the hire date on the staffing screen and this request will review itself.";
    } else {
      const res = reviewRequest({
        request: toRequestFacts(row, pacificDayOf(row.requested_at)),
        policy,
        balance,
        hireDate: emp.hire_date,
      });
      if (res.ok) {
        review = res.value;
      } else {
        refusals = res.refusals;
      }
    }

    if (refusals.length > 0 || blockedBy !== null) blocked += 1;
    else clear += 1;

    requests.push({
      id: row.id,
      employeeId: row.employee_id,
      employeeName: emp?.full_name ?? "(no name on file)",
      leaveDate: row.leave_date,
      minutesRequested: row.minutes_requested,
      purpose: row.purpose,
      noticeKind: row.notice_kind,
      employeeNote: row.employee_note,
      requestedAt: row.requested_at,
      review,
      refusals,
      blockedBy,
      balance,
    });
  }

  // Policy problems repeat on every single row. Collecting them once keeps the
  // list readable and makes it obvious that the cause is one setting rather
  // than twelve separate employee problems.
  // These are the nine codes `validatePolicy` can emit, copied from the
  // SickLeaveRefusalCode union rather than remembered. The type annotation is
  // load-bearing: if a code is ever renamed in the engine, this stops
  // compiling instead of quietly never matching again and letting a policy
  // problem repeat itself once per row for the rest of time.
  const POLICY_CODES = new Set<SickLeaveRefusalCode>([
    "NO_ACCRUAL_RATE_ON_FILE",
    "ACCRUAL_RATE_BELOW_STATUTORY_FLOOR",
    "NO_CARRYOVER_CAP_ON_FILE",
    "CARRYOVER_CAP_BELOW_STATUTORY_FLOOR",
    "NO_USABLE_AFTER_ANSWER",
    "NO_USAGE_INCREMENT_ON_FILE",
    "USAGE_INCREMENT_ABOVE_ONE_HOUR",
    "VERIFICATION_THRESHOLD_UNLAWFUL",
    "VERIFICATION_POLICY_UNANSWERED",
  ]);
  const seen = new Set<string>();
  const policyRefusals: SickLeaveRefusal[] = [];
  for (const r of requests) {
    for (const f of r.refusals) {
      if (POLICY_CODES.has(f.code) && !seen.has(f.code)) {
        seen.add(f.code);
        policyRefusals.push(f);
      }
    }
  }

  return { ok: true, requests, clearCount: clear, blockedCount: blocked, policyRefusals };
}

/* ════════════════════════════════════════════════════════════════════════
 * DECIDING - the only write on this screen
 * ════════════════════════════════════════════════════════════════════════ */

export type DecisionOutcome = {
  readonly ok: true;
  readonly status: "approved" | "denied";
  readonly employeeName: string;
  readonly leaveDate: string;
  readonly minutes: number;
  readonly message: string;
};

/**
 * Approve or deny one day of leave.
 *
 * THE ENGINE IS ASKED AGAIN AT THE MOMENT OF THE WRITE. The screen's verdict
 * may be minutes old. A balance can have moved, a policy can have been saved,
 * another day of the same absence can have been approved in another tab. This
 * is the same discipline as `approvePayPeriodAction` in books-32: a disabled
 * button is a suggestion, and the real gate runs where the row is written.
 *
 * APPROVAL WRITES TWO THINGS, IN THIS ORDER
 *
 *   1. the ledger row that spends the minutes, and
 *   2. the decision on the request.
 *
 * Ledger first, deliberately. If the second write fails, the visible state is
 * a request still sitting in the inbox with a ledger row against it — an
 * over-recorded draw that shows up immediately on the balance and gets fixed.
 * The other order would leave an APPROVED request with no ledger row, which
 * looks completely correct on screen and quietly pays leave nobody deducted.
 *
 * A DENIAL MUST CARRY A REASON. The database enforces ten characters, and this
 * function refuses earlier and more kindly, because "a denial with no reason
 * is the exact record that loses a retaliation claim" (migration 0198).
 */
export async function decideRequest(args: {
  readonly requestId: string;
  readonly decision: "approve" | "deny";
  readonly decidedByStaffId: string;
  readonly note: string | null;
}): Promise<DecisionOutcome | StoreFailure> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, code: "NOT_CONFIGURED", message: NOT_CONFIGURED };
  }

  const trimmedNote = (args.note ?? "").trim();
  if (args.decision === "deny" && trimmedNote.length < 10) {
    return {
      ok: false,
      code: "REFUSED",
      message:
        "A denial has to say why, in at least a sentence. This is not bureaucracy: a denial with " +
        "no recorded reason is the exact record that loses a retaliation claim, and the reason " +
        "is far easier to write today than to remember in two years. Nothing was changed.",
    };
  }

  const admin = createSupabaseAdminClient();

  const { data: reqData, error: reqErr } = await admin
    .from("sick_leave_requests")
    .select(
      "id, employee_id, leave_date, minutes_requested, purpose, notice_kind, status, " +
        "employee_note, requested_at, decided_at, decision_note",
    )
    .eq("id", args.requestId)
    .maybeSingle();
  if (reqErr) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: `Could not read that leave request: ${reqErr.message}`,
    };
  }
  if (!reqData) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message:
        "That leave request no longer exists. It may have been cancelled by the employee since " +
        "this screen was loaded. Nothing was changed.",
    };
  }
  const row = reqData as unknown as RequestRow;

  // ALREADY DECIDED IS NOT AN ERROR TO SHRUG AT. Deciding twice would write a
  // second ledger row and spend the minutes again.
  if (row.status !== "pending") {
    return {
      ok: false,
      code: "REFUSED",
      message:
        `This request was already ${row.status}, so nothing was changed. If two people are ` +
        "working on the inbox at once, reload the screen to see the current state.",
    };
  }

  const { data: empData, error: empErr } = await admin
    .from("employees")
    .select("id, full_name, hire_date")
    .eq("id", row.employee_id)
    .maybeSingle();
  if (empErr) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: `Could not read the employee record: ${empErr.message}`,
    };
  }
  const emp = (empData ?? null) as unknown as EmployeeRow | null;
  const employeeName = emp?.full_name ?? "(no name on file)";

  /* ── DENIAL: no ledger movement, just the decision and the reason ────── */
  if (args.decision === "deny") {
    const { error } = await admin
      .from("sick_leave_requests")
      .update({
        status: "denied",
        decided_by_staff_id: args.decidedByStaffId,
        decided_at: new Date().toISOString(),
        decision_note: trimmedNote,
      })
      .eq("id", args.requestId)
      .eq("status", "pending");
    if (error) {
      return {
        ok: false,
        code: "WRITE_FAILED",
        message: `The denial could not be recorded: ${error.message}. Nothing was changed.`,
      };
    }
    return {
      ok: true,
      status: "denied",
      employeeName,
      leaveDate: row.leave_date,
      minutes: row.minutes_requested,
      message:
        `The request from ${employeeName} for ${row.leave_date} was denied, with your name, the ` +
        "time, and your reason recorded against it. No leave was deducted from their balance.",
    };
  }

  /* ── APPROVAL: re-review, then ledger, then decision ─────────────────── */

  if (!emp || !emp.hire_date) {
    return {
      ok: false,
      code: "REFUSED",
      message:
        `There is no hire date on file for ${employeeName}, and sick leave cannot be used until ` +
        "the ninetieth day of employment. Add the hire date on the staffing screen and come " +
        "back. Nothing was changed.",
    };
  }

  const { data: polData, error: polErr } = await admin
    .from("sick_leave_policy")
    .select(
      "accrual_hundredth_minutes_per_hour, carryover_cap_minutes, usable_after_days, " +
        "usage_increment_minutes, verification_after_days, verification_required",
    )
    .eq("id", 1)
    .maybeSingle();
  if (polErr) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: `Could not read the sick leave policy: ${polErr.message}`,
    };
  }
  if (!polData) {
    return {
      ok: false,
      code: "REFUSED",
      message:
        "There is no sick leave policy on file yet, so there is no accrual rate, no usage " +
        "increment and no waiting period to measure this request against. Save a policy first. " +
        "Nothing was changed.",
    };
  }
  const policy = toPolicy(polData as unknown as PolicyRow);

  const { data: ledData, error: ledErr } = await admin
    .from("sick_leave_ledger")
    .select("entry_kind, minutes, drawn_from")
    .eq("employee_id", row.employee_id);
  if (ledErr) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: `Could not read the sick leave ledger: ${ledErr.message}`,
    };
  }
  const balance = computeBalance(
    ((ledData ?? []) as unknown as LedgerRow[]).map(toLedgerEntry),
  );

  const review = reviewRequest({
    request: toRequestFacts(row, pacificDayOf(row.requested_at)),
    policy,
    balance,
    hireDate: emp.hire_date,
  });
  if (!review.ok) {
    return {
      ok: false,
      code: "REFUSED",
      message:
        "This request cannot be approved as it stands, so nothing was changed. The reasons are " +
        "listed below, each with what to do about it.",
      refusals: review.refusals,
    };
  }

  // The draw is planned by the engine, not by this file. It decides which
  // bucket the minutes come out of, and spending statutory minutes before
  // gifted ones is a rule with money attached (see migration 0198).
  // POSITIONAL, and in this order: planDraw(balance, requestedMinutes).
  // Verified against the signature in sick-leave-core.ts rather than assumed -
  // an object argument compiles to `undefined` for both parameters and the
  // engine would refuse every approval with a message about zero minutes.
  const draw = planDraw(balance, row.minutes_requested);
  if (!draw.ok) {
    return {
      ok: false,
      code: "REFUSED",
      message:
        "The minutes could not be drawn from this employee's balance, so nothing was changed.",
      refusals: draw.refusals,
    };
  }

  const nowIso = new Date().toISOString();
  const ledgerRows: Array<Record<string, unknown>> = [];

  // One row per bucket, so the ledger always shows WHERE each minute came
  // from. A single combined row would lose the distinction the whole
  // statutory/awarded split exists to preserve.
  if (draw.value.fromStatutoryMinutes > 0) {
    ledgerRows.push({
      employee_id: row.employee_id,
      entry_date: row.leave_date,
      entry_kind: "usage",
      minutes: -draw.value.fromStatutoryMinutes,
      drawn_from: "statutory",
      request_id: row.id,
      reason: `Approved sick leave for ${row.leave_date}.`,
      created_by_staff_id: args.decidedByStaffId,
      created_at: nowIso,
    });
  }
  if (draw.value.fromAwardedMinutes > 0) {
    ledgerRows.push({
      employee_id: row.employee_id,
      entry_date: row.leave_date,
      entry_kind: "usage",
      minutes: -draw.value.fromAwardedMinutes,
      drawn_from: "awarded",
      request_id: row.id,
      reason: `Approved sick leave for ${row.leave_date}, from awarded hours.`,
      created_by_staff_id: args.decidedByStaffId,
      created_at: nowIso,
    });
  }

  if (ledgerRows.length === 0) {
    return {
      ok: false,
      code: "REFUSED",
      message:
        "The engine planned a draw of zero minutes, which cannot be right for a request with " +
        "minutes on it. Nothing was changed. This is a defect - tell the developer rather than " +
        "working around it.",
    };
  }

  const { error: insErr } = await admin.from("sick_leave_ledger").insert(ledgerRows);
  if (insErr) {
    return {
      ok: false,
      code: "WRITE_FAILED",
      message:
        `The leave could not be deducted from the balance, so the request was NOT approved and ` +
        `nothing was changed: ${insErr.message}`,
    };
  }

  const { error: updErr } = await admin
    .from("sick_leave_requests")
    .update({
      status: "approved",
      decided_by_staff_id: args.decidedByStaffId,
      decided_at: nowIso,
      decision_note: trimmedNote.length > 0 ? trimmedNote : null,
    })
    .eq("id", args.requestId)
    .eq("status", "pending");
  if (updErr) {
    // The ledger row is already in. Say so plainly rather than reporting a
    // clean failure, because the balance HAS moved and a reader who believes
    // nothing happened will approve it a second time.
    return {
      ok: false,
      code: "WRITE_FAILED",
      message:
        `The leave was deducted from ${employeeName}'s balance but the approval itself could ` +
        `not be recorded: ${updErr.message}. The request is still showing as pending and the ` +
        "balance has already moved, so do NOT approve it again - tell the developer.",
    };
  }

  const hours = (row.minutes_requested / 60).toFixed(2);
  return {
    ok: true,
    status: "approved",
    employeeName,
    leaveDate: row.leave_date,
    minutes: row.minutes_requested,
    message:
      `Approved ${hours} hours of sick leave for ${employeeName} on ${row.leave_date}, with your ` +
      "name and the time recorded against it. The hours have been deducted from their balance " +
      "and will appear on the timesheet for that pay period as paid sick time - which does not " +
      "count toward overtime, because those hours were paid but not worked.",
  };
}
