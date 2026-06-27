/**
 * src/lib/ai/suggestions.ts
 *
 * Server-side service for generating AI DRAFT suggestions, persisting them with
 * provenance in `ai_suggestions`, and the accept/reject lifecycle. Every
 * suggestion is staff-validated before it touches a published entity.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { generate, isAiConfigured, aiModelId } from "./provider";
import { COMPLIANCE_SYSTEM, PROMPT_VERSION, checkCompliance } from "./compliance";
import type { AiSuggestion, AiSuggestionStatus } from "@/lib/enrichment/types";

export { isAiConfigured };

export type ProductFacts = {
  name: string;
  brand?: string | null;
  vendor?: string | null;
  category?: string | null;
  strainType?: string | null;
  strainName?: string | null;
  thc?: string | null;
  cbd?: string | null;
};

/** Build a compliant product-description prompt from POS facts (no PII). */
function productDescriptionPrompt(facts: ProductFacts): { system: string; user: string; inputSummary: string } {
  const lines = [
    `Product: ${facts.name}`,
    facts.brand ? `Brand: ${facts.brand}` : null,
    facts.category ? `Category: ${facts.category}` : null,
    facts.strainType && facts.strainType !== "unknown" ? `Strain type: ${facts.strainType}` : null,
    facts.strainName ? `Strain: ${facts.strainName}` : null,
    facts.thc ? `THC: ${facts.thc}` : null,
    facts.cbd ? `CBD: ${facts.cbd}` : null,
  ].filter(Boolean);

  const user = `Write a 2-3 sentence product description (about 35-60 words) for the following cannabis product, following all rules. Describe format, aroma/flavor, and strain character where relevant. Do not mention price or stock.\n\n${lines.join("\n")}`;
  return { system: COMPLIANCE_SYSTEM, user, inputSummary: lines.join(" · ") };
}

/** Build a tag-suggestion prompt; returns a comma list of allowed tags. */
function productTagsPrompt(facts: ProductFacts): { system: string; user: string; inputSummary: string } {
  const allowed = "new-arrival, best-seller, staff-pick, local, high-cbd, high-thc, value, limited";
  const lines = [
    `Product: ${facts.name}`,
    facts.category ? `Category: ${facts.category}` : null,
    facts.thc ? `THC: ${facts.thc}` : null,
    facts.cbd ? `CBD: ${facts.cbd}` : null,
  ].filter(Boolean);
  const user = `From this allowed list ONLY: [${allowed}], choose 0-3 tags that genuinely fit the product below. Reply with a comma-separated list of tag ids and nothing else. If none fit, reply with an empty line.\n\n${lines.join("\n")}`;
  return { system: COMPLIANCE_SYSTEM, user, inputSummary: lines.join(" · ") };
}

export type GeneratedSuggestion = {
  suggestion: AiSuggestion;
  complianceFlags: string[];
};

/**
 * Generate a product DESCRIPTION draft, run compliance scan, persist as a
 * pending suggestion, and return it with any compliance flags for the reviewer.
 */
export async function generateProductDescription(
  posProductKey: string,
  facts: ProductFacts,
  generatedBy: string | null,
): Promise<GeneratedSuggestion> {
  const { system, user, inputSummary } = productDescriptionPrompt(facts);
  const text = await generate({ system, user, temperature: 0.7, maxTokens: 200 });
  const compliance = checkCompliance(text);
  const suggestion = await persistSuggestion({
    entity_type: "product",
    entity_id: posProductKey,
    field_key: "description",
    suggested_value: text,
    input_summary: inputSummary,
    generated_by: generatedBy,
  });
  return { suggestion, complianceFlags: compliance.flags };
}

/** Generate a product TAGS draft (comma list of allowed tag ids). */
export async function generateProductTags(
  posProductKey: string,
  facts: ProductFacts,
  generatedBy: string | null,
): Promise<GeneratedSuggestion> {
  const { system, user, inputSummary } = productTagsPrompt(facts);
  const text = await generate({ system, user, temperature: 0.3, maxTokens: 40 });
  const cleaned = text
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .join(", ");
  const suggestion = await persistSuggestion({
    entity_type: "product",
    entity_id: posProductKey,
    field_key: "tags",
    suggested_value: cleaned,
    input_summary: inputSummary,
    generated_by: generatedBy,
  });
  return { suggestion, complianceFlags: [] };
}

type PersistInput = {
  entity_type: string;
  entity_id: string;
  field_key: string;
  suggested_value: string;
  input_summary: string;
  generated_by: string | null;
};

async function persistSuggestion(input: PersistInput): Promise<AiSuggestion> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("ai_suggestions")
    .insert({
      entity_type: input.entity_type,
      entity_id: input.entity_id,
      field_key: input.field_key,
      suggested_value: input.suggested_value,
      status: "pending",
      model: aiModelId,
      prompt_version: PROMPT_VERSION,
      input_summary: input.input_summary,
      generated_by: input.generated_by,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`ai_suggestions insert failed: ${error?.message}`);
  return data as AiSuggestion;
}

/** List pending (or any status) suggestions for an entity. */
export async function listSuggestions(
  entityType: string,
  entityId: string,
  status?: AiSuggestionStatus,
): Promise<AiSuggestion[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  let q = admin
    .from("ai_suggestions")
    .select("*")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data } = await q;
  return (data as AiSuggestion[] | null) ?? [];
}

/** Count pending suggestions (for dashboards/badges). */
export async function countPendingSuggestions(): Promise<number> {
  if (!isSupabaseServiceConfigured) return 0;
  const admin = createSupabaseAdminClient();
  const { count } = await admin
    .from("ai_suggestions")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return count ?? 0;
}

/** Mark a suggestion accepted/rejected/edited (the caller applies the value). */
export async function reviewSuggestion(
  id: string,
  status: AiSuggestionStatus,
  reviewedBy: string | null,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("ai_suggestions")
    .update({ status, reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function getSuggestion(id: string): Promise<AiSuggestion | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("ai_suggestions").select("*").eq("id", id).maybeSingle();
  return (data as AiSuggestion | null) ?? null;
}
