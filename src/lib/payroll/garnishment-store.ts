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

import {
  computeAllOrders,
  type GarnishmentRefusal,
  type MinimumWageFacts,
  type MultiOrderResult,
  type PaycheckFacts,
  type WageOrder,
  type WageOrderKind,
} from "./garnishment-core";

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

type WageOrderRow = {
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
};

export type GarnishmentBoard = {
  readonly ok: true;
  readonly orders: readonly WageOrderDetail[];
  readonly activeCount: number;
  /** Orders that cannot be computed until somebody answers a question. */
  readonly blockedCount: number;
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

function toWageOrder(row: WageOrderRow): WageOrder | null {
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
 * Every ACTIVE wage order, with the employee's name attached.
 *
 * Suspended and terminated orders are excluded deliberately. A terminated order
 * that still appeared on a live board would eventually be withheld against, and
 * withholding on a released order is a conversion of the employee's wages -
 * a worse error than failing to withhold, because the money has already gone to
 * somebody who is not entitled to it.
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
        "supports_second_family, priority, effective_from, effective_to, status, notes",
    )
    .eq("status", "active")
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
      missingFacts: missingFactsFor(row),
    });
  }

  // The worked example runs ONLY when a pay period was supplied. Inventing a
  // gross figure to make the screen look populated would produce a number that
  // looks like a withholding instruction and is not one.
  let worked: WorkedExample | null = null;
  if (args?.pay && args?.wages) {
    const computable = details.filter((d) => d.missingFacts.length === 0).map((d) => d.order);
    const res = computeAllOrders({ orders: computable, pay: args.pay, wages: args.wages });
    worked = res.ok ? { ok: true, result: res.value } : { ok: false, refusals: res.refusals };
  }

  return {
    ok: true,
    orders: details,
    activeCount: details.length,
    blockedCount: details.filter((d) => d.missingFacts.length > 0).length,
    worked,
  };
}
