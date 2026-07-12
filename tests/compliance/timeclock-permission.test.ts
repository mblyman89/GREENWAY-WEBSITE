/**
 * tests/compliance/timeclock-permission.test.ts
 *
 * Task S-b — pins the honest `timeclock.use` permission that replaced the
 * old `loyalty.view` proxy on the time-clock surfaces:
 *   - granted to owner, admin, manager, and STAFF (everyone who punches a
 *     clock) — the exact same role set the old proxy covered, so swapping
 *     the permission name changed no one's access;
 *   - NOT granted to content_editor / readonly / signed-out;
 *   - it is a real, labeled, matrix-visible permission (shows up in the
 *     admin permission matrix so the grant is auditable);
 *   - holding timeclock.use does NOT smuggle in staffing.manage — a
 *     budtender can clock in but cannot edit employees, schedules, or
 *     the employee command center.
 */
import { describe, expect, it } from "vitest";
import {
  can,
  rolesForPermission,
  ALL_PERMISSIONS,
  PERMISSION_LABELS,
} from "@/lib/auth/roles";

describe("timeclock.use (Task S-b)", () => {
  it("is granted to owner, admin, manager, and staff — everyone punches a clock", () => {
    expect(can("owner", "timeclock.use")).toBe(true);
    expect(can("admin", "timeclock.use")).toBe(true);
    expect(can("manager", "timeclock.use")).toBe(true);
    expect(can("staff", "timeclock.use")).toBe(true);
    expect(rolesForPermission("timeclock.use").sort()).toEqual(
      ["admin", "manager", "owner", "staff"].sort(),
    );
  });

  it("is NOT granted to content_editor, readonly, or signed-out users", () => {
    expect(can("content_editor", "timeclock.use")).toBe(false);
    expect(can("readonly", "timeclock.use")).toBe(false);
    expect(can(null, "timeclock.use")).toBe(false);
  });

  it("clocking in does not smuggle in staffing.manage for staff", () => {
    expect(can("staff", "staffing.manage")).toBe(false);
    expect(can("staff", "users.manage")).toBe(false);
  });

  it("is labeled and listed in the visible permission matrix (auditable grant)", () => {
    expect(ALL_PERMISSIONS).toContain("timeclock.use");
    expect(PERMISSION_LABELS["timeclock.use"]).toMatch(/clock/i);
  });
});
