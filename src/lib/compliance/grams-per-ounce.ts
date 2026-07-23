/**
 * src/lib/compliance/grams-per-ounce.ts  (GW-016)
 *
 * THE one home for every grams-per-ounce equivalence in the codebase.
 *
 * The problem (FINDINGS GW-016): three different values — 28, 28.35, and
 * 28.3495 — lived as unnamed local constants in five files. Each was
 * CORRECT for its own context, but nothing documented which law uses
 * which, so a future editor could "fix" the wrong constant in the wrong
 * direction (e.g. loosening the recreational limit from 28 g to 28.35 g,
 * or tightening the DOH medical table). This module names all three and
 * pins the intent with self-tests; no behavior changes.
 *
 * WHICH VALUE WHICH LAW USES — do not "unify" these:
 *
 *  - STATUTORY_GRAMS_PER_OUNCE = 28
 *    WAC 314-55-095's sales-limit table is written in ounces, and WA
 *    enforcement practice treats 1 oz usable = 28 g exactly. This is the
 *    LICENSE-CRITICAL equivalence: the recreational/medical limit
 *    enforcement engine (sales-limits-core) and the product-size parser
 *    that feeds it (variant-grams-core) both use 28 so enforcement stays
 *    CONSERVATIVE (a "1 oz" bag counts as its full statutory ounce).
 *
 *  - METRIC_GRAMS_PER_OUNCE = 28.35
 *    The DOH medical allowance convention (RCW 69.51A.210 / WAC 246-71
 *    materials express patient limits in ounces; 28.35 g/oz is the
 *    conversion the medical purchase-limit table has always used, giving
 *    a 3-oz allowance of 85.05 g). Display code divides by the same value
 *    and rounds, so patient-facing ounce figures come out exact. Note the
 *    ENFORCED medical cap remains sales-limits-core's statutory 84 g —
 *    the stricter of the two always wins at the register.
 *
 *  - AVOIRDUPOIS_GRAMS_PER_OUNCE = 28.3495
 *    The true physical conversion, for turning a REAL measured weight
 *    (a lot's unit weight in oz) into grams — employee-sample budgets,
 *    CCRS batch weights, menu-card cannabinoid math. Rounding this one
 *    UP to 28.35 would overstate real weights; truncating to 28 would
 *    understate them.
 *
 * PURE module — no imports at all — safe everywhere (client, server, tsx).
 */

/** WA statutory limit equivalence: 1 oz usable = 28 g (WAC 314-55-095 enforcement). */
export const STATUTORY_GRAMS_PER_OUNCE = 28;

/** DOH medical-allowance convention: 1 oz = 28.35 g (patient limit table + display). */
export const METRIC_GRAMS_PER_OUNCE = 28.35;

/** True avoirdupois conversion: 1 oz = 28.3495 g (real measured weights). */
export const AVOIRDUPOIS_GRAMS_PER_OUNCE = 28.3495;

// ---------------------------------------------------------------------------
// Self-tests (tsx-runnable; PURE).
// ---------------------------------------------------------------------------

export function __runGramsPerOunceTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) {
      pass += 1;
    } else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };

  // The exact values are LOAD-BEARING — a change to any of them changes
  // limit enforcement, the medical table, or weight math. Pin them.
  ok(STATUTORY_GRAMS_PER_OUNCE === 28, "statutory = 28 exactly (WAC 314-55-095 enforcement)");
  ok(METRIC_GRAMS_PER_OUNCE === 28.35, "metric = 28.35 exactly (DOH medical convention)");
  ok(AVOIRDUPOIS_GRAMS_PER_OUNCE === 28.3495, "avoirdupois = 28.3495 exactly (real weights)");

  // Ordering invariant: enforcement (28) is the STRICTEST per-ounce figure,
  // so statutory limits are always <= the DOH-convention equivalents.
  ok(
    STATUTORY_GRAMS_PER_OUNCE < AVOIRDUPOIS_GRAMS_PER_OUNCE &&
      AVOIRDUPOIS_GRAMS_PER_OUNCE < METRIC_GRAMS_PER_OUNCE,
    "28 < 28.3495 < 28.35 (statutory strictest; metric is the rounded-up display value)",
  );

  // The worked consequences the audit called out, pinned so they can't drift:
  ok(3 * STATUTORY_GRAMS_PER_OUNCE === 84, "3 oz enforced medical usable cap = 84 g");
  // (float tolerance: 3 * 28.35 is 85.05000000000001 in IEEE 754)
  ok(Math.abs(3 * METRIC_GRAMS_PER_OUNCE - 85.05) < 1e-9, "3 oz DOH-table medical usable figure = 85.05 g");
  ok(1 * STATUTORY_GRAMS_PER_OUNCE === 28, "1 oz recreational usable cap = 28 g");
  ok(Math.round(85.05 / METRIC_GRAMS_PER_OUNCE) === 3, "display round-trips 85.05 g -> 3 oz");
  ok(Math.round(84 / STATUTORY_GRAMS_PER_OUNCE) === 3, "enforcement round-trips 84 g -> 3 oz");

  if (fail > 0) {
    throw new Error(`grams-per-ounce self-tests: ${fail} FAILED (${pass} passed)`);
  }
  console.log(`grams-per-ounce: ${pass} self-tests passed`);
}
