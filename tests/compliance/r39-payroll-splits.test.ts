/**
 * R39 S3 — payroll split deposits (owner answers Q4 credits only + Q11 up to
 * 3 accounts). Pins planPayrollEntries + rowsToDepositPlans in payroll-core.
 */
import { describe, expect, it } from "vitest";
import {
  planPayrollEntries,
  rowsToDepositPlans,
  type EmployeeDepositPlan,
  type PayrollLineInput,
  type SplitDepositAccount,
  type DepositAcctRow,
} from "@/lib/payroll/payroll-core";

const R1 = "125000105";
const R2 = "021000021";

function line(over: Partial<PayrollLineInput> = {}): PayrollLineInput {
  return {
    employeeId: "emp-1",
    employeeName: "Ann Able",
    netPayCents: 100_000,
    accountType: "checking",
    routing: R1,
    accountNumber: "111111",
    ...over,
  };
}

function acct(over: Partial<SplitDepositAccount> = {}): SplitDepositAccount {
  return {
    priority: 1,
    rule: { kind: "remainder" },
    routing: R2,
    accountNumber: "999999",
    accountType: "checking",
    verificationStatus: "verified",
    ...over,
  };
}

function plans(entries: [string, EmployeeDepositPlan][]): Map<string, EmployeeDepositPlan> {
  return new Map(entries);
}

describe("planPayrollEntries — no authorization on file", () => {
  it("pays the single employee-record account and says so", () => {
    const r = planPayrollEntries([line()], plans([]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ routing: R1, accountNumber: "111111", amountCents: 100_000, name: "Ann Able" });
    expect(r.notes.join(" ")).toMatch(/no signed ACH authorization/);
    expect(r.perEmployee).toEqual([{ employeeId: "emp-1", entries: 1, split: false }]);
  });
});

describe("planPayrollEntries — authorization on file", () => {
  it("uses the vault account, not the employee record, for a single active account", () => {
    const r = planPayrollEntries([line()], plans([["emp-1", { state: "active", accounts: [acct()] }]]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ routing: R2, accountNumber: "999999", amountCents: 100_000 });
    expect(r.notes).toEqual([]);
    expect(r.perEmployee).toEqual([{ employeeId: "emp-1", entries: 1, split: false }]);
  });

  it("splits fixed + percent + remainder by priority and sums to net exactly", () => {
    const p: EmployeeDepositPlan = {
      state: "active",
      accounts: [
        acct({ priority: 1, rule: { kind: "fixed", cents: 20_000 }, accountNumber: "1001" }),
        acct({ priority: 2, rule: { kind: "percent", basisPoints: 3333 }, accountNumber: "1002", accountType: "savings" }),
        acct({ priority: 3, rule: { kind: "remainder" }, accountNumber: "1003" }),
      ],
    };
    const r = planPayrollEntries([line({ netPayCents: 100_001 })], plans([["emp-1", p]]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries.map((e) => [e.accountNumber, e.amountCents, e.accountType])).toEqual([
      ["1001", 20_000, "checking"],
      ["1002", 33_330, "savings"], // floor(100001 * 3333 / 10000) = 33330
      ["1003", 46_671, "checking"],
    ]);
    expect(r.entries.reduce((t, e) => t + e.amountCents, 0)).toBe(100_001);
    expect(r.perEmployee).toEqual([{ employeeId: "emp-1", entries: 3, split: true }]);
    expect(r.entries.every((e) => e.idNumber === "emp-1" && e.name === "Ann Able")).toBe(true);
  });

  it("skips a $0 leg with a note instead of a $0 live credit", () => {
    const p: EmployeeDepositPlan = {
      state: "active",
      accounts: [
        acct({ priority: 1, rule: { kind: "fixed", cents: 500_000 }, accountNumber: "2001" }),
        acct({ priority: 2, rule: { kind: "remainder" }, accountNumber: "2002" }),
      ],
    };
    const r = planPayrollEntries([line()], plans([["emp-1", p]]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ accountNumber: "2001", amountCents: 100_000 });
    expect(r.entries.some((e) => e.amountCents === 0)).toBe(false);
    expect(r.notes.join(" ")).toMatch(/ending 2002 gets \$0\.00/);
    expect(r.perEmployee[0]).toEqual({ employeeId: "emp-1", entries: 1, split: true });
  });

  it.each(["draft", "signed", "verifying", "on_hold", "revoked", "archived"])("blocks state %s", (state) => {
    const r = planPayrollEntries([line()], plans([["emp-1", { state, accounts: [acct()] }]]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/^Ann Able: /);
  });

  it("blocks an unknown state rather than guessing", () => {
    const r = planPayrollEntries([line()], plans([["emp-1", { state: "Active ", accounts: [acct()] }]]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/not one payroll knows/);
  });

  it("blocks when ANY account on the authorization is unverified", () => {
    const p: EmployeeDepositPlan = {
      state: "active",
      accounts: [
        acct({ priority: 1, rule: { kind: "fixed", cents: 100 }, accountNumber: "3001" }),
        acct({ priority: 2, rule: { kind: "remainder" }, accountNumber: "3002", verificationStatus: "pending" }),
      ],
    };
    const r = planPayrollEntries([line()], plans([["emp-1", p]]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/1 deposit account\(s\) not verified/);
  });

  it("blocks a bad routing number or an empty account number (e.g. missing key)", () => {
    const badRouting = planPayrollEntries([line()], plans([["emp-1", { state: "active", accounts: [acct({ routing: "125000106" })] }]]));
    expect(badRouting.ok).toBe(false);
    const emptyAcct = planPayrollEntries([line()], plans([["emp-1", { state: "active", accounts: [acct({ accountNumber: "  " })] }]]));
    expect(emptyAcct.ok).toBe(false);
    if (emptyAcct.ok) return;
    expect(emptyAcct.errors[0]).toMatch(/invalid routing number or no account number/);
  });

  it("blocks an invalid split (no remainder account)", () => {
    const r = planPayrollEntries([line()], plans([["emp-1", { state: "active", accounts: [acct({ rule: { kind: "fixed", cents: 100 } })] }]]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/remainder/);
  });

  it("one blocked employee blocks the whole file (no partial payroll)", () => {
    const r = planPayrollEntries(
      [line(), line({ employeeId: "emp-2", employeeName: "Bob Baker", accountNumber: "222222" })],
      plans([["emp-2", { state: "on_hold", accounts: [acct()] }]]),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/^Bob Baker: On hold/);
  });
});

describe("planPayrollEntries — shared account red flag", () => {
  it("notes (does not block) one account receiving pay for two employees, after normalizing", () => {
    const r = planPayrollEntries(
      [line(), line({ employeeId: "emp-2", employeeName: "Bob Baker", accountNumber: "000111111" })],
      plans([]),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notes.join(" ")).toMatch(/ending 1111 receives pay for Ann Able and Bob Baker/);
  });

  it("does not flag the same name twice or different account types", () => {
    const r = planPayrollEntries(
      [line(), line({ employeeId: "emp-2", employeeName: "Bob Baker", accountType: "savings" })],
      plans([]),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notes.join(" ")).not.toMatch(/receives pay for/);
  });
});

describe("rowsToDepositPlans", () => {
  const dec = (s: string) => s.replace(/^enc:/, "");
  const row = (over: Partial<DepositAcctRow>): DepositAcctRow => ({
    authorization_id: "a1",
    priority: 1,
    rule_kind: "remainder",
    fixed_cents: null,
    basis_points: null,
    routing_enc: `enc:${R2}`,
    account_enc: "enc:999",
    account_type: "checking",
    verification_status: "verified",
    ...over,
  });

  it("maps rule kinds, decrypts, and sorts by priority", () => {
    const m = rowsToDepositPlans(
      [{ id: "a1", employee_id: "emp-1", state: "active" }],
      [
        row({ priority: 3, rule_kind: "remainder", account_enc: "enc:3" }),
        row({ priority: 1, rule_kind: "fixed", fixed_cents: 2500, account_enc: "enc:1" }),
        row({ priority: 2, rule_kind: "percent", basis_points: 1000, account_enc: "enc:2", account_type: "savings" }),
      ],
      dec,
    );
    const p = m.get("emp-1")!;
    expect(p.state).toBe("active");
    expect(p.accounts.map((a) => a.accountNumber)).toEqual(["1", "2", "3"]);
    expect(p.accounts.map((a) => a.rule)).toEqual([
      { kind: "fixed", cents: 2500 },
      { kind: "percent", basisPoints: 1000 },
      { kind: "remainder" },
    ]);
    expect(p.accounts[0].routing).toBe(R2);
    expect(p.accounts[1].accountType).toBe("savings");
  });

  it("keeps accounts with their own authorization only", () => {
    const m = rowsToDepositPlans(
      [
        { id: "a1", employee_id: "emp-1", state: "active" },
        { id: "a2", employee_id: "emp-2", state: "signed" },
      ],
      [row({ authorization_id: "a2", account_enc: "enc:22" })],
      dec,
    );
    expect(m.get("emp-1")!.accounts).toEqual([]);
    expect(m.get("emp-2")!.accounts.map((a) => a.accountNumber)).toEqual(["22"]);
  });

  it("refuses two open authorizations for one employee", () => {
    expect(() =>
      rowsToDepositPlans(
        [
          { id: "a1", employee_id: "emp-1", state: "active" },
          { id: "a2", employee_id: "emp-1", state: "signed" },
        ],
        [],
        dec,
      ),
    ).toThrow(/more than one open ACH authorization/);
  });

  it("an authorization with no accounts then blocks payroll (remainder missing)", () => {
    const m = rowsToDepositPlans([{ id: "a1", employee_id: "emp-1", state: "active" }], [], dec);
    const r = planPayrollEntries([line()], m);
    expect(r.ok).toBe(false);
  });
});
