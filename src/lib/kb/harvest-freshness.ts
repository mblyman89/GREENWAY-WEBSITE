/**
 * src/lib/kb/harvest-freshness.ts — Slice H6 (DB reads).
 *
 * Derives per-target harvest freshness from `ai_suggestions`: any row with
 * source "crawl:<url>" is a harvest touch, and the newest such row per
 * entity_id is that entity's last-harvest timestamp. Rows persist after
 * review (accepted/rejected keep their created_at), so no new table or
 * migration is needed — the drafts ledger already IS the harvest log.
 *
 * Builds FreshnessTarget lists for:
 *  • current vendors with websites (Tier-1 refresh candidates), and
 *  • non-dismissed, unmatched leads with websites (Tier-3 market trickle),
 * which the pure core (harvest-freshness-core.ts) turns into due-target
 * selections and cadence summaries.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { listVendors } from "@/lib/vendors/store";
import { listVendorLeads } from "@/lib/discovery/store";
import { summarizeFreshness, type FreshnessTarget } from "./harvest-freshness-core";

export {
  STALE_AFTER_DAYS,
  classifyFreshness,
  selectDueTargets,
  summarizeFreshness,
} from "./harvest-freshness-core";
export type { Freshness, FreshnessTarget } from "./harvest-freshness-core";

const HTTP_RE = /^https?:\/\//i;

/**
 * Newest crawl-draft created_at per entity_id. Pages newest-first and keeps
 * the FIRST timestamp seen per entity, so one pass yields the max. Bounded:
 * stops after `cap` rows (oldest history beyond the cap is stale anyway).
 */
async function lastHarvestByEntity(cap = 20_000): Promise<Map<string, string>> {
  const admin = createSupabaseAdminClient();
  const PAGE = 1000;
  const out = new Map<string, string>();
  for (let from = 0; from < cap; from += PAGE) {
    const { data, error } = await admin
      .from("ai_suggestions")
      .select("entity_id, created_at")
      .like("source", "crawl:%")
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error || !data) break;
    for (const row of data as { entity_id: string; created_at: string }[]) {
      if (!out.has(row.entity_id)) out.set(row.entity_id, row.created_at);
    }
    if (data.length < PAGE) break;
  }
  return out;
}

export type HarvestFreshness = {
  /** Current vendors with harvestable websites. */
  vendors: FreshnessTarget[];
  /** Unmatched, non-dismissed leads with harvestable websites (the market). */
  leads: FreshnessTarget[];
  /** Cadence summaries computed at load time (pages must not call Date.now()). */
  vendorSummary: FreshnessSummary;
  leadSummary: FreshnessSummary;
};

export type FreshnessSummary = { never: number; stale: number; fresh: number; due: number };

/** Load freshness facts for every harvestable vendor and market lead. */
export async function loadHarvestFreshness(): Promise<HarvestFreshness> {
  if (!isSupabaseServiceConfigured) {
    const empty = { never: 0, stale: 0, fresh: 0, due: 0 };
    return { vendors: [], leads: [], vendorSummary: empty, leadSummary: empty };
  }

  const [vendors, leads, lastByEntity] = await Promise.all([
    listVendors(),
    listVendorLeads({ limit: 2000 }),
    lastHarvestByEntity(),
  ]);

  const vendorTargets: FreshnessTarget[] = vendors
    .filter((v) => v.website && HTTP_RE.test(v.website))
    .map((v) => ({
      entityId: v.id,
      url: v.website as string,
      displayName: v.display_name,
      lastHarvestAt: lastByEntity.get(v.id) ?? null,
    }));

  const leadTargets: FreshnessTarget[] = leads
    .filter(
      (l) => l.website && HTTP_RE.test(l.website) && !l.matched_vendor_id && l.status !== "dismissed",
    )
    .map((l) => ({
      entityId: `lead:${l.id}`,
      url: l.website as string,
      displayName: l.display_name,
      lastHarvestAt: lastByEntity.get(`lead:${l.id}`) ?? null,
    }));

  const now = Date.now();
  return {
    vendors: vendorTargets,
    leads: leadTargets,
    vendorSummary: summarizeFreshness(vendorTargets, now),
    leadSummary: summarizeFreshness(leadTargets, now),
  };
}
