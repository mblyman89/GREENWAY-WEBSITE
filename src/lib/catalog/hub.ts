/**
 * src/lib/catalog/hub.ts
 *
 * Server-side assembler for the Catalog Hub — a one-stop overview of the whole
 * product workflow. It reads REAL counts from the existing stores (no fabricated
 * numbers): product-onboarding drafts awaiting review, enrichment gaps on the
 * live menu, and pending product-mastering suggestions.
 *
 * All data is verified from source stores; when Supabase isn't configured we
 * return a safe empty snapshot so the page still renders.
 */
import "server-only";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { countCatalogDrafts } from "@/lib/inventory/catalog-drafts";
import { getPublishedVersion, getVersionItems } from "@/lib/pos/menu-version";
import { getEnrichmentsForKeys, computeGaps, type GapFlags } from "@/lib/enrichment/store";
import { listSuggestions } from "@/lib/products/masters-store";
import { listPurchaseOrders } from "@/lib/purchasing/po-store";
import { countManifestsByStatus, listManifests } from "@/lib/inventory/intake-store";
import { classifyEta } from "@/lib/inventory/manifest-pipeline-core";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { emptyWorkQueueInputs, type WorkQueueInputs } from "@/lib/catalog/work-queue-core";

export type CatalogHubSnapshot = {
  configured: boolean;
  hasPublishedMenu: boolean;
  purchasing: {
    openPos: number;
    openValueMinor: number;
    awaitingDelivery: number;
    /** W2: draft/submitted POs the vendor hasn't seen yet (work-queue input). */
    toSend: number;
  };
  receiving: {
    inTransit: number;
    awaitingIntake: number;
    pending: number;
    /** W2: in-transit manifests whose ETA is strictly past (work-queue input). */
    overdueInTransit: number;
  };
  /** W2: accepted-but-held lots (status=quarantine, disposition=accepted). */
  heldLots: number;
  onboarding: { needsReview: number; approved: number; dismissed: number };
  enrichment: {
    total: number;
    enrichedLive: number;
    missingDescription: number;
    missingImage: number;
    missingBrandLink: number;
    avgCompletenessPct: number;
  };
  mastering: { pendingSuggestions: number };
};

function emptySnapshot(configured: boolean, hasPublishedMenu = false): CatalogHubSnapshot {
  return {
    configured,
    hasPublishedMenu,
    purchasing: { openPos: 0, openValueMinor: 0, awaitingDelivery: 0, toSend: 0 },
    receiving: { inTransit: 0, awaitingIntake: 0, pending: 0, overdueInTransit: 0 },
    heldLots: 0,
    onboarding: { needsReview: 0, approved: 0, dismissed: 0 },
    enrichment: {
      total: 0,
      enrichedLive: 0,
      missingDescription: 0,
      missingImage: 0,
      missingBrandLink: 0,
      avgCompletenessPct: 0,
    },
    mastering: { pendingSuggestions: 0 },
  };
}

/** Completeness = fraction of the three tracked signals present, as a percent. */
function completenessPct(g: GapFlags): number {
  const signals = [g.hasDescription, g.hasImage, g.hasBrandLink];
  const present = signals.filter(Boolean).length;
  return Math.round((present / signals.length) * 100);
}

/** W2: map the verified snapshot onto the work-queue's inputs (all real counts). */
export function workQueueInputsFromHub(hub: CatalogHubSnapshot): WorkQueueInputs {
  return {
    overdueInTransit: hub.receiving.overdueInTransit,
    awaitingIntake: hub.receiving.awaitingIntake,
    heldLots: hub.heldLots,
    onboardingDrafts: hub.onboarding.needsReview,
    posToSend: hub.purchasing.toSend,
    masteringSuggestions: hub.mastering.pendingSuggestions,
  };
}

/**
 * W3: gather ONLY the six verified work-queue counts (no enrichment-gap math,
 * no menu-version join) — cheap enough for the dashboard to call on every load.
 * Every source is the same one the hub/receiving pages use; on any failure a
 * count degrades to 0 (a missing flag, never a fabricated one).
 */
export async function getWorkQueueInputs(): Promise<WorkQueueInputs> {
  if (!isSupabaseServiceConfigured) return emptyWorkQueueInputs();
  const inputs = emptyWorkQueueInputs();

  // PERF-S8: the six counts are independent, so they now run in PARALLEL
  // (they used to be six serial round trips on every dashboard load). Each
  // still degrades to 0 on its own failure.
  const zero = () => 0;
  const [awaitingIntake, overdueInTransit, heldLots, onboardingDrafts, posToSend, masteringSuggestions] =
    await Promise.all([
      countManifestsByStatus().then((c) => c.awaitingIntake, zero),
      listManifests({ status: "in_transit", limit: 500 }).then(
        (rows) => rows.filter((m) => classifyEta(m.eta_date) === "overdue").length,
        zero,
      ),
      countHeldLots().catch(zero),
      countCatalogDrafts().then((c) => c.draft, zero),
      // PERF2 round 4: these two used to pull EVERY purchase order / pending
      // suggestion (select *) only to count them. Head counts return the same
      // numbers without shipping any rows.
      countRows("purchase_orders", (q) => q.in("status", ["draft", "submitted"])).catch(zero),
      countRows("product_master_suggestions", (q) => q.eq("status", "pending")).catch(zero),
    ]);
  inputs.awaitingIntake = awaitingIntake;
  inputs.overdueInTransit = overdueInTransit;
  inputs.heldLots = heldLots;
  inputs.onboardingDrafts = onboardingDrafts;
  inputs.posToSend = posToSend;
  inputs.masteringSuggestions = masteringSuggestions;
  return inputs;
}

/** Head-only count with a filter; throws on error so the caller's `zero` applies. */
async function countRows(
  table: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filter: (q: any) => any,
): Promise<number> {
  const admin = createSupabaseAdminClient();
  const { count, error } = await filter(admin.from(table).select("id", { count: "exact", head: true }));
  if (error) throw error;
  return count ?? 0;
}

/** Accepted-but-quarantined lots (Slice-107 activation gate). */
async function countHeldLots(): Promise<number> {
  const admin = createSupabaseAdminClient();
  const { count } = await admin
    .from("inventory_lots")
    .select("id", { count: "exact", head: true })
    .eq("status", "quarantine")
    .eq("disposition", "accepted");
  return count ?? 0;
}

async function loadEnrichmentSummary(publishedId: string): Promise<CatalogHubSnapshot["enrichment"]> {
  const items = await getVersionItems(publishedId);
  const keys = items.map((i) => i.source_item_id);
  const enrichments = await getEnrichmentsForKeys(keys);
  const gaps: GapFlags[] = items.map((i) => computeGaps(i, enrichments.get(i.source_item_id) ?? null));
  const total = gaps.length;
  return {
    total,
    enrichedLive: gaps.filter((g) => g.enrichmentStatus === "published").length,
    missingDescription: gaps.filter((g) => !g.hasDescription).length,
    missingImage: gaps.filter((g) => !g.hasImage).length,
    missingBrandLink: gaps.filter((g) => !g.hasBrandLink).length,
    avgCompletenessPct: total > 0 ? Math.round(gaps.reduce((sum, g) => sum + completenessPct(g), 0) / total) : 0,
  };
}

export async function getCatalogHub(): Promise<CatalogHubSnapshot> {
  if (!isSupabaseServiceConfigured) return emptySnapshot(false);

  // PERF-S8: every section below is independent; they now load in PARALLEL
  // instead of one after another. Failure handling is unchanged (each
  // section falls back to its empty value; draft counts still throw).
  const empty = emptySnapshot(true);
  const enrichmentP = getPublishedVersion().then(async (published) => ({
    hasPublishedMenu: Boolean(published),
    enrichment: published ? await loadEnrichmentSummary(published.id) : empty.enrichment,
  }));
  const purchasingP = listPurchaseOrders().then(
    (pos) => {
      const open = pos.filter((p) => ["draft", "submitted", "sent", "partial"].includes(p.status));
      return {
        openPos: open.length,
        openValueMinor: open.reduce((s, p) => s + p.subtotal_minor_units, 0),
        awaitingDelivery: pos.filter((p) => ["sent", "partial"].includes(p.status)).length,
        // W2 work-queue input: the vendor hasn't received these yet.
        toSend: pos.filter((p) => ["draft", "submitted"].includes(p.status)).length,
      };
    },
    () => empty.purchasing,
  );
  // Receiving: inbound manifests by stage; W2 overdue = in-transit past ETA.
  const receivingP = Promise.all([countManifestsByStatus(), listManifests({ status: "in_transit", limit: 500 })]).then(
    ([counts, inTransit]) => ({
      inTransit: counts.in_transit,
      awaitingIntake: counts.awaitingIntake, // received, awaiting verify & accept
      pending: counts.pending,
      overdueInTransit: inTransit.filter((m) => classifyEta(m.eta_date) === "overdue").length,
    }),
    () => empty.receiving,
  );

  const [{ hasPublishedMenu, enrichment }, draftCounts, pendingSuggestions, purchasing, receiving, heldLots] =
    await Promise.all([
      enrichmentP,
      countCatalogDrafts(),
      listSuggestions({ status: "pending" }).then((r) => r.length, () => 0),
      purchasingP,
      receivingP,
      countHeldLots().catch(() => 0),
    ]);

  return {
    configured: true,
    hasPublishedMenu,
    purchasing,
    receiving,
    heldLots,
    onboarding: {
      needsReview: draftCounts.draft,
      approved: draftCounts.approved,
      dismissed: draftCounts.dismissed,
    },
    enrichment,
    mastering: { pendingSuggestions },
  };
}
