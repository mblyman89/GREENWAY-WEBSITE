/**
 * wage-order-watch-store.ts   (books-40c)
 *
 * THE ONE DATABASE READ THE NIGHTLY WATCHMAN NEEDS.
 *
 * wage-order-watch-core.ts is pure: it can judge a wage order's deadlines but
 * it cannot fetch one. loadGarnishmentBoard() can fetch them, but it also
 * joins employees, converts every row into the withholding engine's shapes,
 * and optionally runs a worked withholding example. That is exactly right for
 * a screen somebody is looking at and far more than a 4 a.m. cron should be
 * doing to answer one question: is anything overdue?
 *
 * So this module does the narrow read. Same columns, same meaning, no
 * arithmetic - the arithmetic lives in the pure core, and BOTH the board and
 * this snapshot feed that same core. There is one implementation of "is this
 * answer overdue" in the codebase, and there must stay one, because a board
 * that says fine while the email says overdue destroys trust in both.
 *
 * WHY IT NEVER THROWS
 * -------------------
 * This feeds a cron that also sends the CCRS and LIQ-1295 reminders. Standing
 * rule 48 says throw rather than return a boolean - but that rule is about
 * refusing to let a CALLER mistake failure for success, and here the caller is
 * an unattended scheduler whose other jobs must survive. The engine already
 * wraps every planner in its own try/catch for exactly this reason, and this
 * function degrades the same way the POS snapshot beside it does: it returns
 * an empty list, and the engine records a note.
 *
 * An empty list means "no reminders planned", never "everything is fine". The
 * difference is visible in the run notes the cron returns, which is where a
 * silent failure would otherwise hide.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

import type { WageOrderKind } from "./garnishment-core";
import type { WageOrderWatchFacts } from "./wage-order-watch-core";

/**
 * The order kinds the watchman understands.
 *
 * Mirrors the CHECK constraint in migration 0198. Declared here rather than
 * imported as a cast so that a kind added by a future migration and not taught
 * to this code becomes a row we can SEE we did not understand, instead of a
 * string quietly asserted into a union it does not belong to.
 */
const KNOWN_KINDS: readonly WageOrderKind[] = [
  "child_support",
  "spousal_support",
  "creditor",
  "consumer_debt",
  "student_loan",
  "federal_tax_levy",
  "state_tax_levy",
];

type Row = {
  readonly id: string;
  readonly employee_id: string;
  readonly case_number: string;
  readonly order_kind: string;
  readonly served_date: string | null;
  readonly effective_from: string | null;
  readonly status: string;
  readonly answer_filed_at: string | null;
  readonly answer_not_required: boolean | null;
};

export type WageOrderWatchSnapshot = {
  /** Live orders, ready for assessWageOrder(). Empty when nothing is live. */
  readonly orders: readonly WageOrderWatchFacts[];
  /**
   * Rows that could not be interpreted, named rather than dropped.
   *
   * A wage order the code does not recognise is not a curiosity; it is a
   * legal obligation nobody is watching. Silently filtering it out would mean
   * the one order most likely to be mishandled is also the one order the
   * watchman never mentions.
   */
  readonly unreadable: readonly string[];
};

const EMPTY: WageOrderWatchSnapshot = { orders: [], unreadable: [] };

/**
 * Read every live wage order in the shape the watchman consumes.
 *
 * Terminated orders are excluded in the query rather than in code: they have
 * no future deadline and there can be a lot of them over time, so there is no
 * reason to pull them across the wire every night.
 */
export async function loadWageOrderWatchSnapshot(): Promise<WageOrderWatchSnapshot> {
  if (!isSupabaseServiceConfigured) return EMPTY;

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("wage_orders")
      .select(
        "id, employee_id, case_number, order_kind, served_date, effective_from, " +
          "status, answer_filed_at, answer_not_required",
      )
      .in("status", ["active", "suspended"])
      .order("served_date", { ascending: true, nullsFirst: true });

    if (error) return EMPTY;

    const rows = (data ?? []) as unknown as Row[];
    if (rows.length === 0) return EMPTY;

    // One lookup for the names. The alerts carry a person's name because
    // "case CS-2027-001 is overdue" is a filing reference and "Dana Reyes is
    // overdue" is something Michael can act on without opening anything.
    const employeeIds = Array.from(new Set(rows.map((r) => r.employee_id)));
    const names = new Map<string, string>();
    if (employeeIds.length > 0) {
      const { data: emp } = await admin
        .from("employees")
        .select("id, full_name")
        .in("id", employeeIds);
      for (const e of (emp ?? []) as unknown as {
        id: string;
        full_name: string | null;
      }[]) {
        names.set(e.id, e.full_name ?? "(no name on file)");
      }
    }

    const orders: WageOrderWatchFacts[] = [];
    const unreadable: string[] = [];

    for (const r of rows) {
      const kind = KNOWN_KINDS.find((k) => k === r.order_kind);
      if (kind === undefined) {
        unreadable.push(
          `${r.case_number}: order kind "${r.order_kind}" is not one this system knows`,
        );
        continue;
      }
      if (r.status !== "active" && r.status !== "suspended") {
        unreadable.push(`${r.case_number}: status "${r.status}" is not one this system knows`);
        continue;
      }

      orders.push({
        id: r.id,
        caseNumber: r.case_number,
        employeeName: names.get(r.employee_id) ?? "(no name on file)",
        orderKind: kind,
        servedDate: r.served_date,
        effectiveFrom: r.effective_from,
        status: r.status,
        answerFiledAt: r.answer_filed_at,
        // `=== true` on purpose: a null from a row written before migration
        // 0202 must read as "not exempt" (keep watching), never be coerced
        // into "exempt" (go quiet). Defaulting the wrong way here would
        // switch the watchman off for exactly the oldest orders.
        answerNotRequired: r.answer_not_required === true,
      });
    }

    return { orders, unreadable };
  } catch {
    return EMPTY;
  }
}
