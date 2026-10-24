/**
 * src/lib/promotions/size-cost-core.ts  (R74 S31)
 *
 * Per-SIZE acquisition cost for the CCRS cost floor. Before S31 the cost map
 * was one weighted average per card key, so on a Cultivera card with a 1g and
 * a 3.5g size the 3.5g floor was pulled DOWN by the cheap 1g lots and a
 * discount could take the 3.5g below what it cost (WAC 314-55-079 / CCRS:
 * no sale below acquisition cost). With the lot -> size link (0294) each
 * size gets its own average from its own lots.
 *
 * The map keeps the card keys exactly as before and ADDS size entries under
 * `sizeCostKey(card, size)`, which can never equal a card key (it contains a
 * NUL). `costForLine` prefers the size entry and falls back to the card one,
 * so every caller that ignores sizes keeps the pre-S31 numbers.
 *
 * Pure: no I/O. Self-tested via __runSizeCostCoreTests().
 */

export type CostLotRow = {
  pos_product_key: string | null;
  received_qty: number | null;
  unit_cost_minor_units: number | null;
  menu_source_variant_id?: string | null;
};

/** The map key for one size of one card. Never collides with a card key. */
export function sizeCostKey(cardKey: string, sizeId: string): string {
  return `${cardKey}\u0000size:${sizeId}`;
}

/**
 * Weighted-average cost per card key (as before) plus per size key. Weights
 * are received_qty (min 1), the long-standing method shared with the COGS
 * report.
 */
export function buildCostMap(rows: readonly CostLotRow[]): Map<string, number> {
  const num = new Map<string, number>();
  const den = new Map<string, number>();
  const add = (k: string, cost: number, qty: number) => {
    num.set(k, (num.get(k) ?? 0) + cost * qty);
    den.set(k, (den.get(k) ?? 0) + qty);
  };
  for (const row of rows) {
    const key = row?.pos_product_key;
    if (!key || row.unit_cost_minor_units == null) continue;
    const qty = Math.max(1, Math.round(row.received_qty ?? 1));
    add(key, row.unit_cost_minor_units, qty);
    const size = (row.menu_source_variant_id ?? "").trim();
    if (size) add(sizeCostKey(key, size), row.unit_cost_minor_units, qty);
  }
  const out = new Map<string, number>();
  for (const [k, total] of num) {
    const d = den.get(k) ?? 0;
    if (d > 0) out.set(k, Math.round(total / d));
  }
  return out;
}

/**
 * The cost a sold line is floored at: its own size's average when lots are
 * linked to that size, else the card's average (pre-S31), else null.
 */
export function costForLine(
  costs: ReadonlyMap<string, number>,
  cardKey: string | null | undefined,
  sizeId: string | null | undefined,
): number | null {
  const key = (cardKey ?? "").trim();
  if (!key) return null;
  const size = (sizeId ?? "").trim();
  if (size) {
    const own = costs.get(sizeCostKey(key, size));
    if (own != null) return own;
  }
  return costs.get(key) ?? null;
}

export function __runSizeCostCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`size-cost-core self-test failed: ${m}`);
    }
  };
  const rows: CostLotRow[] = [
    { pos_product_key: "card", received_qty: 10, unit_cost_minor_units: 200, menu_source_variant_id: "card-1g" },
    { pos_product_key: "card", received_qty: 10, unit_cost_minor_units: 1000, menu_source_variant_id: "card-35" },
    { pos_product_key: "card", received_qty: 10, unit_cost_minor_units: 1200, menu_source_variant_id: "card-35" },
    { pos_product_key: "plain", received_qty: 4, unit_cost_minor_units: 300 },
    { pos_product_key: "plain", received_qty: null, unit_cost_minor_units: 800 },
    { pos_product_key: "nocost", received_qty: 4, unit_cost_minor_units: null, menu_source_variant_id: "nocost-a" },
    { pos_product_key: null, received_qty: 4, unit_cost_minor_units: 999 },
  ];
  const m = buildCostMap(rows);
  ok(m.get("card") === 800, "card average unchanged ((200+1000+1200)*10/30)");
  ok(m.get(sizeCostKey("card", "card-35")) === 1100, "3.5g costs its own lots only");
  ok(m.get(sizeCostKey("card", "card-1g")) === 200, "1g costs its own lots only");
  ok(m.get("plain") === 400, "unlinked card: the pre-S31 average ((300*4+800*1)/5)");
  ok(!m.has("nocost") && !m.has(sizeCostKey("nocost", "nocost-a")), "no cost -> absent (never 0)");
  ok(![...m.keys()].some((k) => k === "" || k === "null"), "a lot with no key adds nothing");
  ok(sizeCostKey("a", "b") !== "a" && sizeCostKey("a", "b").includes("\u0000"), "size key never equals a card key");

  ok(costForLine(m, "card", "card-35") === 1100, "a 3.5g line floors at the 3.5g cost (not the cheaper average)");
  ok(costForLine(m, "card", "card-7g") === 800, "a size with no linked lot falls back to the card average");
  ok(costForLine(m, "card", null) === 800, "no size: the card average");
  ok(costForLine(m, "plain", "plain-x") === 400, "unlinked card: unchanged");
  ok(costForLine(m, "missing", "x") === null && costForLine(m, null, "x") === null, "unknown / no key -> null");
  return { passed, failed };
}
