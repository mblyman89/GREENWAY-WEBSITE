/**
 * src/lib/pos/count-audit-stats-core.ts — R74 S50: the count's AUDIT STATISTICS (pure).
 *
 * Turns a count plan (cultivera-count-core planCount lines) plus what the system knows about each
 * lot (category, vendor, unit cost, the published menu card) into the numbers an inventory auditor
 * reads first, then the detail behind them:
 *
 *   overview     system units vs counted, net / gross variance (units and cost value), shrink vs
 *                overage, LOT ACCURACY (share of counted lots that matched exactly — the retail
 *                "inventory record accuracy" figure; ≥ 95% is the usual target, ≥ 98% excellent),
 *                UNIT ACCURACY (1 − gross variance ÷ system units), coverage (lots with stock that
 *                were counted), cost coverage (how much of the value is priced).
 *   breakdowns   by category, by vendor, by counter (productivity + share), top shrink / overage.
 *   menu         the count against the published menu: lots with no menu card, hidden cards that
 *                were counted, cards whose menu stock differs from the shelf.
 *
 * Variance per lot = (counted − sold after the count) − system quantity, i.e. the shelf truth minus
 * the record, BEFORE any earlier apply (so re-applying does not hide the original finding). Lots the
 * count leaves alone for a reason (moved since import, shared barcode, AutoComplete risk, odd sale
 * status) are excluded from accuracy and listed by reason. No imports, no env, no I/O.
 */

export type StatLine = {
  lotCode: string;
  productName: string;
  lotId: string | null;
  counted: number;
  netSold: number;
  rolled: number;
  onHand: number | null;
  exception: string | null;
  byCounter: Record<string, number>;
};

export type LotFact = {
  category: string | null;
  vendor: string | null;
  unitCostCents: number | null;
  menu: { name: string; category: string | null; hidden: boolean; menuStock: number | null; cardId: string } | null;
};

export type GroupRow = {
  key: string;
  lots: number;
  compared: number;
  exact: number;
  system: number;
  counted: number;
  net: number;
  shrink: number;
  over: number;
  valueCents: number;
  accuracyPct: number | null;
};

export type VarianceRow = { code: string; product: string; category: string; system: number; shelf: number; variance: number; valueCents: number | null; counters: string };

export type AuditStats = {
  overview: {
    lotsInScope: number;
    lotsWithStock: number;
    lotsCounted: number;
    compared: number;
    exact: number;
    systemUnits: number;
    countedUnits: number;
    soldAfterCount: number;
    shelfUnits: number;
    netUnits: number;
    grossUnits: number;
    shrinkUnits: number;
    overUnits: number;
    shrinkCents: number;
    overCents: number;
    netCents: number;
    systemCents: number;
    costCoveragePct: number | null;
    lotAccuracyPct: number | null;
    unitAccuracyPct: number | null;
    valueVariancePct: number | null;
    coveragePct: number | null;
    grade: { label: string; tone: "good" | "ok" | "bad" | "none"; why: string };
    uncountedLots: number;
    uncountedUnits: number;
    unknownBarcodes: number;
    unknownUnits: number;
    leftAlone: Record<string, number>;
  };
  byCategory: GroupRow[];
  byVendor: GroupRow[];
  byCounter: { counter: string; units: number; lots: number; unknownUnits: number; sharePct: number }[];
  topShrink: VarianceRow[];
  topOver: VarianceRow[];
  unknown: { code: string; units: number; counters: string }[];
  uncounted: { code: string; product: string; category: string; system: number; valueCents: number | null }[];
  menu: {
    lotsOnMenu: number;
    lotsNotOnMenu: number;
    notOnMenu: { code: string; product: string; shelf: number }[];
    hiddenCounted: { code: string; product: string; shelf: number }[];
    cardsCompared: number;
    cardsMatching: number;
    cardMismatches: { card: string; menuStock: number; shelf: number; diff: number }[];
  };
};

const EXCLUDED = new Set(["moved_since_import", "ambiguous_barcode", "autocomplete_risk", "unknown_order_status", "arrived_after_count"]);

export function gradeFor(lotAccuracyPct: number | null, compared: number): AuditStats["overview"]["grade"] {
  if (lotAccuracyPct == null || compared === 0) return { label: "No data yet", tone: "none", why: "Nothing counted has been compared with the system yet." };
  if (lotAccuracyPct >= 98) return { label: "Excellent", tone: "good", why: "98% or more of counted lots match the record exactly (best-in-class retail record accuracy)." };
  if (lotAccuracyPct >= 95) return { label: "Good", tone: "good", why: "95–98% of counted lots match exactly (the usual retail target is 95%)." };
  if (lotAccuracyPct >= 90) return { label: "Fair", tone: "ok", why: "90–95% match. Recount the biggest variances before applying." };
  return { label: "Needs a recount", tone: "bad", why: "Under 90% of counted lots match. Recount the top variances (and check for a missed area) before applying." };
}

const pct = (a: number, b: number, dp = 1): number | null => (b > 0 ? Math.round((a / b) * 100 * 10 ** dp) / 10 ** dp : null);

export function computeAuditStats(input: { lines: StatLine[]; facts: Map<string, LotFact>; maxRows?: number }): AuditStats {
  const maxRows = input.maxRows ?? 15;
  const fact = (code: string): LotFact => input.facts.get(code.toLowerCase()) ?? { category: null, vendor: null, unitCostCents: null, menu: null };
  const o: AuditStats["overview"] = {
    lotsInScope: 0, lotsWithStock: 0, lotsCounted: 0, compared: 0, exact: 0, systemUnits: 0, countedUnits: 0, soldAfterCount: 0, shelfUnits: 0,
    netUnits: 0, grossUnits: 0, shrinkUnits: 0, overUnits: 0, shrinkCents: 0, overCents: 0, netCents: 0, systemCents: 0,
    costCoveragePct: null, lotAccuracyPct: null, unitAccuracyPct: null, valueVariancePct: null, coveragePct: null,
    grade: gradeFor(null, 0), uncountedLots: 0, uncountedUnits: 0, unknownBarcodes: 0, unknownUnits: 0, leftAlone: {},
  };
  const groups = { cat: new Map<string, GroupRow>(), ven: new Map<string, GroupRow>() };
  const row = (m: Map<string, GroupRow>, k: string) => {
    let g = m.get(k);
    if (!g) m.set(k, (g = { key: k, lots: 0, compared: 0, exact: 0, system: 0, counted: 0, net: 0, shrink: 0, over: 0, valueCents: 0, accuracyPct: null }));
    return g;
  };
  const counters = new Map<string, { units: number; codes: Set<string>; unknownUnits: number }>();
  const variances: VarianceRow[] = [];
  const unknown: AuditStats["unknown"] = [];
  const uncounted: AuditStats["uncounted"] = [];
  let pricedSystemUnits = 0;
  const cards = new Map<string, { name: string; menuStock: number | null; shelf: number; complete: boolean }>();
  const menu: AuditStats["menu"] = { lotsOnMenu: 0, lotsNotOnMenu: 0, notOnMenu: [], hiddenCounted: [], cardsCompared: 0, cardsMatching: 0, cardMismatches: [] };

  for (const l of input.lines) {
    const who = Object.entries(l.byCounter).map(([c, n]) => `${c} ${n}`).join(", ");
    for (const [c, n] of Object.entries(l.byCounter)) {
      const x = counters.get(c) ?? { units: 0, codes: new Set<string>(), unknownUnits: 0 };
      x.units += n;
      x.codes.add(l.lotCode.toLowerCase());
      if (!l.lotId) x.unknownUnits += n;
      counters.set(c, x);
    }
    o.countedUnits += l.counted;
    if (!l.lotId) {
      o.unknownBarcodes++;
      o.unknownUnits += l.counted;
      unknown.push({ code: l.lotCode, units: l.counted, counters: who });
      continue;
    }
    const f = fact(l.lotCode);
    const cat = f.category?.trim() || f.menu?.category?.trim() || "Uncategorized";
    const ven = f.vendor?.trim() || "Unknown vendor";
    const sys = l.onHand ?? 0;
    o.lotsInScope++;
    o.systemUnits += sys;
    o.soldAfterCount += l.netSold;
    if (f.unitCostCents != null) { o.systemCents += sys * f.unitCostCents; pricedSystemUnits += sys; }
    if (sys > 0) o.lotsWithStock++;
    const wasCounted = l.counted > 0 || Object.keys(l.byCounter).length > 0;
    if (wasCounted) o.lotsCounted++;
    const gC = row(groups.cat, cat);
    const gV = row(groups.ven, ven);
    for (const g of [gC, gV]) { g.lots++; g.system += sys; g.counted += l.counted; }
    if (f.menu) menu.lotsOnMenu++;
    else { menu.lotsNotOnMenu++; if (wasCounted) menu.notOnMenu.push({ code: l.lotCode, product: l.productName, shelf: l.rolled }); }
    if (f.menu?.hidden && wasCounted && l.rolled > 0) menu.hiddenCounted.push({ code: l.lotCode, product: l.productName, shelf: l.rolled });

    if (l.exception && EXCLUDED.has(l.exception)) {
      o.leftAlone[l.exception] = (o.leftAlone[l.exception] ?? 0) + 1;
      if (f.menu) { const c = cards.get(f.menu.cardId) ?? { name: f.menu.name, menuStock: f.menu.menuStock, shelf: 0, complete: true }; c.complete = false; cards.set(f.menu.cardId, c); }
      continue;
    }
    if (!wasCounted) {
      if (sys > 0) {
        o.uncountedLots++;
        o.uncountedUnits += sys;
        uncounted.push({ code: l.lotCode, product: l.productName, category: cat, system: sys, valueCents: f.unitCostCents != null ? sys * f.unitCostCents : null });
      }
      if (f.menu) { const c = cards.get(f.menu.cardId) ?? { name: f.menu.name, menuStock: f.menu.menuStock, shelf: 0, complete: true }; if (sys > 0) c.complete = false; cards.set(f.menu.cardId, c); }
      continue;
    }
    const shelf = l.rolled;
    const v = shelf - sys;
    o.compared++;
    o.shelfUnits += shelf;
    o.netUnits += v;
    o.grossUnits += Math.abs(v);
    if (v === 0) o.exact++;
    if (v < 0) o.shrinkUnits -= v;
    if (v > 0) o.overUnits += v;
    const val = f.unitCostCents != null ? v * f.unitCostCents : null;
    if (val != null) { if (val < 0) o.shrinkCents -= val; else o.overCents += val; o.netCents += val; }
    for (const g of [gC, gV]) {
      g.compared++;
      if (v === 0) g.exact++;
      g.net += v;
      if (v < 0) g.shrink -= v; else g.over += v;
      g.valueCents += val ?? 0;
    }
    if (v !== 0) variances.push({ code: l.lotCode, product: l.productName, category: cat, system: sys, shelf, variance: v, valueCents: val, counters: who });
    if (f.menu) {
      const c = cards.get(f.menu.cardId) ?? { name: f.menu.name, menuStock: f.menu.menuStock, shelf: 0, complete: true };
      c.shelf += Math.max(0, shelf);
      cards.set(f.menu.cardId, c);
    }
  }
  o.lotAccuracyPct = pct(o.exact, o.compared);
  const comparedSystem = o.shelfUnits - o.netUnits;
  o.unitAccuracyPct = comparedSystem > 0 ? Math.max(0, Math.round((1 - o.grossUnits / comparedSystem) * 1000) / 10) : null;
  o.valueVariancePct = o.systemCents > 0 ? Math.round((o.netCents / o.systemCents) * 10000) / 100 : null;
  o.coveragePct = pct(o.lotsCounted, Math.max(o.lotsWithStock, o.lotsCounted));
  o.costCoveragePct = pct(pricedSystemUnits, o.systemUnits);
  o.grade = gradeFor(o.lotAccuracyPct, o.compared);

  const finish = (m: Map<string, GroupRow>) =>
    [...m.values()].map((g) => ({ ...g, accuracyPct: pct(g.exact, g.compared) })).sort((a, b) => Math.abs(b.valueCents) - Math.abs(a.valueCents) || b.lots - a.lots || a.key.localeCompare(b.key));
  const totalCounted = [...counters.values()].reduce((a, c) => a + c.units, 0);
  const byCounter = [...counters.entries()]
    .map(([counter, c]) => ({ counter, units: c.units, lots: c.codes.size, unknownUnits: c.unknownUnits, sharePct: pct(c.units, totalCounted) ?? 0 }))
    .sort((a, b) => b.units - a.units || a.counter.localeCompare(b.counter));
  const byImpact = (a: VarianceRow, b: VarianceRow) => Math.abs(b.valueCents ?? 0) - Math.abs(a.valueCents ?? 0) || Math.abs(b.variance) - Math.abs(a.variance) || a.code.localeCompare(b.code);
  for (const c of cards.values()) {
    if (!c.complete || c.menuStock == null) continue;
    menu.cardsCompared++;
    if (c.menuStock === c.shelf) menu.cardsMatching++;
    else menu.cardMismatches.push({ card: c.name, menuStock: c.menuStock, shelf: c.shelf, diff: c.shelf - c.menuStock });
  }
  menu.cardMismatches.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || a.card.localeCompare(b.card));
  menu.cardMismatches = menu.cardMismatches.slice(0, maxRows);
  menu.notOnMenu = menu.notOnMenu.slice(0, maxRows);
  menu.hiddenCounted = menu.hiddenCounted.slice(0, maxRows);
  return {
    overview: o,
    byCategory: finish(groups.cat),
    byVendor: finish(groups.ven).slice(0, maxRows),
    byCounter,
    topShrink: variances.filter((v) => v.variance < 0).sort(byImpact).slice(0, maxRows),
    topOver: variances.filter((v) => v.variance > 0).sort(byImpact).slice(0, maxRows),
    unknown: unknown.sort((a, b) => b.units - a.units).slice(0, maxRows),
    uncounted: uncounted.sort((a, b) => (b.valueCents ?? 0) - (a.valueCents ?? 0) || b.system - a.system).slice(0, maxRows),
    menu,
  };
}

export function money(cents: number | null | undefined): string {
  if (cents == null) return "—";
  const v = Math.round(cents) / 100;
  return `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function __runCountAuditStatsTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL count-audit-stats-core: " + msg);
    passed += 1;
  };
  const L = (code: string, onHand: number | null, counted: number, extra: Partial<StatLine> = {}): StatLine => ({
    lotCode: code, productName: `P-${code}`, lotId: onHand == null ? null : `id-${code}`, counted, netSold: 0, rolled: counted, onHand, exception: null,
    byCounter: counted ? { Ana: counted } : {}, ...extra,
  });
  const facts = new Map<string, LotFact>([
    ["a", { category: "Flower", vendor: "V1", unitCostCents: 500, menu: { name: "Card A", category: "Flower", hidden: false, menuStock: 10, cardId: "c1" } }],
    ["b", { category: "Flower", vendor: "V2", unitCostCents: 1000, menu: { name: "Card B", category: "Flower", hidden: true, menuStock: 5, cardId: "c2" } }],
    ["c", { category: "Edible", vendor: "V1", unitCostCents: null, menu: null }],
  ]);
  const s = computeAuditStats({
    lines: [
      L("A", 10, 10),
      L("B", 5, 3, { byCounter: { Joe: 3 } }),
      L("C", 4, 6, { netSold: 1, rolled: 5 }),
      L("D", 7, 0),
      L("E", 2, 2, { exception: "moved_since_import" }),
      L("ZZ", null, 4, { exception: "unknown_barcode" }),
    ],
    facts,
  });
  const o = s.overview;
  ok(o.compared === 3 && o.exact === 1 && o.lotAccuracyPct === 33.3, `lot accuracy 1 of 3 (${o.lotAccuracyPct})`);
  ok(o.shrinkUnits === 2 && o.overUnits === 1 && o.netUnits === -1 && o.grossUnits === 3, "shrink 2 (B), over 1 (C rolled 5 vs 4)");
  ok(o.shrinkCents === 2000 && o.overCents === 0 && o.netCents === -2000, "value: B 2 × $10 short, C unpriced");
  ok(o.uncountedLots === 1 && o.uncountedUnits === 7 && o.unknownBarcodes === 1 && o.unknownUnits === 4, "uncounted D, unknown ZZ");
  ok(o.leftAlone.moved_since_import === 1 && o.lotsInScope === 5, "moved lot excluded from accuracy but in scope");
  ok(o.unitAccuracyPct === Math.round((1 - 3 / 19) * 1000) / 10 && o.grade.tone === "bad", "unit accuracy + grade");
  ok(s.byCategory[0].key === "Flower" && s.byCategory[0].shrink === 2 && s.byCategory.find((g) => g.key === "Edible")!.over === 1, "by category");
  ok(s.byCounter[0].counter === "Ana" && s.byCounter.find((c) => c.counter === "Ana")!.unknownUnits === 4 && s.byCounter.find((c) => c.counter === "Joe")!.units === 3, "by counter");
  ok(s.topShrink[0].code === "B" && s.topOver[0].code === "C", "top variances");
  ok(s.menu.lotsNotOnMenu === 3 && s.menu.hiddenCounted[0]?.code === "B" && s.menu.cardsCompared === 2 && s.menu.cardsMatching === 1 && s.menu.cardMismatches[0].diff === -2, "menu comparison");
  ok(gradeFor(98.5, 10).label === "Excellent" && gradeFor(96, 10).label === "Good" && gradeFor(null, 0).tone === "none", "grades");
  ok(money(-123456) === "−$1,234.56" && money(null) === "—", "money");
  return { passed, failed: 0 };
}
