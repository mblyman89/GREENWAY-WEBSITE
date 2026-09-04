/**
 * src/lib/inventory/classification-status-core.ts   (SLICE 18A)
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT THIS ANSWERS
 *
 * For ONE product: has a human settled its compliance classification, does it
 * still need attention, and — if it does — exactly why?
 *
 * SLICE 18-0 built the receiving door: a product arriving on a manifest is now
 * asked the "otherwise taken into the body?" question at Product Onboarding
 * before it can be approved. That fixes everything arriving from now on.
 *
 * It does nothing for products ALREADY in the system. Those came from the
 * one-time Cultivera import, and their classification is set (or not set) on
 * the menu-import facts screen. 18A is the worklist that finds the ones nobody
 * has answered, plus the per-product editor that fixes them.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE ONE FACT THAT SHAPES THIS ENTIRE FILE
 *
 * `menu_items` is the ONLY surface the register enforces from.
 * src/lib/pos/live-menu.ts:94-100 reads low_thc_liquid / unit_thc_mg /
 * otherwise_taken / units_per_package off the MENU row and hands them to the
 * cart engine. Nothing ever reads those columns back off `inventory_lots` to
 * decide a limit.
 *
 * Two consequences, and both are load-bearing:
 *
 *   1. A worklist built on `inventory_lots.otherwise_taken IS NULL` would be
 *      WRONG. The Cultivera import (import-service.ts:588-616) writes none of
 *      the four flags to inventory_lots, and fact review (fact-review-store.ts
 *      :122-135) writes them only to menu_items. So every imported lot has a
 *      NULL lot flag whether or not a human already classified it. That
 *      worklist would nag about settled work — the exact failure 18-0 fixed at
 *      the receiving dock, reintroduced across the whole catalog.
 *
 *   2. An EDIT that only writes inventory_lots would look successful and
 *      change nothing at the register. Silent no-ops are worse than errors.
 *
 * So: STATUS IS COMPUTED FROM MENU TRUTH. The lot row is provenance, not the
 * answer.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * SCOPE — deliberately narrow, for the same reason 18-0's gate is
 *
 * Only products where the answer can change a legal outcome are ever listed:
 * the liquid-edible shelf (categoryToBucket → "liquid_edible") plus anything
 * whose name/type looks like a suppository. A worklist that lists all 3,800
 * lots is not a worklist, it is a wall, and staff learn to close it.
 *
 * PURE: no I/O, no Supabase, no clock. Imports only the pure compliance core
 * and the pure 18-0 gate, so the two doors cannot drift apart.
 * ───────────────────────────────────────────────────────────────────────────
 */
import {
  categoryToBucket,
  suspectsOtherwiseTaken,
  LOW_THC_UNIT_MAX_MG,
} from "@/lib/compliance/sales-limits-core";

/**
 * The menu-side truth for one product, as the register would read it.
 *
 * Every field is nullable because a pre-0216/0217 database, or a product no
 * human has ever reviewed, genuinely has nothing recorded. Null means UNKNOWN,
 * never "no" — the doctrine SLICE 2 set for received dates and 18-0 re-applied
 * to classification provenance.
 */
export type ProductClassificationFacts = {
  /** menu_items.source_item_id === inventory_lots.pos_product_key. */
  posProductKey: string | null;
  productName: string | null;
  /** Raw LCB/CCRS inventory type, used only by the suppository detector. */
  inventoryType: string | null;
  /**
   * The website category the product ACTUALLY sits in — the override if the
   * owner set one, else the auto-resolution. This is what decides the shelf,
   * so it must be the effective value, not the raw import string.
   */
  resolvedWebsiteCategory: string | null;
  otherwiseTaken: boolean | null;
  unitsPerPackage: number | null;
  lowThcLiquid: boolean | null;
  unitThcMg: number | null;
};

/** Why a product is on the worklist. Ordered most- to least-urgent. */
export type ClassificationGapReason =
  /**
   * A suspected suppository nobody has answered. URGENT because the fail-safe
   * runs the WRONG WAY: an unanswered otherwise-taken product is treated as
   * ordinary and sells under the 100-unit limit instead of the 10-unit one
   * (WAC 314-55-095(1)(d)(i)(D)). Every hour it sits here is exposure.
   */
  | "otherwise_taken_unanswered"
  /**
   * A liquid-shelf product with no low-THC answer. NOT urgent: the fail-safe
   * runs the safe way — unanswered means the stricter 72 oz bucket applies
   * (WAC 314-55-095(1)(d)(i)(E)). The only cost is that genuine low-THC
   * beverages are under-sold relative to what the law allows.
   */
  | "low_thc_unanswered"
  /**
   * Answered "yes, otherwise taken" but no unit count. The 10-unit limit is
   * counted in UNITS, so without a count the engine cannot do the arithmetic.
   * An answered-yes with no count is worse than unanswered, because it looks
   * settled on every screen.
   */
  | "units_per_package_missing"
  /**
   * Claims low-THC but the stated mg exceeds the 4 mg-per-unit ceiling that
   * QUALIFIES a product for the 200 mg bucket (LOW_THC_UNIT_MAX_MG). The claim
   * and the number contradict each other, so one of them is wrong.
   */
  | "low_thc_contradiction"
  /**
   * Flagged BOTH otherwise-taken and low-THC. They are mutually exclusive
   * buckets; the engine would have to pick one, and picking is guessing.
   */
  | "mutually_exclusive";

export type ClassificationStatus = {
  /** True when this product is on the liquid-edible shelf. */
  isLiquidShelf: boolean;
  /** True when the name/type looks like a suppository. */
  suspected: boolean;
  /**
   * True when this product is IN SCOPE for classification at all. Out-of-scope
   * products (flower, cartridges, solid edibles) are never listed, never
   * badged, and never counted.
   */
  inScope: boolean;
  /** Every reason this product needs attention. Empty = settled. */
  reasons: ClassificationGapReason[];
  /**
   * True when a human's answer is recorded for everything this product needed.
   * Deliberately NOT the inverse of `reasons.length` for out-of-scope
   * products: something nobody ever needed to answer is not "settled", it is
   * "not applicable", and conflating the two would let the worklist claim
   * credit for work that never existed.
   */
  settled: boolean;
  /**
   * True when the product needs attention AND the failure mode is permissive
   * (i.e. leaving it sells MORE than the law allows). Drives the red/amber
   * split in the UI.
   */
  urgent: boolean;
};

/** Reasons whose fail-safe direction is PERMISSIVE — these are the red ones. */
const URGENT_REASONS: ReadonlySet<ClassificationGapReason> = new Set([
  "otherwise_taken_unanswered",
  "units_per_package_missing",
  "mutually_exclusive",
]);

/**
 * Classify one product's compliance-classification state.
 *
 * Mirrors assessReceivingClassification() from the 18-0 gate on purpose: the
 * scope test (`liquid shelf OR suspected`) must be identical at both doors, or
 * the worklist would list products the receiving gate never asks about — and
 * vice versa. tests/compliance/classification-status-parity.test.ts pins that.
 */
export function assessClassificationStatus(
  facts: ProductClassificationFacts,
): ClassificationStatus {
  const isLiquidShelf =
    categoryToBucket(facts.resolvedWebsiteCategory) === "liquid_edible";
  const suspected = suspectsOtherwiseTaken({
    name: facts.productName,
    inventoryType: facts.inventoryType,
  });
  const inScope = isLiquidShelf || suspected;

  const reasons: ClassificationGapReason[] = [];

  if (inScope) {
    // ── the permissive-failure question: must be answered ──────────────────
    if (facts.otherwiseTaken == null) {
      reasons.push("otherwise_taken_unanswered");
    } else if (facts.otherwiseTaken === true && facts.unitsPerPackage == null) {
      // "Yes" without a count cannot be enforced. Note this is checked ONLY
      // when the answer is yes: a "no" product has no unit-count obligation,
      // and demanding one would put settled products on the worklist forever.
      reasons.push("units_per_package_missing");
    }

    // ── the conservative-failure question: only prompted on the shelf ──────
    // Suspected-but-not-liquid products are NOT asked the low-THC question,
    // exactly as the 18-0 gate doesn't prompt for it. A suppository is not a
    // beverage, and asking would be noise.
    if (isLiquidShelf && facts.lowThcLiquid == null) {
      reasons.push("low_thc_unanswered");
    }

    // ── contradictions: answered, but the answers disagree ─────────────────
    if (
      facts.lowThcLiquid === true &&
      facts.unitThcMg != null &&
      Number.isFinite(facts.unitThcMg) &&
      facts.unitThcMg > LOW_THC_UNIT_MAX_MG
    ) {
      reasons.push("low_thc_contradiction");
    }
    if (facts.otherwiseTaken === true && facts.lowThcLiquid === true) {
      reasons.push("mutually_exclusive");
    }
  }

  return {
    isLiquidShelf,
    suspected,
    inScope,
    reasons,
    settled: inScope && reasons.length === 0,
    urgent: reasons.some((r) => URGENT_REASONS.has(r)),
  };
}

/**
 * Plain-English explanation of one reason, written for a budtender rather than
 * a compliance officer. Each sentence says what is wrong AND what it costs, so
 * the reader can tell a genuine hazard from a tidying task.
 */
export function describeClassificationGap(reason: ClassificationGapReason): string {
  switch (reason) {
    case "otherwise_taken_unanswered":
      return "Nobody has said whether this is taken otherwise into the body (a suppository). Until somebody does, the register sells it under the 100-unit limit instead of the 10-unit one.";
    case "low_thc_unanswered":
      return "Nobody has said whether this is a low-THC beverage. Until somebody does, it counts against the stricter 72 oz limit — safe, but it may be selling short of what the law allows.";
    case "units_per_package_missing":
      return "This is marked as taken otherwise into the body, but nobody has recorded how many units are in a package. The 10-unit limit is counted in units, so the register can't apply it.";
    case "low_thc_contradiction":
      return `This is marked as a low-THC beverage, but the stated per-unit THC is above ${LOW_THC_UNIT_MAX_MG} mg — the ceiling that qualifies a product for the 200 mg bucket. One of the two is wrong.`;
    case "mutually_exclusive":
      return "This is marked as BOTH a low-THC beverage and taken otherwise into the body. Those are separate limits and a product can only be in one, so the register can't tell which applies.";
  }
}

/** Short badge text for a table cell. Null when there is nothing to show. */
export function classificationBadgeLabel(status: ClassificationStatus): string | null {
  if (!status.inScope) return null;
  if (status.settled) return "Classified";
  if (status.urgent) return "Needs classifying";
  return "Unconfirmed";
}

/**
 * Sort key for the worklist: urgent first, then unsettled, then settled.
 * Lower sorts earlier. Returned as a number so callers can sort a mixed list
 * without re-deriving the priority rules.
 */
export function classificationSortWeight(status: ClassificationStatus): number {
  if (!status.inScope) return 3;
  if (status.urgent) return 0;
  if (!status.settled) return 1;
  return 2;
}

/**
 * Roll a set of products up into the counts the "What's missing" panel prints.
 *
 * `urgent` and `unconfirmed` are DISJOINT (a product is counted once, by its
 * worst reason) so the two numbers can be added without double-counting — a
 * panel whose parts don't sum to its whole is a panel people stop believing.
 */
export function summarizeClassificationStatuses(
  statuses: readonly ClassificationStatus[],
): {
  inScope: number;
  urgent: number;
  unconfirmed: number;
  settled: number;
  needsAttention: number;
} {
  let inScope = 0;
  let urgent = 0;
  let unconfirmed = 0;
  let settled = 0;
  for (const s of statuses) {
    if (!s.inScope) continue;
    inScope += 1;
    if (s.urgent) urgent += 1;
    else if (!s.settled) unconfirmed += 1;
    else settled += 1;
  }
  return { inScope, urgent, unconfirmed, settled, needsAttention: urgent + unconfirmed };
}

/* ───────────────────────────────────────────────────────────────────────── */
/* Self-tests (wired into scripts/compliance/run-pure-selftests.ts)          */
/* ───────────────────────────────────────────────────────────────────────── */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`classification-status-core: ${msg}`);
}

function facts(over: Partial<ProductClassificationFacts> = {}): ProductClassificationFacts {
  return {
    posProductKey: "pos-1",
    productName: "Blue Dream 3.5g",
    inventoryType: "Usable Marijuana",
    resolvedWebsiteCategory: "flower",
    otherwiseTaken: null,
    unitsPerPackage: null,
    lowThcLiquid: null,
    unitThcMg: null,
    ...over,
  };
}

export function __runClassificationStatusTests(): { passed: number } {
  let passed = 0;
  const check = (cond: boolean, msg: string) => {
    assert(cond, msg);
    passed += 1;
  };

  // ── scope ────────────────────────────────────────────────────────────────
  const flower = assessClassificationStatus(facts());
  check(!flower.inScope, "flower pulled into scope");
  check(flower.reasons.length === 0, "flower produced a reason");
  check(!flower.settled, "out-of-scope flower claimed as settled");
  check(!flower.urgent, "flower marked urgent");
  check(classificationBadgeLabel(flower) === null, "flower got a badge");

  // Every non-liquid bucket stays out of scope.
  for (const c of ["flower", "preroll", "cartridge", "concentrate", "edible-solid"]) {
    check(
      !assessClassificationStatus(facts({ resolvedWebsiteCategory: c })).inScope,
      `${c} wrongly in scope`,
    );
  }
  // Every liquid-shelf category is in scope (mirrors categoryToBucket).
  for (const c of ["edible-liquid", "tincture", "topical"]) {
    const s = assessClassificationStatus(facts({ resolvedWebsiteCategory: c }));
    check(s.inScope && s.isLiquidShelf, `${c} not treated as the liquid shelf`);
  }

  // ── the suppository detector pulls a product in regardless of shelf ──────
  const supp = assessClassificationStatus(
    facts({ productName: "Relief Suppositories 6ct", resolvedWebsiteCategory: "edible-solid" }),
  );
  check(supp.inScope, "suppository not in scope");
  check(supp.suspected, "suppository not suspected");
  check(!supp.isLiquidShelf, "suppository mislabelled as liquid shelf");

  // ── urgency: the permissive failure is the red one ───────────────────────
  check(supp.reasons.includes("otherwise_taken_unanswered"), "unanswered suppository not flagged");
  check(supp.urgent, "unanswered suppository not urgent");
  check(classificationBadgeLabel(supp) === "Needs classifying", "wrong badge for urgent");

  // A suspected-but-not-liquid product is NOT asked the beverage question.
  check(
    !supp.reasons.includes("low_thc_unanswered"),
    "suppository was asked the low-THC question",
  );

  // ── the conservative failure is amber, not red ───────────────────────────
  const bev = assessClassificationStatus(facts({ resolvedWebsiteCategory: "edible-liquid" }));
  check(bev.reasons.includes("low_thc_unanswered"), "unanswered beverage not flagged");
  check(bev.reasons.includes("otherwise_taken_unanswered"), "liquid shelf skipped the OT question");
  // It IS urgent, but only because of the otherwise-taken question, not the
  // low-THC one. Prove the low-THC reason alone would not be urgent.
  const bevOtAnswered = assessClassificationStatus(
    facts({ resolvedWebsiteCategory: "edible-liquid", otherwiseTaken: false }),
  );
  check(
    bevOtAnswered.reasons.length === 1 && bevOtAnswered.reasons[0] === "low_thc_unanswered",
    "answered-no beverage left extra reasons",
  );
  check(!bevOtAnswered.urgent, "low-THC-only gap wrongly marked urgent");
  check(
    classificationBadgeLabel(bevOtAnswered) === "Unconfirmed",
    "wrong badge for a non-urgent gap",
  );

  // ── settled ──────────────────────────────────────────────────────────────
  const settled = assessClassificationStatus(
    facts({ resolvedWebsiteCategory: "edible-liquid", otherwiseTaken: false, lowThcLiquid: false }),
  );
  check(settled.settled, "fully answered beverage not settled");
  check(settled.reasons.length === 0, "settled product still has reasons");
  check(!settled.urgent, "settled product marked urgent");
  check(classificationBadgeLabel(settled) === "Classified", "wrong badge for settled");

  // An explicit FALSE must settle it. This is the whole point of nullable
  // booleans: false is an answer, null is not.
  const answeredNo = assessClassificationStatus(
    facts({ productName: "Relief Suppositories 6ct", otherwiseTaken: false }),
  );
  check(answeredNo.settled, "answered-no suppository not settled");
  check(!answeredNo.urgent, "answered-no suppository still urgent");

  // ── yes requires a unit count ────────────────────────────────────────────
  const yesNoCount = assessClassificationStatus(
    facts({ productName: "Relief Suppositories 6ct", otherwiseTaken: true }),
  );
  check(
    yesNoCount.reasons.includes("units_per_package_missing"),
    "answered-yes without a unit count not flagged",
  );
  check(yesNoCount.urgent, "missing unit count not urgent");
  check(!yesNoCount.settled, "missing unit count claimed settled");

  const yesWithCount = assessClassificationStatus(
    facts({ productName: "Relief Suppositories 6ct", otherwiseTaken: true, unitsPerPackage: 6 }),
  );
  check(yesWithCount.settled, "answered-yes with a count not settled");

  // A "no" product is never asked for a unit count.
  check(
    !answeredNo.reasons.includes("units_per_package_missing"),
    "answered-no wrongly asked for a unit count",
  );

  // ── contradictions ───────────────────────────────────────────────────────
  const overCeiling = assessClassificationStatus(
    facts({
      resolvedWebsiteCategory: "edible-liquid",
      otherwiseTaken: false,
      lowThcLiquid: true,
      unitThcMg: LOW_THC_UNIT_MAX_MG + 0.1,
    }),
  );
  check(
    overCeiling.reasons.includes("low_thc_contradiction"),
    "over-ceiling low-THC claim not flagged",
  );
  // Exactly AT the ceiling is legal, not a contradiction — the statute says
  // "no more than four milligrams", so 4.0 qualifies.
  const atCeiling = assessClassificationStatus(
    facts({
      resolvedWebsiteCategory: "edible-liquid",
      otherwiseTaken: false,
      lowThcLiquid: true,
      unitThcMg: LOW_THC_UNIT_MAX_MG,
    }),
  );
  check(
    !atCeiling.reasons.includes("low_thc_contradiction"),
    "a product exactly at the 4 mg ceiling was called a contradiction",
  );
  check(atCeiling.settled, "at-ceiling low-THC product not settled");

  const both = assessClassificationStatus(
    facts({
      resolvedWebsiteCategory: "edible-liquid",
      otherwiseTaken: true,
      unitsPerPackage: 4,
      lowThcLiquid: true,
    }),
  );
  check(both.reasons.includes("mutually_exclusive"), "both-flags product not flagged");
  check(both.urgent, "mutually-exclusive product not urgent");

  // ── every reason has a real explanation ──────────────────────────────────
  const allReasons: ClassificationGapReason[] = [
    "otherwise_taken_unanswered",
    "low_thc_unanswered",
    "units_per_package_missing",
    "low_thc_contradiction",
    "mutually_exclusive",
  ];
  for (const r of allReasons) {
    const text = describeClassificationGap(r);
    check(text.length > 40, `${r} has no real explanation`);
    check(!/undefined|null|\[object/.test(text), `${r} explanation leaked a raw value`);
  }
  // The two unanswered explanations must name their DIFFERENT consequences,
  // otherwise the reader can't tell the hazard from the tidying task.
  check(
    /100-unit|10-unit/.test(describeClassificationGap("otherwise_taken_unanswered")),
    "the urgent explanation does not name what it costs",
  );
  check(
    /72 oz/.test(describeClassificationGap("low_thc_unanswered")),
    "the low-THC explanation does not name the fallback bucket",
  );

  // ── sort weights order the list the way the UI needs ─────────────────────
  check(classificationSortWeight(supp) === 0, "urgent did not sort first");
  check(classificationSortWeight(bevOtAnswered) === 1, "unconfirmed did not sort second");
  check(classificationSortWeight(settled) === 2, "settled did not sort third");
  check(classificationSortWeight(flower) === 3, "out-of-scope did not sort last");

  // ── the rollup ───────────────────────────────────────────────────────────
  const roll = summarizeClassificationStatuses([supp, bevOtAnswered, settled, flower]);
  check(roll.inScope === 3, `expected 3 in scope, got ${roll.inScope}`);
  check(roll.urgent === 1, `expected 1 urgent, got ${roll.urgent}`);
  check(roll.unconfirmed === 1, `expected 1 unconfirmed, got ${roll.unconfirmed}`);
  check(roll.settled === 1, `expected 1 settled, got ${roll.settled}`);
  check(roll.needsAttention === 2, "needsAttention is not urgent + unconfirmed");
  // The parts must sum to the whole, or the panel is lying.
  check(
    roll.urgent + roll.unconfirmed + roll.settled === roll.inScope,
    "the rollup's parts do not sum to its total",
  );

  const empty = summarizeClassificationStatuses([]);
  check(empty.inScope === 0 && empty.needsAttention === 0, "empty rollup is not zero");

  return { passed };
}
