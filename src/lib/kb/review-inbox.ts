/**
 * src/lib/kb/review-inbox.ts — Slice H5 (review economics), server wrapper.
 *
 * Assembles the vendor-grouped harvest review inbox:
 *  1. loads ALL pending vendor + brand drafts from ai_suggestions,
 *  2. re-scans each writable draft against the CURRENT compliance rules
 *     (advisory routing — the S-4 accept gate re-checks at accept time),
 *  3. dedupes re-harvest duplicates (newest per field wins; older ones are
 *     listed as superseded so actions can close them out),
 *  4. routes every draft into a confidence lane (pure core),
 *  5. groups by vendor (brand drafts roll up to the parent vendor) and
 *     resolves display names for vendors and prospect leads.
 *
 * Read-only: nothing here writes. The accept/reject/batch-accept actions live
 * in the review page's actions.ts.
 */
import "server-only";
import { listPendingByType } from "@/lib/ai/suggestions";
import { checkCompliance } from "@/lib/ai/compliance";
import { loadBannedPhrases } from "@/lib/ai/kb/retrieval";
import { listAllBrands, listVendors } from "@/lib/vendors/store";
import { listVendorLeads } from "@/lib/discovery/store";
import type { AiSuggestion } from "@/lib/enrichment/types";
import {
  classifyLane,
  groupByVendor,
  newestPerField,
  isProspectTarget,
  type ReviewLane,
} from "./review-lanes-core";
import { loadHarvestSettings } from "./harvest-settings";

export type InboxDraft = AiSuggestion & {
  lane: ReviewLane;
  /** Current-rules compliance flags (advisory; gate re-checks at accept). */
  complianceFlags: string[];
  blockingFlags: string[];
};

export type InboxGroup = {
  vendorKey: string;
  displayName: string;
  /** Link target: vendor detail page, or discovery page for prospects. */
  href: string | null;
  isProspect: boolean;
  fast: InboxDraft[];
  standard: InboxDraft[];
  reference: InboxDraft[];
  prospect: InboxDraft[];
};

export type HarvestInbox = {
  groups: InboxGroup[];
  /** Older pending duplicates superseded by a newer draft for the same field. */
  supersededCount: number;
  totals: { fast: number; standard: number; reference: number; prospect: number };
};

/** Load + triage the pending harvest inbox (vendor + brand drafts). */
export async function loadHarvestInbox(): Promise<HarvestInbox> {
  // Tunable knobs (Slice H7): pending limit + fast-lane bars. Fails open to
  // the vetted defaults when the settings table isn't provisioned yet.
  const settings = await loadHarvestSettings();

  const [vendorDrafts, brandDrafts, banned] = await Promise.all([
    listPendingByType("vendor", settings.pendingLimit),
    listPendingByType("brand", settings.pendingLimit),
    loadBannedPhrases().catch(() => []),
  ]);
  const all = [...vendorDrafts, ...brandDrafts];

  // Newest-per-field dedupe; superseded rows stay pending but are hidden from
  // the lanes (batch-close action reports the count).
  const { primary, superseded } = newestPerField(all);

  const laneCache = new Map<string, ReviewLane>();
  const drafts: InboxDraft[] = primary.map((s) => {
    const scan = checkCompliance(String(s.suggested_value ?? ""), banned);
    const lane = classifyLane(s, {
      hasBlockingFlags: scan.blockingFlags.length > 0,
      minConfidence: settings.fastLaneMinConfidence,
      minChars: settings.fastLaneMinChars,
    });
    laneCache.set(s.id, lane);
    return { ...s, lane, complianceFlags: scan.flags, blockingFlags: scan.blockingFlags };
  });

  // brand id → vendor id, for vendor-grouped rollup.
  const brands = await listAllBrands();
  const brandToVendor = new Map<string, string>();
  for (const b of brands) if (b.vendor_id) brandToVendor.set(b.id, b.vendor_id);

  const rawGroups = groupByVendor(drafts, brandToVendor, (d) => laneCache.get(d.id) ?? "standard");

  // Resolve display names (vendors + leads) in bulk.
  const vendorIds = new Set(rawGroups.map((g) => g.vendorKey).filter((k) => !isProspectTarget(k) && k !== "unknown"));
  const nameByVendor = new Map<string, string>();
  if (vendorIds.size > 0) {
    const vendors = await listVendors();
    for (const v of vendors) if (vendorIds.has(v.id)) nameByVendor.set(v.id, v.display_name);
  }
  const leadIds = new Set(
    rawGroups.filter((g) => isProspectTarget(g.vendorKey)).map((g) => g.vendorKey.slice("lead:".length)),
  );
  const nameByLead = new Map<string, string>();
  if (leadIds.size > 0) {
    const leads = await listVendorLeads({ limit: 2000 });
    for (const l of leads) if (leadIds.has(l.id)) nameByLead.set(l.id, l.display_name);
  }

  const groups: InboxGroup[] = rawGroups.map((g) => {
    const isProspect = isProspectTarget(g.vendorKey);
    const displayName = isProspect
      ? `${nameByLead.get(g.vendorKey.slice("lead:".length)) ?? "Unknown lead"} (prospect)`
      : g.vendorKey === "unknown"
        ? "Unlinked drafts"
        : (nameByVendor.get(g.vendorKey) ?? "Unknown vendor");
    const href = isProspect
      ? "/admin/discovery"
      : g.vendorKey === "unknown"
        ? null
        : `/admin/vendors/${g.vendorKey}`;
    return { ...g, displayName, href, isProspect };
  });

  const totals = { fast: 0, standard: 0, reference: 0, prospect: 0 };
  for (const g of groups) {
    totals.fast += g.fast.length;
    totals.standard += g.standard.length;
    totals.reference += g.reference.length;
    totals.prospect += g.prospect.length;
  }

  return { groups, supersededCount: superseded.length, totals };
}
