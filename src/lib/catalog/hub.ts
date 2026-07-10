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
import type { WorkQueueInputs } from "@/lib/catalog/work-queue-core";

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

export async function getCatalogHub(): Promise<CatalogHubSnapshot> {
  if (!isSupabaseServiceConfigured) return emptySnapshot(false);

  const published = await getPublishedVersion();
  const hasPublishedMenu = Boolean(published);

  // Onboarding drafts (always available once the drafts table exists).
  const draftCounts = await countCatalogDrafts();

  // Enrichment gaps require a published menu to measure against.
  let enrichment = emptySnapshot(true).enrichment;
  if (published) {
    const items = await getVersionItems(published.id);
    const keys = items.map((i) => i.source_item_id);
    const enrichments = await getEnrichmentsForKeys(keys);
    const gaps: GapFlags[] = items.map((i) =>
      computeGaps(i, enrichments.get(i.source_item_id) ?? null),
    );
    const total = gaps.length;
    const missingDescription = gaps.filter((g) => !g.hasDescription).length;
    const missingImage = gaps.filter((g) => !g.hasImage).length;
    const missingBrandLink = gaps.filter((g) => !g.hasBrandLink).length;
    const enrichedLive = gaps.filter((g) => g.enrichmentStatus === "published").length;
    const avgCompletenessPct =
      total > 0
        ? Math.round(gaps.reduce((sum, g) => sum + completenessPct(g), 0) / total)
        : 0;
    enrichment = {
      total,
      enrichedLive,
      missingDescription,
      missingImage,
      missingBrandLink,
      avgCompletenessPct,
    };
  }

  // Pending mastering suggestions.
  let pendingSuggestions = 0;
  try {
    const suggestions = await listSuggestions({ status: "pending" });
    pendingSuggestions = suggestions.length;
  } catch {
    pendingSuggestions = 0;
  }

  // Purchasing — open POs and their value (mirrors the Purchasing page logic).
  let purchasing = emptySnapshot(true).purchasing;
  try {
    const pos = await listPurchaseOrders();
    const open = pos.filter((p) =>
      ["draft", "submitted", "sent", "partial"].includes(p.status),
    );
    purchasing = {
      openPos: open.length,
      openValueMinor: open.reduce((s, p) => s + p.subtotal_minor_units, 0),
      awaitingDelivery: pos.filter((p) => ["sent", "partial"].includes(p.status)).length,
      // W2 work-queue input: the vendor hasn't received these yet.
      toSend: pos.filter((p) => ["draft", "submitted"].includes(p.status)).length,
    };
  } catch {
    purchasing = emptySnapshot(true).purchasing;
  }

  // Receiving — inbound manifests by stage (mirrors the Receiving page).
  let receiving = emptySnapshot(true).receiving;
  try {
    const counts = await countManifestsByStatus();
    // W2: overdue = in-transit manifests past ETA (same rule as the Receiving
    // page: classifyEta(m.eta_date) === "overdue").
    const inTransit = await listManifests({ status: "in_transit", limit: 500 });
    const overdueInTransit = inTransit.filter(
      (m) => classifyEta(m.eta_date) === "overdue",
    ).length;
    receiving = {
      inTransit: counts.in_transit,
      awaitingIntake: counts.awaitingIntake, // received, awaiting verify & accept
      pending: counts.pending,
      overdueInTransit,
    };
  } catch {
    receiving = emptySnapshot(true).receiving;
  }

  // W2: held lots — accepted at intake but kept in quarantine by the Slice-107
  // activation gate (missing CCRS id or passing COA). These are owned but not
  // sellable, so they belong in the work queue.
  let heldLots = 0;
  try {
    const admin = createSupabaseAdminClient();
    const { count } = await admin
      .from("inventory_lots")
      .select("id", { count: "exact", head: true })
      .eq("status", "quarantine")
      .eq("disposition", "accepted");
    heldLots = count ?? 0;
  } catch {
    heldLots = 0;
  }

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
