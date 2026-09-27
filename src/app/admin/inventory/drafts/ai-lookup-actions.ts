"use server";

/**
 * Server actions for the AI Product/Strain Lookup on Product Onboarding (T-314).
 *
 *  - productLookupAction:  runs the manual lookup (the AI_MODEL_HEAVY model +
 *    live web search: Gemini google_search grounding when the id starts with
 *    "gemini", else the OpenAI web_search tool; graceful fallback to built-in
 *    knowledge). Returns the sanitized, compliance-
 *    gated result. A plain "not found" is a NORMAL success (found:false), never
 *    an error. Autofill eligibility is decided by the pure core's >= 90% bar.
 *  - saveLookupToKbAction:  saves what the AI found as a kb_strains DRAFT
 *    (status='draft', source='enrichment') — a draft for the owner to approve so
 *    future lots auto-attach it. Compliance is re-checked server-side before the
 *    write; the client payload is NEVER trusted.
 *
 * Both require the inventory.manage permission and are audited.
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { loadBannedPhrases } from "@/lib/ai/kb/retrieval";
import { upsertKbStrain } from "@/lib/ai/kb/store";
import { persistSuggestion, listSuggestions } from "@/lib/ai/suggestions";
import {
  packImageCandidates,
  RESEARCH_IMAGES_FIELD,
} from "@/lib/enrichment/research-core";
import {
  lookupProduct,
  isAiConfigured,
} from "@/lib/inventory/product-lookup-ai";
import { AiLookupError } from "@/lib/ai/provider";
import {
  postProcessLookup,
  LOOKUP_HONEST_MISS,
  type RawProductLookup,
} from "@/lib/inventory/product-lookup-core";
import {
  fieldConfidenceForSave,
  suggestionConfidence,
  type LookupFacts,
  type LookupFieldConfidence,
} from "@/lib/inventory/lookup-facts-core";
import type { WebCitation } from "@/lib/ai/grounding-core";
import type { GreenwayStrainType } from "@/lib/leafly/types";
// S10: the per-field consequence bands, computed in the SHADOW ring (no writes).
import {
  attachPolicyMode,
  decideLookupFacts,
  policyAuditPayload,
  receiptSentence,
  type AttachDecision,
  type AttachPolicyMode,
  type AttachPolicyRing,
  type PolicyAuditPayload,
} from "@/lib/catalog/fact-attach-policy-core";
import { currentAttachPolicyRing } from "@/lib/catalog/fact-attach-policy-server";

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

/** The KB draft the client may ask to save (mirrors the sanitized result). */
export type LookupKbDraft = {
  name: string;
  strainType: GreenwayStrainType;
  strainTypeConfidence: number;
  summary: string;
  effects: string[];
  aromaNotes: string[];
  flavorNotes: string[];
  lineage: string;
  sources: string[];
  // T-315: all-inclusive fields that feed ENRICHMENT (drafts only, human-approved).
  /** The POS product key this draft attaches to on the enrichment page (or ""). */
  posProductKey: string;
  description: string;
  shortDescription: string;
  category: string;
  potencyRatio: string;
  size: string;
  imageCandidates: string[];
  /**
   * SLICE S06 (F-018): each staged field's OWN confidence (0-100), when the
   * v2 lookup gave one. Optional: absent -> the legacy rule, unchanged.
   */
  fieldConfidence?: LookupFieldConfidence;
};

export type ProductLookupActionResult =
  | {
      ok: true;
      found: boolean;
      /** 0..100 OVERALL confidence in the whole result (community-inclusive). */
      confidence: number;
      /** True when the model returned ANY usable content (surface for review). */
      hasAnyFindings: boolean;
      strainType: GreenwayStrainType;
      strainTypeConfidence: number;
      autofillStrainType: boolean;
      summary: string;
      effects: string[];
      /** Effects the model proposed that were dropped by the compliance gate. */
      rejectedEffects: { effect: string; reason: string }[];
      aromaNotes: string[];
      flavorNotes: string[];
      lineage: string;
      sources: string[];
      model: string;
      usedWebSearch: boolean;
      hasKbDraft: boolean;
      honestMiss: string;
      // T-315 all-inclusive fields (for the UI + the save payload).
      description: string;
      shortDescription: string;
      category: string;
      potencyRatio: string;
      size: string;
      imageCandidates: string[];
      hasEnrichmentDraft: boolean;
      /** SLICE S06: structured per-field facts (null on a v1-shaped reply). */
      facts: LookupFacts | null;
      /** SLICE S06: which shape the reply was parsed as. */
      schema: "v2" | "v1";
      /** SLICE S06: grounded url_citation detail. */
      citations: WebCitation[];
      /** SLICE S06: Google Search Suggestions HTML (display only, never stored). */
      searchSuggestions: string[];
      /** The draft payload the client can send back to saveLookupToKbAction. */
      draft: LookupKbDraft;
      /**
       * S10: what the fact-attach policy decided per field. Null when the ring
       * is 0 (off) or the reply was v1-shaped (no per-field confidence, so no
       * per-field decision is possible - never guessed).
       */
      policy: LookupPolicyView | null;
    }
  | { ok: false; error: string };

/** S10: the policy verdicts the panel shows (reasons only - no new writes). */
export type LookupPolicyView = {
  ring: AttachPolicyRing;
  mode: AttachPolicyMode;
  receipt: string;
  verdicts: { field: string; decision: AttachDecision; reason: string; chip: boolean }[];
};

export async function productLookupAction(
  formData: FormData,
): Promise<ProductLookupActionResult> {
  const session = await requirePermission("inventory.manage");

  if (!isAiConfigured) {
    return {
      ok: false,
      error:
        "AI isn't set up yet. Add an AI_API_KEY (or OPENAI_API_KEY) in your environment to enable the lookup. Onboarding works without it.",
    };
  }

  const draftId = str(formData, "draft_id");
  const query = str(formData, "query");
  const productName = str(formData, "product_name");
  const vendorOrBrand = str(formData, "vendor_or_brand");
  const posProductKey = str(formData, "pos_product_key");
  // S10 corroborators, already loaded by the drafts page (loadStrainTypeSignals),
  // so no extra query. They are client-supplied, so they are canonicalised in
  // the pure core (junk -> null) and used ONLY for the shadow decision. S07's
  // write door must re-read them server-side before anything is written.
  const kbStrainType = str(formData, "kb_strain_type") || null;
  const manifestStrainType = str(formData, "manifest_strain_type") || null;
  // The approve form's strain pick at search time: a PERSON's value (wins).
  const humanStrainType = str(formData, "human_strain_type") || null;
  if (!query) return { ok: false, error: "Type something to search for first." };

  try {
    const banned = await loadBannedPhrases();
    const outcome = await lookupProduct({
      query,
      productName,
      vendorOrBrand,
      extraBanned: banned,
      context: {
        entityType: "catalog_drafts",
        entityId: draftId || null,
        actorId: session.userId,
        actorEmail: session.email,
      },
    });

    const r = outcome.result;

    // S10 SHADOW RING: decide every field, write nothing, log counts only.
    const ring = currentAttachPolicyRing();
    let policy: LookupPolicyView | null = null;
    let policyAudit: PolicyAuditPayload | undefined;
    if (ring !== 0 && outcome.facts) {
      const verdicts = decideLookupFacts(outcome.facts, {
        human: humanStrainType ? { strain_type: humanStrainType } : {},
        kbStrainType,
        manifestStrainType,
      });
      const mode = attachPolicyMode(ring);
      policyAudit = policyAuditPayload(ring, verdicts);
      policy = {
        ring,
        mode,
        receipt: receiptSentence(verdicts, mode, { strain_type: outcome.facts.fields.strain_type.value }),
        verdicts: verdicts.map((v) => ({ field: v.field, decision: v.decision, reason: v.reason, chip: v.chip })),
      };
    }

    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "catalog_draft.ai_lookup",
      entityType: "catalog_drafts",
      entityId: draftId || null,
      after: {
        query,
        found: r.found,
        strainType: r.strainType,
        confidence: r.strainTypeConfidence,
        autofill: r.autofillStrainType,
        usedWebSearch: outcome.usedWebSearch,
        model: outcome.model,
        sources: outcome.sources.length,
        category: r.category || undefined,
        hasEnrichmentDraft: r.hasEnrichmentDraft,
        imageCandidates: r.imageCandidates.length,
        // S06: counts only (no values, no suggestion HTML -- never stored).
        schema: outcome.schema,
        bands: outcome.facts?.counts,
        // S10: decision counts + field -> decision (no values). Feeds the
        // drafts-footer shadow counters. Absent when the ring is 0.
        policy: policyAudit,
      },
    });

    return {
      ok: true,
      found: r.found,
      confidence: r.confidence,
      hasAnyFindings: r.hasAnyFindings,
      strainType: r.strainType,
      strainTypeConfidence: r.strainTypeConfidence,
      autofillStrainType: r.autofillStrainType,
      summary: r.summary,
      effects: r.effects,
      rejectedEffects: r.rejectedEffects,
      aromaNotes: r.aromaNotes,
      flavorNotes: r.flavorNotes,
      lineage: r.lineage,
      sources: outcome.sources,
      model: outcome.model,
      usedWebSearch: outcome.usedWebSearch,
      hasKbDraft: r.hasKbDraft,
      honestMiss: LOOKUP_HONEST_MISS,
      description: r.description,
      shortDescription: r.shortDescription,
      category: r.category,
      potencyRatio: r.potencyRatio,
      size: r.size,
      imageCandidates: r.imageCandidates,
      hasEnrichmentDraft: r.hasEnrichmentDraft,
      facts: outcome.facts,
      schema: outcome.schema,
      citations: outcome.citations,
      searchSuggestions: outcome.searchSuggestions,
      draft: {
        name: productName || query,
        strainType: r.strainType,
        strainTypeConfidence: r.strainTypeConfidence,
        summary: r.summary,
        effects: r.effects,
        aromaNotes: r.aromaNotes,
        flavorNotes: r.flavorNotes,
        lineage: r.lineage,
        sources: outcome.sources,
        posProductKey,
        description: r.description,
        shortDescription: r.shortDescription,
        category: r.category,
        potencyRatio: r.potencyRatio,
        size: r.size,
        imageCandidates: r.imageCandidates,
        fieldConfidence: fieldConfidenceForSave(outcome.facts),
      },
      policy,
    };
  } catch (err) {
    // Operator-actionable failures (took too long, out of AI credits, bad key)
    // carry a plain-English `friendly` message we show verbatim \u2014 no HTTP jargon.
    if (err instanceof AiLookupError) {
      return { ok: false, error: err.friendly };
    }
    return {
      ok: false,
      error: `The lookup couldn't complete: ${String(err).slice(0, 160)}`,
    };
  }
}

export type SaveLookupResult = { ok: true } | { ok: false; error: string };

/**
 * Save the AI's findings as a kb_strains DRAFT for owner approval. We re-run the
 * compliance gate server-side (never trust the client) before writing, and we
 * only ever write status='draft' so nothing auto-publishes.
 */
export async function saveLookupToKbAction(formData: FormData): Promise<SaveLookupResult> {
  const session = await requirePermission("inventory.manage");

  const draftId = str(formData, "draft_id");
  let payload: LookupKbDraft;
  try {
    payload = JSON.parse(str(formData, "payload")) as LookupKbDraft;
  } catch {
    return { ok: false, error: "Bad draft payload." };
  }

  const name = String(payload.name ?? "").trim();
  if (!name) return { ok: false, error: "Nothing to save — missing a product name." };

  // Re-sanitize server-side: the client is never trusted. Rebuild a raw shape
  // from the payload and run it back through the compliance gate. This covers
  // BOTH the strain fields and the T-315 all-inclusive fields.
  const banned = await loadBannedPhrases();
  const raw: RawProductLookup = {
    strain_type: payload.strainType,
    strain_type_confidence: (payload.strainTypeConfidence ?? 0) / 100,
    summary: payload.summary ?? "",
    effects: Array.isArray(payload.effects) ? payload.effects : [],
    aroma_notes: Array.isArray(payload.aromaNotes) ? payload.aromaNotes : [],
    flavor_notes: Array.isArray(payload.flavorNotes) ? payload.flavorNotes : [],
    lineage: String(payload.lineage ?? ""),
    found: true,
    description: String(payload.description ?? ""),
    short_description: String(payload.shortDescription ?? ""),
    category: String(payload.category ?? ""),
    potency_ratio: String(payload.potencyRatio ?? ""),
    size: String(payload.size ?? ""),
    image_candidates: Array.isArray(payload.imageCandidates) ? payload.imageCandidates : [],
  };
  const safe = postProcessLookup(raw, banned);

  const posKey = String(payload.posProductKey ?? "").trim();
  const isStrainWorthy =
    safe.strainType !== "unknown" ||
    safe.summary.length > 0 ||
    safe.effects.length > 0 ||
    safe.aromaNotes.length > 0 ||
    safe.flavorNotes.length > 0 ||
    safe.lineage.length > 0;
  const hasEnrichment = safe.hasEnrichmentDraft && posKey.length > 0;

  if (!isStrainWorthy && !hasEnrichment) {
    // Distinguish "nothing at all" from "have enrichment copy but no POS key".
    if (safe.hasEnrichmentDraft && !posKey) {
      return {
        ok: false,
        error:
          "Found details, but this draft has no POS product key yet, so I can't stage them for enrichment. Approve the onboarding draft first, then re-run the lookup.",
      };
    }
    return { ok: false, error: "Nothing worth saving to the KB for this one." };
  }

  const wrote: string[] = [];
  try {
    // 1) Strain KB draft (unchanged behavior) — only when strain-worthy.
    if (isStrainWorthy) {
      await upsertKbStrain(
        {
          name,
          strain_type: safe.strainType,
          summary: safe.summary || null,
          aroma_notes: safe.aromaNotes,
          flavor_notes: safe.flavorNotes,
          lineage: safe.lineage || null,
          sources: Array.isArray(payload.sources) ? payload.sources : [],
          confidence: safe.strainTypeConfidence / 100,
          // The draft flow: a human approves before it auto-attaches to lots.
          status: "draft",
          source: "enrichment",
          active: true,
        },
        session.userId,
      );
      wrote.push("kb_strain");

      await recordAudit({
        actorId: session.userId,
        actorEmail: session.email,
        action: "kb.strain.draft_from_lookup",
        entityType: "kb_strains",
        entityId: draftId || null,
        after: { name, strainType: safe.strainType, status: "draft", source: "enrichment" },
      });
    }

    // 2) ENRICHMENT feed (T-315): stage description / short_description / image
    //    candidates as PENDING ai_suggestions keyed to the POS product key, so
    //    they appear on the enrichment page for the owner to Accept / Import.
    //    DRAFTS ONLY — nothing here publishes or imports on its own.
    if (hasEnrichment) {
      const existing = await listSuggestions("product", posKey, "pending");
      const alreadyHas = (fieldKey: string, value: string) =>
        existing.some((s) => s.field_key === fieldKey && (s.suggested_value ?? "") === value);
      const src = `model:onboarding-lookup`;
      // SLICE S06 (F-018): each suggestion carries ITS OWN field confidence when
      // the v2 lookup gave one. Without it, the legacy rule applies unchanged
      // (strain-type confidence, else 0.75). suggestionConfidence re-parses
      // the client value (0-100 only), so a junk number falls back too.
      const fc = (payload.fieldConfidence ?? {}) as Record<string, unknown>;
      const confFor = (k: "description" | "short_description" | "images") =>
        suggestionConfidence(fc[k], safe.strainTypeConfidence);

      if (safe.description && !alreadyHas("description", safe.description)) {
        await persistSuggestion({
          entity_type: "product",
          entity_id: posKey,
          field_key: "description",
          suggested_value: safe.description,
          input_summary: `AI onboarding lookup for ${name}`,
          generated_by: session.userId,
          confidence: confFor("description"),
          source: src,
        });
        wrote.push("description");
      }
      if (safe.shortDescription && !alreadyHas("short_description", safe.shortDescription)) {
        await persistSuggestion({
          entity_type: "product",
          entity_id: posKey,
          field_key: "short_description",
          suggested_value: safe.shortDescription,
          input_summary: `AI onboarding lookup for ${name}`,
          generated_by: session.userId,
          confidence: confFor("short_description"),
          source: src,
        });
        wrote.push("short_description");
      }
      const packedImages = packImageCandidates(safe.imageCandidates);
      if (packedImages && !alreadyHas(RESEARCH_IMAGES_FIELD, packedImages)) {
        await persistSuggestion({
          entity_type: "product",
          entity_id: posKey,
          field_key: RESEARCH_IMAGES_FIELD,
          suggested_value: packedImages,
          input_summary: `AI onboarding lookup · ${packedImages.split("\n").length} image candidate(s) for ${name}`,
          generated_by: session.userId,
          confidence: confFor("images"),
          source: src,
        });
        wrote.push("images");
      }

      await recordAudit({
        actorId: session.userId,
        actorEmail: session.email,
        action: "enrichment.draft_from_lookup",
        entityType: "product",
        entityId: posKey,
        after: {
          name,
          category: safe.category || undefined,
          potencyRatio: safe.potencyRatio || undefined,
          size: safe.size || undefined,
          staged: wrote.filter((w) => w !== "kb_strain"),
        },
      });
    }

    if (wrote.length === 0) {
      return { ok: false, error: "Those details were already staged — nothing new to save." };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Could not save the draft: ${String(err).slice(0, 160)}` };
  }
}
