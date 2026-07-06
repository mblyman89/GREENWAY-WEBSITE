/**
 * src/lib/compliance/sample-capacity-core.ts
 *
 * PURE sample-CAPACITY logic (no server-only imports → tsx-testable).
 *
 * Answers the owner's question: "Can we take in any more samples?" The correct
 * gate is NOT the per-processor intake cap (120/qtr each) — it's our DISTRIBUTION
 * capacity across staff, because a sample we can't give out before the calendar
 * quarter ends is wasted product.
 *
 * Controlling rule: WAC 314-55-096 (WSR 25-08-032, eff 4/26/25).
 *   • INCOMING (processor → retailer): ≤ 120 units/qtr/PROCESSOR. [096(1)(f)(ii)]
 *   • OUTGOING trade (retailer → employee): ≤ 30 units/qtr/EMPLOYEE. [096(1)(j)(vi)]
 *   • IQC (retailer → employee): ≤ 50 units/qtr/EMPLOYEE, ≤ 25 concentrate. [096(3)(c)]
 *
 * DISTRIBUTION capacity therefore scales with the number of ACTIVE employees:
 *   trade outbound capacity = activeEmployees × 30
 *   iqc   outbound capacity = activeEmployees × 50 (concentrate sub = × 25)
 *
 * This module compares proposed intake against REMAINING distribution capacity
 * and returns a traffic-light verdict. It is ADVISORY ONLY (soft warning) —
 * receiving isn't unlawful; only over-GIVING to an employee is.
 */

import { WAC_CITATION, quarterOfMonth } from "@/lib/compliance/trade-samples-core";

export { WAC_CITATION };

export type CapacityTone = "green" | "amber" | "red";

/** One capacity "lane" (trade or IQC): the aggregate outbound headroom. */
export type CapacityLane = {
  /** Total outbound capacity this quarter = activeEmployees × perEmployeeCap. */
  capacity: number;
  /** Units already distributed this quarter across all employees. */
  used: number;
  /** capacity − used (0 floor). */
  remaining: number;
  /** used / capacity (0..1+). */
  ratio: number;
  tone: CapacityTone;
};

export type SampleCapacity = {
  activeEmployees: number;
  trade: CapacityLane;
  iqc: CapacityLane;
  /** IQC concentrate sub-capacity (activeEmployees × 25). */
  iqcConcentrate: CapacityLane;
  /** Days remaining in the current calendar quarter (inclusive of today). */
  daysLeftInQuarter: number;
  /** Overall headline tone (worst of the lanes, tempered by days left). */
  tone: CapacityTone;
  /** Plain-language headline for the dashboard gauge. */
  headline: string;
};

function laneTone(remaining: number, capacity: number): CapacityTone {
  if (capacity <= 0) return "red";
  if (remaining <= 0) return "red";
  const usedRatio = 1 - remaining / capacity;
  if (usedRatio >= 0.8) return "amber";
  return "green";
}

function makeLane(capacity: number, used: number): CapacityLane {
  const cap = Math.max(0, capacity);
  const u = Math.max(0, used);
  const remaining = Math.max(0, cap - u);
  const ratio = cap > 0 ? u / cap : 1;
  return { capacity: cap, used: u, remaining, ratio, tone: laneTone(remaining, cap) };
}

const WORST: Record<CapacityTone, number> = { green: 0, amber: 1, red: 2 };
function worstTone(...tones: CapacityTone[]): CapacityTone {
  return tones.reduce((acc, t) => (WORST[t] > WORST[acc] ? t : acc), "green" as CapacityTone);
}

/**
 * Compute the current-quarter distribution capacity snapshot.
 *
 * @param activeEmployees   number of CURRENT paid employees (the denominator)
 * @param usage             per-quarter tallies already recorded
 * @param caps              per-employee caps (default 30 trade / 50 iqc / 25 conc)
 * @param daysLeftInQuarter days remaining (inclusive) in the calendar quarter
 */
export function computeSampleCapacity(args: {
  activeEmployees: number;
  tradeUsed: number;
  iqcUsed: number;
  iqcConcentrateUsed: number;
  tradePerEmployee: number;
  iqcPerEmployee: number;
  iqcConcentratePerEmployee: number;
  daysLeftInQuarter: number;
}): SampleCapacity {
  const n = Math.max(0, Math.trunc(args.activeEmployees));
  const trade = makeLane(n * args.tradePerEmployee, args.tradeUsed);
  const iqc = makeLane(n * args.iqcPerEmployee, args.iqcUsed);
  const iqcConcentrate = makeLane(n * args.iqcConcentratePerEmployee, args.iqcConcentrateUsed);

  let tone = worstTone(trade.tone, iqc.tone);
  // Late in the quarter, tighten: if any lane is amber and few days remain, treat
  // as more urgent (still not red unless truly full). Advisory only.
  const lateQuarter = args.daysLeftInQuarter <= 14;

  let headline: string;
  if (n === 0) {
    tone = "red";
    headline = "No active employees — you have no one to give samples to. Do not accept new samples.";
  } else if (trade.remaining <= 0 && iqc.remaining <= 0) {
    tone = "red";
    headline = "No distribution capacity left this quarter — accepting more samples risks waste.";
  } else {
    const bits: string[] = [];
    bits.push(`${trade.remaining} trade unit(s) can still be placed`);
    bits.push(`${iqc.remaining} IQC unit(s) (${iqcConcentrate.remaining} concentrate)`);
    headline = `Room to place ${bits.join(" · ")} across ${n} employee(s) this quarter.`;
    if (lateQuarter && tone === "green" && (trade.tone === "amber" || iqc.tone === "amber")) {
      tone = "amber";
    }
    if (lateQuarter && (trade.remaining > 0 || iqc.remaining > 0)) {
      headline += ` Only ${args.daysLeftInQuarter} day(s) left in the quarter — caps reset and cannot be banked.`;
    }
  }

  return {
    activeEmployees: n,
    trade,
    iqc,
    iqcConcentrate,
    daysLeftInQuarter: args.daysLeftInQuarter,
    tone,
    headline,
  };
}

// ---------------------------------------------------------------------------
// Per-batch verdict: "if I accept THIS incoming batch, can I place it?"
// ---------------------------------------------------------------------------

export type BatchVerdict = {
  tone: CapacityTone;
  /** Units in the batch that would have nowhere to go this quarter (0 if all fit). */
  unplaceable: number;
  message: string;
};

/**
 * Evaluate a proposed INCOMING batch against remaining TRADE distribution
 * capacity. (Incoming sample lots are trade-category product a retailer receives
 * from a processor; IQC is self-generated, not received — so intake pressure
 * lands on the trade outbound lane.) Advisory soft warning, never a hard block.
 */
export function evaluateIncomingBatch(args: {
  batchUnits: number;
  capacity: SampleCapacity;
}): BatchVerdict {
  const batch = Math.max(0, Math.trunc(args.batchUnits));
  const remaining = args.capacity.trade.remaining;

  if (batch <= 0) {
    return { tone: "green", message: "Nothing to place.", unplaceable: 0 };
  }
  if (args.capacity.activeEmployees === 0) {
    return {
      tone: "red",
      unplaceable: batch,
      message: `No active employees — none of these ${batch} unit(s) can be placed. ${WAC_CITATION}.`,
    };
  }
  if (remaining <= 0) {
    return {
      tone: "red",
      unplaceable: batch,
      message: `You have no remaining trade-distribution capacity this quarter — all ${batch} unit(s) would have nowhere to go before caps reset. ${WAC_CITATION}.`,
    };
  }
  if (batch > remaining) {
    return {
      tone: "amber",
      unplaceable: batch - remaining,
      message: `Tight: this batch is ${batch} unit(s) but only ${remaining} can be placed this quarter — ${batch - remaining} unit(s) would have nowhere to go before caps reset.`,
    };
  }
  return {
    tone: "green",
    unplaceable: 0,
    message: `All ${batch} unit(s) fit: ${remaining} trade unit(s) of distribution capacity remain this quarter.`,
  };
}

// ---------------------------------------------------------------------------
// Calendar-quarter day math (Pacific YMD in → inclusive days remaining).
// ---------------------------------------------------------------------------

/** Last day (1..31) of a given 1-based month in a given year. */
function lastDayOfMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/**
 * Days remaining (INCLUSIVE of today) until the end of the calendar quarter
 * that `ymd` falls in. E.g. on the last day of the quarter → 1.
 */
export function daysLeftInQuarter(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return 0;
  const q = quarterOfMonth(m);
  const endMonth = q * 3; // 3, 6, 9, 12
  const endDay = lastDayOfMonth(y, endMonth);
  const today = Date.UTC(y, m - 1, d);
  const end = Date.UTC(y, endMonth - 1, endDay);
  const diffDays = Math.round((end - today) / 86_400_000);
  return Math.max(0, diffDays) + 1; // inclusive of today
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
}

export function __runSampleCapacityCoreTests(): string {
  const baseCaps = { tradePerEmployee: 30, iqcPerEmployee: 50, iqcConcentratePerEmployee: 25 };

  // 6 employees, nothing used, mid-quarter.
  const c1 = computeSampleCapacity({
    activeEmployees: 6,
    tradeUsed: 0,
    iqcUsed: 0,
    iqcConcentrateUsed: 0,
    ...baseCaps,
    daysLeftInQuarter: 60,
  });
  assert(c1.trade.capacity === 180 && c1.trade.remaining === 180, "6 emp → 180 trade capacity");
  assert(c1.iqc.capacity === 300 && c1.iqcConcentrate.capacity === 150, "6 emp → 300 iqc / 150 conc");
  assert(c1.tone === "green", "fresh quarter green");

  // Used 100 trade → 80 remaining.
  const c2 = computeSampleCapacity({
    activeEmployees: 6,
    tradeUsed: 100,
    iqcUsed: 0,
    iqcConcentrateUsed: 0,
    ...baseCaps,
    daysLeftInQuarter: 60,
  });
  assert(c2.trade.remaining === 80, "180-100 = 80 remaining");

  // Near cap → amber (≥80% used: 150/180 = 83%).
  const c3 = computeSampleCapacity({
    activeEmployees: 6,
    tradeUsed: 150,
    iqcUsed: 0,
    iqcConcentrateUsed: 0,
    ...baseCaps,
    daysLeftInQuarter: 60,
  });
  assert(c3.trade.tone === "amber", "150/180 amber");

  // Zero employees → red.
  const c0 = computeSampleCapacity({
    activeEmployees: 0,
    tradeUsed: 0,
    iqcUsed: 0,
    iqcConcentrateUsed: 0,
    ...baseCaps,
    daysLeftInQuarter: 60,
  });
  assert(c0.tone === "red" && c0.trade.capacity === 0, "0 employees red");

  // Fully distributed → red headline.
  const cFull = computeSampleCapacity({
    activeEmployees: 2,
    tradeUsed: 60,
    iqcUsed: 100,
    iqcConcentrateUsed: 50,
    ...baseCaps,
    daysLeftInQuarter: 30,
  });
  assert(cFull.tone === "red" && cFull.trade.remaining === 0 && cFull.iqc.remaining === 0, "full → red");

  // Late-quarter amber promotion.
  const cLate = computeSampleCapacity({
    activeEmployees: 6,
    tradeUsed: 150, // amber lane
    iqcUsed: 0,
    iqcConcentrateUsed: 0,
    ...baseCaps,
    daysLeftInQuarter: 5,
  });
  assert(cLate.tone === "amber", "late quarter + amber lane → amber headline");
  assert(cLate.headline.includes("5 day"), "late headline mentions days left");

  // ---- Batch verdicts ----
  const cap80 = computeSampleCapacity({
    activeEmployees: 6,
    tradeUsed: 100, // 80 remaining
    iqcUsed: 0,
    iqcConcentrateUsed: 0,
    ...baseCaps,
    daysLeftInQuarter: 60,
  });
  const vFits = evaluateIncomingBatch({ batchUnits: 50, capacity: cap80 });
  assert(vFits.tone === "green" && vFits.unplaceable === 0, "50 fits in 80");

  const vTight = evaluateIncomingBatch({ batchUnits: 120, capacity: cap80 });
  assert(vTight.tone === "amber" && vTight.unplaceable === 40, "120 vs 80 → 40 unplaceable");

  const capFull = computeSampleCapacity({
    activeEmployees: 6,
    tradeUsed: 180,
    iqcUsed: 0,
    iqcConcentrateUsed: 0,
    ...baseCaps,
    daysLeftInQuarter: 60,
  });
  const vNoRoom = evaluateIncomingBatch({ batchUnits: 10, capacity: capFull });
  assert(vNoRoom.tone === "red" && vNoRoom.unplaceable === 10, "no room → red all unplaceable");

  const vNoEmp = evaluateIncomingBatch({ batchUnits: 10, capacity: c0 });
  assert(vNoEmp.tone === "red" && vNoEmp.unplaceable === 10, "no employees → red");

  const vZero = evaluateIncomingBatch({ batchUnits: 0, capacity: cap80 });
  assert(vZero.tone === "green" && vZero.unplaceable === 0, "empty batch green");

  const vExact = evaluateIncomingBatch({ batchUnits: 80, capacity: cap80 });
  assert(vExact.tone === "green" && vExact.unplaceable === 0, "exact fit green");

  // ---- daysLeftInQuarter ----
  assert(daysLeftInQuarter("2026-01-01") === 90, "Q1 2026 from Jan 1 → 90 days (Jan31+Feb28+Mar31)");
  assert(daysLeftInQuarter("2026-03-31") === 1, "last day of Q1 → 1");
  assert(daysLeftInQuarter("2026-12-31") === 1, "last day of Q4 → 1");
  assert(daysLeftInQuarter("2024-02-15") === 46, "Q1 leap from Feb 15 → 46 (14 Feb left incl + 31 Mar)");

  return "OK: sample-capacity-core tests passed";
}
