"use server";

/**
 * src/app/admin/knowledge-base/strain-lookup-actions.ts
 *
 * The server action behind the Gemini STRAIN look-up on the KB Strain Editor.
 *
 * ONE JOB (Michael's brief): given a strain name, ask Gemini to find what it
 * can from the live web and hand the sanitized, compliance-gated result back to
 * the panel, which fills the roomy Add/Edit strain form for review. NOTHING is
 * saved here — the operator reviews/edits and then presses the form's existing
 * Save button (upsertStrainAction). This keeps the flow simple and drafts-safe.
 *
 * Returns a plain result object (never redirects) so the client panel can fill
 * the form. Gated on products.enrich, matching every other KB action. A "not
 * found" is a normal result, not an error; only hard config/budget problems
 * surface as { ok:false, error }.
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { loadBannedPhrases } from "@/lib/ai/kb/retrieval";
import { lookupStrain, isAiConfigured } from "@/lib/ai/kb/strain-lookup";
import { AiLookupError } from "@/lib/ai/provider";
import type { StrainLookupResult } from "@/lib/ai/kb/strain-lookup-core";

/** The success payload the panel uses to fill the form. */
export type StrainLookupActionResult =
  | ({
      ok: true;
      /** The name we looked up (echoed back so the panel can fill it). */
      strainName: string;
      /** True when the live web_search grounding ran (vs built-in knowledge). */
      usedWebSearch: boolean;
      /** Model id for the provenance line. */
      model: string;
      /** Real source URLs Gemini consulted (may be []). */
      sources: string[];
    } & StrainLookupResult)
  | { ok: false; error: string };

/**
 * Look up a single strain by name. Read-only (nothing is persisted). The panel
 * takes the returned fields and fills the Add/Edit strain form for review.
 */
export async function strainLookupAction(
  formData: FormData,
): Promise<StrainLookupActionResult> {
  const session = await requirePermission("products.enrich");

  if (!isAiConfigured) {
    return {
      ok: false,
      error: "AI isn't configured yet, so the look-up can't run. Set the AI API key to enable it.",
    };
  }

  const strainName = String(formData.get("strain_name") ?? "").trim();
  if (!strainName) return { ok: false, error: "Type a strain name to look up first." };

  try {
    const banned = await loadBannedPhrases();
    const outcome = await lookupStrain({
      strainName,
      extraBanned: banned,
      context: {
        feature: "kb.strain_lookup",
        entityType: "kb_strain",
        entityId: strainName.toLowerCase(),
      },
    });

    await recordAudit({
      actorId: session.profile.id,
      action: "kb.strain.ai_lookup",
      entityType: "kb_strain",
      entityId: strainName.toLowerCase(),
    }).catch(() => {});

    return {
      ok: true,
      strainName,
      usedWebSearch: outcome.usedWebSearch,
      model: outcome.model,
      sources: outcome.sources,
      ...outcome.result,
    };
  } catch (err) {
    if (err instanceof AiLookupError) {
      return { ok: false, error: err.friendly };
    }
    return {
      ok: false,
      error: `The strain look-up hit a problem: ${String(err).slice(0, 160)}`,
    };
  }
}
