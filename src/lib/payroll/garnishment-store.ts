/**
 * src/lib/payroll/garnishment-store.ts   (books-36)
 *
 * READING WAGE ORDERS OUT OF THE DATABASE AND HANDING THEM TO THE ENGINE.
 *
 * WHY THIS FILE DID NOT EXIST UNTIL NOW, AND WHY THAT MATTERED
 *
 * books-33 built `garnishment-core.ts` (940 lines), `garnishment-authorities.ts`
 * (12 mirrored legal texts) and `garnishment-mentor.ts` (862 lines of teaching).
 * All three are thoroughly tested. None of them were reachable from a screen,
 * because nothing ever read a wage order out of the database. The engine had no
 * input, so the guidance had no output.
 *
 * Michael asked, in the message that opened books-36:
 *
 *   "in the summary report, will you check and confirm that the child support
 *    is included in the garnishments page. I will need it as well."
 *
 * The honest answer was: the child support ARITHMETIC is built and correct, and
 * there is no garnishments page for it to be included in. This file is the
 * missing half.
 *
 * THE DIVISION OF LABOUR, WHICH IS DELIBERATE
 *
 * This module does exactly two things: it reads rows, and it converts them into
 * the shapes `garnishment-core.ts` declares. It performs NO arithmetic. Not a
 * percentage, not a cap, not a comparison against a floor. Every number Michael
 * sees on the garnishments screen was computed by the engine, which is the only
 * module that has been mutation-tested against the statutes.
 *
 * If this file did its own sums they would eventually disagree with the
 * engine's - silently, on somebody's child support - and the disagreement would
 * surface as a family not being paid rather than as a stack trace.
 *
 * WHY A NULL IS PASSED THROUGH RATHER THAN DEFAULTED
 *
 * `supports_second_family` and `arrears_over_twelve_weeks` are nullable in
 * migration 0198 and they are read here as `boolean | null`, never coerced.
 * That is not laziness, it is the whole safety property. Those two answers are
 * the difference between withholding 50% and 65% of an employee's disposable
 * earnings. `garnishment-core.supportCap()` REFUSES when either is null, and it
 * can only refuse if this file resists the temptation to send `false`.
 *
 * A `false` here would look like a working system and quietly under-withhold
 * child support, which is the one error in this whole domain that lands on the
 * employer personally (RCW 26.23.090). Standing rule 62d: never invent a
 * default.
 */

import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pacificToday } from "@/lib/reports/timezone";

import {
  computeAllOrders,
  type GarnishmentRefusal,
  type MinimumWageFacts,
  type MultiOrderResult,
  type PaycheckFacts,
  type WageOrder,
  type WageOrderKind,
} from "./garnishment-core";
import {
  assessWageOrder,
  hasAnswerDuty,
  type WageOrderAlert,
  type WageOrderWatchFacts,
} from "./wage-order-watch-core";

const NOT_CONFIGURED =
  "Supabase is not configured in this environment, so no wage orders could be read. This is a " +
  "deployment problem, not a data problem - no orders have been lost, and nothing has been " +
  "withheld or not withheld as a result of it.";

export type GarnishmentStoreFailure = {
  readonly ok: false;
  readonly code: "NOT_CONFIGURED" | "READ_FAILED";
  readonly message: string;
};

/* ═══════════════════════════════════════════════════════════════════════════
 * ROW SHAPES — what the database actually returns
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Exported alongside `toWageOrder` so a caller can name the shape it passes in. */
export type WageOrderRow = {
  readonly id: string;
  readonly employee_id: string;
  readonly order_kind: string;
  readonly case_number: string;
  readonly issuing_authority: string;
  readonly order_date: string;
  readonly payee_name: string;
  readonly payee_address: string | null;
  readonly remittance_instructions: string | null;
  readonly amount_cents_per_period: number | string | null;
  readonly percent_of_disposable_basis_points: number | null;
  readonly arrears_cents: number | string | null;
  readonly arrears_over_twelve_weeks: boolean | null;
  readonly supports_second_family: boolean | null;
  readonly priority: number;
  readonly effective_from: string;
  readonly effective_to: string | null;
  readonly status: string;
  readonly notes: string | null;
  /**
   * books-38 (migration 0201). The date the order was SERVED on Greenway.
   *
   * Both statutory clocks are measured from this and from nothing else:
   * RCW 26.18.110(1) runs the twenty-day answer deadline from service, and
   * RCW 6.27.350(1) defines the effective date of a writ - the start of the
   * sixty-day continuing lien - as the date of service.
   *
   * Nullable on the way in even though 0201 tightens it, because a row written
   * before that migration can still be missing it, and the watchman must be
   * able to SAY that rather than measure from a date it invented.
   */
  readonly served_date: string | null;
  /** books-40c (migration 0202). The date the answer was filed, if it was. */
  readonly answer_filed_at: string | null;
  /** books-40c. True only for orders with genuinely no answer duty. */
  readonly answer_not_required: boolean | null;
};

type EmployeeRow = {
  readonly id: string;
  readonly full_name: string | null;
};

/**
 * Postgres `bigint` arrives over PostgREST as a STRING, because a bigint does
 * not fit in a JavaScript number safely. Reading it with `Number(...)` without
 * saying so is how a money column silently becomes a float.
 *
 * Cent amounts at Greenway's scale are far inside the safe integer range, so
 * the conversion is sound - but it is done in one named place, with this
 * comment, rather than scattered as bare `Number(x)` calls that a reader has to
 * individually convince themselves about.
 */
function bigintCentsToNumber(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * WHAT THE SCREEN GETS
 * ═══════════════════════════════════════════════════════════════════════════ */

/** One order, plus the human details the engine has no opinion about. */
export type WageOrderDetail = {
  readonly order: WageOrder;
  readonly employeeName: string;
  readonly issuingAuthority: string;
  readonly payeeName: string;
  readonly payeeAddress: string | null;
  readonly remittanceInstructions: string | null;
  readonly orderDate: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly status: string;
  readonly arrearsCents: number | null;
  readonly notes: string | null;
  /**
   * Facts the engine needs that nobody has recorded yet. Held per order so the
   * screen can say "this order cannot be calculated, and here is the one
   * question that would fix it" instead of a general apology.
   */
  readonly missingFacts: readonly string[];
  /**
   * books-40c. Everything the watchman needs to judge this order's deadlines,
   * in the shape wage-order-watch-core consumes.
   *
   * Carried on the detail rather than recomputed by the screen so that the
   * board and the nightly reminder cron are looking at IDENTICAL facts. Two
   * surfaces deriving "is this overdue" separately is how they end up
   * disagreeing, and a board that says fine while the email says overdue is
   * worse than either one alone.
   */
  readonly watch: WageOrderWatchFacts;
};

export type GarnishmentBoard = {
  readonly ok: true;
  /** Live orders - active and paused. Terminated orders are never listed. */
  readonly orders: readonly WageOrderDetail[];
  /**
   * Orders that will withhold on the next pay run. Paused orders are NOT
   * counted here; they are counted in `pausedCount`, because an order that has
   * quietly stopped taking money must never hide inside a number that reads as
   * "everything is running".
   */
  readonly activeCount: number;
  /**
   * Orders that are paused. Live obligations that are currently withholding
   * nothing, which is the state most easily forgotten and the one the employer
   * carries the exposure for.
   */
  readonly pausedCount: number;
  /**
   * ACTIVE orders that cannot be computed until somebody answers a question.
   * Scoped to the active ones so `activeCount - blockedCount` is a true
   * statement of how many are ready.
   */
  readonly blockedCount: number;
  /**
   * books-40c. Live orders that carry an answer duty and have not recorded one.
   *
   * Deliberately its own headline number rather than folded into blockedCount.
   * A blocked order cannot CALCULATE; an unanswered order calculates perfectly
   * and still exposes Greenway to liability for the entire support debt under
   * RCW 26.18.110(6)(b). They are different problems with different fixes, and
   * a single combined number would let the more expensive one hide inside the
   * more obvious one.
   */
  readonly answersOutstandingCount: number;
  /**
   * books-40c. Every alert the watchman raises across every live order today,
   * most severe first. Empty is the normal, healthy state.
   */
  readonly alerts: readonly WageOrderAlert[];
  /**
   * books-40c. The Pacific date every alert above was measured from.
   *
   * Handed to the screen rather than left implicit because the browser has its
   * own clock, and it is not necessarily this one. A laptop in another
   * timezone - or simply one left open past midnight - would otherwise check
   * "is this filing date in the future?" against a different day than the
   * server does, and Michael would get a refusal from the server that the form
   * had already told him was fine. One date, decided in one place, used by
   * both.
   */
  readonly asOf: string;
  /**
   * A worked example against the engine, or the engine's refusals. Present only
   * when a pay period has been supplied.
   */
  readonly worked: WorkedExample | null;
};

export type WorkedExample =
  | { readonly ok: true; readonly result: MultiOrderResult }
  | { readonly ok: false; readonly refusals: readonly GarnishmentRefusal[] };

/* ═══════════════════════════════════════════════════════════════════════════
 * CONVERSION
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The order kinds the ENGINE understands, listed here so an unrecognised value
 * from the database is caught rather than cast.
 *
 * 0198's CHECK constraint and `garnishment-core.WageOrderKind` have to agree,
 * and they are declared in two different languages in two different files. If
 * a future migration adds a sixth kind and the engine is not taught about it,
 * this list is what turns that into a visible refusal instead of a `default:`
 * branch computing something plausible.
 */
const ENGINE_ORDER_KINDS: readonly WageOrderKind[] = [
  "child_support",
  "spousal_support",
  "creditor",
  "federal_tax_levy",
  "state_tax_levy",
];

function isEngineOrderKind(v: string): v is WageOrderKind {
  return (ENGINE_ORDER_KINDS as readonly string[]).includes(v);
}

/**
 * Which unanswered questions stop THIS order from being computed.
 *
 * Support orders are the only kind where a missing boolean is fatal, because
 * they are the only kind whose ceiling depends on one. Saying so per-order lets
 * the screen put the question next to the order it belongs to.
 */
function missingFactsFor(row: WageOrderRow): readonly string[] {
  const out: string[] = [];
  if (row.order_kind === "child_support" || row.order_kind === "spousal_support") {
    if (row.supports_second_family === null) {
      out.push(
        "Whether this employee supports another spouse or dependent child. This is the " +
          "difference between a 50% ceiling and a 60% one.",
      );
    }
    if (row.arrears_over_twelve_weeks === null) {
      out.push(
        "Whether any arrears are more than twelve weeks old. If they are, the ceiling rises " +
          "by five percentage points.",
      );
    }
  }
  return out;
}

/**
 * A stored row, into the shape the garnishment engine consumes.
 *
 * EXPORTED in books-39, and the reason is worth a sentence. The pay run needs
 * each employee's active orders in exactly this shape. The alternative was a
 * second row->WageOrder converter living in the pay-run store, and two
 * converters means two answers to "how much is taken out of this cheque" -
 * which surface as the garnishments screen and the paycheque disagreeing about
 * somebody's child support. Standing rule 25: export and reuse.
 *
 * Note especially what this does NOT do: it passes `arrearsOverTwelveWeeks` and
 * `supportsSecondFamily` through as nulls when they are unknown. Those two
 * answers are the difference between a 50% and a 65% ceiling, and the engine
 * REFUSES when either is null. It can only refuse if this function resists
 * sending `false`.
 */
export function toWageOrder(row: WageOrderRow): WageOrder | null {
  if (!isEngineOrderKind(row.order_kind)) return null;
  return {
    id: row.id,
    employeeId: row.employee_id,
    orderKind: row.order_kind,
    caseNumber: row.case_number,
    amountCents: bigintCentsToNumber(row.amount_cents_per_period),
    percentOfDisposableBasisPoints: row.percent_of_disposable_basis_points,
    // Passed through UNTOUCHED. See the header: a null here must stay a null.
    arrearsOverTwelveWeeks: row.arrears_over_twelve_weeks,
    supportsSecondFamily: row.supports_second_family,
    priority: row.priority,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * THE READ
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Every wage order that is still LIVE - active or paused - with the employee's
 * name attached.
 *
 * TERMINATED ORDERS ARE EXCLUDED, DELIBERATELY AND PERMANENTLY. An ended order
 * that still appeared on a live board would eventually be withheld against, and
 * withholding on a released order is a conversion of the employee's wages - a
 * worse error than failing to withhold, because the money has already gone to
 * somebody who is not entitled to it. Excluded from the BOARD is not deleted:
 * the row stays in the database forever with the reason it ended on it.
 *
 * WHY SUSPENDED ORDERS ARE NOW INCLUDED, AND THE BUG THAT FOUND IT (books-40b)
 *
 * This read used to be `.eq("status", "active")`, which meant a paused order
 * was invisible to every screen in the application. That was survivable while
 * nothing could pause an order from the UI. It stopped being survivable the
 * moment this slice added a Resume button: a Resume button can only ever appear
 * on a paused order, so with an active-only read it would have been a control
 * no human being could reach - shipped, tested, green, and unusable. Standing
 * rule 50 in its most convincing disguise.
 *
 * A paused order is also the one most likely to be forgotten. It is a live
 * legal obligation that has quietly stopped taking money, and the employer
 * carries the exposure for that under RCW 26.18.110(6). Showing it is the whole
 * point; it is listed separately from the active ones so it can never be
 * mistaken for something that is currently withholding.
 *
 * `pausedCount` is reported separately from `activeCount` for the same reason.
 * Rolling the two together would let a paused support order hide inside a
 * headline number that reads as "everything is running".
 */
export async function loadGarnishmentBoard(args?: {
  readonly pay?: PaycheckFacts;
  readonly wages?: MinimumWageFacts;
}): Promise<GarnishmentBoard | GarnishmentStoreFailure> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, code: "NOT_CONFIGURED", message: NOT_CONFIGURED };
  }

  const admin = createSupabaseAdminClient();

  const { data: orderData, error: orderErr } = await admin
    .from("wage_orders")
    .select(
      "id, employee_id, order_kind, case_number, issuing_authority, order_date, payee_name, " +
        "payee_address, remittance_instructions, amount_cents_per_period, " +
        "percent_of_disposable_basis_points, arrears_cents, arrears_over_twelve_weeks, " +
        "supports_second_family, priority, effective_from, effective_to, status, notes, " +
        // books-40c. Without these three the board cannot evaluate either
        // statutory clock, which is exactly the state it was in before this
        // slice: the deadlines existed, were computed once on the entry form,
        // and were never looked at again (standing rule 50).
        "served_date, answer_filed_at, answer_not_required",
    )
    // Live orders only. 'terminated' is never read onto the board; see above.
    .in("status", ["active", "suspended"])
    .order("priority", { ascending: true });

  if (orderErr) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: `Could not read the wage orders: ${orderErr.message}`,
    };
  }

  const rows = (orderData ?? []) as unknown as WageOrderRow[];

  // One lookup for the names rather than one per order.
  const employeeIds = Array.from(new Set(rows.map((r) => r.employee_id)));
  const names = new Map<string, string>();
  if (employeeIds.length > 0) {
    const { data: empData, error: empErr } = await admin
      .from("employees")
      .select("id, full_name")
      .in("id", employeeIds);
    if (empErr) {
      return {
        ok: false,
        code: "READ_FAILED",
        message: `Could not read the employees these orders belong to: ${empErr.message}`,
      };
    }
    for (const e of (empData ?? []) as unknown as EmployeeRow[]) {
      names.set(e.id, e.full_name ?? "(no name on file)");
    }
  }

  /**
   * books-40c. Build the watchman's view of one row.
   *
   * Declared once and used at BOTH push sites below, including the one for an
   * order whose kind the engine does not recognise. That matters: an
   * unrecognised order kind is exactly the row most likely to be sitting there
   * unanswered, and dropping its deadline surveillance because the arithmetic
   * cannot run would silence the alarm on the riskiest order on the board.
   *
   * `answer_not_required` is read with `=== true` rather than a truthiness
   * test. The column is NOT NULL with a default of false in 0202, but a row
   * read before that migration lands returns null, and `null` must mean "not
   * exempt" (keep watching) rather than being coerced into "exempt" (go quiet).
   * Defaulting the wrong way here would silently switch the watchman off.
   */
  function watchFactsFor(row: WageOrderRow, kind: WageOrderKind): WageOrderWatchFacts {
    return {
      id: row.id,
      caseNumber: row.case_number,
      employeeName: names.get(row.employee_id) ?? "(no name on file)",
      orderKind: kind,
      servedDate: row.served_date,
      effectiveFrom: row.effective_from,
      status:
        row.status === "active" || row.status === "suspended" ? row.status : "terminated",
      answerFiledAt: row.answer_filed_at,
      answerNotRequired: row.answer_not_required === true,
    };
  }

  const details: WageOrderDetail[] = [];
  for (const row of rows) {
    const order = toWageOrder(row);
    if (order === null) {
      // An order kind the engine does not know is NOT skipped, because skipping
      // it would silently drop a legal obligation off the board. It is reported
      // as blocked, with the unrecognised value named.
      details.push({
        order: {
          id: row.id,
          employeeId: row.employee_id,
          orderKind: "creditor",
          caseNumber: row.case_number,
          amountCents: null,
          percentOfDisposableBasisPoints: null,
          arrearsOverTwelveWeeks: null,
          supportsSecondFamily: null,
          priority: row.priority,
        },
        employeeName: names.get(row.employee_id) ?? "(no name on file)",
        issuingAuthority: row.issuing_authority,
        payeeName: row.payee_name,
        payeeAddress: row.payee_address,
        remittanceInstructions: row.remittance_instructions,
        orderDate: row.order_date,
        effectiveFrom: row.effective_from,
        effectiveTo: row.effective_to,
        status: row.status,
        arrearsCents: bigintCentsToNumber(row.arrears_cents),
        notes: row.notes,
        // An unknown kind still gets watched. `creditor` is the placeholder the
        // block above already uses for the order shape; the watchman treats it
        // as a writ with an unknown answer deadline, which is the honest and
        // conservative reading of a row nobody can classify.
        watch: watchFactsFor(row, "creditor"),
        missingFacts: [
          `This order is recorded as "${row.order_kind}", which the calculator does not ` +
            `recognise. It has NOT been included in any total. Do not withhold against it ` +
            `until somebody has looked at it.`,
        ],
      });
      continue;
    }

    details.push({
      order,
      employeeName: names.get(row.employee_id) ?? "(no name on file)",
      issuingAuthority: row.issuing_authority,
      payeeName: row.payee_name,
      payeeAddress: row.payee_address,
      remittanceInstructions: row.remittance_instructions,
      orderDate: row.order_date,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      status: row.status,
      arrearsCents: bigintCentsToNumber(row.arrears_cents),
      notes: row.notes,
      watch: watchFactsFor(row, order.orderKind),
      missingFacts: missingFactsFor(row),
    });
  }

  // The worked example runs ONLY when a pay period was supplied. Inventing a
  // gross figure to make the screen look populated would produce a number that
  // looks like a withholding instruction and is not one.
  let worked: WorkedExample | null = null;
  if (args?.pay && args?.wages) {
    // ACTIVE ONLY, AND THIS LINE IS LOAD-BEARING (books-40b).
    //
    // The board began listing paused orders in this slice so that a Resume
    // button has something to attach to. That change made this filter
    // dangerous: without the status test, a PAUSED order would be handed to
    // the engine and would appear in a worked withholding total. Pausing means
    // "withhold nothing", so that would have been a computed instruction to
    // take money out of somebody's pay under an order that is explicitly not
    // running - and it would have looked completely normal on screen.
    //
    // Caught by the existing `blockedCount` test going red for an unrelated
    // reason, which is what those tests are for.
    const computable = details
      .filter((d) => d.status === "active" && d.missingFacts.length === 0)
      .map((d) => d.order);
    const res = computeAllOrders({ orders: computable, pay: args.pay, wages: args.wages });
    worked = res.ok ? { ok: true, result: res.value } : { ok: false, refusals: res.refusals };
  }

  // COUNTED SEPARATELY, ON PURPOSE (books-40b).
  //
  // `activeCount` means "orders that will actually withhold on the next pay
  // run". A paused order will not, so counting it as active would put a
  // reassuring number on screen over an order that has silently stopped taking
  // money - which is the exact failure a paused support order represents.
  //
  // `blockedCount` is scoped to the ACTIVE ones for the same reason: the header
  // renders `activeCount - blockedCount` as "ready to calculate", and that
  // subtraction is only true if both sides count the same population.
  const active = details.filter((d) => d.status === "active");

  // books-40c. The same Pacific day the nightly reminder cron uses, so the
  // board and the email cannot disagree about what "today" is. A board
  // computing UTC midnight while the cron computes Pacific would put them a
  // day apart for seven or eight hours every single day - and the disagreement
  // would show up on the last day of a deadline, which is the worst possible
  // day for the two surfaces to differ.
  const todayIso = pacificToday();
  const alerts: WageOrderAlert[] = [];
  for (const d of details) alerts.push(...assessWageOrder(d.watch, todayIso));

  return {
    ok: true,
    orders: details,
    activeCount: active.length,
    pausedCount: details.filter((d) => d.status === "suspended").length,
    blockedCount: active.filter((d) => d.missingFacts.length > 0).length,
    // Counts the DUTY, not the alert. An order served today is already
    // outstanding even though the watchman is deliberately quiet about it for
    // another ten days, and this number should say so: it is the size of the
    // to-do list, not the size of the shouting.
    answersOutstandingCount: details.filter(
      (d) =>
        d.watch.answerFiledAt === null &&
        !d.watch.answerNotRequired &&
        hasAnswerDuty(d.watch.orderKind),
    ).length,
    alerts,
    asOf: todayIso,
    worked,
  };
}
