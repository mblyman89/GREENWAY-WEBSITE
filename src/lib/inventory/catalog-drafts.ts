/**
 * src/lib/inventory/catalog-drafts.ts
 *
 * POS Slice 8 — when a received lot doesn't match a product in the published
 * menu, we seed a DRAFT catalog product (from the transfer JSON + COA) so an
 * employee can validate and later publish it. Standing rule: machine output is
 * never auto-live — drafts must be approved by a human.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { usableCount } from "@/lib/supabase/read-completeness-core";
import { getPublishedVersion } from "@/lib/pos/menu-version";
import {
  classifyInsertError,
  planDraftSeeding,
  type SeedLotInput,
} from "@/lib/inventory/draft-seed-core";
import {
  assessDraftClassification,
  validateClassificationChoice,
} from "@/lib/inventory/draft-approval-gate-core";
// SLICE 18-0: the COMPLIANCE classification gate. Product Onboarding is the
// only classification step a RECEIVED lot can reach - fact review is scoped to
// an import_id, which a manifest-sourced lot never has.
import {
  assessReceivingClassification,
  validateReceivingClassificationChoice,
} from "@/lib/inventory/receiving-classification-core";
import { resolveWebsiteCategoryForLot } from "@/lib/inventory/website-category-resolver-server";
import { loadCategoryLabelMap } from "@/lib/pos/category-registry";
// SLICE 92: owner-created product types (inventory_types) are legal picks too.
import { listInventoryTypes } from "@/lib/pos/types-store";
// SLICE 93: strain-type intelligence - validate the approver's pick, fold the
// kb/lot/name signals into one >=90% verdict, and gap-fill the strain library
// so the type auto-attaches on future lots of the same strain.
import {
  validateStrainTypeChoice,
  suggestStrainType,
  decideKbStrainTypeWrite,
  STRAIN_TYPE_AUTO_MIN_CONFIDENCE,
} from "@/lib/inventory/strain-type-intel-core";
import { recordAudit } from "@/lib/auth/audit";
import {
  getPricingSettings,
  getVelocityForProduct,
  suggestPrice,
  validatePrice,
} from "@/lib/inventory/pricing";

export type CatalogDraft = {
  id: string;
  pos_product_key: string | null;
  source_item_id: string | null;
  name: string;
  brand_name: string | null;
  vendor_name: string | null;
  category: string | null;
  inventory_type: string | null;
  strain_name: string | null;
  thc_pct: number | null;
  cbd_pct: number | null;
  total_thc_pct: number | null;
  total_cannabinoids_pct: number | null;
  potency_json: Record<string, number> | null;
  manifest_id: string | null;
  lot_id: string | null;
  lab_result_id: string | null;
  unit_cost_minor_units: number | null;
  price_floor_minor_units: number | null;
  suggested_price_minor_units: number | null;
  price_minor_units: number | null;
  price_rationale: string | null;
  status: string; // draft | approved | dismissed
  notes: string | null;
  /**
   * SLICE 64 (migration 0141): the HUMAN's classification picks from the
   * approval card. Optional - absent on databases where 0141 hasn't run.
   */
  chosen_website_category?: string | null;
  chosen_house_type?: string | null;
  /**
   * SLICE 93 (migration 0146): the HUMAN's strain-type pick from the approval
   * card. Optional - absent on databases where 0146 hasn't run.
   */
  chosen_strain_type?: string | null;
  /**
   * SLICE 18-0 (migration 0218): the HUMAN's compliance classification from
   * the approval card - the only classification step a RECEIVED lot can reach.
   * Optional - absent on databases where 0218 hasn't run.
   */
  chosen_otherwise_taken?: boolean | null;
  chosen_units_per_package?: number | null;
  chosen_low_thc_liquid?: boolean | null;
  chosen_unit_thc_mg?: number | null;
  /** How each value came to exist - see receiving-classification-core.ts. */
  chosen_classification_provenance?: Record<string, string> | null;
  created_at: string;
  updated_at: string;
};

type LotForMatch = {
  id: string;
  pos_product_key: string | null;
  product_name: string | null;
  brand_id: string | null;
  vendor_id: string | null;
  category: string | null;
  inventory_type: string | null;
  strain_name: string | null;
  lab_result_id: string | null;
  unit_cost_minor_units: number | null;
};

/**
 * Result of checking a manifest's lots against the published catalog.
 */
export type CatalogMatchResult = {
  matched: number;
  unmatched: number;
  /** Whether a published menu version exists to match against. */
  hasPublishedMenu: boolean;
  /** Draft rows actually WRITTEN this run (verified inserts, not attempts). */
  draftsCreated: number;
  /** Inserts that FAILED with a real error (not benign duplicates). */
  draftsFailed: number;
  /** First real insert error message, for the timeline/UI. */
  firstError: string | null;
};

/**
 * For each lot on a manifest, check if its pos_product_key matches a
 * source_item_id in the published menu. For unmatched lots, seed a draft.
 * Returns HONEST counts for the UI — draftsCreated only counts rows the
 * database confirmed, and real insert errors are surfaced, never swallowed.
 *
 * Task AK fix: this used to `.upsert(..., { onConflict: "pos_product_key" })`,
 * but the only unique index on that column is PARTIAL (0026), which PostgREST
 * cannot target in ON CONFLICT (Postgres 42P10) — and the error was never
 * read, so EVERY insert failed silently and no draft was ever created. The
 * dedupe now happens up front in the pure planner (planDraftSeeding:
 * published-menu match → existing open draft → within-run duplicates) and the
 * writes are PLAIN INSERTS with errors read. The partial unique index still
 * backstops races: a 23505 unique violation is classified as a benign
 * duplicate, anything else counts as a failure.
 */
export async function seedDraftsForManifest(
  manifestId: string,
  actorId: string | null,
): Promise<CatalogMatchResult> {
  const empty: CatalogMatchResult = {
    matched: 0,
    unmatched: 0,
    hasPublishedMenu: false,
    draftsCreated: 0,
    draftsFailed: 0,
    firstError: null,
  };
  if (!isSupabaseServiceConfigured) return empty;
  const admin = createSupabaseAdminClient();

  const published = await getPublishedVersion();
  const hasPublishedMenu = Boolean(published);

  const { data: lotsData, error: lotsError } = await admin
    .from("inventory_lots")
    .select(
      "id, pos_product_key, product_name, brand_id, vendor_id, category, inventory_type, strain_name, lab_result_id, unit_cost_minor_units",
    )
    .eq("manifest_id", manifestId)
    .neq("status", "destroyed");
  if (lotsError) {
    console.error("[catalog-drafts] lots read failed:", lotsError.message);
    return { ...empty, hasPublishedMenu, firstError: lotsError.message };
  }
  const lots = (lotsData as LotForMatch[] | null) ?? [];
  if (lots.length === 0) return { ...empty, hasPublishedMenu };

  // Batched lookups for the pure planner: which of THIS manifest's keys are
  // already on the published menu, and which already have an OPEN draft.
  const lotKeys = Array.from(
    new Set(lots.map((l) => l.pos_product_key).filter((k): k is string => Boolean(k))),
  );
  const publishedKeys = new Set<string>();
  if (published && lotKeys.length > 0) {
    const { data: itemRows, error: itemsError } = await admin
      .from("menu_items")
      .select("source_item_id")
      .eq("menu_version_id", published.id)
      .in("source_item_id", lotKeys);
    if (itemsError) {
      console.error("[catalog-drafts] published-items read failed:", itemsError.message);
      return { ...empty, hasPublishedMenu, firstError: itemsError.message };
    }
    for (const r of (itemRows as { source_item_id: string }[] | null) ?? []) {
      publishedKeys.add(r.source_item_id);
    }
  }
  const openDraftKeys = new Set<string>();
  if (lotKeys.length > 0) {
    const { data: draftRows, error: draftsError } = await admin
      .from("catalog_product_drafts")
      .select("pos_product_key")
      .eq("status", "draft")
      .in("pos_product_key", lotKeys);
    if (draftsError) {
      console.error("[catalog-drafts] open-drafts read failed:", draftsError.message);
      return { ...empty, hasPublishedMenu, firstError: draftsError.message };
    }
    for (const r of (draftRows as { pos_product_key: string | null }[] | null) ?? []) {
      if (r.pos_product_key) openDraftKeys.add(r.pos_product_key);
    }
  }

  const seedInputs: SeedLotInput[] = lots.map((l) => ({
    lotId: l.id,
    posProductKey: l.pos_product_key,
  }));
  const plan = planDraftSeeding({ lots: seedInputs, publishedKeys, openDraftKeys });
  const lotById = new Map(lots.map((l) => [l.id, l] as const));

  // Cache vendor/brand name lookups so we don't refetch per lot.
  const vendorNames = new Map<string, string | null>();
  const brandNames = new Map<string, string | null>();
  const labCache = new Map<
    string,
    {
      thc_pct: number | null;
      cbd_pct: number | null;
      total_thc_pct: number | null;
      total_cannabinoids_pct: number | null;
      potency_json: Record<string, number> | null;
    }
  >();

  const pricingSettings = await getPricingSettings();

  let draftsCreated = 0;
  let draftsFailed = 0;
  let firstError: string | null = null;

  for (const seed of plan.toSeed) {
    const lot = lotById.get(seed.lotId);
    if (!lot) continue;

    // Resolve display names (best-effort).
    let vendorName: string | null = null;
    if (lot.vendor_id) {
      if (!vendorNames.has(lot.vendor_id)) {
        const { data } = await admin
          .from("vendors")
          .select("display_name")
          .eq("id", lot.vendor_id)
          .maybeSingle();
        vendorNames.set(lot.vendor_id, (data as { display_name: string } | null)?.display_name ?? null);
      }
      vendorName = vendorNames.get(lot.vendor_id) ?? null;
    }
    let brandName: string | null = null;
    if (lot.brand_id) {
      if (!brandNames.has(lot.brand_id)) {
        const { data } = await admin
          .from("brands")
          .select("display_name")
          .eq("id", lot.brand_id)
          .maybeSingle();
        brandNames.set(lot.brand_id, (data as { display_name: string } | null)?.display_name ?? null);
      }
      brandName = brandNames.get(lot.brand_id) ?? null;
    }

    // Carry potency from the lab result.
    let lab = {
      thc_pct: null as number | null,
      cbd_pct: null as number | null,
      total_thc_pct: null as number | null,
      total_cannabinoids_pct: null as number | null,
      potency_json: null as Record<string, number> | null,
    };
    if (lot.lab_result_id) {
      if (!labCache.has(lot.lab_result_id)) {
        const { data } = await admin
          .from("lab_results")
          .select("thc_pct, cbd_pct, total_thc_pct, total_cannabinoids_pct, potency_json")
          .eq("id", lot.lab_result_id)
          .maybeSingle();
        const d = data as typeof lab | null;
        labCache.set(lot.lab_result_id, d ?? lab);
      }
      lab = labCache.get(lot.lab_result_id) ?? lab;
    }

    // Pricing: compute the 2× floor + a velocity-aware suggested price.
    const velocity = await getVelocityForProduct(lot.pos_product_key, 60);
    // T-319: pass the category so the auto price folds the RIGHT tax divisor
    // (cannabis 1.463 vs merch 1.093) and lands on a clean whole dollar.
    const suggestion = suggestPrice(
      lot.unit_cost_minor_units,
      velocity,
      pricingSettings,
      lot.category,
    );

    // PLAIN INSERT (dedupe already planned above) — READ the error. The old
    // upsert targeted a PARTIAL unique index (impossible in ON CONFLICT via
    // PostgREST → 42P10) and never read the error, so drafts silently never
    // existed. A 23505 here is the partial index catching a race (the draft
    // already exists — benign); anything else is a real failure we surface.
    const { error: insertError } = await admin.from("catalog_product_drafts").insert({
      pos_product_key: lot.pos_product_key,
      source_item_id: lot.pos_product_key,
      name: lot.product_name ?? "",
      brand_name: brandName,
      vendor_name: vendorName,
      category: lot.category,
      inventory_type: lot.inventory_type,
      strain_name: lot.strain_name,
      thc_pct: lab.thc_pct,
      cbd_pct: lab.cbd_pct,
      total_thc_pct: lab.total_thc_pct,
      total_cannabinoids_pct: lab.total_cannabinoids_pct,
      potency_json: lab.potency_json,
      manifest_id: manifestId,
      lot_id: lot.id,
      lab_result_id: lot.lab_result_id,
      unit_cost_minor_units: lot.unit_cost_minor_units,
      price_floor_minor_units: suggestion.floorMinor,
      suggested_price_minor_units: suggestion.suggestedMinor,
      price_rationale: suggestion.rationale,
      status: "draft",
      created_by: actorId,
      updated_by: actorId,
    });
    if (!insertError) {
      draftsCreated += 1;
    } else if (classifyInsertError(insertError.code) === "duplicate") {
      // Race backstop: another finalize seeded this key between our planning
      // read and this write. The draft exists — that's the desired end state.
      console.warn(
        `[catalog-drafts] draft for key ${lot.pos_product_key ?? "(none)"} already exists (race) — skipped`,
      );
    } else {
      draftsFailed += 1;
      if (!firstError) firstError = insertError.message;
      console.error(
        `[catalog-drafts] draft insert FAILED for lot ${lot.id} (key ${lot.pos_product_key ?? "(none)"}):`,
        insertError.message,
      );
    }
  }

  return {
    matched: plan.matched,
    unmatched: plan.unmatched,
    hasPublishedMenu,
    draftsCreated,
    draftsFailed,
    firstError,
  };
}

/** List drafts, optionally filtered by status. */
export async function listCatalogDrafts(status = "draft"): Promise<CatalogDraft[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("catalog_product_drafts")
    .select("*")
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(500);
  return (data as CatalogDraft[] | null) ?? [];
}

export async function countCatalogDrafts(): Promise<{ draft: number; approved: number; dismissed: number }> {
  const empty = { draft: 0, approved: 0, dismissed: 0 };
  if (!isSupabaseServiceConfigured) return empty;
  const admin = createSupabaseAdminClient();
  // SLICE 5C — this read existed ONLY to produce three numbers, yet it pulled
  // up to 5,000 `status` strings across the wire and tallied them in JS. Two
  // problems: `.limit(5000)` cannot exceed PostgREST's 1,000-row cap
  // (chunked-in.ts:13-14), so every count silently stopped at 1,000; and
  // transferring rows to count them is the wrong shape entirely.
  //
  // `count:"exact", head:true` is a SERVER-side COUNT with no row payload and
  // is therefore immune to `db.max_rows` (SLICE4_WORKPLAN.md:40-43; the house
  // pattern at vendors/store.ts:136). Three cheap counts replace a 5,000-row
  // transfer AND are correct at any table size.
  //
  // NEVER GUESS: a null count means "we could not find out", which is NOT the
  // same as zero. An unusable count leaves that bucket at its empty value
  // rather than asserting a confident 0.
  const [draftRes, approvedRes, dismissedRes] = await Promise.all([
    admin
      .from("catalog_product_drafts")
      .select("id", { count: "exact", head: true })
      .eq("status", "draft"),
    admin
      .from("catalog_product_drafts")
      .select("id", { count: "exact", head: true })
      .eq("status", "approved"),
    admin
      .from("catalog_product_drafts")
      .select("id", { count: "exact", head: true })
      .eq("status", "dismissed"),
  ]);
  const counts = { ...empty };
  if (usableCount(draftRes.count)) counts.draft = draftRes.count;
  if (usableCount(approvedRes.count)) counts.approved = approvedRes.count;
  if (usableCount(dismissedRes.count)) counts.dismissed = dismissedRes.count;
  return counts;
}

/** Mark a draft approved (validated by an employee) or dismissed. */
export async function setCatalogDraftStatus(
  draftId: string,
  status: "approved" | "dismissed" | "draft",
  actorId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase not configured." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("catalog_product_drafts")
    .update({ status, updated_by: actorId })
    .eq("id", draftId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * SLICE 93: batched strain-type suggestions for the Product Onboarding page.
 * One kb_strains read (by slug) + one inventory_lots read (by id) for ALL
 * drafts, folded per draft by the pure suggestStrainType (kb > lot > name).
 * Null entry = no signal ("Set strain type…" in the picker).
 */
export async function loadStrainTypeSuggestions(
  drafts: Pick<CatalogDraft, "id" | "name" | "strain_name" | "lot_id">[],
): Promise<Map<string, ReturnType<typeof suggestStrainType>>> {
  const out = new Map<string, ReturnType<typeof suggestStrainType>>();
  if (!isSupabaseServiceConfigured || drafts.length === 0) {
    for (const d of drafts) out.set(d.id, suggestStrainType({ productName: d.name }));
    return out;
  }
  const admin = createSupabaseAdminClient();

  const slugs = Array.from(
    new Set(
      drafts
        .map((d) => d.strain_name?.trim().toLowerCase().replace(/\s+/g, " ") ?? "")
        .filter(Boolean),
    ),
  );
  const kbTypeBySlug = new Map<string, string>();
  if (slugs.length > 0) {
    const { data } = await admin.from("kb_strains").select("slug, strain_type").in("slug", slugs);
    for (const s of (data as { slug: string; strain_type: string | null }[] | null) ?? []) {
      if (s.strain_type) kbTypeBySlug.set(s.slug, s.strain_type);
    }
  }

  const lotIds = Array.from(new Set(drafts.map((d) => d.lot_id).filter((v): v is string => Boolean(v))));
  const lotTypeById = new Map<string, string>();
  if (lotIds.length > 0) {
    const { data } = await admin.from("inventory_lots").select("id, strain_type").in("id", lotIds);
    for (const l of (data as { id: string; strain_type: string | null }[] | null) ?? []) {
      if (l.strain_type) lotTypeById.set(l.id, l.strain_type);
    }
  }

  for (const d of drafts) {
    const slug = d.strain_name?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
    out.set(
      d.id,
      suggestStrainType({
        kbStrainType: slug ? kbTypeBySlug.get(slug) ?? null : null,
        lotStrainType: d.lot_id ? lotTypeById.get(d.lot_id) ?? null : null,
        productName: d.name,
      }),
    );
  }
  return out;
}

/**
 * Approve a draft with a final price. Enforces the hard 2× cost floor — the
 * price can never be saved below it. This is the guard rail that guarantees
 * margin regardless of who's at the keyboard.
 */
export async function approveDraftWithPrice(
  draftId: string,
  priceMinor: number,
  actorId: string | null,
  classification?: {
    chosenWebsiteCategory?: string | null;
    chosenHouseType?: string | null;
    /** SLICE 93: the approver's strain-type pick (canonical taxonomy value). */
    chosenStrainType?: string | null;
    /**
     * SLICE 18-0: the approver's COMPLIANCE picks. Raw form strings, validated
     * server-side against the assessment - "yes" / "no" / absent, never
     * coerced. See receiving-classification-core.ts for why one of these is a
     * gate and the other only a prompt.
     */
    otherwiseTaken?: string | null;
    unitsPerPackage?: string | null;
    lowThcLiquid?: string | null;
    unitThcMg?: string | null;
  },
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase not configured." };
  const admin = createSupabaseAdminClient();

  const { data } = await admin
    .from("catalog_product_drafts")
    .select(
      "unit_cost_minor_units, manifest_id, pos_product_key, name, inventory_type, category, strain_name, lot_id",
    )
    .eq("id", draftId)
    .maybeSingle();
  const row = data as {
    unit_cost_minor_units: number | null;
    manifest_id: string | null;
    pos_product_key: string | null;
    name: string;
    inventory_type: string | null;
    category: string | null;
    strain_name: string | null;
    lot_id: string | null;
  } | null;
  const cost = row?.unit_cost_minor_units ?? null;

  const settings = await getPricingSettings();
  // T-319: validate the override against the SAME tax-inclusive, whole-dollar
  // floor the auto price used (category picks the tax divisor).
  const check = validatePrice(priceMinor, cost, settings, row?.category ?? null);
  if (!check.ok) {
    return { ok: false, error: check.error };
  }

  // SLICE 64 (owner bug B3): the classification GATE. Re-run the resolver +
  // labeler server-side (NEVER trust the form's idea of what was needed):
  // when the resolver has no website category, or the type labeler is below
  // 90% confidence, the approval must carry a human pick from OUR closed
  // taxonomy - otherwise the approved product would be silently refused at
  // injection time. Picks are validated against the closed vocabularies.
  const resolution = await resolveWebsiteCategoryForLot({
    posProductKey: row?.pos_product_key ?? null,
    productName: row?.name ?? null,
    inventoryType: row?.inventory_type ?? null,
    category: row?.category ?? null,
  });
  const assessment = assessDraftClassification({
    productName: row?.name ?? null,
    inventoryType: row?.inventory_type ?? null,
    resolvedWebsiteCategory: resolution.websiteCategory,
  });
  // SLICE 78: owner-created categories (DB registry) are legal picks too —
  // the closed set becomes hardcoded taxonomy ∪ active registry values.
  // SLICE 92: same for owner-created product types (inventory_types labels —
  // includes rows created inline during onboarding moments earlier).
  const [registryLabels, ownerTypes] = await Promise.all([
    loadCategoryLabelMap(),
    listInventoryTypes({ includeInactive: false }),
  ]);
  const choice = validateClassificationChoice({
    assessment,
    chosenWebsiteCategory: classification?.chosenWebsiteCategory ?? null,
    chosenHouseType: classification?.chosenHouseType ?? null,
    extraCategoryValues: Object.keys(registryLabels),
    extraTypeLabels: ownerTypes.map((t) => t.label),
  });
  if (!choice.ok) {
    return { ok: false, error: choice.error };
  }

  // SLICE 93: validate the approver's strain-type pick against the canonical
  // taxonomy (empty / "unknown" = no pick; junk is refused - the form is
  // never trusted). Strain type is never a GATE - it stays optional.
  const strainChoice = validateStrainTypeChoice(classification?.chosenStrainType);
  if (!strainChoice.ok) {
    return { ok: false, error: strainChoice.error };
  }

  // SLICE 18-0: the COMPLIANCE classification gate.
  //
  // Assessed against the category this product will ACTUALLY sit in, which is
  // the human's pick when they made one and the resolver's verdict otherwise.
  // Using the resolver's value alone would let somebody re-shelve a product
  // onto `topical` in the same submission that skips the suppository question.
  //
  // Re-derived server-side from the row we already loaded - the form's idea of
  // what was required is never trusted, exactly as with SLICE 64 above.
  const complianceAssessment = assessReceivingClassification({
    productName: row?.name ?? null,
    inventoryType: row?.inventory_type ?? null,
    resolvedWebsiteCategory: choice.chosenWebsiteCategory ?? resolution.websiteCategory,
  });
  const compliance = validateReceivingClassificationChoice({
    assessment: complianceAssessment,
    otherwiseTaken: classification?.otherwiseTaken ?? null,
    unitsPerPackage: classification?.unitsPerPackage ?? null,
    lowThcLiquid: classification?.lowThcLiquid ?? null,
    unitThcMg: classification?.unitThcMg ?? null,
  });
  if (!compliance.ok) {
    return { ok: false, error: compliance.error };
  }

  // Persist the picks ONLY when the human made one - on a pre-0141 database
  // an approval without picks keeps working exactly as before, and an
  // approval WITH picks fails with a friendly pointer at the migration.
  const update: Record<string, unknown> = {
    price_minor_units: priceMinor,
    status: "approved",
    updated_by: actorId,
  };
  if (choice.chosenWebsiteCategory !== null) update.chosen_website_category = choice.chosenWebsiteCategory;
  if (choice.chosenHouseType !== null) update.chosen_house_type = choice.chosenHouseType;
  // SLICE 93 (migration 0146): the strain-type pick, only when made.
  if (strainChoice.value !== null) update.chosen_strain_type = strainChoice.value;

  // SLICE 18-0 (migration 0218): the compliance classification.
  //
  // Unlike the picks above, otherwise_taken is written on EVERY approval, not
  // only when a human answered. That is the point: after this slice, an
  // approved product always carries a definite answer, so the ten-unit limit
  // can never fail to engage merely because nobody filled a box in. What
  // distinguishes the two cases is the provenance column, not the absence of
  // a value - "the machine assumed no" and "a person said no" are both
  // recorded, and 18A's worklist reads them apart.
  update.chosen_otherwise_taken = compliance.otherwiseTaken;
  update.chosen_classification_provenance = compliance.provenance;
  if (compliance.unitsPerPackage !== null) update.chosen_units_per_package = compliance.unitsPerPackage;
  // The low-THC pair stays absent when unanswered - here silence is safe (the
  // product simply keeps the tighter liquid limit) and inventing a `false`
  // would be a claim nobody made.
  if (compliance.lowThcLiquid !== null) update.chosen_low_thc_liquid = compliance.lowThcLiquid;
  if (compliance.unitThcMg !== null) update.chosen_unit_thc_mg = compliance.unitThcMg;

  const { error } = await admin
    .from("catalog_product_drafts")
    .update(update)
    .eq("id", draftId);
  if (error) {
    const missingColumn =
      error.code === "42703" ||
      /column .* does not exist|could not find .* column/i.test(error.message ?? "");
    // SLICE 18-0 (0218) is checked FIRST because it is the only one of the
    // three that is written on every approval - on a database missing 0218
    // every approval fails, so naming 0141 or 0146 would send the owner to
    // the wrong migration.
    if (missingColumn && update.chosen_otherwise_taken !== undefined) {
      return {
        ok: false,
        error:
          "Saving the compliance classification needs database migration 0218 " +
          "(supabase/migrations/0218_receiving_classification.sql). Run it, then approve again.",
      };
    }
    if (missingColumn && update.chosen_strain_type !== undefined) {
      return {
        ok: false,
        error:
          "Saving your strain-type pick needs database migration 0146 (supabase/migrations/0146_draft_strain_type_choice.sql). Run it, then approve again.",
      };
    }
    if (
      missingColumn &&
      (update.chosen_website_category !== undefined || update.chosen_house_type !== undefined)
    ) {
      return {
        ok: false,
        error:
          "Saving your category/type pick needs database migration 0141 (supabase/migrations/0141_draft_classification_choice.sql). Run it, then approve again.",
      };
    }
    return { ok: false, error: error.message };
  }

  // SLICE 93: "It should save to the kb as well so it auto attaches on that
  // product when we get new lots in." Fold the machine signals (curated KB >
  // manifest's stated fact > name parse) with the human's pick on top, then
  // gap-fill kb_strains under the pure policy: create a missing row, fill a
  // null/unknown type, and only a HUMAN pick may flip a curated value. The
  // machine never overrides curation. Best-effort - a KB hiccup never fails
  // the approval (the pick is already persisted on the draft).
  try {
    await saveStrainTypeToKb(admin, {
      strainName: row?.strain_name ?? null,
      lotId: row?.lot_id ?? null,
      productName: row?.name ?? null,
      humanPick: strainChoice.value,
      actorId,
    });
  } catch (err) {
    console.error("[catalog-drafts] strain-type KB save failed:", err);
  }

  // Intake auto-carry + auto-publish (owner-approved Option 1): the moment a
  // received product is APPROVED with a price, stage an intake-origin menu
  // version (current live menu carried forward + this newly approved product)
  // and publish it immediately — pressing "Approve" IS the go-live decision,
  // so the product reaches the customer menu + front POS with no further
  // clicks. On a publish hiccup the staged version lands on Menu Imports as
  // the manual fallback. Best-effort + dynamic import to avoid pulling
  // server-only menu code into every caller of this module; a staging/publish
  // hiccup must never fail the approval itself.
  if (row?.manifest_id) {
    try {
      const { stageIntakeMenuVersionForManifest } = await import("@/lib/pos/intake-menu-staging");
      await stageIntakeMenuVersionForManifest(row.manifest_id, actorId);
    } catch (err) {
      console.error("[catalog-drafts] intake auto-carry after approve failed:", err);
    }
  }

  return { ok: true };
}

/**
 * SLICE 93: persist an approval's strain-type verdict into kb_strains so it
 * auto-attaches on FUTURE lots of the same strain (injection + staging read
 * kb_strains by slug). Pure policy in decideKbStrainTypeWrite: create the
 * missing row, gap-fill a null/unknown type, flip ONLY on a human pick -
 * the machine never overrides curation. Every write is audited.
 */
async function saveStrainTypeToKb(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  input: {
    strainName: string | null;
    lotId: string | null;
    productName: string | null;
    /** The approver's validated pick (canonical), or null when none was made. */
    humanPick: string | null;
    actorId: string | null;
  },
): Promise<void> {
  const name = input.strainName?.trim();
  if (!name) return; // no strain on the draft - nothing to attach the type to.
  const slug = name.toLowerCase().replace(/\s+/g, " ");

  // Existing curated row (the same slug convention injection/staging read by).
  const { data: strainData } = await admin
    .from("kb_strains")
    .select("id, strain_type")
    .eq("slug", slug)
    .maybeSingle();
  const existing = strainData as { id: string; strain_type: string | null } | null;

  // The manifest's stated fact ([H]/[I]/[S] intake split on inventory_lots).
  let lotStrainType: string | null = null;
  if (input.lotId) {
    const { data: lotData } = await admin
      .from("inventory_lots")
      .select("strain_type")
      .eq("id", input.lotId)
      .maybeSingle();
    lotStrainType = (lotData as { strain_type: string | null } | null)?.strain_type ?? null;
  }

  // The verdict: the human's pick, else the >=90% machine suggestion. A
  // below-bar hint is never written - never guess.
  let verdict = input.humanPick;
  let source: "human" | "auto" = "human";
  if (!verdict) {
    const suggestion = suggestStrainType({
      kbStrainType: existing?.strain_type ?? null,
      lotStrainType,
      productName: input.productName,
    });
    if (
      !suggestion ||
      suggestion.confidence < STRAIN_TYPE_AUTO_MIN_CONFIDENCE ||
      suggestion.source === "strain library" // already in the KB - nothing to save.
    ) {
      return;
    }
    verdict = suggestion.value;
    source = "auto";
  }

  const decision = decideKbStrainTypeWrite({
    exists: Boolean(existing?.id),
    existingType: existing?.strain_type ?? null,
    verdict: verdict as Parameters<typeof decideKbStrainTypeWrite>[0]["verdict"],
    source,
  });
  if (decision.action === "skip") return;

  if (decision.action === "create") {
    const { error } = await admin.from("kb_strains").insert({
      slug,
      name,
      strain_type: verdict,
      active: true,
      created_by: input.actorId,
      updated_by: input.actorId,
    });
    if (error) throw new Error(error.message);
  } else {
    // set (gap-fill) or flip (human override of a curated value).
    const { error } = await admin
      .from("kb_strains")
      .update({ strain_type: verdict, updated_by: input.actorId })
      .eq("id", existing!.id);
    if (error) throw new Error(error.message);
  }

  await recordAudit({
    actorId: input.actorId,
    action: "kb.strain.type_from_onboarding",
    entityType: "kb_strain",
    entityId: slug,
    before: { strain_type: existing?.strain_type ?? null },
    after: { strain_type: verdict, decision: decision.action, source, reason: decision.reason },
  }).catch(() => {});
}
