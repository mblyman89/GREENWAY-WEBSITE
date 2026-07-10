/**
 * src/lib/pos/intake-menu-staging-core.ts
 *
 * Intake auto-carry (owner Option B, NOT auto-published) — PURE planner.
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
 * DRAFTS-ONLY IS PRESERVED: this only plans a STAGED version. A human still
 * reviews it and presses Publish. Nothing here goes live on its own.
 *
 * NEVER GUESS: the approved-draft rows are turned into menu items by the
 * existing, verified pure planner `buildDraftInjectionPlan` — an approved draft
 * with no lot number / no resolvable website category / no approved price is
 * SKIPPED with a diagnostic, never invented. POS-key (= lot number) collisions
 * with a carried-forward item are treated as "already on the menu" (the live
 * row wins; the intake row is skipped with an info diagnostic) so accepting a
 * manifest never silently overwrites a live product's price/data.
 *
 * PURE: no I/O. The server module (intake-menu-staging.ts) gathers the DB rows
 * and enrichment, calls this, and writes the result.
 */
import {
  buildDraftInjectionPlan,
  type ApprovedDraftForInjection,
  type DraftEnrichment,
  type InjectionDiagnostic,
  type PlannedInjectedItem,
} from "@/lib/pos/draft-injection-core";

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
  /** How many published items were carried forward unchanged. */
  carriedCount: number;
  /** How many newly approved intake items were added. */
  addedCount: number;
  /** True when there is at least one NEW intake item to stage. */
  hasChanges: boolean;
  diagnostics: InjectionDiagnostic[];
};

/** Convert an injected-draft planner item into a staged snapshot item. */
function injectedToSnapshot(it: PlannedInjectedItem, sortOrder: number): StagedSnapshotItem {
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
    variants: it.variant
      ? [
          {
            source_variant_id: it.variant.source_variant_id,
            label: it.variant.label,
            price_minor_units: it.variant.price_minor_units,
            inventory_level: it.variant.inventory_level,
            medical: it.variant.medical,
            sort_order: it.variant.sort_order,
          },
        ]
      : [],
  };
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
 * forward first (their source keys become the "existing keys" so the draft
 * planner treats a live product as already on the menu), then append the newly
 * approved intake items. Deterministic + pure.
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

  // 2) Plan the approved intake drafts. The draft planner skips any draft whose
  //    key is already present (live product wins), whose category is unmapped,
  //    whose price is missing, or which has no lot number — each with a
  //    diagnostic. baseSortOrder appends intake items after the carried ones.
  const injection = buildDraftInjectionPlan({
    drafts: inputs.approvedDrafts,
    existingKeys,
    enrichmentByDraftId: inputs.enrichmentByDraftId,
    baseSortOrder: carriedCount,
  });

  for (const it of injection.items) {
    items.push(injectedToSnapshot(it, it.sort_order));
  }
  const addedCount = injection.items.length;

  return {
    items,
    carriedCount,
    addedCount,
    hasChanges: addedCount > 0,
    diagnostics: injection.diagnostics,
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

  return { passed };
}
