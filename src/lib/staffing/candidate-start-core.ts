/**
 * Phase 0.3 (G-52, F-08-1) - new hires start as Candidate; PIN locked until Active.
 *
 * Owner basis: the roster help text already promised it ("Add them below as a
 * CANDIDATE", employees/page.tsx) and RCW 69.50.357(2)-(3): nobody under 21 and
 * nobody untrained may work the floor. Activate is the only door onto the floor,
 * and it runs activationBlockers (employee-lifecycle-store.ts). Since G-59 / D74
 * only an owner or admin may click it ("I would like to modify this to be owner
 * admin only. No manager access.").
 *
 * Pure: no I/O, so the rule is testable without a database.
 */

/** What every new employee row is created with (roster and Payroll Setup). */
export const NEW_HIRE_START = { employment_status: "candidate", active: false } as const;

export const PIN_LOCKED_MESSAGE =
  "A clock PIN can only be set once this person is Active. An owner or admin activates them after the required steps (21+, background check, training) are done.";

/** A clock PIN may exist only for an Active employee. */
export function pinAllowedForStatus(employmentStatus: string | null, active: boolean): boolean {
  if (employmentStatus === null) return active; // pre-0117 legacy rows
  return employmentStatus === "active" && active;
}

export function __runCandidateStartCoreTests(): number {
  let n = 0;
  const t = (ok: boolean, label: string) => {
    if (!ok) throw new Error(`candidate-start-core: ${label}`);
    n++;
  };
  t(NEW_HIRE_START.employment_status === "candidate", "starts as candidate");
  t(NEW_HIRE_START.active === false, "starts inactive");
  t(pinAllowedForStatus("active", true), "active may have a PIN");
  t(!pinAllowedForStatus("candidate", false), "candidate may not");
  t(!pinAllowedForStatus("onboarding", false), "onboarding may not");
  t(!pinAllowedForStatus("terminated", false), "terminated may not");
  t(!pinAllowedForStatus("active", false), "inconsistent row refused");
  t(!pinAllowedForStatus(null, false), "legacy inactive refused");
  t(pinAllowedForStatus(null, true), "legacy active allowed");
  return n;
}
