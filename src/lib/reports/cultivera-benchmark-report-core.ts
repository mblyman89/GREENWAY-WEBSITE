/**
 * src/lib/reports/cultivera-benchmark-report-core.ts  (CVB-6, owner request 2026-11-01)
 *
 * Michael: "I would like to have a new tab added to reports called Cultivera Benchmark ... I want to compare
 * how well we're doing with our system vs Cultivera ... Total build was 40k ... every time we outperform
 * Cultivera it should go down." (verbatim: docs/sop-program/00-OWNER-REQUEST-VERBATIM.md).
 *
 * PURE. Two jobs, both "never guess":
 *
 *  1. measureIdentities(theirs): Cultivera's daily report has derived columns. Measured 2026-11-01 on real
 *     rows: NetSales = GrossSales - Discounts, GrossProfit = GrossSales - Cost, NetProfit = NetSales - Cost.
 *     We do not ASSUME those hold for every day: they are re-checked on the exact Cultivera days being
 *     compared (1 cent of slack, because each dollar float is rounded to cents on its own). A derived metric
 *     of ours is only filled when Cultivera's own rows prove the same formula. Whether NetSales also takes
 *     Returns off was never measured (every measured day had Returns = 0), so it is measured here too.
 *
 *  2. buildOurDays(input): our side, per Pacific day, from completed orders and their lines (the canonical
 *     completed_at basis, docs/PERIOD_BASIS.md). Stored line prices are tax-INCLUSIVE (migration 0007), so
 *     the pre-tax base comes from preTaxLineBaseMinor (tax-base-core, GW-010):
 *       gross    = pre-tax base of the REGULAR (pre-discount) price at the full rate (a medical exemption
 *                  changes what the patient paid, not the shelf price: tax-base-core preTaxUnitMinor)
 *       sold     = pre-tax base of the price actually charged, honouring the line's exemptions
 *       discount = gross - sold (not clamped: a price raised above regular is a negative discount, so
 *                  gross - discounts is always exactly what was sold)
 *       taxes    = sales tax + excise on the sold base, zero where exempted (same rule as the WA tax report)
 *       cost     = the sale's own cost entry in the books (order:<id>#cogs). A day with ANY completed order
 *                  that has no single cost entry has an UNKNOWN cost (null), never a partial sum.
 *     Returns: Cultivera's Returns basis (pre-tax or not, which day) was never measured, so OUR returns
 *     figure is not compared (null). We only count our returns, so a net-sales comparison can be refused
 *     when returns would make the two definitions differ.
 *
 * ourPeriodTotals() turns our days into the PeriodTotals the CVB-4 comparison engine (comparePeriods) takes.
 * A metric with any unknown day is null for the whole period: a partial sum would look like a real number.
 */
import { preTaxLineBaseMinor } from "@/lib/reports/tax-base-core";
import {
  METRICS,
  daysInRange,
  isDay,
  type BenchmarkDayRow,
  type MetricKey,
  type PaybackEntry,
  type PeriodTotals,
} from "@/lib/reports/cultivera-benchmark-core";

// ---------------------------------------------------------------------------
// 1. Cultivera's identities, measured on the rows being compared
// ---------------------------------------------------------------------------

/** Cents of slack per day: each Cultivera column is a dollar float rounded to cents on its own. */
export const IDENTITY_SLACK_MINOR = 1;

export type IdentityState = "holds" | "broken" | "unmeasured";
export type ReturnsRule = "excludes_returns" | "subtracts_returns" | "no_returns" | "mixed" | "unmeasured";

export type Identities = {
  /** NetSales = GrossSales - Discounts on every day with no returns. */
  netIsGrossLessDiscounts: IdentityState;
  /** On days that DO have returns, which formula NetSales followed. */
  returnsRule: ReturnsRule;
  /** GrossProfit = GrossSales - Cost on every day. */
  grossProfitIsGrossLessCost: IdentityState;
  /** NetProfit = NetSales - Cost on every day. */
  netProfitIsNetLessCost: IdentityState;
  /** Cultivera days the check looked at. */
  days: number;
  /** First few days that broke a rule, for the page (never hidden). */
  breaks: string[];
};

const near = (a: number, b: number) => Math.abs(a - b) <= IDENTITY_SLACK_MINOR;

/** Check Cultivera's own formulas on exactly these rows. */
export function measureIdentities(theirs: readonly BenchmarkDayRow[]): Identities {
  const breaks: string[] = [];
  const note = (s: string) => {
    if (breaks.length < 5) breaks.push(s);
  };
  let netNoRet = 0;
  let netNoRetBad = 0;
  let gp = 0;
  let gpBad = 0;
  let np = 0;
  let npBad = 0;
  let withReturns = 0;
  let excl = 0;
  let subt = 0;
  const seen = new Set<string>();
  for (const r of theirs) {
    if (!r || !isDay(r.day) || seen.has(r.day)) continue;
    seen.add(r.day);
    if (r.returns_minor === 0) {
      netNoRet++;
      if (!near(r.net_sales_minor, r.gross_sales_minor - r.discounts_minor)) {
        netNoRetBad++;
        note(`${r.day}: net sales is not gross sales less discounts`);
      }
    } else {
      withReturns++;
      const e = near(r.net_sales_minor, r.gross_sales_minor - r.discounts_minor);
      const s = near(r.net_sales_minor, r.gross_sales_minor - r.discounts_minor - r.returns_minor);
      if (e && !s) excl++;
      else if (s && !e) subt++;
      else if (!e && !s) note(`${r.day}: net sales follows neither formula on a day with returns`);
    }
    gp++;
    if (!near(r.gross_profit_minor, r.gross_sales_minor - r.cost_minor)) {
      gpBad++;
      note(`${r.day}: gross profit is not gross sales less cost`);
    }
    np++;
    if (!near(r.net_profit_minor, r.net_sales_minor - r.cost_minor)) {
      npBad++;
      note(`${r.day}: net profit is not net sales less cost`);
    }
  }
  const state = (n: number, bad: number): IdentityState => (n === 0 ? "unmeasured" : bad === 0 ? "holds" : "broken");
  let returnsRule: ReturnsRule;
  if (seen.size === 0) returnsRule = "unmeasured";
  else if (withReturns === 0) returnsRule = "no_returns";
  else if (excl === withReturns) returnsRule = "excludes_returns";
  else if (subt === withReturns) returnsRule = "subtracts_returns";
  else returnsRule = "mixed";
  return {
    netIsGrossLessDiscounts: state(netNoRet, netNoRetBad),
    returnsRule,
    grossProfitIsGrossLessCost: state(gp, gpBad),
    netProfitIsNetLessCost: state(np, npBad),
    days: seen.size,
    breaks,
  };
}

// ---------------------------------------------------------------------------
// 2. Our days
// ---------------------------------------------------------------------------

export type OurOrder = {
  id: string;
  /** Pacific day of completed_at (placed_at for legacy rows), YYYY-MM-DD. */
  day: string;
};

export type OurLine = {
  orderId: string;
  quantity: number;
  /** Stored tax-INCLUSIVE unit price actually charged (order_lines.price_minor_units). */
  priceMinor: number;
  /** Stored tax-inclusive pre-discount unit price; null = no sale price (equals price). */
  regularPriceMinor: number | null;
  isCannabis: boolean;
  salesExempt: boolean;
  exciseExempt: boolean;
};

export type OurRates = { combinedSalesRateBps: number; exciseRateBps: number };

/** One of our Pacific days. Cost is null when any order of the day has no single cost entry. */
export type OurDay = {
  day: string;
  orders: number;
  grossMinor: number;
  discountsMinor: number;
  soldMinor: number;
  taxesMinor: number;
  costMinor: number | null;
  ordersWithoutCost: number;
  /** Customer returns recorded on this Pacific day (counted, never valued: see the header). */
  returns: number;
};

const bps = (amount: number, rate: number) => Math.round((amount * rate) / 10000);

/** Pre-tax gross / sold / discount / tax for one line (the rules in the header). */
export function lineFigures(l: OurLine, rates: OurRates): { gross: number; sold: number; discount: number; taxes: number } {
  const qty = Math.max(0, Math.round(Number.isFinite(l.quantity) ? l.quantity : 0));
  const sold = preTaxLineBaseMinor({
    unitPriceMinorUnits: l.priceMinor,
    quantity: qty,
    isCannabis: l.isCannabis,
    salesExempt: l.salesExempt,
    exciseExempt: l.exciseExempt,
    combinedSalesRateBps: rates.combinedSalesRateBps,
    exciseRateBps: rates.exciseRateBps,
  });
  const gross =
    l.regularPriceMinor === null || l.regularPriceMinor === undefined
      ? sold
      : preTaxLineBaseMinor({
          unitPriceMinorUnits: l.regularPriceMinor,
          quantity: qty,
          isCannabis: l.isCannabis,
          combinedSalesRateBps: rates.combinedSalesRateBps,
          exciseRateBps: rates.exciseRateBps,
        });
  const taxes =
    (l.salesExempt ? 0 : bps(sold, rates.combinedSalesRateBps)) + (l.isCannabis && !l.exciseExempt ? bps(sold, rates.exciseRateBps) : 0);
  return { gross, sold, discount: gross - sold, taxes };
}

export type BuildOurDaysInput = {
  /** Every Pacific day of the window that our system was live for (each gets a row, even with no sales). */
  liveDays: readonly string[];
  orders: readonly OurOrder[];
  lines: readonly OurLine[];
  /** order id -> cost in cents from its single cost entry; an order missing here has an unknown cost. */
  costByOrder: ReadonlyMap<string, number>;
  /** Pacific days of our customer returns (one entry per return). */
  returnDays: readonly string[];
  rates: OurRates;
};

/** Our per-day figures. Orders or returns on a day outside liveDays are ignored (that day is not ours). */
export function buildOurDays(input: BuildOurDaysInput): OurDay[] {
  const days = new Map<string, OurDay>();
  for (const d of input.liveDays) {
    if (!isDay(d) || days.has(d)) continue;
    days.set(d, { day: d, orders: 0, grossMinor: 0, discountsMinor: 0, soldMinor: 0, taxesMinor: 0, costMinor: 0, ordersWithoutCost: 0, returns: 0 });
  }
  const dayOf = new Map<string, string>();
  for (const o of input.orders) {
    const row = days.get(o.day);
    if (!row || dayOf.has(o.id)) continue;
    dayOf.set(o.id, o.day);
    row.orders++;
    const c = input.costByOrder.get(o.id);
    if (c === undefined || !Number.isSafeInteger(c)) {
      row.ordersWithoutCost++;
      row.costMinor = null;
    } else if (row.costMinor !== null) {
      row.costMinor += c;
    }
  }
  for (const l of input.lines) {
    const d = dayOf.get(l.orderId);
    if (!d) continue;
    const row = days.get(d) as OurDay;
    const f = lineFigures(l, input.rates);
    row.grossMinor += f.gross;
    row.soldMinor += f.sold;
    row.discountsMinor += f.discount;
    row.taxesMinor += f.taxes;
  }
  for (const d of input.returnDays) {
    const row = days.get(d);
    if (row) row.returns++;
  }
  return [...days.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/** Every Pacific day from..to inclusive (empty when reversed or invalid; capped at 3,700 days). */
export function dayList(from: string, to: string): string[] {
  const n = daysInRange(from, to);
  const out: string[] = [];
  const start = Date.parse(`${from}T00:00:00Z`);
  for (let i = 0; i < Math.min(n, 3700); i++) out.push(new Date(start + i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

/** The days of from..to our system was live for: from max(from, cutover) to min(to, today). */
export function ourLiveWindow(from: string, to: string, cutover: string | null, today: string): { from: string; to: string } | null {
  if (!isDay(from) || !isDay(to) || !isDay(today) || !cutover || !isDay(cutover)) return null;
  const f = from > cutover ? from : cutover;
  const t = to < today ? to : today;
  return f <= t ? { from: f, to: t } : null;
}

export type OurPeriod = PeriodTotals & {
  orders: number;
  returns: number;
  ordersWithoutCost: number;
  /** Plain reasons a metric of ours is left empty (shown on the page, never hidden). */
  notes: string[];
};

/**
 * Our totals for from..to in the CVB-4 PeriodTotals shape. Derived metrics are filled only when Cultivera's
 * own rows (measured by measureIdentities on the period being compared) prove the same formula.
 */
export function ourPeriodTotals(days: readonly OurDay[], from: string, to: string, ids: Identities): OurPeriod {
  const totals = Object.fromEntries(METRICS.map((m) => [m.key, null])) as Record<MetricKey, number | null>;
  const notes: string[] = [];
  const seen = new Set<string>();
  let n = 0;
  let gross = 0;
  let disc = 0;
  let tax = 0;
  let cost: number | null = 0;
  let orders = 0;
  let returns = 0;
  let noCost = 0;
  for (const d of days) {
    if (!isDay(d.day) || d.day < from || d.day > to || seen.has(d.day)) continue;
    seen.add(d.day);
    n++;
    gross += d.grossMinor;
    disc += d.discountsMinor;
    tax += d.taxesMinor;
    orders += d.orders;
    returns += d.returns;
    noCost += d.ordersWithoutCost;
    if (d.costMinor === null) cost = null;
    else if (cost !== null) cost += d.costMinor;
  }
  if (n > 0) {
    totals.gross_sales = gross;
    totals.discounts = disc;
    totals.taxes = tax;
    totals.cost = cost;
    if (cost === null) notes.push(`Cost is not shown: ${noCost.toLocaleString("en-US")} completed order(s) in this period have no single cost entry in the books.`);
    notes.push("Returns are not compared: how Cultivera valued and dated a return was never measured.");

    let net: number | null = null;
    if (ids.netIsGrossLessDiscounts !== "holds") {
      notes.push("Net sales is not shown: Cultivera's net sales for these days is not gross sales less discounts.");
    } else if (ids.returnsRule === "excludes_returns" || (ids.returnsRule === "no_returns" && returns === 0)) {
      net = gross - disc;
    } else if (ids.returnsRule === "no_returns") {
      notes.push("Net sales is not shown: we had returns in this period and Cultivera had none in its period, so whether its net sales takes returns off cannot be told.");
    } else {
      notes.push("Net sales is not shown: Cultivera's net sales takes returns off (or not consistently), and our returns are not valued the same way.");
    }
    totals.net_sales = net;

    if (ids.grossProfitIsGrossLessCost !== "holds") notes.push("Gross profit is not shown: Cultivera's gross profit for these days is not gross sales less cost.");
    else if (cost !== null) totals.gross_profit = gross - cost;

    if (ids.netProfitIsNetLessCost !== "holds") notes.push("Net profit is not shown: Cultivera's net profit for these days is not net sales less cost.");
    else if (cost !== null && net !== null) totals.net_profit = net - cost;
  }
  return { from, to, daysInPeriod: daysInRange(from, to), daysWithData: n, totals, orders, returns, ordersWithoutCost: noCost, notes };
}

// ---------------------------------------------------------------------------
// 3. The owner's "record a saving" key (idempotent: the same saving twice is one row)
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit, hex. Only used to make a stable key; not a security hash. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** saving:<date>:<cents>:<hash of the note>, so pressing Record twice stores one row. */
export function savingKey(e: Pick<PaybackEntry, "entryDate" | "amountMinor" | "note">): string {
  return `saving:${e.entryDate}:${e.amountMinor}:${fnv1a(e.note.trim().toLowerCase())}`;
}

/** The one metric an outperformance credit is taken on (roadmap section 6: "default: gross profit, pre-tax"). */
export const PAYBACK_METRIC: MetricKey = "gross_profit";

/**
 * An outperformance credit may not cover a day an earlier credit already covered (Nov 1-30 and Nov 1-7 have
 * different keys, so the database alone would let the same days be credited twice). Read from the stored keys
 * (outperform:<metric>:<from>:<to>); returns the clash, or null.
 */
export function creditOverlap(existing: readonly Pick<PaybackEntry, "entryKey" | "kind">[], from: string, to: string): string | null {
  for (const e of existing) {
    if (e.kind !== "outperform") continue;
    const m = /^outperform:[a-z_]+:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(e.entryKey);
    if (!m) return `an earlier credit (${e.entryKey}) cannot be read, so overlap cannot be ruled out`;
    if (m[1] <= to && from <= m[2]) return `${m[1]} to ${m[2]} was already credited`;
  }
  return null;
}

/** The payback meter's bar width, 0..100 (null build cost -> 0). */
export function meterWidth(pctPaidBack: number | null): number {
  if (pctPaidBack === null || !Number.isFinite(pctPaidBack)) return 0;
  return Math.max(0, Math.min(100, pctPaidBack));
}

// ---------------------------------------------------------------------------
// Self-tests (scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------
export function __runCultiveraBenchmarkReportCoreTests(): { passed: number; failed: number } {
  let n = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error(`cultivera-benchmark-report-core: ${m}`);
    n++;
  };
  const row = (day: string, o: Partial<BenchmarkDayRow> = {}): BenchmarkDayRow => {
    const base = { day, gross_sales_minor: 868414, discounts_minor: 257770, taxes_minor: 277990, returns_minor: 0, net_sales_minor: 610644, cost_minor: 368618, gross_profit_minor: 499796, net_profit_minor: 242026, cash_redemption_minor: 0 };
    return { ...base, ...o };
  };

  // identities: the measured 2026-10-31 row proves all three
  const m = measureIdentities([row("2026-10-31")]);
  ok(m.netIsGrossLessDiscounts === "holds" && m.grossProfitIsGrossLessCost === "holds" && m.netProfitIsNetLessCost === "holds", "measured row holds");
  ok(m.returnsRule === "no_returns" && m.days === 1 && m.breaks.length === 0, "measured row: no returns");
  ok(measureIdentities([]).returnsRule === "unmeasured" && measureIdentities([]).netIsGrossLessDiscounts === "unmeasured", "empty is unmeasured");
  ok(measureIdentities([row("2026-10-31", { net_sales_minor: 610645 })]).netIsGrossLessDiscounts === "holds", "1 cent slack");
  const broken = measureIdentities([row("2026-10-31", { net_sales_minor: 610700 })]);
  ok(broken.netIsGrossLessDiscounts === "broken" && broken.breaks[0].startsWith("2026-10-31"), "broken net is named");
  ok(measureIdentities([row("2026-10-31", { gross_profit_minor: 1 })]).grossProfitIsGrossLessCost === "broken", "broken gross profit");
  ok(measureIdentities([row("2026-10-31", { net_profit_minor: 1 })]).netProfitIsNetLessCost === "broken", "broken net profit");
  const sub = measureIdentities([row("2026-10-30", { returns_minor: 1000, net_sales_minor: 609644, net_profit_minor: 241026 })]);
  ok(sub.returnsRule === "subtracts_returns", "returns subtracted");
  ok(measureIdentities([row("2026-10-30", { returns_minor: 1000 })]).returnsRule === "excludes_returns", "returns excluded");
  ok(
    measureIdentities([row("2026-10-30", { returns_minor: 1000 }), row("2026-10-29", { returns_minor: 1000, net_sales_minor: 609644, net_profit_minor: 241026 })]).returnsRule === "mixed",
    "mixed returns rule",
  );
  ok(measureIdentities([row("2026-10-31"), row("2026-10-31", { net_sales_minor: 1 })]).days === 1, "a day is checked once");

  // line figures: $14.63 inclusive cannabis at 9.3% + 37% -> $10.00 pre-tax
  const rates = { combinedSalesRateBps: 930, exciseRateBps: 3700 };
  const plain = lineFigures({ orderId: "o", quantity: 1, priceMinor: 1463, regularPriceMinor: null, isCannabis: true, salesExempt: false, exciseExempt: false }, rates);
  ok(plain.gross === 1000 && plain.sold === 1000 && plain.discount === 0 && plain.taxes === 93 + 370, "plain cannabis line");
  const disc = lineFigures({ orderId: "o", quantity: 2, priceMinor: 1463, regularPriceMinor: 2926, isCannabis: true, salesExempt: false, exciseExempt: false }, rates);
  ok(disc.gross === 4000 && disc.sold === 2000 && disc.discount === 2000, "50% off, two units");
  const nc = lineFigures({ orderId: "o", quantity: 1, priceMinor: 1093, regularPriceMinor: 1093, isCannabis: false, salesExempt: false, exciseExempt: false }, rates);
  ok(nc.sold === 1000 && nc.taxes === 93, "non-cannabis: sales tax only");
  const med = lineFigures({ orderId: "o", quantity: 1, priceMinor: 1000, regularPriceMinor: 1463, isCannabis: true, salesExempt: true, exciseExempt: true }, rates);
  ok(med.sold === 1000 && med.gross === 1000 && med.taxes === 0 && med.discount === 0, "medical exempt: shelf at full rate, paid untaxed");
  const up = lineFigures({ orderId: "o", quantity: 1, priceMinor: 2926, regularPriceMinor: 1463, isCannabis: true, salesExempt: false, exciseExempt: false }, rates);
  ok(up.discount === -1000 && up.gross - up.discount === up.sold, "price raised: negative discount, gross - discount = sold");
  ok(lineFigures({ orderId: "o", quantity: Number.NaN, priceMinor: 1463, regularPriceMinor: null, isCannabis: true, salesExempt: false, exciseExempt: false }, rates).sold === 0, "bad quantity is 0");

  // our days
  const days = buildOurDays({
    liveDays: ["2026-11-01", "2026-11-02", "2026-11-03"],
    orders: [
      { id: "a", day: "2026-11-01" },
      { id: "b", day: "2026-11-01" },
      { id: "c", day: "2026-11-02" },
      { id: "z", day: "2026-10-31" },
      { id: "a", day: "2026-11-02" },
    ],
    lines: [
      { orderId: "a", quantity: 1, priceMinor: 1463, regularPriceMinor: null, isCannabis: true, salesExempt: false, exciseExempt: false },
      { orderId: "b", quantity: 2, priceMinor: 1463, regularPriceMinor: 2926, isCannabis: true, salesExempt: false, exciseExempt: false },
      { orderId: "c", quantity: 1, priceMinor: 1093, regularPriceMinor: null, isCannabis: false, salesExempt: false, exciseExempt: false },
      { orderId: "z", quantity: 1, priceMinor: 999999, regularPriceMinor: null, isCannabis: false, salesExempt: false, exciseExempt: false },
    ],
    costByOrder: new Map([
      ["a", 400],
      ["b", 900],
    ]),
    returnDays: ["2026-11-02", "2026-10-15"],
    rates,
  });
  ok(days.length === 3 && days.map((d) => d.day).join() === "2026-11-01,2026-11-02,2026-11-03", "every live day has a row, sorted");
  ok(days[0].orders === 2 && days[0].grossMinor === 5000 && days[0].discountsMinor === 2000 && days[0].soldMinor === 3000, "day 1 sums");
  ok(days[0].costMinor === 1300 && days[0].ordersWithoutCost === 0, "day 1 cost known");
  ok(days[1].costMinor === null && days[1].ordersWithoutCost === 1 && days[1].returns === 1, "day 2: unknown cost, one return");
  ok(days[2].orders === 0 && days[2].grossMinor === 0 && days[2].costMinor === 0, "a quiet day is a real zero");
  ok(!days.some((d) => d.grossMinor >= 999999), "an order outside our live days is not ours");

  // period totals
  const ids = measureIdentities([row("2025-11-01"), row("2025-11-02"), row("2025-11-03")]);
  const p = ourPeriodTotals(days, "2026-11-01", "2026-11-03", ids);
  ok(p.daysInPeriod === 3 && p.daysWithData === 3 && p.orders === 3 && p.returns === 1, "period counts");
  ok(p.totals.gross_sales === 6000 && p.totals.discounts === 2000 && p.totals.cost === null, "unknown cost poisons the period");
  ok(p.totals.net_sales === null && p.notes.some((x) => x.startsWith("Net sales is not shown: we had returns")), "returns on our side, none on theirs: net refused");
  ok(p.totals.gross_profit === null && p.totals.net_profit === null && p.totals.returns === null, "no cost, no profit; returns never compared");
  const p1 = ourPeriodTotals(days, "2026-11-01", "2026-11-01", ids);
  ok(p1.totals.net_sales === 3000 && p1.totals.cost === 1300 && p1.totals.gross_profit === 3700 && p1.totals.net_profit === 1700, "a clean day derives all three");
  const pb = ourPeriodTotals(days, "2026-11-01", "2026-11-01", { ...ids, grossProfitIsGrossLessCost: "broken" });
  ok(pb.totals.gross_profit === null && pb.totals.net_profit === 1700, "a broken Cultivera formula refuses only that metric");
  const pe = ourPeriodTotals(days, "2026-11-01", "2026-11-01", { ...ids, returnsRule: "excludes_returns" });
  ok(pe.totals.net_sales === 3000, "returns excluded by Cultivera: net shown");
  const ps = ourPeriodTotals(days, "2026-11-01", "2026-11-01", { ...ids, returnsRule: "subtracts_returns" });
  ok(ps.totals.net_sales === null && ps.totals.net_profit === null, "returns subtracted by Cultivera: net refused");
  const empty = ourPeriodTotals([], "2026-11-01", "2026-11-30", ids);
  ok(empty.daysWithData === 0 && empty.totals.gross_sales === null && empty.notes.length === 0, "no days: every metric null, not 0");

  // windows and keys
  ok(dayList("2026-10-30", "2026-11-02").join() === "2026-10-30,2026-10-31,2026-11-01,2026-11-02" && dayList("2026-11-02", "2026-11-01").length === 0, "dayList");
  const w = ourLiveWindow("2026-10-01", "2026-11-30", "2026-11-01", "2026-11-05");
  ok(w?.from === "2026-11-01" && w.to === "2026-11-05", "live window clipped to cutover and today");
  ok(ourLiveWindow("2026-10-01", "2026-10-31", "2026-11-01", "2026-11-05") === null && ourLiveWindow("2026-11-01", "2026-11-02", null, "2026-11-05") === null, "no live window");
  ok(fnv1a("") === "811c9dc5" && fnv1a("a") === "e40c292c", "fnv1a known values");
  const k = savingKey({ entryDate: "2026-12-01", amountMinor: 55000, note: " Cultivera invoice " });
  ok(k === savingKey({ entryDate: "2026-12-01", amountMinor: 55000, note: "cultivera invoice" }) && k.startsWith("saving:2026-12-01:55000:"), "saving key is stable");
  ok(k !== savingKey({ entryDate: "2026-12-01", amountMinor: 55001, note: "cultivera invoice" }), "a different amount is a different saving");
  ok(meterWidth(null) === 0 && meterWidth(13.8) === 13.8 && meterWidth(140) === 100 && meterWidth(-1) === 0, "meter width");
  const credited = [{ entryKey: "outperform:gross_profit:2026-11-01:2026-11-30", kind: "outperform" as const }, { entryKey: "owner-build-cost", kind: "build_cost" as const }];
  ok(creditOverlap(credited, "2026-11-07", "2026-11-07") === "2026-11-01 to 2026-11-30 was already credited", "overlap inside");
  ok(creditOverlap(credited, "2026-10-01", "2026-11-01") !== null && creditOverlap(credited, "2026-12-01", "2026-12-31") === null, "overlap edges");
  ok(creditOverlap([{ entryKey: "outperform:odd", kind: "outperform" }], "2026-12-01", "2026-12-31")?.includes("cannot be read") === true, "unreadable credit refuses");
  ok(PAYBACK_METRIC === "gross_profit" && METRICS.find((x) => x.key === PAYBACK_METRIC)?.direction === "up", "payback metric is more-is-better");

  return { passed: n, failed: 0 };
}
