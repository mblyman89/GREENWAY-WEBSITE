/**
 * Fix Phase 5 (plan rows 6.1/6.2; G-53 / G-54) - sign-in <-> employee link and
 * one-step offboarding. Owner, verbatim: D70 (Q-08-1) "yes, built right,
 * professionally and of enterprise grade standards."; D71 (Q-08-2) "yes.";
 * books-87 "I want to create the employee in payroll/ W-4 setup, then I will
 * give them access to the back office if they need access to it."
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  __runOffboardingCoreTests,
  linkVerdict,
  shiftsToDelete,
  offboardingTasksDone,
} from "@/lib/staffing/offboarding-core";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const ACTIONS = read("src/app/admin/staffing/employees/[id]/actions.ts");
const PAGE = read("src/app/admin/staffing/employees/[id]/page.tsx");
const USERS_PAGE = read("src/app/admin/users/page.tsx");
const DEACT = read("src/lib/auth/sign-in-deactivate.ts");

function fnBody(src: string, name: string): string {
  const at = src.indexOf(`function ${name}`);
  const next = src.indexOf("\nexport async function ", at + 10);
  const nextPriv = src.indexOf("\nasync function ", at + 10);
  const ends = [next, nextPriv].filter((n) => n > at);
  return src.slice(at, ends.length ? Math.min(...ends) : undefined);
}

describe("Phase 5 - pure core", () => {
  it("self-tests pass", () => {
    const r = __runOffboardingCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(49);
  });
  it("one sign-in per employee and the rank rule", () => {
    const emp = { id: "e1", fullName: "Jane Smith", status: "active" as const, staffId: null };
    const si = { id: "s1", email: "jane@x.com", fullName: "Jane Smith", role: "owner" as const, active: true };
    expect(linkVerdict({ actorRole: "admin", employee: emp, signIn: si, linkedElsewhere: null, confirmedSamePerson: true }).ok).toBe(false);
    expect(
      linkVerdict({
        actorRole: "owner",
        employee: emp,
        signIn: { ...si, role: "staff" },
        linkedElsewhere: { id: "e2", fullName: "Bob" },
        confirmedSamePerson: true,
      }).ok,
    ).toBe(false);
  });
  it("deletes only scheduled shifts after the last day, and ticks only what it did", () => {
    const p = shiftsToDelete(
      [
        { id: "a", business_day: "2026-11-02", status: "scheduled" },
        { id: "b", business_day: "2026-11-01", status: "scheduled" },
        { id: "c", business_day: "2026-11-03", status: "closed" },
      ],
      "2026-11-01",
    );
    expect(p.deleteIds).toEqual(["a"]);
    expect(
      offboardingTasksDone({
        signIn: { kind: "kept", email: "j@x.com" },
        shiftsDeleted: 0,
        shiftsKeptOnLastDay: 0,
        shiftsSkipped: 0,
        shiftError: null,
        openPunchSince: "2026-11-01T20:00:00Z",
      }),
    ).toEqual(["offboard.reason_recorded", "offboard.schedule_cleared"]);
  });
});

describe("Phase 5 - G-53 link actions", () => {
  it("link and unlink are owner/admin only on the server and audited before/after", () => {
    for (const name of ["linkSignInAction", "unlinkSignInAction"]) {
      const body = fnBody(ACTIONS, name);
      expect(body).toContain('requirePermission("staffing.lifecycle")');
      expect(body).toContain('can(session.profile.role, "users.manage")');
      expect(body).toMatch(/before: \{ staff_id/);
    }
    expect(fnBody(ACTIONS, "linkSignInAction")).toContain('"employee.login_linked"');
    expect(fnBody(ACTIONS, "linkSignInAction")).toContain('"employee.login_link.blocked"');
    expect(fnBody(ACTIONS, "unlinkSignInAction")).toContain('"employee.login_unlinked"');
  });
  it("the file shows the linked sign-in; Users shows the linked employee and Terminate link", () => {
    expect(PAGE).toContain("Back-office sign-in");
    expect(PAGE).toContain("<form action={linkSignInAction}");
    expect(PAGE).toContain('name="confirm_same_person"');
    expect(USERS_PAGE).toContain("linkedEmployeesBySignIn()");
    expect(USERS_PAGE).toContain("Terminate on their file");
  });
  it("migration 0324 is one unique partial index, checked for duplicates first, with a rollback", () => {
    const m = read("supabase/migrations/0324_employee_sign_in_link_unique.sql");
    expect(m).toContain("create unique index if not exists employees_staff_id_unique");
    expect(m).toContain("where staff_id is not null");
    expect(m).toContain("DUPLICATE_SIGN_IN_LINKS");
    expect(m).not.toMatch(/create table|insert into/i);
    expect(existsSync(join(root, "supabase/rollbacks/0324_employee_sign_in_link_unique.rollback.sql"))).toBe(true);
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toContain("## Fix 5 \u2014 0324 \u2014");
  });
});

describe("Phase 5 - G-54 one-step offboarding", () => {
  const T = fnBody(ACTIONS, "terminateWithOffboarding");
  it("validates before writing, deactivates the sign-in first, then terminates", () => {
    const v = T.indexOf("validateTermination(");
    const d = T.indexOf("deactivateSignIn(");
    const s = T.indexOf('setEmploymentStatus({ employeeId, to: "terminated"');
    expect(v).toBeGreaterThan(-1);
    expect(d).toBeGreaterThan(v);
    expect(s).toBeGreaterThan(d);
  });
  it("deletes shifts only when ticked, flags (never closes) an open punch, audits each step", () => {
    expect(T).toContain('formData.get("delete_shifts") === "on"');
    expect(T).toContain("openWorkPunch(employeeId)");
    expect(T).not.toMatch(/updatePunchTimes|clock_out_at/);
    for (const a of ['"shift.deleted_on_termination"', '"employee.offboarding_open_punch"', '"employee.status_terminated"']) {
      expect(T).toContain(a);
    }
    expect(T).toMatch(/before: \{ status: before\.status, staff_id: before\.staffId \}/);
  });
  it("the shared deactivation uses the Users-page guard rails and ban, and never touches employees", () => {
    expect(DEACT).toContain("guardActiveChange(");
    expect(DEACT).toContain("BAN_PERMANENT");
    expect(DEACT).toContain('"user.deactivate.blocked"');
    expect(DEACT).toMatch(/before: \{ active: true \}/);
    expect(DEACT).not.toContain('from("employees")');
  });
  it("the Terminate box offers the sign-in (default on) and the shifts, with a confirmation", () => {
    expect(PAGE).toMatch(/name="deactivate_sign_in" defaultChecked/);
    expect(PAGE).toMatch(/name="delete_shifts" defaultChecked/);
    expect(PAGE).toContain("<TerminateSubmitButton");
    expect(read("src/components/admin/staffing/TerminateSubmitButton.tsx")).toContain("window.confirm(");
  });
});
