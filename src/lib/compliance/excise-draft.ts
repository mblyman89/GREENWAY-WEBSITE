/**
 * src/lib/compliance/excise-draft.ts  (Slice 55)
 *
 * Load/save the editable LIQ-1295 draft (excise_return_drafts) for a reporting
 * (month, year), and resolve the effective return by merging the saved draft's
 * overrides + flags + identity + payment reconciliation on top of the live
 * computed figures.
 *
 * All monetary DRAFT fields are stored in MINOR UNITS (cents). Box 2 and Box 9
 * magnitudes are stored positive (the sheet renders them negative).
 *
 * Server-only (bypasses RLS via the admin client for reads used in server
 * components; writes are still gated by requirePermission in the caller).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  computeExciseReturnForMonth,
  type ExciseReturnData,
  type ExciseReturnIdentity,
} from "@/lib/compliance/excise-return";

/** The raw saved draft row (all fields optional/nullable). */
export type ExciseReturnDraft = {
  id: string;
  report_month: number;
  report_year: number;
  license_number: string | null;
  trade_name: string | null;
  location_address: string | null;
  city: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  is_revised: boolean;
  is_no_sales: boolean;
  is_final: boolean;
  box1_cannabis_sales_minor: number | null;
  box2_less_medical_minor: number | null;
  box6_additional_excise_minor: number | null;
  box8_assessed_penalty_minor: number | null;
  box9_approved_credits_minor: number | null;
  notes: string | null;
  payment_method: string | null;
  payment_status: string;
  payment_confirmation: string | null;
  amount_paid_minor: number | null;
  paid_at: string | null;
  updated_at: string | null;
};

const DRAFT_COLUMNS =
  "id, report_month, report_year, license_number, trade_name, location_address, city, " +
  "contact_phone, contact_email, is_revised, is_no_sales, is_final, " +
  "box1_cannabis_sales_minor, box2_less_medical_minor, box6_additional_excise_minor, " +
  "box8_assessed_penalty_minor, box9_approved_credits_minor, notes, payment_method, " +
  "payment_status, payment_confirmation, amount_paid_minor, paid_at, updated_at";

/** Load the saved draft for a period, or null when none exists / no DB. */
export async function getExciseDraft(month: number, year: number): Promise<ExciseReturnDraft | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("excise_return_drafts")
    .select(DRAFT_COLUMNS)
    .eq("report_year", year)
    .eq("report_month", month)
    .maybeSingle();
  return (data as ExciseReturnDraft | null) ?? null;
}

/** The full set of editable inputs an employee can save. */
export type ExciseDraftInput = {
  month: number;
  year: number;
  // Header overrides (blank string clears the override → falls back to license_settings).
  licenseNumber?: string;
  tradeName?: string;
  locationAddress?: string;
  city?: string;
  contactPhone?: string;
  contactEmail?: string;
  // Flags.
  isRevised?: boolean;
  isNoSales?: boolean;
  isFinal?: boolean;
  // Box overrides (MINOR units; null clears → use computed/zero). Box2/Box9 magnitudes positive.
  box1CannabisSalesMinor?: number | null;
  box2LessMedicalMinor?: number | null;
  box6AdditionalExciseMinor?: number | null;
  box8AssessedPenaltyMinor?: number | null;
  box9ApprovedCreditsMinor?: number | null;
  notes?: string | null;
  // Payment reconciliation.
  paymentMethod?: string | null;
  paymentStatus?: string;
  paymentConfirmation?: string | null;
  amountPaidMinor?: number | null;
  paidAt?: string | null;
};

/** Upsert the draft for a period. Caller MUST enforce permission first. */
export async function saveExciseDraft(
  input: ExciseDraftInput,
  updatedBy: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();

  const trimOrNull = (v?: string) => {
    if (v == null) return null;
    const t = v.trim();
    return t === "" ? null : t;
  };

  const row = {
    report_month: input.month,
    report_year: input.year,
    license_number: trimOrNull(input.licenseNumber),
    trade_name: trimOrNull(input.tradeName),
    location_address: trimOrNull(input.locationAddress),
    city: trimOrNull(input.city),
    contact_phone: trimOrNull(input.contactPhone),
    contact_email: trimOrNull(input.contactEmail),
    is_revised: input.isRevised ?? false,
    is_no_sales: input.isNoSales ?? false,
    is_final: input.isFinal ?? false,
    box1_cannabis_sales_minor: input.box1CannabisSalesMinor ?? null,
    box2_less_medical_minor: input.box2LessMedicalMinor ?? null,
    box6_additional_excise_minor: input.box6AdditionalExciseMinor ?? null,
    box8_assessed_penalty_minor: input.box8AssessedPenaltyMinor ?? null,
    box9_approved_credits_minor: input.box9ApprovedCreditsMinor ?? null,
    notes: trimOrNull(input.notes ?? undefined),
    payment_method: trimOrNull(input.paymentMethod ?? undefined),
    payment_status: input.paymentStatus === "paid" ? "paid" : "unpaid",
    payment_confirmation: trimOrNull(input.paymentConfirmation ?? undefined),
    amount_paid_minor: input.amountPaidMinor ?? null,
    paid_at: input.paidAt ?? null,
    updated_by: updatedBy,
  };

  const { error } = await admin
    .from("excise_return_drafts")
    .upsert(row, { onConflict: "report_year,report_month" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Merge a saved draft's identity overrides onto the computed identity.
 * A non-null draft field wins; otherwise the license_settings value stands.
 */
function mergeIdentity(base: ExciseReturnIdentity, draft: ExciseReturnDraft | null): ExciseReturnIdentity {
  if (!draft) return base;
  return {
    licenseNumber: draft.license_number ?? base.licenseNumber,
    tradeName: draft.trade_name ?? base.tradeName,
    locationAddress: draft.location_address ?? base.locationAddress,
    city: draft.city ?? base.city,
    phone: draft.contact_phone ?? base.phone,
    email: draft.contact_email ?? base.email,
  };
}

/**
 * Resolve the effective return for a period: compute from live sales, then apply
 * the saved draft's box overrides (Box1/Box2/Box6/Box8/Box9), identity overrides,
 * and flags. Returns both the effective data and the raw draft (may be null).
 */
export async function resolveExciseReturn(
  month: number,
  year: number,
): Promise<{ data: ExciseReturnData; draft: ExciseReturnDraft | null }> {
  const draft = await getExciseDraft(month, year);

  // The compute function reads live sales for Box1/Box2 and accepts Box6/8/9
  // overrides. We pass the draft's Box6/8/9 overrides straight through.
  const computed = await computeExciseReturnForMonth(month, year, {
    additionalExciseCollectedMinor: draft?.box6_additional_excise_minor ?? undefined,
    assessedPenaltyMinor: draft?.box8_assessed_penalty_minor ?? undefined,
    approvedCreditsMinor: draft?.box9_approved_credits_minor ?? undefined,
    // Box1/Box2 overrides recompute the whole cascade inside the core.
    cannabisSalesMinorOverride: draft?.box1_cannabis_sales_minor ?? undefined,
    exemptMedicalSalesMinorOverride: draft?.box2_less_medical_minor ?? undefined,
  });

  const data: ExciseReturnData = {
    ...computed,
    identity: mergeIdentity(computed.identity, draft),
    flags: {
      isRevised: draft?.is_revised ?? false,
      isNoSales: draft?.is_no_sales ?? false,
      isFinal: draft?.is_final ?? false,
    },
  };

  // Apply the explicit no-sales flag if the employee set it.
  if (draft?.is_no_sales) {
    data.boxes = { ...data.boxes, noSales: true };
  }

  return { data, draft };
}
