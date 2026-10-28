/**
 * src/lib/inventory/sample-lot-core.ts  (Fix Phase 0.2 — G-51, F-15-20)
 *
 * ONE rule, used by every place that could put a trade sample in front of a
 * customer: **a lot with `is_sample = true` is never sellable.**
 *
 * Owner (D68): "They can not be sold at the register, they cannot be found on
 * the menu. They go directly to the employee samples hub where they are
 * distributed there."  WAC 314-55-096(1)(i): "Trade samples may not be sold".
 *
 * Callers:
 *  - catalog-drafts.ts  seedDraftsForManifest  → no Product Onboarding draft
 *  - catalog-drafts.ts  approveDraftWithPrice  → approval refused
 *  - intake-menu-staging.ts / draft-injection.ts → never staged onto a menu
 *  - sale-lot-read.ts   readSaleLots           → never drawn by a sale
 *  - api/pos/menu       lot read               → no stock, no barcode
 *  - register-sellability-store.ts             → never counted as live stock
 *  - lot-menu-stock.ts  syncLotMenuStock       → never moves menu stock
 *  - void-store.ts      restock                → a void never restocks a sample
 *
 * The Employee Samples hub (src/lib/compliance/trade-samples.ts) stays the
 * only path that reduces a sample lot (besides destruction or a count).
 *
 * Pure: no I/O.
 */

/** Plain-English refusal shown when someone tries to approve a sample draft. */
export const SAMPLE_NOT_FOR_SALE_MESSAGE =
  "This product comes from a trade SAMPLE lot. Trade samples may not be sold (WAC 314-55-096(1)(i)), so it cannot be approved onto the menu. Samples are given out only from the Employee Samples hub. Dismiss this draft.";

/** Intake review wording for a sample line (replaces the old advisory warning). */
export const SAMPLE_INTAKE_REVIEW_MESSAGE =
  "Trade SAMPLE → Employee Samples hub. It will not get a menu draft, will not show on the register or website, and cannot be sold (WAC 314-55-096(1)(i)).";

/** True only for an explicit sample flag. Unknown / null means "not a sample". */
export function isSampleLot(lot: { is_sample?: boolean | null } | null | undefined): boolean {
  return lot?.is_sample === true;
}

/** Drop sample lots from a list (keeps order; never mutates the input). */
export function withoutSampleLots<T extends { is_sample?: boolean | null }>(lots: readonly T[]): T[] {
  return lots.filter((l) => !isSampleLot(l));
}

/** Ids of the sample lots in a list (for excluding drafts linked to them). */
export function sampleLotIds(lots: readonly { id: string; is_sample?: boolean | null }[]): Set<string> {
  return new Set(lots.filter((l) => isSampleLot(l)).map((l) => l.id));
}

export function __runSampleLotCoreTests(): void {
  let pass = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`sample-lot-core: ${msg}`);
    pass += 1;
  };
  ok(isSampleLot({ is_sample: true }), "true is a sample");
  ok(!isSampleLot({ is_sample: false }), "false is not");
  ok(!isSampleLot({ is_sample: null }), "null is not");
  ok(!isSampleLot({}), "missing is not");
  ok(!isSampleLot(null), "null lot is not");
  const lots = [
    { id: "a", is_sample: false },
    { id: "b", is_sample: true },
    { id: "c" },
  ];
  ok(withoutSampleLots(lots).map((l) => l.id).join() === "a,c", "filter keeps non-samples in order");
  ok(lots.length === 3, "input not mutated");
  ok([...sampleLotIds(lots)].join() === "b", "sample ids");
  ok(/WAC 314-55-096\(1\)\(i\)/.test(SAMPLE_NOT_FOR_SALE_MESSAGE), "message cites the WAC");
  console.log(`sample-lot-core: ${pass} assertions passed`);
}
