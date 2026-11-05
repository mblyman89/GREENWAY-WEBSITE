/**
 * D181 (round slice S4): guided cash.
 *
 * Owner, verbatim: "Cash rules, 167.5 for employees, 300 for manager ...
 * Cash should be dropped if over 2k in sales for their register. Either of
 * the morning employees may build the deposit bag ... I am the only one to
 * seal the bag and take it to the bank. There should be a deposit bag for
 * every single day."
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  __runGuidedCashTests,
  dropStatus,
  DROP_THRESHOLD_MINOR,
  missingBagDays,
  morningDuties,
  sealerCheck,
  STANDARD_FLOAT_MINOR,
} from "@/lib/registers/guided-cash-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("D181 · the pure rules", () => {
  it("passes the embedded self-test", () => {
    const r = __runGuidedCashTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(38);
  });

  it("floats are exactly the owner's: $167.50 sales, $300.00 manager till", () => {
    expect(STANDARD_FLOAT_MINOR).toEqual({ sales: 16750, manager_till: 30000 });
  });

  it("a drop is due only when undropped cash is OVER $2,000", () => {
    expect(DROP_THRESHOLD_MINOR).toBe(200000);
    const s = (cash: number, drops = 0) =>
      dropStatus({ registerName: "R1", cashSalesMinor: cash, refundsPaidMinor: 0, dropsMinor: drops, readsComplete: true }).state;
    expect(s(200000)).not.toBe("due");
    expect(s(200001)).toBe("due");
    expect(s(400001, 200000)).toBe("due");
    expect(s(400000, 200000)).not.toBe("due");
  });

  it("a partial read never claims 'ok'", () => {
    expect(dropStatus({ registerName: "R1", cashSalesMinor: 0, refundsPaidMinor: 0, dropsMinor: 0, readsComplete: false }).state).toBe("unknown");
  });

  it("the morning checklist runs in cash order and ends with Michael", () => {
    const m = morningDuties({ day: "2026-11-03", drawers: [{ sessionId: "a", registerName: "R1", status: "closed", secondCountMinor: null }], bagStage: "none" });
    expect(m.steps.map((s) => s.key)).toEqual(["close_drawers", "second_counts", "reconcile", "build_bag", "recount_bag", "seal_bag", "bank"]);
    expect(m.steps.filter((s) => s.who === "owner").map((s) => s.key)).toEqual(["seal_bag", "bank"]);
  });

  it("every past day with drawers needs a bag", () => {
    expect(missingBagDays({ drawerDays: ["2026-11-02", "2026-11-03"], bagDays: ["2026-11-02"], today: "2026-11-04" })).toEqual(["2026-11-03"]);
    expect(missingBagDays({ drawerDays: ["2026-11-04"], bagDays: [], today: "2026-11-04" })).toEqual([]);
  });

  it("only the owner seals, with his own PIN", () => {
    expect(sealerCheck({ isOwner: false, ownerEmployeeId: null, pinEmployeeId: "x" }).ok).toBe(false);
    expect(sealerCheck({ isOwner: true, ownerEmployeeId: "m", pinEmployeeId: "x" }).ok).toBe(false);
    expect(sealerCheck({ isOwner: true, ownerEmployeeId: "m", pinEmployeeId: "m" }).ok).toBe(true);
  });
});

describe("D181 · wiring", () => {
  const actions = read("src/app/admin/registers/deposit-bags/actions.ts");
  const sealBody = actions.slice(actions.indexOf("export async function sealBagAction"), actions.indexOf("export async function retrySealPostAction"));

  it("the seal action is owner-gated before any read, and checks the PIN is Michael's", () => {
    const gate = sealBody.indexOf("requireBooksAccess(");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(sealBody.indexOf("getBag("));
    expect(sealBody.indexOf("sealerCheck(")).toBeLessThan(sealBody.indexOf("saveSeal("));
    expect(sealBody).toContain('"deposit_bag.seal_refused"');
  });

  it("night count and morning recount stay open to any staff login (either morning employee builds the bag)", () => {
    for (const fn of ["nightCountAction", "nightAssembleAction", "morningRecountAction"]) {
      const start = actions.indexOf(`export async function ${fn}`);
      const b = actions.slice(start, start + 400);
      expect(b).toContain('requirePermission("orders.manage")');
    }
  });

  it("the bag page hides the seal form from staff and names Michael", () => {
    const p = read("src/app/admin/registers/deposit-bags/page.tsx");
    expect(p).toContain("Seal the bag (Michael only)");
    expect(p).toContain('data-testid="seal-owner-only"');
    expect(p).toMatch(/!isOwner \? \(/);
    expect(p).toContain("missingBagDaysRecent(");
    expect(p).toContain('data-testid="missing-bag-days"');
  });

  it("the cockpit and Register Activity show the guided cash panel", () => {
    expect(read("src/app/admin/page.tsx")).toContain("<GuidedCashPanel");
    expect(read("src/app/admin/registers/page.tsx")).toContain("<GuidedCashPanel");
    const panel = read("src/components/admin/registers/GuidedCashPanel.tsx");
    for (const k of ["liveDropStatuses(", "morningDutiesFor(", "missingBagDaysRecent(", "floatNotices(", 'testId="drop-due"', 'data-testid="morning-duties"']) {
      expect(panel).toContain(k);
    }
  });

  it("the iPad polls its own drop status and the banner opens the drop flow", () => {
    const route = read("src/app/api/pos/drop-status/route.ts");
    expect(route).toContain("authenticateDevice(");
    expect(route).toContain("dropStatusForRegister(");
    expect(route).toContain("withPosCors(");
    const shell = read("src/app/(site)/pos/RegisterShell.tsx");
    expect(shell).toContain('posFetch("/api/pos/drop-status"');
    expect(shell).toContain('data-testid="pos-drop-due"');
    expect(shell).toContain('onClick={() => onTill("drop")}');
  });

  it("the drop figure uses the same drawer figure the reconcile uses", () => {
    const store = read("src/lib/registers/guided-cash-store.ts");
    expect(store).toContain("loadDrawerFigure(");
    expect(store).toContain("f.cashSalesMinor");
    expect(store).toContain("f.refundsPaidMinor");
    expect(store).toContain("f.dropsMinor");
  });
});
