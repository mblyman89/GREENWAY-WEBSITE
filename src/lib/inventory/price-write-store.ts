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
import {
  ONBOARDED_VARIANT_SUFFIX,
  resolveLotVariant,
} from "@/lib/inventory/price-variant-match-core";
import type { MenuVariantRow } from "@/lib/pos/db-types";

export type PriceWriteVersionResult = {
  versionId: string;
  status: string;
  /** The variant we updated, or null if this version had no such variant. */
  variantFound: boolean;
  /** The card price we re-derived, or null when we didn't touch a card. */
  cardRepriced: number | null;
  /** True when the lot's card has MULTIPLE variants and no -onboarded id, so we
   *  refused to guess which variant to edit. */
  ambiguous?: boolean;
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
 * How a lot maps to a menu variant on one version.
 *  - "onboarded": the intake variant (source_variant_id = "${key}-onboarded").
 *  - "single-card": no -onboarded variant, but the lot's card
 *    (menu_items.source_item_id = key) has exactly ONE variant — safe to edit.
 *  - "ambiguous": the card has MULTIPLE variants and no -onboarded id, so we
 *    can't tell which one this lot is from pos_product_key alone. Refuse
 *    (never guess a price).
 *  - "none": the lot isn't on this version's menu at all.
 *
 * WHY the fallback exists (T-327 Slice 3): Cultivera MENU-IMPORT variants are
 * keyed `${itemId}-${hash}` (transform.ts:1011), NOT `-onboarded`. But a lot's
 * pos_product_key ALWAYS equals its card's menu_items.source_item_id (both are
 * `pos-${stableId(identityKey)}` — transform.ts:1179 vs :982/persistMenuItems).
 * So we can still locate the card by source_item_id and, when it's a single-
 * variant card (the overwhelming majority), edit that variant.
 */
type LotVariantMatch =
  | { kind: "onboarded" | "single-card"; variant: MenuVariantRow }
  | { kind: "ambiguous"; variantCount: number }
  | { kind: "none" };

/** Chunked helper: fetch item ids for a version. */
async function itemIdsForVersion(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  versionId: string,
): Promise<string[]> {
  const { data, error } = await admin
    .from("menu_items")
    .select("id")
    .eq("menu_version_id", versionId);
  if (error) throw new Error(`load items: ${error.message}`);
  return ((data as { id: string }[] | null) ?? []).map((r) => r.id);
}

/**
 * Locate the single menu_variant for one lot on one version. Tries the intake
 * `-onboarded` id first (fast path, intake lots), then falls back to the card
 * matched by source_item_id (import lots). Read-only.
 */
async function findLotVariantOnVersion(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  versionId: string,
  key: string,
): Promise<LotVariantMatch> {
  const itemIds = await itemIdsForVersion(admin, versionId);
  if (itemIds.length === 0) return { kind: "none" };

  const CHUNK = 200;

  // 1) Fetch the intake `-onboarded` candidate(s) for this key.
  const onboardedId = `${key}${ONBOARDED_VARIANT_SUFFIX}`;
  const onboarded: MenuVariantRow[] = [];
  for (let i = 0; i < itemIds.length; i += CHUNK) {
    const slice = itemIds.slice(i, i + CHUNK);
    const { data, error } = await admin
      .from("menu_variants")
      .select("*")
      .eq("source_variant_id", onboardedId)
      .in("menu_item_id", slice);
    if (error) throw new Error(`find onboarded variant: ${error.message}`);
    onboarded.push(...((data as MenuVariantRow[] | null) ?? []));
  }

  // 2) Fetch the card's variants (import fallback): find the card by
  //    source_item_id = key (a lot's pos_product_key always equals its card's
  //    source_item_id). One card per source_item_id in practice, but gather
  //    across all matches defensively.
  const cardVariants: MenuVariantRow[] = [];
  const { data: cardRows, error: cardErr } = await admin
    .from("menu_items")
    .select("id")
    .eq("menu_version_id", versionId)
    .eq("source_item_id", key);
  if (cardErr) throw new Error(`find card: ${cardErr.message}`);
  const cardIds = ((cardRows as { id: string }[] | null) ?? []).map((r) => r.id);
  if (cardIds.length > 0) {
    const { data: vRows, error: vErr } = await admin
      .from("menu_variants")
      .select("*")
      .in("menu_item_id", cardIds);
    if (vErr) throw new Error(`load card variants: ${vErr.message}`);
    cardVariants.push(...((vRows as MenuVariantRow[] | null) ?? []));
  }

  // 3) Make the decision with the PURE core (single source of truth), then map
  //    the chosen variant id back to its full row.
  const byId = new Map<string, MenuVariantRow>();
  for (const v of [...onboarded, ...cardVariants]) byId.set(v.id, v);
  const decision = resolveLotVariant(key, onboarded, cardVariants);
  if (decision.kind === "ambiguous") {
    return { kind: "ambiguous", variantCount: decision.variantCount };
  }
  if (decision.kind === "none") return { kind: "none" };
  const variant = byId.get(decision.variantId);
  if (!variant) return { kind: "none" };
  return { kind: decision.kind, variant };
}

/**
 * Read the CURRENT after-tax (out-the-door) price for one lot from the
 * published menu — the price of ITS variant. Intake lots resolve via the
 * `-onboarded` id; import lots resolve via the card's source_item_id (single-
 * variant cards only). Returns null when there's no published price yet, the
 * card is multi-variant/ambiguous, or the menu DB isn't configured. Read-only.
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
    const match = await findLotVariantOnVersion(admin, published.id, key);
    if (match.kind === "onboarded" || match.kind === "single-card") {
      return match.variant.price_minor_units;
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
  // Locate this lot's variant on this version. Intake lots match the
  // `-onboarded` id; import lots fall back to the card's source_item_id
  // (single-variant cards only — a multi-variant card is ambiguous and refused).
  const match = await findLotVariantOnVersion(admin, versionId, posProductKey);
  if (match.kind === "none") {
    // This lot isn't on this version's menu (e.g. staged version that predates
    // the onboarding, or a hidden/removed card). Nothing to do here.
    return { versionId, status, variantFound: false, cardRepriced: null };
  }
  if (match.kind === "ambiguous") {
    // Multiple variants share this card and none is the -onboarded id, so we
    // can't tell which one this lot is. Refuse rather than guess.
    return { versionId, status, variantFound: false, cardRepriced: null, ambiguous: true };
  }
  const target = match.variant;

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
      // Distinguish "not on the menu" from "on the menu but this card has
      // several sizes and we can't tell which one this lot is."
      if (versions.some((v) => v.ambiguous)) {
        return {
          ok: false,
          error:
            "This product has multiple sizes/prices on one menu card, so we can't tell which one this lot's price should change. Edit the price for this size directly on the menu (per-variant editing) instead of on the lot.",
        };
      }
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
