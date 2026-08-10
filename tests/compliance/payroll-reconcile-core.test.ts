/**
 * tests/compliance/payroll-reconcile-core.test.ts
 *
 * Vitest mirror of the PURE payroll reconciliation engine (P6b). Confirms each
 * completed run matches the single lump-sum ACH withdrawal that leaves the Main
 * operating account, the tolerance band, awaiting-vs-unmatched, newest-first
 * view ordering, and the summary/allClear verdict. All money is integer cents;
 * withdrawals are money-OUT (Plaid positive).
 */
import { describe, expect, it } from "vitest";
import {
  reconcilePayroll,
  toBankWithdrawals,
  toleranceCentsFor,
  isoWithin,
  formatDiff,
  __runPayrollReconcileCoreTests,
  type ReconcileRun,
  type BankWithdrawal,
} from "@/lib/payroll/payroll-reconcile-core";
import {
  payrollReconcileChip,
  payrollReconcileHeadline,
  __runPayrollUiCoreTests,
} from "@/lib/payroll/payroll-ui-core";

describe("payroll-reconcile-core harness parity", () => {
  it("runs the embedded core self-tests without throwing", () => {
    expect(() => __runPayrollReconcileCoreTests()).not.toThrow();
  });
  it("runs the embedded ui self-tests without throwing", () => {
    expect(() => __runPayrollUiCoreTests()).not.toThrow();
  });
});

describe("pure helpers", () => {
  it("keeps only outflows and prefers merchant name", () => {
    const ws = toBankWithdrawals([
      { transactionId: "o1", amountCents: 1200000, date: "2026-07-06", name: "ACH", merchantName: "TIMBERLAND", pending: false },
      { transactionId: "i1", amountCents: -50000, date: "2026-07-06", name: "DEP", merchantName: null, pending: false },
    ]);
    expect(ws).toHaveLength(1);
    expect(ws[0].amountCents).toBe(1200000);
    expect(ws[0].description).toBe("TIMBERLAND");
  });

  it("formats signed differences with a unicode minus", () => {
    expect(formatDiff(0)).toBe("$0.00");
    expect(formatDiff(50)).toBe("+$0.50");
    expect(formatDiff(-200)).toBe("−$2.00");
  });

  it("computes the tolerance band (floor vs percent)", () => {
    expect(toleranceCentsFor(10000)).toBe(500); // $5 floor
    expect(toleranceCentsFor(1200000)).toBe(24000); // 2% of $12k
  });

  it("checks ISO window inclusion", () => {
    expect(isoWithin("2026-07-07", "2026-07-06", "2026-07-08")).toBe(true);
    expect(isoWithin("2026-07-09", "2026-07-06", "2026-07-08")).toBe(false);
  });
});

const run = (over: Partial<ReconcileRun> = {}): ReconcileRun => ({
  runId: "r1",
  label: "PPE",
  payDate: "2026-07-06",
  totalNetCents: 1200000,
  status: "file_generated",
  entryCount: 8,
  ...over,
});

describe("single-run matching", () => {
  it("matches an exact withdrawal on the pay date", () => {
    const withdrawals: BankWithdrawal[] = [
      { transactionId: "w1", amountCents: 1200000, date: "2026-07-06", description: "ACH", pending: false },
    ];
    const res = reconcilePayroll([run()], withdrawals, { todayIso: "2026-07-20" });
    expect(res.runs[0].status).toBe("matched");
    expect(res.runs[0].differenceCents).toBe(0);
    expect(res.summary.allClear).toBe(true);
  });

  it("flags a mismatch within tolerance", () => {
    const withdrawals: BankWithdrawal[] = [
      { transactionId: "w1", amountCents: 1200050, date: "2026-07-07", description: "ACH", pending: false },
    ];
    const res = reconcilePayroll([run()], withdrawals, { todayIso: "2026-07-20" });
    expect(res.runs[0].status).toBe("mismatch");
    expect(res.runs[0].differenceCents).toBe(50);
    expect(res.summary.allClear).toBe(false);
  });

  it("is awaiting inside the window, unmatched after it passes", () => {
    const awaitingRes = reconcilePayroll([run()], [], { todayIso: "2026-07-06" });
    expect(awaitingRes.runs[0].status).toBe("awaiting");
    expect(awaitingRes.summary.allClear).toBe(true);

    const unmatchedRes = reconcilePayroll([run()], [], { todayIso: "2026-07-20" });
    expect(unmatchedRes.runs[0].status).toBe("unmatched");
    expect(unmatchedRes.summary.allClear).toBe(false);
  });

  it("never matches a far-off debit; it becomes unexplained", () => {
    const withdrawals: BankWithdrawal[] = [
      { transactionId: "fee", amountCents: 4000, date: "2026-07-07", description: "FEE", pending: false },
    ];
    const res = reconcilePayroll([run()], withdrawals, { todayIso: "2026-07-20" });
    expect(res.runs[0].status).toBe("unmatched");
    expect(res.unexplainedDebits.map((w) => w.transactionId)).toEqual(["fee"]);
  });
});

describe("multi-run behavior + view ordering", () => {
  it("gives each run its own debit and orders newest pay date first", () => {
    const runs = [
      run({ runId: "r1", payDate: "2026-07-06", totalNetCents: 1000000 }),
      run({ runId: "r2", payDate: "2026-07-20", totalNetCents: 1000000 }),
    ];
    const withdrawals: BankWithdrawal[] = [
      { transactionId: "wA", amountCents: 1000000, date: "2026-07-06", description: "ACH", pending: false },
      { transactionId: "wB", amountCents: 1000000, date: "2026-07-20", description: "ACH", pending: false },
    ];
    const res = reconcilePayroll(runs, withdrawals, { todayIso: "2026-07-31" });
    expect(res.summary.matched).toBe(2);
    expect(res.runs[0].runId).toBe("r2");
    expect(res.runs[1].runId).toBe("r1");
    expect(res.runs[0].matchedTransactionId).toBe("wB");
    expect(res.runs[1].matchedTransactionId).toBe("wA");
    expect(res.unexplainedDebits).toHaveLength(0);
  });

  it("skips zero-amount runs entirely", () => {
    const runs = [
      run({ runId: "r0", totalNetCents: 0 }),
      run({ runId: "r1", totalNetCents: 500000 }),
    ];
    const withdrawals: BankWithdrawal[] = [
      { transactionId: "w1", amountCents: 500000, date: "2026-07-06", description: "ACH", pending: false },
    ];
    const res = reconcilePayroll(runs, withdrawals, { todayIso: "2026-07-20" });
    expect(res.summary.runCount).toBe(1);
    expect(res.runs[0].runId).toBe("r1");
    expect(res.runs[0].status).toBe("matched");
  });
});

describe("ui-core chips + headline", () => {
  it("maps statuses to plain-English chips", () => {
    expect(payrollReconcileChip("matched").label).toBe("Cleared");
    expect(payrollReconcileChip("matched").needsAttention).toBe(false);
    expect(payrollReconcileChip("mismatch").needsAttention).toBe(true);
    expect(payrollReconcileChip("awaiting").tone).toBe("neutral");
    expect(payrollReconcileChip("unmatched").needsAttention).toBe(true);
  });

  it("produces the right headline tone", () => {
    expect(payrollReconcileHeadline({ allClear: true, runCount: 0, mismatch: 0, unmatched: 0, awaiting: 0 }).tone).toBe("neutral");
    expect(payrollReconcileHeadline({ allClear: true, runCount: 2, mismatch: 0, unmatched: 0, awaiting: 0 }).tone).toBe("green");
    expect(payrollReconcileHeadline({ allClear: false, runCount: 2, mismatch: 1, unmatched: 1, awaiting: 0 }).tone).toBe("orange");
  });
});
