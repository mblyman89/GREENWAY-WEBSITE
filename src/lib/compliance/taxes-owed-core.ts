/**
 * src/lib/compliance/taxes-owed-core.ts   (D183, round slice S6)
 *
 * PURE. The plain-English "taxes owed" screen. Strategy section 5: "A 'taxes
 * owed' screen with the exact excise and sales tax collected each month,
 * taken from the saved sales. Every repaired sale is included automatically.
 * You give Sage and the state that number."
 *
 * The figures come from getWaTaxReport (src/lib/reports/wa-tax.ts): completed
 * orders bucketed by the Pacific month of completed_at, the SAME basis as the
 * LIQ-1295 and the CCRS Sale file (docs/PERIOD_BASIS.md). This module only
 * arranges them per month with the two due dates and whether each return has
 * been marked filed on the compliance calendar:
 *   LIQ-1295 (LCB, the 37% excise)        due the 20th of the next month
 *   DOR Combined Excise Tax Return         due the 25th of the next month,
 *     (sales tax: state + local)           rolled past weekends/holidays
 *
 * It also proves the tax number against the money: for each month the money
 * the register took should equal the pre-tax base plus the sales tax plus the
 * excise, to within rounding (each line's taxes are rounded on their own).
 * A gap bigger than that is shown, never hidden.
 */
import { dorExciseDueDate, type DoneMap } from "./compliance-calendar-core";

export type TaxMonthInput = {
  month: string; // YYYY-MM
  label: string;
  exciseTaxMinor: number;
  salesTaxMinor: number;
  stateSalesTaxMinor: number;
  localSalesTaxMinor: number;
  totalBaseMinor: number;
  cannabisBaseMinor: number;
  nonCannabisBaseMinor: number;
  orders: number;
};

/** What the register took per month (sum of completed order totals) and how many lines. */
export type TakenInput = { month: string; takenMinor: number; lines: number };

export type ReturnStatus = "filed" | "open" | "due_soon" | "overdue" | "month_running";

export type TaxReturn = {
  form: "LIQ-1295" | "DOR";
  what: string;
  amountMinor: number;
  dueDate: string; // YYYY-MM-DD
  status: ReturnStatus;
  daysUntilDue: number;
  filedAt: string | null;
};

export type TaxMonthCard = {
  month: string;
  label: string;
  input: TaxMonthInput;
  returns: TaxReturn[];
  totalOwedMinor: number;
  /** null when the money could not be read. */
  takenMinor: number | null;
  /** taken - (base + sales tax + excise). */
  gapMinor: number | null;
  toleranceMinor: number;
  moneyMatches: boolean | null;
  sentence: string;
};

export const DUE_SOON_DAYS = 7;

function nextMonth(month: string): { y: number; m: number } {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** LIQ-1295 due date: the 20th of the next month (the calendar's rule). */
export function liqDueDate(month: string): string {
  const n = nextMonth(month);
  return `${n.y}-${pad(n.m)}-20`;
}

/** DOR return due date: the 25th of the next month, rolled (RCW 82.32.045(1)). */
export function dorDueDate(month: string): string {
  return dorExciseDueDate(Number(month.slice(0, 4)), Number(month.slice(5, 7))).dueDate;
}

export function dayDiff(fromIso: string, toIso: string): number {
  const a = Date.UTC(Number(fromIso.slice(0, 4)), Number(fromIso.slice(5, 7)) - 1, Number(fromIso.slice(8, 10)));
  const b = Date.UTC(Number(toIso.slice(0, 4)), Number(toIso.slice(5, 7)) - 1, Number(toIso.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

export function returnStatus(todayIso: string, month: string, dueDate: string, filedAt: string | null): { status: ReturnStatus; days: number } {
  const days = dayDiff(todayIso, dueDate);
  if (filedAt) return { status: "filed", days };
  if (todayIso.slice(0, 7) <= month) return { status: "month_running", days };
  if (days < 0) return { status: "overdue", days };
  if (days <= DUE_SOON_DAYS) return { status: "due_soon", days };
  return { status: "open", days };
}

const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function buildTaxMonths(input: {
  months: readonly TaxMonthInput[];
  taken: readonly TakenInput[] | null;
  done: DoneMap;
  todayIso: string;
}): TaxMonthCard[] {
  const takenBy = new Map((input.taken ?? []).map((t) => [t.month, t]));
  return [...input.months]
    .sort((a, b) => b.month.localeCompare(a.month))
    .map((mi) => {
      const liqFiled = input.done.liq1295?.[mi.month]?.doneAt ?? null;
      const dorFiled = input.done.dor_excise?.[mi.month]?.doneAt ?? null;
      const liqDue = liqDueDate(mi.month);
      const dorDue = dorDueDate(mi.month);
      const l = returnStatus(input.todayIso, mi.month, liqDue, liqFiled);
      const d = returnStatus(input.todayIso, mi.month, dorDue, dorFiled);
      const returns: TaxReturn[] = [
        { form: "LIQ-1295", what: "Cannabis excise (37%) to the LCB", amountMinor: mi.exciseTaxMinor, dueDate: liqDue, status: l.status, daysUntilDue: l.days, filedAt: liqFiled },
        { form: "DOR", what: "Retail sales tax (state + local) to the Department of Revenue", amountMinor: mi.salesTaxMinor, dueDate: dorDue, status: d.status, daysUntilDue: d.days, filedAt: dorFiled },
      ];
      const t = input.taken === null ? undefined : takenBy.get(mi.month);
      const takenMinor = input.taken === null ? null : (t?.takenMinor ?? 0);
      const expected = mi.totalBaseMinor + mi.salesTaxMinor + mi.exciseTaxMinor;
      const gapMinor = takenMinor === null ? null : takenMinor - expected;
      // Each line's sales tax and excise are rounded on their own: up to one
      // cent each per line, plus the base back-out's own cent.
      const toleranceMinor = Math.max(3, 3 * (t?.lines ?? mi.orders));
      const moneyMatches = gapMinor === null ? null : Math.abs(gapMinor) <= toleranceMinor;
      const running = input.todayIso.slice(0, 7) <= mi.month;
      const sentence = running
        ? `${mi.label} so far: ${money(mi.exciseTaxMinor)} excise and ${money(mi.salesTaxMinor)} sales tax collected. The month is still running.`
        : `${mi.label}: pay ${money(mi.exciseTaxMinor)} excise on the LIQ-1295 by ${liqDue} and ${money(mi.salesTaxMinor)} sales tax on the DOR return by ${dorDue}.`;
      return {
        month: mi.month,
        label: mi.label,
        input: mi,
        returns,
        totalOwedMinor: mi.exciseTaxMinor + mi.salesTaxMinor,
        takenMinor,
        gapMinor,
        toleranceMinor,
        moneyMatches,
        sentence,
      };
    });
}

/** The most urgent unfiled return across the cards (for the headline), or null. */
export function nextReturn(cards: readonly TaxMonthCard[]): (TaxReturn & { label: string }) | null {
  const open = cards.flatMap((c) => c.returns.filter((r) => r.status === "overdue" || r.status === "due_soon" || r.status === "open").map((r) => ({ ...r, label: c.label })));
  open.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return open[0] ?? null;
}

export function statusText(s: ReturnStatus, days: number): string {
  switch (s) {
    case "filed":
      return "Marked filed";
    case "month_running":
      return "Month still running";
    case "overdue":
      return `OVERDUE by ${-days} day${-days === 1 ? "" : "s"}`;
    case "due_soon":
      return days === 0 ? "Due TODAY" : `Due in ${days} day${days === 1 ? "" : "s"}`;
    default:
      return `Due in ${days} days`;
  }
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

export function __runTaxesOwedTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: unknown, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error("taxes-owed-core FAIL:", m);
    }
  };
  ok(liqDueDate("2026-11") === "2026-12-20", "LIQ-1295 for Nov is due Dec 20");
  ok(liqDueDate("2026-12") === "2027-01-20", "LIQ-1295 for Dec is due Jan 20 next year");
  ok(dorDueDate("2026-10") === "2026-11-25", "DOR for Oct 2026 due Nov 25 (Wednesday)");
  ok(dorDueDate("2026-09") === "2026-10-26", "DOR for Sep 2026 rolls past Sunday Oct 25 to Oct 26");
  ok(dayDiff("2026-11-05", "2026-11-25") === 20 && dayDiff("2026-11-26", "2026-11-25") === -1, "day diff");

  const nov: TaxMonthInput = {
    month: "2026-11",
    label: "Nov 2026",
    exciseTaxMinor: 370000,
    salesTaxMinor: 93000,
    stateSalesTaxMinor: 65000,
    localSalesTaxMinor: 28000,
    totalBaseMinor: 1000000,
    cannabisBaseMinor: 1000000,
    nonCannabisBaseMinor: 0,
    orders: 100,
  };
  const oct: TaxMonthInput = { ...nov, month: "2026-10", label: "Oct 2026", exciseTaxMinor: 3700, salesTaxMinor: 930, totalBaseMinor: 10000, orders: 2 };

  // running month
  const run = buildTaxMonths({ months: [nov], taken: [{ month: "2026-11", takenMinor: 1463000, lines: 120 }], done: {}, todayIso: "2026-11-05" });
  ok(run.length === 1 && run[0]!.returns.every((r) => r.status === "month_running"), "the current month is still running, never overdue");
  ok(run[0]!.moneyMatches === true && run[0]!.gapMinor === 0, "taken = base + taxes matches");
  ok(/still running/.test(run[0]!.sentence), "running sentence");
  ok(run[0]!.totalOwedMinor === 463000, "total owed = excise + sales tax");

  // ordering, statuses, done map
  const cards = buildTaxMonths({
    months: [oct, nov],
    taken: [
      { month: "2026-11", takenMinor: 1463000, lines: 120 },
      { month: "2026-10", takenMinor: 14630 + 500, lines: 3 },
    ],
    done: { liq1295: { "2026-10": { doneAt: "2026-11-10T00:00:00Z", byEmail: null } } },
    todayIso: "2026-11-21",
  });
  ok(cards[0]!.month === "2026-11" && cards[1]!.month === "2026-10", "newest month first");
  const o = cards[1]!;
  ok(o.returns[0]!.status === "filed" && o.returns[0]!.filedAt !== null, "LIQ marked filed on the calendar shows filed");
  ok(o.returns[1]!.status === "due_soon" && o.returns[1]!.daysUntilDue === 4, "DOR due in 4 days = due soon");
  ok(o.moneyMatches === false && o.gapMinor === 500, "a $5 gap between money and tax is shown");
  ok(/LIQ-1295 by 2026-11-20/.test(o.sentence) && /DOR return by 2026-11-25/.test(o.sentence), "sentence names both due dates");
  const late = buildTaxMonths({ months: [oct], taken: null, done: {}, todayIso: "2026-11-21" });
  ok(late[0]!.returns[0]!.status === "overdue" && late[0]!.returns[0]!.daysUntilDue === -1, "unfiled LIQ past the 20th is overdue");
  ok(late[0]!.moneyMatches === null && late[0]!.takenMinor === null, "unreadable money is unknown, not a match");
  const nx = nextReturn(late);
  ok(nx !== null && nx.form === "LIQ-1295", "next return is the earliest unfiled one");
  ok(nextReturn(buildTaxMonths({ months: [nov], taken: [], done: {}, todayIso: "2026-11-05" })) === null, "nothing due while the only month is running");
  ok(statusText("overdue", -3) === "OVERDUE by 3 days" && statusText("due_soon", 0) === "Due TODAY" && statusText("due_soon", 1) === "Due in 1 day", "status text");
  ok(returnStatus("2026-12-01", "2026-11", "2026-12-20", null).status === "open", "19 days out = open");
  return { passed, failed };
}
