"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  mapVendorBrandCsv,
  importVendors,
  importBrands,
} from "@/lib/vendors/import";

/**
 * Import vendors/brands from a pasted spreadsheet (CSV) export.
 * Gap-fill upsert by slug; new rows land as draft. Never overwrites curated data.
 * The header row decides whether the paste is a vendor sheet or a brand sheet.
 */
export async function importVendorsBrandsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const csv = (formData.get("csv_text") as string | null)?.trim() ?? "";
  if (!csv) {
    redirect("/admin/vendors/import?error=empty");
  }

  const parsed = mapVendorBrandCsv(csv);

  if (parsed.entity === "unknown") {
    redirect("/admin/vendors/import?error=unknown");
  }
  if (parsed.entity === "vendors" && parsed.vendors.length === 0) {
    redirect("/admin/vendors/import?error=norows");
  }
  if (parsed.entity === "brands" && parsed.brands.length === 0) {
    redirect("/admin/vendors/import?error=norows");
  }

  const result =
    parsed.entity === "vendors"
      ? await importVendors(parsed.vendors, session.userId)
      : await importBrands(parsed.brands, session.userId);

  if (!result.ok) {
    redirect("/admin/vendors/import?error=save");
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "vendors.import",
    entityType: parsed.entity === "vendors" ? "vendor" : "brand",
    entityId: parsed.entity,
    after: {
      inserted: result.inserted,
      updated: result.updated,
      skipped: result.skipped,
    },
  }).catch(() => {});

  revalidatePath("/admin/vendors");
  revalidatePath("/admin/vendors/import");
  redirect(
    `/admin/vendors/import?entity=${parsed.entity}&inserted=${result.inserted}&updated=${result.updated}&skipped=${result.skipped}`,
  );
}
