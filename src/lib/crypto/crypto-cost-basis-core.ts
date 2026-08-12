/**
 * src/lib/crypto/crypto-cost-basis-core.ts
 *
 * THE HEART of the crypto tax engine (R1-C): a PURE, float-free, per-wallet
 * cost-basis lot ledger. NO I/O, no server-only imports — safe under tsx and
 * vitest.
 *
 * What it does
 * ------------
 * Given a chronological list of ACQUISITIONS (buys, income, the received leg of
 * a trade) and DISPOSALS (sells, spends, the sent leg of a trade) for a single
 * (wallet, asset), it matches each disposal against prior acquisition lots using
 * the chosen accounting method and produces, per disposal:
 *   - the exact lots consumed (quantities + basis) — the "glass-box" explainer,
 *   - realized gain/loss in integer cents (proceeds − basis),
 *   - the holding period (short ≤ 1yr / long > 1yr) per consumed lot,
 *   - and, when a disposal can't be fully covered by known lots, a MISSING-BASIS
 *     shortfall — surfaced explicitly, NEVER silently treated as $0 basis.
 *
 * Why per-wallet
 * --------------
 * Since Jan 1 2025 the IRS requires cost basis tracked wallet-by-wallet
 * (Treas. Reg. §1.1012-1(j) / Rev Proc 2024-28). Callers run this engine once
 * per (wallet, asset); own-wallet transfers carry basis + acquisition date
 * across via transfer-in acquisition lots the caller supplies (R1-D wires that).
 *
 * Float-free money + quantity math
 * --------------------------------
 * All USD money is integer CENTS (number, safe-integer range like the rest of
 * the app). All token QUANTITIES are represented as BigInt "scaled units"
 * (quantity × 10^QTY_SCALE) so fractional coins never touch a float. Basis is
 * apportioned across partial-lot consumption with half-up rounding, and the
 * engine guarantees the sum of apportioned basis never exceeds a lot's basis
 * (the last consumption of a lot absorbs any rounding remainder).
 *
 * Accounting methods
 * ------------------
 *   - "fifo" (default) : oldest lots first (IRS default).
 *   - "lifo"           : newest lots first.
 *   - "hifo"           : highest per-unit-cost lots first (minimizes gains).
 *   - "specid"         : caller supplies an explicit lot order (Specific ID).
 */

// ---------------------------------------------------------------------------
// ES2017-safe BigInt constants (no 0n literals, no numeric separators).
// ---------------------------------------------------------------------------
const BI_ZERO = BigInt(0);
const BI_ONE = BigInt(1);
const BI_TWO = BigInt(2);
const BI_TEN = BigInt(10);

/** Token quantities are carried as BigInt (quantity × 10^QTY_SCALE). */
export const QTY_SCALE = 18;

/** pow10 as a loop (avoids ** on BigInt for older targets; matches app style). */
function pow10(n: number): bigint {
  let r = BI_ONE;
  for (let i = 0; i < n; i += 1) r = r * BI_TEN;
  return r;
}

const QTY_ONE = pow10(QTY_SCALE);

// ---------------------------------------------------------------------------
// Public types.
// ---------------------------------------------------------------------------

export type CostBasisMethod = "fifo" | "lifo" | "hifo" | "specid";

export const COST_BASIS_METHODS: readonly CostBasisMethod[] = [
  "fifo",
  "lifo",
  "hifo",
  "specid",
] as const;

/** Long-term threshold: strictly MORE than one year (365 days) is long-term. */
export const LONG_TERM_DAYS = 365;
const MS_PER_DAY = 86400000; // 86,400,000 ms/day (no numeric separators for ES2017)

export type HoldingPeriod = "short" | "long";

/** An acquisition lot: units acquired at a known basis on a known date. */
export interface AcquisitionLot {
  /** Stable id (usually the source transaction id). */
  id: string;
  /** Quantity acquired, as scaled BigInt units (quantity × 10^QTY_SCALE). */
  quantityScaled: bigint;
  /** Total cost basis of this lot in integer USD cents (price + acq. fees). */
  basisCents: number;
  /** Acquisition timestamp (ISO or ms epoch) — starts the holding clock. */
  acquiredAtMs: number;
}

/** A disposal: units sold/spent for known proceeds on a known date. */
export interface DisposalEvent {
  id: string;
  /** Quantity disposed, scaled BigInt units. */
  quantityScaled: bigint;
  /** Total proceeds in integer USD cents (sale value − disposal fees). */
  proceedsCents: number;
  /** Disposal timestamp (ms epoch). */
  disposedAtMs: number;
}

/** One lot consumed by a disposal — the glass-box detail line. */
export interface LotConsumption {
  lotId: string;
  /** Units taken from this lot (scaled). */
  quantityScaled: bigint;
  /** Portion of proceeds apportioned to these units (cents). */
  proceedsCents: number;
  /** Portion of the lot's basis apportioned to these units (cents). */
  basisCents: number;
  /** proceeds − basis for these units (cents). */
  gainCents: number;
  acquiredAtMs: number;
  disposedAtMs: number;
  holdingPeriod: HoldingPeriod;
}

/** The computed result for one disposal. */
export interface DisposalResult {
  disposalId: string;
  /** Units this disposal was actually able to match against known lots. */
  matchedQuantityScaled: bigint;
  /** Units with NO known basis lot — the missing-basis shortfall (never $0). */
  missingBasisQuantityScaled: bigint;
  consumptions: LotConsumption[];
  /** Total proceeds apportioned to matched units (cents). */
  matchedProceedsCents: number;
  /** Total basis of matched units (cents). */
  matchedBasisCents: number;
  /** Realized gain/loss on matched units (cents). */
  realizedGainCents: number;
  shortTermGainCents: number;
  longTermGainCents: number;
  /** True when some units could not be matched to a basis lot. */
  hasMissingBasis: boolean;
}

/** The whole ledger result for one (wallet, asset). */
export interface LedgerResult {
  disposals: DisposalResult[];
  /** Lots (remaining, unconsumed) after all disposals — the open position. */
  remainingLots: Array<{ lotId: string; quantityScaled: bigint; basisCents: number; acquiredAtMs: number }>;
  totalRealizedGainCents: number;
  totalShortTermGainCents: number;
  totalLongTermGainCents: number;
  /** Aggregate units that lacked a basis lot across all disposals. */
  totalMissingBasisQuantityScaled: bigint;
  hasAnyMissingBasis: boolean;
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function toMs(v: number): number {
  if (!Number.isFinite(v)) throw new Error("cost-basis: non-finite timestamp");
  return Math.trunc(v);
}

/** Half-up apportionment: value * partScaled / wholeScaled, all BigInt. */
function apportionCents(valueCents: number, partScaled: bigint, wholeScaled: bigint): number {
  if (wholeScaled <= BI_ZERO) return 0;
  const neg = valueCents < 0;
  const v = BigInt(Math.abs(Math.trunc(valueCents)));
  const numer = v * partScaled;
  // round half up
  const twice = numer * BI_TWO;
  const denomTwice = wholeScaled * BI_TWO;
  let out = twice / denomTwice;
  const remainder = twice % denomTwice;
  if (remainder >= wholeScaled) out += BI_ONE;
  const n = Number(out);
  return neg ? -n : n;
}

function holdingPeriod(acquiredAtMs: number, disposedAtMs: number): HoldingPeriod {
  const days = Math.floor((disposedAtMs - acquiredAtMs) / MS_PER_DAY);
  return days > LONG_TERM_DAYS ? "long" : "short";
}

// A mutable working lot during matching.
interface WorkingLot {
  id: string;
  remainingScaled: bigint;
  remainingBasisCents: number;
  originalQtyScaled: bigint;
  originalBasisCents: number;
  acquiredAtMs: number;
}

/** Order working lots for a disposal per the chosen method. */
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
    // Highest per-unit cost first. Per-unit cost = basis / qty; compare via
    // cross-multiplication to stay float-free: a.basis*b.qty vs b.basis*a.qty.
    return withUnits.slice().sort((a, b) => {
      const left = BigInt(a.remainingBasisCents) * b.remainingScaled;
      const right = BigInt(b.remainingBasisCents) * a.remainingScaled;
      if (left === right) return a.acquiredAtMs - b.acquiredAtMs;
      return left > right ? -1 : 1;
    });
  }
  // specid: caller-provided order; unlisted lots fall back to FIFO after.
  const rank = new Map<string, number>();
  (specIdOrder ?? []).forEach((id, i) => rank.set(id, i));
  return withUnits.slice().sort((a, b) => {
    const ra = rank.has(a.id) ? (rank.get(a.id) as number) : Number.MAX_SAFE_INTEGER;
    const rb = rank.has(b.id) ? (rank.get(b.id) as number) : Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return a.acquiredAtMs - b.acquiredAtMs;
  });
}

// ---------------------------------------------------------------------------
// The ledger.
// ---------------------------------------------------------------------------

export interface ComputeLedgerInput {
  acquisitions: readonly AcquisitionLot[];
  disposals: readonly DisposalEvent[];
  method: CostBasisMethod;
  /** For "specid": the explicit lot-consumption order (lot ids). */
  specIdOrder?: readonly string[];
}

/**
 * Compute the per-(wallet,asset) cost-basis ledger. Disposals are processed in
 * chronological order (a disposal can only consume lots acquired at or before
 * it). Partial-lot consumption apportions both proceeds and basis half-up. Any
 * disposal quantity with no available lot becomes a missing-basis shortfall —
 * reported, never assumed $0.
 */
export function computeCostBasisLedger(input: ComputeLedgerInput): LedgerResult {
  if (!COST_BASIS_METHODS.includes(input.method)) {
    throw new Error(`cost-basis: unknown method ${input.method}`);
  }

  const working: WorkingLot[] = input.acquisitions.map((a) => {
    if (a.quantityScaled <= BI_ZERO) {
      throw new Error(`cost-basis: acquisition ${a.id} has non-positive quantity`);
    }
    if (!Number.isSafeInteger(a.basisCents) || a.basisCents < 0) {
      throw new Error(`cost-basis: acquisition ${a.id} has bad basis`);
    }
    return {
      id: a.id,
      remainingScaled: a.quantityScaled,
      remainingBasisCents: a.basisCents,
      originalQtyScaled: a.quantityScaled,
      originalBasisCents: a.basisCents,
      acquiredAtMs: toMs(a.acquiredAtMs),
    };
  });

  const disposalsSorted = input.disposals
    .slice()
    .sort((a, b) => toMs(a.disposedAtMs) - toMs(b.disposedAtMs));

  const results: DisposalResult[] = [];
  let totalRealized = 0;
  let totalShort = 0;
  let totalLong = 0;
  let totalMissing = BI_ZERO;

  for (const d of disposalsSorted) {
    if (d.quantityScaled <= BI_ZERO) {
      throw new Error(`cost-basis: disposal ${d.id} has non-positive quantity`);
    }
    const disposedAtMs = toMs(d.disposedAtMs);

    // Only lots acquired at or before the disposal can be consumed.
    const eligible = working.filter(
      (l) => l.remainingScaled > BI_ZERO && l.acquiredAtMs <= disposedAtMs,
    );
    const ordered = orderLots(eligible, input.method, input.specIdOrder);

    let remainingToMatch = d.quantityScaled;
    const consumptions: LotConsumption[] = [];
    let matchedQty = BI_ZERO;

    for (const lot of ordered) {
      if (remainingToMatch <= BI_ZERO) break;
      const take = lot.remainingScaled < remainingToMatch ? lot.remainingScaled : remainingToMatch;
      // Apportion proceeds (from the disposal) and basis (from the lot).
      const proceeds = apportionCents(d.proceedsCents, take, d.quantityScaled);
      // Basis: apportion the lot's ORIGINAL basis by units taken vs original qty,
      // but never exceed remaining basis (the last take absorbs rounding).
      const fullTake = take >= lot.remainingScaled;
      const basis = fullTake
        ? lot.remainingBasisCents
        : Math.min(
            lot.remainingBasisCents,
            apportionCents(lot.originalBasisCents, take, lot.originalQtyScaled),
          );
      const gain = proceeds - basis;
      const hp = holdingPeriod(lot.acquiredAtMs, disposedAtMs);
      consumptions.push({
        lotId: lot.id,
        quantityScaled: take,
        proceedsCents: proceeds,
        basisCents: basis,
        gainCents: gain,
        acquiredAtMs: lot.acquiredAtMs,
        disposedAtMs,
        holdingPeriod: hp,
      });
      // Mutate the underlying working lot.
      lot.remainingScaled = lot.remainingScaled - take;
      lot.remainingBasisCents = lot.remainingBasisCents - basis;
      remainingToMatch = remainingToMatch - take;
      matchedQty = matchedQty + take;
    }

    const missing = remainingToMatch > BI_ZERO ? remainingToMatch : BI_ZERO;

    let matchedProceeds = 0;
    let matchedBasis = 0;
    let shortGain = 0;
    let longGain = 0;
    for (const c of consumptions) {
      matchedProceeds += c.proceedsCents;
      matchedBasis += c.basisCents;
      if (c.holdingPeriod === "short") shortGain += c.gainCents;
      else longGain += c.gainCents;
    }
    const realized = matchedProceeds - matchedBasis;

    results.push({
      disposalId: d.id,
      matchedQuantityScaled: matchedQty,
      missingBasisQuantityScaled: missing,
      consumptions,
      matchedProceedsCents: matchedProceeds,
      matchedBasisCents: matchedBasis,
      realizedGainCents: realized,
      shortTermGainCents: shortGain,
      longTermGainCents: longGain,
      hasMissingBasis: missing > BI_ZERO,
    });

    totalRealized += realized;
    totalShort += shortGain;
    totalLong += longGain;
    totalMissing = totalMissing + missing;
  }

  const remainingLots = working
    .filter((l) => l.remainingScaled > BI_ZERO)
    .map((l) => ({
      lotId: l.id,
      quantityScaled: l.remainingScaled,
      basisCents: l.remainingBasisCents,
      acquiredAtMs: l.acquiredAtMs,
    }));

  return {
    disposals: results,
    remainingLots,
    totalRealizedGainCents: totalRealized,
    totalShortTermGainCents: totalShort,
    totalLongTermGainCents: totalLong,
    totalMissingBasisQuantityScaled: totalMissing,
    hasAnyMissingBasis: totalMissing > BI_ZERO,
  };
}

/** Convenience: turn a decimal quantity string ("1.5") into scaled BigInt. */
export function quantityToScaled(decimal: string): bigint {
  const s = decimal.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error(`quantityToScaled: bad quantity ${JSON.stringify(decimal)}`);
  }
  const [ip, fp = ""] = s.split(".");
  if (fp.length > QTY_SCALE) {
    throw new Error(`quantityToScaled: too many decimals (max ${QTY_SCALE})`);
  }
  const padded = fp + "0".repeat(QTY_SCALE - fp.length);
  return BigInt((ip || "0") + padded);
}

/** Convenience: scaled BigInt back to a trimmed decimal string. */
export function scaledToQuantity(scaled: bigint): string {
  const neg = scaled < BI_ZERO;
  const abs = neg ? -scaled : scaled;
  const ip = abs / QTY_ONE;
  const fp = abs % QTY_ONE;
  const frac = fp.toString().padStart(QTY_SCALE, "0").replace(/0+$/, "");
  const body = frac.length > 0 ? `${ip.toString()}.${frac}` : ip.toString();
  return neg ? `-${body}` : body;
}

// ---------------------------------------------------------------------------
// Self-tests (bare-call style; throws on failure, prints pass line).
// ---------------------------------------------------------------------------

function eq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `crypto-cost-basis-core: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

const DAY = MS_PER_DAY;

export function __runCryptoCostBasisCoreTests(): void {
  // --- quantity scaling round-trips ---
  eq(scaledToQuantity(quantityToScaled("1.5")), "1.5", "1.5 round trip");
  eq(scaledToQuantity(quantityToScaled("100")), "100", "100 round trip");
  eq(scaledToQuantity(quantityToScaled("0.000000000000000001")), "0.000000000000000001", "1 wei round trip");
  eq(scaledToQuantity(QTY_ONE), "1", "QTY_ONE = 1 unit");
  let threw = false;
  try { quantityToScaled("1.2.3"); } catch { threw = true; }
  eq(threw, true, "bad quantity rejected");

  // --- basic FIFO: buy 1 @ $100, sell 1 @ $150 -> $50 gain ---
  const fifo1 = computeCostBasisLedger({
    method: "fifo",
    acquisitions: [{ id: "a1", quantityScaled: quantityToScaled("1"), basisCents: 10000, acquiredAtMs: 0 }],
    disposals: [{ id: "d1", quantityScaled: quantityToScaled("1"), proceedsCents: 15000, disposedAtMs: 10 * DAY }],
  });
  eq(fifo1.totalRealizedGainCents, 5000, "FIFO simple gain $50");
  eq(fifo1.disposals[0].hasMissingBasis, false, "no missing basis");
  eq(fifo1.disposals[0].consumptions.length, 1, "one lot consumed");
  eq(fifo1.disposals[0].shortTermGainCents, 5000, "short-term (10 days)");
  eq(fifo1.remainingLots.length, 0, "position fully closed");

  // --- holding period boundary: exactly 365 days = short; 366 = long ---
  const shortBoundary = computeCostBasisLedger({
    method: "fifo",
    acquisitions: [{ id: "a", quantityScaled: quantityToScaled("1"), basisCents: 10000, acquiredAtMs: 0 }],
    disposals: [{ id: "d", quantityScaled: quantityToScaled("1"), proceedsCents: 20000, disposedAtMs: 365 * DAY }],
  });
  eq(shortBoundary.disposals[0].consumptions[0].holdingPeriod, "short", "365 days = short");
  const longBoundary = computeCostBasisLedger({
    method: "fifo",
    acquisitions: [{ id: "a", quantityScaled: quantityToScaled("1"), basisCents: 10000, acquiredAtMs: 0 }],
    disposals: [{ id: "d", quantityScaled: quantityToScaled("1"), proceedsCents: 20000, disposedAtMs: 366 * DAY }],
  });
  eq(longBoundary.disposals[0].consumptions[0].holdingPeriod, "long", "366 days = long");
  eq(longBoundary.totalLongTermGainCents, 10000, "long-term gain bucket");
  eq(longBoundary.totalShortTermGainCents, 0, "no short-term");

  // --- FIFO vs LIFO vs HIFO differ on which lot is consumed ---
  // Lot A: 1 @ $100 (day 0); Lot B: 1 @ $300 (day 5). Sell 1 @ $250 on day 10.
  const acqs = [
    { id: "A", quantityScaled: quantityToScaled("1"), basisCents: 10000, acquiredAtMs: 0 },
    { id: "B", quantityScaled: quantityToScaled("1"), basisCents: 30000, acquiredAtMs: 5 * DAY },
  ];
  const disp = [{ id: "d", quantityScaled: quantityToScaled("1"), proceedsCents: 25000, disposedAtMs: 10 * DAY }];
  const fifo = computeCostBasisLedger({ method: "fifo", acquisitions: acqs, disposals: disp });
  eq(fifo.disposals[0].consumptions[0].lotId, "A", "FIFO consumes oldest (A)");
  eq(fifo.totalRealizedGainCents, 15000, "FIFO gain = 250-100 = $150");
  const lifo = computeCostBasisLedger({ method: "lifo", acquisitions: acqs, disposals: disp });
  eq(lifo.disposals[0].consumptions[0].lotId, "B", "LIFO consumes newest (B)");
  eq(lifo.totalRealizedGainCents, -5000, "LIFO gain = 250-300 = -$50");
  const hifo = computeCostBasisLedger({ method: "hifo", acquisitions: acqs, disposals: disp });
  eq(hifo.disposals[0].consumptions[0].lotId, "B", "HIFO consumes highest-cost (B)");
  eq(hifo.totalRealizedGainCents, -5000, "HIFO minimizes gain here (-$50)");

  // --- Spec-ID honours caller order ---
  const spec = computeCostBasisLedger({
    method: "specid",
    acquisitions: acqs,
    disposals: disp,
    specIdOrder: ["A", "B"],
  });
  eq(spec.disposals[0].consumptions[0].lotId, "A", "Spec-ID picks A first as told");

  // --- partial + multi-lot: sell 1.5 across two 1-unit lots ---
  const multi = computeCostBasisLedger({
    method: "fifo",
    acquisitions: [
      { id: "A", quantityScaled: quantityToScaled("1"), basisCents: 10000, acquiredAtMs: 0 },
      { id: "B", quantityScaled: quantityToScaled("1"), basisCents: 20000, acquiredAtMs: DAY },
    ],
    disposals: [{ id: "d", quantityScaled: quantityToScaled("1.5"), proceedsCents: 30000, disposedAtMs: 2 * DAY }],
  });
  eq(multi.disposals[0].consumptions.length, 2, "spans two lots");
  eq(multi.disposals[0].consumptions[0].quantityScaled === quantityToScaled("1"), true, "takes all of A");
  eq(multi.disposals[0].consumptions[1].quantityScaled === quantityToScaled("0.5"), true, "takes half of B");
  // basis = 10000 (A) + 10000 (half of B) = 20000; proceeds 30000 -> gain 10000
  eq(multi.disposals[0].matchedBasisCents, 20000, "matched basis $200");
  eq(multi.totalRealizedGainCents, 10000, "multi-lot gain $100");
  // B has 0.5 unit left with $100 basis remaining
  eq(multi.remainingLots.length, 1, "half of B remains");
  eq(multi.remainingLots[0].lotId, "B", "remaining is B");
  eq(multi.remainingLots[0].basisCents, 10000, "remaining basis $100");

  // --- MISSING BASIS: sell more than we hold -> shortfall, never $0 basis ---
  const missing = computeCostBasisLedger({
    method: "fifo",
    acquisitions: [{ id: "A", quantityScaled: quantityToScaled("1"), basisCents: 10000, acquiredAtMs: 0 }],
    disposals: [{ id: "d", quantityScaled: quantityToScaled("2"), proceedsCents: 40000, disposedAtMs: DAY }],
  });
  eq(missing.hasAnyMissingBasis, true, "missing basis detected");
  eq(missing.disposals[0].hasMissingBasis, true, "disposal flags missing basis");
  eq(missing.disposals[0].missingBasisQuantityScaled === quantityToScaled("1"), true, "1 unit missing");
  eq(missing.disposals[0].matchedQuantityScaled === quantityToScaled("1"), true, "1 unit matched");
  // Crucially: matched portion is honest (proceeds apportioned to matched unit
  // = half of 40000 = 20000; basis 10000 -> gain 10000). The missing unit is
  // NOT silently counted as $0-basis 100% gain.
  eq(missing.disposals[0].matchedProceedsCents, 20000, "only matched proceeds counted");
  eq(missing.disposals[0].realizedGainCents, 10000, "gain only on matched unit");

  // --- a disposal cannot consume a lot acquired AFTER it ---
  const future = computeCostBasisLedger({
    method: "fifo",
    acquisitions: [{ id: "late", quantityScaled: quantityToScaled("1"), basisCents: 10000, acquiredAtMs: 100 * DAY }],
    disposals: [{ id: "d", quantityScaled: quantityToScaled("1"), proceedsCents: 15000, disposedAtMs: 10 * DAY }],
  });
  eq(future.disposals[0].hasMissingBasis, true, "future lot not usable -> missing");
  eq(future.remainingLots.length, 1, "future lot untouched");

  // --- basis rounding never exceeds a lot's basis across partials ---
  const rounding = computeCostBasisLedger({
    method: "fifo",
    acquisitions: [{ id: "A", quantityScaled: quantityToScaled("3"), basisCents: 100, acquiredAtMs: 0 }],
    disposals: [
      { id: "d1", quantityScaled: quantityToScaled("1"), proceedsCents: 50, disposedAtMs: DAY },
      { id: "d2", quantityScaled: quantityToScaled("1"), proceedsCents: 50, disposedAtMs: 2 * DAY },
      { id: "d3", quantityScaled: quantityToScaled("1"), proceedsCents: 50, disposedAtMs: 3 * DAY },
    ],
  });
  const totalBasisUsed =
    rounding.disposals[0].matchedBasisCents +
    rounding.disposals[1].matchedBasisCents +
    rounding.disposals[2].matchedBasisCents;
  eq(totalBasisUsed, 100, "apportioned basis sums exactly to lot basis (no drift)");
  eq(rounding.remainingLots.length, 0, "lot fully consumed");

  console.log("crypto-cost-basis-core self-tests: all passed");
}
