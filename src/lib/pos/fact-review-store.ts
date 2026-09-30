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
import { isFactReviewMigrationMissing, type IntakeFactAction } from "@/lib/pos/intake-fact-review-core";
import { mirrorTargetVersionIds, type MirrorVersionRow } from "@/lib/pos/publish-now-core";

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
  otherwiseTaken: "otherwise_taken",
  unitsPerPackage: "units_per_package",
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
  // R14a: this import's versions PLUS the live/staged intake-origin versions
  // that carry its cards forward by source_item_id (publish-now-core
  // mirrorTargetVersionIds). Without them a fix made after the first
  // received delivery landed on an archived version and never reached the
  // website -- which "publish now, fix after" depends on.
  // Two plain reads (no filter string built from form input).
  const [own, carried] = await Promise.all([
    admin.from("menu_versions").select("id, import_id, status").eq("import_id", input.importId),
    admin
      .from("menu_versions")
      .select("id, import_id, status")
      .is("import_id", null)
      .in("status", ["published", "staged"]),
  ]);
  if (own.error || !own.data || own.data.length === 0) return; // decision saved; nothing staged to mirror onto
  // A failed carried read is REPORTED, never silently skipped: the decision is
  // saved, but the live card would keep the old value and the owner must know.
  if (carried.error) {
    throw new Error(
      `The decision was saved, but the live menu could not be read to apply it (${carried.error.message}). Save it again.`,
    );
  }
  const versionIds = mirrorTargetVersionIds(
    [...(own.data as MirrorVersionRow[]), ...((carried.data ?? []) as MirrorVersionRow[])],
    input.importId,
  );
  if (versionIds.length === 0) return;

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

// ---------------------------------------------------------------------------
// S30: receiving-origin decisions (scoped by manifest, migration 0237)
// ---------------------------------------------------------------------------
//
// A received delivery never has a pos_imports row, so its fact flags could
// not be decided anywhere (bible S30, F-094/F-095). These two functions store
// and read decisions keyed by (manifest_id, source_item_id) instead. They do
// NOT mirror onto menu_items: the receiving staging module re-plans the
// delivery and APPLIES the decision to the snapshot it builds
// (intake-fact-review-core applyFactDecisions), so the decision reaches the
// menu through the same single door every other receiving change uses.
//
// Before 0237 is applied both are no-ops that say so (never throw for that).

export type IntakeFactReviewRow = PosFactReview & {
  manifest_id: string | null;
  draft_id: string | null;
  flag_signature: string | null;
};

/** The named columns a receiving decision read needs (no select *). */
export const INTAKE_FACT_REVIEW_COLUMNS =
  "id, manifest_id, draft_id, source_item_id, flag_signature, action, note, corrected_facts_json, reviewed_by, updated_at";

/**
 * Every saved decision for one delivery, paged with a unique tiebreaker.
 * `ok` false = the read failed (callers MUST fail closed: keep the hold).
 * `migrated` false = 0237 is not applied (ok is false too: nothing can be
 * trusted as "decided").
 */
export async function listIntakeFactReviewsResult(
  manifestId: string,
): Promise<{ reviews: IntakeFactReviewRow[]; ok: boolean; migrated: boolean }> {
  try {
    const admin = createSupabaseAdminClient();
    let failed = false;
    let missing = false;
    const rows = await pagedAll<IntakeFactReviewRow>(async (from, to) => {
      const { data, error } = await admin
        .from("pos_fact_reviews")
        .select(INTAKE_FACT_REVIEW_COLUMNS)
        .eq("manifest_id", manifestId)
        .order("updated_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to);
      if (error) {
        if (isFactReviewMigrationMissing(error)) missing = true;
        else console.error("[fact-review-store] listIntakeFactReviews error:", error.message);
        failed = true;
        return [];
      }
      return (data as IntakeFactReviewRow[] | null) ?? [];
    });
    if (failed) return { reviews: [], ok: false, migrated: !missing };
    return { reviews: rows, ok: true, migrated: true };
  } catch (err) {
    console.error("[fact-review-store] listIntakeFactReviews exception:", err);
    return { reviews: [], ok: false, migrated: true };
  }
}

export type RecordIntakeFactReviewInput = {
  manifestId: string;
  draftId: string | null;
  /** The lot key the flag is about (the flag's context.pos_product_key). */
  sourceItemId: string;
  /** Which flag this answers (intake-fact-review-core flagSignature). */
  flagSignature: string;
  action: IntakeFactAction;
  note: string | null;
  correctedFacts: Partial<FactReviewFacts> | null;
  reviewedBy: string | null;
};

/**
 * Upsert one receiving decision (latest wins per delivery + lot key, the
 * 0237 UNIQUE constraint). import_id is written as NULL explicitly: the 0237
 * CHECK requires exactly one scope. Returns applied:false with the reason
 * "migration-0237-not-applied" before the migration; throws on a real error.
 */
export async function recordIntakeFactReview(
  input: RecordIntakeFactReviewInput,
): Promise<{ applied: true } | { applied: false; reason: "migration-0237-not-applied" }> {
  if (!input.manifestId || !input.sourceItemId || !input.flagSignature) {
    throw new Error("A receiving fact decision needs a delivery, a product key and the flag it answers.");
  }
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("pos_fact_reviews").upsert(
    {
      import_id: null,
      manifest_id: input.manifestId,
      draft_id: input.draftId,
      source_item_id: input.sourceItemId,
      flag_signature: input.flagSignature,
      action: input.action,
      note: input.note,
      corrected_facts_json: input.action === "fix" ? input.correctedFacts ?? {} : null,
      reviewed_by: input.reviewedBy,
    },
    { onConflict: "manifest_id,source_item_id" },
  );
  if (error) {
    if (isFactReviewMigrationMissing(error)) return { applied: false, reason: "migration-0237-not-applied" };
    throw new Error(`Failed to save the review decision: ${error.message}`);
  }
  return { applied: true };
}
