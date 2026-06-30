"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type SaveAccountingResult = { ok: true } | { ok: false; error: string };

/**
 * Save the Sage 50 chart-of-accounts mapping. Admin/owner only (settings.manage).
 * Account ids are kept as text (leading zeros matter in Sage 50).
 */
export async function saveAccountingSettingsAction(formData: FormData): Promise<SaveAccountingResult> {
  const session = await requirePermission("settings.manage");

  const get = (k: string) => String(formData.get(k) ?? "").trim();
  const patch = {
    gl_cash_clearing: get("gl_cash_clearing"),
    gl_sales_cannabis: get("gl_sales_cannabis"),
    gl_sales_non_cannabis: get("gl_sales_non_cannabis"),
    gl_sales_tax_payable: get("gl_sales_tax_payable"),
    gl_excise_tax_payable: get("gl_excise_tax_payable"),
    gl_cogs: get("gl_cogs"),
    gl_inventory: get("gl_inventory"),
    gl_discounts: get("gl_discounts"),
    journal_ref_prefix: get("journal_ref_prefix") || "GW",
  };

  if (patch.journal_ref_prefix.length > 12) {
    return { ok: false, error: "Reference prefix must be 12 characters or fewer." };
  }

  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("accounting_settings").update(patch).eq("id", true);
    if (error) return { ok: false, error: error.message };

    await recordAudit({
      actorId: session.profile.id,
      action: "accounting_settings.update",
      entityType: "accounting_settings",
      entityId: "singleton",
      after: patch,
    });

    revalidatePath("/admin/reports/accounting");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to save." };
  }
}
