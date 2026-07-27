/**
 * src/lib/pos/intake-mastering-core.ts
 *
 * Intake product mastering — PURE planner (Option A, Slice 2).
 *
 * WHY: the intake pipeline historically minted ONE menu card per approved
 * onboarding draft (= one card per received lot), so restocks and sibling
 * sizes of the SAME product piled up as duplicate cards. This planner rolls
 * approved drafts up into proper product cards:
 *
 *   • WITHIN-INVOICE ROLLUP — drafts on one manifest that are the same vendor +
 *     website category + product family become ONE card with one variant per
 *     lot/size.
 *   • RESTOCK MERGE — when a group's identity matches exactly ONE live card,
 *     its lots are APPENDED to that card as new variants (a restock or a new
 *     size) instead of spawning a duplicate card.
 *
 * OWNER RULE (vendor axis): rollup identity is the VENDOR, not the brand.
 * WCIA/Cultivera manifests carry the vendor at the DOCUMENT level and no
 * per-line brand at all, and every one of the store's vendors is licensed
 * per-brand ("they are all vendor names"), so vendor + website category +
 * family is the owner's "same product" identity. A blank vendor is never
 * grouped (standalone + warning). Brand, when a manifest DOES carry one, is
 * still stripped from name prefixes so families fold consistently.
 *
 * LOT ACCURACY IS PRESERVED: every variant keeps ITS OWN lot's identity —
 * `source_variant_id = ${lotPosProductKey}-onboarded`, the exact encoding the
 * variant-aware sale path (variant-lot-core, PR #552) resolves for FIFO
 * decrement, CCRS stamping, costs, recalls, and barcode scans. A mastered
 * card therefore sells each size against its own inventory lot.
 *
 * CARD IDENTITY WITHOUT A NEW NAMESPACE: a NEW card's source_item_id is the
 * group's lexicographically-smallest lot key. Intake variants always match
 * the `-onboarded` suffix, so the sale path never falls back to the card key
 * for lot consumption — the card key is just a stable, real identifier (the
 * same scheme the pre-mastering one-card-per-lot path used, so every
 * downstream surface keyed on source_item_id keeps working).
 *
 * NEVER GUESS:
 *   • Eligibility (no key / no category / no price / superseded-by-live) is
 *     decided by the EXISTING, verified `buildDraftInjectionPlan` — this
 *     planner only groups what that planner already accepted, so the
 *     diagnostic vocabulary the review surface shows is unchanged.
 *   • A product family that cannot be derived confidently (name strips to
 *     nothing) is NEVER grouped — standalone card + warning diagnostic.
 *   • A group matching MORE THAN ONE live card is NEVER merged — new card +
 *     warning diagnostic; a human resolves the duplicate cards.
 *   • Hidden live cards and medical-only live cards are never merge targets.
 *
 * FAMILY NORMALIZATION mirrors the Cultivera transform (transform.ts
 * :265-269 collapseKeyPart/titleCase, :734-775 stripVariantNoise/
 * deriveDisplayName/groupingIdentity) so intake groups line up with
 * Cultivera-born card identities for restock matching. ONE deliberate
 * deviation: transform's display-name fallbacks (raw name, then category)
 * are fine for a LABEL but dangerous for an IDENTITY — falling back to the
 * category would merge every unparseable product of a category into one
 * card. Here an unconfident family yields NULL (standalone, never grouped).
 *
 * PURE: no I/O. intake-menu-staging-core composes this into the staged
 * snapshot; its only imports are the equally pure draft-injection-core,
 * variant-lot-core, and format helpers.
 */
import {
  buildDraftInjectionPlan,
  type ApprovedDraftForInjection,
  type DraftEnrichment,
  type InjectionDiagnostic,
  type PlannedInjectedItem,
} from "@/lib/pos/draft-injection-core";
import { lotKeyFromVariantId } from "@/lib/pos/variant-lot-core";
import { formatMoney } from "@/lib/pos/format";

/** A live (carried-forward) card the planner may merge a restock into. */
export type LiveCardCandidate = {
  source_item_id: string;
  name: string;
  brand_name: string;
  vendor_name: string | null;
  category: string;
  strain_name: string | null;
  hidden: boolean;
  variants: { source_variant_id: string; medical: boolean }[];
};

/** One size/lot on a mastered card (sort_order assigned by the composer). */
export type MasteredVariant = {
  source_variant_id: string;
  label: string;
  price_minor_units: number;
  inventory_level: number;
  medical: boolean;
};

/** A NEW card to append to the staged snapshot (may carry several lots). */
export type MasteredNewCard = Omit<PlannedInjectedItem, "variant" | "sort_order"> & {
  variants: MasteredVariant[];
};

export type IntakeMasteringInputs = {
  drafts: ApprovedDraftForInjection[];
  /** source_item_ids already in the snapshot (live cards win, as before). */
  existingKeys: Set<string>;
  enrichmentByDraftId: Map<string, DraftEnrichment>;
  /** The carried-forward live cards (deduped), for restock-merge matching. */
  liveCards: LiveCardCandidate[];
};

/** SLICE 62: per-lot verified facts (for inventory_lots persistence). */
export type LotFactBundle = {
  servings_per_pack: number | null;
  mg_per_serving: number | null;
  package_thc_mg: number | null;
  package_cbd_mg: number | null;
  ratio_label: string | null;
  fact_provenance: Record<string, string>;
};

export type IntakeMasteringPlan = {
  /** New cards to append (within-invoice rollup already applied). */
  newCards: MasteredNewCard[];
  /** Variants to APPEND to live cards, keyed by the card's source_item_id. */
  mergesByCardKey: Map<string, MasteredVariant[]>;
  /**
   * Resolved categories (category + filter_categories) of the merged lots per
   * live card, so the composer can extend the card's filter_categories — e.g.
   * a 5-pack restock merged onto a single-preroll card must stay reachable
   * from the pack browse section too.
   */
  mergeCategoriesByCardKey: Map<string, string[]>;
  diagnostics: InjectionDiagnostic[];
  addedCardCount: number;
  mergedVariantCount: number;
  /**
   * SLICE 62: verified extraction facts per planned lot (keyed by the lot's
   * pos_product_key / source_item_id), so the executor can also persist them
   * on inventory_lots — the golden record lives on the lot, not just the card.
   * Only lots with at least one non-null fact appear here.
   */
  lotFactsByKey: Map<string, LotFactBundle>;
};

// --- Family normalization (mirrors transform.ts :265-269 and :734-775) -----

/**
 * SLICE 49 mirror of transform.ts DOSE_LED_CATEGORIES (owner rule): edible /
 * liquid / topical / tincture / RSO customer names KEEP their mg dose and
 * ratio info ("people will only buy it because it's the ratio or specific
 * cannabinoid they need"). For these categories the mg token is part of the
 * product IDENTITY too — a 10mg single and a 100mg pack are DIFFERENT cards
 * (one card name cannot honestly carry two doses), and a restocked 50mg lot
 * must never merge into a live card named "…100mg".
 */
const DOSE_LED_CATEGORIES = new Set(["edible-solid", "edible-liquid", "topical", "tincture", "rso"]);

/** Categories whose display/family name is the STRAIN (transform.ts :763). */
const STRAIN_LED_CATEGORIES = new Set([
  "flower",
  "popcorn-bud",
  "infused-flower",
  "preroll",
  "preroll-pack",
  "infused-preroll",
  "infused-preroll-pack",
  "blunt",
  "infused-blunt",
  "concentrate",
  "rso",
  "cartridge",
  "disposable-cartridge",
  "trim",
]);

function normalizeWhitespace(value: unknown): string {
  return String(value ?? "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

/** Mirror of transform.ts collapseKeyPart (:267) — identity-safe slug part. */
export function collapseFamilyKeyPart(value: unknown): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

/** Mirror of transform.ts titleCase (:269). */
function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .replace(/\bCbd\b/g, "CBD")
    .replace(/\bThc\b/g, "THC");
}

/**
 * Strip size/pack/form noise from a product name to expose the product
 * FAMILY. Token-for-token mirror of transform.ts stripVariantNoise
 * (:734-753) EXCEPT the display fallbacks: an identity must never fall back
 * to the raw name or the category (that would over-merge), so an
 * unconfident result returns NULL instead.
 */
export function familyFromName(value: string, labels: string | string[], preserveDose = false): string | null {
  let s = normalizeWhitespace(value).replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  for (const label of Array.isArray(labels) ? labels : [labels]) {
    const comparable = normalizeWhitespace(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (comparable) s = s.replace(new RegExp(`^${comparable}\\s*[-:|]?\\s*`, "i"), "");
  }
  // SLICE 49 (mirror of transform.ts stripVariantNoise dose mode): canonicalize the dose
  // spelling first ("100 MG" → "100mg") so identities are stable, then EXCLUDE mg from the
  // size strip so the dose stays part of the family/display for dose-led categories.
  if (preserveDose) s = s.replace(/\b(\d+(?:\.\d+)?)\s*(?:mg|milligram|milligrams)\b/gi, "$1mg");
  const sizeUnitRe = preserveDose
    ? /\b\d+(?:\.\d+)?\s*(?:g|gram|grams|oz|ounce|ounces|ml|milliliter|milliliters|fl\.?\s*oz|fluid\s*ounce|fluidounce)\b/gi
    : /\b\d+(?:\.\d+)?\s*(?:g|gram|grams|mg|milligram|milligrams|oz|ounce|ounces|ml|milliliter|milliliters|fl\.?\s*oz|fluid\s*ounce|fluidounce)\b/gi;
  s = s
    .replace(sizeUnitRe, " ")
    // Numbered pack tokens ("5pk", "3 pack", "2-pack") strip away so a
    // multi-pack lands on the same family as its single form. Safe deviation
    // from transform.ts stripVariantNoise: identity here is computed by THIS
    // function on BOTH sides (intake group and live card), so both fold
    // identically.
    .replace(/\b\d+\s*(?:-\s*)?(?:pk|pack|packs)\b/gi, " ")
    .replace(/\b(?:single|pack|packs|pouch|jar|tin|unit|each)\b/gi, " ")
    .replace(
      /\b(?:pre[- ]?rolls?|infused|blunt|flower|cartridge|disposable|vape|rosin|resin|bho|badder|hash|gummies|edible|beverage|shot|topical)\b/gi,
      " ",
    )
    .replace(/[()\[\]]/g, " ")
    .replace(/\s*[-|/]\s*/g, " ")
    .replace(/\s*:\s*/g, ":")
    .replace(/\s+/g, " ")
    .trim();
  if (!s || s.length < 3) return null; // NOT confident — never group on a guess.
  return titleCase(s);
}

/**
 * Derive the grouping family for a card-ish record (a planned intake item or
 * a live card). Strain-led categories use the strain name (transform.ts
 * :756-768); everything else uses the noise-stripped product name. Returns
 * null when no confident family exists.
 */
export function deriveFamily(input: {
  category: string;
  /** The grouping vendor — always stripped from name prefixes. */
  vendor: string;
  /** Optional brand — also stripped from name prefixes when present. */
  brand?: string | null;
  name: string;
  strainName: string | null;
}): { family: string; display: string } | null {
  const strain = normalizeWhitespace(input.strainName).replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  if (STRAIN_LED_CATEGORIES.has(input.category) && strain) {
    return { family: collapseFamilyKeyPart(strain), display: strain };
  }
  // SLICE 49: dose-led categories keep the mg dose in the family AND display —
  // matching the Cultivera transform's dose-preserving display names so intake
  // restocks still line up with live cards, and different doses never merge.
  const stripped = familyFromName(input.name, [input.brand ?? "", input.vendor], DOSE_LED_CATEGORIES.has(input.category));
  if (!stripped) return null;
  return { family: collapseFamilyKeyPart(stripped), display: stripped };
}

/**
 * PACK AXIS (owner rule): multi-pack prerolls / infused prerolls / blunts are
 * the SAME PRODUCT as their single-form siblings, so for IDENTITY ONLY the
 * pack category folds onto its single-form axis. Blunts already reach the
 * preroll axis upstream (the inventory-type catalog maps "Blunt" → "preroll"
 * and "Infused Blunt" → "infused-preroll"); the explicit "blunt" /
 * "infused-blunt" taxonomy values are deliberately NOT folded here — they are
 * browse-focus categories, and folding them would be a guess. Infused NEVER
 * folds onto non-infused.
 */
export const PACK_CATEGORY_AXIS: Record<string, string> = {
  "preroll-pack": "preroll",
  "infused-preroll-pack": "infused-preroll",
};

/** The category used for grouping identity (a pack folds to its single form). */
export function groupingCategoryAxis(category: string): string {
  return PACK_CATEGORY_AXIS[category] ?? category;
}

/** vendor|categoryAxis|family — the owner's "same product, same vendor" identity. */
function identityKey(vendor: string, category: string, family: string): string {
  return [collapseFamilyKeyPart(vendor), groupingCategoryAxis(category), family].join("|");
}

// --- Planner ----------------------------------------------------------------

/** Convert an eligible planned item into a standalone one-variant card. */
function standaloneCard(it: PlannedInjectedItem): MasteredNewCard {
  const { variant, sort_order: _sort, ...rest } = it;
  void _sort;
  return {
    ...rest,
    variants: variant
      ? [
          {
            source_variant_id: variant.source_variant_id,
            label: variant.label,
            price_minor_units: variant.price_minor_units,
            inventory_level: variant.inventory_level,
            medical: variant.medical,
          },
        ]
      : [],
  };
}

/** Cheapest-first, then label, then id — deterministic shopper-friendly order. */
function sortVariants(variants: MasteredVariant[]): MasteredVariant[] {
  return [...variants].sort(
    (a, b) =>
      a.price_minor_units - b.price_minor_units ||
      a.label.localeCompare(b.label) ||
      a.source_variant_id.localeCompare(b.source_variant_id),
  );
}

/**
 * Plan the mastering pass. Deterministic and pure:
 *  1. `buildDraftInjectionPlan` decides eligibility exactly as before (its
 *     diagnostics pass through untouched).
 *  2. Lots already live as a VARIANT on a live card are dropped (info).
 *  3. Eligible items are grouped by vendor|websiteCategory|family; unconfident
 *     family or blank vendor → standalone card + warning (never auto-merge).
 *  4. A group matching exactly ONE live card merges into it (restock); more
 *     than one match → new card + warning; no match → new card.
 */
export function buildIntakeMasteringPlan(inputs: IntakeMasteringInputs): IntakeMasteringPlan {
  const injection = buildDraftInjectionPlan({
    drafts: inputs.drafts,
    existingKeys: inputs.existingKeys,
    enrichmentByDraftId: inputs.enrichmentByDraftId,
    baseSortOrder: 0, // the snapshot composer reassigns sort orders
  });
  const diagnostics: InjectionDiagnostic[] = [...injection.diagnostics];

  // SLICE 62: collect the verified per-lot facts BEFORE grouping — grouped
  // cards keep only the base item's fields, but every lot's facts must reach
  // inventory_lots regardless of how its card was mastered.
  const lotFactsByKey = new Map<string, LotFactBundle>();
  for (const it of injection.items) {
    if (
      it.servings_per_pack !== null ||
      it.mg_per_serving !== null ||
      it.package_thc_mg !== null ||
      it.package_cbd_mg !== null ||
      it.ratio_label !== null
    ) {
      lotFactsByKey.set(it.source_item_id, {
        servings_per_pack: it.servings_per_pack,
        mg_per_serving: it.mg_per_serving,
        package_thc_mg: it.package_thc_mg,
        package_cbd_mg: it.package_cbd_mg,
        ratio_label: it.ratio_label,
        fact_provenance: it.fact_provenance,
      });
    }
  }

  // Lot keys already selling as a variant on some live card (restocked lot
  // that was ALREADY merged in a previous run, or a Slice-1-era card).
  const liveVariantLotKeys = new Map<string, string>(); // lotKey -> card key
  for (const card of inputs.liveCards) {
    for (const v of card.variants) {
      const lotKey = lotKeyFromVariantId(v.source_variant_id);
      if (lotKey) liveVariantLotKeys.set(lotKey, card.source_item_id);
    }
  }

  // Live merge candidates by identity. Hidden cards and medical-only cards
  // are never merge targets (merging sellable adult stock into them would
  // hide it or mis-shelve it).
  const liveByIdentity = new Map<string, LiveCardCandidate[]>();
  for (const card of inputs.liveCards) {
    if (card.hidden) continue;
    if (card.variants.length > 0 && card.variants.every((v) => v.medical)) continue;
    const vendor = normalizeWhitespace(card.vendor_name);
    if (!vendor) continue;
    const fam = deriveFamily({
      category: card.category,
      vendor,
      brand: card.brand_name,
      name: card.name,
      strainName: card.strain_name,
    });
    if (!fam) continue;
    const key = identityKey(vendor, card.category, fam.family);
    const list = liveByIdentity.get(key) ?? [];
    list.push(card);
    liveByIdentity.set(key, list);
  }

  const newCards: MasteredNewCard[] = [];
  const mergesByCardKey = new Map<string, MasteredVariant[]>();
  const mergeCategoriesByCardKey = new Map<string, string[]>();
  let mergedVariantCount = 0;

  // Group eligible planned items by identity, preserving first-seen order.
  type Group = {
    identity: string;
    display: string;
    vendor: string;
    items: PlannedInjectedItem[];
  };
  const groups = new Map<string, Group>();

  for (const it of injection.items) {
    // Already live as a variant on a live card → nothing to add.
    const liveCardKey = liveVariantLotKeys.get(it.source_item_id);
    if (liveCardKey) {
      diagnostics.push({
        severity: "info",
        code: "intake_lot_already_live",
        message: `Approved product “${it.name}” (lot ${it.source_item_id}) is already a size on live card ${liveCardKey} — nothing to add.`,
        context: { pos_product_key: it.source_item_id, card_key: liveCardKey },
      });
      continue;
    }

    const vendor = normalizeWhitespace(it.vendor_name);
    if (!vendor) {
      // Owner rule: rollup is per-vendor; a blank vendor is never grouped.
      diagnostics.push({
        severity: "warning",
        code: "intake_master_no_vendor",
        message: `Approved product “${it.name}” has no vendor, so it was added as its own card (never grouped without a vendor). The vendor comes from the manifest header — fix the manifest's vendor on Intake if it should roll up.`,
        context: { pos_product_key: it.source_item_id },
      });
      newCards.push(standaloneCard(it));
      continue;
    }

    const fam = deriveFamily({
      category: it.category,
      vendor,
      brand: it.brand_name,
      name: it.product_name ?? it.name,
      strainName: it.strain_name,
    });
    if (!fam) {
      diagnostics.push({
        severity: "warning",
        code: "intake_master_ambiguous_name",
        message: `Approved product “${it.name}” has a name too ambiguous to group safely, so it was added as its own card. Rename it on Product Onboarding if it should roll up.`,
        context: { pos_product_key: it.source_item_id },
      });
      newCards.push(standaloneCard(it));
      continue;
    }

    const key = identityKey(vendor, it.category, fam.family);
    const group = groups.get(key);
    if (group) group.items.push(it);
    else groups.set(key, { identity: key, display: fam.display, vendor, items: [it] });
  }

  for (const group of groups.values()) {
    const variants: MasteredVariant[] = [];
    for (const it of group.items) {
      if (!it.variant) continue; // defensive: injection always mints one
      variants.push({
        source_variant_id: it.variant.source_variant_id,
        label: it.variant.label,
        price_minor_units: it.variant.price_minor_units,
        inventory_level: it.variant.inventory_level,
        medical: it.variant.medical,
      });
    }
    if (variants.length === 0) continue;

    const liveMatches = liveByIdentity.get(group.identity) ?? [];

    if (liveMatches.length === 1) {
      // RESTOCK MERGE — append this group's lots to the one matching live card.
      const target = liveMatches[0];
      const list = mergesByCardKey.get(target.source_item_id) ?? [];
      list.push(...sortVariants(variants));
      mergesByCardKey.set(target.source_item_id, list);
      const cats = mergeCategoriesByCardKey.get(target.source_item_id) ?? [];
      for (const gi of group.items) {
        for (const c of [gi.category, ...gi.filter_categories]) {
          if (!cats.includes(c)) cats.push(c);
        }
      }
      mergeCategoriesByCardKey.set(target.source_item_id, cats);
      mergedVariantCount += variants.length;
      diagnostics.push({
        severity: "info",
        code: "intake_master_restock",
        message: `${variants.length} lot(s) of “${group.display}” joined the live card “${target.name}” as new size/restock option(s) — no duplicate card created.`,
        context: {
          card_key: target.source_item_id,
          lots: group.items.map((i) => i.source_item_id),
        },
      });
      continue;
    }

    if (liveMatches.length > 1) {
      diagnostics.push({
        severity: "warning",
        code: "intake_master_merge_ambiguous",
        message: `“${group.display}” matches ${liveMatches.length} live cards, so it was added as a NEW card instead of merging (never merged on a guess). Consolidate the duplicate live cards to fix this.`,
        context: {
          identity: group.identity,
          live_card_keys: liveMatches.map((c) => c.source_item_id),
          lots: group.items.map((i) => i.source_item_id),
        },
      });
    }

    // NEW CARD. Deterministic base = the item owning the smallest lot key;
    // the card id IS that lot key (same namespace the pre-mastering path
    // used — every intake variant matches `-onboarded`, so the sale path
    // never consumes the card key itself).
    const sortedItems = [...group.items].sort((a, b) =>
      a.source_item_id.localeCompare(b.source_item_id),
    );
    const base = sortedItems[0];
    const sorted = sortVariants(variants);

    if (group.items.length === 1 && liveMatches.length === 0) {
      // Singleton with nothing to merge into — exactly the legacy shape.
      newCards.push(standaloneCard(base));
      continue;
    }

    // The card must be reachable from EVERY browse section its lots belong
    // to (e.g. a single preroll + its 5-pack → "preroll" AND "preroll-pack").
    const filterUnion: string[] = [];
    for (const gi of group.items) {
      for (const c of [gi.category, ...gi.filter_categories]) {
        if (!filterUnion.includes(c)) filterUnion.push(c);
      }
    }

    const cheapest = sorted[0];
    const labelPart = cheapest.label === "each" ? "" : cheapest.label;
    const { variant: _v, sort_order: _s, ...baseRest } = base;
    void _v;
    void _s;
    newCards.push({
      ...baseRest,
      source_item_id: base.source_item_id,
      name: group.display,
      filter_categories: filterUnion,
      price_minor_units: cheapest.price_minor_units,
      price_label: [formatMoney(cheapest.price_minor_units), labelPart].filter(Boolean).join(" "),
      inventory_status: ((): MasteredNewCard["inventory_status"] => {
        const total = sorted.reduce((s, v) => s + v.inventory_level, 0);
        if (total <= 0) return "unavailable";
        if (total <= 3) return "low-stock";
        return "in-stock";
      })(),
      // Display only: prefer the brand when the manifest carried one (generic
      // JSON); WCIA has no per-line brand, so fall back to the vendor.
      description: `${group.display} from ${normalizeWhitespace(base.brand_name) || group.vendor}. Browse current availability, package options, and pricing at Greenway Marijuana in Port Orchard.`,
      variants: sorted,
    });
    if (group.items.length > 1) {
      diagnostics.push({
        severity: "info",
        code: "intake_master_grouped",
        message: `${group.items.length} lots of “${group.display}” rolled up into ONE card with ${sorted.length} option(s) — each option still sells against its own inventory lot.`,
        context: {
          card_key: base.source_item_id,
          lots: group.items.map((i) => i.source_item_id),
        },
      });
    }
  }

  return {
    newCards,
    mergesByCardKey,
    mergeCategoriesByCardKey,
    diagnostics,
    addedCardCount: newCards.length,
    mergedVariantCount,
    lotFactsByKey,
  };
}

// ---------------------------------------------------------------------------
// Embedded self-tests (house pattern)
// ---------------------------------------------------------------------------
export function __runIntakeMasteringCoreTests(): { passed: number } {
  let passed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL intake-mastering-core: " + msg);
    passed += 1;
  };

  const draft = (over: Partial<ApprovedDraftForInjection>): ApprovedDraftForInjection => ({
    id: "d1",
    pos_product_key: "LOT-A",
    name: "Blue Dream 1g",
    brand_name: "Fairwinds",
    vendor_name: "Fairwinds LLC",
    strain_name: "Blue Dream",
    thc_pct: 21.5,
    cbd_pct: 0.4,
    total_thc_pct: 24.1,
    potency_json: { thc: 21.5 },
    price_minor_units: 1200,
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  });
  const enrich = (over: Partial<DraftEnrichment>): DraftEnrichment => ({
    websiteCategory: "flower",
    strainType: "hybrid",
    onHandQty: 10,
    packageLabel: "1g",
    ...over,
  });
  const live = (over: Partial<LiveCardCandidate>): LiveCardCandidate => ({
    source_item_id: "card-1",
    name: "Blue Dream",
    brand_name: "Fairwinds",
    vendor_name: "Fairwinds LLC",
    category: "flower",
    strain_name: "Blue Dream",
    hidden: false,
    variants: [{ source_variant_id: "LOT-OLD-onboarded", medical: false }],
    ...over,
  });
  const plan = (
    drafts: ApprovedDraftForInjection[],
    e: [string, DraftEnrichment][],
    liveCards: LiveCardCandidate[] = [],
    existing: string[] = [],
  ) =>
    buildIntakeMasteringPlan({
      drafts,
      existingKeys: new Set(existing),
      enrichmentByDraftId: new Map(e),
      liveCards,
    });

  // Within-invoice rollup: two lots, same brand + strain + category → ONE
  // card with two variants, each keeping ITS OWN lot's `-onboarded` identity.
  {
    const p = plan(
      [
        draft({}),
        draft({ id: "d2", pos_product_key: "LOT-B", name: "Blue Dream 3.5g", price_minor_units: 3500 }),
      ],
      [
        ["d1", enrich({})],
        ["d2", enrich({ packageLabel: "3.5g" })],
      ],
    );
    assert(p.newCards.length === 1, "rollup: one card");
    const card = p.newCards[0];
    assert(card.source_item_id === "LOT-A", "rollup: card id = smallest lot key");
    assert(card.name === "Blue Dream", "rollup: card named after the family");
    assert(card.variants.length === 2, "rollup: two variants");
    assert(card.variants[0].source_variant_id === "LOT-A-onboarded", "rollup: cheapest first, own lot key");
    assert(card.variants[1].source_variant_id === "LOT-B-onboarded", "rollup: second variant own lot key");
    assert(card.price_minor_units === 1200, "rollup: card price = cheapest variant");
    assert(card.price_label === "$12.00 1g", "rollup: price label from cheapest");
    assert(card.inventory_status === "in-stock", "rollup: status from summed on-hand");
    assert(p.mergedVariantCount === 0 && p.mergesByCardKey.size === 0, "rollup: nothing merged");
    assert(p.diagnostics.some((d) => d.code === "intake_master_grouped"), "rollup: grouped diagnostic");
  }

  // Same strain, DIFFERENT vendor → two cards (owner rule: same vendor only).
  {
    const p = plan(
      [draft({}), draft({ id: "d2", pos_product_key: "LOT-B", vendor_name: "Other Farms LLC" })],
      [
        ["d1", enrich({})],
        ["d2", enrich({})],
      ],
    );
    assert(p.newCards.length === 2, "vendor split: two cards");
  }

  // DIFFERENT brand labels under the SAME vendor still roll up — the owner's
  // vendors are licensed per-brand, so the vendor IS the brand axis.
  {
    const p = plan(
      [
        draft({}),
        draft({ id: "d2", pos_product_key: "LOT-B", name: "Blue Dream 3.5g", brand_name: "Other Label", price_minor_units: 3500 }),
      ],
      [
        ["d1", enrich({})],
        ["d2", enrich({ packageLabel: "3.5g" })],
      ],
    );
    assert(p.newCards.length === 1, "same vendor, different brand label: one card");
    assert(p.newCards[0].variants.length === 2, "same vendor rollup: two variants");
  }

  // Same vendor, different strains → two cards.
  {
    const p = plan(
      [draft({}), draft({ id: "d2", pos_product_key: "LOT-B", strain_name: "GG4", name: "GG4 1g" })],
      [
        ["d1", enrich({})],
        ["d2", enrich({})],
      ],
    );
    assert(p.newCards.length === 2, "strain split: two cards");
  }

  // SLICE 49 (owner rule): edible names KEEP their mg dose, and the dose is part
  // of the identity — a 100mg pack and a 10mg single are DIFFERENT products, so
  // they become TWO cards (pre-SLICE-49 they merged into one dose-less
  // "Rainbow Chews" card, which lost the info the owner says sells the product).
  {
    const p = plan(
      [
        draft({
          id: "d1",
          pos_product_key: "LOT-C1",
          name: "Fairwinds - Rainbow Chews 100mg pack",
          strain_name: null,
        }),
        draft({
          id: "d2",
          pos_product_key: "LOT-C2",
          name: "Rainbow_Chews_10mg_single",
          strain_name: null,
          price_minor_units: 900,
        }),
      ],
      [
        ["d1", enrich({ websiteCategory: "edible-solid", packageLabel: "100mg" })],
        ["d2", enrich({ websiteCategory: "edible-solid", packageLabel: "10mg" })],
      ],
    );
    assert(p.newCards.length === 2, "edible dose split: two cards (doses never merge)");
    const names = p.newCards.map((c) => c.name).sort();
    assert(names.includes("Fairwinds - Rainbow Chews 100mg pack"), "edible dose split: 100mg standalone keeps its draft name");
    assert(names.includes("Rainbow_Chews_10mg_single"), "edible dose split: 10mg standalone keeps its draft name");
  }

  // SLICE 49: SAME dose still rolls up — two lots of the identical 100mg product
  // become ONE card whose family name keeps the dose.
  {
    const p = plan(
      [
        draft({ id: "d1", pos_product_key: "LOT-D1", name: "Fairwinds - Rainbow Chews 100mg pack", strain_name: null }),
        draft({ id: "d2", pos_product_key: "LOT-D2", name: "Rainbow_Chews_100_mg_single", strain_name: null, price_minor_units: 900 }),
      ],
      [
        ["d1", enrich({ websiteCategory: "edible-solid", packageLabel: "100mg" })],
        ["d2", enrich({ websiteCategory: "edible-solid", packageLabel: "100mg" })],
      ],
    );
    assert(p.newCards.length === 1, "edible same-dose rollup: one card");
    assert(p.newCards[0].name === "Rainbow Chews 100mg", "edible rollup: family name keeps the dose");
    assert(p.newCards[0].variants.length === 2, "edible rollup: two variants");
  }

  // Restock merge: group identity matches exactly ONE live card → variants
  // are appended to that card; NO new card.
  {
    const p = plan([draft({})], [["d1", enrich({})]], [live({})]);
    assert(p.newCards.length === 0, "restock: no new card");
    assert(p.mergedVariantCount === 1, "restock: one merged variant");
    const merged = p.mergesByCardKey.get("card-1");
    assert(!!merged && merged.length === 1, "restock: merge keyed on live card");
    assert(merged![0].source_variant_id === "LOT-A-onboarded", "restock: variant keeps own lot key");
    assert(p.diagnostics.some((d) => d.code === "intake_master_restock"), "restock: diagnostic");
  }

  // TWO live cards match → never merged on a guess: new card + warning.
  {
    const p = plan(
      [draft({})],
      [["d1", enrich({})]],
      [live({}), live({ source_item_id: "card-2", variants: [] })],
    );
    assert(p.newCards.length === 1, "ambiguous merge: new card instead");
    assert(p.mergedVariantCount === 0, "ambiguous merge: nothing merged");
    assert(
      p.diagnostics.some((d) => d.code === "intake_master_merge_ambiguous" && d.severity === "warning"),
      "ambiguous merge: warning",
    );
  }

  // Hidden and medical-only live cards are never merge targets.
  {
    const p = plan(
      [draft({})],
      [["d1", enrich({})]],
      [
        live({ hidden: true }),
        live({
          source_item_id: "card-med",
          variants: [{ source_variant_id: "LOT-M-onboarded", medical: true }],
        }),
      ],
    );
    assert(p.newCards.length === 1 && p.mergedVariantCount === 0, "hidden/medical: no merge");
  }

  // Lot already live as a VARIANT on a live card → dropped with info diag.
  {
    const p = plan(
      [draft({})],
      [["d1", enrich({})]],
      [live({ variants: [{ source_variant_id: "LOT-A-onboarded", medical: false }] })],
    );
    assert(p.newCards.length === 0 && p.mergedVariantCount === 0, "already-live: dropped");
    assert(p.diagnostics.some((d) => d.code === "intake_lot_already_live"), "already-live: diagnostic");
  }

  // Ambiguous name (strips to nothing) → standalone card + warning, never grouped.
  {
    const p = plan(
      [
        draft({ id: "d1", pos_product_key: "LOT-X1", name: "Fairwinds 1g", strain_name: null }),
        draft({ id: "d2", pos_product_key: "LOT-X2", name: "Fairwinds 3.5g", strain_name: null }),
      ],
      [
        ["d1", enrich({ websiteCategory: "paraphernalia" })],
        ["d2", enrich({ websiteCategory: "paraphernalia" })],
      ],
    );
    assert(p.newCards.length === 2, "ambiguous name: standalone cards, never grouped");
    assert(
      p.diagnostics.filter((d) => d.code === "intake_master_ambiguous_name").length === 2,
      "ambiguous name: warnings",
    );
  }

  // Blank vendor → standalone + warning (owner rule: rollup is per-vendor).
  {
    const p = plan(
      [draft({ vendor_name: null }), draft({ id: "d2", pos_product_key: "LOT-B", vendor_name: "  " })],
      [
        ["d1", enrich({})],
        ["d2", enrich({})],
      ],
    );
    assert(p.newCards.length === 2, "no vendor: standalone cards");
    assert(
      p.diagnostics.filter((d) => d.code === "intake_master_no_vendor").length === 2,
      "no vendor: warnings",
    );
  }

  // Eligibility still delegated: keyless / unpriced / unmapped / superseded
  // diagnostics pass through untouched and produce no cards.
  {
    const p = plan(
      [
        draft({ id: "nk", pos_product_key: null }),
        draft({ id: "np", pos_product_key: "LOT-NP", price_minor_units: null }),
        draft({ id: "uc", pos_product_key: "LOT-UC" }),
        draft({ id: "sp", pos_product_key: "LIVE-KEY" }),
      ],
      [
        ["nk", enrich({})],
        ["np", enrich({})],
        ["uc", enrich({ websiteCategory: null })],
        ["sp", enrich({})],
      ],
      [],
      ["LIVE-KEY"],
    );
    assert(p.newCards.length === 0, "eligibility: nothing planned");
    assert(p.diagnostics.some((d) => d.code === "draft_inject_no_pos_key"), "eligibility: keyless");
    assert(p.diagnostics.some((d) => d.code === "draft_inject_no_price"), "eligibility: unpriced");
    assert(p.diagnostics.some((d) => d.code === "draft_inject_unmapped_category"), "eligibility: unmapped");
    assert(p.diagnostics.some((d) => d.code === "draft_superseded_by_pos"), "eligibility: superseded");
  }

  // Singleton with no live match keeps the exact legacy card shape.
  {
    const p = plan([draft({})], [["d1", enrich({})]]);
    assert(p.newCards.length === 1, "singleton: one card");
    const card = p.newCards[0];
    assert(card.source_item_id === "LOT-A", "singleton: keyed on the lot");
    assert(card.name === "Blue Dream 1g", "singleton: keeps the draft name verbatim");
    assert(card.variants.length === 1 && card.variants[0].source_variant_id === "LOT-A-onboarded",
      "singleton: one -onboarded variant");
  }

  // Family helpers: strain-led uses strain; underscores normalize; category
  // fallback is refused (null), never guessed.
  {
    const fam = deriveFamily({ category: "flower", vendor: "X", name: "whatever", strainName: "Blue_Dream" });
    assert(!!fam && fam.display === "Blue Dream" && fam.family === "blue-dream", "family: strain-led");
    assert(familyFromName("Fairwinds 3.5g", "Fairwinds") === null, "family: strips to nothing → null");
    assert(
      familyFromName("Fairwinds LLC Healing Balm 300mg", ["", "Fairwinds LLC"]) === "Healing Balm",
      "family: vendor prefix strips (label list form)",
    );
    assert(
      familyFromName("Bite_ind_peanut_butter_chip_1:1_10pk", "") ===
        "Bite Ind Peanut Butter Chip 1:1",
      "family: underscores normalize AND the pack token strips (pack-axis rule)",
    );
    assert(
      familyFromName("Healing Balm 2-pack", "") === "Healing Balm",
      "family: hyphenated pack token strips",
    );
  }

  // PACK AXIS — a single preroll and its 5-pack roll up into ONE card; the
  // card's filter_categories covers BOTH browse sections.
  {
    const p = plan(
      [
        draft({ id: "d1", pos_product_key: "LOT-S", name: "Blue Dream Preroll 1g", price_minor_units: 800 }),
        draft({ id: "d2", pos_product_key: "LOT-P5", name: "Blue Dream Prerolls 5pk", price_minor_units: 3000 }),
      ],
      [
        ["d1", enrich({ websiteCategory: "preroll", packageLabel: "1g" })],
        ["d2", enrich({ websiteCategory: "preroll-pack", packageLabel: "5pk" })],
      ],
    );
    assert(p.newCards.length === 1, "pack axis: one card for single + 5pk");
    const card = p.newCards[0];
    assert(card.variants.length === 2, "pack axis: two variants");
    assert(card.variants[0].source_variant_id === "LOT-S-onboarded", "pack axis: single keeps own lot key");
    assert(card.variants[1].source_variant_id === "LOT-P5-onboarded", "pack axis: pack keeps own lot key");
    assert(
      card.filter_categories.includes("preroll") && card.filter_categories.includes("preroll-pack"),
      "pack axis: filter union covers both browse sections",
    );
  }

  // Infused NEVER folds onto non-infused: infused single + infused pack roll
  // up together; the plain single stays its own card.
  {
    const p = plan(
      [
        draft({ id: "i1", pos_product_key: "LOT-I1", name: "GG4 Infused Preroll", strain_name: "GG4", price_minor_units: 1500 }),
        draft({ id: "i2", pos_product_key: "LOT-I2", name: "GG4 Infused Prerolls 2pk", strain_name: "GG4", price_minor_units: 2800 }),
        draft({ id: "n1", pos_product_key: "LOT-N1", name: "GG4 Preroll", strain_name: "GG4", price_minor_units: 700 }),
      ],
      [
        ["i1", enrich({ websiteCategory: "infused-preroll" })],
        ["i2", enrich({ websiteCategory: "infused-preroll-pack", packageLabel: "2pk" })],
        ["n1", enrich({ websiteCategory: "preroll" })],
      ],
    );
    assert(p.newCards.length === 2, "infused split: infused and non-infused never merge");
    const infused = p.newCards.find((c) => c.variants.length === 2);
    assert(!!infused, "infused split: infused card carries both lots");
    assert(
      infused!.variants.map((v) => v.source_variant_id).join(",") ===
        "LOT-I1-onboarded,LOT-I2-onboarded",
      "infused split: infused variants keep own lot keys",
    );
  }

  // Blunts ride the preroll axis (inventory-type catalog maps "Blunt" →
  // "preroll"): a single blunt and its 3-pack roll up into ONE card.
  {
    const p = plan(
      [
        draft({ id: "b1", pos_product_key: "LOT-B1", name: "Grape Ape Blunt 1g", strain_name: "Grape Ape", price_minor_units: 900 }),
        draft({ id: "b3", pos_product_key: "LOT-B3", name: "Grape Ape Blunts 3 pack", strain_name: "Grape Ape", price_minor_units: 2400 }),
      ],
      [
        ["b1", enrich({ websiteCategory: "preroll" })],
        ["b3", enrich({ websiteCategory: "preroll-pack", packageLabel: "3pk" })],
      ],
    );
    assert(p.newCards.length === 1, "blunts: single + 3-pack roll up");
    assert(p.newCards[0].variants.length === 2, "blunts: two variants");
  }

  // PACK-AXIS RESTOCK — a 5-pack lot merges into the live single-preroll
  // card, and the merged lot's pack category is recorded for the composer's
  // filter_categories union.
  {
    const p = plan(
      [draft({ id: "d1", pos_product_key: "LOT-NEWPK", name: "Blue Dream Prerolls 5pk", price_minor_units: 3000 })],
      [["d1", enrich({ websiteCategory: "preroll-pack", packageLabel: "5pk" })]],
      [
        live({
          source_item_id: "card-pr",
          category: "preroll",
          variants: [{ source_variant_id: "LOT-OLDPR-onboarded", medical: false }],
        }),
      ],
    );
    assert(p.newCards.length === 0, "pack-axis restock: no new card");
    assert(p.mergedVariantCount === 1, "pack-axis restock: merged one variant");
    const merged = p.mergesByCardKey.get("card-pr");
    assert(
      !!merged && merged[0].source_variant_id === "LOT-NEWPK-onboarded",
      "pack-axis restock: variant keeps own lot key",
    );
    const mergedCats = p.mergeCategoriesByCardKey.get("card-pr") ?? [];
    assert(mergedCats.includes("preroll-pack"),
      "pack-axis restock: merged lot's pack category recorded for filter union");
  }

  // SLICE 49: topicals are dose-led too — a 100mg balm and a 300mg balm are
  // DIFFERENT doses so they stay separate cards; two lots of the SAME dose
  // still roll up on the noise-stripped, dose-keeping name.
  {
    const p = plan(
      [
        draft({ id: "t1", pos_product_key: "LOT-T1", name: "Healing Balm 100mg", strain_name: null, price_minor_units: 1800 }),
        draft({ id: "t2", pos_product_key: "LOT-T2", name: "Fairwinds Healing Balm 300mg jar", strain_name: null, price_minor_units: 4200 }),
      ],
      [
        ["t1", enrich({ websiteCategory: "topical", packageLabel: "100mg" })],
        ["t2", enrich({ websiteCategory: "topical", packageLabel: "300mg" })],
      ],
    );
    assert(p.newCards.length === 2, "topical dose split: different doses never merge");
  }
  {
    const p = plan(
      [
        draft({ id: "t1", pos_product_key: "LOT-T1", name: "Healing Balm 300mg", strain_name: null, price_minor_units: 4200 }),
        draft({ id: "t2", pos_product_key: "LOT-T2", name: "Fairwinds Healing Balm 300mg jar", strain_name: null, price_minor_units: 4200 }),
      ],
      [
        ["t1", enrich({ websiteCategory: "topical", packageLabel: "300mg" })],
        ["t2", enrich({ websiteCategory: "topical", packageLabel: "300mg" })],
      ],
    );
    assert(p.newCards.length === 1, "topical same-dose rollup: one card");
    assert(p.newCards[0].name === "Healing Balm 300mg", "topical rollup: dose kept in the family name");
    assert(p.newCards[0].variants.length === 2, "topical rollup: two variants");
  }

  // RSO is strain-led: two syringe sizes of the same strain roll up.
  {
    const p = plan(
      [
        draft({ id: "r1", pos_product_key: "LOT-R1", name: "ACDC RSO 1g", strain_name: "ACDC", price_minor_units: 2500 }),
        draft({ id: "r2", pos_product_key: "LOT-R2", name: "ACDC RSO Syringe 0.5g", strain_name: "ACDC", price_minor_units: 1500 }),
      ],
      [
        ["r1", enrich({ websiteCategory: "rso", packageLabel: "1g" })],
        ["r2", enrich({ websiteCategory: "rso", packageLabel: "0.5g" })],
      ],
    );
    assert(p.newCards.length === 1, "rso: strain-led rollup");
    assert(p.newCards[0].variants.length === 2, "rso: two variants");
  }

  // --- SLICE 62: per-lot verified facts surface for inventory_lots ---
  {
    const p = plan(
      [
        draft({
          id: "e1",
          pos_product_key: "LOT-E1",
          name: "Const HRG CBN 1:1:1 Blueberry 10 Pack 300mg",
          total_thc_pct: 10,
          thc_pct: null,
          cbd_pct: 9.1,
          potency_json: null,
          inventory_type: "Solid Edible",
          price_minor_units: 2500,
        }),
      ],
      [["e1", enrich({ websiteCategory: "edible-solid", packageLabel: "10 Pack" })]],
    );
    const facts = p.lotFactsByKey.get("LOT-E1");
    assert(facts !== undefined, "lot facts: verified edible carries a fact bundle");
    assert(facts!.package_thc_mg === 100, "lot facts: verified package THC 100mg");
    assert(facts!.servings_per_pack === 10, "lot facts: verified servings 10");
    assert(facts!.ratio_label === "1:1:1", "lot facts: ratio label");
  }
  {
    const p = plan([draft({})], [["d1", enrich({})]]);
    assert(!p.lotFactsByKey.has("LOT-A"), "lot facts: flower has no mg bundle");
  }

  return { passed };
}
