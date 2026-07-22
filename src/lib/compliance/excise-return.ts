/**
 * src/lib/compliance/excise-return.ts  (Run 6 / Slice 32)
 *
 * Builds the WSLCB Cannabis Retailer Sales & Excise Tax return (FORM LIQ-1295)
 * as a filled .xlsx, aggregating the month's completed cannabis sales (pretax)
 * and the exempt medical sales. The official template ships in
 * ./templates/LIQ-1295-template.xlsx; we fill only the white input cells with
 * exceljs (formulas in the yellow cells recompute on open).
 *
 * Cell map (verified against LIQ-1295 R 7.24):
 *   E9 license number · E10 trade name · E11 location address · E12 city
 *   O10 month · O12 year · L14 revised(Yes/No) · L15 no-sales · L16 final
 *   S20 Box1 (cannabis sales) · S21 Box2 (less medical, negative)
 *   S25 Box6 (additional excise) · S28 Box8 · S29 Box9
 *   Q39 phone · S39 email
 */
import "server-only";
import path from "node:path";
import ExcelJS from "exceljs";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  aggregateBox1Lines,
  computeExciseReturn,
  exciseDueDate,
  monthRange,
  type Box1Line,
  type ExciseReturnBoxes,
} from "@/lib/compliance/excise-return-core";
import { chunkedIn, pagedAll } from "@/lib/supabase/chunked-in";
import { getTaxSettings, getCannabisCategorySet, isCannabisCategory } from "@/lib/reports/tax";
import { buildCategoryLookup } from "@/lib/reports/wa-tax";

const TEMPLATE_PATH = path.join(
  process.cwd(),
  "src",
  "lib",
  "compliance",
  "templates",
  "LIQ-1295-template.xlsx",
);

export type ExciseReturnIdentity = {
  licenseNumber: string;
  tradeName: string;
  locationAddress: string;
  city: string;
  phone: string;
  email: string;
};

export type ExciseReturnData = {
  identity: ExciseReturnIdentity;
  boxes: ExciseReturnBoxes;
  dueDate: string;
  /** Number of completed orders aggregated. */
  orderCount: number;
  /** Number of exempt medical sale records aggregated. */
  exemptRecordCount: number;
  /**
   * Pre-tax non-cannabis (merch/accessory) sales EXCLUDED from Box 1 (GW-014),
   * minor units. Informational — shown so the owner can reconcile Box 1
   * against the wa-tax report's cannabis-only base.
   */
  nonCannabisExcludedMinor: number;
  warnings: string[];
  /** LIQ-1295 Yes/No flags (default all false). */
  flags?: { isRevised: boolean; isNoSales: boolean; isFinal: boolean };
};

/** Load the reporting identity from license_settings. */
export async function getExciseIdentity(): Promise<ExciseReturnIdentity> {
  const fallback: ExciseReturnIdentity = {
    licenseNumber: "",
    tradeName: "",
    locationAddress: "",
    city: "",
    phone: "",
    email: "",
  };
  if (!isSupabaseServiceConfigured) return fallback;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("license_settings")
    .select("license_number, submitted_by, trade_name, location_address, city, contact_phone, contact_email")
    .eq("id", true)
    .maybeSingle();
  if (!data) return fallback;
  const d = data as Record<string, string | null>;
  return {
    licenseNumber: (d.license_number ?? "").trim(),
    tradeName: (d.trade_name ?? d.submitted_by ?? "").trim(),
    locationAddress: (d.location_address ?? "").trim(),
    city: (d.city ?? "").trim(),
    phone: (d.contact_phone ?? "").trim(),
    email: (d.contact_email ?? "").trim(),
  };
}

/**
 * Aggregate the month's data and compute the boxes. Pulls completed orders'
 * pretax subtotal (Box 1) and the exempt medical sales (Box 2 magnitude).
 */
export async function computeExciseReturnForMonth(
  month: number,
  year: number,
  overrides?: {
    additionalExciseCollectedMinor?: number;
    assessedPenaltyMinor?: number;
    approvedCreditsMinor?: number;
    /** Override the live Box 1 pretax sales (MINOR units) — e.g. corrected POS total. */
    cannabisSalesMinorOverride?: number;
    /** Override the live Box 2 exempt medical magnitude (MINOR units, positive). */
    exemptMedicalSalesMinorOverride?: number;
  },
): Promise<ExciseReturnData> {
  const identity = await getExciseIdentity();
  const warnings: string[] = [];
  if (!identity.licenseNumber) warnings.push("License number is not set — fill it in on the Compliance/Accounting settings.");

  let cannabisSalesMinor = 0;
  let nonCannabisExcludedMinor = 0;
  let exemptMedicalSalesMinor = 0;
  let orderCount = 0;
  let exemptRecordCount = 0;

  if (isSupabaseServiceConfigured) {
    const admin = createSupabaseAdminClient();
    // GW-013: [from, to) are the UTC instants of PACIFIC month boundaries —
    // the same period basis as the wa-tax report and CCRS Sale.csv
    // (docs/PERIOD_BASIS.md), so the three filings reconcile at month edges.
    const { fromISO, toISO } = monthRange(month, year);

    // Box 1 — Σ pre-tax CANNABIS line bases over the month's completed orders
    // (GW-014). The order-header subtotal sums EVERY line (merch and
    // accessories included), which would put non-cannabis revenue under the
    // 37% excise — so Box 1 is built from ORDER LINES, classified with the
    // same category rules and backed out with the same shared GW-010 divisor
    // the wa-tax report uses.
    type OrderRow = { id: string; completed_at: string | null; placed_at: string };
    const orders = await pagedAll<OrderRow>(async (from, to) => {
      const { data, error } = await admin
        .from("orders")
        .select("id, completed_at, placed_at, status")
        .eq("status", "completed")
        // completed_at basis with a placed_at fallback for legacy completed
        // orders that predate the completed_at column (docs/PERIOD_BASIS.md).
        .or(
          `and(completed_at.gte.${fromISO},completed_at.lt.${toISO}),and(completed_at.is.null,placed_at.gte.${fromISO},placed_at.lt.${toISO})`,
        )
        .order("id", { ascending: true })
        .range(from, to);
      if (error) throw new Error(error.message);
      return (data as OrderRow[] | null) ?? [];
    }).catch((e: Error) => {
      warnings.push(`Could not load orders: ${e.message}`);
      return null;
    });

    // Box 2 — exempt medical sales in the month (by sale_date, a Pacific
    // calendar date — the Pacific-anchored instants slice to the right labels).
    const fromDate = fromISO.slice(0, 10);
    const toDate = toISO.slice(0, 10); // exclusive upper bound (1st of next month)

    if (orders && orders.length > 0) {
      orderCount = orders.length;
      const orderIds = orders.map((o) => o.id);

      const [taxSettings, cannabisSet, categoryLookup] = await Promise.all([
        getTaxSettings().catch(() => null),
        getCannabisCategorySet(),
        buildCategoryLookup(admin),
      ]);
      const exciseRateBps = taxSettings?.exciseRateBps ?? 3700;
      const combinedSalesRateBps =
        (taxSettings?.stateSalesRateBps ?? 650) + (taxSettings?.localSalesRateBps ?? 280);

      // Per-line WAC 314-55-090(2) exemptions — they change the back-out rate
      // (an exempted tax was never inside the stored price). Same
      // (order_id, product_sku) join as wa-tax / ccrs-sales.
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
            .select("order_id, product_sku, sales_tax_exempt, excise_tax_exempt, sale_date, id")
            .gte("sale_date", fromDate)
            .lt("sale_date", toDate)
            .order("id", { ascending: true })
            .range(from, to);
          return (data as ExemptRow[] | null) ?? [];
        }).catch(() => []);
        for (const r of exemptRows) {
          if (!r.order_id || !r.product_sku) continue;
          const key = `${r.order_id}|${r.product_sku}`;
          const prev = exemptByOrderSku.get(key);
          exemptByOrderSku.set(key, {
            salesExempt: (prev?.salesExempt ?? false) || r.sales_tax_exempt === true,
            exciseExempt: (prev?.exciseExempt ?? false) || r.excise_tax_exempt === true,
          });
        }
      }

      // S-7: chunked + paginated — every line of every order, no row caps.
      type LineRow = {
        order_id: string;
        product_id: string | null;
        quantity: number;
        price_minor_units: number;
        category: string | null;
      };
      const lines = await chunkedIn<string, LineRow>(orderIds, async (chunk, from, to) => {
        const { data, error } = await admin
          .from("order_lines")
          .select("order_id, product_id, quantity, price_minor_units, category")
          .in("order_id", chunk)
          .order("id", { ascending: true })
          .range(from, to);
        if (error) throw new Error(error.message);
        return (data as LineRow[] | null) ?? [];
      }).catch((e: Error) => {
        warnings.push(`Could not load order lines: ${e.message}`);
        return null;
      });

      if (lines) {
        const box1Lines: Box1Line[] = lines.map((l) => {
          // Category: menu snapshot first, then the line's own placement-time
          // snapshot (covers keypad/custom lines) — the ccrs-sales fallback
          // order. An unknown category is conservatively CANNABIS (excise
          // charged / reported), matching isCannabisCategory's own default.
          const category =
            (l.product_id ? categoryLookup.get(l.product_id)?.category : "") || l.category?.trim() || "";
          const exempt = l.product_id ? exemptByOrderSku.get(`${l.order_id}|${l.product_id}`) : undefined;
          return {
            unitPriceMinorUnits: l.price_minor_units ?? 0,
            quantity: l.quantity ?? 0,
            isCannabis: isCannabisCategory(category, cannabisSet),
            salesExempt: exempt?.salesExempt === true,
            exciseExempt: exempt?.exciseExempt === true,
          };
        });
        const agg = aggregateBox1Lines(box1Lines, { combinedSalesRateBps, exciseRateBps });
        cannabisSalesMinor = agg.cannabisSalesMinor;
        nonCannabisExcludedMinor = agg.nonCannabisSalesMinor;
        if (agg.nonCannabisSalesMinor > 0) {
          warnings.push(
            `Non-cannabis (merch/accessory) sales of $${(agg.nonCannabisSalesMinor / 100).toFixed(2)} were excluded from Box 1 — the 37% excise applies to cannabis products only.`,
          );
        }
      }
    }
    const { data: exempt, error: exErr } = await admin
      .from("medical_exempt_sales")
      .select("sales_price_minor, sale_date")
      .gte("sale_date", fromDate)
      .lt("sale_date", toDate);
    if (exErr) {
      warnings.push(`Could not load exempt medical sales: ${exErr.message}`);
    } else {
      const rows = (exempt as { sales_price_minor: number | null }[] | null) ?? [];
      exemptRecordCount = rows.length;
      exemptMedicalSalesMinor = rows.reduce((a, r) => a + (r.sales_price_minor ?? 0), 0);
    }
  }

  // Manual overrides for Box 1 / Box 2 win over the live-aggregated figures
  // (used when an employee corrects the return against a POS report or files a
  // revised return). A defined override replaces the computed value entirely.
  const effectiveCannabisSalesMinor =
    overrides?.cannabisSalesMinorOverride != null ? overrides.cannabisSalesMinorOverride : cannabisSalesMinor;
  const effectiveExemptMedicalSalesMinor =
    overrides?.exemptMedicalSalesMinorOverride != null
      ? overrides.exemptMedicalSalesMinorOverride
      : exemptMedicalSalesMinor;
  if (overrides?.cannabisSalesMinorOverride != null) {
    warnings.push("Box 1 was manually overridden — it does not match the live completed-sales total.");
  }
  if (overrides?.exemptMedicalSalesMinorOverride != null) {
    warnings.push("Box 2 (medical exempt) was manually overridden — it does not match the live exempt-sales total.");
  }

  const boxes = computeExciseReturn({
    month,
    year,
    cannabisSalesMinor: effectiveCannabisSalesMinor,
    exemptMedicalSalesMinor: effectiveExemptMedicalSalesMinor,
    additionalExciseCollectedMinor: overrides?.additionalExciseCollectedMinor,
    assessedPenaltyMinor: overrides?.assessedPenaltyMinor,
    approvedCreditsMinor: overrides?.approvedCreditsMinor,
  });

  if (!identity.email) warnings.push("Contact e-mail is not set — add it so the form's signature block is complete.");
  if (boxes.noSales) warnings.push("No cannabis sales found for this month — the form will be marked as a no-sales report.");

  return {
    identity,
    boxes,
    dueDate: exciseDueDate(month, year),
    orderCount,
    exemptRecordCount,
    nonCannabisExcludedMinor,
    warnings,
  };
}

/** Build the filled LIQ-1295 .xlsx as a Buffer. */
export async function buildLiq1295Xlsx(data: ExciseReturnData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE_PATH);
  const ws = wb.getWorksheet("LIQ1295") ?? wb.worksheets[0];

  const { identity, boxes } = data;

  ws.getCell("E9").value = identity.licenseNumber;
  ws.getCell("E10").value = identity.tradeName;
  ws.getCell("E11").value = identity.locationAddress;
  ws.getCell("E12").value = identity.city;
  ws.getCell("O10").value = boxes.month;
  ws.getCell("O12").value = boxes.year;

  // Yes/No flags. A saved draft may set revised/final and force no-sales.
  const flags = data.flags;
  ws.getCell("L14").value = flags?.isRevised ? "Yes" : "No"; // revised
  ws.getCell("L15").value = flags?.isNoSales || boxes.noSales ? "Yes" : "No"; // no-sales
  ws.getCell("L16").value = flags?.isFinal ? "Yes" : "No"; // final

  // Box values (dollars). Formulas in S22/S24/S26/S30 recompute on open.
  ws.getCell("S20").value = boxes.box1_cannabisSales;
  ws.getCell("S21").value = boxes.box2_lessMedical; // negative
  ws.getCell("S25").value = boxes.box6_additionalExcise;
  ws.getCell("S28").value = boxes.box8_assessedPenalty;
  ws.getCell("S29").value = boxes.box9_approvedCredits; // negative

  // Signature block contact details.
  if (identity.phone) ws.getCell("Q39").value = identity.phone;
  if (identity.email) ws.getCell("S39").value = identity.email;

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}

/** File name: LIQ-1295_<license>_<YYYY>-<MM>.xlsx */
export function makeLiq1295FileName(licenseNumber: string, month: number, year: number): string {
  const lic = (licenseNumber || "LICENSE").replace(/[^A-Za-z0-9]/g, "");
  const mm = String(month).padStart(2, "0");
  return `LIQ-1295_${lic}_${year}-${mm}.xlsx`;
}

/** Log a generated/emailed return batch. */
export async function logExciseReturnBatch(
  data: ExciseReturnData,
  fileName: string,
  generatedBy: string | null,
): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  try {
    const admin = createSupabaseAdminClient();
    await admin.from("excise_return_batches").insert({
      report_month: data.boxes.month,
      report_year: data.boxes.year,
      file_name: fileName,
      cannabis_sales: data.boxes.box1_cannabisSales,
      exempt_medical_sales: Math.abs(data.boxes.box2_lessMedical),
      taxable_sales: data.boxes.box3_taxable,
      calculated_excise: data.boxes.box5_calculatedExcise,
      additional_excise: data.boxes.box6_additionalExcise,
      amount_to_pay: data.boxes.box10_amountToPay,
      no_sales: data.boxes.noSales,
      due_date: data.dueDate,
      status: "generated",
      generated_by: generatedBy,
      notes: data.warnings.join(" | ") || null,
    });
  } catch {
    // non-fatal
  }
}

export type ExciseReturnBatch = {
  id: string;
  report_month: number;
  report_year: number;
  file_name: string;
  amount_to_pay: number;
  no_sales: boolean;
  due_date: string | null;
  status: string;
  created_at: string;
};

export async function listExciseReturnBatches(limit = 12): Promise<ExciseReturnBatch[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("excise_return_batches")
    .select("id, report_month, report_year, file_name, amount_to_pay, no_sales, due_date, status, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as ExciseReturnBatch[] | null) ?? [];
}
