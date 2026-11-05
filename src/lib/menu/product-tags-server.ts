/**
 * src/lib/menu/product-tags-server.ts - R49 S6 (owner: Michael)
 *
 * Menu overlay: attaches `item.tags` (the owner's tags + the automatic "New"
 * tag) to fully-built menu items. Slots into the overlay chain exactly like
 * withCategoryOverride. "now" is read HERE on the server (once per render of
 * a cached page, revalidate = 60) and passed into the pure core, never in a
 * client component render.
 *
 * PERF P4c (owner 2026-11-05 "lightning fast"; AGENTS.md rule 18): the tag
 * picture is read ONCE per MENU_CACHE_TTL_SECONDS and shared by every page
 * render (home, shop, product, specials), under MENU_CACHE_TAG, so a tag edit
 * (tags/actions.ts -> revalidatePublicMenuSurfaces) or a publish clears it at
 * once. Before, every render ran 16 keyed queries over ~2,300 menu keys. A
 * failed read THROWS inside the cache and is never stored; the overlay then
 * falls back to the original keyed read for that render. Only the TIME
 * comparison ("New" for N days) runs per render, against the live clock.
 *
 * Degrades to identity (items unchanged, no tags) when Supabase is
 * unconfigured, before migration 0269, or on ANY read error: the public menu
 * must never break because of this optional overlay. NEVER writes.
 */
import "server-only";
import { unstable_cache } from "next/cache";
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { attachTags } from "@/lib/menu/product-tags-core";
import { loadAllTagInputEntries, loadTagInputsForKeys } from "@/lib/menu/product-tags-store";
import { MENU_CACHE_TAG, MENU_CACHE_TTL_SECONDS } from "@/lib/menu/menu-cache-policy-core";

const loadAllTagInputEntriesCached = unstable_cache(
  async () => loadAllTagInputEntries(),
  ["menu-product-tags", "v1"],
  { revalidate: MENU_CACHE_TTL_SECONDS, tags: [MENU_CACHE_TAG] },
);

async function tagInputs(keys: string[]) {
  try {
    const e = await loadAllTagInputEntriesCached();
    if (!e) return null;
    return { defs: e.defs, manual: new Map(e.manual), firstSeen: new Map(e.firstSeen) };
  } catch (err) {
    console.error("[product-tags] cached tag read failed; using the keyed read:", err);
    return loadTagInputsForKeys(keys);
  }
}

export async function withProductTags(items: GreenwayMenuItem[]): Promise<GreenwayMenuItem[]> {
  if (items.length === 0) return items;
  try {
    const inputs = await tagInputs(items.map((i) => i.id));
    if (!inputs) return items;
    return attachTags(items, { ...inputs, nowMs: new Date().getTime() });
  } catch (err) {
    console.error("[product-tags] withProductTags failed:", err);
    return items;
  }
}
