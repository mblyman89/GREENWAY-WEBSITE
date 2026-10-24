"use server";

import { safeFactReturnPath, PRODUCT_FACTS_ANCHOR } from "@/lib/inventory/coa-panel-core";
import { headers } from "next/headers";
import { listStateFromUrl } from "@/lib/catalog/onboarding-list-core";
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
async function backTo(formData: FormData | undefined, extra: Record<string, string>, failedDraftId?: string): Promise<string> {
  const raw = formData?.get("return_manifest");
  const anchor = failedDraftId && onboardingV2RowOn() ? failedDraftId : null;
  // R74 S33: keep the list where it was (expand-all, search, vendor, page,
  // page size, tab) - read from the page the form was posted from.
  let list: Record<string, string> = {};
  try {
    list = listStateFromUrl((await headers()).get("referer"));
  } catch {
    list = {};
  }
  return draftsHref({ manifestId: typeof raw === "string" ? raw : null, draftId: anchor, extra: { ...list, ...extra } });
}

export async function approveDraftAction(draftId: string, formData: FormData) {
  const session = await requirePermission("inventory.manage");
  // Price arrives in DOLLARS from the form; convert to minor units (cents).
  const raw = (formData.get("price") as string | null)?.trim() ?? "";
  const dollars = Number(raw);
  // R50 S3: a product already selling (Cultivera re-onboarding) has no price
  // field - the server records the LIVE price itself and ignores any typed
  // one. The flag only lets a blank field through; approveDraftWithPrice
  // re-derives the rule from the delivery and refuses a non-positive price
  // on any ordinary draft, so the flag can never approve at $0.
  const reonboardForm = formData.get("reonboard") === "1";
  if (!(reonboardForm && !raw) && (!raw || Number.isNaN(dollars) || dollars <= 0)) {
    redirect(await backTo(formData, { error: "price" }, draftId));
  }
  const priceMinor = reonboardForm && !raw ? 0 : Math.round(dollars * 100);
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
      redirect(await backTo(formData, { error: "floor", msg: parsed.error }, draftId));
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
      redirect(await backTo(formData, { error: "floor", msg: error.message }, draftId));
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
      redirect(await backTo(formData, { error: "floor", msg: parsed.error }, draftId));
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
      redirect(await backTo(formData, { error: "floor", msg: error.message }, draftId));
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
    redirect(await backTo(formData, { error: "floor", msg: result.error ?? "" }, draftId));
  }
  // R23 (item 5): the review queue stays put (no pin), and the banner gets
  // a link to the product on the Approved tab (validated as a UUID there).
  redirect(await backTo(formData, { approved: "1", approved_draft: draftId }));
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
    redirect(await backTo(formData, { error: "floor", msg: result.error ?? "" }));
  }
  redirect(await backTo(formData, batchResultParams(result.result)));
}

export async function dismissDraftAction(draftId: string, formData?: FormData) {
  const session = await requirePermission("inventory.manage");
  const result = await setCatalogDraftStatus(draftId, "dismissed", session.userId);
  revalidatePath("/admin/inventory/drafts");
  if (!result.ok) {
    redirect(await backTo(formData, { error: "update" }, draftId));
  }
  redirect(await backTo(formData, { dismissed: "1" }));
}

export async function restoreDraftAction(draftId: string, formData?: FormData) {
  const session = await requirePermission("inventory.manage");
  const result = await setCatalogDraftStatus(draftId, "draft", session.userId);
  revalidatePath("/admin/inventory/drafts");
  if (!result.ok) {
    redirect(await backTo(formData, { error: "update" }, draftId));
  }
  redirect(await backTo(formData, { restored: "1" }));
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
  if (res.ok) redirect(await backTo(formData, { lookup: res.kind === "created" ? "started" : "exists" }));
  if (res.code === "migration") redirect(await backTo(formData, { lookup: "migration" }));
  if (res.code === "nothing") redirect(await backTo(formData, { lookup: "nothing", lookup_msg: res.message }));
  redirect(await backTo(formData, { lookup: "error", lookup_msg: res.message }));
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
  if (res.ok) redirect(await backTo(formData, { lookup: res.kind === "created" ? "started" : "exists" }));
  if (res.code === "migration") redirect(await backTo(formData, { lookup: "migration" }));
  if (res.code === "nothing") redirect(await backTo(formData, { lookup: "nothing", lookup_msg: res.message }));
  redirect(await backTo(formData, { lookup: "error", lookup_msg: res.message }));
}

/** R19 S13: stop a batch. Products not started yet are canceled; the one in flight finishes. */
export async function cancelLookupAction(jobId: string, formData?: FormData) {
  const session = await requirePermission("inventory.manage");
  const res = await cancelManifestLookup(jobId, { userId: session.userId, email: session.email });
  revalidatePath("/admin/inventory/drafts");
  redirect(await backTo(formData, { lookup: res.ok ? "stopped" : "stop_error", lookup_msg: res.message }));
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
  if (!isUuid(manifestId)) redirect(await backTo(formData, { coa_all: "error" }));
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
  redirect(await backTo(formData, params) + "#batch-lookup");
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
  if (!isUuid(manifestId)) redirect(await backTo(formData, core.deliveryBrandParams({ code: "refused", reason: "That delivery link is not valid." })) + "#batch-lookup");
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
  redirect(await backTo(formData, core.deliveryBrandParams(run)) + "#batch-lookup");
}

/** R37 S5 - the brand of ONE product row (empty clears it). */
export async function setDraftBrandAction(draftId: string, formData?: FormData) {
  const session = await requirePermission("inventory.manage");
  const core = await import("@/lib/inventory/delivery-brand-core");
  if (!isUuid(draftId)) redirect(await backTo(formData, core.deliveryBrandParams({ code: "refused", reason: "That product link is not valid." })));
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

/**
 * R50 S3 - "Start" on a Cultivera manifest (Product Onboarding). Runs the
 * native intake chain for one manifest rebuilt from the Cultivera export:
 * onboarding rows (one per live card, live price), KB write-back + link, lab
 * facts, the Cultivera potency as a shown-not-counted fact. Never changes the
 * live menu or any lot's status, quantity or cost. Lands on that manifest's
 * rows with a banner; the full outcome is on the manifest timeline.
 */
export async function startCultiveraOnboardingAction(manifestId: string) {
  const session = await requirePermission("inventory.manage");
  if (!isUuid(manifestId)) redirect(draftsHref({ extra: { cv: "error", cv_msg: "That manifest link is not valid." } }));
  const { startCultiveraManifestOnboarding } = await import("@/lib/inventory/cultivera-onboarding");
  let extra: Record<string, string>;
  try {
    const res = await startCultiveraManifestOnboarding(manifestId, session.userId);
    extra = res.ok ? { cv: "ok", cv_msg: res.note.slice(0, 600) } : { cv: "error", cv_msg: res.error.slice(0, 300) };
  } catch (err) {
    console.error("[drafts] cultivera onboarding start failed:", err);
    extra = { cv: "error", cv_msg: (err instanceof Error ? err.message : String(err)).slice(0, 300) };
  }
  revalidatePath("/admin/inventory/drafts");
  redirect(draftsHref({ manifestId, extra }));
}

/**
 * R50 S12b - "Attach vendor lab results to every Cultivera manifest".
 * One click walks the rebuilt manifests (id order) through the SAME fill-only
 * attach Start runs, stops before the page's time limit and hands back a
 * checkpoint; "Continue" resumes from it. Never changes stock, status, cost,
 * CCRS fields, prices or live cards.
 */
export async function runWciaBackfillAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const { runWciaBackfill } = await import("@/lib/inventory/cultivera-wcia-backfill");
  const { backfillNote, backfillTone } = await import("@/lib/inventory/cultivera-wcia-backfill-core");
  const raw = formData.get("cursor");
  let extra: Record<string, string>;
  try {
    const run = await runWciaBackfill(typeof raw === "string" ? raw : null, session.userId);
    extra = { lab_bf: backfillTone(run), lab_bf_msg: backfillNote(run).slice(0, 700), cv_page: "1" };
    if (run.next && !(run.ok && run.done)) extra.lab_bf_next = run.next;
  } catch (err) {
    console.error("[drafts] wcia backfill failed:", err);
    extra = { lab_bf: "warn", lab_bf_msg: `Stopped: ${(err instanceof Error ? err.message : String(err)).slice(0, 300)}`, cv_page: "1" };
  }
  revalidatePath("/admin/inventory/drafts");
  revalidatePath("/admin/inventory");
  redirect(draftsHref({ extra }));
}

/**
 * R50 S13 - "Save a copy of every lab certificate". Downloads each COA PDF
 * linked in the vendors' transfer files (lab_results.coa_url) into the private
 * `coa` bucket, resumable like S12b. Only adds the stored copy; never changes
 * a lab result's facts, a lot, stock, price or the menu.
 */
export async function runCoaArchiveBackfillAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const { runCoaArchiveBackfill } = await import("@/lib/inventory/coa-archive-backfill");
  const { coaBackfillNote, coaBackfillTone } = await import("@/lib/inventory/coa-archive-backfill-core");
  const raw = formData.get("cursor");
  let extra: Record<string, string>;
  try {
    const run = await runCoaArchiveBackfill(typeof raw === "string" ? raw : null, session.userId);
    extra = { coa_bf: coaBackfillTone(run), coa_bf_msg: coaBackfillNote(run).slice(0, 700), cv_page: "1" };
    if (run.next && !(run.ok && run.done)) extra.coa_bf_next = run.next;
  } catch (err) {
    console.error("[drafts] coa archive backfill failed:", err);
    extra = { coa_bf: "warn", coa_bf_msg: `Stopped: ${(err instanceof Error ? err.message : String(err)).slice(0, 300)}`, cv_page: "1" };
  }
  revalidatePath("/admin/inventory/drafts");
  redirect(draftsHref({ extra }));
}

/**
 * R50 A3 - "Preview first (writes nothing)" for the S12b button. The SAME walk
 * and the SAME link plan as the real run (runWciaBackfill dryRun): it reads the
 * vendor files and the lots, then stops before any lab result, lot link,
 * timeline line or audit row. Resumable with its own cursor (lab_pv_next).
 */
export async function previewWciaBackfillAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const { runWciaBackfill } = await import("@/lib/inventory/cultivera-wcia-backfill");
  const { wciaPreviewNote, wciaPreviewTone } = await import("@/lib/inventory/bulk-preview-core");
  const raw = formData.get("cursor");
  let extra: Record<string, string>;
  try {
    const run = await runWciaBackfill(typeof raw === "string" ? raw : null, session.userId, { dryRun: true });
    extra = { lab_pv: wciaPreviewTone(run), lab_pv_msg: wciaPreviewNote(run).slice(0, 700), cv_page: "1" };
    if (run.next && !(run.ok && run.done)) extra.lab_pv_next = run.next;
  } catch (err) {
    console.error("[drafts] wcia preview failed:", err);
    extra = { lab_pv: "warn", lab_pv_msg: `Preview stopped: ${(err instanceof Error ? err.message : String(err)).slice(0, 300)}`, cv_page: "1" };
  }
  redirect(draftsHref({ extra }));
}

/**
 * R50 A3 - "Preview first (writes nothing)" for the S13 button: the SAME
 * candidate query and URL check, read-only. Nothing is downloaded or saved.
 */
export async function previewCoaArchiveBackfillAction() {
  await requirePermission("inventory.manage");
  const { previewCoaArchiveBackfill } = await import("@/lib/inventory/coa-archive-backfill");
  const { coaPreviewNote, coaPreviewTone } = await import("@/lib/inventory/bulk-preview-core");
  let extra: Record<string, string>;
  try {
    const run = await previewCoaArchiveBackfill();
    extra = { coa_pv: coaPreviewTone(run), coa_pv_msg: coaPreviewNote(run).slice(0, 700), cv_page: "1" };
  } catch (err) {
    console.error("[drafts] coa preview failed:", err);
    extra = { coa_pv: "warn", coa_pv_msg: `Preview stopped: ${(err instanceof Error ? err.message : String(err)).slice(0, 300)}`, cv_page: "1" };
  }
  redirect(draftsHref({ extra }));
}

/**
 * R50 A1 - "Yes, same product - always join this card" on the S4 suggestion.
 * The server re-runs the row's preview and saves ONLY a card the scorer
 * suggests for that row right now (card-alias-core acceptCheck); the posted
 * key is never trusted. Saving changes nothing live: the alias is applied
 * when the row is approved (and on future deliveries), only while the card is
 * still a valid merge target (intake-mastering-core aliasTarget).
 */
export async function acceptCardAliasAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const core = await import("@/lib/pos/card-alias-core");
  const get = (n: string) => {
    const v = formData.get(n);
    return typeof v === "string" ? v : "";
  };
  const form = core.parseAcceptForm(get);
  if (!form.ok) redirect(draftsHref({ extra: { alias: "error", alias_msg: form.error } }));
  const { draftId, manifestId, cardKey } = form.value;
  let code: string = "error";
  let message: string | null = null;
  try {
    const { loadAcceptEvidence } = await import("@/lib/pos/card-alias-server");
    const checked = core.acceptCheck(cardKey, await loadAcceptEvidence(manifestId, draftId));
    if (!checked.ok) {
      message = checked.error;
    } else {
      const { saveCardAlias } = await import("@/lib/pos/card-alias-store");
      const saved = await saveCardAlias({ identity: checked.identity, cardKey, cardName: checked.cardName }, session.userId);
      if (!saved.migrated) code = "migration";
      else if (!saved.ok) message = saved.error ?? "Saving failed.";
      else {
        code = "saved";
        await recordAudit({
          actorId: session.userId,
          actorEmail: session.email,
          action: core.CARD_ALIAS_AUDIT_ACCEPT,
          entityType: "intake_card_alias",
          entityId: checked.identity,
          after: { manifestId, draftId, cardKey, cardName: checked.cardName },
        });
        const { logManifestEvent } = await import("@/lib/inventory/intake-store");
        await logManifestEvent(manifestId, "card_alias_saved", core.aliasEventNote(checked.identity, cardKey, checked.cardName), session.userId);
      }
    }
  } catch (err) {
    console.error("[drafts] acceptCardAliasAction failed:", err);
    message = err instanceof Error ? err.message : "Saving the choice failed.";
  }
  revalidatePath("/admin/inventory/drafts");
  const extra: Record<string, string> = { alias: code };
  if (code === "error" && message) extra.alias_msg = message.slice(0, 300);
  redirect(draftsHref({ manifestId, draftId, extra }));
}

/** R50 A1 - "Forget this choice": deletes the alias; nothing live changes. */
export async function forgetCardAliasAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const core = await import("@/lib/pos/card-alias-core");
  const get = (n: string) => {
    const v = formData.get(n);
    return typeof v === "string" ? v : "";
  };
  const form = core.parseForgetForm(get);
  if (!form.ok) redirect(draftsHref({ extra: { alias: "error", alias_msg: form.error } }));
  const { identity, manifestId, draftId } = form.value;
  let code: string = "error";
  let message: string | null = null;
  try {
    const { forgetCardAlias } = await import("@/lib/pos/card-alias-store");
    const r = await forgetCardAlias(identity);
    if (!r.migrated) code = "migration";
    else if (!r.ok) message = r.error ?? "Forgetting failed.";
    else {
      code = "forgotten";
      if (r.deleted) {
        await recordAudit({
          actorId: session.userId,
          actorEmail: session.email,
          action: core.CARD_ALIAS_AUDIT_FORGET,
          entityType: "intake_card_alias",
          entityId: identity,
          after: { manifestId, cardKey: r.cardKey },
        });
        const { logManifestEvent } = await import("@/lib/inventory/intake-store");
        await logManifestEvent(manifestId, "card_alias_forgotten", `${identity} \u2192 choice forgotten`, session.userId);
      }
    }
  } catch (err) {
    console.error("[drafts] forgetCardAliasAction failed:", err);
    message = err instanceof Error ? err.message : "Forgetting the choice failed.";
  }
  revalidatePath("/admin/inventory/drafts");
  const extra: Record<string, string> = { alias: code };
  if (code === "error" && message) extra.alias_msg = message.slice(0, 300);
  redirect(draftsHref({ manifestId, draftId, extra }));
}

/**
 * R74 S11 - "Start every manifest from <vendor>" (Product Onboarding, by
 * vendor). Runs the SAME per-manifest Start on each of the vendor's not-done
 * Cultivera manifests inside the page's time limit; "Continue" resumes from
 * the returned cursor. Never changes stock, status, cost, prices or the live
 * menu (each Start's own guarantee).
 */
export async function startCultiveraVendorAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const { parseVendorParam, parseVendorCursor, vendorStartNote } = await import("@/lib/inventory/cultivera-vendor-core");
  const vendor = parseVendorParam(formData.get("vendor"));
  const cursor = parseVendorCursor(formData.get("cursor"));
  const extra: Record<string, string> = vendor ? { cv_vendor: vendor } : { cv_vendors: "1" };
  if (!vendor) {
    extra.cvv = "error";
    extra.cvv_msg = "No vendor was chosen.";
  } else {
    try {
      const { startCultiveraVendorOnboarding } = await import("@/lib/inventory/cultivera-vendor");
      const res = await startCultiveraVendorOnboarding(vendor, cursor, session.userId);
      if (res.ok) {
        extra.cvv = res.run.failed > 0 ? "warn" : "ok";
        extra.cvv_msg = vendorStartNote(res.run).slice(0, 700);
        if (!res.run.done && res.run.next) extra.cvv_next = res.run.next;
      } else {
        extra.cvv = "error";
        extra.cvv_msg = res.error.slice(0, 300);
      }
    } catch (err) {
      console.error("[drafts] vendor start failed:", err);
      extra.cvv = "error";
      extra.cvv_msg = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    }
  }
  revalidatePath("/admin/inventory/drafts");
  redirect(`${draftsHref({ extra })}#cultivera-vendor`);
}

/**
 * R74 S11 - "Look up all products from <vendor> with Gemini". Queues the SAME
 * batch lookup the per-manifest button queues, once per manifest of the
 * vendor that has products in review (idempotent: a running job is reused).
 * The every-minute worker runs them; each answer is saved to the knowledge
 * base for reuse.
 */
export async function lookupCultiveraVendorAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const { parseVendorParam, vendorLookupNote } = await import("@/lib/inventory/cultivera-vendor-core");
  const vendor = parseVendorParam(formData.get("vendor"));
  const extra: Record<string, string> = vendor ? { cv_vendor: vendor } : { cv_vendors: "1" };
  if (!vendor) {
    extra.cvl = "error";
    extra.cvl_msg = "No vendor was chosen.";
  } else {
    try {
      const { enqueueVendorLookup } = await import("@/lib/inventory/cultivera-vendor");
      const res = await enqueueVendorLookup(vendor, { userId: session.userId, email: session.email });
      if (res.ok) {
        extra.cvl = res.run.errors.length > 0 ? "warn" : res.run.created + res.run.alreadyRunning > 0 ? "ok" : "nothing";
        extra.cvl_msg = vendorLookupNote(res.run).slice(0, 700);
      } else {
        extra.cvl = res.migration ? "migration" : "error";
        extra.cvl_msg = res.error.slice(0, 300);
      }
    } catch (err) {
      console.error("[drafts] vendor lookup failed:", err);
      extra.cvl = "error";
      extra.cvl_msg = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    }
  }
  revalidatePath("/admin/inventory/drafts");
  redirect(`${draftsHref({ extra })}#cultivera-vendor`);
}
