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
 *   • WITHIN-INVOICE ROLLUP — drafts on one manifest that are the same brand +
 *     website category + product family become ONE card with one variant per
 *     lot/size.
 *   • RESTOCK MERGE — when a group's identity matches exactly ONE live card,
 *     its lots are APPENDED to that card as new variants (a restock or a new
 *     size) instead of spawning a duplicate card.
 *
 * OWNER RULE: "Only the same products with variants from the same brand
 * should be rolled up into one product card." Brand is always part of the
 * grouping identity; a blank brand is never grouped (standalone + warning).
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

export type IntakeMasteringPlan = {
  /** New cards to append (within-invoice rollup already applied). */
  newCards: MasteredNewCard[];
  /** Variants to APPEND to live cards, keyed by the card's source_item_id. */
  mergesByCardKey: Map<string, MasteredVariant[]>;
  diagnostics: InjectionDiagnostic[];
  addedCardCount: number;
  mergedVariantCount: number;
};

// --- Family normalization (mirrors transform.ts :265-269 and :734-775) -----

/** Categories whose display/family name is the STRAIN (transform.ts :763). */
const STRAIN_LED_CATEGORIES = new Set([
  "flower",
  "popcorn-bud",
  "infused-flower",
  "preroll",
  "preroll-pack",
  "infused-preroll",
  "infused-preroll-pack",
  "concentrate",
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
export function familyFromName(value: string, brand: string): string | null {
  let s = normalizeWhitespace(value).replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  const brandComparable = normalizeWhitespace(brand).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (brandComparable) s = s.replace(new RegExp(`^${brandComparable}\\s*[-:|]?\\s*`, "i"), "");
  s = s
    .replace(
      /\b\d+(?:\.\d+)?\s*(?:g|gram|grams|mg|milligram|milligrams|oz|ounce|ounces|ml|milliliter|milliliters|fl\.?\s*oz|fluid\s*ounce|fluidounce)\b/gi,
      " ",
    )
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
  brand: string;
  name: string;
  strainName: string | null;
}): { family: string; display: string } | null {
  const strain = normalizeWhitespace(input.strainName).replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  if (STRAIN_LED_CATEGORIES.has(input.category) && strain) {
    return { family: collapseFamilyKeyPart(strain), display: strain };
  }
  const stripped = familyFromName(input.name, input.brand);
  if (!stripped) return null;
  return { family: collapseFamilyKeyPart(stripped), display: stripped };
}

/** brand|category|family — the owner's "same product, same brand" identity. */
function identityKey(brand: string, category: string, family: string): string {
  return [collapseFamilyKeyPart(brand), category, family].join("|");
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
 *  3. Eligible items are grouped by brand|websiteCategory|family; unconfident
 *     family or blank brand → standalone card + warning (never auto-merge).
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
    const brand = normalizeWhitespace(card.brand_name);
    if (!brand) continue;
    const fam = deriveFamily({
      category: card.category,
      brand,
      name: card.name,
      strainName: card.strain_name,
    });
    if (!fam) continue;
    const key = identityKey(brand, card.category, fam.family);
    const list = liveByIdentity.get(key) ?? [];
    list.push(card);
    liveByIdentity.set(key, list);
  }

  const newCards: MasteredNewCard[] = [];
  const mergesByCardKey = new Map<string, MasteredVariant[]>();
  let mergedVariantCount = 0;

  // Group eligible planned items by identity, preserving first-seen order.
  type Group = {
    identity: string;
    display: string;
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

    const brand = normalizeWhitespace(it.brand_name);
    if (!brand) {
      // Owner rule: rollup is per-brand; a blank brand is never grouped.
      diagnostics.push({
        severity: "warning",
        code: "intake_master_no_brand",
        message: `Approved product “${it.name}” has no brand, so it was added as its own card (never grouped without a brand). Fix the brand on Product Onboarding if it should roll up.`,
        context: { pos_product_key: it.source_item_id },
      });
      newCards.push(standaloneCard(it));
      continue;
    }

    const fam = deriveFamily({
      category: it.category,
      brand,
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

    const key = identityKey(brand, it.category, fam.family);
    const group = groups.get(key);
    if (group) group.items.push(it);
    else groups.set(key, { identity: key, display: fam.display, items: [it] });
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

    const cheapest = sorted[0];
    const labelPart = cheapest.label === "each" ? "" : cheapest.label;
    const { variant: _v, sort_order: _s, ...baseRest } = base;
    void _v;
    void _s;
    newCards.push({
      ...baseRest,
      source_item_id: base.source_item_id,
      name: group.display,
      price_minor_units: cheapest.price_minor_units,
      price_label: [formatMoney(cheapest.price_minor_units), labelPart].filter(Boolean).join(" "),
      inventory_status: ((): MasteredNewCard["inventory_status"] => {
        const total = sorted.reduce((s, v) => s + v.inventory_level, 0);
        if (total <= 0) return "unavailable";
        if (total <= 3) return "low-stock";
        return "in-stock";
      })(),
      description: `${group.display} from ${base.brand_name}. Browse current availability, package options, and pricing at Greenway Marijuana in Port Orchard.`,
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
    diagnostics,
    addedCardCount: newCards.length,
    mergedVariantCount,
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

  // Same strain, DIFFERENT brand → two cards (owner rule: same brand only).
  {
    const p = plan(
      [draft({}), draft({ id: "d2", pos_product_key: "LOT-B", brand_name: "Other Farms" })],
      [
        ["d1", enrich({})],
        ["d2", enrich({})],
      ],
    );
    assert(p.newCards.length === 2, "brand split: two cards");
  }

  // Same brand, different strains → two cards.
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

  // Non-strain category groups on the noise-stripped name: sizes/pack words
  // strip away, brand prefix strips, so both land on one "Rainbow Chews" card.
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
    assert(p.newCards.length === 1, "edible rollup: one card");
    assert(p.newCards[0].name === "Rainbow Chews", "edible rollup: family name derived");
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

  // Blank brand → standalone + warning (owner rule: rollup is per-brand).
  {
    const p = plan(
      [draft({ brand_name: null }), draft({ id: "d2", pos_product_key: "LOT-B", brand_name: "  " })],
      [
        ["d1", enrich({})],
        ["d2", enrich({})],
      ],
    );
    assert(p.newCards.length === 2, "no brand: standalone cards");
    assert(
      p.diagnostics.filter((d) => d.code === "intake_master_no_brand").length === 2,
      "no brand: warnings",
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
    const fam = deriveFamily({ category: "flower", brand: "X", name: "whatever", strainName: "Blue_Dream" });
    assert(!!fam && fam.display === "Blue Dream" && fam.family === "blue-dream", "family: strain-led");
    assert(familyFromName("Fairwinds 3.5g", "Fairwinds") === null, "family: strips to nothing → null");
    assert(
      familyFromName("Bite_ind_peanut_butter_chip_1:1_10pk", "") ===
        "Bite Ind Peanut Butter Chip 1:1 10pk",
      "family: underscore names normalize like transform.ts Section E",
    );
  }

  return { passed };
}
