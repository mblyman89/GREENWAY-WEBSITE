/**
 * src/lib/crypto/crypto-tax-ledger-builder-core.ts
 *
 * R1-F6b — Tax LEDGER BUILDER (PURE, float-free).
 * NO I/O, no server-only imports — safe under tsx and vitest.
 *
 * What it does
 * ------------
 * The glue between raw, classified transactions and the tax ENGINES. Given a
 * flat list of a wallet-asset's classified transactions (each with its owner
 * tag, USD value in cents, quantity, and timestamp), it produces, per
 * (wallet, asset):
 *
 *   • ACQUISITION lots (buys, income receipts, trade-in legs) for the R1-C
 *     cost-basis engine — each with its basis in cents and acquisition date,
 *   • DISPOSAL events (sells, spends, trade-out legs) for the same engine,
 *   • INCOME events (staking/FTSO/mining/airdrop/etc.) for the R1-F4 income
 *     report — at FMV on receipt,
 *   • plus counts that feed the R1-F5 file-readiness gate: how many disposals
 *     lack a USD price (unpriced) and how many acquisitions/income receipts lack
 *     a basis/FMV (missing basis) — surfaced, NEVER silently treated as $0.
 *
 * It uses the SAME tax-treatment source of truth as the classify screen
 * (getTagDefinition from crypto-classification-core): a tag's createsIncome /
 * isDisposal / isAcquisition booleans decide where each transaction goes. So the
 * builder can never disagree with what Michael sees on the Classify tab.
 *
 * Money & quantity
 * ----------------
 * USD values are integer cents. Quantities are converted from decimal strings to
 * 18-decimal scaled bigints via the R1-C validator (quantityToScaled), which
 * throws on garbage — so a malformed amount is caught, not guessed.
 */

import {
  getTagDefinition,
  defaultTagForPrimitive,
  mapDirectionToPrimitive,
  type TxPrimitive,
} from "./crypto-classification-core";
import {
  quantityToScaled,
  type AcquisitionLot,
  type DisposalEvent,
} from "./crypto-cost-basis-core";

export type TaxLedgerDirection = "in" | "out" | "self" | null;

/** The minimal per-transaction shape the builder needs (caller maps from the DB row). */
export interface TaxLedgerTxInput {
  id: string;
  /** Owner's stored tag key, or null if unclassified. */
  tagKey: string | null;
  direction: TaxLedgerDirection;
  isSwap: boolean;
  /** Decimal quantity string, e.g. "1.5" (validated; may be null/empty). */
  amountDecimal: string | null;
  /** USD value of this transaction in integer cents, or null if unpriced. */
  usdValueCents: number | null;
  /** ISO timestamp of the block/event (or null). */
  blockTimeIso: string | null;
  /** Asset symbol for downstream display (passed through). */
  assetSymbol: string;
}

/** An income event ready for the R1-F4 income report. */
export interface BuiltIncomeEvent {
  id: string;
  tag: string;
  assetSymbol: string;
  fmvCents: number;
  receivedAtMs: number;
}

export interface BuildTaxLedgerInput {
  transactions: readonly TaxLedgerTxInput[];
}

export interface BuildTaxLedgerResult {
  acquisitions: AcquisitionLot[];
  disposals: DisposalEvent[];
  incomeEvents: BuiltIncomeEvent[];
  /** Disposals whose proceeds price (USD) is missing — a hard-block feed. */
  unpricedDisposalCount: number;
  /** Acquisitions/income receipts with no basis/FMV — a missing-basis feed. */
  missingBasisAcquisitionCount: number;
  /** Transactions that were still unclassified (needs-review feed). */
  unclassifiedCount: number;
  /** Income receipts skipped because they had no FMV (never counted as $0). */
  unpricedIncomeCount: number;
}

function tsToMs(iso: string | null): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function hasQuantity(amountDecimal: string | null): boolean {
  if (amountDecimal === null) return false;
  const t = amountDecimal.trim();
  if (t === "" || t === "0") return false;
  // quantityToScaled throws on garbage; treat a throw as "no usable quantity".
  try {
    return quantityToScaled(t) > BigInt(0);
  } catch {
    return false;
  }
}

/**
 * Resolve the EFFECTIVE tag + primitive for a transaction, mirroring the
 * classify view: use the owner's tag if present and known, otherwise the
 * conservative default for the primitive (which never invents income).
 * Returns null tag when the transaction is genuinely unclassified.
 */
function effectiveTag(tx: TaxLedgerTxInput): { tag: string | null; primitive: TxPrimitive } {
  // A null direction is treated conservatively as an outgoing withdrawal (the
  // safe disposal assumption) so we never quietly hide a possible sale.
  const dir: "in" | "out" | "self" = tx.direction ?? "out";
  const primitive = mapDirectionToPrimitive(dir, tx.isSwap);
  if (tx.tagKey && getTagDefinition(tx.tagKey)) {
    return { tag: tx.tagKey, primitive };
  }
  return { tag: null, primitive };
}

/**
 * Build engine-ready acquisitions, disposals and income events from a flat list
 * of classified transactions for ONE (wallet, asset). Deterministic and
 * side-effect-free. Anything unpriced or unclassified is COUNTED for the
 * readiness gate, never fabricated.
 */
export function buildTaxLedger(input: BuildTaxLedgerInput): BuildTaxLedgerResult {
  const acquisitions: AcquisitionLot[] = [];
  const disposals: DisposalEvent[] = [];
  const incomeEvents: BuiltIncomeEvent[] = [];

  let unpricedDisposalCount = 0;
  let missingBasisAcquisitionCount = 0;
  let unclassifiedCount = 0;
  let unpricedIncomeCount = 0;

  for (const tx of input.transactions) {
    if (!hasQuantity(tx.amountDecimal)) {
      // No usable quantity: nothing to book (e.g. a zero-value log line).
      continue;
    }
    const scaled = quantityToScaled((tx.amountDecimal as string).trim());
    const atMs = tsToMs(tx.blockTimeIso);

    const { tag } = effectiveTag(tx);
    if (!tag) {
      unclassifiedCount += 1;
      continue;
    }
    const def = getTagDefinition(tag);
    if (!def) {
      unclassifiedCount += 1;
      continue;
    }

    // Income: ordinary income at FMV on receipt (also opens a basis lot).
    if (def.createsIncome) {
      if (tx.usdValueCents === null) {
        unpricedIncomeCount += 1;
        missingBasisAcquisitionCount += 1;
        continue; // never book income at $0
      }
      incomeEvents.push({
        id: tx.id,
        tag,
        assetSymbol: tx.assetSymbol,
        fmvCents: tx.usdValueCents,
        receivedAtMs: atMs,
      });
      // The received coins carry basis = that FMV.
      acquisitions.push({
        id: tx.id,
        quantityScaled: scaled,
        basisCents: tx.usdValueCents,
        acquiredAtMs: atMs,
      });
      continue;
    }

    // Disposal (sell/spend/trade-out leg): realizes gain vs basis.
    if (def.isDisposal) {
      if (tx.usdValueCents === null) {
        unpricedDisposalCount += 1;
        continue; // never book proceeds at $0
      }
      disposals.push({
        id: tx.id,
        quantityScaled: scaled,
        proceedsCents: tx.usdValueCents,
        disposedAtMs: atMs,
      });
      continue;
    }

    // Acquisition-cost (buy / trade-in leg / gift with carried basis).
    if (def.isAcquisition) {
      if (tx.usdValueCents === null) {
        missingBasisAcquisitionCount += 1;
        continue; // never invent a basis
      }
      acquisitions.push({
        id: tx.id,
        quantityScaled: scaled,
        basisCents: tx.usdValueCents,
        acquiredAtMs: atMs,
      });
      continue;
    }

    // Everything else (transfer / non-taxable): not a taxable lot here.
    // (Self-transfer basis carryover is handled by the R1-F1 relocation engine.)
  }

  return {
    acquisitions,
    disposals,
    incomeEvents,
    unpricedDisposalCount,
    missingBasisAcquisitionCount,
    unclassifiedCount,
    unpricedIncomeCount,
  };
}

// ---------------------------------------------------------------------------
// Self-tests (bare-call style; throws on failure, prints pass line).
// ---------------------------------------------------------------------------

function eq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `crypto-tax-ledger-builder-core: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function tx(over: Partial<TaxLedgerTxInput> & { id: string }): TaxLedgerTxInput {
  return {
    id: over.id,
    tagKey: "tagKey" in over ? (over.tagKey ?? null) : null,
    direction: "direction" in over ? (over.direction ?? null) : null,
    isSwap: over.isSwap ?? false,
    // Preserve an explicitly-passed "" or null (do NOT default them to "1").
    amountDecimal: "amountDecimal" in over ? (over.amountDecimal ?? null) : "1",
    usdValueCents: "usdValueCents" in over ? (over.usdValueCents ?? null) : null,
    blockTimeIso: "blockTimeIso" in over ? (over.blockTimeIso ?? null) : "2024-06-01T00:00:00Z",
    assetSymbol: over.assetSymbol ?? "FLR",
  };
}

// Ensure default primitive assumptions hold (guards against classify drift).
function defaultsSanity(): void {
  const buyDef = getTagDefinition(defaultTagForPrimitive("deposit"));
  eq(buyDef?.createsIncome, false, "default deposit tag never income");
}

export function __runCryptoTaxLedgerBuilderCoreTests(): void {
  defaultsSanity();

  // --- a buy becomes an acquisition lot at its USD basis ---
  const buy = buildTaxLedger({
    transactions: [tx({ id: "b", tagKey: "buy", direction: "in", amountDecimal: "2", usdValueCents: 10000 })],
  });
  eq(buy.acquisitions.length, 1, "buy -> one acquisition");
  eq(buy.acquisitions[0].basisCents, 10000, "buy basis carried");
  eq(buy.disposals.length, 0, "buy is not a disposal");
  eq(buy.incomeEvents.length, 0, "buy is not income");

  // --- a sell becomes a disposal at its USD proceeds ---
  const sell = buildTaxLedger({
    transactions: [tx({ id: "s", tagKey: "sell", direction: "out", amountDecimal: "1", usdValueCents: 25000 })],
  });
  eq(sell.disposals.length, 1, "sell -> one disposal");
  eq(sell.disposals[0].proceedsCents, 25000, "sell proceeds carried");

  // --- an FTSO reward becomes BOTH an income event AND a basis lot ---
  const ftso = buildTaxLedger({
    transactions: [tx({ id: "r", tagKey: "reward_ftso", direction: "in", amountDecimal: "100", usdValueCents: 1500 })],
  });
  eq(ftso.incomeEvents.length, 1, "ftso -> one income event");
  eq(ftso.incomeEvents[0].fmvCents, 1500, "ftso FMV carried");
  eq(ftso.acquisitions.length, 1, "ftso also opens a basis lot");
  eq(ftso.acquisitions[0].basisCents, 1500, "ftso basis = FMV");

  // --- unpriced disposal is COUNTED, never booked at $0 ---
  const unpricedSell = buildTaxLedger({
    transactions: [tx({ id: "u", tagKey: "sell", direction: "out", amountDecimal: "1", usdValueCents: null })],
  });
  eq(unpricedSell.disposals.length, 0, "unpriced sell not booked");
  eq(unpricedSell.unpricedDisposalCount, 1, "unpriced sell counted");

  // --- unpriced income is COUNTED, never booked at $0 ---
  const unpricedIncome = buildTaxLedger({
    transactions: [tx({ id: "ui", tagKey: "airdrop", direction: "in", amountDecimal: "5", usdValueCents: null })],
  });
  eq(unpricedIncome.incomeEvents.length, 0, "unpriced income not booked");
  eq(unpricedIncome.unpricedIncomeCount, 1, "unpriced income counted");
  eq(unpricedIncome.missingBasisAcquisitionCount, 1, "unpriced income -> missing basis too");

  // --- unpriced buy is a missing-basis acquisition, counted ---
  const unpricedBuy = buildTaxLedger({
    transactions: [tx({ id: "ub", tagKey: "buy", direction: "in", amountDecimal: "1", usdValueCents: null })],
  });
  eq(unpricedBuy.acquisitions.length, 0, "unpriced buy not booked");
  eq(unpricedBuy.missingBasisAcquisitionCount, 1, "unpriced buy counted missing basis");

  // --- an unclassified taxable-looking row is counted, not guessed ---
  const unclassified = buildTaxLedger({
    transactions: [tx({ id: "x", tagKey: null, direction: "out", amountDecimal: "1", usdValueCents: 5000 })],
  });
  eq(unclassified.disposals.length, 0, "unclassified not booked as disposal");
  eq(unclassified.unclassifiedCount, 1, "unclassified counted");

  // --- a transfer is neither acquisition nor disposal here ---
  const transfer = buildTaxLedger({
    transactions: [tx({ id: "t", tagKey: "transfer", direction: "self", amountDecimal: "1", usdValueCents: 5000 })],
  });
  eq(transfer.acquisitions.length, 0, "transfer not an acquisition");
  eq(transfer.disposals.length, 0, "transfer not a disposal");
  eq(transfer.incomeEvents.length, 0, "transfer not income");

  // --- zero / empty quantity produces nothing ---
  const zero = buildTaxLedger({
    transactions: [
      tx({ id: "z1", tagKey: "buy", direction: "in", amountDecimal: "0", usdValueCents: 100 }),
      tx({ id: "z2", tagKey: "buy", direction: "in", amountDecimal: "", usdValueCents: 100 }),
      tx({ id: "z3", tagKey: "buy", direction: "in", amountDecimal: null, usdValueCents: 100 }),
    ],
  });
  eq(zero.acquisitions.length, 0, "zero/empty quantity booked nothing");

  // --- garbage quantity is skipped, not guessed ---
  const garbage = buildTaxLedger({
    transactions: [tx({ id: "g", tagKey: "buy", direction: "in", amountDecimal: "1.2.3", usdValueCents: 100 })],
  });
  eq(garbage.acquisitions.length, 0, "garbage quantity skipped");

  // --- a realistic mixed batch ---
  const mixed = buildTaxLedger({
    transactions: [
      tx({ id: "m1", tagKey: "buy", direction: "in", amountDecimal: "3", usdValueCents: 30000 }),
      tx({ id: "m2", tagKey: "reward_ftso", direction: "in", amountDecimal: "10", usdValueCents: 400 }),
      tx({ id: "m3", tagKey: "sell", direction: "out", amountDecimal: "1", usdValueCents: 15000 }),
      tx({ id: "m4", tagKey: "sell", direction: "out", amountDecimal: "1", usdValueCents: null }),
      tx({ id: "m5", tagKey: null, direction: "out", amountDecimal: "1", usdValueCents: 900 }),
    ],
  });
  eq(mixed.acquisitions.length, 2, "buy + ftso -> two acquisitions");
  eq(mixed.disposals.length, 1, "one priced sell");
  eq(mixed.incomeEvents.length, 1, "one income event");
  eq(mixed.unpricedDisposalCount, 1, "one unpriced sell counted");
  eq(mixed.unclassifiedCount, 1, "one unclassified counted");

  console.log("crypto-tax-ledger-builder-core self-tests: all passed");
}
