/**
 * tests/compliance/payables-permission.test.ts
 *
 * W10 — pins the scoped Accounts Payable permission (owner decision, Q2:
 * "my purchase manager should get payables permission"):
 *   - `payables.manage` exists in the matrix and is granted to owner, admin,
 *     and MANAGER (the purchase manager) — and to nobody below manager;
 *   - it is a real, labeled, matrix-visible permission (shows up in the
 *     admin permission matrix so the grant is auditable);
 *   - managers do NOT get settings.manage as a side effect — AP access no
 *     longer drags in user management / store settings;
 *   - the journey model's Pay stage carries payables.manage so the hub's
 *     permission-filtered cards agree with the page's actual gate.
 */
import { describe, expect, it } from "vitest";
import {
  can,
  rolesForPermission,
  ALL_PERMISSIONS,
  PERMISSION_LABELS,
} from "@/lib/auth/roles";
import { journeyStage } from "@/lib/catalog/journey-core";

describe("payables.manage (W10)", () => {
  it("is granted to owner, admin, and manager — the purchase manager runs AP", () => {
    expect(can("owner", "payables.manage")).toBe(true);
    expect(can("admin", "payables.manage")).toBe(true);
    expect(can("manager", "payables.manage")).toBe(true);
  });

  it("is NOT granted below manager (or to nobody at all)", () => {
    expect(can("content_editor", "payables.manage")).toBe(false);
    expect(can("staff", "payables.manage")).toBe(false);
    expect(can("readonly", "payables.manage")).toBe(false);
    expect(can(null, "payables.manage")).toBe(false);
    expect(rolesForPermission("payables.manage").sort()).toEqual(
      ["admin", "manager", "owner"].sort(),
    );
  });

  it("granting AP does not smuggle in settings.manage for managers", () => {
    expect(can("manager", "settings.manage")).toBe(false);
    expect(can("manager", "users.manage")).toBe(false);
  });

  it("is labeled and listed in the visible permission matrix (auditable grant)", () => {
    expect(ALL_PERMISSIONS).toContain("payables.manage");
    expect(PERMISSION_LABELS["payables.manage"]).toMatch(/accounts payable/i);
    expect(PERMISSION_LABELS["payables.manage"]).toMatch(/drafts only/i);
  });

  it("the journey's Pay stage carries the same permission the AP page enforces", () => {
    expect(journeyStage("pay").permission).toBe("payables.manage");
  });
});
