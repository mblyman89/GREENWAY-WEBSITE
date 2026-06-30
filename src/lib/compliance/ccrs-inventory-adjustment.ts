/**
 * src/lib/compliance/ccrs-inventory-adjustment.ts  (Run 6 / Slice 30)
 *
 * DB-backed builder for the WSLCB CCRS **InventoryAdjustment.csv**. The pure
 * mapping + file-format logic lives in ./ccrs-inventory-adjustment-core (so it
 * can be unit-tested with tsx); this module only adds the Supabase read.
 *
 * CSV-upload only (no API). The file depends on existing Inventory records:
 * each row references an Inventory.ExternalIdentifier already on file. Positive
 * `receive` deltas are reported via Inventory.csv and excluded here.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getCcrsLicenseSettings } from "@/lib/compliance/ccrs-sales";
import {
  buildAdjustmentFile,
  makeAdjustmentFileName,
  mapAdjustmentRow,
  type AdjustmentSourceRow,
} from "@/lib/compliance/ccrs-inventory-adjustment-core";

export {
  CCRS_ADJUSTMENT_REASONS,
  ADJUSTMENT_COLUMNS,
  mapAdjustmentReason,
  isReportableAdjustment,
  mapAdjustmentRow,
  buildAdjustmentFile,
  makeAdjustmentFileName,
} from "@/lib/compliance/ccrs-inventory-adjustment-core";
export type {
  CcrsAdjustmentReason,
  AdjustmentSourceRow,
  AdjustmentMapResult,
} from "@/lib/compliance/ccrs-inventory-adjustment-core";

export type CcrsAdjustmentBuildResult = {
  csv: string;
  fileName: string;
  recordCount: number;
  skipped: number;
  warnings: string[];
  licenseNumber: string;
};

/**
 * Build the InventoryAdjustment.csv for adjustments created in [fromISO, toISO].
 * Joins each adjustment to its lot for the external identifier.
 */
export async function buildCcrsInventoryAdjustmentCsv(
  fromISO: string,
  toISO: string,
): Promise<CcrsAdjustmentBuildResult> {
  const license = await getCcrsLicenseSettings();
  const result: CcrsAdjustmentBuildResult = {
    csv: "",
    fileName: makeAdjustmentFileName(license.licenseNumber),
    recordCount: 0,
    skipped: 0,
    warnings: [],
    licenseNumber: license.licenseNumber,
  };

  if (!license.licenseNumber) {
    result.warnings.push("License number is not set — set it on the Compliance tab before uploading.");
  }

  if (!isSupabaseServiceConfigured) {
    result.csv = buildAdjustmentFile([], license);
    return result;
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("inventory_adjustments")
    .select(
      "id, qty_delta, reason, note, created_at, lot:inventory_lots(id, lot_code, pos_product_key)",
    )
    .gte("created_at", fromISO)
    .lte("created_at", toISO)
    .order("created_at", { ascending: true });

  if (error) {
    result.warnings.push(`Could not load adjustments: ${error.message}`);
    result.csv = buildAdjustmentFile([], license);
    return result;
  }

  const rows: string[][] = [];
  for (const raw of (data ?? []) as unknown as AdjustmentSourceRow[]) {
    const lotRel = (raw as { lot: unknown }).lot;
    const lot = Array.isArray(lotRel) ? (lotRel[0] ?? null) : (lotRel ?? null);
    const mapped = mapAdjustmentRow({ ...raw, lot: lot as AdjustmentSourceRow["lot"] }, license);
    if (mapped.row) {
      rows.push(mapped.row);
    } else {
      result.skipped += 1;
      if (mapped.skipReason && !mapped.skipReason.includes("not reportable")) {
        result.warnings.push(mapped.skipReason);
      }
    }
  }

  result.recordCount = rows.length;
  result.csv = buildAdjustmentFile(rows, license);
  if (rows.length === 0) {
    result.warnings.push("No reportable adjustments found in the selected range.");
  }
  return result;
}
