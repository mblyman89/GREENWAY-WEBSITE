/**
 * R32 (T-328) — the inventory table's onboarding join.
 *
 * One PAGED read of every APPROVED catalog draft that is linked to a lot
 * (catalog_product_drafts.lot_id), run in parallel with the lot walk. Paged
 * with pagedAllChecked because PostgREST clamps one response at 1,000 rows
 * WITHOUT an error (SLICE 5C); a stable order on the unique id keeps pages
 * from skipping or repeating rows.
 *
 * Never throws and never blocks the inventory page: a failed read returns an
 * empty index plus `complete: false`, and the page says the onboarding
 * columns are incomplete instead of showing blanks as if they were facts.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { indexApprovedDraftsByLot, type LotOnboardingDraft } from "@/lib/inventory/lot-onboarding-core";

export const LOT_ONBOARDING_SELECT =
  "id, lot_id, status, chosen_website_category, chosen_house_type, chosen_strain_type, chosen_classification_provenance, price_minor_units, suggested_price_minor_units, price_floor_minor_units, category, kb_product_id, updated_at";

export async function loadLotOnboardingIndex(): Promise<{
  byLot: Map<string, LotOnboardingDraft>;
  complete: boolean;
}> {
  if (!isSupabaseServiceConfigured) return { byLot: new Map(), complete: true };
  try {
    const admin = createSupabaseAdminClient();
    const read = await pagedAllChecked<LotOnboardingDraft>(async (from, to) => {
      const { data, error } = await admin
        .from("catalog_product_drafts")
        .select(LOT_ONBOARDING_SELECT)
        .eq("status", "approved")
        .not("lot_id", "is", null)
        .order("id", { ascending: true })
        .range(from, to);
      if (error) console.error("[lot-onboarding] approved-draft read failed:", error.message);
      return { rows: (data as LotOnboardingDraft[] | null) ?? [], ok: !error };
    });
    return { byLot: indexApprovedDraftsByLot(read.rows), complete: read.verdict.complete };
  } catch (err) {
    console.error("[lot-onboarding] approved-draft read threw:", err);
    return { byLot: new Map(), complete: false };
  }
}
