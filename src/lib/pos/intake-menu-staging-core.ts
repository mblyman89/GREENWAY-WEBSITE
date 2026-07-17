/**
 * src/lib/pos/intake-menu-staging-core.ts
 *
 * Intake auto-carry — PURE planner. (The server executor now also
 * AUTO-PUBLISHES the staged result per owner-approved Option 1; this planner
 * itself remains publish-agnostic — it only builds the snapshot.)
 *
 * WHY: products received via the new receiving/intake system must reach the
 * customer-facing menu AND become sellable in the front POS WITHOUT the
 * one-time Cultivera "Menu Imports" (POS-export) upload — that page is a
 * throw-away, one-time tool. Today the ONLY way a `menu_versions` row is born
 * is a POS-export import; there is no path to stage/publish a menu version from
 * accepted intake alone. This planner closes that gap.
 *
 * WHAT: given the currently-PUBLISHED menu snapshot (so nothing already live is
 * lost) plus the APPROVED onboarding products for an accepted manifest, produce
 * the full item set for a NEW STAGED version. Publishing a version is an ATOMIC
 * SWAP (the site reads exactly one published version), so an intake-origin
 * staged version MUST be a COMPLETE snapshot = every currently-published item
 * carried forward + the newly approved intake items appended. If it only held
 * the new items, publishing would wipe the live menu down to just those.
 *
 * SCOPE: this only PLANS the snapshot for a staged version. The go-live
 * decision (auto-publish after item-by-item draft approval, with the Menu
 * Imports Publish button as the fallback) lives entirely in the server
 * executor — nothing in this planner touches publish state.
 *
 * NEVER GUESS: approved-draft eligibility (no lot number / no resolvable
 * website category / no approved price / superseded by a live POS key) is
 * still decided by the verified pure planner `buildDraftInjectionPlan` —
 * ineligible drafts are SKIPPED with a diagnostic, never invented. POS-key
 * (= lot number) collisions with a carried-forward item are treated as
 * "already on the menu" (the live row wins; the intake row is skipped with an
 * info diagnostic) so accepting a manifest never silently overwrites a live
 * product's price/data.
 *
 * PRODUCT MASTERING (Option A Slice 2): eligible intake items are then rolled
 * up by `buildIntakeMasteringPlan` — same brand + website category + product
 * family become ONE card with one variant per lot/size, and a group matching
 * exactly one live card joins that card as new variants (restock) instead of
 * duplicating it. Every variant keeps ITS OWN lot's identity
 * (`${lotKey}-onboarded`), which the variant-aware sale path resolves for
 * FIFO decrement / CCRS / costs / recalls. A restock-merged card's
 * inventory_status is recomputed from its variants' summed on-hand — the POS
 * menu HIDES "unavailable" cards, so a sold-out card MUST wake up when its
 * restock lands (price/label are never touched on a live card).
 *
 * PURE: no I/O. The server module (intake-menu-staging.ts) gathers the DB rows
 * and enrichment, calls this, and writes the result.
 */
import type {
  ApprovedDraftForInjection,
  DraftEnrichment,
  InjectionDiagnostic,
} from "@/lib/pos/draft-injection-core";
import {
  buildIntakeMasteringPlan,
  type MasteredNewCard,
  type MasteredVariant,
} from "@/lib/pos/intake-mastering-core";

/**
 * A currently-published menu item to carry forward verbatim into the new
 * staged snapshot. This is the persisted DB shape (minus ids/version), so the
 * executor can re-insert it unchanged under the new version id.
 */
export type CarryForwardItem = {
  source_item_id: string;
  name: string;
  product_name: string | null;
  brand_name: string;
  vendor_name: string | null;
  category: string;
  filter_categories: string[];
  pos_inventory_type: string | null;
  pos_inventory_category: string | null;
  strain_type: string;
  strain_name: string | null;
  thc: string | null;
  cbd: string | null;
  total_thc_json: unknown | null;
  total_cbd_json: unknown | null;
  compounds_json: unknown;
  description: string;
  price_label: string;
  price_minor_units: number;
  inventory_status: string;
  hidden: boolean;
  hidden_reason: string | null;
  variants: {
    source_variant_id: string;
    label: string;
    price_minor_units: number;
    inventory_level: number;
    medical: boolean;
  }[];
};

/**
 * A single item to persist under the new staged version, with its variants,
 * carrying an explicit sort order and an origin tag for the review screen.
 */
export type StagedSnapshotItem = {
  origin: "carried" | "intake";
  source_item_id: string;
  name: string;
  product_name: string | null;
  brand_name: string;
  vendor_name: string | null;
  category: string;
  filter_categories: string[];
  pos_inventory_type: string | null;
  pos_inventory_category: string | null;
  strain_type: string;
  strain_name: string | null;
  thc: string | null;
  cbd: string | null;
  total_thc_json: unknown | null;
  total_cbd_json: unknown | null;
  compounds_json: unknown;
  description: string;
  price_label: string;
  price_minor_units: number;
  inventory_status: string;
  hidden: boolean;
  hidden_reason: string | null;
  sort_order: number;
  variants: {
    source_variant_id: string;
    label: string;
    price_minor_units: number;
    inventory_level: number;
    medical: boolean;
    sort_order: number;
  }[];
};

export type IntakeStagingInputs = {
  /** Every item on the current published version (empty when nothing is live). */
  publishedItems: CarryForwardItem[];
  /** APPROVED onboarding drafts for the accepted manifest. */
  approvedDrafts: ApprovedDraftForInjection[];
  /** Per-draft enrichment (website category / strain type / on-hand / label). */
  enrichmentByDraftId: Map<string, DraftEnrichment>;
};

export type IntakeStagingPlan = {
  /** The full item set for the new staged version (carried + intake). */
  items: StagedSnapshotItem[];
  /** How many published items were carried forward. */
  carriedCount: number;
  /** How many NEW intake cards were added. */
  addedCount: number;
  /** How many restock variants were merged into carried live cards. */
  mergedCount: number;
  /** True when there is at least one new card OR merged restock variant. */
  hasChanges: boolean;
  diagnostics: InjectionDiagnostic[];
};

/** Convert a mastered new card into a staged snapshot item. */
function masteredToSnapshot(it: MasteredNewCard, sortOrder: number): StagedSnapshotItem {
  return {
    origin: "intake",
    source_item_id: it.source_item_id,
    name: it.name,
    product_name: it.product_name,
    brand_name: it.brand_name,
    vendor_name: it.vendor_name,
    category: it.category,
    filter_categories: it.filter_categories,
    pos_inventory_type: it.pos_inventory_type,
    pos_inventory_category: it.pos_inventory_category,
    strain_type: it.strain_type,
    strain_name: it.strain_name,
    thc: it.thc,
    cbd: it.cbd,
    total_thc_json: it.total_thc_json,
    total_cbd_json: it.total_cbd_json,
    compounds_json: it.compounds_json,
    description: it.description,
    price_label: it.price_label,
    price_minor_units: it.price_minor_units,
    inventory_status: it.inventory_status,
    hidden: it.hidden,
    hidden_reason: it.hidden_reason,
    sort_order: sortOrder,
    variants: it.variants.map((v, i) => ({
      source_variant_id: v.source_variant_id,
      label: v.label,
      price_minor_units: v.price_minor_units,
      inventory_level: v.inventory_level,
      medical: v.medical,
      sort_order: i,
    })),
  };
}

/**
 * Append restock variants to a carried live card and recompute its
 * inventory_status from the summed on-hand of ALL its variants (same
 * thresholds as draft-injection-core statusForOnHand). The POS menu HIDES
 * "unavailable" cards, so a sold-out card must wake up when its restock
 * lands. Nothing else on the live card (price/label/name) is touched.
 */
function applyMergeToCarried(item: StagedSnapshotItem, merged: MasteredVariant[]): void {
  // Defensive: never append a variant identity the card already has.
  const seen = new Set(item.variants.map((v) => v.source_variant_id));
  let sort = item.variants.length;
  for (const v of merged) {
    if (seen.has(v.source_variant_id)) continue;
    seen.add(v.source_variant_id);
    item.variants.push({
      source_variant_id: v.source_variant_id,
      label: v.label,
      price_minor_units: v.price_minor_units,
      inventory_level: v.inventory_level,
      medical: v.medical,
      sort_order: sort,
    });
    sort += 1;
  }
  const total = item.variants.reduce((s, v) => s + v.inventory_level, 0);
  item.inventory_status = total <= 0 ? "unavailable" : total <= 3 ? "low-stock" : "in-stock";
}

/** Carry a published item forward verbatim into the new snapshot. */
function carryForward(item: CarryForwardItem, sortOrder: number): StagedSnapshotItem {
  return {
    origin: "carried",
    source_item_id: item.source_item_id,
    name: item.name,
    product_name: item.product_name,
    brand_name: item.brand_name,
    vendor_name: item.vendor_name,
    category: item.category,
    filter_categories: item.filter_categories,
    pos_inventory_type: item.pos_inventory_type,
    pos_inventory_category: item.pos_inventory_category,
    strain_type: item.strain_type,
    strain_name: item.strain_name,
    thc: item.thc,
    cbd: item.cbd,
    total_thc_json: item.total_thc_json,
    total_cbd_json: item.total_cbd_json,
    compounds_json: item.compounds_json,
    description: item.description,
    price_label: item.price_label,
    price_minor_units: item.price_minor_units,
    inventory_status: item.inventory_status,
    hidden: item.hidden,
    hidden_reason: item.hidden_reason,
    sort_order: sortOrder,
    variants: item.variants.map((v, i) => ({
      source_variant_id: v.source_variant_id,
      label: v.label,
      price_minor_units: v.price_minor_units,
      inventory_level: v.inventory_level,
      medical: v.medical,
      sort_order: i,
    })),
  };
}

/**
 * Plan a full staged snapshot for an intake accept: carry every published item
 * forward first (their source keys become the "existing keys" so eligibility
 * treats a live product as already on the menu), then MASTER the approved
 * intake drafts — restock variants merge into the carried cards they match,
 * and the remaining groups append as new (possibly multi-variant) cards.
 * Deterministic + pure.
 */
export function buildIntakeStagedVersionPlan(inputs: IntakeStagingInputs): IntakeStagingPlan {
  const items: StagedSnapshotItem[] = [];

  // 1) Carry every currently-published item forward, preserving order. Dedupe
  //    defensively on source_item_id (a published version is already unique per
  //    key, but never trust — first occurrence wins).
  const existingKeys = new Set<string>();
  let sort = 0;
  for (const p of inputs.publishedItems) {
    const key = p.source_item_id;
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    items.push(carryForward(p, sort));
    sort += 1;
  }
  const carriedCount = items.length;

  // 2) Master the approved intake drafts. Eligibility (keyless / unpriced /
  //    unmapped / superseded-by-live) is decided inside via the draft planner;
  //    eligible items are grouped (same brand + category + family), matched
  //    against the carried live cards for restock merges, and rolled up.
  const mastering = buildIntakeMasteringPlan({
    drafts: inputs.approvedDrafts,
    existingKeys,
    enrichmentByDraftId: inputs.enrichmentByDraftId,
    liveCards: items
      .filter((it) => it.origin === "carried")
      .map((it) => ({
        source_item_id: it.source_item_id,
        name: it.name,
        brand_name: it.brand_name,
        category: it.category,
        strain_name: it.strain_name,
        hidden: it.hidden,
        variants: it.variants.map((v) => ({
          source_variant_id: v.source_variant_id,
          medical: v.medical,
        })),
      })),
  });

  // 3) Apply restock merges to the carried cards (variants appended, status
  //    recomputed so a sold-out card wakes up when its restock lands).
  const carriedByKey = new Map(items.map((it) => [it.source_item_id, it]));
  let mergedCount = 0;
  for (const [cardKey, merged] of mastering.mergesByCardKey) {
    const target = carriedByKey.get(cardKey);
    if (!target) continue; // defensive: planner only merges into provided cards
    applyMergeToCarried(target, merged);
    mergedCount += merged.length;
  }

  // 4) Append the new mastered cards after the carried ones.
  for (const card of mastering.newCards) {
    items.push(masteredToSnapshot(card, sort));
    sort += 1;
  }
  const addedCount = mastering.newCards.length;

  return {
    items,
    carriedCount,
    addedCount,
    mergedCount,
    hasChanges: addedCount > 0 || mergedCount > 0,
    diagnostics: mastering.diagnostics,
  };
}

// ---------------------------------------------------------------------------
// Embedded self-tests (house pattern)
// ---------------------------------------------------------------------------
export function __runIntakeMenuStagingCoreTests(): { passed: number } {
  let passed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL intake-menu-staging-core: " + msg);
    passed += 1;
  };

  const published = (over: Partial<CarryForwardItem>): CarryForwardItem => ({
    source_item_id: "LIVE-1",
    name: "Live Flower 3.5g",
    product_name: "Live Flower 3.5g",
    brand_name: "House",
    vendor_name: "House LLC",
    category: "flower",
    filter_categories: ["flower"],
    pos_inventory_type: null,
    pos_inventory_category: null,
    strain_type: "hybrid",
    strain_name: "Blue Dream",
    thc: "22%",
    cbd: "0.3%",
    total_thc_json: { type: "thc", value: "22", unit: "%" },
    total_cbd_json: null,
    compounds_json: [],
    description: "Live desc.",
    price_label: "$40.00 3.5g",
    price_minor_units: 4000,
    inventory_status: "in-stock",
    hidden: false,
    hidden_reason: null,
    variants: [
      {
        source_variant_id: "LIVE-1-v",
        label: "3.5g",
        price_minor_units: 4000,
        inventory_level: 12,
        medical: false,
      },
    ],
    ...over,
  });

  const draft = (over: Partial<ApprovedDraftForInjection>): ApprovedDraftForInjection => ({
    id: "d1",
    pos_product_key: "LOT-NEW-1",
    name: "New Concentrate 1g",
    brand_name: "Fairwinds",
    vendor_name: "Fairwinds LLC",
    strain_name: "GG4",
    thc_pct: 70,
    cbd_pct: 0.2,
    total_thc_pct: 74.5,
    potency_json: { thc: 70 },
    price_minor_units: 3000,
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  });
  const enrich = (over: Partial<DraftEnrichment>): DraftEnrichment => ({
    websiteCategory: "concentrate",
    strainType: "hybrid",
    onHandQty: 8,
    packageLabel: "1g",
    ...over,
  });

  // Empty live menu + one approved intake draft → one intake item, snapshot has
  // exactly that item, hasChanges true.
  {
    const plan = buildIntakeStagedVersionPlan({
      publishedItems: [],
      approvedDrafts: [draft({})],
      enrichmentByDraftId: new Map([["d1", enrich({})]]),
    });
    assert(plan.items.length === 1, "empty-live: one item");
    assert(plan.carriedCount === 0, "empty-live: nothing carried");
    assert(plan.addedCount === 1, "empty-live: one added");
    assert(plan.hasChanges, "empty-live: hasChanges");
    assert(plan.items[0].origin === "intake", "empty-live: origin intake");
    assert(plan.items[0].source_item_id === "LOT-NEW-1", "empty-live: keyed on lot number");
    assert(plan.items[0].sort_order === 0, "empty-live: sort 0");
    assert(plan.items[0].variants.length === 1, "empty-live: one variant");
  }

  // Live menu carried forward + new intake item appended after it.
  {
    const plan = buildIntakeStagedVersionPlan({
      publishedItems: [published({}), published({ source_item_id: "LIVE-2", name: "Live Edible" })],
      approvedDrafts: [draft({})],
      enrichmentByDraftId: new Map([["d1", enrich({})]]),
    });
    assert(plan.items.length === 3, "carry: 2 live + 1 intake = 3");
    assert(plan.carriedCount === 2, "carry: 2 carried");
    assert(plan.addedCount === 1, "carry: 1 added");
    assert(plan.items[0].origin === "carried" && plan.items[0].sort_order === 0, "carry: live first");
    assert(plan.items[1].origin === "carried" && plan.items[1].sort_order === 1, "carry: live second");
    assert(plan.items[2].origin === "intake" && plan.items[2].sort_order === 2, "carry: intake appended");
    // Carried item is verbatim, including its variant.
    assert(plan.items[0].price_minor_units === 4000, "carry: live price preserved");
    assert(plan.items[0].variants[0].source_variant_id === "LIVE-1-v", "carry: live variant preserved");
  }

  // POS-key (lot number) collision: the live product wins, intake row skipped
  // with a superseded diagnostic — accepting a manifest never overwrites a live
  // product's price/data.
  {
    const plan = buildIntakeStagedVersionPlan({
      publishedItems: [published({ source_item_id: "LOT-NEW-1", price_minor_units: 9999 })],
      approvedDrafts: [draft({})],
      enrichmentByDraftId: new Map([["d1", enrich({})]]),
    });
    assert(plan.items.length === 1, "collision: only the live item");
    assert(plan.carriedCount === 1 && plan.addedCount === 0, "collision: nothing added");
    assert(!plan.hasChanges, "collision: no changes");
    assert(plan.items[0].price_minor_units === 9999, "collision: live price wins");
    assert(
      plan.diagnostics.some((d) => d.code === "draft_superseded_by_pos"),
      "collision: superseded diagnostic",
    );
  }

  // No approved drafts at all → nothing to stage (hasChanges false).
  {
    const plan = buildIntakeStagedVersionPlan({
      publishedItems: [published({})],
      approvedDrafts: [],
      enrichmentByDraftId: new Map(),
    });
    assert(plan.items.length === 1, "no-drafts: just the live item");
    assert(!plan.hasChanges, "no-drafts: no changes");
    assert(plan.addedCount === 0, "no-drafts: nothing added");
  }

  // Unpriced / keyless / unmapped drafts are refused honestly (no invented data).
  {
    const plan = buildIntakeStagedVersionPlan({
      publishedItems: [],
      approvedDrafts: [
        draft({ id: "np", pos_product_key: "LOT-NP", price_minor_units: null }),
        draft({ id: "nk", pos_product_key: null }),
        draft({ id: "uc", pos_product_key: "LOT-UC" }),
      ],
      enrichmentByDraftId: new Map([
        ["np", enrich({})],
        ["nk", enrich({})],
        ["uc", enrich({ websiteCategory: null })],
      ]),
    });
    assert(plan.items.length === 0, "refuse: nothing injected");
    assert(!plan.hasChanges, "refuse: no changes");
    assert(plan.diagnostics.some((d) => d.code === "draft_inject_no_price"), "refuse: no-price diag");
    assert(plan.diagnostics.some((d) => d.code === "draft_inject_no_pos_key"), "refuse: no-key diag");
    assert(
      plan.diagnostics.some((d) => d.code === "draft_inject_unmapped_category"),
      "refuse: unmapped diag",
    );
  }

  // Defensive dedupe of a duplicated published key (first wins).
  {
    const plan = buildIntakeStagedVersionPlan({
      publishedItems: [published({ price_minor_units: 100 }), published({ price_minor_units: 200 })],
      approvedDrafts: [],
      enrichmentByDraftId: new Map(),
    });
    assert(plan.items.length === 1, "dedupe: duplicate live key collapsed");
    assert(plan.items[0].price_minor_units === 100, "dedupe: first live wins");
  }

  // MASTERING — restock merge: a new lot of a live product (same brand +
  // category + strain) joins the LIVE card as a new variant. No new card;
  // hasChanges is true on merges alone; the sold-out card wakes up.
  {
    const plan = buildIntakeStagedVersionPlan({
      publishedItems: [
        published({
          inventory_status: "unavailable",
          variants: [
            {
              source_variant_id: "LOT-OLD-onboarded",
              label: "3.5g",
              price_minor_units: 4000,
              inventory_level: 0,
              medical: false,
            },
          ],
        }),
      ],
      approvedDrafts: [
        draft({
          pos_product_key: "LOT-RESTOCK",
          name: "Blue Dream 3.5g",
          brand_name: "House",
          strain_name: "Blue Dream",
          price_minor_units: 3800, // deliberately different from the live card
        }),
      ],
      enrichmentByDraftId: new Map([
        ["d1", enrich({ websiteCategory: "flower", packageLabel: "3.5g", onHandQty: 20 })],
      ]),
    });
    assert(plan.items.length === 1, "restock: no duplicate card");
    assert(plan.addedCount === 0 && plan.mergedCount === 1, "restock: merged not added");
    assert(plan.hasChanges, "restock: merges alone count as changes");
    const card = plan.items[0];
    assert(card.variants.length === 2, "restock: variant appended to live card");
    assert(
      card.variants[1].source_variant_id === "LOT-RESTOCK-onboarded",
      "restock: appended variant keeps its own lot key",
    );
    assert(card.inventory_status === "in-stock", "restock: sold-out card woke up");
    assert(card.price_minor_units === 4000, "restock: live card price untouched by merge");
    assert(card.variants[1].price_minor_units === 3800, "restock: new variant keeps its own price");
    assert(
      plan.diagnostics.some((d) => d.code === "intake_master_restock"),
      "restock: diagnostic",
    );
  }

  // MASTERING — within-invoice rollup: two lots of the same brand + strain +
  // category become ONE new card with one variant per lot.
  {
    const plan = buildIntakeStagedVersionPlan({
      publishedItems: [],
      approvedDrafts: [
        draft({ id: "a", pos_product_key: "LOT-A", name: "GG4 1g", price_minor_units: 1200 }),
        draft({ id: "b", pos_product_key: "LOT-B", name: "GG4 3.5g", price_minor_units: 3500 }),
      ],
      enrichmentByDraftId: new Map([
        ["a", enrich({ websiteCategory: "flower", packageLabel: "1g" })],
        ["b", enrich({ websiteCategory: "flower", packageLabel: "3.5g" })],
      ]),
    });
    assert(plan.items.length === 1, "rollup: one card for two lots");
    assert(plan.addedCount === 1 && plan.mergedCount === 0, "rollup: one card added");
    const card = plan.items[0];
    assert(card.variants.length === 2, "rollup: two variants");
    assert(card.variants[0].source_variant_id === "LOT-A-onboarded", "rollup: variant A own lot key");
    assert(card.variants[1].source_variant_id === "LOT-B-onboarded", "rollup: variant B own lot key");
    assert(card.variants[0].sort_order === 0 && card.variants[1].sort_order === 1, "rollup: variant sort orders");
    assert(plan.diagnostics.some((d) => d.code === "intake_master_grouped"), "rollup: grouped diagnostic");
  }

  // MASTERING — never merge on a guess: two live cards share the identity →
  // the intake group becomes a NEW card with a warning instead of merging.
  {
    const plan = buildIntakeStagedVersionPlan({
      publishedItems: [published({}), published({ source_item_id: "LIVE-2" })],
      approvedDrafts: [
        draft({
          pos_product_key: "LOT-N",
          brand_name: "House",
          strain_name: "Blue Dream",
          name: "Blue Dream 1g",
        }),
      ],
      enrichmentByDraftId: new Map([["d1", enrich({ websiteCategory: "flower" })]]),
    });
    assert(plan.items.length === 3, "ambiguous: new card appended, no merge");
    assert(plan.mergedCount === 0 && plan.addedCount === 1, "ambiguous: added not merged");
    assert(
      plan.diagnostics.some((d) => d.code === "intake_master_merge_ambiguous" && d.severity === "warning"),
      "ambiguous: warning diagnostic",
    );
  }

  return { passed };
}
