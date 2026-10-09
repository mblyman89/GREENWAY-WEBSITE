/**
 * src/lib/inventory/coa-panel-server.ts
 *
 * R28 - the reads behind the "Lab certificate" and "Product facts" panels on
 * the lot page (/admin/inventory/[id]) and the KB product page
 * (/admin/knowledge-base/products/[id]). Both pages show the SAME panels from
 * the SAME records:
 *
 *   lab_results.coa_extract_json   the stored certificate read (0252)
 *   inventory_lots fact columns    the golden record the register and the
 *                                  website read (with fact_provenance)
 *   pos_fact_reviews (owner row)   the facts a person set, edited through the
 *                                  same resolveIntakeFactReview action as
 *                                  Product Onboarding (one save path)
 *
 * Never throws: every failure comes back as a flag the panel turns into
 * words ("could not be read - reload before editing"), never as "nothing".
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { isMissingIdentityColumnError } from "@/lib/catalog/identity-columns-core";
import { loadSavedProductFacts, savedFactsMapKey } from "@/lib/pos/intake-fact-review-server";
import type { SavedProductFacts } from "@/lib/pos/intake-fact-review-core";
import { pickLotDraft, type LotDraftRow } from "@/lib/inventory/coa-panel-core";

export type LotFactsContext = {
  /** The draft the facts save goes through (null = cannot save, see reason). */
  draft: LotDraftRow | null;
  saved: SavedProductFacts | null;
  /** False when the drafts or the saved facts could not be read. */
  readOk: boolean;
  /** False when the saved-facts table is not there yet (0237). */
  migrated: boolean;
  /** Why the facts cannot be edited here (shown as-is), else null. */
  reason: string | null;
};

/** The Product Onboarding draft for a lot, and the facts saved on it. */
export async function loadLotFactsContext(lotId: string): Promise<LotFactsContext> {
  const none = (reason: string, readOk = true): LotFactsContext => ({ draft: null, saved: null, readOk, migrated: true, reason });
  if (!isSupabaseServiceConfigured) return none("The database is not configured.", false);
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("catalog_product_drafts")
      .select("id, manifest_id, pos_product_key, status, updated_at, name, inventory_type, chosen_website_category")
      .eq("lot_id", lotId)
      .limit(50);
    if (error) {
      console.error("[coa-panel] drafts read failed:", error.message);
      return none("The product's onboarding record could not be read. Reload the page.", false);
    }
    const draft = pickLotDraft((data as LotDraftRow[] | null) ?? []);
    if (!draft || !draft.manifest_id || !draft.pos_product_key) {
      return none(
        "This lot has no Product Onboarding record from a delivery (for example it came from the one-time Cultivera import), so its facts cannot be set from here. Correct them on the delivery that brought it in.",
      );
    }
    const load = await loadSavedProductFacts([{ manifest_id: draft.manifest_id }]);
    return {
      draft,
      saved: load.saved.get(savedFactsMapKey(draft.manifest_id, draft.pos_product_key)) ?? null,
      readOk: load.ok,
      migrated: load.migrated,
      reason: null,
    };
  } catch (err) {
    console.error("[coa-panel] loadLotFactsContext failed:", err);
    return none("The product's onboarding record could not be read. Reload the page.", false);
  }
}

export type KbProductDetail = {
  id: string;
  display_name: string;
  brand_slug: string;
  category: string | null;
  pos_product_key: string | null;
  status: string | null;
  terpenes: string[];
  cannabinoids: string[];
  total_thc_pct: number | null;
  total_cbd_pct: number | null;
  potency_source: string | null;
  description: string | null;
  short_description: string | null;
  updated_at: string | null;
};

export type KbProductLot = {
  id: string;
  lot_code: string | null;
  product_name: string | null;
  inventory_type: string | null;
  on_hand_qty: number | null;
  unit: string | null;
  status: string | null;
  created_at: string | null;
  lab_result_id: string | null;
};

export type KbProductPageData =
  | { ok: true; product: KbProductDetail; lots: KbProductLot[]; lotsOk: boolean }
  | { ok: false; notFound: boolean; error: string };

export const KB_PRODUCT_LOTS_MAX = 25;

/**
 * One KB product and its lots (newest first). Lots are found by the R25
 * link (inventory_lots.kb_product_id), else - for older lots that were never
 * linked - by the product's POS key. Nothing is matched by name.
 */
export async function loadKbProductPage(id: string): Promise<KbProductPageData> {
  if (!isSupabaseServiceConfigured) return { ok: false, notFound: false, error: "The database is not configured." };
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_products")
      .select(
        "id, display_name, brand_slug, category, pos_product_key, status, terpenes, cannabinoids, total_thc_pct, total_cbd_pct, potency_source, description, short_description, updated_at",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) return { ok: false, notFound: false, error: error.message };
    if (!data) return { ok: false, notFound: true, error: "not found" };
    const product = data as KbProductDetail;
    product.terpenes = Array.isArray(product.terpenes) ? product.terpenes : [];
    product.cannabinoids = Array.isArray(product.cannabinoids) ? product.cannabinoids : [];

    const LOT_COLS = "id, lot_code, product_name, inventory_type, on_hand_qty, unit, status, created_at, lab_result_id";
    let lotsOk = true;
    const byId = new Map<string, KbProductLot>();
    const linked = await admin
      .from("inventory_lots")
      .select(LOT_COLS)
      .eq("kb_product_id", id)
      .order("created_at", { ascending: false })
      .limit(KB_PRODUCT_LOTS_MAX);
    // inventory_lots.kb_product_id arrives with 0234; before it the link
    // simply is not there (the lot key below still finds the lots).
    if (linked.error && !isMissingIdentityColumnError("inventory_lots", linked.error)) lotsOk = false;
    for (const l of (linked.data as KbProductLot[] | null) ?? []) byId.set(l.id, l);
    if (product.pos_product_key && byId.size < KB_PRODUCT_LOTS_MAX) {
      const keyed = await admin
        .from("inventory_lots")
        .select(LOT_COLS)
        .eq("pos_product_key", product.pos_product_key)
        .order("created_at", { ascending: false })
        .limit(KB_PRODUCT_LOTS_MAX);
      if (keyed.error) lotsOk = false;
      for (const l of (keyed.data as KbProductLot[] | null) ?? []) if (!byId.has(l.id)) byId.set(l.id, l);
    }
    const lots = Array.from(byId.values())
      .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
      .slice(0, KB_PRODUCT_LOTS_MAX);
    return { ok: true, product, lots, lotsOk };
  } catch (err) {
    return { ok: false, notFound: false, error: err instanceof Error ? err.message : String(err) };
  }
}
