/**
 * src/lib/compliance/serving-limit-warning-core.ts  (Round 35, item #4)
 *
 * PURE (relative imports only, so the tsx pure runner and coa-facts-core can
 * import it). The WAC 314-55-095 serving / package THC limits as ONE set of
 * constants and ONE wording, shared by:
 *   - the lab-certificate path (coa-facts-core deriveCoaDraftFacts), which
 *     HOLDS a product whose certificate prints figures over a limit (R28), and
 *   - the three MANUAL facts forms (Product Onboarding "Product facts",
 *     the Drafts "Fix the facts" flag panel, Menu Imports -> Facts), which
 *     before R35 relied on the reviewer alone (Bible R29 "Next slices").
 *
 * The rule text, read on app.leg.wa.gov (WAC 314-55-095, WSR 24-21-051,
 * effective 1/7/25) - never paraphrased into new limits:
 *   (1)(a) Single serving. A single serving of a cannabis-infused product must
 *          not exceed 10 milligrams of active delta-9 THC. [Other THC
 *          compounds: 0.5 mg each, 1.0 mg combined, per serving.]
 *   (1)(b) Single package. Any one single package of cannabis-infused product
 *          meant to be eaten or swallowed or otherwise taken into the body
 *          must not exceed 100 milligram of active delta-9 THC.
 *
 * WHY A WARNING AND NOT A REFUSAL ON THE MANUAL FORMS ("soft validation"):
 *   The person typing is the data steward reading the physical package. If
 *   the package really says 11 mg per serving, refusing the save would force
 *   them to type a FALSE number to get past the form - the worst outcome for
 *   a compliance record. So the save goes through, the warning is shown on
 *   the form, on the saved facts and in the result banner, and the audit row
 *   records that the facts were saved over the warning. The certificate path
 *   still holds the product (a person must release it), unchanged.
 *
 * SCOPE, from the text:
 *   - Only mg-dosed (infused) categories are checked. Flower, prerolls and
 *     concentrates are not "cannabis-infused products" with servings; an
 *     unknown category (null) IS checked - typed mg figures imply mg dosing,
 *     and an extra warning is harmless where a missing one is not.
 *   - (1)(b) covers products "eaten or swallowed or otherwise taken into the
 *     body". A topical (applied to the skin) is NOT covered by the
 *     recreational package limit, so the package warning is skipped for it.
 *     (The medical rule (2)(b) adds "applied"; this store sells under (1).)
 *   - No tolerance is applied (none exists in the rule), matching the COA
 *     path. 10 mg is allowed; 10.01 mg warns.
 *   - The 0.5 mg / 1.0 mg other-THC limits need per-compound figures the
 *     manual forms do not collect; the certificate path checks them.
 */

/** WAC 314-55-095(1)(a): max active delta-9 THC in one serving (mg). */
export const WA_SERVING_MAX_THC_MG = 10;
/** WAC 314-55-095(1)(b): max active delta-9 THC in one package eaten / swallowed / otherwise taken (mg). */
export const WA_PACKAGE_MAX_THC_MG = 100;
/** WAC 314-55-095(1)(a): max of any ONE THC compound other than delta-9, per serving (mg). */
export const WA_OTHER_THC_EACH_MAX_MG = 0.5;
/** WAC 314-55-095(1)(a): max of ALL THC compounds other than delta-9 together, per serving (mg). */
export const WA_OTHER_THC_TOTAL_MAX_MG = 1.0;

export const SERVING_RULE = "WAC 314-55-095(1)(a)";
export const PACKAGE_RULE = "WAC 314-55-095(1)(b)";

/** Website categories that are mg-dosed infused products (servings exist). */
export const SERVING_LIMIT_CATEGORIES: ReadonlySet<string> = new Set(["edible-solid", "edible-liquid", "tincture", "topical"]);
/** Of those, the ones (1)(b) does NOT cover (applied to the skin, not taken into the body). */
export const PACKAGE_LIMIT_EXEMPT_CATEGORIES: ReadonlySet<string> = new Set(["topical"]);

export type ServingLimitCode = "serving_over_limit" | "package_over_limit";
export type ServingLimitWarning = { code: ServingLimitCode; rule: string; text: string };

export type ServingLimitInput = {
  mgPerServing?: number | null;
  servingsPerPack?: number | null;
  packageThcMg?: number | null;
  /** The website category (e.g. "edible-solid"); null / unknown = checked. */
  category?: string | null;
};

const r2 = (x: number) => Math.round(x * 100) / 100;
const fmt = (x: number) => String(r2(x));
const pos = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

/** The shared sentences (the COA path prefixes them with what the certificate prints). */
export function servingOverLimitSentence(mg: number): string {
  return `${fmt(mg)} mg THC per serving is above Washington's ${WA_SERVING_MAX_THC_MG} mg single-serving limit (${SERVING_RULE}).`;
}
export function packageOverLimitSentence(mg: number): string {
  return `${fmt(mg)} mg THC in the package is above Washington's ${WA_PACKAGE_MAX_THC_MG} mg package limit (${PACKAGE_RULE}).`;
}

/** Is this category checked at all? Unknown / blank = yes. */
export function servingLimitApplies(category: string | null | undefined): boolean {
  const c = typeof category === "string" ? category.trim().toLowerCase() : "";
  return c === "" || SERVING_LIMIT_CATEGORIES.has(c);
}

/**
 * The warnings for one set of typed (or saved) facts. Package THC is the typed
 * figure, else servings x mg per serving (whole servings only - the same
 * arithmetic the form parser fills in).
 */
export function servingLimitWarnings(input: ServingLimitInput): ServingLimitWarning[] {
  if (!servingLimitApplies(input.category)) return [];
  const out: ServingLimitWarning[] = [];
  const per = pos(input.mgPerServing);
  if (per !== null && per > WA_SERVING_MAX_THC_MG) {
    out.push({
      code: "serving_over_limit",
      rule: SERVING_RULE,
      text: `${servingOverLimitSentence(per)} Check the package; if it really says this, it cannot be sold in Washington.`,
    });
  }
  const c = typeof input.category === "string" ? input.category.trim().toLowerCase() : "";
  if (PACKAGE_LIMIT_EXEMPT_CATEGORIES.has(c)) return out;
  const sv = pos(input.servingsPerPack);
  const typed = pos(input.packageThcMg);
  const pkg = typed ?? (per !== null && sv !== null && Number.isInteger(sv) ? r2(per * sv) : null);
  if (pkg !== null && pkg > WA_PACKAGE_MAX_THC_MG) {
    const how = typed === null && per !== null && sv !== null ? ` (${fmt(sv)} servings x ${fmt(per)} mg)` : "";
    out.push({
      code: "package_over_limit",
      rule: PACKAGE_RULE,
      text: `${packageOverLimitSentence(pkg).replace(" in the package", ` in the package${how}`)} Check the package; if it really says this, it cannot be sold in Washington.`,
    });
  }
  return out;
}

/** One short line for a redirect banner / audit row (bounded). */
export function servingLimitSummary(warnings: readonly ServingLimitWarning[]): string {
  if (warnings.length === 0) return "";
  return `Saved, with a Washington limit warning: ${warnings.map((w) => w.text).join(" ")}`.slice(0, 600);
}

/** The audit payload: what was warned, so a save over a warning is on the record. */
export function servingLimitAudit(warnings: readonly ServingLimitWarning[]): { code: ServingLimitCode; rule: string }[] | null {
  return warnings.length ? warnings.map((w) => ({ code: w.code, rule: w.rule })) : null;
}

/**
 * The result banner after a save. The redirect carries only the CODES (never
 * free text from the URL), and the page renders this fixed wording - so a
 * crafted link cannot put words in the banner.
 */
export const SERVING_LIMIT_PARAM = "fact_warn";
const ALL_CODES: readonly ServingLimitCode[] = ["serving_over_limit", "package_over_limit"];

export function servingLimitParam(warnings: readonly ServingLimitWarning[]): string | null {
  const c = ALL_CODES.filter((code) => warnings.some((w) => w.code === code));
  return c.length ? c.join(",") : null;
}

export function parseServingLimitCodes(raw: unknown): ServingLimitCode[] {
  if (typeof raw !== "string") return [];
  const parts = new Set(raw.split(",").map((s) => s.trim()));
  return ALL_CODES.filter((c) => parts.has(c));
}

export function servingLimitBannerText(codes: readonly ServingLimitCode[]): string | null {
  if (codes.length === 0) return null;
  const parts: string[] = [];
  if (codes.includes("serving_over_limit")) parts.push(`more than ${WA_SERVING_MAX_THC_MG} mg THC per serving (${SERVING_RULE})`);
  if (codes.includes("package_over_limit")) parts.push(`more than ${WA_PACKAGE_MAX_THC_MG} mg THC in the package (${PACKAGE_RULE})`);
  return `Saved - but the facts you entered say ${parts.join(" and ")}, above Washington's limit. Check the physical package: if it really says this, the product cannot be sold in Washington. If you typed it wrong, correct it and save again.`;
}

/**
 * Only a real website category narrows the check (the hidden form field is a
 * hint from the page, never trusted to invent a category). Anything else is
 * treated as unknown, which is CHECKED.
 */
export function limitCategoryFromForm(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.trim().toLowerCase();
  return /^[a-z][a-z0-9-]{0,40}$/.test(c) ? c : null;
}

// ---------------------------------------------------------------------------
// self-tests (pure runner + vitest pin the count)
// ---------------------------------------------------------------------------

export function __runServingLimitWarningCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL serving-limit-warning-core: " + msg);
    }
  };
  const codes = (w: ServingLimitWarning[]) => w.map((x) => x.code).join(",");

  // constants = the rule text
  ok(WA_SERVING_MAX_THC_MG === 10, "serving max 10 mg");
  ok(WA_PACKAGE_MAX_THC_MG === 100, "package max 100 mg");
  ok(WA_OTHER_THC_EACH_MAX_MG === 0.5 && WA_OTHER_THC_TOTAL_MAX_MG === 1.0, "other-THC 0.5 / 1.0");
  ok(SERVING_RULE === "WAC 314-55-095(1)(a)" && PACKAGE_RULE === "WAC 314-55-095(1)(b)", "rule cites");

  // boundaries: equal is allowed, above warns, no tolerance
  ok(servingLimitWarnings({ mgPerServing: 10 }).length === 0, "10 mg/serving allowed");
  ok(codes(servingLimitWarnings({ mgPerServing: 10.01 })) === "serving_over_limit", "10.01 mg warns (no tolerance)");
  ok(codes(servingLimitWarnings({ mgPerServing: 11 })) === "serving_over_limit", "11 mg warns");
  ok(servingLimitWarnings({ packageThcMg: 100 }).length === 0, "100 mg package allowed");
  ok(codes(servingLimitWarnings({ packageThcMg: 100.5 })) === "package_over_limit", "100.5 mg package warns");

  // the owner's real Honeydew case: 11 mg x 10 = 110 mg -> both
  const honey = servingLimitWarnings({ mgPerServing: 11, servingsPerPack: 10, category: "edible-solid" });
  ok(codes(honey) === "serving_over_limit,package_over_limit", "11 x 10 -> both warnings");
  ok(honey[0].text.includes("11 mg THC per serving") && honey[0].text.includes("WAC 314-55-095(1)(a)"), "serving text cites (1)(a)");
  ok(honey[1].text.includes("110 mg THC in the package (10 servings x 11 mg)") && honey[1].text.includes("WAC 314-55-095(1)(b)"), "package text shows the arithmetic");
  ok(honey.every((w) => w.text.endsWith("cannot be sold in Washington.")), "plain-words consequence");

  // typed package wins over the arithmetic (the parser already refuses a contradiction)
  const typed = servingLimitWarnings({ mgPerServing: 5, servingsPerPack: 30, packageThcMg: 90 });
  ok(typed.length === 0, "typed 90 mg package wins over 5x30=150");
  const typedOver = servingLimitWarnings({ mgPerServing: 5, servingsPerPack: 10, packageThcMg: 150 });
  ok(codes(typedOver) === "package_over_limit" && !typedOver[0].text.includes("servings x"), "typed package: no arithmetic shown");

  // computed only from whole servings
  ok(servingLimitWarnings({ mgPerServing: 10, servingsPerPack: 10.5 }).length === 0, "fractional servings: no computed package");
  ok(codes(servingLimitWarnings({ mgPerServing: 10, servingsPerPack: 11 })) === "package_over_limit", "10 x 11 = 110 computed");
  ok(servingLimitWarnings({ mgPerServing: 10, servingsPerPack: 10 }).length === 0, "10 x 10 = 100 allowed");

  // categories
  ok(servingLimitWarnings({ mgPerServing: 50, category: "flower" }).length === 0, "flower not checked");
  ok(servingLimitWarnings({ mgPerServing: 50, category: "concentrate" }).length === 0, "concentrate not checked");
  ok(servingLimitWarnings({ mgPerServing: 50, category: "infused-preroll" }).length === 0, "infused preroll not checked");
  ok(codes(servingLimitWarnings({ mgPerServing: 50, category: null })) === "serving_over_limit", "unknown category checked");
  ok(codes(servingLimitWarnings({ mgPerServing: 50, category: "  " })) === "serving_over_limit", "blank category checked");
  ok(codes(servingLimitWarnings({ mgPerServing: 12, category: "EDIBLE-LIQUID" })) === "serving_over_limit", "category case-insensitive");
  ok(codes(servingLimitWarnings({ mgPerServing: 12, servingsPerPack: 20, category: "tincture" })) === "serving_over_limit,package_over_limit", "tincture: both");
  const top = servingLimitWarnings({ mgPerServing: 12, servingsPerPack: 20, packageThcMg: 240, category: "topical" });
  ok(codes(top) === "serving_over_limit", "topical: serving only - (1)(b) does not cover applied products");
  ok(servingLimitWarnings({ packageThcMg: 500, category: "topical" }).length === 0, "topical 500 mg package: no warning");
  ok(servingLimitApplies(undefined) && servingLimitApplies("edible-solid") && !servingLimitApplies("flower"), "servingLimitApplies");

  // junk input never warns, never throws
  ok(servingLimitWarnings({}).length === 0, "empty input");
  ok(servingLimitWarnings({ mgPerServing: NaN, packageThcMg: Infinity }).length === 0, "non-finite ignored");
  ok(servingLimitWarnings({ mgPerServing: -20, packageThcMg: -500 }).length === 0, "negatives ignored");
  ok(servingLimitWarnings({ mgPerServing: 0, packageThcMg: 0 }).length === 0, "zero (clear) ignored");
  ok(servingLimitWarnings({ mgPerServing: "50" as unknown as number }).length === 0, "strings ignored (parser gives numbers)");

  // shared sentences (the COA path reuses them)
  ok(servingOverLimitSentence(10.62) === "10.62 mg THC per serving is above Washington's 10 mg single-serving limit (WAC 314-55-095(1)(a)).", "serving sentence exact");
  ok(packageOverLimitSentence(110) === "110 mg THC in the package is above Washington's 100 mg package limit (WAC 314-55-095(1)(b)).", "package sentence exact");
  ok(servingOverLimitSentence(10.625) .startsWith("10.63 mg"), "rounded to 2 places");

  // summary + audit
  ok(servingLimitSummary([]) === "", "summary empty");
  const sum = servingLimitSummary(honey);
  ok(sum.startsWith("Saved, with a Washington limit warning: ") && sum.includes("(1)(a)") && sum.includes("(1)(b)"), "summary carries both");
  ok(servingLimitSummary(Array.from({ length: 20 }, () => honey[0])).length === 600, "summary bounded to 600");
  ok(servingLimitAudit([]) === null, "audit null when clean");
  const au = servingLimitAudit(honey);
  ok(JSON.stringify(au) === JSON.stringify([{ code: "serving_over_limit", rule: SERVING_RULE }, { code: "package_over_limit", rule: PACKAGE_RULE }]), "audit codes + rules");

  // redirect codes + fixed banner wording
  ok(SERVING_LIMIT_PARAM === "fact_warn", "param name");
  ok(servingLimitParam([]) === null, "no param when clean");
  ok(servingLimitParam(honey) === "serving_over_limit,package_over_limit", "param both");
  ok(servingLimitParam([honey[1], honey[1]]) === "package_over_limit", "param de-duplicated");
  ok(parseServingLimitCodes("package_over_limit, serving_over_limit").join(",") === "serving_over_limit,package_over_limit", "parse: canonical order");
  ok(parseServingLimitCodes("<script>,serving_over_limit,x").join(",") === "serving_over_limit", "parse: unknown dropped");
  ok(parseServingLimitCodes(undefined).length === 0 && parseServingLimitCodes(["serving_over_limit"]).length === 0, "parse: non-string");
  ok(servingLimitBannerText([]) === null, "banner null when clean");
  const b1 = servingLimitBannerText(["serving_over_limit"]) ?? "";
  ok(b1.includes("more than 10 mg THC per serving (WAC 314-55-095(1)(a))") && !b1.includes("(1)(b)"), "banner serving only");
  const b2 = servingLimitBannerText(["serving_over_limit", "package_over_limit"]) ?? "";
  ok(b2.includes(" and more than 100 mg THC in the package (WAC 314-55-095(1)(b))") && b2.startsWith("Saved - but"), "banner both");
  ok(limitCategoryFromForm(" Edible-Solid ") === "edible-solid", "category hint normalised");
  ok(limitCategoryFromForm("flower; drop") === null && limitCategoryFromForm(7) === null && limitCategoryFromForm("") === null, "category hint junk -> unknown (checked)");

  return { passed, failed };
}
