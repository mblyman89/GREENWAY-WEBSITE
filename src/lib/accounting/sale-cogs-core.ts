/**
 * src/lib/accounting/sale-cogs-core.ts
 *
 * PURE. Turns the FIFO lot draws a completed sale actually made into a COST
 * for each order line, so `buildSaleJournal` can be given a real
 * `unitCostCentsTotal` instead of a guess.
 *
 * WHY THIS FILE EXISTS (measured, books-82)
 * -----------------------------------------
 * `src/lib/inventory/sale-decrement.ts` already computes the true FIFO draw
 * when an order completes: `buildLotDecrementPlan` returns `lotUpdates[]` of
 * `{ id, posProductKey, delta }`, where `delta` is the negative unit count
 * taken out of that specific lot. But grepping that whole file for
 * `unit_cost` returns ZERO hits — it moves quantities and never looks at
 * money. books-81 finally put a real cost on `inventory_lots
 * .unit_cost_minor_units`; nothing had yet read it back out on the way down.
 *
 * So COGS for a sale was being computed nowhere at all. This file is that
 * missing half, and it is deliberately separate from the decrement so the
 * arithmetic can be tested without a database.
 *
 * THE RULE THIS FILE ENFORCES
 * ---------------------------
 * Cost follows the SAME lots the sale actually consumed. Not an average, not
 * the newest lot, not "close enough". FIFO is the method the books already
 * assume (oldest active lot first, `order("created_at")` in the decrement),
 * and an inventory valuation method cannot be silently switched per-sale —
 * that is a change of accounting method, and under 280E it changes the
 * deduction.
 *
 * WHY IT REFUSES INSTEAD OF ESTIMATING
 * ------------------------------------
 * If any consumed lot has no cost, this core returns a refusal. It would be
 * trivial to substitute the average of the lots that DO have costs, and that
 * would be wrong in the specific way that is hardest to detect later: the
 * books would balance, the margin would look plausible, and the COGS figure
 * feeding the 280E deduction would be fiction. A refusal stops one sale from
 * posting and is fixed by costing the lot. A silent average misstates every
 * return that sale lands in.
 *
 * No imports. Embedded self-tests follow the repo's pure-core pattern.
 */

/* ══════════════════════════════════════════════════════════════════════ */
/* Inputs                                                                 */
/* ══════════════════════════════════════════════════════════════════════ */

/** One lot draw: `qty` units taken out of lot `lotId`, positive. */
export type LotDraw = {
  readonly lotId: string;
  /** The aggregation key the decrement planned under (product/variant key). */
  readonly posProductKey: string;
  /** Units drawn. POSITIVE here even though the decrement stores a delta. */
  readonly qty: number;
};

/** A lot's cost as recorded on `inventory_lots` by the receiving path. */
export type LotCost = {
  readonly lotId: string;
  /**
   * Cost of ONE unit, in integer cents. `null` models the real column, which
   * is nullable — a lot received before books-81, or one whose delivery
   * refused, genuinely has no cost.
   */
  readonly unitCostCents: number | null;
};

/** An order line needing a cost, keyed the same way the draws are. */
export type CostableLine = {
  readonly lineId: string;
  /** Key this line aggregated under; `null` for lines that track no stock. */
  readonly posProductKey: string | null;
  readonly quantity: number;
};

/* ══════════════════════════════════════════════════════════════════════ */
/* Outputs                                                                */
/* ══════════════════════════════════════════════════════════════════════ */

export const SALE_COGS_REFUSAL_CODES = [
  "LOT_COST_MISSING",
  "NEGATIVE_LOT_COST",
  "FRACTIONAL_LOT_COST",
  "DRAW_WITHOUT_LOT_COST_ROW",
  "NEGATIVE_DRAW",
] as const;

export type SaleCogsRefusalCode = (typeof SALE_COGS_REFUSAL_CODES)[number];

export type SaleCogsRefusal = {
  readonly kind: "refused";
  readonly code: SaleCogsRefusalCode;
  readonly explanation: string;
  readonly resolution: string;
};

/** What one line's consumption cost, and which lots it came from. */
export type LineCost = {
  readonly lineId: string;
  /** Total extended cost for the whole line, integer cents. */
  readonly costCents: number;
  /** Units actually drawn from costed lots for this key. */
  readonly unitsDrawn: number;
  /** Lot codes/ids that fed this line, for the audit trail. */
  readonly lotIds: readonly string[];
};

export type SaleCogsResult = {
  readonly kind: "costed";
  readonly lines: readonly LineCost[];
  readonly totalCostCents: number;
  /**
   * Lines with no stock draw at all (custom keypad lines, or a key the
   * decrement never planned). They are NOT an error — but they carry zero
   * cost, and that fact is surfaced rather than buried so a zero-COGS sale is
   * never mistaken for a fully-costed one.
   */
  readonly uncostedLineIds: readonly string[];
};

export type SaleCogsOutcome = SaleCogsResult | SaleCogsRefusal;

/* ══════════════════════════════════════════════════════════════════════ */
/* The calculation                                                        */
/* ══════════════════════════════════════════════════════════════════════ */

function refuse(
  code: SaleCogsRefusalCode,
  explanation: string,
  resolution: string,
): SaleCogsRefusal {
  return { kind: "refused", code, explanation, resolution };
}

/**
 * Extend the FIFO draws by their lot costs and attribute the result to lines.
 *
 * Draws are grouped by `posProductKey`, which is exactly how the decrement
 * aggregated demand. When two lines share a key, the cost is split by the
 * units each line asked for, because that is the only attribution consistent
 * with how the draw was planned in the first place.
 */
export function costSaleFromDraws(
  lines: readonly CostableLine[],
  draws: readonly LotDraw[],
  lotCosts: readonly LotCost[],
): SaleCogsOutcome {
  const costById = new Map<string, number | null>();
  for (const c of lotCosts) costById.set(c.lotId, c.unitCostCents);

  // ── Validate every draw before any arithmetic ──────────────────────────
  // A refusal must be decided on the whole sale, not discovered halfway
  // through building a journal that is already half-written.
  for (const d of draws) {
    if (d.qty < 0) {
      return refuse(
        "NEGATIVE_DRAW",
        `Lot ${d.lotId} reports a negative draw of ${d.qty} units.`,
        "A sale consumes stock; it cannot un-consume it. Check the decrement plan that produced this draw.",
      );
    }
    if (d.qty === 0) continue; // a planned-but-empty draw costs nothing

    if (!costById.has(d.lotId)) {
      return refuse(
        "DRAW_WITHOUT_LOT_COST_ROW",
        `The sale drew ${d.qty} unit(s) from lot ${d.lotId}, but no cost row for that lot was supplied.`,
        "Load inventory_lots.unit_cost_minor_units for every lot the decrement touched before costing the sale.",
      );
    }
    const unit = costById.get(d.lotId) ?? null;
    if (unit === null) {
      return refuse(
        "LOT_COST_MISSING",
        `Lot ${d.lotId} has no unit cost, so the ${d.qty} unit(s) sold from it cannot be costed.`,
        "Cost the lot by receiving its delivery through the goods-receipt path (books-81), then re-post this sale.",
      );
    }
    if (unit < 0) {
      return refuse(
        "NEGATIVE_LOT_COST",
        `Lot ${d.lotId} carries a negative unit cost of ${unit} cents.`,
        "Correct the lot's cost. Negative inventory cost is not a discount; it is a data error.",
      );
    }
    if (!Number.isInteger(unit)) {
      return refuse(
        "FRACTIONAL_LOT_COST",
        `Lot ${d.lotId} carries a fractional unit cost of ${unit}.`,
        "Costs are integer cents. Fix the stored value rather than rounding it here, so the rounding is visible where it happens.",
      );
    }
  }

  // ── Total cost and units per aggregation key ───────────────────────────
  const costByKey = new Map<string, number>();
  const unitsByKey = new Map<string, number>();
  const lotsByKey = new Map<string, string[]>();
  for (const d of draws) {
    if (d.qty === 0) continue;
    const unit = costById.get(d.lotId) as number; // validated above
    costByKey.set(d.posProductKey, (costByKey.get(d.posProductKey) ?? 0) + unit * d.qty);
    unitsByKey.set(d.posProductKey, (unitsByKey.get(d.posProductKey) ?? 0) + d.qty);
    const seen = lotsByKey.get(d.posProductKey) ?? [];
    if (!seen.includes(d.lotId)) seen.push(d.lotId);
    lotsByKey.set(d.posProductKey, seen);
  }

  // Demand per key, so a shared key splits by the units each line wanted.
  const demandByKey = new Map<string, number>();
  for (const l of lines) {
    if (l.posProductKey === null) continue;
    demandByKey.set(l.posProductKey, (demandByKey.get(l.posProductKey) ?? 0) + l.quantity);
  }

  const out: LineCost[] = [];
  const uncosted: string[] = [];
  // Largest-remainder state, per key, so a split key's cents sum EXACTLY to
  // the key's cost. Distributing independently would lose or invent a cent.
  const assignedByKey = new Map<string, number>();
  const lastLineIndexByKey = new Map<string, number>();
  lines.forEach((l, i) => {
    if (l.posProductKey !== null) lastLineIndexByKey.set(l.posProductKey, i);
  });

  lines.forEach((l, i) => {
    const key = l.posProductKey;
    if (key === null || !costByKey.has(key)) {
      uncosted.push(l.lineId);
      out.push({ lineId: l.lineId, costCents: 0, unitsDrawn: 0, lotIds: [] });
      return;
    }
    const keyCost = costByKey.get(key) as number;
    const demand = demandByKey.get(key) ?? 0;

    let share: number;
    if (demand <= 0) {
      share = 0;
    } else if (lastLineIndexByKey.get(key) === i) {
      // The LAST line on a key absorbs the remainder, so the split is exact.
      share = keyCost - (assignedByKey.get(key) ?? 0);
    } else {
      share = Math.floor((keyCost * l.quantity) / demand);
      assignedByKey.set(key, (assignedByKey.get(key) ?? 0) + share);
    }

    out.push({
      lineId: l.lineId,
      costCents: share,
      unitsDrawn: unitsByKey.get(key) ?? 0,
      lotIds: lotsByKey.get(key) ?? [],
    });
  });

  let total = 0;
  for (const l of out) total += l.costCents;

  return { kind: "costed", lines: out, totalCostCents: total, uncostedLineIds: uncosted };
}

/** Convert the decrement's negative deltas into positive draws. */
export function drawsFromLotUpdates(
  lotUpdates: readonly { id: string; posProductKey: string; delta: number }[],
): readonly LotDraw[] {
  return lotUpdates.map((u) => ({
    lotId: u.id,
    posProductKey: u.posProductKey,
    // The decrement stores consumption as a NEGATIVE delta; cost needs the
    // magnitude. Math.abs would silently accept a positive delta (a RETURN)
    // as if it were a sale, so the sign is negated deliberately and a
    // genuinely positive delta becomes negative and is refused above.
    qty: -u.delta,
  }));
}

/* ══════════════════════════════════════════════════════════════════════ */
/* Embedded self-tests                                                    */
/* ══════════════════════════════════════════════════════════════════════ */

export function __runSaleCogsCoreTests(): void {
  const ok = (name: string, cond: boolean) => {
    if (!cond) throw new Error(`sale-cogs-core self-test failed: ${name}`);
  };

  // FIFO across two lots at different costs — the whole point of the file.
  const r1 = costSaleFromDraws(
    [{ lineId: "L1", posProductKey: "p1", quantity: 3 }],
    [
      { lotId: "a", posProductKey: "p1", qty: 2 },
      { lotId: "b", posProductKey: "p1", qty: 1 },
    ],
    [
      { lotId: "a", unitCostCents: 100 },
      { lotId: "b", unitCostCents: 150 },
    ],
  );
  ok("two-lot FIFO costs", r1.kind === "costed");
  if (r1.kind !== "costed") return;
  ok("cost is 2*100 + 1*150", r1.totalCostCents === 350);
  ok("line carries both lots", r1.lines[0].lotIds.length === 2);

  // An uncosted lot must REFUSE, never average the costed one.
  const r2 = costSaleFromDraws(
    [{ lineId: "L1", posProductKey: "p1", quantity: 2 }],
    [
      { lotId: "a", posProductKey: "p1", qty: 1 },
      { lotId: "b", posProductKey: "p1", qty: 1 },
    ],
    [
      { lotId: "a", unitCostCents: 100 },
      { lotId: "b", unitCostCents: null },
    ],
  );
  ok("missing lot cost refuses", r2.kind === "refused");
  ok("refusal names the cause", r2.kind === "refused" && r2.code === "LOT_COST_MISSING");

  // A draw whose lot was never loaded is a different, equally loud failure.
  const r3 = costSaleFromDraws(
    [{ lineId: "L1", posProductKey: "p1", quantity: 1 }],
    [{ lotId: "ghost", posProductKey: "p1", qty: 1 }],
    [],
  );
  ok("unloaded lot refuses", r3.kind === "refused" && r3.code === "DRAW_WITHOUT_LOT_COST_ROW");

  // Two lines sharing a key split the cost EXACTLY (no lost/invented cent).
  const r4 = costSaleFromDraws(
    [
      { lineId: "L1", posProductKey: "p1", quantity: 1 },
      { lineId: "L2", posProductKey: "p1", quantity: 2 },
    ],
    [{ lotId: "a", posProductKey: "p1", qty: 3 }],
    [{ lotId: "a", unitCostCents: 101 }],
  );
  ok("split costs", r4.kind === "costed");
  if (r4.kind !== "costed") return;
  ok("split sums exactly to 303", r4.lines[0].costCents + r4.lines[1].costCents === 303);
  ok("split total agrees", r4.totalCostCents === 303);

  // A line that tracks no stock is zero-cost and SURFACED, not silently zero.
  const r5 = costSaleFromDraws(
    [{ lineId: "custom", posProductKey: null, quantity: 1 }],
    [],
    [],
  );
  ok("custom line costed at zero", r5.kind === "costed" && r5.totalCostCents === 0);
  ok("custom line is reported uncosted", r5.kind === "costed" && r5.uncostedLineIds.length === 1);

  // Sign discipline: the decrement's negative delta becomes a positive draw.
  const d = drawsFromLotUpdates([{ id: "a", posProductKey: "p1", delta: -4 }]);
  ok("delta -4 becomes draw 4", d[0].qty === 4);

  // A POSITIVE delta is a return, not a sale, and must not be costed as one.
  const r6 = costSaleFromDraws(
    [{ lineId: "L1", posProductKey: "p1", quantity: 1 }],
    drawsFromLotUpdates([{ id: "a", posProductKey: "p1", delta: 2 }]),
    [{ lotId: "a", unitCostCents: 100 }],
  );
  ok("positive delta refuses", r6.kind === "refused" && r6.code === "NEGATIVE_DRAW");

  // Negative and fractional stored costs are data errors, not roundables.
  const r7 = costSaleFromDraws(
    [{ lineId: "L1", posProductKey: "p1", quantity: 1 }],
    [{ lotId: "a", posProductKey: "p1", qty: 1 }],
    [{ lotId: "a", unitCostCents: -5 }],
  );
  ok("negative cost refuses", r7.kind === "refused" && r7.code === "NEGATIVE_LOT_COST");

  const r8 = costSaleFromDraws(
    [{ lineId: "L1", posProductKey: "p1", quantity: 1 }],
    [{ lotId: "a", posProductKey: "p1", qty: 1 }],
    [{ lotId: "a", unitCostCents: 10.5 }],
  );
  ok("fractional cost refuses", r8.kind === "refused" && r8.code === "FRACTIONAL_LOT_COST");
}
