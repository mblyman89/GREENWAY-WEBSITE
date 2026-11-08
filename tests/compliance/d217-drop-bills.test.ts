/**
 * D217: cash drops. Owner: "the register told the employee to withdraw x amount of money, but it told
 * them it needed to be in 20s ... make sure ... the system doesn't think this money is not included in
 * the blind counts due to it going toward the atm ... Should we require they enter the quantities of the
 * bills taken? ... if it's enterprise grade, professional method, add the bill quantity to the fix."
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { __runDropBillsTests, parseDropBills, DROP_HOW_TO, addBillsToDropRows } from "../../src/lib/registers/drop-bills-core";
import { dropStatus } from "../../src/lib/registers/guided-cash-core";
import { buildDropInsertRows, splitDrops } from "../../src/lib/registers/atm-drop-core";
import { validateTillRequest } from "../../src/lib/pos/till-core";
import { validateTillPayload } from "../../src/lib/pos/offline-till-core";

const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");

describe("D217 drop-bills core", () => {
  it("self-tests pass, exact count", () => {
    const r = __runDropBillsTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(25);
  });
  it("the SR1 drop, counted bill by bill, is $2,420.00", () => {
    const p = parseDropBills({ hundreds: 3, fifties: 1, twenties: 103, ones: 10 });
    expect(p.ok && p.amountMinor).toBe(242000);
  });
  it("how-to never tells a safe drop to be twenties only", () => {
    expect(DROP_HOW_TO).toMatch(/To the safe: enter how many of each bill/);
  });
});

describe("D217 drop-due message", () => {
  const due = dropStatus({ registerName: "Sales Register 2", cashSalesMinor: 212345, refundsPaidMinor: 0, dropsMinor: 0, readsComplete: true });
  it("is still loud and suggests an amount", () => {
    expect(due.state).toBe("due");
    expect(due.sentence.startsWith("DROP NOW")).toBe(true);
    expect(due.suggestedDropMinor).toBe(212000);
  });
  it("no longer says 'in twenties'; says big bills first and count each bill", () => {
    expect(due.sentence).not.toMatch(/in twenties/);
    expect(due.sentence).toMatch(/big bills first \(\$100s, \$50s, then \$20s\)/);
    expect(due.sentence).toMatch(/leave the starting cash/);
    expect(due.sentence).toMatch(/how many of each bill/);
  });
  it("the unknown sentence does not say count the twenties", () => {
    const u = dropStatus({ registerName: "SR1", cashSalesMinor: 1, refundsPaidMinor: 0, dropsMinor: 0, readsComplete: false });
    expect(u.sentence).not.toMatch(/Count the twenties/);
  });
});

describe("D217 ATM drops stay in the blind count, out of the deposit", () => {
  it("drawer expected subtracts every drop; deposit/EOD read safe drops only", () => {
    const fig = read("src/lib/registers/drawer-figure-core.ts");
    expect(fig).toMatch(/dropsMinor/);
    const s = splitDrops([{ amount_minor: 100000 }, { amount_minor: 40000, destination: "atm", twenties_count: 20 }]);
    expect(s.safeMinor + s.atmMinor).toBe(140000);
    expect(s.atmMinor).toBe(40000);
  });
});

describe("D217 server refuses a drop whose bills disagree", () => {
  it("bills alone: amount added up", () => {
    const v = validateTillRequest({ action: "drop", pin: "1234", window: "afternoon", bills: { twenties: 77 } });
    expect(v.ok).toBe(true);
    if (v.ok && v.req.action === "drop") {
      expect(v.req.amountMinor).toBe(154000);
      expect(v.req.bills).toEqual({ twenties: 77 });
    }
  });
  it("the SR2 case: $2,080 typed, 77 x $20 counted -> refused", () => {
    const v = validateTillRequest({ action: "drop", pin: "1234", window: "afternoon", amountMinor: 208000, bills: { twenties: 77 } });
    expect(v.ok).toBe(false);
  });
  it("bills that match the amount are accepted", () => {
    expect(validateTillRequest({ action: "drop", pin: "1234", window: "night", amountMinor: 242000, bills: { hundreds: 3, fifties: 1, twenties: 103, ones: 10 } }).ok).toBe(true);
  });
  it("coins or bills on an ATM drop are refused", () => {
    expect(validateTillRequest({ action: "drop", pin: "1234", window: "night", bills: { quarters: 4 } }).ok).toBe(false);
    expect(validateTillRequest({ action: "drop", pin: "1234", window: "night", destination: "atm", twentiesCount: 5, bills: { twenties: 5 } }).ok).toBe(false);
  });
  it("older builds (typed amount, no bills) still work", () => {
    const v = validateTillRequest({ action: "drop", pin: "1234", window: "night", amountMinor: 50000 });
    expect(v.ok).toBe(true);
    if (v.ok && v.req.action === "drop") expect(v.req.bills).toBeUndefined();
  });
  it("offline replay carries the bills through the same check", () => {
    const pin = { employeeId: "11111111-1111-4111-8111-111111111111", armedAt: "2026-11-08T20:00:00Z", keyId: "e1" };
    const base = { action: "drop" as const, drawerRef: "22222222-2222-4222-8222-222222222222", reason: "offline" as const, actor: pin, window: "night" as const };
    const ok = validateTillPayload({ ...base, amountMinor: 154000, bills: { twenties: 77 } });
    expect(ok.ok).toBe(true);
    expect(validateTillPayload({ ...base, amountMinor: 208000, bills: { twenties: 77 } }).ok).toBe(false);
  });
});

describe("D217 storage", () => {
  it("insert rows: bills column, then note tag before 0349, then pre-0346", () => {
    const r = addBillsToDropRows(
      buildDropInsertRows(
        { session_id: "s", amount_minor: 154000, drop_window: "night", dropped_by: "e", witnessed_by: null, notes: null },
        { destination: "safe", recordedVia: "register" },
      ),
      { twenties: 77 },
    );
    expect(r.full.bills).toEqual({ twenties: 77 });
    expect(String(r.fullNoBills?.notes)).toMatch(/\[bills: 77 × \$20\]/);
    expect(String(r.fallback.notes)).toMatch(/\[bills: 77/);
  });
  it("store tries the 0346 shape with the bills tag before the pre-0346 shape; both writers add the bills", () => {
    expect(read("src/lib/registers/store.ts")).toMatch(/rows\.fullNoBills/);
    expect(read("src/lib/registers/store.ts")).toMatch(/addBillsToDropRows\(rows/);
    expect(read("src/lib/pos/offline-till-store.ts")).toMatch(/addBillsToDropRows\(buildDropInsertRows/);
  });
  it("atm-drop-core still imports nothing (D198 bundle guard)", () => {
    expect(read("src/lib/registers/atm-drop-core.ts")).not.toMatch(/^import /m);
  });
  it("migration 0349: column, bills = amount check, write-once, rollback and pg-check", () => {
    const up = read("supabase/migrations/0349_drawer_drop_bills.sql");
    expect(up).toMatch(/add column if not exists bills jsonb/);
    expect(up).toMatch(/drawer_drop_bills_total\(bills\) = amount_minor/);
    expect(up).toMatch(/destination = 'safe'/);
    expect(up).toMatch(/new\.bills is distinct from old\.bills/);
    expect(up).toMatch(/grant execute on function public\.drawer_drop_bills_total\(jsonb\) to service_role/);
    expect(read("supabase/rollbacks/0349_drawer_drop_bills.rollback.sql")).toMatch(/\[bills: /);
    expect(read("scripts/recon/drawer-drop-bills-0349-pg-check.sql")).toMatch(/DRAWER DROP BILLS 0349 CHECK PASSED/);
    expect(read("scripts/compliance/verify-migrations-execute.ts")).toContain("drawer-drop-bills-0349-pg-check.sql");
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toContain("supabase/migrations/0349_drawer_drop_bills.sql");
  });
  it("route and offline replay audit the bills", () => {
    expect(read("src/app/api/pos/till/route.ts")).toMatch(/billsCounted: !!till\.bills/);
    expect(read("src/lib/pos/offline-till-store.ts")).toMatch(/billsCounted: !!req\.bills/);
  });
});

describe("D217 iPad drop screen", () => {
  const shell = read("src/app/(site)/pos/RegisterShell.tsx");
  it("safe drop is a bill grid; the amount is added up, never typed", () => {
    expect(shell).toContain("How many of each bill are you taking to the safe?");
    expect(shell).toContain('data-testid="pos-drop-bills"');
    expect(shell).toContain("parseDropBills(dropBills)");
    expect(shell).not.toContain("Amount dropped");
    expect(shell).not.toMatch(/dollarsToMinor\(amount\)/);
  });
  it("sends the bills online and offline", () => {
    expect(shell.match(/billsParse\?\.ok \? \{ bills: billsParse\.bills \}/g)?.length).toBe(2);
  });
  it("shows the how-to", () => {
    expect(shell).toContain("{DROP_HOW_TO}");
  });
});
