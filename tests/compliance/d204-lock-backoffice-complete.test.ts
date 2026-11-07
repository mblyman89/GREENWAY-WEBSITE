/**
 * D204 — an online order is completed at the register, where it is paid.
 * Back-office "Mark Completed" is locked; owner/admin/manager may complete it
 * with a written reason, audited as order.completed_off_register.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __runBackofficeCompleteTests,
  backofficeCompleteVerdict,
  OFF_REGISTER_COMPLETE_REFUSAL,
} from "../../src/lib/orders/backoffice-complete-core";

const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");

describe("D204 back-office completion lock", () => {
  it("self-tests pass", () => {
    const r = __runBackofficeCompleteTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(15);
  });
  it("refuses staff, refuses no reason, allows manager with reason", () => {
    expect(backofficeCompleteVerdict({ toStatus: "completed", role: "budtender", reason: "rung on paper" }).ok).toBe(false);
    expect(backofficeCompleteVerdict({ toStatus: "completed", role: "owner", reason: "" }).ok).toBe(false);
    expect(backofficeCompleteVerdict({ toStatus: "completed", role: "manager", reason: "register outage" })).toEqual({
      ok: true,
      offRegister: true,
      reason: "register outage",
    });
    expect(backofficeCompleteVerdict({ toStatus: "cancelled", role: "budtender", reason: "" }).ok).toBe(true);
  });
  it("server action gates before the compliance gate and audits", () => {
    const a = read("src/app/admin/orders/actions.ts");
    const gate = a.indexOf("backofficeCompleteVerdict({");
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(a.indexOf("runCompletionGate({"));
    expect(a).toContain("order.completed_off_register");
    expect(a).toContain('reason: "complete_at_register"');
  });
  it("order page sends staff to the register and asks managers for a reason", () => {
    const p = read("src/app/admin/orders/[id]/page.tsx");
    expect(p).toContain('data-testid="complete-at-register"');
    expect(p).toContain('name="offRegisterReason"');
    expect(p).toContain("OFF_REGISTER_COMPLETE_REFUSAL");
    expect(OFF_REGISTER_COMPLETE_REFUSAL).toMatch(/register/);
  });
});
