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
import { chunkedIn, pagedAllChecked, MENU_READ_CONCURRENCY } from "@/lib/supabase/chunked-in";
import { isMissingIdentityColumnError } from "@/lib/catalog/identity-columns-core";
import { getPublishedVersion } from "@/lib/pos/menu-version";
import {
  ENRICHMENT_IDENTITY_ENV,
  enrichmentFollowsIdentityEnabled,
  enrichmentIdentityForItem,
  indexPublishedByIdentity,
  planIdentityBackfill,
  identityBackfillSummary,
  type BackfillEnrichmentRow,
  type BackfillMenuRow,
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
  // "*" already carries every survivorship column; never append to it.
  const columns = contentColumns.trim() === "*" ? "*" : mergeColumns(contentColumns, SURVIVORSHIP_COLUMNS);
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

/** The menu_items columns the S03 identity is built from (never select *). */
export const MENU_IDENTITY_COLUMNS = "source_item_id, name, product_name, brand_name, vendor_name, category";

/**
 * The storage identity of ONE published card, read from its RAW menu row
 * (not the display overlay). null when: flag off, no credentials, no
 * published version, no such card, not enough identity, or any error.
 * Used by ensureEnrichment to stamp identity_key on a row it creates or
 * finds unstamped, so new enrichments are born linked.
 */
export async function identityForCardKey(posProductKey: string): Promise<string | null> {
  const key = (posProductKey ?? "").trim();
  if (!key || !enrichmentFollowsIdentityOn() || !isSupabaseServiceConfigured) return null;
  try {
    const version = await getPublishedVersion();
    if (!version) return null;
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("menu_items")
      .select(MENU_IDENTITY_COLUMNS)
      .eq("menu_version_id", version.id)
      .eq("source_item_id", key)
      .limit(2);
    if (error || !data) return null;
    const rows = data as unknown as BackfillMenuRow[];
    // Two rows for one card key in one version would be a data fault: the
    // backfill plan's rule (conflicting rows -> no identity) applies here too.
    const ids = new Set(rows.map((r) => enrichmentIdentityForItem(r)));
    if (ids.size !== 1) return null;
    return [...ids][0] ?? null;
  } catch {
    return null;
  }
}

// --- Backfill (bible S20.2) ---------------------------------------------------------------

export type IdentityBackfillResult =
  | {
      ok: true;
      planned: number;
      stamped: number;
      failed: number;
      alreadyStamped: number;
      noCard: number;
      noIdentity: number;
      conflicts: number;
      duplicates: number;
      /** Merge suggestions (bible S20.8), one line per shared identity. */
      duplicateLines: string[];
      summary: string;
    }
  | { ok: false; error: string };

const BACKFILL_PAGE = 1000;

/**
 * "Set identity_key on existing product_enrichments from menu_items."
 * Reads EVERY published menu row (raw identity columns) and EVERY enrichment
 * row (survivorship columns only), both with a completeness verdict -- a
 * partial read refuses rather than plan on a short list. Writes are
 * conditional (`id = ? AND identity_key IS NULL`), so the run is idempotent,
 * never overwrites a stored identity, and a racing writer is harmless.
 * Runs regardless of the read flag: stamping is inert until the flag is on,
 * and it lets the owner prepare the links before switching it on.
 */
export async function runIdentityBackfill(admin?: AdminClient): Promise<IdentityBackfillResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  let client: AdminClient;
  try {
    client = admin ?? createSupabaseAdminClient();
  } catch {
    return { ok: false, error: "Supabase is not configured." };
  }
  try {
    const version = await getPublishedVersion();
    if (!version) return { ok: false, error: "No published menu yet: publish a menu first, then link products." };

    const menu = await pagedAllChecked<BackfillMenuRow>(
      async (from, to) => {
        const { data, error } = await client
          .from("menu_items")
          .select(`id, ${MENU_IDENTITY_COLUMNS}`)
          .eq("menu_version_id", version.id)
          .order("id", { ascending: true })
          .range(from, to);
        return { rows: (data as unknown as BackfillMenuRow[] | null) ?? [], ok: !error };
      },
      { pageSize: BACKFILL_PAGE },
    );
    if (!menu.verdict.complete) {
      return { ok: false, error: `Could not read the whole live menu (${menu.verdict.message}). Nothing was changed; try again.` };
    }

    let missingColumn = false;
    const enr = await pagedAllChecked<BackfillEnrichmentRow>(
      async (from, to) => {
        const { data, error } = await client
          .from("product_enrichments")
          .select(SURVIVORSHIP_COLUMNS)
          .order("id", { ascending: true })
          .range(from, to);
        if (error && isMissingIdentityColumnError("product_enrichments", error)) missingColumn = true;
        return { rows: (data as unknown as BackfillEnrichmentRow[] | null) ?? [], ok: !error };
      },
      { pageSize: BACKFILL_PAGE },
    );
    if (missingColumn) {
      return { ok: false, error: "The product identity column is not in the database yet (migration 0234). Nothing was changed." };
    }
    if (!enr.verdict.complete) {
      return { ok: false, error: `Could not read every enrichment record (${enr.verdict.message}). Nothing was changed; try again.` };
    }

    const plan = planIdentityBackfill(menu.rows, enr.rows);
    let stamped = 0;
    let failed = 0;
    for (const u of plan.updates) {
      const { data, error } = await client
        .from("product_enrichments")
        .update({ identity_key: u.identity_key })
        .eq("id", u.id)
        .is("identity_key", null)
        .select("id");
      if (error) failed += 1;
      else if (Array.isArray(data) && data.length > 0) stamped += 1;
      // 0 rows = someone stamped it first: not a failure, not ours.
    }
    for (const d of plan.duplicates) console.warn(d.logLine);
    const counts = {
      planned: plan.updates.length,
      stamped,
      failed,
      alreadyStamped: plan.alreadyStamped,
      noCard: plan.noCard,
      noIdentity: plan.noIdentity,
      conflicts: plan.conflicts.length,
      duplicates: plan.duplicates.length,
    };
    return { ok: true, ...counts, duplicateLines: plan.duplicates.map((d) => d.logLine), summary: identityBackfillSummary(counts) };
  } catch (err) {
    return { ok: false, error: `Linking failed: ${err instanceof Error ? err.message : String(err)}. Nothing further was changed.` };
  }
}
