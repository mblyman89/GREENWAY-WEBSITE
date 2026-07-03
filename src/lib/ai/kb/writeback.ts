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
 * Promote a set of VALIDATED product facts into the KB as a drafts-only,
 * per-SKU kb_products row (+ non-destructive strain-level sensory gap-fill).
 * Compliance-gated and idempotent. Returns a small result for auditing.
 */
export async function writeBackProductFacts(
  facts: WritebackFacts,
  actorId: string | null,
): Promise<WritebackResult> {
  const result: WritebackResult = {
    ok: false,
    wroteProduct: false,
    wroteStrain: false,
    rejectedEffects: [],
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
    brand_id: (existing?.brand_id as string | null) ?? facts.brandId ?? null,
    vendor_id: (existing?.vendor_id as string | null) ?? facts.vendorId ?? null,
    source: (existing?.source as string | null) ?? facts.source ?? "enrichment",
    confidence:
      facts.confidence === null || facts.confidence === undefined
        ? (existing?.confidence as number | null) ?? null
        : Math.max(0, Math.min(1, facts.confidence)),
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
