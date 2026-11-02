/**
 * Owner request (00-OWNER-REQUEST-VERBATIM.md, "Shift end / till end and
 * clock-out", D121–D124):
 *
 *   "The register should have the employee count out the drawer, entering the
 *   bill quantities, then tips, then end, that's it. The register is now ready
 *   to take on a new employee. The second count happens in the office on the
 *   computer via the back office app. ... The clock out feature is not working
 *   either."
 *
 * D121 one-person iPad close · D122 second count in the back office ·
 * D123 reconcile waits for the second count · D124 clock in/out answered by
 * the server directly, refusals shown.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateTillRequest } from "@/lib/pos/till-core";
import {
  decideRegisterPunch,
  punchSuccessMessage,
  shouldQueueOffline,
  __runClockCoreTests,
} from "@/lib/pos/clock-core";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const SHELL = read("src/app/(site)/pos/RegisterShell.tsx");
const TILL = read("src/app/api/pos/till/route.ts");
const CLOCK = read("src/app/api/pos/clock/route.ts");
const STORE = read("src/lib/registers/store.ts");
const ACTIONS = read("src/app/admin/registers/actions.ts");
const PAGE = read("src/app/admin/registers/page.tsx");
const VERBATIM = read("docs/sop-program/00-OWNER-REQUEST-VERBATIM.md");

describe("D121: one person closes the drawer on the iPad", () => {
  it("bills + tips + own PIN is a valid close", () => {
    const r = validateTillRequest({ action: "close", pin: "1234", denoms: { twenties: 5 }, tipsMinor: 0 });
    expect(r.ok).toBe(true);
  });
  it("the till route has no second-PIN step and does not clock out", () => {
    expect(TILL).not.toMatch(/secondPin/);
    expect(TILL).not.toMatch(/checkSecondCounter/);
    expect(TILL).not.toMatch(/toggleClock/);
    expect(TILL).toMatch(/Owner D121/);
  });
  it("the register close screen is one step and says the register is ready", () => {
    expect(SHELL).not.toMatch(/closeStep/);
    expect(SHELL).not.toMatch(/secondDenoms/);
    expect(SHELL).toMatch(/The register is ready for the next cashier/);
    expect(SHELL).toMatch(/"Close drawer"/);
  });
  it("closeDrawerBlind takes the second count as optional", () => {
    expect(STORE).toMatch(/second\?: \{ employeeId: string; denoms: DenomCounts \}/);
  });
});

describe("D122/D123: second count in the office, before reconcile", () => {
  it("store + action + card exist", () => {
    expect(STORE).toMatch(/export async function recordSecondCount/);
    expect(STORE).toMatch(/\.eq\("status", "closed"\)\s*\.is\("second_count_minor", null\)/);
    expect(ACTIONS).toMatch(/export async function secondCountAction/);
    expect(ACTIONS).toMatch(/BACKOFFICE_TILL_THROTTLE_SCOPE/);
    expect(PAGE).toMatch(/function SecondCountCard/);
    expect(PAGE).toMatch(/if \(item\.secondCountMinor == null\) return <SecondCountCard/);
  });
  it("reconcile is refused (and audited) until the second count is saved", () => {
    expect(ACTIONS).toMatch(/second_count_missing: true/);
  });
});

describe("D124: clock in / out works and says what happened", () => {
  it("pure core self-tests pass", () => {
    const r = __runClockCoreTests();
    expect(r).toEqual({ passed: 16, failed: 0 });
  });
  it("decides, words and queues correctly", () => {
    expect(decideRegisterPunch(null, true)).toEqual({ kind: "toggle", action: "out" });
    expect(decideRegisterPunch("out", false).kind).toBe("already");
    expect(punchSuccessMessage("Zachary", "out", "2026-11-02T00:46:00Z")).toBe("Zachary: clocked OUT at 4:46 PM.");
    expect(shouldQueueOffline(true, true)).toBe(false);
  });
  it("the clock endpoint is device-authenticated, PIN-throttled, uses toggleClock and audits", () => {
    expect(CLOCK).toMatch(/authenticateDevice/);
    expect(CLOCK).toMatch(/pinPadBlocked/);
    expect(CLOCK).toMatch(/notePinFailure/);
    expect(CLOCK).toMatch(/toggleClock\(employee\.id, "register"\)/);
    expect(CLOCK).toMatch(/timeclock\.refused/);
    expect(CLOCK).toMatch(/`timeclock\.\$\{result\.action\}`/);
    expect(CLOCK).toMatch(/withPosCors/);
    expect(CLOCK).toMatch(/export async function OPTIONS/);
  });
  it("the register calls it directly and shows refusals instead of queuing them", () => {
    expect(SHELL).toMatch(/posFetch\("\/api\/pos\/clock"/);
    expect(SHELL).toMatch(/NOT clocked/);
    expect(SHELL).toMatch(/Clock in \/ Clock out/);
    // The lock screen no longer routes a clock punch through the unlock call.
    expect(SHELL).not.toMatch(/onPunch\(body\.employee\)/);
  });
});

describe("standing rule: the owner's words are recorded", () => {
  it("verbatim request and D121–D124 are in the ledger", () => {
    expect(VERBATIM).toMatch(/The register should have the employee count out the drawer, entering the bill quantities, then tips, then end, that's it\./);
    expect(VERBATIM).toMatch(/The clock out feature is not working either\./);
    for (const d of ["D121", "D122", "D123", "D124"]) expect(VERBATIM).toContain(`| ${d} |`);
  });
});
