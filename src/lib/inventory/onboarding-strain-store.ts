/**
 * src/lib/inventory/onboarding-strain-store.ts  (R74 S53)
 *
 * Owner (Round 34): "I want the attach all facts buttons ... to be in
 * onboarding, and I want it to actually attach strain types too if it finds
 * them."
 *
 * The ONE write behind that: set catalog_product_drafts.chosen_strain_type on
 * a product that is still in Needs review and has NO strain pick yet, and
 * stamp chosen_classification_provenance.strainType = "human" (the person
 * pressed the attach button - the same word the Approve card writes for a
 * pick made on the card). Approval later keeps chosen_strain_type exactly
 * like a pick (catalog-drafts approveDraftWithPrice), and the menu reads it
 * first (draft-injection). Never approves; never overwrites a pick (the
 * update is guarded on chosen_strain_type IS NULL in the database itself).
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/catalog/draft-deep-link-core";
import { validateStrainTypeChoice } from "@/lib/inventory/strain-type-intel-core";
import { ONBOARDING_PICK_PROVENANCE, ONBOARDING_PROVENANCE_KEYS } from "@/lib/inventory/onboarding-recall-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type StrainSetResult = { ok: true; set: boolean } | { ok: false; error: string };

export async function setDraftStrainIfEmpty(
  admin: Admin,
  draftId: string,
  strain: string,
  actor: { userId: string | null },
): Promise<StrainSetResult> {
  if (!isUuid(draftId)) return { ok: false, error: "That product link is not valid." };
  const v = validateStrainTypeChoice(strain);
  if (!v.ok) return { ok: false, error: v.error };
  if (v.value === null) return { ok: true, set: false };
  const { data: row, error: readErr } = await admin
    .from("catalog_product_drafts")
    .select("id, status, chosen_strain_type, chosen_classification_provenance")
    .eq("id", draftId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message.slice(0, 160) };
  const r = row as { status: string; chosen_strain_type: string | null; chosen_classification_provenance: unknown } | null;
  if (!r || r.status !== "draft") return { ok: true, set: false };
  if (r.chosen_strain_type && r.chosen_strain_type !== "unknown") return { ok: true, set: false };
  const prov = r.chosen_classification_provenance && typeof r.chosen_classification_provenance === "object" && !Array.isArray(r.chosen_classification_provenance)
    ? (r.chosen_classification_provenance as Record<string, string>)
    : {};
  const { data: upd, error } = await admin
    .from("catalog_product_drafts")
    .update({
      chosen_strain_type: v.value,
      chosen_classification_provenance: { ...prov, [ONBOARDING_PROVENANCE_KEYS.strainType]: ONBOARDING_PICK_PROVENANCE.human },
      updated_by: actor.userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", draftId)
    .eq("status", "draft")
    .or("chosen_strain_type.is.null,chosen_strain_type.eq.unknown")
    .select("id");
  if (error) return { ok: false, error: error.message.slice(0, 160) };
  return { ok: true, set: ((upd as unknown[] | null) ?? []).length > 0 };
}
