import "server-only";
/**
 * src/lib/inventory/lot-live-price-server.ts  (R74 S24)
 *
 * Bulk loader for the inventory table's live menu price: the same variant
 * the lot page reads (price-write-store getLotAfterTaxPrice), for every lot
 * in one pass. The decision is made by the pure lot-live-price-core, which
 * delegates to resolveLotVariant (the lot page's rule).
 *
 * Reads are chunked AND paged (chunked-in.ts), so nothing is silently cut at
 * PostgREST's 1,000-row cap. Completeness is REPORTED: any failed read
 * returns `complete: false`, the page shows a notice and the export refuses
 * (503) rather than ship blanks that look like "no price".
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { chunkedIn, MENU_READ_CONCURRENCY } from "@/lib/supabase/chunked-in";
import { getPublishedVersion } from "@/lib/pos/menu-version";
import { ONBOARDED_VARIANT_SUFFIX } from "@/lib/inventory/price-variant-match-core";
import { buildLivePriceIndex, type LivePrice, type PriceCard, type PriceVariant } from "@/lib/inventory/lot-live-price-core";

export async function loadLotLivePrices(
  keys: ReadonlyArray<string | null | undefined>,
): Promise<{ index: Map<string, LivePrice>; complete: boolean }> {
  const unique = Array.from(new Set(keys.map((k) => (k ?? "").trim()).filter((k) => k.length > 0)));
  if (!isSupabaseServiceConfigured || unique.length === 0) return { index: new Map(), complete: true };
  let failed = false;
  try {
    const published = await getPublishedVersion();
    if (!published) return { index: new Map(), complete: true };
    const admin = createSupabaseAdminClient();

    // 1) Cards on the published menu whose source_item_id is a lot key.
    const cards = await chunkedIn<string, PriceCard>(
      unique,
      async (chunk, from, to) => {
        const { data, error } = await admin
          .from("menu_items")
          .select("id, source_item_id")
          .eq("menu_version_id", published.id)
          .in("source_item_id", chunk)
          .order("id", { ascending: true })
          .range(from, to);
        if (error) {
          console.error("[lot-live-price] cards read error:", error.message);
          failed = true;
          return [];
        }
        return (data as PriceCard[] | null) ?? [];
      },
      { chunkSize: 300, concurrency: MENU_READ_CONCURRENCY },
    );

    // 2) Intake variants `${key}-onboarded` (may sit on a mastered sibling's card).
    const onboardedIds = unique.map((k) => `${k}${ONBOARDED_VARIANT_SUFFIX}`);
    const onboardedAll = await chunkedIn<string, PriceVariant>(
      onboardedIds,
      async (chunk, from, to) => {
        const { data, error } = await admin
          .from("menu_variants")
          .select("id, menu_item_id, source_variant_id, price_minor_units")
          .in("source_variant_id", chunk)
          .order("id", { ascending: true })
          .range(from, to);
        if (error) {
          console.error("[lot-live-price] onboarded variants read error:", error.message);
          failed = true;
          return [];
        }
        return (data as PriceVariant[] | null) ?? [];
      },
      { chunkSize: 300, concurrency: MENU_READ_CONCURRENCY },
    );

    // Keep only intake variants whose card is on the PUBLISHED version
    // (staged and archived versions carry the same source_variant_id).
    const cardIds = new Set(cards.map((c) => c.id));
    const foreignItemIds = Array.from(new Set(onboardedAll.map((v) => v.menu_item_id).filter((id) => !cardIds.has(id))));
    const publishedForeign = new Set<string>();
    if (foreignItemIds.length > 0) {
      const rows = await chunkedIn<string, { id: string }>(
        foreignItemIds,
        async (chunk, from, to) => {
          const { data, error } = await admin
            .from("menu_items")
            .select("id")
            .eq("menu_version_id", published.id)
            .in("id", chunk)
            .order("id", { ascending: true })
            .range(from, to);
          if (error) {
            console.error("[lot-live-price] sibling cards read error:", error.message);
            failed = true;
            return [];
          }
          return (data as { id: string }[] | null) ?? [];
        },
        { chunkSize: 300, concurrency: MENU_READ_CONCURRENCY },
      );
      for (const r of rows) publishedForeign.add(r.id);
    }
    const onboarded = onboardedAll.filter((v) => cardIds.has(v.menu_item_id) || publishedForeign.has(v.menu_item_id));

    // 3) Every variant of the matched cards (the import fallback).
    const cardVariants = cardIds.size
      ? await chunkedIn<string, PriceVariant>(
          Array.from(cardIds),
          async (chunk, from, to) => {
            const { data, error } = await admin
              .from("menu_variants")
              .select("id, menu_item_id, source_variant_id, price_minor_units")
              .in("menu_item_id", chunk)
              .order("id", { ascending: true })
              .range(from, to);
            if (error) {
              console.error("[lot-live-price] card variants read error:", error.message);
              failed = true;
              return [];
            }
            return (data as PriceVariant[] | null) ?? [];
          },
          { chunkSize: 200, concurrency: MENU_READ_CONCURRENCY },
        )
      : [];

    if (failed) return { index: new Map(), complete: false };
    const byId = new Map<string, PriceVariant>();
    for (const v of [...onboarded, ...cardVariants]) byId.set(v.id, v);
    return { index: buildLivePriceIndex(unique, cards, Array.from(byId.values())), complete: true };
  } catch (err) {
    console.error("[lot-live-price] load failed:", err);
    return { index: new Map(), complete: false };
  }
}
