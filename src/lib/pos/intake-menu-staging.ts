/**
 * src/lib/pos/intake-menu-staging.ts
 *
 * Intake auto-carry + AUTO-PUBLISH (owner-approved Option 1) — SERVER executor.
 *
 * When a manifest is accepted, this stages a NEW menu version made of every
 * currently-published item (carried forward) plus the manifest's APPROVED
 * onboarding products, WITHOUT any Cultivera "Menu Imports" (POS-export)
 * upload. The pure planner (intake-menu-staging-core) makes every decision;
 * this module only gathers DB rows + enrichment and writes the result.
 *
 * ORIGIN: the new row has `import_id = NULL` (an intake-origin version — legal
 * per migration 0002, no schema change) and `summary_json.origin = "intake"`
 * with the source manifest id + the planner diagnostics, so the review surface
 * can show what was carried / added / skipped WITHOUT a pos_imports row.
 *
 * AUTO-PUBLISH: the human review already happened item-by-item at draft
 * approval (price set + Approve pressed on Product Onboarding) — that IS the
 * go-live decision, so after staging succeeds the version is published
 * immediately via the same gated `publish_menu_version` RPC the Menu Imports
 * page uses (atomic swap; archives the previously-published version). On a
 * publish hiccup the STAGED version remains and lands on Menu Imports as the
 * manual fallback — nothing can be silently lost. After a successful publish,
 * every OLDER staged version of any origin (built from an older live snapshot
 * — publishing one would DROP newer products) is archived with a reason by
 * the one S15 rule (archiveSupersededStaged, same rule as migration 0236).
 *
 * BEST-EFFORT: called from finalizeManifestDispositions AFTER lots activate and
 * drafts are seeded, and from approveDraftWithPrice after each approval. Any
 * failure logs and returns a skipped result; it must NEVER fail the manifest
 * finalize or the draft approval. No-op when Supabase isn't configured or the
 * manifest has no APPROVED drafts to carry.
 */
import "server-only";
import { revalidatePath } from "next/cache";
import { revalidatePublicMenuSurfaces } from "@/lib/site/public-surfaces";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { strainSlug } from "@/lib/catalog/slug-core";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { recordAudit } from "@/lib/auth/audit";
import { archiveSupersededStaged } from "@/lib/pos/menu-version";
import {
  WAITING_VERSION_READ_LIMIT,
  WAITING_VERSION_SELECT,
  pickWaitingVersion,
  type WaitingMenuVersion,
  type WaitingVersionRow,
} from "@/lib/pos/menu-waiting-link-core";
// S30: receiving fact review - saved decisions resolve (and are applied to)
// the flags that would otherwise hold this update.
import { listIntakeFactReviewsResult } from "@/lib/pos/fact-review-store";
import {
  FACT_FLAG_CODE,
  RETIRED_REASON_PREFIX,
  applyFactDecisions,
  factHoldNote,
  partitionFactFlags,
  planHeldRetire,
  type FactPartition,
  type HeldCandidate,
} from "@/lib/pos/intake-fact-review-core";
import { mergeArchivedSummary } from "@/lib/pos/publish-archive-rule-core";
import { shouldHoldForCutover } from "@/lib/pos/cutover-guard";
import { CUTOVER_EVENT, CUTOVER_HOLD_COPY, CUTOVER_REASON } from "@/lib/inventory/cutover-guard-core";
import { resolveWebsiteCategories } from "@/lib/inventory/website-category-resolver-server";
// SLICE 93: kb > manifest fact > confident name parse - one folded verdict.
import {
  suggestStrainType,
  STRAIN_TYPE_AUTO_MIN_CONFIDENCE,
} from "@/lib/inventory/strain-type-intel-core";
import {
  buildIntakeStagedVersionPlan,
  carryForwardIncompleteNote,
  carryForwardVerdict,
  CARRY_FORWARD_INCOMPLETE_EVENT,
  CARRY_FORWARD_INCOMPLETE_REASON,
  type CarryForwardItem,
} from "@/lib/pos/intake-menu-staging-core";
// S19: vendor-id identity for the restock match (bounded reads, flag).
import { VENDOR_ID_IDENTITY_ENV, vendorIdIdentityEnabled } from "@/lib/inventory/vendor-identity-core";
import { loadVendorIdInputs } from "@/lib/inventory/restock-preview-server";
import { chunkedIn, pagedAll } from "@/lib/supabase/chunked-in";
// S32: remembered answers for products that matched 2+ live cards.
import { loadMergeDecisions } from "@/lib/pos/merge-decision-store";
import { mergeAmbiguousIdentities } from "@/lib/pos/merge-review-core";
import { lotPackageLabel, type MergeDecision } from "@/lib/pos/intake-mastering-core";
import type { ApprovedDraftForInjection, DraftEnrichment } from "@/lib/pos/draft-injection-core";
// S01: self-describing intake versions (manifest header + publish outcome +
// humanised notes). Pure; see the file header for where the truth lives.
import {
  buildIntakeVersionNotes,
  buildManifestHeader,
  failedPublishOutcome,
  initialPublishOutcome,
} from "@/lib/pos/intake-version-copy-core";
// S17: one menu version per approve batch (coalesce + batch notes). Pure.
import {
  BATCH_STAGING_ENV,
  batchNotesSuffix,
  batchStagingEnabled,
  draftIdList,
  planRestageReplace,
  replacedSummary,
  restageWindowStartIso,
  type RestageCandidate,
} from "@/lib/inventory/batch-staging-core";
import type { MenuItemRow, MenuVariantRow, MenuVersion } from "@/lib/pos/db-types";
// SLICE S12: the golden record (attached facts, compliance-cleared).
import { loadGoldenInputs } from "@/lib/catalog/golden-record-server";
import {
  insertMenuItemsWithKbLink,
  logMenuKbLinkPlan,
  planMenuKbLinksForCards,
} from "@/lib/catalog/menu-kb-link-server";

export type IntakeStagingOutcome = {
  /** True when a staged version was created. */
  staged: boolean;
  /** True when the version also went LIVE (auto-publish succeeded). */
  published: boolean;
  /** The new version id (when staged). */
  versionId: string | null;
  carried: number;
  added: number;
  /** Restock variants merged into existing live cards (product mastering). */
  merged: number;
  /** Why nothing was staged (for the timeline note). */
  reason?: string;
};

/**
 * S17: `batchCount` = how many drafts one "Approve all priced" click just
 * approved, so the version notes count the batch. Absent for a single approve.
 */
export type IntakeStagingOptions = { batchCount?: number };

const ITEM_BATCH = 250;
const VARIANT_BATCH = 500;

/**
 * Stage an intake-origin menu version from a freshly-accepted manifest's
 * APPROVED onboarding products. Returns an outcome the caller can log; never
 * throws.
 */
export async function stageIntakeMenuVersionForManifest(
  manifestId: string,
  actorId: string | null,
  opts: IntakeStagingOptions = {},
): Promise<IntakeStagingOutcome> {
  const skip = (reason: string): IntakeStagingOutcome => ({
    staged: false,
    published: false,
    versionId: null,
    carried: 0,
    added: 0,
    merged: 0,
    reason,
  });

  if (!isSupabaseServiceConfigured) return skip("supabase-not-configured");
  const admin = createSupabaseAdminClient();

  // S19: the live menu could not be read whole -> build nothing, say why on
  // the delivery's timeline (approvals stay saved; the live menu is untouched).
  const carryForwardIncomplete = async (missing: number | null): Promise<IntakeStagingOutcome> => {
    try {
      await admin.from("manifest_events").insert({
        manifest_id: manifestId,
        event_type: CARRY_FORWARD_INCOMPLETE_EVENT,
        note: carryForwardIncompleteNote({ missing }),
        actor_id: actorId,
      });
    } catch (err) {
      console.error("[intake-menu-staging] carry-forward note insert failed:", err);
    }
    return skip(CARRY_FORWARD_INCOMPLETE_REASON);
  };

  try {
    // 1) APPROVED onboarding drafts for THIS manifest. Only human-approved,
    //    priced products are eligible (price set at approval from intake data);
    //    unapproved/dismissed drafts are ignored.
    // SLICE 64: also read the approver's classification picks (migration
    // 0141); on databases where 0141 hasn't run yet retry WITHOUT them.
    const DRAFT_COLS =
      "id, pos_product_key, name, brand_name, vendor_name, strain_name, thc_pct, cbd_pct, total_thc_pct, potency_json, price_minor_units, updated_at, lot_id, inventory_type, category";
    // SLICE 93: also read the approver's strain-type pick (migration 0146).
    // Graduated fallback so each missing migration only costs ITS columns:
    // 0141+0146 -> 0141 only -> none.
    const missingCol = (e: { code?: string; message?: string } | null) =>
      Boolean(
        e &&
          (e.code === "42703" ||
            /column .* does not exist|could not find .* column/i.test(e.message ?? "")),
      );
    // R19 (defect found while building S12): this read never selected the
    // approver's COMPLIANCE answers (0218) or the measured package volume
    // (0224), although SLICE 18G made masteredToSnapshot and the insert
    // below carry them. So a product approved at Product Onboarding reached
    // the menu row - the only surface the register enforces from - with all
    // four limit columns NULL and no measured volume. Same widest tier and
    // graduated fallback as draft-injection.ts: a database missing 0218/0224
    // loses ONLY those columns and stages exactly as before.
    const COMPLIANCE_COLS =
      ", chosen_otherwise_taken, chosen_units_per_package, chosen_low_thc_liquid, chosen_unit_thc_mg" +
      ", chosen_net_volume_ml";
    const withCompliance = await admin
      .from("catalog_product_drafts")
      .select(DRAFT_COLS + ", chosen_website_category, chosen_house_type, chosen_strain_type" + COMPLIANCE_COLS)
      .eq("manifest_id", manifestId)
      .eq("status", "approved");
    const firstTry = missingCol(withCompliance.error)
      ? await admin
          .from("catalog_product_drafts")
          .select(DRAFT_COLS + ", chosen_website_category, chosen_house_type, chosen_strain_type")
          .eq("manifest_id", manifestId)
          .eq("status", "approved")
      : withCompliance;
    let draftRows: unknown = firstTry.data;
    let dErr = firstTry.error;
    if (missingCol(dErr)) {
      const secondTry = await admin
        .from("catalog_product_drafts")
        .select(DRAFT_COLS + ", chosen_website_category, chosen_house_type")
        .eq("manifest_id", manifestId)
        .eq("status", "approved");
      draftRows = secondTry.data;
      dErr = secondTry.error;
      if (missingCol(dErr)) {
        const retry = await admin
          .from("catalog_product_drafts")
          .select(DRAFT_COLS)
          .eq("manifest_id", manifestId)
          .eq("status", "approved");
        draftRows = retry.data;
        dErr = retry.error;
      }
    }
    if (dErr) {
      console.error("[intake-menu-staging] drafts read failed:", dErr.message);
      return skip("drafts-read-failed");
    }
    type DraftRow = ApprovedDraftForInjection & {
      lot_id: string | null;
      inventory_type: string | null;
      category: string | null;
      chosen_website_category?: string | null;
      chosen_house_type?: string | null;
      chosen_strain_type?: string | null;
      // 0218 / 0224 (R19). Absent when the migration hasn't run.
      chosen_otherwise_taken?: boolean | null;
      chosen_units_per_package?: number | string | null;
      chosen_low_thc_liquid?: boolean | null;
      chosen_unit_thc_mg?: number | string | null;
      chosen_net_volume_ml?: number | string | null;
    };
    const drafts = ((draftRows as DraftRow[] | null) ?? []).map((r) => ({
      ...r,
      thc_pct: r.thc_pct != null ? Number(r.thc_pct) : null,
      cbd_pct: r.cbd_pct != null ? Number(r.cbd_pct) : null,
      total_thc_pct: r.total_thc_pct != null ? Number(r.total_thc_pct) : null,
      price_minor_units: r.price_minor_units != null ? Number(r.price_minor_units) : null,
      // numerics arrive from PostgREST as strings; Number(null) is 0, which
      // would invent a unit count / volume. null stays null, explicitly.
      chosen_units_per_package:
        r.chosen_units_per_package != null ? Number(r.chosen_units_per_package) : null,
      chosen_unit_thc_mg: r.chosen_unit_thc_mg != null ? Number(r.chosen_unit_thc_mg) : null,
      chosen_net_volume_ml: r.chosen_net_volume_ml != null ? Number(r.chosen_net_volume_ml) : null,
    }));
    if (drafts.length === 0) return skip("no-approved-drafts");

    // 2) Currently-published version + its items (carry-forward snapshot). When
    //    nothing is live yet, the staged version is just the intake products.
    const { data: publishedRow, error: pubErr } = await admin
      .from("menu_versions")
      .select("*")
      .eq("status", "published")
      .limit(1)
      .maybeSingle();
    // S19: a FAILED read is not "nothing is live" - treating it so would stage
    // (and auto-publish) a menu of only this delivery. Fail closed instead.
    if (pubErr) {
      console.error("[intake-menu-staging] published version read failed:", pubErr.message);
      return await carryForwardIncomplete(null);
    }
    const published = (publishedRow as MenuVersion | null) ?? null;
    let publishedItems: CarryForwardItem[] = [];
    // R25 C: the live cards' existing KB links, kept fill-only on the restage.
    let priorKbLinks = new Map<string, string>();
    if (published) {
      // S19 (latent defect, fixed fail-closed): the carry-forward must be the
      // WHOLE live menu - the staged snapshot replaces it on auto-publish.
      const carry = await loadCarryForwardItems(published.id);
      const verdict = carryForwardVerdict(carry);
      if (!verdict.complete) {
        console.error(
          `[intake-menu-staging] carry-forward incomplete (read ${carry.rowsRead} of ${carry.expectedTotal ?? "?"}; failed=${carry.readFailed}) - not staging.`,
        );
        return await carryForwardIncomplete(verdict.missing);
      }
      publishedItems = carry.items;
      priorKbLinks = carry.priorKbLinks;
    }

    // 3) Enrichment (same sources as draft-injection.ts): website category via
    //    the house resolver, curated strain type from kb_strains, and the
    //    source lot's on-hand + package label from inventory_lots.
    const resolutions = await resolveWebsiteCategories(
      drafts.map((d) => ({
        posProductKey: d.pos_product_key,
        productName: d.name,
        inventoryType: d.inventory_type,
        category: d.category,
      })),
    );

    const strainTypeBySlug = new Map<string, string>();
    const slugs = Array.from(
      new Set(
        drafts
          .map((d) => strainSlug(d.strain_name))
          .filter(Boolean),
      ),
    );
    if (slugs.length) {
      const { data: strains } = await admin
        .from("kb_strains")
        .select("slug, strain_type")
        .in("slug", slugs);
      for (const s of (strains as { slug: string; strain_type: string | null }[] | null) ?? []) {
        if (s.strain_type) strainTypeBySlug.set(s.slug, s.strain_type);
      }
    }

    const lotById = new Map<
      string,
      { on_hand_qty: number; unit_weight: number | null; unit_weight_uom: string | null; strain_type: string | null }
    >();
    const lotIds = Array.from(
      new Set(drafts.map((d) => d.lot_id).filter((v): v is string => Boolean(v))),
    );
    if (lotIds.length) {
      const { data: lots } = await admin
        .from("inventory_lots")
        .select("id, on_hand_qty, unit_weight, unit_weight_uom, strain_type")
        .in("id", lotIds);
      for (const l of (lots as
        | {
            id: string;
            on_hand_qty: number;
            unit_weight: number | null;
            unit_weight_uom: string | null;
            strain_type: string | null;
          }[]
        | null) ?? []) {
        lotById.set(l.id, l);
      }
    }

    // SLICE S12: one bounded read of the drafts' attached facts (0235), the
    // description linted server-side. Flag off / 0235 missing / read failed
    // = empty map = the placeholder sentence, exactly as before.
    const goldenByDraftId = await loadGoldenInputs(admin, drafts.map((d) => d.id));
    const enrichmentByDraftId = new Map<string, DraftEnrichment>();
    drafts.forEach((d, i) => {
      const lot = d.lot_id ? lotById.get(d.lot_id) ?? null : null;
      const slug = strainSlug(d.strain_name);
      const rawStrainType = slug ? strainTypeBySlug.get(slug) ?? null : null;
      // SLICE 93: the curated KB still leads, but the manifest's stated fact
      // (inventory_lots.strain_type) and a confident name parse now fill the
      // gap - only >=90% signals; below the bar stays null (never guessed).
      const suggestion = suggestStrainType({
        kbStrainType: rawStrainType,
        lotStrainType: lot?.strain_type ?? null,
        productName: d.name,
      });
      const auto =
        suggestion && suggestion.confidence >= STRAIN_TYPE_AUTO_MIN_CONFIDENCE
          ? suggestion.value
          : null;
      enrichmentByDraftId.set(d.id, {
        websiteCategory: resolutions[i]?.websiteCategory ?? null,
        strainType: auto && auto !== "unknown" ? auto : null,
        onHandQty: lot ? Number(lot.on_hand_qty ?? 0) : null,
        packageLabel: lotPackageLabel(lot),
        ...(goldenByDraftId.get(d.id) ?? {}),
      });
    });

    // S19: vendor ids for the restock match - only when the flag is on and
    // something is live; ONLY the lots that could change a match are read
    // (planVendorIdLookup); any failed read = no ids = the name rule.
    const vendorIds =
      publishedItems.length > 0 && vendorIdIdentityEnabled(process.env[VENDOR_ID_IDENTITY_ENV])
        ? await loadVendorIdInputs(admin, {
            drafts: drafts.map((d, i) => ({
              id: d.id,
              pos_product_key: d.pos_product_key,
              name: d.name,
              brand_name: d.brand_name,
              vendor_name: d.vendor_name,
              strain_name: d.strain_name,
              category: d.chosen_website_category?.trim() || resolutions[i]?.websiteCategory || null,
            })),
            liveCards: publishedItems.map((it) => ({
              source_item_id: it.source_item_id,
              name: it.name,
              brand_name: it.brand_name,
              vendor_name: it.vendor_name,
              category: it.category,
              strain_name: it.strain_name,
              hidden: it.hidden,
              variants: it.variants.map((v) => ({ source_variant_id: v.source_variant_id, medical: v.medical })),
            })),
          })
        : undefined;

    // 4) Pure plan.
    const firstPlan = buildIntakeStagedVersionPlan({
      publishedItems,
      approvedDrafts: drafts,
      enrichmentByDraftId,
      vendorIds,
    });
    // S32: a remembered "join card X" / "keep separate" answer can only apply
    // where the planner raised merge_ambiguous (2+ live matches), so read the
    // saved answers for exactly those identities - zero reads otherwise - and
    // plan again with them. Any failed read (or 0239 not applied) = no
    // answers = the first plan, byte for byte. A stale answer is never
    // applied (intake-mastering-core mergeDecisionVerdict).
    const ambiguousIdentities = mergeAmbiguousIdentities(firstPlan.diagnostics);
    const mergeDecisions =
      ambiguousIdentities.length > 0 ? await loadMergeDecisions(ambiguousIdentities) : new Map<string, MergeDecision>();
    const plan =
      mergeDecisions.size > 0
        ? buildIntakeStagedVersionPlan({
            publishedItems,
            approvedDrafts: drafts,
            enrichmentByDraftId,
            vendorIds,
            mergeDecisions,
          })
        : firstPlan;

    // S30: settle the fact flags against the decisions a human saved for this
    // delivery (Product Onboarding -> Approved). ONE paged read, and only
    // when the plan raised a flag at all. A resolved flag stops holding the
    // update and is APPLIED to the snapshot (fix -> corrected facts with
    // "reviewer" provenance; reject -> the size is withheld) before anything
    // is persisted, so what publishes is what the human decided. A failed
    // read (or 0237 not applied) resolves nothing: the update holds exactly
    // as before (fail closed - never publish an unverified fact).
    const factPartition: FactPartition = plan.diagnostics.some((d) => d.code === FACT_FLAG_CODE)
      ? partitionFactFlags(plan.diagnostics, (await listIntakeFactReviewsResult(manifestId)).reviews)
      : { unresolved: [], resolved: [], diagnostics: plan.diagnostics };
    if (factPartition.resolved.length > 0) {
      applyFactDecisions(plan.items, plan.lotFactsByKey, factPartition.resolved);
    }

    // SLICE 62: persist the VERIFIED extraction facts on the source lots —
    // the golden record lives on inventory_lots (migration 0138 columns), so
    // COAs, audits, and future re-processing see the same facts the menu
    // shows. Best-effort: a failed lot update never blocks the staging.
    if (plan.lotFactsByKey.size > 0) {
      const lotIdByKey = new Map<string, string>();
      for (const d of drafts) {
        if (d.pos_product_key && d.lot_id) lotIdByKey.set(d.pos_product_key, d.lot_id);
      }
      for (const [key, facts] of plan.lotFactsByKey) {
        const lotId = lotIdByKey.get(key);
        if (!lotId) continue;
        const { error: lfErr } = await admin
          .from("inventory_lots")
          .update({
            servings_per_pack: facts.servings_per_pack,
            mg_per_serving: facts.mg_per_serving,
            package_thc_mg: facts.package_thc_mg,
            package_cbd_mg: facts.package_cbd_mg,
            ratio_label: facts.ratio_label,
            // SLICE L3: the package measure on the golden record.
            net_weight_grams: facts.net_weight_grams,
            net_volume_ml: facts.net_volume_ml,
            fact_provenance: facts.fact_provenance,
          })
          .eq("id", lotId);
        if (lfErr) {
          console.error(`[intake-menu-staging] lot fact update failed for ${lotId}:`, lfErr.message);
        }
      }
    }

    // Nothing NEW to carry (every approved draft was superseded/skipped): do not
    // create a redundant staged version. The diagnostics still tell the human why
    // via the timeline note in the caller.
    if (!plan.hasChanges) return skip("no-new-items");

    // S01: the manifest header (who / which invoice / when) so every surface
    //    can say "From Acme Farms · manifest 1234 · received Sep 26" instead
    //    of a UUID. ONE primary-key read of four named columns, only on the
    //    path that actually creates a version. Best-effort: a failed read
    //    persists nulls and the copy says "an unnamed vendor" (never guess).
    let manifestRow: {
      manifest_number: string | null;
      vendor_label: string | null;
      received_at: string | null;
      transfer_date: string | null;
    } | null = null;
    try {
      const { data: mRow, error: mErr } = await admin
        .from("inbound_manifests")
        .select("manifest_number, vendor_label, received_at, transfer_date")
        .eq("id", manifestId)
        .maybeSingle();
      if (mErr) console.error("[intake-menu-staging] manifest header read failed:", mErr.message);
      else manifestRow = mRow as typeof manifestRow;
    } catch (err) {
      console.error("[intake-menu-staging] manifest header read exception:", err);
    }
    const manifestHeader = buildManifestHeader(manifestId, manifestRow);

    // SLICE 62 review gate input, computed BEFORE the insert so the row is
    // born knowing whether it will be held (S01: no follow-up write needed).
    // S30: only the flags no human has answered still hold the update.
    const factFlags = factPartition.unresolved;
    // S18 cutover guard, also decided BEFORE the insert so the row is born
    // "held_for_cutover": while a REAL one-time Cultivera upload sits staged,
    // this update is built on a menu that lacks the Cultivera products, so it
    // must not go live (bible 7.2 "Order-dependent", F-041). One bounded read,
    // skipped when INTAKE_CUTOVER_GUARD is off or a fact hold already applies;
    // a failed read never holds (cutover-guard.ts).
    const cutoverHold = factFlags.length === 0 && (await shouldHoldForCutover());

    // 5) Create the STAGED intake-origin version (import_id NULL). Counts +
    //    diagnostics live in summary_json so the review surface needs no
    //    pos_imports/pos_import_diagnostics rows.
    const variantCount = plan.items.reduce((s, it) => s + it.variants.length, 0);
    const warningCount = factPartition.diagnostics.filter((d) => d.severity === "warning").length;
    const { data: versionRow, error: vErr } = await admin
      .from("menu_versions")
      .insert({
        import_id: null,
        status: "staged",
        is_test: false,
        item_count: plan.items.length,
        variant_count: variantCount,
        vendor_count: countVendors(plan.items),
        hidden_count: plan.items.filter((it) => it.hidden).length,
        error_count: 0,
        warning_count: warningCount,
        summary_json: {
          origin: "intake",
          manifest_id: manifestId,
          carried: plan.carriedCount,
          added: plan.addedCount,
          merged: plan.mergedCount,
          // S30: the planner's diagnostics with every human-settled flag
          // recorded as an FYI (fact_review_resolved) - the audit trail stays.
          diagnostics: factPartition.diagnostics,
          // S01: who/which invoice/when + what the staging module decided.
          // "auto_publish_attempted" + status "published" = published
          // automatically, so the success path needs ZERO extra writes.
          manifest: manifestHeader,
          publish_outcome: initialPublishOutcome(factFlags.length, new Date().toISOString(), { cutover: cutoverHold }),
          // S17: which approved drafts this snapshot was built from, so a
          // later snapshot may replace it ONLY when it provably contains all
          // of them (planRestageReplace). Plus the batch size, when batched.
          approved_draft_ids: draftIdList(drafts.map((d) => d.id)),
          ...(opts.batchCount && opts.batchCount > 1 ? { batch_count: opts.batchCount } : {}),
        },
        notes:
          buildIntakeVersionNotes({
            manifest: manifestHeader,
            added: plan.addedCount,
            merged: plan.mergedCount,
            carried: plan.carriedCount,
          }) + batchNotesSuffix(opts.batchCount),
        created_by: actorId,
      })
      .select("*")
      .single();
    if (vErr || !versionRow) {
      console.error("[intake-menu-staging] version insert failed:", vErr?.message);
      return skip("version-insert-failed");
    }
    const version = versionRow as MenuVersion;

    // 6) Persist items + variants in batches (same shape as persistMenuItems).
    await persistSnapshotItems(version.id, plan.items, priorKbLinks);

    // 6b) S17 coalesce: this snapshot now safely exists (items included), so
    //     a recent UNPUBLISHED update of this delivery that it provably
    //     contains is retired instead of piling up. Never skips staging.
    if (batchStagingEnabled(process.env[BATCH_STAGING_ENV])) {
      await replaceRecentRestages(version, manifestId, draftIdList(drafts.map((d) => d.id)));
    }

    // 7) AUTO-PUBLISH (owner-approved Option 1): the item-by-item human review
    //    already happened at draft approval, so promote the fresh snapshot to
    //    live immediately via the same atomic RPC the Menu Imports publish
    //    button uses. Best-effort: on ANY failure the STAGED version remains
    //    and surfaces on Menu Imports as the manual-publish fallback.
    // SLICE 62 review gate (Rule 3.1: uncertain facts go to a human, never to
    // customers): when the word-by-word extraction engine could NOT verify
    // every fact on an mg-dosed line, the fresh snapshot stays STAGED — the
    // human settles each flag inline on Product Onboarding -> Approved (S30,
    // resolveIntakeFactReview) or presses Publish on Admin -> Publish Menu.
    // Same principle as the SLICE 58 import commit gate. (factFlags
    // is computed above the insert so the row records the hold at birth.)
    if (factFlags.length > 0) {
      try {
        await admin.from("manifest_events").insert({
          manifest_id: manifestId,
          event_type: "menu_publish_held_for_fact_review",
          // S30.4: point at the control that actually settles the flag.
          note: factHoldNote(factFlags.length),
          actor_id: actorId,
        });
      } catch (err) {
        console.error("[intake-menu-staging] fact-review hold event insert failed:", err);
      }
      // S30: a reviewer decision re-staged this delivery and it is STILL held
      // (another product is flagged): the previous held copies it provably
      // contains are obsolete - retire them so the Publish page shows one.
      if (factPartition.resolved.length > 0) {
        await retireOlderHeldCopies(version, manifestId, draftIdList(drafts.map((d) => d.id)));
      }
      return {
        staged: true,
        published: false,
        versionId: version.id,
        carried: plan.carriedCount,
        added: plan.addedCount,
        merged: plan.mergedCount,
        reason: "held-for-fact-review",
      };
    }

    // S18: held for cutover. Staged (nothing lost), NOT published; the owner
    // publishes the Cultivera upload and this delivery is rebuilt on top of
    // it (cutover-guard.ts releaseHeldAfterCutover). Outcome already on the row.
    if (cutoverHold) {
      try {
        await admin.from("manifest_events").insert({
          manifest_id: manifestId,
          event_type: CUTOVER_EVENT,
          note: CUTOVER_HOLD_COPY,
          actor_id: actorId,
        });
      } catch (err) {
        console.error("[intake-menu-staging] cutover hold event insert failed:", err);
      }
      return {
        staged: true,
        published: false,
        versionId: version.id,
        carried: plan.carriedCount,
        added: plan.addedCount,
        merged: plan.mergedCount,
        reason: CUTOVER_REASON,
      };
    }

    const publishedOk = await autoPublishIntakeVersion(
      version.id,
      actorId,
      manifestId,
      version.summary_json,
      version.created_at ?? null,
    );

    return {
      staged: true,
      published: publishedOk,
      versionId: version.id,
      carried: plan.carriedCount,
      added: plan.addedCount,
      merged: plan.mergedCount,
    };
  } catch (err) {
    console.error("[intake-menu-staging] staging failed:", err);
    return skip("exception");
  }
}

/**
 * Promote a freshly-staged intake-origin version to LIVE via the same atomic
 * `publish_menu_version` RPC the Menu Imports publish button uses (archives
 * the previously-published version in the same transaction). Returns true on
 * success. BEST-EFFORT: any failure logs, records a `menu_auto_publish_failed`
 * timeline event, and returns false — the staged version remains on Menu
 * Imports as the manual-publish fallback. The freshly-inserted version always
 * has error_count = 0 (intake staging never writes error diagnostics), so the
 * Menu Imports error guard is satisfied by construction.
 */
async function autoPublishIntakeVersion(
  versionId: string,
  actorId: string | null,
  manifestId: string,
  summaryJson: unknown,
  createdAt: string | null,
): Promise<boolean> {
  const admin = createSupabaseAdminClient();

  // S01: on the RARE failure path, record WHY on the row so the Publish page
  // can explain it ("The system said: …") instead of a generic warning. One
  // update, guarded to rows still staged (a concurrent manual publish wins).
  // Never throws, never changes the publish result.
  const recordFailure = async (error: unknown): Promise<void> => {
    try {
      const base =
        summaryJson && typeof summaryJson === "object" && !Array.isArray(summaryJson)
          ? (summaryJson as Record<string, unknown>)
          : {};
      const { error: uErr } = await admin
        .from("menu_versions")
        .update({
          summary_json: {
            ...base,
            publish_outcome: failedPublishOutcome(error, new Date().toISOString()),
          },
        })
        .eq("id", versionId)
        .eq("status", "staged");
      if (uErr) console.error("[intake-menu-staging] failure outcome write failed:", uErr.message);
    } catch (err) {
      console.error("[intake-menu-staging] failure outcome write exception:", err);
    }
  };

  const logEvent = async (eventType: string, note: string): Promise<void> => {
    try {
      await admin.from("manifest_events").insert({
        manifest_id: manifestId,
        event_type: eventType,
        note,
        actor_id: actorId,
      });
    } catch (err) {
      console.error("[intake-menu-staging] timeline event insert failed:", err);
    }
  };

  try {
    const { error } = await admin.rpc("publish_menu_version", {
      p_version_id: versionId,
      p_actor: actorId,
    });
    if (error) {
      console.error("[intake-menu-staging] auto-publish failed:", error.message);
      await recordFailure(error.message);
      await logEvent(
        "menu_auto_publish_failed",
        "Automatic publish didn't finish — the menu update is STAGED in the Publish command center (Admin → Publish Menu). Press Publish there to put it live.",
      );
      return false;
    }
  } catch (err) {
    console.error("[intake-menu-staging] auto-publish exception:", err);
    await recordFailure(err);
    await logEvent(
      "menu_auto_publish_failed",
      "Automatic publish didn't finish — the menu update is STAGED in the Publish command center (Admin → Publish Menu). Press Publish there to put it live.",
    );
    return false;
  }

  // Housekeeping (S15): the ONE archival rule - every staged version of ANY
  // origin created before this one is superseded and archived with a reason
  // (publish-archive-rule-core.ts, same rule as migration 0236). Before S15
  // this swept intake-origin rows of ANY age and never a POS-import row, so a
  // Cultivera upload left staged sat on the Publish page forever (F-042).
  // Never throws. After 0236 the RPC has already done it and this writes
  // nothing.
  await archiveSupersededStaged({ id: versionId, created_at: createdAt });

  // Audit trail — same action name as the manual Menu Imports publish, with
  // the intake origin recorded (recordAudit never throws).
  await recordAudit({
    actorId,
    action: "menu_version.published",
    entityType: "menu_version",
    entityId: versionId,
    after: { origin: "intake", manifest_id: manifestId, auto: true },
  });

  await logEvent(
    "menu_auto_publish",
    "Published to the live menu automatically — the approved products from this delivery are now on the website and sellable at the register.",
  );

  // Refresh the public menu surfaces + the Menu Imports admin list (same set
  // the manual publish action revalidates).
  try {
    // SLICE 59: the canonical public-surfaces list covers "/", "/menu",
    // "/specials", AND "/vendor-delivery" — the vendor directory is derived
    // from the live menu, so an auto-publish must refresh it too. (SLICE 39:
    // "/shop" was never a route.)
    revalidatePath("/admin/menu-imports");
    revalidatePath("/admin/publish");
    revalidatePublicMenuSurfaces();
  } catch (err) {
    console.error("[intake-menu-staging] revalidate failed:", err);
  }

  return true;
}

/**
 * Ribbon step ④ snapshot for a manifest: how many onboarding drafts are still
 * unpriced vs approved, and whether an intake-origin STAGED version for this
 * manifest is still waiting (auto-publish fallback). Returns null when the
 * counts can't be read — the ribbon then shows a neutral step rather than
 * guessing.
 */
export async function intakeMenuStepSnapshot(
  manifestId: string,
): Promise<{
  pendingDrafts: number;
  approvedDrafts: number;
  stagedWaiting: boolean;
  /** R13a: the ONE waiting update (newest, not superseded) and why it waits. */
  waitingVersion: WaitingMenuVersion | null;
} | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const [pendingRes, approvedRes, stagedRes, publishedRes] = await Promise.all([
      admin
        .from("catalog_product_drafts")
        .select("id", { count: "exact", head: true })
        .eq("manifest_id", manifestId)
        .eq("status", "draft"),
      admin
        .from("catalog_product_drafts")
        .select("id", { count: "exact", head: true })
        .eq("manifest_id", manifestId)
        .eq("status", "approved"),
      // R13a: NAMED rows, newest first, not a bare count. A count also
      // counted receiving updates the next publish archives (S15 rule), so
      // the ribbon said "waiting" and the Publish page had nothing to show.
      admin
        .from("menu_versions")
        .select(WAITING_VERSION_SELECT)
        .is("import_id", null)
        .eq("status", "staged")
        .eq("summary_json->>manifest_id", manifestId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(WAITING_VERSION_READ_LIMIT),
      admin.from("menu_versions").select("id, created_at").eq("status", "published").limit(1).maybeSingle(),
    ]);
    if (pendingRes.error || approvedRes.error || stagedRes.error || publishedRes.error) {
      console.error(
        "[intake-menu-staging] menu-step snapshot read failed:",
        pendingRes.error?.message ??
          approvedRes.error?.message ??
          stagedRes.error?.message ??
          publishedRes.error?.message,
      );
      return null;
    }
    const waitingVersion = pickWaitingVersion(
      (stagedRes.data as unknown as WaitingVersionRow[] | null) ?? [],
      (publishedRes.data as { id: string; created_at: string } | null) ?? null,
    );
    return {
      pendingDrafts: pendingRes.count ?? 0,
      approvedDrafts: approvedRes.count ?? 0,
      stagedWaiting: waitingVersion !== null,
      waitingVersion,
    };
  } catch (err) {
    console.error("[intake-menu-staging] menu-step snapshot exception:", err);
    return null;
  }
}

/**
 * S17: retire recent unpublished receiving updates of the same delivery that
 * the fresh snapshot replaces (bible S17.2 debounce, trailing-edge: the last
 * approve's version always survives). One bounded read of NAMED columns; each
 * write is guarded to rows still staged, so a row published or archived in
 * the meantime is never touched. Best-effort: failures log, never throw,
 * never affect the fresh version.
 * @returns how many rows were replaced.
 */
export async function replaceRecentRestages(
  fresh: { id: string; created_at?: string | null },
  manifestId: string,
  draftIds: string[],
  nowIso: string = new Date().toISOString(),
): Promise<number> {
  try {
    const since = restageWindowStartIso(fresh.created_at ?? null);
    if (!since || !fresh.created_at) return 0;
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("menu_versions")
      .select("id, status, created_at, import_id, summary_json")
      .is("import_id", null)
      .eq("status", "staged")
      .eq("summary_json->>manifest_id", manifestId)
      .gte("created_at", since)
      .lt("created_at", fresh.created_at)
      .neq("id", fresh.id)
      .limit(RESTAGE_READ_MAX);
    if (error) {
      console.error("[intake-menu-staging] restage read failed:", error.message);
      return 0;
    }
    const candidates = (data as RestageCandidate[] | null) ?? [];
    const plan = new Set(
      planRestageReplace({ id: fresh.id, created_at: fresh.created_at, manifest_id: manifestId, draft_ids: draftIds }, candidates),
    );
    let replaced = 0;
    for (const row of candidates) {
      if (!plan.has(row.id)) continue;
      const { data: done, error: uErr } = await admin
        .from("menu_versions")
        .update({ status: "archived", updated_at: nowIso, summary_json: replacedSummary(row.summary_json, fresh.id, nowIso) })
        .eq("id", row.id)
        .eq("status", "staged")
        .select("id");
      if (uErr) {
        console.error("[intake-menu-staging] restage replace failed:", uErr.message);
        continue;
      }
      replaced += (done ?? []).length;
    }
    return replaced;
  } catch (err) {
    console.error("[intake-menu-staging] restage replace exception:", err);
    return 0;
  }
}

/**
 * S30: archive the OLDER held-for-fact-review copies of one delivery that the
 * fresh (still held) copy provably contains (intake-fact-review-core
 * planHeldRetire). Guarded to rows still staged; never throws; returns the
 * number archived. A failed read archives nothing (they stay visible).
 */
export async function retireOlderHeldCopies(
  fresh: { id: string; created_at?: string | null },
  manifestId: string,
  draftIds: string[],
  nowIso: string = new Date().toISOString(),
): Promise<number> {
  try {
    if (!fresh.created_at) return 0;
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("menu_versions")
      .select("id, status, created_at, import_id, summary_json")
      .is("import_id", null)
      .eq("status", "staged")
      .eq("summary_json->>manifest_id", manifestId)
      .lt("created_at", fresh.created_at)
      .neq("id", fresh.id)
      .order("created_at", { ascending: true })
      .limit(RESTAGE_READ_MAX);
    if (error) {
      console.error("[intake-menu-staging] held-copy read failed:", error.message);
      return 0;
    }
    const candidates = (data as HeldCandidate[] | null) ?? [];
    const plan = new Set(
      planHeldRetire({ id: fresh.id, created_at: fresh.created_at, manifest_id: manifestId, draft_ids: draftIds }, candidates),
    );
    let retired = 0;
    for (const row of candidates) {
      if (!plan.has(row.id)) continue;
      const { data: done, error: uErr } = await admin
        .from("menu_versions")
        .update({
          status: "archived",
          updated_at: nowIso,
          summary_json: {
            ...mergeArchivedSummary(row.summary_json, fresh.id, nowIso),
            archived_reason: RETIRED_REASON_PREFIX + fresh.id,
          },
        })
        .eq("id", row.id)
        .eq("status", "staged")
        .select("id");
      if (uErr) {
        console.error("[intake-menu-staging] held-copy retire failed:", uErr.message);
        continue;
      }
      retired += (done ?? []).length;
    }
    return retired;
  } catch (err) {
    console.error("[intake-menu-staging] held-copy retire exception:", err);
    return 0;
  }
}

/** Candidate ceiling for one coalesce read (a 20 s window holds a handful). */
const RESTAGE_READ_MAX = 25;

/**
 * S19: what loadCarryForwardItems returns - the rows plus the evidence
 * (read failure, rows read, independent COUNT) carryForwardVerdict judges.
 * A named type (not an inline object) so the function's first brace is its
 * body - restage-plumbing extracts the body by brace matching.
 */
type CarryForwardRead = {
  items: CarryForwardItem[];
  /**
   * R25 C: source_item_id -> menu_items.kb_product_id on the live rows (the
   * select is "*", so present once 0234 is applied; absent before = empty).
   */
  priorKbLinks: Map<string, string>;
  readFailed: boolean;
  rowsRead: number;
  expectedTotal: number | null;
};

/**
 * Load a published version's items (with variants) as carry-forward rows.
 *
 * S19: the carried-forward live menu, PAGED, with the evidence to prove it is
 * whole. Before S19 this was one un-ranged read (PostgREST silently caps it
 * at db.max_rows = 1,000 on a ~4,500-item menu) that returned [] on error -
 * either way the staged snapshot, which REPLACES the live menu on
 * auto-publish, could silently drop live products. Now: items page by
 * sort_order + id (the getVersionItems pattern), variants page per chunk,
 * and a server-side COUNT is the independent witness. The caller refuses to
 * stage unless carryForwardVerdict says the read is complete.
 */
async function loadCarryForwardItems(versionId: string): Promise<CarryForwardRead> {
  const admin = createSupabaseAdminClient();
  let readFailed = false;
  const items = await pagedAll<MenuItemRow>(async (from, to) => {
    const { data: itemRows, error } = await admin
      .from("menu_items")
      .select("*")
      .eq("menu_version_id", versionId)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    if (error) {
      console.error("[intake-menu-staging] carry-forward items read failed:", error.message);
      readFailed = true;
      return [];
    }
    return (itemRows as MenuItemRow[] | null) ?? [];
  });

  // The independent witness (SLICE 4A pattern, menu-version countVersionItems).
  let expectedTotal: number | null = null;
  const { count, error: countErr } = await admin
    .from("menu_items")
    .select("id", { count: "exact", head: true })
    .eq("menu_version_id", versionId);
  if (countErr) console.error("[intake-menu-staging] carry-forward count failed:", countErr.message);
  else if (typeof count === "number") expectedTotal = count;

  const variantsByItem = new Map<string, MenuVariantRow[]>();
  if (!readFailed && items.length > 0) {
    const variants = await chunkedIn<string, MenuVariantRow>(
      items.map((i) => i.id),
      async (chunk, from, to) => {
        const { data, error } = await admin
          .from("menu_variants")
          .select("*")
          .in("menu_item_id", chunk)
          .order("sort_order", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);
        if (error) {
          console.error("[intake-menu-staging] carry-forward variants read failed:", error.message);
          readFailed = true;
          return [];
        }
        return (data as MenuVariantRow[] | null) ?? [];
      },
    );
    for (const v of variants) {
      const list = variantsByItem.get(v.menu_item_id) ?? [];
      list.push(v);
      variantsByItem.set(v.menu_item_id, list);
    }
  }

  const priorKbLinks = new Map<string, string>();
  for (const it of items) {
    const kb = typeof it.kb_product_id === "string" ? it.kb_product_id.trim() : "";
    if (kb && it.source_item_id) priorKbLinks.set(it.source_item_id, kb);
  }

  return {
    readFailed,
    rowsRead: items.length,
    expectedTotal,
    priorKbLinks,
    // The mapping stays INSIDE this function on purpose: restage-plumbing
    // (SLICE 18G) scopes its guard to this body, so the limit columns are
    // proven to be assigned from the very rows this read returned.
    items: items.map((it) => ({
      source_item_id: it.source_item_id,
      name: it.name,
      product_name: it.product_name,
      brand_name: it.brand_name,
      vendor_name: it.vendor_name,
      category: it.category,
      filter_categories: it.filter_categories,
      pos_inventory_type: it.pos_inventory_type,
      pos_inventory_category: it.pos_inventory_category,
      strain_type: it.strain_type,
      strain_name: it.strain_name,
      thc: it.thc,
      cbd: it.cbd,
      total_thc_json: it.total_thc_json,
      total_cbd_json: it.total_cbd_json,
      compounds_json: it.compounds_json,
      // SLICE 62: carry the structured facts (migration 0138) forward so a new
      // intake snapshot never wipes facts an earlier import/intake run earned.
      servings_per_pack: it.servings_per_pack,
      mg_per_serving: it.mg_per_serving,
      package_thc_mg: it.package_thc_mg,
      package_cbd_mg: it.package_cbd_mg,
      ratio_label: it.ratio_label,
      net_weight_grams: it.net_weight_grams,
      net_volume_ml: it.net_volume_ml,
      fact_provenance: (it.fact_provenance ?? {}) as Record<string, string>,
      // SLICE 18G (DEFECT 3): read the sales-limit classification off the
      // published row so it can be carried forward.
      //
      // The query above is `select("*")`, so these four values were ALWAYS
      // present in `it` — the loss was purely in this hand-written mapping.
      // That is why the fix is four lines and no query change: nothing had to be
      // fetched, only stopped from being thrown away.
      //
      // MenuItemRow already declares all four (src/lib/pos/db-types.ts), so
      // these are typed reads, not casts.
      low_thc_liquid: it.low_thc_liquid,
      unit_thc_mg: it.unit_thc_mg,
      otherwise_taken: it.otherwise_taken,
      units_per_package: it.units_per_package,
      description: it.description,
      price_label: it.price_label,
      price_minor_units: it.price_minor_units,
      inventory_status: it.inventory_status,
      hidden: it.hidden,
      hidden_reason: it.hidden_reason,
      variants: (variantsByItem.get(it.id) ?? []).map((v) => ({
        source_variant_id: v.source_variant_id,
        label: v.label,
        price_minor_units: v.price_minor_units,
        inventory_level: v.inventory_level,
        medical: v.medical,
      })),
    })),
  };
}

/** Distinct non-empty vendor names among the staged items. */
function countVendors(
  items: { vendor_name: string | null; brand_name: string }[],
): number {
  const set = new Set<string>();
  for (const it of items) {
    const v = (it.vendor_name || it.brand_name || "").trim();
    if (v) set.add(v.toLowerCase());
  }
  return set.size;
}

/** Insert the full staged snapshot (items + variants) under `versionId`. */
async function persistSnapshotItems(
  versionId: string,
  items: Awaited<ReturnType<typeof buildIntakeStagedVersionPlan>>["items"],
  priorKbLinks: Map<string, string> = new Map(),
) {
  const admin = createSupabaseAdminClient();

  // R25 C: link every card to its knowledge-base product (menu_items.
  // kb_product_id, 0234) from its lots' approval links; a live card keeps the
  // link it already had. One lot read for the whole snapshot.
  const kbPlan = await planMenuKbLinksForCards(
    admin,
    items.map((it) => ({
      source_item_id: it.source_item_id,
      variantIds: it.variants.map((v) => v.source_variant_id),
      prior: priorKbLinks.get(it.source_item_id) ?? null,
    })),
  );
  logMenuKbLinkPlan("intake-menu-staging", kbPlan);

  for (let start = 0; start < items.length; start += ITEM_BATCH) {
    const batch = items.slice(start, start + ITEM_BATCH);
    const rows = batch.map((it) => ({
      menu_version_id: versionId,
      source_item_id: it.source_item_id,
      name: it.name,
      product_name: it.product_name,
      brand_name: it.brand_name,
      vendor_name: it.vendor_name,
      category: it.category,
      filter_categories: it.filter_categories,
      pos_inventory_type: it.pos_inventory_type,
      pos_inventory_category: it.pos_inventory_category,
      strain_type: it.strain_type,
      strain_name: it.strain_name,
      thc: it.thc,
      cbd: it.cbd,
      total_thc_json: it.total_thc_json,
      total_cbd_json: it.total_cbd_json,
      compounds_json: it.compounds_json,
      // SLICE 62: structured facts (migration 0138) — verified-only values
      // from the word-by-word extraction engine; null means "not verified".
      servings_per_pack: it.servings_per_pack,
      mg_per_serving: it.mg_per_serving,
      package_thc_mg: it.package_thc_mg,
      package_cbd_mg: it.package_cbd_mg,
      ratio_label: it.ratio_label,
      net_weight_grams: it.net_weight_grams,
      net_volume_ml: it.net_volume_ml,
      fact_provenance: it.fact_provenance,
      // SLICE 18G (DEFECT 3): persist the sales-limit classification onto the
      // new version's rows. Without this the planner could carry the values
      // perfectly and the INSERT would still drop them, leaving every column
      // NULL on the menu that auto-publishes moments later.
      //
      // These are the columns migration 0219 labels "ENFORCEMENT SOURCE OF
      // TRUTH": what the register reads to decide whether a cart is over a
      // statutory limit. null is written as null on purpose — it means "not
      // yet classified", which is what makes the receiving dock ask.
      low_thc_liquid: it.low_thc_liquid,
      unit_thc_mg: it.unit_thc_mg,
      otherwise_taken: it.otherwise_taken,
      units_per_package: it.units_per_package,
      description: it.description,
      price_label: it.price_label,
      price_minor_units: it.price_minor_units,
      inventory_status: it.inventory_status,
      hidden: it.hidden,
      hidden_reason: it.hidden_reason,
      sort_order: it.sort_order,
    }));

    const { data: inserted, error } = await insertMenuItemsWithKbLink(admin, rows, kbPlan.links);
    if (error || !inserted) {
      throw new Error(`Failed to insert staged menu items: ${error?.message ?? "unknown"}`);
    }

    const idBySource = new Map<string, string>();
    for (const r of inserted as { id: string; source_item_id: string }[]) {
      idBySource.set(r.source_item_id, r.id);
    }

    const variantRows: Record<string, unknown>[] = [];
    for (const it of batch) {
      const dbId = idBySource.get(it.source_item_id);
      if (!dbId) continue;
      for (const v of it.variants) {
        variantRows.push({
          menu_item_id: dbId,
          source_variant_id: v.source_variant_id,
          label: v.label,
          price_minor_units: v.price_minor_units,
          inventory_level: v.inventory_level,
          medical: v.medical,
          sort_order: v.sort_order,
        });
      }
    }
    for (let v = 0; v < variantRows.length; v += VARIANT_BATCH) {
      const vBatch = variantRows.slice(v, v + VARIANT_BATCH);
      const { error: vErr } = await admin.from("menu_variants").insert(vBatch);
      if (vErr) throw new Error(`Failed to insert staged menu variants: ${vErr.message}`);
    }
  }
}
