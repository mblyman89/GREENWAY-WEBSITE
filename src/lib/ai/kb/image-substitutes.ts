/**
 * src/lib/ai/kb/image-substitutes.ts
 *
 * The approved image-substitute KB (DF-2). A curated, owner-editable library of
 * fallback images so a product card is NEVER blank. Each row points at a
 * media_assets image and is scoped to a category / inventory type / brand /
 * vendor / global key.
 *
 * The product image resolver (DF-3) resolves, in order:
 *   exact product image → brand/vendor shot → honest substitute →
 *   category match → inventory_type match → global ('*').
 *
 * All reads degrade gracefully (return []/null) when the table isn't migrated
 * yet, so the admin page and front end never hard-crash pre-migration.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { publicUrlForKey } from "@/lib/media/store";

export type SubstituteScope = "category" | "inventory_type" | "brand" | "vendor" | "global";

export type ImageSubstitute = {
  id: string;
  scope: SubstituteScope;
  key: string;
  media_id: string;
  label: string | null;
  priority: number;
  active: boolean;
};

/** Substitute joined with the resolved public URL of its media asset. */
export type ImageSubstituteWithUrl = ImageSubstitute & { url: string | null };

/** Normalize a lookup key: lowercase + collapse internal whitespace. */
export function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// The full catalog taxonomy we seed coverage for, measured from the owner's
// INVENTORIES.xlsx + PRODUCTS.xlsx (so every product type/category resolves to
// something from day one). Lowercased to match normalizeKey().
// ---------------------------------------------------------------------------

/** All product CATEGORIES seen across both sheets (52 unique, deduped). */
export const SEED_CATEGORY_KEYS: string[] = [
  "flower",
  "pre-roll",
  "infused pre-roll",
  "cartridge",
  "disposable cartridge",
  "edible",
  "rosin",
  "beverage",
  "gummies",
  "bho",
  "chocolate",
  "live resin",
  "fruit chews",
  "rso",
  "topical",
  "infused blunt",
  "shots",
  "tincture",
  "badder",
  "blunt",
  "liquid infused edible",
  "mints",
  "chewees",
  "hash rosin",
  "moon rocks",
  "distillate",
  "roll on",
  "hash",
  "capsule",
  "bubble hash",
  "balls",
  "thca",
  "sugar",
  "shatter",
  "live resin cartridge",
  "soda",
  "mix infused flower",
  "terp crystals",
  "minis",
  "bath salts",
  "crumble",
];

/** All INVENTORY TYPES seen across both sheets (6 unique). */
export const SEED_INVENTORY_TYPE_KEYS: string[] = [
  "concentrate for inhalation",
  "usable marijuana",
  "solid edible",
  "liquid edible",
  "topical ointment",
  "tincture",
];

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** True if the kb_image_substitutes table exists (migration 0021 applied). */
export async function imageSubstitutesMigrated(): Promise<boolean> {
  if (!isSupabaseServiceConfigured) return false;
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("kb_image_substitutes")
      .select("id", { count: "exact", head: true });
    return !error;
  } catch {
    return false;
  }
}

/** List all substitutes (newest priority first) with resolved URLs for the admin grid. */
export async function listImageSubstitutes(limit = 500): Promise<ImageSubstituteWithUrl[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_image_substitutes")
      .select("id,scope,key,media_id,label,priority,active")
      .order("scope", { ascending: true })
      .order("key", { ascending: true })
      .order("priority", { ascending: true })
      .limit(limit);
    if (error || !data) return [];
    const rows = data as ImageSubstitute[];
    const urls = await resolveMediaUrlsLocal(rows.map((r) => r.media_id));
    return rows.map((r) => ({ ...r, url: urls.get(r.media_id) ?? null }));
  } catch {
    return [];
  }
}

/** Count active substitutes per scope (for the admin coverage summary). */
export async function imageSubstituteCounts(): Promise<{
  total: number;
  byScope: Record<SubstituteScope, number>;
  coveredCategories: number;
  coveredInventoryTypes: number;
}> {
  const empty = {
    total: 0,
    byScope: { category: 0, inventory_type: 0, brand: 0, vendor: 0, global: 0 } as Record<SubstituteScope, number>,
    coveredCategories: 0,
    coveredInventoryTypes: 0,
  };
  if (!isSupabaseServiceConfigured) return empty;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_image_substitutes")
      .select("scope,key,active");
    if (error || !data) return empty;
    const rows = data as { scope: SubstituteScope; key: string; active: boolean }[];
    const byScope = { ...empty.byScope };
    const cats = new Set<string>();
    const types = new Set<string>();
    for (const r of rows) {
      if (!r.active) continue;
      byScope[r.scope] = (byScope[r.scope] ?? 0) + 1;
      if (r.scope === "category") cats.add(r.key);
      if (r.scope === "inventory_type") types.add(r.key);
    }
    return {
      total: rows.filter((r) => r.active).length,
      byScope,
      coveredCategories: cats.size,
      coveredInventoryTypes: types.size,
    };
  } catch {
    return empty;
  }
}

// ---------------------------------------------------------------------------
// Resolution (used by the DF-3 product image resolver)
// ---------------------------------------------------------------------------

/**
 * Resolve the best approved substitute image URL for a product, given its
 * category and inventory type. Tries category → inventory_type → global, lowest
 * priority number first. Returns null if nothing is configured/migrated.
 */
export async function resolveSubstituteFor(
  category: string | null | undefined,
  inventoryType: string | null | undefined,
): Promise<{ url: string; scope: SubstituteScope; key: string } | null> {
  if (!isSupabaseServiceConfigured) return null;
  const attempts: { scope: SubstituteScope; key: string }[] = [];
  if (category) attempts.push({ scope: "category", key: normalizeKey(category) });
  if (inventoryType) attempts.push({ scope: "inventory_type", key: normalizeKey(inventoryType) });
  attempts.push({ scope: "global", key: "*" });

  try {
    const admin = createSupabaseAdminClient();
    for (const a of attempts) {
      const { data, error } = await admin
        .from("kb_image_substitutes")
        .select("media_id,priority")
        .eq("scope", a.scope)
        .eq("key", a.key)
        .eq("active", true)
        .order("priority", { ascending: true })
        .limit(1);
      if (error || !data || data.length === 0) continue;
      const mediaId = (data[0] as { media_id: string }).media_id;
      const urls = await resolveMediaUrlsLocal([mediaId]);
      const url = urls.get(mediaId);
      if (url) return { url, scope: a.scope, key: a.key };
    }
  } catch {
    return null;
  }
  return null;
}

/** Resolve the best approved generic shot for a brand or vendor slug. */
export async function resolveBrandVendorSubstitute(
  brandSlug: string | null | undefined,
  vendorSlug: string | null | undefined,
): Promise<{ url: string; scope: SubstituteScope; key: string } | null> {
  if (!isSupabaseServiceConfigured) return null;
  const attempts: { scope: SubstituteScope; key: string }[] = [];
  if (brandSlug) attempts.push({ scope: "brand", key: normalizeKey(brandSlug) });
  if (vendorSlug) attempts.push({ scope: "vendor", key: normalizeKey(vendorSlug) });
  if (attempts.length === 0) return null;
  try {
    const admin = createSupabaseAdminClient();
    for (const a of attempts) {
      const { data, error } = await admin
        .from("kb_image_substitutes")
        .select("media_id,priority")
        .eq("scope", a.scope)
        .eq("key", a.key)
        .eq("active", true)
        .order("priority", { ascending: true })
        .limit(1);
      if (error || !data || data.length === 0) continue;
      const mediaId = (data[0] as { media_id: string }).media_id;
      const urls = await resolveMediaUrlsLocal([mediaId]);
      const url = urls.get(mediaId);
      if (url) return { url, scope: a.scope, key: a.key };
    }
  } catch {
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export type UpsertSubstituteInput = {
  scope: SubstituteScope;
  key: string;
  media_id: string;
  label?: string | null;
  priority?: number;
};

/** Add or update a substitute (upsert on scope+key+media_id). */
export async function upsertImageSubstitute(
  input: UpsertSubstituteInput,
  actorId: string | null,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const key = input.scope === "global" ? "*" : normalizeKey(input.key);
  const { error } = await admin.from("kb_image_substitutes").upsert(
    {
      scope: input.scope,
      key,
      media_id: input.media_id,
      label: input.label ?? null,
      priority: input.priority ?? 100,
      active: true,
      created_by: actorId,
      updated_by: actorId,
    },
    { onConflict: "scope,key,media_id" },
  );
  if (error) throw new Error(error.message);
}

export async function setSubstituteActive(id: string, active: boolean): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("kb_image_substitutes").update({ active }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteImageSubstitute(id: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("kb_image_substitutes").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Local URL resolver (kept here to avoid a circular import quirk; mirrors
// media/store.resolveMediaUrls but lives alongside this module's reads).
// ---------------------------------------------------------------------------

async function resolveMediaUrlsLocal(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0 || !isSupabaseServiceConfigured) return out;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("media_assets").select("id, storage_key, public_url").in("id", unique);
  for (const row of (data as { id: string; storage_key: string; public_url: string | null }[] | null) ?? []) {
    const url = publicUrlForKey(row.storage_key) ?? row.public_url ?? null;
    if (url) out.set(row.id, url);
  }
  return out;
}
