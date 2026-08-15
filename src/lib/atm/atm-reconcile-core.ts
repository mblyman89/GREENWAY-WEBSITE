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

/**
 * Leg outcomes.
 *
 * Two statuses were ADDED after Michael's 2026-08-15 report ("some of the data
 * is in the wrong spot, or the ATM company deposited the money incorrectly").
 * Both existed in the real world already; the engine simply had no vocabulary
 * for them and so mislabelled them "unmatched", i.e. "money never arrived".
 *
 *   • late    — the deposit DID arrive, just outside the T+1..T+3 window. The
 *               money is not missing; it is slow. Calling that "never arrived"
 *               sent the owner chasing cash that was sitting in his account.
 *   • bundled — one bank deposit paid off SEVERAL settlement legs at once
 *               (the ATM company combining days). Previously every one of those
 *               days read "never arrived" while the combined deposit sat in the
 *               unexplained pile — the same dollars counted as both missing and
 *               unexplained, which is how a reconciliation lies twice.
 *   • no_bank_data — the ATM history reaches back further than the bank feed
 *               does, so there is NOTHING to match against. This is an absence
 *               of evidence, not evidence of loss, and it must never be added
 *               into a shortage total.
 */
export type ReconcileStatus =
  | "matched"
  | "mismatch"
  | "late"
  | "bundled"
  | "awaiting"
  | "unmatched"
  | "no_bank_data";

/**
 * Statuses that mean "this leg is explained — the money is accounted for".
 * matched/late/bundled all end with the dollars located. Kept as one list so
 * the UI, the summary and any future poster agree on what "settled" means.
 */
export const SETTLED_STATUSES: readonly ReconcileStatus[] = ["matched", "late", "bundled"];

/** True when the leg's money has been located, whenever/however it landed. */
export function isSettled(status: ReconcileStatus): boolean {
  return SETTLED_STATUSES.includes(status);
}

/**
 * True when a leg represents a REAL problem the owner must act on.
 * Deliberately EXCLUDES no_bank_data (we have no evidence either way) and
 * awaiting (the window is still open). Including them is precisely the bug that
 * produced a false six-figure shortage.
 */
export function needsAttention(status: ReconcileStatus): boolean {
  return status === "mismatch" || status === "unmatched";
}

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
  /** Deposit arrived, but after the posting window closed. Money located. */
  late: number;
  /** Leg was paid as part of a combined multi-day deposit. Money located. */
  bundled: number;
  awaiting: number;
  unmatched: number;
  /** Legs older than the bank feed — unjudgeable, NOT missing money. */
  noBankData: number;
  /** Expected cents sitting in no_bank_data legs, reported SEPARATELY. */
  noBankDataCents: number;
  /** Span the bank feed actually covers (null when there are no deposits). */
  bankCoverageEarliest: string | null;
  bankCoverageLatest: string | null;
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
/**
 * Is there ANOTHER unconsumed leg that this deposit fits EXACTLY?
 *
 * THE BUG THIS EXISTS TO PREVENT (proved 2026-08-15 from Michael's screenshot):
 * legs are served oldest-first, and a leg was allowed to take an INEXACT deposit
 * from inside its 2% tolerance band. On 2026-07-05 the expected vault cash was
 * $5,020.00; on 2026-07-06 it was $4,940.00. Exactly one $4,940.00 deposit
 * existed. The tolerance band on the 07-05 leg is $100.40, and the gap to
 * $4,940.00 is only $80.00 — inside the band. So the 07-05 leg ATE the deposit
 * that belonged, to the penny, to 07-06.
 *
 * Result on screen: 07-05 "Amount off" and 07-06 "Not deposited" — two wrong
 * answers from one greedy step, and the owner sent chasing money that was never
 * missing. An exact claim must always outrank an approximate one.
 */
function depositIsExactForAnotherLeg(
  deposit: WorkingDeposit,
  currentLegKey: string,
  pendingLegs: readonly PendingLeg[],
): boolean {
  for (const other of pendingLegs) {
    if (other.key === currentLegKey) continue;
    if (other.claimed) continue;
    if (other.expectedCents !== deposit.amountCents) continue;
    if (!isoWithin(deposit.date, other.windowEarliest, other.windowLatest)) continue;
    return true;
  }
  return false;
}

/** A leg awaiting allocation — used for the two-pass exact-first matcher. */
type PendingLeg = {
  key: string;
  expectedCents: number;
  windowEarliest: string;
  windowLatest: string;
  claimed: boolean;
};

function pickBestDeposit(
  pool: WorkingDeposit[],
  expectedCents: number,
  lo: string,
  hi: string,
  toleranceCents: number,
  /** Reserve exact matches for their rightful owners. */
  legKey?: string,
  pendingLegs?: readonly PendingLeg[],
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
    // DO NOT take a deposit that is somebody else's EXACT match. An approximate
    // claim must never outrank an exact one, no matter who asks first.
    if (legKey && pendingLegs && depositIsExactForAnotherLeg(d, legKey, pendingLegs)) continue;
    if (delta < bestApproxDelta || (delta === bestApproxDelta && bestApprox !== null && d.date < bestApprox.date)) {
      bestApprox = d;
      bestApproxDelta = delta;
    }
  }

  if (bestExact) return { deposit: bestExact, exact: true };
  if (bestApprox) return { deposit: bestApprox, exact: false };
  return null;
}

/**
 * Look for an EXACT-amount deposit that landed AFTER the posting window closed.
 *
 * Deliberately exact-only: once we are outside the agreed window we have lost
 * the timing evidence, so the amount must carry the whole burden of proof. An
 * approximate late match would be a guess, and rule 3 forbids inventing values.
 */
function findLateDeposit(
  pool: WorkingDeposit[],
  expectedCents: number,
  windowLatest: string,
  searchDays: number,
): { deposit: WorkingDeposit; daysLate: number } | null {
  const latest = new Date(`${windowLatest}T00:00:00Z`);
  if (Number.isNaN(latest.getTime())) return null;
  const horizon = new Date(latest.getTime());
  horizon.setUTCDate(horizon.getUTCDate() + searchDays);
  const horizonIso = horizon.toISOString().slice(0, 10);

  let best: WorkingDeposit | null = null;
  for (const d of pool) {
    if (d.consumed) continue;
    if (d.amountCents !== expectedCents) continue;
    if (d.date <= windowLatest) continue; // that's in-window; handled elsewhere
    if (d.date > horizonIso) continue;
    if (best === null || d.date < best.date) best = d;
  }
  if (!best) return null;

  const bestDate = new Date(`${best.date}T00:00:00Z`);
  const daysLate = Math.round((bestDate.getTime() - latest.getTime()) / 86_400_000);
  return { deposit: best, daysLate };
}

/**
 * Find an EXACT subset of legs whose expected amounts sum to `target`.
 *
 * Exhaustive over subsets of size 2..maxSize, smallest first, so the simplest
 * explanation wins. Returns null when no exact combination exists — we would
 * rather report a leg as unmatched than assert a bundle we cannot prove.
 * Exact integer cents throughout; no tolerance is applied here on purpose,
 * because a "close enough" bundle is indistinguishable from a coincidence.
 */
function findExactSubset<T extends { expectedCents: number }>(
  items: readonly T[],
  target: number,
  maxSize: number,
): T[] | null {
  // Guard against pathological input: subset-sum is exponential, so cap the
  // candidate pool. Real settlement days never approach this.
  const pool = items.slice(0, 16);

  for (let size = 2; size <= Math.min(maxSize, pool.length); size++) {
    const idx: number[] = [];
    const walk = (start: number, remaining: number, sum: number): T[] | null => {
      if (remaining === 0) return sum === target ? idx.map((i) => pool[i]) : null;
      for (let i = start; i <= pool.length - remaining; i++) {
        const next = sum + pool[i].expectedCents;
        if (next > target) continue; // amounts are positive; prune
        idx.push(i);
        const hit = walk(i + 1, remaining - 1, next);
        if (hit) return hit;
        idx.pop();
      }
      return null;
    };
    const hit = walk(0, size, 0);
    if (hit) return hit;
  }
  return null;
}

/** Earliest/latest dates the bank feed actually covers. Null when no deposits. */
export function bankCoverageWindow(
  deposits: readonly BankDeposit[],
): { earliest: string; latest: string } | null {
  let earliest: string | null = null;
  let latest: string | null = null;
  for (const d of deposits) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) continue;
    if (earliest === null || d.date < earliest) earliest = d.date;
    if (latest === null || d.date > latest) latest = d.date;
  }
  if (earliest === null || latest === null) return null;
  return { earliest, latest };
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
  /**
   * Ignore settlements dated BEFORE this ISO date entirely.
   *
   * Michael, 2026-08-15: "the atm data goes further back than the bank does...
   * the system thinks the full history is the picture we should be looking at,
   * when we really only care about the current year." Without this the engine
   * had no way to be told what period is in scope, so it silently answered a
   * question nobody asked.
   */
  fromDateIso?: string;
  /** Ignore settlements dated AFTER this ISO date. */
  toDateIso?: string;
  /**
   * How many days past the window close to keep looking for a late deposit.
   * Default 10. Set 0 to disable late detection entirely.
   */
  lateSearchDays?: number;
  /**
   * When true (default), legs dated before the bank feed's earliest activity are
   * reported as `no_bank_data` instead of being counted as missing money.
   */
  respectBankCoverage?: boolean;
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

  // PERIOD SCOPE. Applied before anything else so out-of-scope history cannot
  // leak into a single total. Absent options = every settlement, as before.
  const inScope = (s: ReconcileSettlement): boolean => {
    if (opts.fromDateIso && s.settlementDate < opts.fromDateIso) return false;
    if (opts.toDateIso && s.settlementDate > opts.toDateIso) return false;
    return true;
  };
  const scoped = settlements.filter(inScope);

  // Work on a mutable copy so we can mark deposits consumed as legs claim them.
  // Deposits are scoped too, otherwise a deposit from outside the period could
  // satisfy a leg inside it and the two views would disagree.
  const pool: WorkingDeposit[] = deposits
    .filter((d) => {
      if (opts.fromDateIso && d.date < opts.fromDateIso) return false;
      if (opts.toDateIso && d.date > opts.toDateIso) return false;
      return true;
    })
    .map((d) => ({ ...d, consumed: false }));

  // What span does the bank feed actually cover? Used to distinguish "money is
  // missing" from "we have no bank records for that far back".
  const bankCoverage =
    (opts.respectBankCoverage ?? true) ? bankCoverageWindow(pool) : null;

  // Deterministic order: oldest settlement first, then transaction-leg before
  // surcharge-leg. This makes greedy consumption stable + reproducible.
  const ordered = [...scoped].sort((a, b) => {
    if (a.settlementDate !== b.settlementDate) return a.settlementDate < b.settlementDate ? -1 : 1;
    if (a.terminalId !== b.terminalId) return a.terminalId < b.terminalId ? -1 : 1;
    return a.settlementId < b.settlementId ? -1 : a.settlementId > b.settlementId ? 1 : 0;
  });

  const legs: LegMatch[] = [];

  // ---------------------------------------------------------------------------
  // PRE-PASS: register every leg that has a usable amount and a readable window,
  // so the matcher can tell whether a deposit is somebody else's exact match
  // BEFORE letting an earlier leg take it approximately.
  // ---------------------------------------------------------------------------
  const pendingLegs: PendingLeg[] = [];
  for (const s of ordered) {
    const win = bankPostingWindow(s.settlementDate, minD, maxD);
    if (!win) continue;
    if (s.terminalTransactionCents) {
      pendingLegs.push({
        key: `${s.settlementId}:transaction`,
        expectedCents: s.terminalTransactionCents,
        windowEarliest: win.earliest,
        windowLatest: win.latest,
        claimed: false,
      });
    }
    if (s.surchargeCents) {
      pendingLegs.push({
        key: `${s.settlementId}:surcharge`,
        expectedCents: s.surchargeCents,
        windowEarliest: win.earliest,
        windowLatest: win.latest,
        claimed: false,
      });
    }
  }
  const markClaimed = (key: string) => {
    const p = pendingLegs.find((x) => x.key === key);
    if (p) p.claimed = true;
  };

  // ---------------------------------------------------------------------------
  // BUNDLE PASS. Find deposits that exactly equal the SUM of two or more legs
  // whose windows all contain that deposit's date. Computed up-front so the
  // per-leg builder can simply look up its verdict.
  //
  // Bounded on purpose: subsets of size 2..MAX_BUNDLE_LEGS, and only over legs
  // that no single-leg match could claim. Exact cents only.
  // ---------------------------------------------------------------------------
  const bundleClaims = new Map<
    string,
    { deposit: BankDeposit; legCount: number }
  >();
  const MAX_BUNDLE_LEGS = 4;
  {
    // Legs that no exact single deposit can satisfy are bundle candidates.
    const singleMatchable = new Set<string>();
    for (const p of pendingLegs) {
      for (const d of pool) {
        if (d.amountCents === p.expectedCents && isoWithin(d.date, p.windowEarliest, p.windowLatest)) {
          singleMatchable.add(p.key);
          break;
        }
      }
    }

    for (const d of pool) {
      const candidates = pendingLegs.filter(
        (p) =>
          !singleMatchable.has(p.key) &&
          !bundleClaims.has(p.key) &&
          isoWithin(d.date, p.windowEarliest, p.windowLatest) &&
          p.expectedCents < d.amountCents,
      );
      if (candidates.length < 2) continue;

      // Depth-first exact subset-sum, smallest subsets first.
      const found = findExactSubset(candidates, d.amountCents, MAX_BUNDLE_LEGS);
      if (!found) continue;
      for (const leg of found) {
        bundleClaims.set(leg.key, { deposit: d, legCount: found.length });
        markClaimed(leg.key);
      }
      // The deposit is fully spoken for: consume it so it cannot ALSO be
      // reported as an unexplained deposit. Reporting the same dollars twice is
      // the exact defect this whole pass exists to remove.
      d.consumed = true;
    }
  }

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
    const pick = pickBestDeposit(pool, expected, win.earliest, win.latest, tol, key, pendingLegs);
    if (pick) {
      pick.deposit.consumed = true;
      markClaimed(key);
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

    // ------------------------------------------------------------------------
    // NOTHING CLAIMED IN-WINDOW. Before calling this money missing, ask three
    // honest questions in order. Each one exists because the old code answered
    // "the money never arrived" when that was demonstrably untrue.
    // ------------------------------------------------------------------------

    // (1) Did the deposit arrive LATE (after the window closed)? The money is in
    //     the account; it just took longer than T+3. Slow is not lost.
    //
    //     ORDER MATTERS, and my first attempt got it wrong (caught by case11).
    //     The no_bank_data guard used to run first, so a leg whose money landed
    //     just past the window — and was therefore the EARLIEST thing in the bank
    //     feed — got labelled "no bank records" while the matching deposit sat
    //     right there. ALWAYS LOOK FOR THE MONEY BEFORE DECLARING IT UNKNOWABLE.
    const late = findLateDeposit(pool, expected, win.latest, opts.lateSearchDays ?? 10);
    if (late) {
      late.deposit.consumed = true;
      markClaimed(key);
      return {
        ...base,
        matchedCents: late.deposit.amountCents,
        differenceCents: 0,
        status: "late",
        bankTransactionId: late.deposit.transactionId,
        bankPostedDate: late.deposit.date,
        bankDescription: late.deposit.description,
        message:
          `${label}: the deposit DID arrive, on ${late.deposit.date} — ` +
          `${late.daysLate} day(s) after the ${win.latest} cut-off. The money is not missing, it was slow.`,
      };
    }

    // (2) Do we even HAVE bank data covering this date? The ATM history reaches
    //     back to 2024 but the bank feed does not. With no statement to look at,
    //     "missing" is not a finding — it is an absence of evidence. Reporting it
    //     as a shortage is what produced Michael's phantom six-figure hole.
    //     GUARD ON THE GUARD (found by the pre-existing case2/case5 tests, which
    //     my first version broke): a settlement dated a DAY OR TWO before the
    //     first deposit is perfectly normal — its money simply posts a few days
    //     later, which is the entire premise of a T+1..T+3 window. Only treat
    //     history as uncovered when the whole POSTING WINDOW closes before the
    //     bank feed even begins. Comparing the settlement date directly against
    //     coverage.earliest declared ordinary same-week activity unjudgeable and
    //     silently swallowed real unmatched legs — a guard that hides findings is
    //     worse than no guard at all.
    if (bankCoverage && win.latest < bankCoverage.earliest) {
      return {
        ...base,
        status: "no_bank_data",
        message:
          `${label}: the bank feed doesn't reach back to ${s.settlementDate} ` +
          `(earliest bank activity is ${bankCoverage.earliest}), so there is nothing to compare against. ` +
          `This is NOT missing money — it is missing bank history.`,
      };
    }

    // (2.5) Was this leg paid inside a COMBINED deposit? Michael: "the ATM
    //     company deposited the money incorrectly." When they bundle several
    //     settlement days into one wire, every one of those days used to read
    //     "never arrived" while the combined deposit sat unexplained — the same
    //     dollars reported missing AND unexplained, simultaneously.
    //
    //     Deliberately conservative: we only claim a bundle when the leg's amount
    //     is part of an EXACT subset sum of a single deposit, together with other
    //     legs that are also unpaid and in-window. Exact arithmetic only — no
    //     tolerance, no rounding, no guessing (rule 3).
    if (bundleClaims.has(key)) {
      const b = bundleClaims.get(key)!;
      return {
        ...base,
        matchedCents: expected,
        differenceCents: 0,
        status: "bundled",
        bankTransactionId: b.deposit.transactionId,
        bankPostedDate: b.deposit.date,
        bankDescription: b.deposit.description,
        message:
          `${label}: paid as part of a combined deposit of ` +
          `${formatDiff(b.deposit.amountCents).replace("+", "")} on ${b.deposit.date}, ` +
          `which covered ${b.legCount} settlement legs at once. The money arrived — it was just bundled.`,
      };
    }

    // (3) Still in window (today ≤ latest) → awaiting; else genuinely unmatched.
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
  let late = 0;
  let bundled = 0;
  let awaiting = 0;
  let unmatched = 0;
  let noBankData = 0;
  let totalExpectedCents = 0;
  let totalMatchedCents = 0;
  let noBankDataCents = 0;
  for (const l of legs) {
    // A leg we CANNOT evaluate must not enter the expected/matched totals. It
    // has no bank statement behind it, so including it manufactures a shortage
    // out of thin air — the exact defect Michael reported.
    if (l.status === "no_bank_data") {
      noBankData += 1;
      if (l.expectedCents) noBankDataCents += l.expectedCents;
      continue;
    }
    if (l.expectedCents) totalExpectedCents += l.expectedCents;
    if (l.matchedCents) totalMatchedCents += l.matchedCents;
    if (l.status === "matched") matched += 1;
    else if (l.status === "mismatch") mismatch += 1;
    else if (l.status === "late") late += 1;
    else if (l.status === "bundled") bundled += 1;
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
    late,
    bundled,
    awaiting,
    unmatched,
    noBankData,
    noBankDataCents,
    totalExpectedCents,
    totalMatchedCents,
    netDifferenceCents: totalMatchedCents - totalExpectedCents,
    // allClear ignores no_bank_data on purpose: we are not claiming those are
    // fine, we are claiming we cannot judge them. They are reported separately
    // so the distinction stays visible rather than being averaged away.
    allClear: mismatch === 0 && unmatched === 0,
    unexplainedDepositCount: unexplained.length,
    unexplainedDepositCents,
    bankCoverageEarliest: bankCoverage?.earliest ?? null,
    bankCoverageLatest: bankCoverage?.latest ?? null,
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

  // CASE 5: deposit OUTSIDE the posting window.
  //
  // DELIBERATE BEHAVIOUR CHANGE, 2026-08-15 (standing rule 17 — say so plainly).
  // This test used to assert `unmatched` + "unexplained". That assertion encoded
  // a LIMITATION as if it were a requirement: the engine had no notion of a late
  // deposit, so an exact-amount arrival four days after the cut-off was reported
  // as money that never came, WHILE the very same dollars were simultaneously
  // listed as an unexplained deposit. One sum of money, counted as both missing
  // and unexplained. That is what put "Not deposited" on Michael's screen for
  // cash that was already in his account.
  //
  // The variable name in the original fixture — `description: "late"` — shows the
  // author already knew what this deposit really was.
  //
  // The ORIGINAL intent (an out-of-window deposit must not be treated as a normal
  // in-window match) is preserved and asserted below: the status is `late`, NOT
  // `matched`, and the old strict behaviour remains reachable via lateSearchDays: 0.
  {
    const deposits: BankDeposit[] = [
      { transactionId: "d1", amountCents: 180000, date: "2025-03-10", description: "late", pending: false }, // past window
      { transactionId: "d2", amountCents: 4500, date: "2025-03-05", description: "surch", pending: false },
    ];
    const res = reconcileSettlements([settlement], deposits, { todayIso: "2025-03-20" });
    const txnLeg = res.legs.find((l) => l.leg === "transaction")!;
    ok(txnLeg.status === "late", "case5: out-of-window exact deposit is 'late', not 'unmatched'");
    ok(txnLeg.status !== "matched", "case5: and it is still NOT a clean in-window match");
    ok(txnLeg.bankPostedDate === "2025-03-10", "case5: late leg names the real posting date");
    ok(res.summary.unexplainedDepositCount === 0, "case5: the money is no longer double-counted as unexplained");

    // The ORIGINAL strict semantics, still available on demand.
    const strict = reconcileSettlements([settlement], deposits, {
      todayIso: "2025-03-20",
      lateSearchDays: 0,
    });
    const strictTxn = strict.legs.find((l) => l.leg === "transaction")!;
    ok(strictTxn.status === "unmatched", "case5: lateSearchDays=0 reproduces the old behaviour");
    ok(strict.summary.unexplainedDepositCount === 1, "case5: strict mode still lists d1 as unexplained");
    ok(strict.unexplainedDeposits[0].transactionId === "d1", "case5: strict unexplained lists d1");
    ok(strict.summary.unexplainedDepositCents === 180000, "case5: strict unexplained total cents");
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

  // =========================================================================
  // REGRESSION CORPUS — every case below is a defect Michael actually hit on
  // 2026-08-15, reproduced from the numbers in his own screenshots. Standing
  // rule 19: the owner's real failures become permanent tests.
  // =========================================================================

  const vault = (date: string, id: string, cents: number): ReconcileSettlement => ({
    settlementId: id,
    settlementDate: date,
    terminalId: "HG26499",
    terminalTransactionCents: cents,
    surchargeCents: null,
  });
  const dep = (date: string, id: string, cents: number): BankDeposit => ({
    transactionId: id,
    amountCents: cents,
    date,
    description: "PAI DEPOSIT",
    pending: false,
  });

  // CASE 9: THE STOLEN EXACT MATCH (weird_behavior.pdf, 2026-07-05 / 07-06).
  // Expected $5,020.00 and $4,940.00; exactly one $4,940.00 deposit exists.
  // The 07-05 leg's 2% band is $100.40 and the gap is $80.00, so before the fix
  // it swallowed the deposit that exactly matched 07-06 — producing BOTH
  // "Amount off" on 07-05 and "Not deposited" on 07-06 from one greedy step.
  {
    const res = reconcileSettlements(
      [vault("2026-07-05", "s05", 502000), vault("2026-07-06", "s06", 494000)],
      [dep("2026-07-07", "b1", 494000)],
      { todayIso: "2026-08-15" },
    );
    const l05 = res.legs.find((l) => l.settlementId === "s05")!;
    const l06 = res.legs.find((l) => l.settlementId === "s06")!;
    ok(l06.status === "matched", "case9: the leg the deposit EXACTLY fits wins it");
    ok(l06.matchedCents === 494000, "case9: exact owner got the right cents");
    ok(l05.status !== "mismatch", "case9: the earlier leg no longer steals it");
    ok(l05.matchedCents === null, "case9: earlier leg claims nothing");
  }

  // CASE 10: exact-match reservation must NOT block a legitimate approximate
  // match when no other leg wants that deposit exactly.
  {
    const res = reconcileSettlements(
      [vault("2026-07-05", "s05", 502000)],
      [dep("2026-07-07", "b1", 494000)],
      { todayIso: "2026-08-15" },
    );
    ok(res.legs[0].status === "mismatch", "case10: lone leg still takes a close deposit");
    ok(res.legs[0].differenceCents === -8000, "case10: difference reported as −$80.00");
  }

  // CASE 11: LATE DEPOSIT. Money arrived after the window — slow, not lost.
  {
    const res = reconcileSettlements(
      [vault("2026-07-09", "s09", 260000)],
      [dep("2026-07-16", "b1", 260000)],
      { todayIso: "2026-08-15" },
    );
    ok(res.legs[0].status === "late", "case11: late arrival is 'late', not 'unmatched'");
    ok(res.legs[0].matchedCents === 260000, "case11: late leg reports the money");
    ok(res.summary.netDifferenceCents === 0, "case11: no phantom shortage");
    ok(res.summary.unexplainedDepositCount === 0, "case11: deposit is no longer 'unexplained'");
    ok(res.summary.late === 1, "case11: summary counts the late leg");
  }

  // NOTE ON THE FIXTURES BELOW (rule 13j — record what actually happened).
  // My first drafts of case12/case13 supplied a bank feed containing exactly ONE
  // deposit, dated after the posting window. The engine correctly answered
  // `no_bank_data` — with no bank activity anywhere near the window, it truly had
  // nothing to judge. The CODE was right and my FIXTURE was unrealistic. Real
  // feeds have ordinary traffic around the window, so these now include an
  // unrelated in-window deposit, which is what a real account looks like.

  // CASE 12: late detection is EXACT-ONLY — never guess outside the window.
  {
    const res = reconcileSettlements(
      [vault("2026-07-09", "s09", 260000)],
      [
        dep("2026-07-13", "other", 777), // unrelated in-window activity
        dep("2026-07-16", "b1", 259000), // close, but NOT exact, and late
      ],
      { todayIso: "2026-08-15" },
    );
    ok(res.legs[0].status === "unmatched", "case12: a near-miss outside the window is NOT claimed");
    ok(res.legs[0].matchedCents === null, "case12: nothing is invented for it");
  }

  // CASE 13: late search horizon is respected.
  {
    const res = reconcileSettlements(
      [vault("2026-07-09", "s09", 260000)],
      [dep("2026-07-13", "other", 777), dep("2026-07-16", "b1", 260000)],
      { todayIso: "2026-08-15", lateSearchDays: 0 },
    );
    ok(res.legs[0].status === "unmatched", "case13: lateSearchDays=0 disables late matching");
    // ...and with the default horizon the very same data DOES resolve.
    const on = reconcileSettlements(
      [vault("2026-07-09", "s09", 260000)],
      [dep("2026-07-13", "other", 777), dep("2026-07-16", "b1", 260000)],
      { todayIso: "2026-08-15" },
    );
    ok(on.legs[0].status === "late", "case13: default horizon finds the same deposit");
  }

  // CASE 13b: a leg genuinely outside bank coverage still reports no_bank_data
  // even now that late-detection runs first. Proves reordering didn't kill it.
  {
    const res = reconcileSettlements(
      [vault("2024-03-01", "ancient", 500000)],
      [dep("2026-07-13", "b1", 777), dep("2026-07-16", "b2", 260000)],
      { todayIso: "2026-08-15" },
    );
    ok(res.legs[0].status === "no_bank_data", "case13b: pre-coverage leg still no_bank_data");
  }

  // CASE 14: NO BANK DATA. ATM history older than the bank feed must never be
  // reported as missing money. This is the phantom six-figure shortage.
  {
    const res = reconcileSettlements(
      [vault("2024-03-01", "old", 500000), vault("2026-07-09", "new", 260000)],
      [dep("2026-07-10", "b1", 260000)],
      { todayIso: "2026-08-15" },
    );
    const old = res.legs.find((l) => l.settlementId === "old")!;
    ok(old.status === "no_bank_data", "case14: pre-feed leg is 'no_bank_data'");
    ok(res.summary.netDifferenceCents === 0, "case14: NO phantom shortage in the total");
    ok(res.summary.noBankDataCents === 500000, "case14: unjudgeable amount reported separately");
    ok(res.summary.allClear === true, "case14: allClear is not poisoned by unjudgeable legs");
    ok(res.summary.bankCoverageEarliest === "2026-07-10", "case14: coverage start reported");
  }

  // CASE 15: bank-coverage guard can be switched off (old behaviour available).
  {
    const res = reconcileSettlements(
      [vault("2024-03-01", "old", 500000)],
      [dep("2026-07-10", "b1", 260000)],
      { todayIso: "2026-08-15", respectBankCoverage: false },
    );
    ok(res.legs[0].status === "unmatched", "case15: guard off restores strict behaviour");
  }

  // CASE 16: PERIOD SCOPE. "we really only care about the current year."
  {
    const res = reconcileSettlements(
      [vault("2024-03-01", "old", 500000), vault("2026-07-09", "new", 260000)],
      [dep("2026-07-10", "b1", 260000)],
      { todayIso: "2026-08-15", fromDateIso: "2026-01-01" },
    );
    ok(res.legs.length === 1, "case16: out-of-period settlements are excluded entirely");
    ok(res.legs[0].settlementId === "new", "case16: only the in-period leg remains");
    ok(res.summary.noBankData === 0, "case16: excluded rows don't reappear as no_bank_data");
  }

  // CASE 17: toDateIso bound.
  {
    const res = reconcileSettlements(
      [vault("2026-07-09", "a", 260000), vault("2026-09-01", "b", 100000)],
      [],
      { todayIso: "2026-10-01", fromDateIso: "2026-01-01", toDateIso: "2026-08-31" },
    );
    ok(res.legs.length === 1 && res.legs[0].settlementId === "a", "case17: toDateIso upper bound applied");
  }

  // CASE 18: status helpers agree with the chip semantics.
  {
    ok(isSettled("matched") && isSettled("late") && isSettled("bundled"), "case18: settled set");
    ok(!isSettled("unmatched") && !isSettled("no_bank_data"), "case18: unsettled set");
    ok(needsAttention("mismatch") && needsAttention("unmatched"), "case18: attention set");
    ok(!needsAttention("no_bank_data"), "case18: no_bank_data never nags");
    ok(!needsAttention("late"), "case18: late never nags");
  }

  // CASE 20: BUNDLED DEPOSIT — the ATM company combined two days into one wire.
  {
    const res = reconcileSettlements(
      [vault("2026-07-06", "s06", 494000), vault("2026-07-07", "s07", 312000)],
      [dep("2026-07-08", "b1", 494000 + 312000)],
      { todayIso: "2026-08-15" },
    );
    ok(res.legs.every((l) => l.status === "bundled"), "case20: both legs report 'bundled'");
    ok(res.summary.unexplainedDepositCount === 0, "case20: the combined deposit is NOT also unexplained");
    ok(res.summary.netDifferenceCents === 0, "case20: no phantom shortage");
    ok(res.summary.bundled === 2, "case20: summary counts both bundled legs");
    ok(res.summary.allClear === true, "case20: a fully explained bundle is all-clear");
  }

  // CASE 21: bundling must NOT fire when the arithmetic is merely close.
  // One cent off is not a bundle — it is a coincidence, and asserting it would
  // be inventing a value (rule 3).
  {
    const res = reconcileSettlements(
      [vault("2026-07-06", "s06", 494000), vault("2026-07-07", "s07", 312000)],
      [dep("2026-07-08", "b1", 494000 + 312000 + 1)],
      { todayIso: "2026-08-15" },
    );
    ok(res.legs.every((l) => l.status !== "bundled"), "case21: one cent off is NOT a bundle");
    ok(res.summary.unexplainedDepositCount === 1, "case21: the odd deposit stays unexplained");
  }

  // CASE 22: an exact SINGLE match must always beat a bundle interpretation.
  {
    const res = reconcileSettlements(
      [vault("2026-07-06", "s06", 400000), vault("2026-07-07", "s07", 400000)],
      [dep("2026-07-08", "b1", 400000), dep("2026-07-09", "b2", 400000)],
      { todayIso: "2026-08-15" },
    );
    ok(res.legs.every((l) => l.status === "matched"), "case22: singles win over bundling");
    ok(res.summary.bundled === 0, "case22: nothing reported as bundled");
  }

  // CASE 23: a bundle must not reach across legs whose window excludes the date.
  {
    const res = reconcileSettlements(
      [vault("2026-01-05", "far", 494000), vault("2026-07-07", "near", 312000)],
      [dep("2026-07-08", "b1", 494000 + 312000)],
      { todayIso: "2026-08-15" },
    );
    ok(
      res.legs.every((l) => l.status !== "bundled"),
      "case23: out-of-window legs are not swept into a bundle",
    );
  }

  // CASE 19: bankCoverageWindow ignores unparseable dates rather than throwing.
  {
    const cov = bankCoverageWindow([
      dep("2026-07-10", "b1", 100),
      { transactionId: "bad", amountCents: 100, date: "not-a-date", description: null, pending: false },
      dep("2026-01-02", "b2", 100),
    ]);
    ok(cov?.earliest === "2026-01-02" && cov?.latest === "2026-07-10", "case19: coverage span from valid dates only");
    ok(bankCoverageWindow([]) === null, "case19: no deposits → null coverage");
  }

  if (failures.length > 0) {
    throw new Error("atm-reconcile-core self-tests FAILED:\n" + failures.map((f) => "  - " + f).join("\n"));
  }
  console.log("atm-reconcile-core: all self-tests passed");
}
