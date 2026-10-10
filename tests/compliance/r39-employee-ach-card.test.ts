/**
 * R39 S4 — employee file ACH card. The card must never disagree with payroll:
 * it is built from planPayrollEntries, and these tests check that agreement.
 */
import { describe, expect, it } from "vitest";
import {
  __runEmployeeAchCardTests,
  describeRule,
  employeeAchCard,
  SAMPLE_NET_CENTS,
} from "@/lib/payroll/employee-ach-card-core";
import { planPayrollEntries, type EmployeeDepositPlan, type SplitDepositAccount } from "@/lib/payroll/payroll-core";

const acct = (o: Partial<SplitDepositAccount> = {}): SplitDepositAccount => ({
  priority: 1,
  rule: { kind: "remainder" },
  routing: "125000105",
  accountNumber: "123456789",
  accountType: "checking",
  verificationStatus: "verified",
  ...o,
});
const base = { tableReady: true, employeeActive: true, employeeName: "Ann Able", plan: null, historyCount: 0, legacy: null };
const legacy = { routing: "125000105", accountNumber: "555554321", accountType: "checking" };

describe("employeeAchCard agrees with payroll", () => {
  const plans: [string, EmployeeDepositPlan][] = [
    ["active single", { state: "active", accounts: [acct()] }],
    ["active split", { state: "active", accounts: [acct({ priority: 1, rule: { kind: "fixed", cents: 5000 }, accountNumber: "1111" }), acct({ priority: 2, accountNumber: "2222" })] }],
    ["draft", { state: "draft", accounts: [acct()] }],
    ["signed", { state: "signed", accounts: [acct()] }],
    ["verifying", { state: "verifying", accounts: [acct()] }],
    ["on_hold", { state: "on_hold", accounts: [acct()] }],
    ["unverified", { state: "active", accounts: [acct({ verificationStatus: "pending" })] }],
    ["bad routing", { state: "active", accounts: [acct({ routing: "125000106" })] }],
    ["no accounts", { state: "active", accounts: [] }],
    ["unknown state", { state: "ACTIVE", accounts: [acct()] }],
  ];
  it.each(plans)("%s", (_n, plan) => {
    const card = employeeAchCard({ ...base, plan });
    const pay = planPayrollEntries(
      [{ employeeId: "e", employeeName: "Ann Able", netPayCents: SAMPLE_NET_CENTS, accountType: "checking", routing: "", accountNumber: "" }],
      new Map([["e", plan]]),
    );
    expect(card.state === "payable").toBe(pay.ok);
    if (pay.ok) {
      const shown = card.accounts.reduce((t, a) => t + (a.sampleCents ?? 0), 0);
      expect(shown).toBe(SAMPLE_NET_CENTS);
    } else {
      expect(card.tone).toBe("orange");
      expect(card.accounts.every((a) => a.sampleCents === null)).toBe(true);
      // The card repeats payroll's own reason (minus the name prefix).
      expect(card.detail).toContain(pay.errors[0].replace(/^[^:]*:\s*/, "").slice(0, 20));
    }
  });
});

describe("employeeAchCard states", () => {
  it("before 0258: shows the legacy account masked and never nags", () => {
    const c = employeeAchCard({ ...base, tableReady: false, legacy });
    expect(c).toMatchObject({ state: "not_ready", needsSignedForm: false, accounts: [], historyCount: 0 });
    expect(c.detail).toContain("••••4321");
    expect(c.detail).not.toContain("555554321");
  });
  it("no authorization + legacy banking: payroll still pays, card asks for the signed form (Q10)", () => {
    const c = employeeAchCard({ ...base, legacy });
    expect(c).toMatchObject({ state: "legacy_only", tone: "gold", needsSignedForm: true });
  });
  it("inactive employees are not nagged for a form", () => {
    expect(employeeAchCard({ ...base, legacy, employeeActive: false }).needsSignedForm).toBe(false);
    expect(employeeAchCard({ ...base, employeeActive: false }).needsSignedForm).toBe(false);
  });
  it("nothing at all: not in the file", () => {
    expect(employeeAchCard({ ...base })).toMatchObject({ state: "no_banking", needsSignedForm: true });
  });
  it("split shows rules, mask and the $0 leg", () => {
    const c = employeeAchCard({
      ...base,
      plan: {
        state: "active",
        accounts: [
          acct({ priority: 1, rule: { kind: "fixed", cents: 150_000 }, accountNumber: "98761111" }),
          acct({ priority: 2, rule: { kind: "remainder" }, accountNumber: "98762222", accountType: "savings" }),
        ],
      },
      historyCount: 3,
    });
    expect(c.accounts).toEqual([
      { priority: 1, where: "••••1111 (checking)", rule: "$1500.00 fixed", verified: true, sampleCents: 100_000 },
      { priority: 2, where: "••••2222 (savings)", rule: "the rest", verified: true, sampleCents: 0 },
    ]);
    expect(c.historyCount).toBe(3);
    expect(c.label).toBe("Split deposit · 2 accounts");
  });
  it("remainder account at priority 1 is shown its share (allocateSplit puts it last)", () => {
    const c = employeeAchCard({
      ...base,
      plan: {
        state: "active",
        accounts: [
          acct({ priority: 1, rule: { kind: "remainder" }, accountNumber: "7001" }),
          acct({ priority: 2, rule: { kind: "fixed", cents: 25_000 }, accountNumber: "7002" }),
        ],
      },
    });
    expect(c.accounts.map((a) => [a.priority, a.sampleCents])).toEqual([[1, 75_000], [2, 25_000]]);
  });
  it("a skipped $0 leg before a same-number account of another type is not mis-matched", () => {
    const c = employeeAchCard({
      ...base,
      plan: {
        state: "active",
        accounts: [
          acct({ priority: 1, rule: { kind: "fixed", cents: 200_000 }, accountNumber: "8001", accountType: "checking" }),
          acct({ priority: 2, rule: { kind: "percent", basisPoints: 1000 }, accountNumber: "8002", accountType: "savings" }),
          acct({ priority: 3, rule: { kind: "remainder" }, accountNumber: "8001", accountType: "savings" }),
        ],
      },
    });
    expect(c.accounts.map((a) => a.sampleCents)).toEqual([100_000, 0, 0]);
  });
  it("past authorizations are counted even with no open authorization", () => {
    expect(employeeAchCard({ ...base, legacy, historyCount: 2 }).historyCount).toBe(2);
    expect(employeeAchCard({ ...base, historyCount: 1 }).historyCount).toBe(1);
  });
  it("the same account number on two types still matches its own row", () => {
    const c = employeeAchCard({
      ...base,
      plan: {
        state: "active",
        accounts: [
          acct({ priority: 1, rule: { kind: "fixed", cents: 30_000 }, accountNumber: "4444", accountType: "checking" }),
          acct({ priority: 2, rule: { kind: "remainder" }, accountNumber: "4444", accountType: "savings" }),
        ],
      },
    });
    expect(c.accounts.map((a) => a.sampleCents)).toEqual([30_000, 70_000]);
  });
});

describe("describeRule", () => {
  it.each<[SplitDepositAccount["rule"], string]>([
    [{ kind: "fixed", cents: 1 }, "$0.01 fixed"],
    [{ kind: "percent", basisPoints: 100 }, "1% of net"],
    [{ kind: "percent", basisPoints: 3333 }, "33.33% of net"],
    [{ kind: "remainder" }, "the rest"],
  ])("%j -> %s", (rule, want) => expect(describeRule(rule)).toBe(want));
});

describe("embedded self-tests", () => {
  it("all pass with the floor", () => {
    const r = __runEmployeeAchCardTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(28);
  });
});
