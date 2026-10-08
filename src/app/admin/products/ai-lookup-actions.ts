"use server";

/**
 * Server actions for the AI PRODUCT LOOK-UP (Gemini) on the product ENRICHMENT
 * page (`/admin/products/[key]`).
 *
 * This brings the proven onboarding look-up (T-314/T-315) onto the enrichment
 * page — the natural home for Cultivera products that never go through
 * onboarding (imported but not received). It reuses the SAME battle-tested
 * pieces:
 *   • lookupProduct()          — Gemini `google_search` grounding + graceful
 *                                built-in-knowledge fallback (provider-side).
 *   • postProcessLookup()      — compliance gate + sanitize (re-run server-side
 *                                on save; the client payload is NEVER trusted).
 *   • persistSuggestion()      — stages description / short_description / image
 *                                candidates as PENDING ai_suggestions keyed to
 *                                the POS product key → they appear on THIS page
 *                                for the owner to Accept / Import. Drafts only.
 *   • upsertKbStrain()         — an optional kb_strains DRAFT so a confident
 *                                strain becomes reusable knowledge (adds the
 *                                terpene/aroma richness to the product detail
 *                                page — even for edibles).
 *
 * Difference from the onboarding action: this one requires the products.enrich
 * permission (the enrichment page's permission) instead of inventory.manage,
 * and it ALWAYS has a real POS product key (it's the [key] route), so there is
 * no "approve the onboarding draft first" caveat — description/notes/images
 * always stage successfully.
 *
 * Nothing here publishes or imports on its own. Everything lands as a draft.
 */

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { loadBannedPhrases } from "@/lib/ai/kb/retrieval";
import { upsertKbStrain } from "@/lib/ai/kb/store";
import { persistSuggestion, listSuggestions } from "@/lib/ai/suggestions";
import { packImageCandidates, RESEARCH_IMAGES_FIELD } from "@/lib/enrichment/research-core";
import { lookupProduct, isAiConfigured } from "@/lib/inventory/product-lookup-ai";
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
// S07: the single write door (ATTACH_FACTS_V2, default on).
import { attachFactsV2Enabled } from "@/lib/catalog/fact-attach-policy-server";
import { attachProductFacts } from "@/lib/catalog/attach-facts";
import { factConfidenceFromFacts, type AttachReceipt, type FactConfidence } from "@/lib/catalog/attach-plan-core";

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

/** The curated draft the client sends back to save (mirrors the sanitized result). */
export type EnrichmentLookupDraft = {
  name: string;
  strainType: GreenwayStrainType;
  strainTypeConfidence: number;
  summary: string;
  effects: string[];
  aromaNotes: string[];
  flavorNotes: string[];
  lineage: string;
  /** R30: terpene KB slugs the web reported (re-cleaned server-side on save). */
  terpenes?: string[];
  sources: string[];
  /** The POS product key this draft attaches to (always present on this page). */
  posProductKey: string;
  description: string;
  shortDescription: string;
  category: string;
  potencyRatio: string;
  size: string;
  imageCandidates: string[];
  /** SLICE S06 (F-018): each staged field's OWN confidence (0-100), when known. */
  fieldConfidence?: LookupFieldConfidence;
  /** SLICE S07: strain-level own confidences, only for untouched fields (keptFactConfidence). */
  factConfidence?: FactConfidence;
};

export type EnrichmentLookupActionResult =
  | {
      ok: true;
      found: boolean;
      /** 0..100 OVERALL confidence in the whole result (community-inclusive). */
      confidence: number;
      /** True when the model returned ANY usable content (surface for review). */
      hasAnyFindings: boolean;
      strainType: GreenwayStrainType;
      strainTypeConfidence: number;
      summary: string;
      effects: string[];
      /** Effects the model proposed that were dropped by the compliance gate. */
      rejectedEffects: { effect: string; reason: string }[];
      aromaNotes: string[];
      flavorNotes: string[];
      lineage: string;
      /** R30: terpene KB slugs the web reported. */
      terpenes: string[];
      sources: string[];
      model: string;
      usedWebSearch: boolean;
      honestMiss: string;
      description: string;
      shortDescription: string;
      category: string;
      potencyRatio: string;
      size: string;
      imageCandidates: string[];
      /** SLICE S06: structured per-field facts (null on a v1-shaped reply). */
      facts: LookupFacts | null;
      /** SLICE S06: which shape the reply was parsed as. */
      schema: "v2" | "v1";
      /** SLICE S06: grounded url_citation detail. */
      citations: WebCitation[];
      /** SLICE S06: Google Search Suggestions HTML (display only, never stored). */
      searchSuggestions: string[];
      /** The curated payload the client can send back to save. */
      draft: EnrichmentLookupDraft;
    }
  | { ok: false; error: string };

/**
 * Run the AI look-up for a product on the enrichment page. A plain "not found"
 * is a NORMAL success (found:false), never an error. Throws are mapped to a
 * friendly in-panel message.
 */
export async function enrichmentLookupAction(
  formData: FormData,
): Promise<EnrichmentLookupActionResult> {
  const session = await requirePermission("products.enrich");

  if (!isAiConfigured) {
    return {
      ok: false,
      error:
        "AI isn't set up yet. Add an AI_API_KEY (or OPENAI_API_KEY) in your environment to enable the look-up. Enrichment works without it.",
    };
  }

  const key = str(formData, "key");
  const query = str(formData, "query");
  const productName = str(formData, "product_name");
  const vendorOrBrand = str(formData, "vendor_or_brand");
  if (!key) return { ok: false, error: "Missing product key." };
  if (!query) return { ok: false, error: "Type something to look up first." };

  try {
    const banned = await loadBannedPhrases();
    const outcome = await lookupProduct({
      query,
      productName,
      vendorOrBrand,
      extraBanned: banned,
      context: {
        feature: "enrichment.product_lookup",
        entityType: "product",
        entityId: key,
        actorId: session.userId,
        actorEmail: session.email,
      },
    });

    const r = outcome.result;

    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "product.ai_lookup",
      entityType: "product",
      entityId: key,
      after: {
        query,
        found: r.found,
        strainType: r.strainType,
        confidence: r.confidence,
        usedWebSearch: outcome.usedWebSearch,
        model: outcome.model,
        sources: outcome.sources.length,
        category: r.category || undefined,
        imageCandidates: r.imageCandidates.length,
        // S06: counts only (no values, no suggestion HTML -- never stored).
        schema: outcome.schema,
        bands: outcome.facts?.counts,
      },
    });

    return {
      ok: true,
      found: r.found,
      confidence: r.confidence,
      hasAnyFindings: r.hasAnyFindings,
      strainType: r.strainType,
      strainTypeConfidence: r.strainTypeConfidence,
      summary: r.summary,
      effects: r.effects,
      rejectedEffects: r.rejectedEffects,
      aromaNotes: r.aromaNotes,
      flavorNotes: r.flavorNotes,
      lineage: r.lineage,
      terpenes: r.terpenes,
      sources: outcome.sources,
      model: outcome.model,
      usedWebSearch: outcome.usedWebSearch,
      honestMiss: LOOKUP_HONEST_MISS,
      description: r.description,
      shortDescription: r.shortDescription,
      category: r.category,
      potencyRatio: r.potencyRatio,
      size: r.size,
      imageCandidates: r.imageCandidates,
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
        terpenes: r.terpenes,
        sources: outcome.sources,
        posProductKey: key,
        description: r.description,
        shortDescription: r.shortDescription,
        category: r.category,
        potencyRatio: r.potencyRatio,
        size: r.size,
        imageCandidates: r.imageCandidates,
        fieldConfidence: fieldConfidenceForSave(outcome.facts),
        factConfidence: factConfidenceFromFacts(outcome.facts),
      },
    };
  } catch (err) {
    if (err instanceof AiLookupError) {
      return { ok: false, error: err.friendly };
    }
    return {
      ok: false,
      error: `The look-up couldn't complete: ${String(err).slice(0, 160)}`,
    };
  }
}

export type EnrichmentSaveResult =
  | {
      ok: true;
      staged: string[];
      savedStrain: boolean;
      /** S07: the per-field receipt + sentence (absent on the ATTACH_FACTS_V2=off path). */
      receipt?: AttachReceipt;
      sentence?: string;
      notes?: string[];
    }
  | { ok: false; error: string };

/**
 * Save the curated look-up findings as DRAFTS on the enrichment page:
 *   • description / short_description / image candidates → PENDING ai_suggestions
 *     keyed to the POS product key (appear in the Suggestions / image tray on
 *     THIS page for the owner to Accept / Import).
 *   • optionally, a kb_strains DRAFT (when saveStrain is on and it's strain-worthy)
 *     so future lots reuse the richness.
 *
 * The compliance gate is re-run server-side (the client payload is never
 * trusted) and everything is written as status='draft'. Nothing publishes.
 */
export async function enrichmentSaveLookupAction(formData: FormData): Promise<EnrichmentSaveResult> {
  const session = await requirePermission("products.enrich");

  const key = str(formData, "key");
  if (!key) return { ok: false, error: "Missing product key." };

  const saveStrain = str(formData, "save_strain") === "1";

  let payload: EnrichmentLookupDraft;
  try {
    payload = JSON.parse(str(formData, "payload")) as EnrichmentLookupDraft;
  } catch {
    return { ok: false, error: "Bad draft payload." };
  }

  const name = String(payload.name ?? "").trim();
  if (!name) return { ok: false, error: "Nothing to save — missing a product name." };

  // Re-sanitize server-side: rebuild a raw shape and run it back through the
  // compliance gate. Covers strain fields AND the all-inclusive enrichment fields.
  const banned = await loadBannedPhrases();
  const raw: RawProductLookup = {
    strain_type: payload.strainType,
    strain_type_confidence: (payload.strainTypeConfidence ?? 0) / 100,
    summary: payload.summary ?? "",
    effects: Array.isArray(payload.effects) ? payload.effects : [],
    aroma_notes: Array.isArray(payload.aromaNotes) ? payload.aromaNotes : [],
    flavor_notes: Array.isArray(payload.flavorNotes) ? payload.flavorNotes : [],
    lineage: String(payload.lineage ?? ""),
    // R30: re-cleaned by postProcessLookup (lint + KB vocabulary), never trusted as sent.
    terpenes: Array.isArray(payload.terpenes) ? payload.terpenes.filter((x): x is string => typeof x === "string") : [],
    found: true,
    description: String(payload.description ?? ""),
    short_description: String(payload.shortDescription ?? ""),
    category: String(payload.category ?? ""),
    potency_ratio: String(payload.potencyRatio ?? ""),
    size: String(payload.size ?? ""),
    image_candidates: Array.isArray(payload.imageCandidates) ? payload.imageCandidates : [],
  };
  const safe = postProcessLookup(raw, banned);

  // SLICE S07: the single write door. The strain is keyed by the menu item's
  // REAL strain name (read server-side), never this payload's product name.
  if (attachFactsV2Enabled()) {
    try {
      const res = await attachProductFacts({
        context: { kind: "product", posProductKey: key, saveStrain },
        safe,
        sources: Array.isArray(payload.sources) ? payload.sources.filter((x): x is string => typeof x === "string") : [],
        factConfidence: payload.factConfidence ?? {},
        suggestionConfidence: (payload.fieldConfidence ?? {}) as Record<string, unknown>,
        suggestionSource: "model:enrichment-lookup",
        actor: { userId: session.userId, email: session.email },
        fallbackLabel: name,
      });
      if (!res.ok) return { ok: false, error: res.error };
      revalidatePath(`/admin/products/${encodeURIComponent(key)}`);
      const staged = res.receipt.queued.filter((q) => q.to.includes("Enrichment suggestions")).map((q) => q.field);
      const savedStrain = [...res.receipt.attached, ...res.receipt.queued].some((x) => x.to.includes("strain library"));
      return { ok: true, staged, savedStrain, receipt: res.receipt, sentence: res.sentence, notes: res.notes };
    } catch (err) {
      unstable_rethrow(err);
      return { ok: false, error: `Could not save: ${String(err).slice(0, 160)}` };
    }
  }

  // ATTACH_FACTS_V2=off: the previous save path, unchanged.
  const isStrainWorthy =
    safe.strainType !== "unknown" ||
    safe.summary.length > 0 ||
    safe.effects.length > 0 ||
    safe.aromaNotes.length > 0 ||
    safe.flavorNotes.length > 0 ||
    safe.lineage.length > 0;

  const staged: string[] = [];
  let savedStrain = false;

  try {
    // 1) Enrichment drafts — description / short line / images as PENDING
    //    suggestions keyed to this product. Skip anything already staged.
    const existing = await listSuggestions("product", key, "pending");
    const alreadyHas = (fieldKey: string, value: string) =>
      existing.some((s) => s.field_key === fieldKey && (s.suggested_value ?? "") === value);
    const src = "model:enrichment-lookup";
    // SLICE S06 (F-018): each suggestion carries ITS OWN field confidence when
    // the v2 lookup gave one; otherwise the legacy rule, unchanged.
    const fc = (payload.fieldConfidence ?? {}) as Record<string, unknown>;
    const confFor = (k: "description" | "short_description" | "images") =>
      suggestionConfidence(fc[k], safe.strainTypeConfidence);

    if (safe.description && !alreadyHas("description", safe.description)) {
      await persistSuggestion({
        entity_type: "product",
        entity_id: key,
        field_key: "description",
        suggested_value: safe.description,
        input_summary: `AI enrichment look-up for ${name}`,
        generated_by: session.userId,
        confidence: confFor("description"),
        source: src,
      });
      staged.push("description");
    }
    if (safe.shortDescription && !alreadyHas("short_description", safe.shortDescription)) {
      await persistSuggestion({
        entity_type: "product",
        entity_id: key,
        field_key: "short_description",
        suggested_value: safe.shortDescription,
        input_summary: `AI enrichment look-up for ${name}`,
        generated_by: session.userId,
        confidence: confFor("short_description"),
        source: src,
      });
      staged.push("short_description");
    }
    const packedImages = packImageCandidates(safe.imageCandidates);
    if (packedImages && !alreadyHas(RESEARCH_IMAGES_FIELD, packedImages)) {
      await persistSuggestion({
        entity_type: "product",
        entity_id: key,
        field_key: RESEARCH_IMAGES_FIELD,
        suggested_value: packedImages,
        input_summary: `AI enrichment look-up · ${packedImages.split("\n").length} image candidate(s) for ${name}`,
        generated_by: session.userId,
        confidence: confFor("images"),
        source: src,
      });
      staged.push("images");
    }

    // 2) Optional kb_strains DRAFT — only when asked AND strain-worthy.
    if (saveStrain && isStrainWorthy) {
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
          status: "draft",
          source: "enrichment",
          active: true,
        },
        session.userId,
      );
      savedStrain = true;
    }

    if (staged.length === 0 && !savedStrain) {
      if (saveStrain && !isStrainWorthy) {
        return {
          ok: false,
          error:
            "Nothing strain-worthy to save to the KB, and the product details were already staged.",
        };
      }
      return { ok: false, error: "Those details were already staged — nothing new to save." };
    }

    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "enrichment.draft_from_ai_lookup",
      entityType: "product",
      entityId: key,
      after: {
        name,
        staged,
        savedStrain,
        strainType: savedStrain ? safe.strainType : undefined,
        category: safe.category || undefined,
      },
    });

    revalidatePath(`/admin/products/${encodeURIComponent(key)}`);
    return { ok: true, staged, savedStrain };
  } catch (err) {
    return { ok: false, error: `Could not save the draft: ${String(err).slice(0, 160)}` };
  }
}
