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
import { planVaultSave } from "@/lib/payments/payee-banking-core";

export type VendorBankStatus = "active" | "on_hold" | "revoked" | "archived";

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
  status: VendorBankStatus;
  verified_at: string | null;
  verified_note: string | null;
  notes: string | null;
  updated_at: string;
  // R39 S3 (0259). All null before 0259 is applied (controlsReady: false).
  hold_reason: string | null;
  change_entered_by: string | null;
  change_entered_at: string | null;
  released_by: string | null;
  released_at: string | null;
  release_mode: "dual" | "solo" | null;
  release_callback_method: "phone" | "in_person" | null;
  release_callback_note: string | null;
  release_reason: string | null;
  archived_at: string | null;
  archived_by: string | null;
  archive_reason: string | null;
};

type RawRow = {
  id: string;
  vendor_id: string;
  vendor_name: string;
  bank_name: string;
  bank_routing: string;
  bank_account_number: string;
  bank_account_type: "checking" | "savings";
  status: VendorBankStatus;
  verified_at: string | null;
  verified_note: string | null;
  notes: string | null;
  updated_at: string;
} & Partial<Record<(typeof CONTROL_COLS)[number], string | null>>;

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /relation .* does not exist|could not find the table/i.test(error.message ?? "")
  );
}

/**
 * 42703 = Postgres undefined column; PGRST204 = PostgREST "column ... not
 * found" (Supabase docs, PostgREST error codes). Either means 0259 is not
 * applied yet.
 */
export function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    /column .* does not exist|could not find the .* column/i.test(error.message ?? "")
  );
}

const CONTROL_COLS = [
  "hold_reason",
  "change_entered_by",
  "change_entered_at",
  "released_by",
  "released_at",
  "release_mode",
  "release_callback_method",
  "release_callback_note",
  "release_reason",
  "archived_at",
  "archived_by",
  "archive_reason",
] as const;

function decode(r: RawRow): VendorBankRecord {
  const c = (k: (typeof CONTROL_COLS)[number]) => (r[k] ?? null) as string | null;
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
    hold_reason: c("hold_reason"),
    change_entered_by: c("change_entered_by"),
    change_entered_at: c("change_entered_at"),
    released_by: c("released_by"),
    released_at: c("released_at"),
    release_mode: c("release_mode") as VendorBankRecord["release_mode"],
    release_callback_method: c("release_callback_method") as VendorBankRecord["release_callback_method"],
    release_callback_note: c("release_callback_note"),
    release_reason: c("release_reason"),
    archived_at: c("archived_at"),
    archived_by: c("archived_by"),
    archive_reason: c("archive_reason"),
  };
}

const BASE_COLS =
  "id,vendor_id,vendor_name,bank_name,bank_routing,bank_account_number,bank_account_type,status,verified_at,verified_note,notes,updated_at";
const FULL_COLS = `${BASE_COLS},${CONTROL_COLS.join(",")}`;

type ReadState = { tableReady: boolean; controlsReady: boolean };

/**
 * Select with the 0259 columns; if they are missing, re-select the base
 * columns and REPORT controlsReady: false so the screen can say so (rule 48:
 * the fallback is visible, never silent).
 */
async function selectRows(vendorId: string | null): Promise<ReadState & { rows: RawRow[] }> {
  const admin = createSupabaseAdminClient();
  for (const [cols, controlsReady] of [
    [FULL_COLS, true],
    [BASE_COLS, false],
  ] as const) {
    const base = admin.from("vendor_bank_details").select(cols);
    const q = vendorId ? base.eq("vendor_id", vendorId) : base.order("vendor_name", { ascending: true });
    const { data, error } = await q;
    if (!error) return { tableReady: true, controlsReady, rows: (data as unknown as RawRow[] | null) ?? [] };
    if (isMissingTable(error)) return { tableReady: false, controlsReady: false, rows: [] };
    if (controlsReady && isMissingColumn(error)) continue;
    throw new Error(`vendor_bank_details read failed: ${error.message}`);
  }
  // Unreachable: the base select either returns or throws above.
  throw new Error("vendor_bank_details read failed: no column set worked");
}

/**
 * All vault records + whether the table exists yet (pre-0143 probe) + whether
 * the 0259 change-control columns exist. The ONLY list read path for vendor
 * banking.
 */
export async function listVendorBankDetails(): Promise<ReadState & { records: VendorBankRecord[] }> {
  if (!isSupabaseServiceConfigured) return { tableReady: false, controlsReady: false, records: [] };
  const r = await selectRows(null);
  return { tableReady: r.tableReady, controlsReady: r.controlsReady, records: r.rows.map(decode) };
}

/** One vendor's vault record (payment-time resolution). Null = none on file. */
export async function getVendorBankDetails(
  vendorId: string,
): Promise<ReadState & { record: VendorBankRecord | null }> {
  if (!isSupabaseServiceConfigured) return { tableReady: false, controlsReady: false, record: null };
  const r = await selectRows(vendorId);
  if (r.rows.length > 1) throw new Error("vendor_bank_details: more than one row for a vendor (vendor_id must be unique).");
  return { tableReady: r.tableReady, controlsReady: r.controlsReady, record: r.rows[0] ? decode(r.rows[0]) : null };
}

const NOT_READY = "The banking vault table is not ready — apply migration 0143 first.";
const NEED_0259 = "One-time setup needed: apply migration 0259 (vendor vault change control) first.";

/**
 * Create or update a vendor's vault record (one row per vendor). Values
 * arrive VALIDATED (payee-banking-core).
 *
 * R39 S3: the decision is made on DECRYPTED values (planVaultSave). If the
 * routing, account and type are unchanged, the encrypted columns are NOT
 * rewritten (new ciphertext would look like a change to the 0259 trigger and
 * put the vendor on hold for editing a note). If they changed, the row goes
 * on hold here as well as in the database, so the rule holds before 0259 too.
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
}): Promise<
  | { ok: true; before: VendorBankRecord | null; plan: ReturnType<typeof planVaultSave>; controlsReady: boolean }
  | { ok: false; error: string }
> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  const admin = createSupabaseAdminClient();
  const existing = await getVendorBankDetails(params.vendorId);
  if (!existing.tableReady) return { ok: false, error: NOT_READY };
  const before = existing.record;
  const plan = planVaultSave(
    before ? { routing: before.routing, accountNumber: before.account_number, accountType: before.account_type, status: before.status } : null,
    { routing: params.routing, accountNumber: params.accountNumber, accountType: params.accountType },
  );
  // Archived / revoked banking with NEW numbers is re-enrolment: it goes on
  // hold below and must be released like new banking. Archived banking with
  // the SAME numbers keeps its status (re-open it with holdVendorBank).

  const labels = { vendor_name: params.vendorName, bank_name: params.bankName, notes: params.notes, updated_by: params.actorId };
  let error: { message: string } | null = null;
  if (!before) {
    ({ error } = await admin.from("vendor_bank_details").insert({
      vendor_id: params.vendorId,
      ...labels,
      bank_routing: encryptSecret(params.routing),
      bank_account_number: encryptSecret(params.accountNumber),
      bank_account_type: params.accountType,
      status: "on_hold",
      created_by: params.actorId,
      ...(existing.controlsReady ? { hold_reason: plan.holdReason } : {}),
    }));
  } else if (plan.writeBankColumns) {
    ({ error } = await admin
      .from("vendor_bank_details")
      .update({
        ...labels,
        bank_routing: encryptSecret(params.routing),
        bank_account_number: encryptSecret(params.accountNumber),
        bank_account_type: params.accountType,
        status: "on_hold",
        ...(existing.controlsReady ? { hold_reason: plan.holdReason } : {}),
      })
      .eq("vendor_id", params.vendorId));
  } else {
    ({ error } = await admin.from("vendor_bank_details").update(labels).eq("vendor_id", params.vendorId));
  }
  if (error) return { ok: false, error: error.message };
  return { ok: true, before, plan, controlsReady: existing.controlsReady };
}

/**
 * Put banking on hold (or re-open archived / revoked banking on hold). Always
 * allowed, because holding is the safe direction. The reason is stored when
 * 0259 is applied; before that it lives only in the audit log, and the result
 * says so.
 */
export async function holdVendorBank(params: {
  vendorId: string;
  reason: string;
  actorId: string | null;
}): Promise<{ ok: true; before: VendorBankRecord; reasonStored: boolean } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  const reason = params.reason.trim();
  if (!reason) return { ok: false, error: "Write why the banking is going on hold." };
  const existing = await getVendorBankDetails(params.vendorId);
  if (!existing.tableReady) return { ok: false, error: NOT_READY };
  if (!existing.record) return { ok: false, error: "No banking on file for that vendor." };
  if (existing.record.status === "on_hold") return { ok: false, error: "That banking is already on hold." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("vendor_bank_details")
    .update({ status: "on_hold", updated_by: params.actorId, ...(existing.controlsReady ? { hold_reason: reason } : {}) })
    .eq("vendor_id", params.vendorId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, before: existing.record, reasonStored: existing.controlsReady };
}

/**
 * Release a hold. The CALLER has already passed releaseVerdict(); this writes
 * the release record the 0259 trigger requires. Before 0259 the columns do
 * not exist, so only the status changes and the full release record goes in
 * the audit log (recordStored: false tells the caller).
 */
export async function releaseVendorBankHold(params: {
  vendorId: string;
  actorId: string;
  mode: "dual" | "solo";
  method: "phone" | "in_person";
  note: string;
  reason: string | null;
}): Promise<{ ok: true; before: VendorBankRecord; recordStored: boolean } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  const existing = await getVendorBankDetails(params.vendorId);
  if (!existing.tableReady) return { ok: false, error: NOT_READY };
  if (!existing.record) return { ok: false, error: "No banking on file for that vendor." };
  if (existing.record.status !== "on_hold") {
    return { ok: false, error: `Only banking that is on hold can be released (this is ${existing.record.status}).` };
  }
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("vendor_bank_details")
    .update({
      status: "active",
      updated_by: params.actorId,
      ...(existing.controlsReady
        ? {
            released_by: params.actorId,
            released_at: new Date().toISOString(),
            release_mode: params.mode,
            release_callback_method: params.method,
            release_callback_note: params.note,
            release_reason: params.reason,
          }
        : {}),
    })
    .eq("vendor_id", params.vendorId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, before: existing.record, recordStored: existing.controlsReady };
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
    if (isMissingTable(error)) return { ok: false, error: NOT_READY };
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Archive a vendor's banking (owner answer Q7: delete becomes archive). The
 * row and its history stay; payments are refused (canPayWithVaultRecord).
 * Needs 0259 for the reason column; the database refuses DELETE outright.
 */
export async function archiveVendorBankDetails(params: {
  vendorId: string;
  reason: string;
  actorId: string | null;
}): Promise<{ ok: true; before: VendorBankRecord } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  const reason = params.reason.trim();
  if (!reason) return { ok: false, error: "Write why this banking is being archived." };
  const existing = await getVendorBankDetails(params.vendorId);
  if (!existing.tableReady) return { ok: false, error: NOT_READY };
  if (!existing.controlsReady) return { ok: false, error: NEED_0259 };
  if (!existing.record) return { ok: false, error: "No banking on file for that vendor." };
  if (existing.record.status === "archived") return { ok: false, error: "That banking is already archived." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("vendor_bank_details")
    .update({
      status: "archived",
      archived_at: new Date().toISOString(),
      archived_by: params.actorId,
      archive_reason: reason,
      updated_by: params.actorId,
    })
    .eq("vendor_id", params.vendorId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, before: existing.record };
}

// ---------------------------------------------------------------------------
// Vendor contacts for the fraud callback (payee_contacts, 0258)
// ---------------------------------------------------------------------------

export type VendorContact = {
  id: string;
  kind: "phone" | "email";
  value: string;
  onFileSince: string;
  source: "existing_record" | "signed_form" | "in_person" | "onboarding";
};

/** Live (not retired) contacts for one vendor. tableReady false before 0258. */
export async function listVendorContacts(vendorId: string): Promise<{ tableReady: boolean; contacts: VendorContact[] }> {
  if (!isSupabaseServiceConfigured) return { tableReady: false, contacts: [] };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("payee_contacts")
    .select("id,contact_kind,value,on_file_since,source")
    .eq("payee_type", "vendor")
    .eq("vendor_id", vendorId)
    .is("retired_at", null)
    .order("on_file_since", { ascending: true });
  if (error) {
    if (isMissingTable(error)) return { tableReady: false, contacts: [] };
    throw new Error(`payee_contacts read failed: ${error.message}`);
  }
  return {
    tableReady: true,
    contacts: ((data as { id: string; contact_kind: VendorContact["kind"]; value: string; on_file_since: string; source: VendorContact["source"] }[] | null) ?? []).map(
      (r) => ({ id: r.id, kind: r.contact_kind, value: r.value, onFileSince: r.on_file_since, source: r.source }),
    ),
  };
}

/** All live vendor contacts (vault page), keyed by vendor id. */
export async function listAllVendorContacts(): Promise<{ tableReady: boolean; byVendor: Map<string, VendorContact[]> }> {
  const byVendor = new Map<string, VendorContact[]>();
  if (!isSupabaseServiceConfigured) return { tableReady: false, byVendor };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("payee_contacts")
    .select("id,vendor_id,contact_kind,value,on_file_since,source")
    .eq("payee_type", "vendor")
    .is("retired_at", null)
    .order("on_file_since", { ascending: true });
  if (error) {
    if (isMissingTable(error)) return { tableReady: false, byVendor };
    throw new Error(`payee_contacts read failed: ${error.message}`);
  }
  for (const r of (data as { id: string; vendor_id: string; contact_kind: VendorContact["kind"]; value: string; on_file_since: string; source: VendorContact["source"] }[] | null) ?? []) {
    const list = byVendor.get(r.vendor_id) ?? [];
    list.push({ id: r.id, kind: r.contact_kind, value: r.value, onFileSince: r.on_file_since, source: r.source });
    byVendor.set(r.vendor_id, list);
  }
  return { tableReady: true, byVendor };
}

/**
 * Add a vendor contact. The value and its on-file date can never be edited
 * afterwards (0258 trigger); a wrong entry is retired and re-added. The
 * database refuses a future date and a malformed phone or email.
 */
export async function addVendorContact(params: {
  vendorId: string;
  kind: "phone" | "email";
  value: string;
  onFileSince: string;
  source: VendorContact["source"];
  actorId: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("payee_contacts")
    .insert({
      payee_type: "vendor",
      vendor_id: params.vendorId,
      contact_kind: params.kind,
      value: params.value,
      on_file_since: params.onFileSince,
      source: params.source,
      created_by: params.actorId,
    })
    .select("id")
    .single();
  if (error) {
    if (isMissingTable(error)) return { ok: false, error: "One-time setup needed: apply migration 0258 (ACH authorizations) first." };
    if (/payee_contact_live_unique|duplicate key/i.test(error.message)) return { ok: false, error: "That contact is already on file." };
    return { ok: false, error: error.message };
  }
  return { ok: true, id: (data as { id: string }).id };
}

/** Retire a contact (it stays as history; it can no longer be used for a callback). */
export async function retireVendorContact(params: { contactId: string; vendorId: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("payee_contacts")
    .update({ retired_at: new Date().toISOString() })
    .eq("id", params.contactId)
    .eq("vendor_id", params.vendorId)
    .is("retired_at", null)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || (data as unknown[]).length !== 1) return { ok: false, error: "That contact was not found or is already retired." };
  return { ok: true };
}
