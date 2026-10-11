/**
 * src/lib/payments/vendor-esign-store.ts  (R39 S7)
 *
 * Server-only I/O for vendors e-signing GW-ACH-V from a one-time link. Rules
 * live in vendor-esign-core.ts / vendor-esign-app-core.ts (pure, tested) and
 * in 0262 (the database refuses anything out of order). This file moves rows,
 * bytes and emails.
 *
 *   invite      Michael/Stephen press "Email the link": 32 random bytes; only
 *               the keyed hash is stored; the email is stored encrypted.
 *   open        first_opened_at is stamped once (the guard keeps it).
 *   sendCode    to the address the LINK went to (never one the visitor types).
 *               The send is counted before the email goes.
 *   verify      the attempt is counted before the answer; a right code +
 *               "I agree" binds this browser (random httpOnly cookie, only its
 *               keyed hash stored) and records the disclosure hash.
 *   sign        same browser, consent < 24 h: form checked, proof stored
 *               (upsert:false), both PDFs built and stored, ONE call to
 *               vendor_esign_complete; on failure the new files are removed.
 *               The vault row is written ON HOLD by 0262/0259.
 *   countersign after the callback + vault release: acceptance PDF + RPC;
 *               the vendor gets the acceptance and certificate (no full
 *               numbers by email).
 *   reject / cancel with a reason; rows are kept (owner Q7: never delete).
 */
import "server-only";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { decryptSecret, encryptSecret } from "@/lib/security/at-rest-crypto";
import { keyedHasher } from "@/lib/security/keyed-hash";
import { timingSafeEqualStr } from "@/lib/security/constant-time";
import { normalizeAccountKey } from "@/lib/payments/ach-authorization-core";
import { last4, objectKeyFromStoragePath, planDocumentPath } from "@/lib/payments/ach-document-intake-core";
import { buildTextPdf } from "@/lib/payments/pdf-text-core";
import { clampUserAgent } from "@/lib/payments/ach-esign-core";
import {
  OPEN_STATES,
  VENDOR_ESIGN_DISCLOSURE_VERSION,
  VENDOR_OTP_MAX_ATTEMPTS,
  acceptanceLines,
  browserDigest,
  canSendVendorOtp,
  canonicalJson,
  checkInviteRecipient,
  checkSigner,
  checkVendorProof,
  consentStale,
  countersignedNotice,
  inviteEmail,
  inviteExpired,
  inviteExpiresAt,
  makeOtp,
  makeToken,
  maskEmail,
  pacificDate,
  parseVendorForm,
  isTokenShape,
  tokenDigest,
  vendorCertificateLines,
  vendorDisclosureBody,
  vendorEsignDbErrorMessage,
  vendorEsignStep,
  vendorOtpDigest,
  vendorOtpEmail,
  vendorOtpVerdict,
  vendorRecordLines,
  vendorSignedNotices,
  type ParticipationRow,
  type ProofKind,
  type VendorEsignState,
  type VendorEsignStep,
  type VendorForm,
  type VendorFormErrors,
} from "@/lib/payments/vendor-esign-core";
import { countersignReadiness, emailOnFile, inviteLink, isCookieShape, vendorPrefill, type VendorPrefill, type VendorRowForPrefill } from "@/lib/payments/vendor-esign-app-core";
import type { VendorMailer } from "@/lib/payments/vendor-esign-mail";

const BUCKET = "ach-docs";
const TABLE = "vendor_esign_invites";
const NOT_CONFIGURED = "Database is not configured.";
const NO_KEY = "DATA_ENCRYPTION_KEY is not set on the server, so the link, the code and the bank details cannot be protected. Set it in Vercel and redeploy.";
const VENDOR_SORRY = "This page is not available right now. Please call Greenway at 360-443-6988.";
const RACE_STAFF = "Someone else changed this link at the same moment. Reload the page.";
const RACE_VENDOR = "This page changed in another window. Reload the page and try again.";

type Fail = { ok: false; error: string };

export type VendorInvite = {
  id: string;
  vendor_id: string;
  state: VendorEsignState;
  invited_by: string;
  invited_at: string;
  expires_at: string;
  email_enc: string;
  email_masked: string;
  email_on_file: boolean;
  recipient_name: string;
  first_opened_at: string | null;
  otp_digest: string | null;
  otp_sent_at: string | null;
  otp_sends: number;
  otp_attempts: number;
  code_verified_at: string | null;
  browser_digest: string | null;
  disclosure_version: string | null;
  disclosure_sha256: string | null;
  consented_at: string | null;
  proof_storage_path: string | null;
  proof_sha256: string | null;
  proof_byte_size: number | null;
  proof_mime: string | null;
  proof_kind: string | null;
  proof_filename: string | null;
  form: VendorForm | null;
  bank_routing_enc: string | null;
  bank_account_enc: string | null;
  bank_account_type: string | null;
  account_last4: string | null;
  routing_last4: string | null;
  signed_at: string | null;
  signer_name: string | null;
  signer_title: string | null;
  record_document_id: string | null;
  certificate_document_id: string | null;
  proof_document_id: string | null;
  authorization_id: string | null;
  countersigned_by: string | null;
  countersigned_at: string | null;
  countersign_document_id: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  reject_reason: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
};

const COLS =
  "id, vendor_id, state, invited_by, invited_at, expires_at, email_enc, email_masked, email_on_file, recipient_name, first_opened_at, " +
  "otp_digest, otp_sent_at, otp_sends, otp_attempts, code_verified_at, browser_digest, disclosure_version, disclosure_sha256, consented_at, " +
  "proof_storage_path, proof_sha256, proof_byte_size, proof_mime, proof_kind, proof_filename, form, bank_routing_enc, bank_account_enc, " +
  "bank_account_type, account_last4, routing_last4, signed_at, signer_name, signer_title, record_document_id, certificate_document_id, " +
  "proof_document_id, authorization_id, countersigned_by, countersigned_at, countersign_document_id, rejected_by, rejected_at, reject_reason, " +
  "cancelled_by, cancelled_at, cancel_reason";

/** The SHA-256 of exactly the disclosure the vendor's screen shows. */
export function currentVendorDisclosureSha256(): string {
  return createHash("sha256").update(canonicalJson(vendorDisclosureBody()), "utf8").digest("hex");
}

function sha256Hex(b: Uint8Array): string {
  return createHash("sha256").update(b).digest("hex");
}

function dbMsg(error: { code?: string | null; message?: string | null } | null, audience: "staff" | "vendor"): string {
  return vendorEsignDbErrorMessage(`${error?.code ?? ""} ${error?.message ?? ""}`, audience);
}

function oneRow(data: unknown): boolean {
  return Array.isArray(data) && data.length === 1;
}

function plainEmail(enc: string | null): string | null {
  if (!enc) return null;
  try {
    const p = decryptSecret(enc);
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p) ? p : null;
  } catch {
    return null;
  }
}

/** Does the cookie this browser holds match the one bound at consent? */
export function browserMatches(inv: Pick<VendorInvite, "id" | "browser_digest">, cookie: string | null | undefined): boolean {
  if (!inv.browser_digest || !isCookieShape(cookie)) return false;
  const h = keyedHasher("vendorEsignBrowser");
  if (!h) return false;
  return timingSafeEqualStr(browserDigest(h, inv.id, cookie as string), inv.browser_digest);
}

// ---------------------------------------------------------------- reads ----

export async function getVendorInvite(id: string): Promise<VendorInvite | null> {
  if (!isSupabaseServiceConfigured || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await createSupabaseAdminClient().from(TABLE).select(COLS).eq("id", id).maybeSingle();
  return (data as unknown as VendorInvite | null) ?? null;
}

/** Look up by the link token: hash it, then find the row. Unknown or malformed -> null (no detail). */
export async function getVendorInviteByToken(token: string): Promise<VendorInvite | null> {
  if (!isSupabaseServiceConfigured || !isTokenShape(token)) return null;
  const h = keyedHasher("vendorEsignToken");
  if (!h) return null;
  const { data } = await createSupabaseAdminClient().from(TABLE).select(COLS).eq("token_hash", tokenDigest(h, token)).maybeSingle();
  return (data as unknown as VendorInvite | null) ?? null;
}

/** All invites for a vendor (newest first) and whether 0262 is applied. */
export async function listVendorInvites(vendorId: string): Promise<{ ready: boolean; error: string | null; invites: VendorInvite[] }> {
  if (!isSupabaseServiceConfigured) return { ready: false, error: NOT_CONFIGURED, invites: [] };
  const { data, error } = await createSupabaseAdminClient().from(TABLE).select(COLS).eq("vendor_id", vendorId).order("invited_at", { ascending: false }).limit(20);
  if (error) {
    const msg = dbMsg(error, "staff");
    return { ready: !/0262/.test(msg), error: msg, invites: [] };
  }
  return { ready: true, error: null, invites: (data as unknown as VendorInvite[]) ?? [] };
}

export type VendorPageView =
  | { kind: "invalid" }
  | {
      kind: "ok";
      invite: VendorInvite;
      step: VendorEsignStep;
      vendorName: string;
      prefill: VendorPrefill;
      disclosureSha256: string;
      codeSentAgoMs: number | null;
      expiresPacific: string;
    };

/**
 * Everything the vendor page needs. The clock is read HERE (data layer), so
 * the page render stays pure (react-hooks/purity). The first view stamps
 * first_opened_at (once; the guard refuses a second stamp).
 */
export async function vendorPageView(token: string, cookie: string | null): Promise<VendorPageView> {
  const inv = await getVendorInviteByToken(token);
  if (!inv) return { kind: "invalid" };
  const now = Date.now();
  const admin = createSupabaseAdminClient();
  if (!inv.first_opened_at && OPEN_STATES.includes(inv.state) && !inviteExpired(inv.expires_at, now)) {
    const at = new Date(now).toISOString();
    const up = await admin.from(TABLE).update({ first_opened_at: at }).eq("id", inv.id).is("first_opened_at", null).select("id");
    if (!up.error && oneRow(up.data)) inv.first_opened_at = at;
  }
  const step = vendorEsignStep(
    {
      state: inv.state,
      expiresAtIso: inv.expires_at,
      codeVerifiedAtIso: inv.code_verified_at,
      otpSends: inv.otp_sends,
      otpAttempts: inv.otp_attempts,
      browserMatches: browserMatches(inv, cookie),
    },
    now,
  );
  const [vendor, prior, bank] = await Promise.all([
    admin
      .from("vendors")
      .select("display_name, legal_name, dba, license_number, email, phone, billing_address1, billing_city, billing_state, billing_zip, shipping_address1, shipping_city, shipping_state, shipping_zip")
      .eq("id", inv.vendor_id)
      .maybeSingle(),
    step === "fill"
      ? admin.from(TABLE).select("form").eq("vendor_id", inv.vendor_id).in("state", ["signed", "countersigned"]).order("signed_at", { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    step === "fill" ? admin.from("vendor_bank_details").select("id").eq("vendor_id", inv.vendor_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const v = (vendor.data as VendorRowForPrefill | null) ?? null;
  const priorForm = ((prior.data as { form: VendorForm | null } | null)?.form ?? null) as Partial<VendorForm> | null;
  return {
    kind: "ok",
    invite: inv,
    step,
    vendorName: (v?.legal_name || v?.display_name || "your business").toString(),
    prefill: step === "fill" ? vendorPrefill(v, priorForm, Boolean(bank.data)) : {},
    disclosureSha256: currentVendorDisclosureSha256(),
    codeSentAgoMs: inv.otp_sent_at ? now - Date.parse(inv.otp_sent_at) : null,
    expiresPacific: pacificDate(inv.expires_at),
  };
}

// -------------------------------------------------------------- invite ----

export async function createVendorInvite(input: {
  vendorId: string;
  actor: { id: string; name: string };
  recipientName: string;
  email: string;
  siteBase: string;
  nowMs: number;
  mail: VendorMailer;
  /** Cancel an expired open link first (bulk invite, "send a new link"). */
  replaceExpired?: boolean;
}): Promise<{ ok: true; inviteId: string; masked: string; emailOnFile: boolean; mailed: boolean; mailDetail: string | null } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: NOT_CONFIGURED };
  const r = checkInviteRecipient(input.recipientName, input.email);
  if (!r.ok) return { ok: false, error: r.error };
  const th = keyedHasher("vendorEsignToken");
  if (!th) return { ok: false, error: NO_KEY };
  const emailEnc = encryptSecret(r.email);
  if (!emailEnc.startsWith("encv1:")) return { ok: false, error: NO_KEY };
  const token = makeToken((n) => new Uint8Array(randomBytes(n)));
  const link = inviteLink(input.siteBase, token);
  if (!link) return { ok: false, error: "The site address is not known (set NEXT_PUBLIC_SITE_URL to https://www.greenwaymarijuana.com in Vercel), so the link cannot be built." };

  const admin = createSupabaseAdminClient();
  const vend = await admin.from("vendors").select("id, display_name, legal_name, email, ach_opted_out").eq("id", input.vendorId).maybeSingle();
  if (vend.error) return { ok: false, error: dbMsg(vend.error, "staff") };
  if (!vend.data) return { ok: false, error: "That vendor no longer exists." };
  const vrow = vend.data as { display_name: string; legal_name: string | null; email: string | null; ach_opted_out?: boolean };

  if (input.replaceExpired) {
    const open = await admin.from(TABLE).select("id, state, expires_at").eq("vendor_id", input.vendorId).in("state", ["sent", "code_sent", "consented"]).maybeSingle();
    const o = open.data as { id: string; state: VendorEsignState; expires_at: string } | null;
    if (o && inviteExpired(o.expires_at, input.nowMs)) {
      await admin
        .from(TABLE)
        .update({ state: "cancelled", cancelled_at: new Date(input.nowMs).toISOString(), cancelled_by: input.actor.id, cancel_reason: "Expired; replaced by a new link." })
        .eq("id", o.id)
        .eq("state", o.state);
    }
  }

  const invitedAt = new Date(input.nowMs).toISOString();
  const expiresAt = inviteExpiresAt(input.nowMs);
  const onFile = emailOnFile(r.email, vrow.email);
  const masked = maskEmail(r.email);
  const ins = await admin
    .from(TABLE)
    .insert({
      vendor_id: input.vendorId,
      token_hash: tokenDigest(th, token),
      invited_by: input.actor.id,
      invited_at: invitedAt,
      expires_at: expiresAt,
      email_enc: emailEnc,
      email_masked: masked,
      email_on_file: onFile,
      recipient_name: r.name,
    })
    .select("id")
    .single();
  if (ins.error) return { ok: false, error: dbMsg(ins.error, "staff") };
  const inviteId = (ins.data as { id: string }).id;

  const msg = inviteEmail({ link, vendorName: vrow.legal_name || vrow.display_name, recipientName: r.name, inviterName: input.actor.name, expiresPacific: pacificDate(expiresAt) });
  const sent = await input.mail([r.email], msg);
  return { ok: true, inviteId, masked, emailOnFile: onFile, mailed: sent.ok, mailDetail: sent.ok ? null : sent.detail.slice(0, 200) };
}

// ------------------------------------------------------------ send code ----

/** To the invited address only. Counted (optimistically) before the email goes. */
export async function sendVendorCode(input: { invite: VendorInvite; nowMs: number; mail: VendorMailer }): Promise<{ ok: true; masked: string } | Fail> {
  const s = input.invite;
  if (s.state !== "sent" && s.state !== "code_sent" && s.state !== "consented") return { ok: false, error: vendorEsignDbErrorMessage("VENDOR_ESIGN_STATE", "vendor") };
  if (inviteExpired(s.expires_at, input.nowMs)) return { ok: false, error: vendorEsignDbErrorMessage("VENDOR_ESIGN_EXPIRED", "vendor") };
  const can = canSendVendorOtp({ otpDigest: s.otp_digest, otpSentAtIso: s.otp_sent_at, otpSends: s.otp_sends, otpAttempts: s.otp_attempts }, input.nowMs);
  if (!can.ok) return { ok: false, error: can.error };
  const h = keyedHasher("vendorEsignOtp");
  if (!h) return { ok: false, error: VENDOR_SORRY };
  const to = plainEmail(s.email_enc);
  if (!to) return { ok: false, error: VENDOR_SORRY };
  const code = makeOtp((max) => randomInt(max));
  const { data, error } = await createSupabaseAdminClient()
    .from(TABLE)
    .update({ state: "code_sent", otp_digest: vendorOtpDigest(h, s.id, code), otp_sent_at: new Date(input.nowMs).toISOString(), otp_sends: s.otp_sends + 1 })
    .eq("id", s.id)
    .eq("otp_sends", s.otp_sends)
    .eq("state", s.state)
    .select("id");
  if (error) return { ok: false, error: dbMsg(error, "vendor") };
  if (!oneRow(data)) return { ok: false, error: RACE_VENDOR };
  const sent = await input.mail([to], vendorOtpEmail(code));
  if (!sent.ok) return { ok: false, error: "The code email could not be sent just now. Wait a minute and press the button again, or call Greenway at 360-443-6988." };
  return { ok: true, masked: s.email_masked };
}

// ---------------------------------------------------------- verify code ----

/**
 * Typed code + "I agree". The wrong-code attempt is written before the
 * answer. A right code moves to consented, records the disclosure hash and
 * binds this browser: the returned cookie value must be set by the caller.
 */
export async function verifyVendorCode(input: {
  invite: VendorInvite;
  typedCode: string;
  agreed: boolean;
  disclosureSha256Shown: string;
  nowMs: number;
}): Promise<{ ok: true; cookie: string } | Fail> {
  const s = input.invite;
  if (s.state !== "code_sent") return { ok: false, error: vendorEsignDbErrorMessage("VENDOR_ESIGN_STATE", "vendor") };
  if (inviteExpired(s.expires_at, input.nowMs)) return { ok: false, error: vendorEsignDbErrorMessage("VENDOR_ESIGN_EXPIRED", "vendor") };
  if (!input.agreed) return { ok: false, error: "Tick \"I agree\" to sign electronically, or call Greenway for the paper form." };
  const shown = currentVendorDisclosureSha256();
  if (input.disclosureSha256Shown !== shown) return { ok: false, error: "The page changed while it was open. Reload it and read the disclosure again." };
  const oh = keyedHasher("vendorEsignOtp");
  const bh = keyedHasher("vendorEsignBrowser");
  if (!oh || !bh) return { ok: false, error: VENDOR_SORRY };
  const v = vendorOtpVerdict(
    { otpDigest: s.otp_digest, otpSentAtIso: s.otp_sent_at, otpSends: s.otp_sends, otpAttempts: s.otp_attempts },
    input.typedCode,
    input.nowMs,
    (c) => vendorOtpDigest(oh, s.id, c),
    timingSafeEqualStr,
  );
  const admin = createSupabaseAdminClient();
  if (!v.ok) {
    if (v.countAttempt) {
      const up = await admin
        .from(TABLE)
        .update({ otp_attempts: Math.min(VENDOR_OTP_MAX_ATTEMPTS, s.otp_attempts + 1) })
        .eq("id", s.id)
        .eq("otp_attempts", s.otp_attempts)
        .select("id");
      if (up.error) return { ok: false, error: dbMsg(up.error, "vendor") };
      if (!oneRow(up.data)) return { ok: false, error: RACE_VENDOR };
    }
    return { ok: false, error: v.error };
  }
  const cookie = makeToken((n) => new Uint8Array(randomBytes(n)));
  const at = new Date(input.nowMs).toISOString();
  const { data, error } = await admin
    .from(TABLE)
    .update({
      state: "consented",
      code_verified_at: at,
      consented_at: at,
      browser_digest: browserDigest(bh, s.id, cookie),
      disclosure_version: VENDOR_ESIGN_DISCLOSURE_VERSION,
      disclosure_sha256: shown,
    })
    .eq("id", s.id)
    .eq("state", "code_sent")
    .eq("otp_attempts", s.otp_attempts)
    .eq("otp_digest", s.otp_digest as string)
    .select("id");
  if (error) return { ok: false, error: dbMsg(error, "vendor") };
  if (!oneRow(data)) return { ok: false, error: RACE_VENDOR };
  return { ok: true, cookie };
}

// ------------------------------------------------------------------ sign ----

/** Same browser, still consented, consent fresh, link not expired. */
function readyToFill(s: VendorInvite, cookie: string | null, nowMs: number): string | null {
  if (s.state !== "consented") return vendorEsignDbErrorMessage("VENDOR_ESIGN_STATE", "vendor");
  if (inviteExpired(s.expires_at, nowMs)) return vendorEsignDbErrorMessage("VENDOR_ESIGN_EXPIRED", "vendor");
  if (!browserMatches(s, cookie)) return "This browser has not confirmed the code. Reload the page and get a new code here.";
  if (consentStale(s.code_verified_at, nowMs)) return vendorEsignDbErrorMessage("VENDOR_ESIGN_STALE", "vendor");
  return null;
}

/**
 * Store the bank proof on the invite (while consented, this browser). Same
 * file again -> nothing to do. A replaced file's old object is removed.
 */
async function attachProof(s: VendorInvite, file: { bytes: Uint8Array; mime: string | null; filename: string | null; kind: ProofKind }): Promise<{ ok: true; invite: VendorInvite } | { ok: false; error: string; field: "proof" }> {
  const chk = checkVendorProof({ bytes: file.bytes, declaredMime: file.mime, filename: file.filename, kind: file.kind });
  if (!chk.ok) return { ok: false, error: chk.refusal, field: "proof" };
  const sha = sha256Hex(file.bytes);
  if (s.proof_sha256 === sha && s.proof_kind === chk.kind) return { ok: true, invite: s };
  const path = planDocumentPath({ payeeType: "vendor", payeeId: s.vendor_id, fileUuid: randomUUID(), mime: chk.mime });
  if (!path.ok) return { ok: false, error: path.refusal, field: "proof" };
  const admin = createSupabaseAdminClient();
  const bucket = admin.storage.from(BUCKET);
  const up = await bucket.upload(path.objectKey, file.bytes, { contentType: chk.mime, upsert: false });
  if (up.error) return { ok: false, error: "The photo could not be saved. Please try again.", field: "proof" };
  const patch = { proof_storage_path: path.storagePath, proof_sha256: sha, proof_byte_size: chk.byteSize, proof_mime: chk.mime, proof_kind: chk.kind, proof_filename: chk.displayName.slice(0, 180) };
  const q = admin.from(TABLE).update(patch).eq("id", s.id).eq("state", "consented").eq("browser_digest", s.browser_digest as string);
  const res = await (s.proof_storage_path ? q.eq("proof_storage_path", s.proof_storage_path) : q.is("proof_storage_path", null)).select("id");
  if (res.error || !oneRow(res.data)) {
    await bucket.remove([path.objectKey]);
    return { ok: false, error: res.error ? dbMsg(res.error, "vendor") : RACE_VENDOR, field: "proof" };
  }
  const oldKey = s.proof_storage_path ? objectKeyFromStoragePath(s.proof_storage_path) : null;
  if (oldKey) await bucket.remove([oldKey]);
  return { ok: true, invite: { ...s, ...patch } };
}

export type VendorSignResult =
  | { ok: true; authorizationId: string; accountLast4: string; requestType: "new" | "change"; reviewFlags: string[]; signerName: string; vendorName: string }
  | { ok: false; error: string; errors?: VendorFormErrors & { signer_name?: string; signer_title?: string; intent?: string } };

export async function signVendorInvite(input: {
  invite: VendorInvite;
  cookie: string | null;
  get: (k: string) => string | null;
  proofFile: { bytes: Uint8Array; mime: string | null; filename: string | null } | null;
  signerName: string;
  signerTitle: string;
  intentChecked: boolean;
  ip: string | null;
  userAgent: string | null;
  nowMs: number;
}): Promise<VendorSignResult> {
  let s = input.invite;
  const notReady = readyToFill(s, input.cookie, input.nowMs);
  if (notReady) return { ok: false, error: notReady };
  const todayIso = pacificDate(new Date(input.nowMs).toISOString());
  const parsed = parseVendorForm(input.get, todayIso);
  const signer = checkSigner(input.signerName, input.signerTitle);
  const errors: VendorFormErrors & { signer_name?: string; signer_title?: string; intent?: string } = {};
  if (!parsed.ok) Object.assign(errors, parsed.errors);
  if (!signer.ok) Object.assign(errors, signer.errors);
  if (!input.intentChecked) errors.intent = "Tick the box above the Sign button.";
  if (!input.proofFile && !s.proof_storage_path) errors.proof = "Add a photo of a voided check, a bank letter, or a statement page.";
  if (Object.keys(errors).length || !parsed.ok || !signer.ok) return { ok: false, error: "Please fix the boxes marked in red.", errors };

  const ak = keyedHasher("achAccountKey");
  if (!ak) return { ok: false, error: VENDOR_SORRY };
  const routingEnc = encryptSecret(parsed.bank.routing);
  const accountEnc = encryptSecret(parsed.bank.account);
  if (!routingEnc.startsWith("encv1:") || !accountEnc.startsWith("encv1:")) return { ok: false, error: VENDOR_SORRY };

  if (input.proofFile) {
    const a = await attachProof(s, { ...input.proofFile, kind: parsed.form.proof_kind });
    if (!a.ok) return { ok: false, error: a.error, errors: { proof: a.error } };
    s = a.invite;
  }

  const admin = createSupabaseAdminClient();
  const vend = await admin.from("vendors").select("display_name, legal_name").eq("id", s.vendor_id).maybeSingle();
  const inviter = await admin.from("staff_profiles").select("full_name, email").eq("id", s.invited_by).maybeSingle();
  const inv = (inviter.data as { full_name: string | null; email: string } | null) ?? { full_name: null, email: "" };

  const signedAtIso = new Date(input.nowMs).toISOString();
  const recordBytes = buildTextPdf({
    title: "GW-ACH-V Vendor Payment Authorization (e-signed)",
    createdAtIso: signedAtIso,
    lines: vendorRecordLines({
      form: parsed.form,
      bank: parsed.bank,
      vendorId: s.vendor_id,
      inviteId: s.id,
      signerName: signer.name,
      signerTitle: signer.title,
      signedAtIso,
      proof: { filename: s.proof_filename ?? "", sha256: s.proof_sha256 ?? "" },
    }),
    footer: `GW-ACH-V e-signed ${pacificDate(signedAtIso)} | invite ${s.id}`,
  });
  const recordSha = sha256Hex(recordBytes);
  const ua = clampUserAgent(input.userAgent);
  const acct4 = last4(parsed.bank.account);
  const rt4 = parsed.bank.routing.slice(-4);
  const certBytes = buildTextPdf({
    title: "GW-ACH-V Electronic Signature Certificate",
    createdAtIso: signedAtIso,
    lines: vendorCertificateLines({
      inviteId: s.id,
      vendorId: s.vendor_id,
      vendorLegalName: parsed.form.legal_name,
      invitedBy: { name: inv.full_name || inv.email || "Greenway", email: inv.email },
      invitedAtIso: s.invited_at,
      emailMasked: s.email_masked,
      emailOnFile: s.email_on_file,
      firstOpenedAtIso: s.first_opened_at,
      disclosureSha256: s.disclosure_sha256 ?? "",
      codeSentAtIso: s.otp_sent_at ?? "",
      codeVerifiedAtIso: s.code_verified_at ?? "",
      codeAttempts: s.otp_attempts,
      consentedAtIso: s.consented_at ?? "",
      signedAtIso,
      signerName: signer.name,
      signerTitle: signer.title,
      ip: input.ip,
      userAgent: ua,
      recordSha256: recordSha,
      recordBytes: recordBytes.length,
      proofSha256: s.proof_sha256 ?? "",
      proofBytes: Number(s.proof_byte_size ?? 0),
      accountLast4: acct4,
      routingLast4: rt4,
    }),
    footer: `Certificate for record ${recordSha.slice(0, 16)} | invite ${s.id}`,
  });
  const certSha = sha256Hex(certBytes);

  const recPath = planDocumentPath({ payeeType: "vendor", payeeId: s.vendor_id, fileUuid: randomUUID(), mime: "application/pdf" });
  const certPath = planDocumentPath({ payeeType: "vendor", payeeId: s.vendor_id, fileUuid: randomUUID(), mime: "application/pdf" });
  if (!recPath.ok || !certPath.ok) return { ok: false, error: VENDOR_SORRY };
  const bucket = admin.storage.from(BUCKET);
  const up1 = await bucket.upload(recPath.objectKey, recordBytes, { contentType: "application/pdf", upsert: false });
  if (up1.error) return { ok: false, error: vendorEsignDbErrorMessage("VENDOR_ESIGN_FILES", "vendor") };
  const up2 = await bucket.upload(certPath.objectKey, certBytes, { contentType: "application/pdf", upsert: false });
  if (up2.error) {
    await bucket.remove([recPath.objectKey]);
    return { ok: false, error: vendorEsignDbErrorMessage("VENDOR_ESIGN_FILES", "vendor") };
  }
  const { data, error } = await admin.rpc("vendor_esign_complete", {
    p_invite_id: s.id,
    p_signed_at: signedAtIso,
    p_ip: input.ip ?? "",
    p_user_agent: ua,
    p_signer_name: signer.name,
    p_signer_title: signer.title,
    p_form: parsed.form,
    p_bank: {
      bank_name: parsed.form.bank_name,
      routing_enc: routingEnc,
      account_enc: accountEnc,
      account_type: parsed.bank.accountType,
      account_last4: acct4,
      routing_last4: rt4,
      account_key_hmac: ak(normalizeAccountKey(parsed.bank.routing, parsed.bank.account, parsed.bank.accountType)),
    },
    p_record: { storage_path: recPath.storagePath, sha256: recordSha, byte_size: recordBytes.length },
    p_certificate: { storage_path: certPath.storagePath, sha256: certSha, byte_size: certBytes.length },
  });
  if (error) {
    await bucket.remove([recPath.objectKey, certPath.objectKey]);
    return { ok: false, error: dbMsg(error, "vendor") };
  }
  // If 0262 reused an identical proof already on file, this invite's own copy
  // is kept anyway: the frozen invite row points at it (evidence stays whole).
  const vrow = (vend.data as { display_name: string; legal_name: string | null } | null) ?? { display_name: parsed.form.legal_name, legal_name: null };
  return {
    ok: true,
    authorizationId: String(data),
    accountLast4: acct4,
    requestType: parsed.form.request_type,
    reviewFlags: parsed.form.review_flags,
    signerName: signer.name,
    vendorName: vrow.legal_name || vrow.display_name,
  };
}

/** Receipt to the invited address AND the vendor's address on file (a bank change is the classic diversion fraud), and a to-do to the owners. */
export async function sendSignedNotices(input: {
  inviteId: string;
  result: Extract<VendorSignResult, { ok: true }>;
  ownersTo: string[];
  vendorPageUrl: string;
  nowMs: number;
  mail: VendorMailer;
}): Promise<{ vendorMailed: boolean; ownersMailed: boolean }> {
  const s = await getVendorInvite(input.inviteId);
  if (!s) return { vendorMailed: false, ownersMailed: false };
  const admin = createSupabaseAdminClient();
  const [vend, inviter] = await Promise.all([
    admin.from("vendors").select("email").eq("id", s.vendor_id).maybeSingle(),
    admin.from("staff_profiles").select("full_name, email").eq("id", s.invited_by).maybeSingle(),
  ]);
  const inv = (inviter.data as { full_name: string | null; email: string } | null) ?? { full_name: null, email: "" };
  const n = vendorSignedNotices({
    vendorName: input.result.vendorName,
    signerName: input.result.signerName,
    accountLast4: input.result.accountLast4,
    whenPacific: new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" }).format(new Date(input.nowMs)),
    requestType: input.result.requestType,
    inviterName: inv.full_name || inv.email || "Greenway",
    reviewFlags: input.result.reviewFlags,
    vendorPageUrl: input.vendorPageUrl,
  });
  const to = [plainEmail(s.email_enc), (vend.data as { email: string | null } | null)?.email ?? null].filter((x): x is string => Boolean(x && /@/.test(x)));
  const v = to.length ? await input.mail(to.slice(0, 2), n.vendor) : { ok: false as const, detail: "no address" };
  const o = input.ownersTo.length ? await input.mail(input.ownersTo.slice(0, 3), n.owners) : { ok: false as const, detail: "no owners" };
  return { vendorMailed: v.ok, ownersMailed: o.ok };
}

// -------------------------------------------------------- staff actions ----

export async function cancelVendorInvite(input: { invite: VendorInvite; actorId: string; reason: string; nowMs: number }): Promise<{ ok: true } | Fail> {
  const reason = input.reason.trim().replace(/\s+/g, " ").slice(0, 500);
  if (reason.length < 5) return { ok: false, error: vendorEsignDbErrorMessage("vesign_cancelled_shape") };
  const s = input.invite;
  if (!["sent", "code_sent", "consented"].includes(s.state)) return { ok: false, error: vendorEsignDbErrorMessage("VENDOR_ESIGN_FINAL") };
  const { data, error } = await createSupabaseAdminClient()
    .from(TABLE)
    .update({ state: "cancelled", cancelled_at: new Date(input.nowMs).toISOString(), cancelled_by: input.actorId, cancel_reason: reason })
    .eq("id", s.id)
    .eq("state", s.state)
    .select("id");
  if (error) return { ok: false, error: dbMsg(error, "staff") };
  if (!oneRow(data)) return { ok: false, error: RACE_STAFF };
  // An uploaded-but-never-signed proof is not evidence of anything; remove the file.
  const k = s.proof_storage_path ? objectKeyFromStoragePath(s.proof_storage_path) : null;
  if (k) await createSupabaseAdminClient().storage.from(BUCKET).remove([k]);
  return { ok: true };
}

export async function rejectVendorInvite(input: { invite: VendorInvite; actorId: string; reason: string }): Promise<{ ok: true } | Fail> {
  if (input.invite.state !== "signed") return { ok: false, error: vendorEsignDbErrorMessage("VENDOR_ESIGN_STATE") };
  const { error } = await createSupabaseAdminClient().rpc("vendor_esign_reject", { p_invite_id: input.invite.id, p_actor: input.actorId, p_reason: input.reason });
  if (error) return { ok: false, error: dbMsg(error, "staff") };
  return { ok: true };
}

export async function countersignVendorInvite(input: {
  invite: VendorInvite;
  actor: { id: string; name: string; email: string };
  title: string;
  note: string;
  nowMs: number;
  mail: VendorMailer;
}): Promise<{ ok: true; mailed: boolean } | Fail> {
  const s = input.invite;
  if (s.state !== "signed") return { ok: false, error: vendorEsignDbErrorMessage("VENDOR_ESIGN_STATE") };
  const title = input.title.trim().replace(/\s+/g, " ").slice(0, 80);
  if (title.length < 2) return { ok: false, error: "Type your title (for example Owner)." };
  const admin = createSupabaseAdminClient();
  const vb = await admin.from("vendor_bank_details").select("status, released_by, released_at, release_mode, release_callback_note, bank_routing, bank_account_number, bank_account_type").eq("vendor_id", s.vendor_id).maybeSingle();
  const b = vb.data as { status: string; released_by: string | null; released_at: string | null; release_mode: string | null; release_callback_note: string | null; bank_routing: string; bank_account_number: string; bank_account_type: string } | null;
  // Same check as 0262, asked first so the message is clear and no PDF is stored for nothing.
  const rd = countersignReadiness(s, b);
  if (!rd.ready || !b || !b.released_at || !s.signed_at) return { ok: false, error: rd.ready ? vendorEsignDbErrorMessage("VENDOR_ESIGN_NOT_RELEASED") : rd.message };
  const relBy = b.released_by ? await admin.from("staff_profiles").select("full_name, email").eq("id", b.released_by).maybeSingle() : { data: null };
  const rb = (relBy.data as { full_name: string | null; email: string } | null) ?? null;
  const recDoc = s.record_document_id ? await admin.from("ach_authorization_documents").select("sha256").eq("id", s.record_document_id).maybeSingle() : { data: null };
  const acceptedAtIso = new Date(input.nowMs).toISOString();
  const bytes = buildTextPdf({
    title: "GW-ACH-V Greenway Acceptance",
    createdAtIso: acceptedAtIso,
    lines: acceptanceLines({
      inviteId: s.id,
      vendorLegalName: s.form?.legal_name ?? "",
      vendorSignerName: s.signer_name ?? "",
      vendorSignedAtIso: s.signed_at,
      recordSha256: (recDoc.data as { sha256: string } | null)?.sha256 ?? "",
      accountLast4: s.account_last4 ?? "",
      greenwaySigner: { name: input.actor.name, title, email: input.actor.email },
      acceptedAtIso,
      vault: { releasedBy: rb ? rb.full_name || rb.email : "unknown", releasedAtIso: b.released_at, mode: b.release_mode ?? "unknown" },
      callbackNote: (b.release_callback_note ?? "").slice(0, 300),
    }),
    footer: `GW-ACH-V acceptance ${pacificDate(acceptedAtIso)} | invite ${s.id}`,
  });
  const path = planDocumentPath({ payeeType: "vendor", payeeId: s.vendor_id, fileUuid: randomUUID(), mime: "application/pdf" });
  if (!path.ok) return { ok: false, error: path.refusal };
  const bucket = admin.storage.from(BUCKET);
  const up = await bucket.upload(path.objectKey, bytes, { contentType: "application/pdf", upsert: false });
  if (up.error) return { ok: false, error: `The acceptance page could not be stored: ${up.error.message}` };
  const { error } = await admin.rpc("vendor_esign_countersign", {
    p_invite_id: s.id,
    p_actor: input.actor.id,
    p_note: input.note.slice(0, 500),
    p_document: { storage_path: path.storagePath, sha256: sha256Hex(bytes), byte_size: bytes.length },
  });
  if (error) {
    await bucket.remove([path.objectKey]);
    return { ok: false, error: dbMsg(error, "staff") };
  }
  // The vendor's copy: acceptance + certificate (last 4 only; the full record stays in the private bucket).
  const to = plainEmail(s.email_enc);
  let mailed = false;
  if (to) {
    const attachments: { filename: string; content: Uint8Array }[] = [{ filename: "GW-ACH-V-greenway-acceptance.pdf", content: bytes }];
    const cert = s.certificate_document_id ? await documentBytes(s.certificate_document_id) : null;
    if (cert && cert.ok) attachments.push({ filename: "GW-ACH-V-esign-certificate.pdf", content: cert.bytes });
    const msg = countersignedNotice({ vendorName: s.form?.legal_name ?? "", accountLast4: s.account_last4 ?? "", effectivePacific: pacificDate(acceptedAtIso), greenwaySigner: `${input.actor.name}, ${title}` });
    const r = await input.mail([to], { ...msg, attachments });
    mailed = r.ok;
  }
  return { ok: true, mailed };
}

// ------------------------------------------------------------ documents ----

/** A stored document's bytes, re-checked against the recorded SHA-256. */
export async function documentBytes(documentId: string): Promise<{ ok: true; bytes: Uint8Array; sha256: string } | Fail> {
  const admin = createSupabaseAdminClient();
  const doc = await admin.from("ach_authorization_documents").select("storage_path, sha256").eq("id", documentId).maybeSingle();
  if (doc.error || !doc.data) return { ok: false, error: "The document could not be found." };
  const row = doc.data as { storage_path: string; sha256: string };
  const key = objectKeyFromStoragePath(row.storage_path);
  if (!key) return { ok: false, error: "The stored path is not one this app writes." };
  const dl = await admin.storage.from(BUCKET).download(key);
  if (dl.error || !dl.data) return { ok: false, error: "The document could not be read." };
  const bytes = new Uint8Array(await dl.data.arrayBuffer());
  const got = sha256Hex(bytes);
  if (got !== row.sha256) return { ok: false, error: "The stored file does not match its recorded SHA-256. Do not use it; tell the owner." };
  return { ok: true, bytes, sha256: got };
}

/**
 * The vendor's signed record (full numbers, as on paper) for the last
 * screen: only for the browser that signed, only while its 24-hour cookie
 * lives. A forwarded link alone never shows bank numbers.
 */
export async function vendorSignedCopy(token: string, cookie: string | null): Promise<{ ok: true; bytes: Uint8Array; sha256: string } | Fail> {
  const s = await getVendorInviteByToken(token);
  if (!s || (s.state !== "signed" && s.state !== "countersigned") || !s.record_document_id) return { ok: false, error: "Not available." };
  if (!browserMatches(s, cookie)) return { ok: false, error: "Not available." };
  return documentBytes(s.record_document_id);
}

// -------------------------------------------------------- participation ----

/** One row per vendor for the banking page's "how close are we to no checks" panel. */
export async function participationRows(nowMs: number = Date.now()): Promise<{ ready: boolean; rows: (ParticipationRow & { email: string | null; active: boolean })[] }> {
  if (!isSupabaseServiceConfigured) return { ready: false, rows: [] };
  const admin = createSupabaseAdminClient();
  const [vendors, vault, invites] = await Promise.all([
    admin.from("vendors").select("id, display_name, email, is_active, ach_opted_out"),
    admin.from("vendor_bank_details").select("vendor_id, status, verified_at"),
    admin.from(TABLE).select("vendor_id, state, expires_at").in("state", OPEN_STATES as unknown as string[]),
  ]);
  const ready = !invites.error;
  const vaultBy = new Map(((vault.data as { vendor_id: string; status: string; verified_at: string | null }[] | null) ?? []).map((r) => [r.vendor_id, r]));
  const invBy = new Map(((invites.data as { vendor_id: string; state: VendorEsignState; expires_at: string }[] | null) ?? []).map((r) => [r.vendor_id, r]));
  const rows = ((vendors.data as { id: string; display_name: string; email: string | null; is_active: boolean | null; ach_opted_out?: boolean }[] | null) ?? []).map((v) => {
    const vb = vaultBy.get(v.id);
    const iv = invBy.get(v.id);
    return {
      vendorId: v.id,
      name: v.display_name,
      email: v.email,
      active: v.is_active !== false,
      achActive: Boolean(vb && vb.status === "active" && vb.verified_at),
      optedOut: v.ach_opted_out === true,
      invite: iv?.state ?? null,
      inviteExpired: iv ? iv.state !== "signed" && inviteExpired(iv.expires_at, nowMs) : false,
    };
  });
  return { ready, rows };
}

// ------------------------------------------------------------- admin card ----

export type VendorEsignCardData = {
  ready: boolean;
  error: string | null;
  invites: VendorInvite[];
  /** Readiness of the newest signed invite (null when none waits). */
  countersign: CountersignReadinessView | null;
  names: Record<string, string>;
  nowMs: number;
};
export type CountersignReadinessView = { inviteId: string; ready: boolean; message: string | null };

/** Everything the vendor-page card shows. Clock read here (react-hooks/purity). */
export async function vendorEsignCard(vendorId: string): Promise<VendorEsignCardData> {
  const nowMs = Date.now();
  const list = await listVendorInvites(vendorId);
  if (!list.ready || list.error) return { ready: list.ready, error: list.error, invites: [], countersign: null, names: {}, nowMs };
  const admin = createSupabaseAdminClient();
  const waiting = list.invites.find((i) => i.state === "signed") ?? null;
  let countersign: CountersignReadinessView | null = null;
  if (waiting) {
    const vb = await admin.from("vendor_bank_details").select("status, released_at, bank_routing, bank_account_number, bank_account_type").eq("vendor_id", vendorId).maybeSingle();
    const rd = countersignReadiness(waiting, (vb.data as Parameters<typeof countersignReadiness>[1]) ?? null);
    countersign = { inviteId: waiting.id, ready: rd.ready, message: rd.ready ? null : rd.message };
  }
  const ids = Array.from(new Set(list.invites.flatMap((i) => [i.invited_by, i.countersigned_by, i.rejected_by, i.cancelled_by]).filter((x): x is string => Boolean(x))));
  const names: Record<string, string> = {};
  if (ids.length) {
    const sp = await admin.from("staff_profiles").select("id, full_name, email").in("id", ids);
    for (const r of (sp.data as { id: string; full_name: string | null; email: string }[] | null) ?? []) names[r.id] = r.full_name || r.email;
  }
  return { ready: true, error: null, invites: list.invites, countersign, names, nowMs };
}
