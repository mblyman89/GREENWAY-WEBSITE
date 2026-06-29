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
import { generateStructured, isAiConfigured, aiModelId } from "./provider";
import { COMPLIANCE_SYSTEM, PROMPT_VERSION, checkCompliance } from "./compliance";
import {
  productDescriptionSchema,
  productTagsSchema,
  productSensorySchema,
  ALLOWED_PRODUCT_TAGS,
} from "./schemas/product";
import { buildGroundedFacts, loadBannedPhrases } from "./kb/retrieval";
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

/** Build the fact lines + a short PII-free summary from POS facts. */
function factLines(facts: ProductFacts): { lines: string[]; summary: string } {
  const lines = [
    `Product: ${facts.name}`,
    facts.brand ? `Brand: ${facts.brand}` : null,
    facts.vendor ? `Vendor: ${facts.vendor}` : null,
    facts.category ? `Category: ${facts.category}` : null,
    facts.strainType && facts.strainType !== "unknown" ? `Strain type: ${facts.strainType}` : null,
    facts.strainName ? `Strain: ${facts.strainName}` : null,
    facts.thc ? `THC: ${facts.thc}` : null,
    facts.cbd ? `CBD: ${facts.cbd}` : null,
  ].filter(Boolean) as string[];
  return { lines, summary: lines.join(" · ") };
}

export type GeneratedSuggestion = {
  suggestion: AiSuggestion;
  complianceFlags: string[];
  /** Only the must-fix flags (a non-empty list blocks acceptance un-edited). */
  blockingFlags: string[];
  /** 0..1 grounding confidence reported by the model. */
  confidence: number;
};

/**
 * Generate a product DESCRIPTION draft using STRUCTURED output (validated),
 * run the compliance scan, persist as a pending suggestion with confidence +
 * source, and return it with flags for the reviewer.
 *
 * Uses the "heavy" tier so SPRINT mode fills gaps with quality copy; in
 * maintenance mode the router automatically downshifts to the light model.
 */
export async function generateProductDescription(
  posProductKey: string,
  facts: ProductFacts,
  generatedBy: string | null,
): Promise<GeneratedSuggestion> {
  const { lines, summary } = factLines(facts);
  // Pull curated, grounded facts (strain family, terpenes, category vocab,
  // brand notes) so the model can write expert copy even from a thin POS row.
  const grounded = await buildGroundedFacts(facts);
  const banned = await loadBannedPhrases();

  const factBlock = [
    `POS FACTS:\n${lines.map((l) => `- ${l}`).join("\n")}`,
    grounded.block,
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await generateStructured({
    system: COMPLIANCE_SYSTEM,
    user: `Write a product description for this cannabis product using ONLY the facts below. Describe aroma, flavor, format, and strain character where the facts support it. If facts are thin, keep it short and generic and set confidence low.\n\n${factBlock}`,
    schema: productDescriptionSchema,
    tier: "heavy",
    maxTokens: 320,
    context: { feature: "product.description", entityType: "product", entityId: posProductKey, actorId: generatedBy },
  });

  const compliance = checkCompliance(`${result.description} ${result.short_description}`, banned);
  // Provenance: 'kb' when we grounded against curated facts, else 'model'.
  const source = grounded.sources.length ? `kb:${grounded.sources.length}` : "model";
  const suggestion = await persistSuggestion({
    entity_type: "product",
    entity_id: posProductKey,
    field_key: "description",
    // Store the long description as the primary value; keep the short one + meta in input_summary.
    suggested_value: result.description,
    input_summary: `${summary} | short: ${result.short_description}${grounded.sources.length ? ` | grounded: ${grounded.sources.join(", ")}` : ""}`,
    generated_by: generatedBy,
    confidence: result.confidence,
    source,
  });
  return {
    suggestion,
    complianceFlags: compliance.flags,
    blockingFlags: compliance.blockingFlags,
    confidence: result.confidence,
  };
}

/**
 * Generate SENSORY metadata (aroma notes, flavor notes, dominant terpenes) as a
 * structured, validated draft grounded in the KB. This is the richest gap-fill:
 * it turns a bare strain name into the aroma/flavor/terpene data the POS never
 * had. Stored as a single suggestion with field_key 'sensory' holding compact
 * JSON the reviewer can accept into the enrichment record.
 */
export async function generateProductSensory(
  posProductKey: string,
  facts: ProductFacts,
  generatedBy: string | null,
): Promise<GeneratedSuggestion> {
  const { lines, summary } = factLines(facts);
  const grounded = await buildGroundedFacts(facts);
  const banned = await loadBannedPhrases();

  const factBlock = [
    `POS FACTS:\n${lines.map((l) => `- ${l}`).join("\n")}`,
    grounded.block,
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await generateStructured({
    system: COMPLIANCE_SYSTEM,
    user: `From ONLY the facts below, extract sensory metadata for this product: aroma notes, flavor notes, and dominant terpenes. Use the knowledge-base descriptors where provided. Include a terpene ONLY if the facts support it; otherwise leave terpenes empty. Sensory language only — never effects or medical claims. Set confidence low if the facts are thin.\n\n${factBlock}`,
    schema: productSensorySchema,
    tier: "heavy",
    maxTokens: 200,
    context: { feature: "product.sensory", entityType: "product", entityId: posProductKey, actorId: generatedBy },
  });

  const compliance = checkCompliance(
    [...result.aroma_notes, ...result.flavor_notes, ...result.terpenes].join(" "),
    banned,
  );
  const value = JSON.stringify({
    aroma_notes: result.aroma_notes,
    flavor_notes: result.flavor_notes,
    terpenes: result.terpenes,
  });
  const source = grounded.sources.length ? `kb:${grounded.sources.length}` : "model";
  const suggestion = await persistSuggestion({
    entity_type: "product",
    entity_id: posProductKey,
    field_key: "sensory",
    suggested_value: value,
    input_summary: `${summary}${grounded.sources.length ? ` | grounded: ${grounded.sources.join(", ")}` : ""}`,
    generated_by: generatedBy,
    confidence: result.confidence,
    source,
  });
  return {
    suggestion,
    complianceFlags: compliance.flags,
    blockingFlags: compliance.blockingFlags,
    confidence: result.confidence,
  };
}

/** Generate a product TAGS draft (validated against the allowed list). */
export async function generateProductTags(
  posProductKey: string,
  facts: ProductFacts,
  generatedBy: string | null,
): Promise<GeneratedSuggestion> {
  const { lines, summary } = factLines(facts);
  const result = await generateStructured({
    system: COMPLIANCE_SYSTEM,
    user: `Choose 0-3 merchandising tags that genuinely fit this product, from the allowed list only: [${ALLOWED_PRODUCT_TAGS.join(", ")}]. If none fit, return an empty list.\n\n${lines.join("\n")}`,
    schema: productTagsSchema,
    tier: "light",
    maxTokens: 60,
    context: { feature: "product.tags", entityType: "product", entityId: posProductKey, actorId: generatedBy },
  });

  const cleaned = result.tags.join(", ");
  const suggestion = await persistSuggestion({
    entity_type: "product",
    entity_id: posProductKey,
    field_key: "tags",
    suggested_value: cleaned,
    input_summary: summary,
    generated_by: generatedBy,
    confidence: result.confidence,
    source: "model",
  });
  return { suggestion, complianceFlags: [], blockingFlags: [], confidence: result.confidence };
}

type PersistInput = {
  entity_type: string;
  entity_id: string;
  field_key: string;
  suggested_value: string;
  input_summary: string;
  generated_by: string | null;
  /** 0..1 grounding confidence (optional). */
  confidence?: number | null;
  /** Where the facts came from: model | kb | pos | crawl:<url> (optional). */
  source?: string | null;
};

/**
 * Persist an already-generated draft as a pending suggestion with provenance.
 * Exported so other AI helpers (vendors, etc.) can reuse the same lifecycle.
 *
 * confidence/source are written defensively: if those columns don't exist yet
 * (migration not applied), the insert is retried without them so the feature
 * still works. This keeps migrations owner-applied without breaking the app.
 */
export async function persistSuggestion(input: PersistInput): Promise<AiSuggestion> {
  const admin = createSupabaseAdminClient();
  const base = {
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    field_key: input.field_key,
    suggested_value: input.suggested_value,
    status: "pending" as const,
    model: aiModelId,
    prompt_version: PROMPT_VERSION,
    input_summary: input.input_summary,
    generated_by: input.generated_by,
  };
  const withMeta = {
    ...base,
    confidence: input.confidence ?? null,
    source: input.source ?? "model",
  };

  let res = await admin.from("ai_suggestions").insert(withMeta).select("*").single();
  if (res.error && /confidence|source|column/i.test(res.error.message)) {
    // Columns not migrated yet — fall back to the base shape.
    res = await admin.from("ai_suggestions").insert(base).select("*").single();
  }
  if (res.error || !res.data) throw new Error(`ai_suggestions insert failed: ${res.error?.message}`);
  return res.data as AiSuggestion;
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

/**
 * List pending suggestions for a whole entity type (e.g. all products), newest
 * first. Used by the bulk AI review grid so reviewers see every draft awaiting
 * approval in one place.
 */
export async function listPendingByType(
  entityType: string,
  limit = 200,
): Promise<AiSuggestion[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("ai_suggestions")
    .select("*")
    .eq("entity_type", entityType)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(limit);
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
