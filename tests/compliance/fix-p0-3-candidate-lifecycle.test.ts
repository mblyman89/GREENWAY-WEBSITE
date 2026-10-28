/**
 * Phase 0.3 - G-52 (new hires start as Candidate; PIN locked until Active)
 * and G-59 (Activate / Terminate / Rehire are owner and admin only, D74:
 * "I would like to modify this to be owner admin only. No manager access.").
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { can, ALL_PERMISSIONS, PERMISSION_LABELS } from "@/lib/auth/roles";
import {
  NEW_HIRE_START,
  pinAllowedForStatus,
  __runCandidateStartCoreTests,
} from "@/lib/staffing/candidate-start-core";

const read = (p: string) => readFileSync(p, "utf8");
const ROSTER_ACTIONS = read("src/app/admin/staffing/actions.ts");
const FILE_ACTIONS = read("src/app/admin/staffing/employees/[id]/actions.ts");
const FILE_PAGE = read("src/app/admin/staffing/employees/[id]/page.tsx");
const ROSTER_PAGE = read("src/app/admin/staffing/employees/page.tsx");
const PAYROLL = read("src/lib/payroll/payroll-onboarding-store.ts");
const PIN_LOOKUP = read("src/lib/staffing/store.ts");

const fnBody = (src: string, name: string) => {
  const a = src.indexOf(`export async function ${name}`);
  const b = src.indexOf("export async function", a + 10);
  return src.slice(a, b === -1 ? undefined : b);
};

describe("G-59 · lifecycle is owner and admin only", () => {
  it("staffing.lifecycle is granted to owner and admin, never manager or below", () => {
    expect(can("owner", "staffing.lifecycle")).toBe(true);
    expect(can("admin", "staffing.lifecycle")).toBe(true);
    for (const r of ["manager", "content_editor", "staff", "readonly"] as const) {
      expect(can(r, "staffing.lifecycle")).toBe(false);
    }
    // managers keep the rest of the file
    expect(can("manager", "staffing.manage")).toBe(true);
  });

  it("is labelled and listed in the permission matrix", () => {
    expect(ALL_PERMISSIONS).toContain("staffing.lifecycle");
    expect(PERMISSION_LABELS["staffing.lifecycle"]).toMatch(/owner & admin/);
  });

  it("setStatusAction (every transition) requires staffing.lifecycle on the server", () => {
    const body = fnBody(FILE_ACTIONS, "setStatusAction");
    expect(body).toContain('requirePermission("staffing.lifecycle")');
    expect(body).not.toContain('requirePermission("staffing.manage")');
  });

  it("the file page hides every status button and the Terminate box for managers", () => {
    expect(FILE_PAGE).toContain('const canLifecycle = can(session.profile.role, "staffing.lifecycle")');
    expect((FILE_PAGE.match(/<form action=\{setStatusAction\}/g) ?? []).length).toBe(4);
    expect((FILE_PAGE.match(/&& canLifecycle && \(/g) ?? []).length).toBe(4);
    expect(FILE_PAGE).toContain("owner or admin only");
  });

  it("the legacy active checkbox can no longer flip someone on", () => {
    const body = fnBody(ROSTER_ACTIONS, "updateEmployeeAction");
    expect(body).not.toContain("update.active");
  });
});

describe("G-52 · new hires start as Candidate", () => {
  it("the pure core says candidate + inactive, PIN only for Active", () => {
    expect(NEW_HIRE_START).toEqual({ employment_status: "candidate", active: false });
    expect(pinAllowedForStatus("candidate", false)).toBe(false);
    expect(pinAllowedForStatus("onboarding", false)).toBe(false);
    expect(pinAllowedForStatus("active", true)).toBe(true);
    expect(__runCandidateStartCoreTests()).toBeGreaterThan(5);
  });

  it("Add to roster inserts a candidate with no PIN and active=false", () => {
    const body = fnBody(ROSTER_ACTIONS, "createEmployeeAction");
    expect(body).toContain('employment_status: "candidate"');
    expect(body).toContain("active: false");
    expect(body).toContain("clock_pin: null");
    expect(body).not.toContain("active: true");
    expect(body).not.toContain("hashPin(");
  });

  it("Payroll Setup inserts a candidate and still never sets staff_id (books-87)", () => {
    const body = fnBody(PAYROLL, "addPersonToPayroll");
    expect(body).toContain('employment_status: "candidate"');
    expect(body).toContain("active: false");
    const code = body.replace(/\/\/.*$/gm, "");
    expect(code).not.toContain("staff_id");
  });

  it("a PIN cannot be set on the file until Active (server check)", () => {
    const body = fnBody(ROSTER_ACTIONS, "updateEmployeeAction");
    expect(body).toContain("pinAllowedForStatus(");
    expect(body.indexOf("pinAllowedForStatus(")).toBeLessThan(body.indexOf("hashPin(pin)"));
    expect(FILE_PAGE).toContain("locked until Active");
  });

  it("the roster form has no PIN field any more", () => {
    expect(ROSTER_PAGE).not.toContain('name="clock_pin"');
    expect(ROSTER_PAGE).toContain("Candidate");
  });

  it("an inactive person cannot clock in or unlock the register (PIN lookup ignores inactive rows)", () => {
    const body = PIN_LOOKUP.slice(PIN_LOOKUP.indexOf("export async function getEmployeeByPin"));
    expect(body.slice(0, 1500)).toContain('.eq("active", true)');
  });
});
