/**
 * SLICE D (SHOP-4) — the pure model that threads the DOH-compliant flag onto
 * the public menu item.
 *
 * Michael's directive: "the doh compliant flag onto the public menu." A product
 * is DOH-compliant when the store has VERIFIED it (from the DOH logo on the
 * physical packaging) and recorded it in the durable medical_product_registry
 * (migration 0113) — keyed by the STABLE POS product key (= the public item's
 * `id` = menu_items.source_item_id), so the verification survives every menu
 * re-import. That registry is ALSO what the medical checkout uses to zero the
 * sales/excise tax, so the public badge and the register agree by construction
 * (single source of truth — never guessed, never a second list).
 *
 * This module is PURE (no "server-only", no DB, no React) so the client card,
 * the server page, the future DOH sidebar filter (Slice E), the badge (Slice
 * F), and vitest all share ONE overlay + one set of labels. The server side
 * (menu-doh-server.ts) does the graceful DB read and hands us a plain
 * Map<id, DohCategory>; everything else is decided here.
 *
 * Above & beyond (Michael: "add value however you can"): we carry BOTH the
 * boolean AND the DOH 246-70 category (general_use / high_thc / high_cbd) —
 * the category is free from the same registry read and Slices E/F need it to
 * label the filter/badge honestly (e.g. "High CBD"), so threading it now keeps
 * those slices trivial and avoids a second DB round-trip later.
 */
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import {
  DOH_CATEGORY_HELP,
  DOH_CATEGORY_LABELS,
  isDohCategory,
  type DohCategory,
} from "@/lib/medical/medical-sale-core";

/** The DOH read result the server overlay hands the pure attacher. */
export type DohRegistryMap = ReadonlyMap<string, DohCategory>;

/**
 * The public, badge-ready DOH facts for a single item. `compliant` is the flag
 * the menu threads; `category` is the WAC 246-70 lane (null when the boolean is
 * false, so callers can trust `category` implies `compliant`).
 */
export type ItemDohInfo = {
  compliant: boolean;
  category: DohCategory | null;
};

/** The neutral, honest fact for an item that is NOT in the registry. */
export function emptyDohInfo(): ItemDohInfo {
  return { compliant: false, category: null };
}

/**
 * The DOH facts for one item, read from the registry map by the item's stable
 * id. An item is DOH-compliant iff it has a registry row; the row's category is
 * carried through. A blank/absent id or a missing row → not compliant.
 */
export function dohInfoForItem(
  item: Pick<GreenwayMenuItem, "id">,
  registry: DohRegistryMap,
): ItemDohInfo {
  const id = (item.id ?? "").trim();
  if (!id) return emptyDohInfo();
  const category = registry.get(id);
  if (!category || !isDohCategory(category)) return emptyDohInfo();
  return { compliant: true, category };
}

/**
 * Overlay `dohCompliant` + `dohCategory` onto every item from the registry map.
 * Pure and non-mutating (returns new objects). An empty map (the pre-migration
 * / unconfigured case the server overlay hands us) marks every item
 * not-compliant — exactly the honest default, no badge until a product is
 * actually verified.
 */
export function attachDohCompliance<T extends GreenwayMenuItem>(
  items: T[],
  registry: DohRegistryMap,
): T[] {
  if (registry.size === 0) {
    // Fast path: nothing verified — still normalize the fields so the shape is
    // consistent for every downstream consumer (no `undefined` surprises).
    return items.map((item) => ({ ...item, dohCompliant: false, dohCategory: null }));
  }
  return items.map((item) => {
    const info = dohInfoForItem(item, registry);
    return { ...item, dohCompliant: info.compliant, dohCategory: info.category };
  });
}

/** Human label for a DOH category (reused by the Slice E filter + Slice F badge). */
export function dohCategoryLabel(category: DohCategory | null | undefined): string | null {
  if (!category || !isDohCategory(category)) return null;
  return DOH_CATEGORY_LABELS[category];
}

/** One-line help/tooltip for a DOH category (statute-grounded, reused by E/F). */
export function dohCategoryHelp(category: DohCategory | null | undefined): string | null {
  if (!category || !isDohCategory(category)) return null;
  return DOH_CATEGORY_HELP[category];
}

/**
 * True when an already-enriched menu item is DOH-compliant. Trusts the threaded
 * boolean but stays honest if only the category slipped through (defensive).
 */
export function isItemDohCompliant(
  item: Pick<GreenwayMenuItem, "dohCompliant" | "dohCategory">,
): boolean {
  return item.dohCompliant === true || (item.dohCategory != null && isDohCategory(item.dohCategory));
}

// ────────────────────────────────────────────────────────────────────────────
// Pure self-tests (throw on failure). Registered in the pure-selftest runner so
// the whole battery guards this overlay, mirroring shop-carousel-core and
// menu-special-filters-core.
// ────────────────────────────────────────────────────────────────────────────

/** Minimal menu item factory for the self-tests. */
function testItem(over: Partial<GreenwayMenuItem> & { id: string }): GreenwayMenuItem {
  return {
    name: "Test Item",
    brand: "Test Brand",
    category: "flower",
    priceMinorUnits: 3000,
    ...over,
  } as GreenwayMenuItem;
}

export function __runMenuDohCoreTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`menu-doh-core: ${msg}`);
    passed += 1;
  };

  // emptyDohInfo.
  const empty = emptyDohInfo();
  ok(empty.compliant === false && empty.category === null, "emptyDohInfo is not-compliant/null");

  // dohInfoForItem.
  const reg: DohRegistryMap = new Map<string, DohCategory>([
    ["p-general", "general_use"],
    ["p-cbd", "high_cbd"],
    ["p-thc", "high_thc"],
  ]);
  ok(dohInfoForItem({ id: "p-general" }, reg).compliant === true, "registry hit is compliant");
  ok(dohInfoForItem({ id: "p-cbd" }, reg).category === "high_cbd", "category carried through");
  ok(dohInfoForItem({ id: "not-in-reg" }, reg).compliant === false, "registry miss is not compliant");
  ok(dohInfoForItem({ id: "  " }, reg).compliant === false, "blank id is not compliant");

  // attachDohCompliance — empty registry marks everything not-compliant.
  const items = [
    testItem({ id: "p-general" }),
    testItem({ id: "p-thc" }),
    testItem({ id: "plain" }),
  ];
  const none = attachDohCompliance(items, new Map());
  ok(none.every((i) => i.dohCompliant === false && i.dohCategory === null), "empty registry = no badges");
  ok(none[0] !== items[0], "attach is non-mutating (new objects)");
  ok((items[0] as { dohCompliant?: boolean }).dohCompliant === undefined, "source items untouched");

  // attachDohCompliance — real registry threads the flag + category.
  const attached = attachDohCompliance(items, reg);
  ok(attached[0].dohCompliant === true && attached[0].dohCategory === "general_use", "general_use threaded");
  ok(attached[1].dohCompliant === true && attached[1].dohCategory === "high_thc", "high_thc threaded");
  ok(attached[2].dohCompliant === false && attached[2].dohCategory === null, "unverified stays clean");

  // Labels + help (reused by Slices E/F).
  ok(dohCategoryLabel("high_cbd") === "High CBD", "dohCategoryLabel high_cbd");
  ok(dohCategoryLabel(null) === null, "dohCategoryLabel(null) is null");
  ok(dohCategoryLabel("bogus" as DohCategory) === null, "dohCategoryLabel rejects bad category");
  ok((dohCategoryHelp("general_use") ?? "").length > 0, "dohCategoryHelp general_use has text");
  ok(dohCategoryHelp(null) === null, "dohCategoryHelp(null) is null");

  // isItemDohCompliant.
  ok(isItemDohCompliant({ dohCompliant: true, dohCategory: null }) === true, "trusts the boolean");
  ok(isItemDohCompliant({ dohCompliant: false, dohCategory: "high_cbd" }) === true, "defensive on category");
  ok(isItemDohCompliant({ dohCompliant: false, dohCategory: null }) === false, "clean item is not compliant");

  return { passed };
}
