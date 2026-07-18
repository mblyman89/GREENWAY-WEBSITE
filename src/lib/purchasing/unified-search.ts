/**
 * src/lib/purchasing/unified-search.ts
 *
 * GF-4 — the unified smart vendor search ORCHESTRATOR (server-only I/O glue).
 *
 * One query in → platform-tagged vendor hits out:
 *   1. Look up the smart memory (vendor_platform_map) for the query.
 *   2. Search the preferred / last-seen platform FIRST.
 *   3. Search the OTHER platform only when the first found nothing
 *      (sequential search — polite to both marketplaces).
 *   4. Tag every hit with its platform so the UI badges it and the menu
 *      fetch routes to the right worker endpoint.
 *
 * All decisions (order, mapping, dedupe, upsert shape) are PURE functions in
 * unified-search-core.ts; this file only wires HTTP (cultivera-client /
 * growflow-client) and Supabase (vendor-platform-store) around them.
 *
 * Degrades gracefully per platform: a platform whose worker credentials are
 * missing (its 503 → configured:false) simply contributes zero hits and is
 * reported in `notes` — the other platform still works. Never a crash.
 */
import "server-only";

import { searchCultiveraMarkets } from "@/lib/purchasing/cultivera-client";
import { searchGrowflowStores } from "@/lib/purchasing/growflow-client";
import {
  choosePreferredPlatform,
  cultiveraHit,
  growflowHit,
  mergeHits,
  searchOrder,
  shouldSearchSecondary,
  type UnifiedVendorHit,
  type VendorPlatform,
} from "@/lib/purchasing/unified-search-core";
import { findMemories } from "@/lib/purchasing/vendor-platform-store";

export type UnifiedSearchResult = {
  ok: boolean;
  /** False only when NEITHER platform could run (crawler env missing). */
  configured: boolean;
  hits: UnifiedVendorHit[];
  /** Which platform was searched first (memory-driven or default). */
  searchedFirst: VendorPlatform;
  /** Whether the second platform was also searched (first found nothing). */
  searchedSecond: boolean;
  /** Human notes: per-platform degradations (missing creds, errors). */
  notes: string[];
  error: string;
};

/** Search ONE platform and map its records to unified hits. */
async function searchPlatform(
  platform: VendorPlatform,
  query: string,
): Promise<{ hits: UnifiedVendorHit[]; configured: boolean; note: string }> {
  if (platform === "growflow") {
    const res = await searchGrowflowStores(query);
    if (!res.configured) {
      return { hits: [], configured: false, note: `GrowFlow: ${res.error}` };
    }
    if (!res.ok) {
      return { hits: [], configured: true, note: `GrowFlow: ${res.error || `answered ${res.status}`}` };
    }
    return { hits: res.records.map(growflowHit), configured: true, note: "" };
  }
  const res = await searchCultiveraMarkets(query);
  if (!res.configured) {
    return { hits: [], configured: false, note: `Cultivera: ${res.error}` };
  }
  if (!res.ok) {
    return { hits: [], configured: true, note: `Cultivera: ${res.error || `answered ${res.status}`}` };
  }
  return { hits: res.records.map(cultiveraHit), configured: true, note: "" };
}

/**
 * The unified smart search. Sequential: preferred platform first, the other
 * only when the first finds nothing. Returns platform-tagged hits.
 */
export async function unifiedVendorSearch(query: string): Promise<UnifiedSearchResult> {
  const memories = await findMemories(query);
  const preferred = choosePreferredPlatform(memories);
  const order = searchOrder(preferred);
  const [first, second] = order;

  const notes: string[] = [];

  const primary = await searchPlatform(first, query);
  if (primary.note) notes.push(primary.note);

  let hits = primary.hits;
  let searchedSecond = false;
  let secondaryConfigured = true;

  // Sequential rule: only hit the second platform when the first found
  // nothing (including when the first platform wasn't configured at all).
  if (shouldSearchSecondary(primary.hits.length)) {
    searchedSecond = true;
    const secondary = await searchPlatform(second, query);
    if (secondary.note) notes.push(secondary.note);
    secondaryConfigured = secondary.configured;
    hits = mergeHits(primary.hits, secondary.hits);
  }

  const configured = primary.configured || (searchedSecond && secondaryConfigured);

  return {
    ok: configured,
    configured,
    hits,
    searchedFirst: first,
    searchedSecond,
    notes,
    error: configured ? "" : notes.join(" · ") || "Crawler not configured.",
  };
}
