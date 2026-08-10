/**
 * tests/compliance/atm-reconcile-core.test.ts
 *
 * Vitest mirror of the PURE ATM reconciliation engine (P6a). Confirms the two
 * deposit legs (vault cash + surcharge) match the ATM bank account's deposits
 * within the T+1..T+3 window, the tolerance band, awaiting-vs-unmatched, and the
 * summary/allClear verdict. All money is integer cents; deposits are money-IN.
 */
import { describe, expect, it } from "vitest";
import {
  reconcileSettlements,
  toBankDeposits,
  toleranceCentsFor,
  legLabel,
  isoWithin,
  formatDiff,
  __runAtmReconcileCoreTests,
  type ReconcileSettlement,
  type BankDeposit,
} from "@/lib/atm/atm-reconcile-core";

const settlement: ReconcileSettlement = {
  settlementId: "s1",
  settlementDate: "2025-03-03", // Monday → window Tue..Thu 03-04..03-06
  terminalId: "HG26499",
  terminalTransactionCents: 180000,
  surchargeCents: 4500,
};

describe("atm-reconcile-core harness parity", () => {
  it("runs the embedded self-tests without throwing", () => {
    expect(() => __runAtmReconcileCoreTests()).not.toThrow();
  });
});

describe("pure helpers", () => {
  it("labels legs and formats signed differences", () => {
    expect(legLabel("transaction")).toBe("Vault cash");
    expect(legLabel("surcharge")).toBe("Surcharge");
    expect(formatDiff(50)).toBe("+$0.50");
    expect(formatDiff(-200)).toBe("−$2.00");
    expect(formatDiff(0)).toBe("$0.00");
  });

  it("computes the tolerance band as max(flat, percent)", () => {
    expect(toleranceCentsFor(180000)).toBe(3600); // 2% of $1,800
    expect(toleranceCentsFor(4500)).toBe(500); // floor $5 wins over 90c
    expect(isoWithin("2025-03-05", "2025-03-04", "2025-03-06")).toBe(true);
    expect(isoWithin("2025-03-07", "2025-03-04", "2025-03-06")).toBe(false);
  });

  it("keeps only inflows and flips them positive", () => {
    const deps = toBankDeposits([
      { transactionId: "in", amountCents: -180000, date: "2025-03-04", name: "PAI", merchantName: null, pending: false },
      { transactionId: "out", amountCents: 5000, date: "2025-03-04", name: "xfer", merchantName: null, pending: false },
    ]);
    expect(deps).toHaveLength(1);
    expect(deps[0].amountCents).toBe(180000);
  });
});

describe("two-leg matching", () => {
  it("matches both legs to separate deposits and ties out", () => {
    const deposits: BankDeposit[] = [
      { transactionId: "d1", amountCents: 180000, date: "2025-03-04", description: "cash", pending: false },
      { transactionId: "d2", amountCents: 4500, date: "2025-03-05", description: "surch", pending: false },
    ];
    const res = reconcileSettlements([settlement], deposits, { todayIso: "2025-03-20" });
    expect(res.summary.matched).toBe(2);
    expect(res.summary.allClear).toBe(true);
    expect(res.summary.netDifferenceCents).toBe(0);
  });

  it("never lets two legs claim the same deposit", () => {
    const deposits: BankDeposit[] = [
      { transactionId: "d1", amountCents: 180000, date: "2025-03-04", description: "cash", pending: false },
    ];
    const res = reconcileSettlements([settlement], deposits, { todayIso: "2025-03-20" });
    const txn = res.legs.find((l) => l.leg === "transaction")!;
    const sur = res.legs.find((l) => l.leg === "surcharge")!;
    expect(txn.bankTransactionId).toBe("d1");
    expect(sur.bankTransactionId).toBeNull();
    expect(sur.status).toBe("unmatched");
  });

  it("flags a near-miss as mismatch and an amount too far off as unmatched", () => {
    const near = reconcileSettlements([{ ...settlement, surchargeCents: null }], [
      { transactionId: "d1", amountCents: 179970, date: "2025-03-04", description: "cash", pending: false }, // 30c off
    ], { todayIso: "2025-03-20" });
    expect(near.legs[0].status).toBe("mismatch");
    expect(near.legs[0].differenceCents).toBe(-30);

    const far = reconcileSettlements([{ ...settlement, surchargeCents: null }], [
      { transactionId: "d1", amountCents: 170000, date: "2025-03-04", description: "cash", pending: false }, // $100 off
    ], { todayIso: "2025-03-20" });
    expect(far.legs[0].status).toBe("unmatched");
    expect(far.unexplainedDeposits).toHaveLength(1);
  });
});

describe("awaiting vs unmatched", () => {
  it("is awaiting inside the window and unmatched after it", () => {
    const open = reconcileSettlements([settlement], [], { todayIso: "2025-03-05" });
    expect(open.legs.every((l) => l.status === "awaiting")).toBe(true);
    expect(open.summary.allClear).toBe(true); // nothing wrong yet

    const closed = reconcileSettlements([settlement], [], { todayIso: "2025-03-20" });
    expect(closed.legs.every((l) => l.status === "unmatched")).toBe(true);
    expect(closed.summary.allClear).toBe(false);
    expect(closed.legs[0].windowLatest).toBe("2025-03-06");
  });
});

describe("view ordering", () => {
  it("shows newest settlement first, vault-cash leg before surcharge", () => {
    const older = { ...settlement, settlementId: "old", settlementDate: "2025-03-01" };
    const newer = { ...settlement, settlementId: "new", settlementDate: "2025-03-10" };
    const res = reconcileSettlements([older, newer], [], { todayIso: "2025-04-01" });
    expect(res.legs[0].settlementId).toBe("new");
    expect(res.legs[0].leg).toBe("transaction");
    expect(res.legs[1].leg).toBe("surcharge");
    expect(res.legs[2].settlementId).toBe("old");
  });
});
