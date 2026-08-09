/**
 * src/lib/ai/kb/unmapped-ccrs-server.ts  (KB↔CCRS link, Slice 3)
 *
 * Server-only loader that feeds the PURE unmapped-ccrs-core the two DB facts it
 * needs and returns the review list (computed ONCE, surfaced in both the KB
 * Product-types area and the settings Types & Categories page):
 *   1. the distinct CCRS inventory types intake has actually SEEN (from
 *      inventory_lots.inventory_type) + how many lots carried each, and
 *   2. the KB categories and the CCRS names they already map
 *      (kb_product_categories.wa_inventory_types[]).
 *
 * Best-effort + never throws: pre-migration or on any read error it returns an
 * empty review so the pages render cleanly. Reads are bounded.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { listKbProductCategoriesAll } from "@/lib/ai/kb/store";
import {
  computeUnmappedCcrsTypes,
  summarizeUnmapped,
  type SeenCcrsType,
  type UnmappedKbCategory,
  type UnmappedCcrsItem,
  type UnmappedCcrsSummary,
} from "@/lib/ai/kb/unmapped-ccrs-core";

export type UnmappedCcrsReview = {
  items: UnmappedCcrsItem[];
  summary: UnmappedCcrsSummary;
  /** The KB categories offered as map targets (active + inactive), for the dropdown. */
  categories: { id: string; slug: string; name: string; group_key: string }[];
};

const EMPTY: UnmappedCcrsReview = {
  items: [],
  summary: { total: 0, known: 0, legacy: 0, unrecognized: 0, affectedLots: 0 },
  categories: [],
};

/**
 * Read the distinct inventory_type values (+ lot counts) intake has seen. We
 * page through inventory_lots and aggregate in memory (the column isn't a
 * grouped view). Bounded to a generous cap so a huge store still returns fast.
 */
async function loadSeenCcrsTypes(
  admin: ReturnType<typeof createSupabaseAdminClient>,
): Promise<SeenCcrsType[]> {
  const counts = new Map<string, { type: string; count: number }>();
  const PAGE = 1000;
  const MAX_ROWS = 50_000; // safety cap
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from("inventory_lots")
      .select("inventory_type")
      .not("inventory_type", "is", null)
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const row of data as { inventory_type: string | null }[]) {
      const raw = String(row.inventory_type ?? "").trim();
      if (!raw) continue;
      // Key by lower-cased/collapsed form so case variants aggregate, but keep
      // the first-seen exact spelling as the label (the core re-normalizes).
      const key = raw.toLowerCase().replace(/\s+/g, " ");
      const hit = counts.get(key);
      if (hit) hit.count += 1;
      else counts.set(key, { type: raw, count: 1 });
    }
    from += data.length;
    if (data.length < PAGE || from >= MAX_ROWS) break;
  }
  return [...counts.values()];
}

/**
 * Compute the unmapped-CCRS review. Never throws; returns EMPTY on any problem
 * so callers can render unconditionally.
 */
export async function loadUnmappedCcrsReview(): Promise<UnmappedCcrsReview> {
  if (!isSupabaseServiceConfigured) return EMPTY;
  try {
    const admin = createSupabaseAdminClient();
    const [seen, kbRows] = await Promise.all([
      loadSeenCcrsTypes(admin),
      listKbProductCategoriesAll(500),
    ]);

    const categories: UnmappedKbCategory[] = kbRows.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      group_key: c.group_key,
      wa_inventory_types: c.wa_inventory_types,
    }));

    const items = computeUnmappedCcrsTypes(seen, categories);
    const summary = summarizeUnmapped(items);

    // Offer ALL categories (active first, then inactive) as map targets so the
    // operator can map onto any product type, even a hidden one.
    const targets = kbRows
      .map((c) => ({ id: c.id, slug: c.slug, name: c.name, group_key: c.group_key, active: c.active }))
      .sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map(({ id, slug, name, group_key }) => ({ id, slug, name, group_key }));

    return { items, summary, categories: targets };
  } catch {
    return EMPTY;
  }
}
