/**
 * src/lib/enrichment/copilot-search-server.ts  (D244 R-24)
 *
 * The Copilot's photo search, the server half (owner, round 11: "I need a
 * search bar that is very smart, lets me enter any text and the system does
 * its best to show me something based on that text"). Runs, in parallel:
 *   1. the library's hybrid search on the whole text (words + meaning),
 *   2. the word search on each extra plan from copilotSearchPlans,
 *   3. the whole shelf of every vendor / brand whose name is typed; a typed
 *      vendor also brings in every brand filed under it ("the vendors other
 *      brands").
 * rankCopilotSearch (pure) fuses and orders them. Read-only; never throws.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { readImageSearch, readSearchHitAssets } from "@/lib/media/library-picker-server";
import type { LibraryPickerAsset } from "@/lib/media/library-picker-core";
import { isTextRemovedPhoto } from "./image-recommend-v3-core";
import {
  COPILOT_SEARCH_LIMIT,
  cleanCopilotQuery,
  copilotSearchPlans,
  copilotSearchSummary,
  matchNamed,
  rankCopilotSearch,
  type CopilotSearchPhoto,
  type NamedMatch,
} from "./copilot-search-core";

export type CopilotSearchRead = {
  query: string;
  photos: CopilotSearchPhoto[];
  summary: string;
  /** Plain words when the search could not run (never a silent empty). */
  note: string | null;
};

type NameRow = { id: string; display_name: string | null; vendor_id?: string | null };

async function readNames(): Promise<{ vendors: NameRow[]; brands: NameRow[] }> {
  if (!isSupabaseServiceConfigured) return { vendors: [], brands: [] };
  try {
    const admin = createSupabaseAdminClient();
    const [v, b] = await Promise.all([
      admin.from("vendors").select("id, display_name").range(0, 4999),
      admin.from("brands").select("id, display_name, vendor_id").range(0, 9999),
    ]);
    return { vendors: ((v.data as NameRow[] | null) ?? []).filter((r) => r?.id), brands: ((b.data as NameRow[] | null) ?? []).filter((r) => r?.id) };
  } catch {
    return { vendors: [], brands: [] };
  }
}

export async function searchCopilotPhotos(input: { query: unknown; cardVendorId?: string | null; excludeIds?: readonly string[] }): Promise<CopilotSearchRead> {
  const query = cleanCopilotQuery(input.query);
  const done = (photos: CopilotSearchPhoto[], note: string | null, named: { kind: "vendor" | "brand"; match: NamedMatch }[] = []): CopilotSearchRead => ({
    query,
    photos,
    summary: note ? "" : copilotSearchSummary(query, photos.length, named),
    note,
  });
  if (!query) return done([], null);
  if (query.length < 2) return done([], "Type at least two letters.");
  try {
    const names = await readNames();
    const vendorLabels = new Map(names.vendors.map((r) => [r.id.toLowerCase(), r.display_name ?? ""] as const));
    const brandLabels = new Map(names.brands.map((r) => [r.id.toLowerCase(), r.display_name ?? ""] as const));
    const vendorHits = matchNamed(query, names.vendors.map((r) => ({ id: r.id, name: r.display_name ?? "" })));
    const brandHits = matchNamed(query, names.brands.map((r) => ({ id: r.id, name: r.display_name ?? "" })));
    // A typed vendor brings in every brand filed under it (its other brands).
    const shelves: { kind: "vendor" | "brand"; match: NamedMatch }[] = [
      ...vendorHits.map((m) => ({ kind: "vendor" as const, match: m })),
      ...brandHits.map((m) => ({ kind: "brand" as const, match: m })),
    ];
    for (const v of vendorHits) {
      for (const b of names.brands) {
        if ((b.vendor_id ?? "").toLowerCase() !== v.id.toLowerCase() || shelves.some((s) => s.match.id === b.id)) continue;
        shelves.push({ kind: "brand", match: { id: b.id, name: b.display_name ?? "", strength: Math.max(1, v.strength - 1) } });
        if (shelves.length >= 12) break;
      }
    }
    const plans = copilotSearchPlans(query);
    const [whole, planHits, shelfReads] = await Promise.all([
      readImageSearch({ query, scope: "all" }),
      Promise.all(plans.map((p) => readSearchHitAssets(p, 40))),
      Promise.all(shelves.map((s) => readImageSearch(s.kind === "vendor" ? { scope: "vendor", vendorId: s.match.id } : { scope: "brand", brandId: s.match.id }))),
    ]);
    const assets = new Map<string, LibraryPickerAsset>();
    const keep = (list: readonly LibraryPickerAsset[]) => {
      for (const a of list) if (a?.id && !assets.has(a.id)) assets.set(a.id, a);
      return list.map((a) => a.id);
    };
    const lists: string[][] = [keep(whole.assets), ...planHits.map(keep), ...shelfReads.map((r) => keep(r.assets))];
    const meaningIds = new Set([...whole.chips.entries()].filter(([, c]) => c.includes("Matches by meaning")).map(([id]) => id));
    const named = shelves.map((s, i) => ({ ...s, ids: new Set(shelfReads[i]!.assets.map((a) => a.id)) }));
    const photos = rankCopilotSearch({
      query,
      assets,
      lists,
      meaningIds,
      named,
      cardVendorId: input.cardVendorId ?? null,
      excludeIds: new Set(input.excludeIds ?? []),
      vendorLabels,
      brandLabels,
      isTextRemoved: isTextRemovedPhoto,
      limit: COPILOT_SEARCH_LIMIT,
    });
    const note = photos.length === 0 && !whole.ok && whole.note ? whole.note : null;
    return done(photos, note, [...vendorHits.map((m) => ({ kind: "vendor" as const, match: m })), ...brandHits.map((m) => ({ kind: "brand" as const, match: m }))]);
  } catch (e) {
    return done([], e instanceof Error ? `The search failed: ${e.message}` : "The search failed. Try again.");
  }
}
