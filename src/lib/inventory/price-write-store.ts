/**
 * src/lib/inventory/price-write-store.ts  (T-324)
 *
 * The WRITE path for the Inventory Detail after-tax price correction. Given a
 * lot's POS product key + the new after-tax price, it updates the price for
 * EXACTLY that one lot's menu variant — and NOTHING else — on every LIVE menu
 * version (published + any staged), then re-derives its parent card's
 * "starting at" rollup so the card stays truthful without touching any sibling
 * variant's price.
 *
 * WHY THIS IS SAFE (verified, never guessed):
 *  - A lot maps 1:1 to a menu VARIANT via
 *    `source_variant_id = "${lot.pos_product_key}-onboarded"` (variant-lot-core
 *    + draft-injection-core). We look the variant up by that exact key, so we
 *    can only ever hit one lot's price.
 *  - Mastering makes sibling lots share ONE card (menu_item) but each keeps its
 *    OWN variant price. We update only THIS variant, never a sibling.
 *  - A card's `menu_items.price_minor_units` is a DISPLAY "starting at" rollup
 *    set to the CHEAPEST variant (intake-mastering-core:606). After changing a
 *    variant we recompute min(variants) so the card advertises the real
 *    cheapest option — a display re-derivation, not a sibling price write.
 *  - Single-lot cards: the variant key equals the card key and the card price
 *    equals the (only) variant price, so behaviour is byte-identical to before.
 *
 * All prices are TAX-INCLUSIVE ("out-the-door"), stored in minor units.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getPublishedVersion, listIntakeStagedVersions } from "@/lib/pos/menu-version";
import { formatMoney } from "@/lib/pos/format";
import { ONBOARDED_VARIANT_SUFFIX } from "@/lib/pos/variant-lot-core";
import type { MenuVariantRow } from "@/lib/pos/db-types";

export type PriceWriteVersionResult = {
  versionId: string;
  status: string;
  /** The variant we updated, or null if this version had no such variant. */
  variantFound: boolean;
  /** The card price we re-derived, or null when we didn't touch a card. */
  cardRepriced: number | null;
};

export type PriceWriteResult =
  | {
      ok: true;
      /** Per-version outcomes (published first, then staged). */
      versions: PriceWriteVersionResult[];
      /** How many variants we actually updated across all live versions. */
      variantsUpdated: number;
    }
  | { ok: false; error: string };

/**
 * Read the CURRENT after-tax (out-the-door) price for one lot from the
 * published menu — the price of ITS variant
 * (source_variant_id = "${pos_product_key}-onboarded"), NOT the card's
 * "starting at" rollup. Returns null when there's no published price yet (not
 * onboarded/published) or the menu DB isn't configured. Read-only.
 */
export async function getLotAfterTaxPrice(
  posProductKey: string | null | undefined,
): Promise<number | null> {
  const key = (posProductKey ?? "").trim();
  if (!key || !isSupabaseServiceConfigured) return null;
  try {
    const published = await getPublishedVersion();
    if (!published) return null;
    const admin = createSupabaseAdminClient();
    const { data: itemRows, error: itemErr } = await admin
      .from("menu_items")
      .select("id")
      .eq("menu_version_id", published.id);
    if (itemErr) return null;
    const itemIds = ((itemRows as { id: string }[] | null) ?? []).map((r) => r.id);
    if (itemIds.length === 0) return null;

    const sourceVariantId = `${key}${ONBOARDED_VARIANT_SUFFIX}`;
    const CHUNK = 200;
    for (let i = 0; i < itemIds.length; i += CHUNK) {
      const slice = itemIds.slice(i, i + CHUNK);
      const { data: vRows, error: vErr } = await admin
        .from("menu_variants")
        .select("price_minor_units")
        .eq("source_variant_id", sourceVariantId)
        .in("menu_item_id", slice)
        .limit(1);
      if (vErr) return null;
      const rows = (vRows as { price_minor_units: number }[] | null) ?? [];
      if (rows.length > 0) return rows[0].price_minor_units;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Update ONE lot's variant price on one specific menu version. Returns whether
 * the variant existed on that version and (if so) the re-derived card price.
 * Pure-ish: all effects are scoped to the single variant + its parent card.
 */
async function updateVariantPriceOnVersion(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  versionId: string,
  status: string,
  posProductKey: string,
  afterTaxMinor: number,
): Promise<PriceWriteVersionResult> {
  const sourceVariantId = `${posProductKey}${ONBOARDED_VARIANT_SUFFIX}`;

  // 1) Load every item id on this version (variants link via menu_item_id, not
  //    a version column), so we can scope the variant lookup to THIS version.
  const { data: itemRows, error: itemErr } = await admin
    .from("menu_items")
    .select("id")
    .eq("menu_version_id", versionId);
  if (itemErr) throw new Error(`load items (${status}): ${itemErr.message}`);
  const itemIds = ((itemRows as { id: string }[] | null) ?? []).map((r) => r.id);
  if (itemIds.length === 0) {
    return { versionId, status, variantFound: false, cardRepriced: null };
  }

  // 2) Find THIS lot's variant by its encoded key, scoped to this version's
  //    items. Chunked .in() to stay under URL limits (same pattern as
  //    getVersionItems). There is at most one such variant per version.
  const CHUNK = 200;
  let target: MenuVariantRow | null = null;
  for (let i = 0; i < itemIds.length && !target; i += CHUNK) {
    const slice = itemIds.slice(i, i + CHUNK);
    const { data: vRows, error: vErr } = await admin
      .from("menu_variants")
      .select("*")
      .eq("source_variant_id", sourceVariantId)
      .in("menu_item_id", slice);
    if (vErr) throw new Error(`find variant (${status}): ${vErr.message}`);
    const rows = (vRows as MenuVariantRow[] | null) ?? [];
    if (rows.length > 0) target = rows[0];
  }
  if (!target) {
    // This lot isn't on this version's menu (e.g. staged version that predates
    // the onboarding, or a hidden/removed card). Nothing to do here.
    return { versionId, status, variantFound: false, cardRepriced: null };
  }

  // 3) Update ONLY this variant's price. Never touches siblings.
  const { error: upErr } = await admin
    .from("menu_variants")
    .update({ price_minor_units: afterTaxMinor })
    .eq("id", target.id);
  if (upErr) throw new Error(`update variant (${status}): ${upErr.message}`);

  // 4) Re-derive the parent card's "starting at" rollup = MIN over its
  //    variants (mirrors intake-mastering-core). Load the card's variants
  //    fresh (so our just-written price is included) and pick the cheapest.
  const { data: siblingRows, error: sibErr } = await admin
    .from("menu_variants")
    .select("id, price_minor_units, label, sort_order")
    .eq("menu_item_id", target.menu_item_id)
    .order("sort_order", { ascending: true });
  if (sibErr) throw new Error(`load siblings (${status}): ${sibErr.message}`);
  const siblings = (siblingRows as { price_minor_units: number; label: string }[] | null) ?? [];

  let cardRepriced: number | null = null;
  if (siblings.length > 0) {
    const cheapest = siblings.reduce((min, v) =>
      v.price_minor_units < min.price_minor_units ? v : min,
    );
    const labelPart = cheapest.label === "each" ? "" : cheapest.label;
    const priceLabel = [formatMoney(cheapest.price_minor_units), labelPart].filter(Boolean).join(" ");
    const { error: cardErr } = await admin
      .from("menu_items")
      .update({
        price_minor_units: cheapest.price_minor_units,
        price_label: priceLabel,
      })
      .eq("id", target.menu_item_id);
    if (cardErr) throw new Error(`reprice card (${status}): ${cardErr.message}`);
    cardRepriced = cheapest.price_minor_units;
  }

  return { versionId, status, variantFound: true, cardRepriced };
}

/**
 * Apply an after-tax price correction for one lot across all LIVE menu
 * versions: the published version (customers see it immediately, per the
 * owner's instruction) plus any staged intake versions (so a pending publish
 * carries the same corrected price). Returns a per-version report. Never
 * throws to the caller — errors come back as { ok:false }.
 */
export async function applyLotAfterTaxPrice(
  posProductKey: string,
  afterTaxMinor: number,
): Promise<PriceWriteResult> {
  const key = (posProductKey ?? "").trim();
  if (!key) return { ok: false, error: "This lot isn't linked to a POS product key yet, so it has no menu price to edit." };
  if (!Number.isInteger(afterTaxMinor) || afterTaxMinor <= 0) {
    return { ok: false, error: "Internal: the price to write must be a positive whole number of cents." };
  }
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "The menu database isn't configured in this environment, so the price can't be saved." };
  }

  try {
    const admin = createSupabaseAdminClient();
    const [published, staged] = await Promise.all([
      getPublishedVersion(),
      listIntakeStagedVersions(30),
    ]);

    const versions: PriceWriteVersionResult[] = [];
    if (published) {
      versions.push(
        await updateVariantPriceOnVersion(admin, published.id, "published", key, afterTaxMinor),
      );
    }
    for (const v of staged) {
      versions.push(
        await updateVariantPriceOnVersion(admin, v.id, "staged", key, afterTaxMinor),
      );
    }

    const variantsUpdated = versions.filter((v) => v.variantFound).length;
    if (variantsUpdated === 0) {
      return {
        ok: false,
        error:
          "Couldn't find this product on the live menu yet. A price only exists once the product has been published to the menu — publish it first, then set the price here.",
      };
    }
    return { ok: true, versions, variantsUpdated };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Saving the price failed: ${msg}` };
  }
}
