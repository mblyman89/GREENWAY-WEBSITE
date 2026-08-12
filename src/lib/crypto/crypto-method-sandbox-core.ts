/**
 * src/lib/crypto/crypto-method-sandbox-core.ts
 *
 * R1-F5a — Cost-basis METHOD SANDBOX (PURE, float-free).
 * NO I/O, no server-only imports — safe under tsx and vitest.
 *
 * What it does
 * ------------
 * Lets Michael PREVIEW what his realized capital gain/(loss) would be for a tax
 * year under each accounting method — FIFO, LIFO, HIFO — WITHOUT committing to
 * any of them, so he can see the dollar difference before choosing. It runs the
 * exact same R1-C cost-basis engine (computeCostBasisLedger) once per method
 * over the SAME acquisitions and disposals, then reports each method's totals
 * side by side and highlights which minimizes the current-year gain.
 *
 * Legal guard-rail (CRITICAL — see bible §5, FAQ Q82–Q85, Q88)
 * ------------------------------------------------------------
 * FIFO is the IRS default and is always defensible. LIFO and HIFO are only
 * valid when implemented as Specific Identification with a CONTEMPORANEOUS,
 * recorded "standing order / books-and-records" identification made no later
 * than the time of each sale. So the sandbox is for PLANNING: it always emits a
 * hard warning on the LIFO and HIFO options telling Michael they require a
 * recorded Spec-ID to be defensible, and it never silently "picks" an
 * aggressive method. Consistency also matters: once a year is filed the chosen
 * method is locked (enforced by crypto-file-readiness-core.ts).
 *
 * Money math
 * ----------
 * All gains are integer USD CENTS from the R1-C engine (no floats). Quantities
 * stay as 18-decimal scaled bigints inside the engine.
 */

import {
  computeCostBasisLedger,
  type AcquisitionLot,
  type DisposalEvent,
  type CostBasisMethod,
  type LedgerResult,
} from "./crypto-cost-basis-core";

/** The methods the sandbox previews (Spec-ID is chosen explicitly, not previewed). */
export const SANDBOX_METHODS = ["fifo", "lifo", "hifo"] as const;
export type SandboxMethod = (typeof SANDBOX_METHODS)[number];

/** Methods that require a recorded Spec-ID / standing order to be defensible. */
const SPEC_ID_REQUIRED: ReadonlySet<SandboxMethod> = new Set<SandboxMethod>(["lifo", "hifo"]);

/**
 * True when a method requires a recorded Specific-Identification / standing
 * order to be defensible (LIFO, HIFO). FIFO (the IRS default) does not.
 */
export function methodRequiresSpecId(method: SandboxMethod): boolean {
  return SPEC_ID_REQUIRED.has(method);
}

/** One method's outcome in the sandbox. */
export interface MethodOutcome {
  method: SandboxMethod;
  totalRealizedGainCents: number;
  totalShortTermGainCents: number;
  totalLongTermGainCents: number;
  hasAnyMissingBasis: boolean;
  /**
   * True when this method is only defensible with a recorded Spec-ID standing
   * order (LIFO, HIFO). The UI must surface this as a hard warning.
   */
  requiresSpecId: boolean;
  /** Plain-English guard-rail note for Michael (empty for FIFO). */
  guardRailNote: string;
}

export interface MethodSandboxResult {
  outcomes: MethodOutcome[];
  /** The method with the LOWEST current-year realized gain (ties -> FIFO first). */
  lowestGainMethod: SandboxMethod;
  /** The FIFO outcome, always defensible — the safe baseline. */
  defaultMethod: SandboxMethod;
  /**
   * Cents saved by the lowest-gain method vs FIFO (>= 0). A planning figure
   * ONLY — realizing it requires a recorded Spec-ID (see guard-rail note).
   */
  potentialGainReductionVsFifoCents: number;
  /** True when ANY method left units without a basis lot. */
  hasAnyMissingBasis: boolean;
}

export interface MethodSandboxInput {
  acquisitions: readonly AcquisitionLot[];
  disposals: readonly DisposalEvent[];
}

const LIFO_NOTE =
  "LIFO is only valid as Specific Identification: you must have a recorded standing order / books-and-records identification made no later than the time of each sale. Without that record, the IRS default (FIFO) applies.";
const HIFO_NOTE =
  "HIFO is only valid as Specific Identification: you must have a recorded standing order / books-and-records identification made no later than the time of each sale. Without that record, the IRS default (FIFO) applies.";

function guardRailNoteFor(method: SandboxMethod): string {
  if (method === "lifo") return LIFO_NOTE;
  if (method === "hifo") return HIFO_NOTE;
  return "";
}

function runMethod(method: SandboxMethod, input: MethodSandboxInput): MethodOutcome {
  const result: LedgerResult = computeCostBasisLedger({
    method: method as CostBasisMethod,
    acquisitions: input.acquisitions,
    disposals: input.disposals,
  });
  return {
    method,
    totalRealizedGainCents: result.totalRealizedGainCents,
    totalShortTermGainCents: result.totalShortTermGainCents,
    totalLongTermGainCents: result.totalLongTermGainCents,
    hasAnyMissingBasis: result.hasAnyMissingBasis,
    requiresSpecId: methodRequiresSpecId(method),
    guardRailNote: guardRailNoteFor(method),
  };
}

/**
 * Preview realized gains under FIFO / LIFO / HIFO for one (wallet, asset) year.
 * Deterministic and side-effect-free. Ties for lowest gain resolve to FIFO,
 * then LIFO, then HIFO (the order in SANDBOX_METHODS) — never silently favoring
 * the aggressive method.
 */
export function runMethodSandbox(input: MethodSandboxInput): MethodSandboxResult {
  const outcomes: MethodOutcome[] = SANDBOX_METHODS.map((m) => runMethod(m, input));

  let lowest = outcomes[0];
  for (const o of outcomes) {
    if (o.totalRealizedGainCents < lowest.totalRealizedGainCents) {
      lowest = o;
    }
  }

  const fifo = outcomes.find((o) => o.method === "fifo")!;
  const reduction = fifo.totalRealizedGainCents - lowest.totalRealizedGainCents;

  return {
    outcomes,
    lowestGainMethod: lowest.method,
    defaultMethod: "fifo",
    potentialGainReductionVsFifoCents: reduction > 0 ? reduction : 0,
    hasAnyMissingBasis: outcomes.some((o) => o.hasAnyMissingBasis),
  };
}

// ---------------------------------------------------------------------------
// Self-tests (bare-call style; throws on failure, prints pass line).
// ---------------------------------------------------------------------------

function eq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `crypto-method-sandbox-core: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

// Local scaled-quantity helper (avoid importing the validator; 1 whole unit).
const QTY_ONE = (() => {
  let r = BigInt(1);
  const ten = BigInt(10);
  for (let i = 0; i < 18; i += 1) r = r * ten;
  return r;
})();

const DAY = 86400000;

export function __runCryptoMethodSandboxCoreTests(): void {
  // --- Spec-ID requirement flags ---
  eq(methodRequiresSpecId("fifo"), false, "FIFO needs no Spec-ID");
  eq(methodRequiresSpecId("lifo"), true, "LIFO needs Spec-ID");
  eq(methodRequiresSpecId("hifo"), true, "HIFO needs Spec-ID");

  // Two lots: cheap-old (A, $100) then pricey-new (B, $300). Sell 1 unit for $400.
  const acquisitions: AcquisitionLot[] = [
    { id: "A", quantityScaled: QTY_ONE, basisCents: 10000, acquiredAtMs: 0 },
    { id: "B", quantityScaled: QTY_ONE, basisCents: 30000, acquiredAtMs: 10 * DAY },
  ];
  const disposals: DisposalEvent[] = [
    { id: "d", quantityScaled: QTY_ONE, proceedsCents: 40000, disposedAtMs: 20 * DAY },
  ];

  const sb = runMethodSandbox({ acquisitions, disposals });
  eq(sb.outcomes.length, 3, "three method outcomes");

  const fifo = sb.outcomes.find((o) => o.method === "fifo")!;
  const lifo = sb.outcomes.find((o) => o.method === "lifo")!;
  const hifo = sb.outcomes.find((o) => o.method === "hifo")!;

  // FIFO consumes A ($100) -> gain 40000-10000 = 30000.
  eq(fifo.totalRealizedGainCents, 30000, "FIFO gain uses cheapest-oldest lot");
  // LIFO consumes B ($300) -> gain 40000-30000 = 10000.
  eq(lifo.totalRealizedGainCents, 10000, "LIFO gain uses newest lot");
  // HIFO consumes highest-cost B ($300) -> gain 10000.
  eq(hifo.totalRealizedGainCents, 10000, "HIFO gain uses highest-cost lot");

  // Lowest gain = 10000 (LIFO first in order among ties with HIFO).
  eq(sb.lowestGainMethod, "lifo", "lowest-gain method is LIFO (tie resolves to earlier in order)");
  eq(sb.defaultMethod, "fifo", "default method is always FIFO");
  eq(sb.potentialGainReductionVsFifoCents, 20000, "reduction vs FIFO = 30000-10000");
  eq(sb.hasAnyMissingBasis, false, "fully covered, no missing basis");

  // Guard-rail notes present exactly on LIFO/HIFO, empty on FIFO.
  eq(fifo.requiresSpecId, false, "FIFO outcome not flagged");
  eq(fifo.guardRailNote, "", "FIFO has no guard-rail note");
  eq(lifo.requiresSpecId, true, "LIFO outcome flagged");
  eq(lifo.guardRailNote.length > 0, true, "LIFO has a guard-rail note");
  eq(hifo.requiresSpecId, true, "HIFO outcome flagged");
  eq(hifo.guardRailNote.length > 0, true, "HIFO has a guard-rail note");

  // --- when methods tie (single lot), reduction is 0 and default stands ---
  const single = runMethodSandbox({
    acquisitions: [{ id: "only", quantityScaled: QTY_ONE, basisCents: 20000, acquiredAtMs: 0 }],
    disposals: [{ id: "d", quantityScaled: QTY_ONE, proceedsCents: 25000, disposedAtMs: DAY }],
  });
  eq(single.outcomes[0].totalRealizedGainCents, 5000, "single-lot gain");
  eq(single.potentialGainReductionVsFifoCents, 0, "no reduction when all methods equal");
  eq(single.lowestGainMethod, "fifo", "tie across all -> FIFO");

  // --- missing basis flows through the flag ---
  const missing = runMethodSandbox({
    acquisitions: [],
    disposals: [{ id: "d", quantityScaled: QTY_ONE, proceedsCents: 10000, disposedAtMs: DAY }],
  });
  eq(missing.hasAnyMissingBasis, true, "sandbox surfaces missing basis");

  console.log("crypto-method-sandbox-core self-tests: all passed");
}
