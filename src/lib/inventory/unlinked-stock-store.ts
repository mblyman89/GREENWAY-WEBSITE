import "server-only";
/**
 * src/lib/inventory/unlinked-stock-store.ts  (D195 step 2: unlinked stock)
 *
 * Reads for the unlinked-stock worklist and the ONE guarded write that joins
 * a barcode-keyed lot to its published menu card. Every decision is made in
 * the pure core (unlinked-stock-core.ts).
 *
 * FAIL CLOSED. A failed or empty menu read returns ok:false: with no cards,
 * every lot would look "unlinked", and the count on Promotions / Issues would
 * be a false alarm.
 *
 * WHAT THE WRITE CHANGES, AND WHAT IT DOES NOT. pos_product_key is the key
 * the register, FIFO, the cost floor and Promotions join a lot to its card
 * by. It is a LOCKED lot field (lot-edit-core LOCKED_LOT_FIELDS); this is a
 * narrow door, like S37's "Link this lot to a product", not an edit:
 *   - the UPDATE re-asserts the OLD key and `status <> destroyed` in its
 *     WHERE clause, so a lot changed in another tab matches zero rows;
 *   - provenance is written with the value (migration 0215: owner_entered,
 *     set_by, set_at), and an audit row records old key -> new key;
 *   - the lot's CCRS identity is NOT touched: lot_code and
 *     ccrs_inventory_external_id were assigned at receiving and stay the
 *     barcode, so every CCRS file keeps reporting the same inventory id.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { chunkedIn, pagedAll } from "@/lib/supabase/chunked-in";
import { getPublishedVersion, getVersionItems } from "@/lib/pos/menu-version";
import type { UnlinkedCardInput, UnlinkedLotInput } from "@/lib/inventory/unlinked-stock-core";

type Fail = { ok: false; error: string };

type LotRow = {
  id: string;
  pos_product_key: string | null;
  product_name: string | null;
  status: string;
  on_hand_qty: number | null;
  vendor_id: string | null;
  brand_id: string | null;
  unit_cost_minor_units: number | null;
  unit_weight: number | null;
  unit_weight_uom: string | null;
  created_at: string | null;
};

const LOT_COLUMNS =
  "id, pos_product_key, product_name, status, on_hand_qty, vendor_id, brand_id, unit_cost_minor_units, unit_weight, unit_weight_uom, created_at";

/** Published cards with their sizes, reduced for matching. Fails closed. */
export async function loadUnlinkedCards(): Promise<{ ok: true; cards: UnlinkedCardInput[] } | Fail> {
  const version = await getPublishedVersion();
  if (!version) return { ok: false, error: "No published menu was found, so lots cannot be checked against it." };
  const items = await getVersionItems(version.id);
  if (items.length === 0) return { ok: false, error: "The published menu could not be read. Reload to try again." };
  return {
    ok: true,
    cards: items.map((i) => ({
      key: i.source_item_id,
      name: i.name,
      productName: i.product_name ?? null,
      vendorName: i.vendor_name ?? null,
      brandName: i.brand_name ?? null,
      category: i.category ?? null,
      sizes: (i.variants ?? []).map((v) => ({ sourceVariantId: v.source_variant_id, label: v.label ?? null })),
    })),
  };
}

async function namesFor(table: "vendors" | "brands", ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const admin = createSupabaseAdminClient();
  let failed: string | null = null;
  const rows = await chunkedIn<string, { id: string; display_name: string | null }>(ids, async (chunk, from, to) => {
    const { data, error } = await admin.from(table).select("id, display_name").in("id", chunk).order("id").range(from, to);
    if (error) failed = error.message;
    return (data as { id: string; display_name: string | null }[] | null) ?? [];
  });
  if (failed) throw new Error(`read ${table}: ${failed}`);
  for (const r of rows) if (r.display_name) out.set(r.id, r.display_name);
  return out;
}

function toInput(r: LotRow, vendors: Map<string, string>, brands: Map<string, string>): UnlinkedLotInput {
  return {
    id: r.id,
    posProductKey: r.pos_product_key,
    productName: r.product_name,
    status: r.status,
    onHandQty: Number(r.on_hand_qty ?? 0),
    vendorName: r.vendor_id ? vendors.get(r.vendor_id) ?? null : null,
    brandName: r.brand_id ? brands.get(r.brand_id) ?? null : null,
    unitCostMinorUnits: r.unit_cost_minor_units,
    unitWeight: r.unit_weight,
    unitWeightUom: r.unit_weight_uom,
    createdAt: r.created_at,
  };
}

/**
 * Candidate lots: every non-destroyed lot whose key is NOT a Cultivera
 * `pos-` key (those were created together with their cards). That is the
 * receiving path, a few hundred rows. The core decides which are unlinked.
 */
export async function loadCandidateLots(): Promise<{ ok: true; lots: UnlinkedLotInput[] } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase service role not configured." };
  const admin = createSupabaseAdminClient();
  try {
    const rows = await pagedAll<LotRow>(async (from, to) => {
      const { data, error } = await admin
        .from("inventory_lots")
        .select(LOT_COLUMNS)
        .not("pos_product_key", "is", null)
        .not("pos_product_key", "like", "pos-%")
        .neq("pos_product_key", "")
        .neq("status", "destroyed")
        .order("id", { ascending: true })
        .range(from, to);
      if (error) throw new Error(`read the received lots: ${error.message}`);
      return (data as LotRow[] | null) ?? [];
    });
    const vendorIds = [...new Set(rows.map((r) => r.vendor_id).filter((v): v is string => !!v))];
    const brandIds = [...new Set(rows.map((r) => r.brand_id).filter((v): v is string => !!v))];
    const [vendors, brands] = await Promise.all([namesFor("vendors", vendorIds), namesFor("brands", brandIds)]);
    return { ok: true, lots: rows.map((r) => toInput(r, vendors, brands)) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** One lot, fresh, for the server re-check before the write. */
export async function loadLotForRelink(lotId: string): Promise<{ ok: true; lot: UnlinkedLotInput | null } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase service role not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("inventory_lots").select(LOT_COLUMNS).eq("id", lotId).maybeSingle();
  if (error) return { ok: false, error: `Could not read the lot: ${error.message}` };
  if (!data) return { ok: true, lot: null };
  const r = data as LotRow;
  try {
    const [vendors, brands] = await Promise.all([
      namesFor("vendors", r.vendor_id ? [r.vendor_id] : []),
      namesFor("brands", r.brand_id ? [r.brand_id] : []),
    ]);
    return { ok: true, lot: toInput(r, vendors, brands) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Move a lot from its barcode key to its card's key. Compare-and-set: the
 * UPDATE matches only while the lot still carries `oldKey` and is not
 * destroyed. `relinked:false` means another save got there first.
 */
export async function relinkLotToCard(
  lotId: string,
  oldKey: string,
  newKey: string,
  actorId: string | null,
): Promise<{ ok: true; relinked: boolean } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase service role not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("inventory_lots")
    .update({
      pos_product_key: newKey,
      pos_product_key_source: "owner_entered",
      pos_product_key_set_by: actorId,
      pos_product_key_set_at: new Date().toISOString(),
      updated_by: actorId,
    })
    .eq("id", lotId)
    .eq("pos_product_key", oldKey)
    .neq("status", "destroyed")
    .neq("status", "rejected")
    .select("id");
  if (error) return { ok: false, error: error.message };
  return { ok: true, relinked: ((data as { id: string }[] | null) ?? []).length > 0 };
}
