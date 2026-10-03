/**
 * src/lib/enrichment/kb-match-attach.ts - Round 23 (fix 10).
 *
 * The owner's screenshot: a 100%-match knowledge-base row ("EASY PEASY ...
 * Banana Cream Pie - 28g") sat under "Suggested matches" with every fact the
 * card was missing, and no way to use it ("how do we link the suggestions?").
 *
 * This is the server half of the "Use these facts" / "Link to this card"
 * button. One explicit human click:
 *
 *   1. reads the kb_products row SERVER-SIDE by id (never trusts form values);
 *   2. compliance-gates every term and every line of prose against the same
 *      gate the KB writer uses (checkEffects allow-list + checkCompliance with
 *      the owner's banned phrases) - refused values are never written;
 *   3. records the sensory/effects facts the SAME way an accepted AI
 *      suggestion is recorded on this page (an accepted "sensory" JSON row
 *      and an accepted "effects" list, source "kb:<id>", reviewed by the
 *      human), unioned with what the card already accepted - so the menu,
 *      writeBackOnPublish and the gap vector all see them with no new path;
 *   4. fills an EMPTY description / short description (never overwrites);
 *   5. links the card to the row (product_enrichments.kb_product_id, 0234)
 *      so the row keeps filling this card's gaps; a database without 0234
 *      still gets the facts (the link is reported as skipped, honestly).
 *
 * Never throws for data reasons: every outcome is a result value the action
 * turns into a plain-English banner.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { checkCompliance, checkEffects } from "@/lib/ai/compliance";
import { loadBannedPhrases } from "@/lib/ai/kb/retrieval";
import { persistSuggestion, reviewSuggestion } from "@/lib/ai/suggestions";
import { ensureEnrichment, updateEnrichment, getEnrichment } from "@/lib/enrichment/store";
import { isMissingIdentityColumnError } from "@/lib/catalog/identity-columns-core";
import { isUuid } from "@/lib/catalog/draft-deep-link-core";
import {
  joinFields,
  planKbFactsAttach,
  sensoryFromAcceptedSuggestions,
  type KbFactsPlan,
} from "@/lib/enrichment/sensory-fill-core";

export const KB_MATCH_AUDIT_ACTION = "product.kb_match_facts_attached";

export type KbLinkOutcome = "linked" | "already" | "skipped-pre-0234" | "failed";

export type KbMatchAttachResult =
  | {
      ok: true;
      kbId: string;
      kbName: string;
      plan: KbFactsPlan;
      linked: KbLinkOutcome;
      message: string;
    }
  | { ok: false; error: string };

type KbRow = {
  id: string;
  display_name: string | null;
  aroma_notes: string[] | null;
  flavor_notes: string[] | null;
  terpenes: string[] | null;
  effects: string[] | null;
  description: string | null;
  short_description: string | null;
};

/** The sentence the page shows after the click (pure, exported for tests). */
export function kbMatchMessage(name: string, plan: KbFactsPlan, linked: KbLinkOutcome): string {
  const parts: string[] = [];
  parts.push(plan.adds.length > 0 ? `Added ${joinFields(plan.adds)} from \u201c${name}\u201d.` : `\u201c${name}\u201d had nothing new for this card.`);
  if (linked === "linked") parts.push("The card is now linked to it, so it keeps filling this card's gaps.");
  if (linked === "already") parts.push("The card was already linked to it.");
  if (linked === "skipped-pre-0234") parts.push("The permanent link needs database update 0234, so only the facts were saved.");
  if (linked === "failed") parts.push("The permanent link could not be saved just now; the facts were saved.");
  if (plan.refused.length > 0) parts.push(`Left out by the compliance check: ${joinFields(plan.refused)}.`);
  return parts.join(" ");
}

export async function attachKbMatchFacts(input: {
  posKey: string;
  kbId: string;
  actor: { userId: string | null };
}): Promise<KbMatchAttachResult> {
  const key = input.posKey.trim();
  const kbId = input.kbId.trim().toLowerCase();
  if (!key) return { ok: false, error: "Missing product key." };
  if (!isUuid(kbId)) return { ok: false, error: "That knowledge-base match is not valid." };
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database is not configured." };
  const admin = createSupabaseAdminClient();

  // 1. The KB row, server-side.
  const { data: kbData, error: kbErr } = await admin
    .from("kb_products")
    .select("id, display_name, aroma_notes, flavor_notes, terpenes, effects, description, short_description")
    .eq("id", kbId)
    .maybeSingle();
  if (kbErr) return { ok: false, error: "The knowledge base could not be read just now. Nothing was changed." };
  if (!kbData) return { ok: false, error: "That knowledge-base product no longer exists. Nothing was changed." };
  const kb = kbData as KbRow;
  const kbName = (kb.display_name ?? "").trim() || "the knowledge-base product";

  // 2. The card: its enrichment row + what it already accepted.
  await ensureEnrichment(key, {}, input.actor.userId);
  const enrichment = await getEnrichment(key);
  const { data: accData, error: accErr } = await admin
    .from("ai_suggestions")
    .select("field_key, suggested_value, created_at")
    .eq("entity_type", "product")
    .eq("entity_id", key)
    .eq("status", "accepted")
    .in("field_key", ["sensory", "effects"])
    .order("created_at", { ascending: false })
    .limit(50);
  // A failed read would make the union drop older accepted facts: refuse.
  if (accErr) return { ok: false, error: "This card's accepted facts could not be read just now. Nothing was changed." };
  const accepted = sensoryFromAcceptedSuggestions((accData as { field_key: string; suggested_value: string }[] | null) ?? []);

  // 3. Compliance + plan (pure).
  const banned = await loadBannedPhrases().catch(() => []);
  const effectCheck = checkEffects(kb.effects ?? [], banned);
  const plan = planKbFactsAttach({
    card: { description: enrichment?.description ?? null, shortDescription: enrichment?.short_description ?? null, accepted },
    shown: {
      effects: accepted.effects as string[],
      terpenes: accepted.terpenes as string[],
      aromaNotes: accepted.aromaNotes as string[],
      flavorNotes: accepted.flavorNotes as string[],
    },
    kb: {
      aromaNotes: kb.aroma_notes,
      flavorNotes: kb.flavor_notes,
      terpenes: kb.terpenes,
      description: kb.description,
      shortDescription: kb.short_description,
    },
    allowedEffects: effectCheck.allowed,
    termOk: (t) => checkCompliance(t, banned).blockingFlags.length === 0,
    proseOk: (t) => checkCompliance(t, banned).blockingFlags.length === 0,
  });
  for (const r of effectCheck.rejected) plan.refused.push(r.effect);

  // 4. Writes: accepted suggestions (the page's own fact path), then prose.
  const source = `kb:${kb.id}`;
  const summary = `Attached by a person from knowledge-base product \u201c${kbName}\u201d.`;
  const record = async (field_key: "sensory" | "effects", value: string) => {
    const row = await persistSuggestion({
      entity_type: "product",
      entity_id: key,
      field_key,
      suggested_value: value,
      input_summary: summary,
      generated_by: input.actor.userId,
      confidence: null,
      source,
    });
    await reviewSuggestion(row.id, "accepted", input.actor.userId);
  };
  try {
    if (plan.sensoryJson) await record("sensory", plan.sensoryJson);
    if (plan.effectsCsv) await record("effects", plan.effectsCsv);
    const prose: { description?: string; short_description?: string } = {};
    if (plan.description) prose.description = plan.description;
    if (plan.shortDescription) prose.short_description = plan.shortDescription;
    if (Object.keys(prose).length > 0) await updateEnrichment(key, prose, input.actor.userId);
  } catch (err) {
    return { ok: false, error: `The facts could not be saved: ${String(err instanceof Error ? err.message : err).slice(0, 160)}` };
  }

  // 5. The link (0234). Never blocks the facts.
  let linked: KbLinkOutcome = "linked";
  if (enrichment && "kb_product_id" in enrichment && enrichment.kb_product_id === kb.id) {
    linked = "already";
  } else {
    const { error } = await admin
      .from("product_enrichments")
      .update({ kb_product_id: kb.id, updated_by: input.actor.userId })
      .eq("pos_product_key", key);
    if (error) linked = isMissingIdentityColumnError("product_enrichments", error) ? "skipped-pre-0234" : "failed";
  }

  return { ok: true, kbId: kb.id, kbName, plan, linked, message: kbMatchMessage(kbName, plan, linked) };
}
