"use server";

/**
 * R49 S7 -- "Research with Google Gemini (step 1)" server actions for the
 * vendor detail page.
 *
 *   vendorGeminiResearchAction  runs ONE grounded Google Search lookup and
 *                               RETURNS the findings + citations + Google
 *                               Search Suggestions to the staff member who
 *                               clicked. Nothing is stored (Google grounding
 *                               terms). The audit row records counts only.
 *   vendorGeminiSaveAction      saves ONE field the staff member reviewed
 *                               (and may have edited) as a PENDING draft in
 *                               the existing ai_suggestions review queue.
 *                               The draft still needs Accept (with the
 *                               compliance re-scan) before it touches the
 *                               profile.
 *
 * Grounded links are never used to choose a crawl target: there is no
 * hand-off from here to the crawler (step 2), which is only ever prefilled
 * from the vendor's saved website field.
 */

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { getVendorById } from "@/lib/vendors/store";
import { persistSuggestion } from "@/lib/ai/suggestions";
import {
  generateWebSearch,
  isAiConfigured,
  aiWebSearchModelId,
  AiNotConfiguredError,
  AiLookupError,
} from "@/lib/ai/provider";
import { AiBudgetExceededError } from "@/lib/ai/router";
import { looseParseLookupJson } from "@/lib/inventory/product-lookup-parse";
import type { WebCitation } from "@/lib/ai/grounding-core";
import {
  VENDOR_GEMINI_SYSTEM,
  buildVendorGeminiPrompt,
  normalizeVendorFindings,
  socialDraftBody,
  validateGeminiSave,
  GEMINI_DRAFT_SOURCE,
  GEMINI_FIELD_LABELS,
  type VendorGeminiFindings,
} from "@/lib/vendors/vendor-gemini-research-core";

/** True when the web-search model is a Gemini model (grounded Google Search). */
function geminiSelected(): boolean {
  return /^gemini/i.test(aiWebSearchModelId);
}

export type VendorGeminiResult =
  | {
      ok: true;
      findings: VendorGeminiFindings;
      /** Pre-built research_social draft body for the socials found. */
      socialBody: string;
      citations: WebCitation[];
      sources: string[];
      /** Google Search Suggestions HTML -- display only, never stored. */
      searchSuggestions: string[];
      model: string;
      usedWebSearch: boolean;
      usedGemini: boolean;
    }
  | { ok: false; error: string };

export async function vendorGeminiResearchAction(formData: FormData): Promise<VendorGeminiResult> {
  const session = await requirePermission("vendors.manage");
  const id = String(formData.get("id") ?? "").trim();
  const hint = String(formData.get("hint") ?? "").trim().slice(0, 300);
  if (!id) return { ok: false, error: "Missing vendor id." };

  if (!isAiConfigured) {
    return {
      ok: false,
      error: "AI isn't set up yet. Set AI_MODEL_HEAVY to a Gemini model (for example gemini-2.5-flash) and AI_GEMINI_API_KEY in Vercel, then redeploy.",
    };
  }

  const vendor = await getVendorById(id);
  if (!vendor) return { ok: false, error: "Vendor not found." };

  try {
    const ws = await generateWebSearch({
      system: VENDOR_GEMINI_SYSTEM,
      user: buildVendorGeminiPrompt({
        displayName: vendor.display_name,
        legalName: vendor.legal_name,
        licenseNumber: vendor.license_number,
        city: [vendor.shipping_city, vendor.shipping_state].filter(Boolean).join(", ") || null,
        hint,
      }),
      maxTokens: 2500,
      context: {
        feature: "vendors.gemini_research",
        entityType: "vendor",
        entityId: id,
        actorId: session.userId,
        actorEmail: session.email,
      },
    });

    const findings = normalizeVendorFindings(looseParseLookupJson(ws.text));
    const usedGemini = geminiSelected() && /^gemini/i.test(ws.model);

    // Counts only -- no grounded text, links or suggestion HTML are stored.
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "vendor.gemini_research",
      entityType: "vendor",
      entityId: id,
      after: {
        model: ws.model,
        usedWebSearch: ws.usedWebSearch,
        usedGemini,
        found: findings.found,
        confidence: findings.confidence,
        socials: findings.socials.length,
        citations: (ws.citations ?? []).length,
        hint: hint ? true : false,
      },
    });

    return {
      ok: true,
      findings,
      socialBody: socialDraftBody(findings.socials),
      citations: ws.citations ?? [],
      sources: ws.sources,
      searchSuggestions: ws.searchSuggestions ?? [],
      model: ws.model,
      usedWebSearch: ws.usedWebSearch,
      usedGemini,
    };
  } catch (err) {
    if (err instanceof AiLookupError) return { ok: false, error: err.friendly };
    if (err instanceof AiNotConfiguredError) {
      return { ok: false, error: "AI isn't set up yet. Set AI_MODEL_HEAVY to a Gemini model and AI_GEMINI_API_KEY in Vercel." };
    }
    if (err instanceof AiBudgetExceededError) {
      return { ok: false, error: `This month's AI budget is used up: ${err.message}` };
    }
    return { ok: false, error: `The research couldn't complete: ${String(err).slice(0, 160)}` };
  }
}

export type VendorGeminiSaveResult = { ok: true; message: string } | { ok: false; error: string };

export async function vendorGeminiSaveAction(formData: FormData): Promise<VendorGeminiSaveResult> {
  const session = await requirePermission("vendors.manage");
  const id = String(formData.get("id") ?? "").trim();
  const fieldKey = String(formData.get("field") ?? "").trim();
  if (!id) return { ok: false, error: "Missing vendor id." };

  const checked = validateGeminiSave(fieldKey, formData.get("value"));
  if (!checked.ok) return { ok: false, error: checked.error };

  const vendor = await getVendorById(id);
  if (!vendor) return { ok: false, error: "Vendor not found." };

  const confidenceRaw = Number(formData.get("confidence") ?? "");
  const confidence = Number.isFinite(confidenceRaw) && confidenceRaw > 0 ? Math.min(1, confidenceRaw / 100) : null;
  const edited = String(formData.get("edited") ?? "") === "1";

  try {
    await persistSuggestion({
      entity_type: "vendor",
      entity_id: id,
      field_key: checked.field,
      suggested_value: checked.value,
      input_summary: `${vendor.display_name} \u00b7 ${GEMINI_FIELD_LABELS[checked.field].toLowerCase()} \u00b7 Google Gemini research${edited ? " (edited)" : ""}`,
      generated_by: session.userId,
      confidence,
      source: GEMINI_DRAFT_SOURCE,
    });
  } catch (err) {
    return { ok: false, error: `Couldn't save the draft: ${String(err).slice(0, 160)}` };
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "vendor.gemini_draft_saved",
    entityType: "vendor",
    entityId: id,
    after: { field: checked.field, edited, chars: checked.value.length },
  });

  revalidatePath(`/admin/vendors/${id}`);
  return {
    ok: true,
    message: `${GEMINI_FIELD_LABELS[checked.field]} saved as a draft \u2014 review it in the drafts list below and click Accept to put it on the profile.`,
  };
}
