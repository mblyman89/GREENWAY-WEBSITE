/**
 * src/lib/noncannabis/store.ts
 *
 * Data access for the non-cannabis product catalog (migration 0076). Server-only.
 * Mirrors the style of src/lib/equipment/store.ts.
 *
 * Money is stored in MINOR UNITS (cents). Writes are drafts-first: the intake
 * flow inserts status='draft' rows the staff confirm to 'active'.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  buildNonCannabisName,
  buildSku,
  nextAvailableSku,
  nextSeqForType,
  validateNonCannabisName,
  type NonCannabisType,
  type Gender,
} from "@/lib/naming/noncannabis-core";

export type NonCannabisProduct = {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  type: string;
  size: string | null;
  gender: "male" | "female" | null;
  color: string | null;
  price_minor_units: number;
  cost_minor_units: number;
  qty_on_hand: number;
  status: "draft" | "active" | "archived";
  notes: string | null;
  kb_category_slug: string | null;
  created_at: string;
  updated_at: string;
};

export type NonCannabisDraftInput = {
  brand?: string | null;
  type: NonCannabisType | string;
  size?: string | null;
  gender?: Gender;
  color?: string | null;
  price_minor_units?: number;
  cost_minor_units?: number;
  qty_on_hand?: number;
  notes?: string | null;
  kb_category_slug?: string | null;
  /** Optional manual name override; when absent we build from parts. */
  nameOverride?: string | null;
};

export async function listNonCannabisProducts(opts?: {
  status?: NonCannabisProduct["status"];
  type?: string;
  q?: string;
}): Promise<NonCannabisProduct[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  let query = admin
    .from("noncannabis_products")
    .select("*")
    .order("type", { ascending: true })
    .order("name", { ascending: true })
    .limit(2000);
  if (opts?.status) query = query.eq("status", opts.status);
  if (opts?.type) query = query.eq("type", opts.type);
  if (opts?.q) query = query.ilike("name", `%${opts.q}%`);
  const { data } = await query;
  return (data as NonCannabisProduct[] | null) ?? [];
}

/** Fetch one product by id (for the label page). */
export async function getNonCannabisProduct(
  id: string,
): Promise<NonCannabisProduct | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("noncannabis_products")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as NonCannabisProduct | null) ?? null;
}

/** All existing SKUs (for collision-free generation). */
export async function listExistingSkus(): Promise<Set<string>> {
  if (!isSupabaseServiceConfigured) return new Set();
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("noncannabis_products").select("sku").limit(5000);
  return new Set(((data as { sku: string }[] | null) ?? []).map((r) => r.sku));
}

/** Generate the next SKU + preview name for a set of parts (no write). */
export async function previewSkuAndName(input: NonCannabisDraftInput): Promise<{
  sku: string;
  name: string;
  nameOk: boolean;
  nameIssues: string[];
}> {
  const existing = await listExistingSkus();
  const startSeq = nextSeqForType(input.type, existing);
  const sku = nextAvailableSku(
    { type: input.type, size: input.size, color: input.color, gender: input.gender },
    existing,
    startSeq,
  );
  const name =
    (input.nameOverride ?? "").trim() ||
    buildNonCannabisName({
      brand: input.brand,
      type: input.type,
      size: input.size,
      gender: input.gender,
      color: input.color,
    });
  const v = validateNonCannabisName(name);
  return { sku, name, nameOk: v.ok, nameIssues: v.issues };
}

/**
 * Create a non-cannabis product (draft by default). Generates a collision-free
 * SKU + convention name unless a valid override is provided. Returns the row id
 * or an error string.
 */
export async function createNonCannabisProduct(
  input: NonCannabisDraftInput,
  actorId: string | null,
  status: NonCannabisProduct["status"] = "draft",
): Promise<{ ok: true; id: string; sku: string; name: string } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "supabase-not-configured" };
  const admin = createSupabaseAdminClient();

  const { sku, name, nameOk, nameIssues } = await previewSkuAndName(input);
  if (!nameOk) return { ok: false, error: `Name invalid: ${nameIssues.join(" ")}` };

  const gender = input.gender === "male" || input.gender === "female" ? input.gender : null;
  const { data, error } = await admin
    .from("noncannabis_products")
    .insert({
      sku,
      name,
      brand: (input.brand ?? "").trim() || null,
      type: input.type,
      size: (input.size ?? "").trim() || null,
      gender,
      color: (input.color ?? "").trim() || null,
      price_minor_units: Math.max(0, Math.round(input.price_minor_units ?? 0)),
      cost_minor_units: Math.max(0, Math.round(input.cost_minor_units ?? 0)),
      qty_on_hand: Math.max(0, Math.round(input.qty_on_hand ?? 0)),
      status,
      notes: (input.notes ?? "").trim() || null,
      kb_category_slug: (input.kb_category_slug ?? "").trim() || null,
      created_by: actorId,
      updated_by: actorId,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, id: (data as { id: string }).id, sku, name };
}

/** Confirm a draft -> active (staff action). */
export async function activateNonCannabisProduct(
  id: string,
  actorId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "supabase-not-configured" };
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("noncannabis_products")
    .update({ status: "active", updated_by: actorId })
    .eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Archive a product (soft delete). */
export async function archiveNonCannabisProduct(
  id: string,
  actorId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "supabase-not-configured" };
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("noncannabis_products")
    .update({ status: "archived", updated_by: actorId })
    .eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export function summarizeNonCannabis(rows: NonCannabisProduct[]) {
  const active = rows.filter((r) => r.status === "active").length;
  const draft = rows.filter((r) => r.status === "draft").length;
  const totalUnits = rows.reduce((s, r) => s + (r.qty_on_hand ?? 0), 0);
  const retailValueMinor = rows.reduce(
    (s, r) => s + (r.price_minor_units ?? 0) * (r.qty_on_hand ?? 0),
    0,
  );
  return { total: rows.length, active, draft, totalUnits, retailValueMinor };
}

// Re-export buildSku so callers importing from the store have it if needed.
export { buildSku };
