/**
 * src/lib/crypto/crypto-transfer-ledger-core.ts
 *
 * R1-F1 — SELF-TRANSFER BASIS CARRYOVER ENGINE (PURE).
 *
 * The question this file answers (Michael's hot-wallet -> Ledger Stax move)
 * ---------------------------------------------------------------------------
 * "My coins were on a mobile hot wallet; I moved everything to a new Ledger
 *  Stax. Can the software account for that transfer so I can trace my crypto
 *  all the way back to the beginning?"  ->  YES.
 *
 * Moving your own crypto between wallets you control is NOT a taxable event.
 * (IRS Digital Asset FAQ Q81/A81; the transfer is neither a sale nor exchange.)
 * The tax lots you acquired on the OLD wallet keep their ORIGINAL cost basis
 * AND their ORIGINAL acquisition date when they land on the NEW wallet. The
 * holding-period clock does NOT reset.
 *
 * BUT — since Jan 1 2025 the IRS requires cost basis tracked PER WALLET
 * (Treas. Reg. §1.1012-1(j) / Rev Proc 2024-28). So it is not enough to flag a
 * transfer as "non-taxable": we must RELOCATE the specific lots so that, going
 * forward, the destination wallet's per-wallet ledger (R1-C) sees them as
 * transfer-in acquisition lots carrying the original date + basis. That is what
 * this engine does.
 *
 * What it produces (all PURE — no I/O, no server-only imports)
 * ---------------------------------------------------------------------------
 * Given, for a SINGLE asset:
 *   - the source wallet's open acquisition lots (from R1-C, oldest-first order
 *     is caller's choice; this engine matches by the chosen method), and
 *   - a list of CONFIRMED self-transfers (moved quantity, source & dest wallet,
 *     time, and optional gas paid in this same asset),
 * it emits, per transfer:
 *   - the exact lots consumed from the source wallet (glass-box detail),
 *   - the corresponding transfer-IN lots to inject into the destination wallet
 *     ledger, each preserving the ORIGINAL acquiredAtMs + apportioned basis,
 *   - a $0 realized gain for the move itself (non-taxable), and
 *   - if gas was paid IN THIS ASSET, a separate GAS micro-disposal (spending
 *     crypto to pay a fee IS a disposal of that crypto — a real taxable event),
 *     reported as its own realized gain/loss with holding period.
 *
 * Never silently zero-basis: if a confirmed transfer moves MORE units than the
 * source wallet has known basis for, the shortfall is surfaced explicitly as
 * `missingBasisQuantityScaled` (mirroring R1-C), NEVER treated as $0 basis.
 *
 * Money = integer USD cents. Quantities = BigInt scaled units (×10^QTY_SCALE).
 * ES2017-safe: no 0n literals, no numeric separators, no ** on BigInt values.
 */

import {
  QTY_SCALE,
  type AcquisitionLot,
  type CostBasisMethod,
  type HoldingPeriod,
} from "./crypto-cost-basis-core";

// ---------------------------------------------------------------------------
// ES2017-safe BigInt constants.
// ---------------------------------------------------------------------------
const BI_ZERO = BigInt(0);
const BI_ONE = BigInt(1);
const BI_TWO = BigInt(2);

const MS_PER_DAY = 86400000; // 86,400,000 ms/day
/** Long-term threshold: strictly MORE than 365 days is long-term (matches R1-C). */
const LONG_TERM_DAYS = 365;

// Re-export QTY_SCALE so callers/tests can stay anchored to the same constant.
export { QTY_SCALE };

// ---------------------------------------------------------------------------
// Public input/output types.
// ---------------------------------------------------------------------------

/**
 * A confirmed own-wallet transfer of ONE asset from a source wallet to a
 * destination wallet. Confirmed = a human (owner/admin) approved the R1-D
 * suggestion, or entered it manually; this engine trusts it.
 */
export interface ConfirmedSelfTransfer {
  /** Stable id for this transfer (e.g. the OUT tx id, or a match-record id). */
  id: string;
  sourceWalletId: string;
  destWalletId: string;
  /** Quantity that LANDED in the destination wallet (net of gas), scaled units. */
  movedQuantityScaled: bigint;
  /** When the OUT left the source wallet (ms epoch) — used for gas holding period. */
  transferAtMs: number;
  /**
   * Gas/network fee PAID IN THIS SAME ASSET, scaled units (0 if none or if the
   * fee was paid in a different asset — a different-asset fee is handled by that
   * asset's own ledger, not here). This is a real disposal of the gas units.
   */
  gasQuantityScaled?: bigint;
  /**
   * Fair-market USD value (cents) of the gas units at the moment of the
   * transfer — the PROCEEDS of the gas micro-disposal. Undefined => unpriced
   * (surfaced, never assumed $0 proceeds silently).
   */
  gasProceedsCents?: number;
}

/** One source lot consumed by a transfer (or by its gas disposal). */
export interface RelocatedLotConsumption {
  /** The source acquisition lot this came from. */
  sourceLotId: string;
  /** Units taken from that lot (scaled). */
  quantityScaled: bigint;
  /** Portion of that lot's basis apportioned to these units (cents). */
  basisCents: number;
  /** Original acquisition time of the lot — CARRIES OVER (clock does not reset). */
  acquiredAtMs: number;
}

/**
 * A transfer-IN acquisition lot to INJECT into the destination wallet's R1-C
 * ledger. It looks exactly like a normal AcquisitionLot, so the destination
 * ledger treats it as owned units with the ORIGINAL date + basis.
 */
export type DestinationInjectedLot = AcquisitionLot;

/** A gas micro-disposal: spending crypto to pay a network fee IS a disposal. */
export interface GasDisposalResult {
  /** transfer id + ":gas" so it is traceable and unique. */
  disposalId: string;
  quantityScaled: bigint;
  /** Proceeds (FMV of gas at transfer) in cents; null when unpriced. */
  proceedsCents: number | null;
  /** Basis of the consumed gas units (cents). */
  basisCents: number;
  /** proceeds − basis (cents); null when unpriced (cannot compute honestly). */
  realizedGainCents: number | null;
  holdingPeriod: HoldingPeriod;
  consumptions: RelocatedLotConsumption[];
  /** Units of gas with no known basis lot — surfaced, never $0. */
  missingBasisQuantityScaled: bigint;
  /** True when gas was priced (proceeds known) — false => needs a price. */
  priced: boolean;
}

/** The result of relocating ONE confirmed transfer. */
export interface TransferRelocationResult {
  transferId: string;
  sourceWalletId: string;
  destWalletId: string;
  /** Units actually matched to known source lots and relocated (scaled). */
  relocatedQuantityScaled: bigint;
  /** Units the transfer claimed to move but source had no basis lot for. */
  missingBasisQuantityScaled: bigint;
  /** Glass-box: which source lots were consumed to fund the moved units. */
  consumptions: RelocatedLotConsumption[];
  /** Lots to inject into the destination wallet ledger (original date+basis). */
  destinationLots: DestinationInjectedLot[];
  /** The move itself is non-taxable, so this is always 0 (kept explicit). */
  realizedGainCents: 0;
  /** Present only when gas was paid in this asset. */
  gasDisposal: GasDisposalResult | null;
  hasMissingBasis: boolean;
}

/** Input to the relocation engine for ONE asset. */
export interface RelocateTransfersInput {
  /** Open acquisition lots on the SOURCE wallet for this asset (from R1-C). */
  sourceLots: readonly AcquisitionLot[];
  /** Confirmed transfers, applied in chronological order by transferAtMs. */
  transfers: readonly ConfirmedSelfTransfer[];
  /** Lot-selection method for WHICH source lots fund a move. Default "fifo". */
  method?: CostBasisMethod;
  /** For "specid": explicit source-lot id order (highest priority first). */
  specIdOrder?: readonly string[];
}

/** Aggregate result across all transfers for one asset. */
export interface RelocateTransfersResult {
  results: TransferRelocationResult[];
  /** Every destination-injected lot, flattened, ready to append per dest wallet. */
  allDestinationLots: DestinationInjectedLot[];
  /** Total realized gain across all GAS disposals (cents); null if any unpriced. */
  totalGasRealizedGainCents: number | null;
  /** True if any transfer moved more units than the source had basis for. */
  hasAnyMissingBasis: boolean;
  /** True if any gas disposal was unpriced (needs a price before filing). */
  hasUnpricedGas: boolean;
}

// ---------------------------------------------------------------------------
// Helpers (mirrors R1-C style: float-free, half-up apportionment).
// ---------------------------------------------------------------------------

function apportionCents(valueCents: number, partScaled: bigint, wholeScaled: bigint): number {
  if (wholeScaled <= BI_ZERO) return 0;
  const neg = valueCents < 0;
  const v = BigInt(Math.abs(Math.trunc(valueCents)));
  const numer = v * partScaled;
  const twice = numer * BI_TWO;
  const denomTwice = wholeScaled * BI_TWO;
  let out = twice / denomTwice;
  const remainder = twice % denomTwice;
  if (remainder >= wholeScaled) out += BI_ONE;
  const n = Number(out);
  return neg ? -n : n;
}

function holdingPeriodFor(acquiredAtMs: number, disposedAtMs: number): HoldingPeriod {
  const days = Math.floor((disposedAtMs - acquiredAtMs) / MS_PER_DAY);
  return days > LONG_TERM_DAYS ? "long" : "short";
}

// A mutable working lot during relocation matching.
interface WorkingLot {
  id: string;
  remainingScaled: bigint;
  remainingBasisCents: number;
  originalQtyScaled: bigint;
  originalBasisCents: number;
  acquiredAtMs: number;
}

function toWorkingLots(lots: readonly AcquisitionLot[]): WorkingLot[] {
  return lots.map((l) => ({
    id: l.id,
    remainingScaled: l.quantityScaled,
    remainingBasisCents: l.basisCents,
    originalQtyScaled: l.quantityScaled,
    originalBasisCents: l.basisCents,
    acquiredAtMs: l.acquiredAtMs,
  }));
}

/** Order working lots per method (same rules as R1-C). */
function orderLots(
  lots: WorkingLot[],
  method: CostBasisMethod,
  specIdOrder: readonly string[] | undefined,
): WorkingLot[] {
  const withUnits = lots.filter((l) => l.remainingScaled > BI_ZERO);
  if (method === "fifo") {
    return withUnits.slice().sort((a, b) => a.acquiredAtMs - b.acquiredAtMs);
  }
  if (method === "lifo") {
    return withUnits.slice().sort((a, b) => b.acquiredAtMs - a.acquiredAtMs);
  }
  if (method === "hifo") {
    // Highest per-unit cost first; compare via cross-multiplication (float-free).
    return withUnits.slice().sort((a, b) => {
      const left = BigInt(a.remainingBasisCents) * b.remainingScaled;
      const right = BigInt(b.remainingBasisCents) * a.remainingScaled;
      if (left === right) return a.acquiredAtMs - b.acquiredAtMs; // stable tie-break
      return left > right ? -1 : 1;
    });
  }
  // specid: caller-supplied explicit order; unknown ids fall to the end (stable).
  const order = specIdOrder ?? [];
  const rank = new Map<string, number>();
  order.forEach((id, i) => rank.set(id, i));
  return withUnits
    .slice()
    .sort((a, b) => {
      const ra = rank.has(a.id) ? (rank.get(a.id) as number) : Number.MAX_SAFE_INTEGER;
      const rb = rank.has(b.id) ? (rank.get(b.id) as number) : Number.MAX_SAFE_INTEGER;
      if (ra === rb) return a.acquiredAtMs - b.acquiredAtMs;
      return ra - rb;
    });
}

/**
 * Consume `needScaled` units from the ordered working lots, returning the
 * per-lot consumption detail and the total matched/basis. Mutates the lots'
 * remaining amounts. The LAST consumption of a lot absorbs any basis rounding
 * remainder so apportioned basis never exceeds the lot's basis (matches R1-C).
 */
function consume(
  ordered: WorkingLot[],
  needScaled: bigint,
): { consumptions: RelocatedLotConsumption[]; matchedScaled: bigint; matchedBasisCents: number } {
  const consumptions: RelocatedLotConsumption[] = [];
  let remainingNeed = needScaled;
  let matchedScaled = BI_ZERO;
  let matchedBasisCents = 0;

  for (const lot of ordered) {
    if (remainingNeed <= BI_ZERO) break;
    if (lot.remainingScaled <= BI_ZERO) continue;

    const take = lot.remainingScaled < remainingNeed ? lot.remainingScaled : remainingNeed;

    // Basis for `take` units. If we take the WHOLE remaining lot, use the whole
    // remaining basis (absorbs any earlier rounding). Otherwise apportion.
    let basisForTake: number;
    if (take === lot.remainingScaled) {
      basisForTake = lot.remainingBasisCents;
    } else {
      basisForTake = apportionCents(lot.remainingBasisCents, take, lot.remainingScaled);
      if (basisForTake > lot.remainingBasisCents) basisForTake = lot.remainingBasisCents;
    }

    consumptions.push({
      sourceLotId: lot.id,
      quantityScaled: take,
      basisCents: basisForTake,
      acquiredAtMs: lot.acquiredAtMs,
    });

    lot.remainingScaled -= take;
    lot.remainingBasisCents -= basisForTake;
    remainingNeed -= take;
    matchedScaled += take;
    matchedBasisCents += basisForTake;
  }

  return { consumptions, matchedScaled, matchedBasisCents };
}

// ---------------------------------------------------------------------------
// The engine.
// ---------------------------------------------------------------------------

/**
 * Relocate confirmed self-transfers of ONE asset from source wallet(s) to
 * destination wallet(s), carrying basis + acquisition date forward, netting
 * each move to $0 gain, and emitting a separate gas micro-disposal when gas was
 * paid in this asset. Transfers are applied oldest-first so a coin that hops
 * A -> B -> C keeps its ORIGINAL date through every hop.
 */
export function relocateTransfers(input: RelocateTransfersInput): RelocateTransfersResult {
  const method: CostBasisMethod = input.method ?? "fifo";
  const specIdOrder = input.specIdOrder;

  // Per-wallet working lot pools, seeded from the source wallet's open lots.
  // As lots relocate, they enter the destination wallet's pool so multi-hop
  // transfers chain correctly.
  const pools = new Map<string, WorkingLot[]>();

  // Seed: all provided source lots are assumed to live where the first transfer
  // that references them originates. We index them by their originating wallet
  // via the transfers' sourceWalletId. To stay general, we build the seed pool
  // keyed to EACH distinct sourceWalletId that has lots; callers pass one
  // wallet's lots at a time in the common case, but we support many.
  // Since AcquisitionLot has no walletId, the caller passes lots already scoped
  // to the FIRST source wallet in chronological order. We seed that pool.
  const transfersSorted = input.transfers
    .slice()
    .sort((a, b) => a.transferAtMs - b.transferAtMs);

  const firstSourceWallet =
    transfersSorted.length > 0 ? transfersSorted[0].sourceWalletId : "";
  pools.set(firstSourceWallet, toWorkingLots(input.sourceLots));

  function poolFor(walletId: string): WorkingLot[] {
    let p = pools.get(walletId);
    if (!p) {
      p = [];
      pools.set(walletId, p);
    }
    return p;
  }

  const results: TransferRelocationResult[] = [];
  const allDestinationLots: DestinationInjectedLot[] = [];
  let hasAnyMissingBasis = false;
  let hasUnpricedGas = false;
  let totalGasRealizedGainCents: number | null = 0;

  let injectSeq = 0;

  for (const t of transfersSorted) {
    const srcPool = poolFor(t.sourceWalletId);
    const destPool = poolFor(t.destWalletId);

    // 1) GAS FIRST (if paid in this asset): spending crypto on gas is a disposal
    //    that happens at the moment of transfer, consuming source-wallet lots.
    let gasDisposal: GasDisposalResult | null = null;
    const gasQty = t.gasQuantityScaled ?? BI_ZERO;
    if (gasQty > BI_ZERO) {
      const orderedForGas = orderLots(srcPool, method, specIdOrder);
      const g = consume(orderedForGas, gasQty);
      const gasMissing = gasQty - g.matchedScaled;
      if (gasMissing > BI_ZERO) hasAnyMissingBasis = true;

      const priced = t.gasProceedsCents != null;
      if (!priced) hasUnpricedGas = true;

      // Holding period of the gas disposal: use the OLDEST consumed lot's date
      // vs the transfer time (conservative — short unless clearly long).
      let earliestAcq = t.transferAtMs;
      for (const c of g.consumptions) {
        if (c.acquiredAtMs < earliestAcq) earliestAcq = c.acquiredAtMs;
      }
      const hp = holdingPeriodFor(earliestAcq, t.transferAtMs);

      const proceeds = priced ? (t.gasProceedsCents as number) : null;
      const realized =
        proceeds == null ? null : proceeds - g.matchedBasisCents;

      gasDisposal = {
        disposalId: `${t.id}:gas`,
        quantityScaled: g.matchedScaled,
        proceedsCents: proceeds,
        basisCents: g.matchedBasisCents,
        realizedGainCents: realized,
        holdingPeriod: hp,
        consumptions: g.consumptions,
        missingBasisQuantityScaled: gasMissing,
        priced,
      };

      if (realized == null) {
        totalGasRealizedGainCents = null;
      } else if (totalGasRealizedGainCents != null) {
        totalGasRealizedGainCents += realized;
      }
    }

    // 2) THE MOVE: relocate `movedQuantityScaled` lots source -> dest, carrying
    //    basis + ORIGINAL acquisition date. Non-taxable => $0 gain.
    const ordered = orderLots(srcPool, method, specIdOrder);
    const m = consume(ordered, t.movedQuantityScaled);
    const missing = t.movedQuantityScaled - m.matchedScaled;
    if (missing > BI_ZERO) hasAnyMissingBasis = true;

    const destinationLots: DestinationInjectedLot[] = m.consumptions.map((c) => {
      injectSeq += 1;
      return {
        // New lot id ties back to the transfer AND the source lot for tracing.
        id: `${t.id}:in:${c.sourceLotId}:${injectSeq}`,
        quantityScaled: c.quantityScaled,
        basisCents: c.basisCents,
        acquiredAtMs: c.acquiredAtMs, // ORIGINAL date carries over (clock unbroken)
      };
    });

    // Inject the relocated lots into the destination wallet's pool so a later
    // hop from this dest wallet can move them again with the same original date.
    for (const dl of destinationLots) {
      destPool.push({
        id: dl.id,
        remainingScaled: dl.quantityScaled,
        remainingBasisCents: dl.basisCents,
        originalQtyScaled: dl.quantityScaled,
        originalBasisCents: dl.basisCents,
        acquiredAtMs: dl.acquiredAtMs,
      });
      allDestinationLots.push(dl);
    }

    results.push({
      transferId: t.id,
      sourceWalletId: t.sourceWalletId,
      destWalletId: t.destWalletId,
      relocatedQuantityScaled: m.matchedScaled,
      missingBasisQuantityScaled: missing,
      consumptions: m.consumptions,
      destinationLots,
      realizedGainCents: 0,
      gasDisposal,
      hasMissingBasis: missing > BI_ZERO || (gasDisposal?.missingBasisQuantityScaled ?? BI_ZERO) > BI_ZERO,
    });
  }

  return {
    results,
    allDestinationLots,
    totalGasRealizedGainCents,
    hasAnyMissingBasis,
    hasUnpricedGas,
  };
}

// ---------------------------------------------------------------------------
// PURE self-tests (run under tsx via scripts/compliance/run-pure-selftests.ts
// AND under vitest). Local eq() throws on mismatch.
// ---------------------------------------------------------------------------

function eq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`crypto-transfer-ledger self-test FAILED: ${msg} — expected ${String(expected)}, got ${String(actual)}`);
  }
}

const DAY = MS_PER_DAY;
const QTY_ONE = (() => {
  let r = BI_ONE;
  for (let i = 0; i < QTY_SCALE; i += 1) r = r * BigInt(10);
  return r;
})();

function scaled(units: number): bigint {
  return QTY_ONE * BigInt(units);
}

export function __runCryptoTransferLedgerCoreTests(): void {
  // --- basic relocation: 1 lot moves whole, carries date + basis, $0 gain ---
  const basic = relocateTransfers({
    sourceLots: [
      { id: "L1", quantityScaled: scaled(1), basisCents: 10000, acquiredAtMs: 100 * DAY },
    ],
    transfers: [
      {
        id: "T1",
        sourceWalletId: "hot",
        destWalletId: "ledger",
        movedQuantityScaled: scaled(1),
        transferAtMs: 400 * DAY,
      },
    ],
  });
  eq(basic.results.length, 1, "one transfer result");
  eq(basic.results[0].realizedGainCents, 0, "move is non-taxable ($0 gain)");
  eq(basic.results[0].relocatedQuantityScaled === scaled(1), true, "relocated 1 unit");
  eq(basic.results[0].missingBasisQuantityScaled === BI_ZERO, true, "no missing basis");
  eq(basic.allDestinationLots.length, 1, "one destination lot injected");
  eq(basic.allDestinationLots[0].basisCents, 10000, "basis carries over exactly");
  eq(basic.allDestinationLots[0].acquiredAtMs, 100 * DAY, "ORIGINAL acquisition date carries over");
  eq(basic.hasAnyMissingBasis, false, "no missing basis overall");

  // --- partial move: source has 3 units across 2 lots, move 1.5 (FIFO) ---
  const partial = relocateTransfers({
    sourceLots: [
      { id: "A", quantityScaled: scaled(1), basisCents: 10000, acquiredAtMs: 0 },
      { id: "B", quantityScaled: scaled(2), basisCents: 40000, acquiredAtMs: 10 * DAY },
    ],
    transfers: [
      {
        id: "T",
        sourceWalletId: "w1",
        destWalletId: "w2",
        movedQuantityScaled: (QTY_ONE * BigInt(3)) / BigInt(2), // 1.5 units
        transferAtMs: 20 * DAY,
      },
    ],
    method: "fifo",
  });
  eq(partial.results[0].consumptions.length, 2, "FIFO consumes A fully then part of B");
  eq(partial.results[0].consumptions[0].sourceLotId, "A", "A consumed first (oldest)");
  eq(partial.results[0].consumptions[0].quantityScaled === scaled(1), true, "all of A taken");
  eq(partial.results[0].consumptions[0].basisCents, 10000, "A basis carried");
  // Half of B (0.5 of 2 units => 0.25 of the lot => basis 10000 of 40000).
  eq(partial.results[0].consumptions[1].sourceLotId, "B", "then B");
  eq(partial.results[0].consumptions[1].basisCents, 10000, "quarter of B basis = 10000c");
  eq(partial.allDestinationLots.length, 2, "two destination lots (one per source lot)");

  // --- missing basis: move 2 but source only has 1 known lot ---
  const missing = relocateTransfers({
    sourceLots: [{ id: "only", quantityScaled: scaled(1), basisCents: 5000, acquiredAtMs: 0 }],
    transfers: [
      {
        id: "Tm",
        sourceWalletId: "w1",
        destWalletId: "w2",
        movedQuantityScaled: scaled(2),
        transferAtMs: DAY,
      },
    ],
  });
  eq(missing.results[0].relocatedQuantityScaled === scaled(1), true, "only 1 unit had basis");
  eq(missing.results[0].missingBasisQuantityScaled === scaled(1), true, "1 unit missing basis (surfaced)");
  eq(missing.hasAnyMissingBasis, true, "missing basis flagged, never $0-assumed");

  // --- gas paid in this asset = micro-disposal (a real taxable event) ---
  const withGas = relocateTransfers({
    sourceLots: [
      { id: "G", quantityScaled: scaled(2), basisCents: 20000, acquiredAtMs: 0 },
    ],
    transfers: [
      {
        id: "Tg",
        sourceWalletId: "w1",
        destWalletId: "w2",
        movedQuantityScaled: scaled(1),
        gasQuantityScaled: scaled(1),
        gasProceedsCents: 15000, // FMV of the 1 gas unit at transfer = $150
        transferAtMs: 400 * DAY, // > 365 days => long-term gas disposal
      },
    ],
  });
  eq(withGas.results[0].gasDisposal != null, true, "gas disposal present");
  const gd = withGas.results[0].gasDisposal as GasDisposalResult;
  eq(gd.priced, true, "gas was priced");
  eq(gd.basisCents, 10000, "1 of 2 units => half of 20000c basis = 10000c");
  eq(gd.realizedGainCents, 5000, "gas gain = 15000 proceeds − 10000 basis");
  eq(gd.holdingPeriod, "long", "held > 365 days => long-term gas disposal");
  eq(withGas.totalGasRealizedGainCents, 5000, "aggregate gas gain");
  // The move consumed the other 1 unit; $0 gain on the move itself.
  eq(withGas.results[0].realizedGainCents, 0, "move still non-taxable");
  eq(withGas.results[0].relocatedQuantityScaled === scaled(1), true, "1 unit relocated after gas");

  // --- unpriced gas surfaces (never silently $0 proceeds) ---
  const unpriced = relocateTransfers({
    sourceLots: [{ id: "U", quantityScaled: scaled(2), basisCents: 20000, acquiredAtMs: 0 }],
    transfers: [
      {
        id: "Tu",
        sourceWalletId: "w1",
        destWalletId: "w2",
        movedQuantityScaled: scaled(1),
        gasQuantityScaled: scaled(1),
        transferAtMs: DAY,
      },
    ],
  });
  eq(unpriced.hasUnpricedGas, true, "unpriced gas flagged");
  eq(unpriced.totalGasRealizedGainCents, null, "unpriced => aggregate gas gain is null (honest)");
  const ug = unpriced.results[0].gasDisposal as GasDisposalResult;
  eq(ug.realizedGainCents, null, "unpriced gas gain is null, not 0");

  // --- multi-hop A->B->C keeps the ORIGINAL date across both hops ---
  const multiHop = relocateTransfers({
    sourceLots: [{ id: "orig", quantityScaled: scaled(1), basisCents: 30000, acquiredAtMs: 50 * DAY }],
    transfers: [
      { id: "H1", sourceWalletId: "A", destWalletId: "B", movedQuantityScaled: scaled(1), transferAtMs: 100 * DAY },
      { id: "H2", sourceWalletId: "B", destWalletId: "C", movedQuantityScaled: scaled(1), transferAtMs: 200 * DAY },
    ],
  });
  eq(multiHop.results.length, 2, "two hops");
  // The lot that lands in C must still carry the ORIGINAL acquisition date.
  const finalLot = multiHop.results[1].destinationLots[0];
  eq(finalLot.acquiredAtMs, 50 * DAY, "original date survives A->B->C");
  eq(finalLot.basisCents, 30000, "original basis survives A->B->C");
  eq(multiHop.results[1].realizedGainCents, 0, "each hop non-taxable");

  console.log("crypto-transfer-ledger-core self-tests: all passed");
}
