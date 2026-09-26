/**
 * src/lib/customers/customer-insights-core.ts  (Slice 3 — customer intelligence)
 *
 * PURE. No I/O, no database, no clock (every "now" is passed in). Safe for the
 * tsx self-test harness and vitest.
 *
 * WHAT THIS FILE DOES
 * -------------------
 * Turns ONE customer's real purchase history into the profile an owner
 * actually wants: how often they come, what they spend, what they like (brand,
 * vendor, category, strain type, product, potency, price tier), how they shop
 * (day, time, channel, deals), whether they are due back or slipping away,
 * what to have in stock for them, and a short list of plain-English insights
 * with the single next best action on top.
 *
 * WHERE EACH IDEA COMES FROM (researched, not invented)
 * -----------------------------------------------------
 *   - Next-visit date from the customer's OWN cadence, falling back to the
 *     shop's typical cadence for a one-time buyer: Klaviyo's predicted next
 *     order date works the same way, and times win-backs to the moment a
 *     customer is overdue on their own rhythm.
 *   - Churn risk as "how overdue are they relative to their own rhythm": the
 *     intuition behind BG/NBD's P(alive) (a long silence from a frequent buyer
 *     means more than the same silence from a rare one), made explainable
 *     instead of a black-box probability.
 *   - Favorites / basket / deal / time-of-day analysis: Headset's retailer
 *     marketing module (basket analysis, discount analysis, hourly and weekday
 *     analysis) and the cannabis CRMs (Alpine IQ, Springbig) that segment on
 *     "what customers frequently buy".
 *   - Birthday outreach and loyalty balance nudges: standard cannabis-CRM
 *     automations (Alpine IQ / Springbig).
 *
 * HONESTY RULES
 * -------------
 *   - A number is shown only when the data supports it; every prediction says
 *     what it is based on ("their own 8 visits" vs "the shop's typical gap").
 *   - Refunds are subtracted from spend (a return is negative value).
 *   - Nothing is ever invented for missing data: unknown brand stays unknown.
 *
 * Money is integer MINOR UNITS (cents) everywhere.
 */

import { pacificDayKey, pacificMonthKey, pacificParts, storeWeekday, addPacificDays } from "@/lib/reports/timezone";

// ---------------------------------------------------------------------------
// Input shapes (the server fills these from the database)
// ---------------------------------------------------------------------------

export type PurchaseChannel = "register" | "website" | "leafly";

export type LineInput = {
  /** Stable product identity: the catalog product id, or "name:<lowercased>" when there is none. */
  productKey: string;
  productName: string;
  brand: string | null;
  vendor: string | null;
  category: string | null;
  strainType: string | null;
  thcText: string | null;
  quantity: number;
  /** Final price per unit actually paid (tax-inclusive, after discounts). */
  unitPriceMinor: number;
  /** Pre-discount price per unit (null when unknown). */
  regularPriceMinor: number | null;
  /** Keypad "custom" line: counts toward money, never toward product favorites. */
  isCustom: boolean;
};

export type PurchaseInput = {
  orderId: string;
  orderNumber: string | null;
  channel: PurchaseChannel;
  /** A register sale that was the pickup of an online order: which one. */
  pickedUpFrom: "website" | "leafly" | null;
  completedAt: string | null;
  placedAt: string;
  totalMinor: number;
  savingsMinor: number;
  loyaltyDiscountMinor: number;
  lines: LineInput[];
};

export type ReturnInput = {
  orderId: string | null;
  productName: string | null;
  quantity: number;
  refundMinor: number;
  reason: string | null;
  createdAt: string;
};

/** Every online order linked to the customer, whatever happened to it. */
export type OnlineOrderInput = {
  orderId: string;
  orderNumber: string | null;
  channel: "website" | "leafly";
  status: string;
  /** Closed "cancelled" because the customer collected it at the register (slice L-37). */
  pickedUpAtRegister: boolean;
  placedAt: string;
  totalMinor: number;
};

export type LoyaltyInput = {
  balancePoints: number;
  lifetimePoints: number;
  tierName: string | null;
  pointValueMinor: number;
  minRedeemPoints: number;
  pointsEarned: number;
  pointsRedeemed: number;
  codesRedeemed: number;
  redeemedValueMinor: number;
};

export type CatalogItem = {
  productKey: string;
  name: string;
  brand: string | null;
  vendor: string | null;
  category: string | null;
  strainType: string | null;
  priceMinor: number;
  stockStatus: "in-stock" | "low-stock" | "unavailable";
};

export type InsightContext = {
  nowIso: string;
  /** The shop's median gap between visits (customer-segments-core.storeTypicalGapDays). */
  storeTypicalGapDays: number | null;
  /** Median menu price per category, for the price-tier read. */
  categoryMedianPriceMinor: Readonly<Record<string, number>>;
  birthdate: string | null;
  marketingConsent: boolean;
  doNotContact: boolean;
  /** Lifetime spend carried over from the old POS (Cultivera import). */
  importedSpendMinor: number;
  importedLastPurchaseAt: string | null;
  /** Rank labels from the population (e.g. "Top 3%"), when known. */
  spendRankLabel: string | null;
  segmentLabel: string | null;
};

// ---------------------------------------------------------------------------
// Output shapes
// ---------------------------------------------------------------------------

export type Ranked = {
  label: string;
  units: number;
  spendMinor: number;
  /** Number of separate purchases that included it. */
  visits: number;
  /** Share of the customer's attributed spend, 0..1. */
  spendShare: number;
};

export type DueStatus = "on_track" | "due_now" | "overdue" | "lapsed" | "unknown";
export type ChurnRisk = "low" | "medium" | "high" | "unknown";
export type CadenceBasis = "personal" | "store" | "none";

export type Cadence = {
  basis: CadenceBasis;
  /** Median days between visit days. */
  gapDays: number | null;
  /** How many gaps the personal cadence is based on. */
  gapsObserved: number;
  confidence: "low" | "medium" | "high" | null;
  expectedNextDay: string | null; // YYYY-MM-DD Pacific
  /** Negative = overdue by that many days. */
  daysUntilExpected: number | null;
  status: DueStatus;
  risk: ChurnRisk;
  explanation: string;
};

export type Staple = {
  productKey: string;
  productName: string;
  purchaseDays: number;
  typicalGapDays: number | null;
  daysSinceLast: number | null;
  /** Negative = overdue. */
  dueInDays: number | null;
  stockStatus: "in-stock" | "low-stock" | "unavailable" | "not-on-menu";
};

export type Recommendation = {
  productKey: string;
  name: string;
  brand: string | null;
  category: string | null;
  priceMinor: number;
  stockStatus: "in-stock" | "low-stock";
  reasons: string[];
  score: number;
};

export type Insight = {
  tone: "good" | "warn" | "risk" | "info";
  text: string;
};

export type NextBestAction = {
  kind: "restock_staple" | "win_back" | "birthday" | "enroll_loyalty" | "redeem_points" | "expect_visit" | "welcome_back" | "link_orders" | "none";
  title: string;
  detail: string;
};

export type MonthPoint = { month: string; label: string; spendMinor: number; visits: number };

export type CustomerInsights = {
  hasPurchases: boolean;
  // Money + visits
  visits: number;
  grossSpendMinor: number;
  refundsMinor: number;
  netSpendMinor: number;
  avgOrderMinor: number;
  units: number;
  avgUnitsPerVisit: number;
  firstVisitAt: string | null;
  lastVisitAt: string | null;
  tenureDays: number | null;
  daysSinceLastVisit: number | null;
  distinctVisitDays: number;
  savingsMinor: number;
  loyaltyDiscountMinor: number;
  // Trend (last 90 days vs the 90 before)
  recentSpendMinor: number;
  priorSpendMinor: number;
  recentVisits: number;
  priorVisits: number;
  spendTrendPct: number | null;
  // Prediction
  cadence: Cadence;
  // Preferences
  topCategories: Ranked[];
  topBrands: Ranked[];
  topVendors: Ranked[];
  topStrainTypes: Ranked[];
  topProducts: Ranked[];
  distinctProducts: number;
  brandLoyalty: "loyal" | "leaning" | "explorer" | "unknown";
  topBrandVisitShare: number | null;
  dealUnitShare: number | null;
  dealProfile: "deal_driven" | "mixed" | "full_price" | "unknown";
  priceTier: "value" | "mid" | "premium" | "unknown";
  priceIndex: number | null;
  medianThcPct: number | null;
  avgCategoriesPerVisit: number;
  categoryPairs: { pair: string; visits: number }[];
  // Habits
  weekdayCounts: { label: string; visits: number }[];
  favoriteWeekday: string | null;
  daypartCounts: { label: string; visits: number }[];
  favoriteDaypart: string | null;
  channelMix: { channel: PurchaseChannel | "register_pickup_website" | "register_pickup_leafly"; label: string; visits: number; spendMinor: number }[];
  onlineShare: number | null;
  // Online orders (all outcomes)
  onlineOrders: {
    website: { placed: number; fulfilled: number; cancelled: number; noShow: number; open: number };
    leafly: { placed: number; fulfilled: number; cancelled: number; noShow: number; open: number };
  };
  // Returns
  returnsCount: number;
  returnedUnits: number;
  returnRate: number | null;
  returnReasons: { label: string; count: number }[];
  // Loyalty
  loyalty: (LoyaltyInput & { balanceValueMinor: number; canRedeem: boolean }) | null;
  // Staples + recommendations
  staples: Staple[];
  recommendations: Recommendation[];
  // Series
  monthly: MonthPoint[];
  // Birthday
  daysUntilBirthday: number | null;
  // Words
  insights: Insight[];
  nextBestAction: NextBestAction;
};

// ---------------------------------------------------------------------------
// Constants + small helpers
// ---------------------------------------------------------------------------

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const DAYPARTS = ["Morning", "Afternoon", "Evening"] as const;
export const TREND_WINDOW_DAYS = 90;
/** Beyond this many days without a visit, a customer is lapsed whatever their rhythm. */
export const LAPSED_HARD_DAYS = 180;
export const TOP_N = 5;
export const STAPLE_MIN_DAYS = 2;
export const RECOMMENDATION_LIMIT = 6;
export const BIRTHDAY_WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;

function intOr0(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0;
}

function clean(s: string | null | undefined): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t.length ? t : null;
}

export function medianOf(values: readonly number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).slice().sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Whole calendar days between two Pacific day keys (b − a). */
export function dayKeyDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY_MS);
}

/** When the purchase happened: completion time, else placement time. */
export function purchaseTime(p: Pick<PurchaseInput, "completedAt" | "placedAt">): string {
  return p.completedAt && Number.isFinite(Date.parse(p.completedAt)) ? p.completedAt : p.placedAt;
}

/** "24.5%" → 24.5; "310mg" / garbage / >100 → null. */
export function parseThcPercent(text: string | null | undefined): number | null {
  if (typeof text !== "string") return null;
  const m = /(\d+(?:\.\d+)?)\s*%/.exec(text);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) && v > 0 && v <= 100 ? v : null;
}

/** Human title-case for enum-ish values: "indica" → "Indica", "unknown"/blank → null. */
export function tidyStrainType(raw: string | null | undefined): string | null {
  const t = clean(raw)?.toLowerCase() ?? null;
  if (!t || t === "unknown" || t === "n/a" || t === "none") return null;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function daypartOf(hour: number): (typeof DAYPARTS)[number] {
  if (hour < 12) return "Morning";
  if (hour < 17) return "Afternoon";
  return "Evening";
}

export function money(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minor));
  return `${sign}$${(abs / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function plural(n: number, word: string, pluralWord?: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? word : (pluralWord ?? `${word}s`)}`;
}

/** "2026-06-10" → "Jun 10". */
export function shortDayLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  if (!y || !m || !d) return dayKey;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}

/** Days until the next birthday (0 = today), Pacific calendar; null when the birthdate is unusable. */
export function daysUntilBirthday(birthdate: string | null | undefined, nowIso: string): number | null {
  if (!birthdate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthdate.trim());
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const today = pacificDayKey(nowIso);
  const year = Number(today.slice(0, 4));
  const key = (y: number) => {
    // Feb 29 birthdays celebrate on Feb 28 in non-leap years.
    const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const d = month === 2 && day === 29 && !isLeap ? 28 : day;
    return `${y}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  };
  let diff = dayKeyDiff(today, key(year));
  if (diff < 0) diff = dayKeyDiff(today, key(year + 1));
  return diff;
}

// ---------------------------------------------------------------------------
// Cadence + risk
// ---------------------------------------------------------------------------

/**
 * Predict the next visit and read the risk from the customer's rhythm.
 * `visitDays` = distinct Pacific day keys with a purchase (any order).
 */
export function computeCadence(visitDays: readonly string[], todayKey: string, storeGapDays: number | null): Cadence {
  const days = Array.from(new Set(visitDays)).sort();
  if (days.length === 0) {
    return {
      basis: "none",
      gapDays: null,
      gapsObserved: 0,
      confidence: null,
      expectedNextDay: null,
      daysUntilExpected: null,
      status: "unknown",
      risk: "unknown",
      explanation: "No purchases yet, so there is no rhythm to predict from.",
    };
  }
  const last = days[days.length - 1];
  const since = Math.max(0, dayKeyDiff(last, todayKey));
  const gaps: number[] = [];
  for (let i = 1; i < days.length; i++) gaps.push(dayKeyDiff(days[i - 1], days[i]));

  let basis: CadenceBasis;
  let gap: number | null;
  let confidence: Cadence["confidence"];
  if (gaps.length > 0) {
    basis = "personal";
    gap = Math.max(1, Math.round(medianOf(gaps) as number));
    confidence = gaps.length >= 6 ? "high" : gaps.length >= 3 ? "medium" : "low";
  } else if (storeGapDays !== null && storeGapDays > 0) {
    basis = "store";
    gap = Math.max(1, Math.round(storeGapDays));
    confidence = "low";
  } else {
    basis = "none";
    gap = null;
    confidence = null;
  }

  if (gap === null) {
    const status: DueStatus = since > LAPSED_HARD_DAYS ? "lapsed" : "unknown";
    return {
      basis,
      gapDays: null,
      gapsObserved: 0,
      confidence,
      expectedNextDay: null,
      daysUntilExpected: null,
      status,
      risk: status === "lapsed" ? "high" : "unknown",
      explanation:
        status === "lapsed"
          ? `One visit, ${plural(since, "day")} ago. That's long enough to call them lapsed.`
          : "Only one visit so far, and no repeat customers yet to learn the shop's rhythm from.",
    };
  }

  const expected = addPacificDays(last, gap);
  const until = dayKeyDiff(todayKey, expected);
  let status: DueStatus;
  if (since > LAPSED_HARD_DAYS || since > gap * 2.5) status = "lapsed";
  else if (since > gap * 1.25) status = "overdue";
  else if (since >= gap * 0.8) status = "due_now";
  else status = "on_track";
  const risk: ChurnRisk = status === "lapsed" ? "high" : status === "overdue" ? "medium" : "low";

  const basisText =
    basis === "personal"
      ? `based on their own ${plural(days.length, "visit day")}`
      : "based on the shop's typical gap, because they've only visited once";
  let explanation: string;
  if (status === "on_track") explanation = `Usually back about every ${plural(gap, "day")} (${basisText}). Next visit expected around ${shortDayLabel(expected)}.`;
  else if (status === "due_now") explanation = `Due back about now: usually every ${plural(gap, "day")}, last visit ${plural(since, "day")} ago (${basisText}).`;
  else if (status === "overdue") explanation = `Overdue: usually every ${plural(gap, "day")}, but it's been ${plural(since, "day")} (${basisText}).`;
  else explanation = `Lapsed: it's been ${plural(since, "day")} against a usual ${plural(gap, "day")} gap (${basisText}).`;

  return { basis, gapDays: gap, gapsObserved: gaps.length, confidence, expectedNextDay: expected, daysUntilExpected: until, status, risk, explanation };
}

// ---------------------------------------------------------------------------
// Ranking helpers
// ---------------------------------------------------------------------------

type Tally = { units: number; spend: number; orders: Set<string> };

function bump(map: Map<string, Tally>, key: string | null, units: number, spend: number, orderId: string) {
  if (!key) return;
  const cur = map.get(key) ?? { units: 0, spend: 0, orders: new Set<string>() };
  cur.units += units;
  cur.spend += spend;
  cur.orders.add(orderId);
  map.set(key, cur);
}

function rank(map: Map<string, Tally>, totalSpend: number, limit = TOP_N): Ranked[] {
  return [...map.entries()]
    .map(([label, t]) => ({
      label,
      units: t.units,
      spendMinor: t.spend,
      visits: t.orders.size,
      spendShare: totalSpend > 0 ? t.spend / totalSpend : 0,
    }))
    .sort((a, b) => b.spendMinor - a.spendMinor || b.units - a.units || b.visits - a.visits || a.label.localeCompare(b.label))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// The main builder
// ---------------------------------------------------------------------------

export function buildCustomerInsights(input: {
  purchases: readonly PurchaseInput[];
  returns: readonly ReturnInput[];
  onlineOrders: readonly OnlineOrderInput[];
  loyalty: LoyaltyInput | null;
  catalog: readonly CatalogItem[];
  /** Online orders whose contact info matches this customer but are not linked. */
  unlinkedMatchingOrders: number;
  context: InsightContext;
}): CustomerInsights {
  const ctx = input.context;
  const todayKey = pacificDayKey(ctx.nowIso);
  const purchases = [...input.purchases].sort((a, b) => Date.parse(purchaseTime(a)) - Date.parse(purchaseTime(b)));
  const catalogByKey = new Map(input.catalog.map((c) => [c.productKey, c]));

  // ── Money + visits ────────────────────────────────────────────────────────
  const visits = purchases.length;
  const gross = purchases.reduce((s, p) => s + Math.max(0, intOr0(p.totalMinor)), 0);
  const refunds = input.returns.reduce((s, r) => s + Math.max(0, intOr0(r.refundMinor)), 0);
  const net = gross - refunds;
  const savings = purchases.reduce((s, p) => s + Math.max(0, intOr0(p.savingsMinor)), 0);
  const loyaltyDiscount = purchases.reduce((s, p) => s + Math.max(0, intOr0(p.loyaltyDiscountMinor)), 0);
  const firstAt = visits ? purchaseTime(purchases[0]) : null;
  const lastAt = visits ? purchaseTime(purchases[visits - 1]) : null;
  const visitDayKeys = purchases.map((p) => pacificDayKey(purchaseTime(p)));
  const distinctDays = new Set(visitDayKeys).size;
  const daysSince = lastAt ? Math.max(0, dayKeyDiff(pacificDayKey(lastAt), todayKey)) : null;
  const tenure = firstAt ? Math.max(0, dayKeyDiff(pacificDayKey(firstAt), todayKey)) : null;

  // ── Trend ─────────────────────────────────────────────────────────────────
  let recentSpend = 0;
  let priorSpend = 0;
  let recentVisits = 0;
  let priorVisits = 0;
  purchases.forEach((p, i) => {
    const age = dayKeyDiff(visitDayKeys[i], todayKey);
    const amt = Math.max(0, intOr0(p.totalMinor));
    if (age >= 0 && age < TREND_WINDOW_DAYS) {
      recentSpend += amt;
      recentVisits += 1;
    } else if (age >= TREND_WINDOW_DAYS && age < TREND_WINDOW_DAYS * 2) {
      priorSpend += amt;
      priorVisits += 1;
    }
  });
  const spendTrendPct = priorSpend > 0 ? (recentSpend - priorSpend) / priorSpend : null;

  // ── Cadence ───────────────────────────────────────────────────────────────
  const cadence = computeCadence(visitDayKeys, todayKey, ctx.storeTypicalGapDays);

  // ── Preferences (line level) ──────────────────────────────────────────────
  const byCategory = new Map<string, Tally>();
  const byBrand = new Map<string, Tally>();
  const byVendor = new Map<string, Tally>();
  const byStrain = new Map<string, Tally>();
  const byProduct = new Map<string, Tally>();
  const productNames = new Map<string, string>();
  const productDays = new Map<string, Set<string>>();
  const productLastDay = new Map<string, string>();
  let units = 0;
  let attributedSpend = 0;
  let dealUnits = 0;
  let pricedUnits = 0;
  const priceRatios: number[] = [];
  const thcValues: number[] = [];
  let categoriesPerVisitSum = 0;
  const pairCounts = new Map<string, number>();

  purchases.forEach((p, i) => {
    const dayKey = visitDayKeys[i];
    const visitCategories = new Set<string>();
    for (const l of p.lines ?? []) {
      const q = intOr0(l.quantity);
      if (q <= 0) continue;
      const unit = Math.max(0, intOr0(l.unitPriceMinor));
      const spend = unit * q;
      units += q;
      attributedSpend += spend;
      const reg = l.regularPriceMinor === null ? null : intOr0(l.regularPriceMinor);
      if (reg !== null && reg > 0) {
        pricedUnits += q;
        if (reg > unit) dealUnits += q;
      }
      if (l.isCustom) continue;
      const category = clean(l.category);
      bump(byCategory, category, q, spend, p.orderId);
      bump(byBrand, clean(l.brand), q, spend, p.orderId);
      bump(byVendor, clean(l.vendor), q, spend, p.orderId);
      bump(byStrain, tidyStrainType(l.strainType), q, spend, p.orderId);
      bump(byProduct, l.productKey, q, spend, p.orderId);
      if (!productNames.has(l.productKey)) productNames.set(l.productKey, l.productName);
      const set = productDays.get(l.productKey) ?? new Set<string>();
      set.add(dayKey);
      productDays.set(l.productKey, set);
      const prevLast = productLastDay.get(l.productKey);
      if (!prevLast || prevLast < dayKey) productLastDay.set(l.productKey, dayKey);
      if (category) {
        visitCategories.add(category);
        const med = ctx.categoryMedianPriceMinor[category];
        const basis = reg !== null && reg > 0 ? reg : unit;
        if (typeof med === "number" && med > 0 && basis > 0) for (let k = 0; k < q; k++) priceRatios.push(basis / med);
      }
      const thc = parseThcPercent(l.thcText);
      if (thc !== null) thcValues.push(thc);
    }
    categoriesPerVisitSum += visitCategories.size;
    const cats = [...visitCategories].sort();
    for (let a = 0; a < cats.length; a++)
      for (let b = a + 1; b < cats.length; b++) {
        const key = `${cats[a]} + ${cats[b]}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
  });

  const topProductsRaw = rank(byProduct, attributedSpend);
  const topProducts = topProductsRaw.map((r) => ({ ...r, label: productNames.get(r.label) ?? r.label }));
  const topBrands = rank(byBrand, attributedSpend);
  const topCategories = rank(byCategory, attributedSpend);
  const topVendors = rank(byVendor, attributedSpend);
  const topStrainTypes = rank(byStrain, attributedSpend);

  // Brand loyalty: share of visits that included their top brand.
  let brandLoyalty: CustomerInsights["brandLoyalty"] = "unknown";
  let topBrandVisitShare: number | null = null;
  if (topBrands.length > 0 && visits >= 3) {
    const topByVisits = [...byBrand.values()].reduce((m, t) => Math.max(m, t.orders.size), 0);
    topBrandVisitShare = topByVisits / visits;
    brandLoyalty = topBrandVisitShare >= 0.6 ? "loyal" : topBrandVisitShare >= 0.35 ? "leaning" : "explorer";
  }

  const dealUnitShare = pricedUnits > 0 ? dealUnits / pricedUnits : null;
  const dealProfile: CustomerInsights["dealProfile"] =
    dealUnitShare === null || pricedUnits < 3 ? "unknown" : dealUnitShare >= 0.5 ? "deal_driven" : dealUnitShare <= 0.15 ? "full_price" : "mixed";

  const priceIndex = priceRatios.length >= 3 ? medianOf(priceRatios) : null;
  const priceTier: CustomerInsights["priceTier"] =
    priceIndex === null ? "unknown" : priceIndex < 0.85 ? "value" : priceIndex > 1.15 ? "premium" : "mid";

  const medianThc = thcValues.length >= 2 ? medianOf(thcValues) : null;

  const categoryPairs = [...pairCounts.entries()]
    .filter(([, n]) => n >= 2)
    .map(([pair, n]) => ({ pair, visits: n }))
    .sort((a, b) => b.visits - a.visits || a.pair.localeCompare(b.pair))
    .slice(0, 3);

  // ── Habits ────────────────────────────────────────────────────────────────
  const weekdayCounts = WEEKDAY_NAMES.map((label) => ({ label, visits: 0 }));
  const daypartCounts = DAYPARTS.map((label) => ({ label: label as string, visits: 0 }));
  for (const p of purchases) {
    const t = purchaseTime(p);
    weekdayCounts[storeWeekday(t)].visits += 1;
    daypartCounts[DAYPARTS.indexOf(daypartOf(pacificParts(t).hour))].visits += 1;
  }
  const favorite = (rows: { label: string; visits: number }[]): string | null => {
    if (visits < 3) return null;
    const max = Math.max(...rows.map((r) => r.visits));
    const leaders = rows.filter((r) => r.visits === max);
    // Only call it a favorite when it is a clear leader holding a real share.
    return leaders.length === 1 && max / visits >= 0.34 ? leaders[0].label : null;
  };

  const channelDefs = [
    { channel: "register" as const, label: "In store" },
    { channel: "register_pickup_website" as const, label: "Website order, picked up" },
    { channel: "register_pickup_leafly" as const, label: "Leafly order, picked up" },
    { channel: "website" as const, label: "Website order" },
    { channel: "leafly" as const, label: "Leafly order" },
  ];
  const channelOf = (p: PurchaseInput) =>
    p.channel === "register" && p.pickedUpFrom === "website"
      ? "register_pickup_website"
      : p.channel === "register" && p.pickedUpFrom === "leafly"
        ? "register_pickup_leafly"
        : p.channel;
  const channelMix = channelDefs
    .map((d) => {
      const members = purchases.filter((p) => channelOf(p) === d.channel);
      return { ...d, visits: members.length, spendMinor: members.reduce((s, p) => s + Math.max(0, intOr0(p.totalMinor)), 0) };
    })
    .filter((c) => c.visits > 0);
  const onlineVisits = purchases.filter((p) => p.channel !== "register" || p.pickedUpFrom !== null).length;
  const onlineShare = visits > 0 ? onlineVisits / visits : null;

  // ── Online orders (every outcome) ─────────────────────────────────────────
  const blank = () => ({ placed: 0, fulfilled: 0, cancelled: 0, noShow: 0, open: 0 });
  const onlineOrders = { website: blank(), leafly: blank() };
  for (const o of input.onlineOrders) {
    const bucket = onlineOrders[o.channel];
    if (!bucket) continue;
    bucket.placed += 1;
    const s = (o.status ?? "").toLowerCase();
    if (s === "completed" || (s === "cancelled" && o.pickedUpAtRegister)) bucket.fulfilled += 1;
    else if (s === "cancelled") bucket.cancelled += 1;
    else if (s === "no_show") bucket.noShow += 1;
    else bucket.open += 1;
  }

  // ── Returns ───────────────────────────────────────────────────────────────
  const reasonCounts = new Map<string, number>();
  let returnedUnits = 0;
  for (const r of input.returns) {
    returnedUnits += Math.max(0, Number(r.quantity) || 0);
    const label = clean(r.reason)?.replace(/_/g, " ") ?? "other";
    reasonCounts.set(label, (reasonCounts.get(label) ?? 0) + 1);
  }
  const returnReasons = [...reasonCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  // ── Loyalty ───────────────────────────────────────────────────────────────
  const loyalty = input.loyalty
    ? {
        ...input.loyalty,
        balanceValueMinor: Math.max(0, intOr0(input.loyalty.balancePoints)) * Math.max(0, intOr0(input.loyalty.pointValueMinor)),
        canRedeem: input.loyalty.balancePoints >= Math.max(1, input.loyalty.minRedeemPoints),
      }
    : null;

  // ── Staples ───────────────────────────────────────────────────────────────
  const staples: Staple[] = [];
  for (const [key, daySet] of productDays) {
    if (daySet.size < STAPLE_MIN_DAYS) continue;
    const ds = [...daySet].sort();
    const gaps: number[] = [];
    for (let i = 1; i < ds.length; i++) gaps.push(dayKeyDiff(ds[i - 1], ds[i]));
    const g = medianOf(gaps);
    const gap = g === null ? null : Math.max(1, Math.round(g));
    const lastDay = productLastDay.get(key) ?? ds[ds.length - 1];
    const since = Math.max(0, dayKeyDiff(lastDay, todayKey));
    const cat = catalogByKey.get(key);
    staples.push({
      productKey: key,
      productName: productNames.get(key) ?? key,
      purchaseDays: daySet.size,
      typicalGapDays: gap,
      daysSinceLast: since,
      dueInDays: gap === null ? null : gap - since,
      stockStatus: cat ? cat.stockStatus : "not-on-menu",
    });
  }
  staples.sort((a, b) => b.purchaseDays - a.purchaseDays || (a.dueInDays ?? 9e9) - (b.dueInDays ?? 9e9) || a.productName.localeCompare(b.productName));

  // ── Recommendations ───────────────────────────────────────────────────────
  const bought = new Set(byProduct.keys());
  const topCats = topCategories.slice(0, 3).map((c) => c.label);
  const favCat = topCategories[0]?.label ?? null;
  const favBrands = topBrands.slice(0, 3).map((b) => b.label);
  const favStrain = topStrainTypes[0]?.label ?? null;
  const catMedianPaid = new Map<string, number>();
  for (const c of topCats) {
    const t = byCategory.get(c);
    if (t && t.units > 0) catMedianPaid.set(c, t.spend / t.units);
  }
  const recommendations: Recommendation[] = [];
  if (visits > 0 && topCats.length > 0) {
    for (const item of input.catalog) {
      if (item.stockStatus === "unavailable" || bought.has(item.productKey)) continue;
      const cat = clean(item.category);
      if (!cat || !topCats.includes(cat)) continue;
      const reasons: string[] = [];
      let score = 0;
      if (cat === favCat) {
        score += 3;
        reasons.push(`Their favorite category (${cat})`);
      } else {
        score += 1;
        reasons.push(`A category they buy (${cat})`);
      }
      const brand = clean(item.brand);
      if (brand && favBrands.includes(brand)) {
        score += brand === favBrands[0] ? 3 : 2;
        reasons.push(`From ${brand === favBrands[0] ? "their go-to brand" : "a brand they buy"} (${brand})`);
      }
      const strain = tidyStrainType(item.strainType);
      if (strain && favStrain && strain === favStrain) {
        score += 1;
        reasons.push(`Their usual type (${strain})`);
      }
      const paid = catMedianPaid.get(cat);
      if (paid && item.priceMinor > 0 && item.priceMinor <= paid * 1.3 && item.priceMinor >= paid * 0.6) {
        score += 1;
        reasons.push("In their usual price range");
      }
      if (score < 4) continue;
      recommendations.push({
        productKey: item.productKey,
        name: item.name,
        brand,
        category: cat,
        priceMinor: item.priceMinor,
        stockStatus: item.stockStatus,
        reasons,
        score,
      });
    }
    recommendations.sort((a, b) => b.score - a.score || a.priceMinor - b.priceMinor || a.name.localeCompare(b.name));
    recommendations.splice(RECOMMENDATION_LIMIT);
  }

  // ── Monthly series (last 12 Pacific months) ───────────────────────────────
  const monthly: MonthPoint[] = [];
  {
    const [ty, tm] = todayKey.split("-").map(Number);
    for (let k = 11; k >= 0; k--) {
      const d = new Date(Date.UTC(ty, tm - 1 - k, 1));
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      monthly.push({
        month: key,
        label: d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short" }),
        spendMinor: 0,
        visits: 0,
      });
    }
    const idx = new Map(monthly.map((m, i) => [m.month, i]));
    for (const p of purchases) {
      const i = idx.get(pacificMonthKey(purchaseTime(p)));
      if (i === undefined) continue;
      monthly[i].spendMinor += Math.max(0, intOr0(p.totalMinor));
      monthly[i].visits += 1;
    }
  }

  const bday = daysUntilBirthday(ctx.birthdate, ctx.nowIso);

  const base: Omit<CustomerInsights, "insights" | "nextBestAction"> = {
    hasPurchases: visits > 0,
    visits,
    grossSpendMinor: gross,
    refundsMinor: refunds,
    netSpendMinor: net,
    avgOrderMinor: visits > 0 ? Math.round(gross / visits) : 0,
    units,
    avgUnitsPerVisit: visits > 0 ? units / visits : 0,
    firstVisitAt: firstAt,
    lastVisitAt: lastAt,
    tenureDays: tenure,
    daysSinceLastVisit: daysSince,
    distinctVisitDays: distinctDays,
    savingsMinor: savings,
    loyaltyDiscountMinor: loyaltyDiscount,
    recentSpendMinor: recentSpend,
    priorSpendMinor: priorSpend,
    recentVisits,
    priorVisits,
    spendTrendPct,
    cadence,
    topCategories,
    topBrands,
    topVendors,
    topStrainTypes,
    topProducts,
    distinctProducts: byProduct.size,
    brandLoyalty,
    topBrandVisitShare,
    dealUnitShare,
    dealProfile,
    priceTier,
    priceIndex,
    medianThcPct: medianThc,
    avgCategoriesPerVisit: visits > 0 ? categoriesPerVisitSum / visits : 0,
    categoryPairs,
    weekdayCounts,
    favoriteWeekday: favorite(weekdayCounts),
    daypartCounts,
    favoriteDaypart: favorite(daypartCounts),
    channelMix,
    onlineShare,
    onlineOrders,
    returnsCount: input.returns.length,
    returnedUnits,
    returnRate: gross > 0 ? refunds / gross : null,
    returnReasons,
    loyalty,
    staples,
    recommendations,
    monthly,
    daysUntilBirthday: bday,
  };

  const insights = buildInsightSentences(base, ctx, input.unlinkedMatchingOrders);
  const nextBestAction = chooseNextBestAction(base, ctx, input.unlinkedMatchingOrders);
  return { ...base, insights, nextBestAction };
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

export function buildInsightSentences(
  x: Omit<CustomerInsights, "insights" | "nextBestAction">,
  ctx: InsightContext,
  unlinkedMatchingOrders: number,
): Insight[] {
  const out: Insight[] = [];
  if (unlinkedMatchingOrders > 0) {
    out.push({
      tone: "warn",
      text: `${plural(unlinkedMatchingOrders, "online order")} ${unlinkedMatchingOrders === 1 ? "matches" : "match"} this customer's phone or email but ${unlinkedMatchingOrders === 1 ? "isn't" : "aren't"} linked. Link ${unlinkedMatchingOrders === 1 ? "it" : "them"} so ${unlinkedMatchingOrders === 1 ? "it counts" : "they count"} toward their history.`,
    });
  }
  if (!x.hasPurchases) {
    if (ctx.importedSpendMinor > 0)
      out.push({ tone: "info", text: `Spent ${money(ctx.importedSpendMinor)} in the old POS before Greenway's register went live. Nothing is linked since then.` });
    else out.push({ tone: "info", text: "No completed purchases are linked to this customer yet. Attach them at the register so their visits start counting." });
    return out;
  }

  if (ctx.segmentLabel) {
    out.push({
      tone: "info",
      text: `Segment: ${ctx.segmentLabel}${ctx.spendRankLabel ? ` · ${ctx.spendRankLabel} of customers by spend` : ""}.`,
    });
  }

  const c = x.cadence;
  if (c.status !== "unknown") {
    out.push({ tone: c.status === "lapsed" ? "risk" : c.status === "overdue" ? "warn" : "good", text: c.explanation });
  }

  if (x.spendTrendPct !== null && x.priorVisits > 0 && Math.abs(x.spendTrendPct) >= 0.2) {
    const up = x.spendTrendPct > 0;
    out.push({
      tone: up ? "good" : "warn",
      text: `Spending is ${up ? "up" : "down"} ${pct(Math.abs(x.spendTrendPct))} over the last 90 days (${money(x.recentSpendMinor)} vs ${money(x.priorSpendMinor)} the 90 days before).`,
    });
  }

  const fc = x.topCategories[0];
  const fb = x.topBrands[0];
  if (fc) {
    out.push({
      tone: "info",
      text: `Favorite category: ${fc.label} (${pct(fc.spendShare)} of their spend)${fb ? `. Go-to brand: ${fb.label} (in ${plural(fb.visits, "visit")})` : ""}.`,
    });
  }
  if (x.brandLoyalty === "loyal" && fb) out.push({ tone: "good", text: `Brand loyal: ${fb.label} shows up in ${pct(x.topBrandVisitShare ?? 0)} of their visits. Never let it run out.` });
  else if (x.brandLoyalty === "explorer")
    out.push({ tone: "info", text: `Explorer: tried ${plural(x.distinctProducts, "different product")} and doesn't stick to one brand. New arrivals are their hook.` });

  if (x.topStrainTypes[0] && x.topStrainTypes[0].spendShare >= 0.5)
    out.push({ tone: "info", text: `Leans ${x.topStrainTypes[0].label} (${pct(x.topStrainTypes[0].spendShare)} of spend).` });
  if (x.medianThcPct !== null) out.push({ tone: "info", text: `Typical potency of what they buy: about ${Math.round(x.medianThcPct)}% THC.` });

  if (x.dealProfile === "deal_driven") out.push({ tone: "info", text: `Deal-driven: ${pct(x.dealUnitShare ?? 0)} of their items were bought on sale. Specials bring them in.` });
  else if (x.dealProfile === "full_price") out.push({ tone: "good", text: "Pays full price: rarely buys on sale. They don't need discounts." });
  if (x.priceTier === "premium") out.push({ tone: "good", text: `Premium shopper: picks products about ${pct((x.priceIndex ?? 1) - 1)} above the typical menu price in their categories.` });
  else if (x.priceTier === "value") out.push({ tone: "info", text: `Value shopper: picks products about ${pct(1 - (x.priceIndex ?? 1))} below the typical menu price in their categories.` });

  if (x.favoriteWeekday || x.favoriteDaypart) {
    const when = [x.favoriteWeekday ? `${x.favoriteWeekday}s` : null, x.favoriteDaypart ? x.favoriteDaypart.toLowerCase() + "s" : null].filter(Boolean).join(", ");
    out.push({ tone: "info", text: `Usually shops: ${when}.` });
  }
  if (x.categoryPairs[0]) out.push({ tone: "info", text: `Often buys ${x.categoryPairs[0].pair} together (${plural(x.categoryPairs[0].visits, "visit")}).` });

  if (x.onlineShare !== null && x.onlineShare > 0) {
    const leafly = x.channelMix.filter((m) => m.channel === "leafly" || m.channel === "register_pickup_leafly").reduce((s, m) => s + m.visits, 0);
    const web = x.channelMix.filter((m) => m.channel === "website" || m.channel === "register_pickup_website").reduce((s, m) => s + m.visits, 0);
    out.push({ tone: "info", text: `Orders ahead ${pct(x.onlineShare)} of the time (website ${web}, Leafly ${leafly}).` });
  }
  const noShows = x.onlineOrders.website.noShow + x.onlineOrders.leafly.noShow;
  if (noShows > 0) out.push({ tone: "warn", text: `${plural(noShows, "online order")} never picked up.` });

  for (const s of x.staples) {
    if (s.stockStatus === "unavailable" || s.stockStatus === "not-on-menu" || s.stockStatus === "low-stock") {
      const stockWord = s.stockStatus === "low-stock" ? "is running low" : s.stockStatus === "unavailable" ? "is out of stock" : "is no longer on the menu";
      const due = s.dueInDays !== null ? (s.dueInDays <= 0 ? ", and they're due for it now" : `, and they usually rebuy it in about ${plural(s.dueInDays, "day")}`) : "";
      out.push({ tone: "risk", text: `Their staple ${s.productName} ${stockWord}${due}.` });
    }
  }

  if (x.returnsCount > 0)
    out.push({
      tone: "warn",
      text: `Returned ${plural(x.returnsCount, "item")} (${money(x.refundsMinor)} refunded, ${pct(x.returnRate ?? 0)} of spend).`,
    });

  if (x.loyalty) {
    if (x.loyalty.canRedeem && x.loyalty.balancePoints > 0)
      out.push({ tone: "good", text: `Has ${x.loyalty.balancePoints.toLocaleString("en-US")} points (${money(x.loyalty.balanceValueMinor)}) ready to redeem. Mention it at their next visit.` });
  } else if (x.visits >= 2) {
    out.push({ tone: "warn", text: "Not in the loyalty program yet, despite coming back. Sign them up at the next visit." });
  }

  if (x.daysUntilBirthday !== null && x.daysUntilBirthday <= BIRTHDAY_WINDOW_DAYS)
    out.push({ tone: "good", text: x.daysUntilBirthday === 0 ? "Birthday is today." : `Birthday in ${plural(x.daysUntilBirthday, "day")}.` });

  if (ctx.importedSpendMinor > 0) out.push({ tone: "info", text: `Also spent ${money(ctx.importedSpendMinor)} in the old POS (before Greenway's register).` });
  if (ctx.doNotContact) out.push({ tone: "warn", text: "Marked do-not-contact: in-store only, no texts or emails." });
  else if (!ctx.marketingConsent) out.push({ tone: "info", text: "No marketing consent on file, so offers have to happen in the store." });
  return out;
}

export function chooseNextBestAction(
  x: Omit<CustomerInsights, "insights" | "nextBestAction">,
  ctx: InsightContext,
  unlinkedMatchingOrders: number,
): NextBestAction {
  const reachable = !ctx.doNotContact && ctx.marketingConsent;
  const brokenStaple = x.staples.find(
    (s) => (s.stockStatus === "unavailable" || s.stockStatus === "not-on-menu" || s.stockStatus === "low-stock") && s.dueInDays !== null && s.dueInDays <= 14,
  );
  if (brokenStaple) {
    return {
      kind: "restock_staple",
      title: `Restock ${brokenStaple.productName}`,
      detail: `They've bought it on ${plural(brokenStaple.purchaseDays, "separate day")} and are due for it ${brokenStaple.dueInDays !== null && brokenStaple.dueInDays <= 0 ? "now" : `within ${plural(brokenStaple.dueInDays ?? 0, "day")}`}. It ${brokenStaple.stockStatus === "low-stock" ? "is running low" : brokenStaple.stockStatus === "unavailable" ? "is out of stock" : "is no longer on the menu"}.`,
    };
  }
  if ((x.cadence.status === "overdue" || x.cadence.status === "lapsed") && x.visits >= 2) {
    const fav = x.topProducts[0]?.label ?? x.topBrands[0]?.label ?? x.topCategories[0]?.label ?? null;
    return {
      kind: "win_back",
      title: x.cadence.status === "lapsed" ? "Win them back" : "Reach out before they drift",
      detail: `${x.cadence.explanation}${fav ? ` Lead with ${fav}.` : ""}${reachable ? "" : " They can't be messaged (no consent or do-not-contact), so greet them warmly if they come in."}`,
    };
  }
  if (x.daysUntilBirthday !== null && x.daysUntilBirthday <= 14) {
    return {
      kind: "birthday",
      title: x.daysUntilBirthday === 0 ? "Birthday today" : `Birthday in ${plural(x.daysUntilBirthday, "day")}`,
      detail: reachable ? "A birthday note or treat is the highest-response message there is." : "Wish them happy birthday in the store (no marketing consent on file).",
    };
  }
  if (unlinkedMatchingOrders > 0) {
    return {
      kind: "link_orders",
      title: "Link their online orders",
      detail: `${plural(unlinkedMatchingOrders, "online order")} ${unlinkedMatchingOrders === 1 ? "matches" : "match"} their phone or email. Open ${unlinkedMatchingOrders === 1 ? "it" : "each one"} and confirm the link so their history is complete.`,
    };
  }
  if (!x.loyalty && x.visits >= 2) {
    return { kind: "enroll_loyalty", title: "Enroll in loyalty", detail: `${plural(x.visits, "visit")} and not a member yet. Points give them a reason to keep choosing you.` };
  }
  if (x.loyalty && x.loyalty.canRedeem && x.loyalty.balancePoints > 0) {
    return {
      kind: "redeem_points",
      title: "Remind them about their points",
      detail: `${x.loyalty.balancePoints.toLocaleString("en-US")} points (${money(x.loyalty.balanceValueMinor)}) are ready to redeem.`,
    };
  }
  if (x.cadence.status === "due_now" || x.cadence.status === "on_track") {
    const have = x.staples.find((s) => s.stockStatus === "in-stock")?.productName ?? x.topProducts[0]?.label ?? null;
    return {
      kind: "expect_visit",
      title: x.cadence.status === "due_now" ? "Expect them any day" : "On track",
      detail: `${x.cadence.explanation}${have ? ` Have ${have} ready.` : ""}`,
    };
  }
  if (x.visits === 1) return { kind: "welcome_back", title: "Earn the second visit", detail: "First-time customers who return once are far more likely to become regulars. A welcome-back offer works best here." };
  return { kind: "none", title: "Nothing urgent", detail: "No action needed right now." };
}

// ---------------------------------------------------------------------------
// Channel classification (one home; mirrors the Online Orders report rules)
// ---------------------------------------------------------------------------

export const POS_SALE_NOTE_PREFIX = "POS sale —";

/** Which channel a COMPLETED order belongs to. */
export function purchaseChannelOf(row: { origin?: string | null; staffNote?: string | null; posClientUuid?: string | null }): PurchaseChannel {
  const origin = (clean(row.origin) ?? "greenway").toLowerCase();
  if (origin === "leafly") return "leafly";
  if (origin === "register") return "register";
  if (clean(row.posClientUuid) !== null) return "register";
  if (typeof row.staffNote === "string" && row.staffNote.startsWith(POS_SALE_NOTE_PREFIX)) return "register";
  return "website";
}

/** The product identity used for favorites: catalog id when present, else the lower-cased name. */
export function productKeyOf(productId: string | null | undefined, productName: string | null | undefined): string {
  const id = clean(productId);
  if (id) return id;
  return `name:${(clean(productName) ?? "unknown").toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Embedded self-tests
// ---------------------------------------------------------------------------

export function __runCustomerInsightsCoreTests(): { passed: number; failed: number; messages: string[] } {
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

  // 2026-06-01T20:00Z = Mon Jun 1 2026, 1pm Pacific.
  const NOW = "2026-06-01T20:00:00Z";
  const TODAY = "2026-06-01";

  // helpers
  ok(dayKeyDiff("2026-05-01", "2026-06-01") === 31, "dayKeyDiff 31");
  ok(dayKeyDiff("2026-06-01", "2026-05-31") === -1, "dayKeyDiff negative");
  ok(parseThcPercent("24.5%") === 24.5 && parseThcPercent("THC 31 %") === 31, "thc parse");
  ok(parseThcPercent("310mg") === null && parseThcPercent("150%") === null && parseThcPercent(null) === null, "thc parse rejects mg / >100 / null");
  ok(tidyStrainType("indica") === "Indica" && tidyStrainType("unknown") === null && tidyStrainType("  ") === null, "strain tidy");
  ok(daypartOf(9) === "Morning" && daypartOf(12) === "Afternoon" && daypartOf(16) === "Afternoon" && daypartOf(17) === "Evening", "dayparts");
  ok(money(123456) === "$1,234.56" && money(-500) === "-$5.00" && money(0) === "$0.00", "money format");
  ok(shortDayLabel("2026-06-10") === "Jun 10", "short day label");
  ok(purchaseTime({ completedAt: null, placedAt: "2026-01-01T00:00:00Z" }) === "2026-01-01T00:00:00Z", "purchaseTime falls back to placedAt");
  ok(purchaseTime({ completedAt: "2026-01-02T00:00:00Z", placedAt: "2026-01-01T00:00:00Z" }) === "2026-01-02T00:00:00Z", "purchaseTime prefers completedAt");
  ok(medianOf([3, 1, 2]) === 2 && medianOf([]) === null && medianOf([1, 2, 3, 4]) === 2.5, "medianOf");

  // birthday
  ok(daysUntilBirthday("1990-06-01", NOW) === 0, "birthday today");
  ok(daysUntilBirthday("1990-06-11", NOW) === 10, "birthday in 10 days");
  ok(daysUntilBirthday("1990-05-31", NOW) === 364, "birthday just passed wraps to next year");
  ok(daysUntilBirthday("bad", NOW) === null && daysUntilBirthday(null, NOW) === null && daysUntilBirthday("1990-13-01", NOW) === null, "birthday unusable");
  ok(daysUntilBirthday("2000-02-29", "2027-02-20T20:00:00Z") === 8, "Feb 29 birthday -> Feb 28 in non-leap year");

  // channels + keys
  ok(purchaseChannelOf({ origin: "leafly" }) === "leafly", "channel: leafly");
  ok(purchaseChannelOf({ origin: "greenway", posClientUuid: "u" }) === "register", "channel: pos uuid -> register");
  ok(purchaseChannelOf({ origin: null, staffNote: "POS sale — iPad 1 — rung by Sam." }) === "register", "channel: POS note -> register");
  ok(purchaseChannelOf({ origin: "register" }) === "register", "channel: register origin");
  ok(purchaseChannelOf({ origin: "greenway", staffNote: "Customer asked for a bag" }) === "website", "channel: website");
  ok(purchaseChannelOf({}) === "website", "channel: blank -> website");
  ok(productKeyOf("abc", "X") === "abc" && productKeyOf(null, " Blue Dream ") === "name:blue dream" && productKeyOf("", null) === "name:unknown", "product keys");

  // cadence
  const none = computeCadence([], TODAY, 10);
  ok(none.status === "unknown" && none.risk === "unknown" && none.basis === "none", "cadence: no visits");
  const onTrack = computeCadence(["2026-05-01", "2026-05-11", "2026-05-21", "2026-05-29"], TODAY, 30);
  ok(onTrack.basis === "personal" && onTrack.gapDays === 10, "cadence: personal median gap 10 (10,10,8)");
  ok(onTrack.status === "on_track" && onTrack.risk === "low", "cadence: 3 days since vs 10 gap -> on track");
  ok(onTrack.expectedNextDay === "2026-06-08" && onTrack.daysUntilExpected === 7, "cadence: expected next day");
  ok(onTrack.confidence === "medium" && onTrack.gapsObserved === 3, "cadence: 3 gaps medium confidence");
  const due = computeCadence(["2026-05-12", "2026-05-22"], TODAY, null);
  ok(due.status === "due_now" && due.confidence === "low", "cadence: 10 since vs 10 gap -> due now");
  const overdue = computeCadence(["2026-04-20", "2026-05-01", "2026-05-12"], TODAY, null);
  ok(overdue.status === "overdue" && overdue.risk === "medium", "cadence: 20 since vs 11 gap -> overdue");
  ok(overdue.daysUntilExpected === -9, "cadence: overdue days negative");
  const lapsed = computeCadence(["2026-03-01", "2026-03-11"], TODAY, null);
  ok(lapsed.status === "lapsed" && lapsed.risk === "high", "cadence: 82 since vs 10 gap -> lapsed");
  const storeBased = computeCadence(["2026-05-25"], TODAY, 14);
  ok(storeBased.basis === "store" && storeBased.gapDays === 14 && storeBased.status === "on_track", "cadence: single visit uses store gap");
  ok(storeBased.explanation.includes("shop's typical gap"), "cadence: store basis explained");
  const single = computeCadence(["2026-05-25"], TODAY, null);
  ok(single.status === "unknown" && single.basis === "none", "cadence: single visit, no store gap -> unknown");
  const oldSingle = computeCadence(["2025-01-01"], TODAY, null);
  ok(oldSingle.status === "lapsed" && oldSingle.risk === "high", "cadence: single visit > 180 days -> lapsed");
  const hard = computeCadence(["2025-10-01", "2025-10-01", "2025-12-01"], TODAY, null);
  ok(hard.status === "lapsed", "cadence: >180 days lapsed even with a long rhythm");
  const many = computeCadence(["2026-01-01", "2026-01-08", "2026-01-15", "2026-01-22", "2026-01-29", "2026-02-05", "2026-02-12"], "2026-02-14", null);
  ok(many.confidence === "high" && many.gapDays === 7, "cadence: 6 gaps high confidence");
  ok(computeCadence(["2026-05-30", "2026-05-30"], TODAY, 9).basis === "store", "cadence: duplicate days collapse to one visit day");

  // Full profile
  const line = (o: Partial<LineInput> & { productKey: string; productName: string }): LineInput => ({
    brand: null,
    vendor: null,
    category: null,
    strainType: null,
    thcText: null,
    quantity: 1,
    unitPriceMinor: 3000,
    regularPriceMinor: 3000,
    isCustom: false,
    ...o,
  });
  const bd = (o: Partial<LineInput> = {}) =>
    line({ productKey: "p-bd", productName: "Blue Dream 3.5g", brand: "Phat Panda", vendor: "Grow Op Farms", category: "Flower", strainType: "sativa", thcText: "24%", ...o });
  const gum = (o: Partial<LineInput> = {}) =>
    line({ productKey: "p-gum", productName: "Gummies 100mg", brand: "Wyld", vendor: "Wyld WA", category: "Edibles", strainType: "hybrid", thcText: "100mg", unitPriceMinor: 1500, regularPriceMinor: 2000, ...o });
  const P = (id: string, iso: string, lines: LineInput[], extra: Partial<PurchaseInput> = {}): PurchaseInput => ({
    orderId: id,
    orderNumber: `GWY-${id}`,
    channel: "register",
    pickedUpFrom: null,
    completedAt: iso,
    placedAt: iso,
    totalMinor: lines.reduce((s, l) => s + l.unitPriceMinor * l.quantity, 0),
    savingsMinor: lines.reduce((s, l) => s + Math.max(0, (l.regularPriceMinor ?? l.unitPriceMinor) - l.unitPriceMinor) * l.quantity, 0),
    loyaltyDiscountMinor: 0,
    lines,
    ...extra,
  });
  // Fridays 6pm Pacific (01:00Z Saturday): May 1, 8, 15, 22, 29 2026.
  const purchases: PurchaseInput[] = [
    P("1", "2026-05-02T01:00:00Z", [bd({ quantity: 2 }), gum()]),
    P("2", "2026-05-09T01:00:00Z", [bd(), gum()]),
    P("3", "2026-05-16T01:00:00Z", [bd(), line({ productKey: "pos-custom-1", productName: "Custom", isCustom: true, unitPriceMinor: 500, regularPriceMinor: null })]),
    P("4", "2026-05-23T01:00:00Z", [bd(), gum()], { channel: "register", pickedUpFrom: "leafly" }),
    P("5", "2026-05-30T01:00:00Z", [bd({ thcText: "28%" })], { channel: "website", loyaltyDiscountMinor: 300 }),
    P("0", "2026-01-10T20:00:00Z", [bd()]), // prior window
  ];
  const catalog: CatalogItem[] = [
    { productKey: "p-bd", name: "Blue Dream 3.5g", brand: "Phat Panda", vendor: "Grow Op Farms", category: "Flower", strainType: "sativa", priceMinor: 3000, stockStatus: "unavailable" },
    { productKey: "p-gum", name: "Gummies 100mg", brand: "Wyld", vendor: "Wyld WA", category: "Edibles", strainType: "hybrid", priceMinor: 2000, stockStatus: "in-stock" },
    { productKey: "p-new1", name: "Jack Herer 3.5g", brand: "Phat Panda", vendor: "Grow Op Farms", category: "Flower", strainType: "sativa", priceMinor: 3200, stockStatus: "in-stock" },
    { productKey: "p-new2", name: "Pricey OG 3.5g", brand: "Other", vendor: "X", category: "Flower", strainType: "indica", priceMinor: 9000, stockStatus: "in-stock" },
    { productKey: "p-new3", name: "Out Of Stock Kush", brand: "Phat Panda", vendor: "Grow Op Farms", category: "Flower", strainType: "sativa", priceMinor: 3000, stockStatus: "unavailable" },
    { productKey: "p-new4", name: "Vape Cart", brand: "Phat Panda", vendor: "Grow Op Farms", category: "Vapes", strainType: "sativa", priceMinor: 3000, stockStatus: "in-stock" },
  ];
  const ctx: InsightContext = {
    nowIso: NOW,
    storeTypicalGapDays: 14,
    categoryMedianPriceMinor: { Flower: 2500, Edibles: 2000 },
    birthdate: "1990-06-11",
    marketingConsent: true,
    doNotContact: false,
    importedSpendMinor: 12345,
    importedLastPurchaseAt: null,
    spendRankLabel: "Top 5%",
    segmentLabel: "Champions",
  };
  const onlineOrders: OnlineOrderInput[] = [
    { orderId: "w1", orderNumber: "GWY-w1", channel: "website", status: "completed", pickedUpAtRegister: false, placedAt: "2026-05-29T20:00:00Z", totalMinor: 3000 },
    { orderId: "w2", orderNumber: "GWY-w2", channel: "website", status: "no_show", pickedUpAtRegister: false, placedAt: "2026-04-01T20:00:00Z", totalMinor: 3000 },
    { orderId: "l1", orderNumber: "GWY-l1", channel: "leafly", status: "cancelled", pickedUpAtRegister: true, placedAt: "2026-05-22T20:00:00Z", totalMinor: 7500 },
    { orderId: "l2", orderNumber: "GWY-l2", channel: "leafly", status: "cancelled", pickedUpAtRegister: false, placedAt: "2026-05-10T20:00:00Z", totalMinor: 7500 },
    { orderId: "l3", orderNumber: "GWY-l3", channel: "leafly", status: "ready", pickedUpAtRegister: false, placedAt: "2026-06-01T18:00:00Z", totalMinor: 7500 },
  ];
  const returns: ReturnInput[] = [{ orderId: "2", productName: "Gummies 100mg", quantity: 1, refundMinor: 1500, reason: "defective", createdAt: "2026-05-10T20:00:00Z" }];
  const loyalty: LoyaltyInput = {
    balancePoints: 450,
    lifetimePoints: 900,
    tierName: "Gold",
    pointValueMinor: 1,
    minRedeemPoints: 100,
    pointsEarned: 900,
    pointsRedeemed: 450,
    codesRedeemed: 1,
    redeemedValueMinor: 450,
  };
  const x = buildCustomerInsights({ purchases, returns, onlineOrders, loyalty, catalog, unlinkedMatchingOrders: 0, context: ctx });

  ok(x.hasPurchases && x.visits === 6, "profile: 6 visits");
  const gross = 7500 + 4500 + 3500 + 4500 + 3000 + 3000;
  ok(x.grossSpendMinor === gross, "profile: gross = sum of order totals");
  ok(x.refundsMinor === 1500 && x.netSpendMinor === gross - 1500, "profile: refunds subtracted");
  ok(x.avgOrderMinor === Math.round(gross / 6), "profile: AOV");
  ok(x.units === 11, "profile: units include custom lines");
  ok(x.savingsMinor === 1500 && x.loyaltyDiscountMinor === 300, "profile: savings + loyalty discount");
  ok(x.firstVisitAt === "2026-01-10T20:00:00Z" && x.lastVisitAt === "2026-05-30T01:00:00Z", "profile: first/last sorted chronologically");
  ok(x.daysSinceLastVisit === 3, "profile: last visit May 29 Pacific -> Jun 1 = 3 days");
  ok(x.distinctVisitDays === 6, "profile: distinct days");
  ok(x.recentVisits === 5 && x.priorVisits === 1, "profile: trend windows");
  ok(x.spendTrendPct !== null && Math.abs(x.spendTrendPct - (23000 - 3000) / 3000) < 1e-9, "profile: trend pct");
  ok(x.cadence.basis === "personal" && x.cadence.gapDays === 7, "profile: weekly cadence");
  ok(x.topCategories[0].label === "Flower" && x.topCategories[1].label === "Edibles", "profile: categories ranked by spend");
  ok(x.topCategories.every((c) => c.label !== "Custom"), "profile: custom lines never become favorites");
  ok(x.topBrands[0].label === "Phat Panda" && x.topBrands[0].visits === 6, "profile: top brand in 6 visits");
  ok(x.topVendors[0].label === "Grow Op Farms", "profile: top vendor");
  ok(x.topStrainTypes[0].label === "Sativa", "profile: top strain type titled");
  ok(x.topProducts[0].label === "Blue Dream 3.5g" && x.topProducts[0].units === 7, "profile: top product by name with units");
  ok(x.distinctProducts === 2, "profile: distinct products exclude custom");
  ok(x.brandLoyalty === "loyal" && x.topBrandVisitShare === 1, "profile: brand loyal");
  ok(x.dealUnitShare !== null && Math.abs(x.dealUnitShare - 3 / 10) < 1e-9, "profile: deal share over priced units (custom excluded)");
  ok(x.dealProfile === "mixed", "profile: 30% deals is mixed");
  ok(x.priceTier === "mid" || x.priceTier === "premium", "profile: price tier computed");
  ok(x.priceIndex !== null && Math.abs(x.priceIndex - 1.2) < 1e-9, "profile: price index median (7 flower units at 1.2 vs 3 edible at 1.0)");
  ok(x.priceTier === "premium", "profile: 1.2 index is premium");
  ok(x.medianThcPct === 24, "profile: median THC ignores mg lines");
  ok(x.categoryPairs.length === 1 && x.categoryPairs[0].pair === "Edibles + Flower" && x.categoryPairs[0].visits === 3, "profile: category pair");
  ok(x.favoriteWeekday === "Friday", "profile: Friday regular (Pacific, not UTC Saturday)");
  ok(x.favoriteDaypart === "Evening", "profile: evening shopper");
  ok(x.weekdayCounts.reduce((s, w) => s + w.visits, 0) === 6, "profile: weekday counts cover every visit");
  const mix = new Map(x.channelMix.map((m) => [m.channel, m.visits]));
  ok(mix.get("register") === 4 && mix.get("register_pickup_leafly") === 1 && mix.get("website") === 1, "profile: channel mix separates pickups");
  ok(x.onlineShare !== null && Math.abs(x.onlineShare - 2 / 6) < 1e-9, "profile: online share counts pickups + website");
  ok(x.onlineOrders.website.placed === 2 && x.onlineOrders.website.fulfilled === 1 && x.onlineOrders.website.noShow === 1, "profile: website outcomes");
  ok(
    x.onlineOrders.leafly.placed === 3 && x.onlineOrders.leafly.fulfilled === 1 && x.onlineOrders.leafly.cancelled === 1 && x.onlineOrders.leafly.open === 1,
    "profile: leafly outcomes (register pickup is fulfilled, not cancelled)",
  );
  ok(x.returnsCount === 1 && x.returnedUnits === 1 && x.returnReasons[0].label === "defective", "profile: returns");
  ok(x.returnRate !== null && Math.abs(x.returnRate - 1500 / gross) < 1e-9, "profile: return rate");
  ok(x.loyalty !== null && x.loyalty.balanceValueMinor === 450 && x.loyalty.canRedeem, "profile: loyalty value + redeemable");
  ok(x.staples.length === 2 && x.staples[0].productKey === "p-bd", "profile: staples (2+ days), most-bought first");
  ok(x.staples[0].stockStatus === "unavailable" && x.staples[0].typicalGapDays === 7, "profile: staple stock + gap");
  const gumStaple = x.staples.find((s) => s.productKey === "p-gum")!;
  ok(gumStaple.purchaseDays === 3 && gumStaple.typicalGapDays === 11 && gumStaple.daysSinceLast === 10 && gumStaple.dueInDays === 1, "profile: staple gaps 7,14 -> median 10.5 -> 11; 10 days since May 22 -> due in 1");
  ok(x.recommendations.length >= 1 && x.recommendations[0].productKey === "p-new1", "profile: recommends same brand + category + price");
  ok(!x.recommendations.some((r) => r.productKey === "p-bd" || r.productKey === "p-gum"), "profile: never recommends what they already buy");
  ok(!x.recommendations.some((r) => r.productKey === "p-new3"), "profile: never recommends out-of-stock");
  ok(!x.recommendations.some((r) => r.productKey === "p-new4"), "profile: never recommends outside their categories");
  ok(!x.recommendations.some((r) => r.productKey === "p-new2"), "profile: weak match (other brand, other type, pricier) filtered");
  ok(x.recommendations[0].reasons.some((r) => r.includes("go-to brand")), "profile: recommendation explains why");
  ok(x.monthly.length === 12 && x.monthly[11].month === "2026-06" && x.monthly[0].month === "2025-07", "profile: 12 month series ends this month");
  const may = x.monthly.find((m) => m.month === "2026-05")!;
  ok(may.visits === 5 && may.spendMinor === 23000, "profile: May bucket (Pacific months)");
  ok(x.monthly.find((m) => m.month === "2026-01")!.visits === 1, "profile: January bucket");
  ok(x.daysUntilBirthday === 10, "profile: birthday countdown");

  // Words
  const text = x.insights.map((i) => i.text).join(" | ");
  ok(text.includes("Segment: Champions · Top 5%"), "insight: segment + rank");
  ok(text.includes("Favorite category: Flower"), "insight: favorite category");
  ok(text.includes("Brand loyal: Phat Panda"), "insight: brand loyal");
  ok(text.includes("Usually shops: Fridays, evenings"), "insight: habits");
  ok(text.includes("Their staple Blue Dream 3.5g is out of stock"), "insight: staple out of stock");
  ok(text.includes("Returned 1 item"), "insight: returns");
  ok(text.includes("450 points ($4.50) ready to redeem"), "insight: points");
  ok(text.includes("Birthday in 10 days"), "insight: birthday");
  ok(text.includes("old POS"), "insight: imported spend disclosed");
  ok(text.includes("Premium shopper"), "insight: premium");
  ok(text.includes("Spending is up"), "insight: trend up");
  ok(text.includes("Often buys Edibles + Flower together"), "insight: basket pair");
  ok(text.includes("1 online order never picked up"), "insight: no-shows");
  ok(x.nextBestAction.kind === "restock_staple" && x.nextBestAction.title === "Restock Blue Dream 3.5g", "action: restock staple wins");

  // Next-best-action ladder
  const baseX = { ...x } as Omit<CustomerInsights, "insights" | "nextBestAction">;
  const noStaples = { ...baseX, staples: [] };
  const lapsedX = { ...noStaples, cadence: { ...x.cadence, status: "lapsed" as DueStatus, explanation: "Lapsed." } };
  ok(chooseNextBestAction(lapsedX, ctx, 0).kind === "win_back", "action: lapsed regular -> win back");
  ok(chooseNextBestAction(lapsedX, { ...ctx, doNotContact: true }, 0).detail.includes("can't be messaged"), "action: win back respects do-not-contact");
  const onTrackX = { ...noStaples, cadence: { ...x.cadence, status: "on_track" as DueStatus } };
  ok(chooseNextBestAction({ ...onTrackX, daysUntilBirthday: 3 }, ctx, 0).kind === "birthday", "action: birthday within 14 days");
  ok(chooseNextBestAction({ ...onTrackX, daysUntilBirthday: 100 }, ctx, 2).kind === "link_orders", "action: unlinked orders");
  ok(chooseNextBestAction({ ...onTrackX, daysUntilBirthday: 100, loyalty: null }, ctx, 0).kind === "enroll_loyalty", "action: enroll");
  ok(chooseNextBestAction({ ...onTrackX, daysUntilBirthday: 100 }, ctx, 0).kind === "redeem_points", "action: redeem points");
  const noPts = { ...onTrackX, daysUntilBirthday: 100, loyalty: { ...x.loyalty!, canRedeem: false } };
  ok(chooseNextBestAction(noPts, ctx, 0).kind === "expect_visit", "action: expect visit");
  ok(
    chooseNextBestAction({ ...noPts, visits: 1, cadence: { ...x.cadence, status: "unknown" as DueStatus } }, ctx, 0).kind === "welcome_back",
    "action: first-timer -> welcome back",
  );
  ok(
    chooseNextBestAction({ ...noPts, visits: 3, cadence: { ...x.cadence, status: "unknown" as DueStatus } }, ctx, 0).kind === "none",
    "action: nothing urgent",
  );
  const lowStaple = { ...onTrackX, staples: [{ ...x.staples[0], stockStatus: "low-stock" as const, dueInDays: 30 }] };
  ok(chooseNextBestAction(lowStaple, ctx, 0).kind !== "restock_staple", "action: staple not due within 14 days does not trigger restock");

  // Empty customer
  const empty = buildCustomerInsights({ purchases: [], returns: [], onlineOrders: [], loyalty: null, catalog, unlinkedMatchingOrders: 0, context: { ...ctx, importedSpendMinor: 0 } });
  ok(!empty.hasPurchases && empty.visits === 0 && empty.grossSpendMinor === 0 && empty.avgOrderMinor === 0, "empty: zeros, no NaN");
  ok(empty.cadence.status === "unknown" && empty.recommendations.length === 0 && empty.staples.length === 0, "empty: nothing predicted");
  ok(empty.insights.length === 1 && empty.insights[0].text.startsWith("No completed purchases"), "empty: one honest sentence");
  const emptyImported = buildCustomerInsights({ purchases: [], returns: [], onlineOrders: [], loyalty: null, catalog, unlinkedMatchingOrders: 2, context: ctx });
  ok(emptyImported.insights[0].text.startsWith("2 online orders match"), "empty: unlinked orders flagged first");
  ok(emptyImported.insights[1].text.includes("old POS"), "empty: imported spend explained");
  ok(emptyImported.nextBestAction.kind === "birthday" || emptyImported.nextBestAction.kind === "link_orders", "empty: action still useful");

  // Defensive: garbage numbers never produce NaN.
  const junk = buildCustomerInsights({
    purchases: [P("j", "2026-05-30T20:00:00Z", [line({ productKey: "k", productName: "K", quantity: Number.NaN as unknown as number })], { totalMinor: Number.NaN as unknown as number })],
    returns: [],
    onlineOrders: [],
    loyalty: null,
    catalog: [],
    unlinkedMatchingOrders: 0,
    context: ctx,
  });
  ok(junk.grossSpendMinor === 0 && junk.units === 0 && Number.isFinite(junk.avgOrderMinor), "defensive: NaN inputs -> zeros");

  // Deal-driven + value + explorer branches
  const dealLines = (k: string, brand: string): LineInput =>
    line({ productKey: k, productName: k, brand, category: "Flower", unitPriceMinor: 1000, regularPriceMinor: 2000 });
  const explorer = buildCustomerInsights({
    purchases: [
      P("e1", "2026-05-01T20:00:00Z", [dealLines("a", "A")]),
      P("e2", "2026-05-08T20:00:00Z", [dealLines("b", "B")]),
      P("e3", "2026-05-15T20:00:00Z", [dealLines("c", "C")]),
      P("e4", "2026-05-22T20:00:00Z", [dealLines("d", "D")]),
    ],
    returns: [],
    onlineOrders: [],
    loyalty: null,
    catalog: [],
    unlinkedMatchingOrders: 0,
    context: { ...ctx, categoryMedianPriceMinor: { Flower: 4000 } },
  });
  ok(explorer.brandLoyalty === "explorer", "branch: explorer (top brand in 25% of visits)");
  ok(explorer.dealProfile === "deal_driven", "branch: deal driven");
  ok(explorer.priceTier === "value", "branch: value tier (regular 2000 vs median 4000)");
  ok(explorer.insights.some((i) => i.text.startsWith("Not in the loyalty program")), "branch: enroll nudge for repeat non-member");
  ok(explorer.favoriteWeekday === "Friday", "branch: weekday favorite");
  const fullPrice = buildCustomerInsights({
    purchases: [P("f1", "2026-05-01T20:00:00Z", [line({ productKey: "z", productName: "Z", quantity: 3 })])],
    returns: [],
    onlineOrders: [],
    loyalty: null,
    catalog: [],
    unlinkedMatchingOrders: 0,
    context: { ...ctx, marketingConsent: false },
  });
  ok(fullPrice.dealProfile === "full_price", "branch: full price");
  ok(fullPrice.favoriteWeekday === null, "branch: no favorite day under 3 visits");
  ok(fullPrice.brandLoyalty === "unknown", "branch: brand loyalty unknown under 3 visits");
  ok(fullPrice.insights.some((i) => i.text.startsWith("No marketing consent")), "branch: consent note");
  ok(fullPrice.nextBestAction.kind !== "enroll_loyalty", "branch: single visit is not an enroll nudge");

  return { passed, failed, messages };
}
