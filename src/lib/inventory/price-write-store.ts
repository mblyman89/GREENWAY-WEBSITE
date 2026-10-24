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
 * R74 S30: a lot may now carry its own menu SIZE (inventory_lots.
 * menu_source_variant_id, migration 0294). Callers pass the lot as a
 * LotPriceTarget; the linked size is used first, so one size of a multi-size
 * Cultivera card can be priced without onboarding. Editing a size changes the
 * price of that size for every lot that sells as it (it is one menu price).
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
import { chunkedIn, pagedAll } from "@/lib/supabase/chunked-in";
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
 * R74 S30: what identifies a lot's price. The card key (pos_product_key) plus,
 * when the lot is linked to a size (inventory_lots.menu_source_variant_id,
 * migration 0294), that size. A bare string is a key with no link.
 */
export type LotPriceTarget =
  | string
  | null
  | undefined
  | { posProductKey: string | null | undefined; menuSourceVariantId?: string | null };

function targetParts(t: LotPriceTarget): { key: string; linked: string | null } {
  if (t && typeof t === "object") {
    return { key: (t.posProductKey ?? "").trim(), linked: (t.menuSourceVariantId ?? "").trim() || null };
  }
  return { key: (t ?? "").trim(), linked: null };
}

/**
 * How a lot maps to a menu variant on one version.
 *  - "linked": R74 S30 - the lot's own size (menu_source_variant_id) on its card.
 *  - "onboarded": the intake variant (source_variant_id = "${key}-onboarded").
 *  - "single-card": no -onboarded variant, but the lot's card
 *    (menu_items.source_item_id = key) has exactly ONE variant - safe to edit.
 *  - "ambiguous": the card has MULTIPLE variants and the lot is not linked to
 *    one, so we can't tell which one this lot is. Refuse (never guess a price);
 *    the lot page offers "pick this lot's size", which sets the link.
 *  - "none": the lot isn't on this version's menu at all.
 *
 * WHY the fallback exists (T-327 Slice 3): Cultivera MENU-IMPORT variants are
 * keyed `${itemId}-${hash}` (transform.ts toMenuItem), NOT `-onboarded`. A
 * lot's pos_product_key ALWAYS equals its card's menu_items.source_item_id
 * (both are `pos-${stableId(identityKey)}`), so the card is still findable.
 */
export type LotVariantMatch =
  | { kind: "linked" | "onboarded" | "single-card"; variant: MenuVariantRow; cardVariants: MenuVariantRow[] }
  | { kind: "ambiguous"; variantCount: number; cardVariants: MenuVariantRow[] }
  | { kind: "none" };

/**
 * Locate the single menu_variant for one lot on one version. Read-only.
 *
 * R74 S30: no longer reads every item id of the version first (that read was
 * unpaged, so past 1,000 cards PostgREST cut it short and an -onboarded
 * variant on a later card was "not found"). The -onboarded candidates are
 * found by their exact source id (a handful of rows across all versions) and
 * then kept only when their card is on THIS version.
 */
export async function findLotVariantOnVersion(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  versionId: string,
  target: LotPriceTarget,
): Promise<LotVariantMatch> {
  const { key, linked } = targetParts(target);
  if (!key) return { kind: "none" };

  // 1) The intake `-onboarded` candidate(s) for this key, on this version.
  const onboardedId = `${key}${ONBOARDED_VARIANT_SUFFIX}`;
  // Archived versions keep copies of the same source id, so page the read
  // (never a silent cap) and keep only the copy whose card is on this version.
  const obAll = await pagedAll<MenuVariantRow>(async (from, to) => {
    const { data, error } = await admin
      .from("menu_variants")
      .select("*")
      .eq("source_variant_id", onboardedId)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) throw new Error(`find onboarded variant: ${error.message}`);
    return (data as MenuVariantRow[] | null) ?? [];
  });
  let onboarded: MenuVariantRow[] = [];
  if (obAll.length > 0) {
    const onVersion = await chunkedIn<string, { id: string }>(
      obAll.map((v) => v.menu_item_id),
      async (chunk, from, to) => {
        const { data, error } = await admin
          .from("menu_items")
          .select("id")
          .eq("menu_version_id", versionId)
          .in("id", chunk)
          .order("id", { ascending: true })
          .range(from, to);
        if (error) throw new Error(`check onboarded card version: ${error.message}`);
        return (data as { id: string }[] | null) ?? [];
      },
    );
    const ids = new Set(onVersion.map((r) => r.id));
    onboarded = obAll.filter((v) => ids.has(v.menu_item_id));
  }

  // 2) The card's variants: the card is found by source_item_id = key.
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
      .in("menu_item_id", cardIds)
      .order("sort_order", { ascending: true });
    if (vErr) throw new Error(`load card variants: ${vErr.message}`);
    cardVariants.push(...((vRows as MenuVariantRow[] | null) ?? []));
  }

  // 3) The PURE core decides (single source of truth); map the id back.
  const byId = new Map<string, MenuVariantRow>();
  for (const v of [...onboarded, ...cardVariants]) byId.set(v.id, v);
  const decision = resolveLotVariant(key, onboarded, cardVariants, linked);
  if (decision.kind === "ambiguous") {
    return { kind: "ambiguous", variantCount: decision.variantCount, cardVariants };
  }
  if (decision.kind === "none") return { kind: "none" };
  const variant = byId.get(decision.variantId);
  if (!variant) return { kind: "none" };
  return { kind: decision.kind, variant, cardVariants };
}

/** One size of a lot's card, for the lot page's "pick this lot's size". */
export type LotCardSize = { sourceVariantId: string; label: string; priceMinor: number; medical: boolean };

/**
 * R74 S30: everything the lot page needs about this lot's price on the
 * PUBLISHED menu, in one read.
 *  - "priced": the lot's variant is known (`kind` says how). priceMinor may be
 *    0 (a Cultivera product with no price): the owner can still set one.
 *  - "ambiguous": several sizes and the lot isn't linked to one: `sizes`
 *    lists them so the owner can pick.
 *  - "not-on-menu": no published card for this key.
 *  - "unavailable": no key, no DB, or the read failed (never shown as "$0").
 */
export type LotPriceState =
  | { status: "priced"; kind: "linked" | "onboarded" | "single-card"; priceMinor: number; sizeLabel: string; sizes: LotCardSize[] }
  | { status: "ambiguous"; sizes: LotCardSize[] }
  | { status: "not-on-menu" }
  | { status: "unavailable"; reason: string };

function toSizes(rows: MenuVariantRow[]): LotCardSize[] {
  return rows.map((v) => ({
    sourceVariantId: v.source_variant_id,
    label: v.label && v.label !== "each" ? v.label : "each",
    priceMinor: v.price_minor_units,
    medical: v.medical === true,
  }));
}

export async function getLotPriceState(target: LotPriceTarget): Promise<LotPriceState> {
  const { key } = targetParts(target);
  if (!key) return { status: "unavailable", reason: "no-key" };
  if (!isSupabaseServiceConfigured) return { status: "unavailable", reason: "no-db" };
  try {
    const published = await getPublishedVersion();
    if (!published) return { status: "not-on-menu" };
    const admin = createSupabaseAdminClient();
    const match = await findLotVariantOnVersion(admin, published.id, target);
    if (match.kind === "none") return { status: "not-on-menu" };
    if (match.kind === "ambiguous") return { status: "ambiguous", sizes: toSizes(match.cardVariants) };
    const label = match.variant.label && match.variant.label !== "each" ? match.variant.label : "each";
    return { status: "priced", kind: match.kind, priceMinor: match.variant.price_minor_units, sizeLabel: label, sizes: toSizes(match.cardVariants) };
  } catch (err) {
    console.error("[price-write-store] getLotPriceState failed:", err);
    return { status: "unavailable", reason: "read-failed" };
  }
}

/**
 * Read the CURRENT after-tax (out-the-door) price for one lot from the
 * published menu - the price of ITS variant (the linked size, the intake
 * variant, or a one-size card). Null when there's no published price, the
 * card is multi-size and the lot isn't linked, or the menu DB isn't
 * configured. Read-only.
 */
export async function getLotAfterTaxPrice(target: LotPriceTarget): Promise<number | null> {
  const st = await getLotPriceState(target);
  return st.status === "priced" ? st.priceMinor : null;
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
  target: LotPriceTarget,
  afterTaxMinor: number,
): Promise<PriceWriteVersionResult> {
  // Locate this lot's variant on this version. Intake lots match the
  // `-onboarded` id; import lots fall back to the card's source_item_id
  // (single-variant cards only — a multi-variant card is ambiguous and refused).
  const match = await findLotVariantOnVersion(admin, versionId, target);
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
  const variant = match.variant;

  // 3) Update ONLY this variant's price. Never touches siblings.
  const { error: upErr } = await admin
    .from("menu_variants")
    .update({ price_minor_units: afterTaxMinor })
    .eq("id", variant.id);
  if (upErr) throw new Error(`update variant (${status}): ${upErr.message}`);

  // 4) Re-derive the parent card's "starting at" rollup = MIN over its
  //    variants (mirrors intake-mastering-core). Load the card's variants
  //    fresh (so our just-written price is included) and pick the cheapest.
  const { data: siblingRows, error: sibErr } = await admin
    .from("menu_variants")
    .select("id, price_minor_units, label, sort_order")
    .eq("menu_item_id", variant.menu_item_id)
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
      .eq("id", variant.menu_item_id);
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
  target: LotPriceTarget,
  afterTaxMinor: number,
): Promise<PriceWriteResult> {
  const { key } = targetParts(target);
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
        await updateVariantPriceOnVersion(admin, published.id, "published", target, afterTaxMinor),
      );
    }
    for (const v of staged) {
      versions.push(
        await updateVariantPriceOnVersion(admin, v.id, "staged", target, afterTaxMinor),
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
            "This product has several sizes on one menu card and this lot isn't linked to one yet, so we can't tell which price to change. Pick this lot's size in \"Which size is this lot?\" on this page, then set the price.",
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
