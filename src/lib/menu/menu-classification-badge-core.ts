/**
 * SLICE 18C — the on-card sales-limit CLASSIFICATION pills, and the shopper
 * allowance disclosure on the product detail page.
 *
 * Michael's roadmap, verbatim (docs/slice-18-integration-recon.md:343-346):
 *   "18C — Badges + PDP disclosure. New pure core mirroring
 *    menu-doh-badge-core.ts; render through ProductCardVisual; add an
 *    allowance explainer to the PDP."
 *
 * So this module is a deliberate MIRROR of menu-doh-badge-core.ts — same
 * shape, same tone-token structure, same "null means render nothing" rule —
 * because that is the house pattern for a compliance trait shown as a pill.
 * It is the badge half of the facet 18B built; the two live side by side on
 * purpose (menu-classification-FILTER-core / menu-classification-BADGE-core).
 *
 * WHY THIS NEEDS NO SERVER WORK (what keeps 18C additive):
 * the product detail page resolves its item through getLiveMenuItemById →
 * loadLiveMenuItems → menuRowToGreenwayItem, which already maps all four
 * classification fields (live-menu.ts:93,94,98,99). The PDP even passes them
 * into the cart today (ProductDetailPurchasePanel.tsx:155-159). There is
 * therefore NO new DB read, NO overlay and NO migration in this slice — the
 * pills and the explainer are pure derivation over data already on the item.
 *
 * THE CENTRAL RULE — WE DO NOT RE-TEST THE FLAGS:
 * menu-doh-badge-core delegates to isItemDohCompliant so that "the pill, the
 * sidebar filter, and the register can never disagree". We do the same by
 * delegating to SLICE 18B's itemHasClassification, which itself delegates to
 * the register's qualifiesAsLowThcLiquid / qualifiesAsOtherwiseTaken.
 *
 * That indirection is the whole point. Qualifying is a THREE-condition test,
 * not a boolean (sales-limits-core.ts:613,638): the category must bucket as a
 * liquid, the flag must be literally true, and low-THC needs a positive
 * per-unit figure at or below 4 mg. A pill keyed on `item.lowThcLiquid ===
 * true` would print "LOW-THC" on a 10 mg drink that the till still counts
 * against the 72 oz liquid bucket — the website would be advertising an
 * allowance the register refuses to honour.
 *
 * HONESTY — SILENCE FOR UNREVIEWED PRODUCTS:
 * a null `otherwiseTaken` is the PERMISSIVE direction (leafly/types.ts:89-94),
 * so we can never say "this is NOT a suppository" about a product nobody has
 * reviewed. No pill and no disclosure is the only defensible output. We
 * advertise what was affirmatively verified, and stay quiet otherwise.
 *
 * PURE: no "server-only" directive, no DB, no React. Registered in the pure
 * self-test runner, so the card, the PDP and CI share one definition.
 */
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import {
  CLASSIFICATION_FILTER_HELP,
  CLASSIFICATION_FILTER_KINDS,
  CLASSIFICATION_FILTER_LABELS,
  itemHasClassification,
  type ClassificationFilterKind,
} from "@/lib/menu/menu-classification-filter-core";
import {
  LIMIT_BUCKET_LABELS,
  LOW_THC_UNIT_MAX_MG,
  RECREATIONAL_LIMITS,
  formatLimitAmount,
} from "@/lib/compliance/sales-limits-core";

/**
 * The SHORT word on the pill.
 *
 * The pill lane on a product card is a narrow, centred column rendered at
 * text-[0.62rem] with uppercase tracking (ProductCardVisual.tsx:376), so the
 * full shopper labels ("Low-THC Beverages" / "Suppositories") would wrap and
 * break the lane's rhythm. These short forms are singular because a pill
 * describes ONE product, whereas the sidebar label describes a group.
 *
 * The FULL label still travels with the spec (see `title` below) so hover text
 * and assistive technology get the complete wording. Kept as constants so the
 * copy is a one-line change.
 */
export const CLASSIFICATION_PILL_LABELS: Record<ClassificationFilterKind, string> = {
  low_thc_liquid: "Low-THC",
  otherwise_taken: "Suppository",
};

/**
 * A pill colour tone expressed as Tailwind class fragments — identical
 * structure to DohPillTone so both pills dress the same markup. `border` +
 * `text` clothe the pill body and `dot` colours the leading dot.
 */
export type ClassificationPillTone = {
  readonly id: string;
  readonly border: string;
  readonly text: string;
  readonly dot: string;
};

/**
 * AMBER — the low-THC beverage tone.
 *
 * Colour choice is constrained, not arbitrary. On a product card, BLUE is
 * already the DOH pill (menu-doh-badge-core.ts:DOH_PILL_TONE_BLUE) and GREEN
 * is already both the deal badge and the profile pill's dot
 * (ProductCardVisual.tsx:390). Reusing either would make a compliance
 * classification look like a sale or like a DOH product. Amber and violet are
 * unclaimed in this lane.
 */
export const CLASSIFICATION_PILL_TONE_AMBER: ClassificationPillTone = {
  id: "amber",
  border: "border-[#e0a34a]/70",
  text: "text-[#ffe2b0]",
  dot: "bg-[#e0a34a]",
};

/** VIOLET — the otherwise-taken (suppository) tone. */
export const CLASSIFICATION_PILL_TONE_VIOLET: ClassificationPillTone = {
  id: "violet",
  border: "border-[#b07de0]/70",
  text: "text-[#ecd8ff]",
  dot: "bg-[#b07de0]",
};

/** TEAL — an unclaimed alternate, so a recolour stays a one-line change. */
export const CLASSIFICATION_PILL_TONE_TEAL: ClassificationPillTone = {
  id: "teal",
  border: "border-[#4fb3a5]/70",
  text: "text-[#c9f4ec]",
  dot: "bg-[#4fb3a5]",
};

/** SLATE — a deliberately quiet alternate. */
export const CLASSIFICATION_PILL_TONE_SLATE: ClassificationPillTone = {
  id: "slate",
  border: "border-[#8d9aa8]/70",
  text: "text-[#dbe4ec]",
  dot: "bg-[#8d9aa8]",
};

/**
 * THE ACTIVE TONES. Change these two assignments to recolour the pills —
 * every surface follows, because every card renders through ProductCardVisual
 * and the PDP reads the same specs.
 */
export const CLASSIFICATION_PILL_TONES: Record<ClassificationFilterKind, ClassificationPillTone> = {
  low_thc_liquid: CLASSIFICATION_PILL_TONE_AMBER,
  otherwise_taken: CLASSIFICATION_PILL_TONE_VIOLET,
};

/** Every named tone, so a test can prove alternates exist for a recolour. */
export const CLASSIFICATION_PILL_TONE_CHOICES: readonly ClassificationPillTone[] = [
  CLASSIFICATION_PILL_TONE_AMBER,
  CLASSIFICATION_PILL_TONE_VIOLET,
  CLASSIFICATION_PILL_TONE_TEAL,
  CLASSIFICATION_PILL_TONE_SLATE,
];

/** What a renderer needs: the lane, the short word, the full wording, a tone. */
export type ClassificationPillSpec = {
  readonly kind: ClassificationFilterKind;
  readonly label: string;
  /** The full shopper label — hover text / assistive description. */
  readonly title: string;
  readonly tone: ClassificationPillTone;
};

/** The item fields the badge needs. Same shape itemHasClassification takes. */
export type ClassifiableMenuItem = Pick<
  GreenwayMenuItem,
  "category" | "lowThcLiquid" | "unitThcMg" | "otherwiseTaken" | "unitsPerPackage"
>;

/**
 * Every pill an item has earned, in the stable CLASSIFICATION_FILTER_KINDS
 * order. An ordinary or unreviewed product yields an EMPTY array → the card
 * renders nothing, exactly as it does today. That is the same graceful
 * pre-migration behaviour menu-doh-badge-core promises.
 *
 * Returns an array rather than a single spec because the two lanes are
 * unrelated statutory buckets, not subdivisions of one state — a product could
 * in principle carry both flags, and the card should not silently hide one.
 * (The register resolves such a product to the tighter bucket; see
 * classificationKindForItem in the filter core.)
 */
export function classificationPillsForItem(
  item: ClassifiableMenuItem,
): ClassificationPillSpec[] {
  const specs: ClassificationPillSpec[] = [];
  for (const kind of CLASSIFICATION_FILTER_KINDS) {
    // Delegated, never re-tested. See "THE CENTRAL RULE" above.
    if (!itemHasClassification(item, kind)) continue;
    specs.push({
      kind,
      label: CLASSIFICATION_PILL_LABELS[kind],
      title: CLASSIFICATION_FILTER_LABELS[kind],
      tone: CLASSIFICATION_PILL_TONES[kind],
    });
  }
  return specs;
}

/** Convenience predicate (mirrors classificationPillsForItem().length > 0). */
export function shouldShowClassificationPill(item: ClassifiableMenuItem): boolean {
  return classificationPillsForItem(item).length > 0;
}

/**
 * One shopper-facing allowance disclosure.
 *
 * `headline` names the allowance in the shopper's vocabulary; `body` explains
 * what it means for their visit WITHOUT promising a quantity, and `limit` is
 * the statutory ceiling rendered in the bucket's own unit.
 */
export type ClassificationDisclosure = {
  readonly kind: ClassificationFilterKind;
  readonly headline: string;
  readonly body: string;
  /** e.g. "200 mg THC" or "10 units" — the bucket's OWN unit, never grams. */
  readonly limit: string;
  /** The statute, so the claim is checkable. */
  readonly citation: string;
};

/** The rule every disclosure cites. Matches the cart meter's header wording. */
export const CLASSIFICATION_DISCLOSURE_CITATION = "WAC 314-55-095";

/**
 * The per-lane explainer bodies.
 *
 * Written to three hard constraints, each verified in recon (docs/slice-18c-recon.md F5/F6):
 *
 * 1. NO MEDICAL MULTIPLE. These are the only two buckets that do NOT triple
 *    for a DOH-database patient — 200 mg stays 200 mg and 10 units stays 10
 *    units (sales-limits-core.ts:239-256 and :263-269 explain why, in capitals).
 *    Every other bucket triples, so the pattern-matching instinct is wrong
 *    here and the copy must not hint at it.
 * 2. NO QUANTITY PROMISE. The real maximum depends on the whole basket, so
 *    only the cart meter can do that arithmetic honestly. We say the allowance
 *    is SEPARATE and let the meter count.
 * 3. DEFER TO THE STORE, matching CartLimitMeter.tsx:114-116 ("final limits
 *    are confirmed in store").
 */
export const CLASSIFICATION_DISCLOSURE_BODIES: Record<ClassificationFilterKind, string> = {
  low_thc_liquid:
    `Because every unit holds ${LOW_THC_UNIT_MAX_MG} mg of THC or less, this drink counts against a separate ` +
    "milligram allowance instead of the 72-ounce limit for liquid products, so it does not use up " +
    "your liquid allowance. Your cart keeps a running total, and the final amount is confirmed in store.",
  otherwise_taken:
    "This product is taken into the body by another route, so it is counted by the item rather than by " +
    "weight and has its own separate allowance. Your cart keeps a running count, and the final amount " +
    "is confirmed in store.",
};

/**
 * The disclosures for an item — empty for a product in no lane (D7: silence,
 * never a negative claim about an unreviewed product).
 *
 * Figures are READ from the statutory constants through the bucket-aware
 * formatter, never hard-coded, so the copy tracks the law automatically. That
 * formatter matters: `otherwise_taken` is a COUNT and `low_thc_liquid` is
 * MILLIGRAMS, and a naive weight formatter would render 10 units as "0.357 oz"
 * (sales-limits-core.ts:167-170 warns about exactly this).
 */
export function classificationDisclosuresForItem(
  item: ClassifiableMenuItem,
): ClassificationDisclosure[] {
  return classificationPillsForItem(item).map((spec) => ({
    kind: spec.kind,
    headline: CLASSIFICATION_FILTER_LABELS[spec.kind],
    body: CLASSIFICATION_DISCLOSURE_BODIES[spec.kind],
    limit: formatLimitAmount(spec.kind, RECREATIONAL_LIMITS[spec.kind]),
    citation: CLASSIFICATION_DISCLOSURE_CITATION,
  }));
}

/**
 * The owner/admin bucket wording for a lane, for surfaces that speak the back
 * office's vocabulary (the admin worklist, for instance). Distinct from the
 * shopper label on purpose: staff need the statutory phrasing, shoppers need
 * plain language.
 */
export function classificationBucketOwnerLabel(kind: ClassificationFilterKind): string {
  return LIMIT_BUCKET_LABELS[kind];
}

/** The shopper help sentence for a lane (shared with 18B's sidebar). */
export function classificationPillHelp(kind: ClassificationFilterKind): string {
  return CLASSIFICATION_FILTER_HELP[kind];
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure self-tests (throw on failure). Registered in the pure-selftest runner.
// ─────────────────────────────────────────────────────────────────────────────

function testItem(over: Partial<GreenwayMenuItem> & { id: string }): GreenwayMenuItem {
  return {
    name: "Test Item",
    brand: "Test Brand",
    category: "flower",
    priceMinorUnits: 3000,
    ...over,
  } as GreenwayMenuItem;
}

/** A fully-qualifying low-THC drink: liquid bucket, flag true, 4 mg per unit. */
function goodDrink(id: string): GreenwayMenuItem {
  return testItem({ id, category: "edible-liquid", lowThcLiquid: true, unitThcMg: 4 });
}

/** A fully-qualifying suppository: liquid-bucketing category + flag true. */
function goodSupp(id: string): GreenwayMenuItem {
  return testItem({ id, category: "topical", otherwiseTaken: true, unitsPerPackage: 10 });
}

export function __runMenuClassificationBadgeTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`menu-classification-badge-core: ${msg}`);
    passed += 1;
  };

  // ── 1) Nothing to say → no pills. The graceful default. ───────────────────
  ok(classificationPillsForItem(testItem({ id: "a" })).length === 0, "no flags → no pills");
  ok(
    classificationPillsForItem(testItem({ id: "a2", category: "edible-liquid" })).length === 0,
    "liquid category alone → no pills",
  );
  ok(
    shouldShowClassificationPill(testItem({ id: "a3" })) === false,
    "predicate false with no flags",
  );
  ok(
    classificationDisclosuresForItem(testItem({ id: "a4" })).length === 0,
    "no flags → no disclosure (silence, never a negative claim)",
  );

  // ── 2) A qualifying drink earns exactly the low-THC pill. ─────────────────
  {
    const pills = classificationPillsForItem(goodDrink("d1"));
    ok(pills.length === 1, "qualifying drink earns exactly one pill");
    ok(pills[0].kind === "low_thc_liquid", "the drink's pill is the low-THC lane");
    ok(pills[0].label === "Low-THC", "short label on the pill");
    ok(pills[0].label === CLASSIFICATION_PILL_LABELS.low_thc_liquid, "label comes from the map");
    ok(pills[0].title === CLASSIFICATION_FILTER_LABELS.low_thc_liquid, "title is the FULL 18B label");
    ok(pills[0].tone.id === "amber", "the low-THC tone is amber");
    ok(shouldShowClassificationPill(goodDrink("d2")) === true, "predicate true for a drink");
  }

  // ── 3) A qualifying suppository earns exactly the other pill. ─────────────
  {
    const pills = classificationPillsForItem(goodSupp("s1"));
    ok(pills.length === 1, "qualifying suppository earns exactly one pill");
    ok(pills[0].kind === "otherwise_taken", "the suppository's pill is the otherwise-taken lane");
    ok(pills[0].label === "Suppository", "short label reads Suppository");
    ok(pills[0].title === CLASSIFICATION_FILTER_LABELS.otherwise_taken, "title is the FULL 18B label");
    ok(pills[0].tone.id === "violet", "the otherwise-taken tone is violet");
  }

  // ── 4) THE CENTRAL RULE — the pill follows the REGISTER, not the boolean.
  //      Each case below is a product whose raw flag is `true` but which does
  //      NOT qualify. A naive badge would mislabel every one of them.
  ok(
    classificationPillsForItem(
      testItem({ id: "x1", category: "edible-liquid", lowThcLiquid: true, unitThcMg: 9 }),
    ).length === 0,
    "over 4 mg → no pill (the register would use the 72 oz bucket)",
  );
  ok(
    classificationPillsForItem(
      testItem({ id: "x2", category: "edible-liquid", lowThcLiquid: true }),
    ).length === 0,
    "flag set but no mg figure → no pill",
  );
  ok(
    classificationPillsForItem(
      testItem({ id: "x3", category: "edible-liquid", lowThcLiquid: true, unitThcMg: 0 }),
    ).length === 0,
    "zero mg → no pill",
  );
  ok(
    classificationPillsForItem(
      testItem({ id: "x4", category: "flower", lowThcLiquid: true, unitThcMg: 4 }),
    ).length === 0,
    "wrong bucket → no pill",
  );
  ok(
    classificationPillsForItem(testItem({ id: "x5", category: "flower", otherwiseTaken: true }))
      .length === 0,
    "flower flagged otherwise-taken → no pill",
  );
  ok(
    classificationPillsForItem(
      testItem({ id: "x6", category: "topical", otherwiseTaken: "true" as unknown as boolean }),
    ).length === 0,
    "string 'true' does not earn a pill",
  );
  ok(
    classificationPillsForItem(
      testItem({ id: "x7", category: "edible-liquid", otherwiseTaken: null, lowThcLiquid: null }),
    ).length === 0,
    "explicit nulls → no pill (permissive null must not become a claim)",
  );

  // ── 5) The badge and the FILTER agree for every fixture. If these two ever
  //      diverge, a shopper filters to a lane and finds unbadged cards (or
  //      worse, badged cards the filter hides).
  {
    const fixtures: GreenwayMenuItem[] = [
      testItem({ id: "m1" }),
      goodDrink("m2"),
      goodSupp("m3"),
      testItem({ id: "m4", category: "edible-liquid", lowThcLiquid: true, unitThcMg: 9 }),
      testItem({ id: "m5", category: "flower", otherwiseTaken: true }),
      testItem({ id: "m6", category: "tincture", lowThcLiquid: true, unitThcMg: 1 }),
      testItem({ id: "m7", category: "topical", otherwiseTaken: true, unitsPerPackage: 1 }),
    ];
    let agreements = 0;
    for (const item of fixtures) {
      const pills = classificationPillsForItem(item);
      for (const kind of CLASSIFICATION_FILTER_KINDS) {
        const badged = pills.some((p) => p.kind === kind);
        ok(
          badged === itemHasClassification(item, kind),
          `badge/filter agreement for ${item.id} on ${kind}`,
        );
        agreements += 1;
      }
    }
    // Anti-vacuity: an empty fixture list would make the loop above trivially
    // true, so pin the comparison count.
    ok(agreements === fixtures.length * CLASSIFICATION_FILTER_KINDS.length, "every pair compared");
  }

  // ── 6) A dual-flagged product shows BOTH pills, in stable lane order. ─────
  {
    const both = testItem({
      id: "b1",
      category: "topical",
      otherwiseTaken: true,
      unitsPerPackage: 10,
      lowThcLiquid: true,
      unitThcMg: 4,
    });
    const pills = classificationPillsForItem(both);
    ok(pills.length === 2, "a dual-flagged product shows both pills");
    ok(
      pills[0].kind === CLASSIFICATION_FILTER_KINDS[0] &&
        pills[1].kind === CLASSIFICATION_FILTER_KINDS[1],
      "pill order follows the stable lane order",
    );
  }

  // ── 7) Disclosures: figures come from the statute, in the RIGHT unit. ─────
  {
    const d = classificationDisclosuresForItem(goodDrink("y1"));
    ok(d.length === 1, "a qualifying drink gets one disclosure");
    ok(d[0].kind === "low_thc_liquid", "disclosure lane matches");
    ok(d[0].headline === CLASSIFICATION_FILTER_LABELS.low_thc_liquid, "headline is the shopper label");
    ok(d[0].limit === "200 mg THC", "the low-THC ceiling renders as 200 mg THC");
    ok(
      d[0].limit === formatLimitAmount("low_thc_liquid", RECREATIONAL_LIMITS.low_thc_liquid),
      "the figure is READ from the statutory constant, not hard-coded",
    );
    ok(d[0].citation === "WAC 314-55-095", "the disclosure cites the rule");
    ok(d[0].body.length > 40, "the body actually explains something");
  }
  {
    const d = classificationDisclosuresForItem(goodSupp("y2"));
    ok(d.length === 1, "a qualifying suppository gets one disclosure");
    // THE UNIT TRAP: this bucket counts ITEMS. A weight formatter would print
    // "0.357 oz" here, which is meaningless and dangerously wrong.
    ok(d[0].limit === "10 units", "the otherwise-taken ceiling renders as 10 units");
    ok(!d[0].limit.includes("oz"), "a COUNT bucket never renders as ounces");
    ok(!d[0].limit.includes("mg"), "a COUNT bucket never renders as milligrams");
  }

  // ── 8) HONESTY PINS on the copy itself. ──────────────────────────────────
  for (const kind of CLASSIFICATION_FILTER_KINDS) {
    const body = CLASSIFICATION_DISCLOSURE_BODIES[kind];
    // No medical multiple: these are the ONLY two buckets that do not triple.
    ok(!/triple|three times|3\s*x/i.test(body), `${kind}: no medical-multiple claim`);
    ok(!/\bmedical\b|\bpatient\b|\bDOH\b/i.test(body), `${kind}: copy makes no medical claim`);
    // No quantity promise — only the cart can do that arithmetic honestly.
    ok(!/you can buy \d|up to \d+ of/i.test(body), `${kind}: no quantity promise`);
    // Defers to the store, matching the cart meter's established wording.
    ok(/confirmed in store/i.test(body), `${kind}: defers to the store`);
    // Says the allowance is separate, which is the actual shopper benefit.
    ok(/separate/i.test(body), `${kind}: explains the allowance is separate`);
  }
  // The low-THC body must state the per-unit ceiling, read from the constant.
  ok(
    CLASSIFICATION_DISCLOSURE_BODIES.low_thc_liquid.includes(`${LOW_THC_UNIT_MAX_MG} mg`),
    "low-THC copy states the per-unit ceiling from LOW_THC_UNIT_MAX_MG",
  );
  // 200 mg / 10 units are IDENTICAL for medical, so no disclosure may imply
  // otherwise. Pin the underlying facts so a future edit to the limit tables
  // cannot silently make this copy wrong.
  ok(RECREATIONAL_LIMITS.low_thc_liquid === 200, "low-THC ceiling is 200 mg");
  ok(RECREATIONAL_LIMITS.otherwise_taken === 10, "otherwise-taken ceiling is 10 units");

  // ── 9) Tones: distinct, complete, and recolourable in one line. ──────────
  ok(
    CLASSIFICATION_PILL_TONES.low_thc_liquid.id !== CLASSIFICATION_PILL_TONES.otherwise_taken.id,
    "the two lanes are visually distinguishable",
  );
  for (const kind of CLASSIFICATION_FILTER_KINDS) {
    const tone = CLASSIFICATION_PILL_TONES[kind];
    ok(tone.border.length > 0 && tone.text.length > 0 && tone.dot.length > 0,
      `${kind}: tone has border/text/dot fragments`);
    // Must not collide with DOH's blue or the deal/profile green, or a
    // compliance classification will read as a sale or as a DOH product.
    ok(!/greenway/i.test(tone.border + tone.text + tone.dot), `${kind}: does not reuse the deal green`);
  }
  ok(CLASSIFICATION_PILL_TONE_CHOICES.length >= 4, "named alternates exist for a recolour");
  {
    const ids = new Set(CLASSIFICATION_PILL_TONE_CHOICES.map((t) => t.id));
    ok(ids.size === CLASSIFICATION_PILL_TONE_CHOICES.length, "every named tone has a unique id");
    ok(ids.has("amber") && ids.has("violet") && ids.has("teal") && ids.has("slate"),
      "the four named tones are present");
  }

  // ── 10) Vocabulary parity: the pill, the sidebar and the back office. ────
  ok(
    classificationPillHelp("low_thc_liquid") === CLASSIFICATION_FILTER_HELP.low_thc_liquid,
    "pill help is the SAME sentence the sidebar shows",
  );
  ok(
    classificationBucketOwnerLabel("otherwise_taken") === LIMIT_BUCKET_LABELS.otherwise_taken,
    "owner label is the statutory bucket wording",
  );
  ok(
    classificationBucketOwnerLabel("low_thc_liquid") !== CLASSIFICATION_FILTER_LABELS.low_thc_liquid,
    "staff wording and shopper wording are deliberately different",
  );

  return { passed };
}
