/**
 * src/lib/payments/vendor-esign-core.ts  (R39 S7, PURE)
 *
 * Vendors sign form GW-ACH-V electronically, from a one-time link.
 *
 * Owner request: "i want the vendor side to also utilize the e-sign feature.
 * i need this process to be as simple and painless as possible, so the
 * participation rate is very high." So the vendor sees three short screens:
 *   1. "Email me a code"   (the code goes to the address Greenway sent the link to)
 *   2. type the code, read the short disclosure, tick "I agree"
 *   3. one form: business details (pre-filled from Greenway's records), bank
 *      details, a photo of a voided check, name + title, Sign.
 * Greenway then calls back, releases the hold (0259), and countersigns.
 *
 * Nothing about the link is trusted on its own. 0262 decides what can be
 * stored, and 0259 still decides whether money can ever go to the account.
 *
 * Law and rules this follows (sources verified for R39):
 *  - WAC 314-55-115(3)(a): EFT is voluntary for both sides, no discrimination
 *    for not participating. Every screen and email says paper check stays
 *    available; nothing here can make ACH a condition of doing business.
 *  - WAC 314-55-115(3)(b): a written EFT agreement before the first EFT. The
 *    signed record carries the whole agreement verbatim (ACH_V_TERMS).
 *  - RCW 1.80.040(2) (UETA): the parties agree to transact electronically -
 *    the consent step. RCW 1.80.070 / .080 / .110: an e-signature has legal
 *    effect; attribution may be shown by "the efficacy of any security
 *    procedure"; the record is retained accurately and can be reproduced.
 *  - E-SIGN 15 U.S.C. 7001(c) consumer disclosures do not strictly apply to a
 *    business (7006(1) "consumer" = individual, personal/family/household
 *    purposes), but the same disclosure is given anyway: it costs nothing
 *    and removes any argument (VENDOR_ESIGN_DISCLOSURE).
 *  - Nacha Rules, fraud monitoring (Phase 2 from 2026-06-19) and "False
 *    Pretenses": a change of bank details is verified by a callback to a
 *    number Greenway already has, never one typed in the request
 *    (GW-ACH-V Terms 8.1). The phones typed here are kept in the form JSON
 *    only and are labeled "as typed by the vendor - not for callback".
 *  - NIST SP 800-63B-4: email is not an authenticator. The code only shows
 *    the vendor can receive email at the invited address. The link token,
 *    code and browser cookie are random, single-purpose, stored only as
 *    keyed hashes, and limited (sends, attempts, 10-minute code life,
 *    14-day link life, 24-hour consent life).
 */
import { ACH_V_TERMS, ACH_V_TERMS_SHA256 } from "@/lib/payments/vendor-esign-terms";
import type { PdfLine } from "@/lib/payments/pdf-text-core";
import { checkDocumentUpload, last4, type DocKind, type DocMime } from "@/lib/payments/ach-document-intake-core";
import { isValidRouting } from "@/lib/payments/nacha-core";
import { normalizeUsPhone } from "@/lib/payments/ach-authorization-core";
import { escapeHtml } from "@/lib/payments/vault-release-notice-core";
import { canonicalJson, checkEmail, maskEmail, normalizeName, pacificDate } from "@/lib/payments/ach-esign-core";

export { canonicalJson, checkEmail, maskEmail, pacificDate };

// ---------------------------------------------------------------------------
// Greenway's public contacts (printed on page 1 of GW-ACH-V)
// ---------------------------------------------------------------------------
export const GREENWAY_CONTACTS = {
  company: "Lyman's Marijuana d/b/a Greenway Marijuana",
  address: "4851 Geiger Rd SE, Port Orchard, WA 98366",
  store: "360-443-6988",
  stephen: { name: "Stephen Benoit", phone: "360-621-7977", email: "stephen@greenwaymarijuana.com" },
  michael: { name: "Michael Lyman", phone: "360-204-1119", email: "michael@greenwaymarijuana.com" },
} as const;

// ---------------------------------------------------------------------------
// Limits (0262 CHECKs are the ceiling; the app is at or under them)
// ---------------------------------------------------------------------------
/** 0262 vesign_expiry_window: expires_at <= invited_at + 30 days. */
export const INVITE_MAX_DAYS = 30;
export const INVITE_TTL_DAYS = 14;
export const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;
/** 0262 vendor_esign_complete VENDOR_ESIGN_STALE: code_verified_at within 24 hours. */
export const CONSENT_FRESH_MS = 24 * 60 * 60 * 1000;
export const OTP_DIGITS = 6;
export const OTP_TTL_MS = 10 * 60 * 1000;
/** 0262 otp_sends between 0 and 5. */
export const VENDOR_OTP_MAX_SENDS = 5;
/** 0262 otp_attempts between 0 and 5. Counted over the life of the link. */
export const VENDOR_OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
/**
 * Bank proof upload limit. 0262 allows 25 MB, but a Vercel Function request
 * body is capped at 4.5 MB, so the form refuses more than 4 MB with a clear
 * message (the page also shrinks phone photos before sending).
 */
export const VENDOR_PROOF_MAX_BYTES = 4 * 1024 * 1024;
export const TOKEN_BYTES = 32;
export const BROWSER_COOKIE = "gw_vesign";

// ---------------------------------------------------------------------------
// Tokens and digests (input formats pinned by tests/compliance/r39-keyed-hash.test.ts)
// ---------------------------------------------------------------------------
const B64URL = /^[A-Za-z0-9_-]{43}$/;

/** 32 random bytes as base64url (43 characters, no padding). */
export function makeToken(randomBytes: (n: number) => Uint8Array): string {
  const b = randomBytes(TOKEN_BYTES);
  if (!(b instanceof Uint8Array) || b.length !== TOKEN_BYTES) throw new Error("makeToken: random source returned the wrong length");
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  const s = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  if (!B64URL.test(s)) throw new Error("makeToken: encoding failed");
  return s;
}
export function isTokenShape(s: string | null | undefined): boolean {
  return B64URL.test(String(s ?? ""));
}
/** The only thing stored about the link: hmac("vesign-token|" + token) with purpose vendorEsignToken. */
export function tokenDigest(hmac: (s: string) => string, token: string): string {
  return hmac(`vesign-token|${token}`);
}
/** hmac("vesign-otp|" + inviteId + "|" + code), purpose vendorEsignOtp. */
export function vendorOtpDigest(hmac: (s: string) => string, inviteId: string, code: string): string {
  return hmac(`vesign-otp|${inviteId}|${code}`);
}
/** hmac("vesign-browser|" + inviteId + "|" + cookie), purpose vendorEsignBrowser. */
export function browserDigest(hmac: (s: string) => string, inviteId: string, cookie: string): string {
  return hmac(`vesign-browser|${inviteId}|${cookie}`);
}

export function makeOtp(randomInt: (maxExclusive: number) => number): string {
  const n = randomInt(10 ** OTP_DIGITS);
  if (!Number.isInteger(n) || n < 0 || n >= 10 ** OTP_DIGITS) throw new Error("makeOtp: random source out of range");
  return String(n).padStart(OTP_DIGITS, "0");
}

// ---------------------------------------------------------------------------
// Disclosure (E-SIGN 7001(c)(1)(B)/(C) given as good practice; UETA 1.80.040(2))
// ---------------------------------------------------------------------------
export const VENDOR_ESIGN_DISCLOSURE_VERSION = "GW-VESIGN-1";

export const VENDOR_ESIGN_DISCLOSURE: readonly { clause: string; text: string }[] = [
  { clause: "intro", text: "Lyman's Marijuana d/b/a Greenway Marijuana (\"Greenway\") asks whether your business agrees to sign the Vendor Payment Authorization and EFT Agreement (form GW-ACH-V) electronically and to keep it as an electronic record." },
  { clause: "voluntary", text: "ACH is optional. Greenway keeps paying by paper check if you do not sign, and no vendor is treated differently for choosing checks (WAC 314-55-115(3)(a))." },
  { clause: "B.i.I", text: "Paper option. You do not have to sign electronically. You may ask for the paper form at any time, at no charge, by calling the store at 360-443-6988 or emailing stephen@greenwaymarijuana.com." },
  { clause: "B.ii", text: "What this consent covers. Only this one agreement, the signing certificate that goes with it, and Greenway's countersigned acceptance." },
  { clause: "B.i.II", text: "Withdrawing consent. You may withdraw this consent at any time by written notice under Section 22 of the Terms. There is no fee and no penalty. Withdrawing does not undo a signature already made; Greenway will offer the paper form." },
  { clause: "B.iii", text: "Updating your email. To change the email address Greenway uses for this record, tell Greenway in writing as in Section 22, or by phone at a number on this page." },
  { clause: "B.iv", text: "Paper copy. You can download the signed agreement on the last screen, and you may ask for a paper copy at any time, free of charge." },
  { clause: "C.i", text: "What you need. A device with a current web browser (for example Chrome, Safari, Edge or Firefox), a program that opens PDF files (most browsers do), and access to the email address this link was sent to." },
  { clause: "C.ii", text: "Showing you can open electronic records. Greenway emails a 6-digit code to the address this link was sent to. Typing it here shows you can receive email from Greenway. The code expires after 10 minutes." },
  { clause: "safety", text: "Greenway will never ask you to send money, and will never change bank details because of an email alone. Before your first ACH payment Greenway will phone you at a number it already has on file to confirm. If anything looks wrong, call Stephen Benoit at 360-621-7977, Michael Lyman at 360-204-1119, or the store at 360-443-6988." },
];

export const VENDOR_CONSENT_STATEMENT =
  "I have read the disclosure above. On behalf of the vendor, I agree to sign the GW-ACH-V agreement electronically and to receive and keep it as an electronic record. I can open PDF files and read email at this address.";

export const VENDOR_INTENT_STATEMENT =
  "By typing my full name and title and pressing Sign, I sign this Vendor Payment Authorization and EFT Agreement electronically for the vendor named above. I intend this to be my signature, with the same effect as signing by hand.";

export function vendorDisclosureBody(): { version: string; paragraphs: readonly { clause: string; text: string }[]; consent: string; intent: string } {
  return { version: VENDOR_ESIGN_DISCLOSURE_VERSION, paragraphs: VENDOR_ESIGN_DISCLOSURE, consent: VENDOR_CONSENT_STATEMENT, intent: VENDOR_INTENT_STATEMENT };
}

// ---------------------------------------------------------------------------
// States (identical to 0262 vendor_esign_guard)
// ---------------------------------------------------------------------------
export const VENDOR_ESIGN_STATES = ["sent", "code_sent", "consented", "signed", "countersigned", "rejected", "cancelled"] as const;
export type VendorEsignState = (typeof VENDOR_ESIGN_STATES)[number];

export const VENDOR_ESIGN_MOVES: Readonly<Record<VendorEsignState, readonly VendorEsignState[]>> = {
  sent: ["code_sent", "cancelled"],
  code_sent: ["consented", "cancelled"],
  consented: ["code_sent", "signed", "cancelled"],
  signed: ["countersigned", "rejected"],
  countersigned: [],
  rejected: [],
  cancelled: [],
};
export function canMoveVendorEsign(from: VendorEsignState, to: VendorEsignState): boolean {
  return VENDOR_ESIGN_MOVES[from].includes(to);
}
/** 0262 vendor_esign_one_open_per_vendor. */
export const OPEN_STATES: readonly VendorEsignState[] = ["sent", "code_sent", "consented", "signed"];

export const VENDOR_ESIGN_LABELS: Readonly<Record<VendorEsignState, string>> = {
  sent: "Link sent, not opened yet",
  code_sent: "Vendor asked for a code",
  consented: "Vendor is filling in the form",
  signed: "Signed by vendor - call back, release, countersign",
  countersigned: "Countersigned - in effect",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export function inviteExpired(expiresAtIso: string, nowMs: number): boolean {
  const t = Date.parse(expiresAtIso);
  return !Number.isFinite(t) || nowMs > t;
}
export function consentStale(codeVerifiedAtIso: string | null, nowMs: number): boolean {
  if (!codeVerifiedAtIso) return true;
  const t = Date.parse(codeVerifiedAtIso);
  return !Number.isFinite(t) || nowMs - t > CONSENT_FRESH_MS;
}
export function inviteExpiresAt(invitedAtMs: number, days: number = INVITE_TTL_DAYS): string {
  if (!Number.isInteger(days) || days < 1 || days > INVITE_MAX_DAYS) throw new Error("inviteExpiresAt: 1 to 30 days");
  return new Date(invitedAtMs + days * 24 * 60 * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// OTP checks
// ---------------------------------------------------------------------------
export type VendorOtpState = { otpDigest: string | null; otpSentAtIso: string | null; otpSends: number; otpAttempts: number };

export function canSendVendorOtp(s: VendorOtpState, nowMs: number): { ok: true } | { ok: false; error: string } {
  if (s.otpSends >= VENDOR_OTP_MAX_SENDS) return { ok: false, error: `The code has been sent ${VENDOR_OTP_MAX_SENDS} times for this link. Ask Greenway to send you a new link (store 360-443-6988).` };
  if (s.otpAttempts >= VENDOR_OTP_MAX_ATTEMPTS) return { ok: false, error: "Too many wrong codes for this link. Ask Greenway to send you a new link (store 360-443-6988)." };
  if (s.otpSentAtIso) {
    const wait = Date.parse(s.otpSentAtIso) + OTP_RESEND_COOLDOWN_MS - nowMs;
    if (wait > 0) return { ok: false, error: `Please wait ${Math.ceil(wait / 1000)} seconds before asking for another code.` };
  }
  return { ok: true };
}

export type VendorOtpVerdict = { ok: true } | { ok: false; error: string; countAttempt: boolean; locked: boolean };

export function vendorOtpVerdict(
  s: VendorOtpState,
  typed: string,
  nowMs: number,
  digestOf: (code: string) => string,
  same: (a: string, b: string) => boolean,
): VendorOtpVerdict {
  const lockedMsg = "Too many wrong codes for this link. Ask Greenway to send you a new link (store 360-443-6988).";
  if (s.otpAttempts >= VENDOR_OTP_MAX_ATTEMPTS) return { ok: false, error: lockedMsg, countAttempt: false, locked: true };
  if (!s.otpDigest || !s.otpSentAtIso) return { ok: false, error: "No code has been sent yet. Press \"Email me a code\".", countAttempt: false, locked: false };
  const code = String(typed ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { ok: false, error: "Type the 6-digit code from the email.", countAttempt: false, locked: false };
  if (nowMs - Date.parse(s.otpSentAtIso) > OTP_TTL_MS) return { ok: false, error: "That code has expired. Press \"Email me a new code\".", countAttempt: false, locked: false };
  if (!same(digestOf(code), s.otpDigest)) {
    const left = VENDOR_OTP_MAX_ATTEMPTS - s.otpAttempts - 1;
    return { ok: false, error: left > 0 ? `That code is not right. ${left} ${left === 1 ? "try" : "tries"} left.` : lockedMsg, countAttempt: true, locked: left <= 0 };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Which screen
// ---------------------------------------------------------------------------
export type VendorEsignStep =
  | "send_code" // press "Email me a code"
  | "enter_code" // type it + consent
  | "fill" // the one form
  | "other_browser" // consented on another device: get a new code here
  | "stale" // consent older than 24 h: get a new code
  | "locked" // attempts or sends used up
  | "signed"
  | "countersigned"
  | "rejected"
  | "cancelled"
  | "expired";

export function vendorEsignStep(inv: {
  state: VendorEsignState;
  expiresAtIso: string;
  codeVerifiedAtIso: string | null;
  otpSends: number;
  otpAttempts: number;
  browserMatches: boolean;
}, nowMs: number): VendorEsignStep {
  if (inv.state === "signed") return "signed";
  if (inv.state === "countersigned") return "countersigned";
  if (inv.state === "rejected") return "rejected";
  if (inv.state === "cancelled") return "cancelled";
  if (inviteExpired(inv.expiresAtIso, nowMs)) return "expired";
  const canSend = inv.otpSends < VENDOR_OTP_MAX_SENDS && inv.otpAttempts < VENDOR_OTP_MAX_ATTEMPTS;
  if (inv.state === "consented") {
    if (!inv.browserMatches) return canSend ? "other_browser" : "locked";
    if (consentStale(inv.codeVerifiedAtIso, nowMs)) return canSend ? "stale" : "locked";
    return "fill";
  }
  if (inv.otpAttempts >= VENDOR_OTP_MAX_ATTEMPTS) return "locked";
  if (inv.state === "code_sent") return "enter_code";
  return canSend ? "send_code" : "locked";
}

// ---------------------------------------------------------------------------
// The vendor form (Parts 1 and 2 of GW-ACH-V)
// ---------------------------------------------------------------------------
export const ENTITY_TYPES = ["corporation", "llc", "partnership", "sole_proprietor", "other"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];
export const ENTITY_LABELS: Readonly<Record<EntityType, string>> = {
  corporation: "Corporation", llc: "LLC", partnership: "Partnership", sole_proprietor: "Sole proprietor", other: "Other",
};
export const VENDOR_KINDS = ["producer", "processor", "producer_processor", "non_cannabis"] as const;
export type VendorKind = (typeof VENDOR_KINDS)[number];
export const VENDOR_KIND_LABELS: Readonly<Record<VendorKind, string>> = {
  producer: "WA-licensed cannabis producer",
  processor: "WA-licensed cannabis processor",
  producer_processor: "Licensed producer/processor",
  non_cannabis: "Non-cannabis inventory vendor",
};
export const PROOF_KINDS = ["voided_check", "bank_letter", "statement"] as const;
export type ProofKind = (typeof PROOF_KINDS)[number];
export const PROOF_LABELS: Readonly<Record<ProofKind, string>> = {
  voided_check: "Voided check",
  bank_letter: "Bank letter on bank letterhead",
  statement: "Statement page showing name and account number (balance blacked out)",
};
/** 0262 proof_kind is voided_check | bank_letter | other; a statement page is filed as "other". */
export function proofDocKind(k: ProofKind): "voided_check" | "bank_letter" | "other" {
  return k === "statement" ? "other" : k;
}

/** What is stored in vendor_esign_invites.form: no bank numbers. */
export type VendorForm = {
  legal_name: string;
  dba: string;
  entity_type: EntityType;
  entity_other: string;
  vendor_kind: VendorKind;
  license_no: string;
  ubi: string;
  tin_last4: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  ar_contact: string;
  ar_phone: string;
  ar_email: string;
  second_contact: string;
  second_phone: string;
  second_email: string;
  request_type: "new" | "change";
  bank_name: string;
  bank_city_state: string;
  start_date: string;
  name_on_account: string;
  remittance_email: string;
  notes: string;
  proof_kind: ProofKind;
  /** Things the reviewer should look at before the callback. */
  review_flags: string[];
};

export type VendorBankInput = { routing: string; account: string; accountType: "checking" | "savings" };

export type VendorFormErrors = Partial<Record<keyof VendorForm | "routing" | "account" | "account2" | "account_type" | "proof", string>>;

export type VendorFormDefaults = Partial<Pick<VendorForm, "legal_name" | "dba" | "license_no" | "ubi" | "street" | "city" | "state" | "zip" | "ar_email" | "ar_phone">> & { request_type?: "new" | "change" };

const clean = (s: string | null | undefined, max: number) => normalizeName(String(s ?? "")).slice(0, max);
const BAD_CHARS = /[<>{}\\]/;

function looseName(a: string): string {
  return a.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(llc|inc|corp|co|ltd|lp|llp|pllc|company|corporation|incorporated)$/g, "");
}

/**
 * Read and check the vendor's form. Every message names the field, so the
 * page can show it next to the box. The second account-number typing must
 * match (the paper form's "re-enter account number to confirm"); the routing
 * number is checked with the ABA check digit.
 */
export function parseVendorForm(get: (k: string) => string | null | undefined, todayIso: string):
  | { ok: true; form: VendorForm; bank: VendorBankInput }
  | { ok: false; errors: VendorFormErrors } {
  const e: VendorFormErrors = {};
  const g = (k: string, max = 120) => clean(get(k), max);
  const req = (k: keyof VendorForm, label: string, min = 2, max = 120) => {
    const v = g(k, max + 1);
    if (v.length < min) e[k] = `${label} is required.`;
    else if (v.length > max) e[k] = `${label} is too long (${max} characters at most).`;
    else if (BAD_CHARS.test(v)) e[k] = `${label} has characters that are not allowed.`;
    return v;
  };
  const opt = (k: keyof VendorForm, label: string, max = 120) => {
    const v = g(k, max + 1);
    if (v.length > max) e[k] = `${label} is too long (${max} characters at most).`;
    else if (BAD_CHARS.test(v)) e[k] = `${label} has characters that are not allowed.`;
    return v;
  };

  const legal_name = req("legal_name", "Vendor legal name", 2, 200);
  const dba = opt("dba", "Doing business as", 200);
  const entity_type = g("entity_type") as EntityType;
  if (!(ENTITY_TYPES as readonly string[]).includes(entity_type)) e.entity_type = "Pick the entity type.";
  const entity_other = entity_type === "other" ? req("entity_other", "Describe the entity type", 2, 60) : "";
  const vendor_kind = g("vendor_kind") as VendorKind;
  if (!(VENDOR_KINDS as readonly string[]).includes(vendor_kind)) e.vendor_kind = "Pick the vendor type.";
  const license_no = g("license_no", 20).replace(/\s/g, "");
  if (vendor_kind && vendor_kind !== "non_cannabis" && !/^\d{6}$/.test(license_no)) e.license_no = "WSLCB license numbers are 6 digits (required for cannabis vendors).";
  else if (license_no && !/^\d{6}$/.test(license_no)) e.license_no = "WSLCB license numbers are 6 digits.";
  const ubiDigits = g("ubi", 20).replace(/[\s.-]/g, "");
  if (ubiDigits && !/^\d{9}$/.test(ubiDigits)) e.ubi = "A Washington UBI number is 9 digits.";
  if (!ubiDigits && vendor_kind !== "non_cannabis") e.ubi = "UBI number is required for Washington cannabis licensees (9 digits).";
  const tin_last4 = g("tin_last4", 10).replace(/\s/g, "");
  if (!/^\d{4}$/.test(tin_last4)) e.tin_last4 = "Type only the LAST 4 digits of the tax ID (EIN or SSN). Never the full number.";
  const street = req("street", "Street / mailing address", 3, 160);
  const city = req("city", "City", 2, 60);
  const state = g("state", 3).toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) e.state = "Use the 2-letter state (for example WA).";
  const zip = g("zip", 10);
  if (!/^\d{5}(-\d{4})?$/.test(zip)) e.zip = "ZIP is 5 digits (or ZIP+4).";

  const ar_contact = req("ar_contact", "Accounts-receivable contact (name and title)", 3, 120);
  const ar_phone_raw = g("ar_phone", 30);
  const ar_phone = normalizeUsPhone(ar_phone_raw) ?? "";
  if (!ar_phone) e.ar_phone = "Type a 10-digit US phone number (any format).";
  const are = checkEmail(g("ar_email", 254));
  if (!are.ok) e.ar_email = "Type a working email address for accounts receivable.";
  const second_contact = req("second_contact", "Second authorized contact (name and title)", 3, 120);
  const second_phone = normalizeUsPhone(g("second_phone", 30)) ?? "";
  if (!second_phone) e.second_phone = "Type a 10-digit US phone number (any format).";
  const se = checkEmail(g("second_email", 254));
  if (!se.ok) e.second_email = "Type a working email address for the second contact.";

  const rt = g("request_type");
  if (rt !== "new" && rt !== "change") e.request_type = "Pick New enrollment or Change to existing bank information.";
  const bank_name = req("bank_name", "Bank name", 2, 120);
  const bank_city_state = opt("bank_city_state", "Bank city and state", 80);
  const start_date = g("start_date", 10);
  if (start_date && (!/^\d{4}-\d{2}-\d{2}$/.test(start_date) || !Number.isFinite(Date.parse(start_date + "T00:00:00Z")))) e.start_date = "Use a date (YYYY-MM-DD), or leave it blank for as soon as verified.";
  else if (start_date && start_date < todayIso.slice(0, 10)) e.start_date = "The start date cannot be in the past. Leave it blank for as soon as verified.";

  const routing = String(get("routing") ?? "").replace(/[\s-]/g, "");
  if (!/^\d{9}$/.test(routing)) e.routing = "The routing number is exactly 9 digits (bottom left of a check).";
  else if (!isValidRouting(routing)) e.routing = "That routing number is not valid (its check digit does not match). Check each digit.";
  const account = String(get("account") ?? "").replace(/[\s-]/g, "");
  const account2 = String(get("account2") ?? "").replace(/[\s-]/g, "");
  if (!/^\d{4,17}$/.test(account)) e.account = "Account numbers are 4 to 17 digits.";
  else if (account !== account2) e.account2 = "The two account numbers do not match. Type it again.";
  if (routing && account && routing === account) e.account = "The account number is the same as the routing number. Check the numbers on the check.";
  const accountType = g("account_type");
  if (accountType !== "checking" && accountType !== "savings") e.account_type = "Pick checking or savings.";
  const name_on_account = req("name_on_account", "Name exactly as it appears on the account", 2, 200);
  const remRaw = g("remittance_email", 254);
  let remittance_email = "";
  if (remRaw) {
    const r = checkEmail(remRaw);
    if (!r.ok) e.remittance_email = "That remittance email does not look right (or leave it blank).";
    else remittance_email = r.email;
  }
  const notes = opt("notes", "Notes", 500);
  if (/\d{7,}/.test(notes)) e.notes = "Please do not put account or tax ID numbers in the notes.";
  const proof_kind = g("proof_kind") as ProofKind;
  if (!(PROOF_KINDS as readonly string[]).includes(proof_kind)) e.proof_kind = "Say what the bank proof is.";

  if (Object.keys(e).length) return { ok: false, errors: e };

  const review_flags: string[] = [];
  const holder = looseName(name_on_account);
  if (holder !== looseName(legal_name) && (!dba || holder !== looseName(dba))) {
    review_flags.push("Name on the account differs from the legal name and DBA. Terms 7.1(b) needs a business account in the vendor's legal or trade name: confirm on the callback.");
  }
  if (ar_phone === second_phone) review_flags.push("The two contacts have the same phone number; Terms 8.2 calls a second authorized contact.");
  if (are.ok && se.ok && are.email === se.email) review_flags.push("The two contacts have the same email address.");

  return {
    ok: true,
    form: {
      legal_name, dba, entity_type, entity_other, vendor_kind, license_no, ubi: ubiDigits, tin_last4,
      street, city, state, zip,
      ar_contact, ar_phone, ar_email: are.ok ? are.email : "", second_contact, second_phone, second_email: se.ok ? se.email : "",
      request_type: rt as "new" | "change", bank_name, bank_city_state, start_date, name_on_account, remittance_email, notes, proof_kind,
      review_flags,
    },
    bank: { routing, account, accountType: accountType as "checking" | "savings" },
  };
}

/** Bank proof: the shared intake checks (type sniffed from bytes, name, size) plus the 4 MB request cap. */
export function checkVendorProof(input: { bytes: Uint8Array; declaredMime: string | null | undefined; filename: string | null | undefined; kind: ProofKind }):
  | { ok: true; mime: DocMime; kind: "voided_check" | "bank_letter" | "other"; displayName: string; byteSize: number }
  | { ok: false; refusal: string } {
  if (input.bytes.length > VENDOR_PROOF_MAX_BYTES) {
    return { ok: false, refusal: `The file is ${(input.bytes.length / (1024 * 1024)).toFixed(1)} MB; the limit here is 4 MB. Take the photo again a little further away, or save the PDF at a lower quality.` };
  }
  const docKind = proofDocKind(input.kind);
  const v = checkDocumentUpload({ bytes: input.bytes, declaredMime: input.declaredMime, filename: input.filename, kind: docKind as DocKind });
  if (!v.ok) return v;
  return { ok: true, mime: v.mime, kind: docKind, displayName: v.displayName, byteSize: v.byteSize };
}

export function checkSigner(name: string, title: string): { ok: true; name: string; title: string } | { ok: false; errors: { signer_name?: string; signer_title?: string } } {
  const n = normalizeName(name);
  const t = normalizeName(title);
  const errors: { signer_name?: string; signer_title?: string } = {};
  if (n.length < 3 || n.length > 120 || !n.includes(" ") || !/\p{L}/u.test(n) || BAD_CHARS.test(n)) errors.signer_name = "Type your full name (first and last).";
  if (t.length < 2 || t.length > 80 || BAD_CHARS.test(t)) errors.signer_title = "Type your title (for example Owner, CFO or Office Manager).";
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, name: n, title: t };
}

/** Invite recipient, typed by Michael or Stephen. */
export function checkInviteRecipient(name: string, email: string): { ok: true; name: string; email: string } | { ok: false; error: string } {
  const n = normalizeName(name);
  if (n.length < 2 || n.length > 120 || BAD_CHARS.test(n)) return { ok: false, error: "Type who the link is for (a name, 2 to 120 characters)." };
  const e = checkEmail(email);
  if (!e.ok) return { ok: false, error: "Type the vendor's email address." };
  return { ok: true, name: n, email: e.email };
}

// ---------------------------------------------------------------------------
// The signed record, the certificate, Greenway's acceptance
// ---------------------------------------------------------------------------
function termsBlock(L: PdfLine[]): void {
  L.push({ kind: "h2", text: "3 Authorization (Credit-Only)" });
  for (const p of ACH_V_TERMS.part3) L.push({ kind: "p", text: p });
  L.push({ kind: "h2", text: "4 Washington Law: Payment Window for Cannabis Purchases (WAC 314-55-115, verbatim)" });
  for (const w of ACH_V_TERMS.wac) L.push({ kind: "p", text: w });
  L.push({ kind: "p", text: `What this means for you: ${ACH_V_TERMS.wacMeans}` });
  L.push({ kind: "h2", text: "5 Terms and Conditions" });
  for (const t of ACH_V_TERMS.terms) {
    if (t.k === "h") { L.push({ kind: "gap" }); L.push({ kind: "p", text: t.t.toUpperCase() }); }
    else L.push({ kind: "p", text: t.t });
  }
}

export type VendorRecordInput = {
  form: VendorForm;
  bank: VendorBankInput;
  vendorId: string;
  inviteId: string;
  signerName: string;
  signerTitle: string;
  signedAtIso: string;
  proof: { filename: string; sha256: string };
};

/** The agreement as signed: every Part, full numbers (as on paper), the terms verbatim. */
export function vendorRecordLines(r: VendorRecordInput): PdfLine[] {
  const f = r.form;
  const L: PdfLine[] = [];
  const row = (k: string, v: string) => L.push({ kind: "mono", text: `${(k + ":").padEnd(26)}${v || "-"}` });
  L.push({ kind: "h1", text: "Vendor Payment Authorization & EFT (ACH) Agreement" });
  L.push({ kind: "p", text: `Form ${ACH_V_TERMS.formId}  |  ${ACH_V_TERMS.formRev}  |  Signed electronically` });
  L.push({ kind: "p", text: `${GREENWAY_CONTACTS.company}, ${GREENWAY_CONTACTS.address}. WSLCB Lic. 413541. Paying bank: Timberland Bank (account ending 6048).` });
  L.push({ kind: "p", text: ACH_V_TERMS.intro });
  L.push({ kind: "rule" });
  L.push({ kind: "h2", text: "1 Vendor Information" });
  row("Vendor legal name", f.legal_name);
  row("Doing business as", f.dba);
  row("Entity type", f.entity_type === "other" ? `Other: ${f.entity_other}` : ENTITY_LABELS[f.entity_type]);
  row("Vendor type", VENDOR_KIND_LABELS[f.vendor_kind]);
  row("WSLCB license no.", f.license_no);
  row("UBI number", f.ubi);
  row("Tax ID last 4", f.tin_last4);
  row("Address", `${f.street}, ${f.city}, ${f.state} ${f.zip}`);
  row("A/R contact", f.ar_contact);
  row("  phone / email", `${f.ar_phone} / ${f.ar_email}`);
  row("Second contact", f.second_contact);
  row("  phone / email", `${f.second_phone} / ${f.second_email}`);
  L.push({ kind: "p", text: "Contact numbers above are as typed by the Vendor. Greenway verifies by calling a number it already has or finds independently (Terms 8.1)." });
  L.push({ kind: "h2", text: "2 Bank Account to Receive Payment" });
  row("Request type", f.request_type === "new" ? "New enrollment" : "Change to existing bank information");
  row("Bank", f.bank_name);
  row("Bank city & state", f.bank_city_state);
  row("Requested start date", f.start_date || "As soon as verified");
  row("ABA routing number", r.bank.routing);
  row("Account number", r.bank.account);
  row("Name on the account", f.name_on_account);
  row("Account type", r.bank.accountType === "checking" ? "Checking" : "Savings");
  row("Remittance email", f.remittance_email);
  row("Notes", f.notes);
  row("Bank proof attached", `${PROOF_LABELS[f.proof_kind]} (${r.proof.filename})`);
  row("  proof SHA-256", r.proof.sha256);
  L.push({ kind: "p", text: "The account number was typed twice by the Vendor and both entries matched; the routing number passed the ABA check digit." });
  termsBlock(L);
  L.push({ kind: "h2", text: "6 Signatures" });
  L.push({ kind: "p", text: `Vendor certification: ${ACH_V_TERMS.certification}` });
  L.push({ kind: "p", text: VENDOR_INTENT_STATEMENT });
  L.push({ kind: "gap" });
  L.push({ kind: "mono", text: `Vendor authorized signer: /s/ ${r.signerName}` });
  L.push({ kind: "mono", text: `Printed name:             ${r.signerName}` });
  L.push({ kind: "mono", text: `Title:                    ${r.signerTitle}` });
  L.push({ kind: "mono", text: `Date:                     ${pacificDate(r.signedAtIso)} (signed ${r.signedAtIso})` });
  L.push({ kind: "gap" });
  L.push({ kind: "p", text: `Greenway acceptance: ${ACH_V_TERMS.acceptance} Greenway's countersignature is filed as a separate signed page.` });
  L.push({ kind: "mono", text: `Vendor record: ${r.vendorId}   Invite: ${r.inviteId}` });
  L.push({ kind: "p", text: `Terms text SHA-256: ${ACH_V_TERMS_SHA256}. The signing certificate filed with this record lists the evidence of signing.` });
  return L;
}

export type VendorCertificateInput = {
  inviteId: string;
  vendorId: string;
  vendorLegalName: string;
  invitedBy: { name: string; email: string };
  invitedAtIso: string;
  emailMasked: string;
  emailOnFile: boolean;
  firstOpenedAtIso: string | null;
  disclosureSha256: string;
  codeSentAtIso: string;
  codeVerifiedAtIso: string;
  codeAttempts: number;
  consentedAtIso: string;
  signedAtIso: string;
  signerName: string;
  signerTitle: string;
  ip: string | null;
  userAgent: string;
  recordSha256: string;
  recordBytes: number;
  proofSha256: string;
  proofBytes: number;
  accountLast4: string;
  routingLast4: string;
};

export function vendorCertificateLines(c: VendorCertificateInput): PdfLine[] {
  const L: PdfLine[] = [];
  const row = (k: string, v: string) => L.push({ kind: "mono", text: `${(k + ":").padEnd(24)}${v}` });
  L.push({ kind: "h1", text: "Electronic Signature Certificate" });
  L.push({ kind: "p", text: `For: ${ACH_V_TERMS.formId} Vendor Payment Authorization & EFT Agreement, ${ACH_V_TERMS.formRev}` });
  L.push({ kind: "p", text: `${GREENWAY_CONTACTS.company}. Kept with the signed record (Terms Section 12).` });
  L.push({ kind: "rule" });
  L.push({ kind: "h2", text: "Signed record" });
  row("Record SHA-256", c.recordSha256);
  row("Record size", `${c.recordBytes} bytes`);
  row("Terms SHA-256", ACH_V_TERMS_SHA256);
  row("Bank proof SHA-256", `${c.proofSha256} (${c.proofBytes} bytes)`);
  row("Account (last 4)", c.accountLast4);
  row("Routing (last 4)", c.routingLast4);
  L.push({ kind: "h2", text: "Signer" });
  row("Vendor", c.vendorLegalName);
  row("Vendor record", c.vendorId);
  row("Typed signature", `/s/ ${c.signerName}`);
  row("Title", c.signerTitle);
  L.push({ kind: "h2", text: "How the signer was reached (security procedure, RCW 1.80.080)" });
  row("Link sent by", `${c.invitedBy.name} <${c.invitedBy.email}>`);
  row("Link sent", c.invitedAtIso);
  row("Link sent to", `${c.emailMasked} (${c.emailOnFile ? "the email on Greenway's vendor record" : "typed by Greenway when sending"})`);
  row("Link first opened", c.firstOpenedAtIso ?? "not recorded");
  row("Code emailed to", `${c.emailMasked} (always the address the link went to)`);
  row("Code sent", c.codeSentAtIso);
  row("Code confirmed", `${c.codeVerifiedAtIso} (wrong tries on this link: ${c.codeAttempts})`);
  row("Browser", "bound at consent by a one-time cookie; signing from another browser needs a new code");
  L.push({ kind: "h2", text: "Consent to electronic records (RCW 1.80.040(2); 15 U.S.C. 7001(c))" });
  row("Disclosure", `${VENDOR_ESIGN_DISCLOSURE_VERSION}, SHA-256 ${c.disclosureSha256}`);
  row("Consent recorded", c.consentedAtIso);
  L.push({ kind: "p", text: `Consent statement: "${VENDOR_CONSENT_STATEMENT}"` });
  L.push({ kind: "h2", text: "Signature" });
  row("Signed at", c.signedAtIso);
  row("IP address", c.ip ?? "not available");
  L.push({ kind: "mono", text: `User agent: ${c.userAgent || "not available"}` });
  L.push({ kind: "p", text: `Intent statement shown: "${VENDOR_INTENT_STATEMENT}"` });
  L.push({ kind: "rule" });
  L.push({ kind: "p", text: "Legal basis: Washington Uniform Electronic Transactions Act, chapter 1.80 RCW (RCW 1.80.070 legal effect; 1.80.080 attribution; 1.80.110 retention); E-SIGN Act, 15 U.S.C. 7001. Before any payment Greenway verifies the account by callback to a number it already has (Terms 8.1) and releases it under dual control." });
  return L;
}

export type AcceptanceInput = {
  inviteId: string;
  vendorLegalName: string;
  vendorSignerName: string;
  vendorSignedAtIso: string;
  recordSha256: string;
  accountLast4: string;
  greenwaySigner: { name: string; title: string; email: string };
  acceptedAtIso: string;
  vault: { releasedBy: string; releasedAtIso: string; mode: string };
  callbackNote: string;
};

/** Form Part 6 "ACCEPTED: LYMAN'S MARIJUANA d/b/a GREENWAY MARIJUANA" as its own signed page. */
export function acceptanceLines(a: AcceptanceInput): PdfLine[] {
  const L: PdfLine[] = [];
  const row = (k: string, v: string) => L.push({ kind: "mono", text: `${(k + ":").padEnd(24)}${v}` });
  L.push({ kind: "h1", text: "Greenway Acceptance (Countersignature)" });
  L.push({ kind: "p", text: `${ACH_V_TERMS.formId} ${ACH_V_TERMS.formRev}, Part 6. ${ACH_V_TERMS.acceptance}` });
  L.push({ kind: "rule" });
  row("Vendor", a.vendorLegalName);
  row("Signed by vendor", `${a.vendorSignerName}, ${a.vendorSignedAtIso}`);
  row("Vendor record SHA-256", a.recordSha256);
  row("Account (last 4)", a.accountLast4);
  row("Invite", a.inviteId);
  L.push({ kind: "h2", text: "Internal verification (GW-ACH-V-INT)" });
  row("Callback", a.callbackNote || "recorded in the vault release");
  row("Vault released by", `${a.vault.releasedBy} (${a.vault.mode}) at ${a.vault.releasedAtIso}`);
  L.push({ kind: "h2", text: "Accepted: Lyman's Marijuana d/b/a Greenway Marijuana" });
  L.push({ kind: "mono", text: `Authorized Greenway signer: /s/ ${a.greenwaySigner.name}` });
  L.push({ kind: "mono", text: `Printed name:               ${a.greenwaySigner.name} <${a.greenwaySigner.email}>` });
  L.push({ kind: "mono", text: `Title:                      ${a.greenwaySigner.title}` });
  L.push({ kind: "mono", text: `Date:                       ${pacificDate(a.acceptedAtIso)} (signed ${a.acceptedAtIso})` });
  L.push({ kind: "p", text: `Effective Date (Terms 1.1): ${pacificDate(a.acceptedAtIso)}.` });
  return L;
}

// ---------------------------------------------------------------------------
// Emails (escape everything that came from a person)
// ---------------------------------------------------------------------------
const SAFETY_HTML =
  "<p style=\"font-size:13px;color:#555\">Greenway will never ask you to send money or to change bank details by email alone. " +
  "Not sure this is really from Greenway? Do not use the link: call Stephen Benoit 360-621-7977, Michael Lyman 360-204-1119, or the store 360-443-6988.</p>";

export function inviteEmail(i: { link: string; vendorName: string; recipientName: string; inviterName: string; expiresPacific: string }): { subject: string; html: string; text: string } {
  if (!/^https:\/\/[^\s"'<>]+\/vendor-ach\/[A-Za-z0-9_-]{43}$/.test(i.link) && !/^http:\/\/localhost(:\d+)?\/vendor-ach\/[A-Za-z0-9_-]{43}$/.test(i.link)) {
    throw new Error("inviteEmail: link must be an https /vendor-ach/<token> URL");
  }
  const v = escapeHtml(i.vendorName);
  const who = escapeHtml(i.recipientName);
  const by = escapeHtml(i.inviterName);
  const exp = escapeHtml(i.expiresPacific);
  const html =
    `<p>Hi ${who},</p>` +
    `<p>${by} at Greenway Marijuana (Port Orchard) invites <strong>${v}</strong> to be paid by <strong>direct deposit (ACH)</strong> instead of paper check. ` +
    "It takes about 5 minutes: you get a code by email, fill in one page, add a photo of a voided check, and sign on screen.</p>" +
    `<p><a href="${escapeHtml(i.link)}" style="display:inline-block;background:#1f5135;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600">Set up direct deposit</a></p>` +
    `<p>The link works until ${exp} and only for this email address. It is credit-only: Greenway can send money to you, never take it.</p>` +
    "<p>ACH is optional. If you prefer, keep being paid by check: nothing changes and no vendor is treated differently.</p>" +
    SAFETY_HTML;
  const text =
    `Hi ${i.recipientName},\n\n${i.inviterName} at Greenway Marijuana (Port Orchard) invites ${i.vendorName} to be paid by direct deposit (ACH) instead of paper check. ` +
    "It takes about 5 minutes.\n\n" + `Set up direct deposit: ${i.link}\n\n` +
    `The link works until ${i.expiresPacific} and only for this email address. Credit-only: Greenway can send money to you, never take it.\n\n` +
    "ACH is optional; paper check stays available.\n\n" +
    "Greenway will never ask you to send money or to change bank details by email alone. Not sure? Call Stephen 360-621-7977, Michael 360-204-1119, or the store 360-443-6988.";
  return { subject: `Greenway Marijuana: get paid by direct deposit (${i.vendorName.replace(/[\r\n]/g, " ").slice(0, 60)})`, html, text };
}

export function vendorOtpEmail(code: string): { subject: string; html: string; text: string } {
  if (!/^\d{6}$/.test(code)) throw new Error("vendorOtpEmail: code must be 6 digits");
  const html =
    `<p>Your Greenway direct deposit code is <strong style="font-size:20px;letter-spacing:3px">${code}</strong>.</p>` +
    "<p>Type it on the Greenway page you have open. It expires in 10 minutes.</p>" +
    "<p>If you did not ask for this code, ignore this email and tell Greenway (store 360-443-6988).</p>";
  const text = `Your Greenway direct deposit code is ${code}.\n\nType it on the Greenway page you have open. It expires in 10 minutes.\n\nIf you did not ask for this code, ignore this email and tell Greenway (store 360-443-6988).`;
  return { subject: "Your Greenway direct deposit code", html, text };
}

export type VendorSignedNoticeInput = {
  vendorName: string;
  signerName: string;
  accountLast4: string;
  whenPacific: string;
  requestType: "new" | "change";
  inviterName: string;
  reviewFlags: readonly string[];
  vendorPageUrl: string;
};

/**
 * After the vendor signs: a receipt to the invited address (a change of bank
 * account is the classic payment-diversion fraud, so the real contact hears
 * about it) and a to-do to Stephen, Michael and the store. Last 4 only.
 */
export function vendorSignedNotices(i: VendorSignedNoticeInput): { vendor: { subject: string; html: string }; owners: { subject: string; html: string } } {
  const v = escapeHtml(i.vendorName);
  const s = escapeHtml(i.signerName);
  const t = escapeHtml(i.accountLast4);
  const w = escapeHtml(i.whenPacific);
  const flags = i.reviewFlags.length ? `<p><strong>Check on the callback:</strong></p><ul>${i.reviewFlags.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>` : "";
  return {
    vendor: {
      subject: "Greenway received your direct deposit form",
      html:
        `<p>Thank you. ${s} signed the Greenway direct deposit agreement for ${v} on ${w} (account ending &bull;&bull;&bull;&bull;${t}).</p>` +
        "<p>Next: Greenway will <strong>phone you at a number it already has on file</strong> to confirm, then countersign. Until then you keep being paid by check, on the same legal timeline.</p>" +
        "<p>If you did not sign this, call Greenway right away: Stephen 360-621-7977, Michael 360-204-1119, or the store 360-443-6988.</p>",
    },
    owners: {
      subject: `Vendor ACH e-signed: ${i.vendorName.replace(/[\r\n]/g, " ").slice(0, 80)} - call back to release`,
      html:
        `<p>${v} e-signed GW-ACH-V on ${w} (signer ${s}). ${i.requestType === "new" ? "New enrollment." : "<strong>Change of bank details.</strong>"} Account ending &bull;&bull;&bull;&bull;${t}. Link sent by ${escapeHtml(i.inviterName)}.</p>` +
        "<p>The banking is <strong>ON HOLD</strong>. To finish: (1) call the vendor at a number you already had (not one typed on the form) and confirm the tax ID last 4 and account last 4; " +
        "(2) Michael releases the hold in Settings &rarr; Banking (Stephen's release is sent to Michael for approval); (3) Michael countersigns on the vendor's page.</p>" +
        flags +
        `<p><a href="${escapeHtml(i.vendorPageUrl)}">Open the vendor</a></p>`,
    },
  };
}

export function countersignedNotice(i: { vendorName: string; accountLast4: string; effectivePacific: string; greenwaySigner: string }): { subject: string; html: string } {
  return {
    subject: "Greenway direct deposit is set up",
    html:
      `<p>Greenway countersigned the direct deposit agreement for ${escapeHtml(i.vendorName)} on ${escapeHtml(i.effectivePacific)} (${escapeHtml(i.greenwaySigner)}). ` +
      `Future invoice payments go by ACH to the account ending &bull;&bull;&bull;&bull;${escapeHtml(i.accountLast4)}. The countersigned copy is attached.</p>` +
      "<p>To change bank details later, Greenway sends you a new link; it never acts on an email alone.</p>" + SAFETY_HTML,
  };
}

// ---------------------------------------------------------------------------
// Database refusals (0262) in words a person can act on
// ---------------------------------------------------------------------------
export function vendorEsignDbErrorMessage(message: string | null | undefined, audience: "vendor" | "staff" = "staff"): string {
  const m = String(message ?? "");
  const vend = audience === "vendor";
  if (/vendor_esign_invites|vendor_esign_complete|vendor_esign_countersign|vendor_esign_reject/.test(m) && /does not exist|Could not find|PGRST20[25]|42P01|42883/.test(m)) {
    return vend ? "This page is not available yet. Please call Greenway at 360-443-6988." : "One-time setup needed: apply migration 0262 (docs/MIGRATIONS_TO_RUN.md), then try again.";
  }
  const table: [RegExp, string, string][] = [
    [/vendor_esign_one_open_per_vendor/, "This vendor already has a link out (or a signed form waiting). Cancel it, or finish it, first.", "Greenway already sent a link for this business. Use the most recent email."],
    [/VENDOR_ESIGN_EXPIRED|vesign_expiry_window/, "The link has expired. Send a new one.", "This link has expired. Ask Greenway for a new one (store 360-443-6988)."],
    [/VENDOR_ESIGN_STALE/, "The code was confirmed more than 24 hours ago; the vendor must get a new code.", "For your security, please get a new code (it has been more than 24 hours)."],
    [/VENDOR_ESIGN_PROOF/, "The bank proof is missing or was rejected before.", "Attach a different photo of a voided check, a bank letter, or a statement page."],
    [/VENDOR_ESIGN_NAME/, "The signer's full name (first and last) is required.", "Type your full name (first and last)."],
    [/VENDOR_ESIGN_TITLE/, "The signer's title is required.", "Type your title (for example Owner or CFO)."],
    [/VENDOR_ESIGN_FORM/, "The vendor information is incomplete.", "Some business details are missing. Check the form."],
    [/VENDOR_ESIGN_BANK/, "The bank details are incomplete or were not encrypted (is DATA_ENCRYPTION_KEY set?).", "The bank details could not be saved. Please try again."],
    [/VENDOR_ESIGN_FILES/, "The signed files could not be filed. Nothing was saved; try again.", "The signed copy could not be saved. Nothing was submitted; please press Sign again."],
    [/VENDOR_ESIGN_NOT_RELEASED/, "Call the vendor back and release the vault hold for exactly the banking they signed (in Settings > Banking) before countersigning.", "Greenway is still verifying."],
    [/VENDOR_ESIGN_AUTH/, "The authorization is not waiting for acceptance (was it put on hold or revoked?).", "Greenway is still verifying."],
    [/VENDOR_ESIGN_REASON|vesign_rejected_shape/, "Say why the form is rejected (10 characters or more).", "Greenway is still verifying."],
    [/vesign_cancelled_shape/, "Say why the link is cancelled (5 characters or more).", "This link was cancelled."],
    [/VENDOR_ESIGN_KEEP/, "A signed invite is evidence and is kept; it cannot be deleted.", "This form has already been submitted."],
    [/VENDOR_ESIGN_IMMUTABLE/, "Who the link went to, and when, cannot be changed. Cancel it and send a new link.", "This link cannot be changed. Ask Greenway for a new one."],
    [/VENDOR_ESIGN_ACTOR/, "Sign in again: the Greenway signer must be recorded.", "Greenway is still verifying."],
    [/VENDOR_ESIGN_STATE|VENDOR_ESIGN_TRANSITION|VENDOR_ESIGN_FINAL|VENDOR_ESIGN_SIGNED/, "This link has moved on (signed, cancelled or finished). Reload the page.", "This form has already been submitted or the link is closed. Reload the page."],
    [/VENDOR_ESIGN_NOT_FOUND/, "That link no longer exists. Reload the page.", "This link is not valid. Ask Greenway for a new one."],
    [/VENDOR_ESIGN_COUNTERS|otp_attempts_check|otp_sends_check|vendor_esign_invites_otp/, "Too many codes or tries on this link. Send a new link.", "Too many codes or tries. Ask Greenway for a new link (store 360-443-6988)."],
    [/VENDOR_ESIGN_TIME/, "The server clock looks wrong. Try again in a minute.", "Please try again in a minute."],
    [/VAULT_/, "The vault refused the change (0259). Check the hold on Settings > Banking.", "Greenway is still verifying."],
  ];
  for (const [re, staff, vendor] of table) if (re.test(m)) return vend ? vendor : staff;
  return vend ? "Something went wrong and nothing was submitted. Please try again, or call Greenway at 360-443-6988." : `The database refused the change: ${m.slice(0, 300)}`;
}

// ---------------------------------------------------------------------------
// Participation (banking page): how close is "no more checks"?
// ---------------------------------------------------------------------------
export type ParticipationRow = { vendorId: string; name: string; achActive: boolean; optedOut: boolean; invite: VendorEsignState | null; inviteExpired: boolean };
export type ParticipationSummary = {
  total: number;
  active: number;
  waitingOnGreenway: number;
  linkOut: number;
  optedOut: number;
  notInvited: number;
  percentActive: number;
};
export function participationSummary(rows: readonly ParticipationRow[]): ParticipationSummary {
  let active = 0, waitingOnGreenway = 0, linkOut = 0, optedOut = 0, notInvited = 0;
  for (const r of rows) {
    if (r.achActive) active++;
    else if (r.invite === "signed") waitingOnGreenway++;
    else if (r.invite && ["sent", "code_sent", "consented"].includes(r.invite) && !r.inviteExpired) linkOut++;
    else if (r.optedOut) optedOut++;
    else notInvited++;
  }
  const total = rows.length;
  return { total, active, waitingOnGreenway, linkOut, optedOut, notInvited, percentActive: total ? Math.round((active / total) * 1000) / 10 : 0 };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------
export function __runVendorEsignCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, name: string) => {
    if (c) passed++;
    else { failed++; console.error("vendor-esign-core FAIL:", name); }
  };
  const t0 = Date.parse("2026-07-01T17:00:00Z");
  // tokens
  const tok = makeToken((n) => new Uint8Array(n).fill(0xfb));
  ok(tok.length === 43 && isTokenShape(tok) && !tok.includes("+") && !tok.includes("/") && !tok.includes("="), "token base64url 43");
  let threw = false;
  try { makeToken(() => new Uint8Array(16)); } catch { threw = true; }
  ok(threw, "token length enforced");
  ok(!isTokenShape("short") && !isTokenShape(tok + "x") && !isTokenShape(null), "token shape");
  const hm = (s: string) => `h(${s})`;
  ok(tokenDigest(hm, "T") === "h(vesign-token|T)", "token digest format");
  ok(vendorOtpDigest(hm, "I1", "123456") === "h(vesign-otp|I1|123456)", "otp digest format");
  ok(browserDigest(hm, "I1", "B") === "h(vesign-browser|I1|B)", "browser digest format");
  ok(makeOtp(() => 7) === "000007", "otp padded");
  // disclosure
  const clauses = new Set(VENDOR_ESIGN_DISCLOSURE.map((p) => p.clause));
  for (const c of ["B.i.I", "B.i.II", "B.ii", "B.iii", "B.iv", "C.i", "C.ii", "voluntary", "safety"]) ok(clauses.has(c), `disclosure ${c}`);
  ok(/no fee/i.test(VENDOR_ESIGN_DISCLOSURE.find((p) => p.clause === "B.i.II")!.text) && /free of charge/i.test(VENDOR_ESIGN_DISCLOSURE.find((p) => p.clause === "B.iv")!.text), "fees stated");
  ok(/WAC 314-55-115\(3\)\(a\)/.test(VENDOR_ESIGN_DISCLOSURE.find((p) => p.clause === "voluntary")!.text), "voluntary cites WAC");
  // states
  ok(VENDOR_ESIGN_STATES.every((s) => s in VENDOR_ESIGN_MOVES), "moves cover states");
  ok(canMoveVendorEsign("sent", "code_sent") && canMoveVendorEsign("code_sent", "consented") && canMoveVendorEsign("consented", "signed") && canMoveVendorEsign("signed", "countersigned"), "happy path");
  ok(canMoveVendorEsign("consented", "code_sent") && !canMoveVendorEsign("code_sent", "code_sent"), "re-code only from consented (resend keeps code_sent via counters)");
  ok(!canMoveVendorEsign("signed", "cancelled") && !canMoveVendorEsign("sent", "signed") && !canMoveVendorEsign("countersigned", "rejected"), "no skipping");
  // windows
  const exp = inviteExpiresAt(t0);
  ok(Date.parse(exp) - t0 === INVITE_TTL_MS && INVITE_TTL_DAYS <= INVITE_MAX_DAYS, "14-day expiry");
  let threw2 = false;
  try { inviteExpiresAt(t0, 31); } catch { threw2 = true; }
  ok(threw2, "max 30 days");
  ok(!inviteExpired(exp, Date.parse(exp)) && inviteExpired(exp, Date.parse(exp) + 1) && inviteExpired("bad", t0), "expired edge");
  ok(!consentStale(new Date(t0).toISOString(), t0 + CONSENT_FRESH_MS) && consentStale(new Date(t0).toISOString(), t0 + CONSENT_FRESH_MS + 1) && consentStale(null, t0), "stale edge");
  // otp
  const st: VendorOtpState = { otpDigest: vendorOtpDigest(hm, "I1", "123456"), otpSentAtIso: new Date(t0).toISOString(), otpSends: 1, otpAttempts: 0 };
  const dg = (c: string) => vendorOtpDigest(hm, "I1", c);
  const same = (a: string, b: string) => a === b;
  ok(vendorOtpVerdict(st, "123 456", t0 + 1000, dg, same).ok, "right code");
  const w = vendorOtpVerdict(st, "000000", t0, dg, same);
  ok(!w.ok && w.countAttempt && /4 tries/.test(w.error), "wrong counts");
  const w5 = vendorOtpVerdict({ ...st, otpAttempts: 4 }, "000000", t0, dg, same);
  ok(!w5.ok && w5.locked, "fifth wrong locks");
  ok(!vendorOtpVerdict({ ...st, otpAttempts: 5 }, "123456", t0, dg, same).ok, "locked refuses right code");
  const ex = vendorOtpVerdict(st, "123456", t0 + OTP_TTL_MS + 1, dg, same);
  ok(!ex.ok && !ex.countAttempt, "expired not counted");
  ok(!canSendVendorOtp({ ...st, otpSends: 5 }, t0 + 9e9).ok && !canSendVendorOtp({ ...st, otpAttempts: 5 }, t0 + 9e9).ok, "send caps");
  ok(!canSendVendorOtp(st, t0 + 30_000).ok && canSendVendorOtp(st, t0 + 60_000).ok, "cooldown");
  // step
  const base = { state: "sent" as VendorEsignState, expiresAtIso: exp, codeVerifiedAtIso: null, otpSends: 0, otpAttempts: 0, browserMatches: false };
  ok(vendorEsignStep(base, t0) === "send_code", "step send");
  ok(vendorEsignStep({ ...base, state: "code_sent", otpSends: 1 }, t0) === "enter_code", "step enter");
  const cons = { ...base, state: "consented" as VendorEsignState, otpSends: 1, codeVerifiedAtIso: new Date(t0).toISOString(), browserMatches: true };
  ok(vendorEsignStep(cons, t0) === "fill", "step fill");
  ok(vendorEsignStep({ ...cons, browserMatches: false }, t0) === "other_browser", "step other browser");
  ok(vendorEsignStep(cons, t0 + CONSENT_FRESH_MS + 1) === "stale", "step stale");
  ok(vendorEsignStep({ ...cons, browserMatches: false, otpSends: 5 }, t0) === "locked", "step locked");
  ok(vendorEsignStep(cons, Date.parse(exp) + 1) === "expired", "step expired");
  ok(vendorEsignStep({ ...cons, state: "signed" }, Date.parse(exp) + 1) === "signed", "signed beats expiry");
  ok(vendorEsignStep({ ...base, state: "code_sent", otpSends: 1, otpAttempts: 5 }, t0) === "locked", "attempts lock");
  // form
  const F: Record<string, string> = {
    legal_name: "Evergreen Farms LLC", dba: "Evergreen", entity_type: "llc", vendor_kind: "producer_processor", license_no: "412345", ubi: "603-123-456",
    tin_last4: "4321", street: "1 Main St", city: "Shelton", state: "wa", zip: "98584",
    ar_contact: "Ann Lee, AR", ar_phone: "(360) 555-0100", ar_email: "AR@Evergreen.com", second_contact: "Bo Lee, Owner", second_phone: "360.555.0111", second_email: "bo@evergreen.com",
    request_type: "new", bank_name: "Timberland Bank", bank_city_state: "Hoquiam, WA", start_date: "", routing: "021000021", account: "1234 5678", account2: "12345678",
    account_type: "checking", name_on_account: "Evergreen Farms, LLC", remittance_email: "", notes: "", proof_kind: "voided_check",
  };
  const get = (m: Record<string, string>) => (k: string) => m[k];
  const p = parseVendorForm(get(F), "2026-07-01");
  ok(p.ok && p.form.state === "WA" && p.form.ubi === "603123456" && p.form.ar_phone === "360-555-0100" && p.form.second_phone === "360-555-0111" && p.bank.account === "12345678", "form normalizes");
  ok(p.ok && p.form.review_flags.length === 0, "matching account name has no flag");
  ok(p.ok && !JSON.stringify(p.form).includes("12345678") && !JSON.stringify(p.form).includes("021000021"), "form JSON has no bank numbers");
  const bad = (patch: Record<string, string>, key: string) => {
    const r = parseVendorForm(get({ ...F, ...patch }), "2026-07-01");
    return !r.ok && Boolean((r.errors as Record<string, string>)[key]);
  };
  ok(bad({ account2: "12345679" }, "account2"), "account mismatch");
  ok(bad({ routing: "021000022" }, "routing"), "aba check");
  ok(bad({ tin_last4: "123456789" }, "tin_last4"), "full tin refused");
  ok(bad({ license_no: "" }, "license_no"), "cannabis needs license");
  ok(parseVendorForm(get({ ...F, vendor_kind: "non_cannabis", license_no: "", ubi: "" }), "2026-07-01").ok, "non-cannabis without license ok");
  ok(bad({ ar_phone: "555-0100" }, "ar_phone") && bad({ second_email: "x" }, "second_email"), "contacts checked");
  ok(bad({ request_type: "cancel" }, "request_type"), "cancel is not a signing");
  ok(bad({ start_date: "2026-06-30" }, "start_date"), "start date past");
  ok(bad({ notes: "acct 123456789" }, "notes"), "numbers in notes refused");
  ok(bad({ legal_name: "<b>x</b>" }, "legal_name"), "bad chars");
  ok(bad({ entity_type: "other" }, "entity_other"), "other needs description");
  ok(bad({ account: "021000021", account2: "021000021" }, "account"), "account = routing refused");
  const fl = parseVendorForm(get({ ...F, name_on_account: "John Smith" }), "2026-07-01");
  ok(fl.ok && fl.form.review_flags.some((f) => /differs/.test(f)), "personal account flagged");
  const fl2 = parseVendorForm(get({ ...F, second_phone: "360-555-0100" }), "2026-07-01");
  ok(fl2.ok && fl2.form.review_flags.some((f) => /same phone/.test(f)), "same phone flagged");
  // proof
  const pdf = new TextEncoder().encode("%PDF-1.4\n" + "x".repeat(100));
  const pv = checkVendorProof({ bytes: pdf, declaredMime: "application/pdf", filename: "check.pdf", kind: "statement" });
  ok(pv.ok && pv.kind === "other" && pv.mime === "application/pdf", "statement filed as other");
  const big = new Uint8Array(VENDOR_PROOF_MAX_BYTES + 1); big.set(pdf);
  const pb = checkVendorProof({ bytes: big, declaredMime: "application/pdf", filename: "check.pdf", kind: "voided_check" });
  ok(!pb.ok && /4 MB/.test(pb.refusal), "4 MB cap");
  ok(!checkVendorProof({ bytes: new TextEncoder().encode("hello"), declaredMime: "text/plain", filename: "a.txt", kind: "voided_check" }).ok, "non-image refused");
  // signer + recipient
  ok(checkSigner(" Ann  Lee ", "Owner").ok && !checkSigner("Ann", "Owner").ok && !checkSigner("Ann Lee", "").ok, "signer");
  ok(checkInviteRecipient("Ann", "ANN@x.com").ok && !checkInviteRecipient("A", "a@x.com").ok && !checkInviteRecipient("Ann", "nope").ok, "recipient");
  // record + certificate
  if (p.ok) {
    const rec = vendorRecordLines({ form: p.form, bank: p.bank, vendorId: "V1", inviteId: "I1", signerName: "Bo Lee", signerTitle: "Owner", signedAtIso: "2026-07-01T17:00:00Z", proof: { filename: "check.pdf", sha256: "a".repeat(64) } });
    const txt = rec.map((l) => ("text" in l ? l.text : "")).join("\n");
    ok(txt.includes("021000021") && txt.includes("12345678") && txt.includes("/s/ Bo Lee") && txt.includes(ACH_V_TERMS_SHA256), "record has numbers, signature, hash");
    ok(ACH_V_TERMS.terms.every((t) => txt.includes(t.k === "h" ? t.t.toUpperCase() : t.t)), "record carries every term");
    ok(ACH_V_TERMS.wac.every((x) => txt.includes(x)) && ACH_V_TERMS.part3.every((x) => txt.includes(x)) && txt.includes(ACH_V_TERMS.certification) && txt.includes(ACH_V_TERMS.acceptance) && txt.includes(ACH_V_TERMS.intro) && txt.includes(ACH_V_TERMS.wacMeans), "record carries every part");
  }
  const cert = vendorCertificateLines({ inviteId: "I1", vendorId: "V1", vendorLegalName: "Evergreen", invitedBy: { name: "Michael", email: "m@x" }, invitedAtIso: "a", emailMasked: "ar***@e.com", emailOnFile: true, firstOpenedAtIso: null, disclosureSha256: "d".repeat(64), codeSentAtIso: "s", codeVerifiedAtIso: "v", codeAttempts: 0, consentedAtIso: "c", signedAtIso: "t", signerName: "Bo Lee", signerTitle: "Owner", ip: "203.0.113.9", userAgent: "UA", recordSha256: "r".repeat(64), recordBytes: 1, proofSha256: "p".repeat(64), proofBytes: 2, accountLast4: last4("12345678"), routingLast4: "0021" });
  const ct = cert.map((l) => ("text" in l ? l.text : "")).join("\n");
  ok(ct.includes("r".repeat(64)) && ct.includes("203.0.113.9") && ct.includes("5678") && !ct.includes("12345678") && !ct.includes("021000021"), "certificate evidence, no full numbers");
  const acc = acceptanceLines({ inviteId: "I1", vendorLegalName: "E", vendorSignerName: "Bo Lee", vendorSignedAtIso: "t", recordSha256: "r".repeat(64), accountLast4: "5678", greenwaySigner: { name: "Michael Lyman", title: "Owner", email: "m@x" }, acceptedAtIso: "2026-07-02T17:00:00Z", vault: { releasedBy: "Stephen", releasedAtIso: "x", mode: "dual" }, callbackNote: "Called 360-555-0100 from LCB list" });
  const at = acc.map((l) => ("text" in l ? l.text : "")).join("\n");
  ok(at.includes("/s/ Michael Lyman") && at.includes("Effective Date (Terms 1.1): 2026-07-02") && at.includes(ACH_V_TERMS.acceptance), "acceptance page");
  // emails
  const ie = inviteEmail({ link: `https://greenwaymarijuana.com/vendor-ach/${tok}`, vendorName: "Ever <green>", recipientName: "Ann", inviterName: "Michael", expiresPacific: "July 15, 2026" });
  ok(ie.html.includes("Ever &lt;green&gt;") && !ie.html.includes("<green>") && /optional/.test(ie.html) && /never ask you to send money/.test(ie.html), "invite email escaped, voluntary, safety");
  let threw3 = false;
  try { inviteEmail({ link: "javascript:alert(1)", vendorName: "x", recipientName: "x", inviterName: "x", expiresPacific: "x" }); } catch { threw3 = true; }
  ok(threw3, "invite link must be https vendor-ach");
  const oe = vendorOtpEmail("012345");
  ok(oe.html.includes("012345") && !oe.subject.includes("012345"), "otp email");
  const sn = vendorSignedNotices({ vendorName: "E<x>", signerName: "Bo", accountLast4: "5678", whenPacific: "Jul 1", requestType: "change", inviterName: "Michael", reviewFlags: ["<flag>"], vendorPageUrl: "https://x/admin/vendors/1" });
  ok(!sn.owners.html.includes("<x>") && sn.owners.html.includes("&lt;flag&gt;") && /ON HOLD/.test(sn.owners.html) && /Change of bank/.test(sn.owners.html), "owner notice");
  ok(/did not sign/.test(sn.vendor.html) && /phone you/.test(sn.vendor.html), "vendor receipt");
  // db errors
  ok(/0262/.test(vendorEsignDbErrorMessage('relation "public.vendor_esign_invites" does not exist')), "db setup staff");
  ok(!/0262/.test(vendorEsignDbErrorMessage('relation "public.vendor_esign_invites" does not exist', "vendor")), "db setup vendor hides internals");
  ok(/already/.test(vendorEsignDbErrorMessage("vendor_esign_one_open_per_vendor")) && /release/.test(vendorEsignDbErrorMessage("VENDOR_ESIGN_NOT_RELEASED: x")), "db open + release");
  ok(vendorEsignDbErrorMessage("weird").startsWith("The database refused") && !vendorEsignDbErrorMessage("weird", "vendor").includes("weird"), "unknown");
  // participation
  const ps = participationSummary([
    { vendorId: "1", name: "a", achActive: true, optedOut: false, invite: null, inviteExpired: false },
    { vendorId: "2", name: "b", achActive: false, optedOut: false, invite: "signed", inviteExpired: true },
    { vendorId: "3", name: "c", achActive: false, optedOut: false, invite: "sent", inviteExpired: false },
    { vendorId: "4", name: "d", achActive: false, optedOut: true, invite: null, inviteExpired: false },
    { vendorId: "5", name: "e", achActive: false, optedOut: false, invite: "sent", inviteExpired: true },
  ]);
  ok(ps.total === 5 && ps.active === 1 && ps.waitingOnGreenway === 1 && ps.linkOut === 1 && ps.optedOut === 1 && ps.notInvited === 1 && ps.percentActive === 20, "participation");
  console.log(`vendor-esign-core: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
