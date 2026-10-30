/**
 * Fix Phase 6 / Fix E (G-61..G-66; owner message 8, D81-D90) - shift end and
 * end-of-day cash. Owner, verbatim: Q-E-6 "Block. I don't want to clock out on
 * the register change out step."; Q-E-7 "Warn please"; Q-E-4 "Please change it
 * to assembled and verified at night, and blind counted in the morning.";
 * Q-E-5 "Yes please do this."; Q-E-10 "The tip jar is pooled for the morning
 * crew, and pooled for the night crew."
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  __runShiftEndCoreTests,
  clockOutBlocked,
  floatCheck,
  splitTipPool,
  checkAssembledDeposit,
  eodStatus,
} from "@/lib/registers/shift-end-core";
import { validateTillRequest } from "@/lib/pos/till-core";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

function fnBody(src: string, name: string): string {
  const at = src.indexOf(`function ${name}`);
  expect(at, `function ${name} exists`).toBeGreaterThan(-1);
  const next = src.indexOf("\nexport async function ", at + 10);
  const nextPriv = src.indexOf("\nasync function ", at + 10);
  const ends = [next, nextPriv].filter((n) => n > at);
  return src.slice(at, ends.length ? Math.min(...ends) : undefined);
}

describe("shift-end-core pure rules", () => {
  it("self-tests all pass", () => {
    expect(__runShiftEndCoreTests()).toEqual({ passed: 46, failed: 0 });
  });
  it("D84: a register clock-out is blocked while the employee owns an open drawer; manager edits are not", () => {
    const owned = [{ sessionId: "s1", registerName: "Register 1" }];
    expect(clockOutBlocked({ isClockOut: true, source: "register", owned }).blocked).toBe(true);
    expect(clockOutBlocked({ isClockOut: true, source: "register", owned: [] }).blocked).toBe(false);
    expect(clockOutBlocked({ isClockOut: true, source: "manager_edit", owned }).blocked).toBe(false);
  });
  it("D85: the float check warns, it never refuses", () => {
    expect(floatCheck(16_000, 16_750).state).toBe("short");
    expect(floatCheck(16_750, 16_750).state).toBe("match");
  });
  it("D89: the crew pool splits evenly in whole cents; leftover stays in the jar", () => {
    const s = splitTipPool(10_001, 2);
    expect(s.ok && s.shareMinor === 5_000 && s.leftoverMinor === 1).toBe(true);
  });
  it("D89: the till close stores the cashier's share, not the typed tips", () => {
    const v = validateTillRequest({ action: "close", pin: "1234", secondPin: "5678", secondDenoms: {}, denoms: {}, tipsMinor: 99_999, tipPool: { poolMinor: 9_000, people: 2 } });
    expect(v.ok).toBe(true);
    expect(JSON.stringify(v)).toContain('"tipsMinor":4500');
  });
  it("D82: the assembled deposit needs every stack ticked and a workable expected figure", () => {
    const lines = [{ sessionId: "a", registerName: "R1", toBagMinor: 30_000 }, { sessionId: "b", registerName: "R2", toBagMinor: 20_000 }];
    expect(checkAssembledDeposit({ expectedMinor: 50_000, problems: [], lines, confirmedIds: ["a"] }).ok).toBe(false);
    const ok = checkAssembledDeposit({ expectedMinor: 50_000, problems: [], lines, confirmedIds: ["a", "b"] });
    expect(ok.ok && ok.countMinor === 50_000).toBe(true);
    expect(checkAssembledDeposit({ expectedMinor: null, problems: ["x"], lines, confirmedIds: ["a", "b"] }).ok).toBe(false);
  });
  it("D87: closed is not final until every drawer is reconciled", () => {
    expect(eodStatus({ final: true, sessionCount: 2, awaitingReconcile: 1 }).state).toBe("awaiting_reconcile");
  });
});

describe("wiring", () => {
  it("D84: toggleClock checks open drawers before the clock-out, and the register learns about it at unlock", () => {
    const store = read("src/lib/staffing/store.ts");
    const body = fnBody(store, "toggleClock");
    expect(body).toContain("clockOutBlocked(");
    expect(body.indexOf("clockOutBlocked(")).toBeLessThan(body.indexOf("clock_out_at"));
    expect(store).toContain("export async function openDrawersOwnedBy");
    const unlock = read("src/app/api/pos/unlock/route.ts");
    expect(unlock).toContain("openDrawerSessionIds");
    expect(unlock).toContain("clockOutBlockedMessage");
    expect(unlock).toContain("defaultFloatMinor");
  });
  it("D84: closing a drawer does NOT clock the cashier out", () => {
    const till = read("src/app/api/pos/till/route.ts");
    expect(till).not.toMatch(/toggleClock/);
    expect(read("src/app/(site)/pos/RegisterShell.tsx")).toContain("You are still clocked in");
  });
  it("D85: the till route and the console both audit the float warning", () => {
    expect(read("src/app/api/pos/till/route.ts")).toContain("drawer.float_warning");
    expect(read("src/app/admin/registers/actions.ts")).toContain("drawer.float_warning");
  });
  it("D83: verify till is retired (the stub audits and refuses; the store function is gone)", () => {
    const actions = read("src/app/admin/registers/actions.ts");
    expect(fnBody(actions, "verifyTillAction")).toContain("till.verify_retired");
    expect(read("src/lib/registers/store.ts")).not.toMatch(/export async function verifyTill\(/);
    expect(read("src/lib/registers/oversight.ts")).not.toMatch(/kind: "verify"/);
  });
  it("D82: night assemble re-works the lines on the server, then checks, then saves with no denominations", () => {
    const b = fnBody(read("src/app/admin/registers/deposit-bags/actions.ts"), "nightAssembleAction");
    const order = ["employeeFromPin(", "drawersForDay(", "checkAssembledDeposit(", "checkNightCount(", "insertNightCount(", "deposit_bag.night_assembled"];
    let last = -1;
    for (const k of order) {
      const at = b.indexOf(k);
      expect(at, k).toBeGreaterThan(last);
      last = at;
    }
    expect(b).toContain("denoms: null");
    const page = read("src/app/admin/registers/deposit-bags/page.tsx");
    expect(page).toContain("action={nightAssembleAction}");
    expect(page).toContain('name="confirm_session"');
    expect(page).toContain("Count by denomination instead");
  });
  it("D87: sealing warns about unreconciled drawers but still seals", () => {
    const b = fnBody(read("src/app/admin/registers/deposit-bags/actions.ts"), "sealBagAction");
    expect(b.indexOf("saveSeal(")).toBeLessThan(b.indexOf("sealReconcileWarning("));
    expect(b).toContain("deposit_bag.sealed_unreconciled");
    expect(read("src/app/admin/registers/eod/page.tsx")).toContain("eodStatus(");
  });
  it("no migration in this slice (0325 was CCRS C1's; later phases add more)", () => {
    const all = readdirSync(join(root, "supabase/migrations")).filter((f) => /^\d{4}_/.test(f)).sort();
    expect(all.some((f) => f.startsWith("0325_"))).toBe(true);
    expect(all.filter((f) => f.startsWith("0325")).length).toBe(1);
  });
});
