"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type SaveLicenseResult = { ok: true } | { ok: false; error: string };

/**
 * Save the CCRS license identity (license number + SubmittedBy name).
 * Admin/owner only (settings.manage). The CSV export reads these.
 */
export async function saveLicenseSettingsAction(formData: FormData): Promise<SaveLicenseResult> {
  const session = await requirePermission("settings.manage");

  const licenseNumber = String(formData.get("license_number") ?? "").trim();
  const submittedBy = String(formData.get("submitted_by") ?? "").trim();
  const tradeName = String(formData.get("trade_name") ?? "").trim();

  if (licenseNumber && !/^\d{4,8}$/.test(licenseNumber)) {
    return { ok: false, error: "License number should be digits only (typically 6 digits)." };
  }
  if (submittedBy.length > 35) {
    return { ok: false, error: "Submitted-by name must be 35 characters or fewer (CCRS limit)." };
  }

  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("license_settings")
      .update({
        license_number: licenseNumber,
        submitted_by: submittedBy,
        trade_name: tradeName || null,
      })
      .eq("id", true);
    if (error) return { ok: false, error: error.message };

    await recordAudit({
      actorId: session.profile.id,
      action: "license_settings.update",
      entityType: "license_settings",
      entityId: "singleton",
      after: { license_number: licenseNumber, submitted_by: submittedBy, trade_name: tradeName || null },
    });

    revalidatePath("/admin/reports/compliance");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to save." };
  }
}
