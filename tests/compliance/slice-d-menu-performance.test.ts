/**
 * SLICE D — MENU PERFORMANCE
 * ===========================================================================
 *
 * Slice D makes the storefront do less waiting. Every change it ships is a
 * performance change, which means every one of them is a chance to make the
 * site FASTER AND WRONG. These tests exist to make that trade impossible:
 * they assert the behaviour that must not move, and they are written so that
 * reverting any Slice D edit fails at least one of them.
 *
 * What is pinned here:
 *   1. `chunkedIn` concurrency is opt-in, bounded, and order-preserving.
 *   2. The home page is cacheable rather than `force-dynamic`, and its cache
 *      is still cleared by the publish path.
 *   3. The strain indexes are cached under the SAME tag the publish path
 *      already clears, so the fix cannot silently outlive a publish.
 *   4. The menu page's independent reads run together, and the one real
 *      ordering constraint (seed before read) survives.
 *
 * Ordering is the dangerous one. `menu_variants` decides the PRICE on a card,
 * and it is fetched through `chunkedIn`. If concurrency reordered rows, prices
 * could land on the wrong product — so ordering is tested directly, with a
 * fake server that finishes the LAST chunk first.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  chunkedIn,
  CHUNKED_IN_CONCURRENCY,
  MENU_READ_CONCURRENCY,
} from "@/lib/supabase/chunked-in";
import { MENU_CACHE_TAG, MENU_CACHE_TTL_SECONDS } from "@/lib/menu/menu-cache-policy-core";
import { PUBLIC_MENU_SURFACES } from "@/lib/site/public-surfaces";

const repoFile = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

/** Strip comments so a doc block quoting old code can never satisfy a guard. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("SLICE D: chunk concurrency is opt-in", () => {
  it("defaults to serial, so untouched callers cannot change behaviour", () => {
    // The reports, tax and intake paths never asked for concurrency. The
    // default is the contract that protects them.
    expect(CHUNKED_IN_CONCURRENCY).toBe(1);
  });

  it("proves the default is serial by observing in-flight requests", async () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `id-${i}`);
    let inFlight = 0;
    let peak = 0;

    await chunkedIn(ids, async (chunk) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return chunk.map((id) => ({ id }));
    });

    expect(peak).toBe(1);
  });

  it("overlaps requests when asked, without exceeding the ceiling", async () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `id-${i}`);
    let inFlight = 0;
    let peak = 0;

    await chunkedIn(
      ids,
      async (chunk) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return chunk.map((id) => ({ id }));
      },
      { chunkSize: 100, concurrency: 4 },
    );

    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("keeps the menu ceiling modest so a render cannot starve the register", () => {
    expect(MENU_READ_CONCURRENCY).toBeGreaterThan(1);
    expect(MENU_READ_CONCURRENCY).toBeLessThanOrEqual(8);
  });
});

describe("SLICE D: concurrency never reorders rows", () => {
  /**
   * The adversarial case. Completion order is the REVERSE of chunk order, so
   * an implementation that appends results as they arrive returns the data
   * backwards while still returning the right COUNT — the exact bug that a
   * length-only assertion would wave through.
   */
  const invertedServer = async (chunk: string[]) => {
    const first = Number(chunk[0]!.split("-")[1]);
    await new Promise((r) => setTimeout(r, Math.max(0, 40 - first / 10)));
    return chunk.map((id) => ({ id }));
  };

  it("returns byte-identical output to the serial path", async () => {
    const ids = Array.from({ length: 600 }, (_, i) => `id-${i}`);

    const serial = await chunkedIn(ids, invertedServer, { chunkSize: 50 });
    const parallel = await chunkedIn(ids, invertedServer, {
      chunkSize: 50,
      concurrency: 6,
    });

    expect(parallel).toEqual(serial);
    expect(parallel.map((r) => r.id)).toEqual(ids);
  });

  it("keeps price-bearing variant rows attached to the right item", async () => {
    // A miniature of getVersionItems: variants fetched by item id, then
    // grouped. If concurrency mixed rows between chunks, an item would show
    // another item's price.
    const itemIds = Array.from({ length: 900 }, (_, i) => `item-${i}`);

    const variantRows = await chunkedIn<string, { menu_item_id: string; price: number }>(
      itemIds,
      async (chunk) => {
        await new Promise((r) => setTimeout(r, chunk[0] === "item-0" ? 30 : 1));
        return chunk.map((id) => ({
          menu_item_id: id,
          price: Number(id.split("-")[1]) * 100,
        }));
      },
      { chunkSize: 200, concurrency: MENU_READ_CONCURRENCY },
    );

    expect(variantRows).toHaveLength(900);
    for (const row of variantRows) {
      const expected = Number(row.menu_item_id.split("-")[1]) * 100;
      expect(row.price).toBe(expected);
    }
  });

  it("still surfaces a failed chunk instead of returning a short list", async () => {
    // Silent truncation is the failure mode this whole helper family exists to
    // prevent. Concurrency must not reintroduce it.
    await expect(
      chunkedIn(
        Array.from({ length: 600 }, (_, i) => `id-${i}`),
        async (chunk) => {
          if (chunk[0] === "id-200") throw new Error("read failed");
          return chunk.map((id) => ({ id }));
        },
        { chunkSize: 200, concurrency: 3 },
      ),
    ).rejects.toThrow("read failed");
  });

  it("does not hang when handed a nonsense concurrency", async () => {
    const rows = await chunkedIn(
      ["a", "b", "c"],
      async (chunk) => chunk.map((id) => ({ id })),
      { chunkSize: 1, concurrency: 0 },
    );
    expect(rows).toHaveLength(3);
  });
});

describe("SLICE D: the home page is cacheable again", () => {
  const src = stripComments(repoFile("src/app/page.tsx"));

  it("is no longer force-dynamic", () => {
    // force-dynamic meant "never reuse this render", which is what made the
    // home page pay a full server render per visitor.
    expect(src).not.toMatch(/export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/);
  });

  it("declares a revalidate window that matches the menu cache TTL", () => {
    const match = src.match(/export\s+const\s+revalidate\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(MENU_CACHE_TTL_SECONDS);
  });

  it("is still refreshed by the publish path, so a publish is instant", () => {
    // Caching the page is only safe because publishing clears it. If "/" ever
    // leaves this list, the home page could serve a stale menu until the TTL.
    expect(PUBLIC_MENU_SURFACES).toContain("/");
  });
});

describe("SLICE D: the strain indexes are cached under the publish tag", () => {
  const src = repoFile("src/lib/menu/strain-terpenes-server.ts");
  const code = stripComments(src);

  it("caches the index build rather than the product catalog", () => {
    // Caching the enriched MENU would exceed Vercel's documented 2 MB item
    // limit and be dropped silently. The strain index is keyed by strain, so
    // it does not grow with inventory.
    expect(code).toContain("unstable_cache");
    expect(code).toContain("buildMenuIndexesCached");
  });

  it("uses the SAME tag the publish path already clears", () => {
    // A second, private tag would mean a publish refreshed the menu but left
    // stale terpenes sitting behind it for the rest of the TTL.
    //
    // This asserts the tag actually handed to the cache, not merely that the
    // constant is mentioned in the file. An earlier version of this test only
    // checked for the identifier anywhere in the source, and a mutation that
    // swapped the real tag for a private string SURVIVED it.
    const tagsArg = code.match(/tags:\s*\[([^\]]*)\]/);
    expect(tagsArg).not.toBeNull();
    expect(tagsArg![1]).toContain("MENU_CACHE_TAG");
    expect(tagsArg![1]).not.toMatch(/["'`]/); // no hardcoded/private tag string
    expect(MENU_CACHE_TAG).toBe("live-menu");
  });

  it("revalidates on the same TTL as the rest of the menu cache", () => {
    expect(code).toMatch(/revalidate:\s*MENU_CACHE_TTL_SECONDS/);
    expect(MENU_CACHE_TTL_SECONDS).toBe(60);
  });

  it("routes the public attach paths through the cached build", () => {
    // withMenuProfile is what /menu, / and /specials call. If it still called
    // the uncached builder, the fix would be dead code.
    const profile = code.slice(code.indexOf("export async function withMenuProfile"));
    expect(profile).toContain("buildMenuIndexesCached");
  });

  it("falls back to an uncached build so a cache fault cannot blank terpenes", () => {
    expect(code).toMatch(/catch\s*\{[\s\S]*?return buildMenuIndexes\(\);/);
  });
});

describe("SLICE D: the menu page starts independent reads together", () => {
  const src = repoFile("src/app/menu/page.tsx");
  const code = stripComments(src);

  it("batches the page-furniture reads into one Promise.all", () => {
    expect(code).toMatch(
      /const\s*\[\s*categoryLabels\s*,\s*banners\s*,\s*shopSlides\s*,\s*promotionTitles\s*\]\s*=\s*await Promise\.all\(/,
    );
  });

  it("keeps the seed-before-read ordering that actually matters", () => {
    // The carousel must be seeded before it is read; that is a real dependency
    // and it stays chained instead of being flattened into the batch.
    expect(code).toMatch(
      /ensureShopCarouselSeeded\(\)\s*\.then\(\(\)\s*=>\s*getShopCarouselForRender\(\)\)/,
    );
  });

  it("no longer awaits those reads one statement at a time", () => {
    expect(code).not.toContain("const banners = await getPageBanners");
    expect(code).not.toContain("const shopSlides = await getShopCarouselForRender()");
    expect(code).not.toContain("const categoryLabels = await loadCategoryLabelMap()");
  });
});

describe("SLICE D: menu read paths opt into concurrency", () => {
  // These are the call sites the round-trip count was built from. A revert of
  // any one of them is a measurable regression on the storefront, so each is
  // named rather than counted.
  const callSites = [
    "src/lib/enrichment/image-resolver.ts",
    "src/lib/menu/card-identity.ts",
    "src/lib/medical/sale-store.ts",
    "src/lib/pos/menu-version.ts",
    "src/lib/pos/product-classification-overrides.ts",
    "src/lib/ai/kb/product-knowledge-batch.ts",
  ];

  for (const file of callSites) {
    it(`${file} passes MENU_READ_CONCURRENCY`, () => {
      const code = stripComments(repoFile(file));
      expect(code).toContain("MENU_READ_CONCURRENCY");
      expect(code).toMatch(/concurrency:\s*MENU_READ_CONCURRENCY/);
    });
  }

  it("widens the DOH registry chunk so the menu makes fewer trips", () => {
    // This call used the 200 default while every sibling used 300, which cost
    // 8 extra round trips per menu render for no reason.
    const code = stripComments(repoFile("src/lib/medical/sale-store.ts"));
    expect(code).toMatch(/chunkSize:\s*300/);
  });
});
