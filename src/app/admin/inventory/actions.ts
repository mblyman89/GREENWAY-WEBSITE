"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createAdjustment, updateLotStatus, updateLotDetails, getLotById } from "@/lib/inventory/store";
import { parseLotEditInput, brandMatchesVendor, buildLotEditSummary } from "@/lib/inventory/lot-edit-core";
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
