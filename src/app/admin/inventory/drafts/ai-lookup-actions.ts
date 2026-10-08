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
import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { onboardingV2RowOn } from "@/lib/catalog/onboarding-row-flag";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { loadBannedPhrases } from "@/lib/ai/kb/retrieval";
import { upsertKbStrain } from "@/lib/ai/kb/store";
import { persistSuggestion, listSuggestions, reviewSuggestion } from "@/lib/ai/suggestions";
import {
  packImageCandidates,
  RESEARCH_IMAGES_FIELD,
} from "@/lib/enrichment/research-core";
import {
  lookupProduct,
  isAiConfigured,
  type ProductLookupOutcome,
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
import { attachFactsV2Enabled, currentAttachPolicyRing } from "@/lib/catalog/fact-attach-policy-server";
// S07: the single write door (ATTACH_FACTS_V2, default on).
import { attachProductFacts } from "@/lib/catalog/attach-facts";
import { factConfidenceFromFacts, type AttachReceipt, type FactConfidence } from "@/lib/catalog/attach-plan-core";
// S09: KB-first recall - read what the shop already knows BEFORE paying for Gemini.
import {
  KB_FIRST_ONBOARDING_ENV,
  MEMORY_MODEL_LABEL,
  alreadyKnownPromptBlock,
  kbFirstOnboardingEnabled,
  memoryAuditPayload,
  memoryRawLookup,
  memoryResultNotice,
  shouldSkipGemini,
} from "@/lib/catalog/fact-memory-core";
import { recallForDraft } from "@/lib/catalog/fact-memory";
// R23 (items 2 + 6): attach one waiting fact from the row's AI card.
import { attachedFactsOf } from "@/lib/catalog/fact-chips-core";
import { draftsHref, normalizeDraftView } from "@/lib/catalog/draft-deep-link-core";
import {
  PICK_BAD_FIELD,
  PICK_NO_MEMORY,
  gatedValue,
  isWaitingField,
  pickMemoryValue,
  pickSuggestionValue,
  rawLookupForField,
  suggestionClosable,
  type PickResult,
  type WaitingResultCode,
  type WaitingSuggestionRow,
} from "@/lib/catalog/waiting-facts-core";
import { readDraftForWaiting, readWaitingSuggestion } from "@/lib/catalog/waiting-facts-server";

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
  /** R30: terpene KB slugs the web reported (re-cleaned server-side on save). Optional for older clients. */
  terpenes?: string[];
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
  /**
   * SLICE S07: the strain-level fields' OWN confidences (0-100), only while
   * the operator kept them exactly as the AI returned them (keptFactConfidence).
   * Re-parsed server-side; a junk number is treated as unscored.
   */
  factConfidence?: FactConfidence;
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
      /** R30: terpene KB slugs the web reported. */
      terpenes: string[];
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
      /**
       * SLICE S06: which shape the reply was parsed as. S09: "memory" when no
       * web lookup ran because every fact was already on file.
       */
      schema: "v2" | "v1" | "memory";
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
      /**
       * S09: what recall found. Null when the flag is off, there is no draft
       * id, or the product has no full identity / nothing on file.
       */
      memory: LookupMemoryView | null;
    }
  | { ok: false; error: string };

/** S09: the recall summary the panel shows (field names only; values ride in the result). */
export type LookupMemoryView = {
  /** True when Gemini was NOT called (every target fact already on file). */
  skipped: boolean;
  /** The operator pressed "Refresh from web" (memory ignored for this call). */
  refresh: boolean;
  covered: string[];
  missing: string[];
  /** One plain-English line for the panel. */
  notice: string;
};

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
  // S09: "Refresh from web" - the operator says the product may have changed,
  // so memory is neither used to skip nor fed to the prompt for this call.
  const refresh = str(formData, "refresh") === "1";

  try {
    const banned = await loadBannedPhrases();
    // S09 RECALL (KB_FIRST_ONBOARDING, default on). Identity is re-derived
    // SERVER-SIDE from the draft row (never from the client's text). Never
    // throws; null = nothing known -> the lookup runs exactly as before.
    const kbFirst = kbFirstOnboardingEnabled(process.env[KB_FIRST_ONBOARDING_ENV]);
    const memory = kbFirst && draftId ? await recallForDraft(draftId) : null;
    const skipGemini = shouldSkipGemini({ enabled: kbFirst, refresh, memory });
    const outcome: Omit<ProductLookupOutcome, "schema"> & { schema: ProductLookupOutcome["schema"] | "memory" } =
      skipGemini && memory
        ? {
            // The SAME compliance gate as a Gemini reply: an approved record
            // is re-linted against today's banned list. Zero AI calls.
            result: postProcessLookup(memoryRawLookup(memory), banned),
            sources: [],
            model: MEMORY_MODEL_LABEL,
            usedWebSearch: false,
            facts: null,
            schema: "memory",
            citations: [],
            searchSuggestions: [],
          }
        : await lookupProduct({
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
            // Partial memory: tell the model what is already on file. "" when
            // nothing is covered (or on refresh) -> prompt byte-identical.
            alreadyKnown: refresh ? "" : alreadyKnownPromptBlock(memory),
          });
    const memoryView: LookupMemoryView | null = memory
      ? {
          skipped: skipGemini,
          refresh,
          covered: [...memory.covered],
          missing: [...memory.missing],
          notice: skipGemini ? memoryResultNotice(memory, new Date()) : "",
        }
      : null;

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
        // S07: the lookup itself writes nothing; in act mode the preview says
        // what Save selected will do (the save returns the real receipt).
        receipt: receiptSentence(verdicts, mode, { strain_type: outcome.facts.fields.strain_type.value }, { onSave: true }),
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
        // S09: recall outcome - field names and flags only (no values).
        memory: kbFirst && draftId ? memoryAuditPayload(memory, skipGemini, refresh) : undefined,
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
      terpenes: r.terpenes,
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
        terpenes: r.terpenes,
        sources: outcome.sources,
        posProductKey,
        description: r.description,
        shortDescription: r.shortDescription,
        category: r.category,
        potencyRatio: r.potencyRatio,
        size: r.size,
        imageCandidates: r.imageCandidates,
        fieldConfidence: fieldConfidenceForSave(outcome.facts),
        factConfidence: factConfidenceFromFacts(outcome.facts),
      },
      policy,
      memory: memoryView,
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

export type SaveLookupResult =
  | {
      ok: true;
      /** S07: the per-field receipt + sentence (absent on the ATTACH_FACTS_V2=off path). */
      receipt?: AttachReceipt;
      sentence?: string;
      notes?: string[];
    }
  | { ok: false; error: string };

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

  // SLICE S07: the single write door. Every value it uses is re-read on the
  // server (draft row, lot, strain library, product record); the payload only
  // supplies the operator's curated text, which was re-sanitized just above.
  if (attachFactsV2Enabled()) {
    if (!draftId) return { ok: false, error: "Missing the onboarding draft id - refresh the page and try again." };
    try {
      const res = await attachProductFacts({
        context: { kind: "draft", draftId },
        safe,
        sources: Array.isArray(payload.sources) ? payload.sources.filter((x): x is string => typeof x === "string") : [],
        factConfidence: payload.factConfidence ?? {},
        suggestionConfidence: (payload.fieldConfidence ?? {}) as Record<string, unknown>,
        suggestionSource: "model:onboarding-lookup",
        actor: { userId: session.userId, email: session.email },
      });
      if (!res.ok) return { ok: false, error: res.error };
      // S11: when something really landed, re-render the onboarding page so
      // the row's Facts panel shows the SERVER state (the approve form reads
      // server state, not the DOM). Client state in this panel survives the
      // refresh. ONBOARDING_V2_ROW=off keeps the previous behaviour.
      if (res.receipt.attached.length > 0 && onboardingV2RowOn()) {
        revalidatePath("/admin/inventory/drafts");
      }
      return { ok: true, receipt: res.receipt, sentence: res.sentence, notes: res.notes };
    } catch (err) {
      unstable_rethrow(err);
      return { ok: false, error: `Could not save: ${String(err).slice(0, 160)}` };
    }
  }

  // ATTACH_FACTS_V2=off: the previous save path, unchanged.
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

// ---------------------------------------------------------------------------
// R23 (items 2 + 6): attach ONE waiting fact from the onboarding row.
//
// The browser names WHICH fact (draft id, field, origin, suggestion id) -
// never its text. The value is re-read here (the pending suggestion, checked
// against THIS draft's suggestion key; or the product memory, recalled
// again), run through the same compliance gate as a web reply, and saved
// through the S07 door as a PERSON's confirmed answer (confirmedBy
// "human"): this product's own record only, never the shared strain
// library, never a new suggestion, provenance source "human". Not gated by
// the attach ring - the ring governs what lands WITHOUT a person.
// ---------------------------------------------------------------------------

/** Where the form returns to (the row stays pinned and open). */
function waitingBack(formData: FormData, draftId: string, code: WaitingResultCode, msg: string): string {
  const manifest = str(formData, "return_manifest");
  const status = normalizeDraftView(str(formData, "return_status"));
  return draftsHref({ status, manifestId: manifest || null, draftId, extra: { wf: code, ...(msg ? { wf_msg: msg.slice(0, 300) } : {}) } });
}

export async function attachWaitingFactAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const draftId = str(formData, "draft_id");
  const field = str(formData, "field");
  const origin = str(formData, "origin");
  const suggestionId = str(formData, "suggestion_id");
  if (!draftId) redirect(draftsHref({ extra: { wf: "error", wf_msg: "Missing the onboarding draft id - refresh the page and try again." } }));
  if (!isWaitingField(field)) redirect(waitingBack(formData, draftId, "error", PICK_BAD_FIELD));

  let target = "";
  try {
    const draft = await readDraftForWaiting(draftId);
    if (!draft) {
      target = waitingBack(formData, draftId, "error", "This onboarding draft could not be read just now - refresh the page.");
    } else if (draft.status !== "draft" && draft.status !== "approved") {
      target = waitingBack(formData, draftId, "error", "This product was dismissed, so nothing was attached. Restore it first.");
    } else {
      // 1. Re-read the value on the server.
      let suggestionRow: WaitingSuggestionRow | null = null;
      let pick: PickResult;
      if (origin === "suggestion") {
        suggestionRow = await readWaitingSuggestion(suggestionId);
        pick = pickSuggestionValue(suggestionRow, field, draft.key);
      } else if (origin === "memory") {
        const kbFirst = kbFirstOnboardingEnabled(process.env[KB_FIRST_ONBOARDING_ENV]);
        pick = kbFirst ? pickMemoryValue(await recallForDraft(draftId), field) : { ok: false, reason: PICK_NO_MEMORY };
      } else {
        pick = { ok: false, reason: "Unknown fact - refresh the page." };
      }
      if (!pick.ok) {
        target = waitingBack(formData, draftId, "error", pick.reason);
      } else {
        // 2. The same compliance gate as a web reply (today's banned list).
        const banned = await loadBannedPhrases();
        const safe = postProcessLookup(rawLookupForField(field, pick.value), banned);
        const gated = gatedValue(field, safe);
        if ((Array.isArray(gated) && gated.length === 0) || gated === "") {
          target = waitingBack(formData, draftId, "skipped", "That fact did not pass the compliance check (a medical claim, a banned phrase or a non-experiential effect), so it was not attached.");
        } else {
          // 3. The single write door, as a person's confirmed answer.
          const res = await attachProductFacts({
            context: { kind: "draft", draftId },
            safe,
            sources: [],
            factConfidence: {},
            suggestionConfidence: {},
            suggestionSource: "human:onboarding-attach",
            actor: { userId: session.userId, email: session.email },
            confirmedBy: "human",
          });
          if (!res.ok) {
            target = waitingBack(formData, draftId, "error", res.error);
          } else {
            const landed = res.receipt.attached.some((a) => a.field === field);
            const skip = res.receipt.skipped.find((s) => s.field === field);
            // 4. Close the pending sensory/effects suggestion only when every
            //    part of it is now a person's answer on this row.
            let closed = false;
            if (landed && suggestionRow) {
              const after = await readDraftForWaiting(draftId);
              if (after && suggestionClosable(suggestionRow, attachedFactsOf(after.row))) {
                try {
                  await reviewSuggestion(suggestionRow.id, "accepted", session.userId);
                  closed = true;
                } catch {
                  /* best effort: the fact is attached; the suggestion stays pending */
                }
              }
            }
            await recordAudit({
              actorId: session.userId,
              actorEmail: session.email,
              action: "catalog_draft.waiting_fact_attach",
              entityType: "catalog_product_drafts",
              entityId: draftId,
              after: { field, origin, suggestionId: suggestionRow?.id ?? null, landed, suggestionClosed: closed, mode: res.mode },
            });
            const note = res.notes.length > 0 ? ` ${res.notes.join(" ")}` : "";
            target = landed
              ? waitingBack(formData, draftId, "attached", `${res.sentence}${note}`)
              : waitingBack(formData, draftId, "skipped", `${skip?.reason ?? res.sentence}${note}`);
            revalidatePath("/admin/inventory/drafts");
          }
        }
      }
    }
  } catch (err) {
    unstable_rethrow(err);
    target = waitingBack(formData, draftId, "error", `Could not attach: ${String(err).slice(0, 160)}`);
  }
  redirect(target);
}
