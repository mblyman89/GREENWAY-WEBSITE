import "server-only";

/**
 * src/lib/compliance/ccrs-sales.ts  (Run 4 / Slice 17)
 *
 * Builds the WSLCB CCRS **Sale.csv** for a date range. CCRS is CSV-upload only
 * (no API) and is reported weekly (Sun–Sat). This module produces a file that
 * matches the CCRS Upload User Guide field spec exactly so the owner can upload
 * it directly (after validating draft figures, per standing rules).
 *
 * Field spec (retail) — per the CCRS Upload User Guide:
 *   File header rows (above the column header):
 *     SubmittedBy, SubmittedDate (MM/DD/YYYY), NumberRecords
 *   Data columns:
 *     LicenseNumber, SoldToLicenseNumber, InventoryExternalIdentifier,
 *     PlantExternalIdentifier, SaleType, SaleDate (MM/DD/YYYY), Quantity,
 *     UnitPrice (ONE unit, BEFORE discount/tax), Discount (whole line for QTY>1),
 *     SalesTax (state+local combined, whole line), OtherTax (37% excise,
 *     cannabis retail only, whole line), SaleExternalIdentifier (per sale),
 *     SaleDetailExternalIdentifier (unique per line), CreatedBy, CreatedDate,
 *     UpdatedBy, UpdatedDate, Operation (Insert|Update|Delete)
 *
 * Money: CCRS expects DECIMAL DOLLARS (no $, no parens, no negatives). We store
 * everything in minor units (cents) and convert at the boundary.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getTaxSettings, getCannabisCategorySet, isCannabisCategory, applyBps } from "@/lib/reports/tax";

export type CcrsLicenseSettings = {
  licenseNumber: string;
  submittedBy: string;
};

export type CcrsBuildResult = {
  csv: string;
  fileName: string;
  recordCount: number;
  /** Lines skipped because they had no usable price/quantity. */
  skipped: number;
  /** Validation warnings the employee should review before uploading. */
  warnings: string[];
  licenseNumber: string;
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function dollars(cents: number): string {
  return (Math.max(0, cents) / 100).toFixed(2);
}

/** MM/DD/YYYY in UTC. */
function mmddyyyy(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function cell(v: unknown): string {
  const s = v == null ? "" : String(v);
  // CCRS dislikes embedded quotes; strip them and quote if a comma/newline.
  const clean = s.replace(/"/g, "");
  return /[,\n]/.test(clean) ? `"${clean}"` : clean;
}

const COLUMNS = [
  "LicenseNumber",
  "SoldToLicenseNumber",
  "InventoryExternalIdentifier",
  "PlantExternalIdentifier",
  "SaleType",
  "SaleDate",
  "Quantity",
  "UnitPrice",
  "Discount",
  "SalesTax",
  "OtherTax",
  "SaleExternalIdentifier",
  "SaleDetailExternalIdentifier",
  "CreatedBy",
  "CreatedDate",
  "UpdatedBy",
  "UpdatedDate",
  "Operation",
] as const;

// ---------------------------------------------------------------------------
// Settings loader
// ---------------------------------------------------------------------------

export async function getCcrsLicenseSettings(): Promise<CcrsLicenseSettings> {
  const fallback: CcrsLicenseSettings = { licenseNumber: "", submittedBy: "" };
  if (!isSupabaseServiceConfigured) return fallback;
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("license_settings")
      .select("license_number, submitted_by")
      .eq("id", true)
      .maybeSingle();
    if (!data) return fallback;
    return {
      licenseNumber: (data.license_number ?? "").trim(),
      submittedBy: (data.submitted_by ?? "").trim(),
    };
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Category lookup (source_item_id -> category)
// ---------------------------------------------------------------------------

async function buildCategoryLookup(
  admin: ReturnType<typeof createSupabaseAdminClient>,
): Promise<Map<string, string>> {
  const lookup = new Map<string, string>();
  const { data } = await admin
    .from("menu_items")
    .select("source_item_id, category, created_at")
    .order("created_at", { ascending: false })
    .limit(20000);
  const rows = (data as { source_item_id: string; category: string | null }[] | null) ?? [];
  for (const r of rows) {
    if (!r.source_item_id || lookup.has(r.source_item_id)) continue;
    lookup.set(r.source_item_id, r.category?.trim() || "");
  }
  return lookup;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export async function buildCcrsSaleCsv(fromISO: string, toISO: string): Promise<CcrsBuildResult> {
  const license = await getCcrsLicenseSettings();
  const warnings: string[] = [];

  const result: CcrsBuildResult = {
    csv: "",
    fileName: "",
    recordCount: 0,
    skipped: 0,
    warnings,
    licenseNumber: license.licenseNumber,
  };

  if (!license.licenseNumber) {
    warnings.push(
      "License number is not set. Add it in Compliance settings before uploading to CCRS.",
    );
  }

  if (!isSupabaseServiceConfigured) {
    result.csv = buildFile([], license);
    result.fileName = makeFileName(license.licenseNumber);
    return result;
  }

  const admin = createSupabaseAdminClient();
  const [settings, cannabisSet, categoryLookup] = await Promise.all([
    getTaxSettings(),
    getCannabisCategorySet(),
    buildCategoryLookup(admin),
  ]);
  const combinedSalesBps = settings.stateSalesRateBps + settings.localSalesRateBps;

  // Completed (or at least non-cancelled) sales in range.
  const { data: ordersData } = await admin
    .from("orders")
    .select("id, order_number, status, placed_at, completed_at")
    .gte("placed_at", fromISO)
    .lte("placed_at", toISO);
  const orders =
    (ordersData as
      | { id: string; order_number: string; status: string; placed_at: string; completed_at: string | null }[]
      | null) ?? [];
  const reportable = orders.filter((o) => o.status === "completed");
  if (reportable.length === 0) {
    warnings.push("No completed orders in the selected range.");
    result.csv = buildFile([], license);
    result.fileName = makeFileName(license.licenseNumber);
    return result;
  }

  const orderById = new Map(reportable.map((o) => [o.id, o]));
  const orderIds = reportable.map((o) => o.id);

  const { data: linesData } = await admin
    .from("order_lines")
    .select(
      "id, order_id, product_id, quantity, price_minor_units, regular_price_minor_units, ccrs_inventory_external_id",
    )
    .in("order_id", orderIds.slice(0, 2000));
  const lines =
    (linesData as
      | {
          id: string;
          order_id: string;
          product_id: string | null;
          quantity: number;
          price_minor_units: number;
          regular_price_minor_units: number | null;
          ccrs_inventory_external_id: string | null;
        }[]
      | null) ?? [];

  const rows: string[][] = [];
  let missingInvIds = 0;
  let skipped = 0;

  for (const l of lines) {
    const qty = l.quantity ?? 0;
    if (qty <= 0) {
      skipped++;
      continue;
    }
    const order = orderById.get(l.order_id);
    if (!order) {
      skipped++;
      continue;
    }

    // UnitPrice = price of ONE unit BEFORE discount/tax. We use the regular
    // (pre-discount) unit price; the markdown goes in the Discount column.
    const soldUnit = l.price_minor_units ?? 0; // post-discount, pre-tax unit
    const regularUnit = l.regular_price_minor_units ?? soldUnit; // pre-discount unit
    if (regularUnit <= 0) {
      skipped++;
      continue;
    }

    const unitPriceCents = regularUnit;
    const lineDiscountCents = Math.max(0, (regularUnit - soldUnit) * qty); // whole line
    // Taxable base = post-discount price × qty.
    const baseCents = soldUnit * qty;

    const category = (l.product_id ? categoryLookup.get(l.product_id) : "") || "";
    const isCannabis = isCannabisCategory(category, cannabisSet);

    const salesTaxCents = applyBps(baseCents, combinedSalesBps);
    const exciseCents = isCannabis ? applyBps(baseCents, settings.exciseRateBps) : 0;

    // External identifiers (deterministic, stable, idempotent).
    const inventoryExternalId = (l.ccrs_inventory_external_id ?? l.product_id ?? "").trim();
    if (!inventoryExternalId) missingInvIds++;
    const saleExternalId = order.order_number || order.id;
    const saleDetailExternalId = `${saleExternalId}-${l.id.slice(0, 8)}`;
    const saleDate = mmddyyyy(order.completed_at ?? order.placed_at);

    rows.push([
      license.licenseNumber, // LicenseNumber
      "", // SoldToLicenseNumber (retail = blank)
      inventoryExternalId, // InventoryExternalIdentifier
      "", // PlantExternalIdentifier (retail = blank)
      "RecreationalRetail", // SaleType
      saleDate, // SaleDate
      String(qty), // Quantity
      dollars(unitPriceCents), // UnitPrice (one unit, pre-discount/tax)
      dollars(lineDiscountCents), // Discount (whole line)
      dollars(salesTaxCents), // SalesTax (state+local, whole line)
      dollars(exciseCents), // OtherTax / CannabisExciseTax (37%, whole line)
      saleExternalId, // SaleExternalIdentifier
      saleDetailExternalId, // SaleDetailExternalIdentifier
      license.submittedBy, // CreatedBy
      saleDate, // CreatedDate
      "", // UpdatedBy
      "", // UpdatedDate
      "Insert", // Operation
    ]);
  }

  if (missingInvIds > 0) {
    warnings.push(
      `${missingInvIds} line(s) have no InventoryExternalIdentifier. CCRS requires each sold item to map to an existing CCRS inventory id — set per-product CCRS ids or ensure product_id matches your CCRS inventory.`,
    );
  }
  if (skipped > 0) {
    warnings.push(`${skipped} line(s) were skipped (zero quantity or no usable price).`);
  }

  result.csv = buildFile(rows, license);
  result.fileName = makeFileName(license.licenseNumber);
  result.recordCount = rows.length;
  result.skipped = skipped;
  return result;
}

// ---------------------------------------------------------------------------
// File assembly
// ---------------------------------------------------------------------------

function makeFileName(licenseNumber: string): string {
  const now = new Date();
  const ts =
    now.getUTCFullYear().toString() +
    String(now.getUTCMonth() + 1).padStart(2, "0") +
    String(now.getUTCDate()).padStart(2, "0") +
    String(now.getUTCHours()).padStart(2, "0") +
    String(now.getUTCMinutes()).padStart(2, "0") +
    String(now.getUTCSeconds()).padStart(2, "0");
  const lic = licenseNumber || "LICENSE";
  return `sale_${lic}_${ts}.csv`;
}

/**
 * The CCRS Sale file: header rows (SubmittedBy / SubmittedDate / NumberRecords),
 * a blank line, the column header row, then the data rows.
 */
function buildFile(rows: string[][], license: CcrsLicenseSettings): string {
  const submittedDate = mmddyyyy(new Date());
  const out: string[] = [];
  // File header (3 fields, one per labeled line — matches the guide's format).
  out.push(["SubmittedBy", "SubmittedDate", "NumberRecords"].map(cell).join(","));
  out.push([license.submittedBy, submittedDate, String(rows.length)].map(cell).join(","));
  // Column header row.
  out.push(COLUMNS.join(","));
  for (const r of rows) out.push(r.map(cell).join(","));
  return out.join("\n");
}
