import "server-only";
/**
 * src/lib/inventory/lot-size-link-store.ts  (R74 S30)
 *
 * DB side of the lot -> menu size link (inventory_lots.menu_source_variant_id,
 * migration 0294). The rules live in lot-size-link-core (pure).
 *
 *  - listLotsSharingSize: every ACTIVE lot that sells as one size (the lots a
 *    size price change affects; their highest cost + tax is the floor).
 *  - setLotSizeLink: the owner's "Which size is this lot?" pick (source
 *    "owner", which imports never overwrite), or clearing it.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAll } from "@/lib/supabase/chunked-in";
import type { SizeLot } from "@/lib/inventory/lot-size-link-core";

/** True when an error says the 0294 columns are not there yet. */
export function isMissingSizeLinkColumnError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const msg = String(error.message ?? "").toLowerCase();
  const signalled = ["42703", "PGRST204"].includes(String(error.code ?? "")) || /column .* does not exist|could not find the .* column/.test(msg);
  return signalled && /menu_source_variant_(id|source)/.test(msg);
}

/**
 * Active lots linked to `sizeId` on card `posProductKey`. Throws on a read
 * failure: the caller is computing a legal floor and must not proceed blind.
 */
export async function listLotsSharingSize(posProductKey: string, sizeId: string): Promise<SizeLot[]> {
  const admin = createSupabaseAdminClient();
  return pagedAll<SizeLot>(async (from, to) => {
    const { data, error } = await admin
      .from("inventory_lots")
      .select("id, lot_code, product_name, unit_cost_minor_units")
      .eq("pos_product_key", posProductKey)
      .eq("menu_source_variant_id", sizeId)
      .eq("status", "active")
      .order("id", { ascending: true })
      .range(from, to);
    if (error) throw new Error(`read the lots that share this size: ${error.message}`);
    return (data as SizeLot[] | null) ?? [];
  });
}

/**
 * Active lots on card `posProductKey` (used for one-size cards and intake
 * keys, where every lot of the key sells at the one price).
 */
export async function listActiveLotsForKey(posProductKey: string): Promise<SizeLot[]> {
  const admin = createSupabaseAdminClient();
  return pagedAll<SizeLot>(async (from, to) => {
    const { data, error } = await admin
      .from("inventory_lots")
      .select("id, lot_code, product_name, unit_cost_minor_units")
      .eq("pos_product_key", posProductKey)
      .eq("status", "active")
      .order("id", { ascending: true })
      .range(from, to);
    if (error) throw new Error(`read the lots of this product: ${error.message}`);
    return (data as SizeLot[] | null) ?? [];
  });
}

export type SetSizeLinkResult = { ok: true; previous: string | null; previousSource: string | null } | { ok: false; error: string };

/** Write (or clear, sizeId = null) the owner's size pick for one lot. */
export async function setLotSizeLink(lotId: string, sizeId: string | null): Promise<SetSizeLinkResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database isn't configured in this environment." };
  const admin = createSupabaseAdminClient();
  const { data: before, error: readErr } = await admin
    .from("inventory_lots")
    .select("id, menu_source_variant_id, menu_source_variant_source")
    .eq("id", lotId)
    .maybeSingle();
  if (readErr) {
    if (isMissingSizeLinkColumnError(readErr)) return { ok: false, error: "Migration 0294 (the lot size link) is not applied yet. Apply it in the Supabase SQL editor first." };
    return { ok: false, error: `Could not read the lot: ${readErr.message}` };
  }
  if (!before) return { ok: false, error: "That lot no longer exists." };
  const prev = before as { menu_source_variant_id: string | null; menu_source_variant_source: string | null };
  const patch = sizeId
    ? { menu_source_variant_id: sizeId, menu_source_variant_source: "owner" }
    : { menu_source_variant_id: null, menu_source_variant_source: null };
  const { error } = await admin.from("inventory_lots").update(patch).eq("id", lotId);
  if (error) {
    if (isMissingSizeLinkColumnError(error)) return { ok: false, error: "Migration 0294 (the lot size link) is not applied yet. Apply it in the Supabase SQL editor first." };
    return { ok: false, error: `Saving the size failed: ${error.message}` };
  }
  return { ok: true, previous: prev.menu_source_variant_id, previousSource: prev.menu_source_variant_source };
}
