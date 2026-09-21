import "server-only";

/**
 * src/lib/leafly/identity-server.ts  (ROADMAP R1/R3, owner ask 5)
 *
 * Resolve product ids into the identifiers a human actually recognises.
 *
 * ###########################################################################
 * # THE OWNER'S WORDS                                                       #
 * #                                                                        #
 * #   "i don't understand product ids, nor are they a useful way to        #
 * #    identify products for the delete function, as well as the error     #
 * #    messages and fix messages and such, they should not be the product  #
 * #    id, but the names of the product, the barcode, vendor perhaps, just #
 * #    far more ways to identify the products we actually need to get off  #
 * #    the menu."                                                          #
 * ###########################################################################
 *
 * WHY A SEPARATE MODULE AND NOT A FIELD ON `SyndicationItem`
 *
 * The syndication feed is what we SEND to Leafly. Leafly's item contract
 * (`docs/leafly-specs/schemas/v2-items.json`) has no vendor field and no
 * barcode field, so adding them to `SyndicationItem` would mean carrying data
 * to the edge of the network and dropping it there -- and would invite a
 * future maintainer to "helpfully" start transmitting a wholesale vendor name
 * to a public consumer marketplace, which the shop has no business
 * publishing. Identity is a BACK-OFFICE concern: it exists so the owner can
 * recognise a product in an error message. Keeping it out of the feed type is
 * what keeps it out of the payload.
 *
 * WHERE EACH FIELD COMES FROM (verified against the migrations, not assumed)
 *
 *   product_name, brand_name, vendor_name, price_label
 *       -- `public.menu_items`, created in
 *          `supabase/migrations/0002_slice2_pos_import.sql:108-125`.
 *          `vendor_name` is indexed at line 136, so filtering by vendor is
 *          cheap and was clearly always intended.
 *
 *   label (the size, e.g. "3g")
 *       -- `public.menu_variants`.
 *
 *   barcode
 *       -- THERE IS NO BARCODE COLUMN ON `menu_items`. This matters and is
 *          not a detail to paper over. For NON-cannabis goods the barcode is
 *          `noncannabis_products.barcode`. For cannabis the Cultivera barcode
 *          is the lot code, `inventory_lots.lot_code`, reachable by joining
 *          `inventory_lots.pos_product_key = menu_items.source_item_id`.
 *          A product may legitimately have several lots and therefore several
 *          barcodes, so this is a LIST, and an empty list is a truthful
 *          answer -- never a fabricated one.
 *
 * NEVER INVENT. Every field here is nullable and stays null when the source
 * has nothing. A plausible-looking invented barcode is far worse than a blank
 * one: the owner would scan for it, fail to find it, and lose trust in every
 * other number on the screen.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  makeProductIdentity,
  type ProductIdentity,
} from "./product-identity-core";
import type { SendabilityIdentity } from "./sendability-core";

/** How many ids to resolve in one round trip. */
const CHUNK = 200;

/**
 * Look up human identifiers for the given source item ids.
 *
 * @param sourceItemIds `menu_items.source_item_id` values -- the same ids the
 *   syndication feed and the Leafly payload use.
 * @param menuVersionId Restrict to one published menu version when known.
 *
 * Returns a Map keyed by id. Ids that cannot be resolved are simply ABSENT
 * rather than mapped to an empty identity, so a caller can tell "we looked and
 * found nothing" apart from "we never looked".
 *
 * NEVER THROWS. This decorates error messages; if it fails, the caller must
 * still be able to show the underlying error. An identity lookup that takes
 * down the page explaining why a push failed would be a cruel joke.
 */
export async function loadProductIdentities(
  sourceItemIds: readonly string[],
  menuVersionId?: string | null,
): Promise<Map<string, ProductIdentity>> {
  const out = new Map<string, ProductIdentity>();
  const ids = Array.from(
    new Set(
      (sourceItemIds ?? [])
        .map((id) => String(id ?? "").trim())
        .filter((id) => id.length > 0),
    ),
  );
  if (ids.length === 0) return out;

  let supabase: ReturnType<typeof createSupabaseAdminClient>;
  try {
    supabase = createSupabaseAdminClient();
  } catch {
    return out;
  }

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);

    // --- menu_items: name, brand, vendor, price label, category -----------
    let rows: Array<Record<string, unknown>> = [];
    try {
      let q = supabase
        .from("menu_items")
        .select(
          "source_item_id, name, product_name, brand_name, vendor_name, category, strain_name",
        )
        .in("source_item_id", chunk);
      if (typeof menuVersionId === "string" && menuVersionId.length > 0) {
        q = q.eq("menu_version_id", menuVersionId);
      }
      const res = await q;
      rows = (res.data as Array<Record<string, unknown>> | null) ?? [];
    } catch {
      rows = [];
    }

    // --- inventory_lots: the Cultivera barcode (lot code) -----------------
    // Several lots per product is normal, so barcodes accumulate into a list.
    const barcodesByKey = new Map<string, string[]>();
    try {
      const res = await supabase
        .from("inventory_lots")
        .select("pos_product_key, lot_code")
        .in("pos_product_key", chunk);
      for (const r of (res.data as Array<Record<string, unknown>> | null) ?? []) {
        const key = String(r.pos_product_key ?? "").trim();
        const code = String(r.lot_code ?? "").trim();
        if (key.length === 0 || code.length === 0) continue;
        const list = barcodesByKey.get(key);
        if (list === undefined) barcodesByKey.set(key, [code]);
        else if (!list.includes(code)) list.push(code);
      }
    } catch {
      // A missing barcode is reported as missing. It is never guessed.
    }

    for (const row of rows) {
      const id = String(row.source_item_id ?? "").trim();
      if (id.length === 0) continue;
      out.set(
        id,
        makeProductIdentity({
          id,
          name: (row.name as string | null) ?? null,
          productName: (row.product_name as string | null) ?? null,
          brand: (row.brand_name as string | null) ?? null,
          vendor: (row.vendor_name as string | null) ?? null,
          category: (row.category as string | null) ?? null,
          strainName: (row.strain_name as string | null) ?? null,
          barcodes: barcodesByKey.get(id) ?? [],
        }),
      );
    }
  }

  return out;
}

/**
 * Shape used by `sendability-core.triageSendability`.
 *
 * Converted here rather than in the pure core because the core takes zero
 * imports by construction.
 */
export function toSendabilityIdentities(
  identities: Map<string, ProductIdentity>,
): SendabilityIdentity[] {
  return Array.from(identities.values()).map((i) => ({
    id: i.id,
    // Prefer the RAW Cultivera product name: that is the string the owner
    // will recognise from his POS. Fall back to our cleaned card name only
    // when the raw cell is blank.
    productName: i.productName ?? i.name,
    brand: i.brand,
    vendor: i.vendor,
    barcodes: i.barcodes,
    category: i.category,
    // `ProductIdentity` carries no size: a size belongs to a VARIANT, not to
    // a product, and inventing a single "the size" for a multi-size product
    // is precisely the conflation that produced the owner's 1g/3g/5g bug.
    // Left null rather than guessed.
    size: null,
  }));
}
