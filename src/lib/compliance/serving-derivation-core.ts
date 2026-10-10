/**
 * src/lib/compliance/serving-derivation-core.ts  (Round 37, slice S2)
 *
 * Owner (R37, verbatim): "The state regulates per serving amounts to be 10mg
 * thc max. So if a product has 100mg thc in it, it becomes blatantly obvious
 * that the product has 10 servings. The other cannabinoids do not have this
 * limitation, a single serving can have more than 10mg cbd/cbg/cbn/cbc. So I
 * want the system to fill in these facts based on this information so I
 * don't have to do it manually anymore. There shouldn't be any product that
 * the system can't figure out on its own."
 *
 * PURE (relative imports only - the tsx pure runner and the client-safe
 * facts panel both import it). ONE solver for the three THC serving facts of
 * an mg-dosed product - package THC, THC per serving, servings per package -
 * and the per-serving / package totals of the other cannabinoids.
 *
 * The rule, read on app.leg.wa.gov (WAC 314-55-095, WSR 24-21-051, eff.
 * 1/7/25), never paraphrased into a new limit:
 *   (1)(a) "A single serving of a cannabis-infused product must not exceed 10
 *          milligrams of active delta-9 THC."
 *   (1)(b) "Any one single package of cannabis-infused product meant to be
 *          eaten or swallowed or otherwise taken into the body must not
 *          exceed 100 milligram of active delta-9 THC."
 * Only THC is capped. CBD / CBG / CBN / CBC have no per-serving cap, so a
 * serving of them is simply the package total divided by the servings.
 *
 * ORDER OF EVIDENCE (strongest first; a stronger value is never replaced):
 *   1. stated   - what a person saved, the lab certificate, or the name says
 *                 (the caller tags each with its source);
 *   2. arithmetic - two of the three THC facts give the third exactly
 *                 (package = per serving x servings);
 *   3. lab weight - the certificate's serving weight divides the package's
 *                 net weight into a whole number of servings (50 g / 5 g = 10),
 *                 or the lab THC percent x the net weight gives the package mg
 *                 (percent of weight x 10 x grams = mg). MEASURED on the real
 *                 owner fixture (bytes Sour Mandarin, item 12): the lab weighed
 *                 ONE 4.54 g piece of a 50 g 10-pack, so 50 / 4.54 = 11.01
 *                 reads as 11 servings - wrong. And 0.1206% x 10 x 50 g =
 *                 60.3 mg against the true 55 mg. Pieces vary, so anything
 *                 worked out from lab weights is flagged `assumed` ("check
 *                 the package"): it fills the form, never the menu by itself;
 *   4. WA rule  - a package THC total with nothing else: the FEWEST servings
 *                 the law allows, ceil(package / 10). 100 mg -> 10 x 10 mg,
 *                 55 mg -> 6 x 9.17 mg, 8 mg -> 1 x 8 mg. This is the owner's
 *                 rule; it is labelled as worked out from the rule, with the
 *                 citation, so anyone can see where the number came from.
 *   5. assumed  - only ONE of per-serving or servings is known and no package
 *                 total exists anywhere: the package is assumed to sit at the
 *                 100 mg maximum (or the serving at the 10 mg maximum). These
 *                 are flagged `assumed` - the panel pre-fills them so nothing
 *                 is left blank, but staging never sends an assumed figure to
 *                 the menu on its own.
 *
 * TOPICALS: WAC 314-55-095(1)(b) does not cover products applied to the skin,
 * and a lotion's "serving" is not a dose, so steps 4 and 5 never run for a
 * topical. Plain arithmetic (step 2) still does.
 *
 * No I/O, no React. Self-tests at the bottom (real owner fixture numbers),
 * registered in scripts/compliance/run-pure-selftests.ts with an exact floor.
 */
import {
  PACKAGE_LIMIT_EXEMPT_CATEGORIES,
  SERVING_RULE,
  WA_PACKAGE_MAX_THC_MG,
  WA_SERVING_MAX_THC_MG,
  servingLimitWarnings,
  type ServingLimitWarning,
} from "./serving-limit-warning-core";

export type ServingSource = "owner" | "coa" | "name" | "arithmetic" | "lab-weight" | "wa-rule" | "assumed";
export const MINOR_CANNABINOIDS = ["cbd", "cbg", "cbn", "cbc"] as const;
export type MinorCannabinoid = (typeof MINOR_CANNABINOIDS)[number];

export type KnownFact = { value: number; source: ServingSource; how?: string | null } | null | undefined;

export interface ServingDerivationInput {
  /** Website category ("edible-solid", "topical", ...). */
  category?: string | null;
  /** LCB inventory type ("Solid Edible", "Topical Ointment", ...). */
  inventoryType?: string | null;
  packageThcMg?: KnownFact;
  mgPerServing?: KnownFact;
  servingsPerPack?: KnownFact;
  minors?: Partial<Record<MinorCannabinoid, { packageMg?: KnownFact; perServingMg?: KnownFact }>>;
  /** The lab certificate's serving weight (g). */
  servingWeightG?: number | null;
  /** The package's net weight (g) - name size or the lot's unit weight. */
  packageNetWeightG?: number | null;
  /** The lab's total-THC percent of weight (used only with a net weight). */
  labThcPct?: number | null;
  labMinorPct?: Partial<Record<MinorCannabinoid, number | null>>;
}

export interface DerivedFact {
  value: number;
  source: ServingSource;
  /** One plain sentence: where the number came from (arithmetic shown). */
  how: string;
  /** False = it was stated; true = the solver worked it out. */
  derived: boolean;
  /** True = rests on an assumed maximum - never sent to the menu on its own. */
  assumed: boolean;
}

export interface ServingDerivation {
  packageThcMg: DerivedFact | null;
  mgPerServing: DerivedFact | null;
  servingsPerPack: DerivedFact | null;
  minors: Record<MinorCannabinoid, { packageMg: DerivedFact | null; perServingMg: DerivedFact | null }>;
  /** True when all three THC facts are known (stated or worked out). */
  complete: boolean;
  /** Stated figures that do not agree with each other (never "fixed" silently). */
  conflicts: string[];
  /** WAC 314-55-095 warnings on the final figures. */
  warnings: ServingLimitWarning[];
  /** True when the rule-based steps were skipped (topical). */
  topical: boolean;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const fmt = (x: number) => String(r2(x));
const pos = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

const SOURCE_WORD: Record<ServingSource, string> = {
  owner: "set by a person",
  coa: "from the lab certificate",
  name: "written in the product name",
  arithmetic: "worked out by arithmetic",
  "lab-weight": "worked out from the lab's weights",
  "wa-rule": "worked out from Washington's 10 mg serving rule",
  assumed: "assumed at Washington's maximum - check the package",
};
export function servingSourceWord(s: ServingSource): string {
  return SOURCE_WORD[s];
}

function stated(k: KnownFact, label: string): DerivedFact | null {
  if (!k) return null;
  const v = pos(k.value);
  if (v === null) return null;
  return { value: v, source: k.source, how: k.how?.trim() || `${label} ${SOURCE_WORD[k.source]}`, derived: false, assumed: k.source === "assumed" };
}

function made(value: number, source: ServingSource, how: string, assumed = false): DerivedFact {
  return { value, source, how, derived: true, assumed };
}

/** Is the product a topical (rule-based steps never run)? */
export function isTopicalProduct(category: string | null | undefined, inventoryType: string | null | undefined): boolean {
  const c = String(category ?? "").trim().toLowerCase();
  const t = String(inventoryType ?? "").trim().toLowerCase();
  return PACKAGE_LIMIT_EXEMPT_CATEGORIES.has(c) || t === "topical ointment" || t === "topical";
}

/**
 * Servings from the lab's serving weight and the package's net weight: a
 * whole number within 10% (the lab weighs ONE piece; pieces vary). Null when
 * the division is not near a whole number - a serving is then not one piece.
 */
export function servingsFromWeight(netWeightG: number | null | undefined, servingWeightG: number | null | undefined): number | null {
  const net = pos(netWeightG);
  const sw = pos(servingWeightG);
  if (net === null || sw === null) return null;
  const q = net / sw;
  const r = Math.round(q);
  if (r < 1 || r > 500) return null;
  return Math.abs(q - r) <= 0.1 * r ? r : null;
}

/** The fewest servings Washington allows for a package THC total: ceil(mg / 10). */
export function minServingsForPackage(packageThcMg: number): number {
  return Math.max(1, Math.ceil(r2(packageThcMg) / WA_SERVING_MAX_THC_MG - 1e-9));
}

/** Servings = package / per serving, only when it is (near) a whole number. */
function wholeServings(pkg: number, per: number): number | null {
  const r = Math.round(pkg / per);
  if (r < 1) return null;
  // Lab rounding only: 10 x 5.46 printed as 5.5 = 54.6 against 55 passes;
  // 14 x 7 = 98 against 100 does not (that is a different product shape).
  return Math.abs(pkg - per * r) <= Math.max(0.5, 0.01 * pkg) ? r : null;
}

export function deriveServingFacts(input: ServingDerivationInput): ServingDerivation {
  const topical = isTopicalProduct(input.category, input.inventoryType);
  let pkg = stated(input.packageThcMg, "Package THC");
  let per = stated(input.mgPerServing, "THC per serving");
  let serv = stated(input.servingsPerPack, "Servings");
  if (serv && !Number.isInteger(serv.value)) serv = null; // a fraction of a serving is not a count
  const conflicts: string[] = [];

  // Stated figures that disagree: report, never pick a winner silently.
  if (pkg && per && serv) {
    const want = per.value * serv.value;
    if (Math.abs(pkg.value - want) / want > 0.05) {
      conflicts.push(
        `Package THC ${fmt(pkg.value)} mg does not equal ${serv.value} servings x ${fmt(per.value)} mg = ${fmt(want)} mg - one of the three is wrong.`,
      );
    }
  }

  // Arithmetic on an assumed figure is itself assumed (never laundered).
  const arithmetic = () => {
    if (pkg && per && !serv) {
      const s = wholeServings(pkg.value, per.value);
      if (s !== null) serv = made(s, "arithmetic", `${fmt(pkg.value)} mg in the package / ${fmt(per.value)} mg per serving = ${s} servings`, pkg.assumed || per.assumed);
    }
    if (serv && per && !pkg) pkg = made(r2(per.value * serv.value), "arithmetic", `${serv.value} servings x ${fmt(per.value)} mg = ${fmt(per.value * serv.value)} mg THC in the package`, serv.assumed || per.assumed);
    if (serv && pkg && !per) per = made(r2(pkg.value / serv.value), "arithmetic", `${fmt(pkg.value)} mg / ${serv.value} servings = ${fmt(pkg.value / serv.value)} mg THC per serving`, serv.assumed || pkg.assumed);
  };
  arithmetic();

  // Lab weights: serving weight into the net weight -> servings.
  if (!serv) {
    const s = servingsFromWeight(input.packageNetWeightG, input.servingWeightG);
    if (s !== null) {
      serv = made(s, "lab-weight", `${fmt(input.packageNetWeightG as number)} g package / the lab's ${fmt(input.servingWeightG as number)} g serving = ${s} servings (the lab weighed one piece; pieces vary)`, true);
      arithmetic();
    }
  }
  // Lab THC percent x net weight -> package mg (only when no per-serving figure
  // exists: a printed per-serving figure is the stronger measurement).
  if (!pkg && !per) {
    const pct = pos(input.labThcPct);
    const net = pos(input.packageNetWeightG);
    if (pct !== null && net !== null) {
      pkg = made(r2(pct * 10 * net), "lab-weight", `the lab's ${fmt(pct)}% THC x 10 x the ${fmt(net)} g package = ${fmt(pct * 10 * net)} mg THC (a percent of one sample; pieces vary)`, true);
      arithmetic();
    }
  }

  if (!topical) {
    // WA rule: a package total alone -> the fewest servings the law allows.
    if (pkg && !serv && !per) {
      const s = minServingsForPackage(pkg.value);
      serv = made(
        s,
        pkg.assumed ? "assumed" : "wa-rule",
        s === 1
          ? `${fmt(pkg.value)} mg THC is within one 10 mg serving (${SERVING_RULE}), so the package is 1 serving`
          : `Washington caps a serving at ${WA_SERVING_MAX_THC_MG} mg THC (${SERVING_RULE}), so ${fmt(pkg.value)} mg is ${s} servings`,
        pkg.assumed,
      );
      arithmetic();
      // arithmetic() sets `per` through its closure; TS narrowed it to null above.
      const perNow = per as DerivedFact | null;
      if (perNow && perNow.derived) per = { ...perNow, source: perNow.assumed ? "assumed" : "wa-rule", how: `${perNow.how} (${SERVING_RULE})` };
    }
    // A package that is NOT a whole number of the stated per-serving dose:
    // the rule still decides the servings (never more than 10 mg each).
    if (pkg && per && !serv) {
      const s = Math.max(minServingsForPackage(pkg.value), Math.round(pkg.value / per.value) || 1);
      serv = made(s, "wa-rule", `${fmt(pkg.value)} mg / ${fmt(per.value)} mg is not a whole number; the nearest whole count that keeps each serving at or under ${WA_SERVING_MAX_THC_MG} mg is ${s} servings - check the package`, true);
    }
    // Assumed maxima: only one per-serving / servings figure and no package anywhere.
    if (per && !pkg && !serv) {
      const s = Math.max(1, Math.floor(WA_PACKAGE_MAX_THC_MG / per.value + 1e-9));
      serv = made(s, "assumed", `assumed the package is at Washington's ${WA_PACKAGE_MAX_THC_MG} mg maximum: ${WA_PACKAGE_MAX_THC_MG} / ${fmt(per.value)} mg = ${s} servings - check the package`, true);
      pkg = made(r2(per.value * s), "assumed", `${s} servings x ${fmt(per.value)} mg = ${fmt(per.value * s)} mg - assumed, check the package`, true);
    }
    if (serv && !pkg && !per) {
      per = made(WA_SERVING_MAX_THC_MG, "assumed", `assumed each serving is at Washington's ${WA_SERVING_MAX_THC_MG} mg maximum - check the package`, true);
      pkg = made(r2(WA_SERVING_MAX_THC_MG * serv.value), "assumed", `${serv.value} servings x ${WA_SERVING_MAX_THC_MG} mg = ${fmt(WA_SERVING_MAX_THC_MG * serv.value)} mg - assumed, check the package`, true);
    }
  }

  // Other cannabinoids: no cap - per serving = package / servings.
  const minors = {} as ServingDerivation["minors"];
  const sv = serv as DerivedFact | null;
  for (const c of MINOR_CANNABINOIDS) {
    const label = c.toUpperCase();
    let mp = stated(input.minors?.[c]?.packageMg, `Package ${label}`);
    let ms = stated(input.minors?.[c]?.perServingMg, `${label} per serving`);
    if (!mp && !ms) {
      const pct = pos(input.labMinorPct?.[c]);
      const net = pos(input.packageNetWeightG);
      if (pct !== null && net !== null) mp = made(r2(pct * 10 * net), "lab-weight", `the lab's ${fmt(pct)}% ${label} x 10 x the ${fmt(net)} g package = ${fmt(pct * 10 * net)} mg ${label} (a percent of one sample)`, true);
    }
    if (sv) {
      const tag = (src: ServingSource): ServingSource => (sv.assumed || src === "assumed" ? "assumed" : "arithmetic");
      if (mp && !ms) ms = made(r2(mp.value / sv.value), tag(mp.source), `${fmt(mp.value)} mg ${label} / ${sv.value} servings = ${fmt(mp.value / sv.value)} mg per serving (no Washington cap on ${label})`, sv.assumed || mp.assumed);
      else if (ms && !mp) mp = made(r2(ms.value * sv.value), tag(ms.source), `${sv.value} servings x ${fmt(ms.value)} mg ${label} = ${fmt(ms.value * sv.value)} mg in the package`, sv.assumed || ms.assumed);
    }
    minors[c] = { packageMg: mp, perServingMg: ms };
  }

  const fp = pkg as DerivedFact | null;
  const fper = per as DerivedFact | null;
  const fs = serv as DerivedFact | null;
  const warnings = servingLimitWarnings({
    mgPerServing: fper?.value ?? null,
    servingsPerPack: fs?.value ?? null,
    packageThcMg: fp?.value ?? null,
    category: input.category ?? null,
  });
  return { packageThcMg: fp, mgPerServing: fper, servingsPerPack: fs, minors, complete: Boolean(fp && fper && fs), conflicts, warnings, topical };
}

/**
 * The Product facts panel field names (intake-fact-review-core) -> the solved
 * value, ONLY for facts the solver worked out (stated ones are already in the
 * form). `assumed` rides along so the panel can say "check the package".
 */
export type ServingPrefill = Record<string, { value: string; how: string; assumed: boolean }>;
export const PANEL_FIELD_FOR: Readonly<Record<string, string>> = Object.freeze({
  packageThcMg: "packageThcMg",
  mgPerServing: "mgPerServing",
  servingsPerPack: "servingsPerPack",
  "cbd.packageMg": "packageCbdMg",
  "cbg.packageMg": "packageCbgMg",
  "cbn.packageMg": "packageCbnMg",
  "cbc.packageMg": "packageCbcMg",
});

export function servingPrefill(d: ServingDerivation): ServingPrefill {
  const out: ServingPrefill = {};
  const put = (field: string, f: DerivedFact | null) => {
    if (f && f.derived) out[field] = { value: String(r2(f.value)), how: f.how, assumed: f.assumed };
  };
  put("packageThcMg", d.packageThcMg);
  put("mgPerServing", d.mgPerServing);
  put("servingsPerPack", d.servingsPerPack);
  for (const c of MINOR_CANNABINOIDS) put(PANEL_FIELD_FOR[`${c}.packageMg`], d.minors[c].packageMg);
  return out;
}

/** Plain per-serving lines for the panel ("CBD 10 mg per serving (no Washington cap)"). */
export function minorServingLines(d: ServingDerivation): string[] {
  const out: string[] = [];
  for (const c of MINOR_CANNABINOIDS) {
    const ms = d.minors[c].perServingMg;
    if (ms) out.push(`${c.toUpperCase()} ${fmt(ms.value)} mg per serving${ms.assumed ? " (assumed)" : ""} - no Washington cap`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Self-tests (house pattern)
// ---------------------------------------------------------------------------

export function __runServingDerivationTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`  FAIL serving-derivation-core: ${m}`);
    }
  };
  const k = (value: number, source: ServingSource = "name"): KnownFact => ({ value, source });

  // 1. The owner's own example: 100 mg -> 10 servings of 10 mg.
  const a = deriveServingFacts({ category: "edible-solid", packageThcMg: k(100) });
  ok(a.servingsPerPack?.value === 10 && a.servingsPerPack.source === "wa-rule", "100 mg -> 10 servings (wa-rule)");
  ok(a.mgPerServing?.value === 10 && a.mgPerServing.source === "wa-rule", "100 mg -> 10 mg per serving (wa-rule)");
  ok(a.complete && a.warnings.length === 0 && a.conflicts.length === 0, "100 mg complete, no warnings");
  ok(a.servingsPerPack!.how.includes("WAC 314-55-095(1)(a)"), "the rule sentence cites the WAC");
  ok(!a.servingsPerPack!.assumed && a.servingsPerPack!.derived, "rule servings are derived, not assumed");
  ok(a.packageThcMg?.derived === false && a.packageThcMg.source === "name", "the stated package stays stated");

  // 2. ceil: 55 mg -> 6 servings (5 would be 11 mg); 8 mg -> 1; 10 -> 1; 10.01 -> 2; 50 -> 5.
  const b = deriveServingFacts({ packageThcMg: k(55) });
  ok(b.servingsPerPack?.value === 6 && b.mgPerServing?.value === 9.17, "55 mg -> 6 x 9.17 mg");
  ok(deriveServingFacts({ packageThcMg: k(8) }).servingsPerPack?.value === 1, "8 mg -> 1 serving");
  ok(deriveServingFacts({ packageThcMg: k(8) }).servingsPerPack!.how.includes("within one 10 mg serving"), "1-serving sentence");
  ok(deriveServingFacts({ packageThcMg: k(10) }).servingsPerPack?.value === 1, "10 mg -> 1 (10 is allowed)");
  ok(deriveServingFacts({ packageThcMg: k(10.01) }).servingsPerPack?.value === 2, "10.01 mg -> 2");
  ok(deriveServingFacts({ packageThcMg: k(50) }).servingsPerPack?.value === 5, "50 mg -> 5");
  ok(deriveServingFacts({ packageThcMg: k(99.999) }).servingsPerPack?.value === 10, "99.999 -> 10 (rounding never adds a serving)");
  ok(minServingsForPackage(100) === 10 && minServingsForPackage(100.004) === 10 && minServingsForPackage(0.5) === 1, "minServingsForPackage edges");
  ok(minServingsForPackage(20) === 2 && minServingsForPackage(20.5) === 3, "minServingsForPackage 20 / 20.5");

  // 3. Arithmetic beats the rule: bytes Sour Mandarin COA 5.5 mg x 10 pk (owner fixture item12).
  const c = deriveServingFacts({ category: "edible-solid", mgPerServing: k(5.5, "coa"), servingsPerPack: k(10, "name") });
  ok(c.packageThcMg?.value === 55 && c.packageThcMg.source === "arithmetic", "5.5 x 10 = 55 (arithmetic)");
  ok(c.complete && c.packageThcMg !== null && !c.packageThcMg.assumed, "item12 complete, not assumed");
  const c2 = deriveServingFacts({ packageThcMg: k(55, "coa"), mgPerServing: k(5.5, "coa") });
  ok(c2.servingsPerPack?.value === 10 && c2.servingsPerPack.source === "arithmetic", "55 / 5.5 = 10 servings (arithmetic, not the rule's 6)");
  const c3 = deriveServingFacts({ packageThcMg: k(100), servingsPerPack: k(20) });
  ok(c3.mgPerServing?.value === 5 && c3.mgPerServing.source === "arithmetic", "100 / 20 = 5 mg");

  // 4. Lab weights: 50 g package / 5 g serving = 10 servings; then 5.5 x 10.
  const d = deriveServingFacts({ mgPerServing: k(5.5, "coa"), servingWeightG: 5, packageNetWeightG: 50 });
  ok(d.servingsPerPack?.value === 10 && d.servingsPerPack.source === "lab-weight" && d.servingsPerPack.assumed, "50 g / 5 g = 10 (lab-weight, flagged check-the-package)");
  ok(d.packageThcMg?.value === 55 && d.packageThcMg.source === "arithmetic" && d.packageThcMg.assumed, "then 55 mg (arithmetic on an assumed count stays assumed)");
  // The real fixture that proves why: item 12 lab piece 4.54 g of a 50 g 10-pack.
  const real = deriveServingFacts({ mgPerServing: k(5.5, "coa"), servingWeightG: 4.54, packageNetWeightG: 50 });
  ok(real.servingsPerPack?.value === 11 && real.servingsPerPack.assumed, "item 12 weights read 11 (truth 10) -> assumed, never trusted");
  ok(servingsFromWeight(50, 4.54) === 11, "50 / 4.54 = 11.01 -> 11");
  ok(servingsFromWeight(50, 7) === 7, "50 / 7 = 7.14 -> 7 (within 10%)");
  ok(servingsFromWeight(50, 40) === null, "50 / 40 = 1.25 -> not a whole count (25% off)");
  ok(servingsFromWeight(50, 33) === null, "50 / 33 = 1.52 -> not a whole count");
  ok(servingsFromWeight(null, 5) === null && servingsFromWeight(50, 0) === null && servingsFromWeight(50, -1) === null, "weights must be positive");
  ok(servingsFromWeight(5000, 1) === null, "over 500 servings is not a package");
  // Lab THC percent x net weight (no per-serving figure): 0.2% x 10 x 50 g = 100 mg -> rule 10.
  const e = deriveServingFacts({ labThcPct: 0.2, packageNetWeightG: 50 });
  ok(e.packageThcMg?.value === 100 && e.packageThcMg.source === "lab-weight" && e.packageThcMg.assumed, "0.2% x 10 x 50 g = 100 mg (lab-weight, assumed)");
  ok(e.servingsPerPack?.value === 10 && e.servingsPerPack.source === "assumed" && e.servingsPerPack.assumed, "then 10 servings, assumed because the total is");
  // A printed per-serving figure outranks the percent route.
  const e2 = deriveServingFacts({ mgPerServing: k(5.5, "coa"), labThcPct: 0.1206, packageNetWeightG: 50, servingWeightG: 5 });
  ok(e2.packageThcMg?.value === 55, "per-serving x weight servings beats percent x weight (55, not 60.3)");

  // 5. Minors: no cap. 1:1 THC:CBD 100/100 -> 10 servings, 10 mg CBD each; 300 mg CBD -> 30 mg per serving.
  const f = deriveServingFacts({ packageThcMg: k(100), minors: { cbd: { packageMg: k(300) }, cbg: { packageMg: k(50) } } });
  ok(f.minors.cbd.perServingMg?.value === 30, "300 mg CBD / 10 = 30 mg per serving (over 10 is fine)");
  ok(f.minors.cbg.perServingMg?.value === 5, "50 mg CBG / 10 = 5");
  ok(f.warnings.length === 0, "minor over 10 mg per serving raises NO warning");
  ok(f.minors.cbn.packageMg === null && f.minors.cbn.perServingMg === null, "absent minor stays absent");
  const f2 = deriveServingFacts({ servingsPerPack: k(10), mgPerServing: k(5.5, "coa"), minors: { cbg: { perServingMg: k(11, "coa") } } });
  ok(f2.minors.cbg.packageMg?.value === 110, "11 mg CBG x 10 = 110 mg package");
  ok(minorServingLines(f).some((l) => l.startsWith("CBD 30 mg per serving")), "minor line copy");
  const f3 = deriveServingFacts({ packageThcMg: k(100), labMinorPct: { cbd: 0.2 }, packageNetWeightG: 50 });
  ok(f3.minors.cbd.packageMg?.value === 100 && f3.minors.cbd.perServingMg?.value === 10, "lab CBD % x weight -> package, then per serving");

  // 6. Assumed maxima (only one figure, no package anywhere).
  const g = deriveServingFacts({ mgPerServing: k(5, "coa") });
  ok(g.servingsPerPack?.value === 20 && g.servingsPerPack.assumed && g.packageThcMg?.value === 100 && g.packageThcMg.assumed, "5 mg only -> assumed 20 x 5 = 100");
  const g2 = deriveServingFacts({ servingsPerPack: k(10) });
  ok(g2.mgPerServing?.value === 10 && g2.mgPerServing.assumed && g2.packageThcMg?.value === 100, "10 servings only -> assumed 10 mg, 100 mg");
  ok(g2.servingsPerPack?.assumed === false, "the stated count is not marked assumed");
  const g3 = deriveServingFacts({ mgPerServing: k(3) });
  ok(g3.servingsPerPack?.value === 33 && g3.packageThcMg?.value === 99, "3 mg only -> 33 servings, 99 mg (never over 100)");

  // 7. Topicals: arithmetic only, no rule, no assumption.
  const t = deriveServingFacts({ category: "topical", packageThcMg: k(500) });
  ok(t.topical && t.servingsPerPack === null && t.mgPerServing === null && !t.complete, "topical 500 mg: no rule servings");
  const t2 = deriveServingFacts({ inventoryType: "Topical Ointment", packageThcMg: k(500), servingsPerPack: k(50) });
  ok(t2.topical && t2.mgPerServing?.value === 10 && t2.mgPerServing.source === "arithmetic", "topical arithmetic still works");
  ok(isTopicalProduct(null, "Topical Ointment") && isTopicalProduct("topical", null) && !isTopicalProduct("edible-solid", "Solid Edible"), "isTopicalProduct");
  ok(deriveServingFacts({ category: "topical", mgPerServing: k(5) }).servingsPerPack === null, "topical: no assumed servings");

  // 8. Conflicts and over-limit figures are reported, never fixed.
  const h = deriveServingFacts({ packageThcMg: k(100, "owner"), mgPerServing: k(10, "coa"), servingsPerPack: k(5) });
  ok(h.conflicts.length === 1 && h.conflicts[0].includes("5 servings x 10 mg = 50 mg"), "stated conflict reported");
  ok(h.packageThcMg?.value === 100 && h.servingsPerPack?.value === 5, "conflicting stated values are left as stated");
  const i = deriveServingFacts({ packageThcMg: k(200), mgPerServing: k(20) });
  ok(i.servingsPerPack?.value === 10 && i.servingsPerPack.source === "arithmetic", "200 / 20 = 10 (arithmetic)");
  ok(i.warnings.some((w) => w.code === "serving_over_limit") && i.warnings.some((w) => w.code === "package_over_limit"), "over-limit figures warn");
  const j = deriveServingFacts({ packageThcMg: k(100), mgPerServing: k(7) });
  ok(j.servingsPerPack?.value === 14 && j.servingsPerPack.source === "wa-rule" && j.servingsPerPack.assumed && j.servingsPerPack.how.includes("not a whole number"), "100 / 7 -> nearest whole count 14 (check the package)");
  const j2 = deriveServingFacts({ packageThcMg: k(100), mgPerServing: k(30) });
  ok(j2.servingsPerPack?.value === 10, "100 / 30 -> never fewer than the rule's 10");

  // 9. Bad input never derives.
  const z = deriveServingFacts({ packageThcMg: { value: -5, source: "name" }, mgPerServing: { value: Number.NaN, source: "coa" } });
  ok(z.packageThcMg === null && z.mgPerServing === null && z.servingsPerPack === null && !z.complete, "negative / NaN ignored");
  ok(deriveServingFacts({}).complete === false && deriveServingFacts({}).servingsPerPack === null, "nothing known -> nothing derived");
  const z2 = deriveServingFacts({ packageThcMg: k(100), servingsPerPack: k(2.5) });
  ok(z2.servingsPerPack?.value === 10 && z2.servingsPerPack.source === "wa-rule", "a fractional stated count is ignored");

  // 10. Panel prefill: only DERIVED facts, with how + assumed.
  const p = servingPrefill(deriveServingFacts({ packageThcMg: k(100, "owner"), minors: { cbd: { packageMg: k(100, "owner") } } }));
  ok(p.servingsPerPack?.value === "10" && p.mgPerServing?.value === "10" && !("packageThcMg" in p), "prefill: derived only");
  ok(!("packageCbdMg" in p), "prefill: a stated minor is not re-filled");
  const p2 = servingPrefill(deriveServingFacts({ mgPerServing: k(5) }));
  ok(p2.servingsPerPack?.assumed === true && p2.packageThcMg?.assumed === true, "prefill carries assumed");
  const p3 = servingPrefill(deriveServingFacts({ packageThcMg: k(100), labMinorPct: { cbg: 0.1 }, packageNetWeightG: 50 }));
  ok(p3.packageCbgMg?.value === "50", "prefill: a worked-out minor package total");
  ok(servingSourceWord("wa-rule").includes("10 mg serving rule") && servingSourceWord("assumed").includes("check the package"), "source words");
  return { passed, failed };
}
