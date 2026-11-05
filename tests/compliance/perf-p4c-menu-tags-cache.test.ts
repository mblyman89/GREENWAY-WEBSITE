/**
 * PERF P4c (owner 2026-11-05, D186-D190; AGENTS.md rule 18): the public-menu tag overlay reads the
 * tag picture once per MENU_CACHE_TTL_SECONDS (shared by home/shop/product/specials renders) under
 * MENU_CACHE_TAG, instead of 16 keyed queries per render (product_first_seen: 287,000 calls
 * measured). The cached loader throws on any read error, so a failure is never stored; the
 * overlay then falls back to the original keyed read. The "New" time check stays per render.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("PERF P4c: menu tag overlay is cached, never stores a failure", () => {
  const server = read("src/lib/menu/product-tags-server.ts");
  const store = read("src/lib/menu/product-tags-store.ts");

  it("the overlay reads the cached whole picture under the menu tag, keyed read as fallback", () => {
    expect(server).toContain('["menu-product-tags", "v1"]');
    expect(server).toContain("{ revalidate: MENU_CACHE_TTL_SECONDS, tags: [MENU_CACHE_TAG] }");
    expect(server).toContain("return loadTagInputsForKeys(keys);");
    // The clock is read per render, never cached.
    expect(server).toContain("nowMs: new Date().getTime()");
  });

  it("the cached loader pages, reads every error and throws instead of returning a partial set", () => {
    const fn = store.slice(store.indexOf("export async function loadAllTagInputEntries"));
    expect(fn).toContain('throw new Error(`Tag assignments could not be read: ${error.message}`)');
    expect(fn).toContain('throw new Error(`First-seen dates could not be read: ${error.message}`)');
    expect(fn).toContain("throw new Error(`Tag definitions could not be read: ${defsRes.error}`)");
    expect((fn.match(/pagedAll</g) ?? []).length).toBe(2);
    // JSON-safe entries (a Map does not survive the cache round trip).
    expect(fn).toContain("manual: [...manual.entries()]");
  });

  it("tag edits clear it at once (same tag the edit actions revalidate)", () => {
    expect(read("src/app/admin/inventory/tags/actions.ts")).toContain("revalidatePublicMenuSurfaces();");
    expect(read("src/lib/site/public-surfaces.ts")).toContain("revalidateTag(MENU_CACHE_TAG");
  });
});
