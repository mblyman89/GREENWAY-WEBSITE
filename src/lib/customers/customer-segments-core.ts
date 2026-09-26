/**
 * src/lib/customers/customer-segments-core.ts  (Slice 3 — customer intelligence)
 *
 * PURE. No I/O, no database, no clock (every "now" is passed in). Safe for the
 * tsx self-test harness and vitest.
 *
 * WHAT THIS FILE DOES
 * -------------------
 * Scores every customer who has bought something on the three numbers the big
 * retention platforms all start from — RECENCY (days since the last visit),
 * FREQUENCY (how many visits) and MONETARY (net spend) — and turns the scores
 * into named segments with a plain-English meaning and a suggested action.
 *
 * WHERE THE METHOD COMES FROM (researched, not invented)
 * ------------------------------------------------------
 *   - Quintile (1–5) scoring on each of R, F and M, ranked against the shop's
 *     OWN customers, is the standard RFM method (Sweed's cannabis RFM uses the
 *     same 1–5 quantile scores; the mcpanalytics RFM guide likewise).
 *   - The segment names and score rules follow the widely used RFM code maps
 *     (Champions 555/554/544/545, Loyal 4-5 frequency, Can't Lose 1-2 recency
 *     with 4-5 frequency and spend, At Risk, New, Potential Loyalist,
 *     Hibernating/About to Sleep, Lost), collapsed to 11 segments that are
 *     EXHAUSTIVE and ORDERED so every scored customer lands in exactly one.
 *   - Segments on a small customer base are noisy (the RFM guide calls anything
 *     under ~200 customers unreliable; Klaviyo will not show predictions below
 *     500 profiles). We still score — a small shop needs the list most — but
 *     every output carries a CONFIDENCE label so the page says so out loud.
 *
 * TIES
 * ----
 * Scores use MID-RANK percentiles: a value's percentile is
 * (count below + half the count equal) / n. Customers with the same number get
 * the same score, and the common "everyone bought once" pile-up lands in the
 * middle instead of being split arbitrarily across scores by sort order.
 *
 * Money is integer MINOR UNITS (cents) everywhere.
 */

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** One customer's lifetime rollup — the same four facts migration 0232 keeps. */
export type CustomerRollup = {
  customerId: string;
  /** Completed purchases linked to the customer (each register sale / completed order = 1). */
  visits: number;
  /** What they paid across those purchases, less refunds. Cents. */
  netSpendMinor: number;
  firstVisitAt: string | null;
  lastVisitAt: string | null;
};

export type SegmentKey =
  | "champions"
  | "cant_lose"
  | "loyal"
  | "at_risk"
  | "new"
  | "potential_loyalist"
  | "big_spender"
  | "needs_attention"
  | "about_to_sleep"
  | "lost"
  | "none";

export type SegmentInfo = {
  key: SegmentKey;
  label: string;
  /** One sentence: who is in here. */
  meaning: string;
  /** One sentence: what to do about them. */
  action: string;
  /** Badge tone for the admin UI. */
  tone: "green" | "gold" | "orange" | "danger" | "neutral";
};

/** Display order = value order (best first). */
export const SEGMENTS: readonly SegmentInfo[] = [
  {
    key: "champions",
    label: "Champions",
    meaning: "Bought recently, buy often, and spend the most.",
    action: "Reward them: early access to new drops, VIP perks, and ask them for a review.",
    tone: "green",
  },
  {
    key: "loyal",
    label: "Loyal",
    meaning: "Regulars who come in often.",
    action: "Keep their staples in stock and show them the premium option in their favorite category.",
    tone: "green",
  },
  {
    key: "potential_loyalist",
    label: "Potential loyalist",
    meaning: "Recent customers who are starting to come back.",
    action: "Enroll them in loyalty and recommend products next to what they already like.",
    tone: "green",
  },
  {
    key: "new",
    label: "New",
    meaning: "Made their first purchase recently.",
    action: "Make the second visit happen: a welcome follow-up within two weeks of the first visit.",
    tone: "gold",
  },
  {
    key: "big_spender",
    label: "Big spender, occasional",
    meaning: "Spend a lot when they come, but don't come often.",
    action: "Give them a reason to come back more: tell them when their favorite brand restocks.",
    tone: "gold",
  },
  {
    key: "needs_attention",
    label: "Needs attention",
    meaning: "Middle-of-the-road customers who are starting to cool off.",
    action: "A limited-time offer in their favorite category.",
    tone: "orange",
  },
  {
    key: "cant_lose",
    label: "Can't lose them",
    meaning: "Used to be among your best customers, but haven't been in for a long time.",
    action: "Personal win-back now: a message from you, with their favorite product in stock.",
    tone: "danger",
  },
  {
    key: "at_risk",
    label: "At risk",
    meaning: "Were regulars, but their visits have slipped.",
    action: "Send a win-back offer on their favorite brand before they settle somewhere else.",
    tone: "danger",
  },
  {
    key: "about_to_sleep",
    label: "About to sleep",
    meaning: "Haven't been in for a while and never came often.",
    action: "Remind them what's new in the category they buy.",
    tone: "orange",
  },
  {
    key: "lost",
    label: "Lost",
    meaning: "Longest time since a visit and rarely bought.",
    action: "Low-cost reactivation only; don't spend much here.",
    tone: "neutral",
  },
  {
    key: "none",
    label: "No purchases yet",
    meaning: "No completed purchase is linked to this customer yet.",
    action: "Attach them at the register or link their online orders so their history counts.",
    tone: "neutral",
  },
];

export function segmentInfo(key: SegmentKey): SegmentInfo {
  const hit = SEGMENTS.find((s) => s.key === key);
  // SEGMENTS is exhaustive over SegmentKey; the fallback is unreachable but typed.
  return hit ?? SEGMENTS[SEGMENTS.length - 1];
}

export type RfmScore = { r: number; f: number; m: number };

export type ScoredCustomer = CustomerRollup & {
  score: RfmScore | null;
  segment: SegmentKey;
  recencyDays: number | null;
};

/** How far to trust segments at this population size. */
export type SegmentConfidence = "early" | "building" | "solid";

/** Below this many scored customers the page says the segments are early. */
export const SEGMENT_EARLY_BELOW = 50;
/** At or above this many scored customers, segments are statistically solid. */
export const SEGMENT_SOLID_AT = 200;

export function segmentConfidence(scoredCustomers: number): SegmentConfidence {
  if (scoredCustomers >= SEGMENT_SOLID_AT) return "solid";
  if (scoredCustomers >= SEGMENT_EARLY_BELOW) return "building";
  return "early";
}

export const CONFIDENCE_NOTE: Readonly<Record<SegmentConfidence, string>> = {
  early:
    "Early data: fewer than 50 customers have linked purchases, so segments will shift a lot as more sales are linked. Use them as a starting point, not a verdict.",
  building:
    "Building: segments are directionally useful. They become statistically solid at about 200 customers with linked purchases.",
  solid: "Solid: 200+ customers with linked purchases, so segments are statistically meaningful.",
};

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** Whole days from `fromIso` to `toIso` (floor), or null when either is unusable. */
export function daysBetween(fromIso: string | null | undefined, toIso: string | null | undefined): number | null {
  if (!fromIso || !toIso) return null;
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((b - a) / DAY_MS));
}

/** Median of a numeric list (average of the middle two for even lengths); null when empty. */
export function median(values: readonly number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).slice().sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * Mid-rank quintile scores (1..5). `higherIsBetter=false` flips the scale
 * (recency: FEWER days since the last visit is better).
 */
export function quintileScores(values: readonly number[], higherIsBetter: boolean): number[] {
  const n = values.length;
  if (n === 0) return [];
  const sorted = values.slice().sort((a, b) => a - b);
  // lowerBound / upperBound via binary search for O(n log n).
  const lowerBound = (x: number) => {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const upperBound = (x: number) => {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] <= x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return values.map((x) => {
    const below = lowerBound(x);
    const equal = upperBound(x) - below;
    const above = n - below - equal;
    const pct = ((higherIsBetter ? below : above) + equal / 2) / n;
    return Math.min(5, Math.max(1, Math.ceil(pct * 5)));
  });
}

/**
 * The segment for one scored customer. ORDERED rules; the first match wins and
 * the list is exhaustive (every r in 1..5 is caught by the last three rules).
 */
export function segmentFor(score: RfmScore | null, visits: number): SegmentKey {
  if (!score || visits <= 0) return "none";
  const { r, f, m } = score;
  if (r >= 4 && f >= 4 && m >= 4) return "champions";
  if (r <= 2 && f >= 4 && m >= 4) return "cant_lose";
  if (f >= 4 && r >= 3) return "loyal";
  if (r <= 2 && f >= 3) return "at_risk";
  if (visits === 1 && r >= 4) return "new";
  if (r >= 4) return "potential_loyalist";
  if (m >= 4 && r >= 3) return "big_spender";
  if (r === 3) return "needs_attention";
  if (r === 2) return "about_to_sleep";
  return "lost";
}

/**
 * Score a whole population. Only customers with at least one visit and a usable
 * last-visit time are scored; everyone else is "none".
 */
export function scorePopulation(rollups: readonly CustomerRollup[], nowIso: string): ScoredCustomer[] {
  const eligibleIdx: number[] = [];
  const recency: number[] = [];
  const frequency: number[] = [];
  const monetary: number[] = [];
  rollups.forEach((c, i) => {
    const days = daysBetween(c.lastVisitAt, nowIso);
    if (c.visits > 0 && days !== null) {
      eligibleIdx.push(i);
      recency.push(days);
      frequency.push(c.visits);
      monetary.push(Math.max(0, c.netSpendMinor));
    }
  });
  const rS = quintileScores(recency, false);
  const fS = quintileScores(frequency, true);
  const mS = quintileScores(monetary, true);
  const scoreByIdx = new Map<number, { score: RfmScore; days: number }>();
  eligibleIdx.forEach((idx, k) => scoreByIdx.set(idx, { score: { r: rS[k], f: fS[k], m: mS[k] }, days: recency[k] }));
  return rollups.map((c, i) => {
    const hit = scoreByIdx.get(i);
    const score = hit ? hit.score : null;
    return {
      ...c,
      score,
      recencyDays: hit ? hit.days : daysBetween(c.lastVisitAt, nowIso),
      segment: segmentFor(score, c.visits),
    };
  });
}

/**
 * The shop's typical gap between visits, in days: the median over repeat
 * customers of (last − first) / (visits − 1). Used as the PRIOR for a customer
 * who has only visited once (Klaviyo does the same: it predicts from the
 * individual's cadence when it has one, and from similar customers when not).
 * Null when no customer has visited twice.
 */
export function storeTypicalGapDays(rollups: readonly CustomerRollup[]): number | null {
  const gaps: number[] = [];
  for (const c of rollups) {
    if (c.visits < 2) continue;
    const span = daysBetween(c.firstVisitAt, c.lastVisitAt);
    if (span === null || span <= 0) continue;
    gaps.push(span / (c.visits - 1));
  }
  const m = median(gaps);
  return m === null ? null : Math.max(1, Math.round(m));
}

// ---------------------------------------------------------------------------
// Population summary (the intelligence dashboard)
// ---------------------------------------------------------------------------

export type SegmentSummaryRow = SegmentInfo & {
  customers: number;
  netSpendMinor: number;
  /** Share of all scored customers' spend, 0..1. */
  spendShare: number;
  avgVisits: number;
};

export type PopulationSummary = {
  totalCustomers: number;
  /** Customers with at least one linked purchase. */
  buyers: number;
  /** Buyers with 2+ visits. */
  repeatBuyers: number;
  /** repeatBuyers / buyers, or null with no buyers. */
  repeatRate: number | null;
  /** Buyers whose last visit is within ACTIVE_WINDOW_DAYS. */
  activeBuyers: number;
  netSpendMinor: number;
  avgSpendPerBuyerMinor: number;
  avgVisitsPerBuyer: number;
  typicalGapDays: number | null;
  confidence: SegmentConfidence;
  segments: SegmentSummaryRow[];
  /** Top-20% of buyers by spend: their share of all buyers' spend (Pareto check). */
  top20SpendShare: number | null;
};

export const ACTIVE_WINDOW_DAYS = 90;

export function summarizePopulation(scored: readonly ScoredCustomer[]): PopulationSummary {
  const buyers = scored.filter((c) => c.visits > 0);
  const netSpend = buyers.reduce((s, c) => s + Math.max(0, c.netSpendMinor), 0);
  const repeat = buyers.filter((c) => c.visits >= 2).length;
  const active = buyers.filter((c) => c.recencyDays !== null && c.recencyDays <= ACTIVE_WINDOW_DAYS).length;
  const totalVisits = buyers.reduce((s, c) => s + c.visits, 0);

  const segments: SegmentSummaryRow[] = SEGMENTS.map((info) => {
    const members = scored.filter((c) => c.segment === info.key);
    const spend = members.reduce((s, c) => s + Math.max(0, c.netSpendMinor), 0);
    const visits = members.reduce((s, c) => s + c.visits, 0);
    return {
      ...info,
      customers: members.length,
      netSpendMinor: spend,
      spendShare: netSpend > 0 ? spend / netSpend : 0,
      avgVisits: members.length > 0 ? visits / members.length : 0,
    };
  });

  let top20: number | null = null;
  if (buyers.length > 0 && netSpend > 0) {
    const spends = buyers.map((c) => Math.max(0, c.netSpendMinor)).sort((a, b) => b - a);
    const k = Math.max(1, Math.ceil(spends.length * 0.2));
    top20 = spends.slice(0, k).reduce((s, v) => s + v, 0) / netSpend;
  }

  return {
    totalCustomers: scored.length,
    buyers: buyers.length,
    repeatBuyers: repeat,
    repeatRate: buyers.length > 0 ? repeat / buyers.length : null,
    activeBuyers: active,
    netSpendMinor: netSpend,
    avgSpendPerBuyerMinor: buyers.length > 0 ? Math.round(netSpend / buyers.length) : 0,
    avgVisitsPerBuyer: buyers.length > 0 ? totalVisits / buyers.length : 0,
    typicalGapDays: storeTypicalGapDays(buyers),
    confidence: segmentConfidence(buyers.length),
    segments,
    top20SpendShare: top20,
  };
}

/** Where one customer sits by spend among buyers: 0.97 = "top 3%". Null for non-buyers. */
export function spendPercentile(customer: CustomerRollup, population: readonly CustomerRollup[]): number | null {
  if (customer.visits <= 0) return null;
  const buyers = population.filter((c) => c.visits > 0);
  if (buyers.length === 0) return null;
  const me = Math.max(0, customer.netSpendMinor);
  const below = buyers.filter((c) => Math.max(0, c.netSpendMinor) < me).length;
  const equal = buyers.filter((c) => Math.max(0, c.netSpendMinor) === me).length;
  return (below + equal / 2) / buyers.length;
}

/** "Top 3%" / "Top 40%" / "Bottom half" — how a percentile reads to a human. */
export function percentileLabel(p: number | null): string | null {
  if (p === null || !Number.isFinite(p)) return null;
  const top = Math.max(1, Math.round((1 - p) * 100));
  if (top <= 50) return `Top ${top}%`;
  return "Bottom half";
}

// ---------------------------------------------------------------------------
// Identification rate — the KPI every loyalty platform leads with
// ---------------------------------------------------------------------------

/**
 * Share of completed sales that are linked to a customer. Every insight on the
 * customer pages is only as complete as this number. Null with no sales.
 */
export function identificationRate(linkedSales: number, allSales: number): number | null {
  if (!Number.isFinite(allSales) || allSales <= 0) return null;
  const linked = Math.max(0, Math.min(allSales, linkedSales));
  return linked / allSales;
}

export function identificationAdvice(rate: number | null): string {
  if (rate === null) return "No completed sales in this window yet.";
  const pct = Math.round(rate * 100);
  if (rate >= 0.7)
    return `${pct}% of sales are linked to a customer. That's excellent coverage, so these insights reflect most of your business.`;
  if (rate >= 0.4)
    return `${pct}% of sales are linked to a customer. Good, but every unlinked sale is invisible here. Keep attaching members at the register.`;
  return `Only ${pct}% of sales are linked to a customer. The insights below cover a small slice of your business. Attaching a member (or signing them up) on every sale is the single biggest improvement.`;
}

// ---------------------------------------------------------------------------
// Stock watch — "stock what they like"
// ---------------------------------------------------------------------------

/** One regular's repeat purchase of one product (a staple). */
export type StapleSignal = {
  customerId: string;
  productKey: string;
  productName: string;
  /** Distinct days they bought it. */
  purchaseDays: number;
  /** Their typical gap between buys of it, days (null with <2 buy days). */
  typicalGapDays: number | null;
  /** Days since they last bought it. */
  daysSinceLast: number | null;
  /** Their segment — champions/loyal weigh more. */
  segment: SegmentKey;
};

export type StockStatus = "in-stock" | "low-stock" | "unavailable" | "not-on-menu";

export type StockWatchRow = {
  productKey: string;
  productName: string;
  stockStatus: StockStatus;
  /** Regulars (2+ buy days) for whom this is a staple. */
  regulars: number;
  /** Of those, champions / loyal / can't-lose (your most valuable). */
  valuableRegulars: number;
  /** Regulars expected to want it again within DUE_WINDOW_DAYS. */
  dueSoon: number;
  /** Median gap across regulars, days. */
  typicalGapDays: number | null;
  urgency: "reorder_now" | "watch" | "ok";
  reason: string;
};

export const DUE_WINDOW_DAYS = 14;
const VALUABLE: ReadonlySet<SegmentKey> = new Set<SegmentKey>(["champions", "loyal", "cant_lose"]);

export function normalizeStockStatus(raw: string | null | undefined, onMenu: boolean): StockStatus {
  if (!onMenu) return "not-on-menu";
  const s = (raw ?? "").trim().toLowerCase();
  if (s === "unavailable" || s === "out-of-stock" || s === "sold-out") return "unavailable";
  if (s === "low-stock") return "low-stock";
  return "in-stock";
}

/**
 * Roll staple signals up per product and rank what needs stocking. A product
 * matters here only when at least one customer has bought it on 2+ separate
 * days — a repeat purchase is the strongest demand signal a shop has.
 */
export function buildStockWatch(
  signals: readonly StapleSignal[],
  stockByProduct: ReadonlyMap<string, StockStatus>,
): StockWatchRow[] {
  const byProduct = new Map<string, StapleSignal[]>();
  for (const s of signals) {
    if (s.purchaseDays < 2) continue;
    const list = byProduct.get(s.productKey) ?? [];
    list.push(s);
    byProduct.set(s.productKey, list);
  }
  const rows: StockWatchRow[] = [];
  for (const [key, list] of byProduct) {
    const customers = new Set(list.map((s) => s.customerId));
    const valuable = new Set(list.filter((s) => VALUABLE.has(s.segment)).map((s) => s.customerId));
    const due = new Set(
      list
        .filter(
          (s) =>
            s.typicalGapDays !== null &&
            s.daysSinceLast !== null &&
            s.typicalGapDays - s.daysSinceLast <= DUE_WINDOW_DAYS,
        )
        .map((s) => s.customerId),
    );
    const gap = median(list.map((s) => s.typicalGapDays).filter((g): g is number => g !== null));
    const status = stockByProduct.get(key) ?? "not-on-menu";
    const name = list[0].productName;
    let urgency: StockWatchRow["urgency"] = "ok";
    let reason: string;
    const who = `${customers.size} regular${customers.size === 1 ? "" : "s"}`;
    const every = gap !== null ? ` about every ${Math.round(gap)} day${Math.round(gap) === 1 ? "" : "s"}` : "";
    if (status === "unavailable" || status === "not-on-menu") {
      urgency = due.size > 0 || valuable.size > 0 ? "reorder_now" : "watch";
      reason = `${who} buy this${every}, and it is ${status === "unavailable" ? "out of stock" : "no longer on the menu"}.${
        due.size > 0 ? ` ${due.size} of them are due back within ${DUE_WINDOW_DAYS} days.` : ""
      }`;
    } else if (status === "low-stock") {
      urgency = due.size > 0 ? "reorder_now" : "watch";
      reason = `${who} buy this${every}, and stock is low.${
        due.size > 0 ? ` ${due.size} of them are due back within ${DUE_WINDOW_DAYS} days.` : ""
      }`;
    } else {
      reason = `${who} buy this${every}. In stock.`;
    }
    rows.push({
      productKey: key,
      productName: name,
      stockStatus: status,
      regulars: customers.size,
      valuableRegulars: valuable.size,
      dueSoon: due.size,
      typicalGapDays: gap === null ? null : Math.round(gap),
      urgency,
      reason,
    });
  }
  const rank = { reorder_now: 0, watch: 1, ok: 2 } as const;
  return rows.sort(
    (a, b) =>
      rank[a.urgency] - rank[b.urgency] ||
      b.valuableRegulars - a.valuableRegulars ||
      b.dueSoon - a.dueSoon ||
      b.regulars - a.regulars ||
      a.productName.localeCompare(b.productName),
  );
}

// ---------------------------------------------------------------------------
// Store-wide helpers for the intelligence dashboard
// ---------------------------------------------------------------------------

function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** One product bought by one customer on one Pacific day (YYYY-MM-DD). */
export type ProductDay = { customerId: string; productKey: string; productName: string; dayKey: string };

/**
 * Turn raw purchase-days into per-customer staple signals: distinct buy days,
 * median gap between them, days since the last one. Only customers who bought
 * the product on 2+ separate days are returned (a repeat buy is the signal).
 */
export function stapleSignalsFromProductDays(
  rows: readonly ProductDay[],
  todayKey: string,
  segmentByCustomer: ReadonlyMap<string, SegmentKey>,
): StapleSignal[] {
  const groups = new Map<string, { customerId: string; productKey: string; productName: string; days: Set<string> }>();
  for (const r of rows) {
    if (!r.customerId || !r.productKey || !/^\d{4}-\d{2}-\d{2}$/.test(r.dayKey)) continue;
    const k = `${r.customerId}\u0000${r.productKey}`;
    const g = groups.get(k) ?? { customerId: r.customerId, productKey: r.productKey, productName: r.productName, days: new Set<string>() };
    g.days.add(r.dayKey);
    groups.set(k, g);
  }
  const out: StapleSignal[] = [];
  for (const g of groups.values()) {
    if (g.days.size < 2) continue;
    const ds = [...g.days].sort();
    const gaps: number[] = [];
    for (let i = 1; i < ds.length; i++) gaps.push(dayDiff(ds[i - 1], ds[i]));
    const m = median(gaps);
    out.push({
      customerId: g.customerId,
      productKey: g.productKey,
      productName: g.productName,
      purchaseDays: ds.length,
      typicalGapDays: m === null ? null : Math.max(1, Math.round(m)),
      daysSinceLast: Math.max(0, dayDiff(ds[ds.length - 1], todayKey)),
      segment: segmentByCustomer.get(g.customerId) ?? "none",
    });
  }
  return out;
}

/** Spend attributed to a label (brand / category / …) by one customer. */
export type LabelSpend = { customerId: string; label: string; spendMinor: number };

export type PreferenceLiftRow = {
  label: string;
  /** Share of the GROUP's spend that went to this label, 0..1. */
  groupShare: number;
  /** Share of EVERYONE's spend that went to this label, 0..1. */
  allShare: number;
  /** groupShare / allShare. >1 = the group over-indexes on it. null when allShare is 0. */
  lift: number | null;
  groupCustomers: number;
};

/**
 * "What do my best customers buy that everyone else doesn't?" — the
 * over-index view retail analytics uses for assortment decisions. Returns the
 * group's top labels by their share of the group's spend, with the lift vs
 * the whole base.
 */
export function preferenceLift(rows: readonly LabelSpend[], group: ReadonlySet<string>, limit = 8): PreferenceLiftRow[] {
  const all = new Map<string, number>();
  const grp = new Map<string, number>();
  const grpCustomers = new Map<string, Set<string>>();
  let allTotal = 0;
  let grpTotal = 0;
  for (const r of rows) {
    const label = (r.label ?? "").trim();
    const v = Math.max(0, Math.round(r.spendMinor));
    if (!label || v <= 0) continue;
    all.set(label, (all.get(label) ?? 0) + v);
    allTotal += v;
    if (group.has(r.customerId)) {
      grp.set(label, (grp.get(label) ?? 0) + v);
      grpTotal += v;
      const set = grpCustomers.get(label) ?? new Set<string>();
      set.add(r.customerId);
      grpCustomers.set(label, set);
    }
  }
  if (grpTotal <= 0 || allTotal <= 0) return [];
  return [...grp.entries()]
    .map(([label, v]) => {
      const groupShare = v / grpTotal;
      const allShare = (all.get(label) ?? 0) / allTotal;
      return { label, groupShare, allShare, lift: allShare > 0 ? groupShare / allShare : null, groupCustomers: grpCustomers.get(label)?.size ?? 0 };
    })
    .sort((a, b) => b.groupShare - a.groupShare || a.label.localeCompare(b.label))
    .slice(0, Math.max(0, limit));
}

export type DueCustomer = {
  customerId: string;
  segment: SegmentKey;
  visits: number;
  netSpendMinor: number;
  lastVisitAt: string;
  /** Their own average days between visits. */
  gapDays: number;
  /** Negative = overdue by that many days. */
  dueInDays: number;
};

/**
 * Repeat customers (2+ visits) grouped by when they should be back, from
 * their OWN rhythm: (last − first) / (visits − 1). `dueSoon` = expected within
 * `windowDays`; `overdue` = past 1.25× their gap but not yet 2.5× (the
 * win-back zone — past that they are treated as lapsed and left to the
 * segment lists, matching customer-insights-core's cadence rules).
 */
export function dueAndOverdue(
  rollups: readonly (CustomerRollup & { segment?: SegmentKey })[],
  nowIso: string,
  windowDays = 7,
): { dueSoon: DueCustomer[]; overdue: DueCustomer[] } {
  const dueSoon: DueCustomer[] = [];
  const overdue: DueCustomer[] = [];
  for (const c of rollups) {
    if (c.visits < 2 || !c.lastVisitAt) continue;
    const span = daysBetween(c.firstVisitAt, c.lastVisitAt);
    const since = daysBetween(c.lastVisitAt, nowIso);
    if (span === null || span <= 0 || since === null) continue;
    const gap = Math.max(1, Math.round(span / (c.visits - 1)));
    const row: DueCustomer = {
      customerId: c.customerId,
      segment: c.segment ?? "none",
      visits: c.visits,
      netSpendMinor: c.netSpendMinor,
      lastVisitAt: c.lastVisitAt,
      gapDays: gap,
      dueInDays: gap - since,
    };
    if (since > gap * 1.25 && since <= gap * 2.5 && since <= 180) overdue.push(row);
    else if (since <= gap * 1.25 && row.dueInDays <= windowDays) dueSoon.push(row);
  }
  dueSoon.sort((a, b) => a.dueInDays - b.dueInDays || b.netSpendMinor - a.netSpendMinor);
  overdue.sort((a, b) => b.netSpendMinor - a.netSpendMinor || a.dueInDays - b.dueInDays);
  return { dueSoon, overdue };
}

// ---------------------------------------------------------------------------
// Embedded self-tests
// ---------------------------------------------------------------------------

export function __runCustomerSegmentsCoreTests(): { passed: number; failed: number; messages: string[] } {
  let passed = 0;
  let failed = 0;
  const messages: string[] = [];
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      messages.push(`FAIL: ${msg}`);
    }
  };
  const NOW = "2026-06-01T20:00:00Z";

  // daysBetween / median
  ok(daysBetween("2026-05-01T20:00:00Z", NOW) === 31, "daysBetween: 31 days");
  ok(daysBetween("2026-06-01T08:00:00Z", NOW) === 0, "daysBetween: same day floors to 0");
  ok(daysBetween(null, NOW) === null && daysBetween("garbage", NOW) === null, "daysBetween: unusable -> null");
  ok(daysBetween("2026-07-01T00:00:00Z", NOW) === 0, "daysBetween: future clamps to 0");
  ok(median([]) === null, "median: empty -> null");
  ok(median([5, 1, 3]) === 3, "median: odd");
  ok(median([4, 1, 3, 2]) === 2.5, "median: even averages the middle two");

  // quintileScores
  const q = quintileScores([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], true);
  ok(q[0] === 1 && q[9] === 5, "quintile: extremes 1 and 5");
  ok(q[4] === 3 && q[5] === 3, "quintile: middle values score 3");
  const qr = quintileScores([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], false);
  ok(qr[0] === 5 && qr[9] === 1, "quintile: lower-is-better flips the scale");
  const ties = quintileScores([1, 1, 1, 1, 1, 1, 1, 5, 9, 12], true);
  ok(ties.slice(0, 7).every((s) => s === ties[0]), "quintile: ties get the same score");
  ok(ties[0] === 2, "quintile: 70% pile-up at the bottom lands on 2 (mid-rank 0.35)");
  ok(ties[9] === 5, "quintile: top value scores 5");
  ok(quintileScores([], true).length === 0, "quintile: empty");
  ok(quintileScores([42], true)[0] === 3, "quintile: single value scores 3");
  ok(quintileScores([7, 7, 7], false).every((s) => s === 3), "quintile: all-equal scores 3");

  // segmentFor — every rule, in order
  ok(segmentFor(null, 0) === "none", "segment: no score -> none");
  ok(segmentFor({ r: 5, f: 5, m: 5 }, 0) === "none", "segment: zero visits -> none");
  ok(segmentFor({ r: 5, f: 5, m: 5 }, 9) === "champions", "segment: 555 champions");
  ok(segmentFor({ r: 4, f: 4, m: 4 }, 9) === "champions", "segment: 444 champions");
  ok(segmentFor({ r: 2, f: 5, m: 5 }, 9) === "cant_lose", "segment: 255 can't lose");
  ok(segmentFor({ r: 1, f: 4, m: 4 }, 9) === "cant_lose", "segment: 144 can't lose");
  ok(segmentFor({ r: 3, f: 4, m: 2 }, 9) === "loyal", "segment: 342 loyal");
  ok(segmentFor({ r: 5, f: 4, m: 3 }, 9) === "loyal", "segment: 543 loyal (not champion: m 3)");
  ok(segmentFor({ r: 2, f: 4, m: 2 }, 9) === "at_risk", "segment: 242 at risk");
  ok(segmentFor({ r: 1, f: 3, m: 5 }, 4) === "at_risk", "segment: 135 at risk");
  ok(segmentFor({ r: 5, f: 2, m: 1 }, 1) === "new", "segment: recent single visit -> new");
  ok(segmentFor({ r: 5, f: 2, m: 1 }, 2) === "potential_loyalist", "segment: recent 2 visits -> potential loyalist");
  ok(segmentFor({ r: 4, f: 3, m: 5 }, 3) === "potential_loyalist", "segment: 435 potential loyalist");
  ok(segmentFor({ r: 3, f: 2, m: 5 }, 2) === "big_spender", "segment: 325 big spender");
  ok(segmentFor({ r: 3, f: 2, m: 3 }, 2) === "needs_attention", "segment: 323 needs attention");
  ok(segmentFor({ r: 2, f: 2, m: 5 }, 2) === "about_to_sleep", "segment: 225 about to sleep");
  ok(segmentFor({ r: 1, f: 1, m: 1 }, 1) === "lost", "segment: 111 lost");
  ok(segmentFor({ r: 1, f: 2, m: 3 }, 1) === "lost", "segment: 123 lost");
  // Exhaustive: every combination maps to a real segment, never 'none'.
  let exhaustive = true;
  for (let r = 1; r <= 5; r++)
    for (let f = 1; f <= 5; f++)
      for (let m = 1; m <= 5; m++) {
        const s = segmentFor({ r, f, m }, 3);
        if (s === "none" || !SEGMENTS.some((x) => x.key === s)) exhaustive = false;
      }
  ok(exhaustive, "segment: all 125 score combinations land in a real segment");
  ok(SEGMENTS.length === 11 && new Set(SEGMENTS.map((s) => s.key)).size === 11, "segments: 11 unique");
  ok(SEGMENTS.every((s) => s.meaning.length > 10 && s.action.length > 10), "segments: every one has meaning + action");
  ok(segmentInfo("champions").label === "Champions", "segmentInfo lookup");

  // confidence
  ok(segmentConfidence(0) === "early" && segmentConfidence(49) === "early", "confidence: <50 early");
  ok(segmentConfidence(50) === "building" && segmentConfidence(199) === "building", "confidence: 50-199 building");
  ok(segmentConfidence(200) === "solid", "confidence: 200 solid");

  // scorePopulation
  const pop: CustomerRollup[] = [
    { customerId: "a", visits: 20, netSpendMinor: 200000, firstVisitAt: "2025-06-01T20:00:00Z", lastVisitAt: "2026-05-30T20:00:00Z" },
    { customerId: "b", visits: 1, netSpendMinor: 3000, firstVisitAt: "2026-05-29T20:00:00Z", lastVisitAt: "2026-05-29T20:00:00Z" },
    { customerId: "c", visits: 15, netSpendMinor: 150000, firstVisitAt: "2025-01-01T20:00:00Z", lastVisitAt: "2025-12-01T20:00:00Z" },
    { customerId: "d", visits: 0, netSpendMinor: 0, firstVisitAt: null, lastVisitAt: null },
    { customerId: "e", visits: 2, netSpendMinor: 5000, firstVisitAt: "2025-10-01T20:00:00Z", lastVisitAt: "2025-11-01T20:00:00Z" },
  ];
  const scored = scorePopulation(pop, NOW);
  const by = new Map(scored.map((s) => [s.customerId, s]));
  ok(by.get("d")!.segment === "none" && by.get("d")!.score === null, "population: non-buyer unscored");
  ok(by.get("a")!.segment === "champions", "population: frequent recent big spender is a champion");
  ok(by.get("b")!.segment === "new", "population: recent first-timer is new");
  ok(by.get("c")!.segment === "cant_lose", "population: lapsed big regular is can't lose");
  ok(by.get("a")!.recencyDays === 2, "population: recency days carried");
  ok(scored.length === pop.length, "population: every input returned");

  // storeTypicalGapDays
  ok(storeTypicalGapDays(pop) !== null, "gap: repeat customers produce a gap");
  ok(
    storeTypicalGapDays([
      { customerId: "x", visits: 3, netSpendMinor: 1, firstVisitAt: "2026-01-01T00:00:00Z", lastVisitAt: "2026-01-21T00:00:00Z" },
    ]) === 10,
    "gap: 20 days over 2 gaps = 10",
  );
  ok(storeTypicalGapDays([{ customerId: "y", visits: 1, netSpendMinor: 1, firstVisitAt: NOW, lastVisitAt: NOW }]) === null, "gap: no repeaters -> null");
  ok(
    storeTypicalGapDays([
      { customerId: "z", visits: 5, netSpendMinor: 1, firstVisitAt: "2026-01-01T00:00:00Z", lastVisitAt: "2026-01-01T05:00:00Z" },
    ]) === null,
    "gap: same-day repeaters (zero span) ignored",
  );

  // summarizePopulation
  const sum = summarizePopulation(scored);
  ok(sum.totalCustomers === 5 && sum.buyers === 4, "summary: totals");
  ok(sum.repeatBuyers === 3 && sum.repeatRate === 0.75, "summary: repeat rate 3/4");
  ok(sum.netSpendMinor === 358000, "summary: net spend sums buyers");
  ok(sum.avgSpendPerBuyerMinor === 89500, "summary: avg spend per buyer");
  ok(sum.activeBuyers === 2, "summary: active within 90 days");
  ok(sum.segments.length === SEGMENTS.length, "summary: one row per segment");
  ok(sum.segments.reduce((s, r) => s + r.customers, 0) === 5, "summary: segment counts add up to all customers");
  ok(sum.confidence === "early", "summary: 4 buyers is early");
  ok(sum.top20SpendShare !== null && Math.abs(sum.top20SpendShare - 200000 / 358000) < 1e-9, "summary: top-20% share (1 of 4 buyers)");
  const empty = summarizePopulation([]);
  ok(empty.buyers === 0 && empty.repeatRate === null && empty.top20SpendShare === null, "summary: empty is honest");
  ok(
    summarizePopulation(scorePopulation([{ customerId: "neg", visits: 1, netSpendMinor: -500, firstVisitAt: NOW, lastVisitAt: NOW }], NOW)).netSpendMinor === 0,
    "summary: negative net spend (refund > spend) clamps to 0",
  );

  // spendPercentile / label
  ok(spendPercentile(pop[0], pop) === 0.875, "percentile: top of 4 buyers = 0.875");
  ok(spendPercentile(pop[3], pop) === null, "percentile: non-buyer null");
  ok(percentileLabel(0.97) === "Top 3%", "percentile label: top 3%");
  ok(percentileLabel(0.3) === "Bottom half", "percentile label: bottom half");
  ok(percentileLabel(0.9999) === "Top 1%", "percentile label: floors at top 1%");
  ok(percentileLabel(null) === null, "percentile label: null");

  // identification
  ok(identificationRate(30, 100) === 0.3, "id rate: 30%");
  ok(identificationRate(5, 0) === null, "id rate: no sales -> null");
  ok(identificationRate(150, 100) === 1, "id rate: clamped to 100%");
  ok(identificationAdvice(0.3).startsWith("Only 30%"), "id advice: low");
  ok(identificationAdvice(0.5).startsWith("50%") && identificationAdvice(0.5).includes("Good"), "id advice: medium");
  ok(identificationAdvice(0.8).includes("excellent"), "id advice: high");
  ok(identificationAdvice(null).startsWith("No completed sales"), "id advice: none");

  // stock watch
  ok(normalizeStockStatus("unavailable", true) === "unavailable", "stock: unavailable");
  ok(normalizeStockStatus("low-stock", true) === "low-stock", "stock: low");
  ok(normalizeStockStatus("in-stock", true) === "in-stock", "stock: in");
  ok(normalizeStockStatus("in-stock", false) === "not-on-menu", "stock: off menu wins");
  const signals: StapleSignal[] = [
    { customerId: "a", productKey: "p1", productName: "Blue Dream 3.5g", purchaseDays: 5, typicalGapDays: 14, daysSinceLast: 10, segment: "champions" },
    { customerId: "c", productKey: "p1", productName: "Blue Dream 3.5g", purchaseDays: 3, typicalGapDays: 20, daysSinceLast: 90, segment: "cant_lose" },
    { customerId: "e", productKey: "p2", productName: "Gummies", purchaseDays: 2, typicalGapDays: 30, daysSinceLast: 5, segment: "about_to_sleep" },
    { customerId: "b", productKey: "p3", productName: "One-off", purchaseDays: 1, typicalGapDays: null, daysSinceLast: 2, segment: "new" },
    { customerId: "e", productKey: "p4", productName: "Low vape", purchaseDays: 2, typicalGapDays: 10, daysSinceLast: 8, segment: "about_to_sleep" },
  ];
  const stock = new Map<string, StockStatus>([
    ["p1", "unavailable"],
    ["p2", "in-stock"],
    ["p4", "low-stock"],
  ]);
  const watch = buildStockWatch(signals, stock);
  ok(watch.length === 3, "watch: single-day buys are not staples");
  ok(watch[0].productKey === "p1" && watch[0].urgency === "reorder_now", "watch: out-of-stock staple of valuable regulars first");
  ok(watch[0].regulars === 2 && watch[0].valuableRegulars === 2, "watch: regulars and valuable counted");
  ok(watch[0].dueSoon === 2, "watch: overdue regulars count as due");
  ok(watch[0].typicalGapDays === 17, "watch: median gap across regulars");
  ok(watch[0].reason.includes("out of stock"), "watch: reason names the stock problem");
  const low = watch.find((w) => w.productKey === "p4")!;
  ok(low.urgency === "reorder_now" && low.reason.includes("stock is low"), "watch: low stock + due -> reorder now");
  const inStock = watch.find((w) => w.productKey === "p2")!;
  ok(inStock.urgency === "ok" && inStock.reason.endsWith("In stock."), "watch: in-stock staple is ok");
  ok(watch[watch.length - 1].urgency === "ok", "watch: ok rows sort last");
  const offMenu = buildStockWatch([{ ...signals[2], productKey: "gone", daysSinceLast: 20 }], new Map());
  ok(offMenu[0].stockStatus === "not-on-menu" && offMenu[0].urgency === "reorder_now", "watch: off-menu staple due soon -> reorder");
  ok(offMenu[0].reason.includes("no longer on the menu"), "watch: off-menu reason");
  const notDue = buildStockWatch(
    [{ customerId: "q", productKey: "x", productName: "X", purchaseDays: 2, typicalGapDays: 60, daysSinceLast: 1, segment: "lost" }],
    new Map([["x", "unavailable"]]),
  );
  ok(notDue[0].urgency === "watch", "watch: out of stock but nobody due and not valuable -> watch");

  // stapleSignalsFromProductDays
  const pd: ProductDay[] = [
    { customerId: "a", productKey: "p1", productName: "Blue Dream", dayKey: "2026-05-01" },
    { customerId: "a", productKey: "p1", productName: "Blue Dream", dayKey: "2026-05-01" }, // same day twice
    { customerId: "a", productKey: "p1", productName: "Blue Dream", dayKey: "2026-05-11" },
    { customerId: "a", productKey: "p1", productName: "Blue Dream", dayKey: "2026-05-25" },
    { customerId: "b", productKey: "p1", productName: "Blue Dream", dayKey: "2026-05-20" }, // one day only
    { customerId: "c", productKey: "p2", productName: "Gummies", dayKey: "bad" },
  ];
  const sig = stapleSignalsFromProductDays(pd, "2026-06-01", new Map([["a", "champions" as SegmentKey]]));
  ok(sig.length === 1, "staple signals: one-day buyers and bad days dropped");
  ok(sig[0].purchaseDays === 3, "staple signals: same-day duplicates count once");
  ok(sig[0].typicalGapDays === 12, "staple signals: median of 10 and 14 = 12");
  ok(sig[0].daysSinceLast === 7, "staple signals: May 25 -> Jun 1 = 7");
  ok(sig[0].segment === "champions", "staple signals: segment carried");
  ok(stapleSignalsFromProductDays(pd, "2026-06-01", new Map())[0].segment === "none", "staple signals: unknown segment -> none");

  // preferenceLift
  const ls: LabelSpend[] = [
    { customerId: "a", label: "Wyld", spendMinor: 6000 },
    { customerId: "a", label: "Phat Panda", spendMinor: 4000 },
    { customerId: "b", label: "Phat Panda", spendMinor: 9000 },
    { customerId: "c", label: "Phat Panda", spendMinor: 1000 },
    { customerId: "c", label: " ", spendMinor: 500 },
    { customerId: "c", label: "Zero", spendMinor: 0 },
  ];
  const lift = preferenceLift(ls, new Set(["a"]));
  ok(lift.length === 2 && lift[0].label === "Wyld", "lift: group's top label first");
  ok(Math.abs(lift[0].groupShare - 0.6) < 1e-9 && Math.abs(lift[0].allShare - 0.3) < 1e-9, "lift: shares 60% vs 30%");
  ok(Math.abs((lift[0].lift ?? 0) - 2) < 1e-9, "lift: 2x over-index");
  ok(Math.abs((lift[1].lift ?? 0) - 0.4 / 0.7) < 1e-9, "lift: under-index below 1");
  ok(lift[0].groupCustomers === 1, "lift: group customer count");
  ok(preferenceLift(ls, new Set(["nobody"])).length === 0, "lift: empty group -> []");
  ok(preferenceLift(ls, new Set(["a", "b", "c"]), 1).length === 1, "lift: limit respected");

  // dueAndOverdue (NOW = 2026-06-01T20:00Z)
  const due = dueAndOverdue(
    [
      { customerId: "soon", visits: 5, netSpendMinor: 100, firstVisitAt: "2026-04-01T20:00:00Z", lastVisitAt: "2026-05-21T20:00:00Z" }, // span 50/4 = 12.5 -> 13; since 11 -> due in 2
      { customerId: "later", visits: 3, netSpendMinor: 100, firstVisitAt: "2026-03-01T20:00:00Z", lastVisitAt: "2026-05-30T20:00:00Z" }, // gap 45; since 2 -> due in 43
      { customerId: "over", visits: 4, netSpendMinor: 900, firstVisitAt: "2026-03-01T20:00:00Z", lastVisitAt: "2026-04-01T20:00:00Z" }, // span 31/3 -> 10; since 61 -> lapsed (>2.5x)
      { customerId: "win", visits: 3, netSpendMinor: 500, firstVisitAt: "2026-03-02T20:00:00Z", lastVisitAt: "2026-04-21T20:00:00Z" }, // span 50/2 = 25; since 41 -> 1.64x overdue
      { customerId: "once", visits: 1, netSpendMinor: 50, firstVisitAt: "2026-05-01T20:00:00Z", lastVisitAt: "2026-05-01T20:00:00Z" },
      { customerId: "sameday", visits: 2, netSpendMinor: 50, firstVisitAt: "2026-05-01T20:00:00Z", lastVisitAt: "2026-05-01T21:00:00Z" },
    ],
    NOW,
  );
  ok(due.dueSoon.length === 1 && due.dueSoon[0].customerId === "soon", "due: only the customer expected within 7 days");
  ok(due.dueSoon[0].gapDays === 13 && due.dueSoon[0].dueInDays === 2, "due: gap 13, due in 2");
  ok(due.overdue.length === 1 && due.overdue[0].customerId === "win", "due: overdue = win-back zone only (lapsed excluded)");
  ok(due.overdue[0].dueInDays === 25 - 41, "due: overdue by 16 days");
  ok(!due.dueSoon.concat(due.overdue).some((d) => d.customerId === "once" || d.customerId === "sameday"), "due: one-visit / zero-span customers skipped");

  return { passed, failed, messages };
}
