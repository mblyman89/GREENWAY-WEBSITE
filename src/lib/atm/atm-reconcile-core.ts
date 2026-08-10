/**
 * src/lib/atm/atm-reconcile-core.ts — PURE ATM reconciliation engine (P6a).
 *
 * WHAT THIS ANSWERS (Michael's exact ask)
 * Michael owns his ATM outright. Each PAI "settlement date" turns into TWO
 * SEPARATE deposits landing in his dedicated ATM bank account (the Plaid account
 * he tags role="atm"):
 *   • the VAULT-CASH / "transaction" leg — the cash withdrawn from the machine,
 *     re-deposited by the processor, and
 *   • the SURCHARGE leg — his fee revenue (he keeps 100%).
 * He wants each leg matched line-item-by-line-item against the real bank deposit,
 * exactly as the bank shows them — never lumped together.
 *
 * WHY A PURE CORE
 * All the judgment (which deposit matches which leg, is it on time, does the
 * amount tie out) lives here with ZERO I/O so it's exhaustively self-tested and
 * deterministic. The store feeds it plain arrays; the page just renders the
 * result. This mirrors every other Greenway slice.
 *
 * VERIFIED FACTS THIS IS BUILT ON (audited, not guessed):
 *   • atm_settlements carries terminalTransactionCents + surchargeCents per
 *     (settlementDate, terminalId) — src/lib/atm/store.ts.
 *   • bankPostingWindow(iso, 1, 3) already gives the inclusive T+1..T+3
 *     business-day ISO window a deposit can post in — src/lib/atm/atm-core.ts.
 *   • Plaid sign convention (load-bearing): NEGATIVE amount_cents = money IN
 *     (a deposit). We convert those to POSITIVE deposit magnitudes here.
 *   • Money is integer CENTS everywhere.
 *
 * STATUS MODEL (per leg) — plain English so a novice gets it instantly:
 *   • matched   — a bank deposit of the exact expected amount posted in-window.
 *   • mismatch  — a deposit posted in-window but the amount is off (we show by
 *                 how many cents, signed).
 *   • awaiting  — no deposit yet, but we're still inside the posting window
 *                 (this is NORMAL — the bank just hasn't posted it yet).
 *   • unmatched — the window has fully passed and no deposit ever arrived
 *                 (THIS is the one to chase).
 *
 * GREEDY, DETERMINISTIC MATCHING: legs are processed oldest-settlement-first,
 * transaction-leg before surcharge-leg. Each bank deposit can be consumed by at
 * most ONE leg (so two legs never claim the same deposit). Within a leg's window
 * we prefer an EXACT amount match; if none, the closest-amount in-window deposit
 * becomes a mismatch ONLY when it's within a sensible tolerance band (so a $1,800
 * leg never "matches" a $45 deposit — that would be nonsense); if the window is
 * still open we mark awaiting and DON'T consume anything. This is the classic
 * bank-rec worksheet, made honest.
 *
 * MISMATCH TOLERANCE (enterprise-standard): a candidate is only treated as a
 * mismatch when it's within the LARGER of a flat floor (default $5) and a
 * percentage of the expected amount (default 2%). Anything further off is not a
 * plausible restatement of the same deposit, so the leg stays awaiting/unmatched
 * and that stray deposit surfaces as "unexplained" instead.
 */

import { bankPostingWindow } from "./atm-core";

// ---------------------------------------------------------------------------
// Inputs (plain data the store hands us)
// ---------------------------------------------------------------------------

/** A settlement to reconcile — the two legs come straight from atm_settlements. */
export type ReconcileSettlement = {
  /** atm_settlements.id (for writing atm_reconciliation rows later / stable keys). */
  settlementId: string;
  settlementDate: string; // ISO yyyy-mm-dd
  terminalId: string;
  /** Vault-cash leg expected in cents (null = PAI didn't report it). */
  terminalTransactionCents: number | null;
  /** Surcharge leg expected in cents (null = not reported). */
  surchargeCents: number | null;
};

/** A candidate bank deposit (a money-IN transaction on the ATM-role account). */
export type BankDeposit = {
  transactionId: string;
  /** POSITIVE cents actually deposited (we flip Plaid's negative inflow sign). */
  amountCents: number;
  /** Posted date ISO yyyy-mm-dd (Plaid transaction date). */
  date: string;
  /** For display: merchant/name of the deposit line. */
  description: string | null;
  pending: boolean;
};

export type ReconcileLegKind = "transaction" | "surcharge";
export type ReconcileStatus = "matched" | "mismatch" | "awaiting" | "unmatched";

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type LegMatch = {
  /** Stable key: settlementId + leg (mirrors atm_reconciliation's unique index). */
  key: string;
  settlementId: string;
  settlementDate: string;
  terminalId: string;
  leg: ReconcileLegKind;
  legLabel: string; // "Vault cash" | "Surcharge"
  expectedCents: number | null;
  /** Cents actually posted by the matched deposit (null when none claimed). */
  matchedCents: number | null;
  /** matchedCents − expectedCents (signed). 0 on a clean match; null when nothing to compare. */
  differenceCents: number | null;
  status: ReconcileStatus;
  /** The bank deposit that satisfied this leg (null for awaiting/unmatched). */
  bankTransactionId: string | null;
  bankPostedDate: string | null;
  bankDescription: string | null;
  /** Inclusive posting window we searched, for the UI to explain "awaiting". */
  windowEarliest: string | null;
  windowLatest: string | null;
  /** One plain-English sentence a novice can act on. */
  message: string;
};

export type ReconcileSummary = {
  legCount: number;
  matched: number;
  mismatch: number;
  awaiting: number;
  unmatched: number;
  /** Total expected across all legs that HAVE an expected amount, cents. */
  totalExpectedCents: number;
  /** Total actually matched (posted) across matched+mismatch legs, cents. */
  totalMatchedCents: number;
  /** totalMatchedCents − totalExpectedCents (signed). */
  netDifferenceCents: number;
  /**
   * True when there is nothing needing attention: no mismatch and no unmatched
   * legs. (awaiting is fine — the bank just hasn't posted yet.) This is the
   * "everything ties out" green light.
   */
  allClear: boolean;
  /** Count of deposits on the ATM account we could NOT tie to any leg. */
  unexplainedDepositCount: number;
  unexplainedDepositCents: number;
};

export type ReconcileResult = {
  legs: LegMatch[];
  summary: ReconcileSummary;
  /**
   * Deposits on the ATM account that no leg claimed. Surfaced so the owner can
   * see money that arrived but wasn't expected (e.g. a manual transfer, or PAI
   * data not synced yet). Sorted newest-first for the UI.
   */
  unexplainedDeposits: BankDeposit[];
};

// ---------------------------------------------------------------------------
// Small helpers (pure)
// ---------------------------------------------------------------------------

export function legLabel(leg: ReconcileLegKind): string {
  return leg === "transaction" ? "Vault cash" : "Surcharge";
}

/** A minimal Plaid-transaction shape (subset of PlaidTransactionRecord) we read. */
export type DepositSourceTxn = {
  transactionId: string;
  amountCents: number; // Plaid sign: NEGATIVE = money in (deposit)
  date: string;
  name: string | null;
  merchantName: string | null;
  pending: boolean;
};

/**
 * Convert raw ATM-account transactions into positive-magnitude BankDeposits.
 * ONLY money-IN rows (Plaid negative amount) become deposits; outflows (positive)
 * are dropped — the ATM account should be deposits + transfers-out, and we only
 * reconcile the deposits. PURE.
 */
export function toBankDeposits(txns: DepositSourceTxn[]): BankDeposit[] {
  const out: BankDeposit[] = [];
  for (const t of txns) {
    if (t.amountCents >= 0) continue; // not a deposit
    out.push({
      transactionId: t.transactionId,
      amountCents: -t.amountCents, // flip to positive deposited magnitude
      date: t.date,
      description: t.merchantName ?? t.name,
      pending: t.pending,
    });
  }
  return out;
}

/** ISO date compare helper: is `d` within [lo, hi] inclusive? Lexical works for yyyy-mm-dd. */
export function isoWithin(d: string, lo: string, hi: string): boolean {
  return d >= lo && d <= hi;
}

/** Format signed cents difference for a message, e.g. +$0.50 / −$2.00. */
export function formatDiff(cents: number): string {
  const sign = cents > 0 ? "+" : cents < 0 ? "−" : "";
  const abs = Math.abs(cents);
  const dollars = (abs / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}$${dollars}`;
}

type WorkingDeposit = BankDeposit & { consumed: boolean };

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

/**
 * Pick the best in-window deposit for an expected amount from the not-yet-consumed
 * pool. Preference order:
 *   1) EXACT amount match (earliest date wins on ties),
 *   2) otherwise the closest amount WITHIN the tolerance band — becomes a
 *      mismatch. A candidate further off than the tolerance is ignored (it is
 *      not a plausible restatement of the same deposit).
 * Returns the chosen deposit + whether it was exact, or null when nothing in the
 * window qualifies.
 */
function pickBestDeposit(
  pool: WorkingDeposit[],
  expectedCents: number,
  lo: string,
  hi: string,
  toleranceCents: number,
): { deposit: WorkingDeposit; exact: boolean } | null {
  let bestExact: WorkingDeposit | null = null;
  let bestApprox: WorkingDeposit | null = null;
  let bestApproxDelta = Number.POSITIVE_INFINITY;

  for (const d of pool) {
    if (d.consumed) continue;
    if (!isoWithin(d.date, lo, hi)) continue;
    if (d.amountCents === expectedCents) {
      if (bestExact === null || d.date < bestExact.date) bestExact = d;
      continue;
    }
    const delta = Math.abs(d.amountCents - expectedCents);
    if (delta > toleranceCents) continue; // too far off to be the same deposit
    if (delta < bestApproxDelta || (delta === bestApproxDelta && bestApprox !== null && d.date < bestApprox.date)) {
      bestApprox = d;
      bestApproxDelta = delta;
    }
  }

  if (bestExact) return { deposit: bestExact, exact: true };
  if (bestApprox) return { deposit: bestApprox, exact: false };
  return null;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

export type ReconcileOptions = {
  /** Today's ISO date (yyyy-mm-dd) — used to decide awaiting vs unmatched. */
  todayIso: string;
  /** Posting-window business days (default T+1..T+3, matching bankPostingWindow). */
  minBusinessDays?: number;
  maxBusinessDays?: number;
  /** Mismatch tolerance floor in cents (default $5). */
  toleranceFloorCents?: number;
  /** Mismatch tolerance percent of expected (default 2%). */
  tolerancePercent?: number;
};

/**
 * Reconcile every settlement's two legs against the ATM account's deposits.
 * PURE and deterministic. Never throws on bad data — legs with a null/zero
 * expected amount are skipped (they can't be reconciled and aren't counted).
 */
export function reconcileSettlements(
  settlements: ReconcileSettlement[],
  deposits: BankDeposit[],
  opts: ReconcileOptions,
): ReconcileResult {
  const minD = opts.minBusinessDays ?? 1;
  const maxD = opts.maxBusinessDays ?? 3;

  // Work on a mutable copy so we can mark deposits consumed as legs claim them.
  const pool: WorkingDeposit[] = deposits.map((d) => ({ ...d, consumed: false }));

  // Deterministic order: oldest settlement first, then transaction-leg before
  // surcharge-leg. This makes greedy consumption stable + reproducible.
  const ordered = [...settlements].sort((a, b) => {
    if (a.settlementDate !== b.settlementDate) return a.settlementDate < b.settlementDate ? -1 : 1;
    if (a.terminalId !== b.terminalId) return a.terminalId < b.terminalId ? -1 : 1;
    return a.settlementId < b.settlementId ? -1 : a.settlementId > b.settlementId ? 1 : 0;
  });

  const legs: LegMatch[] = [];

  const buildLeg = (
    s: ReconcileSettlement,
    leg: ReconcileLegKind,
    expected: number | null,
  ): LegMatch => {
    const label = legLabel(leg);
    const key = `${s.settlementId}:${leg}`;
    const base: LegMatch = {
      key,
      settlementId: s.settlementId,
      settlementDate: s.settlementDate,
      terminalId: s.terminalId,
      leg,
      legLabel: label,
      expectedCents: expected,
      matchedCents: null,
      differenceCents: null,
      status: "unmatched",
      bankTransactionId: null,
      bankPostedDate: null,
      bankDescription: null,
      windowEarliest: null,
      windowLatest: null,
      message: "",
    };

    // No usable expected amount → nothing to reconcile; caller filters these out.
    if (expected === null || expected === 0) {
      return { ...base, status: "unmatched", message: `${label}: no expected amount reported by PAI.` };
    }

    const win = bankPostingWindow(s.settlementDate, minD, maxD);
    if (!win) {
      return { ...base, status: "unmatched", message: `${label}: settlement date is unreadable, cannot reconcile.` };
    }
    base.windowEarliest = win.earliest;
    base.windowLatest = win.latest;

    const tol = toleranceCentsFor(expected, opts.toleranceFloorCents, opts.tolerancePercent);
    const pick = pickBestDeposit(pool, expected, win.earliest, win.latest, tol);
    if (pick) {
      pick.deposit.consumed = true;
      const posted = pick.deposit.amountCents;
      const diff = posted - expected;
      const matchStatus: ReconcileStatus = pick.exact ? "matched" : "mismatch";
      return {
        ...base,
        matchedCents: posted,
        differenceCents: diff,
        status: matchStatus,
        bankTransactionId: pick.deposit.transactionId,
        bankPostedDate: pick.deposit.date,
        bankDescription: pick.deposit.description,
        message:
          matchStatus === "matched"
            ? `${label}: matched a bank deposit of ${formatDiff(posted).replace("+", "")} on ${pick.deposit.date}.`
            : `${label}: a deposit posted on ${pick.deposit.date} but it's off by ${formatDiff(diff)} — please review.`,
      };
    }

    // Nothing claimed. Still in window (today ≤ latest) → awaiting; else unmatched.
    const stillOpen = opts.todayIso <= win.latest;
    return {
      ...base,
      status: stillOpen ? "awaiting" : "unmatched",
      message: stillOpen
        ? `${label}: waiting for the bank deposit (expected by ${win.latest}).`
        : `${label}: expected deposit never arrived (window ended ${win.latest}) — please chase this.`,
    };
  };

  for (const s of ordered) {
    if (s.terminalTransactionCents !== null && s.terminalTransactionCents !== 0) {
      legs.push(buildLeg(s, "transaction", s.terminalTransactionCents));
    }
    if (s.surchargeCents !== null && s.surchargeCents !== 0) {
      legs.push(buildLeg(s, "surcharge", s.surchargeCents));
    }
  }

  // Summary + unexplained deposits.
  let matched = 0;
  let mismatch = 0;
  let awaiting = 0;
  let unmatched = 0;
  let totalExpectedCents = 0;
  let totalMatchedCents = 0;
  for (const l of legs) {
    if (l.expectedCents) totalExpectedCents += l.expectedCents;
    if (l.matchedCents) totalMatchedCents += l.matchedCents;
    if (l.status === "matched") matched += 1;
    else if (l.status === "mismatch") mismatch += 1;
    else if (l.status === "awaiting") awaiting += 1;
    else unmatched += 1;
  }

  const unexplained: BankDeposit[] = pool
    .filter((d) => !d.consumed)
    .map((d) => ({
      transactionId: d.transactionId,
      amountCents: d.amountCents,
      date: d.date,
      description: d.description,
      pending: d.pending,
    }));
  unexplained.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest first
  const unexplainedDepositCents = unexplained.reduce((s, d) => s + d.amountCents, 0);

  const summary: ReconcileSummary = {
    legCount: legs.length,
    matched,
    mismatch,
    awaiting,
    unmatched,
    totalExpectedCents,
    totalMatchedCents,
    netDifferenceCents: totalMatchedCents - totalExpectedCents,
    allClear: mismatch === 0 && unmatched === 0,
    unexplainedDepositCount: unexplained.length,
    unexplainedDepositCents,
  };

  // Legs newest-first for the UI (settlement date desc, transaction leg first).
  const legsForView = [...legs].sort((a, b) => {
    if (a.settlementDate !== b.settlementDate) return a.settlementDate < b.settlementDate ? 1 : -1;
    if (a.terminalId !== b.terminalId) return a.terminalId < b.terminalId ? -1 : 1;
    return a.leg === b.leg ? 0 : a.leg === "transaction" ? -1 : 1;
  });

  return { legs: legsForView, summary, unexplainedDeposits: unexplained };
}

// ---------------------------------------------------------------------------
// Self-tests (harness parity with the other cores).
// ---------------------------------------------------------------------------

export function __runAtmReconcileCoreTests(): void {
  const failures: string[] = [];
  const ok = (cond: boolean, msg: string) => {
    if (!cond) failures.push(msg);
  };

  // helpers -----------------------------------------------------------------
  ok(legLabel("transaction") === "Vault cash", "transaction leg label");
  ok(legLabel("surcharge") === "Surcharge", "surcharge leg label");
  ok(isoWithin("2025-03-05", "2025-03-04", "2025-03-06"), "isoWithin inside");
  ok(!isoWithin("2025-03-07", "2025-03-04", "2025-03-06"), "isoWithin after");
  ok(!isoWithin("2025-03-03", "2025-03-04", "2025-03-06"), "isoWithin before");
  ok(formatDiff(50) === "+$0.50", "formatDiff positive");
  ok(formatDiff(-200) === "−$2.00", "formatDiff negative (unicode minus)");
  ok(formatDiff(0) === "$0.00", "formatDiff zero has no sign");
  ok(formatDiff(123456) === "+$1,234.56", "formatDiff thousands");

  // toleranceCentsFor -------------------------------------------------------
  ok(toleranceCentsFor(180000) === 3600, "tolerance: 2% of $1,800 = $36 (beats $5 floor)");
  ok(toleranceCentsFor(4500) === 500, "tolerance: 2% of $45 = 90c → floor $5 wins");
  ok(toleranceCentsFor(100000, 1000, 5) === 5000, "tolerance: custom 5% of $1,000 = $50");
  ok(toleranceCentsFor(1000, 1000, 2) === 1000, "tolerance: floor wins on small amounts");

  // toBankDeposits ----------------------------------------------------------
  {
    const deps = toBankDeposits([
      { transactionId: "in1", amountCents: -180000, date: "2025-03-04", name: "PAI CASH", merchantName: null, pending: false },
      { transactionId: "out1", amountCents: 50000, date: "2025-03-04", name: "Transfer out", merchantName: null, pending: false },
      { transactionId: "in2", amountCents: -4500, date: "2025-03-05", name: "row", merchantName: "PAI SURCH", pending: true },
    ]);
    ok(deps.length === 2, "toBankDeposits: keeps only inflows (drops the transfer out)");
    ok(deps[0].transactionId === "in1" && deps[0].amountCents === 180000, "toBankDeposits: flips sign to positive");
    ok(deps[1].description === "PAI SURCH", "toBankDeposits: merchant name preferred for description");
    ok(deps[1].pending === true, "toBankDeposits: pending flag preserved");
  }

  // Settlement dated Mon 2025-03-03 → window T+1..T+3 business days = Tue..Thu
  // 2025-03-04 .. 2025-03-06 (bankPostingWindow verified in atm-core tests).
  const settlement: ReconcileSettlement = {
    settlementId: "s1",
    settlementDate: "2025-03-03",
    terminalId: "HG26499",
    terminalTransactionCents: 180000, // $1,800 vault cash
    surchargeCents: 4500, // $45 surcharge
  };

  // CASE 1: both legs matched exactly, on separate deposits ------------------
  {
    const deposits: BankDeposit[] = [
      { transactionId: "d1", amountCents: 180000, date: "2025-03-04", description: "PAI CASH", pending: false },
      { transactionId: "d2", amountCents: 4500, date: "2025-03-05", description: "PAI SURCH", pending: false },
    ];
    const res = reconcileSettlements([settlement], deposits, { todayIso: "2025-03-20" });
    ok(res.legs.length === 2, "case1: two legs");
    const txnLeg = res.legs.find((l) => l.leg === "transaction")!;
    const surLeg = res.legs.find((l) => l.leg === "surcharge")!;
    ok(txnLeg.status === "matched" && txnLeg.bankTransactionId === "d1", "case1: vault-cash matched d1");
    ok(surLeg.status === "matched" && surLeg.bankTransactionId === "d2", "case1: surcharge matched d2");
    ok(txnLeg.differenceCents === 0 && surLeg.differenceCents === 0, "case1: zero difference");
    ok(res.summary.matched === 2 && res.summary.allClear === true, "case1: allClear");
    ok(res.summary.totalExpectedCents === 184500 && res.summary.totalMatchedCents === 184500, "case1: totals tie");
    ok(res.summary.unexplainedDepositCount === 0, "case1: no unexplained deposits");
  }

  // CASE 2: two legs must NOT claim the same deposit -------------------------
  {
    // Only ONE deposit that happens to equal the vault-cash leg. Surcharge must
    // NOT also grab it — it should go awaiting/unmatched instead.
    const deposits: BankDeposit[] = [
      { transactionId: "d1", amountCents: 180000, date: "2025-03-04", description: "PAI", pending: false },
    ];
    const res = reconcileSettlements([settlement], deposits, { todayIso: "2025-03-20" });
    const txnLeg = res.legs.find((l) => l.leg === "transaction")!;
    const surLeg = res.legs.find((l) => l.leg === "surcharge")!;
    ok(txnLeg.status === "matched" && txnLeg.bankTransactionId === "d1", "case2: vault-cash claims the deposit");
    ok(surLeg.bankTransactionId === null, "case2: surcharge does NOT reuse the same deposit");
    ok(surLeg.status === "unmatched", "case2: surcharge unmatched (window passed, none left)");
  }

  // CASE 3: mismatch — deposit posted in-window but wrong amount ------------
  {
    const deposits: BankDeposit[] = [
      { transactionId: "d1", amountCents: 179950, date: "2025-03-05", description: "PAI", pending: false }, // 50c short
      { transactionId: "d2", amountCents: 4500, date: "2025-03-05", description: "PAI", pending: false },
    ];
    const res = reconcileSettlements([settlement], deposits, { todayIso: "2025-03-20" });
    const txnLeg = res.legs.find((l) => l.leg === "transaction")!;
    ok(txnLeg.status === "mismatch", "case3: vault-cash mismatch");
    ok(txnLeg.matchedCents === 179950 && txnLeg.differenceCents === -50, "case3: difference -50c");
    ok(res.summary.allClear === false, "case3: not allClear when a mismatch exists");
    ok(res.summary.netDifferenceCents === -50, "case3: net difference reflects the 50c short");
  }

  // CASE 4: awaiting vs unmatched depends on today --------------------------
  {
    // No deposits at all.
    const stillOpen = reconcileSettlements([settlement], [], { todayIso: "2025-03-05" }); // today inside window
    ok(stillOpen.legs.every((l) => l.status === "awaiting"), "case4: inside window → awaiting");
    ok(stillOpen.summary.allClear === true, "case4: awaiting is still allClear (nothing wrong yet)");
    const closed = reconcileSettlements([settlement], [], { todayIso: "2025-03-20" }); // today past window
    ok(closed.legs.every((l) => l.status === "unmatched"), "case4: past window → unmatched");
    ok(closed.summary.allClear === false, "case4: unmatched breaks allClear");
    ok(closed.legs[0].windowLatest === "2025-03-06", "case4: window latest is Thu 2025-03-06");
  }

  // CASE 5: deposit OUTSIDE the window is not matched, shows as unexplained --
  {
    const deposits: BankDeposit[] = [
      { transactionId: "d1", amountCents: 180000, date: "2025-03-10", description: "late", pending: false }, // past window
      { transactionId: "d2", amountCents: 4500, date: "2025-03-05", description: "surch", pending: false },
    ];
    const res = reconcileSettlements([settlement], deposits, { todayIso: "2025-03-20" });
    const txnLeg = res.legs.find((l) => l.leg === "transaction")!;
    ok(txnLeg.status === "unmatched", "case5: out-of-window deposit does not match vault-cash");
    ok(res.summary.unexplainedDepositCount === 1, "case5: the late deposit is unexplained");
    ok(res.unexplainedDeposits[0].transactionId === "d1", "case5: unexplained lists d1");
    ok(res.summary.unexplainedDepositCents === 180000, "case5: unexplained total cents");
  }

  // CASE 5b: a deposit WITHIN tolerance but not exact → mismatch, beyond → skip
  {
    const s: ReconcileSettlement = {
      settlementId: "s5b",
      settlementDate: "2025-03-03",
      terminalId: "HG26499",
      terminalTransactionCents: 180000,
      surchargeCents: null,
    };
    // $1,770 is $30 off (within the $36 tolerance) → mismatch.
    const within = reconcileSettlements([s], [
      { transactionId: "d1", amountCents: 177000, date: "2025-03-04", description: "PAI", pending: false },
    ], { todayIso: "2025-03-20" });
    ok(within.legs[0].status === "mismatch" && within.legs[0].differenceCents === -3000, "case5b: within tolerance → mismatch");
    // $1,700 is $100 off (beyond $36) → NOT a match; window passed → unmatched + unexplained.
    const beyond = reconcileSettlements([s], [
      { transactionId: "d1", amountCents: 170000, date: "2025-03-04", description: "PAI", pending: false },
    ], { todayIso: "2025-03-20" });
    ok(beyond.legs[0].status === "unmatched", "case5b: beyond tolerance → unmatched");
    ok(beyond.summary.unexplainedDepositCount === 1, "case5b: the too-far deposit is unexplained");
  }

  // CASE 6: null/zero expected legs are skipped -----------------------------
  {
    const partial: ReconcileSettlement = {
      settlementId: "s2",
      settlementDate: "2025-03-03",
      terminalId: "HG26499",
      terminalTransactionCents: 180000,
      surchargeCents: null, // not reported
    };
    const res = reconcileSettlements([partial], [
      { transactionId: "d1", amountCents: 180000, date: "2025-03-04", description: "PAI", pending: false },
    ], { todayIso: "2025-03-20" });
    ok(res.legs.length === 1 && res.legs[0].leg === "transaction", "case6: only the reported leg is reconciled");
    ok(res.summary.legCount === 1, "case6: summary counts one leg");
  }

  // CASE 7: multiple settlements, greedy oldest-first, stable ordering ------
  {
    const s2: ReconcileSettlement = {
      settlementId: "s2",
      settlementDate: "2025-03-04", // next day
      terminalId: "HG26499",
      terminalTransactionCents: 180000, // same amount as s1's vault leg
      surchargeCents: null,
    };
    // Two 180000 deposits: the OLDER settlement (s1) should claim the earlier
    // in-window deposit; s2 claims the later one. Neither steals the other's.
    const deposits: BankDeposit[] = [
      { transactionId: "dA", amountCents: 180000, date: "2025-03-04", description: "for s1", pending: false },
      { transactionId: "dB", amountCents: 180000, date: "2025-03-06", description: "for s2", pending: false },
      { transactionId: "dC", amountCents: 4500, date: "2025-03-05", description: "s1 surch", pending: false },
    ];
    const res = reconcileSettlements([s2, settlement], deposits, { todayIso: "2025-03-20" });
    const s1txn = res.legs.find((l) => l.settlementId === "s1" && l.leg === "transaction")!;
    const s2txn = res.legs.find((l) => l.settlementId === "s2" && l.leg === "transaction")!;
    ok(s1txn.bankTransactionId === "dA", "case7: older settlement s1 claims earlier deposit dA");
    ok(s2txn.bankTransactionId === "dB", "case7: s2 claims the later deposit dB");
    ok(res.summary.unexplainedDepositCount === 0, "case7: all deposits explained");
  }

  // CASE 8: view ordering is newest settlement first, txn leg before surcharge
  {
    const older = { ...settlement, settlementId: "old", settlementDate: "2025-03-01" };
    const newer = { ...settlement, settlementId: "new", settlementDate: "2025-03-10" };
    const res = reconcileSettlements([older, newer], [], { todayIso: "2025-04-01" });
    ok(res.legs[0].settlementId === "new", "case8: newest settlement legs first");
    ok(res.legs[0].leg === "transaction" && res.legs[1].leg === "surcharge", "case8: txn leg before surcharge within a settlement");
    ok(res.legs[2].settlementId === "old", "case8: older settlement after");
  }

  if (failures.length > 0) {
    throw new Error("atm-reconcile-core self-tests FAILED:\n" + failures.map((f) => "  - " + f).join("\n"));
  }
  console.log("atm-reconcile-core: all self-tests passed");
}
