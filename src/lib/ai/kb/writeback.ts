/**
 * src/lib/ai/kb/writeback.ts
 *
 * KB WRITE-BACK service (Request D). When a product enrichment is PUBLISHED, or
 * an AI suggestion is ACCEPTED, the validated facts are promoted into the
 * Knowledge Base so it becomes the "backbone / brain" the owner asked for.
 *
 * Guarantees (standing rules):
 *   • DRAFTS-ONLY — promoted product rows land as status='draft', active=false.
 *     A human still validates them into published/active. Strain-level gap-fill
 *     only ADDS missing sensory notes to an existing strain; it never flips an
 *     existing curated row inactive or overwrites its curated fields.
 *   • NON-DESTRUCTIVE — we merge, never clobber. Existing kb_products rows are
 *     gap-filled (empty → value); populated fields are left as-is. Existing
 *     curated kb_strains rows are only UNION-merged for note arrays.
 *   • COMPLIANCE-GATED — effects pass checkEffects(); prose passes
 *     checkCompliance(); the owner's kb_banned_phrases blocklist is layered on.
 *   • IDEMPOTENT — keyed on the natural identity (brand+product+variant); re-
 *     running produces the same row. Upsert on the unique index.
 *   • DEFENSIVE — if migration 0071 isn't applied yet (kb_products missing, or
 *     kb_strains.effects missing), the write is skipped/retried gracefully so
 *     the user action never breaks. Migrations are owner-applied.
 *
 * Nothing here touches POS truth (price/stock). It only enriches the KB.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { checkCompliance, checkEffects } from "@/lib/ai/compliance";
import { loadBannedPhrases } from "@/lib/ai/kb/retrieval";
import {
  decideDescriptionOutcome,
  type DescriptionSaveOutcome,
} from "@/lib/purchasing/save-assets-core";

/** Dashed slug (brands/products): lowercase, non-alnum → dash. */
function slugifyDashed(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Strain slug matches the generator convention: lowercase, single-spaced. */
function strainSlug(value: string): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Union two string arrays (case-insensitive), preserving first-seen casing. */
function unionNotes(existing: string[] | null | undefined, incoming: string[] | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of [...(existing ?? []), ...(incoming ?? [])]) {
    const key = String(v ?? "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(String(v).trim());
  }
  return out;
}

export type WritebackFacts = {
  posProductKey: string;
  productName: string;
  brandName?: string | null;
  category?: string | null;
  aroma_notes?: string[];
  flavor_notes?: string[];
  terpenes?: string[];
  effects?: string[];
  description?: string | null;
  short_description?: string | null;
  imageMediaIds?: string[];
  primaryMediaId?: string | null;
  brandId?: string | null;
  vendorId?: string | null;
  strainName?: string | null;
  variantLabel?: string | null;
  confidence?: number | null;
  source?: string; // 'enrichment' | 'suggestion' | 'manual'
};

export type WritebackResult = {
  ok: boolean;
  wroteProduct: boolean;
  wroteStrain: boolean;
  rejectedEffects: { effect: string; reason: string }[];
  skippedReason?: string;
  /**
   * SLICE 90 — what happened to the DESCRIPTION specifically, so save buttons
   * can report it honestly (it used to be a silent side effect):
   *   "saved" (landed in an empty slot) | "kept_existing" (gap-fill kept the
   *   curated prose) | "none_provided" | "blocked_noncompliant" (compliance
   *   gate stripped it) | "kb_unavailable" (kb_products write didn't happen).
   */
  descriptionOutcome: DescriptionSaveOutcome;
};

/** Check a table exists / a column exists by attempting a HEAD select. */
async function tableUsable(table: string, column = "id"): Promise<boolean> {
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from(table).select(column, { head: true, count: "exact" }).limit(1);
    return !error;
  } catch {
    return false;
  }
}

/**
 * GAP 5 (potency inflow) — measured potency for a product, resolved from the
 * COA-backed lab_results linked through its inventory lot.
 *
 * VERIFIED LINK CHAIN (grounded, not guessed):
 *   inventory_lots.pos_product_key  →  inventory_lots.lab_result_id  →
 *   lab_results(total_thc_pct, total_cbd_pct, potency_json)
 * This is the same lab_result_id → lab_results potency lookup already used by
 * src/lib/inventory/catalog-drafts.ts. We take the most recently intaked lot
 * that actually has a lab_result_id so we ground on the freshest COA.
 *
 * Returns null when there is no linked COA — the caller then leaves the
 * kb_products potency columns untouched (never fabricate a number).
 */
type MeasuredPotency = {
  total_thc_pct: number | null;
  total_cbd_pct: number | null;
  potency_json: Record<string, number> | null;
  labResultId: string;
};

async function loadMeasuredPotency(posProductKey: string): Promise<MeasuredPotency | null> {
  try {
    const admin = createSupabaseAdminClient();
    // Newest lot with a linked COA for this POS key. created_at exists on
    // inventory_lots (0023); if the ordering column is unknown the query still
    // returns rows and we just take the first with a lab_result_id.
    const { data: lots, error: lotErr } = await admin
      .from("inventory_lots")
      .select("lab_result_id, created_at")
      .eq("pos_product_key", posProductKey)
      .not("lab_result_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1);
    if (lotErr || !lots || lots.length === 0) return null;
    const labResultId = (lots[0] as { lab_result_id: string | null }).lab_result_id;
    if (!labResultId) return null;

    const { data: lab, error: labErr } = await admin
      .from("lab_results")
      .select("total_thc_pct, total_cbd_pct, potency_json")
      .eq("id", labResultId)
      .maybeSingle();
    if (labErr || !lab) return null;
    const d = lab as {
      total_thc_pct: number | null;
      total_cbd_pct: number | null;
      potency_json: Record<string, number> | null;
    };
    // Only meaningful if the COA carries at least one measured value.
    if (d.total_thc_pct == null && d.total_cbd_pct == null && !d.potency_json) return null;
    return {
      total_thc_pct: d.total_thc_pct,
      total_cbd_pct: d.total_cbd_pct,
      potency_json: d.potency_json,
      labResultId,
    };
  } catch {
    return null;
  }
}

/**
 * 7c.1 \u2014 Resolve the kb_brands golden-record id for a brand slug (best-effort).
 * kb_products.kb_brand_id \u2192 kb_brands.id. Returns null when the KB brand table
 * isn't available or no match exists. Never throws.
 */
async function resolveKbBrandId(brandSlug: string): Promise<string | null> {
  if (!brandSlug || brandSlug === "unknown-brand") return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_brands")
      .select("id")
      .eq("slug", brandSlug)
      .maybeSingle();
    if (error || !data) return null;
    return (data.id as string) ?? null;
  } catch {
    return null;
  }
}

/**
 * 7c.2 \u2014 Resolve the kb_product_categories id for a POS/website category value
 * (best-effort). kb_products.product_category_id \u2192 kb_product_categories.id.
 * Matches on slug first (slugified category), then on a case-insensitive name.
 * Returns null when the table isn't available or no match exists. Never throws.
 */
async function resolveProductCategoryId(category: string | null | undefined): Promise<string | null> {
  const value = String(category ?? "").trim();
  if (!value) return null;
  try {
    const admin = createSupabaseAdminClient();
    const slug = slugifyDashed(value);
    if (slug) {
      const { data: bySlug } = await admin
        .from("kb_product_categories")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (bySlug?.id) return bySlug.id as string;
    }
    const { data: byName } = await admin
      .from("kb_product_categories")
      .select("id")
      .ilike("name", value)
      .maybeSingle();
    return (byName?.id as string) ?? null;
  } catch {
    return null;
  }
}

/**
 * Promote a set of VALIDATED product facts into the KB as a drafts-only,
 * per-SKU kb_products row (+ non-destructive strain-level sensory gap-fill).
 * Compliance-gated and idempotent. Returns a small result for auditing.
 */
export async function writeBackProductFacts(
  facts: WritebackFacts,
  actorId: string | null,
): Promise<WritebackResult> {
  // SLICE 90 — description visibility: remember whether a description was
  // offered and whether the compliance gate stripped it, so the result can say
  // exactly what happened to the prose (it used to be a silent side effect).
  const descriptionProvided = !!(facts.description ?? "").trim();
  let descriptionBlocked = false;
  const result: WritebackResult = {
    ok: false,
    wroteProduct: false,
    wroteStrain: false,
    rejectedEffects: [],
    descriptionOutcome: descriptionProvided ? "kb_unavailable" : "none_provided",
  };
  if (!isSupabaseServiceConfigured) {
    result.skippedReason = "Supabase not configured.";
    return result;
  }

  const admin = createSupabaseAdminClient();
  const banned = await loadBannedPhrases();

  // --- Compliance gate on prose + effects ------------------------------------
  const proseParts = [facts.description ?? "", facts.short_description ?? ""].join(" ").trim();
  if (proseParts) {
    const prose = checkCompliance(proseParts, banned);
    if (!prose.ok) {
      // Don't promote non-compliant copy — strip it, keep structured facts.
      facts = { ...facts, description: null, short_description: null };
      descriptionBlocked = descriptionProvided;
    }
  }
  const effectCheck = checkEffects(facts.effects ?? [], banned);
  result.rejectedEffects = effectCheck.rejected;
  const safeEffects = effectCheck.allowed;

  // --- 1) Strain-level gap-fill (non-destructive) ---------------------------
  // Only union sensory arrays / effects onto an EXISTING strain row. We never
  // create or flip a strain here — strains are curated. This just enriches.
  let kbStrainId: string | null = null;
  const strainName = facts.strainName?.trim();
  if (strainName) {
    const slug = strainSlug(strainName);
    const { data: strain } = await admin
      .from("kb_strains")
      .select("id, aroma_notes, flavor_notes, terpenes")
      .eq("slug", slug)
      .maybeSingle();
    if (strain?.id) {
      kbStrainId = strain.id as string;
      const patch: Record<string, unknown> = {
        aroma_notes: unionNotes(strain.aroma_notes as string[], facts.aroma_notes),
        flavor_notes: unionNotes(strain.flavor_notes as string[], facts.flavor_notes),
        terpenes: unionNotes(strain.terpenes as string[], facts.terpenes),
        updated_by: actorId,
      };
      // Only attempt effects union if the column exists (0071 applied).
      const hasEffects = await tableUsable("kb_strains", "effects");
      if (hasEffects && safeEffects.length) {
        const { data: withEff } = await admin
          .from("kb_strains")
          .select("effects")
          .eq("id", kbStrainId)
          .maybeSingle();
        patch.effects = unionNotes((withEff?.effects as string[]) ?? [], safeEffects);
      }
      // GAP 6: tag this machine touch with provenance so it is auditable, at
      // parity with kb_products/kb_brands (migration 0085). NON-DESTRUCTIVE:
      //   • source — only stamp 'enrichment' when the existing scalar is empty
      //     (never overwrite a curated 'manual'/'seed' provenance).
      //   • sources[] — UNION corroborating refs (never drop existing ones).
      //   • status — NEVER touched here: we only enrich an existing curated
      //     (published) row; we never create or demote a strain row.
      // Each column is added only when 0085 is applied (unknown column would
      // fail the whole update), so this degrades safely pre-migration.
      const hasStrainSource = await tableUsable("kb_strains", "source");
      if (hasStrainSource) {
        const { data: prov } = await admin
          .from("kb_strains")
          .select("source, sources")
          .eq("id", kbStrainId)
          .maybeSingle();
        if (!((prov?.source as string | null) ?? "").trim()) {
          patch.source = facts.source ?? "enrichment";
        }
        const incomingSource = facts.source ? [`writeback:${facts.source}`] : ["writeback:enrichment"];
        patch.sources = unionNotes((prov?.sources as string[]) ?? [], incomingSource);
      }
      const { error } = await admin.from("kb_strains").update(patch).eq("id", kbStrainId);
      if (!error) result.wroteStrain = true;
    }
  }

  // --- 2) Per-SKU kb_products (drafts-only, idempotent) ---------------------
  const kbProductsReady = await tableUsable("kb_products");
  if (!kbProductsReady) {
    // Migration 0071 not applied yet. Strain gap-fill may still have run.
    result.ok = result.wroteStrain;
    result.skippedReason = "kb_products not available (apply migration 0071).";
    result.descriptionOutcome = decideDescriptionOutcome({
      provided: descriptionProvided,
      blocked: descriptionBlocked,
      existingHadDescription: false,
      wroteProduct: false,
    });
    return result;
  }

  const brandSlug = facts.brandName ? slugifyDashed(facts.brandName) : "unknown-brand";
  const productSlug = slugifyDashed(facts.productName) || "product";
  const variantLabel = (facts.variantLabel ?? "").trim();

  // Read any existing row so we can gap-fill (empty → value), never clobber.
  const { data: existing } = await admin
    .from("kb_products")
    .select("*")
    .eq("brand_slug", brandSlug)
    .eq("product_slug", productSlug)
    .eq("variant_label", variantLabel)
    .maybeSingle();

  const emptyStr = (v: string | null | undefined) => !v || !v.trim();
  const gapStr = (cur: string | null | undefined, next: string | null | undefined): string | null =>
    emptyStr(cur) ? next ?? null : cur ?? null;

  const fallbackName = [facts.brandName, facts.productName, variantLabel].filter(Boolean).join(" — ");

  // 7c: close the two write-side FK gaps (G8) so the per-SKU record joins the
  // full backbone. Both are best-effort + non-destructive (existing wins) and
  // ONLY included in the upsert when their column is present (defensive against
  // a pre-0071 schema \u2014 including an unknown column would fail the whole write).
  const kbBrandIdCol = await tableUsable("kb_products", "kb_brand_id");
  const productCategoryIdCol = await tableUsable("kb_products", "product_category_id");
  const kbBrandId = kbBrandIdCol
    ? (existing?.kb_brand_id as string | null) ?? (await resolveKbBrandId(brandSlug))
    : null;
  const productCategoryId = productCategoryIdCol
    ? (existing?.product_category_id as string | null) ?? (await resolveProductCategoryId(facts.category))
    : null;

  // --- GAP 5: potency inflow (drafts-only, non-destructive) -----------------
  // Gap-fill kb_products measured potency from the linked COA (lab_results),
  // ONLY when migration 0084 columns exist AND the existing curated row has no
  // potency yet. Populated potency is never clobbered. If a column is absent we
  // omit it entirely (an unknown column would fail the whole upsert).
  const potencyJsonCol = await tableUsable("kb_products", "potency_json");
  const totalThcCol = await tableUsable("kb_products", "total_thc_pct");
  const totalCbdCol = await tableUsable("kb_products", "total_cbd_pct");
  const potencySourceCol = await tableUsable("kb_products", "potency_source");
  const potencyConfidenceCol = await tableUsable("kb_products", "potency_confidence");
  const potencyColsPresent =
    potencyJsonCol || totalThcCol || totalCbdCol || potencySourceCol || potencyConfidenceCol;

  // Only bother resolving a COA when at least one 0084 column exists and the
  // existing row hasn't already been given potency (empty → value).
  const existingHasPotency =
    (existing?.potency_json as unknown) != null ||
    (existing?.total_thc_pct as number | null) != null ||
    (existing?.total_cbd_pct as number | null) != null;
  const measured =
    potencyColsPresent && !existingHasPotency
      ? await loadMeasuredPotency(facts.posProductKey)
      : null;

  const potencyPatch: Record<string, unknown> = {};
  if (potencyColsPresent) {
    if (measured) {
      if (potencyJsonCol)
        potencyPatch.potency_json =
          (existing?.potency_json as Record<string, number> | null) ?? measured.potency_json;
      if (totalThcCol)
        potencyPatch.total_thc_pct =
          (existing?.total_thc_pct as number | null) ?? measured.total_thc_pct;
      if (totalCbdCol)
        potencyPatch.total_cbd_pct =
          (existing?.total_cbd_pct as number | null) ?? measured.total_cbd_pct;
      if (potencySourceCol)
        potencyPatch.potency_source =
          (existing?.potency_source as string | null) ?? `lab_results:${measured.labResultId}`;
      if (potencyConfidenceCol)
        // COA-backed measured value — high confidence, but preserve any existing.
        potencyPatch.potency_confidence =
          (existing?.potency_confidence as number | null) ?? 0.99;
    } else {
      // No new COA: carry forward whatever the existing row already has so an
      // upsert never nulls a previously populated potency column.
      if (potencyJsonCol)
        potencyPatch.potency_json = (existing?.potency_json as Record<string, number> | null) ?? null;
      if (totalThcCol) potencyPatch.total_thc_pct = (existing?.total_thc_pct as number | null) ?? null;
      if (totalCbdCol) potencyPatch.total_cbd_pct = (existing?.total_cbd_pct as number | null) ?? null;
      if (potencySourceCol)
        potencyPatch.potency_source = (existing?.potency_source as string | null) ?? null;
      if (potencyConfidenceCol)
        potencyPatch.potency_confidence = (existing?.potency_confidence as number | null) ?? null;
    }
  }

  const row = {
    brand_slug: brandSlug,
    product_slug: productSlug,
    variant_label: variantLabel,
    display_name: gapStr(existing?.display_name as string | null, null) ?? (fallbackName || facts.productName),
    pos_product_key: (existing?.pos_product_key as string | null) ?? facts.posProductKey,
    category: gapStr((existing?.category as string | null) ?? null, facts.category ?? null),
    aroma_notes: unionNotes(existing?.aroma_notes as string[], facts.aroma_notes),
    flavor_notes: unionNotes(existing?.flavor_notes as string[], facts.flavor_notes),
    terpenes: unionNotes(existing?.terpenes as string[], facts.terpenes),
    effects: unionNotes(existing?.effects as string[], safeEffects),
    description: gapStr((existing?.description as string | null) ?? null, facts.description ?? null),
    short_description: gapStr(
      (existing?.short_description as string | null) ?? null,
      facts.short_description ?? null,
    ),
    image_media_ids: unionNotes(existing?.image_media_ids as string[], facts.imageMediaIds),
    primary_media_id:
      gapStr((existing?.primary_media_id as string | null) ?? null, facts.primaryMediaId ?? null),
    kb_strain_id: (existing?.kb_strain_id as string | null) ?? kbStrainId,
    ...(kbBrandIdCol ? { kb_brand_id: kbBrandId } : {}),
    ...(productCategoryIdCol ? { product_category_id: productCategoryId } : {}),
    brand_id: (existing?.brand_id as string | null) ?? facts.brandId ?? null,
    vendor_id: (existing?.vendor_id as string | null) ?? facts.vendorId ?? null,
    source: (existing?.source as string | null) ?? facts.source ?? "enrichment",
    confidence:
      facts.confidence === null || facts.confidence === undefined
        ? (existing?.confidence as number | null) ?? null
        : Math.max(0, Math.min(1, facts.confidence)),
    // GAP 5: COA-backed measured potency (gap-fill only; omitted pre-0084).
    ...potencyPatch,
    // DRAFTS-ONLY: never auto-publish. Preserve an already-published row's state.
    status: (existing?.status as string) ?? "draft",
    active: (existing?.active as boolean) ?? false,
    updated_by: actorId,
    ...(existing ? {} : { created_by: actorId }),
  };

  const { error } = await admin
    .from("kb_products")
    .upsert(row, { onConflict: "brand_slug,product_slug,variant_label" });
  if (!error) result.wroteProduct = true;

  result.ok = result.wroteProduct || result.wroteStrain;
  // SLICE 90 — say what happened to the description: saved into an empty slot,
  // kept because the KB row already had curated prose (gap-fill), blocked by
  // the compliance gate, nothing offered, or the write never landed.
  result.descriptionOutcome = decideDescriptionOutcome({
    provided: descriptionProvided,
    blocked: descriptionBlocked,
    existingHadDescription: !emptyStr((existing?.description as string | null) ?? null),
    wroteProduct: result.wroteProduct,
  });
  return result;
}

/**
 * Gather the VALIDATED facts for a product from its enrichment row + any
 * ACCEPTED sensory/effects suggestions, then promote them into the KB. Called
 * when an enrichment is PUBLISHED or a suggestion is accepted. Best-effort:
 * never throws (a write-back failure must not break the calling action).
 */
export async function writeBackOnPublish(
  posProductKey: string,
  actorId: string | null,
): Promise<WritebackResult | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data: enr } = await admin
      .from("product_enrichments")
      .select("*")
      .eq("pos_product_key", posProductKey)
      .maybeSingle();
    if (!enr) return null;

    // Pull accepted sensory + effects suggestions (validated structured facts).
    const { data: accepted } = await admin
      .from("ai_suggestions")
      .select("field_key, suggested_value, confidence, status")
      .eq("entity_type", "product")
      .eq("entity_id", posProductKey)
      .eq("status", "accepted");

    let aroma: string[] = [];
    let flavor: string[] = [];
    let terps: string[] = [];
    let effects: string[] = [];
    let confidence: number | null = null;
    for (const s of accepted ?? []) {
      if (s.field_key === "sensory" && s.suggested_value) {
        try {
          const parsed = JSON.parse(s.suggested_value as string) as {
            aroma_notes?: string[];
            flavor_notes?: string[];
            terpenes?: string[];
          };
          aroma = parsed.aroma_notes ?? [];
          flavor = parsed.flavor_notes ?? [];
          terps = parsed.terpenes ?? [];
        } catch {
          /* ignore malformed JSON */
        }
      }
      if (s.field_key === "effects" && s.suggested_value) {
        effects = String(s.suggested_value)
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean);
      }
      if (typeof s.confidence === "number") confidence = s.confidence as number;
    }

    return await writeBackProductFacts(
      {
        posProductKey,
        productName: (enr.display_name as string) || (enr.last_seen_name as string) || posProductKey,
        brandName: (enr.last_seen_brand as string) ?? null,
        category: (enr.last_seen_category as string) ?? null,
        aroma_notes: aroma,
        flavor_notes: flavor,
        terpenes: terps,
        effects,
        description: (enr.description as string) ?? null,
        short_description: (enr.short_description as string) ?? null,
        imageMediaIds: (enr.image_media_ids as string[]) ?? [],
        primaryMediaId: (enr.primary_media_id as string) ?? null,
        brandId: (enr.brand_id as string) ?? null,
        vendorId: (enr.vendor_id as string) ?? null,
        strainName: null,
        confidence,
        source: "enrichment",
      },
      actorId,
    );
  } catch {
    return null;
  }
}
