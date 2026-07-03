/**
 * src/lib/ai/kb/seed-banned.ts
 *
 * Idempotent sync of the code-defined medical-claim blocklist
 * (MEDICAL_BANNED_PHRASES) into the owner-editable `kb_banned_phrases` table so
 * the DB-backed blocklist stays in step with the compliance code. Uses upsert
 * on the unique `phrase` column, so running it repeatedly is a no-op after the
 * first run. Safe to call from an admin action or a one-off.
 *
 * This never DELETES owner-added phrases — it only ensures the medical set is
 * present and marked block/active. Curated owner rows are untouched.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { MEDICAL_BANNED_PHRASES } from "@/lib/ai/compliance";

export type SeedBannedResult = { attempted: number; ok: boolean; error?: string };

/**
 * Ensure every medical-claim phrase exists in kb_banned_phrases (block/active).
 * Returns a small result object; never throws (a missing table just returns
 * ok:false so callers can surface a "apply migration 0071" hint).
 */
export async function seedMedicalBannedPhrases(actorId: string | null): Promise<SeedBannedResult> {
  if (!isSupabaseServiceConfigured) {
    return { attempted: 0, ok: false, error: "Supabase not configured." };
  }
  const admin = createSupabaseAdminClient();
  const rows = MEDICAL_BANNED_PHRASES.map((p) => ({
    phrase: p.phrase,
    severity: p.severity,
    reason: p.reason,
    active: true,
    created_by: actorId,
  }));

  // Upsert on the unique `phrase` column: missing rows inserted, existing rows
  // left intact (ignoreDuplicates) so owner edits to reason/severity survive.
  const { error } = await admin
    .from("kb_banned_phrases")
    .upsert(rows, { onConflict: "phrase", ignoreDuplicates: true });

  if (error) {
    return { attempted: rows.length, ok: false, error: error.message };
  }
  return { attempted: rows.length, ok: true };
}
