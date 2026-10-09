/**
 * src/lib/inventory/expiry-research-core.ts  (R34)
 *
 * THE RESEARCH BEHIND EVERY SUGGESTED EXPIRATION RULE.
 *
 * Owner: "Please deep research every one of our types and categories so you
 * have reasonable data that will assist me in setting an appropriate date ...
 * backed up by industry leading data from reputable authoritative sources."
 *
 * WHAT THIS MODULE IS
 *   A cited catalog. Every suggestion names the sources it rests on, says in
 *   plain words what those sources measured, and is marked either
 *   "measured" (a cited study observed the product within the suggested
 *   window) or "judgment" (no study covers this exact product, so the number
 *   is a conservative reading of the closest evidence, and it says so).
 *
 * WHAT IT IS NOT
 *   A regulation, and never applied on its own. Washington does not require
 *   an expiration date on cannabis: WAC 314-55-105(8) lists a "best by" date
 *   as OPTIONAL label information. A suggestion only becomes a rule when the
 *   owner presses "Use suggestion" (or types their own), and a rule only
 *   writes after an owner-confirmed preview. A manufacturer's own date (on
 *   the manifest / JSON / COA) always wins over any rule.
 *
 * THE ONE PRINCIPLE THE NUMBERS FOLLOW
 *   Suggest the longest storage time at room temperature for which the cited
 *   data shows the product still stable, or losing no more than about a
 *   fifth of its potency (flower: 16.6% THC loss in year one, UNODC 1997;
 *   cannabis oil: ~21.6-23.2% THC loss per year, Trofin 2012). Where the
 *   evidence is thinner, shorten - never lengthen.
 *
 * Every URL below was opened and read during R34 research. Paywalled
 * standards (ASTM D8197) are cited by their public scope page only.
 *
 * PURE: no I/O. Registered in scripts/compliance/run-pure-selftests.ts.
 */

export type ExpiryCitation = {
  key: string;
  /** Short name shown on the page ("UNODC Bulletin 1997 - Ross & ElSohly"). */
  title: string;
  /** Who publishes it (regulator / journal). */
  publisher: string;
  /** What it says that matters here, in plain words. */
  finding: string;
  url: string;
  /** regulation = a rule with force of law somewhere; guidance = agency guidance; study = peer-reviewed / standards. */
  kind: "regulation" | "guidance" | "study";
};

export const EXPIRY_CITATIONS: readonly ExpiryCitation[] = [
  {
    key: "wac-314-55-105",
    title: "WAC 314-55-105(8) - optional label information",
    publisher: "Washington State Legislature / LCB",
    finding:
      "\"Optional label information includes the following: Harvest date, 'best by' date, and manufactured dates.\" Washington does not require an expiration date on cannabis products.",
    url: "https://app.leg.wa.gov/WAC/default.aspx?cite=314-55-105",
    kind: "regulation",
  },
  {
    key: "wac-314-55-077",
    title: "WAC 314-55-077(10)-(11) - what an edible may be",
    publisher: "Washington State Legislature / LCB",
    finding:
      "Potentially hazardous (refrigerated / time-temperature controlled) foods may not be infused, and acidified or canned/retorted foods, juices, dairy and egg-based pies are not allowed. Washington edibles are shelf-stable foods by rule.",
    url: "https://app.leg.wa.gov/WAC/default.aspx?cite=314-55-077",
    kind: "regulation",
  },
  {
    key: "co-212-3-335",
    title: "Colorado 1 CCR 212-3, Rule 3-335(M) - vaporizer expiration dates",
    publisher: "Colorado Marijuana Enforcement Division",
    finding:
      "The manufacturer sets a vaporizer's expiration date from potency and contaminant testing of the final device, considering additive expiry, hardware interaction, formulation and storage conditions (accelerated stability testing allowed), documents it, and enters it in inventory tracking.",
    url: "https://www.law.cornell.edu/regulations/colorado/1-CCR-212-3-3-335",
    kind: "regulation",
  },
  {
    key: "co-212-3-1010",
    title: "Colorado 1 CCR 212-3, Rule 3-1010 - vaporizer label must show expiration",
    publisher: "Colorado Marijuana Enforcement Division",
    finding:
      "Since July 1, 2022 a regulated vaporizer device label must carry an expiration date and storage conditions.",
    url: "https://regulations.justia.com/states/colorado/200/212/rule-1-ccr-212-3/part-3/section-1-ccr-212-3-3-1010",
    kind: "regulation",
  },
  {
    key: "ma-935-cmr-500-105",
    title: "Massachusetts 935 CMR 500.105 - use-by dates",
    publisher: "Massachusetts Cannabis Control Commission",
    finding:
      "Edibles must show \"the date of creation and the recommended 'use by' or expiration date which may not be altered or changed\"; vaporizer devices must also carry a date of creation and a use-by date.",
    url: "https://www.law.cornell.edu/regulations/massachusetts/935-CMR-500-105",
    kind: "regulation",
  },
  {
    key: "health-canada-labelling",
    title: "Health Canada - packaging and labelling guide for cannabis products",
    publisher: "Health Canada",
    finding:
      "An expiry date is shown only when a stability period has been established; edible cannabis needs a \"best before\" date when its durable life is 90 days or less.",
    url: "https://www.canada.ca/en/health-canada/services/cannabis-regulations-licensed-producers/packaging-labelling-guide-cannabis-products.html",
    kind: "regulation",
  },
  {
    key: "usda-fsis-dating",
    title: "USDA FSIS - Food Product Dating",
    publisher: "U.S. Department of Agriculture, Food Safety and Inspection Service",
    finding:
      "Except infant formula, product dating is not federally required; dates describe quality, not safety. FSIS recommends the phrase \"Best if Used By\".",
    url: "https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/food-safety-basics/food-product-dating",
    kind: "guidance",
  },
  {
    key: "fda-cosmetics-shelf-life",
    title: "FDA - Shelf Life and Expiration Dating of Cosmetics",
    publisher: "U.S. Food and Drug Administration",
    finding:
      "No U.S. law requires cosmetics to carry a shelf life or expiration date; the manufacturer is responsible. Emulsions can separate and preservatives break down over time.",
    url: "https://www.fda.gov/cosmetics/cosmetics-labeling/shelf-life-and-expiration-dating-cosmetics",
    kind: "guidance",
  },
  {
    key: "unodc-1997-ross-elsohly",
    title: "Ross & ElSohly (UNODC Bulletin on Narcotics, 1997)",
    publisher: "United Nations Office on Drugs and Crime",
    finding:
      "Cannabis flower stored at room temperature (20-22 C) lost 16.6% of its THC after 1 year, 26.8% after 2, 34.5% after 3 and 41.4% after 4. Loss is fastest in the first year. Fairbairn: carefully prepared herbal or resin products are reasonably stable for 1-2 years in the dark.",
    url: "https://www.unodc.org/unodc/en/data-and-analysis/bulletin/bulletin_1997-01-01_1_page008.html",
    kind: "study",
  },
  {
    key: "astm-d8197",
    title: "ASTM D8197 - water activity of dried cannabis flower",
    publisher: "ASTM International",
    finding:
      "Standard method for maintaining dried cannabis flower at a water activity of 0.55-0.65 for storage. (Standard is paywalled; scope page cited.)",
    url: "https://www.astm.org/d8197-21.html",
    kind: "study",
  },
  {
    key: "lindholst-2010",
    title: "Lindholst 2010 - long-term stability of cannabis resin and extracts",
    publisher: "Australian Journal of Forensic Sciences 42(3):181-190",
    finding:
      "THCA half-life in resin was about 330 days in daylight and 462 days in the dark; in extracts at room temperature it fell to 35 days (light) and 91 days (dark). Extracts must be kept out of light.",
    url: "https://pure.au.dk/portal/en/publications/long-term-stability-of-cannabis-resin-and-cannabis-extracts",
    kind: "study",
  },
  {
    key: "trofin-2012",
    title: "Trofin et al. 2012 - cannabis oil stored for four years",
    publisher: "Revista de Chimie 63(3):293-297",
    finding:
      "Cannabis oil lost about 21.6% of its THC per year in the dark at 4 C and about 23.2% per year in light at 22 C (83.75% / 89.85% lost after four years); CBD fell more slowly.",
    url: "https://www.researchgate.net/publication/236170001",
    kind: "study",
  },
  {
    key: "kosovic-2021",
    title: "Kosovic et al. 2021 - CBD stability under ICH conditions",
    publisher: "Pharmaceutics 13(3):412",
    finding:
      "CBD in sunflower oil stayed stable for at least 180 days at 25 C / 60% RH but only 58% remained after one year; CBD powder lost 8-10% in a year. At 40 C losses were much faster.",
    url: "https://www.mdpi.com/1999-4923/13/3/412",
    kind: "study",
  },
  {
    key: "jaidee-2022",
    title: "Jaidee et al. 2022 - cannabinoid degradation kinetics",
    publisher: "Cannabis and Cannabinoid Research (PMC9418372)",
    finding:
      "Cannabinoid degradation rises with temperature and with acidity (pH below 4); CBD is most stable between pH 4 and 6.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC9418372",
    kind: "study",
  },
  {
    key: "wolf-poklis-2017",
    title: "Wolf, Poklis et al. 2017 - THC and CBD in baked brownies",
    publisher: "Journal of Analytical Toxicology 41:153 (PMC5412015)",
    finding:
      "THC and CBD in baked brownies stored at room temperature in reclosable bags stayed stable for the full 3 months studied.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5412015",
    kind: "study",
  },
  {
    key: "froude-2024",
    title: "Froude et al. 2024 - review of cannabis beverages",
    publisher: "Cannabis 7(3):134 (PMC11705039)",
    finding:
      "THC in water-based drinks is unstable without emulsifiers: cannabis tea fell to 60% after one day and 6% after 12 days (Hazekamp 2007); refrigerated tea fell below 65% by day 3 (Pacifici 2017). Beverage labels were often inaccurate (61.5% over-labelled, Vandrey 2015).",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11705039",
    kind: "study",
  },
];

const CITATION_BY_KEY = new Map(EXPIRY_CITATIONS.map((c) => [c.key, c] as const));

export function citationByKey(key: string | null | undefined): ExpiryCitation | null {
  if (!key) return null;
  return CITATION_BY_KEY.get(key) ?? null;
}

/** Every suggestion also cites these two: the WA rule and what a date means. */
export const BASE_CITATIONS = ["wac-314-55-105", "usda-fsis-dating"] as const;

export type ExpirySuggestion = {
  /** months | exempt. Days / fixed dates are owner choices, never suggested. */
  mode: "months" | "exempt";
  /** Months after the basis date; null for exempt. */
  months: number | null;
  /**
   * measured  = a cited study observed this product type stable (or within
   *             ~20% loss) for at least this long.
   * judgment  = no study covers this exact product; a conservative reading of
   *             the nearest evidence, said plainly in `why`.
   * not_applicable = not a cannabis product; it does not degrade.
   */
  confidence: "measured" | "judgment" | "not_applicable";
  /** One plain paragraph: what the sources say and how the number follows. */
  why: string;
  /** Citation keys (always valid keys of EXPIRY_CITATIONS). */
  citations: readonly string[];
};

/**
 * Suggestions per WEBSITE CATEGORY (src/lib/pos/category-taxonomy.ts values).
 * Every category in the taxonomy has exactly one entry (asserted by a test).
 */
export const CATEGORY_SUGGESTIONS: Readonly<Record<string, ExpirySuggestion>> = {
  flower: {
    mode: "months",
    months: 12,
    confidence: "measured",
    why: "Flower kept at room temperature lost 16.6% of its THC in the first year and about 7% a year after that (UNODC 1997); Fairbairn found carefully stored flower reasonably stable for 1-2 years in the dark. Twelve months is the point where about a sixth of the potency is gone, so the label still roughly tells the truth.",
    citations: ["unodc-1997-ross-elsohly", "astm-d8197"],
  },
  "popcorn-bud": {
    mode: "months",
    months: 12,
    confidence: "measured",
    why: "Popcorn bud is the same dried flower in smaller pieces, so the flower data applies: 16.6% THC loss in year one at room temperature (UNODC 1997).",
    citations: ["unodc-1997-ross-elsohly", "astm-d8197"],
  },
  trim: {
    mode: "months",
    months: 12,
    confidence: "judgment",
    why: "Trim and shake are the same plant material as flower (16.6% THC loss in year one, UNODC 1997). No study measured trim separately; its broken structure exposes more surface, so do not stretch past the flower figure.",
    citations: ["unodc-1997-ross-elsohly"],
  },
  "infused-flower": {
    mode: "months",
    months: 9,
    confidence: "judgment",
    why: "Infused flower is flower coated with concentrate or kief. The flower part loses about a sixth of its THC in a year (UNODC 1997), but extract coatings degrade faster, especially in light (Lindholst 2010). No study measured infused flower, so the suggestion is shorter than plain flower.",
    citations: ["unodc-1997-ross-elsohly", "lindholst-2010"],
  },
  preroll: {
    mode: "months",
    months: 9,
    confidence: "judgment",
    why: "A pre-roll is ground flower: the flower data applies (16.6% THC loss in year one, UNODC 1997), but grinding exposes far more surface to air and light and no study measured pre-rolls. Nine months shortens the flower figure rather than stretching it.",
    citations: ["unodc-1997-ross-elsohly", "astm-d8197"],
  },
  blunt: {
    mode: "months",
    months: 9,
    confidence: "judgment",
    why: "A blunt is ground flower in a wrap, so it follows the pre-roll reasoning: flower data (UNODC 1997), shortened for the ground material. No blunt-specific study was found.",
    citations: ["unodc-1997-ross-elsohly"],
  },
  "preroll-pack": {
    mode: "months",
    months: 9,
    confidence: "judgment",
    why: "Multi-packs are the same ground flower as single pre-rolls (UNODC 1997 flower data, shortened for grinding). No pack-specific study was found.",
    citations: ["unodc-1997-ross-elsohly"],
  },
  "infused-preroll": {
    mode: "months",
    months: 9,
    confidence: "judgment",
    why: "Ground flower plus concentrate: flower loses about a sixth of its THC in a year (UNODC 1997) and extracts degrade faster in light (Lindholst 2010). No infused pre-roll study was found.",
    citations: ["unodc-1997-ross-elsohly", "lindholst-2010"],
  },
  "infused-blunt": {
    mode: "months",
    months: 9,
    confidence: "judgment",
    why: "Same reasoning as an infused pre-roll: flower data (UNODC 1997) plus faster extract degradation (Lindholst 2010).",
    citations: ["unodc-1997-ross-elsohly", "lindholst-2010"],
  },
  "infused-preroll-pack": {
    mode: "months",
    months: 9,
    confidence: "judgment",
    why: "Same product as single infused pre-rolls, packed together (UNODC 1997; Lindholst 2010).",
    citations: ["unodc-1997-ross-elsohly", "lindholst-2010"],
  },
  cartridge: {
    mode: "months",
    months: 12,
    confidence: "judgment",
    why: "Colorado and Massachusetts require vape expiration dates and Colorado makes the manufacturer set them from stability testing of the finished device, because oil, additives and hardware interact. No public stability study of cartridges was found. Cannabis oil loses about a fifth of its THC per year (Trofin 2012), so 12 months is the outside limit. A manufacturer's date always beats this rule.",
    citations: ["co-212-3-335", "co-212-3-1010", "ma-935-cmr-500-105", "trofin-2012"],
  },
  "disposable-cartridge": {
    mode: "months",
    months: 12,
    confidence: "judgment",
    why: "Same as cartridges: the oil loses about a fifth of its THC per year (Trofin 2012), and Colorado requires the manufacturer to set the date by testing the finished device. A manufacturer's date always beats this rule.",
    citations: ["co-212-3-335", "co-212-3-1010", "trofin-2012"],
  },
  concentrate: {
    mode: "months",
    months: 12,
    confidence: "measured",
    why: "Cannabis extracts lost about 21.6-23.2% of their THC per year (Trofin 2012). In extracts kept in light the acid form (THCA) breaks down much faster (Lindholst 2010), so storage matters. Twelve months matches the point where about a fifth of the potency is gone.",
    citations: ["trofin-2012", "lindholst-2010"],
  },
  rso: {
    mode: "months",
    months: 12,
    confidence: "measured",
    why: "RSO is a full-plant oil: cannabis oil lost about 21.6-23.2% of its THC per year in Trofin 2012.",
    citations: ["trofin-2012", "lindholst-2010"],
  },
  tincture: {
    mode: "months",
    months: 6,
    confidence: "measured",
    why: "Cannabinoids in a carrier oil were stable for at least 180 days at room temperature, but only 58% of the CBD remained after one year (Kosovic 2021). Six months is the longest period the study found stable.",
    citations: ["kosovic-2021", "trofin-2012"],
  },
  "edible-solid": {
    mode: "months",
    months: 6,
    confidence: "judgment",
    why: "Washington edibles must be shelf-stable foods (WAC 314-55-077). THC and CBD in baked brownies stayed stable for the full 3 months studied (Wolf/Poklis 2017); no longer study was found. Food dates describe quality, not safety (USDA FSIS). Six months is a judgment past the measured 3 months; choose 3 months to stay strictly within the evidence. A manufacturer's best-by always wins.",
    citations: ["wac-314-55-077", "wolf-poklis-2017", "ma-935-cmr-500-105", "health-canada-labelling"],
  },
  "edible-liquid": {
    mode: "months",
    months: 3,
    confidence: "judgment",
    why: "THC in water is unstable without emulsifiers: cannabis tea lost 40% in a day (Hazekamp 2007, in Froude 2024), and degradation rises with acidity below pH 4 (Jaidee 2022), which is common in sodas. Commercial drinks are emulsified and far more stable, but no public study of them was found, and beverage labels were often over-stated. Three months is deliberately short; verify with the manufacturer.",
    citations: ["froude-2024", "jaidee-2022", "health-canada-labelling", "wac-314-55-077"],
  },
  topical: {
    mode: "months",
    months: 12,
    confidence: "judgment",
    why: "Topicals are regulated like cosmetics for shelf life: no U.S. law sets one and the manufacturer is responsible; emulsions separate and preservatives break down (FDA). The cannabinoid in the oil phase follows the oil data (Trofin 2012). Twelve months is a conservative cosmetic-style default.",
    citations: ["fda-cosmetics-shelf-life", "trofin-2012"],
  },
  accessories: {
    mode: "exempt",
    months: null,
    confidence: "not_applicable",
    why: "Glass, rolling gear, batteries and tools contain no cannabis and do not expire.",
    citations: [],
  },
  merch: {
    mode: "exempt",
    months: null,
    confidence: "not_applicable",
    why: "Greenway apparel and gear (tees, hoodies, hats, socks, lanyards) contain no cannabis, so there is no potency to lose and no date to set.",
    citations: [],
  },
  paraphernalia: {
    mode: "exempt",
    months: null,
    confidence: "not_applicable",
    why: "Devices, pipes, wraps and other non-cannabis gear do not expire.",
    citations: [],
  },
};

/**
 * Type-level suggestions, ONLY where the evidence differs from the type's
 * website category. Keyed by inventoryTypeKey (lower(trim), single spaces).
 * Every other type inherits its category's suggestion.
 */
export const TYPE_SUGGESTIONS: Readonly<Record<string, ExpirySuggestion>> = {
  // The catalog files Tincture under edible-liquid (3 months, beverage data),
  // but a tincture is an oil/alcohol carrier, not a water drink.
  tincture: CATEGORY_SUGGESTIONS.tincture,
};

/** The suggestion for a category value (null when the category is unknown). */
export function suggestionForCategory(category: string | null | undefined): ExpirySuggestion | null {
  if (!category) return null;
  return CATEGORY_SUGGESTIONS[category] ?? null;
}

/**
 * The suggestion for a type: its own entry, else its category's. `source`
 * says which, so the page can say "inherits Flower".
 */
export function suggestionForType(
  typeKey: string,
  category: string | null | undefined,
): { suggestion: ExpirySuggestion; source: "type" | "category" } | null {
  const own = TYPE_SUGGESTIONS[typeKey];
  if (own) return { suggestion: own, source: "type" };
  const cat = suggestionForCategory(category);
  return cat ? { suggestion: cat, source: "category" } : null;
}

/** "12 months" / "Does not expire". */
export function suggestionLabel(s: ExpirySuggestion): string {
  if (s.mode === "exempt") return "Does not expire";
  return `${s.months} month${s.months === 1 ? "" : "s"}`;
}

export function confidenceLabel(c: ExpirySuggestion["confidence"]): string {
  switch (c) {
    case "measured":
      return "Measured in a cited study";
    case "judgment":
      return "Judgment from the nearest evidence";
    case "not_applicable":
      return "Not a cannabis product";
  }
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------
export function __runExpiryResearchCoreTests(categoryValues: readonly string[]): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL expiry-research-core: " + msg);
    }
  };

  // Every taxonomy category has exactly one suggestion, and nothing extra.
  for (const v of categoryValues) ok(Boolean(CATEGORY_SUGGESTIONS[v]), `suggestion for category ${v}`);
  for (const k of Object.keys(CATEGORY_SUGGESTIONS)) ok(categoryValues.includes(k), `no stray category ${k}`);

  // Citations: unique keys, https, every suggestion cites real keys.
  const keys = EXPIRY_CITATIONS.map((c) => c.key);
  ok(new Set(keys).size === keys.length, "citation keys unique");
  for (const c of EXPIRY_CITATIONS) {
    ok(c.url.startsWith("https://"), `https url ${c.key}`);
    ok(c.finding.length > 40, `finding stated ${c.key}`);
  }
  for (const b of BASE_CITATIONS) ok(citationByKey(b) !== null, `base citation ${b}`);
  const all = { ...CATEGORY_SUGGESTIONS, ...TYPE_SUGGESTIONS };
  for (const [k, s] of Object.entries(all)) {
    for (const ck of s.citations) ok(citationByKey(ck) !== null, `${k} cites known ${ck}`);
    if (s.mode === "months") {
      ok(Number.isInteger(s.months) && (s.months as number) >= 1 && (s.months as number) <= 24, `${k} months sane`);
      ok(s.citations.length > 0, `${k} cannabis suggestion is cited`);
      ok(s.confidence !== "not_applicable", `${k} cannabis is not n/a`);
    } else {
      ok(s.months === null && s.confidence === "not_applicable", `${k} exempt shape`);
    }
    ok(s.why.length > 60, `${k} explains why`);
  }

  // The principle: nothing is suggested longer than flower's measured 12 months.
  for (const [k, s] of Object.entries(all)) {
    if (s.mode === "months") ok((s.months as number) <= 12, `${k} not longer than the flower evidence`);
  }
  // Specific evidence-driven values.
  ok(CATEGORY_SUGGESTIONS.flower.months === 12, "flower 12");
  ok(CATEGORY_SUGGESTIONS.tincture.months === 6, "tincture 6 (Kosovic 180 days)");
  ok(CATEGORY_SUGGESTIONS["edible-liquid"].months === 3, "drinks 3");
  ok(CATEGORY_SUGGESTIONS["edible-liquid"].months! < CATEGORY_SUGGESTIONS["edible-solid"].months!, "drinks shorter than solids");
  ok(CATEGORY_SUGGESTIONS.preroll.months! < CATEGORY_SUGGESTIONS.flower.months!, "pre-rolls shorter than flower");
  ok(CATEGORY_SUGGESTIONS.accessories.mode === "exempt", "accessories exempt");
  ok(CATEGORY_SUGGESTIONS.cartridge.citations.includes("co-212-3-335"), "carts cite the manufacturer-sets-it rule");

  // Type resolution.
  const t = suggestionForType("tincture", "edible-liquid");
  ok(t?.source === "type" && t.suggestion.months === 6, "tincture type beats edible-liquid");
  const g = suggestionForType("gummies", "edible-solid");
  ok(g?.source === "category" && g.suggestion.months === 6, "gummies inherit edible-solid");
  ok(suggestionForType("x", null) === null, "unknown type, unknown category -> none");
  ok(suggestionForCategory("nope") === null, "unknown category -> none");
  ok(suggestionLabel(CATEGORY_SUGGESTIONS.flower) === "12 months", "label months");
  ok(suggestionLabel(CATEGORY_SUGGESTIONS.merch) === "Does not expire", "label exempt");
  ok(confidenceLabel("measured").includes("Measured"), "confidence label");
  return { passed, failed };
}
