/**
 * src/lib/enrichment/enrichment-identity-server.ts   (Round 20, slice S20, server half)
 *
 * The ONLY place ENRICHMENT_FOLLOWS_IDENTITY is read from process.env (the
 * env-ledger rule: actions and pages never read env; they call this). Also
 * holds the one identity-indexed read of product_enrichments that every
 * reader shares, so the batched menu ladder, the per-item lookup and the
 * admin detail page all borrow the SAME survivor.
 *
 * Fail-closed toward "pre-S20": a database without migration 0234
 * (identity_key unknown), any read error, or the flag off -> an empty map,
 * and every reader behaves exactly as before S20.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { chunkedIn, MENU_READ_CONCURRENCY } from "@/lib/supabase/chunked-in";
import { isMissingIdentityColumnError } from "@/lib/catalog/identity-columns-core";
import {
  ENRICHMENT_IDENTITY_ENV,
  enrichmentFollowsIdentityEnabled,
  indexPublishedByIdentity,
  type IdentityCandidate,
} from "./enrichment-identity-core";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

/** S20 rollback lever: off = every read and write is exactly pre-S20. */
export function enrichmentFollowsIdentityOn(): boolean {
  return enrichmentFollowsIdentityEnabled(process.env[ENRICHMENT_IDENTITY_ENV]);
}

const CHUNK_SIZE = 300;

/** The survivorship columns, appended to whatever content columns a reader needs. */
const SURVIVORSHIP_COLUMNS = "id, pos_product_key, status, updated_at, identity_key";

/** Named column lists joined with each column once (order kept, first wins). */
export function mergeColumns(...lists: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const c of list.split(",")) {
      const t = c.trim();
      if (t && !seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
  }
  return out.join(", ");
}

/**
 * PUBLISHED product_enrichments for these identities, one survivor per
 * identity (published, newest updated_at, smallest id). `contentColumns` is
 * the reader's own named column list (never select *). Duplicates are
 * logged once per identity as a merge suggestion (bible S20.8).
 *
 * Returns an empty map when: the flag is off, no identities, no service
 * credentials, identity_key is missing (pre-0234), or any read error.
 */
export async function loadPublishedEnrichmentsByIdentity<T extends IdentityCandidate>(
  identityKeys: readonly string[],
  contentColumns: string,
  admin?: AdminClient,
): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  if (!enrichmentFollowsIdentityOn()) return out;
  const keys = [...new Set(identityKeys.map((k) => (typeof k === "string" ? k.trim() : "")).filter(Boolean))];
  if (keys.length === 0 || !isSupabaseServiceConfigured) return out;
  let client: AdminClient;
  try {
    client = admin ?? createSupabaseAdminClient();
  } catch {
    return out;
  }
  const columns = mergeColumns(contentColumns, SURVIVORSHIP_COLUMNS);
  try {
    const rows = await chunkedIn<string, T>(
      keys,
      async (chunk, from, to) => {
        const { data, error } = await client
          .from("product_enrichments")
          .select(columns)
          .in("identity_key", chunk)
          .eq("status", "published")
          .order("id", { ascending: true })
          .range(from, to);
        if (error) {
          if (isMissingIdentityColumnError("product_enrichments", error)) return [];
          throw new Error(error.message);
        }
        return (data as unknown as T[] | null) ?? [];
      },
      // Disjoint key chunks folded into a Map by survivorship: overlap-safe.
      { chunkSize: CHUNK_SIZE, concurrency: MENU_READ_CONCURRENCY },
    );
    for (const [id, { row, duplicates }] of indexPublishedByIdentity(rows)) {
      out.set(id, row);
      if (duplicates > 0) {
        console.warn(
          `[enrichment-identity] ${duplicates + 1} published enrichment rows share product identity "${id}"; ` +
            `serving ${row.pos_product_key}; merge suggested.`,
        );
      }
    }
    return out;
  } catch (err) {
    console.error("[enrichment-identity] identity read failed:", err instanceof Error ? err.message : err);
    return new Map();
  }
}
