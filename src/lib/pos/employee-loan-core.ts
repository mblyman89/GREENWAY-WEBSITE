/**
 * Employee product loans (Register S5) — pure logic.
 *
 * Owner request (verbatim, todo.md): "I want to add to the employee purchase
 * feature an additional button, for paying later. if they are to pay for it
 * later, it is an employee product loan, and I want to keep track of these
 * unpaid for products and then deduct it from their pay if over n number of
 * days old, a setting in the admin somewhere for owners and admin to set."
 *
 * A pay-later sale is recorded with paymentMethod "employee_tab" (no cash in
 * the drawer) and opens one row in employee_product_loans (0302). A loan is
 * "due for deduction" once it is older than the owner's N days and still open.
 * Money in cents; days counted on the Pacific calendar.
 */

export const LOAN_STATUSES = ["open", "paid", "deducted", "forgiven"] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

export const LOAN_STATUS_LABELS: Record<LoanStatus, string> = {
  open: "Open (unpaid)",
  paid: "Paid in cash",
  deducted: "Deducted from pay",
  forgiven: "Forgiven",
};

export const DEFAULT_LOAN_DEDUCT_DAYS = 14;
export const LOAN_DEDUCT_DAYS_MIN = 1;
export const LOAN_DEDUCT_DAYS_MAX = 90;

/** The words the employee agrees to at the register (shown + stored). */
export const LOAN_ACK_TEXT =
  "I am taking this product now and will pay for it later. If it is still unpaid after the store's set number of days, I authorize Greenway to deduct the amount from my pay.";

/** Parse the admin setting; null = invalid. Blank → the default. */
export function parseDeductDays(raw: unknown): number | null {
  const s = String(raw ?? "").trim();
  if (s === "") return DEFAULT_LOAN_DEDUCT_DAYS;
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= LOAN_DEDUCT_DAYS_MIN && n <= LOAN_DEDUCT_DAYS_MAX ? n : null;
}

/** Whole Pacific calendar days between two YYYY-MM-DD keys (b − a). */
export function daysBetween(aKey: string, bKey: string): number {
  const a = Date.parse(`${aKey}T00:00:00Z`);
  const b = Date.parse(`${bKey}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export type LoanRow = {
  id: string;
  employeeId: string;
  amountMinor: number;
  status: LoanStatus;
  /** Pacific day the product left the store (YYYY-MM-DD). */
  takenDay: string;
};

/** Open AND older than N days → due to be deducted on the next payroll. */
export function isDueForDeduction(row: LoanRow, todayKey: string, deductDays: number): boolean {
  return row.status === "open" && daysBetween(row.takenDay, todayKey) > deductDays;
}

export type EmployeeLoanSummary = {
  employeeId: string;
  openCount: number;
  openMinor: number;
  dueCount: number;
  dueMinor: number;
};

/** Per-employee open / due totals, largest due first. */
export function summarizeLoans(rows: LoanRow[], todayKey: string, deductDays: number): EmployeeLoanSummary[] {
  const by = new Map<string, EmployeeLoanSummary>();
  for (const r of rows) {
    if (r.status !== "open") continue;
    const s = by.get(r.employeeId) ?? { employeeId: r.employeeId, openCount: 0, openMinor: 0, dueCount: 0, dueMinor: 0 };
    s.openCount += 1;
    s.openMinor += r.amountMinor;
    if (isDueForDeduction(r, todayKey, deductDays)) {
      s.dueCount += 1;
      s.dueMinor += r.amountMinor;
    }
    by.set(r.employeeId, s);
  }
  return [...by.values()].sort((a, b) => b.dueMinor - a.dueMinor || b.openMinor - a.openMinor);
}

/** Allowed status moves: only an open loan can be settled. */
export function canSettle(from: LoanStatus, to: LoanStatus): boolean {
  return from === "open" && to !== "open";
}

export function __runEmployeeLoanTests(): { pass: number; fail: number } {
  let pass = 0;
  let fail = 0;
  const ok = (c: boolean, m: string) => {
    if (c) pass += 1;
    else {
      fail += 1;
      console.error(`FAIL employee-loan-core: ${m}`);
    }
  };
  ok(parseDeductDays("") === DEFAULT_LOAN_DEDUCT_DAYS, "blank → default");
  ok(parseDeductDays("7") === 7, "7 days");
  ok(parseDeductDays("0") === null && parseDeductDays("91") === null && parseDeductDays("x") === null, "out of range refused");
  ok(daysBetween("2025-03-01", "2025-03-15") === 14, "14 days");
  ok(daysBetween("2025-03-08", "2025-03-10") === 2, "DST weekend still 2 days");
  const r = (id: string, emp: string, amt: number, day: string, status: LoanStatus = "open"): LoanRow => ({
    id, employeeId: emp, amountMinor: amt, status, takenDay: day,
  });
  ok(!isDueForDeduction(r("1", "a", 100, "2025-03-01"), "2025-03-15", 14), "exactly N days is not yet due");
  ok(isDueForDeduction(r("1", "a", 100, "2025-03-01"), "2025-03-16", 14), "N+1 days is due");
  ok(!isDueForDeduction(r("1", "a", 100, "2025-01-01", "paid"), "2025-03-16", 14), "paid is never due");
  const s = summarizeLoans(
    [r("1", "a", 1000, "2025-03-01"), r("2", "a", 500, "2025-03-14"), r("3", "b", 700, "2025-01-01"), r("4", "b", 900, "2025-01-01", "deducted")],
    "2025-03-16",
    14,
  );
  ok(s.length === 2, "two employees with open loans");
  ok(s[0].employeeId === "a" && s[0].openMinor === 1500 && s[0].dueMinor === 1000, "a: open 15.00, due 10.00");
  ok(s[1].employeeId === "b" && s[1].openMinor === 700 && s[1].dueCount === 1, "b: settled row excluded");
  ok(canSettle("open", "paid") && canSettle("open", "deducted") && !canSettle("paid", "deducted") && !canSettle("open", "open"), "settle rules");
  if (fail) throw new Error(`employee-loan-core: ${fail} failed`);
  return { pass, fail };
}
