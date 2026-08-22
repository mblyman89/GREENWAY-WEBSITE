"use server";

/**
 * src/app/admin/staffing/leave-actions.ts   (books-35 phase F)
 *
 * The server action behind the sick-leave request pad at the clock.
 *
 * WHY THIS IS A SEPARATE FILE FROM staffing/actions.ts
 *
 * Every export of a "use server" module is a public HTTP endpoint. Keeping the
 * one action that can create a sick-leave record in its own small file makes
 * the whole surface readable in a single screen, which is the only way anybody
 * ever actually audits it. staffing/actions.ts is nine hundred lines.
 *
 * AUTHENTICATION HERE IS A PIN, AND THAT IS DELIBERATE
 *
 * Migration 0198, verbatim:
 *
 *   "So the request goes in at the clock, under the station session, keyed by
 *    PIN. Reading and writing a REQUEST is open to an authenticated session.
 *    DECIDING one, and every entry in the LEDGER, and every WAGE ORDER, is
 *    owner-only."
 *
 * Most of Greenway's employees have no back-office login at all — 0037 makes
 * `employees.staff_id` nullable precisely for "floor-only staff who just clock
 * in at a shared station". Requiring a login to ask for a sick day would mean
 * the people RCW 49.46.210 is written to protect could not use the system, and
 * their requests would go back to travelling by text message.
 *
 * THE SAME THROTTLE AS THE CLOCK, AND WHY IT MATTERS MORE HERE
 *
 * `pinPadBlocked` / `notePinFailure` / `notePinSuccess` on the shared
 * TIMECLOCK_THROTTLE_SCOPE. Without it this endpoint would be an unthrottled
 * PIN oracle: an attacker could grind four-digit PINs against it and, worse
 * than clocking somebody in, learn WHICH PINs are valid. Reusing the existing
 * scope is deliberate (rule 25) so failures on either pad count toward the
 * same lockout and the two cannot be played off against each other.
 *
 * WHAT THIS ACTION REFUSES TO DECIDE
 *
 * Nothing about entitlement. It authenticates the person, hands the facts to
 * the store, and returns whatever comes back. Whether the leave may actually be
 * taken is Michael's decision in the inbox, with his name recorded against it —
 * WAC 296-128-630(1) gives the employee the right to ASK, and a machine that
 * silently declined would be an undocumented denial.
 */

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { getEmployeeByPin } from "@/lib/staffing/store";
import { isValidPin } from "@/lib/staffing/time";
import {
  pinPadBlocked,
  notePinFailure,
  notePinSuccess,
  TIMECLOCK_THROTTLE_SCOPE,
} from "@/lib/security/pin-throttle-store";
import { submitLeaveRequest } from "@/lib/payroll/sick-leave-store";

export type LeaveRequestResult = { ok: true; message: string } | { ok: false; message: string };

export async function submitSickLeaveRequestAction(input: {
  pin: string;
  leaveDate: string;
  minutes: number;
  purpose: string;
  noticeKind: string;
  employeeNote: string;
}): Promise<LeaveRequestResult> {
  // Any active staff session may reach the clock; the PIN identifies the
  // person. This is the same gate the clock-in action uses.
  await requirePermission("timeclock.use");

  const locked = await pinPadBlocked(TIMECLOCK_THROTTLE_SCOPE);
  if (locked) return { ok: false, message: locked };

  if (!isValidPin(input.pin)) {
    return { ok: false, message: "Enter a valid 4-6 digit PIN. Nothing was saved." };
  }

  const emp = await getEmployeeByPin(input.pin);
  if (!emp) {
    await notePinFailure(TIMECLOCK_THROTTLE_SCOPE);
    return {
      ok: false,
      message:
        "No active employee matches that PIN, so nothing was saved. Check the PIN and try " +
        "again, or ask Michael.",
    };
  }
  await notePinSuccess(TIMECLOCK_THROTTLE_SCOPE);

  const res = await submitLeaveRequest({
    // THE EMPLOYEE ID COMES FROM THE PIN LOOKUP, NEVER FROM THE FORM. If the
    // browser could name the employee, anybody at the station could file a
    // sick day in a colleague's name - and the colleague would be the one
    // marked absent.
    employeeId: emp.id,
    leaveDate: input.leaveDate,
    minutes: input.minutes,
    purpose: input.purpose,
    noticeKind: input.noticeKind,
    employeeNote: input.employeeNote,
  });

  if (!res.ok) {
    return { ok: false, message: res.message };
  }

  // AUDITED LIKE A CLOCK PUNCH. The whole reason this pad exists is that an
  // undocumented request is worth nothing when it is questioned later, so the
  // asking is logged as its own event, separately from the row it created.
  await recordAudit({
    actorId: emp.staff_id,
    actorEmail: emp.full_name,
    action: "sickleave.requested",
    entityType: "employee",
    entityId: emp.id,
  });

  // The approval inbox is now stale - there is a new row waiting in it.
  revalidatePath("/admin/books/leave");

  return { ok: true, message: res.message };
}
