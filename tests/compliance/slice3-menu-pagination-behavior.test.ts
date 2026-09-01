/**
 * SLICE 3 — PAGINATION BEHAVIOUR (not just source text)
 * ===========================================================================
 *
 * The companion gate test proves the SHAPE of the code is right. This one
 * proves the BEHAVIOUR is right, by running the real `pagedAll` / `chunkedIn`
 * helpers against a fake server that enforces the same 1,000-row ceiling
 * PostgREST enforces — silently, exactly like production.
 *
 * This is the difference between "the code says .range()" and "the code
 * actually returns all 4,179 products". Michael's store is past the ceiling,
 * so this is the property that decides whether his menu is complete.
 */

import { describe, it, expect } from "vitest";
import { pagedAll, chunkedIn } from "@/lib/supabase/chunked-in";

/** PostgREST's db.max_rows. The server NEVER returns more than this. */
const SERVER_CAP = 1000;

describe("SLICE 3: pagedAll returns every row past the 1,000 ceiling", () => {
  it("recovers a full 4,179-product catalog (Michael's real scale)", async () => {
    const TOTAL = 4179;
    const all = Array.from({ length: TOTAL }, (_, i) => ({ id: `item-${i}` }));
    let requests = 0;

    const rows = await pagedAll<{ id: string }>(async (from, to) => {
      requests++;
      // The fake server honours the range BUT never returns more than the cap,
      // which is precisely how the real one behaves.
      const width = Math.min(to - from + 1, SERVER_CAP);
      return all.slice(from, from + width);
    });

    expect(rows).toHaveLength(TOTAL);
    // No duplicates and no gaps — a correct partition of the set.
    expect(new Set(rows.map((r) => r.id)).size).toBe(TOTAL);
    expect(rows[0].id).toBe("item-0");
    expect(rows[TOTAL - 1].id).toBe(`item-${TOTAL - 1}`);
    // 4,179 rows at 1,000/page = 5 pages (the 5th is short and ends the walk).
    expect(requests).toBe(5);
  });

  it("an exact multiple of the page size still terminates", async () => {
    // The dangerous edge: the last full page looks identical to "more data".
    // pagedAll must issue one extra request, get zero rows, and stop.
    const TOTAL = 2000;
    const all = Array.from({ length: TOTAL }, (_, i) => ({ id: i }));
    let requests = 0;
    const rows = await pagedAll<{ id: number }>(async (from, to) => {
      requests++;
      const width = Math.min(to - from + 1, SERVER_CAP);
      return all.slice(from, from + width);
    });
    expect(rows).toHaveLength(TOTAL);
    expect(requests).toBe(3); // 1000, 1000, then 0
  });

  it("an empty table yields an empty menu, not an error", async () => {
    const rows = await pagedAll<{ id: number }>(async () => []);
    expect(rows).toEqual([]);
  });
});

describe("SLICE 3: chunkedIn pages WITHIN each chunk", () => {
  /**
   * This is the second, subtler bug. The old code chunked 200 item ids per
   * request but never paged inside a chunk. Because one product commonly has
   * several variants (sizes), 200 products can own far more than 1,000
   * variants — so the tail of each chunk was silently dropped and products
   * rendered missing some of their sizes and prices.
   */
  it("recovers all variants when 200 items own more than 1,000 of them", async () => {
    const ITEMS = 200;
    const VARIANTS_EACH = 8; // 1,600 variants — well past the ceiling
    const itemIds = Array.from({ length: ITEMS }, (_, i) => `item-${i}`);

    const variantsByItem = new Map<string, { menu_item_id: string; id: string }[]>();
    for (const id of itemIds) {
      variantsByItem.set(
        id,
        Array.from({ length: VARIANTS_EACH }, (_, v) => ({ menu_item_id: id, id: `${id}-v${v}` })),
      );
    }

    const rows = await chunkedIn<string, { menu_item_id: string; id: string }>(
      itemIds,
      async (chunk, from, to) => {
        // Flatten this chunk's variants in a stable order, then serve the
        // requested window under the server cap.
        const flat = chunk.flatMap((id) => variantsByItem.get(id) ?? []);
        const width = Math.min(to - from + 1, SERVER_CAP);
        return flat.slice(from, from + width);
      },
      { chunkSize: ITEMS }, // force ONE chunk, so only paging can save us
    );

    expect(rows).toHaveLength(ITEMS * VARIANTS_EACH);
    expect(new Set(rows.map((r) => r.id)).size).toBe(ITEMS * VARIANTS_EACH);

    // Every single item kept ALL of its sizes — the property that decides
    // whether a customer sees the right price.
    const grouped = new Map<string, number>();
    for (const r of rows) grouped.set(r.menu_item_id, (grouped.get(r.menu_item_id) ?? 0) + 1);
    expect(grouped.size).toBe(ITEMS);
    for (const [, count] of grouped) expect(count).toBe(VARIANTS_EACH);
  });

  it("proves the OLD unpaged approach really did lose data", () => {
    // Demonstrates the bug this slice fixed, so the regression is documented
    // as a fact rather than a claim: one 200-id chunk, no paging, server cap
    // applied once => 1,600 variants collapse to 1,000 and 75 of 200 products
    // lose sizes.
    const ITEMS = 200;
    const VARIANTS_EACH = 8;
    const flat = Array.from({ length: ITEMS }, (_, i) =>
      Array.from({ length: VARIANTS_EACH }, (_, v) => ({ menu_item_id: `item-${i}`, id: `${i}-${v}` })),
    ).flat();

    const whatTheOldCodeGot = flat.slice(0, SERVER_CAP); // single unpaged request
    expect(whatTheOldCodeGot).toHaveLength(SERVER_CAP);

    const complete = new Set<string>();
    const counts = new Map<string, number>();
    for (const r of whatTheOldCodeGot) counts.set(r.menu_item_id, (counts.get(r.menu_item_id) ?? 0) + 1);
    for (const [id, c] of counts) if (c === VARIANTS_EACH) complete.add(id);

    // 125 products intact, 75 silently short-changed.
    expect(complete.size).toBe(125);
    expect(ITEMS - complete.size).toBe(75);
  });
});
