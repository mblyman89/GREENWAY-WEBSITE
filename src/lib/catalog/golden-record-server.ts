/**
 * src/lib/catalog/golden-record-server.ts  (SLICE S12, server half)
 *
 * Gathers the per-draft golden-record inputs both menu producers need
 * (draft-injection.ts for a POS import, intake-menu-staging.ts for an
 * approval / receiving re-stage):
 *
 *   1. ONE bounded, named-column read of catalog_product_drafts.attached_facts
 *      for exactly the approved drafts being planned (chunked + paged, never
 *      select *). A database without migration 0235, or any failed read,
 *      returns an empty map: the planner then writes the placeholder exactly
 *      as before S12 (fail closed toward "no change", never a guess).
 *   2. The compliance gate on prose: the attached description goes through
 *      lintCopy() with the owner's kb_banned_phrases layered on (the same
 *      gate writeBackProductFacts uses). A blocked text never reaches the
 *      planner; a warn-only text is allowed (the owner's warn-only rule for
 *      borderline copy, compliance.ts lintCopy).
 *   3. The strain type pick (canonical, counted sources only).
 *   4. R35 #6 (migration 0254): the counted attached EFFECTS and AROMA, each
 *      through its own gate before the planner sees it - effects through
 *      checkEffects() (the experiential allow-list + medical-claim filter +
 *      kb_banned_phrases: the gate the KB writer and the AI lookup use) and
 *      aroma through lintTerms() (+ kb_banned_phrases: the gate the product
 *      page uses). A list with nothing left is null, never [].
 *
 * GOLDEN_RECORD_ON_APPROVE=off: no read, no lint, empty map (bible S12.7).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { chunkedIn } from "@/lib/supabase/chunked-in";
import { checkEffects, lintCopy, lintTerms } from "@/lib/ai/compliance";
import { loadBannedPhrases } from "@/lib/ai/kb/retrieval";
import { isMissingAttachedFactsError } from "@/lib/catalog/attach-facts-core";
import {
  GOLDEN_FACTS_COLUMN,
  GOLDEN_RECORD_ENV,
  goldenRecordEnabled,
  pickAttachedDescription,
  pickAttachedSensory,
  pickAttachedStrainType,
  type PickedDescription,
  type PickedSensory,
  type PickedStrainType,
} from "@/lib/catalog/golden-record-core";
import { sensoryForStorage } from "@/lib/pos/menu-sensory-core";

export interface GoldenInputs {
  goldenDescription: PickedDescription | null;
  attachedStrainType: PickedStrainType | null;
  /** R35 #6: counted effects, cleared by checkEffects (allowed only). */
  goldenEffects: PickedSensory | null;
  /** R35 #6: counted aroma, cleared by lintTerms (safe only). */
  goldenAroma: PickedSensory | null;
}

type Banned = Awaited<ReturnType<typeof loadBannedPhrases>>;

/**
 * The server gate for the two lists (exported for the R35 tests). Never
 * widens a list: only values the gate returns survive, in storage form.
 */
export function gateGoldenSensory(
  effects: PickedSensory | null,
  aroma: PickedSensory | null,
  banned: Banned,
): { goldenEffects: PickedSensory | null; goldenAroma: PickedSensory | null } {
  let goldenEffects: PickedSensory | null = null;
  if (effects) {
    const v = sensoryForStorage(checkEffects(effects.values, banned).allowed);
    if (v) goldenEffects = { ...effects, values: v };
  }
  let goldenAroma: PickedSensory | null = null;
  if (aroma) {
    const v = sensoryForStorage(lintTerms(aroma.values, banned).safe);
    if (v) goldenAroma = { ...aroma, values: v };
  }
  return { goldenEffects, goldenAroma };
}

/** True unless GOLDEN_RECORD_ON_APPROVE is an off-word. */
export function goldenRecordOn(): boolean {
  return goldenRecordEnabled(process.env[GOLDEN_RECORD_ENV]);
}

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * draftId -> golden inputs. Only drafts with at least one usable value are in
 * the map. Never throws.
 */
export async function loadGoldenInputs(admin: Admin, draftIds: readonly string[]): Promise<Map<string, GoldenInputs>> {
  const out = new Map<string, GoldenInputs>();
  if (!goldenRecordOn() || draftIds.length === 0) return out;
  let rows: { id: string; attached_facts: unknown }[] = [];
  try {
    rows = await chunkedIn<string, { id: string; attached_facts: unknown }>(draftIds, async (chunk, from, to) => {
      const { data, error } = await admin
        .from("catalog_product_drafts")
        .select(`id, ${GOLDEN_FACTS_COLUMN}`)
        .in("id", chunk)
        .order("id", { ascending: true })
        .range(from, to);
      if (error) throw error;
      return (data as unknown as { id: string; attached_facts: unknown }[] | null) ?? [];
    });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (!isMissingAttachedFactsError(e)) {
      console.error("[golden-record] attached facts read failed:", e?.message ?? String(err));
    }
    return out;
  }

  const picks = rows.map((r) => ({
    id: r.id,
    description: pickAttachedDescription(r.attached_facts),
    strain: pickAttachedStrainType(r.attached_facts),
    effects: pickAttachedSensory(r.attached_facts, "effects"),
    aroma: pickAttachedSensory(r.attached_facts, "aroma"),
  }));
  const needsLint = picks.some((p) => p.description !== null || p.effects !== null || p.aroma !== null);
  let banned: Banned = [];
  if (needsLint) {
    try {
      banned = await loadBannedPhrases();
    } catch {
      banned = [];
    }
  }
  for (const p of picks) {
    let goldenDescription: PickedDescription | null = null;
    if (p.description) {
      const lint = lintCopy(p.description.text, banned);
      if (lint.disposition !== "block" && lint.publicText) {
        goldenDescription = { ...p.description, text: lint.publicText };
      }
    }
    const { goldenEffects, goldenAroma } = gateGoldenSensory(p.effects, p.aroma, banned);
    if (goldenDescription || p.strain || goldenEffects || goldenAroma) {
      out.set(p.id, { goldenDescription, attachedStrainType: p.strain, goldenEffects, goldenAroma });
    }
  }
  return out;
}
