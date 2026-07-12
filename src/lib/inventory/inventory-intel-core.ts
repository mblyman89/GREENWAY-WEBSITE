/**
 * src/lib/inventory/inventory-intel-core.ts  (Task L)
 *
 * PURE inventory-intelligence math for the WA retail inventory command center.
 * No imports, no I/O — fully unit-testable via __runInventoryIntelTests().
 *
 * Implements the professional inventory toolkit on top of the compliance floor
 * documented in docs/INVENTORY_COMPLIANCE_WA.md:
 *
 *  - ABC classification by on-hand value at cost (A ≈ top 80% of cumulative
 *    value, B ≈ next 15%, C ≈ last 5%) — highest-value stock gets the most
 *    audit attention.
 *  - FEFO (First-Expired, First-Out) sell-first ranking — expired first, then
 *    soonest expiry, then oldest receipt.
 *  - Aging buckets by days-on-hand (0–30 / 31–60 / 61–90 / 90+).
 *  - Months-of-supply estimate vs the WAC 314-55-079(10) FOUR-MONTH maximum
 *    average inventory a retailer may keep on the licensed premises.
 *  - Shrink telemetry (units + value at cost by reason group) — undocumented
 *    inventory reductions are DEEMED SALES and assessed the 37% excise under
 *    WAC 314-55-089(4)(c), so every reduction must carry a documented reason.
 *  - Cycle-count cadence (A monthly / B quarterly / C semi-annual) + overdue
 *    detection, and blind-count variance review with dollar impact + recount
 *    flags before a session is applied.
 *
 * All money is in MINOR UNITS (cents).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal lot shape the intel math needs (mapped from inventory_lots rows). */
export type IntelLot = {
  id: string;
  productName: string | null;
  category: string | null;
  status: string;
  isMedical: boolean;
  onHandQty: number;
  receivedQty: number;
  unitCostMinor: number | null;
  /** YYYY-MM-DD or null. */
  expiresOn: string | null;
  /** ISO timestamp the lot was created/received, or null. */
  receivedAt: string | null;
  /** ISO timestamp the lot was last physically counted, or null (never). */
  lastCountedAt: string | null;
};

export type AbcClass = "A" | "B" | "C";

export type AgingBucketKey = "0-30" | "31-60" | "61-90" | "90+" | "unknown";

/** Adjustment shape for shrink telemetry (from inventory_adjustments rows). */
export type IntelAdjustment = {
  lotId: string;
  qtyDelta: number;
  reason: string;
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** On-hand value of one lot at cost, in minor units (0 when cost unknown). */
export function onHandValueMinor(lot: Pick<IntelLot, "onHandQty" | "unitCostMinor">): number {
  if (lot.unitCostMinor == null || !Number.isFinite(lot.unitCostMinor)) return 0;
  const qty = Number(lot.onHandQty) || 0;
  if (qty <= 0) return 0;
  return Math.round(qty * lot.unitCostMinor);
}

/** Whole days between two ISO instants/dates (floor; never negative). */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.floor((to - from) / 86_400_000));
}

// ---------------------------------------------------------------------------
// ABC classification (cumulative value at cost: 80 / 95 breakpoints)
// ---------------------------------------------------------------------------

export const ABC_BREAKPOINTS = { a: 0.8, b: 0.95 } as const;

/**
 * Classify lots A/B/C by cumulative share of total on-hand value at cost.
 * Lots are ranked by value descending; lots inside the top 80% of cumulative
 * value are A, the next 15% are B, and the tail (incl. all zero-value lots)
 * are C. Deterministic: value ties break by lot id.
 */
export function classifyAbc(lots: IntelLot[]): Map<string, AbcClass> {
  const ranked = lots
    .map((l) => ({ id: l.id, value: onHandValueMinor(l) }))
    .sort((a, b) => b.value - a.value || (a.id < b.id ? -1 : 1));
  const total = ranked.reduce((s, r) => s + r.value, 0);
  const out = new Map<string, AbcClass>();
  if (total <= 0) {
    for (const r of ranked) out.set(r.id, "C");
    return out;
  }
  let cum = 0;
  for (const r of ranked) {
    if (r.value <= 0) {
      out.set(r.id, "C");
      continue;
    }
    cum += r.value;
    const share = cum / total;
    out.set(r.id, share <= ABC_BREAKPOINTS.a ? "A" : share <= ABC_BREAKPOINTS.b ? "B" : "C");
  }
  // Guarantee the single largest lot is always A (edge: one lot >80% share).
  if (ranked.length > 0 && ranked[0].value > 0) out.set(ranked[0].id, "A");
  return out;
}

// ---------------------------------------------------------------------------
// FEFO — First-Expired, First-Out sell-first ranking
// ---------------------------------------------------------------------------

/**
 * Comparator for FEFO ordering. Sort order:
 *  1. lots WITH an expiry date, soonest first (expired lots therefore lead);
 *  2. lots without expiry, oldest receipt first;
 *  3. stable tie-break by id.
 */
export function fefoCompare(a: IntelLot, b: IntelLot): number {
  const ax = a.expiresOn;
  const bx = b.expiresOn;
  if (ax && bx && ax !== bx) return ax < bx ? -1 : 1;
  if (ax && !bx) return -1;
  if (!ax && bx) return 1;
  const ar = a.receivedAt ?? "";
  const br = b.receivedAt ?? "";
  if (ar !== br) return ar < br ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Return a NEW array of lots in FEFO (sell-first) order. */
export function fefoRank(lots: IntelLot[]): IntelLot[] {
  return [...lots].sort(fefoCompare);
}

// ---------------------------------------------------------------------------
// Aging buckets (days on hand since receipt)
// ---------------------------------------------------------------------------

export const AGING_BUCKETS: AgingBucketKey[] = ["0-30", "31-60", "61-90", "90+", "unknown"];

export function agingBucket(receivedAt: string | null, todayIso: string): AgingBucketKey {
  if (!receivedAt) return "unknown";
  const days = daysBetween(receivedAt, todayIso);
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export type AgingSummary = Record<AgingBucketKey, { lots: number; valueMinor: number }>;

/** Aging summary across ACTIVE lots only (units of interest for rotation). */
export function summarizeAging(lots: IntelLot[], todayIso: string): AgingSummary {
  const out: AgingSummary = {
    "0-30": { lots: 0, valueMinor: 0 },
    "31-60": { lots: 0, valueMinor: 0 },
    "61-90": { lots: 0, valueMinor: 0 },
    "90+": { lots: 0, valueMinor: 0 },
    unknown: { lots: 0, valueMinor: 0 },
  };
  for (const l of lots) {
    if (l.status !== "active") continue;
    const b = agingBucket(l.receivedAt, todayIso);
    out[b].lots += 1;
    out[b].valueMinor += onHandValueMinor(l);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Months of supply vs the WAC 314-55-079(10) four-month ceiling
// ---------------------------------------------------------------------------

/** WAC 314-55-079(10): max FOUR months of average inventory on premises. */
export const MAX_MONTHS_ON_HAND = 4;

export type MonthsOfSupply = {
  /** Estimated months of supply at the current depletion rate, or null when
   * there is no measurable depletion yet (fresh store / no cost data). */
  months: number | null;
  /** true when the estimate exceeds the 4-month WAC ceiling. */
  overCeiling: boolean;
  onHandValueMinor: number;
  /** Estimated value depleted per month (minor units). */
  monthlyDepletionMinor: number;
};

/**
 * Estimate months of supply from lot depletion. For each ACTIVE lot with cost
 * data, depletion = (received − on-hand) × unit cost, spread over the lot's
 * age (min 1 week so brand-new lots don't produce infinite rates). This is an
 * ESTIMATE — labeled as such in the UI — but it is derived from real lot data
 * (never guessed) and gives an honest read against the 4-month ceiling.
 */
export function monthsOfSupply(lots: IntelLot[], todayIso: string): MonthsOfSupply {
  let onHand = 0;
  let monthlyDepletion = 0;
  for (const l of lots) {
    if (l.status !== "active") continue;
    onHand += onHandValueMinor(l);
    if (l.unitCostMinor == null || !l.receivedAt) continue;
    const depletedUnits = Math.max(0, (Number(l.receivedQty) || 0) - (Number(l.onHandQty) || 0));
    if (depletedUnits <= 0) continue;
    const ageDays = Math.max(7, daysBetween(l.receivedAt, todayIso));
    const depletedValue = depletedUnits * l.unitCostMinor;
    monthlyDepletion += depletedValue / (ageDays / 30.44);
  }
  monthlyDepletion = Math.round(monthlyDepletion);
  const months = monthlyDepletion > 0 ? Math.round((onHand / monthlyDepletion) * 10) / 10 : null;
  return {
    months,
    overCeiling: months != null && months > MAX_MONTHS_ON_HAND,
    onHandValueMinor: onHand,
    monthlyDepletionMinor: monthlyDepletion,
  };
}

// ---------------------------------------------------------------------------
// Shrink telemetry (WAC 314-55-089(4)(c) — document every reduction)
// ---------------------------------------------------------------------------

export type ShrinkGroup = "shrink" | "destruction" | "samples" | "correction" | "other";

/** Map an internal adjustment reason to a shrink-telemetry group. */
export function shrinkGroupOf(reason: string): ShrinkGroup | null {
  switch ((reason ?? "").trim().toLowerCase()) {
    case "shrink":
    case "damage":
    case "theft":
    case "seizure":
      return "shrink";
    case "destruction":
    case "recall":
      return "destruction";
    case "sample":
    case "employee_sample":
      return "samples";
    case "count":
      return "correction";
    case "receive":
      return null; // additions — not a reduction event
    default:
      return "other";
  }
}

export type ShrinkSummary = {
  byGroup: Record<ShrinkGroup, { units: number; valueMinor: number }>;
  totalUnits: number;
  totalValueMinor: number;
};

/**
 * Summarize documented NEGATIVE adjustments (reductions) by group, valued at
 * each lot's unit cost. Positive deltas (e.g. count corrections upward,
 * receives) are excluded — this is a reduction/shrink report.
 */
export function summarizeShrink(
  adjustments: IntelAdjustment[],
  costByLot: Map<string, number | null>,
): ShrinkSummary {
  const byGroup: ShrinkSummary["byGroup"] = {
    shrink: { units: 0, valueMinor: 0 },
    destruction: { units: 0, valueMinor: 0 },
    samples: { units: 0, valueMinor: 0 },
    correction: { units: 0, valueMinor: 0 },
    other: { units: 0, valueMinor: 0 },
  };
  let totalUnits = 0;
  let totalValueMinor = 0;
  for (const a of adjustments) {
    const delta = Number(a.qtyDelta) || 0;
    if (delta >= 0) continue;
    const group = shrinkGroupOf(a.reason);
    if (!group) continue;
    const units = -delta;
    const cost = costByLot.get(a.lotId) ?? null;
    const value = cost != null ? Math.round(units * cost) : 0;
    byGroup[group].units += units;
    byGroup[group].valueMinor += value;
    totalUnits += units;
    totalValueMinor += value;
  }
  return { byGroup, totalUnits, totalValueMinor };
}

// ---------------------------------------------------------------------------
// Cycle-count cadence (A monthly / B quarterly / C semi-annual)
// ---------------------------------------------------------------------------

export const COUNT_CADENCE_DAYS: Record<AbcClass, number> = { A: 30, B: 90, C: 180 };

/** true when an ACTIVE lot is overdue for a physical count under its cadence.
 * A lot never counted is overdue once it is older than its cadence window. */
export function isOverdueForCount(lot: IntelLot, cls: AbcClass, todayIso: string): boolean {
  if (lot.status !== "active") return false;
  const cadence = COUNT_CADENCE_DAYS[cls];
  const anchor = lot.lastCountedAt ?? lot.receivedAt;
  if (!anchor) return true; // no history at all — needs a baseline count
  return daysBetween(anchor, todayIso) > cadence;
}

export type OverdueSummary = {
  byClass: Record<AbcClass, number>;
  total: number;
  lotIds: string[];
};

export function summarizeOverdueCounts(
  lots: IntelLot[],
  abc: Map<string, AbcClass>,
  todayIso: string,
): OverdueSummary {
  const byClass: OverdueSummary["byClass"] = { A: 0, B: 0, C: 0 };
  const lotIds: string[] = [];
  for (const l of lots) {
    const cls = abc.get(l.id) ?? "C";
    if (isOverdueForCount(l, cls, todayIso)) {
      byClass[cls] += 1;
      lotIds.push(l.id);
    }
  }
  return { byClass, total: lotIds.length, lotIds };
}

// ---------------------------------------------------------------------------
// Blind-count variance review (before applying a session)
// ---------------------------------------------------------------------------

/** A counted line with cost context for the review. */
export type ReviewLine = {
  lineId: string;
  productName: string | null;
  systemQty: number;
  countedQty: number | null;
  unitCostMinor: number | null;
};

/** Flag thresholds: recount recommended when |variance value| ≥ $50 at cost OR
 * |variance| ≥ 20% of the system figure (when the system figure is nonzero). */
export const VARIANCE_FLAG_VALUE_MINOR = 5000;
export const VARIANCE_FLAG_PCT = 0.2;

export type FlaggedLine = {
  lineId: string;
  productName: string | null;
  varianceQty: number;
  varianceValueMinor: number;
};

export type VarianceReview = {
  totalLines: number;
  countedLines: number;
  matchedLines: number;
  /** matchedLines / countedLines as a 0–100 integer (100 when nothing counted). */
  accuracyPct: number;
  overUnits: number;
  shortUnits: number;
  netUnits: number;
  /** Net dollar impact at cost of applying all variances (signed, minor units). */
  netValueMinor: number;
  /** Absolute dollar exposure at cost (sum of |variance| × cost). */
  absValueMinor: number;
  flagged: FlaggedLine[];
};

export function reviewVariances(lines: ReviewLine[]): VarianceReview {
  let counted = 0;
  let matched = 0;
  let overUnits = 0;
  let shortUnits = 0;
  let netValue = 0;
  let absValue = 0;
  const flagged: FlaggedLine[] = [];
  for (const l of lines) {
    if (l.countedQty == null) continue;
    counted += 1;
    const system = Number(l.systemQty) || 0;
    const variance = (Number(l.countedQty) || 0) - system;
    if (variance === 0) {
      matched += 1;
      continue;
    }
    if (variance > 0) overUnits += variance;
    else shortUnits += -variance;
    const cost = l.unitCostMinor ?? 0;
    const value = Math.round(variance * cost);
    netValue += value;
    absValue += Math.abs(value);
    const pctFlag = system !== 0 && Math.abs(variance) / Math.abs(system) >= VARIANCE_FLAG_PCT;
    const valueFlag = Math.abs(value) >= VARIANCE_FLAG_VALUE_MINOR;
    if (pctFlag || valueFlag) {
      flagged.push({
        lineId: l.lineId,
        productName: l.productName,
        varianceQty: variance,
        varianceValueMinor: value,
      });
    }
  }
  // Largest dollar exposure first.
  flagged.sort((a, b) => Math.abs(b.varianceValueMinor) - Math.abs(a.varianceValueMinor));
  return {
    totalLines: lines.length,
    countedLines: counted,
    matchedLines: matched,
    accuracyPct: counted > 0 ? Math.round((matched / counted) * 100) : 100,
    overUnits,
    shortUnits,
    netUnits: overUnits - shortUnits,
    netValueMinor: netValue,
    absValueMinor: absValue,
    flagged,
  };
}

// ---------------------------------------------------------------------------
// Command-center composition
// ---------------------------------------------------------------------------

export type CommandCenter = {
  abcCounts: Record<AbcClass, number>;
  abcByLot: Map<string, AbcClass>;
  aging: AgingSummary;
  supply: MonthsOfSupply;
  shrink30: ShrinkSummary;
  overdue: OverdueSummary;
  /** ACTIVE DOH-compliant (medical) lots with stock — an endorsed retailer must
   * always keep compliant product in stock or on order (WAC 314-55-080). */
  medicalInStock: number;
};

export function buildCommandCenter(
  lots: IntelLot[],
  adjustments30d: IntelAdjustment[],
  todayIso: string,
): CommandCenter {
  const abcByLot = classifyAbc(lots.filter((l) => l.status === "active"));
  const abcCounts: Record<AbcClass, number> = { A: 0, B: 0, C: 0 };
  for (const cls of abcByLot.values()) abcCounts[cls] += 1;
  const costByLot = new Map<string, number | null>(lots.map((l) => [l.id, l.unitCostMinor]));
  const medicalInStock = lots.filter(
    (l) => l.status === "active" && l.isMedical && (Number(l.onHandQty) || 0) > 0,
  ).length;
  return {
    abcCounts,
    abcByLot,
    aging: summarizeAging(lots, todayIso),
    supply: monthsOfSupply(lots, todayIso),
    shrink30: summarizeShrink(adjustments30d, costByLot),
    overdue: summarizeOverdueCounts(
      lots.filter((l) => l.status === "active"),
      abcByLot,
      todayIso,
    ),
    medicalInStock,
  };
}

// ---------------------------------------------------------------------------
// Embedded self-tests
// ---------------------------------------------------------------------------

function makeLot(over: Partial<IntelLot> & { id: string }): IntelLot {
  return {
    productName: `Lot ${over.id}`,
    category: null,
    status: "active",
    isMedical: false,
    onHandQty: 10,
    receivedQty: 20,
    unitCostMinor: 1000,
    expiresOn: null,
    receivedAt: "2025-11-01T00:00:00Z",
    lastCountedAt: null,
    ...over,
  };
}

export function __runInventoryIntelTests(): void {
  const eq = (got: unknown, want: unknown, label: string) => {
    const g = JSON.stringify(got);
    const w = JSON.stringify(want);
    if (g !== w) throw new Error(`${label}: got ${g}, want ${w}`);
  };
  const ok = (cond: boolean, label: string) => {
    if (!cond) throw new Error(label);
  };
  const TODAY = "2026-01-10";

  // onHandValueMinor
  eq(onHandValueMinor({ onHandQty: 3, unitCostMinor: 250 }), 750, "value 3×250");
  eq(onHandValueMinor({ onHandQty: 3, unitCostMinor: null }), 0, "value null cost");
  eq(onHandValueMinor({ onHandQty: -2, unitCostMinor: 100 }), 0, "value negative qty clamps");

  // daysBetween
  eq(daysBetween("2026-01-01", "2026-01-10"), 9, "daysBetween 9");
  eq(daysBetween("2026-01-10", "2026-01-01"), 0, "daysBetween never negative");
  eq(daysBetween("garbage", "2026-01-01"), 0, "daysBetween bad input");

  // ABC: values 800 / 150 / 50 → A / B / C at the 80/95 breakpoints
  const abc = classifyAbc([
    makeLot({ id: "a", onHandQty: 8, unitCostMinor: 100 }), // 800
    makeLot({ id: "b", onHandQty: 3, unitCostMinor: 50 }), // 150
    makeLot({ id: "c", onHandQty: 1, unitCostMinor: 50 }), // 50
    makeLot({ id: "z", onHandQty: 0, unitCostMinor: 100 }), // 0 → C
  ]);
  eq(abc.get("a"), "A", "abc A");
  eq(abc.get("b"), "B", "abc B");
  eq(abc.get("c"), "C", "abc C");
  eq(abc.get("z"), "C", "abc zero-value → C");
  // Single dominant lot is still A.
  const abc2 = classifyAbc([
    makeLot({ id: "big", onHandQty: 100, unitCostMinor: 100 }),
    makeLot({ id: "small", onHandQty: 1, unitCostMinor: 100 }),
  ]);
  eq(abc2.get("big"), "A", "dominant lot forced A");
  // All-zero inventory → everything C, no crash.
  const abc3 = classifyAbc([makeLot({ id: "n1", onHandQty: 0 }), makeLot({ id: "n2", onHandQty: 0 })]);
  eq(abc3.get("n1"), "C", "all-zero → C");

  // FEFO: expired first, then soonest expiry, then no-expiry oldest receipt
  const ranked = fefoRank([
    makeLot({ id: "noexp-old", expiresOn: null, receivedAt: "2025-10-01T00:00:00Z" }),
    makeLot({ id: "soon", expiresOn: "2026-02-01" }),
    makeLot({ id: "expired", expiresOn: "2025-12-01" }),
    makeLot({ id: "noexp-new", expiresOn: null, receivedAt: "2025-12-15T00:00:00Z" }),
  ]);
  eq(
    ranked.map((l) => l.id),
    ["expired", "soon", "noexp-old", "noexp-new"],
    "fefo order",
  );

  // Aging buckets
  eq(agingBucket("2026-01-05T00:00:00Z", TODAY), "0-30", "aging 0-30");
  eq(agingBucket("2025-11-25T00:00:00Z", TODAY), "31-60", "aging 31-60");
  eq(agingBucket("2025-10-20T00:00:00Z", TODAY), "61-90", "aging 61-90");
  eq(agingBucket("2025-08-01T00:00:00Z", TODAY), "90+", "aging 90+");
  eq(agingBucket(null, TODAY), "unknown", "aging unknown");
  const aging = summarizeAging(
    [
      makeLot({ id: "x", receivedAt: "2025-08-01T00:00:00Z", onHandQty: 2, unitCostMinor: 500 }),
      makeLot({ id: "y", receivedAt: "2026-01-05T00:00:00Z" }),
      makeLot({ id: "dead", status: "destroyed", receivedAt: "2025-08-01T00:00:00Z" }),
    ],
    TODAY,
  );
  eq(aging["90+"], { lots: 1, valueMinor: 1000 }, "aging 90+ summary");
  eq(aging["0-30"].lots, 1, "aging 0-30 count");

  // Months of supply: lot received 30.44 days ago, depleted 10 units @ $10 →
  // monthly depletion ≈ $100; on hand 10 units @ $10 = $100 → ≈1 month.
  const mos = monthsOfSupply(
    [
      makeLot({
        id: "m",
        receivedQty: 20,
        onHandQty: 10,
        unitCostMinor: 1000,
        receivedAt: "2025-12-10T13:26:00Z", // ~30.44 days before TODAY
      }),
    ],
    TODAY,
  );
  ok(mos.months != null && mos.months > 0.8 && mos.months < 1.2, `mos ≈1 (got ${mos.months})`);
  ok(!mos.overCeiling, "mos under ceiling");
  // No depletion → null months, not over ceiling.
  const mosNone = monthsOfSupply([makeLot({ id: "f", receivedQty: 10, onHandQty: 10 })], TODAY);
  eq(mosNone.months, null, "mos null when no depletion");
  eq(mosNone.overCeiling, false, "mos null not over ceiling");
  // Slow seller: depleted 1 of 100 over ~30 days → way over the 4-month cap.
  const mosOver = monthsOfSupply(
    [
      makeLot({
        id: "s",
        receivedQty: 100,
        onHandQty: 99,
        unitCostMinor: 1000,
        receivedAt: "2025-12-10T00:00:00Z",
      }),
    ],
    TODAY,
  );
  ok(mosOver.overCeiling, "slow seller flags over the 4-month ceiling");

  // Shrink groups
  eq(shrinkGroupOf("shrink"), "shrink", "group shrink");
  eq(shrinkGroupOf("theft"), "shrink", "group theft");
  eq(shrinkGroupOf("recall"), "destruction", "group recall");
  eq(shrinkGroupOf("employee_sample"), "samples", "group employee_sample");
  eq(shrinkGroupOf("count"), "correction", "group count");
  eq(shrinkGroupOf("receive"), null, "receive excluded");
  const shrink = summarizeShrink(
    [
      { lotId: "l1", qtyDelta: -2, reason: "shrink" },
      { lotId: "l1", qtyDelta: -1, reason: "damage" },
      { lotId: "l2", qtyDelta: -3, reason: "destruction" },
      { lotId: "l1", qtyDelta: +5, reason: "count" }, // positive → excluded
      { lotId: "l1", qtyDelta: -4, reason: "receive" }, // receive → excluded
      { lotId: "missing", qtyDelta: -1, reason: "theft" }, // no cost → 0 value
    ],
    new Map([
      ["l1", 100],
      ["l2", 200],
    ]),
  );
  eq(shrink.byGroup.shrink, { units: 4, valueMinor: 300 }, "shrink group units+value");
  eq(shrink.byGroup.destruction, { units: 3, valueMinor: 600 }, "destruction group");
  eq(shrink.totalUnits, 7, "shrink total units");
  eq(shrink.totalValueMinor, 900, "shrink total value");

  // Cadence / overdue
  const freshA = makeLot({ id: "fa", lastCountedAt: "2025-12-20T00:00:00Z" });
  ok(!isOverdueForCount(freshA, "A", TODAY), "A counted 21d ago not overdue");
  const staleA = makeLot({ id: "sa", lastCountedAt: "2025-12-01T00:00:00Z" });
  ok(isOverdueForCount(staleA, "A", TODAY), "A counted 40d ago overdue");
  ok(!isOverdueForCount(staleA, "B", TODAY), "same lot as B not overdue");
  const neverCounted = makeLot({ id: "nc", lastCountedAt: null, receivedAt: "2025-10-01T00:00:00Z" });
  ok(isOverdueForCount(neverCounted, "B", TODAY), "never-counted 101d-old B overdue");
  const noHistory = makeLot({ id: "nh", lastCountedAt: null, receivedAt: null });
  ok(isOverdueForCount(noHistory, "C", TODAY), "no history → needs baseline count");
  const inactive = makeLot({ id: "in", status: "destroyed", lastCountedAt: null, receivedAt: null });
  ok(!isOverdueForCount(inactive, "A", TODAY), "inactive lot never overdue");
  const overdue = summarizeOverdueCounts(
    [staleA, freshA, neverCounted],
    new Map([
      ["sa", "A"],
      ["fa", "A"],
      ["nc", "B"],
    ]),
    TODAY,
  );
  eq(overdue.byClass, { A: 1, B: 1, C: 0 }, "overdue by class");
  eq(overdue.lotIds.length, 2, "overdue lot ids");

  // Variance review
  const review = reviewVariances([
    { lineId: "r1", productName: "P1", systemQty: 10, countedQty: 10, unitCostMinor: 100 },
    { lineId: "r2", productName: "P2", systemQty: 10, countedQty: 7, unitCostMinor: 2000 }, // -3 → -$60, 30% → flagged both ways
    { lineId: "r3", productName: "P3", systemQty: 100, countedQty: 101, unitCostMinor: 100 }, // +1 → $1, 1% → not flagged
    { lineId: "r4", productName: "P4", systemQty: 5, countedQty: null, unitCostMinor: 100 }, // uncounted
  ]);
  eq(review.totalLines, 4, "review total");
  eq(review.countedLines, 3, "review counted");
  eq(review.matchedLines, 1, "review matched");
  eq(review.accuracyPct, 33, "review accuracy");
  eq(review.overUnits, 1, "review over");
  eq(review.shortUnits, 3, "review short");
  eq(review.netUnits, -2, "review net units");
  eq(review.netValueMinor, -6000 + 100, "review net value");
  eq(review.absValueMinor, 6000 + 100, "review abs value");
  eq(review.flagged.length, 1, "review one flag");
  eq(review.flagged[0].lineId, "r2", "review flag is the big short");
  // Nothing counted → accuracy 100 (nothing to dispute), no flags.
  const empty = reviewVariances([
    { lineId: "e", productName: null, systemQty: 5, countedQty: null, unitCostMinor: null },
  ]);
  eq(empty.accuracyPct, 100, "empty review accuracy 100");
  eq(empty.flagged.length, 0, "empty review no flags");
  // Zero-system line with any count is flagged by percent rule only if system≠0 —
  // a found lot (system 0 → counted 2) flags only on value ≥ $50.
  const found = reviewVariances([
    { lineId: "f1", productName: "Found", systemQty: 0, countedQty: 2, unitCostMinor: 3000 },
  ]);
  eq(found.flagged.length, 1, "found lot flags on value");

  // Command center composition sanity
  const cc = buildCommandCenter(
    [
      makeLot({ id: "cc1", isMedical: true, onHandQty: 5 }),
      makeLot({ id: "cc2", status: "quarantine" }),
    ],
    [{ lotId: "cc1", qtyDelta: -1, reason: "shrink" }],
    TODAY,
  );
  eq(cc.medicalInStock, 1, "cc medical in stock");
  eq(cc.abcCounts.A >= 1, true, "cc abc has an A");
  eq(cc.shrink30.totalUnits, 1, "cc shrink wired");
  ok(cc.overdue.total >= 0, "cc overdue wired");
}
