/**
 * src/lib/inventory/inventory-audit-core.ts   (slice books-10)
 *
 * THE INVENTORY AUDITOR — pure decision logic. No I/O, no Supabase, no React.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS, AND WHY IT SITS ON TOP OF CYCLE COUNTS RATHER THAN INSIDE THEM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The existing cycle-count feature (migration 0041, cycle-counts.ts,
 * cycle-count-sheet-core.ts, cycle-count-scan-core.ts) is GOOD at the thing it
 * does: it snapshots system quantity server-side, hands staff a sheet that does
 * NOT show that quantity (a genuinely blind count — the single hardest thing to
 * get right, and it is already right), resolves barcodes without ever silently
 * guessing between two matches, and applies deltas atomically so a register sale
 * mid-count cannot be clobbered.
 *
 * What it does NOT do is behave like an auditor. It will count whatever it is
 * pointed at, once, in units, and then never tell the general ledger. Six gaps,
 * all verified by execution rather than by reading, are closed here:
 *
 *   1. Counts never touched the books. A count could find forty missing units
 *      and the inventory balance on the balance sheet kept the old number
 *      forever. §1.471-2(d) requires the opposite: balances "verified by
 *      physical inventories at reasonable intervals AND ADJUSTED TO CONFORM
 *      THEREWITH". Adjusting the shelf without adjusting the books does half
 *      the job and gets no credit for it.
 *   2. No scope engine — it counted every active lot or a hand-typed list.
 *   3. No coverage memory — nothing knew what was counted last week.
 *   4. Variance was units only, never money. Nobody can triage 300 units of
 *      $2 pre-rolls against 3 units of $60 concentrate without dollars.
 *   5. No materiality, no recount. The first number typed became permanent.
 *   6. THE LOT-CODE TRAP was wide open (see below).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE LOT-CODE TRAP — the failure this module exists to make impossible
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Michael's own words: "products that had multiple lot codes ended up getting
 * consolidated into one because they recorded the lot code of the first one they
 * picked out and then assumed all of them were the same lot code."
 *
 * Mechanically: product P has lots L1, L2, L3 on the shelf. Someone picks up the
 * front jar, reads L1, counts all 30 units, writes 30 against L1. L2 and L3 get
 * counted as zero — or never touched at all. Three real lots collapse into one
 * on paper while all three are still physically sitting there.
 *
 * Federal regulation named this in 1960. 26 C.F.R. §1.471-2(f)(3) lists, among
 * methods NOT in accord with the regulations, "Omitting portions of the stock on
 * hand." That is precisely and literally what happened.
 *
 * THREE INDEPENDENT DEFENCES ARE BUILT HERE, because one is not enough:
 *
 *   (a) SCOPE COHESION — `groupLotsByProduct` + the whole-group admission rule
 *       in `buildAuditPlan`. If ANY lot of a product is in today's scope, EVERY
 *       open lot of that product is in scope, in the same session, on the same
 *       screen. You cannot be handed one lot of a three-lot product and be left
 *       to guess about the other two. A group is never split, even when it
 *       breaks the size budget — being slightly over budget is a scheduling
 *       annoyance, splitting a multi-lot product is how the books got wrong.
 *
 *   (b) NULL IS NOT ZERO — `countedQty === null` means NOBODY LOOKED. Zero means
 *       a human looked and found nothing. These are completely different facts
 *       and the difference is preserved end to end: `assessLine` reports
 *       "uncounted", `readinessOf` refuses to let a session close while any
 *       in-scope line is uncounted. Collapsing null to zero would silently
 *       recreate the exact bug — it would write off the entire on-hand of every
 *       lot nobody scanned.
 *
 *   (c) MERGE-SIGNATURE DETECTION — `detectLotMergeSignature`. Even with (a) and
 *       (b), a determined person could type the group total against one lot and
 *       zero against its siblings. That leaves a FINGERPRINT: one lot counted
 *       far above its own system quantity, its siblings counted at zero, and the
 *       group total landing suspiciously close to correct. The group ties, every
 *       line is filled in, and the session looks perfect. This function goes
 *       looking for that pattern specifically and refuses to let it through.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY A ROTATION IS ALLOWED AT ALL — and what it has to add up to
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PCAOB AS 2510.11 is the authority for cycle counting instead of an annual
 * wall-to-wall count, and it states the condition in the same breath: the
 * procedures must be "sufficiently reliable to produce results substantially the
 * same as those which would be obtained by a count of all items each year."
 *
 * That sentence is the DESIGN SPECIFICATION for `CADENCE_DAYS`, and it is
 * enforced structurally rather than hoped for: `assertCadencePolicySound` proves
 * at module load that no class's cadence exceeds 365 days, so a rotation that
 * runs as designed reaches every item inside a year. If a future edit sets a
 * cadence to 400 days, this module refuses to load rather than quietly shipping
 * a program that fails its own standard.
 *
 * AS 1105.27 is the matching humility clause: results from judgmentally selected
 * items "cannot be projected to the entire population." So nothing here computes
 * a shop-wide accuracy percentage from a targeted count. `buildCoverageReport`
 * reports what was TOUCHED and what was MISSED, and the missed list is the one
 * printed first.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * MONEY
 * ═══════════════════════════════════════════════════════════════════════════
 * All money is INTEGER MINOR UNITS (cents). Always. Quantities may be fractional
 * because cannabis is sold by weight, so extension rounds ONCE, explicitly, at
 * the moment quantity meets price — see `extendCostCents`.
 *
 * A lot whose `unitCostMinorUnits` is null is NOT worth zero. §1.471-2(f)(2)
 * forbids taking inventory "at a nominal price or at less than its proper
 * value", and zero is the most nominal price there is. Unvalued is a first-class
 * outcome that BLOCKS posting and demands a cost be supplied.
 */

import {
  findGuidanceAuthority,
  type GuidanceAuthority,
} from "@/lib/accounting/books-guidance-core";
import {
  INVENTORY_AUDIT_AUTHORITY_IDS,
  INVENTORY_AUDIT_BORROWED_AUTHORITY_IDS,
} from "./inventory-audit-authorities";

// ═══════════════════════════════════════════════════════════════════════════
// 1) THE INPUT SHAPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * One lot as the auditor needs to see it. Deliberately a flat, boring record:
 * this module must be callable from a test with a literal, not only from a
 * database row, or the tests end up testing the query instead of the thinking.
 */
export type AuditLot = {
  lotId: string;
  /** The regulatory lot code. Null happens on bad intake and is itself a risk. */
  lotCode: string | null;
  /** Groups lots that are the SAME product. The lot-code trap lives here. */
  posProductKey: string | null;
  productName: string | null;
  /** House inventory category slug, e.g. "flower". Drives the GL account. */
  categorySlug: string | null;
  vendorId: string | null;
  vendorName: string | null;
  /** System on-hand. May be fractional (grams). */
  onHandQty: number;
  /** Invoice cost per unit in CENTS. Null = unknown, NOT zero. */
  unitCostMinorUnits: number | null;
  /** ISO timestamp of the last completed count, or null for never. */
  lastCountedAt: string | null;
  /** How many times this lot has previously come up with a variance. */
  priorVarianceCount: number;
  /** active | quarantine | recalled | sold_out | destroyed */
  status: string;
};

/** A line as it stands during or after a count session. */
export type AuditCountLine = {
  lotId: string;
  /** Quantity the system believed at SNAPSHOT time. Frozen, never re-read. */
  systemQty: number;
  /**
   * What a human found. NULL MEANS NOBODY LOOKED. Zero means somebody looked
   * and found nothing. Do not ever collapse these two.
   */
  countedQty: number | null;
  /** Second blind count, when materiality demanded one. Null = not recounted. */
  recountQty: number | null;
  /** Structured shrink reason, required once a variance is material. */
  reason: string | null;
  /** Free text explanation, required once a variance is material. */
  note: string | null;
};

// ═══════════════════════════════════════════════════════════════════════════
// 2) MONEY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Multiply a (possibly fractional) quantity by a per-unit cost in cents and
 * round ONCE to a whole cent.
 *
 * Rounds HALF AWAY FROM ZERO, so +0.5c goes to +1c and -0.5c goes to -1c. That
 * choice is deliberate and it matters: half-up (toward +∞) would round -0.5 to
 * 0, which makes a shrink of exactly half a cent vanish while an equal overage
 * survives. Over thousands of lines a directional bias like that is exactly the
 * kind of thing that shows up as an unexplained drift nobody can source. Away
 * from zero treats a loss and a gain of the same size identically.
 */
export function extendCostCents(qty: number, unitCostMinorUnits: number): number {
  if (!Number.isFinite(qty) || !Number.isFinite(unitCostMinorUnits)) {
    throw new Error("extendCostCents: non-finite input");
  }
  if (!Number.isInteger(unitCostMinorUnits)) {
    throw new Error(
      `extendCostCents: unit cost must already be in whole cents, got ${unitCostMinorUnits}`,
    );
  }
  const raw = qty * unitCostMinorUnits;
  return raw < 0 ? -Math.round(-raw) : Math.round(raw);
}

/** Cents → "$1,234.56". Used in staff-facing and owner-facing copy alike. */
export function formatCents(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  const rem = String(abs % 100).padStart(2, "0");
  return `${neg ? "-" : ""}$${dollars}.${rem}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3) ABC STRATIFICATION
//
// AS 1105.25 gives two professional bases for picking specific items: things
// that are BIG ("all items over a certain amount... to verify a large
// proportion of the total amount") and things that are RISKY ("suspicious,
// unusual, or particularly risk-prone or items that have a history of error").
// This section does BIG. Section 4 does RISKY.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A = the lots carrying the first 80% of the money.
 * B = the next 15%.
 * C = the last 5% — the long tail of cheap stuff.
 * U = UNVALUED. No cost on file, so its value is unknown, not small.
 *
 * U is not a fourth tier of cheapness. An unpriced lot is treated as high
 * attention precisely BECAUSE its value is unknown: assuming an unknown is small
 * is how you end up ignoring the expensive thing. §1.471-2(f)(2) refuses to let
 * us call it zero, so we refuse to let it sit at the bottom of the list.
 */
export type AbcClass = "A" | "B" | "C" | "U";

export const ABC_CUTOFF_MILLI_PCT = { A: 80_000, B: 95_000 } as const;

export type StratifiedLot = {
  lot: AuditLot;
  /** Extended value at invoice cost, in cents. Null when cost is unknown. */
  extendedCostCents: number | null;
  abc: AbcClass;
  /** Share of total valued inventory, in milli-percent (80_000 = 80.000%). */
  cumulativeMilliPct: number;
};

export function stratifyLots(lots: readonly AuditLot[]): StratifiedLot[] {
  const valued: Array<{ lot: AuditLot; cents: number }> = [];
  const unvalued: AuditLot[] = [];

  for (const lot of lots) {
    if (lot.unitCostMinorUnits === null) {
      unvalued.push(lot);
      continue;
    }
    valued.push({ lot, cents: extendCostCents(lot.onHandQty, lot.unitCostMinorUnits) });
  }

  // Descending by money. Tie-break on lotId so the ordering is deterministic —
  // a report that reshuffles between runs is a report nobody trusts.
  valued.sort((a, b) => (b.cents - a.cents) || a.lot.lotId.localeCompare(b.lot.lotId));

  const total = valued.reduce((s, v) => s + v.cents, 0);
  const out: StratifiedLot[] = [];
  let running = 0;

  for (const v of valued) {
    // THE BOUNDARY RULE. A lot is classified on the cumulative share reached
    // BEFORE it is added, not after. The lot that CROSSES a cutoff belongs to
    // the class it was still inside when its turn came.
    //
    // This is not a cosmetic preference, it is the difference between a working
    // programme and a broken one. Classifying on the cumulative AFTER the lot
    // means the single biggest lot is judged by the share it already fills. If
    // one lot holds 90% of the money, "after" is 90% and the richest lot on the
    // premises gets labelled B. If one lot holds ALL of the money — a small shop,
    // or a single product line — "after" is 100% and that lot gets labelled C,
    // the long tail, and drops to a 90-day cadence. The most valuable stock in
    // the building would be the least frequently counted. Classifying on the
    // share reached BEFORE the lot puts the first lot at 0%, which is always
    // inside A, which is always correct: the biggest lot is never the tail.
    const before = total > 0 ? Math.round(((running) / total) * 100_000) : 100_000;
    running += v.cents;
    // When total is 0 (every valued lot is out of stock) there is no meaningful
    // Pareto curve. Everything is C: nothing on the shelf, nothing at stake.
    const cum = total > 0 ? Math.round((running / total) * 100_000) : 100_000;
    const abc: AbcClass =
      total <= 0 ? "C"
      : before < ABC_CUTOFF_MILLI_PCT.A ? "A"
      : before < ABC_CUTOFF_MILLI_PCT.B ? "B"
      : "C";
    // `cumulativeMilliPct` is reported as the share covered THROUGH this lot,
    // because that is the number a reader wants ("these lots are 80% of value").
    // It is deliberately not the number used to classify. See above.
    out.push({ lot: v.lot, extendedCostCents: v.cents, abc, cumulativeMilliPct: cum });
  }

  for (const lot of unvalued) {
    out.push({ lot, extendedCostCents: null, abc: "U", cumulativeMilliPct: 0 });
  }

  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4) CADENCE AND RISK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * How often each class should be counted, in days.
 *
 * THE HARD CONSTRAINT: every one of these must be ≤ 365, because AS 2510.11
 * only permits a rotation that produces "results substantially the same as those
 * which would be obtained by a count of all items each year". A cadence of 400
 * days would mean some products are never reached inside a year and the whole
 * programme fails the standard it relies on. `assertCadencePolicySound` proves
 * this at module load — see the call at the bottom of this file.
 *
 * U (unvalued) gets the TIGHTEST cadence of all. A lot with no cost on file is
 * both a valuation problem and an intake problem, and it should be in front of a
 * human quickly.
 */
export const CADENCE_DAYS: Record<AbcClass, number> = {
  A: 30,
  B: 60,
  C: 90,
  U: 14,
};

export const MAX_PERMITTED_CADENCE_DAYS = 365;

/**
 * Prove a cadence policy can actually satisfy AS 2510.11, and throw if it cannot.
 *
 * WHY THIS TAKES A PARAMETER. It used to read `CADENCE_DAYS` directly, which
 * made its own logic impossible to test: with sound constants hard-coded, the
 * failure branch could never be reached, and a mutation campaign proved the
 * point by disabling the check with no test noticing. A guard whose firing
 * mechanism is untestable is a comment with extra steps.
 *
 * Taking the policy as an argument (defaulting to the shipped one, so every
 * existing call site and the module-load assertion are unchanged) lets the tests
 * hand it a deliberately broken policy and prove it refuses.
 */
export function assertCadencePolicySound(
  policy: Record<string, number> = CADENCE_DAYS,
): void {
  for (const [cls, days] of Object.entries(policy)) {
    if (!Number.isInteger(days) || days < 1) {
      throw new Error(`inventory-audit-core: cadence for class ${cls} must be a positive integer`);
    }
    if (days > MAX_PERMITTED_CADENCE_DAYS) {
      throw new Error(
        `inventory-audit-core: cadence for class ${cls} is ${days} days, which exceeds ${MAX_PERMITTED_CADENCE_DAYS}. ` +
          `PCAOB AS 2510.11 only allows a rotating count in place of an annual count of every item when the ` +
          `programme produces "results substantially the same as those which would be obtained by a count of ` +
          `all items each year". A cadence longer than a year cannot do that.`,
      );
    }
  }
}

export const MS_PER_DAY = 86_400_000;

/** Whole days between two ISO instants. Null `since` means "never counted". */
export function daysSince(since: string | null, asOf: Date): number | null {
  if (since === null) return null;
  const t = Date.parse(since);
  if (Number.isNaN(t)) return null;
  return Math.floor((asOf.getTime() - t) / MS_PER_DAY);
}

/**
 * Why a lot is being put in front of a human today. Every reason maps to a
 * professional basis, so the hub can always answer "why am I counting this?"
 * with something better than "the computer said so".
 */
export type RiskReasonCode =
  | "never_counted"
  | "overdue"
  | "high_value"
  | "multi_lot_product"
  | "history_of_error"
  | "missing_cost"
  | "missing_lot_code"
  | "quarantined";

export const RISK_REASON_TEXT: Record<RiskReasonCode, string> = {
  never_counted: "Nobody has ever counted this lot.",
  overdue: "This lot is past due for its scheduled count.",
  high_value: "A large share of the money on your shelves is sitting in this lot.",
  multi_lot_product: "This product has more than one open lot — the exact situation that broke the books before.",
  history_of_error: "This lot has come up wrong on a previous count.",
  missing_cost: "This lot has no cost on file, so nobody can say what it is worth.",
  missing_lot_code: "This lot has no lot code recorded, which is a traceability problem on its own.",
  quarantined: "This lot is not in normal selling status and needs eyes on it.",
};

/**
 * Weights. Higher = sooner. These are an executive judgement, not a law, and
 * they are DATA so they can be argued with and tuned without touching logic.
 *
 * `multi_lot_product` is weighted second-highest on purpose. It is not the most
 * expensive risk in dollars — it is the one that has actually bitten this
 * business, and Rule 19 says the owner's real historical failures outrank
 * theoretical ones.
 */
export const RISK_WEIGHTS: Record<RiskReasonCode, number> = {
  never_counted: 100,
  multi_lot_product: 80,
  history_of_error: 60,
  missing_cost: 55,
  quarantined: 50,
  overdue: 40,
  high_value: 35,
  missing_lot_code: 30,
};

export type LotRisk = {
  lot: AuditLot;
  abc: AbcClass;
  extendedCostCents: number | null;
  daysSinceCount: number | null;
  dueInDays: number | null;
  isOverdue: boolean;
  reasons: RiskReasonCode[];
  score: number;
};

/** Group lots by product. THE anchor of the lot-code defence. */
export function groupLotsByProduct(lots: readonly AuditLot[]): Map<string, AuditLot[]> {
  const m = new Map<string, AuditLot[]>();
  for (const lot of lots) {
    // A lot with no product key cannot be grouped with anything, so it becomes
    // its own group keyed by lot id. It must NOT fall into a shared "null"
    // bucket — that would invent a product relationship that does not exist and
    // drag unrelated lots into each other's scope.
    const key = lot.posProductKey ?? `\u0000lot:${lot.lotId}`;
    const arr = m.get(key);
    if (arr) arr.push(lot);
    else m.set(key, [lot]);
  }
  return m;
}

export function assessRisk(lots: readonly AuditLot[], asOf: Date): LotRisk[] {
  const strat = stratifyLots(lots);
  const byId = new Map(strat.map((s) => [s.lot.lotId, s]));
  const groups = groupLotsByProduct(lots);
  const groupSizeByLot = new Map<string, number>();
  for (const [, arr] of groups) {
    for (const l of arr) groupSizeByLot.set(l.lotId, arr.length);
  }

  const out: LotRisk[] = [];
  for (const lot of lots) {
    const s = byId.get(lot.lotId)!;
    const d = daysSince(lot.lastCountedAt, asOf);
    const cadence = CADENCE_DAYS[s.abc];
    const isOverdue = d === null || d >= cadence;
    const dueInDays = d === null ? null : cadence - d;

    const reasons: RiskReasonCode[] = [];
    if (d === null) reasons.push("never_counted");
    else if (isOverdue) reasons.push("overdue");
    if (s.abc === "A") reasons.push("high_value");
    if ((groupSizeByLot.get(lot.lotId) ?? 1) > 1) reasons.push("multi_lot_product");
    if (lot.priorVarianceCount > 0) reasons.push("history_of_error");
    if (lot.unitCostMinorUnits === null) reasons.push("missing_cost");
    if (lot.lotCode === null || lot.lotCode.trim() === "") reasons.push("missing_lot_code");
    if (lot.status !== "active") reasons.push("quarantined");

    let score = reasons.reduce((sum, r) => sum + RISK_WEIGHTS[r], 0);
    // Being MORE overdue matters more than being barely overdue, but it must
    // never overwhelm the categorical reasons above — capped at 60 so a lot that
    // is 900 days late cannot outrank a live multi-lot product that also has a
    // history of error.
    if (d !== null && d > cadence) score += Math.min(60, d - cadence);

    out.push({
      lot,
      abc: s.abc,
      extendedCostCents: s.extendedCostCents,
      daysSinceCount: d,
      dueInDays,
      isOverdue,
      reasons,
      score,
    });
  }

  out.sort((a, b) => (b.score - a.score) || a.lot.lotId.localeCompare(b.lot.lotId));
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// 5) THE PLAN — what to count today
// ═══════════════════════════════════════════════════════════════════════════

export type AuditPlanGroup = {
  productKey: string;
  productName: string | null;
  vendorName: string | null;
  lots: LotRisk[];
  groupScore: number;
  totalUnits: number;
  /** Null if ANY lot in the group is unvalued — an unknown poisons the sum. */
  totalCostCents: number | null;
  /** True when the group holds more than one open lot. Drives the loud warning. */
  isMultiLot: boolean;
  reasons: RiskReasonCode[];
};

export type AuditPlan = {
  asOf: string;
  groups: AuditPlanGroup[];
  lotCount: number;
  /** Groups that qualified but did not fit today. Named, so nothing is lost. */
  deferredGroups: number;
  /** True when a single group had to bust the budget rather than be split. */
  budgetOverriddenForCohesion: boolean;
  multiLotGroupCount: number;
  totalUnits: number;
  totalCostCents: number | null;
  notes: string[];
};

export type PlanOptions = {
  /** Soft cap on lots per session. Soft, because cohesion outranks it. */
  maxLots: number;
  /** When false, lots not yet due are excluded. Default true. */
  includeOnlyDue?: boolean;
};

/**
 * Draft the scope. THE SYSTEM PROPOSES; Michael validates before anyone counts.
 *
 * THE ONE RULE THAT MATTERS: groups are admitted whole or not at all. A product
 * with three open lots is presented as three lots on one screen, always. This is
 * defence (a) against the lot-code trap. The budget is a convenience; cohesion
 * is a control, and when they conflict the control wins — recorded honestly in
 * `budgetOverriddenForCohesion` rather than hidden.
 */
export function buildAuditPlan(
  lots: readonly AuditLot[],
  asOf: Date,
  opts: PlanOptions,
): AuditPlan {
  if (!Number.isInteger(opts.maxLots) || opts.maxLots < 1) {
    throw new Error("buildAuditPlan: maxLots must be a positive integer");
  }
  const includeOnlyDue = opts.includeOnlyDue !== false;

  const risks = assessRisk(lots, asOf);
  const riskById = new Map(risks.map((r) => [r.lot.lotId, r]));
  const groups = groupLotsByProduct(lots);

  const candidates: AuditPlanGroup[] = [];
  for (const [productKey, arr] of groups) {
    const lotRisks = arr
      .map((l) => riskById.get(l.lotId)!)
      .sort((a, b) => (b.score - a.score) || a.lot.lotId.localeCompare(b.lot.lotId));

    // A group is due if ANY of its lots is due. You cannot honestly count two
    // of three lots of a product and leave the third for next month — that IS
    // the trap. One due lot pulls its whole family in.
    const anyDue = lotRisks.some((r) => r.isOverdue);
    if (includeOnlyDue && !anyDue) continue;

    let totalCostCents: number | null = 0;
    for (const r of lotRisks) {
      if (r.extendedCostCents === null) { totalCostCents = null; break; }
      totalCostCents += r.extendedCostCents;
    }

    const reasonSet = new Set<RiskReasonCode>();
    for (const r of lotRisks) for (const c of r.reasons) reasonSet.add(c);

    candidates.push({
      productKey,
      productName: lotRisks[0]?.lot.productName ?? null,
      vendorName: lotRisks[0]?.lot.vendorName ?? null,
      lots: lotRisks,
      // The group takes its HIGHEST member's score, not the average. Averaging
      // would let two calm lots dilute one alarming one, which is backwards:
      // the reason to look at this product is the worst thing in it.
      groupScore: lotRisks.reduce((m, r) => Math.max(m, r.score), 0),
      totalUnits: lotRisks.reduce((s, r) => s + r.lot.onHandQty, 0),
      totalCostCents,
      isMultiLot: lotRisks.length > 1,
      reasons: [...reasonSet],
    });
  }

  candidates.sort((a, b) => (b.groupScore - a.groupScore) || a.productKey.localeCompare(b.productKey));

  const chosen: AuditPlanGroup[] = [];
  let used = 0;
  let deferred = 0;
  let overridden = false;

  for (const g of candidates) {
    if (used + g.lots.length <= opts.maxLots) {
      chosen.push(g);
      used += g.lots.length;
      continue;
    }
    // Does not fit. If we have taken nothing yet and this single group is bigger
    // than the entire budget, take it anyway: a product with more open lots than
    // the daily budget still must be counted all at once or not at all.
    if (chosen.length === 0 && g.lots.length > opts.maxLots) {
      chosen.push(g);
      used += g.lots.length;
      overridden = true;
      continue;
    }
    deferred += 1;
  }

  const notes: string[] = [];
  const multiLot = chosen.filter((g) => g.isMultiLot).length;
  if (multiLot > 0) {
    notes.push(
      `${multiLot} product${multiLot === 1 ? " has" : "s have"} more than one open lot today. ` +
        `Every lot of those products is on this list on purpose — count them together, ` +
        `and never assume the jar behind the first one is the same lot.`,
    );
  }
  if (overridden) {
    notes.push(
      `One product has more open lots than the size limit you set. It was kept whole anyway. ` +
        `Splitting a multi-lot product across two sessions is the exact mistake this system exists to prevent.`,
    );
  }
  if (deferred > 0) {
    notes.push(
      `${deferred} more product${deferred === 1 ? "" : "s"} ${deferred === 1 ? "is" : "are"} due but did not fit ` +
        `in today's session. Nothing is lost — they keep their place at the front of the queue and will be ` +
        `first on the next list.`,
    );
  }
  if (chosen.length === 0) {
    notes.push(
      `Nothing is due for counting right now. That is a real answer, not an error — ` +
        `it means the rotation is ahead of schedule.`,
    );
  }

  let totalCost: number | null = 0;
  for (const g of chosen) {
    if (g.totalCostCents === null) { totalCost = null; break; }
    totalCost += g.totalCostCents;
  }

  return {
    asOf: asOf.toISOString(),
    groups: chosen,
    lotCount: used,
    deferredGroups: deferred,
    budgetOverriddenForCohesion: overridden,
    multiLotGroupCount: multiLot,
    totalUnits: chosen.reduce((s, g) => s + g.totalUnits, 0),
    totalCostCents: totalCost,
    notes,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 6) COVERAGE — the AS 2510.11 self-check
// ═══════════════════════════════════════════════════════════════════════════

export type CoverageReport = {
  totalLots: number;
  countedEver: number;
  neverCounted: number;
  overdue: number;
  /** Lots not counted within a YEAR. The number that breaks AS 2510.11. */
  beyondOneYear: number;
  /** Worst case on the floor, in days. Null when every lot is uncounted. */
  oldestDaysSinceCount: number | null;
  /** Does the programme still qualify as a substitute for an annual count? */
  meetsAnnualStandard: boolean;
  /** Plain-English verdict. Never claims more than the evidence supports. */
  verdict: string;
  staleLotIds: string[];
};

export function buildCoverageReport(lots: readonly AuditLot[], asOf: Date): CoverageReport {
  let countedEver = 0;
  let neverCounted = 0;
  let beyondOneYear = 0;
  let oldest: number | null = null;
  const stale: string[] = [];
  const strat = new Map(stratifyLots(lots).map((s) => [s.lot.lotId, s.abc]));

  let overdue = 0;
  for (const lot of lots) {
    const d = daysSince(lot.lastCountedAt, asOf);
    const cadence = CADENCE_DAYS[strat.get(lot.lotId) ?? "C"];
    if (d === null) {
      neverCounted += 1;
      beyondOneYear += 1;
      overdue += 1;
      stale.push(lot.lotId);
      continue;
    }
    countedEver += 1;
    if (d > (oldest ?? -1)) oldest = d;
    if (d >= cadence) overdue += 1;
    if (d > MAX_PERMITTED_CADENCE_DAYS) {
      beyondOneYear += 1;
      stale.push(lot.lotId);
    }
  }

  const meets = beyondOneYear === 0;

  // WORDING IS LOAD-BEARING HERE. AS 1105.27 forbids projecting the result of a
  // judgmental selection onto the whole population, so this verdict describes
  // COVERAGE (which lots were reached) and never accuracy (how right the shop
  // is). "97% of lots counted this year" is a fact about our diligence.
  // "97% accurate" would be a claim about the shop that no targeted count can
  // support, and it is the sentence this system must never print.
  const verdict = meets
    ? `Every one of the ${lots.length} lots on hand has been counted within the last year. ` +
      `That is what lets a rotating count stand in for shutting the doors and counting everything at once. ` +
      `This measures how much you have REACHED, not how accurate the shop is — those are different questions.`
    : `${beyondOneYear} lot${beyondOneYear === 1 ? " has" : "s have"} not been counted in over a year ` +
      `${neverCounted > 0 ? `(${neverCounted} never counted at all) ` : ""}— ` +
      `so this rotation does not currently stand in for an annual count of everything. ` +
      `Clear the stale list and it will.`;

  return {
    totalLots: lots.length,
    countedEver,
    neverCounted,
    overdue,
    beyondOneYear,
    oldestDaysSinceCount: oldest,
    meetsAnnualStandard: meets,
    verdict,
    staleLotIds: stale,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 7) MATERIALITY, VARIANCE, AND THE RECOUNT RULE
// ═══════════════════════════════════════════════════════════════════════════

export type MaterialityPolicy = {
  /** A variance at or above this many cents is material regardless of size. */
  absCents: number;
  /** ...or at or above this share of the line's system value (milli-percent). */
  milliPct: number;
  /** Any variance at or above this many cents demands a second blind recount. */
  recountAtCents: number;
};

/**
 * Chosen deliberately tight, because Michael is scanning EVERY unit rather than
 * eyeballing shelves. When the count method is exact, tolerating drift is just
 * tolerating error. $20 is roughly one unit of the more expensive things in the
 * shop — small enough to catch a single missing jar, large enough not to trip
 * over a rounded gram.
 */
export const DEFAULT_MATERIALITY: MaterialityPolicy = {
  absCents: 2_000,
  milliPct: 2_000, // 2.000%
  recountAtCents: 5_000,
};

export type LineStatus =
  | "uncounted"
  | "clean"
  | "immaterial"
  | "material"
  | "needs_recount"
  | "recount_disagrees"
  | "unvalued";

export type LineAssessment = {
  lotId: string;
  status: LineStatus;
  /** Counted minus system. Positive = found MORE than the books said. */
  varianceQty: number | null;
  /** Variance valued at INVOICE cost (§1.471-3(b)). Null when unvalued. */
  varianceCents: number | null;
  systemValueCents: number | null;
  isMaterial: boolean;
  requiresRecount: boolean;
  requiresDocumentation: boolean;
  blocksPosting: boolean;
  /** Which count is authoritative: the recount when present, else the count. */
  effectiveCountedQty: number | null;
  messages: string[];
  authorityIds: string[];
};

export function assessLine(
  lot: AuditLot,
  line: AuditCountLine,
  policy: MaterialityPolicy = DEFAULT_MATERIALITY,
): LineAssessment {
  const messages: string[] = [];
  const authorityIds: string[] = [];

  // NULL IS NOT ZERO. Defence (b) against the lot-code trap. If we let an
  // uncounted line fall through as zero we would write off the entire on-hand
  // of every lot nobody scanned — which is how you lose three lots of a product
  // because someone only scanned the front jar.
  if (line.countedQty === null) {
    return {
      lotId: lot.lotId,
      status: "uncounted",
      varianceQty: null,
      varianceCents: null,
      systemValueCents:
        lot.unitCostMinorUnits === null ? null : extendCostCents(line.systemQty, lot.unitCostMinorUnits),
      isMaterial: false,
      requiresRecount: false,
      requiresDocumentation: false,
      blocksPosting: true,
      effectiveCountedQty: null,
      messages: [
        "Nobody has counted this line yet. Blank is not the same as zero — blank means we do not know, " +
          "and zero means someone looked and the shelf was empty. This session cannot be finished until " +
          "somebody puts eyes on it.",
      ],
      authorityIds: ["REG_1_471_2_F_3_OMITTING_STOCK"],
    };
  }

  const effective = line.recountQty !== null ? line.recountQty : line.countedQty;
  const varianceQty = effective - line.systemQty;

  if (lot.unitCostMinorUnits === null) {
    // §1.471-2(f)(2). We could multiply by zero and show a tidy $0.00. We will
    // not. An unknown value is not a small value.
    return {
      lotId: lot.lotId,
      status: "unvalued",
      varianceQty,
      varianceCents: null,
      systemValueCents: null,
      isMaterial: varianceQty !== 0,
      requiresRecount: false,
      requiresDocumentation: varianceQty !== 0,
      blocksPosting: true,
      effectiveCountedQty: effective,
      messages: [
        "This lot has no cost on file, so the system cannot say what the difference is worth — and it will " +
          "not pretend the answer is zero. Put the invoice cost on the lot and this line will value itself.",
      ],
      authorityIds: ["REG_1_471_2_F_2_NOMINAL_PRICE", "REG_1_471_3_B_RESELLER_COST"],
    };
  }

  const unitCost = lot.unitCostMinorUnits;
  const varianceCents = extendCostCents(varianceQty, unitCost);
  const systemValueCents = extendCostCents(line.systemQty, unitCost);
  const absCents = Math.abs(varianceCents);

  if (varianceQty === 0) {
    return {
      lotId: lot.lotId,
      status: "clean",
      varianceQty: 0,
      varianceCents: 0,
      systemValueCents,
      isMaterial: false,
      requiresRecount: false,
      requiresDocumentation: false,
      blocksPosting: false,
      effectiveCountedQty: effective,
      messages: ["Counted exactly what the books said. Nothing to do."],
      authorityIds: [],
    };
  }

  const pctOfLine =
    systemValueCents > 0 ? Math.round((absCents / systemValueCents) * 100_000) : 100_000;
  const isMaterial = absCents >= policy.absCents || pctOfLine >= policy.milliPct;

  // RECOUNT DISCIPLINE. A single keystroke should never become a permanent
  // inventory adjustment. Above the recount threshold a SECOND BLIND count is
  // required before anything posts, and if the two counts disagree the line is
  // frozen for a human rather than quietly averaged.
  const needsRecount = absCents >= policy.recountAtCents;
  if (needsRecount && line.recountQty === null) {
    return {
      lotId: lot.lotId,
      status: "needs_recount",
      varianceQty,
      varianceCents,
      systemValueCents,
      isMaterial: true,
      requiresRecount: true,
      requiresDocumentation: true,
      blocksPosting: true,
      effectiveCountedQty: effective,
      messages: [
        `This is off by ${formatCents(absCents)}, which is big enough to be worth a second look before it ` +
          `touches anything. Count it again WITHOUT looking at the first number. If the two counts agree, ` +
          `we will trust them.`,
      ],
      authorityIds: ["AS_2510_12_RECORDS_ALONE"],
    };
  }

  if (line.recountQty !== null && line.recountQty !== line.countedQty) {
    return {
      lotId: lot.lotId,
      status: "recount_disagrees",
      varianceQty,
      varianceCents,
      systemValueCents,
      isMaterial: true,
      requiresRecount: false,
      requiresDocumentation: true,
      blocksPosting: true,
      effectiveCountedQty: effective,
      messages: [
        `The first count said ${line.countedQty} and the second said ${line.recountQty}. Two honest counts ` +
          `of the same shelf should match, so one of them is wrong and the system will not guess which. ` +
          `Do not average them. Go and look again.`,
      ],
      authorityIds: ["AS_2510_12_RECORDS_ALONE", "REG_1_471_2_E_BURDEN_OF_PROOF"],
    };
  }

  // DOCUMENTATION GATE — WAC 314-55-089(4)(c). In Washington an inventory
  // reduction with no adequate documentation is not a write-off: it is DEEMED A
  // SALE and assessed the 37% excise. So a material shrink without a reason and
  // a note is not merely untidy, it is expensive, and it is blocked here.
  const isShrink = varianceQty < 0;
  const hasReason = (line.reason ?? "").trim() !== "";
  const hasNote = (line.note ?? "").trim() !== "";
  const needsDocs = isMaterial && isShrink;
  const docsMissing = needsDocs && !(hasReason && hasNote);

  if (docsMissing) {
    messages.push(
      `${formatCents(absCents)} of product is missing and there is no explanation attached. In Washington an ` +
        `inventory reduction that is not properly documented is treated as a SALE and taxed at 37% — so an ` +
        `unexplained ${formatCents(absCents)} shortage can cost you the excise on top of the product itself. ` +
        `Pick a reason and write one honest sentence about what happened.`,
    );
    authorityIds.push("WAC_314_55_089_4_C_DEEMED_SALES", "WAC_314_55_089_4_A_MONTHLY_LOST");
  }

  if (isMaterial && !docsMissing) {
    messages.push(
      isShrink
        ? `${formatCents(absCents)} short, documented. This will be drafted as a shrink adjustment for your approval.`
        : `${formatCents(absCents)} MORE on the shelf than the books said. Found product is not free money — ` +
          `it usually means an earlier receipt or sale was recorded wrong, and it is worth knowing which.`,
    );
    authorityIds.push("REG_1_471_2_D_VERIFY_BY_COUNT");
  }

  if (!isMaterial) {
    messages.push(
      `Off by ${formatCents(absCents)}, which is under your ${formatCents(policy.absCents)} threshold. ` +
        `It still gets corrected and it is still on the record — small does not mean invisible.`,
    );
  }

  return {
    lotId: lot.lotId,
    status: isMaterial ? "material" : "immaterial",
    varianceQty,
    varianceCents,
    systemValueCents,
    isMaterial,
    requiresRecount: false,
    requiresDocumentation: needsDocs,
    blocksPosting: docsMissing,
    effectiveCountedQty: effective,
    messages,
    authorityIds,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 8) THE MERGE-SIGNATURE DETECTOR — defence (c)
// ═══════════════════════════════════════════════════════════════════════════

export type MergeSignature = {
  productKey: string;
  productName: string | null;
  /** The lot that absorbed everybody else's units. */
  absorbingLotId: string;
  /** Lots counted at zero that the system believed were stocked. */
  zeroedLotIds: string[];
  /** How far the group as a whole is off, in units. Near zero is the tell. */
  groupVarianceQty: number;
  message: string;
  authorityIds: string[];
};

/**
 * Look for the fingerprint of Michael's historical failure.
 *
 * THE PATTERN, precisely:
 *   - a product has two or more lots that the system believes are stocked;
 *   - exactly ONE of them is counted materially ABOVE its own system quantity;
 *   - one or more siblings that should have stock are counted at ZERO;
 *   - and the GROUP total lands close to right.
 *
 * That last condition is what makes this worth writing. Any per-line check
 * passes: every line has a number in it, the group foots, the session looks
 * finished. The books are still wrong, because three lots became one. Only a
 * check that looks ACROSS lines within a product can see it.
 *
 * Note the deliberate asymmetry: a sibling genuinely selling out is normal and
 * common. What is NOT normal is a sibling reading zero at the same moment
 * another lot of the same product reads well over its own system quantity by
 * roughly the amount the siblings lost. We require BOTH halves before crying
 * wolf, because a detector that fires on ordinary sell-through gets ignored,
 * and an ignored detector is worse than none.
 */
export function detectLotMergeSignature(
  lots: readonly AuditLot[],
  lines: readonly AuditCountLine[],
  opts: { groupTolerancePct?: number } = {},
): MergeSignature[] {
  const tolerancePct = opts.groupTolerancePct ?? 5; // percent of group system qty
  const lineByLot = new Map(lines.map((l) => [l.lotId, l]));
  const out: MergeSignature[] = [];

  for (const [productKey, arr] of groupLotsByProduct(lots)) {
    if (arr.length < 2) continue;

    const rows = arr
      .map((lot) => ({ lot, line: lineByLot.get(lot.lotId) }))
      .filter((r): r is { lot: AuditLot; line: AuditCountLine } => r.line !== undefined);
    if (rows.length < 2) continue;
    // Every line must be filled in; an uncounted line is caught by assessLine
    // and is a different (louder, simpler) problem.
    if (rows.some((r) => r.line.countedQty === null)) continue;

    const stocked = rows.filter((r) => r.line.systemQty > 0);
    if (stocked.length < 2) continue;

    const over = stocked.filter((r) => (r.line.countedQty as number) > r.line.systemQty);
    if (over.length !== 1) continue;

    const zeroed = stocked.filter(
      (r) => r.line.countedQty === 0 && r.line.systemQty > 0 && r.lot.lotId !== over[0].lot.lotId,
    );
    if (zeroed.length === 0) continue;

    const groupSystem = rows.reduce((s, r) => s + r.line.systemQty, 0);
    const groupCounted = rows.reduce((s, r) => s + (r.line.countedQty as number), 0);
    const groupVariance = groupCounted - groupSystem;
    const tolerance = (groupSystem * tolerancePct) / 100;
    if (Math.abs(groupVariance) > tolerance) continue;

    // The absorbing lot must have gained roughly what the zeroed siblings lost.
    // Without this the check would fire on unrelated coincidences.
    const gained = (over[0].line.countedQty as number) - over[0].line.systemQty;
    const lost = zeroed.reduce((s, r) => s + r.line.systemQty, 0);
    if (lost <= 0) continue;
    if (gained < lost * 0.5) continue;

    const absorbCode = over[0].lot.lotCode ?? over[0].lot.lotId;
    out.push({
      productKey,
      productName: over[0].lot.productName,
      absorbingLotId: over[0].lot.lotId,
      zeroedLotIds: zeroed.map((r) => r.lot.lotId),
      groupVarianceQty: groupVariance,
      message:
        `STOP. This looks like the lot-code mistake that broke the books before. On ` +
        `${over[0].lot.productName ?? productKey}, lot ${absorbCode} was counted ${gained} units ABOVE what ` +
        `the system had, while ${zeroed.length} other lot${zeroed.length === 1 ? "" : "s"} of the same ` +
        `product that should have had stock came back as zero — and the group total still adds up. ` +
        `That is the exact fingerprint of counting the whole shelf against the first lot code you read. ` +
        `Go back and scan each package individually. Two jars of the same product are usually NOT the same lot.`,
      authorityIds: ["REG_1_471_2_F_3_OMITTING_STOCK", "REG_1_471_2_E_BURDEN_OF_PROOF"],
    });
  }

  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// 9) SESSION READINESS
// ═══════════════════════════════════════════════════════════════════════════

export type SessionReadiness = {
  totalLines: number;
  counted: number;
  uncounted: number;
  clean: number;
  material: number;
  needingRecount: number;
  blocked: number;
  netVarianceCents: number | null;
  /** Sum of |variance|. The honest measure — offsets must not cancel out. */
  grossVarianceCents: number | null;
  mergeSignatures: MergeSignature[];
  canPost: boolean;
  blockers: string[];
  summary: string;
};

export function readinessOf(
  lots: readonly AuditLot[],
  lines: readonly AuditCountLine[],
  policy: MaterialityPolicy = DEFAULT_MATERIALITY,
): SessionReadiness {
  const lotById = new Map(lots.map((l) => [l.lotId, l]));
  const blockers: string[] = [];
  let counted = 0, uncounted = 0, clean = 0, material = 0, needingRecount = 0, blocked = 0;
  let net: number | null = 0;
  let gross: number | null = 0;

  for (const line of lines) {
    const lot = lotById.get(line.lotId);
    if (!lot) {
      blockers.push(`Line references lot ${line.lotId}, which is not in this session's scope.`);
      blocked += 1;
      continue;
    }
    const a = assessLine(lot, line, policy);
    if (a.status === "uncounted") uncounted += 1; else counted += 1;
    if (a.status === "clean") clean += 1;
    if (a.isMaterial) material += 1;
    if (a.requiresRecount) needingRecount += 1;
    if (a.blocksPosting) blocked += 1;

    if (a.varianceCents === null) { net = null; gross = null; }
    else {
      if (net !== null) net += a.varianceCents;
      if (gross !== null) gross += Math.abs(a.varianceCents);
    }
  }

  const merges = detectLotMergeSignature(lots, lines);

  // ── THE MISSING-LINE HOLE ────────────────────────────────────────────
  // A real defect, found by the mirror suite. The loop above walks the LINES, so
  // it can only ever notice a lot that somebody started. A lot that is in scope
  // and has NO LINE AT ALL was invisible: the session reported "nothing is
  // blocking — this is ready for you to approve" while an entire lot had never
  // been looked at.
  //
  // That is the exact failure §1.471-2(f)(3) names — omitting portions of the
  // stock on hand — and it is more dangerous than a blank line, because a blank
  // line at least APPEARS on the counter's screen. A missing line appears
  // nowhere. Scope said count it, nobody did, and the books would have closed
  // over the gap.
  //
  // A lot in scope with no line is therefore counted as uncounted and blocks the
  // session, exactly like a blank one.
  const lineLotIds = new Set(lines.map((l) => l.lotId));
  const missingLots = lots.filter((l) => !lineLotIds.has(l.lotId));
  if (missingLots.length > 0) {
    uncounted += missingLots.length;
    blocked += missingLots.length;
    const shown = missingLots.slice(0, 5).map((l) => l.lotCode ?? l.lotId).join(", ");
    blockers.push(
      `${missingLots.length} lot${missingLots.length === 1 ? "" : "s"} in this session ` +
        `${missingLots.length === 1 ? "has" : "have"} no count sheet line at all ` +
        `(${shown}${missingLots.length > 5 ? ", and more" : ""}). ` +
        `Scope said to count ${missingLots.length === 1 ? "it" : "them"} and nobody did — ` +
        `stock that is left out of a count cannot be treated as stock that is not there.`,
    );
  }

  if (uncounted > 0) {
    blockers.push(
      `${uncounted} line${uncounted === 1 ? " has" : "s have"} not been counted. Blank is not zero — ` +
        `a line nobody looked at cannot be treated as an empty shelf.`,
    );
  }
  if (needingRecount > 0) {
    blockers.push(
      `${needingRecount} line${needingRecount === 1 ? " needs" : "s need"} a second blind recount before posting.`,
    );
  }
  if (merges.length > 0) {
    blockers.push(
      `${merges.length} product${merges.length === 1 ? " shows" : "s show"} the lot-consolidation pattern. ` +
        `This must be re-counted package by package before anything is posted.`,
    );
  }
  const undocumented = lines.filter((line) => {
    const lot = lotById.get(line.lotId);
    if (!lot) return false;
    const a = assessLine(lot, line, policy);
    return a.blocksPosting && (a.status === "material" || a.status === "unvalued");
  }).length;
  if (undocumented > 0) {
    blockers.push(
      `${undocumented} line${undocumented === 1 ? "" : "s"} cannot post yet — either a shrink has no ` +
        `explanation, or a lot has no cost on file.`,
    );
  }

  const canPost = blockers.length === 0 && lines.length > 0;

  // The denominator is the LOTS IN SCOPE, never the lines submitted. Reporting
  // "12 lines counted" when scope held 15 lots is how a gap hides in a summary
  // that reads like success.
  const inScope = Math.max(lots.length, lines.length);
  const summary = canPost
    ? `${inScope} lots counted, ${clean} exactly right, ${material} with a real difference. ` +
      `Net effect on the books: ${net === null ? "not calculable" : formatCents(net)}. ` +
      `Nothing is blocking — this is ready for you to approve.`
    : `${inScope} lots in scope: ${counted} counted, ${uncounted} still to do. ` +
      `${blockers.length} thing${blockers.length === 1 ? "" : "s"} must be sorted out before this can post.`;

  return {
    // Scope, not submissions. See the missing-line note above.
    totalLines: inScope,
    counted,
    uncounted,
    clean,
    material,
    needingRecount,
    blocked,
    netVarianceCents: net,
    grossVarianceCents: gross,
    mergeSignatures: merges,
    canPost,
    blockers,
    summary,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 10) THE BOOKS — closing GAP 1
// ═══════════════════════════════════════════════════════════════════════════

/**
 * THE SIGN WALL, restated because getting it wrong here is unrecoverable:
 * in `gl_journal_lines`, a POSITIVE `amountCents` is a DEBIT.
 */
export type DraftJournalLine = {
  accountCode: string;
  amountCents: number;
  memo: string;
};

export type ShrinkTreatment = "cogs" | "owner_must_decide";

export type VarianceJournalDraft = {
  /** ALWAYS "draft". This module never posts. Rule: AI output is drafts only. */
  disposition: "draft";
  entity: "greenway";
  sourceKind: "inventory";
  lines: DraftJournalLine[];
  totalDebitCents: number;
  totalCreditCents: number;
  balanced: boolean;
  treatment: ShrinkTreatment;
  explanation: string;
  warnings: string[];
  authorityIds: string[];
};

/**
 * Draft the journal entry a count variance implies.
 *
 * WHY THIS DRAFTS AND NEVER POSTS, and why the treatment is sometimes handed
 * straight back to Michael:
 *
 * A shrink write-off has to land somewhere, and in a §280E business WHERE it
 * lands is the difference between a deductible number and a nondeductible one.
 * Charging inventory shrinkage to cost of goods sold preserves it; charging it
 * to an operating expense throws it away, because §280E disallows deductions
 * for a trafficking business while COGS survives as a matter of constitutional
 * necessity. That is a large, real, recurring amount of money.
 *
 * It is also genuinely contestable. §1.471-3 defines a reseller's cost as the
 * invoice price of goods PURCHASED; product that vanished was never sold, and an
 * examiner can argue a theft or breakage loss is a §165 casualty rather than a
 * cost of goods. Normal, documented, routine shrink following a counted physical
 * inventory is the strong case. A large unexplained disappearance is the weak
 * one, and pretending otherwise on a screen would be exactly the kind of
 * confident-and-wrong that costs money later.
 *
 * So: routine documented shrink drafts to COGS with the reasoning shown, and
 * anything unusual is escalated rather than decided. The system does not get a
 * vote on Michael's tax position — it gets to show him the fork in the road with
 * both branches labelled.
 */
export function draftVarianceJournal(input: {
  inventoryAccountCode: string;
  cogsAccountCode: string;
  varianceCents: number;
  documented: boolean;
  reason: string | null;
  lotLabel: string;
}): VarianceJournalDraft {
  const { inventoryAccountCode, cogsAccountCode, varianceCents, documented, reason, lotLabel } = input;

  if (!Number.isInteger(varianceCents)) {
    throw new Error("draftVarianceJournal: varianceCents must be an integer number of cents");
  }
  if (varianceCents === 0) {
    return {
      disposition: "draft",
      entity: "greenway",
      sourceKind: "inventory",
      lines: [],
      totalDebitCents: 0,
      totalCreditCents: 0,
      balanced: true,
      treatment: "cogs",
      explanation: "No difference, so there is nothing for the books to record.",
      warnings: [],
      authorityIds: [],
    };
  }

  const warnings: string[] = [];
  const authorityIds: string[] = ["REG_1_471_2_D_VERIFY_BY_COUNT", "REG_1_471_3_B_RESELLER_COST"];
  const isShrink = varianceCents < 0;

  let treatment: ShrinkTreatment = "cogs";
  if (isShrink && !documented) {
    treatment = "owner_must_decide";
    warnings.push(
      "This shortage has no documented reason. Washington treats an undocumented inventory reduction as a " +
        "SALE and assesses the 37% excise on it, so this cannot be written off quietly. It needs your decision " +
        "and an explanation before it goes anywhere.",
    );
    authorityIds.push("WAC_314_55_089_4_C_DEEMED_SALES");
  }

  // Shrink: inventory falls (CREDIT, negative), cost of goods rises (DEBIT).
  // Overage: the exact mirror.
  const lines: DraftJournalLine[] = isShrink
    ? [
        {
          accountCode: cogsAccountCode,
          amountCents: -varianceCents,
          memo: `Count shrink — ${lotLabel}${reason ? ` (${reason})` : ""}`,
        },
        {
          accountCode: inventoryAccountCode,
          amountCents: varianceCents,
          memo: `Count shrink — ${lotLabel}`,
        },
      ]
    : [
        {
          accountCode: inventoryAccountCode,
          amountCents: varianceCents,
          memo: `Count overage — ${lotLabel}`,
        },
        {
          accountCode: cogsAccountCode,
          amountCents: -varianceCents,
          memo: `Count overage — ${lotLabel}${reason ? ` (${reason})` : ""}`,
        },
      ];

  const totalDebitCents = lines.filter((l) => l.amountCents > 0).reduce((s, l) => s + l.amountCents, 0);
  const totalCreditCents = lines.filter((l) => l.amountCents < 0).reduce((s, l) => s - l.amountCents, 0);

  if (!isShrink) {
    warnings.push(
      "Found MORE than the books said. That is not a windfall — extra product on the shelf almost always " +
        "means a delivery or a sale was recorded wrong earlier, and that earlier mistake is still in your " +
        "numbers somewhere.",
    );
  }

  const explanation = isShrink
    ? `${formatCents(-varianceCents)} of product that the books say you own was not on the shelf. The books ` +
      `now come down to match what was actually counted, and the cost moves into cost of goods sold. ` +
      `Cost of goods sold is the account that survives §280E, which is why it matters that this is treated ` +
      `as product cost and not as a general expense — and why it needs to be documented well enough to defend.`
    : `${formatCents(varianceCents)} more product was on the shelf than the books showed. Inventory goes up ` +
      `and cost of goods sold comes back down by the same amount.`;

  return {
    disposition: "draft",
    entity: "greenway",
    sourceKind: "inventory",
    lines,
    totalDebitCents,
    totalCreditCents,
    balanced: totalDebitCents === totalCreditCents,
    treatment,
    explanation,
    warnings,
    authorityIds,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 11) THE STAFF CHECKLIST
//
// Michael: "formatted in a way that my stoner employees can follow. They need
// their hands held far more than mine, you are going to need to carry them."
//
// So: one instruction per step, present tense, no accounting words at all, and
// the multi-lot warning stated in physical terms — jars on a shelf, not lot
// identifiers in a database.
// ═══════════════════════════════════════════════════════════════════════════

export type ChecklistStep = {
  n: number;
  title: string;
  detail: string;
  /** True when getting this step wrong is what caused the historical failure. */
  critical: boolean;
};

export function buildCountChecklist(group: AuditPlanGroup): ChecklistStep[] {
  const steps: ChecklistStep[] = [];
  let n = 1;
  const name = group.productName ?? group.productKey;

  steps.push({
    n: n++,
    title: `Find every package of ${name}`,
    detail:
      "Bring them all to one spot before you scan anything. Check the shelf, the back stock, the display " +
      "case, and anywhere a package could have been set down. If you find some later, that is fine — " +
      "just scan them too.",
    critical: false,
  });

  if (group.isMultiLot) {
    steps.push({
      n: n++,
      title: `There are ${group.lots.length} different batches of this product`,
      detail:
        "This is the important one. Two packages of the same product are often from different batches, and " +
        "they look identical from the outside. You cannot tell by looking. Do not read one label and assume " +
        "the rest match it — that is exactly what went wrong before and it is why this list exists.",
      critical: true,
    });
  }

  steps.push({
    n: n++,
    title: "Scan every single package, one at a time",
    detail:
      "Every package gets its own scan. Not one scan for the pile. Pick it up, scan it, put it in a " +
      "different pile so you know it is done. The screen will tell you which batch it belongs to and add " +
      "one to that batch's count.",
    critical: true,
  });

  steps.push({
    n: n++,
    title: "Do not type a number if you can scan it",
    detail:
      "Typing is where mistakes come from. Only type a count if a barcode will not read, and if that " +
      "happens, tell a manager so the label can be fixed.",
    critical: false,
  });

  steps.push({
    n: n++,
    title: "If a batch has none left, leave it at zero — do not skip it",
    detail:
      "A batch showing zero because you looked and there were none is useful information. A batch left " +
      "blank because you did not get to it is a problem. The screen will not let you finish while anything " +
      "is still blank.",
    critical: true,
  });

  steps.push({
    n: n++,
    title: "If something looks wrong, say so in the box",
    detail:
      "Broken jar, water damage, something in the wrong place, a package you cannot find — write it down " +
      "in plain words. One sentence is enough. This is not you getting in trouble; an explanation written " +
      "down at the time is worth real money to the shop later.",
    critical: true,
  });

  steps.push({
    n: n++,
    title: "Press Done and walk away",
    detail:
      "You are finished. You do not decide anything about the numbers and nothing you enter changes the " +
      "books on its own. Michael reviews it and approves it.",
    critical: false,
  });

  return steps;
}

// ═══════════════════════════════════════════════════════════════════════════
// 12) AUTHORITY RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════

export function resolveAuditAuthorities(ids: readonly string[]): GuidanceAuthority[] {
  const out: GuidanceAuthority[] = [];
  for (const id of ids) {
    const a = findGuidanceAuthority(id);
    if (a) out.push(a);
  }
  return out;
}

/** Every authority id this module is entitled to cite. */
export function permittedAuthorityIds(): string[] {
  return [...INVENTORY_AUDIT_AUTHORITY_IDS, ...INVENTORY_AUDIT_BORROWED_AUTHORITY_IDS];
}

assertCadencePolicySound();

// ═══════════════════════════════════════════════════════════════════════════
// 13) SELF-TESTS
//
// Rule 15: every test must be proven capable of failing. These are written to
// be MUTATION-KILLED — each one targets a specific behaviour such that breaking
// that behaviour breaks this test and nothing else has to notice.
// ═══════════════════════════════════════════════════════════════════════════

function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`inventory-audit-core self-test FAILED: ${msg}`);
}
function eq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `inventory-audit-core self-test FAILED: ${msg} (expected ${String(expected)}, got ${String(actual)})`,
    );
  }
}

/** Test-fixture helper. Every field explicit so tests read as facts. */
function lot(over: Partial<AuditLot> & { lotId: string }): AuditLot {
  return {
    lotCode: `LC-${over.lotId}`,
    posProductKey: "P1",
    productName: "Test Product",
    categorySlug: "flower",
    vendorId: "V1",
    vendorName: "Test Vendor",
    onHandQty: 10,
    unitCostMinorUnits: 1_000,
    lastCountedAt: null,
    priorVarianceCount: 0,
    status: "active",
    ...over,
  };
}
function line(over: Partial<AuditCountLine> & { lotId: string }): AuditCountLine {
  return {
    systemQty: 10,
    countedQty: null,
    recountQty: null,
    reason: null,
    note: null,
    ...over,
  };
}

export function __runInventoryAuditCoreTests(): void {
  const NOW = new Date("2026-08-19T12:00:00.000Z");

  // ─── money ──────────────────────────────────────────────────────────────
  {
    eq(extendCostCents(3, 1_250), 3_750, "whole quantity extends exactly");
    eq(extendCostCents(3.5, 1_000), 3_500, "fractional grams extend");
    eq(extendCostCents(0, 999), 0, "zero quantity is zero money");

    // Rounding is HALF AWAY FROM ZERO and must be symmetric. If it were
    // half-up, -0.5c would round to 0 while +0.5c rounds to 1, quietly biasing
    // every shrink downward.
    eq(extendCostCents(0.005, 100), 1, "half a cent up rounds away from zero");
    eq(extendCostCents(-0.005, 100), -1, "half a cent down rounds away from zero");
    eq(
      extendCostCents(-0.005, 100),
      -extendCostCents(0.005, 100),
      "rounding is symmetric — a loss and a gain of equal size round equally",
    );

    let threw = false;
    try { extendCostCents(1, 10.5); } catch { threw = true; }
    ok(threw, "a non-integer unit cost is rejected rather than silently rounded");

    eq(formatCents(123_456), "$1,234.56", "formats with thousands separator");
    eq(formatCents(-500), "-$5.00", "formats negatives");
    eq(formatCents(5), "$0.05", "pads the cents");
  }

  // ─── ABC stratification ─────────────────────────────────────────────────
  {
    const lots = [
      lot({ lotId: "big",   onHandQty: 100, unitCostMinorUnits: 10_000 }), // $10,000
      lot({ lotId: "mid",   onHandQty: 10,  unitCostMinorUnits: 10_000 }), // $1,000
      lot({ lotId: "small", onHandQty: 1,   unitCostMinorUnits: 10_000 }), // $100
      lot({ lotId: "nocost", unitCostMinorUnits: null }),
    ];
    const s = stratifyLots(lots);
    const by = new Map(s.map((x) => [x.lot.lotId, x]));
    eq(by.get("big")!.abc, "A", "the lot holding most of the money is class A");
    eq(by.get("small")!.abc, "C", "the long tail is class C");
    eq(by.get("nocost")!.abc, "U", "a lot with no cost is UNVALUED, not cheap");
    eq(by.get("nocost")!.extendedCostCents, null, "an unvalued lot has no value, not zero value");
    eq(by.get("big")!.extendedCostCents, 1_000_000, "extended value is qty x unit cost");

    // Descending order is what makes the Pareto meaningful.
    ok(
      s[0].lot.lotId === "big",
      "stratification sorts by money descending so the cumulative curve means something",
    );

    // ── REGRESSION: THE DOMINANT-LOT TRAP ───────────────────────────────
    // A real bug caught by this suite on its first run. Classifying on the
    // cumulative share AFTER adding the lot meant a lot holding 100% of the
    // money scored 100% and was labelled C — the long tail — and dropped to the
    // slowest cadence in the system. The single most valuable thing in the
    // building would have been the least-counted thing in the building. These
    // two cases pin the boundary rule permanently.
    {
      const solo = stratifyLots([lot({ lotId: "only", onHandQty: 5, unitCostMinorUnits: 100_000 })]);
      eq(solo[0].abc, "A", "a lot that is 100% of inventory value is class A, never the tail");
      eq(solo[0].cumulativeMilliPct, 100_000, "its reported cumulative share is still an honest 100%");
    }
    {
      // 90% / 10% split: the 90% lot crosses the 80% cutoff, so it IS the A class.
      const two = stratifyLots([
        lot({ lotId: "dominant", onHandQty: 90, unitCostMinorUnits: 1_000 }),
        lot({ lotId: "rest", onHandQty: 10, unitCostMinorUnits: 1_000 }),
      ]);
      const m = new Map(two.map((x) => [x.lot.lotId, x.abc]));
      eq(m.get("dominant"), "A", "the lot that crosses the 80% line is inside A, not past it");
      ok(m.get("rest") !== "A", "the remainder after the cutoff is not also class A");
    }
  }

  // ─── BLIND SPOTS FOUND BY THE MUTATION CAMPAIGN ───────────────────────
  // Both defects below were killed by the mirror vitest suite but SURVIVED here.
  // A gate that misses what the other catches is half a gate, so they are pinned
  // in both places now.
  {
    // Determinism: equal-value lots must not swap places between runs.
    const build = () =>
      stratifyLots([
        lot({ lotId: "zzz", posProductKey: "Z", onHandQty: 10, unitCostMinorUnits: 1_000 }),
        lot({ lotId: "aaa", posProductKey: "A", onHandQty: 10, unitCostMinorUnits: 1_000 }),
        lot({ lotId: "mmm", posProductKey: "M", onHandQty: 10, unitCostMinorUnits: 1_000 }),
      ])
        .map((x) => x.lot.lotId)
        .join(",");
    eq(build(), "aaa,mmm,zzz", "ties break on lotId so the same inventory always sorts the same way");
    eq(build(), build(), "the ordering is stable across runs");
  }
  {
    // A detected merge must BLOCK, not merely warn. Detecting the owner's
    // historical failure and then allowing the post is worse than not detecting
    // it, because it looks like the control worked.
    const mLots = [
      lot({ lotId: "s1", posProductKey: "G", onHandQty: 10 }),
      lot({ lotId: "s2", posProductKey: "G", onHandQty: 10 }),
      lot({ lotId: "s3", posProductKey: "G", onHandQty: 10 }),
    ];
    const merged = readinessOf(mLots, [
      line({ lotId: "s1", systemQty: 10, countedQty: 30 }),
      line({ lotId: "s2", systemQty: 10, countedQty: 0 }),
      line({ lotId: "s3", systemQty: 10, countedQty: 0 }),
    ]);
    ok(merged.mergeSignatures.length > 0, "the consolidation pattern is detected");
    ok(!merged.canPost, "and detecting it STOPS the session rather than noting it");
    // ASSERT THE SPECIFIC BLOCKER, not merely that something blocked. The large
    // variances in this fixture ALSO trip the undocumented-shrink blocker, so
    // `!canPost` alone would stay true even if the merge stopped blocking — and
    // a mutation campaign proved exactly that, surviving here while dying in the
    // mirror suite. The failure must be attributed to the right control.
    ok(
      merged.blockers.some((b) => /consolidat/i.test(b)),
      "a blocker explicitly names the lot-consolidation pattern, not just some other problem",
    );

    // NEGATIVE CONTROL: the same lots counted honestly post fine, so the block
    // above is caused by the merge and not by the shape of the fixture.
    const honest = readinessOf(mLots, [
      line({ lotId: "s1", systemQty: 10, countedQty: 10 }),
      line({ lotId: "s2", systemQty: 10, countedQty: 10 }),
      line({ lotId: "s3", systemQty: 10, countedQty: 10 }),
    ]);
    eq(honest.mergeSignatures.length, 0, "an honest count shows no merge signature");
    ok(honest.canPost, "and an honest, complete, clean session can post");
  }

  // ─── REGRESSION: A LOT IN SCOPE WITH NO LINE AT ALL ─────────────────────
  // Found by the mirror vitest suite, NOT by this file — which is precisely why
  // two gates exist. `readinessOf` walked the submitted lines, so a lot that was
  // in scope and never started was invisible, and the session reported itself
  // ready to approve with an entire lot uncounted. That is §1.471-2(f)(3)
  // "omitting portions of the stock on hand", and it is worse than a blank line
  // because a blank line at least shows up on the counter's screen.
  {
    const lots = [
      lot({ lotId: "seen",   posProductKey: "PA" }),
      lot({ lotId: "forgot", posProductKey: "PB" }),
    ];
    const lines = [line({ lotId: "seen", systemQty: 10, countedQty: 10 })];

    const r = readinessOf(lots, lines);
    ok(!r.canPost, "a lot with no count line at all blocks the session");
    eq(r.uncounted, 1, "the forgotten lot is counted as uncounted, not ignored");
    eq(r.totalLines, 2, "the denominator is the lots in SCOPE, not the lines submitted");
    ok(
      r.blockers.some((b) => /no count sheet line/i.test(b)),
      "the blocker says plainly that a lot was never started",
    );
    ok(
      !/ready for you to approve/i.test(r.summary),
      "a session with an untouched lot must never read as ready to approve",
    );

    // NEGATIVE CONTROL: once every lot has a line, the complaint disappears.
    const complete = readinessOf(lots, [
      ...lines,
      line({ lotId: "forgot", systemQty: 10, countedQty: 10 }),
    ]);
    ok(
      !complete.blockers.some((b) => /no count sheet line/i.test(b)),
      "the missing-line blocker does NOT fire when every lot has a line",
    );
    ok(complete.canPost, "a fully counted, clean session can post");
  }

  // ─── the cadence policy is structurally sound ──────────────────────────
  {
    assertCadencePolicySound(); // must not throw for the shipped policy

    // PROVE THE GUARD CAN FIRE. Without this, disabling the check entirely
    // would change nothing observable — a mutation campaign demonstrated
    // exactly that. A guard that cannot be shown to fire is not a guard.
    let cadenceThrew = false;
    try { assertCadencePolicySound({ A: 30, B: 60, C: 400, U: 14 }); } catch { cadenceThrew = true; }
    ok(cadenceThrew, "a cadence longer than a year is REJECTED, not just documented as forbidden");

    let zeroThrew = false;
    try { assertCadencePolicySound({ A: 0 }); } catch { zeroThrew = true; }
    ok(zeroThrew, "a zero-day cadence is rejected as nonsense rather than accepted");

    let fracThrew = false;
    try { assertCadencePolicySound({ A: 30.5 }); } catch { fracThrew = true; }
    ok(fracThrew, "a fractional cadence is rejected");

    // NEGATIVE CONTROL: a sound custom policy must NOT throw, so the checks
    // above are detecting unsoundness rather than rejecting everything.
    let soundThrew = false;
    try { assertCadencePolicySound({ A: 30, B: 60, C: 365, U: 7 }); } catch { soundThrew = true; }
    ok(!soundThrew, "a sound policy passes — the guard is selective, not indiscriminate");
    for (const [cls, days] of Object.entries(CADENCE_DAYS)) {
      ok(
        days <= MAX_PERMITTED_CADENCE_DAYS,
        `cadence for ${cls} stays inside a year, as AS 2510.11 requires`,
      );
    }
    ok(
      CADENCE_DAYS.U <= CADENCE_DAYS.A,
      "an unvalued lot is looked at at least as often as a high-value one — an unknown value is not a small one",
    );
    ok(CADENCE_DAYS.A < CADENCE_DAYS.C, "expensive stock is counted more often than cheap stock");
  }

  // ─── days since ─────────────────────────────────────────────────────────
  {
    eq(daysSince(null, NOW), null, "never counted is null, not a big number");
    eq(daysSince("2026-08-09T12:00:00.000Z", NOW), 10, "ten days is ten days");
    eq(daysSince("not a date", NOW), null, "an unparseable date is treated as unknown");
  }

  // ─── grouping: the anchor of the lot-code defence ───────────────────────
  {
    const lots = [
      lot({ lotId: "a", posProductKey: "P1" }),
      lot({ lotId: "b", posProductKey: "P1" }),
      lot({ lotId: "c", posProductKey: "P2" }),
      lot({ lotId: "d", posProductKey: null }),
      lot({ lotId: "e", posProductKey: null }),
    ];
    const g = groupLotsByProduct(lots);
    eq(g.get("P1")!.length, 2, "two lots of the same product group together");
    eq(g.get("P2")!.length, 1, "a different product is its own group");
    // Two keyless lots must NOT be grouped with each other. Doing so would
    // invent a product relationship and drag unrelated lots into scope.
    eq(g.size, 4, "lots with no product key each get their OWN group, never a shared null bucket");
  }

  // ─── risk assessment ────────────────────────────────────────────────────
  {
    const lots = [
      lot({ lotId: "never", lastCountedAt: null, posProductKey: "SOLO1" }),
      lot({ lotId: "fresh", lastCountedAt: "2026-08-18T12:00:00.000Z", posProductKey: "SOLO2" }),
    ];
    const r = assessRisk(lots, NOW);
    const byId = new Map(r.map((x) => [x.lot.lotId, x]));
    ok(byId.get("never")!.reasons.includes("never_counted"), "an uncounted lot is flagged as never counted");
    ok(byId.get("never")!.isOverdue, "never counted is always overdue");
    ok(!byId.get("fresh")!.isOverdue, "a lot counted yesterday is not overdue");
    ok(
      byId.get("never")!.score > byId.get("fresh")!.score,
      "the never-counted lot outranks the freshly counted one",
    );
    eq(r[0].lot.lotId, "never", "risk output is sorted worst-first");

    // multi-lot must be detected as a risk in its own right
    const multi = assessRisk(
      [lot({ lotId: "m1", posProductKey: "PX" }), lot({ lotId: "m2", posProductKey: "PX" })],
      NOW,
    );
    ok(
      multi.every((x) => x.reasons.includes("multi_lot_product")),
      "every lot of a multi-lot product is flagged as such",
    );

    // the overdue bonus must not swamp categorical risk
    const ancient = lot({
      lotId: "ancient",
      posProductKey: "SOLO3",
      lastCountedAt: "2019-01-01T00:00:00.000Z",
    });
    const scored = assessRisk([ancient], NOW)[0];
    ok(
      scored.score <= RISK_WEIGHTS.overdue + RISK_WEIGHTS.high_value + RISK_WEIGHTS.missing_lot_code + 60 + 200,
      "the age bonus is capped so a very old lot cannot outrank every categorical risk",
    );
  }

  // ─── THE PLAN: group cohesion is non-negotiable ─────────────────────────
  {
    // Three lots of one product, one lot of another. Budget of 2 lots.
    // The three-lot product must NEVER be split.
    const lots = [
      lot({ lotId: "x1", posProductKey: "BIG", productName: "Big Product", priorVarianceCount: 3 }),
      lot({ lotId: "x2", posProductKey: "BIG", productName: "Big Product" }),
      lot({ lotId: "x3", posProductKey: "BIG", productName: "Big Product" }),
      lot({ lotId: "y1", posProductKey: "SMALL", productName: "Small Product" }),
    ];
    const plan = buildAuditPlan(lots, NOW, { maxLots: 2 });
    const bigGroup = plan.groups.find((g) => g.productKey === "BIG");
    ok(bigGroup !== undefined, "the highest-risk group is selected");
    eq(bigGroup!.lots.length, 3, "ALL THREE lots of the product are in scope — the group is never split");
    ok(plan.budgetOverriddenForCohesion, "busting the budget for cohesion is recorded honestly, not hidden");
    ok(
      plan.notes.some((n) => n.toLowerCase().includes("multi") || n.toLowerCase().includes("more than one open lot")),
      "the plan warns in words about multi-lot products",
    );
    eq(plan.multiLotGroupCount, 1, "the multi-lot group is counted");

    // deferral is reported, never silently dropped
    const many = [
      lot({ lotId: "p1", posProductKey: "A1", priorVarianceCount: 5 }),
      lot({ lotId: "p2", posProductKey: "A2" }),
      lot({ lotId: "p3", posProductKey: "A3" }),
    ];
    const small = buildAuditPlan(many, NOW, { maxLots: 1 });
    eq(small.lotCount, 1, "the budget is respected when cohesion does not require breaking it");
    eq(small.deferredGroups, 2, "groups that did not fit are counted as deferred, not forgotten");
    ok(
      small.notes.some((n) => n.includes("did not fit")),
      "the plan says out loud that some products were deferred",
    );

    // nothing due => empty plan with an honest explanation, not an error
    const fresh = [lot({ lotId: "f1", posProductKey: "F", lastCountedAt: "2026-08-18T12:00:00.000Z" })];
    const none = buildAuditPlan(fresh, NOW, { maxLots: 10 });
    eq(none.groups.length, 0, "nothing due yields an empty plan");
    ok(none.notes.some((n) => n.includes("Nothing is due")), "an empty plan explains itself");

    // includeOnlyDue:false must actually include not-yet-due lots
    const all = buildAuditPlan(fresh, NOW, { maxLots: 10, includeOnlyDue: false });
    eq(all.groups.length, 1, "includeOnlyDue:false includes lots that are not yet due");

    let threw = false;
    try { buildAuditPlan(lots, NOW, { maxLots: 0 }); } catch { threw = true; }
    ok(threw, "a nonsensical budget is rejected");

    // A group where ONE lot is due drags its siblings in.
    const mixed = [
      lot({ lotId: "d1", posProductKey: "MIX", lastCountedAt: null }),
      lot({ lotId: "d2", posProductKey: "MIX", lastCountedAt: "2026-08-18T12:00:00.000Z" }),
    ];
    const mixPlan = buildAuditPlan(mixed, NOW, { maxLots: 10 });
    eq(mixPlan.groups.length, 1, "the group is selected because one member is due");
    eq(
      mixPlan.groups[0].lots.length,
      2,
      "the sibling that is NOT due is pulled in anyway — counting two of three lots is the trap",
    );
  }

  // ─── coverage: the AS 2510.11 self-check ────────────────────────────────
  {
    const good = [
      lot({ lotId: "g1", posProductKey: "G1", lastCountedAt: "2026-08-01T12:00:00.000Z" }),
      lot({ lotId: "g2", posProductKey: "G2", lastCountedAt: "2026-07-01T12:00:00.000Z" }),
    ];
    const cov = buildCoverageReport(good, NOW);
    ok(cov.meetsAnnualStandard, "everything counted inside a year meets the standard");
    eq(cov.beyondOneYear, 0, "nothing is beyond a year");
    eq(cov.neverCounted, 0, "everything has been counted at least once");

    const bad = [
      lot({ lotId: "b1", posProductKey: "B1", lastCountedAt: null }),
      lot({ lotId: "b2", posProductKey: "B2", lastCountedAt: "2024-01-01T12:00:00.000Z" }),
    ];
    const cov2 = buildCoverageReport(bad, NOW);
    ok(!cov2.meetsAnnualStandard, "a lot untouched for over a year breaks the annual standard");
    eq(cov2.neverCounted, 1, "the never-counted lot is identified");
    eq(cov2.beyondOneYear, 2, "both the never-counted and the ancient lot are beyond a year");
    eq(cov2.staleLotIds.length, 2, "stale lots are named so they can be acted on");

    // AS 1105.27: the verdict must NOT CLAIM shop-wide accuracy.
    //
    // Note the shape of this check. It does not ban the word "accurate", because
    // the verdict deliberately USES that word to disclaim it — "this measures how
    // much you have REACHED, not how accurate the shop is". Banning the word
    // outright would delete the one sentence that teaches the distinction. What
    // must never appear is accuracy asserted AS A RESULT: "is accurate",
    // "97% accurate", "accuracy rate". Those are projections from a judgmental
    // sample onto a whole population, which is exactly what AS 1105.27 forbids.
    for (const v of [cov.verdict, cov2.verdict]) {
      ok(
        !/\b(?:is|are|was|were|looks|seems|\d+(?:\.\d+)?%)\s+accurate\b/i.test(v),
        "the coverage verdict never asserts the shop IS accurate — AS 1105.27 forbids projecting a targeted count",
      );
      ok(
        !/\baccuracy\s+(?:rate|score|percentage|level)\b/i.test(v),
        "the coverage verdict never reports an accuracy rate, which a targeted count cannot support",
      );
    }
    // ...and the honest distinction must actually be taught, not merely not-violated.
    ok(
      /not how accurate/i.test(cov.verdict),
      "the passing verdict explicitly tells the reader coverage is not accuracy",
    );
    ok(
      cov.verdict.toLowerCase().includes("reached") || cov.verdict.toLowerCase().includes("coverage"),
      "the coverage verdict talks about what was REACHED, which is all it can honestly claim",
    );
  }

  // ─── line assessment: NULL IS NOT ZERO ──────────────────────────────────
  {
    const l = lot({ lotId: "u1" });
    const a = assessLine(l, line({ lotId: "u1", countedQty: null }));
    eq(a.status, "uncounted", "a blank line is UNCOUNTED");
    eq(a.varianceQty, null, "an uncounted line has no variance — not a variance of minus everything");
    ok(a.blocksPosting, "an uncounted line blocks posting");
    ok(
      a.messages.some((m) => m.toLowerCase().includes("blank is not the same as zero")),
      "the uncounted message explains the null/zero distinction in plain words",
    );

    // ...and zero IS a real count, with a real (large) variance.
    const z = assessLine(l, line({ lotId: "u1", countedQty: 0, systemQty: 10 }));
    eq(z.varianceQty, -10, "a counted zero is a real finding of minus ten");
    ok(z.status !== "uncounted", "a counted zero is NOT the same status as never counted");
  }

  // ─── line assessment: unvalued blocks, never zero-values ────────────────
  {
    const l = lot({ lotId: "nv", unitCostMinorUnits: null });
    const a = assessLine(l, line({ lotId: "nv", countedQty: 8, systemQty: 10 }));
    eq(a.status, "unvalued", "a lot with no cost is UNVALUED");
    eq(a.varianceCents, null, "an unvalued variance has NO dollar value — it is not $0.00");
    ok(a.blocksPosting, "an unvalued variance cannot post");
    eq(a.varianceQty, -2, "the unit variance is still computed and reported");
  }

  // ─── line assessment: clean, immaterial, material ───────────────────────
  {
    const l = lot({ lotId: "c1", unitCostMinorUnits: 1_000 });
    const clean = assessLine(l, line({ lotId: "c1", countedQty: 10, systemQty: 10 }));
    eq(clean.status, "clean", "an exact count is clean");
    eq(clean.varianceCents, 0, "a clean line is worth zero");
    ok(!clean.blocksPosting, "a clean line never blocks");

    // 1 unit at $10 = $10.00, below the $20 threshold and 10% of a $100 line...
    // 10% exceeds the 2% relative threshold, so this IS material by percentage.
    const rel = assessLine(l, line({ lotId: "c1", countedQty: 9, systemQty: 10 }));
    eq(rel.varianceCents, -1_000, "one missing $10 unit is a $10 variance");
    ok(rel.isMaterial, "10% of the line is material even though $10 is under the dollar threshold");

    // A cheap line: 1 unit at $1 out of 1000 units = 0.1%, under both thresholds.
    const cheap = lot({ lotId: "c2", unitCostMinorUnits: 100, onHandQty: 1000 });
    const imm = assessLine(cheap, line({ lotId: "c2", countedQty: 999, systemQty: 1000 }));
    eq(imm.status, "immaterial", "a tiny variance on a big cheap line is immaterial");
    ok(!imm.blocksPosting, "an immaterial variance does not block posting");
    ok(
      imm.messages.some((m) => m.toLowerCase().includes("small does not mean invisible")),
      "even an immaterial variance is recorded, and says so",
    );
  }

  // ─── recount discipline ─────────────────────────────────────────────────
  {
    const l = lot({ lotId: "r1", unitCostMinorUnits: 10_000, onHandQty: 100 });
    // 10 units at $100 = $1,000, way over the $50 recount threshold.
    const needs = assessLine(l, line({ lotId: "r1", countedQty: 90, systemQty: 100 }));
    eq(needs.status, "needs_recount", "a large variance demands a second blind count");
    ok(needs.blocksPosting, "a line awaiting recount cannot post");
    ok(
      needs.messages.some((m) => m.toLowerCase().includes("without looking at the first number")),
      "the recount instruction insists on blindness",
    );

    // Recount AGREES -> proceeds to normal material handling.
    const agrees = assessLine(
      l,
      line({ lotId: "r1", countedQty: 90, recountQty: 90, systemQty: 100, reason: "damage", note: "Water damage in back room." }),
    );
    eq(agrees.status, "material", "when both counts agree the line proceeds");
    ok(!agrees.blocksPosting, "a documented, twice-counted material variance can post");

    // Recount DISAGREES -> frozen, and explicitly NOT averaged.
    const disagrees = assessLine(
      l,
      line({ lotId: "r1", countedQty: 90, recountQty: 85, systemQty: 100, reason: "damage", note: "x" }),
    );
    eq(disagrees.status, "recount_disagrees", "two different counts freeze the line");
    ok(disagrees.blocksPosting, "a disputed line cannot post");
    ok(
      disagrees.messages.some((m) => m.toLowerCase().includes("do not average")),
      "the system explicitly refuses to average two disagreeing counts",
    );
    // The authoritative number is the RECOUNT, not the first guess.
    eq(disagrees.effectiveCountedQty, 85, "the recount is the authoritative number when present");
  }

  // ─── the documentation gate (WAC 314-55-089(4)(c)) ─────────────────────
  {
    const l = lot({ lotId: "d1", unitCostMinorUnits: 1_000, onHandQty: 100 });
    // 3 units at $10 = $30, material by dollars, under the $50 recount bar.
    const undoc = assessLine(l, line({ lotId: "d1", countedQty: 97, systemQty: 100 }));
    eq(undoc.status, "material", "a $30 shortage is material");
    ok(undoc.blocksPosting, "an undocumented material SHRINK is blocked");
    ok(
      undoc.messages.some((m) => m.includes("37%")),
      "the block explains the Washington deemed-sale consequence with the actual rate",
    );
    ok(
      undoc.authorityIds.includes("WAC_314_55_089_4_C_DEEMED_SALES"),
      "the block cites the Washington rule that creates the consequence",
    );

    const doc = assessLine(
      l,
      line({ lotId: "d1", countedQty: 97, systemQty: 100, reason: "damage", note: "Dropped and broken on 8/18." }),
    );
    ok(!doc.blocksPosting, "the same shortage WITH a reason and a note is allowed through");

    // Reason without note is NOT enough — a dropdown alone explains nothing.
    const half = assessLine(l, line({ lotId: "d1", countedQty: 97, systemQty: 100, reason: "damage" }));
    ok(half.blocksPosting, "a reason code with no written explanation is not adequate documentation");

    // Whitespace is not documentation.
    const blank = assessLine(
      l,
      line({ lotId: "d1", countedQty: 97, systemQty: 100, reason: "  ", note: "   " }),
    );
    ok(blank.blocksPosting, "whitespace does not count as an explanation");

    // An OVERAGE is material but is not a WAC shrink problem — it must not be
    // blocked for missing shrink documentation, but it must be questioned.
    const over = assessLine(l, line({ lotId: "d1", countedQty: 103, systemQty: 100 }));
    eq(over.status, "material", "a $30 overage is material");
    ok(!over.blocksPosting, "an overage is not blocked by the shrink documentation rule");
    ok(
      over.messages.some((m) => m.toLowerCase().includes("not free money")),
      "an overage is treated as evidence of an earlier error, not a windfall",
    );
  }

  // ─── THE MERGE SIGNATURE DETECTOR ──────────────────────────────────────
  {
    // The exact historical failure: L1 absorbs everything, L2 and L3 read zero,
    // the group total ties perfectly. Every line is filled in. Nothing else
    // would catch this.
    const lots = [
      lot({ lotId: "L1", posProductKey: "PZ", productName: "Blue Dream 3.5g", lotCode: "AAA-111" }),
      lot({ lotId: "L2", posProductKey: "PZ", productName: "Blue Dream 3.5g", lotCode: "BBB-222" }),
      lot({ lotId: "L3", posProductKey: "PZ", productName: "Blue Dream 3.5g", lotCode: "CCC-333" }),
    ];
    const lines = [
      line({ lotId: "L1", systemQty: 10, countedQty: 30 }),
      line({ lotId: "L2", systemQty: 10, countedQty: 0 }),
      line({ lotId: "L3", systemQty: 10, countedQty: 0 }),
    ];
    const sigs = detectLotMergeSignature(lots, lines);
    eq(sigs.length, 1, "the lot-consolidation fingerprint is detected");
    eq(sigs[0].absorbingLotId, "L1", "the absorbing lot is identified");
    eq(sigs[0].zeroedLotIds.length, 2, "both zeroed siblings are identified");
    eq(sigs[0].groupVarianceQty, 0, "the group ties perfectly — which is exactly why per-line checks miss it");
    ok(
      sigs[0].message.toLowerCase().includes("scan each package individually"),
      "the warning tells staff exactly what to do differently",
    );
    ok(
      sigs[0].authorityIds.includes("REG_1_471_2_F_3_OMITTING_STOCK"),
      "the warning cites the regulation that names this failure",
    );

    // NEGATIVE CONTROL 1: a genuine sell-out is NOT the fingerprint. If this
    // fired here the detector would be noise and would get ignored.
    const honest = [
      line({ lotId: "L1", systemQty: 10, countedQty: 10 }),
      line({ lotId: "L2", systemQty: 10, countedQty: 0 }),
      line({ lotId: "L3", systemQty: 10, countedQty: 10 }),
    ];
    eq(
      detectLotMergeSignature(lots, honest).length,
      0,
      "a lot that genuinely sold out does not trigger the merge warning",
    );

    // NEGATIVE CONTROL 2: a single-lot product can never show this pattern.
    const solo = [lot({ lotId: "S1", posProductKey: "SOLO" })];
    eq(
      detectLotMergeSignature(solo, [line({ lotId: "S1", systemQty: 10, countedQty: 30 })]).length,
      0,
      "a single-lot product cannot be a consolidation",
    );

    // NEGATIVE CONTROL 3: if the group does NOT tie, this is some other
    // problem and gets reported by the ordinary variance path instead.
    const wild = [
      line({ lotId: "L1", systemQty: 10, countedQty: 90 }),
      line({ lotId: "L2", systemQty: 10, countedQty: 0 }),
      line({ lotId: "L3", systemQty: 10, countedQty: 0 }),
    ];
    eq(
      detectLotMergeSignature(lots, wild).length,
      0,
      "a wildly out-of-balance group is a different problem, not a silent merge",
    );

    // NEGATIVE CONTROL 4: uncounted lines are handled elsewhere, louder.
    const partial = [
      line({ lotId: "L1", systemQty: 10, countedQty: 30 }),
      line({ lotId: "L2", systemQty: 10, countedQty: null }),
      line({ lotId: "L3", systemQty: 10, countedQty: 0 }),
    ];
    eq(
      detectLotMergeSignature(lots, partial).length,
      0,
      "an incomplete group is left to the uncounted check rather than double-reported",
    );
  }

  // ─── session readiness ──────────────────────────────────────────────────
  {
    const lots = [lot({ lotId: "A", unitCostMinorUnits: 1_000 })];

    const blank = readinessOf(lots, [line({ lotId: "A", systemQty: 10, countedQty: null })]);
    ok(!blank.canPost, "a session with a blank line cannot post");
    eq(blank.uncounted, 1, "the blank line is counted as uncounted");
    ok(blank.blockers.some((b) => b.includes("Blank is not zero")), "the blocker names the null/zero rule");

    const good = readinessOf(lots, [line({ lotId: "A", systemQty: 10, countedQty: 10 })]);
    ok(good.canPost, "a fully counted clean session can post");
    eq(good.netVarianceCents, 0, "a clean session nets to zero");
    eq(good.clean, 1, "the clean line is counted");

    // GROSS vs NET: two offsetting errors must not look like a perfect count.
    // This is the inventory version of the D8 "ties ≠ complete" lesson.
    const two = [
      lot({ lotId: "X", unitCostMinorUnits: 1_000, posProductKey: "PX1" }),
      lot({ lotId: "Y", unitCostMinorUnits: 1_000, posProductKey: "PY1" }),
    ];
    const offset = readinessOf(two, [
      line({ lotId: "X", systemQty: 10, countedQty: 5, reason: "damage", note: "broken" }),
      line({ lotId: "Y", systemQty: 10, countedQty: 15 }),
    ]);
    eq(offset.netVarianceCents, 0, "the two errors cancel to a net of zero");
    eq(
      offset.grossVarianceCents,
      10_000,
      "GROSS variance still shows $100 of error — offsetting mistakes must never look like a clean count",
    );
    ok(
      offset.grossVarianceCents! > 0 && offset.netVarianceCents === 0,
      "gross and net disagree exactly when errors offset, which is the whole point of tracking both",
    );

    // A line pointing at a lot outside scope is a blocker, not a crash.
    const orphan = readinessOf(lots, [line({ lotId: "GHOST", systemQty: 1, countedQty: 1 })]);
    ok(!orphan.canPost, "a line outside the session scope blocks the session");

    // An empty session is not "ready".
    ok(!readinessOf(lots, []).canPost, "an empty session cannot post");

    // The merge signature must surface as a session blocker, not just a note.
    const mLots = [
      lot({ lotId: "M1", posProductKey: "PM" }),
      lot({ lotId: "M2", posProductKey: "PM" }),
    ];
    const mSession = readinessOf(mLots, [
      line({ lotId: "M1", systemQty: 10, countedQty: 20 }),
      line({ lotId: "M2", systemQty: 10, countedQty: 0 }),
    ]);
    eq(mSession.mergeSignatures.length, 1, "the merge signature is surfaced on the session");
    ok(!mSession.canPost, "a session showing the lot-merge fingerprint CANNOT post");
  }

  // ─── the journal draft ──────────────────────────────────────────────────
  {
    const shrink = draftVarianceJournal({
      inventoryAccountCode: "20140",
      cogsAccountCode: "60140",
      varianceCents: -5_000,
      documented: true,
      reason: "damage",
      lotLabel: "AAA-111",
    });
    eq(shrink.disposition, "draft", "the auditor NEVER posts — it drafts");
    eq(shrink.lines.length, 2, "a shrink is two lines");
    ok(shrink.balanced, "the draft balances");
    eq(shrink.totalDebitCents, 5_000, "debits equal the variance");
    eq(shrink.totalCreditCents, 5_000, "credits equal the variance");

    // THE SIGN WALL: positive amount_cents is a DEBIT.
    const cogsLine = shrink.lines.find((l) => l.accountCode === "60140")!;
    const invLine = shrink.lines.find((l) => l.accountCode === "20140")!;
    ok(cogsLine.amountCents > 0, "shrink DEBITS cost of goods sold (positive = debit)");
    ok(invLine.amountCents < 0, "shrink CREDITS inventory (negative = credit)");
    eq(cogsLine.amountCents, 5_000, "the debit is the absolute value of the shrink");
    eq(shrink.treatment, "cogs", "documented routine shrink is treated as cost of goods sold");

    // An overage is the exact mirror.
    const over = draftVarianceJournal({
      inventoryAccountCode: "20140",
      cogsAccountCode: "60140",
      varianceCents: 5_000,
      documented: true,
      reason: null,
      lotLabel: "AAA-111",
    });
    const overInv = over.lines.find((l) => l.accountCode === "20140")!;
    ok(overInv.amountCents > 0, "an overage DEBITS inventory — the mirror of a shrink");
    ok(over.balanced, "the overage draft balances");
    ok(
      over.warnings.some((w) => w.toLowerCase().includes("not a windfall")),
      "an overage warns that it usually means an earlier error",
    );

    // Undocumented shrink is escalated, not decided.
    const undoc = draftVarianceJournal({
      inventoryAccountCode: "20140",
      cogsAccountCode: "60140",
      varianceCents: -5_000,
      documented: false,
      reason: null,
      lotLabel: "AAA-111",
    });
    eq(undoc.treatment, "owner_must_decide", "undocumented shrink is escalated to the owner, not auto-classified");
    ok(
      undoc.warnings.some((w) => w.includes("37%")),
      "the escalation states the Washington excise consequence",
    );
    ok(
      undoc.authorityIds.includes("WAC_314_55_089_4_C_DEEMED_SALES"),
      "the escalation cites the rule behind it",
    );

    // Zero is a no-op, not an empty balanced entry with phantom lines.
    const zero = draftVarianceJournal({
      inventoryAccountCode: "20140",
      cogsAccountCode: "60140",
      varianceCents: 0,
      documented: true,
      reason: null,
      lotLabel: "x",
    });
    eq(zero.lines.length, 0, "a zero variance produces NO journal lines at all");

    let threw = false;
    try {
      draftVarianceJournal({
        inventoryAccountCode: "20140",
        cogsAccountCode: "60140",
        varianceCents: 10.5,
        documented: true,
        reason: null,
        lotLabel: "x",
      });
    } catch { threw = true; }
    ok(threw, "a fractional cent amount is rejected — money is integers");
  }

  // ─── the staff checklist ────────────────────────────────────────────────
  {
    const multiGroup: AuditPlanGroup = {
      productKey: "PZ",
      productName: "Blue Dream 3.5g",
      vendorName: "V",
      lots: [],
      groupScore: 100,
      totalUnits: 30,
      totalCostCents: 30_000,
      isMultiLot: true,
      reasons: ["multi_lot_product"],
    };
    // Give it three lots so the checklist can name the number.
    multiGroup.lots = [
      { lot: lot({ lotId: "L1" }), abc: "A", extendedCostCents: 1, daysSinceCount: null, dueInDays: null, isOverdue: true, reasons: [], score: 1 },
      { lot: lot({ lotId: "L2" }), abc: "A", extendedCostCents: 1, daysSinceCount: null, dueInDays: null, isOverdue: true, reasons: [], score: 1 },
      { lot: lot({ lotId: "L3" }), abc: "A", extendedCostCents: 1, daysSinceCount: null, dueInDays: null, isOverdue: true, reasons: [], score: 1 },
    ];
    const steps = buildCountChecklist(multiGroup);
    ok(steps.length >= 6, "the checklist has enough steps to actually carry someone through");
    eq(steps[0].n, 1, "steps are numbered from one");
    steps.forEach((s, i) => eq(s.n, i + 1, "step numbers are sequential with no gaps"));

    const batchStep = steps.find((s) => s.title.includes("3 different batches"));
    ok(batchStep !== undefined, "a multi-lot product gets an explicit batch-count warning naming the number");
    ok(batchStep!.critical, "the batch warning is marked critical");
    ok(
      batchStep!.detail.toLowerCase().includes("cannot tell by looking"),
      "the batch warning explains WHY assuming is wrong, in physical terms",
    );

    ok(
      steps.some((s) => s.title.toLowerCase().includes("scan every single package")),
      "the checklist insists on scanning every package individually",
    );
    ok(
      steps.some((s) => s.title.toLowerCase().includes("leave it at zero")),
      "the checklist teaches the zero-versus-blank distinction to the people doing the counting",
    );

    // A single-lot product must NOT get the multi-batch warning — a warning
    // that appears everywhere is a warning nobody reads.
    const soloGroup: AuditPlanGroup = { ...multiGroup, isMultiLot: false, lots: [multiGroup.lots[0]] };
    const soloSteps = buildCountChecklist(soloGroup);
    ok(
      !soloSteps.some((s) => s.title.includes("different batches")),
      "a single-lot product does NOT get the multi-batch warning",
    );
    soloSteps.forEach((s, i) => eq(s.n, i + 1, "single-lot checklist is also numbered without gaps"));

    // NO ACCOUNTING VOCABULARY. Michael was explicit that staff need carrying.
    const banned = ["debit", "credit", "journal", "gaap", "accrual", "ledger", "variance", "materiality", "shrinkage"];
    for (const s of steps) {
      const text = `${s.title} ${s.detail}`.toLowerCase();
      for (const w of banned) {
        ok(!text.includes(w), `the staff checklist contains no accounting jargon (found "${w}")`);
      }
    }
  }

  // ─── authorities resolve ────────────────────────────────────────────────
  {
    for (const id of permittedAuthorityIds()) {
      ok(findGuidanceAuthority(id) !== undefined, `authority ${id} resolves in the shared registry`);
    }
    eq(
      resolveAuditAuthorities(["REG_1_471_2_F_3_OMITTING_STOCK"]).length,
      1,
      "a known authority resolves",
    );
    eq(resolveAuditAuthorities(["NOT_A_REAL_AUTHORITY"]).length, 0, "an unknown id resolves to nothing");

    // Every authority id emitted anywhere in this module must be one we are
    // entitled to cite. This is what stops a typo shipping as a dangling cite.
    const permitted = new Set(permittedAuthorityIds());
    const l = lot({ lotId: "au", unitCostMinorUnits: 1_000, onHandQty: 100 });
    const emitted = [
      assessLine(l, line({ lotId: "au", countedQty: null })),
      assessLine(l, line({ lotId: "au", countedQty: 97, systemQty: 100 })),
      assessLine(lot({ lotId: "au2", unitCostMinorUnits: null }), line({ lotId: "au2", countedQty: 1 })),
      assessLine(l, line({ lotId: "au", countedQty: 90, systemQty: 100 })),
    ];
    for (const a of emitted) {
      for (const id of a.authorityIds) {
        ok(permitted.has(id), `assessLine cites only permitted authorities (offender: ${id})`);
        ok(findGuidanceAuthority(id) !== undefined, `assessLine cites a REAL authority (${id})`);
      }
    }
    const draft = draftVarianceJournal({
      inventoryAccountCode: "20140",
      cogsAccountCode: "60140",
      varianceCents: -100,
      documented: false,
      reason: null,
      lotLabel: "x",
    });
    for (const id of draft.authorityIds) {
      ok(permitted.has(id), `the journal draft cites only permitted authorities (offender: ${id})`);
      ok(findGuidanceAuthority(id) !== undefined, `the journal draft cites a REAL authority (${id})`);
    }
  }
}
