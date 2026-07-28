"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createAdjustment, updateLotStatus, updateLotDetails, getLotById } from "@/lib/inventory/store";
import { parseLotEditInput, brandMatchesVendor, buildLotEditSummary } from "@/lib/inventory/lot-edit-core";
import { getVendorById, getBrandById } from "@/lib/vendors/store";

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
