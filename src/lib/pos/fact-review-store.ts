/**
 * src/lib/pos/fact-review-store.ts  (PROGRAM 3 / SLICE 57)
 *
 * Server-only persistence for the golden-record exception queue
 * (pos_fact_reviews, migration 0139). The PURE bucket/CSV logic lives in
 * fact-review-core.ts; this module only reads/writes the database:
 *
 *   listFactReviews(importId)  -> saved human decisions for an import
 *   recordFactReview(...)      -> upsert one decision, and mirror it onto the
 *                                 STAGED menu_items row so publish reflects it:
 *       approve : decision logged; staged row untouched (facts stand).
 *       fix     : corrected fact columns written to the staged row with
 *                 provenance "reviewer" (Rule 2.2 - a named human source).
 *       reject  : staged row hidden with hidden_reason "reviewer_rejected"
 *                 (Rule 3.3 - documented reject, never a silent drop).
 *
 * All writes use the service-role admin client; the calling server actions
 * gate permissions (menu.import).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pagedAll } from "@/lib/supabase/chunked-in";
import type { PosFactReview } from "@/lib/pos/db-types";
import type { FactResolutionAction, FactResolutionInput, FactReviewFacts } from "@/lib/pos/fact-review-core";

/**
 * SLICE 4B: read every saved decision for an import, reporting whether the
 * read actually succeeded.
 *
 * Two defects are fixed here:
 *
 *   1. NO PAGINATION. This read was unpaged, and PostgREST silently caps a
 *      response at `db.max_rows` (1,000). These rows are what record that a
 *      human APPROVED / FIXED / REJECTED a flagged product, so on a large
 *      import the decisions past row 1,000 simply vanished -- and a review
 *      with no recorded decision counts as PENDING, which blocks the publish
 *      with a refusal the owner cannot clear (the decision IS there; the read
 *      just never returned it).
 *
 *   2. UNSTABLE ORDER. `updated_at` is not unique -- a bulk "approve all"
 *      writes many rows in the same instant. Paging an unstable order can
 *      repeat or skip rows between requests, which would corrupt the
 *      decisions in a far subtler way than losing them. Every page is now
 *      ordered by `updated_at` with `id` as a unique tiebreaker, which makes
 *      the pages a genuine partition.
 *
 * The `ok` flag exists because an empty array is ambiguous: it means both "no
 * decisions recorded" and "the read failed". The commit gate MUST tell those
 * apart -- treating a failed read as "nothing pending" is exactly the
 * fail-open SLICE 4A closes. Display screens can keep ignoring it.
 */
export async function listFactReviewsResult(
  importId: string,
): Promise<{ reviews: PosFactReview[]; ok: boolean }> {
  try {
    const admin = createSupabaseAdminClient();
    let failed = false;
    const rows = await pagedAll<PosFactReview>(async (from, to) => {
      const { data, error } = await admin
        .from("pos_fact_reviews")
        .select("*")
        .eq("import_id", importId)
        .order("updated_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to);
      if (error) {
        console.error("[fact-review-store] listFactReviews error:", error.message);
        failed = true;
        return [];
      }
      return (data as PosFactReview[] | null) ?? [];
    });
    if (failed) return { reviews: [], ok: false };
    return { reviews: rows, ok: true };
  } catch (err) {
    console.error("[fact-review-store] listFactReviews exception:", err);
    return { reviews: [], ok: false };
  }
}

/**
 * Convenience wrapper for display screens, which render whatever loaded and
 * do not need to distinguish "empty" from "failed". The publish gate must use
 * `listFactReviewsResult` instead.
 */
export async function listFactReviews(importId: string): Promise<PosFactReview[]> {
  const { reviews } = await listFactReviewsResult(importId);
  return reviews;
}

/** Adapt saved DB decisions to the pure core's resolution inputs. */
export function factReviewsToResolutions(reviews: PosFactReview[]): FactResolutionInput[] {
  return reviews.map((r) => ({
    sourceItemId: r.source_item_id,
    action: r.action,
    note: r.note,
    correctedFacts:
      r.corrected_facts_json && typeof r.corrected_facts_json === "object" && !Array.isArray(r.corrected_facts_json)
        ? (r.corrected_facts_json as Partial<FactReviewFacts>)
        : null,
  }));
}

export type RecordFactReviewInput = {
  importId: string;
  /** "pos-..." or synthetic "flag:<code>:<name>" (standalone flags have no staged row). */
  sourceItemId: string;
  action: FactResolutionAction;
  note: string | null;
  correctedFacts: Partial<FactReviewFacts> | null;
  reviewedBy: string | null;
};

/**
 * camelCase fact key -> menu_items column name (0138 columns + display strings,
 * plus the two SLICE 16 / migration 0216 columns).
 *
 * Record<keyof FactReviewFacts, string> is load-bearing: adding a field to
 * FactReviewFacts without adding it here is a COMPILE error, not a silent
 * drop. That is why a reviewer's low-THC decision cannot fail to persist.
 */
const FACT_COLUMN: Record<keyof FactReviewFacts, string> = {
  thc: "thc",
  cbd: "cbd",
  servingsPerPack: "servings_per_pack",
  mgPerServing: "mg_per_serving",
  packageThcMg: "package_thc_mg",
  packageCbdMg: "package_cbd_mg",
  ratioLabel: "ratio_label",
  netWeightGrams: "net_weight_grams",
  netVolumeMl: "net_volume_ml",
  lowThcLiquid: "low_thc_liquid",
  unitThcMg: "unit_thc_mg",
};

export async function recordFactReview(input: RecordFactReviewInput): Promise<void> {
  const admin = createSupabaseAdminClient();

  // 1. Upsert the decision (latest wins per import+row).
  const { error: upsertErr } = await admin.from("pos_fact_reviews").upsert(
    {
      import_id: input.importId,
      source_item_id: input.sourceItemId,
      action: input.action,
      note: input.note,
      corrected_facts_json: input.action === "fix" ? input.correctedFacts ?? {} : null,
      reviewed_by: input.reviewedBy,
    },
    { onConflict: "import_id,source_item_id" },
  );
  if (upsertErr) throw new Error(`Failed to save the review decision: ${upsertErr.message}`);

  // 2. Mirror the decision onto the STAGED menu_items row (synthetic flag
  // ids have no staged row - the decision log alone is the record).
  if (input.sourceItemId.startsWith("flag:")) return;
  const { data: versions, error: vErr } = await admin
    .from("menu_versions")
    .select("id")
    .eq("import_id", input.importId);
  if (vErr || !versions || versions.length === 0) return; // decision saved; nothing staged to mirror onto
  const versionIds = versions.map((v) => (v as { id: string }).id);

  if (input.action === "fix" && input.correctedFacts) {
    const update: Record<string, unknown> = {};
    const provenancePatch: Record<string, string> = {};
    for (const [key, value] of Object.entries(input.correctedFacts)) {
      const column = FACT_COLUMN[key as keyof FactReviewFacts];
      if (!column || value === undefined) continue;
      update[column] = value;
      provenancePatch[column] = "reviewer";
    }
    if (Object.keys(update).length === 0) return;
    // Merge provenance per row (read-modify-write; single-reviewer tool).
    const { data: rows, error: rErr } = await admin
      .from("menu_items")
      .select("id, fact_provenance")
      .in("menu_version_id", versionIds)
      .eq("source_item_id", input.sourceItemId);
    if (rErr) throw new Error(`Failed to load the staged item: ${rErr.message}`);
    for (const row of (rows ?? []) as { id: string; fact_provenance: unknown }[]) {
      const existing =
        row.fact_provenance && typeof row.fact_provenance === "object" && !Array.isArray(row.fact_provenance)
          ? (row.fact_provenance as Record<string, string>)
          : {};
      const { error: uErr } = await admin
        .from("menu_items")
        .update({ ...update, fact_provenance: { ...existing, ...provenancePatch } })
        .eq("id", row.id);
      if (uErr) throw new Error(`Failed to apply the fix to the staged item: ${uErr.message}`);
    }
  } else if (input.action === "reject") {
    const { error: hErr } = await admin
      .from("menu_items")
      .update({ hidden: true, hidden_reason: "reviewer_rejected" })
      .in("menu_version_id", versionIds)
      .eq("source_item_id", input.sourceItemId);
    if (hErr) throw new Error(`Failed to hide the rejected item: ${hErr.message}`);
  }

  // Reversibility: a later approve/fix must clear a PRIOR reviewer reject -
  // but ONLY the reviewer's own hide. Rows hidden by the transformer
  // (no_product_master / no_inventory) are never un-hidden here.
  if (input.action === "approve" || input.action === "fix") {
    const { error: unErr } = await admin
      .from("menu_items")
      .update({ hidden: false, hidden_reason: null })
      .in("menu_version_id", versionIds)
      .eq("source_item_id", input.sourceItemId)
      .eq("hidden_reason", "reviewer_rejected");
    if (unErr) throw new Error(`Failed to restore the previously rejected item: ${unErr.message}`);
  }
}
