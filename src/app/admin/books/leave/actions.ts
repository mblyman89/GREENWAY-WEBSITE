"use server";

/**
 * src/app/admin/books/leave/actions.ts   (books-35)
 *
 * SERVER ACTIONS for the sick-leave approval inbox. There is exactly ONE, and
 * it is the only thing in the application that can spend an employee's sick
 * leave balance.
 *
 * WHAT MICHAEL DECIDED, VERBATIM (standing rule 1)
 *
 *   "Thank you. I like option 1 as well. It should reach me in accounting
 *    somewhere logical."
 *
 * Option 1 was: a sick-leave request must be APPROVED BEFORE it appears on the
 * timesheet. Not entered, paid, and reversed later - approved first. This file
 * is the gate that decision describes.
 *
 * WHY THE GATE IS RE-CHECKED HERE
 *
 * `sick-leave-store.ts` uses the service role, which IGNORES the owner-only RLS
 * policies migration 0198 puts on `sick_leave_ledger` and on deciding a
 * request. The database gate is therefore INERT on this path, and
 * `requireBooksAccess()` is the entire protection. A server action is a public
 * HTTP endpoint - reachable by anybody who can guess it, with or without ever
 * loading the page - so the gate is called FIRST, before anything is read or
 * written. Not once, in the page.
 *
 * WHO IS RECORDED AS HAVING DECIDED
 *
 * `requireBooksAccess()` returns the signed-in session and the deciding staff
 * id is taken FROM THAT SESSION, never from the form. A decision whose name
 * comes from the request body is not a decision, it is a text field - and this
 * particular text field would be the defendant's own evidence in a retaliation
 * claim.
 *
 * WHY ERRORS ARE RETURNED RATHER THAN THROWN
 *
 * A thrown error renders an error boundary: a blank screen where the guidance
 * used to be. Michael's standing complaint about Sage was being stopped without
 * being told why, so failing into silence is the one thing this must never do.
 * Every failure comes back as a sentence he can read and act on.
 */

import { revalidatePath } from "next/cache";

import { requireBooksAccess } from "@/lib/accounting/books-access";
import { decideRequest, type StoreFailure } from "@/lib/payroll/sick-leave-store";
import type { SickLeaveRefusal } from "@/lib/payroll/sick-leave-core";

const SCREEN = "/admin/books/leave";

export type LeaveDecisionResult =
  | { ok: true; message: string }
  | { ok: false; message: string; refusals: readonly SickLeaveRefusal[] };

/**
 * Approve or deny ONE day of sick leave.
 *
 * ONE DAY, not one absence, and that is deliberate. Migration 0198 stores one
 * row per leave DAY precisely so a three-day absence can be approved for two
 * days and denied for the third. A single row for the whole absence could not
 * express that, and the alternative - all or nothing - is worse for everybody.
 *
 * THE ENGINE IS ASKED AGAIN INSIDE THE STORE, at the moment of the write. The
 * screen's verdict may be minutes old: a balance can have moved, a policy can
 * have been saved, another day of the same absence can have been approved in
 * another tab. A disabled button is a suggestion; the real gate runs where the
 * row is written (standing rule 63c - the automation stops for a human, and
 * then checks its own work).
 */
export async function decideLeaveRequestAction(input: {
  requestId: string;
  decision: "approve" | "deny";
  note: string | null;
}): Promise<LeaveDecisionResult> {
  const session = await requireBooksAccess();

  if (!input.requestId) {
    return {
      ok: false,
      message:
        "No leave request was identified, so there was nothing to decide. Reload the screen and " +
        "try again. Nothing was changed.",
      refusals: [],
    };
  }

  if (input.decision !== "approve" && input.decision !== "deny") {
    // Not reachable from the UI, which sends one of two literals. It is checked
    // anyway because this is a public endpoint and an unrecognised decision
    // must refuse rather than fall through to some default (rule 62d).
    return {
      ok: false,
      message:
        "That is not a decision this screen knows how to record, so nothing was changed. Use " +
        "Approve or Deny.",
      refusals: [],
    };
  }

  const res = await decideRequest({
    requestId: input.requestId,
    decision: input.decision,
    decidedByStaffId: session.profile.id,
    note: input.note,
  });

  if (!res.ok) {
    const failure = res as StoreFailure;
    return {
      ok: false,
      message: failure.message,
      refusals: failure.refusals ?? [],
    };
  }

  revalidatePath(SCREEN);
  // The timesheet reads APPROVED requests, so its page is stale the moment one
  // is approved. Revalidating it here is the whole of option 1 in one line:
  // approved leave reaches the timesheet because Michael said yes.
  revalidatePath("/admin/books/timesheets");

  return { ok: true, message: res.message };
}
