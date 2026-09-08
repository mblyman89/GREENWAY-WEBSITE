/**
 * SLICE E — the shop page.
 *
 * Owner report after Slice D: "The home page loads instantly now. The shop menu
 * page is still very slow. I feel like it got a little worse somehow."
 *
 * The measured causes, and what this file locks down:
 *
 *   1. The menu cache entry was ~5.94 MB against Vercel's documented 2 MB Data
 *      Cache item limit, so every write was SILENTLY DROPPED and the cache
 *      never once hit. Fixed by storing the entry compressed (~204 KB).
 *   2. /menu read `searchParams` with no route config, which Next.js documents
 *      as opting the page into dynamic rendering at request time — it could
 *      never be reused. Fixed with `revalidate = 60`.
 *   3. The grid shipped fields no card renders.
 *
 * These tests assert BEHAVIOR (round-trips, size, fallbacks) and, where they
 * must read source, they assert the real argument rather than the mere presence
 * of an identifier — a lesson carried over from Slice D, where a mutation
 * survived because a test only checked that a constant appeared somewhere in
 * the file.
 */

import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DATA_CACHE_ITEM_LIMIT_BYTES,
  MENU_CACHE_ENCODED_LIMIT_BYTES,
  __runMenuCacheCodecTests,
  decodeMenuCacheEntry,
  encodeMenuCacheEntry,
} from "@/lib/menu/menu-cache-codec-core";
import {
  GRID_TRIMMED_FIELDS,
  __runMenuGridProjectionTests,
  toMenuGridItems,
} from "@/lib/menu/menu-grid-projection-core";
import { MENU_CACHE_TTL_SECONDS } from "@/lib/menu/menu-cache-policy-core";
import { PUBLIC_MENU_SURFACES } from "@/lib/site/public-surfaces";
import type { GreenwayMenuItem } from "@/lib/leafly/types";

const repoRoot = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

/**
 * Strip comments so a guard can never be satisfied by prose in a doc block.
 * (Slice D lesson: a constant named in a comment must not count as usage.)
 */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** A product roughly the size of a real one, with UNIQUE text per item. */
function makeItem(i: number): GreenwayMenuItem {
  return {
    id: `POS-KEY-${i}-0000-1111-2222`,
    name: `Product Name ${i} - Premium Cannabis Flower 3.5g`,
    brand: `Brand Name ${i % 120}`,
    vendor: `Vendor Company Name ${i % 90}`,
    category: "flower",
    strainType: "hybrid",
    strainName: `Strain Name ${i % 300}`,
    terpenes: ["myrcene", "limonene", "caryophyllene"],
    thc: "24.5",
    cbd: "0.12",
    totalThc: { name: "THC", value: 24.5, unit: "%" },
    totalCbd: { name: "CBD", value: 0.12, unit: "%" },
    compounds: [
      { name: "THC", value: 24.5, unit: "%" },
      { name: "CBD", value: 0.12, unit: "%" },
    ],
    description: `Unique storefront copy for product ${i}: aroma and appearance notes that vary by lot ${i * 7919}.`,
    priceLabel: "$45.00",
    priceMinorUnits: 4500,
    inventoryStatus: "in-stock",
    variants: [
      { id: `${i}-v1`, label: "1g", priceMinorUnits: 1500, inventoryLevel: 12, medical: false },
      { id: `${i}-v2`, label: "3.5g", priceMinorUnits: 4500, inventoryLevel: 8, medical: false },
    ],
    imageUrl: `https://example.test/media/product-${i}.webp`,
  } as unknown as GreenwayMenuItem;
}

describe("Slice E — the pure modules prove themselves", () => {
  it("cache codec self-tests all pass", () => {
    const { passed, failed } = __runMenuCacheCodecTests();
    expect(failed).toBe(0);
    expect(passed).toBeGreaterThan(0);
  });

  it("grid projection self-tests all pass", () => {
    const { passed, failed } = __runMenuGridProjectionTests();
    expect(failed).toBe(0);
    expect(passed).toBeGreaterThan(0);
  });
});

describe("Slice E — the cache entry fits under Vercel's 2 MB item limit", () => {
  it("guards against the vendor-documented limit, not an invented one", () => {
    expect(DATA_CACHE_ITEM_LIMIT_BYTES).toBe(2 * 1024 * 1024);
    expect(MENU_CACHE_ENCODED_LIMIT_BYTES).toBe(DATA_CACHE_ITEM_LIMIT_BYTES);
  });

  it("THE BUG: a full 4,500-product menu is far too large to cache uncompressed", () => {
    const items = Array.from({ length: 4500 }, (_, i) => makeItem(i));
    const raw = Buffer.byteLength(JSON.stringify(items), "utf8");
    // This is the regression that made Slice A do nothing. If this ever stops
    // being true the compression layer is no longer load-bearing, and someone
    // should re-derive the decision rather than assume it still holds.
    expect(raw).toBeGreaterThan(DATA_CACHE_ITEM_LIMIT_BYTES);
  });

  it("THE FIX: the same menu, encoded, fits with room to spare", () => {
    const items = Array.from({ length: 4500 }, (_, i) => makeItem(i));
    const envelope = encodeMenuCacheEntry(items);
    expect(envelope).not.toBeNull();
    const encodedBytes = Buffer.byteLength(envelope!.z, "utf8");
    expect(encodedBytes).toBeLessThan(DATA_CACHE_ITEM_LIMIT_BYTES);
    // Not merely "under" — comfortably under, so growth does not silently
    // reintroduce the bug.
    expect(encodedBytes).toBeLessThan(DATA_CACHE_ITEM_LIMIT_BYTES / 2);
  });

  it("round-trips a full-size menu with byte-for-byte fidelity", () => {
    const items = Array.from({ length: 4500 }, (_, i) => makeItem(i));
    const back = decodeMenuCacheEntry<GreenwayMenuItem>(encodeMenuCacheEntry(items));
    expect(back).not.toBeNull();
    expect(back!.length).toBe(items.length);
    expect(JSON.stringify(back)).toBe(JSON.stringify(items));
  });

  it("preserves order exactly — the menu is an ordered list", () => {
    const items = Array.from({ length: 500 }, (_, i) => makeItem(i));
    const back = decodeMenuCacheEntry<GreenwayMenuItem>(encodeMenuCacheEntry(items))!;
    expect(back.map((r) => r.id)).toEqual(items.map((r) => r.id));
  });

  it("preserves prices and variants — a cached wrong price is unacceptable", () => {
    const items = Array.from({ length: 200 }, (_, i) => makeItem(i));
    const back = decodeMenuCacheEntry<GreenwayMenuItem>(encodeMenuCacheEntry(items))!;
    for (let i = 0; i < items.length; i += 1) {
      expect(back[i]!.priceMinorUnits).toBe(items[i]!.priceMinorUnits);
      expect(back[i]!.priceLabel).toBe(items[i]!.priceLabel);
      expect(back[i]!.variants).toEqual(items[i]!.variants);
    }
  });

  it("refuses to write an entry that would still be dropped", () => {
    // Incompressible payload (random strings) large enough to exceed the limit
    // EVEN AFTER gzip. The codec must return null so the caller can skip the
    // write rather than issue one that vanishes silently.
    //
    // The size here is measured, not guessed: at 60,000 random rows the encoded
    // entry is ~1.20 MB (still under the limit, correctly accepted); 200,000
    // rows encode to ~3.98 MB, which is comfortably over.
    const incompressible = Array.from({ length: 200000 }, () => ({
      k: Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
    }));
    expect(encodeMenuCacheEntry(incompressible)).toBeNull();
  });
});

describe("Slice E — a cache problem degrades to slow, never to broken", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "not-an-envelope"],
    ["a number", 42],
    ["an array", [1, 2, 3]],
    ["an empty object", {}],
    ["a wrong version", { v: 99, z: "x", n: 0 }],
    ["a non-string payload", { v: 1, z: 123, n: 0 }],
    ["corrupt gzip", { v: 1, z: "!!!!not-gzip!!!!", n: 1 }],
  ])("treats %s as a miss instead of throwing", (_label, input) => {
    expect(() => decodeMenuCacheEntry(input)).not.toThrow();
    expect(decodeMenuCacheEntry(input)).toBeNull();
  });

  it("rejects an entry written by a DIFFERENT format version", () => {
    // Found by mutation testing: deleting the version check let this pass.
    // This is the real deploy scenario — an entry written by the previous
    // format is still warm in the cache when new code ships. It must be
    // treated as a miss and re-read, never parsed under the wrong assumptions.
    const items = [{ id: "a" }, { id: "b" }];
    const valid = encodeMenuCacheEntry(items)!;
    const staleFormat = { ...valid, v: 2 as unknown as 1 };
    expect(decodeMenuCacheEntry(staleFormat)).toBeNull();
    // ...and the current version still decodes, so the check is not simply
    // rejecting everything.
    expect(decodeMenuCacheEntry(valid)).toEqual(items);
  });

  it("rejects an envelope missing its version field entirely", () => {
    const valid = encodeMenuCacheEntry([{ id: "a" }])!;
    const noVersion: Record<string, unknown> = { ...valid };
    delete noVersion.v;
    expect(decodeMenuCacheEntry(noVersion)).toBeNull();
  });

  it("rejects valid gzip that does not contain an array", () => {
    const notAnArray = { v: 1 as const, z: gzipSync('{"a":1}').toString("base64"), n: 1 };
    expect(decodeMenuCacheEntry(notAnArray)).toBeNull();
  });

  it("distinguishes an empty menu from an unusable entry", () => {
    // An empty published menu is a REAL state (Slice 48: empty back office =
    // empty site). It must decode to [], not to null, or the caller would fall
    // back to a database read on every request forever.
    const decoded = decodeMenuCacheEntry(encodeMenuCacheEntry([]));
    expect(decoded).toEqual([]);
    expect(decoded).not.toBeNull();
  });

  it("live-menu falls back to the uncached loader when the entry is unusable", () => {
    const code = stripComments(read("src/lib/pos/live-menu.ts"));
    // The exported reader must decode and, on null, read through. Assert the
    // actual fallback expression, not merely that the identifier appears.
    expect(code).toMatch(/decodeMenuCacheEntry<GreenwayMenuItem>\(envelope\)/);
    expect(code).toMatch(/decoded\s*\?\?\s*\(await\s+loadLiveMenuAll\(\)\)/);
  });

  it("the cached function stores the ENCODED envelope, not the raw array", () => {
    const code = stripComments(read("src/lib/pos/live-menu.ts"));
    // The unstable_cache callback must wrap the loader in encodeMenuCacheEntry.
    // Without this the 2 MB bug is back, silently.
    expect(code).toMatch(/unstable_cache\(\s*async\s*\(\)[^)]*=>\s*encodeMenuCacheEntry\(await loadLiveMenuAll\(\)\)/);
  });

  it("still caches under the shared publish tag and TTL", () => {
    const code = stripComments(read("src/lib/pos/live-menu.ts"));
    // menuCacheOptions() carries the tag + TTL; publishing must still clear it.
    expect(code).toContain("menuCacheOptions()");
    expect(code).toContain("[...MENU_CACHE_KEY]");
  });

  it("the visible-items reader still filters hidden items outside the cache", () => {
    // Found by mutation testing: the original assertion allowed up to 120
    // characters between the cached read and the filter, which a mutation that
    // DELETED the filter could still satisfy via a later occurrence in the
    // file. Assert the exact body of loadLiveMenuItemsCached instead.
    const code = stripComments(read("src/lib/pos/live-menu.ts"));
    const fn = code.match(
      /export async function loadLiveMenuItemsCached\(\)[^{]*\{([\s\S]*?)\n\}/,
    );
    expect(fn).not.toBeNull();
    const body = fn![1]!;
    expect(body).toContain("loadLiveMenuAllCached()");
    // Hidden products must never reach the storefront. Caching must not become
    // a way for them to leak.
    expect(body).toMatch(/filter\(\(item\) => !item\.hidden\)/);
  });

  it("the UNCACHED visible-items reader also filters hidden items", () => {
    const code = stripComments(read("src/lib/pos/live-menu.ts"));
    const fn = code.match(
      /export async function loadLiveMenuItems\(\)[^{]*\{([\s\S]*?)\n\}/,
    );
    expect(fn).not.toBeNull();
    // This is the fallback path the cache degrades to, so it carries the same
    // obligation.
    expect(fn![1]!).toMatch(/filter\(\(item\) => !item\.hidden\)/);
  });
});

describe("Slice E — /menu is no longer rebuilt for every visitor", () => {
  const menuPage = () => stripComments(read("src/app/menu/page.tsx"));

  it("declares a revalidate window", () => {
    // Next.js: reading `searchParams` opts a page into dynamic rendering. The
    // route segment config is what lets the rendered page be reused at all.
    expect(menuPage()).toMatch(/^export const revalidate = \d+;/m);
  });

  it("does not force dynamic rendering", () => {
    expect(menuPage()).not.toMatch(/export const dynamic\s*=\s*["']force-dynamic["']/);
  });

  it("uses the same window as the menu data cache", () => {
    const match = menuPage().match(/export const revalidate = (\d+);/);
    expect(match).not.toBeNull();
    // Page cache and data cache expiring together avoids one serving stale
    // content the other has already dropped.
    expect(Number(match![1])).toBe(MENU_CACHE_TTL_SECONDS);
  });

  it("/menu is still revalidated on publish, so caching cannot make it stale", () => {
    expect(PUBLIC_MENU_SURFACES).toContain("/menu");
  });

  it("the client still resolves filters from the live URL", () => {
    // This is what makes the route safe to cache: the browser reads the real
    // query string and it takes precedence over anything the server rendered.
    const code = stripComments(read("src/components/menu/InteractiveMenuBrowser.tsx"));
    expect(code).toContain("window.location.search");
    expect(code).toMatch(/if \(liveValue !== null && liveValue !== ""\) return liveValue;/);
  });
});

describe("Slice E — the grid ships less", () => {
  it("the page projects items before handing them to the browser", () => {
    // SLICE H: the projection moved into the renderer both shop routes share.
    const code = stripComments(read("src/components/menu/ShopPage.tsx"));
    expect(code).toMatch(/const menuItems = toMenuGridItems\(enrichedMenuItems\)/);
    expect(code).toMatch(/<InteractiveMenuBrowser[\s\S]*?items=\{menuItems\}/);
  });

  it("removes the payload of every field it claims to trim", () => {
    const [projected] = toMenuGridItems([makeItem(1)]);
    const record = projected as unknown as Record<string, unknown>;
    for (const field of GRID_TRIMMED_FIELDS) {
      const value = record[field];
      expect(value === undefined || value === "").toBe(true);
    }
  });

  it("keeps every field the cards actually render", () => {
    const [projected] = toMenuGridItems([makeItem(1)]);
    // Verified in use by ProductCardVisual / ProductCardPriceSelector /
    // InteractiveMenuBrowser / the promotion rules.
    for (const field of [
      "id", "name", "brand", "vendor", "category", "strainType",
      "priceLabel", "priceMinorUnits", "inventoryStatus", "variants",
      "compounds", "totalThc", "totalCbd", "imageUrl", "terpenes",
    ]) {
      expect(projected).toHaveProperty(field);
    }
  });

  it("keeps the item type intact so no card component has to change", () => {
    // description must still be PRESENT (blank), because the card components
    // are typed against the full GreenwayMenuItem.
    const [projected] = toMenuGridItems([makeItem(1)]);
    expect(projected).toHaveProperty("description");
  });

  it("measurably shrinks the serialized payload", () => {
    const items = Array.from({ length: 1000 }, (_, i) => makeItem(i));
    const before = Buffer.byteLength(JSON.stringify(items), "utf8");
    const after = Buffer.byteLength(JSON.stringify(toMenuGridItems(items)), "utf8");
    expect(after).toBeLessThan(before);
  });

  it("shrinks the COMPRESSED payload too — the number that reaches the shopper", () => {
    // The first attempt at this idea was measured with identical descriptions
    // and appeared to save nothing, because gzip collapses repetition. Real
    // catalogs have unique copy, so the saving is real. This test uses unique
    // text and asserts the compressed delta directly.
    const items = Array.from({ length: 1000 }, (_, i) => makeItem(i));
    const before = gzipSync(JSON.stringify(items)).length;
    const after = gzipSync(JSON.stringify(toMenuGridItems(items))).length;
    expect(after).toBeLessThan(before);
  });

  it("does not mutate the enriched items it was given", () => {
    const original = makeItem(7);
    const originalDescription = original.description;
    toMenuGridItems([original]);
    expect(original.description).toBe(originalDescription);
  });

  it("preserves order and length", () => {
    const items = Array.from({ length: 250 }, (_, i) => makeItem(i));
    const projected = toMenuGridItems(items);
    expect(projected.length).toBe(items.length);
    expect(projected.map((r) => r.id)).toEqual(items.map((r) => r.id));
  });
});

describe("Slice E — the product detail page keeps its full copy", () => {
  it("loads its own item instead of receiving the trimmed grid item", () => {
    // This is why blanking `description` on the grid is safe.
    const code = stripComments(read("src/app/menu/products/[id]/page.tsx"));
    expect(code).toContain("getLiveMenuItemByIdCached");
    expect(code).toMatch(/item\.description/);
  });

  it("the grid projection is not applied on the detail page", () => {
    const code = stripComments(read("src/app/menu/products/[id]/page.tsx"));
    expect(code).not.toContain("toMenuGridItems");
  });
});
