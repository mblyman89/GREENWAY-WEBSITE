import Link from "next/link";
import { Fragment } from "react";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { SopSheetLink } from "@/components/admin/SopSheetLink";
import { BackLink, Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Button, Input, Select } from "@/components/admin/ui";
import { CatalogStageStrip } from "@/components/admin/catalog/CatalogStageStrip";
import {
  listCatalogDraftsPage,
  loadOnboardingPicker,
  countCatalogDrafts,
  loadStrainTypeSignals,
  listPriorClassifications,
  listPriorOnboardingPicks,
} from "@/lib/inventory/catalog-drafts";
// R32 (T-328): identity memory for type / strain type / shelf (the SAME
// survivorship the approval gate re-derives server-side).
import {
  effectiveHouseType,
  effectiveStrainType,
  recallOnboardingPicks,
  rememberedStrainPlaceholder,
  type OnboardingRecall,
} from "@/lib/inventory/onboarding-recall-core";
import { INVENTORY_TYPE_CATALOG } from "@/lib/pos/inventory-type-catalog";
// S10: the fact-attach policy's shadow counters (one bounded audit read; no writes).
import { attachPolicyMode, shadowFooterCopy } from "@/lib/catalog/fact-attach-policy-core";
import { currentAttachPolicyRing, loadShadowSummary } from "@/lib/catalog/fact-attach-policy-server";
// SLICE 93: strain-type intelligence - the picker's honest placeholder + the
// canonical dropdown choices (strain-taxonomy, the single source of truth).
import { strainTypePickerPlaceholder } from "@/lib/inventory/strain-type-intel-core";
// R32 (T-328): the explainable price waterfall (accurate fine print + steps).
import { PriceExplainNote } from "@/components/admin/catalog/PriceExplainNote";
import { getPricingSettings } from "@/lib/inventory/pricing";
// T-314: manual, web-grounded product/strain lookup on each row. The model is
// whatever AI_MODEL_HEAVY names (Gemini google_search grounding when it starts
// with "gemini", otherwise the OpenAI web_search tool) - see
// src/lib/ai/provider.ts generateWebSearch.
import { AiLookupPanel } from "./AiLookupPanel";
// R23 (items 2 + 6): "Facts waiting for you" - attach in the row's AI card.
import { attachWaitingFactAction } from "./ai-lookup-actions";
import { WaitingFactsPanel } from "@/components/admin/catalog/WaitingFactsPanel";
import { buildWaitingFacts, waitingResultBanner } from "@/lib/catalog/waiting-facts-core";
import { loadWaitingSuggestions, waitingKeyForDraft } from "@/lib/catalog/waiting-facts-server";
// R23 (item 5): the approved row opens too.
import {
  APPROVED_BANNER_LINK_TEXT,
  APPROVED_TOGGLE_CLOSE,
  APPROVED_TOGGLE_OPEN,
  approvedBannerLink,
  approvedRowCopy,
} from "@/lib/catalog/approved-row-core";
import { isAiConfigured } from "@/lib/inventory/product-lookup-ai";
import { strainTypeDefinitions } from "@/lib/menu/strain-taxonomy";
import { approveAllPricedAction, approveDraftAction, cancelLookupAction, dismissDraftAction, lookupAllAction, restoreDraftAction } from "./actions";
// S17: "Approve all N priced" for one delivery (one menu update per batch).
import {
  BATCH_BUTTON_HELP,
  BATCH_STAGING_ENV,
  batchButtonLabel,
  batchResultCopy,
  batchStagingEnabled,
  parseBatchResult,
  pricedInReview,
} from "@/lib/inventory/batch-staging-core";
import { draftsWhatDoIDoHere } from "@/lib/catalog/next-action-core";
import { WhatDoIDoHere } from "@/components/admin/catalog/WhatDoIDoHere";
import { resolveWebsiteCategoriesWithLiveKeys } from "@/lib/inventory/website-category-resolver-server";
// S02: deep links — ?draft=<id> pins + highlights one product, ?manifest=<id>
// narrows to one delivery; Enrich now opens the product itself when live.
import {
  draftRowAnchorId,
  draftsHref,
  effectiveDraftView,
  enrichHrefForDraft,
  parseDraftFocus,
} from "@/lib/catalog/draft-deep-link-core";
// S22: "Enrich this delivery's products" (filtered enrichment list).
import { enrichDeliveryHref } from "@/lib/enrichment/enrichment-manifest-core";
// S03: shadow measurement of the product-identity key (console only).
// S14: filters, paging, the delivery picker + header, condensed rows (pure).
import {
  DRAFT_PAGE_SIZES,
  manifestPickerLabel,
  onboardingHeaderTitle,
  onboardingListHref,
  pageWindow,
  parseOnboardingListParams,
  pickerVendors,
  rowAttention,
  rowStartsOpen,
  onboardingColumns,
  detailRowId,
} from "@/lib/catalog/onboarding-list-core";
import { identityShadowLogLine, summarizeIdentityShadow } from "@/lib/catalog/product-identity-core";
import {
  assessDraftClassification,
  websiteCategoryLabel,
  categoryPickerPlaceholder,
  typePickerPlaceholder,
  type DraftClassificationAssessment,
} from "@/lib/inventory/draft-approval-gate-core";
// SLICE 18-0: the compliance classification gate. Product Onboarding is the
// classification step a RECEIVED lot reaches. S30: a received lot's
// fact_extraction_review flag is now answered HERE too (Approved tab, inline
// IntakeFactReviewPanel -> resolveIntakeFactReview, scoped by delivery + lot
// key, migration 0237) - no pos_imports row is needed.
import { extractNameFacts } from "@/lib/inventory/fact-extraction-core";
import {
  deriveNetVolumeMl,
  deriveNetWeightGrams,
} from "@/lib/compliance/liquid-volume-derivation-core";
import {
  assessReceivingClassification,
  // SLICE L5 — the volume gate and its placeholder.
  assessReceivingVolume,
  volumePickerPlaceholder,
  otherwiseTakenPickerPlaceholder,
  lowThcPickerPlaceholder,
  type ReceivingClassificationAssessment,
} from "@/lib/inventory/receiving-classification-core";
// SLICE 18F: the memory for that same gate. Pure - it only decides what MAY be
// remembered (never a machine default, never silence), and the human still
// confirms every pre-filled answer.
import {
  recallClassification,
  prefillFromMemory,
  describeMemory,
  type PriorClassification,
} from "@/lib/inventory/classification-memory-core";
// SLICE 78: the category picker lists the DB-backed registry (owner's
// categories from /admin/settings/types), not the hardcoded taxonomy — the
// registry falls back to the hardcoded list on an empty/unconfigured DB.
import { loadCategoryLabelMap } from "@/lib/pos/category-registry";
import { groupCatalogByCategory } from "@/lib/pos/inventory-type-catalog";
// SLICE 92: owner-created product types join the picker (and new ones can be
// created inline) - same inventory_types registry as Settings -> Types.
import { listInventoryTypes } from "@/lib/pos/types-store";
import { mergeOwnerTypesIntoGroups } from "@/lib/pos/type-registry-core";
import { labelForCategory } from "@/lib/pos/category-registry-core";
import { intakeDisplayName } from "@/lib/pos/intake-mastering-core";
// S00: the one shared sentence about what Approve does (never retyped here).
import { APPROVE_PUBLISHES_COPY, HELD_EXCEPTION_COPY } from "@/lib/catalog/publish-story-core";
import { loadRestockPreview } from "@/lib/inventory/restock-preview-server";
import { previewUnavailableCopy } from "@/lib/inventory/vendor-identity-core";
import { restockPreviewPlan } from "@/lib/inventory/restock-preview-view-core";
import { RestockPreviewChip, RestockPreviewUnavailable } from "@/components/admin/catalog/RestockPreviewChip";
import { MasteringPreviewPanel } from "@/components/admin/catalog/MasteringPreviewPanel";
// S09: KB-first recall - the "Known product" chip.
import { KnownProductChip } from "@/components/admin/catalog/KnownProductChip";
// S11: the onboarding row redesign (provenance chips, Facts + Manifest columns).
import { FactsPanel } from "@/components/admin/catalog/FactsPanel";
import { ApproveGroup, FieldLabel, OnboardingDetailRow } from "@/components/admin/catalog/OnboardingDetailRow";
import {
  ONBOARDING_V2_ROW_ENV,
  attachedFactsOf,
  buildFactChips,
  identityLine,
  manifestCell,
  onboardingV2RowEnabled,
  rowRecordFacts,
} from "@/lib/catalog/fact-chips-core";
import { recallProductMemories, knowledgeQueryForDraft } from "@/lib/catalog/fact-memory";
import { KB_FIRST_ONBOARDING_ENV, kbFirstOnboardingEnabled } from "@/lib/catalog/fact-memory-core";
import { identityForDraft } from "@/lib/catalog/product-identity-core";
// S30: inline fact review for received products (Approved tab).
import { loadOpenIntakeFactFlags, loadSavedProductFacts, savedFactsMapKey } from "@/lib/pos/intake-fact-review-server";
import { factFlagWorklist } from "@/lib/pos/menu-waiting-link-core";
import {
  FACT_REVIEW_MIGRATION_COPY,
  factResultCopy,
  parseFactResult,
} from "@/lib/pos/intake-fact-review-core";
import { IntakeFactReviewPanel } from "./IntakeFactReviewPanel";
import { ProductFactsPanel } from "./ProductFactsPanel";
import { loadLabViewsForDrafts } from "@/lib/catalog/lab-facts-attach";
import { labPanelView } from "@/lib/catalog/lab-facts-attach-core";
import { strainSlug } from "@/lib/catalog/slug-core";
// R19 S13: "Look up all N products on this manifest" (server-side batch).
import { lookupJobsOn, loadManifestLookup } from "@/lib/catalog/lookup-job-server";
import { attachFactsV2Enabled } from "@/lib/catalog/fact-attach-policy-server";
import {
  LOOKUP_ALL_HELP,
  LOOKUP_CHOOSE_COPY,
  LOOKUP_CHOOSE_NONE_COPY,
  batchLookupEntry,
  costLine,
  itemRowCopy,
  jobHeadline,
  lookupBanner,
  lookupDeliveryChoices,
  progressLine,
} from "@/lib/catalog/lookup-job-core";

export const dynamic = "force-dynamic";
// T-318 / T-323: the AI product lookup (a server action invoked on this route)
// runs a live web-grounded call that can take a while. provider.ts aborts its
// own fetch at AI_WEBSEARCH_TIMEOUT_MS (default 290s), so the function gets
// 300s - just above that - and can still return the clean "took too long"
// message instead of being killed mid-flight. (The project is on Vercel Pro,
// AGENTS.md rule 12; raise both numbers together if a longer lookup is ever
// needed.)
export const maxDuration = 300;

function fmtPct(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return `${n}%`;
}

function fmtMoney(minor: number | null | undefined): string {
  if (minor == null) return "—";
  return `$${(minor / 100).toFixed(2)}`;
}

export default async function CatalogDraftsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; approved?: string; dismissed?: string; restored?: string; error?: string; msg?: string; back?: string; manifest?: string; draft?: string; q?: string; vendor?: string; page?: string; size?: string; rows?: string; batch_ok?: string; batch_skip?: string; batch_more?: string; batch_why?: string; fact?: string; fact_msg?: string; lookup?: string; lookup_msg?: string; wf?: string; wf_msg?: string; approved_draft?: string }>;
}) {
  await requirePermission("inventory.manage");
  const sp = await searchParams;
  const { approved, dismissed, restored, error, msg, back } = sp;
  // S02: validated focus (bad ids are dropped, never queried).
  const focus = parseDraftFocus(sp);
  // S14: search / delivery vendor / page / size / condensed-or-expanded rows.
  const list = parseOnboardingListParams(sp);

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Product Onboarding" subtitle="Review and approve new products onto the menu." />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn&apos;t fully set up yet. Apply migration 0026 to enable product drafts.
          </div>
        </div>
      </div>
    );
  }

  const now = new Date();
  const [listPage, counts, categoryLabelMap, ownerTypes, picker] = await Promise.all([
    // ONE read: the page of the tab (optionally one delivery / vendor /
    // search) WITH its total; a pinned row keeps S02's unpaged query.
    listCatalogDraftsPage({
      status: focus.view,
      manifestId: focus.manifestId,
      draftId: focus.draftId,
      vendorId: list.vendorId,
      q: list.q,
      page: list.page,
      pageSize: list.pageSize,
    }),
    countCatalogDrafts(),
    loadCategoryLabelMap(),
    listInventoryTypes({ includeInactive: false }),
    // S14: the delivery picker + header (recent accepted deliveries + counts).
    loadOnboardingPicker(focus.manifestId, now),
  ]);
  const listed = listPage.rows;
  // S02 (F-060): the pinned product decides the tab from its REAL status, so a
  // link to an approved product can never land on an empty review queue. Rows
  // from another tab are dropped so each tab only ever shows its own rows.
  const pinned = focus.draftId ? listed.find((d) => d.id === focus.draftId) ?? null : null;
  const view = effectiveDraftView(focus, pinned);
  const drafts = listed.filter((d) => d.status === view);
  // R32 (T-328): the CURRENT markup setting, so the price fine print is
  // recomputed live (never a stale frozen sentence) and drift is flagged.
  const pricingSettings = await getPricingSettings();
  const pinnedMissing = Boolean(focus.draftId) && !pinned;
  const pinnedMovedTab = Boolean(pinned) && view !== focus.view;
  // S14: paging copy, the focused delivery's header, the picker's choices.
  const paged = listPage.plan.mode === "paged";
  const pager = pageWindow(listPage.total, list.page, list.pageSize, drafts.length, listPage.pastEnd);
  const focusManifest = focus.manifestId ? picker?.manifests.find((m) => m.id === focus.manifestId) ?? null : null;
  // S17: the batch button - focused delivery, review tab, flag on, and an
  // EXACT priced count (unknown counts hide the button: never guess a number).
  const batchPriced =
    focusManifest && picker?.countsComplete ? pricedInReview(picker.counts.get(focusManifest.id) ?? null) : null;
  const batchOn = batchStagingEnabled(process.env[BATCH_STAGING_ENV]);
  const batchDone = parseBatchResult(sp);
  // R19 S13: the batch lookup for the focused delivery (review tab only).
  // Hidden when the flag is off or AI is not set up; the job and the exact
  // button count are read on the server (never guessed).
  const batchLookupOn = Boolean(focus.manifestId) && view === "draft" && lookupJobsOn() && isAiConfigured;
  const batchLookup = batchLookupOn && focus.manifestId ? await loadManifestLookup(focus.manifestId) : null;
  const batchLookupJob = batchLookup?.state === "job" ? batchLookup.job : null;
  const batchLookupActive = batchLookupJob !== null && (batchLookupJob.status === "queued" || batchLookupJob.status === "running");
  const batchLookupEligible = batchLookup && (batchLookup.state === "job" || batchLookup.state === "none") ? batchLookup.eligible : null;
  const batchLookupAttachOn = attachFactsV2Enabled();
  // R21: one decision for every state - the button, Stop, a plain reason, or
  // (no delivery focused) a list of deliveries to open. Never silent.
  const batchEntry = batchLookupEntry({
    focused: Boolean(focus.manifestId),
    view,
    flagOn: lookupJobsOn(),
    aiOn: isAiConfigured,
    attachOn: batchLookupAttachOn,
    state: batchLookup ? batchLookup.state : null,
    jobActive: batchLookupActive,
    eligible: batchLookupEligible,
  });
  const batchChoices =
    batchEntry.kind === "choose" && picker
      ? lookupDeliveryChoices(
          picker.manifests.map((m) => ({
            id: m.id,
            label: manifestPickerLabel(m, null, now),
            inReview: picker.countsComplete ? picker.counts.get(m.id)?.inReview ?? 0 : null,
          })),
        )
      : [];
  const lookupResult = lookupBanner(sp.lookup, sp.lookup_msg) ?? waitingResultBanner(sp.wf, sp.wf_msg);
  const headerTitle = onboardingHeaderTitle(
    focusManifest,
    focusManifest && picker?.countsComplete ? picker.counts.get(focusManifest.id) ?? null : null,
    now,
  );
  const vendorChoices = picker ? pickerVendors(picker.manifests) : [];
  const listFilters = { status: view, manifestId: focus.manifestId, q: list.q, vendorId: list.vendorId, pageSize: list.pageSize, rows: list.rows };
  const filtered = Boolean(list.q || list.vendorId);
  const filterVendors = focus.manifestId
    ? Array.from(new Set(drafts.map((d) => (d.vendor_name ?? "").trim()).filter(Boolean)))
    : [];
  // SLICE 78: [value, label] pairs for the "Pick a category" select — the
  // owner's live registry, sorted by the same order the settings page uses.
  const categoryChoices = Object.entries(categoryLabelMap);
  // SLICE L5: per-draft "must this be measured before it can be onboarded?".
  const volumeAssessments = new Map<string, ReturnType<typeof assessReceivingVolume>>();

  // SLICE 64 (owner bug B3): resolve OUR website category + run the SLICE 63
  // type labeler for every row, so the table shows OUR labels (never the raw
  // CCRS blob) and the approval card KNOWS what the human must pick. One
  // batched resolver call; the raw LCB values stay visible in fine print so
  // the approver can decide with full information.
  // S02: the same published-menu read also says which keys are LIVE cards,
  // so Enrich now can open the product itself (no extra query).
  const { resolutions, liveKeys } = await resolveWebsiteCategoriesWithLiveKeys(
    drafts.map((d) => ({
      posProductKey: d.pos_product_key,
      productName: d.name,
      inventoryType: d.inventory_type,
      category: d.category,
    })),
  );
  const assessments = new Map<string, DraftClassificationAssessment>();
  // SLICE 18-0: the COMPLIANCE assessment - does this product need somebody to
  // answer the suppository question before it can go on the shelf? Computed
  // here for the UI only; approveDraftWithPrice re-derives it server-side and
  // is the actual gate. This is deliberately TARGETED: it fires on the three
  // liquid_edible shelves and on a detector hit, and nowhere else, because a
  // gate that interrupts every flower delivery is a gate staff click through.
  const complianceAssessments = new Map<string, ReceivingClassificationAssessment>();
  // SLICE 18F: the MEMORY. `pos_product_key` is `sku ?? lot_code`
  // (intake-parser.ts:414), so for any manifest without a SKU the key changes
  // every delivery and the gate above re-asks a question this owner has
  // already answered - sometimes many times. One batched read of prior
  // APPROVED decisions lets the picker arrive pre-filled and labelled.
  //
  // OPTION B (owner's decision): pre-fill the ANSWER, never the DECISION. The
  // pick below stays `required`, so the fail-permissive gate is not weakened.
  const [priorClassifications, priorOnboardingPicks] = await Promise.all([
    listPriorClassifications(),
    // R32: the approved history of shelf / type / strain-type picks.
    listPriorOnboardingPicks(),
  ]);
  const allowedTypeLabels = new Set<string>([
    ...INVENTORY_TYPE_CATALOG.map((e) => e.label),
    ...ownerTypes.map((t) => t.label),
  ]);
  const ownerTypeShelves = ownerTypes.map((t) => ({ label: t.label, websiteCategory: t.website_category }));
  const recalls = new Map<string, OnboardingRecall>();
  const memories = new Map<string, PriorClassification | null>();
  drafts.forEach((d, i) => {
    assessments.set(
      d.id,
      assessDraftClassification({
        productName: d.name,
        inventoryType: d.inventory_type,
        resolvedWebsiteCategory: resolutions[i]?.websiteCategory ?? null,
      }),
    );
    complianceAssessments.set(
      d.id,
      assessReceivingClassification({
        productName: d.name,
        inventoryType: d.inventory_type,
        resolvedWebsiteCategory: resolutions[i]?.websiteCategory ?? null,
      }),
    );
    // SLICE L5: does this draft need a human to MEASURE it? Derived with the
    // SAME pair the approval gate and draft injection use, so the card cannot
    // show a question the server will not ask, or hide one it will.
    // Display only — approveDraftWithPrice re-derives all of it server-side.
    {
      const facts = extractNameFacts(d.name);
      volumeAssessments.set(
        d.id,
        assessReceivingVolume({
          resolvedWebsiteCategory: resolutions[i]?.websiteCategory ?? null,
          derivedVolumeMl: deriveNetVolumeMl({
            rawName: d.name,
            sizes: facts.sizes,
            packCount: facts.packCount,
          }).netVolumeMl,
          // SLICE T1 — a weight-labelled salve is already measured, so the
          // card must not show a question the server will not ask.
          derivedWeightGrams: deriveNetWeightGrams(facts.sizes),
        }),
      );
    }
    memories.set(
      d.id,
      recallClassification({
        candidate: {
          vendorName: d.vendor_name,
          brandName: d.brand_name,
          productName: d.name,
          // Match on the shelf the product will ACTUALLY sit in, which is what
          // the earlier decision was recorded against.
          category: resolutions[i]?.websiteCategory ?? d.category,
        },
        history: priorClassifications,
      }),
    );
    recalls.set(
      d.id,
      recallOnboardingPicks({
        candidate: { vendorName: d.vendor_name, brandName: d.brand_name, productName: d.name },
        resolvedWebsiteCategory: resolutions[i]?.websiteCategory ?? null,
        history: priorOnboardingPicks,
        allowedTypeLabels,
      }),
    );
  });


  // S03 SHADOW RING (console only, zero behaviour change, ZERO queries): how
  // many open drafts are re-deliveries of an already-approved product whose
  // new lot key restock merge could not match? Uses only what this page has
  // already loaded (drafts, approved history, live keys). Never throws.
  if (view === "draft") {
    try {
      const shadowLine = identityShadowLogLine(
        summarizeIdentityShadow({
          drafts: drafts.map((d, i) => ({
            posProductKey: d.pos_product_key,
            identity: {
              vendorName: d.vendor_name,
              brandName: d.brand_name,
              productName: d.name,
              category: resolutions[i]?.websiteCategory ?? d.category,
            },
          })),
          approvedHistory: priorClassifications,
          liveKeys,
        }),
      );
      if (shadowLine) console.info(shadowLine);
    } catch (err) {
      console.error("[identity-shadow] summary failed (display unaffected):", err);
    }
  }

  // SLICE 92: the type picker = hardcoded catalog ∪ the owner's registry
  // (listInventoryTypes returns DB rows + catalog fillers; the merge skips
  // catalog built-ins so each type appears exactly once). Owner-created types
  // group under their mapped website category, unmapped ones under "Other
  // types" - a type created yesterday (or one row ago) is a one-click pick.
  const typeGroups = mergeOwnerTypesIntoGroups(
    groupCatalogByCategory(),
    ownerTypes,
    (value) => labelForCategory(categoryLabelMap, value),
  );

  // SLICE 93: one batched read (kb_strains by slug + inventory_lots by id)
  // folded into a per-draft strain-type suggestion (kb > manifest > name
  // parse). >=90% shows as "Keep auto" and submits no override; below the bar
  // it's an honest hint the approver can confirm or correct.
  // S10: the same two reads also return the raw library/manifest readings,
  // which the lookup panel forwards so the policy can corroborate strain type.
  // The footer's shadow counters are read in parallel (skipped at ring 0).
  const attachRing = currentAttachPolicyRing();
  // S09: what the shop already knows about each product on THIS page (review
  // tab only): one batched knowledge-ladder load + one fact-history read, in
  // parallel with the reads above. "Last onboarded" reuses the approved
  // history already loaded (priorClassifications) - no extra query. Never
  // throws; KB_FIRST_ONBOARDING=off skips it entirely.
  const kbFirst = kbFirstOnboardingEnabled(process.env[KB_FIRST_ONBOARDING_ENV]);
  // R23 (items 2 + 6): the facts a lookup filed for these rows (one bounded
  // read, the same suggestion key the S07 door files under). R23 (item 5):
  // the approved tab recalls memory too, so its opened row shows the facts.
  const rowsOpen = view === "draft" || view === "approved";
  const waitingKeys = new Map(drafts.map((d) => [d.id, waitingKeyForDraft(d)] as const));
  const [{ suggestions: strainSuggestions, evidence: strainEvidence, sizeLabels: strainSizeLabels }, shadowSummary, productMemories, waitingRead, labViews] = await Promise.all([
    loadStrainTypeSignals(drafts),
    attachRing === 0 ? Promise.resolve(null) : loadShadowSummary(),
    kbFirst && rowsOpen
      ? recallProductMemories(
          drafts.map((d, i) => ({
            id: d.id,
            identityKey: identityForDraft(d, { websiteCategory: resolutions[i]?.websiteCategory ?? null }).identityKey,
            query: knowledgeQueryForDraft(d),
            // The keys the S07 door / 0234 seeding may have stamped history under.
            historyKeys: [identityForDraft(d).identityKey, d.identity_key ?? ""],
          })),
          priorClassifications,
        )
      : Promise.resolve(null),
    rowsOpen ? loadWaitingSuggestions(Array.from(waitingKeys.values())) : Promise.resolve({ ok: true, rows: [] }),
    // R30: each row's stored lab-certificate read (terpenes chip + the
    // Product facts panel's lab block) and the strain library's terpenes.
    rowsOpen ? loadLabViewsForDrafts(drafts) : Promise.resolve(null),
  ]);
  const shadowFooter = shadowFooterCopy(shadowSummary, attachRing);

  // (S34: runs after the strain-signal read so each row carries its lot's size label.)
  // S19.2 PREVIEW: what Approve WILL do for each row of the focused delivery
  // ("Restock -> joins live card ..."). Same pure planner as the staging
  // (previewRestockVerdicts), same category rule (chosen ?? resolved). Only
  // on the review tab of ONE delivery - the question is per delivery, and
  // it keeps the reads bounded. Any incomplete read says so on screen.
  const previewPlan = restockPreviewPlan({ view, manifestId: focus.manifestId, rows: drafts.length });
  const restockPreview = previewPlan.load
    ? await loadRestockPreview(
        drafts.map((d, i) => ({
          id: d.id,
          pos_product_key: d.pos_product_key,
          name: d.name,
          brand_name: d.brand_name,
          vendor_name: d.vendor_name,
          strain_name: d.strain_name,
          category: d.chosen_website_category?.trim() || resolutions[i]?.websiteCategory || null,
          // S34: the size Approve will write (same lot read as strain type; display only).
          size_label: strainSizeLabels.get(d.id) ?? null,
        })),
      )
    : null;
  const previewNote =
    previewPlan.unavailable !== null
      ? previewUnavailableCopy(previewPlan.unavailable)
      : restockPreview && !restockPreview.ok
        ? previewUnavailableCopy(restockPreview.reason)
        : null;
  const previewVerdicts = restockPreview && restockPreview.ok ? restockPreview.verdicts : null;
  // S34: the groups the SAME dry run built (null = no preview -> no panel).
  const previewGroups = restockPreview && restockPreview.ok ? restockPreview.groups : null;

  // S11: the redesigned row (Facts + Manifest columns, the facts panel, the
  // lookup outside the approve form, the in-row error). ONBOARDING_V2_ROW=off
  // renders the previous row (bible S11.7 rollback).
  const v2Row = onboardingV2RowEnabled(process.env[ONBOARDING_V2_ROW_ENV]);
  // S41: the header cells AND the detail row's colSpan come from this list.
  const columns = onboardingColumns(v2Row);
  const policyMode = attachPolicyMode(attachRing);
  const manifestById = new Map((picker?.manifests ?? []).map((m) => [m.id, m]));

  // T-314: is the AI lookup available? (soft-disables the panel when no key.)
  const aiLookupEnabled = isAiConfigured;

  // S30: which approved rows have an open fact flag on their delivery's
  // newest held update. Approved tab only; bounded reads; never writes.
  // R13a: a delivery-focused view reads THAT delivery's flags even when none
  // of its flagged rows is on this page (the Approved view is paged).
  const factFlags =
    view === "approved"
      ? await loadOpenIntakeFactFlags(focus.manifestId ? [{ manifest_id: focus.manifestId }, ...drafts] : drafts)
      : null;
  // R13a: every open flag for the focused delivery, each with a link that
  // pins its row - so a flag on page 3 is never invisible from page 1.
  const factWorklist =
    factFlags && focus.manifestId && !focus.draftId
      ? factFlagWorklist(factFlags.flags.values(), focus.manifestId, new Set(drafts.map((d) => d.id)))
      : [];
  const factResult = parseFactResult(sp.fact);
  // R27: the facts a person saved for each shown product (review AND
  // approved tabs) - shown and editable on the row's Product facts panel.
  const savedFacts = rowsOpen && v2Row
    ? await loadSavedProductFacts(focus.manifestId ? [{ manifest_id: focus.manifestId }, ...drafts] : drafts)
    : null;

  // One error sentence for the banner AND (S11, F-033) the failed row itself.
  const errorText =
    error === "floor" ? (msg || "Price is below the cost floor.")
      : error === "price" ? "Enter a valid price before approving."
        : error ? "Something went wrong updating that draft."
          : null;
  const banner =
    factResult ? factResultCopy(factResult, sp.fact_msg)
    : batchDone ? batchResultCopy(batchDone)
    : approved ? "Approved — it's live on the website and sellable at the register now. Add photos & a description in Product Enrichment whenever you're ready."
      : dismissed ? "Draft dismissed."
        : restored ? "Draft restored to the review queue."
          : errorText;
  // R23 (item 5): where the product just approved went (validated UUID only).
  const approvedLink = approved ? approvedBannerLink(sp.approved_draft, focus.manifestId) : null;
  const bannerTone = error || factResult === "error" ? "danger" : "accent";

  return (
    <div>
      <AdminPageHeader
        title={headerTitle}
        subtitle="When a received lot isn't on the live menu, we draft the product from the transfer + COA so you can check it. Nothing here is customer-facing until you approve it — and approving with a price is what puts it live."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Product Intake", href: "/admin/catalog" },
              { label: "Product Onboarding" },
            ]}
          />
        }
        help={
          <HelpPanel
            id="catalog-drafts"
            title="How product onboarding works"
            steps={[
              "On accepting a manifest, we match each lot to the published menu by its POS key.",
              "Lots that don't match get a DRAFT product, pre-filled from the JSON + COA potency.",
              "Review the details, then Approve (validated) or Dismiss (not a new product).",
              "If we couldn't classify a product at 90% confidence or better, the approve form asks you to pick its category or type from our own list — no product is ever guessed onto the menu.",
              APPROVE_PUBLISHES_COPY,
              HELD_EXCEPTION_COPY,
            ]}
          >
            <p>
              This keeps the live menu clean: machine-suggested products always wait for a human to
              confirm them before customers ever see them. Your Approve click is the go-live
              decision, so there is no second publish step to remember.
            </p>
            <SopSheetLink slug="onboard" />
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <div>
          <BackLink
            fallback="/admin/catalog"
            back={back}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
          >
            ← Back to Product Intake Hub
          </BackLink>
        </div>
        <CatalogStageStrip current="onboarding" />

        {/* W4: one plain-English next action for the tab you're on. */}
        <WhatDoIDoHere action={draftsWhatDoIDoHere(view, counts)} />

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Needs review" value={counts.draft} accent={counts.draft > 0 ? "gold" : "muted"} href="/admin/inventory/drafts?status=draft" />
          <StatCard label="Approved" value={counts.approved} accent="green" href="/admin/inventory/drafts?status=approved" />
          <StatCard label="Dismissed" value={counts.dismissed} accent="muted" href="/admin/inventory/drafts?status=dismissed" />
        </div>

        {banner && (
          <div
            className={
              bannerTone === "danger"
                ? "rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]"
                : "rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]"
            }
          >
            {banner}
            {approved && approvedLink && (
              <>
                {" "}
                <a href={approvedLink} className="font-semibold underline" data-testid="approved-banner-link">
                  {APPROVED_BANNER_LINK_TEXT} &rarr;
                </a>
              </>
            )}
          </div>
        )}

        {lookupResult && (
          <div
            role={lookupResult.tone === "error" ? "alert" : "status"}
            data-testid="lookup-result"
            className={
              lookupResult.tone === "error"
                ? "rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]"
                : "rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]"
            }
          >
            {lookupResult.text}
          </div>
        )}

        {/* S30: fact review cannot be saved until migration 0237 is applied. */}
        {factFlags && factFlags.flags.size > 0 && !factFlags.migrated && (
          <p className="text-xs text-[var(--admin-text-muted)]" data-testid="fact-review-migration">
            {FACT_REVIEW_MIGRATION_COPY}
          </p>
        )}
        {factFlags && !factFlags.ok && factFlags.migrated && (
          <p className="text-xs text-[var(--admin-text-muted)]" data-testid="fact-review-partial">
            Some deliveries could not be checked for flagged facts just now. Reload to try again, or open Admin → Publish Menu.
          </p>
        )}

        {/* S02: where a deep link landed you, and one click back to everything. */}
        {focus.manifestId && (
          <div className="flex flex-wrap items-center gap-3 rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            <span>
              Showing only the products from one delivery
              {filterVendors.length > 0 ? ` (${filterVendors.join(", ")})` : ""}.
            </span>
            <Link href={draftsHref({ status: view })} className="font-semibold underline">
              Show every delivery
            </Link>
            {/* S22 (F-008): the enrichment list filtered to THIS delivery,
                newest first - by manifest, not by a name search. */}
            <Link href={enrichDeliveryHref(focus.manifestId)} className="font-semibold underline" data-testid="enrich-this-delivery">
              ✨ Enrich this delivery&apos;s products →
            </Link>
          </div>
        )}
        {/* R13a: the flagged-facts worklist. The Keep / Correct / Take off
            panel sits on each product's row; this list names every one for
            the delivery, so none hides on a later page. */}
        {factWorklist.length > 0 && (
          <section
            id="flagged-facts"
            data-testid="fact-worklist"
            className="scroll-mt-24 rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm"
          >
            <p className="font-semibold text-[var(--admin-gold)]">
              {factWorklist.length} product{factWorklist.length === 1 ? " has a fact" : "s have facts"} to check before this delivery&apos;s menu update goes live
            </p>
            <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
              Open each one and choose Keep, Correct, or Take off the menu. The update publishes by itself once every flag has a decision.
            </p>
            <ul className="mt-2 space-y-1 text-xs">
              {factWorklist.map((w) => (
                <li key={w.draftId} className="flex flex-wrap items-baseline gap-2">
                  <Link href={w.href} className="font-semibold text-[var(--admin-text)] underline" data-testid="fact-worklist-link">
                    {w.productName}
                  </Link>
                  <span className="text-[var(--admin-text-muted)]">{w.reason}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* S17: approve the whole delivery's priced products at once, then
            update the menu ONCE (bible S17.2 / S17.4). */}
        {focus.manifestId && view === "draft" && batchOn && batchPriced !== null && batchPriced > 0 && (
          <form
            action={approveAllPricedAction.bind(null, focus.manifestId)}
            className="flex flex-wrap items-center gap-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-3 text-sm"
          >
            <input type="hidden" name="return_manifest" value={focus.manifestId} />
            <Button type="submit" variant="save" size="sm">✓ {batchButtonLabel(batchPriced)}</Button>
            <span className="text-xs text-[var(--admin-text-muted)]">{BATCH_BUTTON_HELP}</span>
          </form>
        )}
        {/* R19 S13 (bible S13.4): look up the whole delivery on the server.
            The press only writes a job; the every-minute worker
            (/api/cron/lookup-jobs) does the lookups, so closing this tab
            loses nothing. Facts attach only under the S10 attach policy. */}
        {batchEntry.kind !== "hidden" && (
          <section
            id="batch-lookup"
            aria-labelledby="batch-lookup-title"
            data-testid="batch-lookup"
            data-entry={batchEntry.kind}
            className="flex scroll-mt-24 flex-col gap-2 rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-surface)] px-4 py-3 text-sm"
          >
            <p id="batch-lookup-title" className="font-semibold text-[var(--admin-text)]">{"\u2728 "}Look up a whole delivery with AI</p>
            {focus.manifestId && batchLookupJob && (
              <div data-testid="batch-lookup-progress" aria-live="polite">
                <p className="font-semibold text-[var(--admin-text)]">{jobHeadline(batchLookupJob.status, batchLookupJob.summary)}</p>
                <p className="text-xs text-[var(--admin-text-muted)]">{progressLine(batchLookupJob.summary)}</p>
                <p className="text-xs text-[var(--admin-text-muted)]">{costLine(batchLookupJob.summary, batchLookupJob.model)}</p>
                {batchLookupJob.summary.failed > 0 && (
                  <p className="text-xs text-[var(--admin-danger)]">
                    {batchLookupJob.summary.failed} could not be looked up; the reason is on each row. AI Lookup on that row tries again.
                  </p>
                )}
              </div>
            )}
            {batchEntry.kind === "reason" ? (
              <p className="text-xs text-[var(--admin-text-muted)]" data-testid={batchLookup?.state === "migration" ? "batch-lookup-migration" : "batch-lookup-reason"}>
                {batchEntry.text}
              </p>
            ) : batchEntry.kind === "choose" ? (
              <div data-testid="batch-lookup-choose" className="flex flex-col gap-2">
                <p className="text-xs text-[var(--admin-text-muted)]">{batchChoices.length > 0 ? LOOKUP_CHOOSE_COPY : LOOKUP_CHOOSE_NONE_COPY}</p>
                {batchChoices.length > 0 && (
                  <ul className="flex flex-wrap gap-2">
                    {batchChoices.map((c) => (
                      <li key={c.id}>
                        <Link
                          href={`${draftsHref({ manifestId: c.id })}#batch-lookup`}
                          className="inline-flex items-baseline gap-2 rounded-full border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-1 text-xs hover:border-[var(--admin-accent)]"
                          data-testid="batch-lookup-choice"
                        >
                          <span className="font-semibold text-[var(--admin-text)]">{c.label}</span>
                          <span className="text-[var(--admin-text-muted)]">{c.countText}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : batchEntry.kind === "stop" && focus.manifestId && batchLookupJob ? (
              <form action={cancelLookupAction.bind(null, batchLookupJob.jobId)} className="flex flex-wrap items-center gap-3">
                <input type="hidden" name="return_manifest" value={focus.manifestId} />
                <Button type="submit" variant="neutral" size="sm">Stop the batch lookup</Button>
                <span className="text-xs text-[var(--admin-text-muted)]">Refresh to see progress. Products not started yet are skipped; the one in progress finishes.</span>
              </form>
            ) : batchEntry.kind === "button" && focus.manifestId && batchLookupEligible ? (
              <form action={lookupAllAction.bind(null, focus.manifestId)} className="flex flex-wrap items-center gap-3">
                <input type="hidden" name="return_manifest" value={focus.manifestId} />
                <Button type="submit" variant="special" size="sm" data-testid="batch-lookup-button">
                  {"\u2728 "}{batchEntry.label}
                </Button>
                <span className="text-xs text-[var(--admin-text-muted)]">
                  {LOOKUP_ALL_HELP}
                  {batchLookupEligible.truncated > 0 ? ` This press covers the first ${batchLookupEligible.count}; press again afterwards for the other ${batchLookupEligible.truncated}.` : ""}
                </span>
              </form>
            ) : null}
          </section>
        )}
        {pinned && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-2 text-sm text-[var(--admin-gold)]">
            The product you came here for is highlighted below
            {pinnedMovedTab ? ` \u2014 it's on the ${view === "draft" ? "Needs review" : view} tab now` : ""}.{" "}
            <a href={`#${draftRowAnchorId(pinned.id)}`} className="font-semibold underline">
              Jump to it
            </a>
          </div>
        )}
        {pinnedMissing && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm text-[var(--admin-text-muted)]">
            That link pointed at a product draft that no longer exists, so the full list is shown instead.
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 text-sm">
          {(["draft", "approved", "dismissed"] as const).map((s) => (
            <Link
              key={s}
              href={draftsHref({ status: s, manifestId: focus.manifestId })}
              className={`rounded-full px-3 py-1 font-medium capitalize ${
                view === s
                  ? "bg-[var(--admin-accent)] text-black"
                  : "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
              }`}
            >
              {s === "draft" ? "Needs review" : s}
            </Link>
          ))}
        </div>

        {/* S14 (F-001, F-034): find one delivery's products in one click. A
            plain GET form - no client JS, and every choice is a shareable URL. */}
        {!focus.draftId && (
          <form
            method="get"
            action="/admin/inventory/drafts"
            className="flex flex-wrap items-end gap-2 text-xs"
            data-testid="onboarding-filter-bar"
          >
            {view !== "draft" && <input type="hidden" name="status" value={view} />}
            {list.rows === "expanded" && <input type="hidden" name="rows" value="expanded" />}
            {picker && picker.manifests.length > 0 && (
              <label className="flex flex-col gap-1">
                <span className="font-semibold text-[var(--admin-text-faint)]">Delivery (last 30 days)</span>
                <Select name="manifest" defaultValue={focus.manifestId ?? ""} className="w-72 text-xs" aria-label="Delivery">
                  <option value="">Every delivery</option>
                  {picker.manifests.map((m) => (
                    <option key={m.id} value={m.id}>
                      {manifestPickerLabel(m, picker.countsComplete ? picker.counts.get(m.id) ?? { total: 0, inReview: 0, needsPrice: 0 } : null, now)}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            {vendorChoices.length > 0 && (
              <label className="flex flex-col gap-1">
                <span className="font-semibold text-[var(--admin-text-faint)]">Vendor</span>
                <Select name="vendor" defaultValue={list.vendorId ?? ""} className="w-48 text-xs" aria-label="Vendor">
                  <option value="">Every vendor</option>
                  {vendorChoices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            <label className="flex flex-col gap-1">
              <span className="font-semibold text-[var(--admin-text-faint)]">Search</span>
              <Input
                name="q"
                defaultValue={list.q}
                placeholder="Name, brand, vendor, strain or POS key"
                className="w-64 text-xs"
                aria-label="Search products"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-semibold text-[var(--admin-text-faint)]">Per page</span>
              <Select name="size" defaultValue={String(list.pageSize)} className="w-20 text-xs" aria-label="Products per page">
                {DRAFT_PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </label>
            <Button type="submit" variant="neutral" size="sm">Apply</Button>
            {filtered && (
              <Link href={onboardingListHref({ ...listFilters, q: null, vendorId: null })} className="pb-1 font-semibold underline">
                Clear search
              </Link>
            )}
            <Link
              href={onboardingListHref({ ...listFilters, page: list.page, rows: list.rows === "expanded" ? "condensed" : "expanded" })}
              className="ml-auto pb-1 font-semibold text-[var(--admin-text-muted)] underline"
            >
              {list.rows === "expanded" ? "Collapse every row" : "Expand every row"}
            </Link>
          </form>
        )}
        {listPage.plan.ignored.length > 0 && (
          <p className="text-xs text-[var(--admin-text-faint)]">
            Search, vendor and page are set aside while one product is pinned, so the link always lands on it.
          </p>
        )}

        {previewNote && drafts.length > 0 ? <RestockPreviewUnavailable text={previewNote} /> : null}
        {drafts.length > 0 ? (
          <MasteringPreviewPanel
            groups={previewGroups}
            rowNames={new Map(drafts.map((d) => [d.id, d.name]))}
            totalRows={drafts.length}
            manifestId={focus.manifestId}
            back={draftsHref({ manifestId: focus.manifestId })}
          />
        ) : null}
        {drafts.length === 0 ? (
          <EmptyState
            icon="📝"
            title={
              pager.pastEnd
                ? "That page is past the end of the list"
                : filtered
                ? "Nothing matches that search"
                : focus.manifestId
                ? `No ${view === "draft" ? "drafts to review" : `${view} drafts`} from this delivery`
                : view === "draft"
                  ? "No drafts to review"
                  : `No ${view} drafts`
            }
            description={
              pager.pastEnd
                ? pager.label
                : filtered
                ? "Try fewer words, or clear the search to see this tab again."
                : view === "draft"
                ? "When you accept a manifest with products that aren't on the live menu, they'll show up here."
                : "Nothing here yet."
            }
          />
        ) : (
          <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
            <table className="w-full text-sm" aria-label={v2Row ? "Products to onboard" : undefined}>
              <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} className={c.alignRight ? "px-4 py-3 text-right" : "px-4 py-3"}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--admin-border)]">
                {drafts.map((d, i) => {
                  const approve = approveDraftAction.bind(null, d.id);
                  const dismiss = dismissDraftAction.bind(null, d.id);
                  const restore = restoreDraftAction.bind(null, d.id);
                  const defaultPrice =
                    (d.price_minor_units ?? d.suggested_price_minor_units ?? d.price_floor_minor_units ?? 0) / 100;
                  const floorDollars = d.price_floor_minor_units != null ? d.price_floor_minor_units / 100 : undefined;
                  // SLICE 64: OUR classification verdict for this row. The
                  // approver's own picks (approved rows) outrank the machine.
                  const a = assessments.get(d.id);
                  // SLICE 18-0: the compliance assessment for this row.
                  const ca = complianceAssessments.get(d.id);
                  const va = volumeAssessments.get(d.id);
                  // SLICE 18F: the remembered answer for THIS product, if a
                  // human ever gave one. Null when nothing qualifies - a
                  // machine default is deliberately not recalled.
                  const memory = memories.get(d.id) ?? null;
                  const prefill = prefillFromMemory(memory);
                  // R32: this product's own earlier decisions (identity memory).
                  const recall = recalls.get(d.id) ?? null;
                  const displayCategory =
                    d.chosen_website_category ?? a?.resolvedWebsiteCategory ?? recall?.websiteCategory?.value ?? null;
                  // R32: remembered > labeler >=90 > one-type category > ask.
                  // The SAME function the server gate runs.
                  const effType = effectiveHouseType({
                    labeler: {
                      houseType: a?.house.houseType ?? null,
                      confidence: a?.house.confidence ?? 0,
                      autoAssigned: Boolean(a && !a.needsTypePick),
                    },
                    recalled: recall?.houseType ?? null,
                    websiteCategory: displayCategory,
                    ownerTypes: ownerTypeShelves,
                  });
                  const autoType = effType.value;
                  const displayType = d.chosen_house_type ?? autoType;
                  const needsCategoryPick =
                    view === "draft" && Boolean(a?.needsCategoryPick) && !recall?.websiteCategory;
                  const needsTypePick = view === "draft" && effType.needsTypePick;
                  const effStrain = effectiveStrainType({
                    recalled: recall?.strainType ?? null,
                    suggestion: strainSuggestions.get(d.id) ?? null,
                  });
                  // S14: the collapsed row's "what this one still needs" chips -
                  // the SAME flags that render the pickers below.
                  const rowChips = rowAttention({
                    needsCategoryPick,
                    needsTypePick,
                    needsOtherwiseTakenPick: Boolean(ca?.needsOtherwiseTakenPick),
                    promptsLowThcLiquid: Boolean(ca?.promptsLowThcLiquid),
                    needsVolumePick: Boolean(va?.needsVolumePick),
                    suggestedPriceMinor: d.suggested_price_minor_units,
                  });
                  // SLICE 65 (A1/A3/A4): the name shown here is the BUILT
                  // customer name — the same family derivation the menu card
                  // will use (size/pack noise stripped, mg dose kept for
                  // dose-led items). NULL means "not confident": the raw
                  // manifest name stays on screen, never a guess. The raw
                  // string drops to fine print when a built name exists.
                  const builtName = displayCategory
                    ? intakeDisplayName({
                        name: d.name || "",
                        product_name: d.name || null,
                        brand_name: d.brand_name ?? "",
                        vendor_name: d.vendor_name,
                        category: displayCategory,
                        strain_name: d.strain_name,
                      })
                    : null;
                  // S11: what is attached (records the row holds + the draft's
                  // attached facts + the S09 memory), one chip per field.
                  const facts = v2Row && rowsOpen
                    ? buildFactChips(attachedFactsOf(d as unknown as Record<string, unknown>), productMemories?.get(d.id) ?? null, { mode: policyMode }, rowRecordFacts({
                        chosenWebsiteCategory: d.chosen_website_category,
                        resolvedWebsiteCategory: resolutions[i]?.websiteCategory ?? null,
                        resolutionSource: resolutions[i]?.source ?? null,
                        categoryLabel: (v) => websiteCategoryLabel(v) ?? v,
                        chosenStrainType: d.chosen_strain_type,
                        strainSuggestion: strainSuggestions.get(d.id) ?? null,
                        strainLabel: (v) => strainTypeDefinitions.find((t) => t.value === v)?.label ?? v,
                        totalThcPct: d.total_thc_pct,
                        thcPct: d.thc_pct,
                        labResultId: d.lab_result_id,
                        coaTerpenes: labViews?.byDraft.get(d.id)?.coaTerpenes ?? null,
                        coaRead: labViews?.byDraft.get(d.id)?.coaRead ?? false,
                        strainTerpenes: labViews?.strainTerpenes.get(strainSlug(d.strain_name)) ?? null,
                      }))
                    : null;
                  const identity = v2Row && rowsOpen
                    ? identityLine(identityForDraft(d, { websiteCategory: resolutions[i]?.websiteCategory ?? null }).identityKey, d, kbFirst)
                    : null;
                  const manifest = v2Row ? manifestCell(d.manifest_id ? manifestById.get(d.manifest_id) : null) : null;
                  const rowError = v2Row && pinned?.id === d.id ? errorText : null;
                  // T-314: manual web-grounded lookup (AI_MODEL_HEAVY).
                  // Prefilled with this row's name + brand; the operator presses
                  // Search (never auto-run). A >=90% result autofills the
                  // strain-type select (found by id, so it works inside or
                  // outside the approve form). S11 (F-020) mounts it OUTSIDE the
                  // approve form; ONBOARDING_V2_ROW=off keeps it inside.
                  // R19 S13: this row's line from the delivery's batch lookup.
                  const batchItem = batchLookupJob?.items.get(d.id.toLowerCase()) ?? null;
                  const batchRowLine = batchItem ? (
                    <p
                      className={`${v2Row ? "text-left" : "max-w-[28rem] text-right"} text-xs ${batchItem.status === "failed" ? "text-[var(--admin-danger)]" : "text-[var(--admin-text-muted)]"}`}
                      data-testid="batch-lookup-row"
                    >
                      {itemRowCopy(batchItem)}
                    </p>
                  ) : null;
                  // R23 (item 2/6): the facts the batch lookup (pending
                  // suggestions on this product's key) and the S09 memory hold
                  // for this row, minus what is already attached - each one
                  // attachable right here, without approving first.
                  const waitingView = rowsOpen
                    ? buildWaitingFacts({
                        suggestionKey: waitingKeys.get(d.id) ?? null,
                        suggestions: waitingRead.rows,
                        memory: productMemories?.get(d.id) ?? null,
                        attached: attachedFactsOf(d as unknown as Record<string, unknown>),
                      })
                    : null;
                  const lookupPanel = (
                    <>
                    {batchRowLine}
                    {waitingView && (
                      <WaitingFactsPanel
                        draftId={d.id}
                        view={waitingView}
                        action={attachWaitingFactAction}
                        returnManifest={focus.manifestId}
                        returnStatus={view}
                        readFailed={!waitingRead.ok}
                      />
                    )}
                    <AiLookupPanel
                      draftId={d.id}
                      productName={builtName ?? (d.name || "")}
                      vendorOrBrand={[d.brand_name, d.vendor_name].filter(Boolean).join(" ") || ""}
                      strainSelectId={`strain-type-${d.id}`}
                      posProductKey={d.pos_product_key ?? ""}
                      aiEnabled={aiLookupEnabled}
                      kbStrainType={strainEvidence.get(d.id)?.kb ?? null}
                      manifestStrainType={strainEvidence.get(d.id)?.manifest ?? null}
                      wide={v2Row}
                    />
                    </>
                  );
                  // S41: the approve controls - narrow inside the cell on the
                  // previous row, full zone width in the detail row.
                  const ctl = v2Row ? "w-full text-sm" : "w-48 text-xs";
                  const box = v2Row ? "w-full" : "w-48";
                  const hasSizeBlock =
                    view === "draft" && Boolean(ca?.needsOtherwiseTakenPick || ca?.promptsLowThcLiquid || va?.needsVolumePick);
                  // R23 (item 5): the Approved tab's third zone - what was
                  // decided, and where to finish.
                  const approvedCopy = view === "approved"
                    ? approvedRowCopy({
                        priceMinorUnits: d.price_minor_units,
                        categoryLabel: displayCategory ? websiteCategoryLabel(displayCategory) ?? displayCategory : null,
                        strainLabel: d.chosen_strain_type
                          ? strainTypeDefinitions.find((t) => t.value === d.chosen_strain_type)?.label ?? d.chosen_strain_type
                          : null,
                        houseType: displayType,
                        // R27: never "live" while a fact check keeps it off.
                        factHold: factFlags?.flags.get(d.id)
                          ? (factFlags.flags.get(d.id)!.withheld ? "withheld" : "held")
                          : null,
                      })
                    : null;
                  const approvedZone = approvedCopy ? (
                    <div className="flex flex-col gap-2" data-testid="approved-zone">
                      <p className="text-xs text-[var(--admin-text-muted)]">{approvedCopy.lead}</p>
                      {approvedCopy.lines.length > 0 && (
                        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                          {approvedCopy.lines.map(([label, value]) => (
                            <Fragment key={label}>
                              <dt className="text-[var(--admin-text-muted)]">{label}</dt>
                              <dd className="font-semibold text-[var(--admin-text)]">{value}</dd>
                            </Fragment>
                          ))}
                        </dl>
                      )}
                    </div>
                  ) : null;
                  const approveForm = (
                              <form action={approve} className={v2Row ? "flex flex-col gap-3" : "mt-2 flex flex-col items-end gap-2"} data-testid={v2Row ? "draft-approve-form" : undefined}>
                                {focus.manifestId && <input type="hidden" name="return_manifest" value={focus.manifestId} />}
                                {/* SLICE 64: required picks when we couldn't
                                    classify at >=90% confidence. The server
                                    re-checks — this is UX, not the gate.
                                    SLICE 91 (owner): BOTH pickers are now on
                                    EVERY draft row — "I want to be able to
                                    edit each one just in case." When the
                                    machine already classified the product the
                                    empty option reads "Keep auto: X" and
                                    submits NO override; only an actual
                                    selection records a human pick. */}
                                <ApproveGroup on={v2Row} legend="Classify">
                                <FieldLabel on={v2Row} htmlFor={`website-category-${d.id}`}>Website category</FieldLabel>
                                <Select
                                  id={v2Row ? `website-category-${d.id}` : undefined}
                                  name="website_category"
                                  required={needsCategoryPick}
                                  defaultValue=""
                                  className={ctl}
                                  aria-label="Website category"
                                >
                                  <option value="" disabled={needsCategoryPick}>
                                    {categoryPickerPlaceholder({
                                      needsCategoryPick,
                                      resolvedLabel: displayCategory
                                        ? websiteCategoryLabel(displayCategory)
                                        : null,
                                    })}
                                  </option>
                                  {categoryChoices.map(([value, label]) => (
                                    <option key={value} value={value}>
                                      {label}
                                    </option>
                                  ))}
                                  {/* SLICE 78: create a category without leaving
                                      onboarding — name it in the box below. */}
                                  <option value="__new__">➕ Create a new category…</option>
                                </Select>
                                <Input
                                  name="new_category_label"
                                  placeholder="New category name (only if creating one)"
                                  className={ctl}
                                  aria-label="New category name"
                                />
                                <FieldLabel on={v2Row} htmlFor={`house-type-${d.id}`}>Product type</FieldLabel>
                                <Select
                                  id={v2Row ? `house-type-${d.id}` : undefined}
                                  name="house_type"
                                  required={needsTypePick}
                                  defaultValue={needsTypePick ? a?.suggestedHouseType ?? "" : ""}
                                  className={ctl}
                                  aria-label="Product type"
                                >
                                  <option value="" disabled={needsTypePick}>
                                    {effType.source === "auto"
                                      ? typePickerPlaceholder({
                                          needsTypePick,
                                          autoType,
                                          confidence: a?.house.confidence ?? 0,
                                        })
                                      : effType.placeholder}
                                  </option>
                                  {typeGroups.map((g) => (
                                    <optgroup key={g.category} label={g.categoryLabel}>
                                      {g.types.map((t) => (
                                        <option key={t.label} value={t.label}>
                                          {t.label}
                                        </option>
                                      ))}
                                    </optgroup>
                                  ))}
                                  {/* SLICE 92: create a product type without
                                      leaving onboarding — name it in the box
                                      below. It saves to the same registry the
                                      Types & Categories page manages. */}
                                  <option value="__new_type__">➕ Create a new product type…</option>
                                </Select>
                                <Input
                                  name="new_type_label"
                                  placeholder="New type name (only if creating one)"
                                  className={ctl}
                                  aria-label="New product type name"
                                />
                                </ApproveGroup>
                                {/* SLICE 93: strain type - never required. The
                                    machine's verdict (strain library > the
                                    manifest's stated fact > the name parse)
                                    shows in the empty option; >=90% reads
                                    "Keep auto" and submits NO override. Only
                                    an actual selection records a human pick,
                                    which also gap-fills the strain library so
                                    it auto-attaches on future lots. */}
                                <ApproveGroup on={v2Row} legend="Menu card">
                                <FieldLabel on={v2Row} htmlFor={`strain-type-${d.id}`}>Strain type</FieldLabel>
                                <Select
                                  id={`strain-type-${d.id}`}
                                  name="strain_type"
                                  defaultValue=""
                                  className={ctl}
                                  aria-label="Strain type"
                                >
                                  <option value="">
                                    {recall?.strainType
                                      ? rememberedStrainPlaceholder(recall.strainType)
                                      : strainTypePickerPlaceholder(strainSuggestions.get(d.id) ?? null)}
                                  </option>
                                  {strainTypeDefinitions
                                    .filter((s) => s.value !== "unknown")
                                    .map((s) => (
                                      <option key={s.value} value={s.value}>
                                        {s.label}
                                      </option>
                                    ))}
                                </Select>
                                </ApproveGroup>
                                {/* SLICE 18-0: the COMPLIANCE classification.
                                    Only rendered where the answer could change
                                    a limit — the three liquid_edible shelves,
                                    or a name/CCRS type that looks like a
                                    suppository. On a flower or cartridge lot
                                    nothing appears at all, because
                                    qualifiesAsOtherwiseTaken() would refuse to
                                    move that line out of its statutory bucket
                                    however it were answered.

                                    Why this one BLOCKS while strain type does
                                    not: an unflagged suppository is filed as an
                                    ordinary topical, lands in the 2016 g liquid
                                    bucket, and the ten-unit maximum silently
                                    never engages (migration 0217). Silence here
                                    does not fail closed — it disables a
                                    statutory limit. */}
                                <ApproveGroup on={v2Row && hasSizeBlock} legend="Size & compliance">
                                {view === "draft" && ca?.needsOtherwiseTakenPick ? (
                                  <div className={`flex ${box} flex-col gap-1 rounded border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-2`}>
                                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                                      Compliance
                                    </span>
                                    <label
                                      className="text-[10px] text-[var(--admin-text-faint)]"
                                      htmlFor={`otherwise-taken-${d.id}`}
                                    >
                                      Taken into the body another way? (suppository)
                                    </label>
                                    <Select
                                      id={`otherwise-taken-${d.id}`}
                                      name="otherwise_taken"
                                      required
                                      /* SLICE 18F: pre-filled from the last
                                         answer a human gave for this product.
                                         `required` STAYS - Option B saves the
                                         typing, never the decision. */
                                      defaultValue={prefill.otherwiseTaken}
                                      className="text-xs"
                                      aria-label="Otherwise taken into the body"
                                    >
                                      <option value="" disabled>
                                        {otherwiseTakenPickerPlaceholder({
                                          needsOtherwiseTakenPick: true,
                                        })}
                                      </option>
                                      <option value="no">No — ordinary product</option>
                                      <option value="yes">Yes — suppository (10-unit limit)</option>
                                    </Select>
                                    <Input
                                      name="units_per_package"
                                      inputMode="numeric"
                                      placeholder="Units per package (a box of 6 = 6)"
                                      className="text-xs"
                                      aria-label="Units per package"
                                      defaultValue={prefill.unitsPerPackage}
                                    />
                                    {/* SLICE 18F: never a silent pre-fill. The
                                        operator is told WHOSE answer this is
                                        and HOW OLD it is, so a stale
                                        classification can be spotted and
                                        overridden rather than rubber-stamped. */}
                                    {prefill.isRemembered ? (
                                      <span className="text-[10px] text-[var(--admin-accent)]">
                                        {describeMemory(memory)}
                                      </span>
                                    ) : null}
                                    {ca.suspected ? (
                                      <span className="text-[10px] text-[var(--admin-warning,#b45309)]">
                                        This name looks like a suppository — please confirm.
                                      </span>
                                    ) : null}
                                  </div>
                                ) : null}
                                {/* SLICE 18-0: the low-THC beverage question is
                                    PROMPTED, never required. The asymmetry is
                                    deliberate: an unanswered beverage stays in
                                    the TIGHTER 2016 g liquid bucket, so silence
                                    can only ever under-sell — a lawful sale we
                                    declined, not an unlawful one we made. That
                                    does not justify blocking a delivery. */}
                                {view === "draft" && ca?.promptsLowThcLiquid ? (
                                  <div className={`flex ${box} flex-col gap-1 rounded border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-2`}>
                                    <label
                                      className="text-[10px] text-[var(--admin-text-faint)]"
                                      htmlFor={`low-thc-${d.id}`}
                                    >
                                      Low-THC beverage? (≤ 4 mg per sealed container)
                                    </label>
                                    <Select
                                      id={`low-thc-${d.id}`}
                                      name="low_thc_liquid"
                                      defaultValue=""
                                      className="text-xs"
                                      aria-label="Low-THC beverage"
                                    >
                                      <option value="">{lowThcPickerPlaceholder()}</option>
                                      <option value="no">No</option>
                                      <option value="yes">Yes — 200 mg THC allowance</option>
                                    </Select>
                                    <Input
                                      name="unit_thc_mg"
                                      inputMode="decimal"
                                      placeholder="mg THC in ONE sealed container"
                                      className="text-xs"
                                      aria-label="THC milligrams per container"
                                    />
                                  </div>
                                ) : null}
                                {/* SLICE L5: the VOLUME gate. Unlike the
                                    low-THC prompt above this one BLOCKS, and
                                    for the same reason otherwise_taken does:
                                    an unmeasured liquid has no volume for the
                                    limit engine to measure, falls back to a
                                    28 g default, and 72 packages of ANY size
                                    fit the 72 fl oz cap. Silence here does not
                                    fail closed — it disables a statutory
                                    limit. Shown only when the name gave us
                                    nothing, so nobody is asked to re-measure a
                                    bottle whose size we already read. */}
                                {view === "draft" && va?.needsVolumePick ? (
                                  <div className={`flex ${box} flex-col gap-1 rounded border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-2`}>
                                    <label
                                      className="text-[10px] text-[var(--admin-text-faint)]"
                                      htmlFor={`net-volume-${d.id}`}
                                    >
                                      Package volume — required (the name states no size)
                                    </label>
                                    <Input
                                      id={`net-volume-${d.id}`}
                                      name="net_volume_quantity"
                                      inputMode="decimal"
                                      required
                                      placeholder={volumePickerPlaceholder({ needsVolumePick: true })}
                                      className="text-xs"
                                      aria-label="Package volume"
                                    />
                                    <Select
                                      name="net_volume_unit"
                                      required
                                      defaultValue=""
                                      className="text-xs"
                                      aria-label="Package volume unit"
                                    >
                                      <option value="" disabled>
                                        Pick a unit…
                                      </option>
                                      <option value="ml">ml</option>
                                      <option value="l">L</option>
                                      <option value="floz">fl oz</option>
                                    </Select>
                                    {/* Said plainly, because guessing wrong here
                                        is a ~4% error on a legal limit. */}
                                    <span className="text-[10px] text-[var(--admin-text-faint)]">
                                      A bare &quot;oz&quot; is not accepted — fl oz and weight oz
                                      are different amounts.
                                    </span>
                                  </div>
                                ) : null}
                                </ApproveGroup>
                                {/* T-314 lookup: inside the form only on the previous row
                                    (ONBOARDING_V2_ROW=off); S11 mounts it above the form. */}
                                {!v2Row && lookupPanel}
                                <FieldLabel on={v2Row} htmlFor={`price-${d.id}`}>Menu price</FieldLabel>
                                <div className={v2Row ? "flex flex-wrap items-center gap-2" : "flex items-center gap-2"}>
                                  <div className="flex items-center gap-1">
                                    <span className="text-[var(--admin-text-faint)]">$</span>
                                    <Input
                                      id={v2Row ? `price-${d.id}` : undefined}
                                      name="price"
                                      type="number"
                                      step="0.01"
                                      min={floorDollars}
                                      defaultValue={defaultPrice ? defaultPrice.toFixed(2) : ""}
                                      className="w-24"
                                    />
                                  </div>
                                  <Button type="submit" variant="save" size="sm">✓ Approve</Button>
                                </div>
                                {v2Row && (
                                  <p className="text-xs text-[var(--admin-text-muted)]" data-testid="draft-approve-price-hint">
                                    Floor {fmtMoney(d.price_floor_minor_units)} {"\u00b7"} AI suggests {fmtMoney(d.suggested_price_minor_units)}
                                  </p>
                                )}
                              </form>
                  );
                  return (
                    <Fragment key={d.id}>
                    <tr
                      id={draftRowAnchorId(d.id)}
                      aria-current={pinned?.id === d.id ? "true" : undefined}
                      className={`scroll-mt-24 align-top ${
                        pinned?.id === d.id
                          ? "bg-[var(--admin-gold-soft)] outline outline-2 -outline-offset-2 outline-[var(--admin-gold)]"
                          : "bg-[var(--admin-surface)]"
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-[var(--admin-text)]">{builtName ?? (d.name || "(unnamed)")}</div>
                        <div className="text-xs text-[var(--admin-text-faint)]">
                          {[d.brand_name, d.vendor_name, d.strain_name].filter(Boolean).join(" · ") || "—"}
                        </div>
                        {builtName && builtName !== d.name ? (
                          <div className="text-[10px] text-[var(--admin-text-faint)]">Manifest: {d.name}</div>
                        ) : null}
                        {previewVerdicts?.get(d.id) ? (
                          <RestockPreviewChip verdict={previewVerdicts.get(d.id)!} />
                        ) : null}
                        {productMemories?.get(d.id) ? (
                          <KnownProductChip memory={productMemories.get(d.id)!} now={now} />
                        ) : null}
                      </td>
                      {v2Row && (
                        <td className="px-4 py-3 text-xs text-[var(--admin-text-muted)]" data-testid="draft-row-manifest">
                          {manifest ? (
                            <>
                              <div className="font-medium text-[var(--admin-text)]">{manifest.number}</div>
                              {manifest.date ? <div className="text-[10px] text-[var(--admin-text-faint)]">{manifest.date}</div> : null}
                            </>
                          ) : (
                            <span className="text-[var(--admin-text-faint)]">{"\u2014"}</span>
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3 text-[var(--admin-text-muted)]">
                        {/* OUR labels on screen — never the raw CCRS blob. */}
                        <div>
                          {displayCategory ? (
                            websiteCategoryLabel(displayCategory)
                          ) : (
                            <span className="font-semibold text-[var(--admin-gold)]">Needs category</span>
                          )}
                        </div>
                        <div className="text-xs">
                          {displayType ? (
                            <span>
                              {displayType}
                              {d.chosen_house_type ? (
                                <span className="text-[var(--admin-text-faint)]"> · your pick</span>
                              ) : effType.source === "remembered" || effType.source === "category" ? (
                                <span className="text-[var(--admin-text-faint)]" data-testid="draft-type-basis"> · {effType.basis}</span>
                              ) : a ? (
                                <span className="text-[var(--admin-text-faint)]"> · {a.house.confidence}% confident</span>
                              ) : null}
                            </span>
                          ) : view === "draft" ? (
                            <span className="font-semibold text-[var(--admin-gold)]">Needs type</span>
                          ) : (
                            <span className="text-[var(--admin-text-faint)]">—</span>
                          )}
                        </div>
                        {/* R32: strain type with its basis (your pick / remembered / source). */}
                        <div className="text-xs" data-testid="draft-strain-basis">
                          {d.chosen_strain_type && d.chosen_strain_type !== "unknown" ? (
                            <span>
                              {strainTypeDefinitions.find((t) => t.value === d.chosen_strain_type)?.label ?? d.chosen_strain_type}
                              <span className="text-[var(--admin-text-faint)]"> · your pick</span>
                            </span>
                          ) : effStrain.value ? (
                            <span>
                              {strainTypeDefinitions.find((t) => t.value === effStrain.value)?.label ?? effStrain.value}
                              <span className="text-[var(--admin-text-faint)]">
                                {" · "}
                                {effStrain.source === "remembered"
                                  ? recall?.strainType?.sourceText ?? "remembered"
                                  : `${effStrain.source}, ${effStrain.confidence}%`}
                              </span>
                            </span>
                          ) : (
                            <span className="text-[var(--admin-text-faint)]">Strain type not set</span>
                          )}
                          {effStrain.conflict && (
                            <div className="text-[10px] text-[var(--admin-gold)]">{effStrain.conflict}</div>
                          )}
                        </div>
                        {/* CCRS under the hood — fine print so the approver can decide. */}
                        <div className="mt-0.5 text-[10px] text-[var(--admin-text-faint)]">
                          LCB: {[d.inventory_type, d.category].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </td>
                      {v2Row && facts && (
                        <td className="px-4 py-3 text-xs" data-testid="draft-row-facts">
                          <div className="font-semibold text-[var(--admin-text)]">{facts.countLabel}</div>
                          <div className="text-[10px] text-[var(--admin-text-faint)]">
                            {facts.missing.length === 0 ? "all attached" : `${facts.missing.length} to fill`}
                          </div>
                        </td>
                      )}
                      <td className="px-4 py-3 text-right text-[var(--admin-text-muted)]">
                        {fmtPct(d.total_thc_pct ?? d.thc_pct)}
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--admin-text-muted)]">
                        {fmtMoney(d.unit_cost_minor_units)}
                      </td>
                      <td className="px-4 py-3 text-right text-xs">
                        <div className="text-[var(--admin-text-muted)]">
                          Floor <span className="font-semibold text-[var(--admin-text)]">{fmtMoney(d.price_floor_minor_units)}</span>
                        </div>
                        <div className="text-[var(--admin-accent)]">
                          AI suggests {fmtMoney(d.suggested_price_minor_units)}
                        </div>
                        {/* R32 (T-328): accurate, explainable fine print + waterfall. */}
                        <PriceExplainNote
                          storedRationale={d.price_rationale}
                          costMinor={d.unit_cost_minor_units}
                          category={d.category}
                          multiple={pricingSettings.min_markup_multiple}
                          storedFloorMinor={d.price_floor_minor_units}
                          storedSuggestedMinor={d.suggested_price_minor_units}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-end gap-2">
                          {rowError && (
                            <p role="alert" className="max-w-[20rem] text-right text-xs font-semibold text-[var(--admin-danger)]" data-testid="draft-row-error">
                              {rowError}
                            </p>
                          )}
                          {view === "draft" && (
                            <>
                              {/* S14 (F-006): condensed by default. The summary says what
                                  this product still needs; opening it shows the full form.
                                  Approve lives INSIDE, so a closed row can never submit
                                  past a hidden required pick. */}
                              <details
                                open={rowStartsOpen({ rows: list.rows, pinned: pinned?.id === d.id })}
                                className="group flex flex-col items-end"
                                data-testid="draft-row-details"
                              >
                                <summary
                                  className="flex cursor-pointer list-none flex-wrap items-center justify-end gap-1 text-xs"
                                  aria-controls={v2Row ? detailRowId(draftRowAnchorId(d.id)) : undefined}
                                >
                                  {rowChips.length === 0 ? (
                                    <span className="rounded-full bg-[var(--admin-accent-soft)] px-2 py-0.5 font-semibold text-[var(--admin-accent)]">
                                      Ready to approve
                                    </span>
                                  ) : (
                                    rowChips.map((chip) => (
                                      <span
                                        key={chip.key}
                                        className={`rounded-full px-2 py-0.5 font-semibold ${
                                          chip.blocking
                                            ? "bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]"
                                            : "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)]"
                                        }`}
                                      >
                                        {chip.label}
                                      </span>
                                    ))
                                  )}
                                  <span className="font-semibold text-[var(--admin-accent)] underline group-open:hidden">Review & approve{" \u25be"}</span>
                                  <span className="hidden font-semibold text-[var(--admin-text-muted)] underline group-open:inline">Collapse{" \u25b4"}</span>
                                </summary>
                              {!v2Row && approveForm}
                              </details>
                              <form action={dismiss}>
                                {focus.manifestId && <input type="hidden" name="return_manifest" value={focus.manifestId} />}
                                <Button type="submit" variant="neutral" size="sm">Dismiss</Button>
                              </form>
                            </>
                          )}
                          {view !== "draft" && (
                            <>
                              {/* R23 (item 5): the Approved tab opens the same
                                  full-width detail row (CSS keys on this testid). */}
                              {v2Row && view === "approved" && (
                                <details
                                  open={rowStartsOpen({ rows: list.rows, pinned: pinned?.id === d.id })}
                                  className="group flex flex-col items-end"
                                  data-testid="draft-row-details"
                                >
                                  <summary
                                    className="flex cursor-pointer list-none items-center justify-end gap-1 text-xs"
                                    aria-controls={detailRowId(draftRowAnchorId(d.id))}
                                    data-testid="approved-row-toggle"
                                  >
                                    <span className="font-semibold text-[var(--admin-accent)] underline group-open:hidden">{APPROVED_TOGGLE_OPEN}{" \u25be"}</span>
                                    <span className="hidden font-semibold text-[var(--admin-text-muted)] underline group-open:inline">{APPROVED_TOGGLE_CLOSE}{" \u25b4"}</span>
                                  </summary>
                                </details>
                              )}
                              {d.price_minor_units != null && (
                                <span className="text-sm font-semibold text-[var(--admin-text)]">
                                  {fmtMoney(d.price_minor_units)}
                                </span>
                              )}
                              {view === "approved" && (
                                <Button
                                  href={enrichHrefForDraft({
                                    posProductKey: d.pos_product_key,
                                    isOnLiveMenu: Boolean(d.pos_product_key && liveKeys.has(d.pos_product_key)),
                                    name: d.name,
                                  })}
                                  variant="save"
                                  size="sm"
                                >
                                  ✨ Enrich now →
                                </Button>
                              )}
                              <form action={restore}>
                                {focus.manifestId && <input type="hidden" name="return_manifest" value={focus.manifestId} />}
                                <Button type="submit" variant="neutral" size="sm">↩ Restore</Button>
                              </form>
                              {view === "approved" && factFlags?.flags.get(d.id) && (
                                <IntakeFactReviewPanel
                                  flag={factFlags.flags.get(d.id)!}
                                  draftId={d.id}
                                  returnManifest={focus.manifestId}
                                />
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* S41 (bible S41.2): the opened row's full-width detail -
                        a second row spanning every column, shown by CSS while
                        the summary row's <details> is open. */}
                    {v2Row && rowsOpen && (
                      <OnboardingDetailRow
                        id={detailRowId(draftRowAnchorId(d.id))}
                        colSpan={columns.length}
                        highlighted={pinned?.id === d.id}
                        facts={
                          (facts && identity) || (savedFacts && d.manifest_id && d.pos_product_key) ? (
                            <div className="flex flex-col gap-2" data-testid="draft-row-detail">
                              {facts && identity && <FactsPanel view={facts} identity={identity} wide />}
                              {/* R27: the facts a person set - visible and editable, review + approved. */}
                              {savedFacts && d.manifest_id && d.pos_product_key && (view === "draft" || view === "approved") && (
                                <ProductFactsPanel
                                  draftId={d.id}
                                  manifestId={d.manifest_id}
                                  productKey={d.pos_product_key}
                                  saved={savedFacts.saved.get(savedFactsMapKey(d.manifest_id, d.pos_product_key)) ?? null}
                                  readOk={savedFacts.ok && savedFacts.migrated}
                                  lab={labPanelView(
                                    labViews?.byDraft.get(d.id)?.plan ?? null,
                                    (savedFacts.saved.get(savedFactsMapKey(d.manifest_id, d.pos_product_key))?.facts as Record<string, unknown> | undefined) ?? null,
                                  )}
                                  returnManifest={focus.manifestId}
                                  returnView={view}
                                />
                              )}
                            </div>
                          ) : null
                        }
                        lookup={lookupPanel}
                        approve={view === "approved" ? approvedZone : approveForm}
                      />
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* S14: one page at a time, with the true total from the same read. */}
        {paged && (pager.hasPrev || pager.hasNext || pager.label) && !pager.pastEnd && (
          <nav className="flex items-center justify-between gap-3 text-xs text-[var(--admin-text-muted)]" aria-label="Pages" data-testid="onboarding-pager">
            <span>{pager.label}</span>
            <span className="flex gap-3">
              {pager.hasPrev && (
                <Link href={onboardingListHref({ ...listFilters, page: list.page - 1 })} className="font-semibold underline">
                  {"\u2190 Previous"}
                </Link>
              )}
              {pager.hasNext && (
                <Link href={onboardingListHref({ ...listFilters, page: list.page + 1 })} className="font-semibold underline">
                  {"Next \u2192"}
                </Link>
              )}
            </span>
          </nav>
        )}
        {pager.pastEnd && (
          <Link href={onboardingListHref({ ...listFilters, page: 1 })} className="text-xs font-semibold underline">
            Back to the first page
          </Link>
        )}

        {/* S10 SHADOW RING: what the 90% rule WOULD have attached, from the
            lookups already run. Visible before any write is switched on. */}
        {shadowFooter && (
          <p
            className="border-t border-[var(--admin-border)] pt-3 text-xs text-[var(--admin-text-faint)]"
            data-testid="attach-policy-shadow-footer"
          >
            {shadowFooter}
          </p>
        )}
      </div>
    </div>
  );
}
