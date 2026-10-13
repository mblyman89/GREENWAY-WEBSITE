import "server-only";

/**
 * src/lib/inventory/cultivera-received-flag-server.ts — R50 S3d.
 *
 * The set of manifest ids that are Cultivera migration manifests, for the
 * Inventory list's "via Cultivera" flag. One chunked lineage read of the
 * manifests the given lots sit on (the same select and predicate as the
 * classification source tab).
 *
 * FAILS SOFT, like the Leafly badge: on a read error it returns an empty
 * set, and the page falls back to the notes marker (every imported lot
 * carries it). It never invents a flag and never breaks the page.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { chunkedIn } from "@/lib/supabase/chunked-in";
import { LINEAGE_MANIFEST_SELECT, type LineageManifestRow } from "@/lib/inventory/import-lineage-core";
import { cultiveraManifestIdSet } from "@/lib/inventory/cultivera-received-flag-core";

export async function loadCultiveraManifestIds(
  lots: readonly { manifest_id?: string | null }[],
): Promise<Set<string>> {
  const ids = [...new Set(lots.map((l) => (l.manifest_id ?? "").trim()).filter((m) => m !== ""))];
  if (ids.length === 0) return new Set();
  try {
    const admin = createSupabaseAdminClient();
    let failed = false;
    const rows = await chunkedIn<string, LineageManifestRow>(ids, async (chunk, from, to) => {
      const { data, error } = await admin
        .from("inbound_manifests")
        .select(LINEAGE_MANIFEST_SELECT)
        .in("id", chunk)
        .order("id", { ascending: true })
        .range(from, to);
      if (error) {
        failed = true;
        return [];
      }
      return (data as unknown as LineageManifestRow[] | null) ?? [];
    });
    if (failed) {
      console.error("[cultivera-received-flag] manifest read failed; falling back to the notes marker");
      return new Set();
    }
    return cultiveraManifestIdSet(rows);
  } catch (e) {
    console.error("[cultivera-received-flag] manifest read threw:", e instanceof Error ? e.message : e);
    return new Set();
  }
}
