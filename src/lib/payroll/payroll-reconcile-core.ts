/**
 * src/lib/payroll/payroll-reconcile-core.ts — PURE payroll reconciliation (P6b).
 *
 * WHAT THIS ANSWERS (Michael's ask)
 * After a payroll run's ACH file is generated and uploaded to Timberland, ONE
 * lump-sum ACH DEBIT leaves the Main operating account for the run's total net
 * pay. Michael wants each completed run married to that real bank withdrawal —
 * line-item, in plain English — so he can prove every payroll actually cleared
 * for the right amount, and instantly spot any that DIDN'T.
 *
 * WHY ONE DEBIT PER RUN (verified, not guessed)
 * The NACHA file Greenway generates is CREDIT-ONLY (Total Debit = 0) —
 * src/lib/payments/nacha-core.ts. In that model the originating bank posts a
 * SINGLE offsetting debit to the company's operating account equal to the batch
 * total (= payroll_runs.total_net_cents) on the ACH effective date (= pay_date).
 * So we match one run → one bank withdrawal, not one per employee.
 *
 * WHY A PURE CORE
 * All the judgment (which withdrawal matches which run, is it on time, does the
 * amount tie out) lives here with ZERO I/O so it is exhaustively self-tested and
 * deterministic. The store hands it plain arrays; the page renders the result.
 * This mirrors the ATM reconciliation engine (P6a) exactly.
 *
 * VERIFIED FACTS THIS IS BUILT ON (audited, not guessed):
 *   • payroll_runs carries pay_date + total_net_cents + status; only
 *     file_generated | submitted runs are actually PAID — payroll-store.ts.
 *   • Main bank account = Plaid account role==="main" — plaid-core AccountRole.
 *   • Plaid sign convention (load-bearing): POSITIVE amount_cents = money OUT
 *     (a withdrawal/debit). A payroll debit is an OUTFLOW, so we keep positive
 *     rows and use their magnitude directly.
 *   • Money is integer CENTS everywhere.
 *   • bankPostingWindow(iso, lo, hi) gives the inclusive business-day ISO window
 *     a debit can post in — reused from atm-core.ts.
 *
 * STATUS MODEL (per run) — plain English:
 *   • matched   — a bank debit of the exact net-pay amount posted in-window.
 *   • mismatch  — a debit posted in-window but the amount is off (we show by how
 *                 many cents, signed).
 *   • awaiting  — no debit yet, but we're still inside the posting window (this
 *                 is NORMAL — the ACH just hasn't settled/posted yet).
 *   • unmatched — the window has fully passed and no debit ever arrived (THIS is
 *                 the one to chase — did the file actually get uploaded?).
 *
 * GREEDY, DETERMINISTIC MATCHING: runs are processed oldest-pay-date-first. Each
 * bank withdrawal can be consumed by at most ONE run (so two runs never claim
 * the same debit). Within a run's window we prefer an EXACT amount match; if
 * none, the closest-amount in-window debit becomes a mismatch ONLY when it's
 * within a sensible tolerance band (so a $12,000 payroll never "matches" a $40
 * bank fee); if the window is still open we mark awaiting and DON'T consume
 * anything. This is the classic bank-rec worksheet, made honest.
 */

import { bankPostingWindow } from "@/lib/atm/atm-core";

// ---------------------------------------------------------------------------
// Inputs (plain data the store hands us)
// ---------------------------------------------------------------------------

/** A completed payroll run to reconcile. */
export type ReconcileRun = {
  runId: string;
  label: string | null;
  payDate: string; // yyyy-mm-dd (ACH effective date)
  totalNetCents: number; // the lump-sum debit we expect to see leave the bank
  status: string; // file_generated | submitted (only these are passed in)
  entryCount: number;
};

/** A single bank withdrawal (money OUT) from the Main operating account. */
export type BankWithdrawal = {
  transactionId: string;
  amountCents: number; // POSITIVE magnitude of money that LEFT the account
  date: string; // yyyy-mm-dd posted date
  description: string | null;
  pending: boolean;
};

/** The Plaid transaction shape we down-convert from (subset we actually use). */
export type WithdrawalSourceTxn = {
  transactionId: string;
  amountCents: number; // Plaid sign: POSITIVE = money out (a debit)
  date: string;
  name: string | null;
  merchantName: string | null;
  pending: boolean;
};

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type PayrollReconcileStatus = "matched" | "mismatch" | "awaiting" | "unmatched";

/** One reconciled run row (what the view renders). */
export type RunMatch = {
  runId: string;
  label: string | null;
  payDate: string;
  entryCount: number;
  status: PayrollReconcileStatus;
  expectedCents: number;
  /** The matched debit's magnitude, or null when nothing matched. */
  matchedCents: number | null;
  /** matched − expected (signed), or null when nothing matched. */
  differenceCents: number | null;
  /** The bank debit we tied to, if any. */
  matchedTransactionId: string | null;
  matchedDate: string | null;
  matchedDescription: string | null;
  /** Inclusive business-day window this debit was expected to post in. */
  windowEarliest: string;
  windowLatest: string;
};

export type PayrollReconcileSummary = {
  runCount: number;
  matched: number;
  mismatch: number;
  awaiting: number;
  unmatched: number;
  totalExpectedCents: number;
  totalMatchedCents: number;
  /** totalMatched − totalExpected (signed). */
  netDifferenceCents: number;
  /** True when nothing needs attention (no mismatch, no unmatched). */
  allClear: boolean;
  unexplainedDebitCount: number;
  unexplainedDebitCents: number;
};

export type PayrollReconcileResult = {
  runs: RunMatch[];
  summary: PayrollReconcileSummary;
  /** Bank debits from the Main account that no run claimed (informational). */
  unexplainedDebits: BankWithdrawal[];
};

export type PayrollReconcileOptions = {
  /** Today's ISO date (yyyy-mm-dd) — used to decide awaiting vs unmatched. */
  todayIso: string;
  /** Posting-window business days (default T+0..T+2). Payroll debits often post
   *  ON the effective date, so the window starts at T+0 (not T+1 like ATM). */
  minBusinessDays?: number;
  maxBusinessDays?: number;
  /** Mismatch tolerance floor in cents (default $5). */
  toleranceFloorCents?: number;
  /** Mismatch tolerance percent of expected (default 2%). */
  tolerancePercent?: number;
};

// ---------------------------------------------------------------------------
// Pure helpers (shared philosophy with the ATM engine)
// ---------------------------------------------------------------------------

/**
 * Convert Main-account Plaid transactions into bank withdrawals. Keeps ONLY
 * money-OUT rows (Plaid positive amount) — inflows (negative) are dropped. The
 * amount is already positive, so it becomes the debit magnitude directly.
 */
export function toBankWithdrawals(txns: WithdrawalSourceTxn[]): BankWithdrawal[] {
  const out: BankWithdrawal[] = [];
  for (const t of txns) {
    if (t.amountCents <= 0) continue; // not money leaving the account
    out.push({
      transactionId: t.transactionId,
      amountCents: t.amountCents,
      date: t.date,
      description: t.merchantName ?? t.name,
      pending: t.pending,
    });
  }
  return out;
}

/** ISO date compare: is `d` within [lo, hi] inclusive? Lexical works for yyyy-mm-dd. */
export function isoWithin(d: string, lo: string, hi: string): boolean {
  return d >= lo && d <= hi;
}

/** Format signed cents difference, e.g. +$0.50 / −$2.00 / $0.00. */
export function formatDiff(cents: number): string {
  const sign = cents > 0 ? "+" : cents < 0 ? "−" : "";
  const abs = Math.abs(cents);
  const dollars = (abs / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}$${dollars}`;
}

/** Default mismatch tolerance: max($5 flat, 2% of expected). */
export const DEFAULT_TOLERANCE_FLOOR_CENTS = 500;
export const DEFAULT_TOLERANCE_PERCENT = 2;

/** The mismatch tolerance (in cents) for an expected amount, given the knobs. */
export function toleranceCentsFor(
  expectedCents: number,
  floorCents = DEFAULT_TOLERANCE_FLOOR_CENTS,
  percent = DEFAULT_TOLERANCE_PERCENT,
): number {
  const pctBand = Math.round((Math.abs(expectedCents) * percent) / 100);
  return Math.max(floorCents, pctBand);
}

type WorkingWithdrawal = BankWithdrawal & { consumed: boolean };

/**
 * Pick the best in-window debit for an expected amount from the not-yet-consumed
 * pool. Preference order:
 *   1) EXACT amount match (earliest date wins on ties),
 *   2) otherwise the closest amount WITHIN the tolerance band — becomes a
 *      mismatch. A candidate further off than the tolerance is ignored (it is
 *      not a plausible restatement of the same payroll debit).
 */
function pickBestWithdrawal(
  pool: WorkingWithdrawal[],
  expectedCents: number,
  lo: string,
  hi: string,
  toleranceCents: number,
): { withdrawal: WorkingWithdrawal; exact: boolean } | null {
  let bestExact: WorkingWithdrawal | null = null;
  let bestApprox: WorkingWithdrawal | null = null;
  let bestApproxDelta = Number.POSITIVE_INFINITY;

  for (const w of pool) {
    if (w.consumed) continue;
    if (!isoWithin(w.date, lo, hi)) continue;
    if (w.amountCents === expectedCents) {
      if (bestExact === null || w.date < bestExact.date) bestExact = w;
      continue;
    }
    const delta = Math.abs(w.amountCents - expectedCents);
    if (delta > toleranceCents) continue; // too far off to be the same debit
    if (
      delta < bestApproxDelta ||
      (delta === bestApproxDelta && bestApprox !== null && w.date < bestApprox.date)
    ) {
      bestApprox = w;
      bestApproxDelta = delta;
    }
  }

  if (bestExact) return { withdrawal: bestExact, exact: true };
  if (bestApprox) return { withdrawal: bestApprox, exact: false };
  return null;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/**
 * Reconcile every completed payroll run against the Main account's withdrawals.
 * PURE and deterministic. Never throws on bad data — runs with a null/zero
 * expected amount are skipped (they can't be reconciled and aren't counted).
 * Runs are returned newest-pay-date-first for the view.
 */
export function reconcilePayroll(
  runs: ReconcileRun[],
  withdrawals: BankWithdrawal[],
  opts: PayrollReconcileOptions,
): PayrollReconcileResult {
  const minD = opts.minBusinessDays ?? 0;
  const maxD = opts.maxBusinessDays ?? 2;

  // Work on a mutable copy so we can mark debits consumed as runs claim them.
  const pool: WorkingWithdrawal[] = withdrawals.map((w) => ({ ...w, consumed: false }));

  // Deterministic order: oldest pay date first (then runId) so greedy
  // consumption is stable + reproducible.
  const ordered = [...runs].sort((a, b) => {
    if (a.payDate !== b.payDate) return a.payDate < b.payDate ? -1 : 1;
    return a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0;
  });

  const matches: RunMatch[] = [];

  for (const r of ordered) {
    const expected = r.totalNetCents;
    // bankPostingWindow returns null on an unparseable date; degrade to a
    // same-day window so a bad row can never crash the engine.
    const win = bankPostingWindow(r.payDate, minD, maxD) ?? {
      earliest: r.payDate,
      latest: r.payDate,
    };
    const base: RunMatch = {
      runId: r.runId,
      label: r.label,
      payDate: r.payDate,
      entryCount: r.entryCount,
      status: "unmatched",
      expectedCents: expected,
      matchedCents: null,
      differenceCents: null,
      matchedTransactionId: null,
      matchedDate: null,
      matchedDescription: null,
      windowEarliest: win.earliest,
      windowLatest: win.latest,
    };

    // A run with no positive expected amount can't be reconciled; skip it
    // entirely (don't count it, don't consume anything).
    if (!Number.isFinite(expected) || expected <= 0) {
      continue;
    }

    const tol = toleranceCentsFor(expected, opts.toleranceFloorCents, opts.tolerancePercent);
    const pick = pickBestWithdrawal(pool, expected, win.earliest, win.latest, tol);

    if (pick) {
      pick.withdrawal.consumed = true;
      base.matchedCents = pick.withdrawal.amountCents;
      base.differenceCents = pick.withdrawal.amountCents - expected;
      base.matchedTransactionId = pick.withdrawal.transactionId;
      base.matchedDate = pick.withdrawal.date;
      base.matchedDescription = pick.withdrawal.description;
      base.status = pick.exact ? "matched" : "mismatch";
    } else {
      const stillOpen = opts.todayIso <= win.latest;
      base.status = stillOpen ? "awaiting" : "unmatched";
    }

    matches.push(base);
  }

  // View order: newest pay date first (most recent payroll on top).
  matches.sort((a, b) => (a.payDate < b.payDate ? 1 : a.payDate > b.payDate ? -1 : 0));

  // Summary.
  let matched = 0;
  let mismatch = 0;
  let awaiting = 0;
  let unmatched = 0;
  let totalExpectedCents = 0;
  let totalMatchedCents = 0;
  for (const m of matches) {
    totalExpectedCents += m.expectedCents;
    if (m.matchedCents !== null) totalMatchedCents += m.matchedCents;
    if (m.status === "matched") matched += 1;
    else if (m.status === "mismatch") mismatch += 1;
    else if (m.status === "awaiting") awaiting += 1;
    else unmatched += 1;
  }

  const unexplainedDebits: BankWithdrawal[] = pool
    .filter((w) => !w.consumed)
    .map((w) => ({
      transactionId: w.transactionId,
      amountCents: w.amountCents,
      date: w.date,
      description: w.description,
      pending: w.pending,
    }));
  const unexplainedDebitCents = unexplainedDebits.reduce((s, w) => s + w.amountCents, 0);

  const summary: PayrollReconcileSummary = {
    runCount: matches.length,
    matched,
    mismatch,
    awaiting,
    unmatched,
    totalExpectedCents,
    totalMatchedCents,
    netDifferenceCents: totalMatchedCents - totalExpectedCents,
    allClear: mismatch === 0 && unmatched === 0,
    unexplainedDebitCount: unexplainedDebits.length,
    unexplainedDebitCents,
  };

  return { runs: matches, summary, unexplainedDebits };
}

// ---------------------------------------------------------------------------
// Self-tests (pure, deterministic) — mirrored in the vitest suite.
// ---------------------------------------------------------------------------

export function __runPayrollReconcileCoreTests(): void {
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`payroll-reconcile-core self-test FAILED: ${msg}`);
  };

  // toBankWithdrawals: keep only outflows, prefer merchant name -------------
  {
    const ws = toBankWithdrawals([
      { transactionId: "out1", amountCents: 1200000, date: "2026-07-06", name: "ACH DEBIT", merchantName: "TIMBERLAND ACH", pending: false },
      { transactionId: "in1", amountCents: -50000, date: "2026-07-06", name: "DEPOSIT", merchantName: null, pending: false },
      { transactionId: "out2", amountCents: 4000, date: "2026-07-07", name: "MONTHLY FEE", merchantName: null, pending: true },
    ]);
    ok(ws.length === 2, "toBankWithdrawals: keeps only outflows (drops the deposit)");
    ok(ws[0].transactionId === "out1" && ws[0].amountCents === 1200000, "toBankWithdrawals: positive magnitude preserved");
    ok(ws[0].description === "TIMBERLAND ACH", "toBankWithdrawals: merchant name preferred for description");
    ok(ws[1].description === "MONTHLY FEE" && ws[1].pending === true, "toBankWithdrawals: name fallback + pending preserved");
  }

  // isoWithin / formatDiff --------------------------------------------------
  {
    ok(isoWithin("2026-07-07", "2026-07-06", "2026-07-08"), "isoWithin: inside");
    ok(!isoWithin("2026-07-09", "2026-07-06", "2026-07-08"), "isoWithin: outside");
    ok(formatDiff(0) === "$0.00", "formatDiff: zero");
    ok(formatDiff(50) === "+$0.50", "formatDiff: positive");
    ok(formatDiff(-200) === "−$2.00", "formatDiff: negative uses unicode minus");
    ok(formatDiff(123456) === "+$1,234.56", "formatDiff: thousands separator");
  }

  // toleranceCentsFor -------------------------------------------------------
  {
    ok(toleranceCentsFor(10000) === 500, "tolerance: floor $5 wins for small amounts");
    ok(toleranceCentsFor(1200000) === 24000, "tolerance: 2% wins for large amounts ($240 on $12k)");
    ok(toleranceCentsFor(30000, 500, 2) === 600, "tolerance: 2% of $300 = $6 beats floor");
  }

  // Case 1: exact match on the pay date ------------------------------------
  {
    const runs: ReconcileRun[] = [
      { runId: "r1", label: "PPE 7/4", payDate: "2026-07-06", totalNetCents: 1200000, status: "file_generated", entryCount: 8 },
    ];
    const withdrawals: BankWithdrawal[] = [
      { transactionId: "w1", amountCents: 1200000, date: "2026-07-06", description: "TIMBERLAND ACH", pending: false },
    ];
    const res = reconcilePayroll(runs, withdrawals, { todayIso: "2026-07-20" });
    ok(res.runs.length === 1, "case1: one run");
    ok(res.runs[0].status === "matched", "case1: matched on pay date (T+0)");
    ok(res.runs[0].matchedCents === 1200000 && res.runs[0].differenceCents === 0, "case1: amounts tie out");
    ok(res.summary.allClear === true, "case1: all clear");
    ok(res.unexplainedDebits.length === 0, "case1: no leftover debits");
  }

  // Case 2: mismatch (amount off, within tolerance) ------------------------
  {
    const runs: ReconcileRun[] = [
      { runId: "r1", label: null, payDate: "2026-07-06", totalNetCents: 1200000, status: "submitted", entryCount: 8 },
    ];
    const withdrawals: BankWithdrawal[] = [
      { transactionId: "w1", amountCents: 1200050, date: "2026-07-07", description: "ACH", pending: false },
    ];
    const res = reconcilePayroll(runs, withdrawals, { todayIso: "2026-07-20" });
    ok(res.runs[0].status === "mismatch", "case2: mismatch when amount is off");
    ok(res.runs[0].differenceCents === 50, "case2: +$0.50 difference");
    ok(res.summary.allClear === false, "case2: not all clear");
  }

  // Case 3: awaiting (in window, nothing posted yet) -----------------------
  {
    const runs: ReconcileRun[] = [
      { runId: "r1", label: null, payDate: "2026-07-06", totalNetCents: 1200000, status: "file_generated", entryCount: 8 },
    ];
    const res = reconcilePayroll(runs, [], { todayIso: "2026-07-06" });
    ok(res.runs[0].status === "awaiting", "case3: awaiting while inside the window");
    ok(res.summary.allClear === true, "case3: awaiting does NOT block all-clear");
  }

  // Case 4: unmatched (window passed, no debit) ----------------------------
  {
    const runs: ReconcileRun[] = [
      { runId: "r1", label: null, payDate: "2026-07-06", totalNetCents: 1200000, status: "submitted", entryCount: 8 },
    ];
    const res = reconcilePayroll(runs, [], { todayIso: "2026-07-20" });
    ok(res.runs[0].status === "unmatched", "case4: unmatched once the window has fully passed");
    ok(res.summary.allClear === false, "case4: unmatched blocks all-clear");
  }

  // Case 5: a far-off debit is NOT a mismatch; run stays unmatched, debit is unexplained
  {
    const runs: ReconcileRun[] = [
      { runId: "r1", label: null, payDate: "2026-07-06", totalNetCents: 1200000, status: "submitted", entryCount: 8 },
    ];
    const withdrawals: BankWithdrawal[] = [
      { transactionId: "fee", amountCents: 4000, date: "2026-07-07", description: "MONTHLY FEE", pending: false },
    ];
    const res = reconcilePayroll(runs, withdrawals, { todayIso: "2026-07-20" });
    ok(res.runs[0].status === "unmatched", "case5: $12k run never 'matches' a $40 fee");
    ok(res.unexplainedDebits.length === 1 && res.unexplainedDebits[0].transactionId === "fee", "case5: the fee surfaces as unexplained");
  }

  // Case 6: two runs, each consumes its own debit (no double-claim) ---------
  {
    const runs: ReconcileRun[] = [
      { runId: "r1", label: "wk1", payDate: "2026-07-06", totalNetCents: 1000000, status: "submitted", entryCount: 8 },
      { runId: "r2", label: "wk2", payDate: "2026-07-20", totalNetCents: 1000000, status: "submitted", entryCount: 8 },
    ];
    const withdrawals: BankWithdrawal[] = [
      { transactionId: "wA", amountCents: 1000000, date: "2026-07-06", description: "ACH", pending: false },
      { transactionId: "wB", amountCents: 1000000, date: "2026-07-20", description: "ACH", pending: false },
    ];
    const res = reconcilePayroll(runs, withdrawals, { todayIso: "2026-07-31" });
    ok(res.summary.matched === 2, "case6: both runs matched");
    // View order is newest first.
    ok(res.runs[0].runId === "r2" && res.runs[1].runId === "r1", "case6: view is newest pay date first");
    ok(res.runs[0].matchedTransactionId === "wB" && res.runs[1].matchedTransactionId === "wA", "case6: each run tied to its own debit");
    ok(res.unexplainedDebits.length === 0, "case6: no leftover debits");
  }

  // Case 7: zero/invalid expected is skipped entirely ----------------------
  {
    const runs: ReconcileRun[] = [
      { runId: "r0", label: "empty", payDate: "2026-07-06", totalNetCents: 0, status: "file_generated", entryCount: 0 },
      { runId: "r1", label: "real", payDate: "2026-07-06", totalNetCents: 500000, status: "submitted", entryCount: 4 },
    ];
    const withdrawals: BankWithdrawal[] = [
      { transactionId: "w1", amountCents: 500000, date: "2026-07-06", description: "ACH", pending: false },
    ];
    const res = reconcilePayroll(runs, withdrawals, { todayIso: "2026-07-20" });
    ok(res.summary.runCount === 1, "case7: zero-amount run is not counted");
    ok(res.runs[0].runId === "r1" && res.runs[0].status === "matched", "case7: only the real run reconciles");
  }
}
