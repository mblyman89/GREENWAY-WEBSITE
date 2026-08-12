/**
 * src/lib/crypto/crypto-reconciliation-core.ts
 *
 * PURE reconciliation + review-queue logic for the crypto tax engine (R1-D). NO
 * I/O, no server-only imports — safe under tsx and vitest.
 *
 * Three trust-building checks the community begs for (research §4), all pure:
 *
 *   1. reconcileBalances — does the balance we DISPLAY match what the chain
 *      history implies? For each (wallet, asset) we sum inflows − outflows from
 *      the transaction history and compare to the stored balance. A mismatch is
 *      surfaced (with the exact delta) so numbers never silently disagree.
 *
 *   2. buildMissingBasisQueue — turn the cost-basis ledger's missing-basis
 *      disposals (R1-C) into a plain-English review queue: "you sold X units we
 *      have no purchase price for — add it so we don't overstate your gain."
 *      This is the never-silently-zero-basis protection made actionable.
 *
 *   3. suggestTransferMatches — find likely own-wallet transfers that weren't
 *      auto-matched: an OUT on one of your wallets that pairs with an IN on
 *      another, same asset, amounts within tolerance, close in time. Each pair
 *      gets a CONFIDENCE score so a human confirms before we merge — no wrong
 *      merges (Koinly's #1 weakness).
 *
 * All quantity math is float-free BigInt scaled units (reusing R1-C's
 * QTY_SCALE / quantityToScaled / scaledToQuantity).
 */

import {
  quantityToScaled,
  scaledToQuantity,
  QTY_SCALE,
  type LedgerResult,
} from "./crypto-cost-basis-core";

const BI_ZERO = BigInt(0);
const BI_ONE = BigInt(1);
const BI_TEN = BigInt(10);
const BI_HUNDRED = BigInt(100);

function pow10(n: number): bigint {
  let r = BI_ONE;
  for (let i = 0; i < n; i += 1) r = r * BI_TEN;
  return r;
}

function absBig(v: bigint): bigint {
  return v < BI_ZERO ? -v : v;
}

// ---------------------------------------------------------------------------
// 1. Balance reconciliation.
// ---------------------------------------------------------------------------

/** A minimal transaction view for reconciliation (chain history). */
export interface ReconTx {
  walletId: string;
  assetId: string | null;
  /** "in" adds to the wallet, "out" subtracts, "self" is neutral for a wallet. */
  direction: "in" | "out" | "self" | null;
  /** Normalized decimal amount string (e.g. "1.5"); null/"" treated as 0. */
  amountDecimal: string | null;
}

/** The stored, displayed balance for a (wallet, asset). */
export interface ReconBalance {
  walletId: string;
  assetId: string;
  amountDecimal: string | null;
}

export interface BalanceReconRow {
  walletId: string;
  assetId: string;
  /** Balance implied by summing chain history (in − out), decimal string. */
  computedDecimal: string;
  /** Balance we currently store/display, decimal string. */
  storedDecimal: string;
  /** storedScaled − computedScaled as a decimal string (signed). */
  deltaDecimal: string;
  /** True when |delta| is within the allowed tolerance (they reconcile). */
  reconciled: boolean;
}

export interface BalanceReconResult {
  rows: BalanceReconRow[];
  mismatchCount: number;
  allReconciled: boolean;
}

function keyOf(walletId: string, assetId: string): string {
  return `${walletId}\u0000${assetId}`;
}

function safeScaled(decimal: string | null | undefined): bigint {
  const s = (decimal ?? "").trim();
  if (s === "") return BI_ZERO;
  // A leading '-' is allowed here (a delta can be negative); quantityToScaled
  // rejects negatives, so handle sign ourselves.
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const scaled = quantityToScaled(body);
  return neg ? -scaled : scaled;
}

/**
 * Reconcile stored balances against the balance implied by transaction history.
 * `toleranceScaled` allows a tiny dust difference (default 0 = exact). Only
 * (wallet, asset) pairs present in EITHER input are reported.
 */
export function reconcileBalances(
  txs: readonly ReconTx[],
  balances: readonly ReconBalance[],
  toleranceScaled: bigint = BI_ZERO,
): BalanceReconResult {
  // Sum chain history per (wallet, asset).
  const computed = new Map<string, bigint>();
  const assetOf = new Map<string, { walletId: string; assetId: string }>();
  for (const tx of txs) {
    if (tx.assetId == null || tx.assetId === "") continue;
    if (tx.direction === "self" || tx.direction == null) continue; // neutral
    const k = keyOf(tx.walletId, tx.assetId);
    const amt = safeScaled(tx.amountDecimal);
    const signed = tx.direction === "in" ? amt : -amt;
    computed.set(k, (computed.get(k) ?? BI_ZERO) + signed);
    if (!assetOf.has(k)) assetOf.set(k, { walletId: tx.walletId, assetId: tx.assetId });
  }

  const stored = new Map<string, bigint>();
  for (const b of balances) {
    const k = keyOf(b.walletId, b.assetId);
    stored.set(k, safeScaled(b.amountDecimal));
    if (!assetOf.has(k)) assetOf.set(k, { walletId: b.walletId, assetId: b.assetId });
  }

  const rows: BalanceReconRow[] = [];
  let mismatch = 0;
  const keys = Array.from(assetOf.keys()).sort();
  for (const k of keys) {
    const meta = assetOf.get(k) as { walletId: string; assetId: string };
    const c = computed.get(k) ?? BI_ZERO;
    const s = stored.get(k) ?? BI_ZERO;
    const delta = s - c;
    const reconciled = absBig(delta) <= toleranceScaled;
    if (!reconciled) mismatch += 1;
    rows.push({
      walletId: meta.walletId,
      assetId: meta.assetId,
      computedDecimal: scaledToQuantity(c),
      storedDecimal: scaledToQuantity(s),
      deltaDecimal: scaledToQuantity(delta),
      reconciled,
    });
  }

  return { rows, mismatchCount: mismatch, allReconciled: mismatch === 0 };
}

// ---------------------------------------------------------------------------
// 2. Missing-basis review queue.
// ---------------------------------------------------------------------------

export interface MissingBasisItem {
  disposalId: string;
  /** Units with no known basis lot (decimal string). */
  missingQuantityDecimal: string;
  /** Units that DID match (decimal string) — the honest, priced portion. */
  matchedQuantityDecimal: string;
  /** Plain-English guidance for Michael. */
  note: string;
}

/**
 * Turn a cost-basis ledger's missing-basis disposals into an actionable queue.
 * Only disposals that actually lack basis appear. Never fabricates a $0 basis;
 * it asks the owner to supply the purchase price.
 */
export function buildMissingBasisQueue(ledger: LedgerResult): MissingBasisItem[] {
  const items: MissingBasisItem[] = [];
  for (const d of ledger.disposals) {
    if (!d.hasMissingBasis) continue;
    const missing = scaledToQuantity(d.missingBasisQuantityScaled);
    const matched = scaledToQuantity(d.matchedQuantityScaled);
    items.push({
      disposalId: d.disposalId,
      missingQuantityDecimal: missing,
      matchedQuantityDecimal: matched,
      note:
        `You disposed of ${missing} units we have no purchase price for. ` +
        `Add where these came from (a buy, transfer-in, or reward) so your gain ` +
        `isn't overstated — we will NOT assume a $0 cost.`,
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// 3. Confidence-scored transfer-match suggestions.
// ---------------------------------------------------------------------------

export interface TransferCandidateTx {
  id: string;
  walletId: string;
  assetId: string | null;
  direction: "in" | "out" | "self" | null;
  amountDecimal: string | null;
  /** Event time in ms epoch (null => unknown, excluded from matching). */
  timeMs: number | null;
}

export interface TransferMatchSuggestion {
  outTxId: string;
  inTxId: string;
  outWalletId: string;
  inWalletId: string;
  assetId: string;
  amountDecimal: string;
  /** |timeIn − timeOut| in seconds. */
  timeGapSeconds: number;
  /** Relative amount difference in basis points (0 = identical). */
  amountDiffBps: number;
  /** 0..100 confidence this OUT/IN pair is one own-wallet transfer. */
  confidence: number;
}

export interface TransferMatchOptions {
  /** Max time gap to consider a pair (seconds). Default 1 hour. */
  maxGapSeconds?: number;
  /** Max amount difference (basis points) to consider. Default 100 = 1%. */
  maxAmountDiffBps?: number;
}

/**
 * Suggest likely own-wallet transfers: an OUT on one wallet paired with an IN on
 * a DIFFERENT wallet, same asset, amounts within tolerance, close in time. Each
 * candidate OUT is matched to its single best IN (highest confidence), and each
 * IN is used at most once. Confidence blends amount closeness and time
 * closeness. Nothing is auto-merged — a human confirms.
 */
export function suggestTransferMatches(
  txs: readonly TransferCandidateTx[],
  options: TransferMatchOptions = {},
): TransferMatchSuggestion[] {
  const maxGapSeconds = options.maxGapSeconds ?? 3600;
  const maxAmountDiffBps = options.maxAmountDiffBps ?? 100;

  const outs = txs.filter(
    (t) => t.direction === "out" && t.assetId && t.timeMs != null && (t.amountDecimal ?? "") !== "",
  );
  const ins = txs.filter(
    (t) => t.direction === "in" && t.assetId && t.timeMs != null && (t.amountDecimal ?? "") !== "",
  );

  const suggestions: TransferMatchSuggestion[] = [];
  const usedIn = new Set<string>();

  // Deterministic order: process OUTs oldest first.
  const outsSorted = outs.slice().sort((a, b) => (a.timeMs as number) - (b.timeMs as number));

  for (const out of outsSorted) {
    const outAmt = safeScaled(out.amountDecimal);
    if (outAmt <= BI_ZERO) continue;
    const outTime = out.timeMs as number;

    let best: TransferMatchSuggestion | null = null;
    for (const inTx of ins) {
      if (usedIn.has(inTx.id)) continue;
      if (inTx.walletId === out.walletId) continue; // must be a different wallet
      if (inTx.assetId !== out.assetId) continue;
      const inTime = inTx.timeMs as number;
      const gapSec = Math.abs(inTime - outTime) / 1000;
      if (gapSec > maxGapSeconds) continue;

      const inAmt = safeScaled(inTx.amountDecimal);
      if (inAmt <= BI_ZERO) continue;
      // amount diff in basis points = |in-out| / out * 10000, float-free.
      const diff = absBig(inAmt - outAmt);
      const diffBps = Number((diff * BigInt(10000)) / outAmt);
      if (diffBps > maxAmountDiffBps) continue;

      // Confidence: amount closeness (up to 60) + time closeness (up to 40).
      const amountScore = 60 - Math.min(60, Math.round((diffBps / maxAmountDiffBps) * 60));
      const timeScore = 40 - Math.min(40, Math.round((gapSec / maxGapSeconds) * 40));
      const confidence = Math.max(0, Math.min(100, amountScore + timeScore));

      const candidate: TransferMatchSuggestion = {
        outTxId: out.id,
        inTxId: inTx.id,
        outWalletId: out.walletId,
        inWalletId: inTx.walletId,
        assetId: out.assetId as string,
        amountDecimal: scaledToQuantity(outAmt),
        timeGapSeconds: Math.round(gapSec),
        amountDiffBps: diffBps,
        confidence,
      };
      if (
        best === null ||
        candidate.confidence > best.confidence ||
        (candidate.confidence === best.confidence && candidate.timeGapSeconds < best.timeGapSeconds)
      ) {
        best = candidate;
      }
    }

    if (best !== null) {
      usedIn.add(best.inTxId);
      suggestions.push(best);
    }
  }

  // Highest-confidence first for display.
  suggestions.sort((a, b) => b.confidence - a.confidence || a.timeGapSeconds - b.timeGapSeconds);
  return suggestions;
}

/** Convert a decimal amount + a bps tolerance into a scaled tolerance (dust). */
export function bpsToScaledTolerance(referenceDecimal: string, bps: number): bigint {
  const ref = quantityToScaled(referenceDecimal.trim());
  return (ref * BigInt(Math.max(0, Math.trunc(bps)))) / (BI_HUNDRED * BI_HUNDRED);
}

// ---------------------------------------------------------------------------
// Self-tests (bare-call style; throws on failure, prints pass line).
// ---------------------------------------------------------------------------

function eq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `crypto-reconciliation-core: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

export function __runCryptoReconciliationCoreTests(): void {
  // sanity: QTY_SCALE reused
  eq(QTY_SCALE, 18, "reuses R1-C QTY_SCALE");
  eq(pow10(2) === BI_HUNDRED, true, "pow10 helper works");

  // --- reconcileBalances: exact match ---
  const okRecon = reconcileBalances(
    [
      { walletId: "w1", assetId: "a1", direction: "in", amountDecimal: "10" },
      { walletId: "w1", assetId: "a1", direction: "out", amountDecimal: "4" },
    ],
    [{ walletId: "w1", assetId: "a1", amountDecimal: "6" }],
  );
  eq(okRecon.allReconciled, true, "10 in - 4 out = 6 stored reconciles");
  eq(okRecon.rows[0].computedDecimal, "6", "computed = 6");
  eq(okRecon.rows[0].deltaDecimal, "0", "delta 0");

  // mismatch surfaced with signed delta
  const badRecon = reconcileBalances(
    [{ walletId: "w1", assetId: "a1", direction: "in", amountDecimal: "10" }],
    [{ walletId: "w1", assetId: "a1", amountDecimal: "7" }],
  );
  eq(badRecon.allReconciled, false, "10 computed vs 7 stored mismatches");
  eq(badRecon.mismatchCount, 1, "one mismatch");
  eq(badRecon.rows[0].deltaDecimal, "-3", "stored 7 - computed 10 = -3");

  // 'self' and null-asset txs are neutral
  const neutral = reconcileBalances(
    [
      { walletId: "w1", assetId: "a1", direction: "self", amountDecimal: "5" },
      { walletId: "w1", assetId: null, direction: "in", amountDecimal: "9" },
      { walletId: "w1", assetId: "a1", direction: "in", amountDecimal: "2" },
    ],
    [{ walletId: "w1", assetId: "a1", amountDecimal: "2" }],
  );
  eq(neutral.allReconciled, true, "self + null-asset ignored; 2 in = 2 stored");

  // tolerance allows dust
  const dust = reconcileBalances(
    [{ walletId: "w1", assetId: "a1", direction: "in", amountDecimal: "1.000000000000000002" }],
    [{ walletId: "w1", assetId: "a1", amountDecimal: "1" }],
    BigInt(5),
  );
  eq(dust.allReconciled, true, "2-wei delta within 5-wei tolerance");

  // fractional exactness
  const frac = reconcileBalances(
    [
      { walletId: "w", assetId: "a", direction: "in", amountDecimal: "0.1" },
      { walletId: "w", assetId: "a", direction: "in", amountDecimal: "0.2" },
    ],
    [{ walletId: "w", assetId: "a", amountDecimal: "0.3" }],
  );
  eq(frac.allReconciled, true, "0.1 + 0.2 = 0.3 exactly (no float error)");

  // --- buildMissingBasisQueue ---
  const ledger: LedgerResult = {
    disposals: [
      {
        disposalId: "d1",
        matchedQuantityScaled: quantityToScaled("1"),
        missingBasisQuantityScaled: quantityToScaled("2"),
        consumptions: [],
        matchedProceedsCents: 5000,
        matchedBasisCents: 3000,
        realizedGainCents: 2000,
        shortTermGainCents: 2000,
        longTermGainCents: 0,
        hasMissingBasis: true,
      },
      {
        disposalId: "d2",
        matchedQuantityScaled: quantityToScaled("1"),
        missingBasisQuantityScaled: BI_ZERO,
        consumptions: [],
        matchedProceedsCents: 100,
        matchedBasisCents: 50,
        realizedGainCents: 50,
        shortTermGainCents: 50,
        longTermGainCents: 0,
        hasMissingBasis: false,
      },
    ],
    remainingLots: [],
    totalRealizedGainCents: 2050,
    totalShortTermGainCents: 2050,
    totalLongTermGainCents: 0,
    totalMissingBasisQuantityScaled: quantityToScaled("2"),
    hasAnyMissingBasis: true,
  };
  const queue = buildMissingBasisQueue(ledger);
  eq(queue.length, 1, "only the missing-basis disposal queued");
  eq(queue[0].disposalId, "d1", "d1 queued");
  eq(queue[0].missingQuantityDecimal, "2", "2 units missing");
  eq(queue[0].matchedQuantityDecimal, "1", "1 unit matched");
  eq(queue[0].note.includes("NOT assume a $0"), true, "note reassures no $0 basis");

  // --- suggestTransferMatches ---
  const base = 1000000000000; // arbitrary ms epoch (no numeric separators for ES2017)
  const matches = suggestTransferMatches([
    { id: "out1", walletId: "wA", assetId: "a1", direction: "out", amountDecimal: "5", timeMs: base },
    { id: "in1", walletId: "wB", assetId: "a1", direction: "in", amountDecimal: "5", timeMs: base + 60000 },
    // a decoy IN on same wallet as out (should never match)
    { id: "inSelf", walletId: "wA", assetId: "a1", direction: "in", amountDecimal: "5", timeMs: base + 1000 },
    // a decoy different asset
    { id: "inOther", walletId: "wB", assetId: "a2", direction: "in", amountDecimal: "5", timeMs: base + 1000 },
  ]);
  eq(matches.length, 1, "one transfer suggested");
  eq(matches[0].outTxId, "out1", "out matched");
  eq(matches[0].inTxId, "in1", "in matched (cross-wallet, same asset)");
  eq(matches[0].amountDiffBps, 0, "identical amount => 0 bps");
  eq(matches[0].confidence > 90, true, "near-perfect match high confidence");

  // amount out of tolerance -> no match
  const noMatch = suggestTransferMatches([
    { id: "o", walletId: "wA", assetId: "a1", direction: "out", amountDecimal: "5", timeMs: base },
    { id: "i", walletId: "wB", assetId: "a1", direction: "in", amountDecimal: "50", timeMs: base + 1000 },
  ]);
  eq(noMatch.length, 0, "10x amount difference rejected");

  // time gap too large -> no match
  const farApart = suggestTransferMatches([
    { id: "o", walletId: "wA", assetId: "a1", direction: "out", amountDecimal: "5", timeMs: base },
    { id: "i", walletId: "wB", assetId: "a1", direction: "in", amountDecimal: "5", timeMs: base + 7200000 },
  ]);
  eq(farApart.length, 0, "2-hour gap beyond 1-hour default rejected");

  // each IN used at most once: two OUTs, one IN -> only one match
  const contention = suggestTransferMatches([
    { id: "o1", walletId: "wA", assetId: "a1", direction: "out", amountDecimal: "5", timeMs: base },
    { id: "o2", walletId: "wC", assetId: "a1", direction: "out", amountDecimal: "5", timeMs: base + 2000 },
    { id: "i1", walletId: "wB", assetId: "a1", direction: "in", amountDecimal: "5", timeMs: base + 1000 },
  ]);
  eq(contention.length, 1, "single IN consumed by only one OUT");

  // bpsToScaledTolerance: 1% of 100 = 1 unit
  eq(scaledToQuantity(bpsToScaledTolerance("100", 100)), "1", "1% of 100 = 1");

  console.log("crypto-reconciliation-core self-tests: all passed");
}
