/**
 * src/lib/accounting/lot-cost-classification-core.ts
 *
 * books-92 / D-72 — ONE answer to "what does this lot cost us?"
 *
 * Michael, verbatim: "the system needs to know that every product coming in
 * has a cost attached. Unless it is a sample. Those are zero cost, and the
 * system knows how to keep them separate from menu products."
 *
 * There are three honest answers for a delivered lot, and the old code only
 * had two because it asked `Number(lot.unit_cost_minor_units) || 0`:
 *
 *   SAMPLE   a lawful free trade sample (WAC 314-55-096). Costs nothing, owes
 *            nothing, belongs on no vendor bill. Correct to exclude.
 *   PRICED   we know the unit cost. Bill it.
 *   UNPRICED we do NOT know the unit cost yet. The price lives on the vendor's
 *            invoice or the JSON and has not been keyed. This is NOT zero.
 *
 * Collapsing UNPRICED into "zero" is what made a half-priced manifest post a
 * half bill: the payable and the inventory value both came out short, and
 * understated inventory means understated COGS, which under 280E means
 * OVERSTATED taxable income. The books still balanced, so nothing looked wrong.
 *
 * WHY THIS FILE EXISTS AT ALL: the bill engine (vendor-bill-service) and the
 * payables screen (vendor-payables-store) must reach the SAME verdict, or the
 * number Michael reads on the screen is not the number that hits the ledger.
 * vendor-payables-store's own header promises exactly that. Two copies of this
 * rule would drift, so there is one copy and both call it.
 *
 * PURE: no I/O, no database, no `server-only` import, so it runs in the tsx
 * pure-selftest runner as well as under vitest.
 */

/** The three honest answers. */
export type LotCostClass = "sample" | "priced" | "unpriced";

/** Only the two columns the verdict depends on. */
export type LotCostInput = {
  readonly unit_cost_minor_units: number | null | undefined;
  readonly is_sample: boolean | null | undefined;
};

/**
 * Classify one delivered lot.
 *
 * ORDER MATTERS. The sample test comes FIRST, because a sample legitimately
 * has no cost. Asking "is the cost missing?" first would report every free
 * sample as an unpriced lot and block every sample delivery Michael takes.
 */
export function classifyLotCost(lot: LotCostInput): LotCostClass {
  if (lot.is_sample === true) return "sample";

  const raw = lot.unit_cost_minor_units;
  if (raw === null || raw === undefined) return "unpriced";
  // A NaN or Infinity that survived a bad parse is not a cost we know.
  if (!Number.isFinite(Number(raw))) return "unpriced";

  return "priced";
}

/**
 * True when this lot should contribute money to a vendor bill / payable.
 * A deliberately keyed 0 is PRICED and returns true; it simply adds nothing.
 */
export function lotIsBillable(lot: LotCostInput): boolean {
  return classifyLotCost(lot) === "priced";
}

/* ═══════════════════════════════════════════════════════════════════════════
 * SELF-TEST (rule 26: the module explains itself and proves it)
 * ═══════════════════════════════════════════════════════════════════════════ */

export function __runLotCostClassificationTests(): void {
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`lot-cost-classification-core: ${msg}`);
  };

  // The distinction the whole defect turned on.
  ok(
    classifyLotCost({ unit_cost_minor_units: null, is_sample: true }) === "sample",
    "a free trade sample is a SAMPLE, not a missing price",
  );
  ok(
    classifyLotCost({ unit_cost_minor_units: null, is_sample: false }) === "unpriced",
    "a purchase with no cost keyed is UNPRICED, not zero",
  );
  ok(
    classifyLotCost({ unit_cost_minor_units: 1500, is_sample: false }) === "priced",
    "a purchase with a cost is PRICED",
  );

  // A keyed zero is knowledge, not absence.
  ok(
    classifyLotCost({ unit_cost_minor_units: 0, is_sample: false }) === "priced",
    "a deliberately keyed zero is KNOWN, so it is PRICED",
  );

  // Order: sample wins even if someone keyed a price onto it.
  ok(
    classifyLotCost({ unit_cost_minor_units: 9999, is_sample: true }) === "sample",
    "the sample flag wins over a stray price",
  );

  // Missing/garbage inputs must never read as free.
  ok(
    classifyLotCost({ unit_cost_minor_units: undefined, is_sample: undefined }) === "unpriced",
    "undefined cost is UNPRICED",
  );
  ok(
    classifyLotCost({ unit_cost_minor_units: Number.NaN, is_sample: false }) === "unpriced",
    "NaN cost is UNPRICED, never 0",
  );

  // billable mirrors the classification exactly.
  ok(
    lotIsBillable({ unit_cost_minor_units: 1500, is_sample: false }),
    "priced lots are billable",
  );
  ok(
    !lotIsBillable({ unit_cost_minor_units: null, is_sample: true }),
    "samples are not billable",
  );
  ok(
    !lotIsBillable({ unit_cost_minor_units: null, is_sample: false }),
    "unpriced lots are not billable (they BLOCK, they do not bill as 0)",
  );
}
