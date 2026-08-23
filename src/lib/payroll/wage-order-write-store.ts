/**
 * src/lib/payroll/wage-order-write-store.ts   (books-38)
 *
 * THE WRITE PATH FOR WAGE ORDERS. IT DID NOT EXIST UNTIL NOW.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Michael wrote, in the message that opened this slice:
 *
 *   "the child support and garnishment page does not have a way for me to
 *    enter that in. Is it on other page like the payroll setup page?"
 *
 * He was right, and the honest answer was worse than he assumed. It was not on
 * another page. It was on NO page. The evidence, gathered before a line of this
 * was written rather than from memory (standing rule 11):
 *
 *   - `wage_orders` has existed since migration 0198 with every judgement field
 *     on it, seven order kinds, and the CHECK constraints that make a
 *     half-entered order impossible.
 *   - `garnishment-core.ts` (940 lines) computes every ceiling correctly and is
 *     mutation-tested against the statutes.
 *   - `garnishment-store.ts` exported exactly ONE function: `loadGarnishmentBoard()`.
 *   - A repository-wide grep for `insert`/`update`/`upsert` against
 *     `wage_orders` returned exactly one hit, and that hit was a STRING LITERAL
 *     inside a mentor-gate file.
 *
 * So the system could read wage orders, display wage orders, and compute
 * withholding on wage orders — and there was no way on earth to put one in. The
 * table would have stayed empty forever and the garnishments page would have
 * kept saying "no orders on file", which is the exact sentence a screen shows
 * when everything is fine and also the exact sentence it shows when a live
 * court order is being ignored.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A SEPARATE FILE FROM `garnishment-store.ts`
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Standing rule 25 says EXTEND, do not duplicate, and this looks at first like
 * a violation of it. It is not, and the distinction is worth stating because a
 * future reader will otherwise "tidy" the two together.
 *
 * `garnishment-store.ts` has a property stated loudly in its own header: it
 * performs NO arithmetic and makes NO decisions. It reads rows and hands them
 * to the engine. That is a small, checkable claim, and its whole value is that
 * a reader can confirm it in one sitting.
 *
 * Writing is a different act with different hazards — validation, duplicate
 * detection, race conditions, constraint translation, audit trail. Pouring 600
 * lines of that into the read module would destroy the one property that makes
 * the read module trustworthy. They share the table; they do not share a job.
 *
 * The read module is still the only thing that reads for display, and this
 * module is the only thing that writes. Neither duplicates the other.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DIVISION OF LABOUR, WHICH IS THE WHOLE SAFETY ARGUMENT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Three layers, and each refuses independently:
 *
 *   1. `wage-order-entry-core.validateWageOrderDraft()` — PURE. Turns what a
 *      human typed into either a row or a list of refusals. No database, no
 *      clock, no I/O. Every refusal code is reachable and mutation-tested.
 *
 *   2. THIS FILE. Re-runs that validation at the moment of the write, with the
 *      real duplicate list read fresh from the database, and translates any
 *      constraint violation the database still raises into a sentence.
 *
 *   3. The DATABASE. Migration 0198's CHECK constraints and 0201's
 *      `served_date` NOT NULL. The last line, and the only one that cannot be
 *      bypassed by a bug in the two above.
 *
 * Layer 1 running in the browser is a courtesy — it makes the form pleasant. It
 * is NOT a gate, because a server action is a public HTTP endpoint that anybody
 * can post to without ever loading the page. Layer 2 is the real gate. This is
 * the same reasoning as `leave/actions.ts` and it is not negotiable.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY VALIDATION IS RE-RUN HERE INSTEAD OF TRUSTING THE FORM'S VERDICT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The duplicate-case-number check is the reason. The form checks the draft
 * against the case numbers it was rendered with, which may be minutes old. In
 * those minutes another order can have been entered — in another tab, by
 * another person, or by Michael himself who forgot he had already done it.
 *
 * If the stale verdict were trusted, a re-entered writ would be written twice
 * and the employee would have DOUBLE withheld from their pay. They would find
 * out when their rent bounced. The unique index `wage_orders_one_live_per_case`
 * would actually catch it — but as a raw Postgres error, and the whole point of
 * this file is that Michael never sees one of those.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOTHING IS EVER DELETED
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * There is no delete function in this file and there will not be one.
 *
 * A wage order is a legal instrument served on Greenway. When it ends, the
 * ending is itself a fact with a date and a reason — and if the court or the
 * employee ever asks "what did you withhold, and under what authority, in
 * March", the answer has to exist. A deleted row cannot answer that question,
 * and an employer who cannot answer it is the one who pays.
 *
 * So orders are TERMINATED (with a mandatory reason, enforced by 0198's
 * `wage_orders_terminated_has_note` constraint) or SUSPENDED (reversible). Both
 * leave the row, its history, and its `updated_at` in place.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A NULL IS NEVER TURNED INTO A FALSE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `supports_second_family` and `arrears_over_twelve_weeks` decide whether the
 * ceiling on a support order is 50%, 55%, 60% or 65% of disposable earnings.
 * The difference between the outer two is fifteen percentage points of
 * somebody's wages.
 *
 * A `false` written where the answer is genuinely unknown produces a system
 * that looks like it is working and quietly under-withholds child support,
 * which is the one error in this entire domain that lands on the employer
 * personally (RCW 26.23.090). The validator refuses on a support order with
 * either answer missing, and this file passes the tri-state through untouched.
 * Standing rule 62d: never invent a default.
 */

import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

// The minimum reason length, imported rather than redeclared. See the comment
// on the re-export further down for why the number lives in the pure module.
import { MIN_TERMINATION_NOTE_CHARS } from "./wage-order-lifecycle-core";

import {
  validateWageOrderDraft,
  type EmployeeChoice,
  type ValidatedWageOrder,
  type WageOrderDraft,
  type WageOrderRefusal,
} from "./wage-order-entry-core";

/* ══════════════════════════════════════════════════════════════════════════
 * §1  RESULT SHAPES
 *
 * Every failure comes back as a value with a sentence on it. Nothing throws.
 *
 * A thrown error in a server action renders Next's error boundary: a blank
 * screen where the guidance used to be. Michael's standing complaint about
 * Sage is being stopped without being told why, so failing into silence is
 * the one behaviour this must never have.
 * ══════════════════════════════════════════════════════════════════════════ */

export type WageOrderWriteFailure = {
  readonly ok: false;
  readonly code: "NOT_CONFIGURED" | "READ_FAILED" | "WRITE_FAILED" | "NOT_FOUND" | "REFUSED";
  readonly message: string;
  /**
   * Field-level refusals from the pure validator, so the form can put each
   * sentence beside the box it belongs to instead of dumping them all at the
   * top where nobody reads them.
   */
  readonly refusals?: readonly WageOrderRefusal[];
};

export type WageOrderWriteSuccess = {
  readonly ok: true;
  readonly orderId: string;
  readonly message: string;
  /**
   * Things worth saying that are not reasons to stop. Kept separate from
   * refusals on purpose: mixing "we did not do this" with "we did this, and
   * here is something to watch" teaches people to skim both.
   */
  readonly warnings: readonly string[];
};

export type WageOrderWriteResult = WageOrderWriteSuccess | WageOrderWriteFailure;

const NOT_CONFIGURED =
  "Supabase is not configured in this environment, so the order could not be saved. Nothing " +
  "was written. This is a deployment problem rather than a problem with what you typed - the " +
  "order is still valid and can be entered again once the connection is working. Do not throw " +
  "the paperwork away.";

/* ══════════════════════════════════════════════════════════════════════════
 * §2  TRANSLATING A CONSTRAINT VIOLATION INTO A SENTENCE
 *
 * Layer 3 (the database) can still refuse after layers 1 and 2 have passed.
 * That is not a bug — it is the design. It happens on a genuine race, and it
 * would happen on a defect in the validator, which is exactly when the last
 * line of defence matters most.
 *
 * When it happens, Postgres says something like:
 *
 *   duplicate key value violates unique constraint "wage_orders_one_live_per_case"
 *
 * Standing rule 64a: detection is not explanation. That string tells Michael
 * that something is broken and nothing about what to do. Worse, it tells him
 * the SYSTEM is broken when in fact the system just correctly prevented a
 * double withholding, which is the system working perfectly.
 *
 * Each constraint below is mapped to what actually went wrong and what to do
 * about it. The mapping is DERIVED from `WAGE_ORDER_CONSTRAINT_PARITY` in the
 * pure core, so a constraint added there without a sentence here is caught by
 * a test rather than discovered by Michael.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Constraint name -> what a human should do about it.
 *
 * Exported so the parity test can check it against the engine's list rather
 * than against a copy. A hand-kept copy in a test passes forever after
 * somebody adds a constraint and forgets the sentence (standing rule 50).
 */
export const CONSTRAINT_EXPLANATIONS: Readonly<Record<string, string>> = {
  wage_orders_one_live_per_case:
    "This employee already has an ACTIVE order with that case number, so nothing was saved. " +
    "That is the database refusing to let the same writ be entered twice - if it had gone " +
    "through, twice the money would have come out of their pay and they would find out when " +
    "their rent bounced. If the court amended the order, end the existing one first (with the " +
    "reason) and then enter the amended version. If somebody else entered it while you were " +
    "typing, reload the page and you will see it there.",

  wage_orders_states_one_measure:
    "An order withholds EITHER a fixed amount per pay period OR a percentage of disposable " +
    "earnings - never both, and never neither. Nothing was saved. Read the withholding " +
    "instructions again and enter whichever one the order actually states. If it genuinely " +
    "states both, that is a question for the issuing authority and not something to resolve " +
    "by picking one.",

  wage_orders_support_needs_family_answer:
    "A child support or spousal support order cannot be saved until it is recorded whether " +
    "this employee supports another spouse or dependent child. Nothing was saved. That answer " +
    "is the difference between a 50% ceiling and a 60% one, and there is no safe guess: " +
    "guessing high over-withholds from somebody's wages, guessing low under-withholds child " +
    "support and Greenway can be made to pay the shortfall personally.",

  wage_orders_dates_ordered:
    "The last day this order applies is earlier than the first day it applies, so nothing was " +
    "saved. Check both dates against the order. If the order has no end date - which is " +
    "normal for child support - leave the end date empty rather than putting a guess in it.",

  wage_orders_terminated_has_note:
    "An order cannot be ended without a written reason of at least a few words, so nothing " +
    "was changed. The reason is not paperwork for its own sake: if the court or the employee " +
    "later asks why withholding stopped in March, that sentence is the answer, and 'it was " +
    "ended' is not one.",

  wage_orders_served_after_ordered:
    "The date this order was DELIVERED to Greenway is earlier than the date the judge signed " +
    "it, so nothing was saved. A piece of paper cannot arrive before it exists. Almost always " +
    "this means the signature date was typed into the served box, or the year is wrong. " +
    "Both dates matter and they are different things: every deadline runs from the date of " +
    "service, not from the date of signature.",

  wage_orders_served_date_not_null:
    "The date this order was delivered to Greenway is required, and nothing was saved. Every " +
    "deadline in this area is measured from the date of SERVICE - the answer is due within " +
    "twenty days of it (RCW 26.18.110(1)) and a creditor writ expires sixty days after it " +
    "(RCW 6.27.350(1)). Without it, no deadline can be calculated at all.",
};

/**
 * Pull the constraint name out of a Postgres error message.
 *
 * PostgREST surfaces the underlying message, and the constraint name is inside
 * double quotes in every form Postgres emits for a check, unique or not-null
 * violation. Matching on the KNOWN names rather than on quotes generally means
 * an unfamiliar error is reported honestly as unfamiliar instead of being
 * mangled into a confident wrong explanation.
 */
export function explainConstraintViolation(dbMessage: string): string | null {
  for (const name of Object.keys(CONSTRAINT_EXPLANATIONS)) {
    if (dbMessage.includes(name)) return CONSTRAINT_EXPLANATIONS[name];
  }
  // A not-null violation names the COLUMN rather than a constraint.
  if (/null value in column "served_date"/i.test(dbMessage)) {
    return CONSTRAINT_EXPLANATIONS.wage_orders_served_date_not_null;
  }
  return null;
}

/**
 * Turn any database error into something worth reading.
 *
 * When the constraint is recognised, Michael gets the sentence. When it is
 * NOT, he gets the raw message plus an explicit statement that nothing was
 * saved and that this is a defect to report rather than to work around.
 *
 * The unrecognised branch deliberately does not apologise vaguely. "Something
 * went wrong" is the sentence that makes people try the same thing three more
 * times.
 */
function writeFailureFrom(dbMessage: string, verb: string): WageOrderWriteFailure {
  const explained = explainConstraintViolation(dbMessage);
  if (explained !== null) {
    return { ok: false, code: "REFUSED", message: explained };
  }
  return {
    ok: false,
    code: "WRITE_FAILED",
    message:
      `The order could not be ${verb} and NOTHING was saved: ${dbMessage}. This is not a ` +
      `message the system recognises, which means it is a defect rather than something you ` +
      `typed. Do not try to work around it - send this exact sentence to the developer.`,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * §3  THE DUPLICATE LIST
 *
 * Read fresh, immediately before the write, for the reason in the header.
 * ══════════════════════════════════════════════════════════════════════════ */

type CaseRow = { readonly case_number: string };

/**
 * Case numbers already ACTIVE for this employee.
 *
 * Scoped to the employee because `wage_orders_one_live_per_case` is scoped to
 * the employee. Two different employees can genuinely be subject to orders
 * bearing the same case number — a single support case covering two people at
 * the same employer is unusual but entirely legal — and refusing that would
 * block a real order for no reason.
 *
 * Only ACTIVE orders count, matching the partial unique index. A terminated
 * order for the same case is exactly what a re-issued or amended writ looks
 * like, and blocking it would make an amended order impossible to enter.
 */
export async function activeCaseNumbersFor(
  employeeId: string,
): Promise<{ ok: true; caseNumbers: readonly string[] } | WageOrderWriteFailure> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, code: "NOT_CONFIGURED", message: NOT_CONFIGURED };
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("wage_orders")
    .select("case_number")
    .eq("employee_id", employeeId)
    .eq("status", "active");

  if (error) {
    // NOT swallowed into an empty list. An empty list means "no duplicates",
    // which would let a duplicate straight through — a read failure silently
    // becoming permission to double-withhold (standing rule 39).
    return {
      ok: false,
      code: "READ_FAILED",
      message:
        `The existing orders for this employee could not be read, so the order was NOT saved: ` +
        `${error.message}. This matters more than it sounds: without that list there is no way ` +
        `to tell whether this order is already on file, and entering the same writ twice takes ` +
        `twice the money out of somebody's pay.`,
    };
  }

  const rows = (data ?? []) as unknown as CaseRow[];
  return { ok: true, caseNumbers: rows.map((r) => r.case_number) };
}

/* ══════════════════════════════════════════════════════════════════════════
 * §3b  THE EMPLOYEE PICKER
 * ══════════════════════════════════════════════════════════════════════════ */

// Re-exported, NOT redeclared. The definition lives in the pure entry core
// because the client form needs the same shape and cannot import this module
// (it is server-only). A second declaration here compiled fine and was exactly
// the drift standing rule 25 exists to prevent.
// (imported at the top of this file, alongside the validator)
export type { EmployeeChoice };

/**
 * Just enough about each employee to choose one. Nothing else.
 *
 * WHY THIS DOES NOT REUSE `payroll-onboarding-store.listEmployeeSetup()`
 *
 * That function is the right shape and the wrong data. It reads
 * `ssn_last_four` and joins W-4, I-9 and pay records, because the setup screen
 * needs to show what is missing. This screen needs a name and an id to put in
 * a dropdown.
 *
 * Reusing it would pull partial Social Security numbers into a component whose
 * job is entering court orders, for no reason at all. Standing rule 25 says
 * extend rather than duplicate, and this is the case the rule does not cover:
 * two callers wanting genuinely different data from the same table. The
 * columns are named explicitly rather than selected with `*` for the same
 * reason — naming them means an SSN cannot arrive here by accident, which is a
 * stronger guarantee than remembering not to display it.
 *
 * A read failure returns a FAILURE, not an empty list. An empty dropdown says
 * "this employer has no employees", which is a different and untrue statement,
 * and it would leave Michael staring at a form he cannot use with no idea why.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY INACTIVE EMPLOYEES ARE LISTED RATHER THAN FILTERED OUT
 * ───────────────────────────────────────────────────────────────────────────
 *
 * `employees.active` exists (migration 0037) and the obvious thing to write is
 * `.eq("active", true)`. That obvious thing is a legal defect, so it is worth
 * recording why it is absent before somebody adds it as a tidy-up.
 *
 * RCW 26.18.110(1), mirrored verbatim in `wage-order-entry-authorities.ts`,
 * requires the employer's sworn answer to state
 *
 *     "whether the obligor is employed by or receives earnings or other
 *      remuneration from the employer"
 *
 * The statute plainly contemplates the answer being NO. Service does not
 * depend on the person still working here - a support registry works from
 * records that lag, and an order naming somebody who left in March will land
 * in June. The duty to ANSWER attaches on service either way, and RCW
 * 6.27.200 lets a court enter judgment against GREENWAY for the whole
 * underlying debt if the writ goes unanswered.
 *
 * If this query filtered on `active`, the name on the paper would simply not
 * be in the dropdown. The most likely reading of that is "we have no such
 * employee, so this does not concern us" - which is the precise belief that
 * ends in a default judgment. Worse, there is a final-paycheck case: someone
 * marked inactive who still has earned, unpaid wages sitting in the next run.
 * Those wages ARE subject to the order.
 *
 * So every employee is listed, and the ones no longer employed are labelled as
 * such at the point of choosing. Michael can still see the name, still record
 * the order, and still answer the writ - and the label tells him the answer to
 * the "is this person employed" question is probably no. Showing him the fact
 * is strictly better than hiding the row and letting him infer the wrong thing
 * from an absence (standing rule 39: an empty result and a filtered result
 * look identical and mean opposite things).
 */
export async function listEmployeesForOrderEntry(): Promise<
  { ok: true; employees: readonly EmployeeChoice[] } | WageOrderWriteFailure
> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, code: "NOT_CONFIGURED", message: NOT_CONFIGURED };
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("employees")
    .select("id, full_name, active")
    // Currently-employed names sort first, because they are the overwhelming
    // majority of orders. This is ORDERING, not filtering - every former
    // employee is still in the list, further down.
    .order("active", { ascending: false })
    .order("full_name", { ascending: true });

  if (error) {
    return {
      ok: false,
      code: "READ_FAILED",
      message:
        `The list of employees could not be read, so there is nobody to attach an order to: ` +
        `${error.message}. This is a problem reading the records - it does NOT mean there are ` +
        `no employees. Nothing was changed. Note that the deadline to answer a court order runs ` +
        `regardless of whether this screen is working, so if one has been served, answer it on ` +
        `paper in the meantime.`,
    };
  }

  const rows = (data ?? []) as unknown as {
    id: string;
    full_name: string | null;
    active: boolean | null;
  }[];
  return {
    ok: true,
    employees: rows.map((r) => ({
      id: r.id,
      // A missing name is shown as such rather than hidden. An employee with no
      // name on file still has wages, and can still have an order against them.
      name: r.full_name ?? "(no name on file)",
      // A null `active` is treated as ACTIVE, not inactive. The column is
      // `not null default true` in migration 0037 so null should be
      // impossible, but if one ever appears the safe reading is "still
      // employed": that keeps the name unlabelled and makes Michael check the
      // paper, whereas guessing "former employee" would put a false statement
      // next to a name he is about to swear an answer about.
      active: r.active !== false,
    })),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * §4  CREATE
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Record a new wage order from what Michael typed off the judgement.
 *
 * @param draft         the raw form values, exactly as typed
 * @param createdByStaffId  taken from the SESSION by the calling action, never
 *        from the form. Who entered a garnishment is an audit fact; a name
 *        that arrives in the request body is not a fact, it is a text field.
 */
export async function createWageOrder(args: {
  readonly draft: WageOrderDraft;
  readonly createdByStaffId: string | null;
}): Promise<WageOrderWriteResult> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, code: "NOT_CONFIGURED", message: NOT_CONFIGURED };
  }

  /* ── Pass 1: validate WITHOUT the duplicate list ──────────────────────────
   *
   * Deliberate ordering. If the employee has not been chosen, or the case
   * number box is empty, there is nothing sensible to look duplicates up
   * against — and running the query first would produce either a pointless
   * round trip or a misleading "no duplicates found".
   *
   * Get the shape of the draft right first, then ask the database about it. */
  const firstPass = validateWageOrderDraft(args.draft, []);
  if (!firstPass.ok) {
    return {
      ok: false,
      code: "REFUSED",
      message:
        `The order was not saved, because ${firstPass.refusals.length} thing` +
        `${firstPass.refusals.length === 1 ? " needs" : "s need"} fixing first. Each one is ` +
        `shown beside the box it belongs to. Nothing was written, so no withholding has ` +
        `started and nothing has been half-recorded.`,
      refusals: firstPass.refusals,
    };
  }

  /* ── Pass 2: validate WITH the live duplicate list ───────────────────────── */
  const existing = await activeCaseNumbersFor(firstPass.order.employee_id);
  if (!existing.ok) return existing;

  const secondPass = validateWageOrderDraft(args.draft, existing.caseNumbers);
  if (!secondPass.ok) {
    return {
      ok: false,
      code: "REFUSED",
      message:
        "The order was not saved. Everything you typed is well-formed, but checking it against " +
        "the orders already on file turned something up - most often that this exact writ is " +
        "already active for this employee. Nothing was written.",
      refusals: secondPass.refusals,
    };
  }

  const row: ValidatedWageOrder = secondPass.order;

  const { data, error } = await admin_insert(row, args.createdByStaffId);
  if (error !== null) return writeFailureFrom(error, "saved");
  if (data === null) {
    return {
      ok: false,
      code: "WRITE_FAILED",
      message:
        "The order was submitted without error but the database returned no row, so there is " +
        "no way to confirm it was saved. Reload the garnishments page and check before " +
        "entering it again - entering it twice would double the withholding.",
    };
  }

  return {
    ok: true,
    orderId: data,
    message: successSentence(row),
    warnings: secondPass.warnings,
  };
}

/**
 * The insert itself, kept in one small function so the error handling above
 * reads as a single story rather than being interleaved with column names.
 *
 * Returns the new id, or the database's message. Never throws.
 */
async function admin_insert(
  row: ValidatedWageOrder,
  createdByStaffId: string | null,
): Promise<{ data: string | null; error: string | null }> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("wage_orders")
    .insert({
      employee_id: row.employee_id,
      order_kind: row.order_kind,
      case_number: row.case_number,
      issuing_authority: row.issuing_authority,
      order_date: row.order_date,
      served_date: row.served_date,
      payee_name: row.payee_name,
      payee_address: row.payee_address,
      remittance_instructions: row.remittance_instructions,
      amount_cents_per_period: row.amount_cents_per_period,
      percent_of_disposable_basis_points: row.percent_of_disposable_basis_points,
      arrears_cents: row.arrears_cents,
      // Tri-state, passed through UNTOUCHED. See the header: a null here must
      // stay a null, because the engine can only refuse if it receives one.
      arrears_over_twelve_weeks: row.arrears_over_twelve_weeks,
      supports_second_family: row.supports_second_family,
      priority: row.priority,
      effective_from: row.effective_from,
      effective_to: row.effective_to,
      // status is NOT set here. 0198 defaults it to 'active'. Writing it
      // explicitly would mean two places decide what a new order's status is,
      // and they would eventually disagree.
      notes: row.notes,
      created_by_staff_id: createdByStaffId,
    })
    .select("id")
    .maybeSingle();

  if (error) return { data: null, error: error.message };
  const id = (data as { id?: string } | null)?.id ?? null;
  return { data: id, error: null };
}

/**
 * What Michael reads after a successful save.
 *
 * It restates the measure and the case number rather than saying "Saved."
 * That is deliberate: this is the moment a transposed digit is still cheap to
 * catch, and the only way he can catch it is if the system says back what it
 * heard. A bare "Saved" gives him nothing to check against the paper still in
 * his hand.
 */
function successSentence(row: ValidatedWageOrder): string {
  const measure =
    row.amount_cents_per_period !== null
      ? `$${(row.amount_cents_per_period / 100).toFixed(2)} per pay period`
      : `${((row.percent_of_disposable_basis_points ?? 0) / 100).toFixed(2)}% of disposable earnings`;

  return (
    `Saved. Case ${row.case_number} from ${row.issuing_authority}, withholding ${measure}, ` +
    `starting ${row.effective_from}. Please check that against the paper in front of you now, ` +
    `while it is still cheap to fix - especially the case number and the amount. It will show ` +
    `on the garnishments page and will be applied on the next payroll run on or after ` +
    `${row.effective_from}.`
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * §5  SUSPEND, RESUME, TERMINATE
 *
 * Three state changes, and NO delete. See the header.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * The shortest reason that is actually a reason. Mirrors 0198's `>= 5`.
 *
 * RE-EXPORTED, NOT REDECLARED (books-40b). The number now lives in
 * `wage-order-lifecycle-core.ts` because the browser needs it too - the End
 * button checks the reason before sending anything - and this file begins with
 * `import "server-only"`, so a client component cannot import from here without
 * breaking the bundle. The dependency therefore points from this node-only
 * module to the pure one, never the reverse.
 *
 * It stays exported from this path so existing callers and
 * `tests/compliance/wage-order-write-store.test.ts` keep working, and so there
 * is still exactly one number.
 */
export { MIN_TERMINATION_NOTE_CHARS } from "./wage-order-lifecycle-core";

/**
 * Stop withholding under an order permanently, with the reason on the record.
 *
 * The reason is mandatory in the database AND checked here, and the two checks
 * exist for different audiences. The database check is the guarantee. This one
 * is the explanation — without it Michael would get a constraint name, which
 * would tell him nothing about why a note is required.
 */
export async function terminateWageOrder(args: {
  readonly orderId: string;
  readonly reason: string;
}): Promise<WageOrderWriteResult> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, code: "NOT_CONFIGURED", message: NOT_CONFIGURED };
  }

  const reason = args.reason.trim();
  if (reason.length < MIN_TERMINATION_NOTE_CHARS) {
    return {
      ok: false,
      code: "REFUSED",
      message:
        "Ending an order needs a written reason, and nothing was changed. Write what actually " +
        "happened - 'released by the registry 2026-04-02', 'balance paid in full', 'employee " +
        "terminated' - because if the court or the employee later asks why withholding stopped, " +
        "this sentence is the entire answer. Withholding continues in the meantime, which is " +
        "the safe direction to fail in: money withheld under a released order can be returned, " +
        "money not withheld under a live one can land on Greenway.",
    };
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("wage_orders")
    .update({ status: "terminated", termination_note: reason })
    .eq("id", args.orderId)
    // Guarded on the CURRENT status, not just the id. Two people ending the
    // same order in two tabs would otherwise both report success while one of
    // them overwrote the other's reason - and the reason is the entire point.
    .in("status", ["active", "suspended"])
    .select("id, case_number")
    .maybeSingle();

  if (error) return writeFailureFrom(error.message, "ended");
  if (data === null) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message:
        "That order was not found as an order that could be ended, so nothing was changed. " +
        "Most likely it has already been ended - possibly by somebody else while this page was " +
        "open. Reload the garnishments page to see its current state before doing anything " +
        "else.",
    };
  }

  const row = data as unknown as { id: string; case_number: string };
  return {
    ok: true,
    orderId: row.id,
    message:
      `Case ${row.case_number} has been ended and your reason is on the record against it. No ` +
      `further withholding will be calculated for it. The order and everything withheld under ` +
      `it stay on file - that history is what answers the question if anybody asks later. If ` +
      `money was withheld but not yet sent to the payee, it still has to be sent: ending the ` +
      `order stops future withholding, it does not cancel what was already taken.`,
    warnings: [],
  };
}

/**
 * Pause withholding without ending the order.
 *
 * The honest use for this is narrow, and stating it matters more than the code
 * does. Suspension is for when withholding should not happen right now but the
 * order is still live — an employee on unpaid leave, or an order the issuing
 * authority has told you to hold.
 *
 * It is NOT the thing to reach for when an order has been released. That is a
 * termination, and it requires a reason, and the reason is what protects
 * Greenway. Suspension is deliberately the weaker tool.
 */
export async function suspendWageOrder(args: {
  readonly orderId: string;
  readonly note: string | null;
}): Promise<WageOrderWriteResult> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, code: "NOT_CONFIGURED", message: NOT_CONFIGURED };
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("wage_orders")
    .update({ status: "suspended", notes: args.note?.trim() || null })
    .eq("id", args.orderId)
    .eq("status", "active")
    .select("id, case_number")
    .maybeSingle();

  if (error) return writeFailureFrom(error.message, "paused");
  if (data === null) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message:
        "That order was not found as an ACTIVE order, so nothing was changed. It may already " +
        "be paused, or it may have been ended. Reload the garnishments page to see where it " +
        "stands.",
    };
  }

  const row = data as unknown as { id: string; case_number: string };
  return {
    ok: true,
    orderId: row.id,
    message:
      `Case ${row.case_number} is paused. No withholding will be calculated for it until it is ` +
      `resumed. Be careful with this one: a support order that is paused when it should not be ` +
      `is an under-withholding that Greenway can be made to pay for personally, and a paused ` +
      `order is easy to forget because it stops appearing on the active board. If the order ` +
      `has actually been released, END it with the reason instead of pausing it.`,
    warnings: [
      "A paused order does not appear on the active garnishments board. Set yourself a " +
        "reminder for the date you expect to resume it.",
    ],
  };
}

/**
 * Put a paused order back into effect.
 *
 * Note what this does NOT do: it does not go back and withhold for the periods
 * that were missed while it was paused. Catching up on missed withholding is a
 * decision with legal consequences for the employee's take-home pay, and it is
 * not something a Resume button should make silently. If catch-up is owed, it
 * comes from the issuing authority in writing.
 */
export async function resumeWageOrder(args: {
  readonly orderId: string;
}): Promise<WageOrderWriteResult> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, code: "NOT_CONFIGURED", message: NOT_CONFIGURED };
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("wage_orders")
    .update({ status: "active" })
    .eq("id", args.orderId)
    .eq("status", "suspended")
    .select("id, case_number")
    .maybeSingle();

  if (error) return writeFailureFrom(error.message, "resumed");
  if (data === null) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message:
        "That order was not found as a PAUSED order, so nothing was changed. Only a paused " +
        "order can be resumed - an order that was ENDED cannot be, deliberately, because " +
        "restarting withholding under an order that was released is taking money the payee is " +
        "no longer entitled to. If withholding needs to start again, enter the new order.",
    };
  }

  const row = data as unknown as { id: string; case_number: string };
  return {
    ok: true,
    orderId: row.id,
    message:
      `Case ${row.case_number} is active again and will be included in the next payroll run. ` +
      `Nothing has been withheld for the periods it was paused, and this has NOT gone back to ` +
      `catch them up. If the issuing authority wants the missed amounts collected, they have ` +
      `to say so in writing and it is entered as arrears - it is not something to decide here.`,
    warnings: [],
  };
}
