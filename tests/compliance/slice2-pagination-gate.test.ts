/**
 * SLICE 2 — PAGINATION GATE
 * ===========================================================================
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Michael reported: "the inventory page seems to be capped at 1000 products
 * and shows strange numbers in the header section like the total cost on hand
 * is way off."
 *
 * The cause was not a bug in our arithmetic. It was PostgREST's `db.max_rows`
 * ceiling (1,000). Several reads used `.limit(5000)` believing that raised the
 * ceiling. It does not — `.limit()` can only LOWER the number of rows the
 * server returns, never raise it above `db.max_rows`. So every one of those
 * reads silently returned the FIRST 1,000 rows and the code summed them as if
 * they were the whole store. The totals were not "strange"; they were the
 * honest total of a quarter of the inventory.
 *
 * The fix is `pagedAll()`, which walks `.range(from, to)` until a short page
 * comes back. But `pagedAll()` is only CORRECT if the underlying query has a
 * STABLE, TOTAL ordering. Without an explicit `.order()`, PostgreSQL is free
 * to return rows in any order it likes between calls, so page 2 can repeat or
 * skip rows from page 1 — producing a total that is wrong in a new and much
 * harder-to-see way.
 *
 * These tests are the guardrail (standing rule: add guardrails, not just
 * fixes). They fail if anyone reintroduces the `.limit(5000)` anti-pattern in
 * the reads SLICE 2 repaired, or adds a `pagedAll()` call without a stable
 * `.order()` beside it.
 *
 * They are deliberately SOURCE-TEXT tests: they need no database, so they run
 * in CI on every commit and cannot be skipped for lack of credentials.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");

/** The reads SLICE 2 converted from a false `.limit()` to real pagination. */
const PAGED_FILES = [
  "src/lib/inventory/store.ts",
  "src/lib/inventory/inventory-intel.ts",
  "src/lib/compliance/ccrs-batch.ts",
] as const;

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/**
 * Source with comments removed. These files deliberately QUOTE the old broken
 * code in their comments to record what went wrong and why, so a naive text
 * search would match the very history we want preserved. Only executable code
 * should be policed.
 */
function readCode(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

describe("SLICE 2: the 1,000-row cap stays fixed", () => {
  it.each(PAGED_FILES)(
    "%s never re-introduces .limit(5000) as a way to beat db.max_rows",
    (rel) => {
      // Only executable code counts — the explanatory comments in these files
      // quote the old `.limit(5000)` on purpose, to record what went wrong.
      expect(readCode(rel)).not.toMatch(/\.limit\(\s*5000\s*\)/);
    },
  );

  it.each(PAGED_FILES)("%s uses pagedAll() for its full-table reads", (rel) => {
    expect(read(rel)).toMatch(/pagedAll</);
  });
});

describe("SLICE 2: every paged read is deterministically ordered", () => {
  /**
   * `pagedAll()` slices a result set with `.range()`. If the query has no
   * explicit `.order()`, the row order is undefined between pages and the
   * walk can duplicate or drop rows. Every `pagedAll(` call body must
   * therefore contain an `.order(`.
   */
  it.each(PAGED_FILES)("%s pairs each pagedAll() with an .order()", (rel) => {
    const src = read(rel);
    const calls = src.split("pagedAll<").slice(1);
    expect(calls.length).toBeGreaterThan(0);

    for (const call of calls) {
      // The callback body ends at the closing of the pagedAll( ... ) call;
      // scanning the next 1,200 chars comfortably covers one query builder
      // without bleeding into unrelated code.
      const body = call.slice(0, 1200);
      expect(body).toMatch(/\.order\(/);
      expect(body).toMatch(/\.range\(\s*from\s*,\s*to\s*\)/);
    }
  });

  it("the cycle-count read breaks ties, because 'first row wins' depends on it", () => {
    // inventory-intel picks the most recent cycle count per lot by taking the
    // FIRST row it sees for that lot. With only `updated_at desc`, two counts
    // sharing a timestamp could swap places between runs and change which one
    // wins. The `lot_id` tiebreaker makes the choice reproducible.
    const src = read("src/lib/inventory/inventory-intel.ts");
    expect(src).toMatch(/order\("updated_at",\s*\{\s*ascending:\s*false\s*\}\)/);
    expect(src).toMatch(/order\("lot_id"/);
  });
});

describe("SLICE 2: CCRS reports the received date, not the import date", () => {
  it("ccrs-batch sources Inventory.CreatedDate through the evidence helper", () => {
    // The whole point of SLICE 2: for a lot whose real receipt day is known,
    // CCRS must report THAT day, not the instant we imported it.
    const code = readCode("src/lib/compliance/ccrs-batch.ts");
    expect(code).toMatch(/ccrsDate\(\s*ccrsInventoryCreatedDate\(/);
    // And the raw fallback must not be used for this field any more.
    expect(code).not.toMatch(/ccrsDate\(\s*l\.created_at\s*\)/);
  });

  it("no code path backfills received_on from created_at", () => {
    // NULL means "we do not know". Filling it from created_at would tell the
    // LCB the lot arrived on migration day. Migration 0191 set this precedent
    // for last_counted_at: evidence, not decoration.
    for (const rel of [...PAGED_FILES, "src/lib/inventory/received-date-core.ts"]) {
      expect(readCode(rel)).not.toMatch(/received_on:\s*[a-z]*\.?created_at/i);
    }
    const migration = readCode(
      "supabase/migrations/0214_inventory_lot_received_date.sql",
    ).replace(/^\s*--.*$/gm, "");
    expect(migration).not.toMatch(/received_on\s*=\s*created_at/i);
  });
});
