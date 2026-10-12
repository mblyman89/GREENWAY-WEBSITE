/**
 * src/lib/inventory/import-lineage-store.ts — R50 S2b server read for
 * import-lineage-core.ts.
 *
 * ONE PostgREST read finds every manifest that can hold an import's lots (the
 * POS-IMPORT number OR raw_payload.import_id), then the pure core keeps
 * exactly the right ones. A read error THROWS: a short list would make a
 * page say "no lots" for lots that exist (never a silent skip).
 */
import "server-only";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import {
  LINEAGE_MANIFEST_SELECT,
  importManifestOr,
  manifestIdsForImport,
  type LineageManifestRow,
} from "@/lib/inventory/import-lineage-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** Manifest ids per `.in()` request (uuid lists past ~200 risk the URL limit; chunked-in.ts uses 200). */
export const LINEAGE_MANIFEST_CHUNK = 150;

/**
 * Every inventory_lots row on the given manifests: chunked by manifest id,
 * each chunk fully paged by lot id. Any failed page THROWS (fail-closed).
 * `excludeDestroyed` adds `.neq("status","destroyed")` (the received-date page's scope).
 */
export async function readLotsOnManifests<Row>(
  admin: Admin,
  manifestIds: readonly string[],
  select: string,
  opts: { excludeDestroyed?: boolean } = {},
): Promise<Row[]> {
  const out: Row[] = [];
  const ids = [...new Set(manifestIds)];
  for (let i = 0; i < ids.length; i += LINEAGE_MANIFEST_CHUNK) {
    const chunk = ids.slice(i, i + LINEAGE_MANIFEST_CHUNK);
    const read = await pagedAllChecked<Row>(async (from, to) => {
      let q = admin.from("inventory_lots").select(select).in("manifest_id", chunk);
      if (opts.excludeDestroyed) q = q.neq("status", "destroyed");
      const { data, error } = await q.order("id", { ascending: true }).range(from, to);
      return { ok: !error, rows: (data as unknown as Row[] | null) ?? [] };
    });
    if (!read.verdict.complete) throw new Error(`Could not read every lot of this import. ${read.verdict.message}`);
    out.push(...read.rows);
  }
  return out;
}

/** Every manifest id holding this import's lots (sorted). Empty when none exist. */
export async function importManifestIds(admin: Admin, importId: string): Promise<string[]> {
  const or = importManifestOr(importId);
  if (!or) throw new Error("That import id is not valid.");
  const read = await pagedAllChecked<LineageManifestRow>(async (from, to) => {
    const { data, error } = await admin
      .from("inbound_manifests")
      .select(LINEAGE_MANIFEST_SELECT)
      .or(or)
      .order("id", { ascending: true })
      .range(from, to);
    return { ok: !error, rows: (data as unknown as LineageManifestRow[] | null) ?? [] };
  });
  if (!read.verdict.complete) throw new Error(`Could not find this import's manifests. ${read.verdict.message}`);
  return manifestIdsForImport(read.rows, importId);
}
