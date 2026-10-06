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
import { CCRS_COLUMNS, withholdUnencodableRows } from "@/lib/compliance/ccrs-batch-core";

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

  // S-09 E38 / S-09b E42: a correction carrying a line break or comma cannot
  // be one CCRS record (CCRS splits on every comma). A `"` is fine (S-09c).
  // Withhold it and leave it PENDING (never marked exported) so it is fixed
  // and re-sent, not lost. rows[i] belongs to includedIds[i].
  const e38 = withholdUnencodableRows(rows, CCRS_COLUMNS.Sale, (_r, i) => includedIds[i]);
  const withheldIds = new Set(e38.withheld.map((w) => w.label));
  const exportIds = includedIds.filter((id) => !withheldIds.has(id));
  for (const w of e38.withheld) skipped.push(`${w.label}: ${w.column} contains a ${w.reason} — left pending`);

  const csv = buildSaleCorrectionFile(e38.rows, license);
  const fileName = makeSaleCorrectionFileName(license.licenseNumber);

  if (exportIds.length > 0) {
    await markCorrectionsExported(exportIds);
  }
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ccrs.sale_correction_export",
    entityType: "customer_returns",
    entityId: fileName,
    after: { record_count: e38.rows.length, skipped: skipped.length, e38_withheld: e38.withheld.length },
  });

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
