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
  SEED_STRAINS,
  SEED_TERPENES,
  SEED_CATEGORIES,
  SEED_BANNED_PHRASES,
} from "./seed";

export type KbCounts = {
  strains: number;
  terpenes: number;
  categories: number;
  brands: number;
  banned: number;
  /** True if the kb_* tables exist (migration applied). */
  migrated: boolean;
};

async function tableCount(table: string): Promise<number | null> {
  const admin = createSupabaseAdminClient();
  const { count, error } = await admin.from(table).select("id", { count: "exact", head: true });
  if (error) return null;
  return count ?? 0;
}

/** Read counts across all KB tables. Returns migrated=false if tables missing. */
export async function getKbCounts(): Promise<KbCounts> {
  const empty: KbCounts = { strains: 0, terpenes: 0, categories: 0, brands: 0, banned: 0, migrated: false };
  if (!isSupabaseServiceConfigured) return empty;
  const [strains, terpenes, categories, brands, banned] = await Promise.all([
    tableCount("kb_strains"),
    tableCount("kb_terpenes"),
    tableCount("kb_category_terms"),
    tableCount("kb_brands"),
    tableCount("kb_banned_phrases"),
  ]);
  const migrated = strains !== null; // kb_strains query succeeded
  return {
    strains: strains ?? 0,
    terpenes: terpenes ?? 0,
    categories: categories ?? 0,
    brands: brands ?? 0,
    banned: banned ?? 0,
    migrated,
  };
}

export type SeedReport = {
  ok: boolean;
  message: string;
  inserted: { strains: number; terpenes: number; categories: number; banned: number };
};

/**
 * Idempotently upsert the starter KB data. Uses upsert on the natural unique
 * keys so re-running it refreshes the starter rows without duplicating, and
 * leaves owner-added rows untouched. Safe to run multiple times.
 */
export async function seedKnowledgeBase(actorId: string | null): Promise<SeedReport> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, message: "The database isn't connected yet.", inserted: { strains: 0, terpenes: 0, categories: 0, banned: 0 } };
  }
  const admin = createSupabaseAdminClient();

  const strainRows = SEED_STRAINS.map((s) => ({
    slug: s.slug,
    name: s.name,
    aliases: s.aliases ?? [],
    strain_type: s.strain_type,
    lineage: s.lineage ?? null,
    aroma_notes: s.aroma_notes,
    flavor_notes: s.flavor_notes,
    terpenes: s.terpenes,
    summary: s.summary,
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

  const errors: string[] = [];
  const r1 = await admin.from("kb_strains").upsert(strainRows, { onConflict: "slug" });
  if (r1.error) errors.push(`strains: ${r1.error.message}`);
  const r2 = await admin.from("kb_terpenes").upsert(terpeneRows, { onConflict: "slug" });
  if (r2.error) errors.push(`terpenes: ${r2.error.message}`);
  const r3 = await admin.from("kb_category_terms").upsert(categoryRows, { onConflict: "category" });
  if (r3.error) errors.push(`categories: ${r3.error.message}`);
  const r4 = await admin.from("kb_banned_phrases").upsert(bannedRows, { onConflict: "phrase" });
  if (r4.error) errors.push(`banned phrases: ${r4.error.message}`);

  if (errors.length) {
    return {
      ok: false,
      message: `Some data couldn't be saved. Make sure the knowledge-base setup has been run. (${errors.join("; ")})`,
      inserted: { strains: 0, terpenes: 0, categories: 0, banned: 0 },
    };
  }
  return {
    ok: true,
    message: "Knowledge base seeded with the expert starter set. You can edit or add to it any time.",
    inserted: {
      strains: strainRows.length,
      terpenes: terpeneRows.length,
      categories: categoryRows.length,
      banned: bannedRows.length,
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
