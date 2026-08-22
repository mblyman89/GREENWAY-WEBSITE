"use server";

/**
 * src/app/admin/books/timesheets/actions.ts   (slice books-32)
 *
 * SERVER ACTIONS for the timesheet screen. There are exactly two, and only one
 * of them writes anything.
 *
 * WHY THE GATE IS RE-CHECKED HERE
 *
 * `timesheet-store.ts` uses the service role, which ignores the owner-only RLS
 * policies migration 0197 puts on `pay_periods`. The database gate is therefore
 * INERT on this path, and `requireBooksAccess()` is the whole protection. A
 * server action is a public HTTP endpoint - it is reachable by anybody who can
 * guess it, with or without ever loading the page - so the gate is called FIRST,
 * before anything is read or written, in both functions. Not once, in the page.
 *
 * WHY THE COMPUTE ACTION WRITES NOTHING (standing rule 63c)
 *
 * Computing hours and approving them are two different acts by two different
 * authorities. The engine proposes; Michael disposes. `computeTimesheetAction`
 * reads punches and returns numbers, and there is no code path from it to an
 * UPDATE. That separation is the reason an arithmetic mistake in this system
 * produces a wrong number ON A SCREEN, where it can be seen and argued with,
 * rather than a wrong number in a filed return.
 *
 * WHY ERRORS ARE RETURNED RATHER THAN THROWN
 *
 * A thrown error renders an error boundary - a blank screen where the guidance
 * used to be. Michael's whole complaint about Sage was being stopped without
 * being told anything, so failing into silence is the one thing these functions
 * must never do. Every failure comes back as a sentence he can read and act on.
 *
 * WHO IS ALLOWED TO APPROVE
 *
 * `requireBooksAccess()` returns the signed-in session, and the approving
 * staff id is taken FROM THAT SESSION - never from the form. An approval whose
 * name comes from the request body is not an approval, it is a text field.
 */

import { revalidatePath } from "next/cache";

import { requireBooksAccess } from "@/lib/accounting/books-access";
import {
  approvePayPeriod,
  computeTimesheetForPeriod,
  type TimesheetComputation,
} from "@/lib/payroll/timesheet-store";

const SCREEN = "/admin/books/timesheets";

export type TimesheetActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/**
 * Recompute the hours for one pay period and show them.
 *
 * READ ONLY. This exists so Michael can look at the numbers, find the punch
 * that is wrong, fix it on the time-clock screen, and look again - as many
 * times as he likes - before anything is committed to.
 */
export async function computeTimesheetAction(
  periodId: string,
): Promise<
  { ok: true; computation: TimesheetComputation } | { ok: false; message: string }
> {
  await requireBooksAccess();

  if (!periodId) {
    return {
      ok: false,
      message:
        "No pay period was selected, so there is nothing to add up. Choose a period from the list " +
        "above and try again. Nothing was changed.",
    };
  }

  const res = await computeTimesheetForPeriod(periodId);
  if (!res.ok) {
    return { ok: false, message: res.message };
  }
  return { ok: true, computation: res };
}

/**
 * Approve a pay period's hours.
 *
 * THE ONE WRITE ON THIS SCREEN, and the point of standing rule 63c: the
 * automation goes all the way up to the edge and then stops for a human.
 *
 * The refusal to approve a period that still has punch problems is enforced
 * HERE and not only in the button's `disabled` attribute, because a disabled
 * button is a suggestion. The engine is asked again, at the moment of the
 * write, whether the numbers hold up - so a punch that was fixed, or broken,
 * in another tab since the page rendered cannot slip through.
 */
export async function approvePayPeriodAction(
  periodId: string,
): Promise<TimesheetActionResult> {
  const session = await requireBooksAccess();

  if (!periodId) {
    return {
      ok: false,
      message:
        "No pay period was selected, so there was nothing to approve. Nothing was changed.",
    };
  }

  // Re-run the engine at the moment of the write. The screen's numbers may be
  // minutes old, and approving hours nobody has just verified is how a bad
  // punch becomes a paycheck.
  const computed = await computeTimesheetForPeriod(periodId);
  if (!computed.ok) {
    return {
      ok: false,
      message: `The hours could not be re-checked, so nothing was approved. ${computed.message}`,
    };
  }

  if (computed.refusedCount > 0) {
    const who = computed.sheets
      .filter((s) => s.refusals.length > 0)
      .map((s) => s.employee.fullName)
      .join(", ");
    return {
      ok: false,
      message:
        `${computed.refusedCount} ${
          computed.refusedCount === 1 ? "employee" : "employees"
        } (${who}) still have time-clock problems the system will not guess its way past, so this ` +
        "period was not approved and nothing was changed. Each problem is listed on this screen with " +
        "what to do about it. Fix them on the time-clock screen, recompute here, and then approve.",
    };
  }

  const res = await approvePayPeriod(periodId, session.profile.id);
  if (!res.ok) {
    return { ok: false, message: res.message };
  }

  revalidatePath(SCREEN);
  return {
    ok: true,
    message:
      `The hours for "${res.period.label}" are approved, with your name and the time recorded ` +
      "against them. The pay run for this period can now be built from these hours instead of " +
      "from a number typed by hand.",
  };
}
