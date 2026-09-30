/**
 * src/lib/pos/cultivera-type-from-category-core.ts   (R14b — type from category)
 *
 * Owner, Round 14 (verbatim): "Things like fixing the types and categories,
 * which by the way, Cultivera uses the CCRS types for their type column, but
 * their category column closely matches our category column, so we will need
 * to reverse engineer the type based on the category. We know the type for all
 * categories, so we should be able to convert Cultivera's types into our type
 * convention."
 *
 * ═══ WHAT IS VERIFIED (not assumed) ═══
 *
 *   1. Cultivera's `Category` values ARE our type vocabulary: every label in
 *      INVENTORY_TYPE_CATALOG (inventory-type-catalog.ts) is a Cultivera
 *      Category, copied verbatim from transform.ts CATEGORY_MAP. So OUR type
 *      for a Cultivera row is simply its Category, when the catalog knows it.
 *   2. Cultivera's `InventoryType` column carries the CCRS/LCB product type
 *      ("Usable Marijuana", "Concentrate for Inhalation", "Solid Edible",
 *      "Liquid Edible", "Tincture", "Topical Ointment"). Measured on the
 *      repo's real export (back-office/GREENWAY WEBSITE/transformer/inputs/
 *      INVENTORIES.xlsx, 3,917 rows): every Category has ONE majority CCRS
 *      type, and that majority is exactly what EXPECTED_CCRS_BY_WEBSITE_
 *      CATEGORY below derives from the category's website family. A vitest
 *      re-reads the workbook and proves it for every category.
 *   3. The minority rows are Cultivera data errors in ONE of the two columns
 *      (measured: Infused Pre-roll typed Usable Marijuana ×85, Cartridge typed
 *      Usable Marijuana ×8, Edible typed Usable Marijuana ×5, Panda Candies —
 *      a pre-roll — typed Usable Marijuana ×1, Tincture typed Topical
 *      Ointment ×1 …). The CCRS type matters on our side: it decides mg vs %
 *      potency (MG_FACT_TYPES, fact-extraction-core.ts:49; transform.ts
 *      cannabinoidUnitForInventoryType) and the CCRS report type
 *      (ccrs-batch.ts: deriveCcrsClassificationFromType).
 *
 * ═══ THE VERDICT (suggest only — Rule 3.1, owner rule E1) ═══
 *
 *   agree            the CCRS type is one the category allows.
 *   type_mismatch    the category (and the name, when it speaks) says one CCRS
 *                    type; Cultivera's type column says another. The category
 *                    is the column the owner trusts, so the TYPE is the
 *                    suspect. The CCRS value is never rewritten here (E1:
 *                    CCRS/LCB values stay verbatim) — the fix is in Cultivera,
 *                    and the next upload carries it.
 *   category_suspect the product NAME and the CCRS type agree with each other
 *                    and BOTH disagree with the category (e.g. a pre-roll filed
 *                    under "Panda Candies"). Two witnesses against one, so the
 *                    CATEGORY is the suspect; the suggestion is our own type +
 *                    website category from the name, applied only when a human
 *                    presses "Re-file" (product_classification_overrides).
 *   unknown_category the catalog does not know the category (measured on the
 *                    owner's upload: "Dab Rig" ×43, "Cured Resin Cartridge"
 *                    ×13). A suggestion is offered from a closed keyword list
 *                    (paraphernalia per WAC 314-55-010(34)) or the house-type
 *                    name rules read against the category text, then the
 *                    product name.
 *   no_category      Cultivera sent no category — nothing to reverse-engineer.
 *
 * A category whose family has no measured CCRS type (Trim: zero rows in the
 * export) has NO expectation and is never flagged — no witness, no verdict.
 *
 * PURE: no I/O. Registered in scripts/compliance/run-pure-selftests.ts.
 */
import { INVENTORY_TYPE_CATALOG, inventoryTypeKey } from "@/lib/pos/inventory-type-catalog";
import { HOUSE_TYPE_NAME_RULES } from "@/lib/inventory/house-type-core";
import { MG_FACT_TYPES } from "@/lib/inventory/fact-extraction-core";

/** The six CCRS product types Cultivera's InventoryType column carries (measured). */
export const CCRS_UM = "Usable Marijuana";
export const CCRS_CFI = "Concentrate for Inhalation";
export const CCRS_SE = "Solid Edible";
export const CCRS_LE = "Liquid Edible";
export const CCRS_TINCTURE = "Tincture";
export const CCRS_TO = "Topical Ointment";

/**
 * Website family → the CCRS type(s) its products carry. The FIRST entry is the
 * one suggested; later entries are also accepted. Grounded as follows:
 *   - majority per category in the measured export (see header, point 2);
 *   - "Usable Cannabis" is the v2023+ spelling of "Usable Marijuana"
 *     (CCRS_LEGACY_TYPE_ALIASES, ccrs-batch-core.ts:284) — both accepted;
 *   - "Capsule" is its own CCRS EndProduct type (CCRS_INVENTORY_TYPES,
 *     ccrs-batch-core.ts:245) while Cultivera exported capsules as Solid
 *     Edible (7 of 7) — both accepted for the edible family.
 */
export const EXPECTED_CCRS_BY_WEBSITE_CATEGORY: Readonly<Record<string, readonly string[]>> = {
  flower: [CCRS_UM, "Usable Cannabis"],
  "popcorn-bud": [CCRS_UM, "Usable Cannabis"],
  preroll: [CCRS_UM, "Usable Cannabis"],
  "infused-preroll": [CCRS_CFI],
  "infused-flower": [CCRS_CFI],
  cartridge: [CCRS_CFI],
  "disposable-cartridge": [CCRS_CFI],
  concentrate: [CCRS_CFI],
  "edible-solid": [CCRS_SE, "Capsule"],
  "edible-liquid": [CCRS_LE],
  topical: [CCRS_TO],
};

/**
 * Category-level exceptions to the family rule, each measured: Tincture is
 * filed on the website under edible-liquid (catalog) but Cultivera's CCRS type
 * for it is "Tincture" (31 of 32 rows).
 */
export const EXPECTED_CCRS_BY_CATEGORY_EXCEPTION: Readonly<Record<string, readonly string[]>> = {
  tincture: [CCRS_TINCTURE],
};

/**
 * Closed keyword list for categories the catalog does not know. Each entry is
 * a statute-grounded placement, never a guess:
 *   paraphernalia — WAC 314-55-010(34): "Paraphernalia" means items used for
 *   the storage or use of cannabis, such as lighters, roach clips, pipes,
 *   rolling papers, bongs, and storage containers. A dab rig is a water pipe.
 */
export const UNKNOWN_CATEGORY_KEYWORDS: ReadonlyArray<{ re: RegExp; websiteCategory: string; why: string }> = [
  {
    re: /\b(?:dab\s*rigs?|rigs?|bongs?|pipes?|bubblers?|grinders?|lighters?|papers?|rolling|roach\s*clips?|trays?|stash|storage|batter(?:y|ies)|torch(?:es)?|nectar\s*collectors?|glass)\b/i,
    websiteCategory: "paraphernalia",
    why: "WAC 314-55-010(34) lists pipes, bongs, rolling papers, lighters and storage containers as paraphernalia.",
  },
];

export type CultiveraTypeVerdict = "agree" | "type_mismatch" | "category_suspect" | "unknown_category" | "no_category";

export type TypeSuggestion = {
  /** A catalog type label ("Pre-roll") or null when only a website family is known. */
  houseType: string | null;
  /** A website category value ("preroll", "paraphernalia"). */
  websiteCategory: string;
  /** Plain-English reason, shown on screen. */
  why: string;
};

export type CultiveraTypeAssessment = {
  verdict: CultiveraTypeVerdict;
  /** OUR type: the catalog label for the Cultivera category, or null when unknown. */
  ourType: string | null;
  /** OUR website category for the Cultivera category, or null when unknown. */
  websiteCategory: string | null;
  /** The CCRS type the category implies (first accepted), or null when none is measured. */
  expectedCcrsType: string | null;
  /** Cultivera's own CCRS type column, trimmed ("" when blank). */
  actualCcrsType: string;
  /** For category_suspect / unknown_category: what to re-file it as. */
  suggestion: TypeSuggestion | null;
};

/**
 * Product FORM per website family. A name only contradicts a category when it
 * names a DIFFERENT form: "Pre-Rolls" is the generic label of an infused
 * pre-roll, so a name silent about infusion is no witness against "Infused
 * Pre-roll" (measured: 13 "Trichome InTERPreter Pre-Rolls" filed as Infused
 * Pre-roll, and "Walden infused flower" under Moon Rocks, whose name rule is
 * plain Flower). Grouping follows the catalog's own families
 * (inventory-type-catalog.ts) and transform.ts's cross-listing (popcorn /
 * infused flower → flower; packs → singles).
 */
export const FORM_OF_WEBSITE_CATEGORY: Readonly<Record<string, string>> = {
  flower: "flower",
  "popcorn-bud": "flower",
  "infused-flower": "flower",
  trim: "flower",
  preroll: "preroll",
  "infused-preroll": "preroll",
  cartridge: "vape",
  "disposable-cartridge": "vape",
  concentrate: "concentrate",
  "edible-solid": "edible-solid",
  "edible-liquid": "edible-liquid",
  topical: "topical",
};

const CATALOG = new Map(INVENTORY_TYPE_CATALOG.map((e) => [inventoryTypeKey(e.label), e] as const));
const CATEGORY_OF_LABEL = new Map(INVENTORY_TYPE_CATALOG.map((e) => [e.label, e.websiteCategory] as const));

function norm(s: string | null | undefined): string {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** The accepted CCRS types for a catalog label (exception first, then family). Empty = no expectation. */
export function acceptedCcrsTypesFor(label: string): readonly string[] {
  const key = inventoryTypeKey(label);
  const exception = EXPECTED_CCRS_BY_CATEGORY_EXCEPTION[key];
  if (exception) return exception;
  const entry = CATALOG.get(key);
  if (!entry) return [];
  return EXPECTED_CCRS_BY_WEBSITE_CATEGORY[entry.websiteCategory] ?? [];
}

/** Every CCRS type accepted by any website family of one product form. */
export function acceptedCcrsTypesForForm(form: string): readonly string[] {
  const out: string[] = [];
  for (const [family, f] of Object.entries(FORM_OF_WEBSITE_CATEGORY)) {
    if (f !== form) continue;
    for (const t of EXPECTED_CCRS_BY_WEBSITE_CATEGORY[family] ?? []) if (!out.includes(t)) out.push(t);
  }
  return out;
}

function accepts(types: readonly string[], actual: string): boolean {
  const a = norm(actual);
  return a !== "" && types.some((t) => norm(t) === a);
}

/** Every catalog label the name rules find in `text` (all matches, rule order). */
export function nameLabels(text: string | null | undefined): string[] {
  const t = String(text ?? "").trim();
  if (!t) return [];
  const out: string[] = [];
  for (const rule of HOUSE_TYPE_NAME_RULES) if (rule.re.test(t) && !out.includes(rule.label)) out.push(rule.label);
  return out;
}

/** Suggest a placement for a category the catalog does not know. Null = no grounded suggestion. */
export function suggestForUnknownCategory(category: string, productName?: string | null): TypeSuggestion | null {
  for (const k of UNKNOWN_CATEGORY_KEYWORDS) {
    if (k.re.test(category)) return { houseType: null, websiteCategory: k.websiteCategory, why: k.why };
  }
  const fromCategory = nameLabels(category)[0];
  if (fromCategory) {
    return {
      houseType: fromCategory,
      websiteCategory: CATEGORY_OF_LABEL.get(fromCategory) ?? "",
      why: `The category name itself contains "${fromCategory}".`,
    };
  }
  const fromName = nameLabels(productName)[0];
  if (fromName) {
    return {
      houseType: fromName,
      websiteCategory: CATEGORY_OF_LABEL.get(fromName) ?? "",
      why: `The product name reads as "${fromName}".`,
    };
  }
  return null;
}

/** Assess ONE Cultivera row. Pure and deterministic. */
export function assessCultiveraType(input: {
  category: string | null | undefined;
  inventoryType: string | null | undefined;
  productName?: string | null;
}): CultiveraTypeAssessment {
  const category = String(input.category ?? "").trim().replace(/\s+/g, " ");
  const actual = String(input.inventoryType ?? "").trim();
  const base = { actualCcrsType: actual };
  if (!category) {
    return { ...base, verdict: "no_category", ourType: null, websiteCategory: null, expectedCcrsType: null, suggestion: null };
  }
  const entry = CATALOG.get(inventoryTypeKey(category));
  if (!entry) {
    return {
      ...base,
      verdict: "unknown_category",
      ourType: null,
      websiteCategory: null,
      expectedCcrsType: null,
      suggestion: suggestForUnknownCategory(category, input.productName),
    };
  }
  const accepted = acceptedCcrsTypesFor(entry.label);
  const known = { ourType: entry.label, websiteCategory: entry.websiteCategory, expectedCcrsType: accepted[0] ?? null };
  // No measured expectation (Trim) or the type fits → agree.
  if (accepted.length === 0 || accepts(accepted, actual)) {
    return { ...base, ...known, verdict: "agree", suggestion: null };
  }
  // The type does not fit the category. Read the NAME as a second witness.
  // The name rules are FIRST-match-wins (house-type-core.ts), so the name's
  // reading is its FIRST label. Any label that supports the category vetoes a
  // suspect verdict (conservative: two strong witnesses or none).
  const all = nameLabels(input.productName);
  const nameSupportsCategory =
    all.includes(entry.label) || all.some((l) => accepts(acceptedCcrsTypesFor(l), accepted[0]));
  const categoryForm = FORM_OF_WEBSITE_CATEGORY[entry.websiteCategory];
  if (!nameSupportsCategory && all.length > 0) {
    const first = all[0];
    const firstForm = FORM_OF_WEBSITE_CATEGORY[CATEGORY_OF_LABEL.get(first) ?? ""];
    // A different FORM is required (a less specific label is not a contradiction).
    const differentForm = Boolean(firstForm && categoryForm && firstForm !== categoryForm);
    // The CCRS type is a second witness when it belongs to the NAME's form
    // (e.g. Usable Marijuana is a pre-roll-form type, so it backs an
    // "Infused Pre-roll" name against a Roll On category).
    const agreeing = differentForm && firstForm && accepts(acceptedCcrsTypesForForm(firstForm), actual) ? first : null;
    if (agreeing) {
      return {
        ...base,
        ...known,
        verdict: "category_suspect",
        suggestion: {
          houseType: agreeing,
          websiteCategory: CATEGORY_OF_LABEL.get(agreeing) ?? entry.websiteCategory,
          why: `The name reads as "${agreeing}" and Cultivera's type (${actual}) fits that; only the category says ${entry.label}.`,
        },
      };
    }
  }
  return { ...base, ...known, verdict: "type_mismatch", suggestion: null };
}

// ─── the import-page report ───────────────────────────────────────────────

export type TypeCheckItem = {
  sourceItemId: string;
  name: string;
  productName?: string | null;
  category: string | null;
  inventoryType: string | null;
};

export type TypeCheckRow = { sourceItemId: string; name: string; suggestion: TypeSuggestion | null };

export type TypeCheckGroup = {
  /** Stable key: verdict|category|actual type. */
  key: string;
  verdict: Exclude<CultiveraTypeVerdict, "agree" | "no_category">;
  category: string;
  ourType: string | null;
  websiteCategory: string | null;
  actualCcrsType: string;
  expectedCcrsType: string | null;
  count: number;
  /** Group-level suggestion (unknown categories: from the category text). */
  suggestion: TypeSuggestion | null;
  /** The first `rowLimit` products, each with its own suggestion. */
  rows: TypeCheckRow[];
};

export type TypeCheckReport = {
  checked: number;
  agree: number;
  noCategory: number;
  flagged: number;
  groups: TypeCheckGroup[];
};

const VERDICT_ORDER: Record<TypeCheckGroup["verdict"], number> = { category_suspect: 0, unknown_category: 1, type_mismatch: 2 };

/** Group every flagged row; biggest groups first within each verdict. */
export function buildTypeCheckReport(items: readonly TypeCheckItem[], rowLimit = 25): TypeCheckReport {
  const groups = new Map<string, TypeCheckGroup>();
  let agree = 0;
  let noCategory = 0;
  for (const it of items) {
    const a = assessCultiveraType({
      category: it.category,
      inventoryType: it.inventoryType,
      productName: it.productName || it.name,
    });
    if (a.verdict === "agree") { agree += 1; continue; }
    if (a.verdict === "no_category") { noCategory += 1; continue; }
    const category = String(it.category ?? "").trim().replace(/\s+/g, " ");
    const key = `${a.verdict}|${category}|${a.actualCcrsType}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        verdict: a.verdict,
        category,
        ourType: a.ourType,
        websiteCategory: a.websiteCategory,
        actualCcrsType: a.actualCcrsType,
        expectedCcrsType: a.expectedCcrsType,
        count: 0,
        suggestion: a.verdict === "unknown_category" ? suggestForUnknownCategory(category) : null,
        rows: [],
      };
      groups.set(key, g);
    }
    g.count += 1;
    if (g.rows.length < rowLimit) g.rows.push({ sourceItemId: it.sourceItemId, name: it.name, suggestion: a.suggestion });
  }
  const list = [...groups.values()].sort(
    (x, y) => VERDICT_ORDER[x.verdict] - VERDICT_ORDER[y.verdict] || y.count - x.count || x.key.localeCompare(y.key),
  );
  const flagged = list.reduce((n, g) => n + g.count, 0);
  return { checked: items.length, agree, noCategory, flagged, groups: list };
}

/** "mg" for the CCRS types dosed in milligrams (MG_FACT_TYPES), else "%". */
export function potencyUnitForCcrsType(ccrsType: string): "mg" | "%" {
  return MG_FACT_TYPES.has(String(ccrsType ?? "").trim().replace(/\s+/g, " ")) ? "mg" : "%";
}

/** True when the expected and actual CCRS types display potency in different units. */
export function ccrsUnitsDiffer(expected: string | null, actual: string): boolean {
  if (!expected) return false;
  return potencyUnitForCcrsType(expected) !== potencyUnitForCcrsType(actual);
}

/** Plain-English "what to do" for a group. */
export function typeCheckAdvice(g: Pick<TypeCheckGroup, "verdict" | "category" | "ourType" | "actualCcrsType" | "expectedCcrsType">): string {
  if (g.verdict === "type_mismatch") {
    const actual = g.actualCcrsType || "blank";
    const unitNote = ccrsUnitsDiffer(g.expectedCcrsType, g.actualCcrsType)
      ? ` Until then their potency shows in ${potencyUnitForCcrsType(g.actualCcrsType)} instead of ${potencyUnitForCcrsType(g.expectedCcrsType ?? "")}, because the CCRS type decides mg vs %.`
      : "";
    return `Our type is already ${g.ourType ?? g.category} (from the category). Cultivera's CCRS type says ${actual} but a ${g.category} is ${g.expectedCcrsType}. The CCRS type is never rewritten here — it is the regulator's value and goes on the CCRS report — so correct it in Cultivera and upload again.${unitNote}`;
  }
  if (g.verdict === "category_suspect") {
    return "The product name and Cultivera's CCRS type agree with each other and not with the category. Re-file each one below as the suggested type (it moves on the live menu and in the back office at once), and fix the category in Cultivera.";
  }
  return `"${g.category}" is not one of our types yet. Add it on the Types page with the suggested website category, and ask Cultivera to use a standard category name.`;
}

// ─── the one-click re-file (import page) ─────────────────────────────────────

/** Anchor of the import page's Type & category check (NOT in IMPORT_PAGE_ANCHORS, which is pinned). */
export const TYPE_CHECK_ANCHOR = "type-check";

/** The audit action a type-check re-file records. */
export const TYPE_CHECK_REFILE_AUDIT = "menu_import.type_check_refiled";

/** Where the re-file returns: the import page, the check open, with a plain message. */
export function typeCheckReturnHref(importId: string, message: string, isError = false): string {
  return `/admin/menu-imports/${encodeURIComponent(importId)}?${isError ? "error" : "refiled"}=${encodeURIComponent(message)}#${TYPE_CHECK_ANCHOR}`;
}

export type TypeCheckRefileParse =
  | { ok: true; websiteCategory: string; houseType: string | null }
  | { ok: false; error: string };

/**
 * Validate a "Re-file as …" press against the LIVE registries (closed
 * vocabularies — never free text). The website category is required; the
 * house type is optional, must be a registry label, and when it is a catalog
 * label its catalog website category must equal the chosen one (a Pre-roll
 * filed under topical is refused, not saved).
 */
export function parseTypeCheckRefile(
  raw: { website_category?: string | null; house_type?: string | null },
  registries: { validCategoryValues: readonly string[]; validTypeLabels: readonly string[] },
): TypeCheckRefileParse {
  const websiteCategory = String(raw.website_category ?? "").trim();
  const houseTypeRaw = String(raw.house_type ?? "").trim();
  if (!websiteCategory) return { ok: false, error: "Pick a website category to re-file this product under." };
  if (!registries.validCategoryValues.includes(websiteCategory)) {
    return { ok: false, error: `"${websiteCategory}" is not an active website category.` };
  }
  if (!houseTypeRaw) return { ok: true, websiteCategory, houseType: null };
  const label = registries.validTypeLabels.find((l) => inventoryTypeKey(l) === inventoryTypeKey(houseTypeRaw));
  if (!label) return { ok: false, error: `"${houseTypeRaw}" is not one of your product types.` };
  const catalogCategory = CATALOG.get(inventoryTypeKey(label))?.websiteCategory;
  if (catalogCategory && catalogCategory !== websiteCategory) {
    return { ok: false, error: `${label} belongs under ${catalogCategory}, not ${websiteCategory}.` };
  }
  return { ok: true, websiteCategory, houseType: label };
}

// ─── self-tests ───────────────────────────────────────────────────────────

export function __runCultiveraTypeFromCategoryCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  ✗ cultivera-type-from-category-core: ${name}`);
    }
  };
  const A = (category: string | null, inventoryType: string | null, productName?: string) =>
    assessCultiveraType({ category, inventoryType, productName });

  // Every catalog label resolves; every family except trim has an expectation.
  for (const e of INVENTORY_TYPE_CATALOG) {
    const acc = acceptedCcrsTypesFor(e.label);
    if (e.websiteCategory === "trim") ok(acc.length === 0, `${e.label}: no measured expectation`);
    else ok(acc.length > 0, `${e.label}: has an expected CCRS type`);
  }
  // Measured majorities (INVENTORIES.xlsx), spot-pinned here; the vitest checks all.
  ok(A("Flower", CCRS_UM).verdict === "agree", "flower UM agrees");
  ok(A("Flower", "Usable Cannabis").verdict === "agree", "modern spelling accepted");
  ok(A("Flower", " usable  marijuana ").verdict === "agree", "case/space-insensitive");
  ok(A("Cartridge", CCRS_CFI).verdict === "agree", "cartridge CfI agrees");
  ok(A("Tincture", CCRS_TINCTURE).verdict === "agree", "tincture exception agrees");
  ok(A("Tincture", CCRS_LE).verdict === "type_mismatch", "tincture LE is not accepted (exception replaces family)");
  ok(A("Capsule", "Capsule").verdict === "agree" && A("Capsule", CCRS_SE).verdict === "agree", "capsule both");
  ok(A("Topical", CCRS_TO).verdict === "agree", "topical agrees");
  ok(A("Beverage", CCRS_LE).verdict === "agree", "beverage agrees");
  ok(A("Trim", CCRS_CFI).verdict === "agree", "trim: no witness → never flagged");
  ok(A("Flower", CCRS_UM).ourType === "Flower" && A("Flower", CCRS_UM).websiteCategory === "flower", "our type = category");
  ok(A(" live  resin ", CCRS_CFI).ourType === "Live Resin", "category normalised");

  // type_mismatch: the category is trusted; the name supports it or is silent.
  const cart = A("Cartridge", CCRS_UM, "Blue Dream Cart 1g");
  ok(cart.verdict === "type_mismatch" && cart.expectedCcrsType === CCRS_CFI && cart.actualCcrsType === CCRS_UM, "cart typed UM → type mismatch");
  ok(cart.suggestion === null, "type mismatch never suggests a re-file");
  ok(A("Infused Pre-roll", CCRS_UM, "Hellavated Diamond Joint 1g").verdict === "type_mismatch", "infused joint with diamonds → name supports category");
  ok(A("Infused Pre-roll", CCRS_UM, "Mystery 1g").verdict === "type_mismatch", "silent name → type mismatch");
  ok(A("Infused Pre-roll", CCRS_UM, "Sunset Infused Pre-Roll").verdict === "type_mismatch", "name matches the category label itself");
  ok(A("Edible", CCRS_UM, "Doozies 10pk").verdict === "type_mismatch", "edible typed UM");
  ok(A("Flower", "", "OG").verdict === "type_mismatch" && A("Flower", "", "OG").actualCcrsType === "", "blank type → mismatch");

  // category_suspect: name + type agree against the category.
  const panda = A("Panda Candies", CCRS_UM, "ThunderChief Pre-roll 1g");
  ok(panda.verdict === "category_suspect", "pre-roll under Panda Candies → category suspect");
  ok(panda.suggestion?.houseType === "Pre-roll" && panda.suggestion.websiteCategory === "preroll", "suggest Pre-roll / preroll");
  ok(panda.suggestion?.why.includes("Panda Candies") === true, "why names the category");
  ok(panda.ourType === "Panda Candies", "ourType still reports the category");
  const rollOn = A("Roll On", CCRS_UM, "Canna Organix Infused Pre-roll");
  ok(rollOn.verdict === "category_suspect" && rollOn.suggestion?.houseType === "Infused Pre-roll", "infused pre-roll under Roll On typed UM (a pre-roll-form type) → suspect, measured case");
  ok(acceptedCcrsTypesForForm("preroll").join() === [CCRS_UM, "Usable Cannabis", CCRS_CFI].join(), "pre-roll form types");
  ok(acceptedCcrsTypesForForm("nope").length === 0, "unknown form → none");
  ok(A("Roll On", CCRS_SE, "Canna Organix Infused Pre-roll").verdict === "type_mismatch", "a type outside the name's form → no suspect");
  ok(A("Roll On", CCRS_CFI, "Canna Organix Infused Pre-roll").verdict === "category_suspect", "…but typed CfI it is a suspect");
  ok(A("Roll On", CCRS_CFI, "Canna Organix Infused Pre-roll").suggestion?.houseType === "Infused Pre-roll", "suggest Infused Pre-roll");
  ok(A("Tincture", CCRS_TO, "4.20 Tincture").verdict === "type_mismatch", "tincture named tincture typed TO → type mismatch");
  // Same form, less specific name → NOT a category suspect (measured cases).
  ok(A("Infused Pre-roll", CCRS_UM, ".75g Trichome InTERPreter Pre-Rolls, 6pk").verdict === "type_mismatch", "generic pre-roll name under Infused Pre-roll → mismatch, not suspect");
  ok(A("Moon Rocks", CCRS_UM, "Walden infused flower super boof 1g").verdict === "type_mismatch", "infused flower name under Moon Rocks → mismatch");
  ok(A("Infused Blunt", CCRS_UM, "Seattle Bubble Works- Blunt Bomb - GMO (I) - 4g").verdict === "type_mismatch", "blunt name under Infused Blunt → mismatch");
  ok(A("Popcorn Bud", CCRS_CFI, "OG Flower").verdict === "type_mismatch", "flower name under popcorn (same form) → mismatch");
  ok(A("Edible", CCRS_CFI, "Blue Dream Cart").verdict === "category_suspect", "vape name + CfI under Edible → suspect (different form)");
  for (const c of Object.keys(EXPECTED_CCRS_BY_WEBSITE_CATEGORY)) ok(Boolean(FORM_OF_WEBSITE_CATEGORY[c]), `${c} has a form`);
  ok(Boolean(FORM_OF_WEBSITE_CATEGORY.trim), "trim has a form");

  // unknown_category.
  const dab = A("Dab Rig", "", "Glass Rig 8in");
  ok(dab.verdict === "unknown_category" && dab.suggestion?.websiteCategory === "paraphernalia", "dab rig → paraphernalia");
  ok(dab.suggestion?.why.includes("WAC 314-55-010(34)") === true, "paraphernalia cites the WAC");
  ok(dab.suggestion?.houseType === null && dab.ourType === null, "no invented house type");
  const cured = A("Cured Resin Cartridge", CCRS_CFI, "X");
  ok(cured.suggestion?.houseType === "Cartridge" && cured.suggestion.websiteCategory === "cartridge", "cured resin cartridge → Cartridge");
  ok(A("Mystery Thing", CCRS_SE, "Blue Gummies").suggestion?.houseType === "Gummies", "unknown category → name suggestion");
  ok(A("Mystery Thing", CCRS_SE, "Zzz").suggestion === null, "no grounded suggestion → null");
  ok(A(null, CCRS_UM).verdict === "no_category" && A("  ", CCRS_UM).verdict === "no_category", "blank category");
  ok(nameLabels("").length === 0 && nameLabels("Live Resin Cart")[0] === "Live Resin Cartridge", "name labels ordered");

  // Report.
  const rep = buildTypeCheckReport(
    [
      { sourceItemId: "a", name: "Cart A", category: "Cartridge", inventoryType: CCRS_UM },
      { sourceItemId: "b", name: "Cart B", category: "Cartridge", inventoryType: CCRS_UM },
      { sourceItemId: "c", name: "OG", category: "Flower", inventoryType: CCRS_UM },
      { sourceItemId: "d", name: "Rig", category: "Dab Rig", inventoryType: "" },
      { sourceItemId: "e", name: "TC", productName: "ThunderChief Pre-roll", category: "Panda Candies", inventoryType: CCRS_UM },
      { sourceItemId: "f", name: "X", category: null, inventoryType: CCRS_UM },
    ],
    1,
  );
  ok(rep.checked === 6 && rep.agree === 1 && rep.noCategory === 1 && rep.flagged === 4, "report totals reconcile");
  ok(rep.checked === rep.agree + rep.noCategory + rep.flagged, "checked = agree + none + flagged");
  ok(rep.groups.map((g) => g.verdict).join(",") === "category_suspect,unknown_category,type_mismatch", "verdict order");
  const cg = rep.groups.find((g) => g.verdict === "type_mismatch");
  ok(cg?.count === 2 && cg.rows.length === 1, "row limit caps rows, not the count");
  ok(rep.groups[0].rows[0].suggestion?.houseType === "Pre-roll", "row suggestion uses productName");
  ok(rep.groups[1].suggestion?.websiteCategory === "paraphernalia", "unknown group suggestion");
  ok(typeCheckAdvice(cg!).includes("correct it in Cultivera"), "mismatch advice → Cultivera");
  ok(typeCheckAdvice(cg!).includes("never rewritten"), "advice states E1");
  ok(!typeCheckAdvice(cg!).includes(" instead of "), "UM vs CfI: both % → no unit sentence");
  const edUm = { verdict: "type_mismatch" as const, category: "Edible", ourType: "Edible", actualCcrsType: CCRS_UM, expectedCcrsType: CCRS_SE };
  ok(typeCheckAdvice(edUm).includes("shows in % instead of mg"), "edible typed UM → % instead of mg");
  ok(potencyUnitForCcrsType(CCRS_SE) === "mg" && potencyUnitForCcrsType(CCRS_TO) === "mg" && potencyUnitForCcrsType(CCRS_UM) === "%", "unit per MG_FACT_TYPES");
  ok(!ccrsUnitsDiffer(null, CCRS_UM) && !ccrsUnitsDiffer(CCRS_TINCTURE, CCRS_TO) && ccrsUnitsDiffer(CCRS_LE, CCRS_CFI), "unit difference");
  ok(A("Infused Pre-roll", CCRS_UM, "Hellavated Diamond Joint 1g").verdict !== "category_suspect", "a supporting later label vetoes suspect");
  ok(typeCheckAdvice(rep.groups[0]).includes("Re-file"), "suspect advice → re-file");
  ok(typeCheckAdvice(rep.groups[1]).includes("Types page"), "unknown advice → Types page");

  // Re-file parse.
  const REG = { validCategoryValues: ["preroll", "topical", "paraphernalia"], validTypeLabels: ["Pre-roll", "Roll On", "My Custom"] };
  const r1 = parseTypeCheckRefile({ website_category: " preroll ", house_type: "pre-roll" }, REG);
  ok(r1.ok && r1.websiteCategory === "preroll" && r1.houseType === "Pre-roll", "refile: registry label, canonical casing");
  ok(!parseTypeCheckRefile({ website_category: "", house_type: "Pre-roll" }, REG).ok, "refile: category required");
  ok(!parseTypeCheckRefile({ website_category: "flower" }, REG).ok, "refile: inactive/unknown category refused");
  ok(!parseTypeCheckRefile({ website_category: "preroll", house_type: "Space Cake" }, REG).ok, "refile: unknown type refused");
  const r2 = parseTypeCheckRefile({ website_category: "topical", house_type: "Pre-roll" }, REG);
  ok(!r2.ok && r2.error.includes("belongs under preroll"), "refile: catalog contradiction refused");
  const r3 = parseTypeCheckRefile({ website_category: "paraphernalia", house_type: "" }, REG);
  ok(r3.ok && r3.houseType === null, "refile: category only");
  const r4 = parseTypeCheckRefile({ website_category: "topical", house_type: "My Custom" }, REG);
  ok(r4.ok && r4.houseType === "My Custom", "refile: custom registry type (no catalog entry) allowed");
  ok(typeCheckReturnHref("i 1", "Re-filed 1") === "/admin/menu-imports/i%201?refiled=Re-filed%201#type-check", "return href");
  ok(typeCheckReturnHref("i", "bad", true) === "/admin/menu-imports/i?error=bad#type-check", "error return href");
  return { passed, failed };
}
