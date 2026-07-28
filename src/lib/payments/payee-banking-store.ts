/**
 * src/lib/payments/payee-banking-store.ts — SLICE 80
 *
 * Server-side persistence for the payee banking vault (vendor_bank_details,
 * migration 0143). Routing/account numbers are envelope-encrypted at rest
 * (at-rest-crypto S-10) and decrypted ONLY here — this module is the single
 * read path for vendor banking, exactly like listEmployeeBanking() is for
 * employees. Nothing else may select these columns.
 *
 * No-op-safe pre-0143: every read catches the missing-table error (42P01)
 * and reports { tableReady: false } so the UI can show a friendly
 * "apply migration 0143" banner instead of crashing, and Accounts Payable
 * keeps its legacy manual entry until the vault exists.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { decryptSecret, encryptSecret } from "@/lib/security/at-rest-crypto";

export type VendorBankRecord = {
  id: string;
  vendor_id: string;
  vendor_name: string;
  bank_name: string;
  /** DECRYPTED routing number (server-only). */
  routing: string;
  /** DECRYPTED account number (server-only). */
  account_number: string;
  account_type: "checking" | "savings";
  status: "active" | "on_hold";
  verified_at: string | null;
  verified_note: string | null;
  notes: string | null;
  updated_at: string;
};

type RawRow = {
  id: string;
  vendor_id: string;
  vendor_name: string;
  bank_name: string;
  bank_routing: string;
  bank_account_number: string;
  bank_account_type: "checking" | "savings";
  status: "active" | "on_hold";
  verified_at: string | null;
  verified_note: string | null;
  notes: string | null;
  updated_at: string;
};

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    /relation .* does not exist|could not find the table/i.test(error.message ?? "")
  );
}

function decode(r: RawRow): VendorBankRecord {
  return {
    id: r.id,
    vendor_id: r.vendor_id,
    vendor_name: r.vendor_name,
    bank_name: r.bank_name,
    routing: r.bank_routing ? decryptSecret(r.bank_routing) : "",
    account_number: r.bank_account_number ? decryptSecret(r.bank_account_number) : "",
    account_type: r.bank_account_type,
    status: r.status,
    verified_at: r.verified_at,
    verified_note: r.verified_note,
    notes: r.notes,
    updated_at: r.updated_at,
  };
}

const COLS =
  "id,vendor_id,vendor_name,bank_name,bank_routing,bank_account_number,bank_account_type,status,verified_at,verified_note,notes,updated_at";

/**
 * All vault records + whether the table exists yet (pre-0143 probe). The ONLY
 * list read path for vendor banking.
 */
export async function listVendorBankDetails(): Promise<{
  tableReady: boolean;
  records: VendorBankRecord[];
}> {
  if (!isSupabaseServiceConfigured) return { tableReady: false, records: [] };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("vendor_bank_details")
    .select(COLS)
    .order("vendor_name", { ascending: true });
  if (error) {
    if (isMissingTable(error)) return { tableReady: false, records: [] };
    throw new Error(`vendor_bank_details read failed: ${error.message}`);
  }
  return { tableReady: true, records: ((data as RawRow[] | null) ?? []).map(decode) };
}

/** One vendor's vault record (payment-time resolution). Null = none on file. */
export async function getVendorBankDetails(
  vendorId: string,
): Promise<{ tableReady: boolean; record: VendorBankRecord | null }> {
  if (!isSupabaseServiceConfigured) return { tableReady: false, record: null };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("vendor_bank_details")
    .select(COLS)
    .eq("vendor_id", vendorId)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return { tableReady: false, record: null };
    throw new Error(`vendor_bank_details read failed: ${error.message}`);
  }
  return { tableReady: true, record: data ? decode(data as RawRow) : null };
}

/**
 * Create or update a vendor's vault record (upsert on vendor_id — one row per
 * vendor by design). Values arrive VALIDATED (payee-banking-core) and are
 * encrypted here before storage. Returns the previous decrypted record (for
 * the caller's audit diff) and the new id.
 */
export async function saveVendorBankDetails(params: {
  vendorId: string;
  vendorName: string;
  bankName: string;
  routing: string;
  accountNumber: string;
  accountType: "checking" | "savings";
  notes: string | null;
  actorId: string | null;
}): Promise<{ ok: true; before: VendorBankRecord | null } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  const admin = createSupabaseAdminClient();
  const existing = await getVendorBankDetails(params.vendorId);
  if (!existing.tableReady) {
    return { ok: false, error: "The banking vault table is not ready — apply migration 0143 first." };
  }
  const { error } = await admin.from("vendor_bank_details").upsert(
    {
      vendor_id: params.vendorId,
      vendor_name: params.vendorName,
      bank_name: params.bankName,
      bank_routing: encryptSecret(params.routing),
      bank_account_number: encryptSecret(params.accountNumber),
      bank_account_type: params.accountType,
      notes: params.notes,
      ...(existing.record ? { updated_by: params.actorId } : { created_by: params.actorId, updated_by: params.actorId }),
    },
    { onConflict: "vendor_id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, before: existing.record };
}

/**
 * Flip a record between active and on_hold (the out-of-band-verification
 * freeze), or stamp it verified. Small targeted updates so the audit caller
 * can describe exactly what changed.
 */
export async function setVendorBankStatus(params: {
  vendorId: string;
  status: "active" | "on_hold";
  actorId: string | null;
}): Promise<{ ok: true; before: VendorBankRecord | null } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  const admin = createSupabaseAdminClient();
  const existing = await getVendorBankDetails(params.vendorId);
  if (!existing.tableReady) return { ok: false, error: "The banking vault table is not ready — apply migration 0143 first." };
  if (!existing.record) return { ok: false, error: "No banking on file for that vendor." };
  const { error } = await admin
    .from("vendor_bank_details")
    .update({ status: params.status, updated_by: params.actorId })
    .eq("vendor_id", params.vendorId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, before: existing.record };
}

/** Record that the owner verified the details with the vendor out-of-band. */
export async function markVendorBankVerified(params: {
  vendorId: string;
  note: string;
  actorId: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("vendor_bank_details")
    .update({
      verified_at: new Date().toISOString(),
      verified_note: params.note || null,
      updated_by: params.actorId,
    })
    .eq("vendor_id", params.vendorId);
  if (error) {
    if (isMissingTable(error)) return { ok: false, error: "The banking vault table is not ready — apply migration 0143 first." };
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Remove a vendor's banking from the vault entirely (rare; audited by caller). */
export async function deleteVendorBankDetails(params: {
  vendorId: string;
}): Promise<{ ok: true; before: VendorBankRecord | null } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  const admin = createSupabaseAdminClient();
  const existing = await getVendorBankDetails(params.vendorId);
  if (!existing.tableReady) return { ok: false, error: "The banking vault table is not ready — apply migration 0143 first." };
  if (!existing.record) return { ok: false, error: "No banking on file for that vendor." };
  const { error } = await admin.from("vendor_bank_details").delete().eq("vendor_id", params.vendorId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, before: existing.record };
}
