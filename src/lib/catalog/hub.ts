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

export type CatalogHubSnapshot = {
  configured: boolean;
  hasPublishedMenu: boolean;
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

  return {
    configured: true,
    hasPublishedMenu,
    onboarding: {
      needsReview: draftCounts.draft,
      approved: draftCounts.approved,
      dismissed: draftCounts.dismissed,
    },
    enrichment,
    mastering: { pendingSuggestions },
  };
}
