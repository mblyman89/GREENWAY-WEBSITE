/**
 * Vitest mirror of the menu-columns-core pure self-tests (USAGE-2).
 *
 * Locks the Supabase-egress fixes on the 6 MB published-menu read path:
 *  - the hot menu loaders select EXPLICIT column lists (never `select("*")`),
 *    so `fact_provenance` (jsonb) and `summary_json` (jsonb) stop riding
 *    every full-menu read;
 *  - the register's product-image endpoint fetches ONE row instead of
 *    loading the whole menu and `.find()`ing it;
 *  - media uploads carry a one-year Cache-Control (keys are content-hashed).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  MENU_ITEM_COLUMNS,
  MENU_ITEM_COLUMN_LIST,
  MENU_ITEM_DROPPED_COLUMNS,
  MENU_VARIANT_COLUMNS,
  MENU_VARIANT_COLUMN_LIST,
  MENU_VERSION_DROPPED_COLUMNS,
  MENU_VERSION_LIGHT_COLUMNS,
  MENU_VERSION_LIGHT_COLUMN_LIST,
  isMenuItemColumnFetched,
  __runMenuColumnsCoreTests,
} from "@/lib/pos/menu-columns-core";

const read = (rel: string) => readFileSync(path.resolve(__dirname, "../..", rel), "utf8");

/** Body of a top-level `export async function NAME(` up to the next top-level export. */
function fnBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  expect(start, `${name} not found`).toBeGreaterThanOrEqual(0);
  const rest = source.slice(start + 1);
  const next = rest.search(/\n(export |\/\*\*\n \* [A-Z])/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("menu-columns-core", () => {
  it("passes its embedded pure self-tests", () => {
    expect(() => __runMenuColumnsCoreTests()).not.toThrow();
  });

  it("renders comma-separated column lists that never contain a wildcard", () => {
    for (const list of [MENU_ITEM_COLUMNS, MENU_VARIANT_COLUMNS, MENU_VERSION_LIGHT_COLUMNS]) {
      expect(list).not.toContain("*");
      expect(list).toMatch(/^[a-z_]+(, [a-z_]+)+$/);
    }
    expect(MENU_ITEM_COLUMNS.split(", ")).toEqual([...MENU_ITEM_COLUMN_LIST]);
    expect(MENU_VARIANT_COLUMNS.split(", ")).toEqual([...MENU_VARIANT_COLUMN_LIST]);
    expect(MENU_VERSION_LIGHT_COLUMNS.split(", ")).toEqual([...MENU_VERSION_LIGHT_COLUMN_LIST]);
  });

  it("drops exactly the heavy jsonb columns and nothing the site or the money needs", () => {
    // S04: identity_key / kb_product_id (0234) are optional MenuItemRow
    // fields that must NOT be fetched, or the menu read fails pre-migration.
    expect(MENU_ITEM_DROPPED_COLUMNS).toEqual(["fact_provenance", "identity_key", "kb_product_id"]);
    expect(isMenuItemColumnFetched("identity_key")).toBe(false);
    expect(isMenuItemColumnFetched("kb_product_id")).toBe(false);
    expect(MENU_VERSION_DROPPED_COLUMNS).toEqual(["summary_json"]);
    expect(isMenuItemColumnFetched("fact_provenance")).toBe(false);
    expect(MENU_VERSION_LIGHT_COLUMN_LIST).not.toContain("summary_json");
    // Money + display + gating columns the public menu, carts and the
    // register all read — every one must still be fetched.
    for (const col of [
      "id",
      "source_item_id",
      "name",
      "brand_name",
      "vendor_name",
      "category",
      "filter_categories",
      "price_minor_units",
      "hidden",
      "thc",
      "cbd",
      "pos_inventory_type",
      "pos_inventory_category",
      "strain_type",
    ]) {
      expect(isMenuItemColumnFetched(col), `${col} must be fetched`).toBe(true);
    }
    for (const col of ["id", "menu_item_id", "price_minor_units", "sort_order"]) {
      expect(MENU_VARIANT_COLUMN_LIST, `${col} must be fetched`).toContain(col);
    }
    for (const col of ["id", "published_at", "item_count", "variant_count", "vendor_count"]) {
      expect(MENU_VERSION_LIGHT_COLUMN_LIST, `${col} must be fetched`).toContain(col);
    }
  });

  it("is wired into the pure selftest runner so CI cannot skip it", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain("__runMenuColumnsCoreTests");
    expect(runner).toMatch(/__runMenuColumnsCoreTests\(\);/);
  });

  it("the hot menu loaders in menu-version.ts use the column lists, not select(\"*\")", () => {
    const src = read("src/lib/pos/menu-version.ts");
    expect(src).toContain('from "@/lib/pos/menu-columns-core"');

    const published = fnBody(src, "getPublishedVersion");
    expect(published).toContain(".select(MENU_VERSION_LIGHT_COLUMNS)");
    expect(published).not.toContain('select("*")');
    // The light row is widened back to MenuVersion with summary_json: null
    // so the (unchanged) return type is honest about what was fetched.
    expect(published).toContain("summary_json: null");

    const items = fnBody(src, "getVersionItems");
    expect(items).toContain(".select(MENU_ITEM_COLUMNS)");
    expect(items).toContain(".select(MENU_VARIANT_COLUMNS)");
    expect(items).not.toContain('select("*")');

    const one = fnBody(src, "getItemBySourceKey");
    expect(one).toContain(".select(MENU_ITEM_COLUMNS)");
    expect(one).toContain(".select(MENU_VARIANT_COLUMNS)");
    expect(one).not.toContain('select("*")');
  });

  it("live-menu exposes a single-row lookup that mirrors the list path's conversion", () => {
    const src = read("src/lib/pos/live-menu.ts");
    expect(src).toContain("export async function getLiveMenuItemByIdDirect(");
    // The list-based lookup stays (public path + policy test pin it).
    expect(src).toContain("export async function getLiveMenuItemById(");
    const direct = fnBody(src, "getLiveMenuItemByIdDirect");
    expect(direct).toContain("getPublishedVersion()");
    expect(direct).toContain("getItemBySourceKey(version.id, id)");
    expect(direct).toContain("row.hidden");
    expect(direct).toContain("withCardIdentity([menuRowToGreenwayItem(row)])");
    expect(direct).not.toContain("loadLiveMenuAll");
    expect(direct).not.toContain("loadLiveMenuItems");
    expect(direct).not.toContain("unstable_cache");
  });

  it("the register product-image route fetches one row, not the whole menu", () => {
    const route = read("src/app/api/pos/product-image/route.ts");
    expect(route).toContain('import { getLiveMenuItemByIdDirect } from "@/lib/pos/live-menu"');
    expect(route).toMatch(/await getLiveMenuItemByIdDirect\(productId\)/);
    expect(route).not.toMatch(/\bgetLiveMenuItemById\(/);
    expect(route).not.toContain("loadLiveMenuAll");
    expect(route).not.toContain("loadLiveMenuItems");
    // Still read-through — the register never caches.
    expect(route).not.toContain("Cached(");
  });

  it("media uploads pin a one-year Cache-Control on content-hashed keys", () => {
    const store = read("src/lib/media/store.ts");
    expect(store).toContain('export const MEDIA_UPLOAD_CACHE_CONTROL_SECONDS = "31536000"');
    expect(store).toMatch(
      /\.upload\(storageKey, input\.buffer, \{[^}]*cacheControl: MEDIA_UPLOAD_CACHE_CONTROL_SECONDS[^}]*\}\)/,
    );
    // The key really is content-addressed (sha256 prefix), so a long TTL is safe.
    expect(store).toMatch(/createHash\("sha256"\)/);
    expect(store).toMatch(/\$\{hash\.slice\(0, 16\)\}/);
  });
});
