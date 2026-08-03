"use server";

/**
 * Server actions for the AI Product/Strain Lookup on Product Onboarding (T-314).
 *
 *  - productLookupAction:  runs the manual lookup (GPT-4o + live web search,
 *    graceful fallback to built-in knowledge). Returns the sanitized, compliance-
 *    gated result. A plain "not found" is a NORMAL success (found:false), never
 *    an error. Autofill eligibility is decided by the pure core's >= 90% bar.
 *  - saveLookupToKbAction:  saves what the AI found as a kb_strains DRAFT
 *    (status='draft', source='enrichment') \u2014 a draft for the owner to approve so
 *    future lots auto-attach it. Compliance is re-checked server-side before the
 *    write; the client payload is NEVER trusted.
 *
 * Both require the inventory.manage permission and are audited.
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { loadBannedPhrases } from "@/lib/ai/kb/retrieval";
import { upsertKbStrain } from "@/lib/ai/kb/store";
import {
  lookupProduct,
  isAiConfigured,
} from "@/lib/inventory/product-lookup-ai";
import {
  postProcessLookup,
  LOOKUP_HONEST_MISS,
  type RawProductLookup,
} from "@/lib/inventory/product-lookup-core";
import type { GreenwayStrainType } from "@/lib/leafly/types";

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
};

export type ProductLookupActionResult =
  | {
      ok: true;
      found: boolean;
      strainType: GreenwayStrainType;
      strainTypeConfidence: number;
      autofillStrainType: boolean;
      summary: string;
      effects: string[];
      aromaNotes: string[];
      flavorNotes: string[];
      lineage: string;
      sources: string[];
      model: string;
      usedWebSearch: boolean;
      hasKbDraft: boolean;
      honestMiss: string;
      /** The draft payload the client can send back to saveLookupToKbAction. */
      draft: LookupKbDraft;
    }
  | { ok: false; error: string };

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
      },
    });

    return {
      ok: true,
      found: r.found,
      strainType: r.strainType,
      strainTypeConfidence: r.strainTypeConfidence,
      autofillStrainType: r.autofillStrainType,
      summary: r.summary,
      effects: r.effects,
      aromaNotes: r.aromaNotes,
      flavorNotes: r.flavorNotes,
      lineage: r.lineage,
      sources: outcome.sources,
      model: outcome.model,
      usedWebSearch: outcome.usedWebSearch,
      hasKbDraft: r.hasKbDraft,
      honestMiss: LOOKUP_HONEST_MISS,
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
      },
    };
  } catch (err) {
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
  if (!name) return { ok: false, error: "Nothing to save \u2014 missing a product name." };
  if (payload.strainType === "unknown" && !payload.summary && (!payload.effects || payload.effects.length === 0)) {
    return { ok: false, error: "Nothing worth saving to the KB for this one." };
  }

  // Re-sanitize server-side: the client is never trusted. Rebuild a raw shape
  // from the payload and run it back through the compliance gate.
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
  };
  const safe = postProcessLookup(raw, banned);

  try {
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

    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "kb.strain.draft_from_lookup",
      entityType: "kb_strains",
      entityId: draftId || null,
      after: {
        name,
        strainType: safe.strainType,
        status: "draft",
        source: "enrichment",
      },
    });

    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Could not save the draft: ${String(err).slice(0, 160)}` };
  }
}
