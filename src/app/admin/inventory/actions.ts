"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  createAdjustment,
  updateLotStatus,
  updateLotDetails,
  updateLotReceivedDate,
  getLotById,
  listLotsForBulkFill,
  applyBulkFill,
} from "@/lib/inventory/store";
// SLICE 8 — bulk fill of the fields the one-time Cultivera import never carried.
import {
  planBulkFill,
  formatFillValue,
  BULK_FILLABLE_FIELDS,
  type BulkFillField,
} from "@/lib/inventory/bulk-fill-core";
import { pacificToday } from "@/lib/reports/timezone";
// SLICE 18 - the back-office undo for the register's "86" button.
import { restoreProductToSale } from "@/lib/inventory/restore-to-sale-store";
import { parseLotEditInput, brandMatchesVendor, buildLotEditSummary } from "@/lib/inventory/lot-edit-core";
import { parseReceivedDateInput, buildReceivedDateSummary } from "@/lib/inventory/received-date-core";
import { getVendorById, getBrandById } from "@/lib/vendors/store";
// Option A: per-product website Type/Category override (migration 0150).
import {
  parseClassificationEdit,
  resolveOverrideValue,
  buildClassificationAuditSummary,
} from "@/lib/inventory/lot-website-classification-core";
import {
  getOverrideForKey,
  upsertOverride,
} from "@/lib/pos/product-classification-overrides";
import { listWebsiteCategoryTypes, listInventoryTypes } from "@/lib/pos/types-store";
import { validateCategoryDraft } from "@/lib/pos/category-registry-core";
import { validateInventoryTypeDraft } from "@/lib/pos/type-registry-core";
import { resolveWebsiteCategoryForLot } from "@/lib/inventory/website-category-resolver-server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
// T-324: after-tax price correction (pure math + write path).
import { parsePriceCorrection } from "@/lib/inventory/price-correction-core";
import { applyLotAfterTaxPrice } from "@/lib/inventory/price-write-store";
// SLICE 18A: the compliance-classification editor. The RULES are the same pure
// gate the receiving door uses (18-0) — imported, never re-implemented, so the
// two doors into this store cannot drift apart.
import {
  assessReceivingClassification,
  validateReceivingClassificationChoice,
} from "@/lib/inventory/receiving-classification-core";
// The write goes to the menu because that is the only surface the register
// enforces from (live-menu.ts:94-100).
import { applyClassificationToMenu } from "@/lib/inventory/classification-status-store";

const VALID_REASONS = new Set([
  "receive",
  "shrink",
  "damage",
  "sample",
  // Task K: trade sample provided to a paid employee (WAC 314-55-096) \u2014 exports
  // to CCRS as AdjustmentReason "Other" with a detail naming the employee.
  "employee_sample",
  "destruction",
  "count",
  "recall",
  "other",
]);

const VALID_STATUSES = new Set([
  "active",
  "quarantine",
  "recalled",
  "sold_out",
  "destroyed",
]);

export async function adjustLotAction(lotId: string, formData: FormData) {
  const session = await requirePermission("inventory.manage");

  const rawQty = formData.get("qty_delta");
  const reason = (formData.get("reason") as string | null)?.trim() ?? "";
  const note = (formData.get("note") as string | null)?.trim() || null;

  const qtyDelta = typeof rawQty === "string" ? Number(rawQty) : NaN;
  if (!Number.isFinite(qtyDelta) || qtyDelta === 0) {
    redirect(`/admin/inventory/${lotId}?error=qty`);
  }
  if (!VALID_REASONS.has(reason)) {
    redirect(`/admin/inventory/${lotId}?error=reason`);
  }

  const result = await createAdjustment(
    { lotId, qtyDelta, reason, note },
    session.userId,
  );
  revalidatePath(`/admin/inventory/${lotId}`);
  revalidatePath("/admin/inventory");
  if (!result.ok) {
    redirect(`/admin/inventory/${lotId}?error=save`);
  }
  redirect(`/admin/inventory/${lotId}?saved=1`);
}

export async function setLotStatusAction(lotId: string, formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const status = (formData.get("status") as string | null)?.trim() ?? "";
  if (!VALID_STATUSES.has(status)) {
    redirect(`/admin/inventory/${lotId}?error=status`);
  }
  const result = await updateLotStatus(lotId, status, session.userId);
  revalidatePath(`/admin/inventory/${lotId}`);
  revalidatePath("/admin/inventory");
  if (!result.ok) {
    redirect(`/admin/inventory/${lotId}?error=save`);
  }
  redirect(`/admin/inventory/${lotId}?saved=1`);
}

/**
 * SLICE 2 — set a lot's RECEIVED DATE (owner-mandated compliance fix).
 *
 * Owner request, verbatim: "For lots that don't have a receive date, I want
 * them flagged for me to add one." Before this there was no such capability
 * anywhere in the app — `lot-edit-core.ts` whitelists four descriptive fields
 * and explicitly locks dates.
 *
 * Why this date IS safe to hand-enter when the others are not: the received
 * date is not a derived number, it is a FACT FROM THE PAPERWORK that the
 * Cultivera export simply failed to carry. The owner reading it off the
 * manifest is the most authoritative source available. What stays locked is
 * `created_at` (the immutable FIFO ordering key) and `expires_on` (which comes
 * from the COA).
 *
 * Validated by the PURE core, attributed to whoever set it, audited.
 */
export async function updateLotReceivedDateAction(lotId: string, formData: FormData) {
  const session = await requirePermission("inventory.manage");

  const parsed = parseReceivedDateInput(formData.get("received_on") as string | null);
  if (!parsed.ok) {
    redirect(`/admin/inventory/${lotId}?error=` + encodeURIComponent(parsed.error));
  }

  const before = await getLotById(lotId);
  if (!before) {
    redirect(`/admin/inventory/${lotId}?error=` + encodeURIComponent("That lot no longer exists."));
  }
  // `received_on` is now a first-class column on InventoryLot (migration 0214),
  // so this reads straight off the typed row — no cast needed.
  const beforeReceivedOn = before.received_on ?? null;

  const result = await updateLotReceivedDate(lotId, parsed.receivedOn, session.userId);
  if (!result.ok) {
    redirect(`/admin/inventory/${lotId}?error=` + encodeURIComponent(result.error));
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "inventory_lot.received_date_set",
    entityType: "inventory_lot",
    entityId: lotId,
    before: { received_on: beforeReceivedOn },
    after: {
      received_on: parsed.receivedOn,
      received_on_source: parsed.receivedOn ? "owner_entered" : null,
      changes: [buildReceivedDateSummary(beforeReceivedOn, parsed.receivedOn)],
    },
  });

  revalidatePath(`/admin/inventory/${lotId}`);
  revalidatePath("/admin/inventory");
  redirect(`/admin/inventory/${lotId}?saved=1`);
}

/**
 * SLICE 77 — correct the descriptive linkage on a lot: vendor, brand, strain
 * name, strain type. These are the ONLY legally hand-editable lot fields
 * (lot-edit-core is the whitelist gatekeeper); quantities, lot codes, costs,
 * LCB classification and COA links stay locked to manifests + audited
 * adjustments. Vendor/brand ids are verified against the REAL vendors/brands
 * tables, vendor⇄brand consistency is enforced, and the change lands in the
 * audit trail as a plain-English "old → new" summary.
 */
export async function updateLotDetailsAction(lotId: string, formData: FormData) {
  const session = await requirePermission("inventory.manage");

  const parsed = parseLotEditInput({
    vendor_id: formData.get("vendor_id") as string | null,
    brand_id: formData.get("brand_id") as string | null,
    strain_name: formData.get("strain_name") as string | null,
    strain_type: formData.get("strain_type") as string | null,
  });
  if (!parsed.ok) {
    redirect(`/admin/inventory/${lotId}?error=` + encodeURIComponent(parsed.error));
  }
  const patch = parsed.patch;

  const before = await getLotById(lotId);
  if (!before) {
    redirect(`/admin/inventory/${lotId}?error=` + encodeURIComponent("That lot no longer exists."));
  }

  // Verify the ids point at REAL rows (never trust form input).
  const [vendor, brand] = await Promise.all([
    patch.vendor_id ? getVendorById(patch.vendor_id) : Promise.resolve(null),
    patch.brand_id ? getBrandById(patch.brand_id) : Promise.resolve(null),
  ]);
  if (patch.vendor_id && !vendor) {
    redirect(`/admin/inventory/${lotId}?error=` + encodeURIComponent("That vendor isn't in the vendors database — pick one from the list."));
  }
  if (patch.brand_id && !brand) {
    redirect(`/admin/inventory/${lotId}?error=` + encodeURIComponent("That brand isn't in the brands database — pick one from the list."));
  }
  if (!brandMatchesVendor(brand, patch.vendor_id)) {
    redirect(`/admin/inventory/${lotId}?error=` + encodeURIComponent("That brand belongs to a different vendor. Pick the brand's own vendor, or clear the brand."));
  }

  const result = await updateLotDetails(lotId, patch, session.userId);
  if (!result.ok) {
    redirect(`/admin/inventory/${lotId}?error=save`);
  }

  const summary = buildLotEditSummary(
    {
      vendor: before.vendor_name,
      brand: before.brand_name,
      strain_name: before.strain_name,
      strain_type: before.strain_type,
    },
    {
      vendor: vendor?.display_name ?? null,
      brand: brand?.display_name ?? null,
      strain_name: patch.strain_name,
      strain_type: patch.strain_type,
    },
  );
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "inventory_lot.details_edited",
    entityType: "inventory_lot",
    entityId: lotId,
    before: {
      vendor: before.vendor_name,
      brand: before.brand_name,
      strain_name: before.strain_name,
      strain_type: before.strain_type,
    },
    after: { changes: summary, patch },
  });

  revalidatePath(`/admin/inventory/${lotId}`);
  revalidatePath("/admin/inventory");
  redirect(`/admin/inventory/${lotId}?saved=1`);
}

/**
 * Option A — correct ONE product's WEBSITE Type & Category (the values our menu
 * filters by), from the Inventory Detail corrections section. This is the
 * per-product override the pros have: the system auto-resolves Type/Category on
 * import/onboarding, but if that was wrong the owner re-files THIS product here.
 *
 * It behaves EXACTLY like the onboarding approval card:
 *   - pick an EXISTING website category / product type, OR
 *   - create a new one on the fly ("__new__" / "__new_type__"), which is saved
 *     into the SAME registries the Types & Categories page manages
 *     (website_category_types / inventory_types) and is then reusable
 *     everywhere, OR
 *   - keep the current override, OR clear it back to auto-resolution.
 *
 * It NEVER touches the CCRS/LCB columns (inventory_lots.category /
 * inventory_type stay locked — the WA traceability source of truth). The choice
 * is stored in product_classification_overrides (keyed by pos_product_key) and
 * wins at read time on the menu and in the back office. The form is never
 * trusted: every pick is whitelisted against the LIVE registries, and every
 * change lands in the audit trail as a plain-English "old → new" summary.
 *
 * Degrades safely before migration 0150 (upsert returns a friendly message).
 */
export async function updateLotWebsiteClassificationAction(lotId: string, formData: FormData) {
  const session = await requirePermission("inventory.manage");

  const lot = await getLotById(lotId);
  if (!lot) {
    redirect(`/admin/inventory/${lotId}?error=` + encodeURIComponent("That lot no longer exists."));
  }
  const key = (lot.pos_product_key ?? "").trim();
  if (!key) {
    redirect(
      `/admin/inventory/${lotId}?error=` +
        encodeURIComponent("This lot isn't linked to a POS product key yet, so it can't be re-filed."),
    );
  }

  // LIVE registries — the closed vocabularies every pick is checked against.
  const [categoryRegistry, typeRegistry, currentOverride] = await Promise.all([
    listWebsiteCategoryTypes({ includeInactive: false }),
    listInventoryTypes({ includeInactive: false }),
    getOverrideForKey(key),
  ]);

  const parsed = parseClassificationEdit(
    {
      website_category: formData.get("website_category") as string | null,
      house_type: formData.get("house_type") as string | null,
      new_category_label: formData.get("new_category_label") as string | null,
      new_type_label: formData.get("new_type_label") as string | null,
    },
    {
      validCategoryValues: categoryRegistry.map((c) => c.value),
      validTypeLabels: typeRegistry.map((t) => t.label),
    },
  );
  if (!parsed.ok) {
    redirect(`/admin/inventory/${lotId}?error=` + encodeURIComponent(parsed.error));
  }

  // The effective website category BEFORE this edit — the override if set, else
  // the auto-resolution. Needed to map a newly-created product type, and for
  // the audit "old → new" summary.
  const beforeResolution = await resolveWebsiteCategoryForLot({
    posProductKey: lot.pos_product_key,
    productName: lot.product_name,
    inventoryType: lot.inventory_type,
    category: lot.category,
  });
  const beforeCategory = currentOverride?.website_category ?? beforeResolution.websiteCategory;
  const beforeType = currentOverride?.house_type ?? null;

  const admin = createSupabaseAdminClient();

  // Create-on-the-fly: website category ("__new__"). Same pure gatekeeper as
  // Settings → Types, same table, same audit — then the new value is the pick.
  let createdCategory: string | null = null;
  if (parsed.category.kind === "create") {
    const v = validateCategoryDraft({
      label: parsed.category.newLabel,
      existingValues: categoryRegistry.map((c) => c.value),
    });
    if (!v.ok) {
      redirect(`/admin/inventory/${lotId}?error=` + encodeURIComponent(v.error));
    }
    const { error } = await admin.from("website_category_types").insert({
      value: v.value,
      label: v.label,
      helper: "",
      sort_order: v.sort_order,
      is_active: true,
      is_system: false,
    });
    if (error) {
      redirect(`/admin/inventory/${lotId}?error=` + encodeURIComponent(error.message));
    }
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "website_category.created",
      entityType: "website_category_type",
      entityId: v.value,
      after: { value: v.value, label: v.label, created_during: "inventory_detail_correction" },
    });
    createdCategory = v.value;
  }

  // Create-on-the-fly: product type ("__new_type__"). Mapped to the website
  // category this product files under (the just-chosen/created category if any,
  // otherwise the current effective category) so the new type is grouped
  // correctly everywhere from day one.
  let createdType: string | null = null;
  if (parsed.type.kind === "create") {
    const v = validateInventoryTypeDraft({
      label: parsed.type.newLabel,
      existingKeys: typeRegistry.map((t) => t.key),
    });
    if (!v.ok) {
      redirect(`/admin/inventory/${lotId}?error=` + encodeURIComponent(v.error));
    }
    const mappedCategory =
      createdCategory ??
      (parsed.category.kind === "set" ? parsed.category.value : null) ??
      beforeCategory ??
      null;
    const { error } = await admin.from("inventory_types").insert({
      key: v.key,
      label: v.label,
      notes: "Created during an inventory-detail correction.",
      website_category: mappedCategory,
      is_active: true,
      is_system: false,
    });
    if (error) {
      redirect(`/admin/inventory/${lotId}?error=` + encodeURIComponent(error.message));
    }
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "inventory_type.created",
      entityType: "inventory_type",
      entityId: v.key,
      after: {
        key: v.key,
        label: v.label,
        website_category: mappedCategory,
        created_during: "inventory_detail_correction",
      },
    });
    createdType = v.label;
  }

  // Fold each decision against the CURRENT stored override to get the new
  // stored values. "keep" preserves the existing override; "clear" nulls it.
  const nextCategory = resolveOverrideValue(
    parsed.category,
    currentOverride?.website_category ?? null,
    createdCategory,
  );
  const nextType = resolveOverrideValue(
    parsed.type,
    currentOverride?.house_type ?? null,
    createdType,
  );

  const result = await upsertOverride(
    key,
    { website_category: nextCategory, house_type: nextType, note: currentOverride?.note ?? null },
    session.userId,
  );
  if (!result.ok) {
    redirect(`/admin/inventory/${lotId}?error=` + encodeURIComponent(result.error));
  }

  const summary = buildClassificationAuditSummary(
    { category: beforeCategory, type: beforeType },
    { category: nextCategory, type: nextType },
  );
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "inventory_lot.website_classification_edited",
    entityType: "inventory_lot",
    entityId: lotId,
    before: { pos_product_key: key, website_category: beforeCategory, house_type: beforeType },
    after: {
      pos_product_key: key,
      website_category: nextCategory,
      house_type: nextType,
      changes: summary,
    },
  });

  // The override wins at read time on the menu and in the back office, so
  // refresh both surfaces.
  revalidatePath(`/admin/inventory/${lotId}`);
  revalidatePath("/admin/inventory");
  revalidatePath("/menu");
  redirect(`/admin/inventory/${lotId}?saved=1`);
}

/**
 * T-324 — correct the AFTER-TAX (out-the-door) SELL price of ONE lot, from the
 * Inventory Detail corrections section.
 *
 * The owner types the price the customer pays at the register (tax already
 * folded in). We:
 *   1. HARD-BLOCK any price below the statutory cost+tax floor
 *      (ceil(cost × divisor) — RCW 69.50.357 / WAC 314-55-155; CCRS/LCB do not
 *      tolerate below-acquisition-cost pricing) with a plain-English reason.
 *   2. Write the new price to EXACTLY this lot's menu variant
 *      (source_variant_id = "${pos_product_key}-onboarded") on every LIVE menu
 *      version — the published one (customers see it immediately) and any
 *      staged one — and re-derive that card's "starting at" rollup to the
 *      cheapest variant. It NEVER touches any sibling variant's price, so
 *      mastered-together products are completely unaffected.
 *   3. Record the change in the audit trail (old → new, base + tax breakdown).
 *
 * The category that drives the tax divisor + floor is the SAME website category
 * the menu/cart use for this product (resolveWebsiteCategoryForLot), so the
 * back office can never disagree with what the register charges.
 */
export async function updateLotAfterTaxPriceAction(lotId: string, formData: FormData) {
  const session = await requirePermission("inventory.manage");

  const lot = await getLotById(lotId);
  if (!lot) {
    redirect(`/admin/inventory/${lotId}?error=` + encodeURIComponent("That lot no longer exists."));
  }
  const key = (lot.pos_product_key ?? "").trim();
  if (!key) {
    redirect(
      `/admin/inventory/${lotId}?error=` +
        encodeURIComponent(
          "This lot isn't linked to a POS product key yet, so it has no menu price to edit. The link is made automatically when the product goes onto the menu.",
        ),
    );
  }

  // The website category the menu/cart use for THIS product — the single source
  // of truth for the tax divisor and the floor (never guess the category).
  const resolution = await resolveWebsiteCategoryForLot({
    posProductKey: lot.pos_product_key,
    productName: lot.product_name,
    inventoryType: lot.inventory_type,
    category: lot.category,
  });

  // Validate + reverse-math + HARD FLOOR, all in the pure core (identical math
  // to the display formula and the register's floor).
  const parsed = parsePriceCorrection({
    afterTaxDollars: formData.get("after_tax_price") as string | null,
    costMinor: lot.unit_cost_minor_units,
    category: resolution.websiteCategory,
  });
  if (!parsed.ok) {
    redirect(`/admin/inventory/${lotId}?error=` + encodeURIComponent(parsed.error));
  }

  const before = lot; // captured for the audit "old → new"
  const result = await applyLotAfterTaxPrice(key, parsed.afterTaxMinor);
  if (!result.ok) {
    redirect(`/admin/inventory/${lotId}?error=` + encodeURIComponent(result.error));
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "inventory_lot.after_tax_price_edited",
    entityType: "inventory_lot",
    entityId: lotId,
    before: {
      pos_product_key: key,
      product_name: before.product_name,
      cost_minor_units: before.unit_cost_minor_units,
    },
    after: {
      pos_product_key: key,
      website_category: resolution.websiteCategory,
      after_tax_minor_units: parsed.afterTaxMinor,
      pre_tax_base_minor_units: parsed.baseMinor,
      tax_inclusive_divisor: parsed.divisor,
      cost_tax_floor_minor_units: parsed.floorMinor,
      menu_versions_updated: result.variantsUpdated,
    },
  });

  // The variant/card price is what the menu + POS bundle read, so refresh both
  // the back office and the customer menu.
  revalidatePath(`/admin/inventory/${lotId}`);
  revalidatePath("/admin/inventory");
  revalidatePath("/menu");
  redirect(`/admin/inventory/${lotId}?saved=1`);
}

/**
 * SLICE 8 — BULK FILL: complete the fields the one-time Cultivera import never
 * carried, across many lots at once.
 *
 * Owner request, verbatim: "Cultivera's data is garbage, and we will need a way
 * to add those fields if they don't exist in the Cultivera data ... allow me to
 * enter that data the one time and then it respects the locked fields rules
 * that protect my license from compliance issues."
 *
 * THE SHAPE OF THE SAFETY (three independent layers, deliberately redundant):
 *
 *  1. The PURE planner (bulk-fill-core) decides eligibility from rows we read
 *     HERE, server-side. The client's posted row data is never trusted — the
 *     form supplies only ids and a value.
 *  2. This action re-reads every selected lot from the database immediately
 *     before planning, so a stale page cannot cause a wrong write.
 *  3. The store writer re-asserts blankness IN THE WHERE CLAUSE, so a row
 *     filled in another tab between preview and confirm matches zero rows and
 *     is reported as skipped rather than overwritten.
 *
 * DRAFTS-ONLY (standing rule 3): `mode=preview` computes and returns the plan
 * WITHOUT writing anything. Only an explicit `mode=apply` — which the UI reaches
 * from the confirm button on the preview — performs writes. The research calls
 * this the "changes preview"; the standing rules call it owner review. They are
 * the same requirement, so the implementation serves both.
 */
export async function bulkFillLotsAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");

  const field = String(formData.get("field") ?? "") as BulkFillField;
  const rawValue = formData.get("value") as string | null;
  const mode = String(formData.get("mode") ?? "preview");
  const ids = formData
    .getAll("lot_ids")
    .map((v) => String(v).trim())
    .filter(Boolean);

  const back = (params: Record<string, string>) => {
    const q = new URLSearchParams({ bulk: "1", ...params });
    redirect(`/admin/inventory?${q.toString()}`);
  };

  if (!(BULK_FILLABLE_FIELDS as readonly string[]).includes(field)) {
    back({ bulkError: "Pick a field to fill." });
  }
  if (ids.length === 0) {
    back({ bulkError: "Select at least one lot first." });
  }

  // Layer 2: read the CURRENT state of every selected lot. Cap-immune.
  const lots = await listLotsForBulkFill(ids);

  // Layer 1: the pure planner makes every decision.
  const plan = planBulkFill({
    field,
    rawValue,
    lots,
    todayPacific: pacificToday(),
  });
  if (!plan.ok) {
    back({ bulkError: plan.error });
    return;
  }

  // DRAFTS-ONLY: preview writes NOTHING. The owner sees exactly what would
  // change, then confirms.
  if (mode !== "apply") {
    back({
      bulkField: field,
      bulkValue: String(rawValue ?? ""),
      bulkPreview: String(plan.apply.length),
      bulkSkipped: String(plan.skip.length),
      bulkIds: plan.apply.map((p) => p.lotId).join(","),
    });
    return;
  }

  // Layer 3: apply, one row at a time, each with its own blankness guard.
  let filled = 0;
  let raced = 0;
  const failures: string[] = [];
  for (const item of plan.apply) {
    const res = await applyBulkFill(item.lotId, field, item.value, session.userId);
    if (!res.ok) {
      failures.push(item.lotId);
    } else if (res.filled) {
      filled += 1;
    } else {
      // Matched zero rows: something filled it first. Not an error — a skip.
      raced += 1;
    }
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "inventory_lot.bulk_filled",
    entityType: "inventory_lot",
    entityId: plan.apply[0]?.lotId ?? "bulk",
    before: { field, blank_on: plan.apply.length },
    after: {
      field,
      value: plan.value,
      value_display: formatFillValue(field, plan.value),
      source: "owner_entered",
      requested: ids.length,
      filled,
      skipped_ineligible: plan.skip.length,
      skipped_raced: raced,
      failed: failures.length,
      lot_ids: plan.apply.map((p) => p.lotId),
      basis:
        "One-time Cultivera migration enrichment: the import recorded these fields as blank and to be set during enrichment (import-lot-core.ts:291-302). Blanks filled from paperwork; no evidenced value was overwritten.",
    },
  });

  revalidatePath("/admin/inventory");
  revalidatePath("/menu");
  back({
    bulkDone: String(filled),
    bulkSkipped: String(plan.skip.length + raced),
    ...(failures.length ? { bulkFailed: String(failures.length) } : {}),
  });
}

/**
 * SLICE 18A — set the COMPLIANCE CLASSIFICATION for one product, from the
 * Inventory Detail corrections section.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS WRITES TO THE MENU AND NOT JUST THE LOT
 *
 * The register enforces the two special limits from the MENU row
 * (live-menu.ts:94-100). Nothing reads those flags back off `inventory_lots`
 * to decide a limit. So an edit that only touched the lot would report
 * "Saved", show the new value on this page, and change nothing at all at the
 * till — a silent no-op, which is worse than an error because nobody
 * investigates a success.
 *
 * The write therefore goes to `menu_items` on the published version plus any
 * staged intake versions, exactly like the after-tax price correction does
 * (price-write-store.ts:259-313), and the lot row is updated alongside it as
 * PROVENANCE so the receiving dock's warning and CCRS-style reporting stay
 * honest about this product.
 *
 * The validation rules are NOT re-implemented here. They come from the same
 * pure gate the receiving door uses (18-0), so the answer a manager gives on
 * this page and the answer a receiver gives at onboarding are checked by one
 * set of rules. tests/compliance/classification-status-parity.test.ts pins
 * that agreement.
 * ───────────────────────────────────────────────────────────────────────────
 */
export async function updateLotComplianceClassificationAction(
  lotId: string,
  formData: FormData,
) {
  const session = await requirePermission("inventory.manage");

  const lot = await getLotById(lotId);
  if (!lot) {
    redirect(`/admin/inventory/${lotId}?error=` + encodeURIComponent("That lot no longer exists."));
  }
  const key = (lot.pos_product_key ?? "").trim();
  if (!key) {
    redirect(
      `/admin/inventory/${lotId}?error=` +
        encodeURIComponent(
          "This lot isn't linked to a POS product key yet, so there's no menu listing to classify.",
        ),
    );
  }

  // Re-derive the shelf SERVER-SIDE. The form is never trusted to say whether
  // a product is in scope: a stale tab, or a hand-edited request, could
  // otherwise disable the gate for a product that needs it most.
  const resolution = await resolveWebsiteCategoryForLot({
    posProductKey: lot.pos_product_key,
    productName: lot.product_name,
    inventoryType: lot.inventory_type,
    category: lot.category,
  });
  const override = await getOverrideForKey(key);
  const effectiveCategory = override?.website_category ?? resolution.websiteCategory;

  const assessment = assessReceivingClassification({
    productName: lot.product_name,
    inventoryType: lot.inventory_type,
    resolvedWebsiteCategory: effectiveCategory,
  });

  const choice = validateReceivingClassificationChoice({
    assessment,
    otherwiseTaken: formData.get("otherwise_taken") as string | null,
    unitsPerPackage: formData.get("units_per_package") as string | null,
    lowThcLiquid: formData.get("low_thc_liquid") as string | null,
    unitThcMg: formData.get("unit_thc_mg") as string | null,
  });
  if (!choice.ok) {
    redirect(`/admin/inventory/${lotId}?error=` + encodeURIComponent(choice.error));
  }

  // 1. THE ENFORCEMENT WRITE. Do this FIRST: if the menu can't be updated the
  //    change has not taken effect anywhere that matters, and we must not
  //    leave the lot row claiming a classification the register isn't using.
  const applied = await applyClassificationToMenu(key, {
    otherwiseTaken: choice.otherwiseTaken,
    unitsPerPackage: choice.unitsPerPackage,
    lowThcLiquid: choice.lowThcLiquid,
    unitThcMg: choice.unitThcMg,
  });
  if (!applied.ok) {
    redirect(`/admin/inventory/${lotId}?error=` + encodeURIComponent(applied.error));
  }

  // 2. THE PROVENANCE WRITE. Best-effort by design: the enforcement write has
  //    already succeeded, so failing the whole action here would tell the
  //    owner nothing was saved when in fact the register IS enforcing the new
  //    answer. Record the shortfall in the audit instead of lying.
  let lotWriteError: string | null = null;
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("inventory_lots")
      .update({
        otherwise_taken: choice.otherwiseTaken,
        units_per_package: choice.unitsPerPackage,
        low_thc_liquid: choice.lowThcLiquid,
        unit_thc_mg: choice.unitThcMg,
        updated_by: session.userId,
      })
      .eq("id", lotId);
    if (error) lotWriteError = error.message;
  } catch (err) {
    lotWriteError = err instanceof Error ? err.message : String(err);
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "inventory_lot.compliance_classification_edited",
    entityType: "inventory_lot",
    entityId: lotId,
    before: {
      pos_product_key: key,
      otherwise_taken: lot.otherwise_taken ?? null,
      units_per_package: lot.units_per_package ?? null,
      low_thc_liquid: lot.low_thc_liquid ?? null,
      unit_thc_mg: lot.unit_thc_mg ?? null,
    },
    after: {
      pos_product_key: key,
      otherwise_taken: choice.otherwiseTaken,
      units_per_package: choice.unitsPerPackage,
      low_thc_liquid: choice.lowThcLiquid,
      unit_thc_mg: choice.unitThcMg,
      provenance: choice.provenance,
      resolved_website_category: effectiveCategory,
      menu_versions_updated: applied.versionsUpdated,
      menu_rows_updated: applied.rowsUpdated,
      // Present ONLY when the provenance write failed, so a reader can tell
      // "the register is enforcing this but the lot row disagrees".
      ...(lotWriteError ? { lot_row_write_failed: lotWriteError } : {}),
      basis:
        "WAC 314-55-095(1)(d)(i)(D) ten-unit 'otherwise taken into the body' limit and (E)/(F) low-THC liquid limit. Set by a manager on the inventory detail page; written to the published menu (the surface the register enforces from) and mirrored onto the lot row as provenance.",
    },
  });

  revalidatePath(`/admin/inventory/${lotId}`);
  revalidatePath("/admin/inventory");
  revalidatePath("/menu");
  redirect(`/admin/inventory/${lotId}?saved=1`);
}

/**
 * SLICE 18 — RESTORE TO SALE: the undo the "86" button never had.
 *
 * Owner: "I will test that while you build the proper restore to sale button."
 *
 * `/api/pos/stock-flag` lets the register pull a listing off the menu, and its
 * own header promised that "bringing an item back is a back-office action".
 * Slice 16 recon proved that action did not exist anywhere under src/app/admin
 * — every 86 was permanent. This is it.
 *
 * SAFETY: this does NOT set "in-stock". It recomputes the status from the live
 * lot units via the pure `decideRestore`, so the one-way property the flag was
 * protecting survives: an item with nothing on the shelf cannot be restored,
 * and the refusal says so plainly. Recall holds and hidden cards outrank stock.
 */
export async function restoreProductToSaleAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");

  const productKey = (formData.get("productKey") as string | null)?.trim() ?? "";
  // Where to send the manager back to — the banner lives on the list page, but
  // the same action is usable from a lot detail page.
  const returnTo = (formData.get("returnTo") as string | null)?.trim() ?? "/admin/inventory";
  const safeReturn = returnTo.startsWith("/admin/inventory") ? returnTo : "/admin/inventory";

  const result = await restoreProductToSale(productKey, {
    userId: session.userId,
    email: session.email,
  });

  // The published menu is what the register, the website and the back office
  // all read, so every surface that could show the stale status is revalidated.
  revalidatePath("/admin/inventory");
  revalidatePath("/menu");

  const params = new URLSearchParams();
  params.set(result.ok ? "restored" : "restoreError", result.message);
  redirect(`${safeReturn}?${params.toString()}`);
}
