/**
 * src/lib/purchasing/unified-search.ts
 *
 * GF-4 — the unified smart vendor search ORCHESTRATOR (server-only I/O glue).
 *
 * One query in → platform-tagged vendor hits out:
 *   1. Look up the smart memory (vendor_platform_map) for the query.
 *   2. Search the preferred / last-seen platform FIRST.
 *   3. Walk the REMAINING platforms one at a time, but only while nothing
 *      has been found yet (sequential search — polite to every marketplace).
 *   4. Tag every hit with its platform so the UI badges it and the menu
 *      fetch routes to the right worker endpoint.
 *
 * Platforms today: Cultivera, GrowFlow, LeafLink (SLICE 84).
 *
 * All decisions (order, mapping, dedupe, upsert shape) are PURE functions in
 * unified-search-core.ts; this file only wires HTTP (cultivera-client /
 * growflow-client / leaflink-client) and Supabase (vendor-platform-store)
 * around them.
 *
 * Degrades gracefully per platform: a platform whose worker credentials are
 * missing (its 503 → configured:false) simply contributes zero hits and is
 * reported in `notes` — the other platforms still work. Never a crash.
 */
import "server-only";

import { searchCultiveraMarkets } from "@/lib/purchasing/cultivera-client";
import { searchGrowflowStores } from "@/lib/purchasing/growflow-client";
import { searchLeaflinkBrands } from "@/lib/purchasing/leaflink-client";
import {
  choosePreferredPlatform,
  cultiveraHit,
  growflowHit,
  leaflinkHit,
  mergeHits,
  searchOrder,
  shouldSearchSecondary,
  type UnifiedVendorHit,
  type VendorPlatform,
} from "@/lib/purchasing/unified-search-core";
import { findMemories } from "@/lib/purchasing/vendor-platform-store";

export type UnifiedSearchResult = {
  ok: boolean;
  /** False only when NO platform could run (crawler env missing). */
  configured: boolean;
  hits: UnifiedVendorHit[];
  /** Which platform was searched first (memory-driven or default). */
  searchedFirst: VendorPlatform;
  /** Whether any later platform was also searched (earlier found nothing). */
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
  if (platform === "leaflink") {
    const res = await searchLeaflinkBrands(query);
    if (!res.configured) {
      return { hits: [], configured: false, note: `LeafLink: ${res.error}` };
    }
    if (!res.ok) {
      return { hits: [], configured: true, note: `LeafLink: ${res.error || `answered ${res.status}`}` };
    }
    return { hits: res.records.map(leaflinkHit), configured: true, note: "" };
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
 * The unified smart search. Sequential: preferred platform first, each of the
 * remaining platforms only while nothing has been found yet. Returns
 * platform-tagged hits.
 */
export async function unifiedVendorSearch(query: string): Promise<UnifiedSearchResult> {
  const memories = await findMemories(query);
  const preferred = choosePreferredPlatform(memories);
  const order = searchOrder(preferred);
  const [first, ...rest] = order;

  const notes: string[] = [];

  const primary = await searchPlatform(first, query);
  if (primary.note) notes.push(primary.note);

  let hits = primary.hits;
  let searchedSecond = false;
  let anyConfigured = primary.configured;

  // Sequential rule: only walk to the next platform while every platform
  // searched so far found nothing (including unconfigured platforms).
  for (const platform of rest) {
    if (!shouldSearchSecondary(hits.length)) break;
    searchedSecond = true;
    const secondary = await searchPlatform(platform, query);
    if (secondary.note) notes.push(secondary.note);
    anyConfigured = anyConfigured || secondary.configured;
    hits = mergeHits(hits, secondary.hits);
  }

  const configured = anyConfigured;

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
