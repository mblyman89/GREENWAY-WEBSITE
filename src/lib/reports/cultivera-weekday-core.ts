/**
 * src/lib/reports/cultivera-weekday-core.ts  (D260, owner request 2026-11-20)
 *
 * Michael: "I want to see what an average Thursday looked like on Cultivera, compared with what an average
 * Thursday looks like on ours ... I just want to see if we are outperforming Cultivera and making more profit
 * per day." (verbatim: docs/sop-program/00-OWNER-REQUEST-VERBATIM.md, D260).
 *
 * PURE. Both sides are folded into the same per-day, per-group figures (cents, pre-tax), then averaged per
 * weekday over the days that had sales.
 *
 *  Cultivera: the archived sales_lines rows. Every OrderStatus is summed per Pacific day of CreatedAt (measured
 *    2026-11-20: this equals Cultivera's own daily report to the cent for Gross, Discounts, NetSales, Taxes and
 *    Cost). NetSales = GrossSales - DiscountAmount is the pre-tax "sales before tax". TotalTax is one number:
 *    a non-cannabis line's tax is all sales tax; a cannabis line's tax is split by the excise : sales rates
 *    (measured TotalTax / NetSales = 0.4630 on cannabis lines = 37% + 9.3%, 0.0929 on non-cannabis).
 *  Ours: lineFigures() of the existing benchmark (pre-tax regular price = gross, pre-tax charged = net), excise
 *    and sales tax on the charged base honouring medical exemptions, cost from each sale's own COGS entry. An
 *    order with no cost entry is "uncosted": its sales count, but margin is measured on costed sales only and
 *    the page says how much was costed (never a guessed cost).
 *
 *  Categories: Cultivera has ~78 names, we have ~14 slugs. Both map into GROUPS below; a name not listed goes
 *  to "Other" (shown, never dropped). A line Cultivera marks IsCannabis=false is always "Accessories".
 */
import { dollarsToCents, isDay } from "@/lib/reports/cultivera-benchmark-core";
import { lineFigures, type OurLine, type OurRates } from "@/lib/reports/cultivera-benchmark-report-core";

export const GROUPS = [
  { key: "flower", label: "Flower" },
  { key: "preroll", label: "Pre-rolls" },
  { key: "infused", label: "Infused pre-rolls, blunts & flower" },
  { key: "vape", label: "Cartridges & disposables" },
  { key: "edible", label: "Edibles & drinks" },
  { key: "concentrate", label: "Concentrates" },
  { key: "topical", label: "Topicals, tinctures & RSO" },
  { key: "accessory", label: "Accessories & non-cannabis" },
  { key: "other", label: "Other / uncategorized" },
] as const;
export type GroupKey = (typeof GROUPS)[number]["key"];

const MAP: Record<GroupKey, string[]> = {
  flower: ["flower", "popcorn-bud", "popcorn bud", "popcorn buds", "mix flower", "trim"],
  preroll: ["preroll", "preroll-pack", "pre-roll", "blunt"],
  infused: ["infused-preroll", "infused-preroll-pack", "infused-blunt", "infused-flower", "infused pre-roll", "infused blunt", "mix infused flower", "moon rocks"],
  vape: ["cartridge", "disposable-cartridge", "disposable cartridge", "live resin cartridge", "cured resin cartridge", "hte cartridge", "solventless cartridge", "pod"],
  edible: [
    "edible-solid", "edible-liquid", "gummies", "edible", "beverage", "chocolate", "fruit chews", "shots", "soda", "liquid infused edible",
    "chewees", "mints", "hard candy", "truffles", "bites", "honey", "peanut butter cups", "panda candies", "marmas", "bar", "other liquid edible", "capsule",
  ],
  concentrate: [
    "concentrate", "bho", "rosin", "live resin", "badder", "hash rosin", "sugar", "hash", "distillate", "shatter", "kief", "thca", "loud resin",
    "terp crystals", "bubble hash", "diamonds", "crumble", "terp sauce", "full melt",
  ],
  topical: ["topical", "tincture", "rso", "roll on", "bath salts", "personal lubricant"],
  accessory: ["accessories", "paraphernalia", "merch", "pipe", "devices", "bong", "paper", "blunt wrap", "dab rig", "glass", "non cannabis accessories", "other non cannabis"],
  other: [],
};
const LOOKUP = new Map<string, GroupKey>();
for (const [k, names] of Object.entries(MAP) as [GroupKey, string[]][]) for (const n of names) LOOKUP.set(n, k);

export function groupOf(category: string | null | undefined, isCannabis: boolean): GroupKey {
  if (!isCannabis) return "accessory";
  return LOOKUP.get((category ?? "").trim().toLowerCase()) ?? "other";
}

/** One side's figures (cents). costedNet = net sales of the lines whose cost is known. */
export type Fig = { orders: number; units: number; gross: number; disc: number; net: number; excise: number; salesTax: number; cost: number; costedNet: number };
const FIG_KEYS = ["orders", "units", "gross", "disc", "net", "excise", "salesTax", "cost", "costedNet"] as const;
export const zeroFig = (): Fig => ({ orders: 0, units: 0, gross: 0, disc: 0, net: 0, excise: 0, salesTax: 0, cost: 0, costedNet: 0 });
const addInto = (a: Fig, b: Fig) => {
  for (const k of FIG_KEYS) a[k] += b[k];
};

/** One Pacific day: the total and each group (orders are counted on the total only). */
export type DayFacts = { day: string; total: Fig; groups: Partial<Record<GroupKey, Fig>> };

/** Split a cannabis line's single tax figure by the excise : sales rates (cents, excise rounded). */
export function splitTax(taxCents: number, isCannabis: boolean, rates: OurRates): { excise: number; salesTax: number } {
  if (!isCannabis) return { excise: 0, salesTax: taxCents };
  const all = rates.exciseRateBps + rates.combinedSalesRateBps;
  const excise = all > 0 ? Math.round((taxCents * rates.exciseRateBps) / all) : 0;
  return { excise, salesTax: taxCents - excise };
}

const PACIFIC = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" });
const cents = (v: unknown) => dollarsToCents(v) ?? 0;

/** Folds Cultivera sales_lines rows into days, one archived part at a time. */
export class CultiveraLineFold {
  private days = new Map<string, DayFacts>();
  private orderIds = new Map<string, Set<string>>();
  rows = 0;
  skipped = 0;
  constructor(private rates: OurRates) {}
  add(rows: readonly Record<string, unknown>[]): void {
    for (const r of rows) {
      this.rows++;
      const t = typeof r.CreatedAt === "string" ? Date.parse(r.CreatedAt) : NaN;
      const day = Number.isFinite(t) ? PACIFIC.format(new Date(t)) : "";
      if (!isDay(day)) {
        this.skipped++;
        continue;
      }
      const cann = r.IsCannabis !== false;
      const g = groupOf(typeof r.Category === "string" ? r.Category : null, cann);
      const net = cents(r.NetSales);
      const cost = cents(r.Cost);
      const tax = splitTax(cents(r.TotalTax), cann, this.rates);
      const f: Fig = {
        orders: 0,
        units: Number.isFinite(Number(r.Units)) ? Number(r.Units) : 0,
        gross: cents(r.GrossSales),
        disc: cents(r.DiscountAmount),
        net,
        excise: tax.excise,
        salesTax: tax.salesTax,
        cost,
        costedNet: net,
      };
      let d = this.days.get(day);
      if (!d) this.days.set(day, (d = { day, total: zeroFig(), groups: {} }));
      addInto(d.total, f);
      addInto((d.groups[g] ??= zeroFig()), f);
      const oid = String(r.OrderId ?? "");
      if (oid) {
        let s = this.orderIds.get(day);
        if (!s) this.orderIds.set(day, (s = new Set()));
        if (!s.has(oid)) {
          s.add(oid);
          d.total.orders++;
        }
      }
    }
  }
  result(): DayFacts[] {
    return [...this.days.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
  }
}

export type OurWeekdayLine = OurLine & { category: string | null };
export type OurWeekdayInput = {
  orders: readonly { id: string; day: string }[];
  lines: readonly OurWeekdayLine[];
  /** order id -> cost cents of its single COGS entry; missing = uncosted order. */
  costByOrder: ReadonlyMap<string, number>;
  rates: OurRates;
};

/** Our days in the same shape (cost and costedNet only from orders with a cost entry). */
export function foldOurDays(input: OurWeekdayInput): DayFacts[] {
  const days = new Map<string, DayFacts>();
  const dayOf = new Map<string, string>();
  for (const o of input.orders) {
    if (!isDay(o.day) || dayOf.has(o.id)) continue;
    dayOf.set(o.id, o.day);
    let d = days.get(o.day);
    if (!d) days.set(o.day, (d = { day: o.day, total: zeroFig(), groups: {} }));
    d.total.orders++;
    const c = input.costByOrder.get(o.id);
    if (c !== undefined) d.total.cost += c;
  }
  const r = input.rates;
  const bps = (a: number, rate: number) => Math.round((a * rate) / 10000);
  for (const l of input.lines) {
    const day = dayOf.get(l.orderId);
    if (!day) continue;
    const d = days.get(day) as DayFacts;
    const lf = lineFigures(l, r);
    const costed = input.costByOrder.has(l.orderId);
    const f: Fig = {
      orders: 0,
      units: Math.max(0, Math.round(l.quantity || 0)),
      gross: lf.gross,
      disc: lf.discount,
      net: lf.sold,
      excise: l.isCannabis && !l.exciseExempt ? bps(lf.sold, r.exciseRateBps) : 0,
      salesTax: l.salesExempt ? 0 : bps(lf.sold, r.combinedSalesRateBps),
      cost: 0,
      costedNet: costed ? lf.sold : 0,
    };
    const cost = d.total.cost;
    addInto(d.total, f);
    d.total.cost = cost;
    addInto((d.groups[groupOf(l.category, l.isCannabis)] ??= zeroFig()), f);
  }
  return [...days.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

/** Cost per group for our side, added from COGS lines "COGS — <slug>" (slug -> group). */
export function addOurGroupCost(days: DayFacts[], costLines: readonly { day: string; slug: string; cents: number }[], cannabis: (slug: string) => boolean): void {
  const byDay = new Map(days.map((d) => [d.day, d]));
  for (const c of costLines) {
    const d = byDay.get(c.day);
    if (!d) continue;
    (d.groups[groupOf(c.slug, cannabis(c.slug))] ??= zeroFig()).cost += c.cents;
  }
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const weekdayOf = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

/** Average per weekday (0..6) and over all days (7), for days in from..to that had sales. */
export type WeekdayAvg = { days: number; avg: Fig; groups: Partial<Record<GroupKey, Fig>> };
export function weekdayAverages(days: readonly DayFacts[], from: string, to: string): WeekdayAvg[] {
  const acc = Array.from({ length: 8 }, () => ({ days: 0, sum: zeroFig(), groups: {} as Partial<Record<GroupKey, Fig>> }));
  for (const d of days) {
    if (d.day < from || d.day > to || d.total.orders + d.total.net === 0) continue;
    for (const slot of [acc[weekdayOf(d.day)], acc[7]]) {
      slot.days++;
      addInto(slot.sum, d.total);
      for (const [g, f] of Object.entries(d.groups) as [GroupKey, Fig][]) addInto((slot.groups[g] ??= zeroFig()), f);
    }
  }
  const div = (f: Fig, n: number): Fig => {
    const o = zeroFig();
    for (const k of FIG_KEYS) o[k] = n ? f[k] / n : 0;
    return o;
  };
  return acc.map((a) => ({
    days: a.days,
    avg: div(a.sum, a.days),
    groups: Object.fromEntries(Object.entries(a.groups).map(([g, f]) => [g, div(f as Fig, a.days)])) as Partial<Record<GroupKey, Fig>>,
  }));
}

/** Margin on costed sales (null when nothing was costed). */
export const marginOf = (f: Fig): number | null => (f.costedNet > 0 ? (f.costedNet - f.cost) / f.costedNet : null);
/** Gross profit per day at the measured margin (= net - cost when every sale was costed). */
export const profitOf = (f: Fig): number | null => {
  const m = marginOf(f);
  return m === null ? null : f.net * m;
};
export const discountRateOf = (f: Fig): number | null => (f.gross > 0 ? f.disc / f.gross : null);

// Compact JSON for the cache (unstable_cache stores JSON only).
export const packDays = (days: readonly DayFacts[]) =>
  days.map((d) => [d.day, FIG_KEYS.map((k) => d.total[k]), Object.fromEntries(Object.entries(d.groups).map(([g, f]) => [g, FIG_KEYS.map((k) => (f as Fig)[k])]))] as const);
export function unpackDays(packed: ReturnType<typeof packDays>): DayFacts[] {
  const fig = (a: readonly number[]) => Object.fromEntries(FIG_KEYS.map((k, i) => [k, a[i] ?? 0])) as Fig;
  return packed.map(([day, t, g]) => ({ day, total: fig(t), groups: Object.fromEntries(Object.entries(g).map(([k, a]) => [k, fig(a)])) }));
}

export function __runCultiveraWeekdayTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error("  x cultivera-weekday-core:", m);
    }
  };
  const rates: OurRates = { combinedSalesRateBps: 930, exciseRateBps: 3700 };
  ok(groupOf("Disposable Cartridge", true) === "vape" && groupOf("disposable-cartridge", true) === "vape", "both systems map to one group");
  ok(groupOf("Pipe", false) === "accessory" && groupOf("Gummies", false) === "accessory", "non-cannabis is always accessories");
  ok(groupOf("Mystery", true) === "other", "unknown name -> other, never dropped");
  const s = splitTax(4630, true, rates);
  ok(s.excise === 3700 && s.salesTax === 930, "cannabis tax split 37 : 9.3");
  ok(splitTax(93, false, rates).excise === 0, "non-cannabis tax is all sales tax");

  const fold = new CultiveraLineFold(rates);
  fold.add([
    { CreatedAt: "2025-10-03T02:00:00Z", OrderId: 1, Category: "Flower", IsCannabis: true, GrossSales: 20, DiscountAmount: 5, NetSales: 15, TotalTax: 6.95, Cost: 6, Units: 1 },
    { CreatedAt: "2025-10-03T02:00:00Z", OrderId: 1, Category: "Pipe", IsCannabis: false, GrossSales: 10, DiscountAmount: 0, NetSales: 10, TotalTax: 0.93, Cost: 4, Units: 1 },
    { CreatedAt: "bad", OrderId: 2 },
  ]);
  const cd = fold.result();
  ok(cd.length === 1 && cd[0].day === "2025-10-02", "UTC 02:00 is the previous Pacific day");
  ok(cd[0].total.orders === 1 && cd[0].total.net === 2500 && cd[0].total.disc === 500 && cd[0].total.cost === 1000, "one order, cents exact");
  ok(cd[0].groups.accessory?.salesTax === 93 && fold.skipped === 1, "groups kept; bad row counted");

  const ours = foldOurDays({
    orders: [{ id: "a", day: "2026-11-05" }, { id: "b", day: "2026-11-05" }],
    lines: [
      { orderId: "a", quantity: 1, priceMinor: 1463, regularPriceMinor: null, isCannabis: true, salesExempt: false, exciseExempt: false, category: "flower" },
      { orderId: "b", quantity: 1, priceMinor: 1463, regularPriceMinor: null, isCannabis: true, salesExempt: false, exciseExempt: false, category: "preroll" },
    ],
    costByOrder: new Map([["a", 400]]),
    rates,
  });
  ok(ours[0].total.orders === 2 && ours[0].total.cost === 400 && ours[0].total.costedNet === ours[0].total.net / 2, "uncosted order counts in sales, not in costed sales");
  const m = marginOf(ours[0].total) as number;
  ok(Math.abs(m - (ours[0].total.costedNet - 400) / ours[0].total.costedNet) < 1e-9, "margin on costed sales only");

  const avg = weekdayAverages([...cd, { day: "2025-10-09", total: { ...cd[0].total, net: 4500 }, groups: {} }], "2025-01-01", "2025-12-31");
  ok(avg[4].days === 2 && avg[4].avg.net === 3500 && avg[7].days === 2, "two Thursdays averaged");
  ok(unpackDays(packDays(cd))[0].groups.flower?.gross === 2000, "pack/unpack round trip");
  return { passed, failed };
}
