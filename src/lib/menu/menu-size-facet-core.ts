/**
 * menu-size-facet-core.ts — R49 S2 (owner: Michael)
 *
 * OWNER'S ASK: "The weights section in the filter bar is empty when it should
 * show options there. There should be size options too if the menu has them,
 * like 1oz beverage, 12oz beverage. I can't think of any solid edibles that
 * would go in this category other than single serving and multi serving
 * packs, so let's just start there."
 *
 * ROOT CAUSE OF THE EMPTY WEIGHTS SECTION (measured on the live /menu payload,
 * 45 items, not assumed): live variant labels are "28 g", "1 g", "3.5 g",
 * "3.5 Grams", "28 Grams", "1 Grams", "50 g", "32.5 g" — a space and/or the
 * spelled unit. The old matcher compared against space-less tokens ("1g",
 * "3.5g" …) so ZERO labels matched and every count was 0.
 *
 * THE FIX re-uses the store's ONE weight-label parser
 * (compliance/weight-label-core `parseWeightLabelGrams`, the same parser the
 * discount and purchase-limit engines use) instead of inventing a fourth
 * regex. Grams become the canonical facet token ("3.5g", "28g"), so "28 g",
 * "28 Grams" and "1oz" all land in ONE bucket labelled "28 g (1 oz)". The
 * token for the classic sizes is unchanged ("1g", "3.5g", "7g", "14g",
 * "28g"), so old `?weights=1g` links keep working; a legacy `?weights=1oz`
 * is mapped onto "28g" by `normalizeWeightToken`.
 *
 * WHICH CATEGORIES FEED "WEIGHTS": only those where the package weight IS
 * the product (flower, pre-rolls, concentrates, carts …). A "50 g" gummy bag
 * or the "32.5 g" gross weight of a drink is not a shopping axis — those
 * items get a SIZE instead.
 *
 * SIZE:
 *   - Beverages / tinctures → fluid ounces from `netVolumeMl` (the SLICE L3
 *     authoritative package volume) or, failing that, an explicit volume
 *     label ("355ml", "12fl oz", "1L") via liquid-volume-core
 *     `volumeMlFromLabel` (which refuses bare "oz" — never invents density).
 *     Rounded to the nearest 0.5 fl oz so 29.5735 ml → "1 fl oz",
 *     355 ml → "12 fl oz".
 *   - Solid edibles → "Single serving" (1) / "Multi-serving pack" (>1) from
 *     `servingsPerPack`, else `unitsPerPackage`. Unknown → NOT bucketed
 *     (never guess).
 *
 * Pure; self-tests via __runMenuSizeFacetCoreTests().
 */

import { parseWeightLabelGrams } from "@/lib/compliance/weight-label-core";
import { ML_PER_FLUID_OUNCE, volumeMlFromLabel } from "@/lib/compliance/liquid-volume-core";

export type FacetOption = { value: string; label: string; count: number };

/** Categories whose package weight is the shopping axis. */
export const WEIGHT_FACET_CATEGORIES: ReadonlySet<string> = new Set([
  "flower",
  "popcorn-bud",
  "infused-flower",
  "trim",
  "preroll",
  "preroll-pack",
  "infused-preroll",
  "infused-preroll-pack",
  "blunt",
  "infused-blunt",
  "concentrate",
  "rso",
  "cartridge",
  "disposable-cartridge",
]);

/** Categories that get a beverage-style volume size. */
export const VOLUME_SIZE_CATEGORIES: ReadonlySet<string> = new Set(["edible-liquid", "tincture"]);

/** Categories that get a serving-pack size. */
export const SERVING_SIZE_CATEGORIES: ReadonlySet<string> = new Set(["edible-solid"]);

type SizeInput = {
  category: string;
  variants?: ReadonlyArray<{ label?: string | null }> | null;
  netVolumeMl?: number | null;
  servingsPerPack?: number | null;
  unitsPerPackage?: number | null;
};

function fmt(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/** Canonical gram token ("3.5g", "28g") for a variant label, or null. */
export function weightTokenForLabel(label: string | null | undefined): string | null {
  const grams = parseWeightLabelGrams(label);
  if (grams === null) return null;
  return `${fmt(grams)}g`;
}

/** Map a persisted/URL weight value onto the canonical token (legacy "1oz" → "28g"). */
export function normalizeWeightToken(value: string): string {
  const token = weightTokenForLabel(value);
  return token ?? value;
}

/** Grams for a canonical token, or null. */
export function gramsForWeightToken(token: string): number | null {
  const m = /^(\d+(?:\.\d+)?)g$/.exec(token);
  return m ? Number(m[1]) : null;
}

const OUNCE_FRACTIONS: ReadonlyArray<[number, string]> = [
  [3.5, "⅛ oz"],
  [7, "¼ oz"],
  [14, "½ oz"],
  [28, "1 oz"],
  [56, "2 oz"],
];

/** Shopper label for a weight token: "3.5 g (⅛ oz)", "28 g (1 oz)", "1 g". */
export function weightTokenLabel(token: string): string {
  const grams = gramsForWeightToken(token);
  if (grams === null) return token;
  const oz = OUNCE_FRACTIONS.find(([g]) => Math.abs(g - grams) < 0.001);
  return oz ? `${fmt(grams)} g (${oz[1]})` : `${fmt(grams)} g`;
}

/** Distinct canonical weight tokens for an item (empty for non-weight categories). */
export function itemWeightTokens(item: SizeInput): string[] {
  if (!WEIGHT_FACET_CATEGORIES.has(item.category)) return [];
  const out = new Set<string>();
  for (const variant of item.variants ?? []) {
    const token = weightTokenForLabel(variant?.label ?? null);
    if (token) out.add(token);
  }
  return [...out];
}

/** Fluid-ounce bucket (nearest 0.5, min 0.5) for a volume in ml. */
export function fluidOunceBucket(ml: number): number | null {
  if (!Number.isFinite(ml) || ml <= 0) return null;
  const bucket = Math.round((ml / ML_PER_FLUID_OUNCE) * 2) / 2;
  return bucket > 0 ? bucket : 0.5;
}

/** Distinct size tokens for an item: "floz:12", "serving:single", "serving:multi". */
export function itemSizeTokens(item: SizeInput): string[] {
  const out = new Set<string>();
  if (VOLUME_SIZE_CATEGORIES.has(item.category)) {
    const net = typeof item.netVolumeMl === "number" ? item.netVolumeMl : null;
    if (net !== null && net > 0) {
      const b = fluidOunceBucket(net);
      if (b !== null) out.add(`floz:${fmt(b)}`);
    } else {
      for (const variant of item.variants ?? []) {
        const ml = volumeMlFromLabel(variant?.label ?? null);
        const b = ml === null ? null : fluidOunceBucket(ml);
        if (b !== null) out.add(`floz:${fmt(b)}`);
      }
    }
  }
  if (SERVING_SIZE_CATEGORIES.has(item.category)) {
    const servings =
      typeof item.servingsPerPack === "number" && item.servingsPerPack > 0
        ? item.servingsPerPack
        : typeof item.unitsPerPackage === "number" && item.unitsPerPackage > 0
          ? item.unitsPerPackage
          : null;
    if (servings !== null) out.add(servings === 1 ? "serving:single" : "serving:multi");
  }
  return [...out];
}

/** Shopper label for a size token. */
export function sizeTokenLabel(token: string): string {
  if (token === "serving:single") return "Single serving";
  if (token === "serving:multi") return "Multi-serving pack";
  const m = /^floz:(\d+(?:\.\d+)?)$/.exec(token);
  if (m) return `${m[1]} fl oz beverage`;
  return token;
}

/** Sort key: volumes ascending first, then single, then multi. */
function sizeOrdinal(token: string): number {
  const m = /^floz:(\d+(?:\.\d+)?)$/.exec(token);
  if (m) return Number(m[1]);
  if (token === "serving:single") return 100000;
  if (token === "serving:multi") return 100001;
  return 200000;
}

function countTokens(lists: string[][]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const list of lists) for (const t of list) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
}

/** Weight options present in the pool (ascending grams); selected-but-absent kept at 0. */
export function buildWeightFacetOptions(items: ReadonlyArray<SizeInput>, selected: ReadonlyArray<string>): FacetOption[] {
  const counts = countTokens(items.map(itemWeightTokens));
  for (const s of selected) if (!counts.has(s)) counts.set(s, 0);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: weightTokenLabel(value), count }))
    .sort((a, b) => (gramsForWeightToken(a.value) ?? 1e9) - (gramsForWeightToken(b.value) ?? 1e9) || a.value.localeCompare(b.value));
}

/** Size options present in the pool; selected-but-absent kept at 0. */
export function buildSizeFacetOptions(items: ReadonlyArray<SizeInput>, selected: ReadonlyArray<string>): FacetOption[] {
  const counts = countTokens(items.map(itemSizeTokens));
  for (const s of selected) if (!counts.has(s)) counts.set(s, 0);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: sizeTokenLabel(value), count }))
    .sort((a, b) => sizeOrdinal(a.value) - sizeOrdinal(b.value) || a.value.localeCompare(b.value));
}

/** OR within the facet; empty selection matches everything. */
export function matchesWeightSelection(item: SizeInput, selected: ReadonlyArray<string>): boolean {
  if (selected.length === 0) return true;
  const tokens = itemWeightTokens(item);
  return selected.some((s) => tokens.includes(normalizeWeightToken(s)));
}

export function matchesSizeSelection(item: SizeInput, selected: ReadonlyArray<string>): boolean {
  if (selected.length === 0) return true;
  const tokens = itemSizeTokens(item);
  return selected.some((s) => tokens.includes(s));
}

// ---------------------------------------------------------------------------
// Self-tests (pure, tsx-runnable)
// ---------------------------------------------------------------------------

export function __runMenuSizeFacetCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`menu-size-facet-core FAIL: ${msg}`);
    }
  };

  // The live label shapes that made Weights empty.
  ok(weightTokenForLabel("28 g") === "28g", "'28 g' → 28g");
  ok(weightTokenForLabel("1 g") === "1g", "'1 g' → 1g");
  ok(weightTokenForLabel("3.5 g") === "3.5g", "'3.5 g' → 3.5g");
  ok(weightTokenForLabel("3.5 Grams") === "3.5g", "'3.5 Grams' → 3.5g");
  ok(weightTokenForLabel("28 Grams") === "28g", "'28 Grams' → 28g");
  ok(weightTokenForLabel("1 Grams") === "1g", "'1 Grams' → 1g");
  ok(weightTokenForLabel("1oz") === "28g", "'1oz' merges into 28g");
  ok(weightTokenForLabel("3.5g") === "3.5g", "space-less legacy token unchanged");
  ok(weightTokenForLabel("100mg") === null, "mg dose is not a weight");
  ok(weightTokenForLabel("12fl oz") === null, "fluid ounce is not a weight");
  ok(weightTokenForLabel("each") === null, "each is not a weight");
  ok(normalizeWeightToken("1oz") === "28g", "legacy ?weights=1oz maps to 28g");
  ok(normalizeWeightToken("1g") === "1g", "legacy ?weights=1g unchanged");

  ok(weightTokenLabel("28g") === "28 g (1 oz)", "28 g label");
  ok(weightTokenLabel("3.5g") === "3.5 g (⅛ oz)", "eighth label");
  ok(weightTokenLabel("1g") === "1 g", "gram label");

  const flower = { category: "flower", variants: [{ label: "3.5 g" }, { label: "28 Grams" }, { label: "1oz" }] };
  const gummy = { category: "edible-solid", variants: [{ label: "50 g" }], servingsPerPack: 10 };
  const single = { category: "edible-solid", variants: [{ label: "5 g" }], servingsPerPack: 1 };
  const unknownServ = { category: "edible-solid", variants: [{ label: "5 g" }] };
  const drink = { category: "edible-liquid", variants: [{ label: "32.5 g" }], netVolumeMl: 29.5735 };
  const can = { category: "edible-liquid", variants: [{ label: "355ml" }] };
  const bareOz = { category: "edible-liquid", variants: [{ label: "12oz" }] };

  const ft = itemWeightTokens(flower);
  ok(ft.length === 2 && ft.includes("3.5g") && ft.includes("28g"), "flower: 28 Grams + 1oz de-duplicated");
  ok(itemWeightTokens(gummy).length === 0, "edible pack weight is not a Weights option");
  ok(itemWeightTokens(drink).length === 0, "drink gross weight is not a Weights option");

  ok(itemSizeTokens(drink).join() === "floz:1", "29.5735 ml → 1 fl oz");
  ok(itemSizeTokens(can).join() === "floz:12", "355 ml label → 12 fl oz");
  ok(itemSizeTokens(bareOz).length === 0, "bare '12oz' refused (never invent density)");
  ok(itemSizeTokens(gummy).join() === "serving:multi", "10 servings → multi");
  ok(itemSizeTokens(single).join() === "serving:single", "1 serving → single");
  ok(itemSizeTokens(unknownServ).length === 0, "unknown servings not bucketed");
  ok(itemSizeTokens({ category: "edible-solid", unitsPerPackage: 1 }).join() === "serving:single", "unitsPerPackage fallback");
  ok(itemSizeTokens(flower).length === 0, "flower has no size");

  ok(sizeTokenLabel("floz:12") === "12 fl oz beverage", "volume label");
  ok(sizeTokenLabel("serving:multi") === "Multi-serving pack", "multi label");

  const wo = buildWeightFacetOptions([flower, flower, gummy], []);
  ok(wo.map((o) => o.value).join() === "3.5g,28g", "weight options ascending");
  ok(wo[1].count === 2, "weight count per item");
  const wSel = buildWeightFacetOptions([flower], ["7g"]);
  ok(wSel.some((o) => o.value === "7g" && o.count === 0), "selected-but-absent weight kept at 0");

  const so = buildSizeFacetOptions([drink, can, gummy, single], []);
  ok(so.map((o) => o.value).join() === "floz:1,floz:12,serving:single,serving:multi", "size option order");

  ok(matchesWeightSelection(flower, ["28g"]), "flower matches 28g");
  ok(matchesWeightSelection(flower, ["1oz"]), "flower matches legacy 1oz");
  ok(!matchesWeightSelection(gummy, ["28g"]), "gummy doesn't match a weight");
  ok(matchesWeightSelection(gummy, []), "empty selection matches all");
  ok(matchesSizeSelection(drink, ["floz:1", "floz:12"]), "OR within size");
  ok(!matchesSizeSelection(flower, ["floz:1"]), "flower excluded by size");

  return { passed, failed };
}
