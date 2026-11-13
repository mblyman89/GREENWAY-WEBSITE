/**
 * tests/compliance/d241-register-switches-keypad.test.ts
 *
 * D241 — "I want to add a toggle setting in register activity that lets me
 * turn off or disable use of the web browser registers. I only want them on
 * if the iPads have failed in some way. I also want a toggle for dual
 * approval on cash swaps with the master so I can turn it off if needed.
 * Finally, my employees would like a digital key pad for the register
 * screen. Anytime something needs to be typed by hand, I want a keypad
 * button to be available for them."
 *
 * Pins:
 *   1. the pure cores (switches, keypad) and the till validators;
 *   2. /api/pos/unlock refuses a browser before the PIN when browser
 *      registers are off, and audits it; clock and sync are not gated;
 *   3. /api/pos/till skips the approver only when the owner's switch is off
 *      and no PIN was typed; the offline sync re-checks the setting;
 *   4. the settings page sits under Register Activity, owner/admin only,
 *      audited, one site_settings row (no migration);
 *   5. the keypad is mounted on BOTH register hosts (browser page + iPad app).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  __runRegisterSwitchesTests,
  DEFAULT_REGISTER_SWITCHES,
  normalizeRegisterSwitches,
  registerClientFromOrigin,
  webRegisterUnlockGate,
} from "@/lib/pos/register-switches-core";
import {
  __runRegisterKeypadTests,
  applyKeypadKey,
  eligibleForKeypad,
  keypadKindFor,
} from "@/lib/pos/register-keypad-core";
import { validateTillRequest } from "@/lib/pos/till-core";
import { validateTillPayload, __runOfflineTillCoreTests } from "@/lib/pos/offline-till-core";
import { EMPTY_DENOMS } from "@/lib/registers/cash";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

describe("D241 register switches: pure core", () => {
  it("self-tests pass", () => {
    const r = __runRegisterSwitchesTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(22);
  });
  it("defaults keep today's behaviour; only a literal false turns a switch off", () => {
    expect(DEFAULT_REGISTER_SWITCHES).toEqual({ webRegistersAllowed: true, swapApprovalRequired: true });
    expect(normalizeRegisterSwitches({})).toEqual(DEFAULT_REGISTER_SWITCHES);
    expect(normalizeRegisterSwitches({ webRegistersAllowed: false, swapApprovalRequired: false })).toEqual({
      webRegistersAllowed: false,
      swapApprovalRequired: false,
    });
  });
  it("the iPad app is told apart from a browser by its Origin", () => {
    expect(registerClientFromOrigin("capacitor://localhost")).toBe("ipad_app");
    expect(registerClientFromOrigin("https://greenwaymarijuana.com")).toBe("web_browser");
    expect(registerClientFromOrigin(null)).toBe("web_browser");
  });
  it("the unlock gate only refuses a browser when the switch is off", () => {
    const off = { webRegistersAllowed: false, swapApprovalRequired: true };
    expect(webRegisterUnlockGate(off, "web_browser").ok).toBe(false);
    expect(webRegisterUnlockGate(off, "ipad_app").ok).toBe(true);
    expect(webRegisterUnlockGate(DEFAULT_REGISTER_SWITCHES, "web_browser").ok).toBe(true);
  });
});

describe("D241 swap approval: validators", () => {
  const bills = { ...EMPTY_DENOMS, hundreds: 1 };
  const change = { ...EMPTY_DENOMS, twenties: 5 };
  it("online: approver required unless the owner's switch is off", () => {
    expect(validateTillRequest({ action: "swap", pin: "1234", amountMinor: 10000 }).ok).toBe(false);
    expect(validateTillRequest({ action: "swap", pin: "1234", amountMinor: 10000 }, { swapApprovalRequired: true }).ok).toBe(false);
    const off = validateTillRequest({ action: "swap", pin: "1234", amountMinor: 10000, inDenoms: bills, outDenoms: change }, { swapApprovalRequired: false });
    expect(off.ok).toBe(true);
    if (off.ok && off.req.action === "swap") expect(off.req.approverPin).toBe("");
  });
  it("offline: approvalOff lets a swap through without an approver; bills still checked", () => {
    const A = { employeeId: "11111111-1111-4111-8111-111111111111", armedAt: "2026-11-04T10:00:00.000Z", keyId: "e1" };
    const ref = "33333333-3333-4333-8333-333333333333";
    const base = { action: "swap" as const, drawerRef: ref, reason: "offline" as const, actor: A, amountMinor: 10000, inDenoms: bills, outDenoms: change };
    expect(validateTillPayload(base).ok).toBe(false);
    expect(validateTillPayload({ ...base, approvalOff: true }).ok).toBe(true);
    expect(validateTillPayload({ ...base, approvalOff: true, outDenoms: { ...EMPTY_DENOMS, twenties: 4 } }).ok).toBe(false);
    const r = __runOfflineTillCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(34);
  });
});

describe("D241 server enforcement", () => {
  it("/api/pos/unlock checks the switch by Origin BEFORE the PIN and audits a refusal", () => {
    const src = read("src/app/api/pos/unlock/route.ts");
    const gate = src.indexOf("webRegisterUnlockGate(await getRegisterSwitches(), client)");
    const pin = src.indexOf("getEmployeeByPin(pin)");
    expect(gate).toBeGreaterThan(0);
    expect(pin).toBeGreaterThan(gate);
    expect(src).toMatch(/registerClientFromOrigin\(req\.headers\.get\("origin"\)\)/);
    expect(src).toMatch(/"register\.unlock_blocked_web"/);
    expect(src).toMatch(/code: "web_registers_off"/);
  });
  it("clock and sync are NOT gated (punches and saved sales never stranded)", () => {
    for (const r of ["src/app/api/pos/clock/route.ts", "src/app/api/pos/sync/route.ts"]) {
      expect(read(r)).not.toMatch(/webRegisterUnlockGate|getRegisterSwitches/);
    }
  });
  it("/api/pos/till reads the switch for a swap and records approvalNotRequired", () => {
    const src = read("src/app/api/pos/till/route.ts");
    expect(src).toMatch(/validateTillRequest\(body, \{ swapApprovalRequired \}\)/);
    expect(src).toMatch(/const approvalSkipped = !swapApprovalRequired && till\.approverPin === ""/);
    expect(src).toMatch(/approvedBy: approver\?\.id \?\? null/);
    expect(src).toMatch(/approvalNotRequired: approvalSkipped/);
    // a typed approver PIN is still verified, role-gated and not self-approved
    expect(src).toMatch(/SWAP_APPROVER_ROLES\.has\(approver\.job_role\)/);
    expect(src).toMatch(/approver\.id === employee\.id/);
  });
  it("the offline sync re-checks the server's setting for a no-approver swap", () => {
    const src = read("src/lib/pos/offline-till-store.ts");
    expect(src).toMatch(/p\.approvalOff === true/);
    expect(src).toMatch(/\(await getRegisterSwitches\(\)\)\.swapApprovalRequired/);
    expect(src).toMatch(/approvalNotRequired: swapNoApprover/);
  });
  it("the switches ride the menu bundle for offline registers", () => {
    expect(read("src/app/api/pos/menu/route.ts")).toMatch(/getRegisterSwitches\(\)/);
    expect(read("src/lib/pos/sale-flow-core.ts")).toMatch(/registerSwitches\?: unknown/);
  });
});

describe("D241 register screens", () => {
  const shell = read("src/app/(site)/pos/RegisterShell.tsx");
  it("the lock screen shows the off notice and blocks the offline unlock on a browser", () => {
    expect(shell).toMatch(/webRegistersOff=\{isWebRegister && !normalizeRegisterSwitches\(menuBundle\?\.registerSwitches\)\.webRegistersAllowed\}/);
    expect(shell).toMatch(/BROWSER REGISTERS ARE TURNED OFF/);
    expect(shell).toMatch(/if \(webRegistersOff\) \{\s*setPin\(""\);\s*setError\(WEB_REGISTERS_OFF_MESSAGE\)/);
  });
  it("the swap screen hides the approver PIN only when approval is off", () => {
    expect(shell).toMatch(/const swapNeedsApprover = swapApprovalFromBundle \|\| approvalForced/);
    expect(shell).toMatch(/\(!swapNeedsApprover \|\| approverPin\.length >= 4\)/);
    expect(shell).toMatch(/\.\.\.\(swapNeedsApprover \? \{ approverPin \} : \{\}\)/);
    expect(shell).toMatch(/approvalOff: true as const/);
  });
});

describe("D241 settings page", () => {
  it("lives under Register Activity, needs settings.manage, audits before and after", () => {
    expect(read("src/app/admin/registers/page.tsx")).toMatch(/href=\{`\$\{BASE\}\/switches`\}/);
    expect(read("src/app/admin/registers/switches/page.tsx")).toMatch(/requirePermission\("settings\.manage"\)/);
    const act = read("src/app/admin/registers/switches/actions.ts");
    expect(act).toMatch(/requirePermission\("settings\.manage"\)/);
    expect(act).toMatch(/"pos\.register_switches_saved"/);
    expect(act).toMatch(/before: \{ \.\.\.before \}/);
  });
  it("one site_settings row, no migration", () => {
    expect(read("src/lib/pos/register-switches-store.ts")).toMatch(/POS_REGISTER_SWITCHES_KEY = "pos_register_switches"/);
    const migs = readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => /register_switch|d241/i.test(f));
    expect(migs).toEqual([]);
  });
});

describe("D241 on-screen keypad", () => {
  it("self-tests pass", () => {
    const r = __runRegisterKeypadTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(37);
  });
  it("number pad for PINs and counts, letters for names; the scanner sink is skipped", () => {
    expect(keypadKindFor({ tag: "input", type: "password", inputMode: "numeric" })).toBe("numeric");
    expect(keypadKindFor({ tag: "input", inputMode: "decimal" })).toBe("decimal");
    expect(keypadKindFor({ tag: "input" })).toBe("alpha");
    expect(eligibleForKeypad({ tag: "input", type: "text", inputMode: "none", ariaHidden: "true" })).toBe(false);
    expect(applyKeypadKey("12345", 5, 5, { t: "char", c: "6" }, 6).value).toBe("123456");
    expect(applyKeypadKey("123456", 6, 6, { t: "char", c: "7" }, 6).value).toBe("123456");
  });
  it("is mounted on both register hosts (browser page and iPad app)", () => {
    expect(read("src/app/(site)/pos/page.tsx")).toMatch(/<RegisterKeypad \/>/);
    expect(read("register-app/src/main.tsx")).toMatch(/<RegisterKeypad \/>/);
  });
  it("types through the box's own onChange and keeps the iPad keyboard down while open", () => {
    const kp = read("src/app/(site)/pos/RegisterKeypad.tsx");
    expect(kp).toMatch(/getOwnPropertyDescriptor\(proto, "value"\)\?\.set/);
    expect(kp).toMatch(/new Event\("input", \{ bubbles: true \}\)/);
    expect(kp).toMatch(/setAttribute\("inputmode", "none"\)/);
    expect(kp).toMatch(/Keypad/);
  });
});
