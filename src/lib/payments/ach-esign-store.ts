/**
 * src/lib/payments/ach-esign-store.ts  (R39 S6)
 *
 * Server-only I/O for in-person e-signing of GW-ACH-E. Every rule lives in
 * the pure core (ach-esign-core.ts) or in the database (0261); this file only
 * moves rows, bytes and one email.
 *
 *   start    owner/admin at the counter: photo ID checked, legal name typed.
 *   sendCode the employee's email -> 6-digit code (crypto.randomInt), stored
 *            ONLY as a keyed hash (esignOtp), email stored encrypted.
 *   verify   the attempt is counted in the database BEFORE the answer is
 *            given, so a crash or a retry never yields free guesses; digests
 *            are compared in constant time.
 *   consent  the disclosure version + SHA-256 of exactly the text shown.
 *   sign     both PDFs built (deterministic), hashed, stored with
 *            upsert:false under app-generated keys, then ONE call to
 *            ach_esign_complete. If that call fails, the two objects are
 *            removed so no orphan file is left.
 *   cancel   with a reason; the row is kept (a cancelled session is final).
 *
 * No bank number is written anywhere except the encrypted account columns
 * and the record PDF in the private bucket (where the paper form's scan
 * would be). Events, audit, notices and the certificate carry last-4 only.
 */
import "server-only";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { decryptSecret, encryptSecret } from "@/lib/security/at-rest-crypto";
import { keyedHasher } from "@/lib/security/keyed-hash";
import { timingSafeEqualStr } from "@/lib/security/constant-time";
import { normalizeAccountKey } from "@/lib/payments/ach-authorization-core";
import { last4, objectKeyFromStoragePath, planAccountRows, planDocumentPath } from "@/lib/payments/ach-document-intake-core";
import { buildTextPdf } from "@/lib/payments/pdf-text-core";
import {
  ESIGN_DISCLOSURE_VERSION,
  OTP_MAX_ATTEMPTS,
  canSendOtp,
  canonicalJson,
  certificateLines,
  checkEmail,
  checkIdCheck,
  checkLegalName,
  clampUserAgent,
  disclosureBody,
  esignDbErrorMessage,
  esignStep,
  makeOtp,
  maskEmail,
  otpDigest,
  otpEmail,
  otpVerdict,
  pacificDate,
  recordLines,
  sessionExpired,
  signatureMatches,
  type EsignAccountInput,
  type EsignStep,
  type EsignState,
  type IdType,
} from "@/lib/payments/ach-esign-core";

const BUCKET = "ach-docs";
const NOT_CONFIGURED = "Database is not configured.";
const NO_KEY = "DATA_ENCRYPTION_KEY is not set on the server, so the code and the bank details cannot be protected. Set it in Vercel and redeploy.";

type Fail = { ok: false; error: string };

export type EsignSession = {
  id: string;
  employee_id: string;
  state: EsignState;
  started_by: string;
  started_at: string;
  id_type: IdType;
  id_detail: string;
  legal_name: string;
  email_enc: string | null;
  email_masked: string | null;
  otp_digest: string | null;
  otp_sent_at: string | null;
  otp_sends: number;
  otp_attempts: number;
  code_verified_at: string | null;
  disclosure_version: string | null;
  disclosure_sha256: string | null;
  consented_at: string | null;
  signed_at: string | null;
  record_document_id: string | null;
  certificate_document_id: string | null;
  authorization_id: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
};

const SESSION_COLS =
  "id, employee_id, state, started_by, started_at, id_type, id_detail, legal_name, email_enc, email_masked, otp_digest, otp_sent_at, otp_sends, otp_attempts, code_verified_at, disclosure_version, disclosure_sha256, consented_at, signed_at, record_document_id, certificate_document_id, authorization_id, cancelled_at, cancel_reason";

/** The SHA-256 of exactly the disclosure the screen shows (version, paragraphs, consent and intent). */
export function currentDisclosureSha256(): string {
  return createHash("sha256").update(canonicalJson(disclosureBody()), "utf8").digest("hex");
}

function sha256Hex(b: Uint8Array): string {
  return createHash("sha256").update(b).digest("hex");
}

// ---------------------------------------------------------------- reads ----

export async function getEsignSession(id: string): Promise<EsignSession | null> {
  if (!isSupabaseServiceConfigured || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await createSupabaseAdminClient().from("ach_esign_sessions").select(SESSION_COLS).eq("id", id).maybeSingle();
  return (data as EsignSession | null) ?? null;
}

/** The employee's live (not signed, not cancelled) session, if any; and whether 0261 is applied. */
export async function liveEsignSession(employeeId: string): Promise<{ ready: boolean; session: EsignSession | null; error: string | null }> {
  if (!isSupabaseServiceConfigured) return { ready: false, session: null, error: NOT_CONFIGURED };
  const { data, error } = await createSupabaseAdminClient()
    .from("ach_esign_sessions")
    .select(SESSION_COLS)
    .eq("employee_id", employeeId)
    .in("state", ["started", "code_sent", "consented"])
    .maybeSingle();
  if (error) {
    const msg = esignDbErrorMessage(`${error.code ?? ""} ${error.message ?? ""}`);
    return { ready: !/0261/.test(msg), session: null, error: msg };
  }
  return { ready: true, session: (data as EsignSession | null) ?? null, error: null };
}

/**
 * The page's view: the live session (or the just-signed one named by done=)
 * and its step. The clock is read HERE, in the data layer, so the page render
 * stays pure (react-hooks/purity), as registers/oversight.ts does.
 */
export async function esignPageView(
  employeeId: string,
  doneId: string | null,
): Promise<{ ready: boolean; error: string | null; live: EsignSession | null; session: EsignSession | null; step: EsignStep | null }> {
  const live = await liveEsignSession(employeeId);
  const done = !live.session && doneId ? await getEsignSession(doneId) : null;
  const session = live.session ?? (done && done.employee_id === employeeId ? done : null);
  const step = session ? esignStep(session.state, session.started_at, Date.now()) : null;
  return { ready: live.ready, error: live.error, live: live.session, session, step };
}

// ---------------------------------------------------------------- start ----

export async function startEsignSession(input: {
  employeeId: string;
  actorId: string;
  idType: string;
  idDetail: string;
  legalName: string;
  todayIso: string;
}): Promise<{ ok: true; session: EsignSession } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: NOT_CONFIGURED };
  const id = checkIdCheck(input.idType, input.idDetail, input.todayIso);
  if (!id.ok) return { ok: false, error: id.error };
  const name = checkLegalName(input.legalName);
  if (!name.ok) return { ok: false, error: name.error };
  const admin = createSupabaseAdminClient();
  const emp = await admin.from("employees").select("id, active").eq("id", input.employeeId).maybeSingle();
  if (emp.error) return { ok: false, error: esignDbErrorMessage(emp.error.message) };
  if (!emp.data) return { ok: false, error: "That employee no longer exists." };
  const { data, error } = await admin
    .from("ach_esign_sessions")
    .insert({ employee_id: input.employeeId, started_by: input.actorId, id_type: id.type, id_detail: id.detail, legal_name: name.name })
    .select(SESSION_COLS)
    .single();
  if (error) return { ok: false, error: esignDbErrorMessage(`${error.code ?? ""} ${error.message ?? ""}`) };
  return { ok: true, session: data as EsignSession };
}

// ------------------------------------------------------------ send code ----

export type CodeMailer = (to: string, msg: { subject: string; html: string }) => Promise<{ ok: true } | { ok: false; detail: string }>;

/**
 * Store the new digest FIRST (with the send counted), then email. If the email
 * fails, the send is still counted: a provider that half-delivers must not
 * give unlimited sends.
 */
export async function sendEsignCode(input: {
  session: EsignSession;
  email: string;
  nowMs: number;
  mail: CodeMailer;
}): Promise<{ ok: true; masked: string } | Fail> {
  const s = input.session;
  if (s.state !== "started" && s.state !== "code_sent") return { ok: false, error: esignDbErrorMessage("ACH_ESIGN_STATE") };
  if (sessionExpired(s.started_at, input.nowMs)) return { ok: false, error: esignDbErrorMessage("ACH_ESIGN_EXPIRED") };
  const em = checkEmail(input.email);
  if (!em.ok) return { ok: false, error: em.error };
  const can = canSendOtp({ otpDigest: s.otp_digest, otpSentAtIso: s.otp_sent_at, otpSends: s.otp_sends, otpAttempts: s.otp_attempts }, input.nowMs);
  if (!can.ok) return { ok: false, error: can.error };
  const h = keyedHasher("esignOtp");
  if (!h) return { ok: false, error: NO_KEY };
  const emailEnc = encryptSecret(em.email);
  if (!emailEnc.startsWith("encv1:")) return { ok: false, error: NO_KEY };

  const code = makeOtp((max) => randomInt(max));
  const masked = maskEmail(em.email);
  const admin = createSupabaseAdminClient();
  // Optimistic concurrency: only move from the counters we read.
  const { data, error } = await admin
    .from("ach_esign_sessions")
    .update({
      state: "code_sent",
      email_enc: emailEnc,
      email_masked: masked,
      otp_digest: otpDigest(h, s.id, code),
      otp_sent_at: new Date(input.nowMs).toISOString(),
      otp_sends: s.otp_sends + 1,
    })
    .eq("id", s.id)
    .eq("otp_sends", s.otp_sends)
    .in("state", ["started", "code_sent"])
    .select("id");
  if (error) return { ok: false, error: esignDbErrorMessage(error.message) };
  if (!data || (data as unknown[]).length !== 1) return { ok: false, error: "Another device changed this signing. Reload the page." };

  const msg = otpEmail(code);
  const sent = await input.mail(em.email, { subject: msg.subject, html: msg.html });
  if (!sent.ok) return { ok: false, error: `The code could not be emailed (${sent.detail.slice(0, 160)}). Check the address and send again, or sign the paper form.` };
  return { ok: true, masked };
}

// ---------------------------------------------------------- verify code ----

/**
 * Typed code + "I agree". The attempt is recorded before the answer; a right
 * code moves the session to consented with the disclosure evidence in the
 * same update.
 */
export async function verifyCodeAndConsent(input: {
  session: EsignSession;
  typedCode: string;
  agreed: boolean;
  disclosureSha256Shown: string;
  nowMs: number;
}): Promise<{ ok: true } | Fail> {
  const s = input.session;
  if (s.state !== "code_sent") return { ok: false, error: esignDbErrorMessage("ACH_ESIGN_STATE") };
  if (sessionExpired(s.started_at, input.nowMs)) return { ok: false, error: esignDbErrorMessage("ACH_ESIGN_EXPIRED") };
  if (!input.agreed) return { ok: false, error: "Tick \"I agree\" to sign electronically, or ask for the paper form." };
  const shown = currentDisclosureSha256();
  if (input.disclosureSha256Shown !== shown) return { ok: false, error: "The disclosure changed while the page was open. Reload the page and read it again." };
  const h = keyedHasher("esignOtp");
  if (!h) return { ok: false, error: NO_KEY };
  const state = { otpDigest: s.otp_digest, otpSentAtIso: s.otp_sent_at, otpSends: s.otp_sends, otpAttempts: s.otp_attempts };
  const v = otpVerdict(state, input.typedCode, input.nowMs, (c) => otpDigest(h, s.id, c), timingSafeEqualStr);
  const admin = createSupabaseAdminClient();

  if (!v.ok) {
    if (v.countAttempt) {
      const up = await admin
        .from("ach_esign_sessions")
        .update({ otp_attempts: Math.min(OTP_MAX_ATTEMPTS, s.otp_attempts + 1) })
        .eq("id", s.id)
        .eq("otp_attempts", s.otp_attempts)
        .select("id");
      if (up.error) return { ok: false, error: esignDbErrorMessage(up.error.message) };
      if (!up.data || (up.data as unknown[]).length !== 1) return { ok: false, error: "Another device changed this signing. Reload the page." };
    }
    return { ok: false, error: v.error };
  }

  const at = new Date(input.nowMs).toISOString();
  const { data, error } = await admin
    .from("ach_esign_sessions")
    .update({
      state: "consented",
      code_verified_at: at,
      consented_at: at,
      disclosure_version: ESIGN_DISCLOSURE_VERSION,
      disclosure_sha256: shown,
    })
    .eq("id", s.id)
    .eq("state", "code_sent")
    .eq("otp_attempts", s.otp_attempts)
    .eq("otp_digest", s.otp_digest as string)
    .select("id");
  if (error) return { ok: false, error: esignDbErrorMessage(error.message) };
  if (!data || (data as unknown[]).length !== 1) return { ok: false, error: "Another device changed this signing. Reload the page." };
  return { ok: true };
}

// ------------------------------------------------------------------ sign ----

export type SignResult = {
  ok: true;
  authorizationId: string;
  recordSha256: string;
  accountsLast4: string[];
  emailTo: string | null;
  replacedPrevious: boolean;
};

export async function signEsignSession(input: {
  session: EsignSession;
  actorId: string;
  startedBy: { name: string; email: string };
  typedName: string;
  intentChecked: boolean;
  replaceOpen: boolean;
  accounts: EsignAccountInput[];
  ip: string | null;
  userAgent: string | null;
  nowMs: number;
}): Promise<SignResult | Fail> {
  const s = input.session;
  if (s.state !== "consented") return { ok: false, error: esignDbErrorMessage("ACH_ESIGN_STATE") };
  if (sessionExpired(s.started_at, input.nowMs)) return { ok: false, error: esignDbErrorMessage("ACH_ESIGN_EXPIRED") };
  if (!input.intentChecked) return { ok: false, error: "Tick the box under the signature statement to sign." };
  if (!signatureMatches(input.typedName, s.legal_name)) return { ok: false, error: esignDbErrorMessage("ACH_ESIGN_NAME") };
  const ak = keyedHasher("achAccountKey");
  if (!ak) return { ok: false, error: NO_KEY };
  const rows = planAccountRows(
    input.accounts,
    input.accounts.map((a) => a.bankName),
    { encrypt: encryptSecret, hmacKey: (r, a, t) => ak(normalizeAccountKey(r, a, t)) },
  );
  if (!rows.ok) return { ok: false, error: rows.error };

  const admin = createSupabaseAdminClient();
  const open = await admin
    .from("ach_authorizations")
    .select("id")
    .eq("payee_type", "employee")
    .eq("employee_id", s.employee_id)
    .not("state", "in", "(revoked,archived)")
    .maybeSingle();
  if (open.error) return { ok: false, error: esignDbErrorMessage(open.error.message) };
  if (open.data && !input.replaceOpen) return { ok: false, error: esignDbErrorMessage("ACH_INTAKE_OPEN_EXISTS") };

  const signedAtIso = new Date(input.nowMs).toISOString();
  const tails = input.accounts.map((a) => last4(a.account));
  const recordBytes = buildTextPdf({
    title: "GW-ACH-E Employee Direct Deposit Authorization (e-signed)",
    createdAtIso: signedAtIso,
    lines: recordLines({ employeeLegalName: s.legal_name, employeeId: s.employee_id, accounts: input.accounts, signedAtIso, sessionId: s.id }),
    footer: `GW-ACH-E e-signed ${pacificDate(signedAtIso)} | session ${s.id}`,
  });
  const recordSha = sha256Hex(recordBytes);
  const ua = clampUserAgent(input.userAgent);
  const certBytes = buildTextPdf({
    title: "GW-ACH-E Electronic Signature Certificate",
    createdAtIso: signedAtIso,
    lines: certificateLines({
      sessionId: s.id,
      employeeLegalName: s.legal_name,
      employeeId: s.employee_id,
      startedBy: input.startedBy,
      startedAtIso: s.started_at,
      idCheck: { type: s.id_type, detail: s.id_detail },
      disclosureSha256: s.disclosure_sha256 ?? "",
      consentedAtIso: s.consented_at ?? "",
      emailMasked: s.email_masked ?? "",
      codeSentAtIso: s.otp_sent_at ?? "",
      codeVerifiedAtIso: s.code_verified_at ?? "",
      codeAttempts: s.otp_attempts,
      signedAtIso,
      typedSignature: input.typedName.trim().replace(/\s+/g, " "),
      ip: input.ip,
      userAgent: ua,
      recordSha256: recordSha,
      recordBytes: recordBytes.length,
      accountsLast4: tails,
    }),
    footer: `Certificate for record ${recordSha.slice(0, 16)} | session ${s.id}`,
  });
  const certSha = sha256Hex(certBytes);

  const recPath = planDocumentPath({ payeeType: "employee", payeeId: s.employee_id, fileUuid: randomUUID(), mime: "application/pdf" });
  const certPath = planDocumentPath({ payeeType: "employee", payeeId: s.employee_id, fileUuid: randomUUID(), mime: "application/pdf" });
  if (!recPath.ok) return { ok: false, error: recPath.refusal };
  if (!certPath.ok) return { ok: false, error: certPath.refusal };

  const bucket = admin.storage.from(BUCKET);
  const up1 = await bucket.upload(recPath.objectKey, recordBytes, { contentType: "application/pdf", upsert: false });
  if (up1.error) return { ok: false, error: `The signed record could not be stored: ${up1.error.message}` };
  const up2 = await bucket.upload(certPath.objectKey, certBytes, { contentType: "application/pdf", upsert: false });
  if (up2.error) {
    await bucket.remove([recPath.objectKey]);
    return { ok: false, error: `The certificate could not be stored: ${up2.error.message}` };
  }

  const { data, error } = await admin.rpc("ach_esign_complete", {
    p_session_id: s.id,
    p_actor: input.actorId,
    p_signed_at: signedAtIso,
    p_ip: input.ip ?? "",
    p_user_agent: ua,
    p_typed_name: input.typedName,
    p_replace_open: input.replaceOpen,
    p_accounts: rows.rows,
    p_record: { storage_path: recPath.storagePath, sha256: recordSha, byte_size: recordBytes.length },
    p_certificate: { storage_path: certPath.storagePath, sha256: certSha, byte_size: certBytes.length },
  });
  if (error) {
    // Nothing was written in the database (one transaction); remove the two files too.
    await bucket.remove([recPath.objectKey, certPath.objectKey]);
    return { ok: false, error: esignDbErrorMessage(error.message) };
  }
  let emailTo: string | null = null;
  if (s.email_enc) {
    try {
      const plain = decryptSecret(s.email_enc);
      emailTo = checkEmail(plain).ok ? plain : null;
    } catch {
      emailTo = null;
    }
  }
  return { ok: true, authorizationId: String(data), recordSha256: recordSha, accountsLast4: tails, emailTo, replacedPrevious: Boolean(open.data) };
}

// ---------------------------------------------------------------- cancel ----

export async function cancelEsignSession(input: { session: EsignSession; reason: string; nowMs: number }): Promise<{ ok: true } | Fail> {
  const reason = input.reason.trim().replace(/\s+/g, " ").slice(0, 500);
  if (reason.length < 5) return { ok: false, error: esignDbErrorMessage("esign_cancelled_shape") };
  const s = input.session;
  if (s.state === "signed" || s.state === "cancelled") return { ok: false, error: esignDbErrorMessage("ACH_ESIGN_FINAL") };
  const { data, error } = await createSupabaseAdminClient()
    .from("ach_esign_sessions")
    .update({ state: "cancelled", cancelled_at: new Date(input.nowMs).toISOString(), cancel_reason: reason })
    .eq("id", s.id)
    .in("state", ["started", "code_sent", "consented"])
    .select("id");
  if (error) return { ok: false, error: esignDbErrorMessage(error.message) };
  if (!data || (data as unknown[]).length !== 1) return { ok: false, error: "This signing has already finished or been cancelled. Reload the page." };
  return { ok: true };
}

// ------------------------------------------------- signer's copy (record) ----

/**
 * The signed record for the signer to download or print on the last screen
 * (disclosure B.iv; RCW 1.80.070: a record the recipient can store and print).
 * Owner/admin only (the caller checks), and only for a signed session.
 */
export async function signedRecordBytes(session: EsignSession): Promise<{ ok: true; bytes: Uint8Array; sha256: string } | Fail> {
  if (session.state !== "signed" || !session.record_document_id) return { ok: false, error: "This signing is not finished." };
  const admin = createSupabaseAdminClient();
  const doc = await admin.from("ach_authorization_documents").select("storage_path, sha256").eq("id", session.record_document_id).maybeSingle();
  if (doc.error || !doc.data) return { ok: false, error: "The signed record could not be found." };
  const row = doc.data as { storage_path: string; sha256: string };
  const key = objectKeyFromStoragePath(row.storage_path);
  if (!key) return { ok: false, error: "The stored path is not one this app writes." };
  const dl = await admin.storage.from(BUCKET).download(key);
  if (dl.error || !dl.data) return { ok: false, error: "The signed record could not be read." };
  const bytes = new Uint8Array(await dl.data.arrayBuffer());
  const got = sha256Hex(bytes);
  // Integrity: the stored file must be the one that was signed.
  if (got !== row.sha256) return { ok: false, error: "The stored record does not match its recorded SHA-256. Do not use it; tell the owner." };
  return { ok: true, bytes, sha256: got };
}
