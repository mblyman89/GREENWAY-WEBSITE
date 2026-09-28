/**
 * src/lib/enrichment/enrichment-manifest.ts  (S22 - server reads for the
 * Enrichment list's invoice/manifest filter and "newest" sort)
 *
 * TWO bounded, named-column reads over the cards already on the page:
 *   1. inventory_lots (pos_product_key, manifest_id, vendor_id, created_at,
 *      received_on) for every lot key the cards carry (their own key + each
 *      `<lotKey>-onboarded` variant - vendor-identity-core cardLotKeys), via
 *      the indexed pos_product_key (0023 inventory_lots_poskey_idx);
 *   2. inbound_manifests (the S14 picker columns) for the deliveries those
 *      lots came from, by primary key.
 * Both are chunked + paged (chunkedIn), so neither can be silently capped at
 * PostgREST's 1000 rows. No writes, no new egress, no polls.
 *
 * NEVER GUESS: any failed page returns null. The page then turns the new
 * filters off and says so (ATTRIBUTION_UNAVAILABLE_NOTE) instead of showing
 * a list that is short for a reason nobody can see.
 *
 * Pre-migration safety: received_on arrives with 0214, which the owner
 * applies by hand. If the lot read says that column is unknown, the read is
 * retried ONCE without it (Cultivera receipt dates then read as unknown,
 * which is the truth for that database).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { chunkedIn, MENU_READ_CONCURRENCY } from "@/lib/supabase/chunked-in";
import { cardLotKeys } from "@/lib/inventory/vendor-identity-core";
import type { PickerManifestRow } from "@/lib/catalog/onboarding-list-core";
import {
  attributeCards,
  type AttributionCard,
  type AttributionLot,
  type CardAttribution,
} from "@/lib/enrichment/enrichment-manifest-core";

export const ATTRIBUTION_LOT_COLUMNS = "id, pos_product_key, manifest_id, vendor_id, created_at, received_on";
export const ATTRIBUTION_LOT_COLUMNS_PRE_0214 = "id, pos_product_key, manifest_id, vendor_id, created_at";
export const ATTRIBUTION_MANIFEST_COLUMNS =
  "id, manifest_number, vendor_id, vendor_label, transfer_date, received_at, accepted_at, status";

export type EnrichmentAttribution = {
  attrs: Map<string, CardAttribution>;
  manifests: PickerManifestRow[];
};

type DbError = { code?: unknown; message?: unknown } | null | undefined;

/** True only when the error says received_on (0214) is an unknown column. */
export function isMissingReceivedOnError(error: DbError): boolean {
  if (!error) return false;
  const msg = String(error.message ?? "").toLowerCase();
  const signalled =
    error.code === "42703" || error.code === "PGRST204" || /column .* does not exist|could not find the .* column/.test(msg);
  return signalled && /\breceived_on\b/.test(msg);
}

type LotRow = AttributionLot & { id: string };

async function readLots(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  keys: string[],
  columns: string,
): Promise<{ rows: LotRow[]; error: DbError }> {
  let firstError: DbError = null;
  const rows = await chunkedIn<string, LotRow>(
    keys,
    async (chunk, from, to) => {
      if (firstError) return [];
      const { data, error } = await admin
        .from("inventory_lots")
        .select(columns)
        .in("pos_product_key", chunk)
        .order("id", { ascending: true })
        .range(from, to);
      if (error) {
        firstError = error;
        return [];
      }
      return (data as unknown as LotRow[] | null) ?? [];
    },
    { concurrency: MENU_READ_CONCURRENCY },
  );
  return { rows, error: firstError };
}

/**
 * Attribute the live cards to the deliveries their lots came from. Returns
 * null when Supabase is not configured or any read failed.
 */
export async function readEnrichmentAttribution(
  cards: readonly AttributionCard[],
): Promise<EnrichmentAttribution | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const keys: string[] = [];
    const seen = new Set<string>();
    for (const c of cards) {
      for (const k of cardLotKeys(c)) {
        if (!seen.has(k)) {
          seen.add(k);
          keys.push(k);
        }
      }
    }
    if (keys.length === 0) return { attrs: attributeCards(cards, [], []), manifests: [] };

    let lots = await readLots(admin, keys, ATTRIBUTION_LOT_COLUMNS);
    if (lots.error && isMissingReceivedOnError(lots.error)) {
      lots = await readLots(admin, keys, ATTRIBUTION_LOT_COLUMNS_PRE_0214);
      lots.rows = lots.rows.map((r) => ({ ...r, received_on: null }));
    }
    if (lots.error) {
      console.error("[enrichment-manifest] lot read failed:", String((lots.error as { message?: unknown }).message ?? ""));
      return null;
    }

    const manifestIds = [
      ...new Set(
        lots.rows
          .map((r) => (typeof r.manifest_id === "string" ? r.manifest_id.trim().toLowerCase() : ""))
          .filter(Boolean),
      ),
    ];
    let manifestError: DbError = null;
    const manifests =
      manifestIds.length === 0
        ? []
        : await chunkedIn<string, PickerManifestRow>(
            manifestIds,
            async (chunk, from, to) => {
              if (manifestError) return [];
              const { data, error } = await admin
                .from("inbound_manifests")
                .select(ATTRIBUTION_MANIFEST_COLUMNS)
                .in("id", chunk)
                .order("id", { ascending: true })
                .range(from, to);
              if (error) {
                manifestError = error;
                return [];
              }
              return (data as unknown as PickerManifestRow[] | null) ?? [];
            },
            { concurrency: MENU_READ_CONCURRENCY },
          );
    if (manifestError) {
      console.error("[enrichment-manifest] manifest read failed:", String((manifestError as { message?: unknown }).message ?? ""));
      return null;
    }
    return { attrs: attributeCards(cards, lots.rows, manifests), manifests };
  } catch (err) {
    console.error("[enrichment-manifest] attribution threw:", err);
    return null;
  }
}
