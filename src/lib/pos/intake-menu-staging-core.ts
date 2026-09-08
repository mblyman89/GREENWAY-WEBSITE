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
 * up by `buildIntakeMasteringPlan` — same vendor + website category + product
 * family become ONE card with one variant per lot/size, and a group matching
 * exactly one live card joins that card as new variants (restock) instead of
 * duplicating it. Every variant keeps ITS OWN lot's identity
 * (`${lotKey}-onboarded`), which the variant-aware sale path resolves for
 * FIFO decrement / CCRS / costs / recalls. A restock-merged card's
 * inventory_status is recomputed from its variants' summed on-hand — the POS
 * menu HIDES "unavailable" cards, so a sold-out card MUST wake up when its
 * restock lands (price/label are never touched on a live card). PACK AXIS:
 * multi-pack prerolls / infused prerolls / blunts group with their single-form
 * siblings, and a merged card's filter_categories is EXTENDED with the merged
 * lots' categories so the card stays reachable from both browse sections.
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
  type LotFactBundle,
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
  /**
   * SLICE 62: structured facts (migration 0138) carried forward VERBATIM so
   * a new intake snapshot never wipes facts the import path already earned.
   * Optional so historical fixtures keep compiling; missing means null.
   */
  servings_per_pack?: number | null;
  mg_per_serving?: number | null;
  package_thc_mg?: number | null;
  package_cbd_mg?: number | null;
  ratio_label?: string | null;
  net_weight_grams?: number | null;
  net_volume_ml?: number | null;
  fact_provenance?: Record<string, string> | null;
  /**
   * SLICE 18G (DEFECT 3): the four sales-limit classification columns
   * (migrations 0216 / 0217), carried forward for the same reason as the
   * SLICE 62 facts above and with far worse consequences if they are not.
   *
   * The register reads these off the MENU row and nothing else, and NULL is
   * the fail-open — 0216 says "NULL = not yet classified; the engine treats
   * NULL as a normal liquid". So before 18G, re-staging silently reverted every
   * classification in the shop to "nobody has answered" and the ten-unit and
   * low-THC limits stopped applying, with no error anywhere.
   *
   * NEVER coalesce null to false when carrying these. For otherwise_taken
   * there are three distinct states: null (unanswered — the receiving dock
   * must keep asking), false (a human said no — the dock must go quiet), and
   * true (the limit engages). Collapsing null into false would silence a
   * question nobody ever answered.
   *
   * Optional so historical fixtures keep compiling; missing means null.
   */
  low_thc_liquid?: boolean | null;
  unit_thc_mg?: number | null;
  otherwise_taken?: boolean | null;
  units_per_package?: number | null;
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
  /** SLICE 62: structured facts persisted to menu_items (migration 0138). */
  servings_per_pack: number | null;
  mg_per_serving: number | null;
  package_thc_mg: number | null;
  package_cbd_mg: number | null;
  ratio_label: string | null;
  net_weight_grams: number | null;
  net_volume_ml: number | null;
  fact_provenance: Record<string, string>;
  /**
   * SLICE 18G (DEFECT 3): the sales-limit classification columns
   * (migrations 0216 / 0217) as they will be PERSISTED to menu_items.
   *
   * Required here, not optional, and deliberately so: this is the shape the
   * insert is built from, so a producer that forgets one is a TYPE ERROR
   * rather than a silently NULL column in production. That is the whole
   * difference between how the compliance flags and the SLICE 62 facts are
   * declared, and it is the reason this defect could exist at all.
   *
   * null means "not classified" and must be preserved as null.
   */
  low_thc_liquid: boolean | null;
  unit_thc_mg: number | null;
  otherwise_taken: boolean | null;
  units_per_package: number | null;
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
  /** SLICE 62: verified extraction facts per lot key (for inventory_lots). */
  lotFactsByKey: Map<string, LotFactBundle>;
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
    servings_per_pack: it.servings_per_pack,
    mg_per_serving: it.mg_per_serving,
    package_thc_mg: it.package_thc_mg,
    package_cbd_mg: it.package_cbd_mg,
    ratio_label: it.ratio_label,
    // SLICE L3: these two were hardcoded null -- the SAME defect class as the
    // "SLICE 18G (DEFECT 3)" note below, and with the same silent blast
    // radius. The carry-forward mapper ~90 lines down maps them correctly, so
    // a CARRIED card kept its volume while a NEWLY RECEIVED one lost it, and
    // the register measured the new bottle against a 28 g category default.
    // Carried straight through; never re-derived here.
    net_weight_grams: it.net_weight_grams ?? null,
    net_volume_ml: it.net_volume_ml ?? null,
    fact_provenance: it.fact_provenance,
    // SLICE 18G (DEFECT 3): the SECOND producer, and the one the 18E writeup
    // missed. SLICE 18-0 deliberately plumbed the approver's compliance answers
    // all the way to PlannedInjectedItem, and standaloneCard() preserves them
    // through `...rest` — but this mapper dropped them, so a newly approved
    // product reached the register unclassified even though a human had just
    // answered the question. Carried straight through; never derived here,
    // because the two flags' fail-safes point in OPPOSITE directions and
    // guessing either one is how a limit silently stops applying.
    low_thc_liquid: it.low_thc_liquid,
    unit_thc_mg: it.unit_thc_mg,
    otherwise_taken: it.otherwise_taken,
    units_per_package: it.units_per_package,
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
    servings_per_pack: item.servings_per_pack ?? null,
    mg_per_serving: item.mg_per_serving ?? null,
    package_thc_mg: item.package_thc_mg ?? null,
    package_cbd_mg: item.package_cbd_mg ?? null,
    ratio_label: item.ratio_label ?? null,
    net_weight_grams: item.net_weight_grams ?? null,
    net_volume_ml: item.net_volume_ml ?? null,
    fact_provenance: item.fact_provenance ?? {},
    // SLICE 18G (DEFECT 3): carry the sales-limit classification forward.
    //
    // `?? null` here normalises a MISSING property (an older fixture, or a
    // read that predates 0216/0217) to an explicit null. It does NOT convert
    // false to null: `false ?? null` is false, which is the behaviour required
    // — false is a human's answer and it is what silences the receiving dock.
    // Using `||` instead of `??` would destroy that distinction, which is why
    // tests/compliance/classification-survives-restage.test.ts asserts a
    // literal false survives.
    low_thc_liquid: item.low_thc_liquid ?? null,
    unit_thc_mg: item.unit_thc_mg ?? null,
    otherwise_taken: item.otherwise_taken ?? null,
    units_per_package: item.units_per_package ?? null,
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
  //    eligible items are grouped (same vendor + category + family), matched
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
        vendor_name: it.vendor_name,
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
    // filter_categories only takes effect when NON-EMPTY (the menu falls back
    // to [category] when it's empty), so before adding a genuinely new
    // category (e.g. "preroll-pack" merging onto a single-preroll card) seed
    // the list with the card's own category — otherwise the addition alone
    // would DROP the card from its original section.
    const mergedCats = mastering.mergeCategoriesByCardKey.get(cardKey) ?? [];
    const newCats = mergedCats.filter(
      (c) => c && c !== target.category && !target.filter_categories.includes(c),
    );
    if (newCats.length > 0) {
      if (target.filter_categories.length === 0) {
        target.filter_categories = [target.category];
      }
      target.filter_categories = [...target.filter_categories, ...newCats];
    }
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
    lotFactsByKey: mastering.lotFactsByKey,
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

  // MASTERING — restock merge: a new lot of a live product (same vendor +
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
          vendor_name: "House LLC", // matches the live card's vendor (the axis)
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

  // MASTERING — within-invoice rollup: two lots of the same vendor + strain +
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
          vendor_name: "House LLC", // matches BOTH live cards' vendor
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

  // MASTERING — PACK-AXIS restock: a 5-pack lot (preroll-pack) merges into
  // the LIVE single-preroll card of the same vendor + strain, and the card's
  // filter_categories gains "preroll-pack" so it stays reachable from BOTH
  // browse sections.
  {
    const plan = buildIntakeStagedVersionPlan({
      publishedItems: [
        published({
          name: "Blue Dream",
          category: "preroll",
          filter_categories: ["preroll"],
          variants: [
            {
              source_variant_id: "LOT-OLDPR-onboarded",
              label: "1g",
              price_minor_units: 800,
              inventory_level: 6,
              medical: false,
            },
          ],
        }),
      ],
      approvedDrafts: [
        draft({
          pos_product_key: "LOT-NEWPK",
          name: "Blue Dream Prerolls 5pk",
          vendor_name: "House LLC", // matches the live card's vendor (the axis)
          strain_name: "Blue Dream",
          price_minor_units: 3000,
        }),
      ],
      enrichmentByDraftId: new Map([
        ["d1", enrich({ websiteCategory: "preroll-pack", packageLabel: "5pk", onHandQty: 10 })],
      ]),
    });
    assert(plan.items.length === 1, "pack-axis restock: no duplicate card");
    assert(plan.addedCount === 0 && plan.mergedCount === 1, "pack-axis restock: merged not added");
    const card = plan.items[0];
    assert(card.variants.length === 2, "pack-axis restock: pack variant appended");
    assert(
      card.variants[1].source_variant_id === "LOT-NEWPK-onboarded",
      "pack-axis restock: pack variant keeps its own lot key",
    );
    assert(card.category === "preroll", "pack-axis restock: card category untouched");
    assert(
      card.filter_categories.includes("preroll") && card.filter_categories.includes("preroll-pack"),
      "pack-axis restock: filter_categories covers both browse sections",
    );
  }

  return { passed };
}
