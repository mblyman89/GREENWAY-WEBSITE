/**
 * src/lib/catalog/dock-to-shelf.ts
 *
 * W12 — server side of the dock-to-shelf metric (audit gap G9). Pure READS
 * of timestamps that already exist; no writes, no migrations:
 *
 *   hop 1  inbound_manifests.received_at → accepted_at
 *   hop 2  manifest accepted_at → approved draft's updated_at (the approval
 *          write is the last touch on an approved row)
 *   hop 3  draft approval → first menu version published after it
 *
 * Window: the last 90 days of manifests/drafts, so the medians reflect how
 * the pipeline runs NOW, not its whole history. Best-effort: any failure or
 * an unconfigured DB returns null and the hub simply hides the card.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  buildDockToShelfMetrics,
  type DockToShelfMetrics,
  type StampPair,
} from "@/lib/catalog/dock-to-shelf-core";

const WINDOW_DAYS = 90;

export async function getDockToShelfMetrics(): Promise<DockToShelfMetrics | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const sinceIso = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

    // Hop 1 — manifests with both stamps in the window.
    const { data: manifests } = await admin
      .from("inbound_manifests")
      .select("id, received_at, accepted_at")
      .not("received_at", "is", null)
      .not("accepted_at", "is", null)
      .gte("accepted_at", sinceIso)
      .limit(500);
    const mRows =
      (manifests as { id: string; received_at: string; accepted_at: string }[] | null) ?? [];
    const manifestPairs: StampPair[] = mRows.map((m) => ({
      startIso: m.received_at,
      endIso: m.accepted_at,
    }));
    const acceptedById = new Map(mRows.map((m) => [m.id, m.accepted_at] as const));

    // Hop 2 + 3 inputs — approved drafts in the window. For approved rows the
    // approval write is the last touch, so updated_at is the approval time.
    const { data: drafts } = await admin
      .from("catalog_product_drafts")
      .select("id, manifest_id, updated_at")
      .eq("status", "approved")
      .gte("updated_at", sinceIso)
      .limit(500);
    const dRows =
      (drafts as { id: string; manifest_id: string | null; updated_at: string }[] | null) ?? [];
    const approvalPairs: StampPair[] = [];
    for (const d of dRows) {
      const acceptedAt = d.manifest_id ? acceptedById.get(d.manifest_id) : undefined;
      if (acceptedAt) approvalPairs.push({ startIso: acceptedAt, endIso: d.updated_at });
    }
    const approvalTimes = dRows.map((d) => d.updated_at);

    // Hop 3 — published menu versions (small table; published_at is stamped
    // by the publish_menu_version RPC).
    const { data: versions } = await admin
      .from("menu_versions")
      .select("published_at")
      .not("published_at", "is", null)
      .gte("published_at", sinceIso)
      .limit(500);
    const publishedAts = ((versions as { published_at: string }[] | null) ?? []).map(
      (v) => v.published_at,
    );

    return buildDockToShelfMetrics({ manifestPairs, approvalPairs, approvalTimes, publishedAts });
  } catch (err) {
    console.error("[dock-to-shelf] metric read failed:", err);
    return null;
  }
}
