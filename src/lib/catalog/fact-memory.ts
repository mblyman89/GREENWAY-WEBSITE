/**
 * src/lib/catalog/fact-memory.ts
 *
 * SLICE S09 (bible) - KB-first at onboarding: the SERVER side of recall.
 *
 * Two batched reads, both fail-soft (this module NEVER throws - a failed read
 * means "nothing remembered", which is exactly today's behaviour):
 *
 *   1. The knowledge ladder (kb_products -> product_enrichments -> kb_strains)
 *      via loadKnowledgeIndexes + resolveKnowledgeFromIndexes - the SAME
 *      batched path the public menu uses (product-knowledge-display.ts), so a
 *      product resolves to the same record on the drafts page as on the site.
 *      That loader already tolerates a missing 0234 (lot rung retries without
 *      kb_product_id) and never throws.
 *   2. The 0235 fact-history table (PROVENANCE_TABLE - always the core's
 *      constant, never a literal), newest first, only the S09 target fields,
 *      chunked + paged by identity_key so the 0235 index
 *      (identity_key, field, created_at desc) serves it. If 0235 is not
 *      applied yet (isMissingAttachedFactsError) the history is simply empty.
 *
 * Every decision about what COUNTS is made by the pure core
 * (fact-memory-core.ts -> the S10 decide()). This file only fetches.
 *
 * No new egress, no poll, no cron: these are reads on page render and on the
 * operator's own Look up click.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { chunkedIn } from "@/lib/supabase/chunked-in";
import { loadKnowledgeIndexes } from "@/lib/ai/kb/product-knowledge-batch";
import { resolveKnowledgeFromIndexes, type KnowledgeQuery } from "@/lib/ai/kb/product-knowledge-batch-core";
import type { ProductKnowledge } from "@/lib/ai/kb/product-lookup";
import { resolveWebsiteCategoryForLot } from "@/lib/inventory/website-category-resolver-server";
import { PROVENANCE_TABLE, isMissingAttachedFactsError } from "./attach-facts-core";
import { identityForDraft } from "./product-identity-core";
import {
  MEMORY_TARGET_FIELDS,
  buildProductMemory,
  lastOnboarded,
  type OnboardedHistoryRow,
  type ProductMemory,
  type ProvenanceRecallRow,
} from "./fact-memory-core";

/** The columns recall reads (a named subset of PROVENANCE_SELECT - never *). */
export const RECALL_PROVENANCE_SELECT = "identity_key, field, value_json, source, confidence, created_at";

/** One product to recall. `id` is the caller's key (the draft id). */
export interface RecallTarget {
  id: string;
  /** The identity the memory is ABOUT (resolved website category - the page's key). */
  identityKey: string;
  query: KnowledgeQuery;
  /**
   * Every key the fact history may have been stamped under. The S07 door
   * stamps identityForDraft(row) WITHOUT the resolver's category (attach-
   * facts.ts readDraftFacts), and 0234 stamps the draft's own identity_key at
   * seeding; those can differ from the page's resolved key for the same
   * product (e.g. raw "EndProduct" vs resolved "edible-solid"). Reading only
   * one would silently miss facts the door really wrote. Blank keys are
   * dropped; identityKey is always included.
   */
  historyKeys?: readonly string[];
}

/** identityKey + historyKeys, trimmed, de-duplicated, never "". */
export function historyKeysFor(t: Pick<RecallTarget, "identityKey" | "historyKeys">): string[] {
  const out: string[] = [];
  for (const k of [t.identityKey, ...(t.historyKeys ?? [])]) {
    const v = typeof k === "string" ? k.trim() : "";
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** The KnowledgeQuery for a catalog_product_drafts row (mirrors queryFor()). */
export function knowledgeQueryForDraft(d: {
  name: string | null;
  brand_name: string | null;
  pos_product_key: string | null;
  strain_name: string | null;
}): KnowledgeQuery {
  const pos = (d.pos_product_key ?? "").trim() || null;
  return {
    productName: (d.name ?? "").trim(),
    brandName: (d.brand_name ?? "").trim() || null,
    posProductKey: pos,
    strainName: (d.strain_name ?? "").trim() || null,
    // A draft's own lot key is its pos_product_key (intake-parser: sku ?? lot
    // code), so the S24 lot rung can find a record the bridge already wrote.
    lotKeys: pos ? [pos] : [],
  };
}

type RecallRow = ProvenanceRecallRow & { identity_key: string };

/**
 * Newest-first fact history for the given identity keys, grouped by key.
 * Missing 0235 -> empty map (logged once, quietly). Any other error -> empty
 * map and a console.error (recall is an optimisation; the lookup still works).
 */
export async function loadFactHistory(identityKeys: readonly string[]): Promise<Map<string, ProvenanceRecallRow[]>> {
  const out = new Map<string, ProvenanceRecallRow[]>();
  const keys = [...new Set(identityKeys.map((k) => (k ?? "").trim()).filter((k) => k !== ""))];
  if (keys.length === 0 || !isSupabaseServiceConfigured) return out;
  try {
    const admin = createSupabaseAdminClient();
    let firstError: { code?: string | null; message?: string | null } | null = null;
    const rows = await chunkedIn<string, RecallRow>(keys, async (chunk, from, to) => {
      if (firstError) return [];
      const { data, error } = await admin
        .from(PROVENANCE_TABLE)
        .select(RECALL_PROVENANCE_SELECT)
        .in("identity_key", chunk)
        .in("field", [...MEMORY_TARGET_FIELDS])
        .order("created_at", { ascending: false })
        .range(from, to);
      if (error) {
        firstError = error;
        return [];
      }
      return (data as unknown as RecallRow[] | null) ?? [];
    });
    if (firstError) {
      if (!isMissingAttachedFactsError(firstError)) {
        console.error("[fact-memory] history read failed (recall uses the KB only):", (firstError as { message?: string }).message);
      }
      return out;
    }
    for (const r of rows) {
      const k = String(r.identity_key ?? "");
      if (!k) continue;
      const list = out.get(k) ?? [];
      list.push({ field: r.field, value_json: r.value_json, source: r.source, confidence: r.confidence, created_at: r.created_at });
      out.set(k, list);
    }
    return out;
  } catch (err) {
    console.error("[fact-memory] history read threw (recall uses the KB only):", err);
    return new Map();
  }
}

/**
 * Recall for many products (the drafts page). One ladder load + one history
 * read for the whole page. `history` is the approved-draft history the page
 * ALREADY loaded (listPriorClassifications) - "last onboarded" costs no query.
 * Never throws; a product with "" identity is never recalled (null).
 */
export async function recallProductMemories(
  targets: readonly RecallTarget[],
  history: readonly OnboardedHistoryRow[] = [],
): Promise<Map<string, ProductMemory | null>> {
  const out = new Map<string, ProductMemory | null>();
  const usable = targets.filter((t) => (t.identityKey ?? "").trim() !== "" && t.query.productName.trim() !== "");
  for (const t of targets) out.set(t.id, null);
  if (usable.length === 0) return out;
  try {
    const [indexes, factHistory] = await Promise.all([
      loadKnowledgeIndexes(usable.map((t) => t.query)),
      loadFactHistory(usable.flatMap((t) => historyKeysFor(t))),
    ]);
    for (const t of usable) {
      let knowledge: ProductKnowledge | null = null;
      try {
        knowledge = resolveKnowledgeFromIndexes(t.query, indexes);
      } catch {
        knowledge = null;
      }
      out.set(
        t.id,
        buildProductMemory({
          identityKey: t.identityKey,
          knowledge,
          provenance: historyKeysFor(t).flatMap((k) => factHistory.get(k) ?? []),
          lastSeen: lastOnboarded(t.identityKey, history),
        }),
      );
    }
    return out;
  } catch (err) {
    console.error("[fact-memory] recall failed (rows render without memory):", err);
    return out;
  }
}

/** Recall for ONE product (the Look up click). Never throws. */
export async function recallProductMemory(
  target: Omit<RecallTarget, "id">,
  history: readonly OnboardedHistoryRow[] = [],
): Promise<ProductMemory | null> {
  const m = await recallProductMemories([{ ...target, id: "one" }], history);
  return m.get("one") ?? null;
}

/** The draft columns recall needs. select("*") so a missing 0234 column is simply absent. */
type DraftRecallRow = {
  id: string;
  name: string | null;
  brand_name: string | null;
  vendor_name: string | null;
  category: string | null;
  chosen_website_category: string | null;
  inventory_type: string | null;
  strain_name: string | null;
  pos_product_key: string | null;
  identity_key?: string | null;
};

/**
 * Recall for one onboarding draft, read SERVER-SIDE by id (the client's
 * product name / brand are never trusted for identity). Identity uses the
 * same resolver the drafts page uses (resolveWebsiteCategoryForLot), so the
 * Look up click and the row chip agree. Never throws; null on any miss.
 */
export async function recallForDraft(draftId: string): Promise<ProductMemory | null> {
  const id = (draftId ?? "").trim();
  if (!id || !isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("catalog_product_drafts").select("*").eq("id", id).maybeSingle();
    if (error || !data) return null;
    const d = data as DraftRecallRow;
    const resolution = await resolveWebsiteCategoryForLot({
      posProductKey: d.pos_product_key,
      productName: d.name,
      inventoryType: d.inventory_type,
      category: d.category,
    });
    const identityKey = identityForDraft(d, { websiteCategory: resolution?.websiteCategory ?? null }).identityKey;
    return await recallProductMemory({
      identityKey,
      query: knowledgeQueryForDraft(d),
      historyKeys: [identityForDraft(d).identityKey, d.identity_key ?? ""],
    });
  } catch (err) {
    console.error("[fact-memory] draft recall failed (lookup runs as before):", err);
    return null;
  }
}
