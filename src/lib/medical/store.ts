/**
 * src/lib/medical/store.ts
 *
 * Server-side data access for medical endorsement, recognition cards, and the
 * WAC 314-55-090(2) excise-exempt sale records. Mirrors migration 0040.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  type RecognitionCard,
  type FormChecklist,
  type MedTaxSettings,
  DEFAULT_MED_TAX_SETTINGS,
  cardValidity,
} from "@/lib/medical/tax";
import { validateAuthorizationIssuance } from "@/lib/medical/medical-authorization-core";
import { verifyExemptSaleRecord } from "@/lib/medical/exempt-sale-record-core";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------
export type AuthorizationRow = {
  id: string;
  customer_id: string;
  authorization_id: string | null;
  unique_patient_identifier: string | null;
  holder_type: "patient" | "designated_provider";
  issued_on: string | null;
  effective_on: string | null;
  expires_on: string | null;
  in_doh_database: boolean;
  status: string;
  form_complete_signed: boolean;
  tamper_resistant_verified: boolean;
  identity_verified: boolean;
  embossed_seal_verified: boolean;
  mcr_validated_at: string | null;
  notes: string | null;
  form_scan_path: string | null;
  form_scan_filename: string | null;
  form_scan_bytes: number | null;
  form_scan_uploaded_at: string | null;
  card_printed_at: string | null;
};

export type ExemptSaleRow = {
  id: string;
  order_id: string | null;
  customer_id: string | null;
  sale_date: string;
  unique_patient_identifier: string;
  card_effective_on: string | null;
  card_expires_on: string | null;
  product_sku: string;
  product_name: string | null;
  sales_price_minor: number;
  sales_tax_exempt: boolean;
  excise_tax_exempt: boolean;
  excise_amount_exempt_minor: number;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Endorsement config
// ---------------------------------------------------------------------------
export async function getMedTaxSettings(): Promise<MedTaxSettings> {
  if (!isSupabaseServiceConfigured) return DEFAULT_MED_TAX_SETTINGS;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("medical_endorsement_config")
    .select("is_medically_endorsed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    ...DEFAULT_MED_TAX_SETTINGS,
    medicallyEndorsed: data ? Boolean(data.is_medically_endorsed) : DEFAULT_MED_TAX_SETTINGS.medicallyEndorsed,
  };
}

export async function getEndorsementConfig(): Promise<{
  isMedicallyEndorsed: boolean;
  endorsementNumber: string | null;
  exciseExemptionUntil: string;
} | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("medical_endorsement_config")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    isMedicallyEndorsed: Boolean(data.is_medically_endorsed),
    endorsementNumber: (data.endorsement_number as string | null) ?? null,
    exciseExemptionUntil: String(data.excise_exemption_until),
  };
}

// ---------------------------------------------------------------------------
// Recognition cards (authorizations)
// ---------------------------------------------------------------------------
export async function listAuthorizations(customerId: string): Promise<AuthorizationRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("patient_authorizations")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  return (data as AuthorizationRow[] | null) ?? [];
}

/** Recent authorizations across ALL customers (for the intake queue). */
export type AuthorizationWithCustomer = AuthorizationRow & {
  customer_name: string | null;
  created_at: string;
};

export async function listRecentAuthorizations(limit = 25): Promise<AuthorizationWithCustomer[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("patient_authorizations")
    .select("*, customers(first_name, last_name)")
    .order("created_at", { ascending: false })
    .limit(limit);
  const rows =
    (data as
      | (AuthorizationRow & {
          created_at: string;
          customers?: { first_name: string | null; last_name: string | null } | null;
        })[]
      | null) ?? [];
  return rows.map((r) => ({
    ...r,
    customer_name: r.customers
      ? `${r.customers.first_name ?? ""} ${r.customers.last_name ?? ""}`.trim() || null
      : null,
  }));
}

export async function getActiveCard(customerId: string): Promise<AuthorizationRow | null> {
  const all = await listAuthorizations(customerId);
  const active = all.find((a) => a.status === "active");
  return active ?? null;
}

/** Convert an authorization row into the pure-engine RecognitionCard shape. */
export function toRecognitionCard(row: AuthorizationRow): RecognitionCard {
  return {
    uniquePatientIdentifier: row.unique_patient_identifier,
    effectiveOn: row.effective_on ?? row.issued_on,
    expiresOn: row.expires_on,
    inDohDatabase: row.in_doh_database,
    status: row.status,
  };
}

/** Is this customer a valid, in-database medical patient right now? */
export async function customerMedicalStatus(
  customerId: string,
  onDate: Date = new Date(),
): Promise<{ carded: boolean; card: AuthorizationRow | null; reason: string | null }> {
  const card = await getActiveCard(customerId);
  if (!card) return { carded: false, card: null, reason: "No active recognition card" };
  const v = cardValidity(toRecognitionCard(card), onDate);
  return { carded: v.valid, card, reason: v.reason };
}

export type AuthorizationInput = {
  customerId: string;
  authorizationId?: string | null;
  uniquePatientIdentifier?: string | null;
  holderType: "patient" | "designated_provider";
  effectiveOn?: string | null;
  expiresOn?: string | null;
  inDohDatabase: boolean;
  checklist: FormChecklist;
  notes?: string | null;
};

/**
 * Create a recognition card. Enforces the DOH 608-048 form checklist: all four
 * checks must pass before a card may be issued.
 */
export async function createAuthorization(
  input: AuthorizationInput,
  actorId: string | null,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase not configured" };
  // Slice 100 — full issuance guardrail: the DOH 608-048 four checks PLUS the
  // data-integrity rules (UPID required when in-MCR, effective<=expiration, not
  // already expired, valid holder type). Blocks bad cards with precise reasons.
  const issuance = validateAuthorizationIssuance({
    uniquePatientIdentifier: input.uniquePatientIdentifier ?? null,
    holderType: input.holderType,
    effectiveOn: input.effectiveOn ?? null,
    expiresOn: input.expiresOn ?? null,
    inDohDatabase: input.inDohDatabase,
    checklist: input.checklist,
  });
  if (!issuance.ok) {
    return { ok: false, error: issuance.errors.join(" ") };
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("patient_authorizations")
    .insert({
      customer_id: input.customerId,
      authorization_id: input.authorizationId ?? null,
      unique_patient_identifier: input.uniquePatientIdentifier ?? null,
      holder_type: input.holderType,
      effective_on: input.effectiveOn ?? null,
      issued_on: input.effectiveOn ?? null,
      expires_on: input.expiresOn ?? null,
      in_doh_database: input.inDohDatabase,
      status: "active",
      form_complete_signed: input.checklist.formCompleteSigned,
      tamper_resistant_verified: input.checklist.tamperResistantVerified,
      identity_verified: input.checklist.identityVerified,
      embossed_seal_verified: input.checklist.embossedSealVerified,
      mcr_validated_at: input.inDohDatabase ? new Date().toISOString() : null,
      mcr_validated_by: input.inDohDatabase ? actorId : null,
      notes: input.notes ?? null,
      created_by: actorId,
      updated_by: actorId,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create card" };

  // Mark the customer as a medical patient.
  await admin.from("customers").update({ is_medical_patient: true }).eq("id", input.customerId);
  return { ok: true, id: (data as { id: string }).id };
}

/**
 * Slice 85 — attach a SCANNED authorization form (from the Canon PIXMA TS3522)
 * to an authorization row. The bytes are uploaded to the private `medical-forms`
 * bucket; we record the path/filename/size + who/when for the audit trail.
 */
export async function attachFormScan(
  authorizationId: string,
  scan: { bytes: ArrayBuffer; filename: string; contentType: string },
  actorId: string | null,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase not configured" };
  const admin = createSupabaseAdminClient();
  const safeName = scan.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "scan";
  const path = `${authorizationId}/${Date.now()}_${safeName}`;
  const { error: upErr } = await admin.storage
    .from("medical-forms")
    .upload(path, new Uint8Array(scan.bytes), {
      contentType: scan.contentType || "application/octet-stream",
      upsert: false,
    });
  if (upErr) return { ok: false, error: upErr.message };
  const { error } = await admin
    .from("patient_authorizations")
    .update({
      form_scan_path: path,
      form_scan_filename: scan.filename,
      form_scan_bytes: scan.bytes.byteLength,
      form_scan_uploaded_at: new Date().toISOString(),
      form_scan_uploaded_by: actorId,
      updated_by: actorId,
    })
    .eq("id", authorizationId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, path };
}

/** A short-lived signed URL to view a scanned authorization form (staff only). */
export async function signedFormScanUrl(path: string, expiresInSec = 300): Promise<string | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.storage.from("medical-forms").createSignedUrl(path, expiresInSec);
  return data?.signedUrl ?? null;
}

/** Stamp when the physical recognition card was printed (for laminating). */
export async function markCardPrinted(
  authorizationId: string,
  actorId: string | null,
): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  await admin
    .from("patient_authorizations")
    .update({ card_printed_at: new Date().toISOString(), updated_by: actorId })
    .eq("id", authorizationId);
}

export async function setAuthorizationStatus(
  id: string,
  status: "active" | "expired" | "revoked",
  actorId: string | null,
): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  await admin
    .from("patient_authorizations")
    .update({ status, updated_by: actorId })
    .eq("id", id);
}

/** Record a manual MCR validation (consultant looked up the card in the DB). */
export async function recordMcrValidation(id: string, actorId: string | null): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  await admin
    .from("patient_authorizations")
    .update({ in_doh_database: true, mcr_validated_at: new Date().toISOString(), mcr_validated_by: actorId })
    .eq("id", id);
}

// ---------------------------------------------------------------------------
// Excise-exempt sale records (WAC 314-55-090(2)) — retain 5 years
// ---------------------------------------------------------------------------
export type ExemptSaleInput = {
  orderId?: string | null;
  customerId?: string | null;
  authorizationId?: string | null;
  uniquePatientIdentifier: string;
  cardEffectiveOn?: string | null;
  cardExpiresOn?: string | null;
  productSku: string;
  productName?: string | null;
  salesPriceMinor: number;
  salesTaxExempt: boolean;
  exciseTaxExempt: boolean;
  exciseAmountExemptMinor: number;
};

export async function recordExemptSale(
  input: ExemptSaleInput,
  actorId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase not configured" };
  // Slice 103 — WAC 314-55-090(2) completeness guardrail: an EXCISE-exempt sale
  // record must carry date + UPID + card effective/expiration + product + price
  // before we persist it (it must survive a 5-yr audit). Sales-tax-only exempt
  // rows (exciseTaxExempt === false) are not held to this ledger standard.
  const completeness = verifyExemptSaleRecord({
    saleDate: new Date().toISOString().slice(0, 10),
    uniquePatientIdentifier: input.uniquePatientIdentifier,
    cardEffectiveOn: input.cardEffectiveOn ?? null,
    cardExpiresOn: input.cardExpiresOn ?? null,
    productSku: input.productSku,
    productName: input.productName ?? null,
    salesPriceMinor: input.salesPriceMinor,
    exciseTaxExempt: input.exciseTaxExempt,
  });
  if (!completeness.ok) {
    return {
      ok: false,
      error: `Excise-exempt sale record is missing required WAC 314-55-090(2) field(s): ${completeness.missing.join(", ")}.`,
    };
  }
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("medical_exempt_sales").insert({
    order_id: input.orderId ?? null,
    customer_id: input.customerId ?? null,
    authorization_id: input.authorizationId ?? null,
    unique_patient_identifier: input.uniquePatientIdentifier,
    card_effective_on: input.cardEffectiveOn ?? null,
    card_expires_on: input.cardExpiresOn ?? null,
    product_sku: input.productSku,
    product_name: input.productName ?? null,
    sales_price_minor: input.salesPriceMinor,
    sales_tax_exempt: input.salesTaxExempt,
    excise_tax_exempt: input.exciseTaxExempt,
    excise_amount_exempt_minor: input.exciseAmountExemptMinor,
    recorded_by: actorId,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function listExemptSales(opts?: {
  from?: string;
  to?: string;
  limit?: number;
}): Promise<ExemptSaleRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  let q = admin.from("medical_exempt_sales").select("*").order("sale_date", { ascending: false });
  if (opts?.from) q = q.gte("sale_date", opts.from);
  if (opts?.to) q = q.lte("sale_date", opts.to);
  q = q.limit(opts?.limit ?? 200);
  const { data } = await q;
  return (data as ExemptSaleRow[] | null) ?? [];
}

export async function medicalSummary(): Promise<{
  patients: number;
  activeCards: number;
  exciseExemptedMinor: number;
}> {
  if (!isSupabaseServiceConfigured) return { patients: 0, activeCards: 0, exciseExemptedMinor: 0 };
  const admin = createSupabaseAdminClient();
  const [{ count: patients }, { count: activeCards }, { data: exempts }] = await Promise.all([
    admin.from("customers").select("id", { count: "exact", head: true }).eq("is_medical_patient", true),
    admin.from("patient_authorizations").select("id", { count: "exact", head: true }).eq("status", "active"),
    admin.from("medical_exempt_sales").select("excise_amount_exempt_minor"),
  ]);
  const exciseExemptedMinor = ((exempts as { excise_amount_exempt_minor: number }[] | null) ?? []).reduce(
    (acc, r) => acc + (r.excise_amount_exempt_minor ?? 0),
    0,
  );
  return { patients: patients ?? 0, activeCards: activeCards ?? 0, exciseExemptedMinor };
}
