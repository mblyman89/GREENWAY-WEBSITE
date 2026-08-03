/**
 * src/lib/ai/kb/store.ts
 *
 * CRUD + seed helpers for the cannabis knowledge base (kb_* tables). Used by the
 * admin "Knowledge base" page so the owner can view counts, seed the starter
 * data, and add/edit/remove rows without touching code.
 *
 * All reads are best-effort and degrade gracefully when the tables aren't
 * migrated yet (return empty / zero) so the page never hard-crashes pre-migration.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  SEED_TERPENES,
  SEED_CANNABINOIDS,
  SEED_EFFECTS,
  SEED_PRODUCT_FORMATS,
  SEED_COMPLIANCE_RULES,
  SEED_STORE_FACTS,
  SEED_FAQS,
  SEED_CATEGORIES,
  SEED_BANNED_PHRASES,
} from "./seed";
import { STRAINS_RICH } from "./strains-data";
import { PRODUCT_CATEGORIES } from "./product-categories-data";
import { attachImageToGallery } from "./product-images-core";

export type KbCounts = {
  strains: number;
  terpenes: number;
  /** Cannabinoid compounds (migration 0083). */
  cannabinoids: number;
  /** Experiential-effect vocabulary (migration 0086). */
  effects: number;
  /** Product-format / consumption-method vocabulary (migration 0087). */
  productFormats: number;
  /** Compliance/safety reference rules (migration 0088). */
  complianceRules: number;
  /** Store/brand fact cards — hours, address, payment, etc. (migration 0090). */
  storeFacts: number;
  /** Curated FAQ pack (migration 0090). */
  faqs: number;
  categories: number;
  brands: number;
  banned: number;
  /** Owner-uploaded free-form reference notes (item 14). */
  notes: number;
  /** Active non-cannabis products connected to the KB (migration 0076). */
  nonCannabis: number;
  /** True if the kb_* tables exist (migration applied). */
  migrated: boolean;
  /** True if kb_notes exists (migration 0056 applied). */
  notesMigrated: boolean;
};

async function tableCount(table: string): Promise<number | null> {
  const admin = createSupabaseAdminClient();
  const { count, error } = await admin.from(table).select("id", { count: "exact", head: true });
  if (error) return null;
  return count ?? 0;
}

/** Read counts across all KB tables. Returns migrated=false if tables missing. */
export async function getKbCounts(): Promise<KbCounts> {
  const empty: KbCounts = {
    strains: 0,
    terpenes: 0,
    cannabinoids: 0,
    effects: 0,
    productFormats: 0,
    complianceRules: 0,
    storeFacts: 0,
    faqs: 0,
    categories: 0,
    brands: 0,
    banned: 0,
    notes: 0,
    nonCannabis: 0,
    migrated: false,
    notesMigrated: false,
  };
  if (!isSupabaseServiceConfigured) return empty;
  const [strains, terpenes, cannabinoids, effects, productFormats, complianceRules, storeFacts, faqs, categories, brands, banned, notes, nonCannabis] =
    await Promise.all([
      tableCount("kb_strains"),
      tableCount("kb_terpenes"),
      tableCount("kb_cannabinoids"),
      tableCount("kb_effects"),
      tableCount("kb_product_formats"),
      tableCount("kb_compliance_rules"),
      tableCount("kb_store_facts"),
      tableCount("kb_faqs"),
      tableCount("kb_category_terms"),
      tableCount("kb_brands"),
      tableCount("kb_banned_phrases"),
      tableCount("kb_notes"),
      tableCount("noncannabis_products"),
    ]);
  const migrated = strains !== null; // kb_strains query succeeded
  return {
    strains: strains ?? 0,
    terpenes: terpenes ?? 0,
    cannabinoids: cannabinoids ?? 0,
    effects: effects ?? 0,
    productFormats: productFormats ?? 0,
    complianceRules: complianceRules ?? 0,
    storeFacts: storeFacts ?? 0,
    faqs: faqs ?? 0,
    categories: categories ?? 0,
    brands: brands ?? 0,
    banned: banned ?? 0,
    notes: notes ?? 0,
    nonCannabis: nonCannabis ?? 0,
    migrated,
    notesMigrated: notes !== null,
  };
}

/**
 * List active non-cannabis products connected to the KB (migration 0076). This
 * keeps the KB "connected" to the non-cannabis catalog the owner asked for.
 */
export type KbNonCannabisRow = {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  type: string;
  price_minor_units: number;
  qty_on_hand: number;
  kb_category_slug: string | null;
};

export async function listKbNonCannabis(limit = 1000): Promise<KbNonCannabisRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("noncannabis_products")
    .select("id, sku, name, brand, type, price_minor_units, qty_on_hand, kb_category_slug")
    .eq("status", "active")
    .order("type", { ascending: true })
    .order("name", { ascending: true })
    .limit(limit);
  if (error) return [];
  return (data as KbNonCannabisRow[] | null) ?? [];
}

export type SeedReport = {
  ok: boolean;
  message: string;
  inserted: { strains: number; terpenes: number; cannabinoids: number; effects: number; productFormats: number; complianceRules: number; storeFacts: number; faqs: number; categories: number; banned: number; productCategories: number };
};

/**
 * Idempotently upsert the starter KB data. Uses upsert on the natural unique
 * keys so re-running it refreshes the starter rows without duplicating, and
 * leaves owner-added rows untouched. Safe to run multiple times.
 */
export async function seedKnowledgeBase(actorId: string | null): Promise<SeedReport> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, message: "The database isn't connected yet.", inserted: { strains: 0, terpenes: 0, cannabinoids: 0, effects: 0, productFormats: 0, complianceRules: 0, storeFacts: 0, faqs: 0, categories: 0, banned: 0, productCategories: 0 } };
  }
  const admin = createSupabaseAdminClient();

  const strainRows = STRAINS_RICH.map((s) => ({
    slug: s.slug,
    name: s.name,
    aliases: s.aliases ?? [],
    strain_type: s.strain_type,
    lineage: s.lineage ?? null,
    aroma_notes: s.aroma_notes,
    flavor_notes: s.flavor_notes,
    terpenes: s.terpenes,
    summary: s.summary,
    dominant_cannabinoid: s.dominant_cannabinoid ?? null,
    potency_note: s.potency_note ?? null,
    bud_structure: s.bud_structure ?? null,
    origin: s.origin ?? null,
    sources: s.sources ?? [],
    confidence: s.confidence ?? null,
    active: true,
    created_by: actorId,
    updated_by: actorId,
  }));
  const terpeneRows = SEED_TERPENES.map((t) => ({
    slug: t.slug,
    name: t.name,
    aroma_notes: t.aroma_notes,
    flavor_notes: t.flavor_notes,
    also_found_in: t.also_found_in ?? null,
    // Slice 5: aroma-family cross-map. Column added in migration 0089 (default '{}').
    aroma_families: t.aroma_families ?? [],
    active: true,
    created_by: actorId,
    updated_by: actorId,
  }));
  const cannabinoidRows = SEED_CANNABINOIDS.map((c) => ({
    slug: c.slug,
    name: c.name,
    full_name: c.full_name ?? null,
    intoxication: c.intoxication,
    is_acidic: c.is_acidic,
    decarbs_to: c.decarbs_to ?? null,
    character_notes: c.character_notes,
    description: c.description,
    also_found_in: c.also_found_in ?? null,
    sources: c.sources,
    confidence: c.confidence,
    active: true,
    created_by: actorId,
    updated_by: actorId,
  }));
  const effectRows = SEED_EFFECTS.map((e) => ({
    slug: e.slug,
    name: e.name,
    category: e.category,
    definition: e.definition,
    house_note: e.house_note,
    aliases: e.aliases,
    sources: e.sources,
    confidence: e.confidence,
    source: "manual",
    status: "published",
    active: true,
    created_by: actorId,
    updated_by: actorId,
  }));
  const productFormatRows = SEED_PRODUCT_FORMATS.map((f) => ({
    slug: f.slug,
    name: f.name,
    category: f.category,
    definition: f.definition,
    consumption: f.consumption,
    potency_note: f.potency_note,
    house_note: f.house_note,
    aliases: f.aliases,
    sources: f.sources,
    confidence: f.confidence,
    source: "manual",
    status: "published",
    active: true,
    created_by: actorId,
    updated_by: actorId,
  }));
  const complianceRuleRows = SEED_COMPLIANCE_RULES.map((r) => ({
    slug: r.slug,
    title: r.title,
    category: r.category,
    rule: r.rule,
    house_note: r.house_note,
    severity: r.severity,
    citation: r.citation,
    sources: r.sources,
    confidence: r.confidence,
    sort_order: r.sort_order,
    source: "manual",
    status: "published",
    active: true,
    created_by: actorId,
    updated_by: actorId,
  }));
  const storeFactRows = SEED_STORE_FACTS.map((f) => ({
    key: f.key,
    label: f.label,
    category: f.category,
    body: f.body,
    tags: f.tags,
    sort_order: f.sort_order,
    sources: f.sources,
    confidence: f.confidence,
    source: "manual",
    status: "published",
    active: true,
    created_by: actorId,
    updated_by: actorId,
  }));
  const faqRows = SEED_FAQS.map((q) => ({
    slug: q.slug,
    question: q.question,
    answer: q.answer,
    category: q.category,
    tags: q.tags,
    sort_order: q.sort_order,
    sources: q.sources,
    confidence: q.confidence,
    source: "manual",
    status: "published",
    active: true,
    created_by: actorId,
    updated_by: actorId,
  }));
  const categoryRows = SEED_CATEGORIES.map((c) => ({
    category: c.category,
    display_name: c.display_name,
    formats: c.formats,
    format_words: c.format_words,
    sensory_words: c.sensory_words,
    notes: c.notes ?? null,
    active: true,
    created_by: actorId,
    updated_by: actorId,
  }));
  const bannedRows = SEED_BANNED_PHRASES.map((b) => ({
    phrase: b.phrase,
    severity: b.severity,
    reason: b.reason ?? null,
    active: true,
    created_by: actorId,
  }));
  // Product-type taxonomy (edibles, liquids, tinctures, topicals, vapes, …).
  // These are the validated PRODUCT families the store carries — kept separate
  // from strains, market-factual only (WA I-502). Seeded on `slug`.
  const productCategoryRows = PRODUCT_CATEGORIES.map((c) => ({
    slug: c.slug,
    name: c.name,
    group_key: c.group_key,
    summary: c.summary,
    aliases: c.aliases ?? [],
    wa_inventory_types: c.wa_inventory_types ?? [],
    sort_order: c.sort_order,
    active: true,
    created_by: actorId,
    updated_by: actorId,
  }));

  const errors: string[] = [];
  const warnings: string[] = [];
  const r1 = await admin.from("kb_strains").upsert(strainRows, { onConflict: "slug" });
  if (r1.error) errors.push(`strains: ${r1.error.message}`);
  const r2 = await admin.from("kb_terpenes").upsert(terpeneRows, { onConflict: "slug" });
  if (r2.error) {
    // Slice 5: aroma_families lives behind migration 0089. If that column isn't
    // there yet, don't fail the whole terpene seed — retry without it (matches the
    // pre-migration degrade pattern). Any OTHER error is still surfaced.
    const missingAromaFamilies =
      /aroma_families/i.test(r2.error.message) &&
      /(column|does not exist|schema cache)/i.test(r2.error.message);
    if (missingAromaFamilies) {
      const terpeneRowsNoFamilies = terpeneRows.map((row) => {
        const rest: Record<string, unknown> = { ...row };
        delete rest.aroma_families;
        return rest;
      });
      const r2b = await admin
        .from("kb_terpenes")
        .upsert(terpeneRowsNoFamilies, { onConflict: "slug" });
      if (r2b.error) {
        errors.push(`terpenes: ${r2b.error.message}`);
      } else {
        warnings.push(
          "terpenes: aroma_families column not found — seeded without the aroma cross-map. Apply migration 0089, then reseed.",
        );
      }
    } else {
      errors.push(`terpenes: ${r2.error.message}`);
    }
  }
  const r3 = await admin.from("kb_category_terms").upsert(categoryRows, { onConflict: "category" });
  if (r3.error) errors.push(`categories: ${r3.error.message}`);
  const r4 = await admin.from("kb_banned_phrases").upsert(bannedRows, { onConflict: "phrase" });
  if (r4.error) errors.push(`banned phrases: ${r4.error.message}`);

  // Product categories live behind migration 0070. If the table isn't there yet,
  // don't fail the whole seed — just note it (matches the pre-migration degrade
  // pattern used by the list helpers). Seeding these is idempotent.
  let productCategoriesSeeded = 0;
  const r5 = await admin
    .from("kb_product_categories")
    .upsert(productCategoryRows, { onConflict: "slug" });
  if (r5.error) {
    warnings.push(
      `product types not seeded (apply migration 0070): ${r5.error.message}`,
    );
  } else {
    productCategoriesSeeded = productCategoryRows.length;
  }

  // Cannabinoid compounds live behind migration 0083. Degrade gracefully (like
  // product categories) so seeding still works before the owner applies 0083.
  let cannabinoidsSeeded = 0;
  const r6 = await admin
    .from("kb_cannabinoids")
    .upsert(cannabinoidRows, { onConflict: "slug" });
  if (r6.error) {
    warnings.push(
      `cannabinoids not seeded (apply migration 0083): ${r6.error.message}`,
    );
  } else {
    cannabinoidsSeeded = cannabinoidRows.length;
  }

  // Effects vocabulary lives behind migration 0086. Degrade gracefully so
  // seeding still works before the owner applies 0086.
  let effectsSeeded = 0;
  const r7 = await admin
    .from("kb_effects")
    .upsert(effectRows, { onConflict: "slug" });
  if (r7.error) {
    warnings.push(`effects not seeded (apply migration 0086): ${r7.error.message}`);
  } else {
    effectsSeeded = effectRows.length;
  }

  // Product-format vocabulary lives behind migration 0087. Degrade gracefully
  // so seeding still works before the owner applies 0087.
  let productFormatsSeeded = 0;
  const r8 = await admin
    .from("kb_product_formats")
    .upsert(productFormatRows, { onConflict: "slug" });
  if (r8.error) {
    warnings.push(`product formats not seeded (apply migration 0087): ${r8.error.message}`);
  } else {
    productFormatsSeeded = productFormatRows.length;
  }

  // Compliance-rule reference lives behind migration 0088. Degrade gracefully
  // so seeding still works before the owner applies 0088.
  let complianceRulesSeeded = 0;
  const r9 = await admin
    .from("kb_compliance_rules")
    .upsert(complianceRuleRows, { onConflict: "slug" });
  if (r9.error) {
    warnings.push(`compliance rules not seeded (apply migration 0088): ${r9.error.message}`);
  } else {
    complianceRulesSeeded = complianceRuleRows.length;
  }

  // Store/brand facts live behind migration 0090. Degrade gracefully so seeding
  // still works before the owner applies 0090.
  let storeFactsSeeded = 0;
  const r10 = await admin
    .from("kb_store_facts")
    .upsert(storeFactRows, { onConflict: "key" });
  if (r10.error) {
    warnings.push(`store facts not seeded (apply migration 0090): ${r10.error.message}`);
  } else {
    storeFactsSeeded = storeFactRows.length;
  }

  // FAQ pack lives behind migration 0090. Degrade gracefully so seeding still
  // works before the owner applies 0090.
  let faqsSeeded = 0;
  const r11 = await admin
    .from("kb_faqs")
    .upsert(faqRows, { onConflict: "slug" });
  if (r11.error) {
    warnings.push(`FAQs not seeded (apply migration 0090): ${r11.error.message}`);
  } else {
    faqsSeeded = faqRows.length;
  }

  if (errors.length) {
    return {
      ok: false,
      message: `Some data couldn't be saved. Make sure the knowledge-base setup has been run. (${errors.join("; ")})`,
      inserted: { strains: 0, terpenes: 0, cannabinoids: 0, effects: 0, productFormats: 0, complianceRules: 0, storeFacts: 0, faqs: 0, categories: 0, banned: 0, productCategories: 0 },
    };
  }
  const okMessage =
    "Knowledge base seeded with the expert starter set. You can edit or add to it any time." +
    (warnings.length ? ` Note: ${warnings.join("; ")}.` : "");
  return {
    ok: true,
    message: okMessage,
    inserted: {
      strains: strainRows.length,
      terpenes: terpeneRows.length,
      cannabinoids: cannabinoidsSeeded,
      effects: effectsSeeded,
      productFormats: productFormatsSeeded,
      complianceRules: complianceRulesSeeded,
      storeFacts: storeFactsSeeded,
      faqs: faqsSeeded,
      categories: categoryRows.length,
      banned: bannedRows.length,
      productCategories: productCategoriesSeeded,
    },
  };
}

// ---------------------------------------------------------------------------
// Lightweight list reads for the admin page (degrade to [] pre-migration).
// ---------------------------------------------------------------------------

export type KbStrainRow = {
  id: string; slug: string; name: string; strain_type: string | null;
  aroma_notes: string[] | null; flavor_notes: string[] | null; terpenes: string[] | null; active: boolean;
};

export async function listKbStrains(limit = 500): Promise<KbStrainRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_strains")
      .select("id,slug,name,strain_type,aroma_notes,flavor_notes,terpenes,active")
      .order("name", { ascending: true })
      .limit(limit);
    if (error || !data) return [];
    return data as KbStrainRow[];
  } catch {
    return [];
  }
}

/**
 * Full strain row used by the manual add/edit form (every editable column the
 * kb_strains table holds, after migrations 0019 + 0020). Reads degrade to []
 * pre-migration like the other list helpers.
 */
export type KbStrainFull = {
  id: string;
  slug: string;
  name: string;
  aliases: string[] | null;
  strain_type: string | null;
  lineage: string | null;
  aroma_notes: string[] | null;
  flavor_notes: string[] | null;
  terpenes: string[] | null;
  summary: string | null;
  dominant_cannabinoid: string | null;
  potency_note: string | null;
  bud_structure: string | null;
  origin: string | null;
  sources: string[] | null;
  confidence: number | null;
  active: boolean;
  // Leaning + ratio (migration 0073). Percentages are 0-100 (indica vs sativa
  // split); `leaning` is a canonical strain-taxonomy value (e.g. sativa-hybrid).
  // These are NULL unless we have a verified ratio (owner-approved), so the UI
  // must treat null as "no verified ratio" rather than 0%.
  indica_pct: number | null;
  sativa_pct: number | null;
  ruderalis_pct: number | null;
  leaning: string | null;
  ratio_source: string | null;
  // Drafts-only lifecycle + provenance (migration 0085). Optional so the type
  // stays valid pre-migration; the loader falls back to the base columns then.
  status?: string | null;
  source?: string | null;
};

const KB_STRAIN_BASE_COLUMNS =
  "id,slug,name,aliases,strain_type,lineage,aroma_notes,flavor_notes,terpenes,summary," +
  "dominant_cannabinoid,potency_note,bud_structure,origin,sources,confidence,active," +
  "indica_pct,sativa_pct,ruderalis_pct,leaning,ratio_source";
const KB_STRAIN_FULL_COLUMNS = `${KB_STRAIN_BASE_COLUMNS},status,source`;

/**
 * Read full strain rows (all editable fields) for the manage/edit table.
 *
 * PostgREST caps a single `select()` at 1000 rows, so a plain `.limit(2500)`
 * silently returns only the first 1000 (the root cause of "only 1000 strains
 * show" even though the library holds 2000+). We page through with `.range()`
 * in 1000-row windows until we've fetched everything (up to `limit`).
 */
export async function listKbStrainsFull(limit = 5000): Promise<KbStrainFull[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const PAGE = 1000;
    const rows: KbStrainFull[] = [];
    // Try the provenance-aware columns first; if migration 0085 isn't applied
    // yet the status/source columns are unknown → fall back to the base set so
    // the manage page still renders (defensive FULL→BASE fallback).
    let cols = KB_STRAIN_FULL_COLUMNS;
    for (let from = 0; from < limit; from += PAGE) {
      const to = Math.min(from + PAGE, limit) - 1;
      let { data, error } = await admin
        .from("kb_strains")
        .select(cols)
        .order("name", { ascending: true })
        .range(from, to);
      if (error && cols === KB_STRAIN_FULL_COLUMNS) {
        // Unknown column (pre-0085) → retry this page with the base set and
        // keep using the base set for the remaining pages.
        cols = KB_STRAIN_BASE_COLUMNS;
        ({ data, error } = await admin
          .from("kb_strains")
          .select(cols)
          .order("name", { ascending: true })
          .range(from, to));
      }
      if (error || !data) break;
      rows.push(...(data as unknown as KbStrainFull[]));
      // Short page => no more rows to fetch.
      if (data.length < PAGE) break;
    }
    return rows;
  } catch {
    return [];
  }
}

/**
 * Terpene reference row (migration 0019). Read-only reference data — the owner
 * does not edit terpenes (there are a fixed set), but a detail view is useful.
 */
export type KbTerpeneRow = {
  id: string;
  slug: string;
  name: string;
  aroma_notes: string[];
  flavor_notes: string[];
  also_found_in: string | null;
  active: boolean;
};

const KB_TERPENE_COLUMNS = "id,slug,name,aroma_notes,flavor_notes,also_found_in,active";

/** List all terpene reference rows (active first, alphabetical). Degrades to []. */
export async function listKbTerpenesFull(limit = 500): Promise<KbTerpeneRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_terpenes")
      .select(KB_TERPENE_COLUMNS)
      .order("name", { ascending: true })
      .limit(limit);
    if (error || !data) return [];
    return data as unknown as KbTerpeneRow[];
  } catch {
    return [];
  }
}

/** Fetch one terpene by slug (for the detail page). Returns null if missing. */
export async function getKbTerpeneBySlug(slug: string): Promise<KbTerpeneRow | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_terpenes")
      .select(KB_TERPENE_COLUMNS)
      .eq("slug", slug)
      .maybeSingle();
    if (error || !data) return null;
    return data as unknown as KbTerpeneRow;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cannabinoid compounds (migration 0083). Reads/writes degrade safely
// pre-migration like the other KB helpers.
// ---------------------------------------------------------------------------
export type KbCannabinoidRow = {
  id: string;
  slug: string;
  name: string;
  full_name: string | null;
  intoxication: string | null;
  is_acidic: boolean;
  decarbs_to: string | null;
  character_notes: string[];
  description: string | null;
  also_found_in: string | null;
  sources: string[];
  confidence: number | null;
  active: boolean;
};

const KB_CANNABINOID_COLUMNS =
  "id,slug,name,full_name,intoxication,is_acidic,decarbs_to,character_notes,description,also_found_in,sources,confidence,active";

/** List all cannabinoid reference rows (active first, alphabetical). Degrades to []. */
export async function listKbCannabinoidsFull(limit = 100): Promise<KbCannabinoidRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_cannabinoids")
      .select(KB_CANNABINOID_COLUMNS)
      .order("active", { ascending: false })
      .order("name", { ascending: true })
      .limit(limit);
    if (error || !data) return [];
    return data as unknown as KbCannabinoidRow[];
  } catch {
    return [];
  }
}

/** Fetch one cannabinoid by slug (for the detail/editor page). Returns null if missing. */
export async function getKbCannabinoidBySlug(slug: string): Promise<KbCannabinoidRow | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_cannabinoids")
      .select(KB_CANNABINOID_COLUMNS)
      .eq("slug", slug)
      .maybeSingle();
    if (error || !data) return null;
    return data as unknown as KbCannabinoidRow;
  } catch {
    return null;
  }
}

export type UpsertKbCannabinoidInput = {
  slug: string;
  name: string;
  full_name?: string | null;
  intoxication?: string | null;
  is_acidic?: boolean;
  decarbs_to?: string | null;
  character_notes?: string[];
  description?: string | null;
  also_found_in?: string | null;
  sources?: string[];
  confidence?: number | null;
};

/** Idempotent upsert of a single cannabinoid on slug. Returns ok + message. */
export async function upsertKbCannabinoid(
  input: UpsertKbCannabinoidInput,
  actorId: string | null,
): Promise<{ ok: boolean; message: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, message: "The database isn't connected yet." };
  const slug = input.slug.trim().toLowerCase();
  if (!slug) return { ok: false, message: "A slug is required." };
  if (!input.name.trim()) return { ok: false, message: "A name is required." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("kb_cannabinoids").upsert(
      {
        slug,
        name: input.name.trim(),
        full_name: input.full_name?.trim() || null,
        intoxication: input.intoxication?.trim() || null,
        is_acidic: input.is_acidic ?? false,
        decarbs_to: input.decarbs_to?.trim() || null,
        character_notes: input.character_notes ?? [],
        description: input.description?.trim() || null,
        also_found_in: input.also_found_in?.trim() || null,
        sources: input.sources ?? [],
        confidence: input.confidence ?? null,
        updated_by: actorId,
      },
      { onConflict: "slug" },
    );
    if (error) {
      return { ok: false, message: `Couldn't save (apply migration 0083 if needed): ${error.message}` };
    }
    return { ok: true, message: `Saved ${input.name.trim()}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Unexpected error." };
  }
}

/** Toggle a cannabinoid active/hidden. */
export async function setCannabinoidActive(
  slug: string,
  active: boolean,
  actorId: string | null,
): Promise<{ ok: boolean; message: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, message: "The database isn't connected yet." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("kb_cannabinoids")
      .update({ active, updated_by: actorId })
      .eq("slug", slug.trim().toLowerCase());
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: active ? "Shown." : "Hidden." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Unexpected error." };
  }
}

// ---------------------------------------------------------------------------
// Experiential EFFECTS vocabulary (migration 0086). Reads/writes degrade safely
// pre-migration like the other KB helpers. SUBJECTIVE experience only — the
// compliance gate strips any medical framing before it can surface.
// ---------------------------------------------------------------------------
export type KbEffectRow = {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  definition: string | null;
  house_note: string | null;
  aliases: string[];
  sources: string[];
  confidence: number | null;
  source: string | null;
  status: string;
  active: boolean;
};

const KB_EFFECT_COLUMNS =
  "id,slug,name,category,definition,house_note,aliases,sources,confidence,source,status,active";

/** List all effect reference rows (active first, alphabetical). Degrades to []. */
export async function listKbEffectsFull(limit = 200): Promise<KbEffectRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_effects")
      .select(KB_EFFECT_COLUMNS)
      .order("active", { ascending: false })
      .order("name", { ascending: true })
      .limit(limit);
    if (error || !data) return [];
    return data as unknown as KbEffectRow[];
  } catch {
    return [];
  }
}

/** Fetch one effect by slug. Returns null if missing. */
export async function getKbEffectBySlug(slug: string): Promise<KbEffectRow | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_effects")
      .select(KB_EFFECT_COLUMNS)
      .eq("slug", slug)
      .maybeSingle();
    if (error || !data) return null;
    return data as unknown as KbEffectRow;
  } catch {
    return null;
  }
}

export type UpsertKbEffectInput = {
  slug: string;
  name: string;
  category?: string | null;
  definition?: string | null;
  house_note?: string | null;
  aliases?: string[];
  sources?: string[];
  confidence?: number | null;
};

/** Idempotent upsert of a single effect on slug. Curated edits stay published. */
export async function upsertKbEffect(
  input: UpsertKbEffectInput,
  actorId: string | null,
): Promise<{ ok: boolean; message: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, message: "The database isn't connected yet." };
  const slug = input.slug.trim().toLowerCase();
  if (!slug) return { ok: false, message: "A slug is required." };
  if (!input.name.trim()) return { ok: false, message: "A name is required." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("kb_effects").upsert(
      {
        slug,
        name: input.name.trim(),
        category: input.category?.trim() || null,
        definition: input.definition?.trim() || null,
        house_note: input.house_note?.trim() || null,
        aliases: input.aliases ?? [],
        sources: input.sources ?? [],
        confidence: input.confidence ?? null,
        source: "manual",
        status: "published",
        updated_by: actorId,
      },
      { onConflict: "slug" },
    );
    if (error) {
      return { ok: false, message: `Couldn't save (apply migration 0086 if needed): ${error.message}` };
    }
    return { ok: true, message: `Saved ${input.name.trim()}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Unexpected error." };
  }
}

/** Toggle an effect active/hidden. */
export async function setEffectActive(
  slug: string,
  active: boolean,
  actorId: string | null,
): Promise<{ ok: boolean; message: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, message: "The database isn't connected yet." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("kb_effects")
      .update({ active, updated_by: actorId })
      .eq("slug", slug.trim().toLowerCase());
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: active ? "Shown." : "Hidden." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Unexpected error." };
  }
}

// ---------------------------------------------------------------------------
// Product formats / consumption methods (migration 0087). Mirrors the effects
// CRUD above: read-only list/get for the admin card, plus idempotent upsert and
// active toggle for future curation. All reads degrade to []/null pre-migration.
// ---------------------------------------------------------------------------
export type KbProductFormatRow = {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  definition: string | null;
  consumption: string | null;
  potency_note: string | null;
  house_note: string | null;
  aliases: string[];
  sources: string[];
  confidence: number | null;
  source: string | null;
  status: string;
  active: boolean;
};

const KB_PRODUCT_FORMAT_COLUMNS =
  "id,slug,name,category,definition,consumption,potency_note,house_note,aliases,sources,confidence,source,status,active";

/** List all product-format rows (active first, alphabetical). Degrades to []. */
export async function listKbProductFormatsFull(limit = 200): Promise<KbProductFormatRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_product_formats")
      .select(KB_PRODUCT_FORMAT_COLUMNS)
      .order("active", { ascending: false })
      .order("name", { ascending: true })
      .limit(limit);
    if (error || !data) return [];
    return data as unknown as KbProductFormatRow[];
  } catch {
    return [];
  }
}

/** Fetch one product format by slug. Returns null if missing. */
export async function getKbProductFormatBySlug(slug: string): Promise<KbProductFormatRow | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_product_formats")
      .select(KB_PRODUCT_FORMAT_COLUMNS)
      .eq("slug", slug)
      .maybeSingle();
    if (error || !data) return null;
    return data as unknown as KbProductFormatRow;
  } catch {
    return null;
  }
}

export type UpsertKbProductFormatInput = {
  slug: string;
  name: string;
  category?: string | null;
  definition?: string | null;
  consumption?: string | null;
  potency_note?: string | null;
  house_note?: string | null;
  aliases?: string[];
  sources?: string[];
  confidence?: number | null;
};

/** Idempotent upsert of a single product format on slug. Curated edits stay published. */
export async function upsertKbProductFormat(
  input: UpsertKbProductFormatInput,
  actorId: string | null,
): Promise<{ ok: boolean; message: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, message: "The database isn't connected yet." };
  const slug = input.slug.trim().toLowerCase();
  if (!slug) return { ok: false, message: "A slug is required." };
  if (!input.name.trim()) return { ok: false, message: "A name is required." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("kb_product_formats").upsert(
      {
        slug,
        name: input.name.trim(),
        category: input.category?.trim() || null,
        definition: input.definition?.trim() || null,
        consumption: input.consumption?.trim() || null,
        potency_note: input.potency_note?.trim() || null,
        house_note: input.house_note?.trim() || null,
        aliases: input.aliases ?? [],
        sources: input.sources ?? [],
        confidence: input.confidence ?? null,
        source: "manual",
        status: "published",
        updated_by: actorId,
      },
      { onConflict: "slug" },
    );
    if (error) {
      return { ok: false, message: `Couldn't save (apply migration 0087 if needed): ${error.message}` };
    }
    return { ok: true, message: `Saved ${input.name.trim()}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Unexpected error." };
  }
}

/** Toggle a product format active/hidden. */
export async function setProductFormatActive(
  slug: string,
  active: boolean,
  actorId: string | null,
): Promise<{ ok: boolean; message: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, message: "The database isn't connected yet." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("kb_product_formats")
      .update({ active, updated_by: actorId })
      .eq("slug", slug.trim().toLowerCase());
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: active ? "Shown." : "Hidden." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Unexpected error." };
  }
}

// ---------------------------------------------------------------------------
// Compliance rules (migration 0088). REFERENCE/education layer — read-only list
// for the admin card plus idempotent upsert / active toggle for future curation.
// Reads degrade to []/null pre-migration. NOT the enforcement path (that stays
// in sales-limits-core.ts).
// ---------------------------------------------------------------------------
export type KbComplianceRuleRow = {
  id: string;
  slug: string;
  title: string;
  category: string | null;
  rule: string | null;
  house_note: string | null;
  severity: string;
  citation: string | null;
  sources: string[];
  confidence: number | null;
  sort_order: number;
  source: string | null;
  status: string;
  active: boolean;
};

const KB_COMPLIANCE_RULE_COLUMNS =
  "id,slug,title,category,rule,house_note,severity,citation,sources,confidence,sort_order,source,status,active";

/** List all compliance-rule rows (active first, by sort_order). Degrades to []. */
export async function listKbComplianceRulesFull(limit = 200): Promise<KbComplianceRuleRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_compliance_rules")
      .select(KB_COMPLIANCE_RULE_COLUMNS)
      .order("active", { ascending: false })
      .order("sort_order", { ascending: true })
      .limit(limit);
    if (error || !data) return [];
    return data as unknown as KbComplianceRuleRow[];
  } catch {
    return [];
  }
}

/** Fetch one compliance rule by slug. Returns null if missing. */
export async function getKbComplianceRuleBySlug(slug: string): Promise<KbComplianceRuleRow | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_compliance_rules")
      .select(KB_COMPLIANCE_RULE_COLUMNS)
      .eq("slug", slug)
      .maybeSingle();
    if (error || !data) return null;
    return data as unknown as KbComplianceRuleRow;
  } catch {
    return null;
  }
}

export type UpsertKbComplianceRuleInput = {
  slug: string;
  title: string;
  category?: string | null;
  rule?: string | null;
  house_note?: string | null;
  severity?: "info" | "important" | "critical";
  citation?: string | null;
  sources?: string[];
  confidence?: number | null;
  sort_order?: number;
};

/** Idempotent upsert of a single compliance rule on slug. Curated edits stay published. */
export async function upsertKbComplianceRule(
  input: UpsertKbComplianceRuleInput,
  actorId: string | null,
): Promise<{ ok: boolean; message: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, message: "The database isn't connected yet." };
  const slug = input.slug.trim().toLowerCase();
  if (!slug) return { ok: false, message: "A slug is required." };
  if (!input.title.trim()) return { ok: false, message: "A title is required." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("kb_compliance_rules").upsert(
      {
        slug,
        title: input.title.trim(),
        category: input.category?.trim() || null,
        rule: input.rule?.trim() || null,
        house_note: input.house_note?.trim() || null,
        severity: input.severity ?? "info",
        citation: input.citation?.trim() || null,
        sources: input.sources ?? [],
        confidence: input.confidence ?? null,
        sort_order: input.sort_order ?? 100,
        source: "manual",
        status: "published",
        updated_by: actorId,
      },
      { onConflict: "slug" },
    );
    if (error) {
      return { ok: false, message: `Couldn't save (apply migration 0088 if needed): ${error.message}` };
    }
    return { ok: true, message: `Saved ${input.title.trim()}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Unexpected error." };
  }
}

/** Toggle a compliance rule active/hidden. */
export async function setComplianceRuleActive(
  slug: string,
  active: boolean,
  actorId: string | null,
): Promise<{ ok: boolean; message: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, message: "The database isn't connected yet." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("kb_compliance_rules")
      .update({ active, updated_by: actorId })
      .eq("slug", slug.trim().toLowerCase());
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: active ? "Shown." : "Hidden." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Unexpected error." };
  }
}

/**
 * Customer-facing product-category taxonomy row (migration 0070). Reads degrade
 * to [] pre-migration like the other KB list helpers, so the admin page renders
 * safely before the owner has applied 0070.
 */
export type KbProductCategoryRow = {
  id: string;
  slug: string;
  name: string;
  group_key: string;
  summary: string | null;
  aliases: string[] | null;
  wa_inventory_types: string[] | null;
  sort_order: number;
  active: boolean;
};

export async function listKbProductCategories(
  limit = 200,
): Promise<KbProductCategoryRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_product_categories")
      .select(
        "id,slug,name,group_key,summary,aliases,wa_inventory_types,sort_order,active",
      )
      .order("sort_order", { ascending: true })
      .limit(limit);
    if (error || !data) return [];
    return data as KbProductCategoryRow[];
  } catch {
    return [];
  }
}

/**
 * Add or update a single product-type/category (manual staff entry). Mirrors the
 * strain editor so the owner can grow the product-type taxonomy over time.
 * Market-factual only (WA I-502: no health/effect claims). Upserts on `slug`.
 */
export type UpsertProductCategoryInput = {
  slug?: string | null;
  name: string;
  group_key: string; // flower | concentrate | vape | edible | liquid | topical
  summary?: string | null;
  aliases?: string[];
  wa_inventory_types?: string[];
  sort_order?: number | null;
  active?: boolean;
};

/** Normalize a display name into a stable slug (lowercase, dashed). */
function slugifyName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function upsertKbProductCategory(
  input: UpsertProductCategoryInput,
  actorId: string | null,
): Promise<{ ok: boolean; message?: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, message: "The database isn't connected yet." };
  }
  const admin = createSupabaseAdminClient();
  const slug = (input.slug?.trim() || slugifyName(input.name)) || slugifyName(input.name);
  if (!slug) return { ok: false, message: "A product type needs a name." };
  const row = {
    slug,
    name: input.name.trim(),
    group_key: input.group_key,
    summary: input.summary?.trim() || null,
    aliases: input.aliases ?? [],
    wa_inventory_types: input.wa_inventory_types ?? [],
    sort_order: typeof input.sort_order === "number" ? input.sort_order : 999,
    active: input.active ?? true,
    updated_by: actorId,
  };
  const { error } = await admin
    .from("kb_product_categories")
    .upsert(row, { onConflict: "slug" });
  if (error) {
    return {
      ok: false,
      message: `Couldn't save the product type (apply migration 0070?): ${error.message}`,
    };
  }
  return { ok: true };
}

/** Toggle a product-type row active/inactive. */
export async function setProductCategoryActive(
  id: string,
  active: boolean,
): Promise<{ ok: boolean; message?: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, message: "The database isn't connected yet." };
  }
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("kb_product_categories")
    .update({ active })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

/**
 * List product categories INCLUDING inactive rows, for the editor view. Reads
 * degrade to [] pre-migration like the other helpers.
 */
export async function listKbProductCategoriesAll(
  limit = 500,
): Promise<KbProductCategoryRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_product_categories")
      .select(
        "id,slug,name,group_key,summary,aliases,wa_inventory_types,sort_order,active",
      )
      .order("sort_order", { ascending: true })
      .limit(limit);
    if (error || !data) return [];
    return data as KbProductCategoryRow[];
  } catch {
    return [];
  }
}

export type UpsertStrainInput = {
  slug?: string | null;
  name: string;
  aliases?: string[];
  strain_type: string; // indica | sativa | hybrid | unknown
  lineage?: string | null;
  aroma_notes?: string[];
  flavor_notes?: string[];
  terpenes?: string[];
  summary?: string | null;
  dominant_cannabinoid?: string | null;
  potency_note?: string | null;
  bud_structure?: string | null;
  origin?: string | null;
  sources?: string[];
  confidence?: number | null;
  active?: boolean;
  /**
   * Review status: 'published' (default when omitted) or 'draft'. Set to
   * 'draft' by the AI product-lookup "Save to KB?" flow (T-314) so a human
   * approves before it auto-attaches to future lots. Written only when provided
   * so pre-migration DBs (no status column) keep working.
   */
  status?: string | null;
  /** Provenance: 'manual' | 'seed' | 'enrichment'. Written only when provided. */
  source?: string | null;
};

/**
 * Add or update a single strain row (manual entry by staff). Upserts on the
 * natural unique key `slug`, so re-saving the same strain updates it. Slug is
 * derived from the name when not supplied (lowercase, single-spaced) — matching
 * the generator's slug convention so manual rows interoperate with seeded ones.
 */
export async function upsertKbStrain(input: UpsertStrainInput, actorId: string | null): Promise<void> {
  const name = input.name.trim();
  const slug = (input.slug?.trim() || name).toLowerCase().replace(/\s+/g, " ");
  const conf =
    input.confidence === null || input.confidence === undefined
      ? null
      : Math.max(0, Math.min(1, input.confidence));
  const admin = createSupabaseAdminClient();
  const row: Record<string, unknown> = {
    slug,
    name,
    aliases: input.aliases ?? [],
    strain_type: input.strain_type,
    lineage: input.lineage ?? null,
    aroma_notes: input.aroma_notes ?? [],
    flavor_notes: input.flavor_notes ?? [],
    terpenes: input.terpenes ?? [],
    summary: input.summary ?? null,
    dominant_cannabinoid: input.dominant_cannabinoid ?? null,
    potency_note: input.potency_note ?? null,
    bud_structure: input.bud_structure ?? null,
    origin: input.origin ?? null,
    sources: input.sources ?? [],
    confidence: conf,
    active: input.active ?? true,
    updated_by: actorId,
  };
  // Additive: only include provenance columns when the caller sets them, so
  // existing callers and pre-migration DBs behave exactly as before.
  if (input.status !== undefined && input.status !== null) row.status = input.status;
  if (input.source !== undefined && input.source !== null) row.source = input.source;
  const { error } = await admin.from("kb_strains").upsert(row, { onConflict: "slug" });
  if (error) throw new Error(error.message);
}

/** Toggle a strain active/inactive. */
export async function setStrainActive(id: string, active: boolean): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("kb_strains").update({ active }).eq("id", id);
  if (error) throw new Error(error.message);
}

export type KbBrandRow = {
  id: string; slug: string; name: string; known_for: string | null; active: boolean;
};

export async function listKbBrands(limit = 500): Promise<KbBrandRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_brands")
      .select("id,slug,name,known_for,active")
      .order("name", { ascending: true })
      .limit(limit);
    if (error || !data) return [];
    return data as KbBrandRow[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Slice B — kb_brands drafts review (requires migration 0082 for the status/
// provenance columns; every read degrades to empty pre-migration).
// ---------------------------------------------------------------------------

export type KbBrandDraftRow = {
  id: string;
  slug: string;
  name: string;
  aliases: string[] | null;
  vendor_id: string | null;
  source: string | null;
  confidence: number | null;
  status: string;
  updated_at: string;
};

/** List kb_brands rows awaiting review (status='draft'). Empty pre-0082. */
export async function listKbBrandDrafts(limit = 200): Promise<KbBrandDraftRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_brands")
      .select("id,slug,name,aliases,vendor_id,source,confidence,status,updated_at")
      .eq("status", "draft")
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data as KbBrandDraftRow[];
  } catch {
    return [];
  }
}

/** Count draft kb_brands (for the review-queue badge). 0 pre-0082. */
export async function countKbBrandDrafts(): Promise<number> {
  if (!isSupabaseServiceConfigured) return 0;
  try {
    const admin = createSupabaseAdminClient();
    const { count, error } = await admin
      .from("kb_brands")
      .select("id", { count: "exact", head: true })
      .eq("status", "draft");
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

/** Publish / archive / return-to-draft one kb_brands row (mirrors reviewKbProduct). */
export async function reviewKbBrand(
  id: string,
  decision: "publish" | "archive" | "draft",
  actorId: string | null,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const patch =
    decision === "publish"
      ? { status: "published", active: true, updated_by: actorId }
      : decision === "archive"
        ? { status: "archived", active: false, updated_by: actorId }
        : { status: "draft", active: false, updated_by: actorId };
  const { error } = await admin.from("kb_brands").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Bulk publish/archive every DRAFT whose source starts with the given prefix
 * (e.g. 'ccrs:' = all CCRS-enrichment drafts, or 'ccrs:<datasetId>' = one
 * dataset). Only ever touches status='draft' rows — published/archived rows
 * are never moved by a bulk action. Returns per-table update counts.
 */
export async function bulkReviewKbDraftsBySource(
  sourcePrefix: string,
  decision: "publish" | "archive",
  actorId: string | null,
): Promise<{ products: number; brands: number }> {
  const admin = createSupabaseAdminClient();
  const patch =
    decision === "publish"
      ? { status: "published", active: true, updated_by: actorId }
      : { status: "archived", active: false, updated_by: actorId };
  const like = `${sourcePrefix.replaceAll("%", "\\%")}%`;

  let products = 0;
  let brands = 0;
  {
    const { data, error } = await admin
      .from("kb_products")
      .update(patch)
      .eq("status", "draft")
      .like("source", like)
      .select("id");
    if (error) throw new Error(error.message);
    products = data?.length ?? 0;
  }
  try {
    // kb_brands needs 0082; degrade to 0 when the columns don't exist yet.
    const { data, error } = await admin
      .from("kb_brands")
      .update(patch)
      .eq("status", "draft")
      .like("source", like)
      .select("id");
    if (!error) brands = data?.length ?? 0;
  } catch {
    // pre-0082 schema — brands untouched
  }
  return { products, brands };
}

export type KbBannedRow = { id: string; phrase: string; severity: string; reason: string | null; active: boolean };

export async function listKbBanned(limit = 500): Promise<KbBannedRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_banned_phrases")
      .select("id,phrase,severity,reason,active")
      .order("phrase", { ascending: true })
      .limit(limit);
    if (error || !data) return [];
    return data as KbBannedRow[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Mutations used by the admin page actions.
// ---------------------------------------------------------------------------

export async function addBannedPhrase(phrase: string, severity: "block" | "warn", reason: string | null, actorId: string | null): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("kb_banned_phrases")
    .upsert({ phrase: phrase.trim(), severity, reason, active: true, created_by: actorId }, { onConflict: "phrase" });
  if (error) throw new Error(error.message);
}

export async function setBannedActive(id: string, active: boolean): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("kb_banned_phrases").update({ active }).eq("id", id);
  if (error) throw new Error(error.message);
}

export type UpsertBrandInput = {
  slug: string; name: string; known_for?: string | null; house_style?: string | null;
  sensory_notes?: string[]; aliases?: string[];
};

export async function upsertKbBrand(input: UpsertBrandInput, actorId: string | null): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("kb_brands").upsert(
    {
      slug: input.slug.trim().toLowerCase(),
      name: input.name.trim(),
      known_for: input.known_for ?? null,
      house_style: input.house_style ?? null,
      sensory_notes: input.sensory_notes ?? [],
      aliases: input.aliases ?? [],
      active: true,
      created_by: actorId,
      updated_by: actorId,
    },
    { onConflict: "slug" },
  );
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Owner-uploaded reference notes (item 14, migration 0056). Free-form
// title + body + tags the owner drops in without touching code; retrieval
// matches active notes to a product and injects them into the grounded block.
// All reads degrade to [] pre-migration.
// ---------------------------------------------------------------------------

export type KbNoteRow = {
  id: string;
  title: string;
  body: string;
  tags: string[] | null;
  source: string | null;
  active: boolean;
  created_at: string;
};

export async function listKbNotes(limit = 500): Promise<KbNoteRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_notes")
      .select("id,title,body,tags,source,active,created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data as KbNoteRow[];
  } catch {
    return [];
  }
}

export type UpsertNoteInput = {
  id?: string | null;
  title: string;
  body: string;
  tags: string[];
  source: string | null;
};

/** Insert a new note, or update an existing one when `id` is supplied. */
export async function upsertKbNote(input: UpsertNoteInput, actorId: string | null): Promise<void> {
  const admin = createSupabaseAdminClient();
  if (input.id) {
    const { error } = await admin
      .from("kb_notes")
      .update({
        title: input.title,
        body: input.body,
        tags: input.tags,
        source: input.source,
        updated_by: actorId,
      })
      .eq("id", input.id);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await admin.from("kb_notes").insert({
    title: input.title,
    body: input.body,
    tags: input.tags,
    source: input.source,
    active: true,
    created_by: actorId,
    updated_by: actorId,
  });
  if (error) throw new Error(error.message);
}

/** Toggle a note active/inactive (soft hide from retrieval). */
export async function setKbNoteActive(id: string, active: boolean): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("kb_notes").update({ active }).eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// kb_products — per-SKU KB records promoted by the write-back service (0071).
// The admin "Review write-backs" queue lists DRAFT rows so the owner can
// validate them into published/active or archive them. Reads degrade to empty
// pre-migration.
// ---------------------------------------------------------------------------

export type KbProductRow = {
  id: string;
  brand_slug: string;
  product_slug: string;
  variant_label: string;
  display_name: string;
  category: string | null;
  aroma_notes: string[];
  flavor_notes: string[];
  terpenes: string[];
  effects: string[];
  description: string | null;
  short_description: string | null;
  image_media_ids: string[];
  primary_media_id: string | null;
  source: string | null;
  confidence: number | null;
  status: string;
  active: boolean;
  updated_at: string;
  // GAP 5 potency (migration 0084). Optional so the type is valid pre-migration.
  total_thc_pct?: number | null;
  total_cbd_pct?: number | null;
  potency_source?: string | null;
};

const KB_PRODUCT_BASE_COLS =
  "id, brand_slug, product_slug, variant_label, display_name, category, aroma_notes, flavor_notes, terpenes, effects, description, short_description, image_media_ids, primary_media_id, source, confidence, status, active, updated_at";
const KB_PRODUCT_FULL_COLS = `${KB_PRODUCT_BASE_COLS}, total_thc_pct, total_cbd_pct, potency_source`;

/** List kb_products by status (default: draft = the review queue). */
export async function listKbProducts(
  status: "draft" | "published" | "archived" | "all" = "draft",
  limit = 200,
): Promise<KbProductRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const run = (cols: string) => {
      let q = admin
        .from("kb_products")
        .select(cols)
        .order("updated_at", { ascending: false })
        .limit(limit);
      if (status !== "all") q = q.eq("status", status);
      return q;
    };
    // Try the potency-aware columns first; if 0084 isn't applied yet the column
    // is unknown → retry with the base column set so the page still renders.
    let { data, error } = await run(KB_PRODUCT_FULL_COLS);
    if (error) {
      ({ data, error } = await run(KB_PRODUCT_BASE_COLS));
    }
    if (error || !data) return [];
    return data as unknown as KbProductRow[];
  } catch {
    return [];
  }
}

/**
 * Slice H9c — attach an imported media asset to a kb_products row's gallery.
 * Reads the current gallery, applies the pure merge (append + set primary when
 * empty; never reorder/remove), and writes back. Returns a small summary for
 * the UI. Never publishes the product — this only enriches a draft/record's
 * images; the human still publishes separately.
 */
export async function attachKbProductImage(
  productId: string,
  mediaId: string,
  actorId: string | null,
): Promise<{ ok: boolean; becamePrimary: boolean; alreadyPresent: boolean; error?: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, becamePrimary: false, alreadyPresent: false, error: "Supabase not configured." };
  const admin = createSupabaseAdminClient();
  const { data: row, error: readErr } = await admin
    .from("kb_products")
    .select("id, image_media_ids, primary_media_id")
    .eq("id", productId)
    .maybeSingle();
  if (readErr) return { ok: false, becamePrimary: false, alreadyPresent: false, error: readErr.message };
  if (!row) return { ok: false, becamePrimary: false, alreadyPresent: false, error: "Product not found." };

  const merge = attachImageToGallery(
    {
      image_media_ids: (row as { image_media_ids?: string[] }).image_media_ids ?? [],
      primary_media_id: (row as { primary_media_id?: string | null }).primary_media_id ?? null,
    },
    mediaId,
  );
  if (merge.alreadyPresent) {
    return { ok: true, becamePrimary: false, alreadyPresent: true };
  }
  const { error: writeErr } = await admin
    .from("kb_products")
    .update({
      image_media_ids: merge.image_media_ids,
      primary_media_id: merge.primary_media_id,
      updated_by: actorId,
    })
    .eq("id", productId);
  if (writeErr) return { ok: false, becamePrimary: false, alreadyPresent: false, error: writeErr.message };
  return { ok: true, becamePrimary: merge.becamePrimary, alreadyPresent: false };
}

/** Count draft kb_products (for the review-queue badge). */
export async function countKbProductDrafts(): Promise<number> {
  if (!isSupabaseServiceConfigured) return 0;
  try {
    const admin = createSupabaseAdminClient();
    const { count } = await admin
      .from("kb_products")
      .select("id", { count: "exact", head: true })
      .eq("status", "draft");
    return count ?? 0;
  } catch {
    return 0;
  }
}

export type KbPipelineCounts = {
  /** Bronze: raw intake staged as drafts, awaiting enrichment/review. */
  draft: number;
  /** Gold: human-validated, active golden records the read side trusts. */
  published: number;
  /** Discarded/superseded records kept for audit. */
  archived: number;
  /** kb_products table reachable (migration 0071 applied). */
  migrated: boolean;
};

/**
 * Medallion pipeline stage counts for kb_products (Slice 6).
 * Bronze/Silver work is staged as `draft`; the review inbox is the Silver→Gold
 * human gate that promotes a draft to `published` (Gold) or `archived`.
 * Degrades to migrated=false pre-0071.
 */
export async function getKbPipelineCounts(): Promise<KbPipelineCounts> {
  const empty: KbPipelineCounts = { draft: 0, published: 0, archived: 0, migrated: false };
  if (!isSupabaseServiceConfigured) return empty;
  try {
    const admin = createSupabaseAdminClient();
    const countByStatus = async (status: string): Promise<number | null> => {
      const { count, error } = await admin
        .from("kb_products")
        .select("id", { count: "exact", head: true })
        .eq("status", status);
      if (error) return null;
      return count ?? 0;
    };
    const [draft, published, archived] = await Promise.all([
      countByStatus("draft"),
      countByStatus("published"),
      countByStatus("archived"),
    ]);
    const migrated = draft !== null; // a query succeeded → table exists
    return {
      draft: draft ?? 0,
      published: published ?? 0,
      archived: archived ?? 0,
      migrated,
    };
  } catch {
    return empty;
  }
}

/**
 * Validate a staged kb_products row into published/active, or archive it.
 * Publishing is the human validation step (drafts-only rule): only after this
 * is the per-SKU record treated as authoritative by the read side.
 */
export async function reviewKbProduct(
  id: string,
  decision: "publish" | "archive" | "draft",
  actorId: string | null,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const patch =
    decision === "publish"
      ? { status: "published", active: true, updated_by: actorId }
      : decision === "archive"
        ? { status: "archived", active: false, updated_by: actorId }
        : { status: "draft", active: false, updated_by: actorId };
  const { error } = await admin.from("kb_products").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Store/brand facts (migration 0090). Owner-extendable "about us" cards: hours,
// address, phone, payment, delivery, mission, etc. Read helpers degrade to
// []/null pre-migration; upsert/toggle let the owner add + curate their own.
// ---------------------------------------------------------------------------
export type KbStoreFactRow = {
  id: string;
  key: string;
  label: string;
  category: string;
  body: string;
  tags: string[];
  sort_order: number;
  sources: string[];
  confidence: number | null;
  source: string | null;
  status: string;
  active: boolean;
};

const KB_STORE_FACT_COLUMNS =
  "id,key,label,category,body,tags,sort_order,sources,confidence,source,status,active";

/** List all store-fact rows (active first, by category then sort_order). Degrades to []. */
export async function listKbStoreFactsFull(limit = 200): Promise<KbStoreFactRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_store_facts")
      .select(KB_STORE_FACT_COLUMNS)
      .order("active", { ascending: false })
      .order("category", { ascending: true })
      .order("sort_order", { ascending: true })
      .limit(limit);
    if (error || !data) return [];
    return data as unknown as KbStoreFactRow[];
  } catch {
    return [];
  }
}

/** Active, published store facts for retrieval grounding. Degrades to []. */
export async function listActiveKbStoreFacts(): Promise<KbStoreFactRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_store_facts")
      .select(KB_STORE_FACT_COLUMNS)
      .eq("active", true)
      .eq("status", "published")
      .order("category", { ascending: true })
      .order("sort_order", { ascending: true });
    if (error || !data) return [];
    return data as unknown as KbStoreFactRow[];
  } catch {
    return [];
  }
}

/** Fetch one store fact by key. Returns null if missing. */
export async function getKbStoreFactByKey(key: string): Promise<KbStoreFactRow | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_store_facts")
      .select(KB_STORE_FACT_COLUMNS)
      .eq("key", key)
      .maybeSingle();
    if (error || !data) return null;
    return data as unknown as KbStoreFactRow;
  } catch {
    return null;
  }
}

export type UpsertKbStoreFactInput = {
  key: string;
  label: string;
  category?: string | null;
  body: string;
  tags?: string[];
  sort_order?: number;
  sources?: string[];
  confidence?: number | null;
};

/** Idempotent upsert of a single store fact on key. Curated edits stay published. */
export async function upsertKbStoreFact(
  input: UpsertKbStoreFactInput,
  actorId: string | null,
): Promise<{ ok: boolean; message: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, message: "The database isn't connected yet." };
  const key = input.key.trim().toLowerCase();
  if (!key) return { ok: false, message: "A key is required." };
  if (!input.label.trim()) return { ok: false, message: "A label is required." };
  if (!input.body.trim()) return { ok: false, message: "The fact body can't be empty." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("kb_store_facts").upsert(
      {
        key,
        label: input.label.trim(),
        category: (input.category?.trim() || "basics"),
        body: input.body.trim(),
        tags: input.tags ?? [],
        sort_order: input.sort_order ?? 100,
        sources: input.sources ?? [],
        confidence: input.confidence ?? null,
        source: "manual",
        status: "published",
        updated_by: actorId,
      },
      { onConflict: "key" },
    );
    if (error) {
      return { ok: false, message: `Couldn't save (apply migration 0090 if needed): ${error.message}` };
    }
    return { ok: true, message: `Saved ${input.label.trim()}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Unexpected error." };
  }
}

/** Toggle a store fact active/hidden. */
export async function setStoreFactActive(
  key: string,
  active: boolean,
  actorId: string | null,
): Promise<{ ok: boolean; message: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, message: "The database isn't connected yet." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("kb_store_facts")
      .update({ active, updated_by: actorId })
      .eq("key", key.trim().toLowerCase());
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: active ? "Shown." : "Hidden." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Unexpected error." };
  }
}

// ---------------------------------------------------------------------------
// FAQ pack (migration 0090). Curated + owner-extendable Q&A. Read helpers
// degrade to []/null pre-migration; upsert/toggle let the owner add + curate.
// ---------------------------------------------------------------------------
export type KbFaqRow = {
  id: string;
  slug: string;
  question: string;
  answer: string;
  category: string;
  tags: string[];
  sort_order: number;
  sources: string[];
  confidence: number | null;
  source: string | null;
  status: string;
  active: boolean;
};

const KB_FAQ_COLUMNS =
  "id,slug,question,answer,category,tags,sort_order,sources,confidence,source,status,active";

/** List all FAQ rows (active first, by category then sort_order). Degrades to []. */
export async function listKbFaqsFull(limit = 300): Promise<KbFaqRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_faqs")
      .select(KB_FAQ_COLUMNS)
      .order("active", { ascending: false })
      .order("category", { ascending: true })
      .order("sort_order", { ascending: true })
      .limit(limit);
    if (error || !data) return [];
    return data as unknown as KbFaqRow[];
  } catch {
    return [];
  }
}

/** Active, published FAQs for retrieval grounding. Degrades to []. */
export async function listActiveKbFaqs(): Promise<KbFaqRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_faqs")
      .select(KB_FAQ_COLUMNS)
      .eq("active", true)
      .eq("status", "published")
      .order("category", { ascending: true })
      .order("sort_order", { ascending: true });
    if (error || !data) return [];
    return data as unknown as KbFaqRow[];
  } catch {
    return [];
  }
}

/** Fetch one FAQ by slug. Returns null if missing. */
export async function getKbFaqBySlug(slug: string): Promise<KbFaqRow | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_faqs")
      .select(KB_FAQ_COLUMNS)
      .eq("slug", slug)
      .maybeSingle();
    if (error || !data) return null;
    return data as unknown as KbFaqRow;
  } catch {
    return null;
  }
}

export type UpsertKbFaqInput = {
  slug: string;
  question: string;
  answer: string;
  category?: string | null;
  tags?: string[];
  sort_order?: number;
  sources?: string[];
  confidence?: number | null;
};

/** Idempotent upsert of a single FAQ on slug. Curated edits stay published. */
export async function upsertKbFaq(
  input: UpsertKbFaqInput,
  actorId: string | null,
): Promise<{ ok: boolean; message: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, message: "The database isn't connected yet." };
  const slug = input.slug.trim().toLowerCase();
  if (!slug) return { ok: false, message: "A slug is required." };
  if (!input.question.trim()) return { ok: false, message: "A question is required." };
  if (!input.answer.trim()) return { ok: false, message: "An answer is required." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("kb_faqs").upsert(
      {
        slug,
        question: input.question.trim(),
        answer: input.answer.trim(),
        category: (input.category?.trim() || "basics"),
        tags: input.tags ?? [],
        sort_order: input.sort_order ?? 100,
        sources: input.sources ?? [],
        confidence: input.confidence ?? null,
        source: "manual",
        status: "published",
        updated_by: actorId,
      },
      { onConflict: "slug" },
    );
    if (error) {
      return { ok: false, message: `Couldn't save (apply migration 0090 if needed): ${error.message}` };
    }
    return { ok: true, message: `Saved "${input.question.trim()}".` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Unexpected error." };
  }
}

/** Toggle an FAQ active/hidden. */
export async function setFaqActive(
  slug: string,
  active: boolean,
  actorId: string | null,
): Promise<{ ok: boolean; message: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, message: "The database isn't connected yet." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("kb_faqs")
      .update({ active, updated_by: actorId })
      .eq("slug", slug.trim().toLowerCase());
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: active ? "Shown." : "Hidden." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Unexpected error." };
  }
}
