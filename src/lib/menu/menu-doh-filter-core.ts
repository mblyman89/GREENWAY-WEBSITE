/**
 * SLICE E (SHOP-5): the pure logic behind the Shop sidebar's dynamic **DOH**
 * filter. Built on the `dohCompliant` / `dohCategory` flag threaded onto every
 * public menu item in SLICE D (see menu-doh-core.ts / menu-doh-server.ts).
 *
 * The filter is DYNAMIC and HONEST: options only exist for states that are
 * actually present in the live menu, so with an empty medical registry (the
 * pre-migration / unconfigured default) NOTHING renders here — no dead
 * checkbox promising DOH products that don't exist yet.
 *
 * This module is PURE (no "server-only", no DB, no React) so the client browser
 * (InteractiveMenuBrowser), the server, and vitest all share ONE matcher —
 * exactly the split we used for menu-special-filters-core and menu-doh-core.
 */
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import {
  DOH_CATEGORIES,
  DOH_CATEGORY_LABELS,
  isDohCategory,
  type DohCategory,
} from "@/lib/medical/medical-sale-core";
import { isItemDohCompliant } from "@/lib/menu/menu-doh-core";

/** The stable id of the built-in "any DOH-compliant product" lane. */
export const DOH_FILTER_ALL_ID = "doh";

/** Prefix for the per-category lane ids (e.g. "doh:high_thc"). */
export const DOH_FILTER_CATEGORY_PREFIX = "doh:";

/**
 * One selectable DOH filter option. `category` is null for the umbrella "DOH
 * Compliant" lane and a specific WAC 246-70 category for the per-lane options.
 * `count` is how many CURRENTLY-eligible items match (drives the honest,
 * data-driven render — an option with count 0 is never surfaced).
 */
export type DohFilterOption = {
  id: string;
  label: string;
  /** null = the umbrella "any DOH-compliant" lane. */
  category: DohCategory | null;
  count: number;
};

/** The umbrella lane's human label (kept here so the UI never hardcodes it). */
export const DOH_FILTER_ALL_LABEL = "DOH Compliant";

/** Build the per-category lane id for a category. */
export function dohFilterCategoryId(category: DohCategory): string {
  return `${DOH_FILTER_CATEGORY_PREFIX}${category}`;
}

/**
 * Parse a per-category lane id back to its category (null for the umbrella lane
 * or any unrecognized id). Defensive: never throws.
 */
export function dohFilterCategoryFromId(id: string | null | undefined): DohCategory | null {
  if (!id || !id.startsWith(DOH_FILTER_CATEGORY_PREFIX)) return null;
  const raw = id.slice(DOH_FILTER_CATEGORY_PREFIX.length);
  return isDohCategory(raw) ? raw : null;
}

/**
 * Derive the DOH filter options from the live menu items. Returns:
 *   - the umbrella "DOH Compliant" lane (count = all compliant items), THEN
 *   - one lane per DOH category that has at least one compliant item, in the
 *     canonical DOH_CATEGORIES order (General Use, High THC, High CBD).
 * Returns an EMPTY array when no item is DOH-compliant — the honest empty
 * state, so the sidebar section simply does not appear.
 */
export function resolveDohFilterOptions(items: readonly GreenwayMenuItem[]): DohFilterOption[] {
  let compliantTotal = 0;
  const perCategory = new Map<DohCategory, number>();

  for (const item of items) {
    if (!isItemDohCompliant(item)) continue;
    compliantTotal += 1;
    const category = item.dohCategory;
    if (category && isDohCategory(category)) {
      perCategory.set(category, (perCategory.get(category) ?? 0) + 1);
    }
  }

  if (compliantTotal === 0) return [];

  const options: DohFilterOption[] = [
    { id: DOH_FILTER_ALL_ID, label: DOH_FILTER_ALL_LABEL, category: null, count: compliantTotal },
  ];

  for (const category of DOH_CATEGORIES) {
    const count = perCategory.get(category) ?? 0;
    // Only surface a per-category lane when it actually has items AND it is a
    // proper subset (skip a lone category that trivially equals the umbrella,
    // which would be a redundant duplicate checkbox).
    if (count > 0 && count < compliantTotal) {
      options.push({
        id: dohFilterCategoryId(category),
        label: DOH_CATEGORY_LABELS[category],
        category,
        count,
      });
    }
  }

  return options;
}

/**
 * True when `item` passes the active DOH filter. A null/blank active id means
 * "no DOH filter applied" (everything passes). The umbrella lane keeps any
 * DOH-compliant item; a per-category lane keeps only items in that category.
 */
export function itemMatchesDohFilter(
  item: Pick<GreenwayMenuItem, "dohCompliant" | "dohCategory">,
  activeDohId: string | null | undefined,
): boolean {
  const id = (activeDohId ?? "").trim();
  if (!id) return true;
  if (!isItemDohCompliant(item)) return false;
  if (id === DOH_FILTER_ALL_ID) return true;
  const category = dohFilterCategoryFromId(id);
  if (!category) return true; // unknown id → treat as the umbrella (safe)
  return item.dohCategory === category;
}

/** Look an option up by id (null when absent), for pill labels / validation. */
export function findDohFilterOption(
  options: readonly DohFilterOption[],
  id: string | null | undefined,
): DohFilterOption | null {
  const wanted = (id ?? "").trim();
  if (!wanted) return null;
  return options.find((o) => o.id === wanted) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure self-tests (throw on failure). Registered in the pure-selftest runner so
// the whole compliance battery guards this matcher — same convention as
// menu-doh-core and menu-special-filters-core.
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

export function __runMenuDohFilterCoreTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`menu-doh-filter-core self-test failed: ${msg}`);
    passed += 1;
  };

  // Empty / no-compliant → no options at all (honest empty state).
  ok(resolveDohFilterOptions([]).length === 0, "empty items → no options");
  ok(
    resolveDohFilterOptions([testItem({ id: "a", dohCompliant: false, dohCategory: null })]).length === 0,
    "no compliant items → no options",
  );

  // A single category present → umbrella only (per-category would be redundant).
  {
    const opts = resolveDohFilterOptions([
      testItem({ id: "a", dohCompliant: true, dohCategory: "high_thc" }),
      testItem({ id: "b", dohCompliant: true, dohCategory: "high_thc" }),
    ]);
    ok(opts.length === 1, "single category → umbrella only (no redundant lane)");
    ok(opts[0].id === DOH_FILTER_ALL_ID && opts[0].count === 2, "umbrella counts all compliant");
    ok(opts[0].category === null, "umbrella has null category");
  }

  // Mixed categories → umbrella + one lane per present category, canonical order.
  {
    const opts = resolveDohFilterOptions([
      testItem({ id: "a", dohCompliant: true, dohCategory: "high_cbd" }),
      testItem({ id: "b", dohCompliant: true, dohCategory: "high_thc" }),
      testItem({ id: "c", dohCompliant: true, dohCategory: "general_use" }),
      testItem({ id: "d", dohCompliant: true, dohCategory: "high_thc" }),
      testItem({ id: "e", dohCompliant: false, dohCategory: null }),
    ]);
    ok(opts[0].id === DOH_FILTER_ALL_ID && opts[0].count === 4, "umbrella = 4 compliant (ignores non-compliant)");
    const ids = opts.map((o) => o.id);
    // canonical DOH order: general_use, high_thc, high_cbd
    ok(
      ids.join("|") ===
        [DOH_FILTER_ALL_ID, "doh:general_use", "doh:high_thc", "doh:high_cbd"].join("|"),
      "options in umbrella + canonical category order",
    );
    const thc = opts.find((o) => o.id === "doh:high_thc");
    ok(!!thc && thc.count === 2 && thc.label === DOH_CATEGORY_LABELS.high_thc, "per-category count + label");
  }

  // Matcher: null/blank id → everything passes.
  ok(itemMatchesDohFilter(testItem({ id: "a", dohCompliant: false, dohCategory: null }), null), "null id passes all");
  ok(itemMatchesDohFilter(testItem({ id: "a", dohCompliant: false, dohCategory: null }), "  "), "blank id passes all");

  // Matcher: umbrella keeps any compliant, drops non-compliant.
  ok(
    itemMatchesDohFilter(testItem({ id: "a", dohCompliant: true, dohCategory: "high_thc" }), DOH_FILTER_ALL_ID),
    "umbrella keeps compliant",
  );
  ok(
    !itemMatchesDohFilter(testItem({ id: "a", dohCompliant: false, dohCategory: null }), DOH_FILTER_ALL_ID),
    "umbrella drops non-compliant",
  );

  // Matcher: per-category keeps only that category.
  ok(
    itemMatchesDohFilter(testItem({ id: "a", dohCompliant: true, dohCategory: "high_cbd" }), "doh:high_cbd"),
    "category lane keeps matching category",
  );
  ok(
    !itemMatchesDohFilter(testItem({ id: "a", dohCompliant: true, dohCategory: "high_thc" }), "doh:high_cbd"),
    "category lane drops other category",
  );

  // id parsing round-trips + defends against junk.
  ok(dohFilterCategoryFromId("doh:general_use") === "general_use", "parse category id");
  ok(dohFilterCategoryFromId(DOH_FILTER_ALL_ID) === null, "umbrella id → null category");
  ok(dohFilterCategoryFromId("doh:nonsense") === null, "junk category id → null");
  ok(dohFilterCategoryId("high_thc") === "doh:high_thc", "build category id");

  // findDohFilterOption
  {
    const opts = resolveDohFilterOptions([
      testItem({ id: "a", dohCompliant: true, dohCategory: "high_thc" }),
      testItem({ id: "b", dohCompliant: true, dohCategory: "general_use" }),
    ]);
    ok(findDohFilterOption(opts, DOH_FILTER_ALL_ID)?.category === null, "find umbrella");
    ok(findDohFilterOption(opts, "doh:high_thc")?.category === "high_thc", "find category lane");
    ok(findDohFilterOption(opts, "nope") === null, "find missing → null");
    ok(findDohFilterOption(opts, null) === null, "find null → null");
  }

  return { passed };
}
