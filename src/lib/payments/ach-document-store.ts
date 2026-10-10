/**
 * src/lib/payments/ach-document-store.ts  (R39 S5)
 *
 * Server-only I/O for ACH document intake. Every decision is made by the pure
 * core (ach-document-intake-core.ts); this file only moves bytes and rows.
 *
 *   drop      manager or admin: sniff + checks -> private bucket ach-docs
 *             (app-generated key, upsert false) -> documents row -> event.
 *   read      admin only: 2-minute signed link (SIGNED_URL_SECONDS).
 *   extract   admin: our fillable PDF -> AcroForm fields read locally (unpdf,
 *             no third party). Scans go to LlamaParse ONLY when the admin
 *             ticks "send to LlamaParse"; OCR only proposes routing hints.
 *   rekey     admin: blind entry -> rekeyStep; a mismatch stores keyed
 *             fingerprints only (keyed-hash.ts), never a number.
 *   accept    employee: one Postgres function (0260), all or nothing.
 *             vendor: the 0259 vault (goes ON HOLD) then ach_intake_finish.
 *   reject    any payee: ach_intake_finish('rejected') with a reason.
 *
 * No bank number is ever written to the event log, the audit log, a redirect
 * URL or a console line.
 */
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { getDocumentProxy } from "unpdf";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { encryptSecret } from "@/lib/security/at-rest-crypto";
import { keyedHasher } from "@/lib/security/keyed-hash";
import { normalizeAccountKey } from "@/lib/payments/ach-authorization-core";
import { saveVendorBankDetails } from "@/lib/payments/payee-banking-store";
import { isLlamaParseConfigured, parsePdf } from "@/lib/inbound-email/llamaparse-provider";
import {
  EMPTY_DRAFT,
  INTAKE_EVENTS,
  SIGNED_URL_SECONDS,
  acceptChecks,
  acroFormKind,
  canAcceptKind,
  checkDocumentUpload,
  checkSignedOn,
  draftFromAcroForm,
  draftFromParsedText,
  extractedEventDetail,
  fieldsFromFieldObjects,
  intakeDbErrorMessage,
  objectKeyFromStoragePath,
  ocrFingerprintsFromEvents,
  ocrRoutingAdvice,
  ocrRoutingFingerprints,
  pendingFromEvents,
  planAccountRows,
  planDocumentPath,
  rekeyStep,
  routingCandidatesFromText,
  type BankDraft,
  type DocKind,
  type DocMime,
  type IntakeStatus,
  type PayeeType,
  type RekeyAccount,
} from "@/lib/payments/ach-document-intake-core";

const BUCKET = "ach-docs";
const NOT_CONFIGURED = "Database is not configured.";
const NOT_READY = "One-time setup needed: apply migration 0258 (docs/MIGRATIONS_TO_RUN.md), then try again.";
const NO_KEY = "DATA_ENCRYPTION_KEY is not set on the server, so bank details cannot be fingerprinted or stored. Set it in Vercel and redeploy.";

export type AchDocument = {
  id: string;
  authorization_id: string | null;
  payee_type: PayeeType;
  employee_id: string | null;
  vendor_id: string | null;
  kind: DocKind;
  storage_path: string;
  sha256: string;
  byte_size: number;
  mime_type: DocMime;
  original_filename: string;
  intake_status: IntakeStatus;
  intake_note: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  archived_at: string | null;
};

const DOC_COLS =
  "id, authorization_id, payee_type, employee_id, vendor_id, kind, storage_path, sha256, byte_size, mime_type, original_filename, intake_status, intake_note, uploaded_by, uploaded_at, archived_at";

type Fail = { ok: false; error: string };

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /relation .* does not exist|could not find the table/i.test(error.message ?? "");
}

function payeeColumn(t: PayeeType): "employee_id" | "vendor_id" {
  return t === "employee" ? "employee_id" : "vendor_id";
}

// ------------------------------------------------------------------ drop ----

export async function dropAchDocument(input: {
  payeeType: PayeeType;
  payeeId: string;
  kind: string;
  filename: string;
  declaredMime: string;
  bytes: Uint8Array;
  actorId: string;
}): Promise<{ ok: true; document: AchDocument } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: NOT_CONFIGURED };
  const verdict = checkDocumentUpload({ bytes: input.bytes, declaredMime: input.declaredMime, filename: input.filename, kind: input.kind });
  if (!verdict.ok) return { ok: false, error: verdict.refusal };
  const path = planDocumentPath({ payeeType: input.payeeType, payeeId: input.payeeId, fileUuid: randomUUID(), mime: verdict.mime });
  if (!path.ok) return { ok: false, error: path.refusal };
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const admin = createSupabaseAdminClient();
  const col = payeeColumn(input.payeeType);

  // Same file twice for the same payee: refuse before storing a second copy.
  const dup = await admin
    .from("ach_authorization_documents")
    .select("id")
    .eq("payee_type", input.payeeType)
    .eq(col, input.payeeId)
    .eq("sha256", sha256)
    .maybeSingle();
  if (dup.error) return { ok: false, error: isMissingTable(dup.error) ? NOT_READY : intakeDbErrorMessage(dup.error.message) };
  if (dup.data) return { ok: false, error: intakeDbErrorMessage("ach_doc_sha_per_payee") };

  const up = await admin.storage.from(BUCKET).upload(path.objectKey, input.bytes, { contentType: verdict.mime, upsert: false });
  if (up.error) return { ok: false, error: `The file could not be stored: ${up.error.message}` };

  const ins = await admin
    .from("ach_authorization_documents")
    .insert({
      payee_type: input.payeeType,
      [col]: input.payeeId,
      kind: verdict.kind,
      storage_path: path.storagePath,
      sha256,
      byte_size: verdict.byteSize,
      mime_type: verdict.mime,
      original_filename: verdict.displayName,
      uploaded_by: input.actorId,
    })
    .select(DOC_COLS)
    .single();
  if (ins.error || !ins.data) {
    // The row failed, so nothing points at the stored object: remove it
    // (an orphan file would be unreferenced bank evidence).
    await admin.storage.from(BUCKET).remove([path.objectKey]);
    return { ok: false, error: ins.error && isMissingTable(ins.error) ? NOT_READY : intakeDbErrorMessage(ins.error?.message) };
  }
  const doc = ins.data as AchDocument;
  await admin.from("ach_authorization_events").insert({
    payee_type: input.payeeType,
    [col]: input.payeeId,
    event_kind: INTAKE_EVENTS.dropped,
    actor_id: input.actorId,
    detail: { document_id: doc.id, kind: doc.kind, sha256, byte_size: doc.byte_size, mime_type: doc.mime_type },
  });
  return { ok: true, document: doc };
}

// ------------------------------------------------------------------ read ----

export async function listAchDocuments(filter: { payeeType: PayeeType; payeeId: string } | { queue: true }): Promise<{
  tableReady: boolean;
  documents: AchDocument[];
  error: string | null;
}> {
  if (!isSupabaseServiceConfigured) return { tableReady: false, documents: [], error: null };
  const admin = createSupabaseAdminClient();
  let q = admin.from("ach_authorization_documents").select(DOC_COLS).order("uploaded_at", { ascending: false }).limit(200);
  if ("queue" in filter) q = q.in("intake_status", ["received", "extracted"]).is("archived_at", null);
  else q = q.eq("payee_type", filter.payeeType).eq(payeeColumn(filter.payeeType), filter.payeeId);
  const { data, error } = await q;
  if (error) return { tableReady: !isMissingTable(error), documents: [], error: isMissingTable(error) ? null : error.message };
  return { tableReady: true, documents: (data ?? []) as AchDocument[], error: null };
}

export async function getAchDocument(id: string): Promise<AchDocument | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("ach_authorization_documents").select(DOC_COLS).eq("id", id).maybeSingle();
  return (data as AchDocument | null) ?? null;
}

/** Admin only (the caller checks settings.manage). Short-lived link. */
export async function signedAchDocumentUrl(doc: AchDocument): Promise<{ ok: true; url: string } | Fail> {
  const key = objectKeyFromStoragePath(doc.storage_path);
  if (!key) return { ok: false, error: "The stored path is not one this app writes." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(key, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) return { ok: false, error: `Could not open the file: ${error?.message ?? "no link"}` };
  return { ok: true, url: data.signedUrl };
}

async function downloadBytes(doc: AchDocument): Promise<{ ok: true; bytes: Uint8Array } | Fail> {
  const key = objectKeyFromStoragePath(doc.storage_path);
  if (!key) return { ok: false, error: "The stored path is not one this app writes." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage.from(BUCKET).download(key);
  if (error || !data) return { ok: false, error: `Could not read the file: ${error?.message ?? "missing"}` };
  const bytes = new Uint8Array(await data.arrayBuffer());
  // The stored file is evidence: it must still be the file that was dropped.
  if (createHash("sha256").update(bytes).digest("hex") !== doc.sha256) {
    return { ok: false, error: "The stored file no longer matches the fingerprint taken when it was dropped. Do not use it; tell the owner." };
  }
  return { ok: true, bytes };
}

export async function documentEvents(doc: AchDocument): Promise<{ event_kind: string; detail: unknown; occurred_at: string }[]> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("ach_authorization_events")
    .select("event_kind, detail, occurred_at, id")
    .eq("payee_type", doc.payee_type)
    .eq(payeeColumn(doc.payee_type), (doc.employee_id ?? doc.vendor_id) as string)
    .eq("detail->>document_id", doc.id)
    .order("id", { ascending: true })
    .limit(500);
  return (data ?? []) as { event_kind: string; detail: unknown; occurred_at: string }[];
}

// --------------------------------------------------------------- extract ----

/** Read the draft again (not stored: the log keeps no numbers). */
export async function readDraft(doc: AchDocument): Promise<{ ok: true; draft: BankDraft; conflicts: string[]; formKind: PayeeType | null } | Fail> {
  if (doc.mime_type !== "application/pdf") return { ok: true, draft: EMPTY_DRAFT, conflicts: [], formKind: null };
  const got = await downloadBytes(doc);
  if (!got.ok) return got;
  try {
    const pdf = await getDocumentProxy(got.bytes.slice());
    const raw = await pdf.getFieldObjects();
    const formKind = acroFormKind(raw);
    if (!formKind) return { ok: true, draft: EMPTY_DRAFT, conflicts: [], formKind: null };
    const { fields, conflicts } = fieldsFromFieldObjects(raw);
    const draft = draftFromAcroForm(formKind, fields);
    if (formKind !== doc.payee_type) {
      draft.warnings.push(`This is the ${formKind} form, but it was dropped on a ${doc.payee_type}.`);
    }
    for (const c of conflicts) draft.warnings.push(`The form field "${c}" holds two different values.`);
    return { ok: true, draft, conflicts, formKind };
  } catch {
    return { ok: true, draft: EMPTY_DRAFT, conflicts: [], formKind: null };
  }
}

export async function extractAchDocument(input: { doc: AchDocument; actorId: string; actorEmail: string | null; useLlamaParse: boolean }): Promise<
  { ok: true; summary: string } | Fail
> {
  const { doc } = input;
  if (doc.archived_at || (doc.intake_status !== "received" && doc.intake_status !== "extracted")) {
    return { ok: false, error: intakeDbErrorMessage("ACH_INTAKE_STATE") };
  }
  const admin = createSupabaseAdminClient();
  const col = payeeColumn(doc.payee_type);
  const local = await readDraft(doc);
  if (!local.ok) return local;
  let detail = extractedEventDetail(doc.id, local.draft, local.conflicts, local.formKind);
  let summary = local.draft.source === "acroform"
    ? `Read the form's own fields: ${local.draft.accounts.length} account(s), ${local.draft.warnings.length} warning(s).`
    : "No fillable form fields were found.";

  if (local.draft.source === "none" && input.useLlamaParse) {
    if (!isLlamaParseConfigured()) return { ok: false, error: "LLAMA_CLOUD_API_KEY is not set, so the scan cannot be sent to LlamaParse." };
    const hm = keyedHasher("achRekeyFingerprint");
    if (!hm) return { ok: false, error: NO_KEY };
    const got = await downloadBytes(doc);
    if (!got.ok) return got;
    const parsed = await parsePdf(
      got.bytes,
      { tier: "balanced", doNotCache: true, mimeType: doc.mime_type, filename: `document.${doc.storage_path.split(".").pop()}` },
      { feature: "ach_document_intake", entityType: "ach_authorization_document", entityId: doc.id, actorId: input.actorId, actorEmail: input.actorEmail },
    );
    if (parsed.error) return { ok: false, error: `LlamaParse could not read it: ${parsed.error}` };
    const draft = draftFromParsedText(parsed.text);
    const candidates = routingCandidatesFromText(parsed.text);
    detail = { ...extractedEventDetail(doc.id, draft, [], null), routing_fingerprints: ocrRoutingFingerprints(candidates, hm) };
    summary = `LlamaParse read the scan: ${candidates.length} possible routing number(s). These are hints only; enter everything yourself.`;
  }

  await admin.from("ach_authorization_events").insert({
    payee_type: doc.payee_type,
    [col]: (doc.employee_id ?? doc.vendor_id) as string,
    event_kind: INTAKE_EVENTS.extracted,
    actor_id: input.actorId,
    detail,
  });
  if (doc.intake_status === "received") {
    const { error } = await admin.from("ach_authorization_documents").update({ intake_status: "extracted" }).eq("id", doc.id).eq("intake_status", "received");
    if (error) return { ok: false, error: intakeDbErrorMessage(error.message) };
  }
  return { ok: true, summary };
}

// ----------------------------------------------------------- rekey/accept ----

export type RekeyOutcome =
  | { ok: true; done: true; message: string }
  | { ok: true; done: false; message: string }
  | Fail;

/**
 * One blind entry. If it is enough (matches the form, or matches the previous
 * blind entry), the document is accepted in the same request. Otherwise the
 * fingerprint is kept and the next person enters it again.
 */
export async function rekeyAndMaybeAccept(input: {
  doc: AchDocument;
  actorId: string;
  accounts: RekeyAccount[];
  bankNames: string[];
  signedOnRaw: string;
  payeeName: string;
  replaceOpen: boolean;
}): Promise<RekeyOutcome> {
  const { doc } = input;
  if (doc.archived_at || (doc.intake_status !== "received" && doc.intake_status !== "extracted")) {
    return { ok: false, error: intakeDbErrorMessage("ACH_INTAKE_STATE") };
  }
  if (!canAcceptKind(doc.kind)) return { ok: false, error: intakeDbErrorMessage("ACH_INTAKE_KIND") };
  const fp = keyedHasher("achRekeyFingerprint");
  const ak = keyedHasher("achAccountKey");
  if (!fp || !ak) return { ok: false, error: NO_KEY };

  const pre = acceptChecks(doc.payee_type, input.accounts);
  if (pre.length) return { ok: false, error: pre.join(" ") };
  const signed = checkSignedOn(input.signedOnRaw, new Date().toISOString());
  if (!signed.ok) return { ok: false, error: signed.error };

  const read = await readDraft(doc);
  if (!read.ok) return read;
  const events = await documentEvents(doc);
  const pending = pendingFromEvents(events, doc.id);
  const step = rekeyStep(read.draft, pending, { byId: input.actorId, accounts: input.accounts }, fp);
  const admin = createSupabaseAdminClient();
  const col = payeeColumn(doc.payee_type);
  const payeeId = (doc.employee_id ?? doc.vendor_id) as string;

  if (!step.ok) {
    if (step.need === "fix_entry") return { ok: false, error: step.errors.join(" ") };
    // Keep the pairing state: a fingerprint (second_entry) or a reset (form_disagrees).
    await admin.from("ach_authorization_events").insert({
      payee_type: doc.payee_type,
      [col]: payeeId,
      event_kind: INTAKE_EVENTS.rekeyMismatch,
      actor_id: input.actorId,
      detail: { document_id: doc.id, need: step.need, differences: step.differences, fingerprint: "keepPending" in step ? step.keepPending : null },
    });
    const advice = ocrRoutingAdvice(ocrFingerprintsFromEvents(events, doc.id), input.accounts, fp);
    const d = step.differences.length ? ` Different: ${step.differences.join(", ")}.` : "";
    return { ok: true, done: false, message: `${step.reason}${d}${advice.length ? ` ${advice.join(" ")}` : ""}` };
  }

  const rows = planAccountRows(step.accounts, input.bankNames, {
    encrypt: encryptSecret,
    hmacKey: (r, a, t) => ak(normalizeAccountKey(r, a, t)),
  });
  if (!rows.ok) return { ok: false, error: rows.error };

  if (doc.payee_type === "employee") {
    const { error } = await admin.rpc("ach_intake_accept_employee", {
      p_document_id: doc.id,
      p_actor: input.actorId,
      p_signed_on: signed.date,
      p_payee_name: input.payeeName.trim().slice(0, 200),
      p_basis: step.basis,
      p_replace_open: input.replaceOpen,
      p_accounts: rows.rows,
    });
    if (error) return { ok: false, error: intakeDbErrorMessage(error.message) };
    return { ok: true, done: true, message: `${step.note} Direct deposit is set up as signed; verify each account (prenote or $1 test credit) before payroll pays it.` };
  }

  // Vendor: through the 0259 vault, which puts new banking ON HOLD for the
  // callback release. Then close the document.
  const a = step.accounts[0];
  const vendor = await admin.from("vendors").select("display_name, legal_name").eq("id", payeeId).maybeSingle();
  const vendorName = String((vendor.data as { display_name?: string } | null)?.display_name ?? input.payeeName ?? "").trim();
  const saved = await saveVendorBankDetails({
    vendorId: payeeId,
    vendorName,
    bankName: (input.bankNames[0] ?? "").trim(),
    routing: a.routing.replace(/[\s-]/g, ""),
    accountNumber: a.account.replace(/[\s-]/g, ""),
    accountType: a.accountType,
    notes: `From signed vendor ACH form (document ${doc.id}), signed ${signed.date}.`,
    actorId: input.actorId,
  });
  if (!saved.ok) return { ok: false, error: saved.error };
  const fin = await admin.rpc("ach_intake_finish", {
    p_document_id: doc.id,
    p_actor: input.actorId,
    p_outcome: "accepted",
    p_note: `Saved to the vault on hold, signed ${signed.date}.`,
    p_detail: { basis: step.basis, account_last4: [rows.rows[0].account_last4], signed_on: signed.date },
  });
  if (fin.error) return { ok: false, error: `The banking was saved on hold, but the document could not be closed: ${intakeDbErrorMessage(fin.error.message)}` };
  return { ok: true, done: true, message: `${step.note} Saved to the vendor vault ON HOLD: release it after the call-back to a number you already had.` };
}

export async function rejectAchDocument(input: { doc: AchDocument; actorId: string; reason: string }): Promise<{ ok: true } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: NOT_CONFIGURED };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("ach_intake_finish", {
    p_document_id: input.doc.id,
    p_actor: input.actorId,
    p_outcome: "rejected",
    p_note: input.reason,
    p_detail: {},
  });
  if (error) return { ok: false, error: intakeDbErrorMessage(error.message) };
  return { ok: true };
}
