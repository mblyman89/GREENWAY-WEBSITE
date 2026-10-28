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
 * wins, rows with a null/blank key skipped. And if the function is missing
 * (0305 not applied yet) or errors for ANY reason, this module runs the
 * original full walk unchanged - so the worst case is "as slow as before",
 * never "a different number".
 */
import "server-only";

import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pagedAll, ADMIN_PAGED_CONCURRENCY } from "@/lib/supabase/chunked-in";

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

class RpcUnavailable extends Error {}

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
      if (error) throw new RpcUnavailable(error.message);
      return (data as LatestMenuFactsRow[] | null) ?? [];
    },
    // A key chunk answers in one page; only the all-keys read needs waves.
    { concurrency: keys === null ? ADMIN_PAGED_CONCURRENCY : 1 },
  );
}

/**
 * THE ORIGINAL WALK, kept verbatim as the fallback: every menu_items row,
 * newest first (created_at desc, id asc), first row per key wins.
 */
async function readViaFullWalk(admin: Admin): Promise<LatestMenuFactsRow[]> {
  const rows = await pagedAll<LatestMenuFactsRow>(async (from, to) => {
    const { data } = await admin
      .from("menu_items")
      .select("source_item_id, category, pos_inventory_type, pos_inventory_category, vendor_name, brand_name, created_at")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);
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
  } catch {
    // 0305 not applied (PGRST202 / 42883) or any other failure: the original
    // read, so the numbers can never differ - only the speed.
    rows = await readViaFullWalk(admin);
  }

  for (const r of rows) {
    if (!r.source_item_id || out.has(r.source_item_id)) continue;
    out.set(r.source_item_id, r);
  }
  return out;
}
