/**
 * src/lib/catalog/lookup-history-server.ts  (R37 S6)
 *
 * The READ half of "what did past web searches find for the products on this
 * delivery?" Every decision is in lookup-history-core.ts (pure, self-tested);
 * this file only reads four existing tables and hands the rows to
 * assembleLookupHistory():
 *
 *   catalog_product_drafts (0234 identity_key)  other rows of the SAME product
 *       - on this delivery or an earlier one - so a search run months ago on
 *       last spring's delivery of the same product is found.
 *   lookup_job_items (0242)   batch searches ("Search the web for every
 *       product"), done or failed, with what each one attached / queued.
 *   audit_logs                row searches (catalog_draft.ai_lookup - the
 *       per-row AI Lookup). The batch worker never writes that audit (it logs
 *       to ai_usage only), so the two sources never double count.
 *   product_fact_provenance (0235, append-only, kept by the factory reset)
 *       the facts the web (source 'gemini') actually gave, by identity.
 *
 * Every read is ordered on a unique column and paged with .range() (never a
 * silent .limit cap), chunked for long id lists, and checked: a failed page is
 * REPORTED (complete=false, said on screen), never mistaken for "no history".
 * A table that is not there yet (migration not applied) is simply no history
 * of that kind. Never throws.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { PROVENANCE_TABLE, isMissingAttachedFactsError } from "@/lib/catalog/attach-facts-core";
import { LOOKUP_JOB_ITEMS_TABLE, isMissingLookupJobsTable } from "@/lib/catalog/lookup-job-core";
import {
  assembleLookupHistory,
  type AuditRow,
  type FoundFact,
  type HistoryTarget,
  type ItemRow,
  type PastSearch,
  type ProvenanceRow,
  type SiblingRow,
} from "@/lib/catalog/lookup-history-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type DbError = { code?: string | null; message?: string | null } | null;

/** Ids per .in() request (keeps the URL well under PostgREST limits). */
export const HISTORY_CHUNK = 150;
/** Memory ceiling per read; hitting it is reported as incomplete, never silently accepted. */
export const HISTORY_MAX_ROWS = 20_000;
/** The row-lookup audit action (ai-lookup-actions.ts). */
export const ROW_LOOKUP_AUDIT_ACTION = "catalog_draft.ai_lookup";

export type DeliveryLookupHistory =
  | { ok: true; complete: boolean; byDraft: Map<string, { searches: PastSearch[]; found: FoundFact[] }> }
  | { ok: false };

function isMissingColumn(e: DbError): boolean {
  if (!e) return false;
  if (e.code === "42703" || e.code === "PGRST204") return true;
  return /column .* does not exist|could not find the .* column/i.test(e.message ?? "");
}

/**
 * Read every row for `ids` in chunks, each chunk paged to the end.
 * Returns the rows, whether the read was complete, and the first error
 * (so the caller can tell "table missing" from "outage").
 */
async function chunkedChecked<Row>(
  ids: readonly string[],
  page: (chunk: string[], from: number, to: number) => PromiseLike<{ data: unknown; error: DbError }>,
): Promise<{ rows: Row[]; complete: boolean; error: DbError }> {
  const unique = [...new Set(ids.filter((x) => typeof x === "string" && x.trim() !== ""))];
  const rows: Row[] = [];
  let complete = true;
  let error: DbError = null;
  for (let i = 0; i < unique.length; i += HISTORY_CHUNK) {
    const chunk = unique.slice(i, i + HISTORY_CHUNK);
    const r = await pagedAllChecked<Row>(
      async (from, to) => {
        const { data, error: e } = await page(chunk, from, to);
        if (e) {
          error = error ?? e;
          return { rows: [], ok: false };
        }
        return { rows: ((data as Row[] | null) ?? []), ok: true };
      },
      { maxRows: HISTORY_MAX_ROWS },
    );
    rows.push(...r.rows);
    if (!r.verdict.complete) {
      complete = false;
      break;
    }
  }
  return { rows, complete, error };
}

async function readSiblings(admin: Admin, keys: string[]) {
  const r = await chunkedChecked<SiblingRow>(keys, (chunk, from, to) =>
    admin
      .from("catalog_product_drafts")
      .select("id, identity_key, manifest_id")
      .in("identity_key", chunk)
      .order("id", { ascending: true })
      .range(from, to),
  );
  // Before 0234 there is no identity key: no cross-delivery history, not an outage.
  if (r.error && isMissingColumn(r.error)) return { rows: [] as SiblingRow[], complete: true };
  return r;
}

async function readItems(admin: Admin, draftIds: string[]) {
  const r = await chunkedChecked<ItemRow>(draftIds, (chunk, from, to) =>
    admin
      .from(LOOKUP_JOB_ITEMS_TABLE)
      .select("id, draft_id, status, result_json, finished_at")
      .in("draft_id", chunk)
      .in("status", ["done", "failed"])
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (r.error && isMissingLookupJobsTable(r.error)) return { rows: [] as ItemRow[], complete: true };
  return r;
}

async function readAudits(admin: Admin, draftIds: string[]) {
  return chunkedChecked<AuditRow>(draftIds, (chunk, from, to) =>
    admin
      .from("audit_logs")
      .select("id, entity_id, after_json, created_at")
      .eq("entity_type", "catalog_drafts")
      .in("entity_id", chunk)
      .eq("action", ROW_LOOKUP_AUDIT_ACTION)
      .order("id", { ascending: true })
      .range(from, to),
  );
}

async function readProvenance(admin: Admin, keys: string[]) {
  const r = await chunkedChecked<ProvenanceRow>(keys, (chunk, from, to) =>
    admin
      .from(PROVENANCE_TABLE)
      .select("id, identity_key, field, created_at")
      .in("identity_key", chunk)
      .eq("source", "gemini")
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (r.error && isMissingAttachedFactsError(r.error)) return { rows: [] as ProvenanceRow[], complete: true };
  return r;
}

/**
 * Past web searches (and what they found) for the products on one delivery.
 * `targets` = the page's rows with every identity key each may be stamped
 * under. { ok:false } only when the database is not configured or the call
 * threw; partial reads come back ok with complete=false.
 */
export async function loadDeliveryLookupHistory(manifestId: string | null, targets: readonly HistoryTarget[]): Promise<DeliveryLookupHistory> {
  if (!isSupabaseServiceConfigured) return { ok: false };
  const usable = targets.filter((t) => typeof t.draftId === "string" && t.draftId.trim() !== "");
  if (usable.length === 0) return { ok: true, complete: true, byDraft: new Map() };
  try {
    const admin = createSupabaseAdminClient();
    const keys = [...new Set(usable.flatMap((t) => t.keys).filter((k): k is string => typeof k === "string" && k.trim() !== "").map((k) => k.trim()))];
    const [siblings, provenance] = await Promise.all([readSiblings(admin, keys), readProvenance(admin, keys)]);
    const draftIds = [...new Set([...usable.map((t) => t.draftId), ...siblings.rows.map((s) => s.id)].filter((x) => typeof x === "string" && x))];
    const [items, audits] = await Promise.all([readItems(admin, draftIds), readAudits(admin, draftIds)]);
    const complete = siblings.complete && provenance.complete && items.complete && audits.complete;
    if (!complete) console.error("[lookup-history] part of the search history could not be read (shown as incomplete).");
    const byDraft = assembleLookupHistory({
      manifestId,
      targets: usable,
      siblings: siblings.rows,
      items: items.rows,
      audits: audits.rows,
      provenance: provenance.rows,
    });
    return { ok: true, complete, byDraft };
  } catch (err) {
    console.error("[lookup-history] read failed (the bar shows no history):", err);
    return { ok: false };
  }
}
