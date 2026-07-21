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
import { chunkedIn, pagedAll } from "@/lib/supabase/chunked-in";
import { getTaxSettings, getCannabisCategorySet, isCannabisCategory, applyBps } from "@/lib/reports/tax";
import { preTaxLineBaseMinor, preTaxUnitMinor } from "@/lib/reports/tax-base-core";
import {
  deriveInventoryExternalId,
  resolveSaleInventoryExternalId,
  validateExternalId,
} from "@/lib/compliance/ccrs-identifiers";
// Mastering Slice 1: sold lines resolve the variant's own lot key first.
import { lotKeyForSaleLine } from "@/lib/pos/variant-lot-core";
import {
  assembleCcrsFile,
  ccrsFileName,
  ccrsDate,
  saleTypeForOrder,
} from "@/lib/compliance/ccrs-batch-core";

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

/** MM/DD/YYYY for the Pacific calendar day (B3) — delegates to the shared,
 * timezone-correct formatter so SaleDate/CreatedDate use the WA business day. */
function mmddyyyy(iso: string | Date): string {
  return ccrsDate(iso);
}

// A6: single source of truth — the Sale column set + file assembly now live in
// ccrs-batch-core (A1: RetailSalesTax / CannabisExciseTax; A2/A3: 3-row header +
// \r\n via assembleCcrsFile). No divergent local column copy here anymore.

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
  // S-7: page past the PostgREST per-response row cap (a dropped catalog row
  // misclassifies its lines as non-cannabis → OtherTax under-reported).
  type MenuRow = { source_item_id: string; category: string | null };
  const rows = await pagedAll<MenuRow>(async (from, to) => {
    const { data } = await admin
      .from("menu_items")
      .select("source_item_id, category, created_at")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);
    return (data as MenuRow[] | null) ?? [];
  });
  for (const r of rows) {
    if (!r.source_item_id || lookup.has(r.source_item_id)) continue;
    lookup.set(r.source_item_id, r.category?.trim() || "");
  }
  return lookup;
}

/**
 * Index inventory lots by pos_product_key so a sold line can resolve its
 * canonical CCRS inventory external id and quarantine status. When multiple
 * lots share a key, prefer a non-quarantine lot, then the most recently created.
 */
type LotInfo = { canonicalExternalId: string | null; quarantined: boolean };

async function buildLotIndex(
  admin: ReturnType<typeof createSupabaseAdminClient>,
): Promise<Map<string, LotInfo>> {
  const index = new Map<string, LotInfo>();
  // S-7: page past the PostgREST per-response row cap (the .limit(50000)
  // never returned more than db.max_rows per response anyway).
  type LotRowRaw = {
    id: string;
    pos_product_key: string | null;
    lot_code: string | null;
    ccrs_inventory_external_id: string | null;
    status: string | null;
  };
  const rows = await pagedAll<LotRowRaw>(async (from, to) => {
    const { data } = await admin
      .from("inventory_lots")
      .select("id, pos_product_key, lot_code, ccrs_inventory_external_id, status, created_at")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);
    return (data as LotRowRaw[] | null) ?? [];
  });
  for (const r of rows) {
    const key = r.pos_product_key;
    if (!key) continue;
    const quarantined = r.status === "quarantine";
    const canonicalExternalId = deriveInventoryExternalId({
      ccrs_inventory_external_id: r.ccrs_inventory_external_id,
      pos_product_key: r.pos_product_key,
      lot_code: r.lot_code,
      id: r.id,
    });
    const existing = index.get(key);
    // Prefer a non-quarantine lot; otherwise keep the first (most recent) seen.
    if (!existing || (existing.quarantined && !quarantined)) {
      index.set(key, { canonicalExternalId, quarantined });
    }
  }
  return index;
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
  const [settings, cannabisSet, categoryLookup, lotIndex] = await Promise.all([
    getTaxSettings(),
    getCannabisCategorySet(),
    buildCategoryLookup(admin),
    buildLotIndex(admin),
  ]);
  const combinedSalesBps = settings.stateSalesRateBps + settings.localSalesRateBps;

  // Completed sales in range. S-7: paged so a busy filing period can never
  // silently drop orders from the CCRS upload.
  //
  // S-8 canonical period basis (docs/PERIOD_BASIS.md): completed orders by
  // completed_at (placed_at fallback for legacy rows) — the same basis as
  // wa-tax and the LIQ-1295, and the same timestamp the SaleDate column
  // already reports, so the file's date range matches its own rows.
  type CcrsOrderRow = { id: string; order_number: string; status: string; placed_at: string; completed_at: string | null };
  const orders = await pagedAll<CcrsOrderRow>(async (from, to) => {
    const { data } = await admin
      .from("orders")
      .select("id, order_number, status, placed_at, completed_at")
      .eq("status", "completed")
      .or(
        `and(completed_at.gte.${fromISO},completed_at.lte.${toISO}),and(completed_at.is.null,placed_at.gte.${fromISO},placed_at.lte.${toISO})`,
      )
      .order("id", { ascending: true })
      .range(from, to);
    return (data as CcrsOrderRow[] | null) ?? [];
  });

  // B1: an order is a MEDICAL sale (SaleType = RecreationalMedical) when it has
  // WAC 314-55-090(2) exempt-sale records tied to it — the authoritative,
  // schema-grounded signal (there is no orders.medical column). We look up the
  // set of order ids that appear in medical_exempt_sales for this range.
  //
  // S-8: we also key each exempt record by (order_id, product_sku) so the
  // matching sold LINE reports SalesTax/OtherTax = 0 in the CCRS Sale.csv.
  // Convention (documented on recordExemptSale): product_sku MUST equal the
  // order line's product_id (the POS product key), or the line-level zeroing
  // cannot match.
  const medicalOrderIds = new Set<string>();
  const exemptByOrderSku = new Map<string, { salesExempt: boolean; exciseExempt: boolean }>();
  {
    type ExemptRow = {
      order_id: string | null;
      product_sku: string | null;
      sales_tax_exempt: boolean | null;
      excise_tax_exempt: boolean | null;
    };
    const exemptRows = await pagedAll<ExemptRow>(async (from, to) => {
      const { data } = await admin
        .from("medical_exempt_sales")
        .select("order_id, product_sku, sales_tax_exempt, excise_tax_exempt, sale_date")
        .gte("sale_date", fromISO.slice(0, 10))
        .lte("sale_date", toISO.slice(0, 10))
        .order("id", { ascending: true })
        .range(from, to);
      return (data as ExemptRow[] | null) ?? [];
    });
    for (const r of exemptRows) {
      if (!r.order_id) continue;
      medicalOrderIds.add(r.order_id);
      if (r.product_sku) {
        const key = `${r.order_id}|${r.product_sku}`;
        const prev = exemptByOrderSku.get(key);
        exemptByOrderSku.set(key, {
          salesExempt: (prev?.salesExempt ?? false) || r.sales_tax_exempt === true,
          exciseExempt: (prev?.exciseExempt ?? false) || r.excise_tax_exempt === true,
        });
      }
    }
  }
  const reportable = orders.filter((o) => o.status === "completed");
  if (reportable.length === 0) {
    warnings.push("No completed orders in the selected range.");
    result.csv = buildFile([], license);
    result.fileName = makeFileName(license.licenseNumber);
    return result;
  }

  const orderById = new Map(reportable.map((o) => [o.id, o]));
  const orderIds = reportable.map((o) => o.id);

  // S-7: chunked + paginated — a CCRS Sale.csv must contain EVERY line.
  type CcrsLineRow = {
    id: string;
    order_id: string;
    product_id: string | null;
    variant_id: string | null;
    quantity: number;
    price_minor_units: number;
    regular_price_minor_units: number | null;
    ccrs_inventory_external_id: string | null;
    category: string | null;
  };
  const lines = await chunkedIn<string, CcrsLineRow>(orderIds, async (chunk, from, to) => {
    const { data } = await admin
      .from("order_lines")
      .select(
        "id, order_id, product_id, variant_id, quantity, price_minor_units, regular_price_minor_units, ccrs_inventory_external_id, category",
      )
      .in("order_id", chunk)
      .order("id", { ascending: true })
      .range(from, to);
    return (data as CcrsLineRow[] | null) ?? [];
  });

  const rows: string[][] = [];
  let missingInvIds = 0;
  let quarantinedIds = 0;
  let invalidIds = 0;
  let fallbackKeyIds = 0;
  let skipped = 0;
  let medicalLines = 0;
  let exemptZeroedLines = 0;

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

    // Stored prices are TAX-INCLUSIVE out-the-door card prices (schema
    // contract: migration 0007 / order-pricing-core.ts). GW-010: CCRS wants
    // PRE-TAX money, so every figure below is backed out first.
    const soldUnit = l.price_minor_units ?? 0; // post-discount unit (tax-INCLUSIVE)
    const regularUnit = l.regular_price_minor_units ?? soldUnit; // pre-discount unit (tax-INCLUSIVE)
    if (regularUnit <= 0) {
      skipped++;
      continue;
    }

    // Category: menu catalog first (existing behavior), then the line's own
    // placement-time snapshot (migration 0096; POS B39 keypad lines carry a
    // reserved "pos-custom-*" key that never appears in the catalog, and an
    // empty category is conservatively treated as cannabis - which would
    // wrongly charge excise on a merch keypad line).
    const category = ((l.product_id ? categoryLookup.get(l.product_id) : "") || l.category?.trim() || "");
    const isCannabis = isCannabisCategory(category, cannabisSet);

    // S-8: a line covered by a WAC 314-55-090(2) exempt-sale record reports
    // its exempted tax as 0 (sales tax and/or excise "OtherTax"), so the CCRS
    // Sale.csv matches what was actually charged at the register and what the
    // LIQ-1295 Box 2 deduction claims. The exemption also changes the back-out
    // rate: the register passed it through by REPRICING the line to
    // base + still-due tax, so exempted tax was never inside the stored price.
    const exempt = l.product_id ? exemptByOrderSku.get(`${l.order_id}|${l.product_id}`) : undefined;

    // UnitPrice = price of ONE unit BEFORE discount/tax
    // (docs/CCRS_SELF_REPORTING_GUIDE.md): pre-tax regular unit. Regular shelf
    // prices always carry the full rate for the line type — a medical
    // exemption changes what the patient PAID, not the shelf price.
    const unitPriceCents = preTaxUnitMinor({
      unitPriceMinorUnits: regularUnit,
      isCannabis,
      combinedSalesRateBps: combinedSalesBps,
      exciseRateBps: settings.exciseRateBps,
    });
    // Taxable base = pre-tax post-discount line total (exemption-aware).
    const baseCents = preTaxLineBaseMinor({
      unitPriceMinorUnits: soldUnit,
      quantity: qty,
      isCannabis,
      salesExempt: exempt?.salesExempt,
      exciseExempt: exempt?.exciseExempt,
      combinedSalesRateBps: combinedSalesBps,
      exciseRateBps: settings.exciseRateBps,
    });
    // Discount (whole line, pre-tax): regular pre-tax − sold pre-tax. Keeps
    // the CCRS identity qty × UnitPrice − Discount ≈ pre-tax base, and an
    // exemption is never misreported as a discount.
    const lineDiscountCents = Math.max(0, unitPriceCents * qty - baseCents);

    const salesTaxCents = exempt?.salesExempt ? 0 : applyBps(baseCents, combinedSalesBps);
    const exciseCents =
      isCannabis && !exempt?.exciseExempt ? applyBps(baseCents, settings.exciseRateBps) : 0;
    if (exempt?.salesExempt || exempt?.exciseExempt) exemptZeroedLines += 1;

    // External identifiers (deterministic, stable, idempotent), hardened to the
    // CCRS spec: prefer the line's explicit id, then the matched lot's canonical
    // id, then a sanitized product key as a degraded fallback.
    // Mastering Slice 1: the variant's own encoded lot key wins over the
    // card's product_id (single-lot cards: the two keys coincide) so each
    // size on a mastered card reports ITS OWN lot's CCRS identifier.
    const lineLotKey = lotKeyForSaleLine({ productId: l.product_id, variantId: l.variant_id });
    const lot = lineLotKey ? lotIndex.get(lineLotKey) : undefined;
    const resolved = resolveSaleInventoryExternalId({
      lineExplicit: l.ccrs_inventory_external_id,
      lotCanonical: lot?.canonicalExternalId,
      posProductKey: lineLotKey,
    });
    const inventoryExternalId = resolved.value;

    if (!inventoryExternalId) {
      missingInvIds++;
    } else {
      const idErrs = validateExternalId(inventoryExternalId);
      if (idErrs.length) invalidIds++;
      if (resolved.source === "product_key") fallbackKeyIds++;
      // CCRS rejects sales of inventory still in a quarantine area.
      if (lot?.quarantined) quarantinedIds++;
    }
    const saleExternalId = order.order_number || order.id;
    const saleDetailExternalId = `${saleExternalId}-${l.id.slice(0, 8)}`;
    const saleDate = mmddyyyy(order.completed_at ?? order.placed_at);

    rows.push([
      license.licenseNumber, // LicenseNumber
      "", // SoldToLicenseNumber (retail = blank)
      inventoryExternalId, // InventoryExternalIdentifier
      "", // PlantExternalIdentifier (retail = blank)
      (() => {
        const t = saleTypeForOrder(medicalOrderIds.has(order.id));
        if (t === "RecreationalMedical") medicalLines += 1;
        return t;
      })(), // SaleType (B1: medical → RecreationalMedical)
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
      `${missingInvIds} line(s) have NO InventoryExternalIdentifier. CCRS requires each sold item to map to an inventory record already reported in an Inventory.csv. Set a per-product CCRS id, give the inventory lot a lot code, or ensure the sold product_id matches a received lot.`,
    );
  }
  if (fallbackKeyIds > 0) {
    warnings.push(
      `${fallbackKeyIds} line(s) fell back to using the POS product key as the InventoryExternalIdentifier because no matching inventory lot was found. Verify this key equals the Inventory.ExternalIdentifier you filed in CCRS, or the upload will error with "Invalid InventoryExternalIdentifier".`,
    );
  }
  if (invalidIds > 0) {
    warnings.push(
      `${invalidIds} line(s) have an InventoryExternalIdentifier that may be rejected (over 100 chars or non-alphanumeric). These were sanitized, but confirm they still match the id you filed in CCRS.`,
    );
  }
  if (quarantinedIds > 0) {
    warnings.push(
      `${quarantinedIds} line(s) reference inventory currently in a QUARANTINE area. CCRS rejects sales of quarantined inventory ("Sold item cannot be in Quarantine"). Accept/move the lot out of quarantine in CCRS before uploading.`,
    );
  }
  if (skipped > 0) {
    warnings.push(`${skipped} line(s) were skipped (zero quantity or no usable price).`);
  }
  if (medicalLines > 0) {
    warnings.push(
      `${medicalLines} line(s) are reported as SaleType "RecreationalMedical" because their order has WAC 314-55-090(2) medical exempt-sale records. Confirm each was a qualifying DOH-authorized medical sale before uploading.`,
    );
  }
  if (exemptZeroedLines > 0) {
    warnings.push(
      `${exemptZeroedLines} line(s) had their exempted tax reported as $0.00 (S-8): sales tax and/or the 37% excise "OtherTax" was zeroed because a matching medical exempt-sale record (order + product SKU) covers the line.`,
    );
  }
  if (medicalLines > 0 && exemptZeroedLines === 0) {
    warnings.push(
      `Medical orders were found but NO line matched an exempt record by product SKU — the exempt records' product_sku must equal the sold line's product id (POS product key) for line-level tax zeroing. Taxes were reported at full rates for those lines.`,
    );
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

/** UploadType_LicenseNumber_YYYYMMDDHHMMSS.csv (A6: shared spec helper). */
function makeFileName(licenseNumber: string): string {
  return ccrsFileName("Sale", licenseNumber);
}

/**
 * The CCRS Sale file. A2/A3/A6: assembled by the shared, spec-verified
 * assembler so it is byte-identical in shape to the batch's master-data files —
 * the 3-row common header (SubmittedBy / SubmittedDate / NumberRecords, one per
 * line), the exact template column row, then data rows, joined with \r\n and
 * with NumberRecords == the data-row count.
 */
function buildFile(rows: string[][], license: CcrsLicenseSettings): string {
  return assembleCcrsFile({
    type: "Sale",
    submittedBy: license.submittedBy,
    rows,
  });
}
