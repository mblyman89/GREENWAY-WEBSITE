/**
 * GET /admin/inventory/disposition/sale-correction-export
 *
 * Generates and downloads the CCRS Sale.csv CORRECTION file (Operation
 * Delete/Update) for all customer returns whose correction is still pending.
 * Per the LCB CCRS FAQ, a valid customer return means the sale identifier is
 * deleted (or updated for a partial return) in CCRS — this file is that
 * correction, built from the snapshots captured when each return was accepted.
 *
 * Marks the included returns as exported and audits the download. Requires
 * inventory.manage (same gate as the disposition page).
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getCcrsLicenseSettings } from "@/lib/compliance/ccrs-sales";
import {
  mapSaleCorrectionRow,
  buildSaleCorrectionFile,
  makeSaleCorrectionFileName,
} from "@/lib/compliance/ccrs-sale-correction-core";
import { markCorrectionsExported, type CustomerReturn } from "@/lib/inventory/disposition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await requirePermission("inventory.manage");

  const license = await getCcrsLicenseSettings();
  const rows: string[][] = [];
  const includedIds: string[] = [];
  const skipped: string[] = [];

  if (isSupabaseServiceConfigured) {
    try {
      const admin = createSupabaseAdminClient();
      const { data } = await admin
        .from("customer_returns")
        .select("*")
        .eq("correction_status", "pending")
        .order("created_at", { ascending: true })
        .limit(500);
      for (const r of ((data as CustomerReturn[] | null) ?? [])) {
        const mapped = mapSaleCorrectionRow(
          {
            correctionOperation: r.correction_operation,
            saleExternalId: r.sale_external_id ?? "",
            saleDetailExternalId: r.sale_detail_external_id ?? "",
            inventoryExternalId: r.inventory_external_id ?? "",
            saleType: r.sale_type ?? "RecreationalRetail",
            saleDateISO: r.sale_date ?? r.created_at,
            originalQuantity: Number(r.original_quantity) || 0,
            returnQuantity: Number(r.quantity) || 0,
            unitPriceMinor: r.unit_price_minor ?? 0,
            discountMinor: r.discount_minor ?? 0,
            salesTaxMinor: r.sales_tax_minor ?? 0,
            exciseMinor: r.excise_minor ?? 0,
            returnedAtISO: r.created_at,
          },
          license,
        );
        if (mapped.row) {
          rows.push(mapped.row);
          includedIds.push(r.id);
        } else {
          skipped.push(`${r.id}: ${mapped.skipReason ?? "unmappable"}`);
        }
      }
    } catch {
      // customer_returns missing (pre-0115) — empty file below.
    }
  }

  const csv = buildSaleCorrectionFile(rows, license);
  const fileName = makeSaleCorrectionFileName(license.licenseNumber);

  if (includedIds.length > 0) {
    await markCorrectionsExported(includedIds);
  }
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ccrs.sale_correction_export",
    entityType: "customer_returns",
    entityId: fileName,
    after: { record_count: rows.length, skipped: skipped.length },
  });

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
