"use server";

import { safeFactReturnPath, PRODUCT_FACTS_ANCHOR } from "@/lib/inventory/coa-panel-core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import {
  setCatalogDraftStatus,
  approveDraftWithPrice,
  approveAllPricedForManifest,
} from "@/lib/inventory/catalog-drafts";
// S17: the batch result travels back in the redirect (pure encode/decode).
import { batchResultParams } from "@/lib/inventory/batch-staging-core";
// SLICE 78: create a website category during onboarding ("__new__" pick).
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { listWebsiteCategoryTypes, listInventoryTypes } from "@/lib/pos/types-store";
import { validateCategoryDraft } from "@/lib/pos/category-registry-core";
// SLICE 92: create a product TYPE during onboarding ("__new_type__" pick) -
// same registry (inventory_types) the Types & Categories settings page manages.
import { validateInventoryTypeDraft } from "@/lib/pos/type-registry-core";
// S02: after an action, return to the SAME delivery filter the approver was
// working in (hidden `return_manifest` field, re-validated as a UUID by
// draftsHref — the form is never trusted).
import { draftsHref, isUuid } from "@/lib/catalog/draft-deep-link-core";
// S11: row-level error anchoring rides the redesigned-row flag.
import { onboardingV2RowOn } from "@/lib/catalog/onboarding-row-flag";
// S30: inline fact review for receiving-origin products (bible S30.2).
import {
  factResultCode,
  parseIntakeFactForm,
  type FactResultCode,
} from "@/lib/pos/intake-fact-review-core";
import { mirrorIntakeFixToLive, recordIntakeFactReview } from "@/lib/pos/fact-review-store";
import { revalidatePublicMenuSurfaces } from "@/lib/site/public-surfaces";
import {
  SERVING_LIMIT_PARAM,
  limitCategoryFromForm,
  servingLimitAudit,
  servingLimitParam,
  servingLimitWarnings,
} from "@/lib/compliance/serving-limit-warning-core";
// R19 S13: batch manifest lookup (enqueue / stop; the cron does the work).
import { enqueueManifestLookup, cancelManifestLookup } from "@/lib/catalog/lookup-job-server";

/**
 * Where an action returns. S11 (F-033): a FAILED row action also passes its
 * draft id, so the page comes back pinned to that row (?draft=<id>&error=...
 * #draft-<id>): highlighted, scrolled to, and the error repeated inside the
 * row. Success redirects pass no id (an approved row has left this tab).
 * ONBOARDING_V2_ROW=off keeps the previous redirect (no draft pin).
 */
function backTo(formData: FormData | undefined, extra: Record<string, string>, failedDraftId?: string): string {
  const raw = formData?.get("return_manifest");
  const anchor = failedDraftId && onboardingV2RowOn() ? failedDraftId : null;
  return draftsHref({ manifestId: typeof raw === "string" ? raw : null, draftId: anchor, extra });
}

export async function approveDraftAction(draftId: string, formData: FormData) {
  const session = await requirePermission("inventory.manage");
  // Price arrives in DOLLARS from the form; convert to minor units (cents).
  const raw = (formData.get("price") as string | null)?.trim() ?? "";
  const dollars = Number(raw);
  if (!raw || Number.isNaN(dollars) || dollars <= 0) {
    redirect(backTo(formData, { error: "price" }, draftId));
  }
  const priceMinor = Math.round(dollars * 100);
  // SLICE 64: the approver's classification picks. The server re-derives what
  // was actually REQUIRED (resolver + labeler) and validates every pick
  // against the closed vocabularies inside approveDraftWithPrice - the form
  // is never trusted.
  let chosenWebsiteCategory = (formData.get("website_category") as string | null)?.trim() || null;
  let chosenHouseType = (formData.get("house_type") as string | null)?.trim() || null;
  // SLICE 93: the approver's strain-type pick (empty = keep auto / none).
  // Validated server-side against the canonical taxonomy in
  // approveDraftWithPrice - the form is never trusted.
  const chosenStrainType = (formData.get("strain_type") as string | null)?.trim() || null;
  // SLICE 18-0: the approver's COMPLIANCE picks. Passed through as RAW form
  // strings on purpose - approveDraftWithPrice re-derives what was actually
  // required and validates/refuses every value there. Parsing them here would
  // duplicate the rules, and duplicated compliance rules drift.
  const otherwiseTaken = (formData.get("otherwise_taken") as string | null) ?? null;
  const unitsPerPackage = (formData.get("units_per_package") as string | null) ?? null;
  const lowThcLiquid = (formData.get("low_thc_liquid") as string | null) ?? null;
  const unitThcMg = (formData.get("unit_thc_mg") as string | null) ?? null;
  // SLICE L5: the approver's MEASURED package volume. Raw strings for the same
  // reason as above — approveDraftWithPrice re-derives whether a measurement
  // was required and refuses anything it cannot trust, including a bare "oz".
  const volumeQuantity = (formData.get("net_volume_quantity") as string | null) ?? null;
  const volumeUnit = (formData.get("net_volume_unit") as string | null) ?? null;

  // SLICE 78: "__new__" = create the category right here, mid-onboarding.
  // Same pure gatekeeper as Settings → Types (label required, slug derivation,
  // duplicate refusal), same audit trail, then the new value becomes the pick.
  if (chosenWebsiteCategory === "__new__") {
    const newLabel = (formData.get("new_category_label") as string | null)?.trim() || "";
    const registry = await listWebsiteCategoryTypes({ includeInactive: true });
    const parsed = validateCategoryDraft({
      label: newLabel,
      existingValues: registry.map((r) => r.value),
    });
    if (!parsed.ok) {
      redirect(backTo(formData, { error: "floor", msg: parsed.error }, draftId));
    }
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("website_category_types").insert({
      value: parsed.value,
      label: parsed.label,
      helper: "",
      sort_order: parsed.sort_order,
      is_active: true,
      is_system: false,
    });
    if (error) {
      redirect(backTo(formData, { error: "floor", msg: error.message }, draftId));
    }
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "website_category.created",
      entityType: "website_category_type",
      entityId: parsed.value,
      after: { value: parsed.value, label: parsed.label, created_during: "draft_onboarding" },
    });
    chosenWebsiteCategory = parsed.value;
  }

  // SLICE 92: "__new_type__" = create the product type right here, mid-
  // onboarding. Same pure gatekeeper the registry demands (name required,
  // canonical-key derivation, duplicate refusal against catalog + DB), the
  // same inventory_types table the Types & Categories page manages, the same
  // audit trail as the settings page's create - then the new label becomes
  // the pick. It is mapped to the website category this approval resolves to,
  // so the new type is grouped correctly everywhere from day one.
  if (chosenHouseType === "__new_type__") {
    const newLabel = (formData.get("new_type_label") as string | null)?.trim() || "";
    const existing = await listInventoryTypes({ includeInactive: true });
    const parsed = validateInventoryTypeDraft({
      label: newLabel,
      existingKeys: existing.map((t) => t.key),
    });
    if (!parsed.ok) {
      redirect(backTo(formData, { error: "floor", msg: parsed.error }, draftId));
    }
    const admin = createSupabaseAdminClient();
    // Map the new type to the category this approval files under: the human's
    // pick when made, otherwise the resolver's verdict for THIS draft (a
    // "Keep auto" approval submits no category override). Verified, never
    // guessed - when neither exists the type is created unmapped and can be
    // mapped later at Settings -> Types & Categories.
    let mappedCategory = chosenWebsiteCategory;
    if (!mappedCategory) {
      const { data: draftRow } = await admin
        .from("catalog_product_drafts")
        .select("pos_product_key, name, inventory_type, category")
        .eq("id", draftId)
        .maybeSingle();
      if (draftRow) {
        const d = draftRow as {
          pos_product_key: string | null;
          name: string;
          inventory_type: string | null;
          category: string | null;
        };
        const { resolveWebsiteCategoryForLot } = await import(
          "@/lib/inventory/website-category-resolver-server"
        );
        const resolution = await resolveWebsiteCategoryForLot({
          posProductKey: d.pos_product_key,
          productName: d.name,
          inventoryType: d.inventory_type,
          category: d.category,
        });
        mappedCategory = resolution.websiteCategory;
      }
    }
    const { error } = await admin.from("inventory_types").insert({
      key: parsed.key,
      label: parsed.label,
      notes: "Created during product onboarding.",
      website_category: mappedCategory,
      is_active: true,
      is_system: false,
    });
    if (error) {
      redirect(backTo(formData, { error: "floor", msg: error.message }, draftId));
    }
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "inventory_type.created",
      entityType: "inventory_type",
      entityId: parsed.key,
      after: {
        key: parsed.key,
        label: parsed.label,
        website_category: mappedCategory,
        created_during: "draft_onboarding",
      },
    });
    chosenHouseType = parsed.label;
  }
  const result = await approveDraftWithPrice(draftId, priceMinor, session.userId, {
    chosenWebsiteCategory,
    chosenHouseType,
    chosenStrainType,
    otherwiseTaken,
    unitsPerPackage,
    lowThcLiquid,
    unitThcMg,
    volumeQuantity,
    volumeUnit,
  });
  revalidatePath("/admin/inventory/drafts");
  if (!result.ok) {
    // Surface the floor-violation / classification-gate message.
    redirect(backTo(formData, { error: "floor", msg: result.error ?? "" }, draftId));
  }
  // R23 (item 5): the review queue stays put (no pin), and the banner gets
  // a link to the product on the Approved tab (validated as a UUID there).
  redirect(backTo(formData, { approved: "1", approved_draft: draftId }));
}

/**
 * S17 (bible S17.2): "Approve all N priced" for the focused delivery. The
 * manifest id is bound server-side from the validated page focus; every draft
 * still passes every approval gate inside approveDraftWithPrice, and the menu
 * is staged ONCE for the batch. Refused rows stay in the list and are counted.
 */
export async function approveAllPricedAction(manifestId: string, formData?: FormData) {
  const session = await requirePermission("inventory.manage");
  const result = await approveAllPricedForManifest(manifestId, session.userId);
  revalidatePath("/admin/inventory/drafts");
  if (!result.ok || !result.result) {
    redirect(backTo(formData, { error: "floor", msg: result.error ?? "" }));
  }
  redirect(backTo(formData, batchResultParams(result.result)));
}

export async function dismissDraftAction(draftId: string, formData?: FormData) {
  const session = await requirePermission("inventory.manage");
  const result = await setCatalogDraftStatus(draftId, "dismissed", session.userId);
  revalidatePath("/admin/inventory/drafts");
  if (!result.ok) {
    redirect(backTo(formData, { error: "update" }, draftId));
  }
  redirect(backTo(formData, { dismissed: "1" }));
}

export async function restoreDraftAction(draftId: string, formData?: FormData) {
  const session = await requirePermission("inventory.manage");
  const result = await setCatalogDraftStatus(draftId, "draft", session.userId);
  revalidatePath("/admin/inventory/drafts");
  if (!result.ok) {
    redirect(backTo(formData, { error: "update" }, draftId));
  }
  redirect(backTo(formData, { restored: "1" }));
}

/**
 * S30 (bible S30.2): the receiving-origin exit for a `fact_extraction_review`
 * hold. The owner approves, fixes or rejects the flagged fact INLINE on the
 * approved product (the drafts page, same `inventory.manage` gate as that
 * page - page.tsx requirePermission), no pos_imports row involved. The
 * decision is a recorded human act (pos_fact_reviews row with reviewed_by +
 * an audit row, bible S30.8), then the delivery's menu update is re-staged:
 * staging applies the decision and auto-publishes when nothing else is
 * flagged. Before migration 0237 the decision cannot be saved: say so, and
 * nothing else changes (the held update stays publishable by hand).
 */
export async function resolveIntakeFactReview(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const get = (name: string): string => {
    const v = formData.get(name);
    return typeof v === "string" ? v : "";
  };
  // R27: the Product facts panel also lives on the review tab - return there.
  const returnView = get("return_view") === "draft" ? ("draft" as const) : ("approved" as const);
  // R28: the same panel lives on the lot page and the KB product page. They
  // send return_to; only a lot / KB product page by id is accepted
  // (safeFactReturnPath) - anything else falls back to Product Onboarding.
  const returnTo = safeFactReturnPath(get("return_to"));
  const back = (manifestId: string | null, draftId: string | null, extra: Record<string, string>) =>
    returnTo
      ? `${returnTo}?${new URLSearchParams(extra).toString()}#${PRODUCT_FACTS_ANCHOR}`
      : draftsHref({ status: returnView, manifestId, draftId, extra });

  const parsed = parseIntakeFactForm(get);
  if (!parsed.ok) {
    const m = get("manifestId").trim();
    const d = get("draftId").trim();
    redirect(back(m || null, d || null, { fact: "error", fact_msg: parsed.error }));
  }
  const form = parsed.form;
  // R35 (#4): WAC 314-55-095 - a fix over the serving / package limit is
  // SAVED with a warning (never refused: the person reads the package), and
  // the warning goes on the audit row and the result banner.
  const limitWarnings =
    form.action === "fix" && form.correctedFacts
      ? servingLimitWarnings({
          mgPerServing: form.correctedFacts.mgPerServing ?? null,
          servingsPerPack: form.correctedFacts.servingsPerPack ?? null,
          packageThcMg: form.correctedFacts.packageThcMg ?? null,
          category: limitCategoryFromForm(get("limit_category")),
        })
      : [];

  let code: FactResultCode;
  let message = "";
  try {
    const saved = await recordIntakeFactReview({
      manifestId: form.manifestId,
      draftId: form.draftId,
      sourceItemId: form.sourceItemId,
      flagSignature: form.flagSignature,
      action: form.action,
      note: form.note,
      correctedFacts: form.correctedFacts,
      reviewedBy: session.userId,
    });
    if (!saved.applied) {
      code = "migration";
    } else {
      await recordAudit({
        actorId: session.userId,
        actorEmail: session.email,
        action: `fact_review.${form.action}`,
        entityType: "pos_fact_review",
        entityId: `${form.manifestId}:${form.sourceItemId}`,
        after: {
          note: form.note,
          correctedFacts: form.correctedFacts,
          flagSignature: form.flagSignature,
          draftId: form.draftId,
          servingLimitWarnings: servingLimitAudit(limitWarnings),
        },
      });
      const { stageIntakeMenuVersionForManifest } = await import("@/lib/pos/intake-menu-staging");
      const outcome = await stageIntakeMenuVersionForManifest(form.manifestId, session.userId);
      code = factResultCode(outcome);
      // R27: a product ALREADY on the menu is carried, never re-planned, so
      // the re-stage alone cannot change it. Write the typed facts onto its
      // live/staged cards and its lot (golden record) too - after the
      // re-stage, so the version that just went live carries them as well.
      if (form.action === "fix") {
        const { data: draftRow } = await createSupabaseAdminClient()
          .from("catalog_product_drafts")
          .select("lot_id")
          .eq("id", form.draftId)
          .maybeSingle();
        const mirror = await mirrorIntakeFixToLive({
          sourceItemId: form.sourceItemId,
          lotId: (draftRow as { lot_id: string | null } | null)?.lot_id ?? null,
          correctedFacts: form.correctedFacts,
        });
        // R33: the mirror writes the LIVE card directly — refresh the public
        // site (data tag + every page) or the fix sits behind the 60 s menu
        // cache and the prerendered product page. Staging refreshes on its
        // own when it publishes; this covers the carried (already-live) card.
        if (mirror.items > 0) revalidatePublicMenuSurfaces();
        if (mirror.errors.length > 0) {
          code = "error";
          message = `Saved, but ${mirror.errors.join("; ")}. Save the facts again to retry.`;
        }
      }
    }
  } catch (err) {
    console.error("[drafts] resolveIntakeFactReview failed:", err);
    code = "error";
    message = err instanceof Error ? err.message : "Saving the fact decision failed.";
  }
  revalidatePath("/admin/inventory/drafts");
  revalidatePath("/admin/publish");
  if (returnTo) revalidatePath(returnTo);
  const extra: Record<string, string> = { fact: code };
  if (code === "error" && message) extra.fact_msg = message.slice(0, 300);
  const warnParam = code !== "error" && code !== "migration" ? servingLimitParam(limitWarnings) : null;
  if (warnParam) extra[SERVING_LIMIT_PARAM] = warnParam;
  redirect(back(form.manifestId, form.draftId, extra));
}

/**
 * R19 S13 (bible S13.4): "Look up all N products on this manifest". The
 * manifest id is bound server-side from the validated page focus (same as
 * S17's Approve all). This only WRITES the job; the every-minute worker
 * (/api/cron/lookup-jobs) does the lookups, so closing the tab loses
 * nothing. Idempotent: a running job is returned, never doubled.
 */
export async function lookupAllAction(manifestId: string, formData?: FormData) {
  const session = await requirePermission("inventory.manage");
  const res = await enqueueManifestLookup(manifestId, { userId: session.userId, email: session.email });
  revalidatePath("/admin/inventory/drafts");
  if (res.ok) redirect(backTo(formData, { lookup: res.kind === "created" ? "started" : "exists" }));
  if (res.code === "migration") redirect(backTo(formData, { lookup: "migration" }));
  if (res.code === "nothing") redirect(backTo(formData, { lookup: "nothing", lookup_msg: res.message }));
  redirect(backTo(formData, { lookup: "error", lookup_msg: res.message }));
}

/**
 * R37 S6 - "Search again" (owner: "maybe the vendor added new info online
 * about these products and it may be worth rerunning the search to find new
 * facts"). Queues a fresh web search for ONLY the products the history panel
 * recommends that an earlier batch of this delivery already did (the plain
 * press skips those). The ids come back from the form as hidden fields and
 * are re-validated by the server (uuid-shaped, still in Needs review on THIS
 * delivery, capped); nothing else on the page can be queued this way.
 */
export async function lookupAgainAction(manifestId: string, formData?: FormData) {
  const session = await requirePermission("inventory.manage");
  const ids = formData ? formData.getAll("again_id") : [];
  const res = await enqueueManifestLookup(manifestId, { userId: session.userId, email: session.email }, { againDraftIds: ids });
  revalidatePath("/admin/inventory/drafts");
  if (res.ok) redirect(backTo(formData, { lookup: res.kind === "created" ? "started" : "exists" }));
  if (res.code === "migration") redirect(backTo(formData, { lookup: "migration" }));
  if (res.code === "nothing") redirect(backTo(formData, { lookup: "nothing", lookup_msg: res.message }));
  redirect(backTo(formData, { lookup: "error", lookup_msg: res.message }));
}

/** R19 S13: stop a batch. Products not started yet are canceled; the one in flight finishes. */
export async function cancelLookupAction(jobId: string, formData?: FormData) {
  const session = await requirePermission("inventory.manage");
  const res = await cancelManifestLookup(jobId, { userId: session.userId, email: session.email });
  revalidatePath("/admin/inventory/drafts");
  redirect(backTo(formData, { lookup: res.ok ? "stopped" : "stop_error", lookup_msg: res.message }));
}

/**
 * R37 S4 - "Re-read lab certificates (LlamaParse)" in the AI section at the
 * top of Product Onboarding (owner: "add a button that allows me to rerun
 * llama parse on the onboarding page to re read the COA's"). Reads every
 * certificate of the delivery again (forced, LlamaParse + the PDF text, best
 * reading wins), attaches the facts to the onboarding rows (R30; fill-only -
 * a person's figure is never replaced), rebuilds the delivery's menu update,
 * logs a delivery event and an audit row. Never throws to the page: every
 * outcome is a banner (coa-reread-delivery-core deliveryCoaBanner).
 */
export async function rereadDeliveryCoasAction(manifestId: string, formData?: FormData) {
  const session = await requirePermission("inventory.manage");
  if (!isUuid(manifestId)) redirect(backTo(formData, { coa_all: "error" }));
  const { rereadCoasForManifest } = await import("@/lib/inventory/coa-extract");
  const core = await import("@/lib/inventory/coa-reread-delivery-core");
  let params: Record<string, string> = { coa_all: "error" };
  try {
    // Leave room inside the page's 300 s for the attach + restage.
    const { run, labs } = await rereadCoasForManifest(manifestId, session.userId, { budgetMs: 200_000 });
    const code = core.deliveryCoaCode(run, labs);
    let factsAttached = 0;
    let restaged = false;
    const summary: Record<string, unknown> = { labs, read: run.read, ok: run.ok, partial: run.partial, failed: run.failed, deferred: run.deferred, kbFilled: run.kbFilled, errors: run.errors.slice(0, 5) };
    if (run.read > 0) {
      try {
        const { attachLabFactsToManifestDrafts } = await import("@/lib/catalog/lab-facts-attach");
        const { LAB_FACTS_ATTACH_EVENT, labFactsAttachNote } = await import("@/lib/catalog/lab-facts-attach-core");
        const { logManifestEvent } = await import("@/lib/inventory/intake-store");
        const labRun = await attachLabFactsToManifestDrafts(manifestId, session.userId);
        factsAttached = labRun.facts;
        summary.labAttach = { attached: labRun.attached, facts: labRun.facts, kept: labRun.kept, strainsUpdated: labRun.strainsUpdated, unmigrated: labRun.unmigrated, errors: labRun.errors.slice(0, 3) };
        const labNote = labFactsAttachNote(labRun);
        if (labNote) await logManifestEvent(manifestId, LAB_FACTS_ATTACH_EVENT, labNote, session.userId);
      } catch (err) {
        console.error("[drafts] delivery COA re-read lab attach failed:", err);
      }
      try {
        const { stageIntakeMenuVersionForManifest } = await import("@/lib/pos/intake-menu-staging");
        const outcome = await stageIntakeMenuVersionForManifest(manifestId, session.userId);
        restaged = outcome.staged;
        summary.restage = { staged: outcome.staged, published: outcome.published, reason: outcome.reason ?? null, withheld: outcome.withheld ?? 0 };
      } catch (err) {
        console.error("[drafts] delivery COA re-read restage failed:", err);
        summary.restage = { error: err instanceof Error ? err.message : String(err) };
      }
    }
    try {
      const { logManifestEvent } = await import("@/lib/inventory/intake-store");
      await logManifestEvent(manifestId, core.DELIVERY_COA_EVENT, `Lab certificates read again with LlamaParse: ${run.read} of ${labs} (${run.ok} ok, ${run.partial} partial, ${run.failed} failed).`, session.userId);
    } catch (err) {
      console.error("[drafts] delivery COA re-read event failed:", err);
    }
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: core.DELIVERY_COA_AUDIT,
      entityType: "intake_manifest",
      entityId: manifestId,
      after: { code, ...summary },
    });
    params = core.deliveryCoaParams({ code, labs, run, factsAttached, restaged });
  } catch (err) {
    console.error("[drafts] rereadDeliveryCoasAction failed:", err);
    params = { coa_all: "error" };
  }
  revalidatePath("/admin/inventory/drafts");
  revalidatePath("/admin/knowledge-base/products");
  redirect(backTo(formData, params) + "#batch-lookup");
}

/**
 * R37 S5 - "Brand for this delivery": one brand for every product of the
 * delivery (fill rows without one, or replace all), written to the drafts,
 * the inventory lots, the menu cards (website + Leafly read
 * menu_items.brand_name) and remembered on the delivery + the vendor
 * (migration 0257) so the next delivery from that vendor fills itself.
 * Decisions: delivery-brand-core (pure). Writes: delivery-brand-store.
 */
export async function setDeliveryBrandAction(manifestId: string, formData?: FormData) {
  const session = await requirePermission("inventory.manage");
  const core = await import("@/lib/inventory/delivery-brand-core");
  if (!isUuid(manifestId)) redirect(backTo(formData, core.deliveryBrandParams({ code: "refused", reason: "That delivery link is not valid." })) + "#batch-lookup");
  const { setDeliveryBrand } = await import("@/lib/inventory/delivery-brand-store");
  const mode = core.parseBrandMode(formData?.get("brand_mode"));
  const run = await setDeliveryBrand({ manifestId, rawName: formData?.get("brand"), mode, actorId: session.userId });
  if (run.code === "ok") {
    try {
      const { logManifestEvent } = await import("@/lib/inventory/intake-store");
      await logManifestEvent(
        manifestId,
        core.DELIVERY_BRAND_EVENT,
        core.deliveryBrandNote(run.brand ?? "", { changed: run.changed ?? 0, kept: run.kept ?? 0, already: run.already ?? 0 }, mode),
        session.userId,
      );
    } catch (err) {
      console.error("[drafts] delivery brand event failed:", err);
    }
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: core.DELIVERY_BRAND_AUDIT,
      entityType: "intake_manifest",
      entityId: manifestId,
      after: {
        brand: run.brand,
        brandId: run.brandId,
        created: run.created ?? false,
        adoptedByVendor: run.adopted ?? false,
        mode,
        changed: run.changed,
        already: run.already,
        kept: run.kept,
        cards: run.cards,
        remembered: run.remembered,
        note: run.reason ?? null,
      },
    });
    if (run.vendorId && run.remembered === true) {
      await recordAudit({
        actorId: session.userId,
        actorEmail: session.email,
        action: core.VENDOR_DEFAULT_BRAND_AUDIT,
        entityType: "vendor",
        entityId: run.vendorId,
        after: { brand: run.brand, brandId: run.brandId, from: "product_onboarding", manifestId },
      });
      revalidatePath(`/admin/vendors/${run.vendorId}`);
    }
    if ((run.cards ?? 0) > 0) revalidatePublicMenuSurfaces();
  }
  revalidatePath("/admin/inventory/drafts");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/vendors");
  redirect(backTo(formData, core.deliveryBrandParams(run)) + "#batch-lookup");
}

/** R37 S5 - the brand of ONE product row (empty clears it). */
export async function setDraftBrandAction(draftId: string, formData?: FormData) {
  const session = await requirePermission("inventory.manage");
  const core = await import("@/lib/inventory/delivery-brand-core");
  if (!isUuid(draftId)) redirect(backTo(formData, core.deliveryBrandParams({ code: "refused", reason: "That product link is not valid." })));
  const { setDraftBrand } = await import("@/lib/inventory/delivery-brand-store");
  const run = await setDraftBrand({ draftId, rawName: formData?.get("brand"), actorId: session.userId });
  if (run.code === "ok" || (run.code === "cleared" && (run.changed ?? 0) > 0)) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: core.DRAFT_BRAND_AUDIT,
      entityType: "catalog_product_draft",
      entityId: draftId,
      after: { brand: run.brand ?? null, brandId: run.brandId ?? null, created: run.created ?? false, adoptedByVendor: run.adopted ?? false, cards: run.cards, note: run.reason ?? null },
    });
    if ((run.cards ?? 0) > 0) revalidatePublicMenuSurfaces();
  }
  revalidatePath("/admin/inventory/drafts");
  revalidatePath("/admin/inventory");
  const anchor = onboardingV2RowOn() ? draftId : null;
  const raw = formData?.get("return_manifest");
  redirect(draftsHref({ manifestId: typeof raw === "string" && raw ? raw : run.manifestId ?? null, draftId: anchor, extra: core.deliveryBrandParams(run) }));
}
