/**
 * src/lib/reports/net-income-core.ts — PURE net-income roll-up (P6c).
 *
 * WHAT THIS ANSWERS (Michael's ask)
 * The final slice of the P6 reconciliation family: a single, plain-English
 * bottom-line view that rolls the numbers the app can ACTUALLY verify into a
 * simple profit-and-loss for a date range —
 *
 *     Gross retail revenue
 *   − Cost of goods sold (COGS)
 *   ─────────────────────────────
 *   = Gross profit
 *   + ATM surcharge income (your fee revenue — reconciled in P6a)
 *   − Payroll (net pay that left the bank — reconciled in P6b)
 *   ─────────────────────────────
 *   = Operating result (before other costs)
 *
 * WHY A PURE CORE
 * All the arithmetic + labeling lives here with ZERO I/O so it is exhaustively
 * self-tested and deterministic. The page fetches the figures (from the existing
 * COGS report, payroll runs, and ATM settlements) and hands this core plain
 * cents. Mirrors every other Greenway slice.
 *
 * HONESTY (never guess / never overstate — a standing rule)
 * This is an OPERATING roll-up of the categories the system can prove, NOT a
 * full audited P&L. It deliberately does NOT invent numbers for costs the app
 * has no ledger for yet — rent, utilities, taxes remitted to the state, vendor
 * payments, loan payments, etc. Those are surfaced as an explicit "not yet
 * included" list so the bottom line is never mistaken for the final net profit.
 * (Vendor payments arrive with the P7 Timberland ACH pipeline.)
 *
 * VERIFIED FACTS THIS IS BUILT ON (audited, not guessed):
 *   • getCogsReport(from,to) → totalRevenueMinorUnits, totalCogsMinorUnits,
 *     totalGrossProfitMinorUnits — src/lib/reports/cogs.ts.
 *   • payroll_runs carry pay_date + total_net_cents + status; only
 *     file_generated | submitted are actually PAID — payroll-store.ts.
 *   • atm_settlements carry settlementDate + surchargeCents — atm/store.ts.
 *   • Money is integer CENTS everywhere.
 */

// ---------------------------------------------------------------------------
// Inputs (plain cents the page assembles)
// ---------------------------------------------------------------------------

export type NetIncomeInputs = {
  /** Gross retail revenue for the range, in cents (from the COGS/sales report). */
  revenueCents: number;
  /** Cost of goods sold for the range, in cents. */
  cogsCents: number;
  /** ATM surcharge income for the range, in cents (your fee revenue). */
  atmSurchargeCents: number;
  /** Payroll net pay that cleared in the range, in cents. */
  payrollNetCents: number;
  /** How many completed payroll runs the payroll figure covers (for the note). */
  payrollRunCount: number;
};

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** One line on the roll-up. `kind` drives styling (subtotal/total emphasized). */
export type NetIncomeLine = {
  key: string;
  label: string;
  /** Signed cents: positive = adds to the bottom line, negative = subtracts. */
  amountCents: number;
  kind: "revenue" | "expense" | "subtotal" | "income" | "total";
  /** Optional one-line plain-English explanation for a novice. */
  note?: string;
};

export type NetIncomeReport = {
  lines: NetIncomeLine[];
  grossProfitCents: number;
  operatingResultCents: number;
  /** Gross margin (grossProfit / revenue), 0..1; 0 when revenue is 0. */
  grossMarginRatio: number;
  /** Operating margin (operatingResult / revenue), 0..1; 0 when revenue is 0. */
  operatingMarginRatio: number;
  /** True when the operating result is >= 0. */
  isProfitable: boolean;
  /** Costs the app cannot verify yet — shown so the total isn't misread. */
  notIncluded: string[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Integer cents guard: coerce non-finite/negative-noise to a clean integer. */
function cleanCents(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v);
}

/** Ratio helper: numerator/denominator, 0 when denominator is 0. Not rounded. */
export function safeRatio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 0;
  return numerator / denominator;
}

/** Format a 0..1 ratio as a percent string, e.g. 0.512 → "51.2%". */
export function formatRatioPct(ratio: number): string {
  if (!Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(1)}%`;
}

/** The costs this roll-up deliberately does NOT include (honesty note). */
export const NET_INCOME_NOT_INCLUDED: string[] = [
  "Rent, utilities, and other overhead",
  "Sales & excise tax remitted to the state",
  "Vendor / product payments (coming with the ACH pipeline)",
  "Loan payments, insurance, and other fixed costs",
  "Owner draws or distributions",
];

// ---------------------------------------------------------------------------
// The roll-up
// ---------------------------------------------------------------------------

/**
 * Assemble the operating net-income roll-up from verified inputs. PURE and
 * deterministic. All money is integer cents. Never throws on messy numbers.
 */
export function buildNetIncome(inputs: NetIncomeInputs): NetIncomeReport {
  const revenue = cleanCents(inputs.revenueCents);
  const cogs = cleanCents(inputs.cogsCents);
  const atm = cleanCents(inputs.atmSurchargeCents);
  const payroll = cleanCents(inputs.payrollNetCents);
  const runCount = Number.isFinite(inputs.payrollRunCount)
    ? Math.max(0, Math.round(inputs.payrollRunCount))
    : 0;

  const grossProfit = revenue - cogs;
  const operatingResult = grossProfit + atm - payroll;

  const runsNote =
    runCount === 0
      ? "No completed payroll runs cleared in this range."
      : `${runCount} completed payroll run${runCount === 1 ? "" : "s"} that cleared the bank.`;

  const lines: NetIncomeLine[] = [
    {
      key: "revenue",
      label: "Gross retail revenue",
      amountCents: revenue,
      kind: "revenue",
      note: "Everything you rang up at the register in this range.",
    },
    {
      key: "cogs",
      label: "Cost of goods sold",
      amountCents: -cogs,
      kind: "expense",
      note: "What the products you sold cost you.",
    },
    {
      key: "gross_profit",
      label: "Gross profit",
      amountCents: grossProfit,
      kind: "subtotal",
      note: "Revenue minus product cost.",
    },
    {
      key: "atm_surcharge",
      label: "ATM surcharge income",
      amountCents: atm,
      kind: "income",
      note: "Your ATM fee revenue (reconciled to the bank in the ATM tab).",
    },
    {
      key: "payroll",
      label: "Payroll (net pay)",
      amountCents: -payroll,
      kind: "expense",
      note: runsNote,
    },
    {
      key: "operating_result",
      label: "Operating result",
      amountCents: operatingResult,
      kind: "total",
      note: "Gross profit + ATM income − payroll. Before other costs below.",
    },
  ];

  return {
    lines,
    grossProfitCents: grossProfit,
    operatingResultCents: operatingResult,
    grossMarginRatio: safeRatio(grossProfit, revenue),
    operatingMarginRatio: safeRatio(operatingResult, revenue),
    isProfitable: operatingResult >= 0,
    notIncluded: [...NET_INCOME_NOT_INCLUDED],
  };
}

/**
 * Plain-English verdict headline for the summary banner. Pure.
 *   • no revenue → neutral "Nothing to roll up yet"
 *   • profitable → green
 *   • loss      → orange (a call to look, not an error)
 */
export function netIncomeHeadline(report: NetIncomeReport, revenueCents: number): {
  tone: "green" | "orange" | "neutral";
  title: string;
  detail: string;
} {
  if (cleanCents(revenueCents) === 0 && report.operatingResultCents === 0) {
    return {
      tone: "neutral",
      title: "Nothing to roll up yet",
      detail: "Once you have sales in this range, your bottom line will appear here.",
    };
  }
  if (report.isProfitable) {
    return {
      tone: "green",
      title: "In the black ✓",
      detail: `Your operating result is positive at a ${formatRatioPct(report.operatingMarginRatio)} operating margin, before the costs listed at the bottom.`,
    };
  }
  return {
    tone: "orange",
    title: "Operating at a loss",
    detail: "Your tracked costs came in above gross profit + ATM income for this range. Review the line items below.",
  };
}

// ---------------------------------------------------------------------------
// Self-tests (pure, deterministic) — mirrored in the vitest suite.
// ---------------------------------------------------------------------------

export function __runNetIncomeCoreTests(): void {
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`net-income-core self-test FAILED: ${msg}`);
  };

  // Ratio + format helpers --------------------------------------------------
  ok(safeRatio(50, 100) === 0.5, "safeRatio: basic");
  ok(safeRatio(1, 0) === 0, "safeRatio: divide-by-zero is 0, not Infinity");
  ok(formatRatioPct(0.512) === "51.2%", "formatRatioPct: one decimal");
  ok(formatRatioPct(0) === "0.0%", "formatRatioPct: zero");

  // A clean profitable roll-up ---------------------------------------------
  {
    const r = buildNetIncome({
      revenueCents: 10000_00,
      cogsCents: 4000_00,
      atmSurchargeCents: 500_00,
      payrollNetCents: 3000_00,
      payrollRunCount: 2,
    });
    ok(r.grossProfitCents === 6000_00, "profit: gross profit = revenue − cogs");
    ok(r.operatingResultCents === 3500_00, "profit: operating = grossProfit + atm − payroll");
    ok(r.grossMarginRatio === 0.6, "profit: gross margin 60%");
    ok(Math.abs(r.operatingMarginRatio - 0.35) < 1e-9, "profit: operating margin 35%");
    ok(r.isProfitable === true, "profit: flagged profitable");
    // Line signs: revenue positive, cogs negative, payroll negative.
    const byKey = Object.fromEntries(r.lines.map((l) => [l.key, l.amountCents]));
    ok(byKey.revenue === 10000_00, "profit: revenue line positive");
    ok(byKey.cogs === -4000_00, "profit: cogs line negative");
    ok(byKey.payroll === -3000_00, "profit: payroll line negative");
    ok(byKey.operating_result === 3500_00, "profit: total line matches");
    // The sum of the signed component lines equals the operating result.
    const componentSum =
      byKey.revenue + byKey.cogs + byKey.atm_surcharge + byKey.payroll;
    ok(componentSum === r.operatingResultCents, "profit: signed components sum to operating result");
    ok(r.notIncluded.length === NET_INCOME_NOT_INCLUDED.length, "profit: honesty list present");
  }

  // A loss --------------------------------------------------------------------
  {
    const r = buildNetIncome({
      revenueCents: 1000_00,
      cogsCents: 600_00,
      atmSurchargeCents: 50_00,
      payrollNetCents: 900_00,
      payrollRunCount: 1,
    });
    ok(r.grossProfitCents === 400_00, "loss: gross profit");
    ok(r.operatingResultCents === -450_00, "loss: negative operating result");
    ok(r.isProfitable === false, "loss: flagged not profitable");
    const h = netIncomeHeadline(r, 1000_00);
    ok(h.tone === "orange" && h.title === "Operating at a loss", "loss: headline is orange");
  }

  // Zero revenue → neutral empty headline -----------------------------------
  {
    const r = buildNetIncome({ revenueCents: 0, cogsCents: 0, atmSurchargeCents: 0, payrollNetCents: 0, payrollRunCount: 0 });
    ok(r.operatingResultCents === 0, "empty: zero operating result");
    ok(r.grossMarginRatio === 0 && r.operatingMarginRatio === 0, "empty: ratios are 0");
    const h = netIncomeHeadline(r, 0);
    ok(h.tone === "neutral" && h.title === "Nothing to roll up yet", "empty: neutral headline");
    // A profitable headline uses the green tone.
    const hp = netIncomeHeadline(buildNetIncome({ revenueCents: 100_00, cogsCents: 10_00, atmSurchargeCents: 0, payrollNetCents: 0, payrollRunCount: 0 }), 100_00);
    ok(hp.tone === "green" && hp.title === "In the black ✓", "empty: profitable headline is green");
  }

  // Messy inputs are cleaned, never throw -----------------------------------
  {
    const r = buildNetIncome({
      revenueCents: Number.NaN,
      cogsCents: 100.6,
      atmSurchargeCents: Number.POSITIVE_INFINITY,
      payrollNetCents: 50.4,
      payrollRunCount: -3,
    });
    ok(r.lines[0].amountCents === 0, "messy: NaN revenue → 0");
    ok(r.lines[1].amountCents === -101, "messy: 100.6 cogs rounds to 101 (negated)");
    ok(Number.isFinite(r.operatingResultCents), "messy: operating result stays finite");
    const payrollNote = r.lines.find((l) => l.key === "payroll")?.note ?? "";
    ok(payrollNote.includes("No completed payroll"), "messy: negative run count → zero-runs note");
  }

  // Singular vs plural payroll note -----------------------------------------
  {
    const one = buildNetIncome({ revenueCents: 100_00, cogsCents: 0, atmSurchargeCents: 0, payrollNetCents: 10_00, payrollRunCount: 1 });
    ok((one.lines.find((l) => l.key === "payroll")?.note ?? "").includes("1 completed payroll run "), "note: singular run");
    const two = buildNetIncome({ revenueCents: 100_00, cogsCents: 0, atmSurchargeCents: 0, payrollNetCents: 10_00, payrollRunCount: 2 });
    ok((two.lines.find((l) => l.key === "payroll")?.note ?? "").includes("2 completed payroll runs"), "note: plural runs");
  }
}
