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
import { resolveWebsiteCategoryForLot } from "@/lib/inventory/website-category-resolver-server";
import { loadCategoryLabelMap } from "@/lib/pos/category-registry";
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
    const suggestion = suggestPrice(lot.unit_cost_minor_units, velocity, pricingSettings);

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
  const { data } = await admin.from("catalog_product_drafts").select("status").limit(5000);
  const rows = (data as { status: string }[] | null) ?? [];
  const counts = { ...empty };
  for (const r of rows) {
    if (r.status === "draft") counts.draft += 1;
    else if (r.status === "approved") counts.approved += 1;
    else if (r.status === "dismissed") counts.dismissed += 1;
  }
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
  },
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase not configured." };
  const admin = createSupabaseAdminClient();

  const { data } = await admin
    .from("catalog_product_drafts")
    .select("unit_cost_minor_units, manifest_id, pos_product_key, name, inventory_type, category")
    .eq("id", draftId)
    .maybeSingle();
  const row = data as {
    unit_cost_minor_units: number | null;
    manifest_id: string | null;
    pos_product_key: string | null;
    name: string;
    inventory_type: string | null;
    category: string | null;
  } | null;
  const cost = row?.unit_cost_minor_units ?? null;

  const settings = await getPricingSettings();
  const check = validatePrice(priceMinor, cost, settings);
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
  const registryLabels = await loadCategoryLabelMap();
  const choice = validateClassificationChoice({
    assessment,
    chosenWebsiteCategory: classification?.chosenWebsiteCategory ?? null,
    chosenHouseType: classification?.chosenHouseType ?? null,
    extraCategoryValues: Object.keys(registryLabels),
  });
  if (!choice.ok) {
    return { ok: false, error: choice.error };
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

  const { error } = await admin
    .from("catalog_product_drafts")
    .update(update)
    .eq("id", draftId);
  if (error) {
    if (
      (error.code === "42703" ||
        /column .* does not exist|could not find .* column/i.test(error.message ?? "")) &&
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
