/**
 * POS Slice B40 — register favorites (pure core).
 *
 * Square's "Favorites" page / Shopify POS's smart grid: the budtender pins
 * the store's best-sellers to a tile page so the top ~20 products are one
 * tap away instead of a search. Design decisions:
 *
 *  - PER DEVICE, in localStorage. Each register keeps its own pins (the
 *    drive-thru window sells different things than the main counter) and the
 *    feature works fully offline — no migration, no server round-trip, in
 *    keeping with the offline-first PWA.
 *  - Pins are VARIANT ids (the sellable unit — same key the cart uses), and
 *    they are resolved against the CURRENT menu bundle on every render, in
 *    pinned order. A product that leaves the menu simply stops showing; it
 *    never renders a stale price or a phantom tile. Prices/stock always come
 *    from the live bundle, never from the stored pin.
 *  - Versioned envelope + REAL validation on parse (register-polish-core
 *    pattern): a corrupted blob yields [], never a crash at the register.
 *
 * Pure: no I/O — the shell owns localStorage. Self-tested below (registered
 * in scripts/compliance/run-pure-selftests.ts) and mirrored in vitest.
 */

import type { PosMenuProduct } from "./sale-flow-core";

/** localStorage key (single source of truth — the shell imports this). */
export const FAVORITES_KEY = "gw-pos-favorites";

/**
 * Cap on pins. A favorites page loses its point past ~2 screens of tiles —
 * and a bounded list keeps the stored blob tiny.
 */
export const MAX_FAVORITES = 24;

/** Stored envelope so future shape changes can be versioned. */
type StoredFavorites = { v: 1; ids: string[] };

/** Serialize pins for localStorage. */
export function serializeFavorites(ids: string[]): string {
  const stored: StoredFavorites = { v: 1, ids: sanitizeIds(ids) };
  return JSON.stringify(stored);
}

/**
 * Parse persisted pins; [] on ANY corruption (never a crash at the register).
 * Dedupes and re-caps defensively — the blob is user-storage, not trusted.
 */
export function parseFavorites(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Partial<StoredFavorites>;
    if (parsed?.v !== 1 || !Array.isArray(parsed.ids)) return [];
    return sanitizeIds(parsed.ids as unknown[]);
  } catch {
    return [];
  }
}

/** Dedupe, drop non-strings/blanks, cap — shared by serialize + parse. */
function sanitizeIds(ids: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string") continue;
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= MAX_FAVORITES) break;
  }
  return out;
}

/**
 * Toggle a pin. Removing always works; adding is a no-op at the cap (the UI
 * tells the user the page is full rather than silently evicting a pin).
 * Returns a NEW array (React state identity).
 */
export function toggleFavorite(ids: string[], variantId: string): string[] {
  const id = variantId.trim();
  if (!id) return ids.slice();
  if (ids.includes(id)) return ids.filter((x) => x !== id);
  if (ids.length >= MAX_FAVORITES) return ids.slice();
  return [...ids, id];
}

/**
 * Resolve pins against the CURRENT menu, in pinned order. Ids that no longer
 * match a menu entry are skipped — a delisted product never shows a stale
 * tile. Duplicate variantIds in the menu (shouldn't happen) resolve to the
 * first occurrence.
 */
export function favoriteProducts(products: PosMenuProduct[], ids: string[]): PosMenuProduct[] {
  if (ids.length === 0) return [];
  const byVariant = new Map<string, PosMenuProduct>();
  for (const p of products) {
    if (!byVariant.has(p.variantId)) byVariant.set(p.variantId, p);
  }
  const out: PosMenuProduct[] = [];
  for (const id of ids) {
    const hit = byVariant.get(id);
    if (hit) out.push(hit);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runFavoritesCoreTests(): void {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      failures.push(name);
    }
  };

  const product = (variantId: string, name = variantId): PosMenuProduct => ({
    productId: `prod-${variantId}`,
    variantId,
    name,
    brand: null,
    category: "flower",
    categories: ["flower"],
    variantLabel: null,
    regularPriceMinor: 1000,
    costMinorUnits: null,
    inventoryStatus: "in-stock",
  });

  // Toggle behavior.
  ok(toggleFavorite([], "v1").join(",") === "v1", "toggle adds to empty");
  ok(toggleFavorite(["v1"], "v2").join(",") === "v1,v2", "toggle appends (pin order kept)");
  ok(toggleFavorite(["v1", "v2"], "v1").join(",") === "v2", "toggle removes existing");
  ok(toggleFavorite(["v1"], "").join(",") === "v1", "blank id is a no-op");
  ok(toggleFavorite(["v1"], "  ").join(",") === "v1", "whitespace id is a no-op");
  const atCap = Array.from({ length: MAX_FAVORITES }, (_, i) => `v${i}`);
  ok(toggleFavorite(atCap, "extra").length === MAX_FAVORITES, "add at cap is a no-op");
  ok(toggleFavorite(atCap, "v3").length === MAX_FAVORITES - 1, "remove at cap still works");
  const before = ["v1"];
  const after = toggleFavorite(before, "v2");
  ok(after !== before && before.length === 1, "toggle returns a new array (no mutation)");

  // Serialize / parse round-trip.
  ok(parseFavorites(serializeFavorites(["v1", "v2"])).join(",") === "v1,v2", "round-trip keeps order");
  ok(parseFavorites(null).length === 0, "null -> []");
  ok(parseFavorites(undefined).length === 0, "undefined -> []");
  ok(parseFavorites("").length === 0, "empty string -> []");
  ok(parseFavorites("not json{").length === 0, "corrupt JSON -> []");
  ok(parseFavorites('{"v":2,"ids":["v1"]}').length === 0, "unknown version -> []");
  ok(parseFavorites('{"v":1,"ids":"v1"}').length === 0, "non-array ids -> []");
  ok(parseFavorites('{"v":1,"ids":["v1",5,null,"","v1"," v2 "]}').join(",") === "v1,v2", "parse sanitizes: non-strings, blanks, dupes dropped, ids trimmed");
  const overCap = JSON.stringify({ v: 1, ids: Array.from({ length: MAX_FAVORITES + 10 }, (_, i) => `v${i}`) });
  ok(parseFavorites(overCap).length === MAX_FAVORITES, "parse re-caps oversized blob");

  // Menu resolution.
  const menu = [product("v1", "Blue Dream"), product("v2", "OG Kush"), product("v3", "Gelato")];
  ok(favoriteProducts(menu, []).length === 0, "no pins -> empty page");
  ok(
    favoriteProducts(menu, ["v3", "v1"]).map((p) => p.variantId).join(",") === "v3,v1",
    "resolution follows PIN order, not menu order",
  );
  ok(favoriteProducts(menu, ["v-gone", "v2"]).map((p) => p.variantId).join(",") === "v2", "delisted pin silently skipped");
  ok(favoriteProducts([], ["v1"]).length === 0, "empty menu -> empty page");
  const dupMenu = [product("v1", "first"), { ...product("v1", "second") }];
  ok(favoriteProducts(dupMenu, ["v1"])[0]?.name === "first", "duplicate menu variantId resolves to first occurrence");

  console.log(`favorites-core: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    throw new Error(`favorites-core self-tests failed: ${failures.join("; ")}`);
  }
}
