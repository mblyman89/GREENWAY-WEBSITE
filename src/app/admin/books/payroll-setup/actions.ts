/**
 * src/app/admin/books/payroll-setup/actions.ts   (slice books-25)
 *
 * SERVER ACTIONS for employee payroll setup. Three of them: one that CHECKS,
 * one that WRITES, and one that REVEALS a Social Security number.
 *
 * WHY A CHECK ACTION EXISTS AT ALL, WHEN THE FORM ALREADY CHECKS
 *
 * Michael asked for this by name:
 *
 *   "It should have a check list of task to be completed before it lets you
 *    save them to the system, and if a field is missing, it should highlight it
 *    so something can't silently fail me in some way."
 *
 * The checklist runs in the browser on every keystroke, because guidance that
 * arrives after you press Save is not guidance, it is a complaint. But a
 * browser-side checklist is ADVICE, NOT A PERMISSION SLIP. `saveSetupAction`
 * therefore re-runs the identical evaluation server-side and refuses on its own
 * authority. A client that skipped the checklist, or lied about what it said,
 * gets exactly the same answer.
 *
 * That is not paranoia about Michael. It is that there is only one definition
 * of "ready for payroll" in this system, it lives in the engine, and both
 * halves of this screen ask the same function. If the view layer could decide,
 * two screens could disagree about the same employee and whichever one he
 * happened to be looking at would become the truth.
 *
 * WHY NOTHING HERE RE-IMPLEMENTS A RULE
 *
 * These functions are wiring. Every judgement is `evaluateOnboarding()` in the
 * core or `saveEmployeePayrollSetup()` in the store. A second copy of a payroll
 * rule eventually disagrees with the first, silently, and the disagreement
 * surfaces on a 941 nine months later.
 *
 * WHY ERRORS ARE RETURNED RATHER THAN THROWN
 *
 * `saveSetupAction` returns a refusal as a value the screen can render next to
 * the field at fault. A thrown error would render an error boundary instead - a
 * blank red screen where the guidance used to be. Michael's whole complaint
 * about Sage is being stopped without being told anything, so failing into
 * silence is the one thing this file must never do.
 *
 * WHY THERE IS NO SEPARATE "CHECK" ACTION
 *
 * There was one, and it was deleted before it ever shipped, because nothing
 * called it. The screen already recomputes the checklist locally from the same
 * engine on every keystroke, which is what makes the guidance arrive as you
 * type instead of after you press Save. A server round-trip returning that
 * identical verdict would have been a second door into the same judgement,
 * kept alive only by its own tests - and a second door is exactly how two
 * screens start disagreeing about one employee.
 *
 * THE GATE
 *
 * Every action calls `requireBooksAccess()` FIRST, before it looks at its own
 * arguments. `is_owner()` in application form. The reveal path is additionally
 * gated inside the store on the session's real role, because the service-role
 * client used for the write ignores the column privilege that stops everyone
 * else - so for that one path the application check is the only check there is.
 */

"use server";

import { revalidatePath } from "next/cache";

import { requireBooksAccess } from "@/lib/accounting/books-access";
import {
  evaluateOnboarding,
  type OnboardingCandidate,
} from "@/lib/payroll/payroll-onboarding-core";
import {
  revealSsn,
  saveEmployeePayrollSetup,
  type RevealResult,
  type SaveResult,
} from "@/lib/payroll/payroll-onboarding-store";

/**
 * Save the W-4, the I-9 and the pay record, or refuse and say why.
 *
 * The store supersedes any current rows and inserts new ones, so a second save
 * for the same employee is a new version rather than an overwrite - the history
 * of what was on file, and when, survives.
 */
export async function saveSetupAction(input: {
  candidate: OnboardingCandidate;
  ssn?: string | null;
}): Promise<SaveResult> {
  await requireBooksAccess();

  // The server's own verdict, computed here and not taken from the client.
  // saveEmployeePayrollSetup() runs this again internally; that duplication is
  // deliberate and cheap, and it means this action cannot be the reason a bad
  // record gets through even if the store's contract changes underneath it.
  const evaluation = evaluateOnboarding(input.candidate);
  if (!evaluation.canSaveToPayroll) {
    return {
      ok: false,
      refusalCode: evaluation.refusalCode ?? "missing_required_steps",
      message:
        "This setup is not complete, so nothing was saved. The checklist on this " +
        "screen lists what is still outstanding, and the fields it names are " +
        "highlighted.",
      fields: evaluation.blockingProblems.map((p) => p.field),
      evaluation,
    };
  }

  const result = await saveEmployeePayrollSetup(input);

  if (result.ok) {
    // Two paths, because this employee now appears on both.
    revalidatePath("/admin/books/payroll-setup");
    revalidatePath("/admin/payroll");
  }

  return result;
}

/**
 * Show a full Social Security number, and record that it was shown.
 *
 * Michael's instruction was to store the SSN in full and mask it for everyone
 * but the owner, with a Sage-style reveal toggle. The difference from Sage is
 * the log: the store writes the audit row BEFORE it reads the number, so a
 * failed log means a failed reveal. A disclosure nobody can prove happened is
 * indistinguishable from one that did not.
 *
 * The role is resolved from the SESSION here, never accepted from the caller.
 * A client-supplied role would make the whole gate decorative.
 */
export async function revealSsnAction(input: {
  employeeId: string;
  reason: string;
}): Promise<RevealResult> {
  const session = await requireBooksAccess();

  return revealSsn({
    employeeId: input.employeeId,
    role: session.profile.role,
    actorId: session.userId,
    reason: input.reason,
  });
}
