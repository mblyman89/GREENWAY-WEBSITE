/**
 * D239 N-9 (SOP-22 G-119; Q-22-2 (a)): the Curated reviews list, kept in
 * site_settings under `curated_reviews` (no migration).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { CURATED_REVIEWS_KEY, normalizeReviews, usableChoices, type CuratedReview, type CuratedReviewChoice } from "./curated-reviews-core";

export async function loadCuratedReviews(): Promise<CuratedReview[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("site_settings").select("value_json").eq("key", CURATED_REVIEWS_KEY).maybeSingle();
    return normalizeReviews((data as { value_json: unknown } | null)?.value_json ?? null);
  } catch {
    return [];
  }
}

/** Only the reviews with the permission tick, a first name and no health wording. */
export async function usableCuratedReviews(): Promise<CuratedReviewChoice[]> {
  return usableChoices(await loadCuratedReviews());
}

export async function saveCuratedReviews(list: CuratedReview[], updatedBy: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("site_settings").upsert(
      {
        key: CURATED_REVIEWS_KEY,
        label: "Curated reviews (D239 N-9)",
        value_json: { reviews: normalizeReviews(list) } as unknown as Record<string, unknown>,
        updated_by: updatedBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}
