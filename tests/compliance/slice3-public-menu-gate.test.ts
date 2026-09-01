/**
 * SLICE 3 — PUBLIC MENU GATE
 * ===========================================================================
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Michael reported: "none of the inventory I imported shows up on the customer
 * facing website."
 *
 * The customer menu reads exactly one thing: the single `published`
 * menu_version, via getPublishedVersion() -> getVersionItems(). Every read on
 * that path went through PostgREST, which enforces `db.max_rows` (1,000) and
 * SILENTLY TRUNCATES — no error, no warning, no signal of any kind.
 *
 * Two distinct defects lived on that path:
 *
 *   1. getVersionItems() had NO pagination at all, so a catalog larger than
 *      1,000 products was cut to 1,000 everywhere it is used — the public
 *      menu, the admin Products page, the syndication feed, AND the publish
 *      commit gate.
 *
 *   2. Its variant read chunked item ids 200 at a time but never paged WITHIN
 *      a chunk. Since one item commonly owns several variants (sizes), 200
 *      items can own well over 1,000 variants — so products silently rendered
 *      with some of their sizes, and therefore some of their prices, missing.
 *
 * The same "chunk but never page" shape was found on four more reads that
 * decorate the customer's product card: brand identity, product images,
 * category overrides, and the strain/terpene index. Each one degrades
 * SILENTLY — a missing photo, a raw "CERES - 435011" brand label, a product
 * filed under the wrong category — which is exactly why none of it was
 * reported as an error.
 *
 * These are SOURCE-TEXT tests. They need no database, so they run in CI on
 * every commit and cannot be skipped for lack of credentials. They fail if
 * anyone reintroduces the anti-pattern.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");

/** Reads on the customer-facing menu path that MUST page to exhaustion. */
const MENU_PATH_FILES = [
  "src/lib/pos/menu-version.ts",
  "src/lib/menu/card-identity.ts",
  "src/lib/enrichment/image-resolver.ts",
  "src/lib/pos/category-registry.ts",
  "src/lib/pos/product-classification-overrides.ts",
] as const;

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/**
 * Source with comments stripped. These files deliberately QUOTE the old broken
 * code in their comments to record what went wrong, so a naive text search
 * would match the very history we want to keep. Only executable code is
 * policed.
 */
function readCode(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

describe("SLICE 3: the customer menu is never silently truncated", () => {
  it.each(MENU_PATH_FILES)(
    "%s does not use .limit(N) to try to beat db.max_rows",
    (rel) => {
      const code = readCode(rel);
      // `.limit()` above the 1,000 ceiling is always a mistake: PostgREST can
      // only ever return FEWER rows than db.max_rows, so such a limit reads as
      // an intention that the server silently ignores.
      const bogus = code.match(/\.limit\(\s*(\d+)\s*\)/g) ?? [];
      for (const m of bogus) {
        const n = Number(/(\d+)/.exec(m)![1]);
        expect(n, `${rel} has ${m}, which db.max_rows silently caps at 1000`).toBeLessThanOrEqual(1000);
      }
    },
  );

  it.each(MENU_PATH_FILES)("%s pages with pagedAll or chunkedIn", (rel) => {
    expect(readCode(rel)).toMatch(/pagedAll<|chunkedIn</);
  });

  it("getVersionItems pages BOTH its items and its variants", () => {
    const code = readCode("src/lib/pos/menu-version.ts");
    const fn = code.slice(code.indexOf("export async function getVersionItems"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    // items: paged
    expect(body).toMatch(/pagedAll<MenuItemRow>/);
    // variants: chunked AND paged (the second, subtler bug)
    expect(body).toMatch(/chunkedIn<string, MenuVariantRow>/);
    // the old unpaged loop must be gone
    expect(body).not.toMatch(/for\s*\(\s*let\s+i\s*=\s*0;\s*i\s*<\s*itemIds\.length/);
  });

  it("the variant read is ordered, so pages are a stable partition", () => {
    const code = readCode("src/lib/pos/menu-version.ts");
    const fn = code.slice(code.indexOf("export async function getVersionItems"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    // sort_order is NOT unique (assigned per batch as start+idx), so an `id`
    // tiebreaker is required or rows can swap between page requests.
    expect(body).toMatch(/\.order\("sort_order"/);
    expect(body).toMatch(/\.order\("id"/);
    expect(body).toMatch(/\.range\(\s*from\s*,\s*to\s*\)/);
  });
});

describe("SLICE 3: a partial read is never served as a whole menu", () => {
  /**
   * The old code did `continue` on a variant read error, which quietly served
   * a product with SOME of its sizes. Variants carry the price, so a partial
   * variant read puts a wrong price in front of a customer. Both reads must
   * fail closed instead.
   */
  it("getVersionItems fails closed on a read error", () => {
    const code = readCode("src/lib/pos/menu-version.ts");
    const fn = code.slice(code.indexOf("export async function getVersionItems"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toMatch(/itemsFailed/);
    expect(body).toMatch(/variantsFailed/);
    // The silent-partial `continue` is gone.
    expect(body).not.toMatch(/^\s*continue;\s*$/m);
  });

  it("getImportDiagnostics fails closed, because the commit gate reads it", () => {
    const code = readCode("src/lib/pos/menu-version.ts");
    const fn = code.slice(code.indexOf("export async function getImportDiagnostics"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toMatch(/failed\s*\?\s*\[\]\s*:\s*rows/);
  });
});

describe("SLICE 3: the publish commit gate reads COMPLETE evidence", () => {
  /**
   * publishMenuVersion() counts how many fact-review rows still await a human
   * decision. It passed `{ limit: 5000 }`, which PostgREST silently served as
   * 1,000 — so on a large import the gate could see ZERO pending reviews
   * simply because the pending ones sat past the cap, and open the door to
   * publish. A safety gate reading partial evidence is not a safety gate.
   */
  it("the gate no longer passes a limit to getImportDiagnostics", () => {
    const code = readCode("src/lib/pos/import-service.ts");
    expect(code).not.toMatch(/getImportDiagnostics\([^)]*limit:\s*5000/);
    expect(code).toMatch(/getImportDiagnostics\(\s*importId\s*\)/);
  });

  it("getImportDiagnostics still honours an EXPLICIT limit for display screens", () => {
    // Paging everything is right for the gate, but screens that show "the
    // first N diagnostics" must keep working. The bounded branch is preserved.
    const code = readCode("src/lib/pos/menu-version.ts");
    expect(code).toMatch(/opts\?\.limit\s*!=\s*null/);
  });
});

describe("SLICE 3: card decoration reads cover the whole menu", () => {
  it("card-identity pages brands and vendors", () => {
    const code = readCode("src/lib/menu/card-identity.ts");
    expect(code).toMatch(/chunkedIn<string, \{ pos_product_key: string; brand_id: string \| null \}>/);
    expect(code).toMatch(/pagedAll</);
    // The old `.limit(2000)` vendor read is gone.
    expect(code).not.toMatch(/\.limit\(\s*2000\s*\)/);
  });

  it("image-resolver pages enrichment rows and media assets", () => {
    const code = readCode("src/lib/enrichment/image-resolver.ts");
    expect(code).toMatch(/chunkedIn<string, EnrichRow>/);
    expect(code).toMatch(/chunkedIn<string, MediaRow>/);
  });

  it("classification overrides are chunked AND paged", () => {
    const code = readCode("src/lib/pos/product-classification-overrides.ts");
    expect(code).toMatch(/chunkedIn<string, ProductClassificationOverride>/);
    expect(code).toMatch(/\.range\(\s*from\s*,\s*to\s*\)/);
  });

  it("the strain index is built from the whole library, not the first page", () => {
    const kb = readCode("src/lib/ai/kb/store.ts");
    const fn = kb.slice(kb.indexOf("export async function listKbStrains"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    // Must page rather than rely on a single capped .limit().
    expect(body).toMatch(/\.range\(\s*from\s*,\s*to\s*\)/);
    expect(body).toMatch(/\.order\("id"/);
    // And the menu must not ask for exactly the old 1,000-row ceiling.
    const menu = readCode("src/lib/menu/strain-terpenes-server.ts");
    expect(menu).not.toMatch(/listKbStrains\(\s*1000\s*\)/);
  });
});
