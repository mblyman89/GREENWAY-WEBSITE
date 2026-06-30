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
  computeExciseReturn,
  exciseDueDate,
  monthRange,
  type ExciseReturnBoxes,
} from "@/lib/compliance/excise-return-core";

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
  warnings: string[];
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
  },
): Promise<ExciseReturnData> {
  const identity = await getExciseIdentity();
  const warnings: string[] = [];
  if (!identity.licenseNumber) warnings.push("License number is not set — fill it in on the Compliance/Accounting settings.");

  let cannabisSalesMinor = 0;
  let exemptMedicalSalesMinor = 0;
  let orderCount = 0;
  let exemptRecordCount = 0;

  if (isSupabaseServiceConfigured) {
    const admin = createSupabaseAdminClient();
    const { fromISO, toISO } = monthRange(month, year);

    // Box 1 — completed orders' pretax subtotal in the month.
    const { data: orders, error: ordErr } = await admin
      .from("orders")
      .select("subtotal_minor_units, completed_at, status")
      .eq("status", "completed")
      .gte("completed_at", fromISO)
      .lt("completed_at", toISO);
    if (ordErr) {
      warnings.push(`Could not load orders: ${ordErr.message}`);
    } else {
      const rows = (orders as { subtotal_minor_units: number | null }[] | null) ?? [];
      orderCount = rows.length;
      cannabisSalesMinor = rows.reduce((a, r) => a + (r.subtotal_minor_units ?? 0), 0);
    }

    // Box 2 — exempt medical sales in the month (by sale_date, YYYY-MM-DD).
    const fromDate = fromISO.slice(0, 10);
    const toDate = toISO.slice(0, 10); // exclusive upper bound (1st of next month)
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

  const boxes = computeExciseReturn({
    month,
    year,
    cannabisSalesMinor,
    exemptMedicalSalesMinor,
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

  // Yes/No flags.
  ws.getCell("L14").value = "No"; // revised
  ws.getCell("L15").value = boxes.noSales ? "Yes" : "No"; // no-sales
  ws.getCell("L16").value = "No"; // final

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
