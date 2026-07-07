/**
 * src/lib/kb/lead-promotion.ts — Slice H6, the lead-promotion hook.
 *
 * Strategy §9: "lead-promotion hook that auto-bumps a vendor from Tier 3 →
 * Tier 2 depth when you start pursuing them." Two pieces:
 *
 *  • bumpLeadHarvestDepth() — when a lead moves into a pursuing status
 *    (contacted/qualified), queue a Tier-2 medium-depth harvest of its site
 *    so that "when a rep walks in, their page already looks like you've been
 *    stocking them for a year." BEST-EFFORT: a down crawler never blocks the
 *    status change.
 *
 *  • unlockLeadDrafts() — when a lead is ONBOARDED with a matched vendor,
 *    re-key its dark prospect drafts (ai_suggestions entity_id "lead:<id>")
 *    to the real vendor id. They stay PENDING — this only moves them from the
 *    prospect lane into the normal review lanes; every accept still passes
 *    the S-4 compliance gate. Reference-only research_* drafts keep their
 *    read-only routing by field key, unchanged.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { isCrawlerConfigured, startHarvest } from "@/lib/ai/crawler-client";
import type { DiscoveryVendorStatus } from "@/lib/discovery/types";

/** Tier-2 depth (strategy §3: prospects, ~8–15 pages — H4 preset uses 10). */
const TIER2_MAX_PAGES = 10;

/** Statuses that mean "we started pursuing this vendor". */
const PURSUING_STATUSES: ReadonlySet<DiscoveryVendorStatus> = new Set(["contacted", "qualified"]);

export function isPursuingStatus(status: DiscoveryVendorStatus): boolean {
  return PURSUING_STATUSES.has(status);
}

/**
 * Queue a Tier-2 depth harvest for a lead's website. Returns the job id, or
 * null when skipped (no crawler, no usable website). Never throws.
 */
export async function bumpLeadHarvestDepth(lead: {
  id: string;
  website: string | null;
  display_name: string;
}): Promise<string | null> {
  if (!isCrawlerConfigured()) return null;
  if (!lead.website || !/^https?:\/\//i.test(lead.website)) return null;
  try {
    const job = await startHarvest({
      targets: [
        {
          entityType: "vendor",
          entityId: `lead:${lead.id}`,
          url: lead.website,
          displayName: lead.display_name,
        },
      ],
      maxPagesPerSite: TIER2_MAX_PAGES,
      label: `Tier 2 — depth bump · ${lead.display_name}`,
    });
    return job.id;
  } catch {
    return null; // best-effort: pursuing a lead never fails on crawler trouble
  }
}

/**
 * Re-key a promoted lead's PENDING drafts from "lead:<id>" to the real vendor
 * id, unlocking them into the review lanes. Returns the number of drafts
 * moved. Only pending rows move — reviewed history keeps its original key.
 */
export async function unlockLeadDrafts(leadId: string, vendorId: string): Promise<number> {
  if (!isSupabaseServiceConfigured || !leadId || !vendorId) return 0;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("ai_suggestions")
    .update({ entity_id: vendorId })
    .eq("entity_id", `lead:${leadId}`)
    .eq("status", "pending")
    .select("id");
  if (error || !data) return 0;
  return data.length;
}
