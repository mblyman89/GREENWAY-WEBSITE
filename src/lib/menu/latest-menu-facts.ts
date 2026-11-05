/**
 * latest-menu-facts.ts  (PERF2 round 4)
 *
 * "The newest category / POS type / POS category / vendor / brand for each
 * menu product key" - the lookup the sales, COGS, WA tax, CCRS Sale.csv,
 * LIQ-1295 and Sage builders all need to put a sold line in the right bucket.
 *
 * BEFORE: each builder downloaded EVERY menu_items row ever written (every
 * snapshot of every product, newest first), 1,000 rows per request, one
 * request after another, and kept the first row per key in JavaScript. The
 * /admin cockpit did that three times per load, every report tab at least
 * once. That walk, not the arithmetic, was most of the wait.
 *
 * NOW: migration 0305 `latest_menu_facts(p_keys)` lets Postgres pick the
 * newest row per key (DISTINCT ON over the 0303 index) and return ONE row per
 * key - optionally only the keys the caller actually sold.
 *
 * SAME ANSWER, BY CONSTRUCTION. The function's rule is the builders' rule:
 * created_at descending, id ascending as the tie-break, first row per key
 * wins, rows with a null/blank key skipped.
 *
 * PERF round (0344, owner 2026-11-05 "I need my back office to be lightning
 * fast"): the function now reads product_latest_facts (one row per key) in
 * milliseconds. And the fallback changed. It used to run the original full
 * walk on ANY error - including a statement timeout. Measured: that walk ran
 * 5,622 times at 2.15 s a page (3.4 hours of database time, the largest cost
 * on the server), which slowed every other query, which timed out more RPC
 * calls, which ran more walks. Now the walk runs ONLY when the function does
 * not exist (a database before 0305, PGRST202 / 42883). Any other failure is
 * THROWN with its message (rule 135: a missing answer is a question, never a
 * different number and never a 700,000-row walk). The walk reads its own
 * errors too.
 */
import "server-only";

import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pagedAll, ADMIN_PAGED_CONCURRENCY } from "@/lib/supabase/chunked-in";
import { factsFallback, type DbError } from "@/lib/menu/menu-retention-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type LatestMenuFactsRow = {
  source_item_id: string;
  category: string | null;
  pos_inventory_type: string | null;
  pos_inventory_category: string | null;
  vendor_name: string | null;
  brand_name: string | null;
};

export const LATEST_MENU_FACTS_RPC = "latest_menu_facts";

/**
 * Keys per RPC call. The keys travel in the POST body (no URL-length limit);
 * 900 keeps every chunk's answer (at most one row per key) under PostgREST's
 * 1,000-row page, so a chunk is exactly one round trip.
 */
const KEYS_PER_CALL = 900;

class RpcFailed extends Error {
  constructor(readonly dbError: DbError) {
    super(dbError?.message || dbError?.code || "latest_menu_facts failed");
  }
}

/** One RPC call (one key chunk, or all keys), paged past PostgREST's row cap. */
async function readViaRpc(admin: Admin, keys: string[] | null): Promise<LatestMenuFactsRow[]> {
  return pagedAll<LatestMenuFactsRow>(
    async (from, to) => {
      const { data, error } = await admin
        .rpc(LATEST_MENU_FACTS_RPC, { p_keys: keys })
        // source_item_id is unique per returned row (one row per key), so
        // ordering by it makes paging deterministic: no overlap, no skip.
        .order("source_item_id", { ascending: true })
        .range(from, to);
      if (error) throw new RpcFailed(error);
      return (data as LatestMenuFactsRow[] | null) ?? [];
    },
    // A key chunk answers in one page; only the all-keys read needs waves.
    { concurrency: keys === null ? ADMIN_PAGED_CONCURRENCY : 1 },
  );
}

/**
 * THE ORIGINAL WALK, kept as the fallback for a database WITHOUT the function
 * only: every menu_items row, newest first (created_at desc, id asc), first
 * row per key wins. A page that errors throws (it used to read as "no more
 * rows" and silently returned a partial lookup).
 */
async function readViaFullWalk(admin: Admin): Promise<LatestMenuFactsRow[]> {
  const rows = await pagedAll<LatestMenuFactsRow>(async (from, to) => {
    const { data, error } = await admin
      .from("menu_items")
      .select("source_item_id, category, pos_inventory_type, pos_inventory_category, vendor_name, brand_name, created_at")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);
    if (error) throw new Error(`Menu facts (fallback read) failed: ${error.message}`);
    return (data as LatestMenuFactsRow[] | null) ?? [];
  });
  return rows;
}

/**
 * source_item_id -> newest facts row.
 *
 * `keys` omitted/null: every product key. `keys` given: at least those keys
 * (the fallback returns every key - a superset, so lookups are identical).
 * An empty `keys` array returns an empty map without a round trip.
 */
export async function loadLatestMenuFacts(
  admin: Admin,
  keys?: Iterable<string | null | undefined> | null,
): Promise<Map<string, LatestMenuFactsRow>> {
  const out = new Map<string, LatestMenuFactsRow>();
  const wanted =
    keys == null ? null : [...new Set([...keys].filter((k): k is string => typeof k === "string" && k !== ""))];
  if (wanted && wanted.length === 0) return out;

  let rows: LatestMenuFactsRow[];
  try {
    if (wanted === null) {
      rows = await readViaRpc(admin, null);
    } else {
      const chunks: string[][] = [];
      for (let i = 0; i < wanted.length; i += KEYS_PER_CALL) chunks.push(wanted.slice(i, i + KEYS_PER_CALL));
      rows = (await Promise.all(chunks.map((c) => readViaRpc(admin, c)))).flat();
    }
  } catch (err) {
    const dbError: DbError = err instanceof RpcFailed ? err.dbError : { message: err instanceof Error ? err.message : String(err) };
    if (factsFallback(dbError) !== "walk") {
      // A timeout, a network error, anything but "not there": say so. The
      // page shows its error card; nothing is filed on a guessed category.
      throw new Error(`Menu facts lookup failed (latest_menu_facts): ${dbError?.message || dbError?.code || "unknown error"}`);
    }
    // Function not applied yet (PGRST202 / 42883): the original read.
    rows = await readViaFullWalk(admin);
  }

  for (const r of rows) {
    if (!r.source_item_id || out.has(r.source_item_id)) continue;
    out.set(r.source_item_id, r);
  }
  return out;
}
