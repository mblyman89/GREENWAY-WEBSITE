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
 * SLICE 65 (owner bugs A1/A3/A4): the family display is ALSO the card's
 * customer-facing name for singletons (grouped cards already used it), and
 * `intakeDisplayName` exposes the same derivation to the Cultivera-import
 * injection path — one brain for naming AND identity. The raw manifest name
 * always stays in product_name (compliance under the hood); an unconfident
 * family keeps the raw name on screen too (never guess).
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
import { BOILERPLATE_TAIL, isBoilerplateDescription } from "@/lib/catalog/golden-record-core";
import {
  cardLotKeys,
  cardVendorIds,
  cleanVendorId,
  groupVendorId,
  mergeCandidates,
  vendorIdKey,
  isCultiveraCardKey,
  type MatchedBy,
  type RestockVerdict,
  type VendorIdInputs,
} from "@/lib/inventory/vendor-identity-core";
import { formatMoney } from "@/lib/pos/format";
import { variantSizeValue } from "@/lib/menu/variant-sort";

/** A live (carried-forward) card the planner may merge a restock into. */
export type LiveCardCandidate = {
  source_item_id: string;
  name: string;
  brand_name: string;
  vendor_name: string | null;
  category: string;
  strain_name: string | null;
  hidden: boolean;
  /**
   * S34: label / price / stock are OPTIONAL - only the Onboarding preview
   * reads them (to say what the joined card has now); the merge never does.
   */
  variants: {
    source_variant_id: string;
    medical: boolean;
    label?: string | null;
    price_minor_units?: number | null;
    inventory_level?: number | null;
  }[];
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
  /**
   * S19 (F-066, F-072): vendor-id identity. Absent = the name-only rule,
   * byte-for-byte as before (flag off, or a vendor read that was not
   * complete). See vendor-identity-core.ts for the rule and its grounding.
   */
  vendorIds?: VendorIdInputs;
  /**
   * S32 (D-R2-4): the human's remembered answer for an identity that matched
   * 2+ live cards, keyed by that identity (vendor|categoryAxis|family, exactly
   * as the merge_ambiguous diagnostic emits it). Applied ONLY while its
   * candidate_card_keys still equal the cards matched now (set equality) -
   * otherwise it is STALE and today's warning returns with stale_decision.
   * Absent = byte-identical behaviour to before S32.
   */
  mergeDecisions?: ReadonlyMap<string, MergeDecision>;
};

/**
 * S32: one remembered "join card X" / "keep separate" choice.
 *
 * own_card_key is the card THIS product got on its own when the choice was
 * made: the smallest lot key of the delivery (the new-card key rule below,
 * "the card id IS that lot key"). Once that version is live, that card has
 * the same identity, so the NEXT delivery matches the candidates PLUS it.
 * Without it every saved choice would go stale on the very next delivery.
 */
export type MergeDecision = {
  decision: "join" | "separate";
  target_card_key: string | null;
  candidate_card_keys: readonly string[];
  own_card_key?: string | null;
};

/** S32: same set of card keys (order and duplicates ignored). */
export function sameCardKeySet(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const k of sa) if (!sb.has(k)) return false;
  return true;
}

/**
 * S32: what a remembered decision means for the cards matched NOW.
 *   none      no decision saved
 *   stale     the matched cards changed since the choice (a card was hidden,
 *             added, or went medical-only) - never applied
 *   join      add the lots to `targetKey` (always one of the matched cards):
 *             the chosen card, or - for "keep separate" once the product's
 *             own card is live - its own card (keptSeparate)
 *   separate  keep as its own NEW card (its own card is not live)
 * The matched set must equal the saved candidates, or the saved candidates
 * plus the product's own card - nothing else is ever accepted.
 */
export type MergeDecisionVerdict =
  | { kind: "none" }
  | { kind: "stale" }
  | { kind: "join"; targetKey: string; keptSeparate: boolean }
  | { kind: "separate" };

export function mergeDecisionVerdict(
  decision: MergeDecision | undefined,
  matchedKeys: readonly string[],
): MergeDecisionVerdict {
  if (!decision) return { kind: "none" };
  const own = typeof decision.own_card_key === "string" && decision.own_card_key ? decision.own_card_key : null;
  const exact = sameCardKeySet(decision.candidate_card_keys, matchedKeys);
  const withOwn =
    !exact && own !== null && !decision.candidate_card_keys.includes(own) &&
    sameCardKeySet([...decision.candidate_card_keys, own], matchedKeys);
  if (!exact && !withOwn) return { kind: "stale" };
  if (decision.decision === "separate") {
    return withOwn && own ? { kind: "join", targetKey: own, keptSeparate: true } : { kind: "separate" };
  }
  if (decision.decision === "join") {
    const t = decision.target_card_key;
    // A join whose target is not one of today's matches can never apply.
    if (t && t !== own && decision.candidate_card_keys.includes(t) && matchedKeys.includes(t)) {
      return { kind: "join", targetKey: t, keptSeparate: false };
    }
    return { kind: "stale" };
  }
  return { kind: "stale" };
}

/** S32: the key a group's own NEW card gets (the smallest lot key - see the NEW CARD step). */
export function ownCardKeyOf(items: readonly { source_item_id: string }[]): string | null {
  const keys = items.map((i) => i.source_item_id).sort((a, b) => a.localeCompare(b));
  return keys[0] ?? null;
}

/** SLICE 62: per-lot verified facts (for inventory_lots persistence). */
export type LotFactBundle = {
  servings_per_pack: number | null;
  mg_per_serving: number | null;
  package_thc_mg: number | null;
  package_cbd_mg: number | null;
  ratio_label: string | null;
  /**
   * SLICE L3: the physical package measure reaches inventory_lots too, so the
   * golden record and the menu row agree. Grouped cards keep only the base
   * item's fields, which is exactly why this bundle exists.
   */
  net_weight_grams: number | null;
  net_volume_ml: number | null;
  fact_provenance: Record<string, string>;
  /**
   * R29: per-package mg of the non-THC/CBD cannabinoids (CBG, CBN, CBC, ...)
   * for inventory_lots.minor_cannabinoids_json (0138). Present only when the
   * card has mg rows for them (lab certificate or a person); staging writes
   * it only when non-empty, so it never wipes a lot's existing minors.
   */
  minor_cannabinoids_json?: { type: string; value: string; unit: string }[];
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
    // R29: same cannabinoid list as transform.ts titleCase (exact parity).
    .replace(/\b(Cbd|Thc|Cbg|Cbn|Cbc|Thcv|Cbdv|Thca|Cbda)\b/g, (m) => m.toUpperCase());
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

/**
 * SLICE 65: the customer-facing display name for ONE planned intake item —
 * the SAME family derivation grouping and restock identity use (strain for
 * strain-led categories; noise-stripped name otherwise, mg dose preserved
 * for dose-led categories). Mirrors the mastering planner's per-item rules
 * exactly: a blank vendor or an unconfident family returns NULL (the caller
 * keeps the raw name — never guess).
 */
export function intakeDisplayName(
  it: Pick<
    PlannedInjectedItem,
    "name" | "product_name" | "brand_name" | "vendor_name" | "category" | "strain_name"
  >,
): string | null {
  const vendor = normalizeWhitespace(it.vendor_name);
  if (!vendor) return null;
  const fam = deriveFamily({
    category: it.category,
    vendor,
    brand: it.brand_name,
    name: it.product_name ?? it.name,
    strainName: it.strain_name,
  });
  return fam ? fam.display : null;
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
 * S19: the live-card index the restock merge matches against - built ONCE
 * and shared by buildIntakeMasteringPlan and previewRestockVerdicts (the
 * Product Onboarding preview from the same inputs, so the "will join" chip
 * and the real merge can never disagree).
 *
 *   variantLotKeys  lot key -> card key, for lots already selling on a card.
 *   byName          vendor-name|categoryAxis|family -> cards (pre-S19 rule,
 *                   unchanged: hidden, all-medical, blank-vendor and
 *                   unconfident-family cards are never merge targets).
 *   byVendorId      vid:<uuid>|categoryAxis|family -> cards, from the vendor
 *                   ids of each card's own lots (empty without vendorIds).
 *   vidsByCard      card key -> the vendor ids its lots carry.
 */
export type LiveMergeIndex = {
  variantLotKeys: Map<string, string>;
  byName: Map<string, LiveCardCandidate[]>;
  byVendorId: Map<string, LiveCardCandidate[]>;
  vidsByCard: Map<string, Set<string>>;
};

export function buildLiveMergeIndex(
  liveCards: LiveCardCandidate[],
  vendorIds?: VendorIdInputs,
): LiveMergeIndex {
  const variantLotKeys = new Map<string, string>(); // lotKey -> card key
  for (const card of liveCards) {
    for (const v of card.variants) {
      const lotKey = lotKeyFromVariantId(v.source_variant_id);
      if (lotKey) variantLotKeys.set(lotKey, card.source_item_id);
    }
  }

  // Hidden cards and medical-only cards are never merge targets (merging
  // sellable adult stock into them would hide it or mis-shelve it).
  const byName = new Map<string, LiveCardCandidate[]>();
  const byVendorId = new Map<string, LiveCardCandidate[]>();
  const vidsByCard = new Map<string, Set<string>>();
  for (const card of liveCards) {
    if (card.hidden) continue;
    if (card.variants.length > 0 && card.variants.every((v) => v.medical)) continue;
    // Blank vendor NAME is still never a target (S19.8: by design), even when
    // its lots carry an id - the name is what the owner sees and fixes.
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
    const list = byName.get(key) ?? [];
    list.push(card);
    byName.set(key, list);
    if (vendorIds) {
      const vids = cardVendorIds(card, vendorIds.lotVendorIdsByKey);
      vidsByCard.set(card.source_item_id, vids);
      for (const vid of vids) {
        const vkey = vendorIdKey(vid, card.category, fam.family);
        const vlist = byVendorId.get(vkey) ?? [];
        vlist.push(card);
        byVendorId.set(vkey, vlist);
      }
    }
  }
  return { variantLotKeys, byName, byVendorId, vidsByCard };
}

/**
 * S19: which live cards a group of same-identity lots matches. Without ids
 * (or with mixed ids): the name rule. With ONE shared vendor id: the name
 * matches PLUS live cards of that id under any spelling - additive only, so
 * S19 can remove a duplicate card but never create one (see
 * vendor-identity-core mergeCandidates).
 */
export function matchLiveCards(
  live: LiveMergeIndex,
  group: { identity: string; category: string; family: string; vendorIds: Array<string | null | undefined> },
): { cards: LiveCardCandidate[]; matchedBy: MatchedBy; conflicts: LiveCardCandidate[] } {
  const groupVid = groupVendorId(group.vendorIds);
  return mergeCandidates({
    groupVid,
    byVendorId: groupVid ? live.byVendorId.get(vendorIdKey(groupVid, group.category, group.family)) ?? [] : [],
    byName: live.byName.get(group.identity) ?? [],
    vidsByCard: live.vidsByCard,
  });
}

/** One Onboarding row, as the preview needs it (review OR approved). */
export type RestockPreviewDraft = {
  id: string;
  pos_product_key: string | null;
  name: string;
  brand_name: string | null;
  vendor_name: string | null;
  strain_name: string | null;
  /** The website category the row will be filed under (chosen ?? resolved); null = unmapped. */
  category: string | null;
  /**
   * S34: the size label Approve will write for this row's variant - the SAME
   * derivation draft injection / staging use (`${unit_weight} ${uom}` from
   * the row's lot). null/absent = not recorded (shown as such, never guessed).
   * Display only: grouping and verdicts never read it.
   */
  size_label?: string | null;
};

/**
 * The variant size label Approve writes for a lot: `${unit_weight} ${uom}`,
 * or null when the lot carries no unit weight. ONE definition, used by draft
 * injection, intake staging and the S34 preview (so the preview's sizes are
 * the labels Approve will write).
 */
export function lotPackageLabel(
  lot: { unit_weight: number | null; unit_weight_uom: string | null } | null | undefined,
): string | null {
  return lot && lot.unit_weight != null ? `${lot.unit_weight} ${lot.unit_weight_uom ?? ""}`.trim() : null;
}

/** S34: what a row's size reads as when the lot carries no unit weight. */
export const PREVIEW_SIZE_UNKNOWN = "size not recorded";

/** S34: the joined live card as it is NOW (from the same S19 read). */
export type PreviewLiveCardView = {
  key: string;
  name: string;
  /** Its current sizes, ladder order (lowest first), blanks dropped. */
  variantLabels: string[];
  /** [min, max] over the variants that carry a price; null = none do. */
  priceRangeMinor: [number, number] | null;
  /** Sum of inventory_level; null when ANY variant's level is unknown. */
  onHand: number | null;
};

/** S34: one group of rows Approve will master as ONE card. */
export type PreviewGroupView = {
  identity: string;
  category: string;
  family: string;
  /** The member rows, input order. */
  draftIds: string[];
  /** One label per member row, ladder order (unknown sizes last, as PREVIEW_SIZE_UNKNOWN). */
  sizes: string[];
  /** The SAME verdict object every member row carries. */
  verdict: RestockVerdict;
  /** Present only for a "joins" verdict. */
  liveCard?: PreviewLiveCardView;
};

/** Ladder order: smallest size first, sizeless labels after, then by label. */
function ladderSort(labels: string[]): string[] {
  return [...labels].sort((a, b) => {
    const sa = variantSizeValue(a);
    const sb = variantSizeValue(b);
    if (sa != null && sb != null && sa !== sb) return sa - sb;
    if (sa != null && sb == null) return -1;
    if (sa == null && sb != null) return 1;
    return a.localeCompare(b);
  });
}

/** S34: the joined card's current shape, from the variants S19 already read. */
export function liveCardView(card: LiveCardCandidate): PreviewLiveCardView {
  const labels = card.variants.map((v) => (typeof v.label === "string" ? v.label.trim() : "")).filter(Boolean);
  const prices = card.variants
    .map((v) => v.price_minor_units)
    .filter((p): p is number => typeof p === "number" && Number.isFinite(p) && p >= 0);
  const levels = card.variants.map((v) => v.inventory_level);
  const onHandKnown = levels.length > 0 && levels.every((l) => typeof l === "number" && Number.isFinite(l));
  return {
    key: card.source_item_id,
    name: card.name,
    variantLabels: ladderSort(labels),
    priceRangeMinor: prices.length > 0 ? [Math.min(...prices), Math.max(...prices)] : null,
    onHand: onHandKnown ? (levels as number[]).reduce((a, b) => a + Math.max(0, b), 0) : null,
  };
}

/**
 * S19.2 "Preview": the mastering decision run DRY for one delivery's rows,
 * so the Onboarding row can say what Approve will do. Same steps, same
 * order, same derivation as buildIntakeMasteringPlan (and the same
 * LiveMergeIndex), minus the parts that need a price:
 *   1. its POS key is already a live card      -> already_live (F-068: the
 *      draft_superseded_by_pos case, said out loud instead of a silent drop)
 *   2. its lot already sells as a size          -> already_live (as a size)
 *   3. no vendor                                -> no_vendor
 *   4. name too vague                           -> vague_name
 *   5. group same-identity rows, match live     -> joins / ambiguous / new
 * Rows with no POS key or no category get NO verdict (their own chips on the
 * row already say what is missing - never a guessed chip).
 */
export function previewRestockVerdicts(input: {
  drafts: RestockPreviewDraft[];
  liveCards: LiveCardCandidate[];
  vendorIds?: VendorIdInputs;
}): Map<string, RestockVerdict> {
  return previewMasteringGroups(input).verdicts;
}

/**
 * S34: the SAME dry run as previewRestockVerdicts (it IS that function's
 * body - the wrapper above only drops .groups), plus the groups it already
 * built: which rows Approve masters as ONE card, their sizes, and the live
 * card a "joins" group lands on. Never a second grouping (bible S34.8).
 */
export function previewMasteringGroups(input: {
  drafts: RestockPreviewDraft[];
  liveCards: LiveCardCandidate[];
  vendorIds?: VendorIdInputs;
}): { verdicts: Map<string, RestockVerdict>; groups: PreviewGroupView[] } {
  const out = new Map<string, RestockVerdict>();
  const views: PreviewGroupView[] = [];
  const live = buildLiveMergeIndex(input.liveCards, input.vendorIds);
  const liveCardKeys = new Set(input.liveCards.map((c) => c.source_item_id));

  type PreviewGroup = { identity: string; category: string; family: string; rows: RestockPreviewDraft[] };
  const groups = new Map<string, PreviewGroup>();
  for (const d of input.drafts) {
    const key = d.pos_product_key?.trim() || null;
    const category = d.category?.trim() || null;
    if (!key || !category) continue;
    if (liveCardKeys.has(key)) {
      out.set(d.id, { kind: "already_live", cardKey: key, asSize: false });
      continue;
    }
    const sizeOf = live.variantLotKeys.get(key);
    if (sizeOf) {
      out.set(d.id, { kind: "already_live", cardKey: sizeOf, asSize: true });
      continue;
    }
    const vendor = normalizeWhitespace(d.vendor_name);
    if (!vendor) {
      out.set(d.id, { kind: "no_vendor" });
      continue;
    }
    const fam = deriveFamily({
      category,
      vendor,
      brand: d.brand_name?.trim() || "",
      name: d.name,
      strainName: d.strain_name,
    });
    if (!fam) {
      out.set(d.id, { kind: "vague_name" });
      continue;
    }
    const identity = identityKey(vendor, category, fam.family);
    const g = groups.get(identity);
    if (g) g.rows.push(d);
    else groups.set(identity, { identity, category, family: fam.family, rows: [d] });
  }

  for (const g of groups.values()) {
    const m = matchLiveCards(live, {
      identity: g.identity,
      category: g.category,
      family: g.family,
      vendorIds: g.rows.map((r) => input.vendorIds?.vendorIdByLotKey.get(r.pos_product_key?.trim() ?? "")),
    });
    let verdict: RestockVerdict;
    if (m.cards.length === 1) {
      const card = m.cards[0];
      verdict = {
        kind: "joins",
        cardKey: card.source_item_id,
        cardName: card.name,
        fromCultivera: isCultiveraCardKey(card.source_item_id),
        matchedBy: m.matchedBy,
        vendorRecordDiffers: m.conflicts.some((c) => c.source_item_id === card.source_item_id),
      };
    } else if (m.cards.length > 1) {
      verdict = { kind: "ambiguous", cardKeys: m.cards.map((c) => c.source_item_id) };
    } else {
      verdict = { kind: "new" };
    }
    for (const r of g.rows) out.set(r.id, verdict);
    const sized = g.rows.map((r) => (typeof r.size_label === "string" ? r.size_label.trim() : "")).filter(Boolean);
    const unknown = g.rows.length - sized.length;
    views.push({
      identity: g.identity,
      category: g.category,
      family: g.family,
      draftIds: g.rows.map((r) => r.id),
      sizes: [...ladderSort(sized), ...Array.from({ length: unknown }, () => PREVIEW_SIZE_UNKNOWN)],
      verdict,
      ...(m.cards.length === 1 ? { liveCard: liveCardView(m.cards[0]) } : {}),
    });
  }
  return { verdicts: out, groups: views };
}

/** Ceiling on live lot keys one vendor-id read may ask about (never paged past). */
export const VENDOR_ID_LIVE_KEY_CAP = 2000;

/**
 * S19: WHICH lot keys to read vendor ids for - so the server reads the few
 * lots that can matter, never the whole store. Pure.
 *   draftLotKeys  the rows' own POS keys (their lot's vendor_id).
 *   liveLotKeys   the lot keys of live cards whose category axis + family
 *                 equal SOME row's (the only cards an id could add as a
 *                 match - an id never changes the family or the axis).
 *   overCap       more live keys than VENDOR_ID_LIVE_KEY_CAP: the caller
 *                 skips ids (the name rule), never reads a partial set.
 */
export function planVendorIdLookup(input: {
  drafts: RestockPreviewDraft[];
  liveCards: LiveCardCandidate[];
}): { draftLotKeys: string[]; liveLotKeys: string[]; overCap: boolean } {
  const wanted = new Set<string>();
  const draftLotKeys: string[] = [];
  for (const d of input.drafts) {
    const key = d.pos_product_key?.trim() || null;
    const category = d.category?.trim() || null;
    const vendor = normalizeWhitespace(d.vendor_name);
    if (!key || !category || !vendor) continue;
    const fam = deriveFamily({ category, vendor, brand: d.brand_name?.trim() || "", name: d.name, strainName: d.strain_name });
    if (!fam) continue;
    if (!draftLotKeys.includes(key)) draftLotKeys.push(key);
    wanted.add(`${groupingCategoryAxis(category)}|${fam.family}`);
  }
  const live = new Set<string>();
  if (wanted.size > 0) {
    for (const card of input.liveCards) {
      if (card.hidden) continue;
      if (card.variants.length > 0 && card.variants.every((v) => v.medical)) continue;
      const vendor = normalizeWhitespace(card.vendor_name);
      if (!vendor) continue;
      const fam = deriveFamily({ category: card.category, vendor, brand: card.brand_name, name: card.name, strainName: card.strain_name });
      if (!fam || !wanted.has(`${groupingCategoryAxis(card.category)}|${fam.family}`)) continue;
      for (const k of cardLotKeys(card)) live.add(k);
    }
  }
  const liveLotKeys = [...live];
  return { draftLotKeys, liveLotKeys, overCap: liveLotKeys.length > VENDOR_ID_LIVE_KEY_CAP };
}

/**
 * S19: fold the two bounded lot reads into the planner's VendorIdInputs.
 * draftLots: the rows' own lots (key -> vendor_id); liveLots: rows of
 * inventory_lots (pos_product_key, vendor_id). Blank ids are dropped. A draft
 * key whose lots DISAGREE on the vendor id gets NO id (never pick one - the
 * group then falls back to the name rule).
 */
export function buildVendorIdInputs(input: {
  draftLots: Array<{ pos_product_key: string | null; vendor_id: unknown }>;
  liveLots: Array<{ pos_product_key: string | null; vendor_id: unknown }>;
}): VendorIdInputs {
  const vendorIdByLotKey = new Map<string, string>();
  const disagreeing = new Set<string>();
  for (const l of input.draftLots) {
    const k = l.pos_product_key?.trim();
    const v = cleanVendorId(l.vendor_id);
    if (!k || !v) continue;
    const had = vendorIdByLotKey.get(k);
    if (had === undefined) vendorIdByLotKey.set(k, v);
    else if (had !== v) disagreeing.add(k);
  }
  for (const k of disagreeing) vendorIdByLotKey.delete(k);
  const lotVendorIdsByKey = new Map<string, Set<string>>();
  for (const l of input.liveLots) {
    const k = l.pos_product_key?.trim();
    const v = cleanVendorId(l.vendor_id);
    if (!k || !v) continue;
    const set = lotVendorIdsByKey.get(k) ?? new Set<string>();
    set.add(v);
    lotVendorIdsByKey.set(k, set);
  }
  return { vendorIdByLotKey, lotVendorIdsByKey };
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
    // R29: the card's mg rows for every cannabinoid other than THC / CBD (and
    // their acids) are the lot's minors - same {type,value,unit} shape.
    const minors = it.compounds_json.filter((c) => c.unit === "mg" && !["thc", "thca", "cbd", "cbda"].includes(c.type));
    if (
      minors.length > 0 ||
      it.servings_per_pack !== null ||
      it.mg_per_serving !== null ||
      it.package_thc_mg !== null ||
      it.package_cbd_mg !== null ||
      it.ratio_label !== null ||
      // SLICE L3: a bottle whose ONLY fact is its size still has a fact worth
      // keeping -- and it is the fact the sales limit is measured from.
      it.net_weight_grams !== null ||
      it.net_volume_ml !== null
    ) {
      lotFactsByKey.set(it.source_item_id, {
        servings_per_pack: it.servings_per_pack,
        mg_per_serving: it.mg_per_serving,
        package_thc_mg: it.package_thc_mg,
        package_cbd_mg: it.package_cbd_mg,
        ratio_label: it.ratio_label,
        net_weight_grams: it.net_weight_grams,
        net_volume_ml: it.net_volume_ml,
        fact_provenance: it.fact_provenance,
        ...(minors.length > 0 ? { minor_cannabinoids_json: minors.map((c) => ({ ...c })) } : {}),
      });
    }
  }

  // Lot keys already selling as a variant on some live card, and the live
  // merge candidates by identity (S19: plus by vendor id) - ONE index, shared
  // with the Product Onboarding preview so the chip and the merge agree.
  const live = buildLiveMergeIndex(inputs.liveCards, inputs.vendorIds);
  const liveVariantLotKeys = live.variantLotKeys;
  const newCards: MasteredNewCard[] = [];
  const mergesByCardKey = new Map<string, MasteredVariant[]>();
  const mergeCategoriesByCardKey = new Map<string, string[]>();
  let mergedVariantCount = 0;

  // Group eligible planned items by identity, preserving first-seen order.
  type Group = {
    identity: string;
    display: string;
    vendor: string;
    /** S19: the category + family the vendor-id key is built from. */
    category: string;
    family: string;
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
    else
      groups.set(key, {
        identity: key,
        display: fam.display,
        vendor,
        category: it.category,
        family: fam.family,
        items: [it],
      });
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

    // S19: vendor id when both sides have one, else the normalized name.
    const { cards: liveMatches, matchedBy, conflicts } = matchLiveCards(live, {
      identity: group.identity,
      category: group.category,
      family: group.family,
      vendorIds: group.items.map((gi) => inputs.vendorIds?.vendorIdByLotKey.get(gi.source_item_id)),
    });

    // S32: a remembered human decision for a multi-card match.
    const verdict =
      liveMatches.length > 1
        ? mergeDecisionVerdict(
            inputs.mergeDecisions?.get(group.identity),
            liveMatches.map((c) => c.source_item_id),
          )
        : ({ kind: "none" } as MergeDecisionVerdict);
    const decidedTarget =
      verdict.kind === "join" ? liveMatches.find((c) => c.source_item_id === verdict.targetKey) ?? null : null;

    if (liveMatches.length === 1 || decidedTarget) {
      // RESTOCK MERGE — append this group's lots to the one matching live card
      // (S32: or to the card a human chose for a multi-card match).
      const target = decidedTarget ?? liveMatches[0];
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
          matched_by: matchedBy,
          // S19: the card's lots sit under a different vendor row of the
          // same name (merged by name exactly as before; worth merging the
          // vendor rows so future matches are exact).
          vendor_record_differs: conflicts.some((c) => c.source_item_id === target.source_item_id),
          // S32: joined by a remembered human decision, not by a single match.
          ...(decidedTarget
            ? {
                decided: true,
                identity: group.identity,
                decision: verdict.kind === "join" && verdict.keptSeparate ? "separate" : "join",
              }
            : {}),
        },
      });
      continue;
    }

    if (liveMatches.length > 1 && verdict.kind === "separate") {
      diagnostics.push({
        severity: "info",
        code: "intake_master_kept_separate",
        message: `“${group.display}” matches ${liveMatches.length} live cards; as you chose, it stays its own card.`,
        context: {
          identity: group.identity,
          live_card_keys: liveMatches.map((c) => c.source_item_id),
          lots: group.items.map((i) => i.source_item_id),
          decided: true,
        },
      });
    } else if (liveMatches.length > 1) {
      diagnostics.push({
        severity: "warning",
        code: "intake_master_merge_ambiguous",
        message: `“${group.display}” matches ${liveMatches.length} live cards, so it was added as a NEW card instead of merging (never merged on a guess). Consolidate the duplicate live cards to fix this.`,
        context: {
          identity: group.identity,
          live_card_keys: liveMatches.map((c) => c.source_item_id),
          lots: group.items.map((i) => i.source_item_id),
          // S32: the key this product's own new card gets (the new-card rule
          // below: the smallest lot key) - saved with a choice so the next
          // delivery, which also matches that card, is still recognised.
          own_card_key: ownCardKeyOf(group.items),
          // S32: a saved choice exists but the matched cards changed since.
          ...(verdict.kind === "stale" ? { stale_decision: true } : {}),
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
    // S32: ownCardKeyOf must name exactly this card (asserted in self-tests).
    const sorted = sortVariants(variants);

    if (group.items.length === 1 && liveMatches.length === 0) {
      // SLICE 65 (owner bugs A1/A3/A4): a singleton with a CONFIDENT family
      // takes the family display as its customer-facing name — the SAME
      // derivation grouped cards and restock identity already use, so the
      // built name folds back onto its own identity. Sizes, pack tokens and
      // vendor/brand prefixes are stripped; the mg dose stays for dose-led
      // categories. The raw manifest name stays on the card's product_name
      // (compliance under the hood). Unconfident families never reach here
      // (standalone + warning above), so nothing is ever guessed.
      const single = standaloneCard(base);
      if (group.display && group.display !== single.name) {
        diagnostics.push({
          severity: "info",
          code: "intake_display_name_built",
          message: `“${single.name}” will appear on the menu as “${group.display}” — the manifest name stays on file.`,
          context: {
            card_key: single.source_item_id,
            raw_name: single.product_name ?? single.name,
            display_name: group.display,
          },
        });
        single.name = group.display;
        // SLICE S12: only the placeholder is rebuilt with the built name; real
        // copy attached at onboarding is never overwritten (F-064).
        if (isBoilerplateDescription(single.description)) {
          single.description = `${group.display} from ${normalizeWhitespace(single.brand_name) || group.vendor}${BOILERPLATE_TAIL}`;
        }
      }
      newCards.push(single);
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
      // SLICE S12: real copy attached at onboarding (on the base lot, else
      // the first lot that has it) wins over the placeholder (F-064).
      description:
        sortedItems.map((gi) => gi.description).find((t) => !isBoilerplateDescription(t)) ??
        `${group.display} from ${normalizeWhitespace(base.brand_name) || group.vendor}${BOILERPLATE_TAIL}`,
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
    // SLICE 65: singletons now carry the BUILT display name — the dose stays
    // (it sells the product), the pack/form noise goes, raw stays under the hood.
    assert(names.includes("Rainbow Chews 100mg"), "edible dose split: 100mg standalone built name keeps the dose");
    assert(names.includes("Rainbow Chews 10mg"), "edible dose split: 10mg standalone built name keeps the dose");
    const raws = p.newCards.map((c) => c.product_name).sort();
    assert(raws.includes("Fairwinds - Rainbow Chews 100mg pack"), "edible dose split: raw 100mg name kept under the hood");
    assert(raws.includes("Rainbow_Chews_10mg_single"), "edible dose split: raw 10mg name kept under the hood");
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

  // S32 (D-R2-4): remembered merge decisions.
  {
    const twoLive = [live({}), live({ source_item_id: "card-2", variants: [] })];
    const base = plan([draft({})], [["d1", enrich({})]], twoLive);
    const amb = base.diagnostics.find((d) => d.code === "intake_master_merge_ambiguous");
    const identity = String(amb?.context?.identity ?? "");
    assert(identity.length > 0, "S32: ambiguous warning carries the identity the decision is keyed on");
    const withDecisions = (m: Map<string, MergeDecision>, cards = twoLive) =>
      buildIntakeMasteringPlan({
        drafts: [draft({})],
        existingKeys: new Set(),
        enrichmentByDraftId: new Map([["d1", enrich({})]]),
        liveCards: cards,
        mergeDecisions: m,
      });
    // (a) no decisions (empty map) → identical plan to no map at all.
    const a = withDecisions(new Map());
    assert(JSON.stringify(a.diagnostics) === JSON.stringify(base.diagnostics), "S32 (a): empty decisions → identical diagnostics");
    assert(JSON.stringify(a.newCards) === JSON.stringify(base.newCards), "S32 (a): empty decisions → identical new cards");
    assert(a.mergedVariantCount === base.mergedVariantCount, "S32 (a): empty decisions → identical merge count");
    // (b) join with the matching candidate set → appended to target, no warnings.
    const b = withDecisions(
      new Map([[identity, { decision: "join", target_card_key: "card-2", candidate_card_keys: ["card-2", "card-1"] }]]),
    );
    assert(b.newCards.length === 0, "S32 (b): join → no new card");
    assert(b.mergedVariantCount === 1, "S32 (b): join → one merged variant");
    assert((b.mergesByCardKey.get("card-2") ?? []).length === 1, "S32 (b): join → variants on the CHOSEN card");
    assert(!b.mergesByCardKey.has("card-1"), "S32 (b): join → never on the other card");
    assert(!b.diagnostics.some((d) => d.severity === "warning"), "S32 (b): join → zero warnings");
    const bd = b.diagnostics.find((d) => d.code === "intake_master_restock");
    assert(bd?.context?.decided === true && bd?.context?.identity === identity, "S32 (b): restock diagnostic marks the human decision");
    // (c) separate → new card + info diagnostic, zero warnings.
    const c = withDecisions(
      new Map([[identity, { decision: "separate", target_card_key: null, candidate_card_keys: ["card-1", "card-2"] }]]),
    );
    assert(c.newCards.length === 1 && c.mergedVariantCount === 0, "S32 (c): separate → its own new card");
    assert(!c.diagnostics.some((d) => d.severity === "warning"), "S32 (c): separate → zero warnings");
    const cd = c.diagnostics.find((d) => d.code === "intake_master_kept_separate");
    assert(cd?.severity === "info" && cd?.context?.decided === true && cd?.context?.identity === identity, "S32 (c): kept-separate info diagnostic");
    // (d) candidate set changed → the warning returns with stale_decision.
    const threeLive = [...twoLive, live({ source_item_id: "card-3", variants: [] })];
    const d = withDecisions(
      new Map([[identity, { decision: "join", target_card_key: "card-1", candidate_card_keys: ["card-1", "card-2"] }]]),
      threeLive,
    );
    const dd = d.diagnostics.find((x) => x.code === "intake_master_merge_ambiguous");
    assert(dd?.severity === "warning" && dd?.context?.stale_decision === true, "S32 (d): changed cards → stale warning");
    assert(d.mergedVariantCount === 0 && d.newCards.length === 1, "S32 (d): stale decision never applied");
    const dSep = withDecisions(
      new Map([[identity, { decision: "separate", target_card_key: null, candidate_card_keys: ["card-1", "card-2"] }]]),
      threeLive,
    );
    assert(!dSep.diagnostics.some((x) => x.code === "intake_master_kept_separate"), "S32 (d): stale separate not applied");
    assert(dSep.diagnostics.some((x) => x.context?.stale_decision === true), "S32 (d): stale separate → stale warning");
    // (e) join target that is now hidden → stale (hidden cards never match).
    const e3 = [live({}), live({ source_item_id: "card-2", variants: [] }), live({ source_item_id: "card-3", variants: [] })];
    const eBase = withDecisions(new Map(), e3);
    const eId = String(eBase.diagnostics.find((x) => x.code === "intake_master_merge_ambiguous")?.context?.identity ?? "");
    const e = withDecisions(
      new Map([[eId, { decision: "join", target_card_key: "card-3", candidate_card_keys: ["card-1", "card-2", "card-3"] }]]),
      [e3[0], e3[1], { ...e3[2], hidden: true }],
    );
    assert(e.mergedVariantCount === 0, "S32 (e): hidden join target → nothing merged");
    assert(
      e.diagnostics.some((x) => x.code === "intake_master_merge_ambiguous" && x.context?.stale_decision === true),
      "S32 (e): hidden join target → stale warning",
    );
    // A decision for a different identity never leaks.
    const other = withDecisions(
      new Map([["someone|else|entirely", { decision: "join", target_card_key: "card-1", candidate_card_keys: ["card-1", "card-2"] }]]),
    );
    assert(other.mergedVariantCount === 0 && !other.diagnostics.some((x) => x.context?.stale_decision), "S32: other identity's decision ignored");
    // A single live match is untouched by any decision.
    const single = withDecisions(
      new Map([[identity, { decision: "separate", target_card_key: null, candidate_card_keys: ["card-1", "card-2"] }]]),
      [live({})],
    );
    assert(single.mergedVariantCount === 1, "S32: a single match still restocks (decisions only apply to 2+)");
    // Pure helpers.
    assert(sameCardKeySet(["a", "b"], ["b", "a", "a"]), "sameCardKeySet: order/dupes ignored");
    assert(!sameCardKeySet(["a", "b"], ["a", "c"]), "sameCardKeySet: different member");
    assert(!sameCardKeySet(["a"], ["a", "b"]), "sameCardKeySet: different size");
    assert(mergeDecisionVerdict(undefined, ["a"]).kind === "none", "verdict: none");
    assert(mergeDecisionVerdict({ decision: "join", target_card_key: "z", candidate_card_keys: ["a", "b"] }, ["a", "b"]).kind === "stale", "verdict: join target outside matches → stale");
    assert(mergeDecisionVerdict({ decision: "join", target_card_key: null, candidate_card_keys: ["a", "b"] }, ["a", "b"]).kind === "stale", "verdict: join without target → stale");
    const vj = mergeDecisionVerdict({ decision: "join", target_card_key: "b", candidate_card_keys: ["a", "b"] }, ["b", "a"]);
    assert(vj.kind === "join" && vj.targetKey === "b", "verdict: join");
    assert(mergeDecisionVerdict({ decision: "separate", target_card_key: null, candidate_card_keys: ["a", "b"] }, ["a", "b"]).kind === "separate", "verdict: separate");
    // own_card_key: the delivery went live as its own card, so the next
    // delivery matches the candidates PLUS that card - still the same choice.
    const vo = mergeDecisionVerdict({ decision: "join", target_card_key: "b", candidate_card_keys: ["a", "b"], own_card_key: "o" }, ["a", "o", "b"]);
    assert(vo.kind === "join" && vo.targetKey === "b" && !vo.keptSeparate, "verdict: join still applies once own card is live");
    const so = mergeDecisionVerdict({ decision: "separate", target_card_key: null, candidate_card_keys: ["a", "b"], own_card_key: "o" }, ["o", "a", "b"]);
    assert(so.kind === "join" && so.targetKey === "o" && so.keptSeparate, "verdict: separate + own card live → onto its own card");
    assert(mergeDecisionVerdict({ decision: "join", target_card_key: "b", candidate_card_keys: ["a", "b"], own_card_key: "o" }, ["a", "o", "b", "x"]).kind === "stale", "verdict: own + an extra card → stale");
    assert(mergeDecisionVerdict({ decision: "join", target_card_key: "b", candidate_card_keys: ["a", "b"], own_card_key: "o" }, ["a", "o"]).kind === "stale", "verdict: own replaces a candidate → stale");
    assert(mergeDecisionVerdict({ decision: "join", target_card_key: "b", candidate_card_keys: ["a", "b"] }, ["a", "o", "b"]).kind === "stale", "verdict: no own key → an extra card is stale");
    assert(mergeDecisionVerdict({ decision: "join", target_card_key: "o", candidate_card_keys: ["a", "b"], own_card_key: "o" }, ["a", "o", "b"]).kind === "stale", "verdict: join target must be a saved candidate");
    assert(mergeDecisionVerdict({ decision: "join", target_card_key: "a", candidate_card_keys: ["a", "b"], own_card_key: "a" }, ["a", "b"]).kind === "stale", "verdict: own key inside candidates never joins itself");
    // End to end: the delivery's own card (smallest lot key) is live.
    const ownLive = [...twoLive, live({ source_item_id: "LOT-A", variants: [{ source_variant_id: "LOT-A-onboarded", medical: false }] })];
    const nextDraft = draft({ id: "d9", pos_product_key: "LOT-Z", name: "Blue Dream 3.5g" });
    const nextPlan = (m: Map<string, MergeDecision>) =>
      buildIntakeMasteringPlan({
        drafts: [nextDraft],
        existingKeys: new Set(),
        enrichmentByDraftId: new Map([["d9", enrich({})]]),
        liveCards: ownLive,
        mergeDecisions: m,
      });
    const nAmb = nextPlan(new Map()).diagnostics.find((x) => x.code === "intake_master_merge_ambiguous");
    const nIds = (nAmb?.context?.live_card_keys as string[] | undefined) ?? [];
    assert(nIds.length === 3 && nIds.includes("LOT-A") && String(nAmb?.context?.identity) === identity, "S32: own card joins the match set on the next delivery (same identity)");
    const nJoin = nextPlan(new Map([[identity, { decision: "join", target_card_key: "card-2", candidate_card_keys: ["card-1", "card-2"], own_card_key: "LOT-A" }]]));
    assert((nJoin.mergesByCardKey.get("card-2") ?? []).length === 1 && !nJoin.diagnostics.some((x) => x.severity === "warning"), "S32: next delivery joins the chosen card, no warning");
    const nSep = nextPlan(new Map([[identity, { decision: "separate", target_card_key: null, candidate_card_keys: ["card-1", "card-2"], own_card_key: "LOT-A" }]]));
    assert((nSep.mergesByCardKey.get("LOT-A") ?? []).length === 1 && nSep.newCards.length === 0, "S32: next delivery of a kept-separate product restocks its own card");
    const nSepD = nSep.diagnostics.find((x) => x.code === "intake_master_restock");
    assert(nSepD?.context?.decision === "separate" && !nSep.diagnostics.some((x) => x.severity === "warning"), "S32: kept-separate restock is labelled and warning-free");
    assert(nJoin.diagnostics.find((x) => x.code === "intake_master_restock")?.context?.decision === "join", "S32: joined restock is labelled join");
    // own_card_key on the warning IS the key the separate card really gets.
    const two = plan(
      [draft({ pos_product_key: "LOT-M" }), draft({ id: "d2", pos_product_key: "LOT-C", name: "Blue Dream 3.5g" })],
      [["d1", enrich({})], ["d2", enrich({})]],
      twoLive,
    );
    const twoAmb = two.diagnostics.find((x) => x.code === "intake_master_merge_ambiguous");
    assert(twoAmb?.context?.own_card_key === "LOT-C" && two.newCards.length === 1 && two.newCards[0].source_item_id === "LOT-C", "S32: own_card_key names the new card (smallest lot key)");
    assert(ownCardKeyOf([]) === null && ownCardKeyOf([{ source_item_id: "b" }, { source_item_id: "a" }]) === "a", "ownCardKeyOf helper");
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
    // SLICE 65: no confident family → the raw name is KEPT (never guess a name).
    assert(
      p.newCards.every((c) => c.name === "Fairwinds 1g" || c.name === "Fairwinds 3.5g"),
      "ambiguous name: raw names kept, never rebuilt on a guess",
    );
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

  // SLICE 65: a singleton with a confident family gets the BUILT display
  // name (size stripped); the raw manifest name stays in product_name.
  {
    const p = plan([draft({})], [["d1", enrich({})]]);
    assert(p.newCards.length === 1, "singleton: one card");
    const card = p.newCards[0];
    assert(card.source_item_id === "LOT-A", "singleton: keyed on the lot");
    assert(card.name === "Blue Dream", "singleton: display name built from the family (no size token)");
    assert(card.product_name === "Blue Dream 1g", "singleton: raw manifest name kept under the hood");
    assert(card.description.startsWith("Blue Dream from"), "singleton: description uses the built name");
    assert(
      p.diagnostics.some((d) => d.code === "intake_display_name_built" && d.severity === "info"),
      "singleton: rename disclosed via diagnostic",
    );
    assert(card.variants.length === 1 && card.variants[0].source_variant_id === "LOT-A-onboarded",
      "singleton: one -onboarded variant");
  }

  // SLICE 65: junk manifest wording on a strain-led singleton → the strain IS
  // the name; ambiguous names below keep raw (never guess).
  {
    const p = plan(
      [
        draft({
          id: "j1",
          pos_product_key: "LOT-J1",
          name: "2727 - Blunts - 2727 - DOH - Strawberry - Tropicana Cookies - 1.5g",
          strain_name: "Tropicana Cookies",
        }),
      ],
      [["j1", enrich({ websiteCategory: "blunt", packageLabel: "1.5g" })]],
    );
    assert(p.newCards.length === 1, "junk singleton: one card");
    assert(p.newCards[0].name === "Tropicana Cookies", "junk singleton: strain-led built name");
    assert(
      p.newCards[0].product_name === "2727 - Blunts - 2727 - DOH - Strawberry - Tropicana Cookies - 1.5g",
      "junk singleton: raw manifest name kept under the hood",
    );
  }

  // SLICE 65: helper mirrors the planner — built name, or null when blank
  // vendor / unconfident (caller keeps raw, never guesses).
  {
    assert(
      intakeDisplayName({ name: "Blue Dream 1g", product_name: "Blue Dream 1g", brand_name: "Fairwinds", vendor_name: "Fairwinds LLC", category: "flower", strain_name: "Blue Dream" }) === "Blue Dream",
      "helper: strain-led built name",
    );
    assert(
      intakeDisplayName({ name: "Rainbow_Chews_100mg_single", product_name: "Rainbow_Chews_100mg_single", brand_name: "", vendor_name: "Fairwinds LLC", category: "edible-solid", strain_name: null }) === "Rainbow Chews 100mg",
      "helper: dose-led keeps the mg dose, strips the pack/form noise",
    );
    assert(
      intakeDisplayName({ name: "Blue Dream 1g", product_name: "Blue Dream 1g", brand_name: "Fairwinds", vendor_name: null, category: "flower", strain_name: "Blue Dream" }) === null,
      "helper: blank vendor → null (never guess)",
    );
    assert(
      intakeDisplayName({ name: "Fairwinds 3.5g", product_name: "Fairwinds 3.5g", brand_name: "Fairwinds", vendor_name: "Fairwinds LLC", category: "paraphernalia", strain_name: null }) === null,
      "helper: unconfident family → null (never guess)",
    );
  }

  // Family helpers: strain-led uses strain; underscores normalize; category
  // fallback is refused (null), never guessed.
  {
    const fam = deriveFamily({ category: "flower", vendor: "X", name: "whatever", strainName: "Blue_Dream" });
    assert(!!fam && fam.display === "Blue Dream" && fam.family === "blue-dream", "family: strain-led");
    assert(familyFromName("Fairwinds 3.5g", "Fairwinds") === null, "family: strips to nothing → null");
    // R29: cannabinoid abbreviations stay upper-case on the family display name.
    assert(familyFromName("const hrg cbn:cbg 1:1 blueberry 10pk", "", true) === "Const Hrg CBN:CBG 1:1 Blueberry", "family: R29 CBN/CBG upper-case -> " + familyFromName("const hrg cbn:cbg 1:1 blueberry 10pk", "", true));
    assert(collapseFamilyKeyPart("Const Hrg CBN 1:1") === collapseFamilyKeyPart("Const Hrg Cbn 1:1"), "family: R29 case change never moves identity");
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
    // R29 (supersedes the SLICE 62 "package THC 100mg" pin): an intake draft
    // only has lab PERCENTS (WCIA uom "pct"), and reading total_thc_pct 10 as
    // "10 mg per serving" was the guess behind the 0.12 mg menu cards. The
    // bundle still carries what the NAME states (pack count, ratio); the mg
    // waits for the lab certificate or a person (draft-injection-core pins
    // both halves: no-COA -> null, COA -> 100 mg).
    const facts = p.lotFactsByKey.get("LOT-E1");
    assert(facts !== undefined, "lot facts: verified edible carries a fact bundle");
    assert(facts!.package_thc_mg === null, "lot facts: R29 lab percent never becomes package THC mg");
    assert(facts!.servings_per_pack === 10, "lot facts: verified servings 10");
    assert(facts!.ratio_label === "1:1:1", "lot facts: ratio label");
  }
  {
    const p = plan([draft({})], [["d1", enrich({})]]);
    assert(!p.lotFactsByKey.has("LOT-A"), "lot facts: flower has no mg bundle");
    assert(p.lotFactsByKey.get("LOT-A")?.minor_cannabinoids_json === undefined, "lot facts: no minors key invented");
  }
  // R29: lab-certificate CBG / CBC mg reach the lot's golden record
  // (inventory_lots.minor_cannabinoids_json) - THC / CBD stay in their columns.
  {
    const p = plan(
      [
        draft({
          id: "m1",
          pos_product_key: "LOT-M1",
          name: "bytes - CBG:CBC:CBD:THC (2:2:2:1) - 10pk - Sour Mandarin - 50g",
          inventory_type: "Solid Edible",
          thc_pct: 0.1206,
          cbd_pct: 0.2219,
          total_thc_pct: 0.1206,
          potency_json: { thc: 0.1206, cbd: 0.2219 },
        }),
      ],
      [[
        "m1",
        enrich({
          websiteCategory: "edibles",
          coaFacts: {
            usable: true,
            servingWeightG: 4.54,
            thcMgPerServing: { value: 5.5, confidence: "verified", note: "t" },
            cbdMgPerServing: { value: 10, confidence: "verified", note: "c" },
            cbdNotDetected: false,
            servingsPerPack: 10,
            packageThcMg: { value: 55, confidence: "verified", note: "5.5 x 10" },
            packageCbdMg: { value: 100, confidence: "verified", note: "10 x 10" },
            minors: [
              { cannabinoid: "CBG", mgPerServing: 10, packageMg: 100 },
              { cannabinoid: "CBC", mgPerServing: 9.5, packageMg: 95 },
            ],
            ratioCheck: null,
            reasons: [],
            notes: ["n"],
          },
        }),
      ]],
    );
    const facts = p.lotFactsByKey.get("LOT-M1");
    const minors = (facts?.minor_cannabinoids_json ?? []).map((c) => `${c.type}:${c.value}${c.unit}`).join(",");
    assert(minors === "cbg:100mg,cbc:95mg", "R29 lot facts: minors from the COA -> " + minors);
    assert(facts!.package_thc_mg === 55 && facts!.package_cbd_mg === 100, "R29 lot facts: THC / CBD stay in their columns");
    const card = p.newCards.find((c) => c.source_item_id === "LOT-M1")!;
    const cbgRow = card.compounds_json.find((c) => c.type === "cbg")!;
    cbgRow.value = "999";
    assert(facts!.minor_cannabinoids_json![0].value === "100", "R29 lot facts: minors are copies (card edits never leak)");
  }

  // --- S19: vendor-id identity (bible S19.5) ---------------------------------
  {
    const vid = (lotToVid: [string, string][], liveLots: [string, string[]][]): VendorIdInputs => ({
      vendorIdByLotKey: new Map(lotToVid),
      lotVendorIdsByKey: new Map(liveLots.map(([k, v]) => [k, new Set(v)])),
    });
    // Cultivera card: vendor spelled from INVENTORIES `Vendor`; its lots carry
    // pos_product_key = the card key and the vendor row the import resolved.
    const cult = live({
      source_item_id: "pos-0123456789ab",
      vendor_name: "Fairwinds Manufacturing",
      variants: [{ source_variant_id: "pos-0123456789ab-aa11", medical: false }],
    });
    const ids = vid([["LOT-A", "V-FW"]], [["pos-0123456789ab", ["V-FW"]]]);

    // S19.5 #1: different vendor spelling, same vendor_id -> MERGE.
    const withIds = buildIntakeMasteringPlan({
      drafts: [draft({})],
      existingKeys: new Set(),
      enrichmentByDraftId: new Map([["d1", enrich({})]]),
      liveCards: [cult],
      vendorIds: ids,
    });
    assert(withIds.newCards.length === 0, "S19.5 same id: no new card");
    assert(withIds.mergedVariantCount === 1, "S19.5 same id: merged one variant");
    assert(withIds.mergesByCardKey.get("pos-0123456789ab")?.[0]?.source_variant_id === "LOT-A-onboarded", "S19.5 same id: onto the Cultivera card, own lot key");
    const rd = withIds.diagnostics.find((d) => d.code === "intake_master_restock");
    assert(rd?.context?.matched_by === "vendor_id", "S19.5 same id: diagnostic says matched_by vendor_id");
    assert(rd?.context?.vendor_record_differs === false, "S19.5 same id: vendor record does not differ");

    // Same input WITHOUT ids (flag off / read incomplete): pre-S19 duplicate.
    const noIds = plan([draft({})], [["d1", enrich({})]], [cult]);
    assert(noIds.newCards.length === 1 && noIds.mergedVariantCount === 0, "S19 flag off: name rule byte-for-byte (duplicate card)");

    // Different ids with different spellings -> still a new card (never guessed).
    const otherVid = buildIntakeMasteringPlan({
      drafts: [draft({})],
      existingKeys: new Set(),
      enrichmentByDraftId: new Map([["d1", enrich({})]]),
      liveCards: [cult],
      vendorIds: vid([["LOT-A", "V-OTHER"]], [["pos-0123456789ab", ["V-FW"]]]),
    });
    assert(otherVid.newCards.length === 1 && otherVid.mergedVariantCount === 0, "S19 different id + different name: new card");

    // Same NAME, different vendor row -> still merged (additive, never
    // subtractive) and flagged vendor_record_differs.
    const sameName = buildIntakeMasteringPlan({
      drafts: [draft({})],
      existingKeys: new Set(),
      enrichmentByDraftId: new Map([["d1", enrich({})]]),
      liveCards: [live({})],
      vendorIds: vid([["LOT-A", "V-NEW"]], [["LOT-OLD", ["V-OLD"]]]),
    });
    assert(sameName.mergedVariantCount === 1 && sameName.newCards.length === 0, "S19 same name, other vendor row: still merged (never subtract)");
    const sd = sameName.diagnostics.find((d) => d.code === "intake_master_restock");
    assert(sd?.context?.matched_by === "name" && sd?.context?.vendor_record_differs === true, "S19 same name other row: flagged");

    // Mixed ids inside one group -> name rule (groupVendorId null).
    const mixed = buildIntakeMasteringPlan({
      drafts: [draft({}), draft({ id: "d2", pos_product_key: "LOT-B", name: "Blue Dream 3.5g", price_minor_units: 3500 })],
      existingKeys: new Set(),
      enrichmentByDraftId: new Map([["d1", enrich({})], ["d2", enrich({ packageLabel: "3.5g" })]]),
      liveCards: [cult],
      vendorIds: vid([["LOT-A", "V-FW"], ["LOT-B", "V-X"]], [["pos-0123456789ab", ["V-FW"]]]),
    });
    assert(mixed.newCards.length === 1 && mixed.mergedVariantCount === 0, "S19 mixed ids in group: name rule");

    // S19.5 #2: ambiguous -> new card + diagnostic (unchanged), incl. via id.
    const amb = buildIntakeMasteringPlan({
      drafts: [draft({})],
      existingKeys: new Set(),
      enrichmentByDraftId: new Map([["d1", enrich({})]]),
      liveCards: [cult, live({ source_item_id: "pos-0123456789cd", vendor_name: "Fairwinds Mfg", variants: [] })],
      vendorIds: vid([["LOT-A", "V-FW"]], [["pos-0123456789ab", ["V-FW"]], ["pos-0123456789cd", ["V-FW"]]]),
    });
    assert(amb.newCards.length === 1 && amb.mergedVariantCount === 0, "S19.5 ambiguous: new card");
    const ad = amb.diagnostics.find((d) => d.code === "intake_master_merge_ambiguous");
    assert(ad?.severity === "warning", "S19.5 ambiguous: warning diagnostic unchanged");
    assert(JSON.stringify(ad?.context?.live_card_keys) === JSON.stringify(["pos-0123456789ab", "pos-0123456789cd"]), "S19.5 ambiguous: both id cards listed");
    // Name ambiguity is untouched by ids (pre-S19 decision stands).
    const nameAmb = buildIntakeMasteringPlan({
      drafts: [draft({})],
      existingKeys: new Set(),
      enrichmentByDraftId: new Map([["d1", enrich({})]]),
      liveCards: [live({}), live({ source_item_id: "card-2", variants: [] }), cult],
      vendorIds: ids,
    });
    assert(nameAmb.newCards.length === 1 && nameAmb.diagnostics.some((d) => d.code === "intake_master_merge_ambiguous"), "S19.5 name-ambiguous stays ambiguous");
    // NEVER WORSE: a same-name card + an id-only card -> still merges onto the name card.
    const nameStands = buildIntakeMasteringPlan({
      drafts: [draft({})],
      existingKeys: new Set(),
      enrichmentByDraftId: new Map([["d1", enrich({})]]),
      liveCards: [live({}), cult],
      vendorIds: ids,
    });
    assert(nameStands.mergedVariantCount === 1 && nameStands.mergesByCardKey.has("card-1") && nameStands.newCards.length === 0, "S19 never worse: the name match still merges");

    // Blank-vendor Cultivera card never a target, even when its lot has the id (S19.8).
    const blank = buildIntakeMasteringPlan({
      drafts: [draft({})],
      existingKeys: new Set(),
      enrichmentByDraftId: new Map([["d1", enrich({})]]),
      liveCards: [live({ source_item_id: "pos-0123456789ab", vendor_name: "", variants: [] })],
      vendorIds: ids,
    });
    assert(blank.newCards.length === 1 && blank.mergedVariantCount === 0, "S19.8 blank-vendor card never a merge target");

    // Hidden card with the id is never a target either.
    const hid = buildIntakeMasteringPlan({
      drafts: [draft({})],
      existingKeys: new Set(),
      enrichmentByDraftId: new Map([["d1", enrich({})]]),
      liveCards: [{ ...cult, hidden: true }],
      vendorIds: ids,
    });
    assert(hid.newCards.length === 1, "S19 hidden id card never a target");

    // Receiving card (-onboarded variants): its variant lots carry the id.
    const recv = buildIntakeMasteringPlan({
      drafts: [draft({})],
      existingKeys: new Set(),
      enrichmentByDraftId: new Map([["d1", enrich({})]]),
      liveCards: [live({ source_item_id: "LOT-OLD", vendor_name: "Fairwinds Mfg", variants: [{ source_variant_id: "LOT-OLD2-onboarded", medical: false }] })],
      vendorIds: vid([["LOT-A", "V-FW"]], [["LOT-OLD2", ["V-FW"]]]),
    });
    assert(recv.mergedVariantCount === 1 && recv.mergesByCardKey.has("LOT-OLD"), "S19 receiving card via variant lot id");

    // S19.6 ACCEPTANCE FIXTURE: known restocks of Cultivera-born cards whose
    // vendor strings differ from the manifest licensee. Duplicate cards
    // (a new card for a product that is already live) with the name rule vs
    // with vendor ids: must drop to ZERO.
    const liveFx = [
      live({ source_item_id: "pos-aaaaaaaaaaa1", name: "Blue Dream", vendor_name: "Fairwinds Manufacturing", variants: [] }),
      live({ source_item_id: "pos-aaaaaaaaaaa2", name: "Sour Diesel", strain_name: "Sour Diesel", vendor_name: "Seattles Private Reserve", brand_name: "SPR", variants: [] }),
      live({ source_item_id: "pos-aaaaaaaaaaa3", name: "Gelato", strain_name: "Gelato", vendor_name: "Ceres Garden LLC", brand_name: "Ceres", variants: [] }),
    ];
    const draftsFx = [
      draft({ id: "x1", pos_product_key: "LOT-X1", vendor_name: "Fairwinds LLC" }),
      draft({ id: "x2", pos_product_key: "LOT-X2", name: "Sour Diesel 1g", strain_name: "Sour Diesel", brand_name: "SPR", vendor_name: "Seattle's Private Reserve" }),
      draft({ id: "x3", pos_product_key: "LOT-X3", name: "Gelato 1g", strain_name: "Gelato", brand_name: "Ceres", vendor_name: "CERES" }),
    ];
    const enrFx = new Map(draftsFx.map((d) => [d.id, enrich({})] as [string, DraftEnrichment]));
    const idsFx = vid(
      [["LOT-X1", "V1"], ["LOT-X2", "V2"], ["LOT-X3", "V3"]],
      [["pos-aaaaaaaaaaa1", ["V1"]], ["pos-aaaaaaaaaaa2", ["V2"]], ["pos-aaaaaaaaaaa3", ["V3"]]],
    );
    const before = buildIntakeMasteringPlan({ drafts: draftsFx, existingKeys: new Set(), enrichmentByDraftId: enrFx, liveCards: liveFx });
    const after = buildIntakeMasteringPlan({ drafts: draftsFx, existingKeys: new Set(), enrichmentByDraftId: enrFx, liveCards: liveFx, vendorIds: idsFx });
    assert(before.newCards.length === 3, "S19.6 fixture: name rule mints 3 duplicate cards");
    assert(after.newCards.length === 0 && after.mergedVariantCount === 3, "S19.6 fixture: vendor ids -> ZERO duplicate cards");

    // --- Preview (S19.2) agrees with the real plan ---
    const pv = (drafts: RestockPreviewDraft[], cards: LiveCardCandidate[], v?: VendorIdInputs) =>
      previewRestockVerdicts({ drafts, liveCards: cards, vendorIds: v });
    const row = (over: Partial<RestockPreviewDraft>): RestockPreviewDraft => ({
      id: "d1",
      pos_product_key: "LOT-A",
      name: "Blue Dream 1g",
      brand_name: "Fairwinds",
      vendor_name: "Fairwinds LLC",
      strain_name: "Blue Dream",
      category: "flower",
      ...over,
    });
    const j = pv([row({})], [cult], ids).get("d1");
    assert(j?.kind === "joins" && j.cardKey === "pos-0123456789ab" && j.fromCultivera && j.matchedBy === "vendor_id" && !j.vendorRecordDiffers, "preview: joins Cultivera card via id");
    assert(j?.kind === "joins" && j.cardName === "Blue Dream", "preview: card name carried");
    const jr = pv([row({})], [live({})]).get("d1");
    assert(jr?.kind === "joins" && !jr.fromCultivera && jr.matchedBy === "name", "preview: joins receiving card by name");
    const jd = pv([row({})], [live({})], vid([["LOT-A", "V-NEW"]], [["LOT-OLD", ["V-OLD"]]])).get("d1");
    assert(jd?.kind === "joins" && jd.vendorRecordDiffers === true, "preview: vendor record differs flagged");
    assert(pv([row({})], [cult]).get("d1")?.kind === "new", "preview: no ids -> new (matches the plan)");
    const a2 = pv([row({})], [live({}), live({ source_item_id: "card-2", variants: [] })], ids).get("d1");
    assert(a2?.kind === "ambiguous" && a2.cardKeys.join() === "card-1,card-2", "preview: ambiguous 2");
    const al = pv([row({ pos_product_key: "pos-0123456789ab" })], [cult], ids).get("d1");
    assert(al?.kind === "already_live" && !al.asSize && al.cardKey === "pos-0123456789ab", "preview F-068: POS key already a live card");
    const as = pv([row({ pos_product_key: "LOT-OLD" })], [live({})]).get("d1");
    assert(as?.kind === "already_live" && as.asSize && as.cardKey === "card-1", "preview: lot already a size");
    assert(pv([row({ vendor_name: "  " })], [cult]).get("d1")?.kind === "no_vendor", "preview: no vendor");
    assert(pv([row({ name: "Flower", strain_name: null })], [cult]).get("d1")?.kind === "vague_name", "preview: vague name");
    assert(!pv([row({ pos_product_key: null })], [cult]).has("d1") && !pv([row({ pos_product_key: " " })], [cult]).has("d1"), "preview: keyless -> no verdict");
    assert(!pv([row({ category: null })], [cult]).has("d1") && !pv([row({ category: "  " })], [cult]).has("d1"), "preview: unmapped -> no verdict");
    // Group verdict: two rows of the same product share one verdict.
    const ids2 = vid([["LOT-A", "V-FW"], ["LOT-B", "v-fw "]], [["pos-0123456789ab", ["V-FW"]]]);
    const g2 = pv([row({}), row({ id: "d2", pos_product_key: "LOT-B", name: "Blue Dream 3.5g" })], [cult], ids2);
    assert(g2.size === 2 && g2.get("d1") === g2.get("d2") && g2.get("d1")?.kind === "joins", "preview: grouped rows share ONE verdict");
    // One row missing its id -> whole group on the name rule -> new.
    const g4 = pv([row({}), row({ id: "d2", pos_product_key: "LOT-Z", name: "Blue Dream 3.5g" })], [cult], vid([["LOT-A", "V-FW"]], [["pos-0123456789ab", ["V-FW"]]]));
    assert(g4.get("d1")?.kind === "new" && g4.get("d2")?.kind === "new", "preview: group with a missing id -> name rule");
    // Preview == plan on the acceptance fixture.
    const pf = pv(draftsFx.map((d) => row({ id: d.id, pos_product_key: d.pos_product_key, name: d.name, brand_name: d.brand_name, vendor_name: d.vendor_name, strain_name: d.strain_name })), liveFx, idsFx);
    assert([...pf.values()].every((v) => v.kind === "joins") && pf.size === 3, "preview == plan on the S19.6 fixture");

    // --- S34: previewMasteringGroups wraps the SAME dry run ---
    const sameMap = (a: Map<string, RestockVerdict>, b: Map<string, RestockVerdict>) =>
      a.size === b.size && [...a.keys()].join() === [...b.keys()].join() && [...a].every(([k, v]) => JSON.stringify(v) === JSON.stringify(b.get(k)));
    const s34Fixtures: Array<[RestockPreviewDraft[], LiveCardCandidate[], VendorIdInputs | undefined]> = [
      [[row({})], [cult], ids],
      [[row({})], [live({})], undefined],
      [[row({})], [live({}), live({ source_item_id: "card-2", variants: [] })], ids],
      [[row({ pos_product_key: "pos-0123456789ab" })], [cult], ids],
      [[row({ pos_product_key: "LOT-OLD" })], [live({})], undefined],
      [[row({ vendor_name: " " }), row({ id: "d2", name: "Flower", strain_name: null }), row({ id: "d3", pos_product_key: null }), row({ id: "d4", category: null })], [cult], undefined],
      [[row({}), row({ id: "d2", pos_product_key: "LOT-B", name: "Blue Dream 3.5g" })], [cult], ids2],
      [draftsFx.map((d) => row({ id: d.id, pos_product_key: d.pos_product_key, name: d.name, brand_name: d.brand_name, vendor_name: d.vendor_name, strain_name: d.strain_name })), liveFx, idsFx],
    ];
    assert(
      s34Fixtures.every(([dr, lc, v]) => sameMap(previewMasteringGroups({ drafts: dr, liveCards: lc, vendorIds: v }).verdicts, pv(dr, lc, v))),
      "S34: wrapper verdicts identical on every S19 preview fixture",
    );
    const s34Rows = [
      row({ id: "m1", pos_product_key: "LOT-M1", name: "Blue Dream 7g", size_label: "7 g" }),
      row({ id: "m2", pos_product_key: "LOT-M2", name: "Blue Dream 1g", size_label: "1 g" }),
      row({ id: "m3", pos_product_key: "LOT-M3", name: "Blue Dream 3.5g", size_label: null }),
      row({ id: "m4", pos_product_key: "LOT-M4", name: "Blue Dream 3.5g", size_label: "3.5 g" }),
      row({ id: "n1", pos_product_key: "LOT-N1", name: "Gelato 1g", strain_name: "Gelato", size_label: "1 g" }),
      row({ id: "x1", pos_product_key: "pos-0123456789ab" }),
      row({ id: "x2", pos_product_key: "LOT-OLD" }),
      row({ id: "x3", vendor_name: "" }),
      row({ id: "x4", name: "Flower", strain_name: null }),
      row({ id: "x5", pos_product_key: null }),
    ];
    const liveSized = live({
      variants: [
        { source_variant_id: "LOT-OLD-onboarded", medical: false, label: "3.5g", price_minor_units: 3500, inventory_level: 9 },
        { source_variant_id: "LOT-OLD2-onboarded", medical: false, label: "1g", price_minor_units: 1200, inventory_level: 5 },
      ],
    });
    const mg = previewMasteringGroups({ drafts: s34Rows, liveCards: [liveSized, cult] });
    const grouped = mg.groups.flatMap((g) => g.draftIds);
    assert(new Set(grouped).size === grouped.length, "S34: each draft in at most one group");
    assert(grouped.slice().sort().join() === "m1,m2,m3,m4,n1", "S34: every groupable draft in exactly one group");
    assert(["x1", "x2", "x3", "x4", "x5"].every((id) => !grouped.includes(id)), "S34: already_live / no_vendor / vague_name / keyless rows are not grouped");
    assert(mg.groups.length === 2 && mg.groups[0].draftIds.join() === "m1,m2,m3,m4", "S34: groups in first-seen order, members in input order");
    assert(mg.groups[0].sizes.join("|") === "1 g|3.5 g|7 g|" + PREVIEW_SIZE_UNKNOWN, "S34: sizes in ladder order, unknown sizes last and named");
    assert(mg.groups.every((g) => g.draftIds.every((id) => mg.verdicts.get(id) === g.verdict)), "S34: group verdict === each member's verdict");
    const bd = mg.groups[0];
    assert(bd.verdict.kind === "joins" && bd.liveCard?.key === "card-1", "S34: joins group carries the live card");
    assert(bd.liveCard?.variantLabels.join() === "1g,3.5g", "S34: live card sizes in ladder order");
    assert(bd.liveCard?.priceRangeMinor?.join() === "1200,3500" && bd.liveCard?.onHand === 14, "S34: live card price range + on hand");
    assert(mg.groups[1].verdict.kind === "new" && mg.groups[1].liveCard === undefined, "S34: new group has no live card");
    assert(bd.identity === "fairwinds-llc|flower|blue-dream" && bd.identity === identityKey("Fairwinds LLC", "flower", "blue-dream") && bd.category === "flower" && bd.family === "blue-dream", "S34: group carries the S19 identity (the S32 review key)");
    const s34Amb = previewMasteringGroups({ drafts: [row({})], liveCards: [live({}), live({ source_item_id: "card-2", variants: [] })], vendorIds: ids }).groups;
    assert(s34Amb.length === 1 && s34Amb[0].verdict.kind === "ambiguous" && s34Amb[0].liveCard === undefined, "S34: ambiguous group, no single live card");
    // liveCardView honesty: unknown level -> null on hand; no prices -> null range.
    const lv = liveCardView(live({ variants: [{ source_variant_id: "a", medical: false, label: " 7g ", price_minor_units: null, inventory_level: 3 }, { source_variant_id: "b", medical: false, label: "", inventory_level: null }] }));
    assert(lv.onHand === null && lv.priceRangeMinor === null && lv.variantLabels.join() === "7g", "S34: liveCardView never invents stock or price");
    assert(liveCardView(live({ variants: [] })).onHand === null, "S34: a card with no variants has unknown stock");
    assert(lotPackageLabel({ unit_weight: 3.5, unit_weight_uom: "g" }) === "3.5 g" && lotPackageLabel({ unit_weight: 1, unit_weight_uom: null }) === "1", "S34: lotPackageLabel = the staging label");
    assert(lotPackageLabel({ unit_weight: null, unit_weight_uom: "g" }) === null && lotPackageLabel(null) === null && lotPackageLabel({ unit_weight: 0, unit_weight_uom: "g" }) === "0 g", "S34: lotPackageLabel null only without a weight (0 kept, as before)");
    assert(liveCardView(live({ variants: [{ source_variant_id: "a", medical: false, label: "1g", price_minor_units: 900, inventory_level: -2 }] })).onHand === 0, "S34: negative stock counts as zero");
    // buildLiveMergeIndex / matchLiveCards surface.
    const idx = buildLiveMergeIndex([cult], ids);
    assert(idx.byVendorId.size === 1 && idx.vidsByCard.get("pos-0123456789ab")?.has("v-fw") === true, "index: vendor-id keyed (lowercased)");
    assert(buildLiveMergeIndex([cult]).byVendorId.size === 0 && buildLiveMergeIndex([cult]).vidsByCard.size === 0, "index: no ids -> empty id maps");
    assert(buildLiveMergeIndex([cult]).variantLotKeys.size === 0, "index: pos- variant ids are not lots");
    assert(buildLiveMergeIndex([live({})]).variantLotKeys.get("LOT-OLD") === "card-1", "index: onboarded variant lot mapped");

    // planVendorIdLookup: only the lots that could matter.
    const other = live({ source_item_id: "card-9", name: "Gelato", strain_name: "Gelato", variants: [{ source_variant_id: "LOT-G-onboarded", medical: false }] });
    const edible = live({ source_item_id: "card-8", category: "edible-solid", name: "Blue Dream Gummies 100mg", variants: [] });
    const lk = planVendorIdLookup({ drafts: [row({}), row({ id: "d2", pos_product_key: "LOT-A" })], liveCards: [cult, live({}), other, edible] });
    assert(lk.draftLotKeys.join() === "LOT-A", "lookup: draft keys deduped");
    assert(lk.liveLotKeys.join() === "pos-0123456789ab,card-1,LOT-OLD", "lookup: only same axis+family cards' lots");
    assert(!lk.overCap, "lookup: under the cap");
    assert(planVendorIdLookup({ drafts: [row({ vendor_name: "" }), row({ id: "x", category: null }), row({ id: "y", pos_product_key: null }), row({ id: "z", name: "Flower", strain_name: null })], liveCards: [cult] }).liveLotKeys.length === 0, "lookup: unusable rows ask nothing");
    assert(planVendorIdLookup({ drafts: [row({})], liveCards: [{ ...cult, hidden: true }, live({ source_item_id: "m", variants: [{ source_variant_id: "M-onboarded", medical: true }] }), live({ source_item_id: "b", vendor_name: " " })] }).liveLotKeys.length === 0, "lookup: hidden / medical-only / blank-vendor cards skipped");
    assert(planVendorIdLookup({ drafts: [row({ category: "preroll-pack", name: "Blue Dream 5pk" })], liveCards: [live({ category: "preroll", variants: [] })] }).liveLotKeys.join() === "card-1", "lookup: pack axis folds");
    const many = Array.from({ length: VENDOR_ID_LIVE_KEY_CAP + 1 }, (_, i) => live({ source_item_id: `c${i}`, variants: [] }));
    assert(planVendorIdLookup({ drafts: [row({})], liveCards: many }).overCap, "lookup: over the cap is reported");
    assert(!planVendorIdLookup({ drafts: [row({})], liveCards: many.slice(0, VENDOR_ID_LIVE_KEY_CAP) }).overCap, "lookup: exactly the cap is fine");
    assert(VENDOR_ID_LIVE_KEY_CAP === 2000, "lookup: cap pinned");
    // buildVendorIdInputs
    const vi2 = buildVendorIdInputs({
      draftLots: [
        { pos_product_key: " LOT-A ", vendor_id: " V1 " },
        { pos_product_key: "LOT-A", vendor_id: "v1" },
        { pos_product_key: "LOT-C", vendor_id: "v1" },
        { pos_product_key: "LOT-C", vendor_id: "v2" },
        { pos_product_key: "LOT-B", vendor_id: null },
        { pos_product_key: null, vendor_id: "v3" },
      ],
      liveLots: [{ pos_product_key: "K", vendor_id: "V1" }, { pos_product_key: "K", vendor_id: "v4" }, { pos_product_key: "K", vendor_id: "" }, { pos_product_key: " ", vendor_id: "v5" }],
    });
    assert(vi2.vendorIdByLotKey.size === 1 && vi2.vendorIdByLotKey.get("LOT-A") === "v1", "inputs: draft ids trimmed+lowercased, agreeing repeats kept, blanks dropped");
    assert(!vi2.vendorIdByLotKey.has("LOT-C"), "inputs: a draft key whose lots disagree gets NO id (never pick one)");
    assert([...(vi2.lotVendorIdsByKey.get("K") ?? [])].join() === "v1,v4" && vi2.lotVendorIdsByKey.size === 1, "inputs: live ids unioned, blanks dropped");
  }

  // SLICE S12: the placeholder is rebuilt with the built name, but REAL copy
  // attached at onboarding is never overwritten (F-064), on a singleton or a
  // rolled-up card.
  {
    const p = plan([draft({})], [["d1", enrich({})]]);
    assert(
      p.newCards[0].description ===
        "Blue Dream from Fairwinds. Browse current availability, package options, and pricing at Greenway Marijuana in Port Orchard.",
      "S12: singleton placeholder rebuilt with the built name, byte for byte",
    );
  }
  {
    const gd = { text: "Sweet berry, calm finish.", field: "description" as const, source: "gemini" as const, confidence: 0.95 };
    const p = plan([draft({})], [["d1", enrich({ goldenDescription: gd })]]);
    assert(p.newCards[0].name === "Blue Dream", "S12: singleton still gets the built name");
    assert(p.newCards[0].description === "Sweet berry, calm finish.", "S12: singleton keeps attached copy");
  }
  {
    const gd = { text: "Grouped real copy.", field: "description" as const, source: "human" as const, confidence: null };
    const p = plan(
      [
        draft({}),
        draft({ id: "d2", pos_product_key: "LOT-B", name: "Blue Dream 3.5g", price_minor_units: 3500 }),
      ],
      [
        ["d1", enrich({})],
        ["d2", enrich({ packageLabel: "3.5g", goldenDescription: gd })],
      ],
    );
    assert(p.newCards.length === 1, "S12: rollup still one card");
    assert(p.newCards[0].description === "Grouped real copy.", "S12: rollup takes the first lot with real copy");
  }
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
    assert(
      p.newCards[0].description ===
        "Blue Dream from Fairwinds. Browse current availability, package options, and pricing at Greenway Marijuana in Port Orchard.",
      "S12: rollup with no real copy keeps the placeholder, byte for byte",
    );
  }

  return { passed };
}
