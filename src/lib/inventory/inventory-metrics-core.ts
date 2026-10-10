/**
 * R38 S2 — derived, per-lot inventory metrics for the enterprise table.
 *
 * Owner: "I want it to be a professional, all inclusive, data rich,
 * enterprise grade table … show me everything that an enterprise grade
 * solution would show."
 *
 * What enterprise cannabis inventory reports show beyond the raw row (Dutchie
 * inventory report: Inventory Cost, Days Supply, Received/Last Audited/
 * Expiration dates; standard retail KPIs: sell-through, extended cost/retail,
 * ABC class, aging). Each is computed ONCE here, then the table, the sorts,
 * the facets, the totals row and the export all read the same number.
 *
 * DOCTRINE: unknown is null, never zero. A lot with no unit cost has no
 * extended cost (not $0); a lot with no received date has no age, velocity
 * or days of supply. The definitions deliberately match the Insights panel
 * (inventory-intel-core): on-hand value at cost = round(on hand × cost) and
 * the depletion rate uses the same 7-day floor on age, so a lot received
 * yesterday does not report an absurd velocity.
 *
 * PURE. No I/O.
 */

export type AbcClassValue = "A" | "B" | "C";

export type InventoryMetrics = {
  /** Whole days since the evidenced received date (null = no date on file). */
  ageDays: number | null;
  /** Aging bucket matching the Insights panel. */
  agingBucket: "0-30" | "31-60" | "61-90" | "90+" | null;
  /** On hand × unit cost, minor units (null = unit cost unknown). */
  extCostMinor: number | null;
  /** On hand × approved shelf price (tax-incl.), minor units (null = no price). */
  extRetailMinor: number | null;
  /** Sold ÷ received, percent with one decimal (null = nothing received). */
  sellThroughPct: number | null;
  /** Units sold per day since receipt (2 dp). 0 = received but nothing sold. */
  velocityPerDay: number | null;
  /** On hand ÷ velocity, whole days (null = no sales rate to divide by). */
  daysOfSupply: number | null;
  /** Days until the lot's expiry (negative = already expired). */
  daysToExpiry: number | null;
  /** Days until the COA expires (negative = expired). */
  coaDaysToExpiry: number | null;
  /** ABC class among ACTIVE lots by on-hand value (Insights panel rule). */
  abc: AbcClassValue | null;
  /** The product has a card on the published menu. */
  onMenu: boolean;
};

export type MetricsLot = {
  id: string;
  status?: string | null;
  on_hand_qty?: number | null;
  received_qty?: number | null;
  unit_cost_minor_units?: number | null;
  received_on?: string | null;
  expires_on?: string | null;
  pos_product_key?: string | null;
  onboarding_price_minor?: number | null;
  lab?: { coa_expire_date?: string | null } | null;
};

export type MetricsContext = {
  /** Store business day, YYYY-MM-DD (Pacific). */
  today: string;
  /** Published-menu product keys (resolveWebsiteCategoriesWithLiveKeys). */
  liveKeys?: ReadonlySet<string>;
  /** ABC by lot id (buildCommandCenter().abcByLot). */
  abcByLot?: ReadonlyMap<string, AbcClassValue>;
};

/** Minimum age used for a sales rate (the Insights panel's 7-day floor). */
export const VELOCITY_MIN_AGE_DAYS = 7;

const DAY_MS = 86_400_000;

function isoDay(v: string | null | undefined): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v ?? ""));
  return m ? m[1] : null;
}

/** Signed whole days from `from` to `to` (both YYYY-MM-DD), null on garbage. */
export function signedDays(from: string | null | undefined, to: string | null | undefined): number | null {
  const a = isoDay(from);
  const b = isoDay(to);
  if (!a || !b) return null;
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(da) || !Number.isFinite(db)) return null;
  return Math.round((db - da) / DAY_MS);
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function computeInventoryMetrics(lot: MetricsLot, ctx: MetricsContext): InventoryMetrics {
  const onHand = Math.max(0, num(lot.on_hand_qty) ?? 0);
  const received = Math.max(0, num(lot.received_qty) ?? 0);
  const sold = Math.max(0, received - onHand);
  const cost = num(lot.unit_cost_minor_units);
  const price = num(lot.onboarding_price_minor);

  const age = signedDays(lot.received_on, ctx.today);
  const ageDays = age == null ? null : Math.max(0, age);
  const agingBucket =
    ageDays == null ? null : ageDays <= 30 ? "0-30" : ageDays <= 60 ? "31-60" : ageDays <= 90 ? "61-90" : "90+";

  let velocityPerDay: number | null = null;
  if (ageDays != null && received > 0) {
    velocityPerDay = sold > 0 ? Math.round((sold / Math.max(VELOCITY_MIN_AGE_DAYS, ageDays)) * 100) / 100 : 0;
  }
  let daysOfSupply: number | null = null;
  if (velocityPerDay != null && velocityPerDay > 0) daysOfSupply = Math.round(onHand / velocityPerDay);

  const key = String(lot.pos_product_key ?? "").trim();
  return {
    ageDays,
    agingBucket,
    extCostMinor: cost == null || cost < 0 ? null : Math.round(onHand * cost),
    extRetailMinor: price == null || price <= 0 ? null : Math.round(onHand * price),
    sellThroughPct: received > 0 ? Math.round((sold / received) * 1000) / 10 : null,
    velocityPerDay,
    daysOfSupply,
    daysToExpiry: signedDays(ctx.today, lot.expires_on),
    coaDaysToExpiry: signedDays(ctx.today, lot.lab?.coa_expire_date ?? null),
    abc: ctx.abcByLot?.get(lot.id) ?? null,
    onMenu: key.length > 0 && Boolean(ctx.liveKeys?.has(key)),
  };
}

/** Attach `inv_metrics` to each lot (pure; input never mutated). */
export function attachInventoryMetrics<L extends MetricsLot>(
  lots: readonly L[],
  ctx: MetricsContext,
): Array<L & { inv_metrics: InventoryMetrics }> {
  return lots.map((l) => ({ ...l, inv_metrics: computeInventoryMetrics(l, ctx) }));
}

/** Totals over a set of lots (the table footer + export summary). */
export type InventoryTotals = {
  lots: number;
  extCostMinor: number;
  /** Lots with stock whose cost is unknown (excluded from extCostMinor). */
  extCostUnknown: number;
  extRetailMinor: number;
  /** Lots with stock that have no approved price (excluded from extRetailMinor). */
  extRetailUnknown: number;
  /** Sum of on-hand units by unit ("ea", "g" …) — never mixed into one number. */
  onHandByUnit: Record<string, number>;
};

export function inventoryTotals(
  lots: ReadonlyArray<MetricsLot & { unit?: string | null; inv_metrics?: InventoryMetrics }>,
): InventoryTotals {
  const t: InventoryTotals = {
    lots: lots.length,
    extCostMinor: 0,
    extCostUnknown: 0,
    extRetailMinor: 0,
    extRetailUnknown: 0,
    onHandByUnit: {},
  };
  for (const l of lots) {
    const m = l.inv_metrics;
    const onHand = Math.max(0, num(l.on_hand_qty) ?? 0);
    if (onHand > 0) {
      const u = String(l.unit ?? "").trim() || "ea";
      t.onHandByUnit[u] = Math.round(((t.onHandByUnit[u] ?? 0) + onHand) * 1000) / 1000;
    }
    if (m?.extCostMinor != null) t.extCostMinor += m.extCostMinor;
    else if (onHand > 0) t.extCostUnknown += 1;
    if (m?.extRetailMinor != null) t.extRetailMinor += m.extRetailMinor;
    else if (onHand > 0) t.extRetailUnknown += 1;
  }
  return t;
}

// ---------------------------------------------------------------------------
// Self-tests (pure). Registered in scripts/compliance/run-pure-selftests.ts.
// ---------------------------------------------------------------------------
export function __runInventoryMetricsTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL inventory-metrics-core: " + msg);
    }
  };
  const ctx: MetricsContext = {
    today: "2026-03-31",
    liveKeys: new Set(["K1"]),
    abcByLot: new Map([["L1", "A" as const]]),
  };
  const base: MetricsLot = {
    id: "L1",
    status: "active",
    on_hand_qty: 30,
    received_qty: 100,
    unit_cost_minor_units: 500,
    received_on: "2026-03-01",
    expires_on: "2026-04-10",
    pos_product_key: "K1",
    onboarding_price_minor: 1500,
    lab: { coa_expire_date: "2026-03-30" },
  };
  const m = computeInventoryMetrics(base, ctx);
  ok(m.ageDays === 30 && m.agingBucket === "0-30", `age 30 (got ${m.ageDays})`);
  ok(m.extCostMinor === 15000, "ext cost 30 × 500");
  ok(m.extRetailMinor === 45000, "ext retail 30 × 1500");
  ok(m.sellThroughPct === 70, "sell-through 70/100");
  ok(m.velocityPerDay === 2.33, `velocity 70/30 (got ${m.velocityPerDay})`);
  ok(m.daysOfSupply === 13, `days of supply 30/2.33 (got ${m.daysOfSupply})`);
  ok(m.daysToExpiry === 10, "10 days to expiry");
  ok(m.coaDaysToExpiry === -1, "COA expired yesterday → -1");
  ok(m.abc === "A" && m.onMenu === true, "abc + on menu");

  // Unknowns stay unknown.
  const u = computeInventoryMetrics({ id: "x", on_hand_qty: 5, received_qty: 5 }, ctx);
  ok(u.ageDays === null && u.agingBucket === null && u.velocityPerDay === null && u.daysOfSupply === null, "no received date → no age/velocity/supply");
  ok(u.extCostMinor === null && u.extRetailMinor === null, "no cost/price → null, never $0");
  ok(u.daysToExpiry === null && u.coaDaysToExpiry === null && u.abc === null && u.onMenu === false, "no expiry/coa/abc/menu");
  // Received but nothing sold → velocity 0, no days of supply.
  const z = computeInventoryMetrics({ ...base, on_hand_qty: 100 }, ctx);
  ok(z.velocityPerDay === 0 && z.daysOfSupply === null && z.sellThroughPct === 0, "nothing sold");
  // 7-day floor: received today, sold 14 → 2/day, not 14/day or infinity.
  const f = computeInventoryMetrics({ ...base, received_on: "2026-03-31", received_qty: 20, on_hand_qty: 6 }, ctx);
  ok(f.velocityPerDay === 2 && f.ageDays === 0, `7-day floor (got ${f.velocityPerDay})`);
  // Over-received (found stock) never yields negative sold.
  const o = computeInventoryMetrics({ ...base, on_hand_qty: 120 }, ctx);
  ok(o.sellThroughPct === 0 && o.extCostMinor === 60000, "on hand above received → sold 0");
  // Zero cost is a real cost (free sample) — $0, not unknown.
  ok(computeInventoryMetrics({ ...base, unit_cost_minor_units: 0 }, ctx).extCostMinor === 0, "zero cost is $0");
  // Zero price is not a price.
  ok(computeInventoryMetrics({ ...base, onboarding_price_minor: 0 }, ctx).extRetailMinor === null, "zero price → null");
  // Aging buckets.
  ok(computeInventoryMetrics({ ...base, received_on: "2026-01-30" }, ctx).agingBucket === "31-60", "60 days → 31-60");
  ok(computeInventoryMetrics({ ...base, received_on: "2025-12-01" }, ctx).agingBucket === "90+", "120 days → 90+");
  ok(computeInventoryMetrics({ ...base, received_on: "2026-01-01" }, ctx).agingBucket === "61-90", "89 days → 61-90");
  // Future received date clamps age at 0.
  ok(computeInventoryMetrics({ ...base, received_on: "2026-04-05" }, ctx).ageDays === 0, "future received → 0");
  // Timestamps accepted.
  ok(signedDays("2026-03-01T23:00:00Z", "2026-03-02") === 1 && signedDays("junk", "2026-03-02") === null, "signedDays");
  // Key whitespace is not a key.
  ok(computeInventoryMetrics({ ...base, pos_product_key: "  " }, ctx).onMenu === false, "blank key never on menu");

  // Totals.
  const lots = attachInventoryMetrics(
    [
      { ...base, unit: "ea" } as MetricsLot & { unit: string },
      { ...base, id: "L2", unit: "ea", unit_cost_minor_units: null, onboarding_price_minor: null } as MetricsLot & { unit: string },
      { ...base, id: "L3", unit: "g", on_hand_qty: 2.5 } as MetricsLot & { unit: string },
      { ...base, id: "L4", unit: "ea", on_hand_qty: 0, unit_cost_minor_units: null } as MetricsLot & { unit: string },
    ],
    ctx,
  );
  const t = inventoryTotals(lots);
  ok(t.lots === 4, "totals lot count");
  ok(t.extCostMinor === 15000 + 1250 && t.extCostUnknown === 1, `ext cost sum (got ${t.extCostMinor}/${t.extCostUnknown})`);
  ok(t.extRetailMinor === 45000 + 3750 && t.extRetailUnknown === 1, "ext retail sum");
  ok(t.onHandByUnit.ea === 60 && t.onHandByUnit.g === 2.5 && Object.keys(t.onHandByUnit).length === 2, "on hand by unit, never mixed");
  ok(!("inv_metrics" in base), "attach is pure");
  return { passed, failed };
}
