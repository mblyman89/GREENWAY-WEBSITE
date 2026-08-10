/**
 * tests/compliance/plaid-money-core.test.ts
 *
 * Vitest mirror of the PURE Plaid money-view core (Slice P5): sidebar grouping,
 * date-range math, money-in/out/net, category breakdown, activity/pending rows,
 * and the tab/range resolvers. All money is integer cents with Plaid's sign
 * preserved (positive = out, negative = in). No I/O here.
 */
import { describe, expect, it } from "vitest";
import {
  institutionLabel,
  groupAccountsByInstitution,
  resolveSelectedAccountId,
  resolveMoneyRange,
  moneyRangeLabel,
  moneyRangeBounds,
  dateInRange,
  filterTxnsInRange,
  computeMoneyFlow,
  formatNetCentsUsd,
  computeCategoryBreakdown,
  categoryLabel,
  buildActivityRows,
  buildPendingRows,
  resolveMoneyView,
  moneyViewLabel,
  __runPlaidMoneyCoreTests,
  type GroupableAccount,
  type MoneyTxn,
} from "@/lib/plaid/plaid-money-core";

const acct = (over: Partial<GroupableAccount> & { accountId: string }): GroupableAccount => ({
  institutionName: null,
  displayName: "Account",
  maskText: "—",
  currentText: "$0.00",
  currentBalanceCents: 0,
  role: null,
  ...over,
});

const txn = (over: Partial<MoneyTxn> & { transactionId: string; amountCents: number; date: string }): MoneyTxn => ({
  accountId: "a1",
  name: null,
  merchantName: null,
  categoryPrimary: null,
  categoryDetailed: null,
  pending: false,
  paymentChannel: null,
  ...over,
});

describe("plaid-money-core harness parity", () => {
  it("runs the embedded self-tests without throwing", () => {
    expect(() => __runPlaidMoneyCoreTests()).not.toThrow();
  });
});

describe("institution grouping", () => {
  it("labels blanks as Other accounts and collapses whitespace", () => {
    expect(institutionLabel("Timberland")).toBe("Timberland");
    expect(institutionLabel("  Citi  Bank ")).toBe("Citi Bank");
    expect(institutionLabel(null)).toBe("Other accounts");
    expect(institutionLabel("   ")).toBe("Other accounts");
  });

  it("groups by institution, sorts groups and accounts, and subtotals balances", () => {
    const groups = groupAccountsByInstitution([
      acct({ accountId: "a1", institutionName: "Timberland", displayName: "Checking", currentBalanceCents: 100000 }),
      acct({ accountId: "a2", institutionName: "Citi", displayName: "Visa", currentBalanceCents: -50000 }),
      acct({ accountId: "a3", institutionName: "Timberland", displayName: "ATM", currentBalanceCents: 25000 }),
      acct({ accountId: "a4", institutionName: null, displayName: "Cash", currentBalanceCents: null }),
    ]);
    expect(groups.map((g) => g.institutionName)).toEqual(["Citi", "Other accounts", "Timberland"]);
    const tb = groups[2];
    expect(tb.accounts.map((a) => a.displayName)).toEqual(["ATM", "Checking"]);
    expect(tb.subtotalCents).toBe(125000);
    expect(tb.subtotalText).toBe("$1,250.00");
    expect(groups[1].subtotalCents).toBe(0); // null balance contributes nothing
  });

  it("resolves the selected account id with sensible fallbacks", () => {
    const groups = groupAccountsByInstitution([
      acct({ accountId: "a2", institutionName: "Citi" }),
      acct({ accountId: "a1", institutionName: "Timberland" }),
    ]);
    expect(resolveSelectedAccountId("a1", groups)).toBe("a1");
    expect(resolveSelectedAccountId("ghost", groups)).toBe("a2"); // first of first group (Citi)
    expect(resolveSelectedAccountId(null, groups)).toBe("a2");
    expect(resolveSelectedAccountId("a1", [])).toBeNull();
  });
});

describe("date ranges", () => {
  it("resolves range keys with a this_month default", () => {
    expect(resolveMoneyRange(undefined)).toBe("this_month");
    expect(resolveMoneyRange("ALL")).toBe("all");
    expect(resolveMoneyRange("nope")).toBe("this_month");
    expect(moneyRangeLabel("last_month")).toBe("Last month");
  });

  it("computes inclusive bounds, handling leap years and year rollover", () => {
    expect(moneyRangeBounds("this_month", "2025-03-15")).toEqual({ start: "2025-03-01", end: "2025-03-31" });
    expect(moneyRangeBounds("this_month", "2024-02-10")).toEqual({ start: "2024-02-01", end: "2024-02-29" });
    expect(moneyRangeBounds("last_month", "2025-01-05")).toEqual({ start: "2024-12-01", end: "2024-12-31" });
    expect(moneyRangeBounds("this_year", "2025-07-04")).toEqual({ start: "2025-01-01", end: "2025-12-31" });
    expect(moneyRangeBounds("all", "2025-07-04")).toEqual({ start: null, end: null });
    expect(moneyRangeBounds("this_month", "bad")).toEqual({ start: null, end: null });
  });

  it("filters transactions to a range and skips removed rows", () => {
    expect(dateInRange("2025-03-15", "2025-03-01", "2025-03-31")).toBe(true);
    expect(dateInRange("2025-04-01", "2025-03-01", "2025-03-31")).toBe(false);
    expect(dateInRange("2025-03-15", null, null)).toBe(true);
    const kept = filterTxnsInRange(
      [
        txn({ transactionId: "t1", amountCents: 100, date: "2025-03-02" }),
        txn({ transactionId: "t2", amountCents: 100, date: "2025-02-20" }),
        txn({ transactionId: "t3", amountCents: 100, date: "2025-03-05", removed: true }),
      ],
      "2025-03-01",
      "2025-03-31",
    );
    expect(kept.map((t) => t.transactionId)).toEqual(["t1"]);
  });
});

describe("money flow (in/out/net)", () => {
  it("sums magnitudes by direction and signs the net", () => {
    const flow = computeMoneyFlow([
      txn({ transactionId: "t1", amountCents: 5000, date: "2025-03-02" }), // out
      txn({ transactionId: "t2", amountCents: -120000, date: "2025-03-05" }), // in
      txn({ transactionId: "t3", amountCents: 2599, date: "2025-03-10" }), // out
    ]);
    expect(flow.inflowCents).toBe(120000);
    expect(flow.outflowCents).toBe(7599);
    expect(flow.netCents).toBe(112401);
    expect(flow.netText).toBe("+$1,124.01");
    expect(flow.count).toBe(3);
  });

  it("formats net with sign", () => {
    expect(formatNetCentsUsd(112401)).toBe("+$1,124.01");
    expect(formatNetCentsUsd(-5000)).toBe("-$50.00");
    expect(formatNetCentsUsd(0)).toBe("$0.00");
    expect(formatNetCentsUsd(Number.NaN)).toBe("—");
  });

  it("returns all zeros for an empty set", () => {
    const flow = computeMoneyFlow([]);
    expect([flow.inflowCents, flow.outflowCents, flow.netCents]).toEqual([0, 0, 0]);
  });
});

describe("category breakdown (outflows only)", () => {
  it("groups outflows biggest-first with percents summing to 100", () => {
    const cats = computeCategoryBreakdown([
      txn({ transactionId: "t1", amountCents: 5000, date: "2025-03-02", categoryPrimary: "RENT_AND_UTILITIES" }),
      txn({ transactionId: "t2", amountCents: 2599, date: "2025-03-10", categoryPrimary: "FOOD_AND_DRINK" }),
      txn({ transactionId: "t3", amountCents: -120000, date: "2025-03-05", categoryPrimary: "INCOME" }), // inflow ignored
    ]);
    expect(cats.map((c) => c.category)).toEqual(["Rent And Utilities", "Food And Drink"]);
    expect(cats[0].amountCents).toBe(5000);
    expect(cats[0].percent + cats[1].percent).toBe(100);
    expect(computeCategoryBreakdown([]).length).toBe(0);
  });

  it("labels categories in Title Case with Uncategorized fallback", () => {
    expect(categoryLabel(null)).toBe("Uncategorized");
    expect(categoryLabel("GENERAL_MERCHANDISE")).toBe("General Merchandise");
  });
});

describe("activity + pending rows", () => {
  const rows = [
    txn({ transactionId: "t1", amountCents: 5000, date: "2025-03-02", name: "Rent", categoryPrimary: "RENT_AND_UTILITIES" }),
    txn({ transactionId: "t2", amountCents: -120000, date: "2025-03-05", name: "Deposit" }),
    txn({ transactionId: "t3", amountCents: 2599, date: "2025-03-10", name: "Coffee", merchantName: "Starbucks", pending: true }),
    txn({ transactionId: "t4", amountCents: 100, date: "2025-03-11", removed: true }),
  ];

  it("builds signed activity rows and prefers merchant over name", () => {
    const built = buildActivityRows(rows);
    expect(built.map((r) => r.transactionId)).toEqual(["t1", "t2", "t3"]); // removed dropped
    expect(built.find((r) => r.transactionId === "t2")!.amountText).toBe("+$1,200.00");
    expect(built.find((r) => r.transactionId === "t1")!.amountText).toBe("-$50.00");
    expect(built.find((r) => r.transactionId === "t3")!.description).toBe("Starbucks");
    expect(built.find((r) => r.transactionId === "t2")!.description).toBe("Deposit");
  });

  it("returns only pending rows", () => {
    const pend = buildPendingRows(rows);
    expect(pend.map((r) => r.transactionId)).toEqual(["t3"]);
  });
});

describe("money-view resolver", () => {
  it("defaults to activity and labels the four views", () => {
    expect(resolveMoneyView(undefined)).toBe("activity");
    expect(resolveMoneyView("CATEGORIES")).toBe("categories");
    expect(resolveMoneyView("nope")).toBe("activity");
    expect(moneyViewLabel("flow")).toBe("Money in & out");
    expect(moneyViewLabel("categories")).toBe("Where it goes");
    expect(moneyViewLabel("activity")).toBe("Activity");
    expect(moneyViewLabel("pending")).toBe("Pending");
  });
});
