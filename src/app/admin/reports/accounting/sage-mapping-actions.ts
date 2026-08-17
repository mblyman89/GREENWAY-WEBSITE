"use server";

/**
 * Server actions for the Sage 50 export mapping (migration 0091):
 *   • per-bucket category accounts (sage_category_accounts)
 *   • menu-category → bucket map (sage_category_map)
 *   • store-wide Sage export settings (accounting_settings columns)
 * All admin/owner-gated (settings.manage) and audit-logged.
 */

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isValidBucketKey, normalizeBucketKey, normalizeCategory } from "@/lib/accounting/sage-exports-core";

export type SageMappingResult = { ok: true } | { ok: false; error: string };

/** Save one bucket row of the Sage category mapping. */
export async function saveSageCategoryAccountAction(formData: FormData): Promise<SageMappingResult> {
  const session = await requirePermission("financials.view");
  const get = (k: string) => String(formData.get(k) ?? "").trim();

  const bucket = get("bucket");
  if (!isValidBucketKey(bucket)) return { ok: false, error: "Unknown bucket." };

  const patch = {
    label: get("label"),
    sales_customer_id: get("sales_customer_id"),
    cogs_customer_id: get("cogs_customer_id"),
    gl_sales: get("gl_sales"),
    gl_cogs: get("gl_cogs"),
    gl_inventory: get("gl_inventory"),
    is_cannabis: get("is_cannabis") === "on" || get("is_cannabis") === "true",
    active: get("active") !== "false",
  };

  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("sage_category_accounts").update(patch).eq("bucket", bucket);
    if (error) return { ok: false, error: error.message };
    await recordAudit({
      actorId: session.profile.id,
      action: "sage_category_accounts.update",
      entityType: "sage_category_accounts",
      entityId: bucket,
      after: patch,
    });
    revalidatePath("/admin/reports/accounting");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to save." };
  }
}

/** Map a back-office menu category to a Sage bucket (upsert). */
export async function saveSageCategoryMapAction(formData: FormData): Promise<SageMappingResult> {
  const session = await requirePermission("financials.view");
  const source = normalizeCategory(String(formData.get("source_category") ?? ""));
  const bucket = String(formData.get("bucket") ?? "").trim();
  if (!source) return { ok: false, error: "Category is required." };
  if (!isValidBucketKey(bucket)) return { ok: false, error: "Bucket key must be a lowercase slug (e.g. rosin, vape_cartridges)." };

  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("sage_category_map")
      .upsert({ source_category: source, bucket, active: true }, { onConflict: "source_category" });
    if (error) return { ok: false, error: error.message };
    await recordAudit({
      actorId: session.profile.id,
      action: "sage_category_map.upsert",
      entityType: "sage_category_map",
      entityId: source,
      after: { bucket },
    });
    revalidatePath("/admin/reports/accounting");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to save." };
  }
}

/** Remove a category → bucket mapping. */
export async function deleteSageCategoryMapAction(formData: FormData): Promise<SageMappingResult> {
  const session = await requirePermission("financials.view");
  const source = normalizeCategory(String(formData.get("source_category") ?? ""));
  if (!source) return { ok: false, error: "Category is required." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("sage_category_map").delete().eq("source_category", source);
    if (error) return { ok: false, error: error.message };
    await recordAudit({
      actorId: session.profile.id,
      action: "sage_category_map.delete",
      entityType: "sage_category_map",
      entityId: source,
    });
    revalidatePath("/admin/reports/accounting");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to delete." };
  }
}

/** Save the store-wide Sage export settings (0091 accounting_settings columns). */
export async function saveSageExportSettingsAction(formData: FormData): Promise<SageMappingResult> {
  const session = await requirePermission("financials.view");
  const get = (k: string) => String(formData.get(k) ?? "").trim();
  const patch = {
    gl_ap_account: get("gl_ap_account"),
    gl_bank_account: get("gl_bank_account"),
    gl_purchases_default: get("gl_purchases_default"),
    gl_cash_on_hand: get("gl_cash_on_hand"),
    sales_tax_id_cannabis: get("sales_tax_id_cannabis"),
    sales_tax_id_other: get("sales_tax_id_other"),
  };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("accounting_settings").update(patch).eq("id", true);
    if (error) return { ok: false, error: error.message };
    await recordAudit({
      actorId: session.profile.id,
      action: "accounting_settings.update",
      entityType: "accounting_settings",
      entityId: "sage-export",
      after: patch,
    });
    revalidatePath("/admin/reports/accounting");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to save." };
  }
}

/**
 * Create a new detailed category bucket (dynamic buckets, migration 0092).
 * The key is slugified from the label; fails with a clear message pre-0092
 * (the DB check constraint on the 7 seeded buckets rejects new keys).
 */
export async function createSageCategoryBucketAction(formData: FormData): Promise<SageMappingResult> {
  const session = await requirePermission("financials.view");
  const get = (k: string) => String(formData.get(k) ?? "").trim();

  const label = get("label");
  if (!label) return { ok: false, error: "Label is required (e.g. ROSIN)." };
  const bucket = normalizeBucketKey(get("bucket") || label);
  if (!isValidBucketKey(bucket)) {
    return { ok: false, error: "Bucket key must be a lowercase slug (e.g. rosin, vape_cartridges)." };
  }

  const row = {
    bucket,
    label,
    sales_customer_id: get("sales_customer_id"),
    cogs_customer_id: get("cogs_customer_id"),
    gl_sales: get("gl_sales"),
    gl_cogs: get("gl_cogs"),
    gl_inventory: get("gl_inventory"),
    is_cannabis: get("is_cannabis") === "on" || get("is_cannabis") === "true",
    active: true,
  };

  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("sage_category_accounts").insert(row);
    if (error) {
      if (error.message.includes("bucket_check")) {
        return { ok: false, error: "Apply migration 0092_sage50_dynamic_buckets.sql first — the database still limits buckets to the original seven." };
      }
      if (error.code === "23505") return { ok: false, error: `Bucket "${bucket}" already exists.` };
      return { ok: false, error: error.message };
    }
    await recordAudit({
      actorId: session.profile.id,
      action: "sage_category_accounts.create",
      entityType: "sage_category_accounts",
      entityId: bucket,
      after: row,
    });
    revalidatePath("/admin/reports/accounting");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create bucket." };
  }
}

/** Deactivate a category bucket (kept in the table; excluded from exports/forms). */
export async function deactivateSageCategoryBucketAction(formData: FormData): Promise<SageMappingResult> {
  const session = await requirePermission("financials.view");
  const bucket = String(formData.get("bucket") ?? "").trim();
  if (!isValidBucketKey(bucket)) return { ok: false, error: "Unknown bucket." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("sage_category_accounts").update({ active: false }).eq("bucket", bucket);
    if (error) return { ok: false, error: error.message };
    await recordAudit({
      actorId: session.profile.id,
      action: "sage_category_accounts.deactivate",
      entityType: "sage_category_accounts",
      entityId: bucket,
    });
    revalidatePath("/admin/reports/accounting");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to deactivate." };
  }
}
