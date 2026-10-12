/**
 * src/lib/menu/product-tags-server.ts - R49 S6 (owner: Michael)
 *
 * Menu overlay: attaches `item.tags` (the owner's tags + the automatic "New"
 * tag) to fully-built menu items. Slots into the overlay chain exactly like
 * withCategoryOverride. One batched read for the whole menu; "now" is read
 * HERE on the server (once per render of a cached page, revalidate = 60) and
 * passed into the pure core, never in a client component render.
 *
 * Degrades to identity (items unchanged, no tags) when Supabase is
 * unconfigured, before migration 0269, or on ANY read error: the public menu
 * must never break because of this optional overlay. NEVER writes.
 */
import "server-only";
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { attachTags } from "@/lib/menu/product-tags-core";
import { loadTagInputsForKeys } from "@/lib/menu/product-tags-store";

export async function withProductTags(items: GreenwayMenuItem[]): Promise<GreenwayMenuItem[]> {
  if (items.length === 0) return items;
  try {
    const inputs = await loadTagInputsForKeys(items.map((i) => i.id));
    if (!inputs) return items;
    return attachTags(items, { ...inputs, nowMs: new Date().getTime() });
  } catch (err) {
    console.error("[product-tags] withProductTags failed:", err);
    return items;
  }
}
