/**
 * menu-facets-core.ts — R49 S1 (owner: Michael)
 *
 * OWNER'S ASK: "please change the strains section title to say 'strain types'
 * … Then, please add a 'strains' section with all the strains on the menu."
 *
 * The existing "Strains" facet was always strain TYPES (indica / sativa /
 * hybrid … + the high-CBD lane); its `?strains=` URL param is pinned by tests
 * and linked from the Medical page, so it stays the TYPE param and is only
 * re-titled. This module powers the NEW strain-NAME facet (`?strainNames=`).
 *
 * WHICH ITEMS CONTRIBUTE A STRAIN NAME (measured, not assumed):
 * On the live menu (2026-10-12) `strainName` on edibles/drinks holds the
 * FLAVOR ("Raspberry Peach", "Sugar-Free Coffee", "Concord Grape"), not a
 * cultivar. Listing those under "Strains" would mislead shoppers, so only the
 * strain-bearing (inhalable) categories contribute. Non-cannabis rows never do.
 *
 * NORMALISATION: whitespace collapsed, and a trailing single-letter type
 * marker that some vendors append — "Granddaddy Purple (I)", "Cromagnum (H)",
 * "Rat Girl OG (S)" — is dropped so it merges with the same strain sold
 * without the marker. Matching is case-insensitive; the label shown is the
 * first spelling seen (stable because the menu order is stable).
 *
 * Pure; self-tests via __runMenuFacetsCoreTests().
 */

/** Categories whose `strainName` is a cultivar (not a flavor). */
export const STRAIN_NAME_CATEGORIES: ReadonlySet<string> = new Set([
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

type StrainNameInput = { category: string; strainName?: string | null };

/** Clean a raw strain name for display/matching, or null when blank. */
export function cleanStrainName(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const collapsed = raw.replace(/\s+/g, " ").trim();
  const withoutMarker = collapsed.replace(/\s*\((?:i|h|s)\)$/i, "").trim();
  return withoutMarker || null;
}

/** Case-insensitive matching key for a strain name. */
export function strainNameKey(name: string): string {
  return name.toLowerCase();
}

/** The item's facet strain name, or null when it does not contribute. */
export function itemStrainName(item: StrainNameInput): string | null {
  if (!STRAIN_NAME_CATEGORIES.has(item.category)) return null;
  return cleanStrainName(item.strainName);
}

/** True when the item matches ANY selected strain name (OR, like other facets). */
export function matchesStrainNameSelection(item: StrainNameInput, selected: readonly string[]): boolean {
  if (selected.length === 0) return true;
  const name = itemStrainName(item);
  if (!name) return false;
  const key = strainNameKey(name);
  return selected.some((s) => strainNameKey(s) === key);
}

export type FacetOption = { value: string; label: string; count: number };

/**
 * Options for the strain-name facet: one per distinct name (case-insensitive),
 * A→Z, with counts; selected names with zero matches are kept (count 0) so a
 * shopper can always un-tick what they ticked.
 */
export function buildStrainNameOptions(items: readonly StrainNameInput[], selected: readonly string[] = []): FacetOption[] {
  const byKey = new Map<string, FacetOption>();
  for (const item of items) {
    const name = itemStrainName(item);
    if (!name) continue;
    const key = strainNameKey(name);
    const existing = byKey.get(key);
    if (existing) existing.count += 1;
    else byKey.set(key, { value: name, label: name, count: 1 });
  }
  for (const s of selected) {
    const key = strainNameKey(s);
    if (!byKey.has(key)) byKey.set(key, { value: s, label: s, count: 0 });
  }
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

export function __runMenuFacetsCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`menu-facets-core FAIL: ${name}`);
    }
  };
  ok(cleanStrainName("Granddaddy Purple (I)") === "Granddaddy Purple", "drops (I) marker");
  ok(cleanStrainName("Cromagnum (H)") === "Cromagnum", "drops (H) marker");
  ok(cleanStrainName("Rat Girl OG (s)") === "Rat Girl OG", "drops (s) marker case-insensitive");
  ok(cleanStrainName("  Gelato   33 ") === "Gelato 33", "collapses whitespace");
  ok(cleanStrainName("Something (Indica)") === "Something (Indica)", "keeps longer parentheticals");
  ok(cleanStrainName("") === null && cleanStrainName(null) === null && cleanStrainName("   ") === null, "blank -> null");
  ok(itemStrainName({ category: "flower", strainName: "Runtz" }) === "Runtz", "flower contributes");
  ok(itemStrainName({ category: "edible-solid", strainName: "Raspberry Peach" }) === null, "edible flavor excluded");
  ok(itemStrainName({ category: "edible-liquid", strainName: "Spiced Apple" }) === null, "drink flavor excluded");
  ok(itemStrainName({ category: "accessories", strainName: "X" }) === null, "non-cannabis excluded");
  const items = [
    { category: "flower", strainName: "Hash Burger" },
    { category: "preroll", strainName: "hash burger" },
    { category: "concentrate", strainName: "Granddaddy Purple (I)" },
    { category: "flower", strainName: "Granddaddy Purple" },
    { category: "edible-solid", strainName: "Concord Grape" },
    { category: "flower" },
  ];
  const opts = buildStrainNameOptions(items);
  ok(opts.length === 2, "two distinct strains");
  ok(opts[0].label === "Granddaddy Purple" && opts[0].count === 2, "GDP merged across marker");
  ok(opts[1].label === "Hash Burger" && opts[1].count === 2, "case-insensitive merge, first spelling kept");
  const withSel = buildStrainNameOptions(items, ["Zkittlez"]);
  ok(withSel.some((o) => o.value === "Zkittlez" && o.count === 0), "selected-but-absent kept with 0");
  ok(matchesStrainNameSelection(items[1], ["HASH BURGER"]), "match is case-insensitive");
  ok(matchesStrainNameSelection(items[2], ["Granddaddy Purple"]), "match ignores marker");
  ok(!matchesStrainNameSelection(items[4], ["Concord Grape"]), "edible never matches a strain");
  ok(matchesStrainNameSelection(items[4], []), "empty selection matches all");
  return { passed, failed };
}
