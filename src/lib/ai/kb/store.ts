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
  SEED_CATEGORIES,
  SEED_BANNED_PHRASES,
} from "./seed";
import { STRAINS_RICH } from "./strains-data";
import { PRODUCT_CATEGORIES } from "./product-categories-data";

export type KbCounts = {
  strains: number;
  terpenes: number;
  categories: number;
  brands: number;
  banned: number;
  /** Owner-uploaded free-form reference notes (item 14). */
  notes: number;
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
    categories: 0,
    brands: 0,
    banned: 0,
    notes: 0,
    migrated: false,
    notesMigrated: false,
  };
  if (!isSupabaseServiceConfigured) return empty;
  const [strains, terpenes, categories, brands, banned, notes] = await Promise.all([
    tableCount("kb_strains"),
    tableCount("kb_terpenes"),
    tableCount("kb_category_terms"),
    tableCount("kb_brands"),
    tableCount("kb_banned_phrases"),
    tableCount("kb_notes"),
  ]);
  const migrated = strains !== null; // kb_strains query succeeded
  return {
    strains: strains ?? 0,
    terpenes: terpenes ?? 0,
    categories: categories ?? 0,
    brands: brands ?? 0,
    banned: banned ?? 0,
    notes: notes ?? 0,
    migrated,
    notesMigrated: notes !== null,
  };
}

export type SeedReport = {
  ok: boolean;
  message: string;
  inserted: { strains: number; terpenes: number; categories: number; banned: number; productCategories: number };
};

/**
 * Idempotently upsert the starter KB data. Uses upsert on the natural unique
 * keys so re-running it refreshes the starter rows without duplicating, and
 * leaves owner-added rows untouched. Safe to run multiple times.
 */
export async function seedKnowledgeBase(actorId: string | null): Promise<SeedReport> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, message: "The database isn't connected yet.", inserted: { strains: 0, terpenes: 0, categories: 0, banned: 0, productCategories: 0 } };
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
  if (r2.error) errors.push(`terpenes: ${r2.error.message}`);
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

  if (errors.length) {
    return {
      ok: false,
      message: `Some data couldn't be saved. Make sure the knowledge-base setup has been run. (${errors.join("; ")})`,
      inserted: { strains: 0, terpenes: 0, categories: 0, banned: 0, productCategories: 0 },
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
};

const KB_STRAIN_FULL_COLUMNS =
  "id,slug,name,aliases,strain_type,lineage,aroma_notes,flavor_notes,terpenes,summary," +
  "dominant_cannabinoid,potency_note,bud_structure,origin,sources,confidence,active";

/** Read full strain rows (all editable fields) for the manage/edit table. */
export async function listKbStrainsFull(limit = 500): Promise<KbStrainFull[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_strains")
      .select(KB_STRAIN_FULL_COLUMNS)
      .order("name", { ascending: true })
      .limit(limit);
    if (error || !data) return [];
    return data as unknown as KbStrainFull[];
  } catch {
    return [];
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
  const { error } = await admin.from("kb_strains").upsert(
    {
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
    },
    { onConflict: "slug" },
  );
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
