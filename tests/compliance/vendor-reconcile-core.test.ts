/**
 * tests/compliance/vendor-reconcile-core.test.ts
 *
 * Vitest mirror of the PURE vendor payment ↔ bank reconciliation engine (P7-a).
 * Confirms each recorded ACH/wire vendor payment matches the withdrawal that
 * leaves the Main operating account, the tolerance band, awaiting-vs-unmatched,
 * newest-first view ordering, the method split (cash/check/other are NOT
 * reconciled against the feed), and the summary/allClear verdict. All money is
 * integer cents; withdrawals are money-OUT (Plaid positive).
 */
import { describe, expect, it } from "vitest";
import {
  reconcileVendorPayments,
  toBankWithdrawals,
  toleranceCentsFor,
  isoWithin,
  formatDiff,
  isBankClearingMethod,
  __runVendorReconcileCoreTests,
  type VendorPaymentRecord,
  type BankWithdrawal,
} from "@/lib/payments/vendor-reconcile-core";
import {
  vendorReconcileChip,
  vendorReconcileHeadline,
  vendorMethodLabel,
  __runVendorReconcileUiCoreTests,
} from "@/lib/payments/vendor-reconcile-ui-core";

describe("vendor-reconcile-core harness parity", () => {
  it("runs the embedded core self-tests without throwing", () => {
    expect(() => __runVendorReconcileCoreTests()).not.toThrow();
  });
  it("runs the embedded ui self-tests without throwing", () => {
    expect(() => __runVendorReconcileUiCoreTests()).not.toThrow();
  });
});

describe("method classification", () => {
  it("treats only ach and wire as bank-clearing", () => {
    expect(isBankClearingMethod("ach")).toBe(true);
    expect(isBankClearingMethod("wire")).toBe(true);
    expect(isBankClearingMethod("cash")).toBe(false);
    expect(isBankClearingMethod("check")).toBe(false);
    expect(isBankClearingMethod("other")).toBe(false);
  });
});

describe("pure helpers", () => {
  it("keeps only outflows and prefers merchant name", () => {
    const ws = toBankWithdrawals([
      { transactionId: "o1", amountCents: 900000, date: "2026-07-06", name: "ACH", merchantName: "GROW CO", pending: false },
      { transactionId: "i1", amountCents: -50000, date: "2026-07-06", name: "DEP", merchantName: null, pending: false },
    ]);
    expect(ws).toHaveLength(1);
    expect(ws[0].amountCents).toBe(900000);
    expect(ws[0].description).toBe("GROW CO");
  });

  it("formats signed differences with a unicode minus", () => {
    expect(formatDiff(0)).toBe("$0.00");
    expect(formatDiff(50)).toBe("+$0.50");
    expect(formatDiff(-200)).toBe("−$2.00");
  });

  it("computes the tolerance band (floor vs percent)", () => {
    expect(toleranceCentsFor(10000)).toBe(500); // $5 floor
    expect(toleranceCentsFor(900000)).toBe(18000); // 2% of $9k
  });

  it("checks ISO window inclusion", () => {
    expect(isoWithin("2026-07-07", "2026-07-06", "2026-07-08")).toBe(true);
    expect(isoWithin("2026-07-09", "2026-07-06", "2026-07-08")).toBe(false);
  });
});

describe("reconcileVendorPayments", () => {
  it("matches an exact ACH payment on the paid date", () => {
    const records: VendorPaymentRecord[] = [
      { paymentId: "p1", vendorName: "Grow Co", manifestNumber: "M-100", amountCents: 900000, paidDate: "2026-07-06", method: "ach", reference: "BATCH-1" },
    ];
    const withdrawals: BankWithdrawal[] = [
      { transactionId: "w1", amountCents: 900000, date: "2026-07-06", description: "GROW CO ACH", pending: false },
    ];
    const res = reconcileVendorPayments(records, withdrawals, { todayIso: "2026-07-20" });
    expect(res.payments[0].status).toBe("matched");
    expect(res.payments[0].differenceCents).toBe(0);
    expect(res.summary.allClear).toBe(true);
  });

  it("flags a mismatch within tolerance and reports the signed difference", () => {
    const records: VendorPaymentRecord[] = [
      { paymentId: "p1", vendorName: "Grow Co", manifestNumber: "M-100", amountCents: 900000, paidDate: "2026-07-06", method: "wire", reference: "WIRE-77" },
    ];
    const withdrawals: BankWithdrawal[] = [
      { transactionId: "w1", amountCents: 900050, date: "2026-07-07", description: "WIRE OUT", pending: false },
    ];
    const res = reconcileVendorPayments(records, withdrawals, { todayIso: "2026-07-20" });
    expect(res.payments[0].status).toBe("mismatch");
    expect(res.payments[0].differenceCents).toBe(50);
    expect(res.summary.allClear).toBe(false);
  });

  it("marks awaiting inside the window and unmatched once it passes", () => {
    const records: VendorPaymentRecord[] = [
      { paymentId: "p1", vendorName: "Grow Co", manifestNumber: "M-100", amountCents: 900000, paidDate: "2026-07-06", method: "ach", reference: null },
    ];
    const inside = reconcileVendorPayments(records, [], { todayIso: "2026-07-06" });
    expect(inside.payments[0].status).toBe("awaiting");
    expect(inside.summary.allClear).toBe(true);
    const passed = reconcileVendorPayments(records, [], { todayIso: "2026-07-20" });
    expect(passed.payments[0].status).toBe("unmatched");
    expect(passed.summary.allClear).toBe(false);
  });

  it("never matches a far-off debit; it surfaces as unexplained", () => {
    const records: VendorPaymentRecord[] = [
      { paymentId: "p1", vendorName: "Grow Co", manifestNumber: "M-100", amountCents: 900000, paidDate: "2026-07-06", method: "ach", reference: null },
    ];
    const withdrawals: BankWithdrawal[] = [
      { transactionId: "fee", amountCents: 4000, date: "2026-07-07", description: "FEE", pending: false },
    ];
    const res = reconcileVendorPayments(records, withdrawals, { todayIso: "2026-07-20" });
    expect(res.payments[0].status).toBe("unmatched");
    expect(res.unexplainedDebits).toHaveLength(1);
    expect(res.unexplainedDebits[0].transactionId).toBe("fee");
  });

  it("gives each payment its own debit (no double-claim) and views newest-first", () => {
    const records: VendorPaymentRecord[] = [
      { paymentId: "p1", vendorName: "Grow Co", manifestNumber: "M-100", amountCents: 500000, paidDate: "2026-07-06", method: "ach", reference: null },
      { paymentId: "p2", vendorName: "Grow Co", manifestNumber: "M-101", amountCents: 500000, paidDate: "2026-07-20", method: "ach", reference: null },
    ];
    const withdrawals: BankWithdrawal[] = [
      { transactionId: "wA", amountCents: 500000, date: "2026-07-06", description: "ACH", pending: false },
      { transactionId: "wB", amountCents: 500000, date: "2026-07-20", description: "ACH", pending: false },
    ];
    const res = reconcileVendorPayments(records, withdrawals, { todayIso: "2026-07-31" });
    expect(res.summary.matched).toBe(2);
    expect(res.payments[0].paymentId).toBe("p2");
    expect(res.payments[0].matchedTransactionId).toBe("wB");
    expect(res.payments[1].matchedTransactionId).toBe("wA");
  });

  it("splits cash/check/other into a separate bucket that never blocks all-clear", () => {
    const records: VendorPaymentRecord[] = [
      { paymentId: "pc", vendorName: "Cash Vendor", manifestNumber: "M-CASH", amountCents: 120000, paidDate: "2026-07-06", method: "cash", reference: "vault" },
      { paymentId: "pk", vendorName: "Check Vendor", manifestNumber: "M-CHK", amountCents: 250000, paidDate: "2026-07-04", method: "check", reference: "#1042" },
      { paymentId: "po", vendorName: "Other Vendor", manifestNumber: "M-OTH", amountCents: 33000, paidDate: "2026-07-05", method: "other", reference: null },
      { paymentId: "pa", vendorName: "ACH Vendor", manifestNumber: "M-ACH", amountCents: 700000, paidDate: "2026-07-06", method: "ach", reference: null },
    ];
    const withdrawals: BankWithdrawal[] = [
      { transactionId: "wA", amountCents: 700000, date: "2026-07-06", description: "ACH", pending: false },
    ];
    const res = reconcileVendorPayments(records, withdrawals, { todayIso: "2026-07-20" });
    expect(res.summary.paymentCount).toBe(1);
    expect(res.payments[0].paymentId).toBe("pa");
    expect(res.summary.otherMethodCount).toBe(3);
    expect(res.summary.otherMethodCents).toBe(403000);
    expect(res.summary.allClear).toBe(true);
  });

  it("skips zero/invalid amounts entirely", () => {
    const records: VendorPaymentRecord[] = [
      { paymentId: "p0", vendorName: "Empty", manifestNumber: "M-000", amountCents: 0, paidDate: "2026-07-06", method: "ach", reference: null },
      { paymentId: "p1", vendorName: "Real", manifestNumber: "M-100", amountCents: 500000, paidDate: "2026-07-06", method: "ach", reference: null },
    ];
    const withdrawals: BankWithdrawal[] = [
      { transactionId: "w1", amountCents: 500000, date: "2026-07-06", description: "ACH", pending: false },
    ];
    const res = reconcileVendorPayments(records, withdrawals, { todayIso: "2026-07-20" });
    expect(res.summary.paymentCount).toBe(1);
    expect(res.summary.otherMethodCount).toBe(0);
    expect(res.payments[0].status).toBe("matched");
  });
});

describe("ui-core chips + headline + method labels", () => {
  it("chips carry the right tone and attention flag", () => {
    expect(vendorReconcileChip("matched").tone).toBe("green");
    expect(vendorReconcileChip("matched").needsAttention).toBe(false);
    expect(vendorReconcileChip("mismatch").needsAttention).toBe(true);
    expect(vendorReconcileChip("awaiting").tone).toBe("neutral");
    expect(vendorReconcileChip("unmatched").needsAttention).toBe(true);
  });

  it("labels methods in plain English with an Other fallback", () => {
    expect(vendorMethodLabel("ach")).toBe("ACH");
    expect(vendorMethodLabel("wire")).toBe("Wire");
    expect(vendorMethodLabel("check")).toBe("Check");
    expect(vendorMethodLabel("cash")).toBe("Cash");
    expect(vendorMethodLabel("mystery")).toBe("Other");
  });

  it("headline reflects empty / all-clear / attention states", () => {
    expect(vendorReconcileHeadline({ allClear: true, paymentCount: 0, mismatch: 0, unmatched: 0, awaiting: 0 }).tone).toBe("neutral");
    expect(vendorReconcileHeadline({ allClear: true, paymentCount: 3, mismatch: 0, unmatched: 0, awaiting: 0 }).tone).toBe("green");
    const attn = vendorReconcileHeadline({ allClear: false, paymentCount: 3, mismatch: 1, unmatched: 2, awaiting: 0 });
    expect(attn.tone).toBe("orange");
    expect(attn.detail).toContain("2 payments never cleared");
  });
});
