"use server";

/**
 * CCRS AI advisor server action (Slice 54). Regenerates the batch server-side
 * for the given range, then asks the AI for a DRAFTS-ONLY, grounded briefing on
 * what to fix before uploading. Read-only; never mutates anything. Gated on
 * reports.view + the AI key.
 */
import { requirePermission } from "@/lib/auth/session";
import { resolveRange } from "@/lib/reports/range";
import { buildCcrsBatch } from "@/lib/compliance/ccrs-batch";
import { generateCcrsAdvice, isAiConfigured, type CcrsAdvice } from "@/lib/compliance/ccrs-advisor";

export type CcrsAdvisorResult = { ok: true; advice: CcrsAdvice } | { ok: false; error: string };

export async function generateCcrsAdviceAction(sp: {
  from?: string;
  to?: string;
  range?: string;
  year?: string;
}): Promise<CcrsAdvisorResult> {
  await requirePermission("reports.view");

  if (!isAiConfigured) {
    return {
      ok: false,
      error:
        "AI isn't set up yet. Add an AI_API_KEY in your environment to enable the CCRS advisor. The batch, files, and sync report above work without it.",
    };
  }

  try {
    const range = resolveRange(sp);
    const batch = await buildCcrsBatch(range.fromISO, range.toISO);
    const advice = await generateCcrsAdvice(batch);
    return { ok: true, advice };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to generate advice." };
  }
}
