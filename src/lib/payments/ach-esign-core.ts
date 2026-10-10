/**
 * src/lib/payments/ach-esign-core.ts  (R39 S6, PURE)
 *
 * In-person electronic signing of the employee direct deposit form GW-ACH-E.
 *
 * Owner answers: Q5 "add e-sign now"; Q10 every employee signs, and the form
 * goes in the employee file and the vault; Q12 no self-service. The form's
 * own rule (Terms 8.1, 12) is that bank details change "only in person with a
 * photo ID and a signed form". So signing is IN PERSON on the store device:
 * Michael or Stephen starts the session and checks the photo ID, then the
 * employee does the rest themselves.
 *
 * What the law asks for, and where it is met:
 *  - E-SIGN 15 U.S.C. 7001(c)(1)(B) disclosures before consent: paper option,
 *    right to withdraw and its consequences/fees, scope, how to withdraw and
 *    update the email, how to get a paper copy and the fee. These are
 *    ESIGN_DISCLOSURE below. (C)(i) hardware/software statement: in the same
 *    disclosure.
 *  - 7001(c)(1)(C)(ii): consent given electronically "in a manner that
 *    reasonably demonstrates" access to the electronic form. We email a
 *    6-digit code to the address the employee chooses, and they type it back
 *    (otpVerdict).
 *  - Attribution, RCW 1.80.080: "the act of the person ... shown in any
 *    manner, including a showing of the efficacy of any security procedure".
 *    The evidence is the in-person photo ID check, the emailed code, the
 *    typed name under an intent statement, time, IP and user agent, and the
 *    record's hash. It all goes on the certificate (certificateLines).
 *  - Retention, 7001(d) and RCW 1.80.110: the record "accurately reflects"
 *    the agreement and can be "accurately reproduced". The PDF is
 *    deterministic, its SHA-256 is stored, and the file can never be swapped
 *    (0258 ach_doc_guard).
 *
 * The emailed code is NOT used as an authenticator. NIST SP 800-63B-4 says
 * "Email SHALL NOT be used for out-of-band authentication". Identity comes
 * from the in-person ID check; the code only shows that the email works. The
 * code handling still follows the 800-63B out-of-band rules: random, at
 * least 6 digits, valid 10 minutes, accepted once, attempts rate-limited,
 * stored only as a keyed hash.
 */
import { ACH_E_TERMS, ACH_E_TERMS_SHA256 } from "@/lib/payments/ach-esign-terms";
import type { PdfLine } from "@/lib/payments/pdf-text-core";
import { acceptChecks, last4, validateRekeyEntry, type RekeyAccount } from "@/lib/payments/ach-document-intake-core";

// ---------------------------------------------------------------------------
// Disclosure (E-SIGN 7001(c)(1)(B) and (C)(i))
// ---------------------------------------------------------------------------
export const ESIGN_DISCLOSURE_VERSION = "GW-ESIGN-1";

/** Each paragraph is tagged with the clause it satisfies, so the test can check every clause is covered. */
export const ESIGN_DISCLOSURE: readonly { clause: string; text: string }[] = [
  { clause: "intro", text: "Lyman's Marijuana d/b/a Greenway Marijuana (\"Greenway\") asks for your consent to sign your Employee Direct Deposit Authorization (form GW-ACH-E) electronically and to keep it as an electronic record. Please read this before you agree." },
  { clause: "B.i.I", text: "Paper option. You do not have to sign electronically. You may sign the paper form instead, today or at any time, at no charge. Ask Stephen or Michael for the paper form." },
  { clause: "B.ii", text: "What this consent covers. This consent applies only to this one direct deposit authorization and the signing certificate that goes with it. It does not cover any other document." },
  { clause: "B.i.II", text: "Withdrawing consent. You may withdraw this consent at any time by telling Stephen or Michael in writing (a note or an email to stephen@greenwaymarijuana.com or michael@greenwaymarijuana.com). There is no fee and no penalty. If you withdraw, Greenway will ask you to sign the paper form; your pay is not affected, and if there is no signed form in effect you are paid by paper check (Terms Section 2). Withdrawing does not undo a signature already made." },
  { clause: "B.iii", text: "How to withdraw or update your email. Tell Stephen or Michael in writing, as above. To change the email address Greenway uses for this record, tell them in person or in writing." },
  { clause: "B.iv", text: "Paper copy. You may ask for a paper copy of the signed record at any time, free of charge. You may also download or print it on the last screen today." },
  { clause: "C.i", text: "What you need. To open and keep this record you need a device with a current web browser (for example Chrome, Safari, Edge or Firefox), a program that opens PDF files (most browsers do), and an email account you can read. To keep a copy, you need to be able to save or print a PDF." },
  { clause: "C.ii", text: "Showing you can open electronic records. Greenway will email a 6-digit code to the address you give. Typing that code here shows that you can receive and open email from Greenway. The code expires after 10 minutes." },
];

export const ESIGN_CONSENT_STATEMENT =
  "I have read the disclosure above. I agree to sign my direct deposit authorization electronically and to receive and keep it as an electronic record. I can open PDF files and read email at the address I give.";

export const ESIGN_INTENT_STATEMENT =
  "By typing my full legal name and pressing Sign, I am signing this Employee Direct Deposit Authorization electronically. I intend this to be my signature, with the same effect as signing by hand.";

// ---------------------------------------------------------------------------
// Canonical JSON + hashes (the disclosure is pinned like the terms)
// ---------------------------------------------------------------------------
/** Canonical JSON: object keys sorted, no spaces. Same function the terms hash uses. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return "{" + Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canonicalJson(o[k])).join(",") + "}";
  }
  return JSON.stringify(v ?? null);
}

export function disclosureBody(): { version: string; paragraphs: readonly { clause: string; text: string }[]; consent: string; intent: string } {
  return { version: ESIGN_DISCLOSURE_VERSION, paragraphs: ESIGN_DISCLOSURE, consent: ESIGN_CONSENT_STATEMENT, intent: ESIGN_INTENT_STATEMENT };
}

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------
export const ESIGN_STATES = ["started", "code_sent", "consented", "signed", "cancelled"] as const;
export type EsignState = (typeof ESIGN_STATES)[number];

const ESIGN_MOVES: Readonly<Record<EsignState, readonly EsignState[]>> = {
  started: ["code_sent", "cancelled"],
  code_sent: ["code_sent", "consented", "cancelled"],
  consented: ["signed", "cancelled"],
  signed: [],
  cancelled: [],
};
export function canMoveEsign(from: EsignState, to: EsignState): boolean {
  return ESIGN_MOVES[from].includes(to);
}

/** A session is only usable for 30 minutes after it starts: one sitting, in person. */
export const SESSION_TTL_MS = 30 * 60 * 1000;
export function sessionExpired(startedAtIso: string, nowMs: number): boolean {
  const t = Date.parse(startedAtIso);
  return !Number.isFinite(t) || nowMs - t > SESSION_TTL_MS || nowMs < t - 60_000;
}

// ---------------------------------------------------------------------------
// One-time code (NIST SP 800-63B-4 out-of-band secret rules)
// ---------------------------------------------------------------------------
export const OTP_DIGITS = 6;
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_MAX_SENDS = 3;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

/** A 6-digit code from a caller-supplied CSPRNG (crypto.randomInt in the store). */
export function makeOtp(randomInt: (maxExclusive: number) => number): string {
  const n = randomInt(10 ** OTP_DIGITS);
  if (!Number.isInteger(n) || n < 0 || n >= 10 ** OTP_DIGITS) throw new Error("makeOtp: random source out of range");
  return String(n).padStart(OTP_DIGITS, "0");
}

/** What is stored: a keyed hash bound to the session, never the code. */
export function otpDigest(hmac: (s: string) => string, sessionId: string, code: string): string {
  return hmac(`esign-otp|${sessionId}|${code}`);
}

export type OtpState = {
  otpDigest: string | null;
  otpSentAtIso: string | null;
  otpSends: number;
  otpAttempts: number;
};

export function canSendOtp(s: OtpState, nowMs: number): { ok: true } | { ok: false; error: string } {
  if (s.otpSends >= OTP_MAX_SENDS) return { ok: false, error: "The code has been sent 3 times. Cancel this signing and start again, or sign the paper form." };
  if (s.otpSentAtIso) {
    const wait = Date.parse(s.otpSentAtIso) + OTP_RESEND_COOLDOWN_MS - nowMs;
    if (wait > 0) return { ok: false, error: `Please wait ${Math.ceil(wait / 1000)} seconds before sending another code.` };
  }
  return { ok: true };
}

export type OtpVerdict =
  | { ok: true }
  | { ok: false; error: string; countAttempt: boolean; locked: boolean };

/**
 * Check a typed code. The caller compares digests in constant time via the
 * `same` function (timingSafeEqual in the store) and records the attempt
 * BEFORE answering, so a crash cannot give free guesses.
 */
export function otpVerdict(
  s: OtpState,
  typed: string,
  nowMs: number,
  digestOf: (code: string) => string,
  same: (a: string, b: string) => boolean,
): OtpVerdict {
  if (s.otpAttempts >= OTP_MAX_ATTEMPTS) return { ok: false, error: "Too many wrong codes. Cancel this signing and start again.", countAttempt: false, locked: true };
  if (!s.otpDigest || !s.otpSentAtIso) return { ok: false, error: "No code has been sent yet.", countAttempt: false, locked: false };
  const code = String(typed ?? "").replace(/\s/g, "");
  if (!new RegExp(`^\\d{${OTP_DIGITS}}$`).test(code)) return { ok: false, error: "Type the 6-digit code from the email.", countAttempt: false, locked: false };
  if (nowMs - Date.parse(s.otpSentAtIso) > OTP_TTL_MS) return { ok: false, error: "That code has expired. Send a new one.", countAttempt: false, locked: false };
  if (!same(digestOf(code), s.otpDigest)) {
    const left = OTP_MAX_ATTEMPTS - s.otpAttempts - 1;
    return { ok: false, error: left > 0 ? `That code is not right. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many wrong codes. Cancel this signing and start again.", countAttempt: true, locked: left <= 0 };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------
export const ID_TYPES = ["wa_dl_id", "passport", "other_gov_photo_id"] as const;
export type IdType = (typeof ID_TYPES)[number];
export const ID_TYPE_LABELS: Readonly<Record<IdType, string>> = {
  wa_dl_id: "WA driver license / ID",
  passport: "Passport",
  other_gov_photo_id: "Other government photo ID",
};

/** Form Part 7 "ID last 4 / expiry". At most 4 digits in a row, so a full ID number cannot be stored here. */
export function checkIdCheck(type: string, detail: string, todayIso: string): { ok: true; type: IdType; detail: string } | { ok: false; error: string } {
  if (!(ID_TYPES as readonly string[]).includes(type)) return { ok: false, error: "Choose the type of photo ID you checked." };
  const d = String(detail ?? "").trim().replace(/\s+/g, " ");
  if (d.length < 4 || d.length > 40) return { ok: false, error: "Write the ID's last 4 and its expiry date (for example 1234 exp 2029-05-01)." };
  // Dates like 2029-05-01 are fine (digits separated); 5+ digits in a row is an ID number.
  if (/\d{5,}/.test(d)) return { ok: false, error: "Only the last 4 of the ID number, please (no full ID numbers)." };
  const exp = /(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (exp && `${exp[1]}-${exp[2]}-${exp[3]}` < todayIso.slice(0, 10)) return { ok: false, error: "That ID has expired. An expired ID cannot be used." };
  return { ok: true, type: type as IdType, detail: d };
}

const EMAIL = /^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/;
export function checkEmail(raw: string): { ok: true; email: string } | { ok: false; error: string } {
  const e = String(raw ?? "").trim().toLowerCase();
  if (e.length > 254 || !EMAIL.test(e)) return { ok: false, error: "Type an email address you can open now (for example name@example.com)." };
  return { ok: true, email: e };
}

/** jo***@example.com — for the certificate and screens. */
export function maskEmail(email: string): string {
  const [u, d] = String(email).split("@");
  if (!u || !d) return "***";
  return `${u.slice(0, Math.min(2, u.length))}***@${d}`;
}

export function normalizeName(s: string): string {
  return String(s ?? "").normalize("NFC").trim().replace(/\s+/g, " ");
}

export function checkLegalName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const n = normalizeName(raw);
  if (n.length < 3 || n.length > 120 || !/\p{L}/u.test(n) || !n.includes(" ")) return { ok: false, error: "Type your full legal name (first and last)." };
  if (/[<>{}\\]/.test(n)) return { ok: false, error: "The name has characters that are not allowed." };
  return { ok: true, name: n };
}

/** The typed signature must be the legal name given on the form (case and spacing ignored). */
export function signatureMatches(typed: string, legalName: string): boolean {
  const a = normalizeName(typed).toLowerCase();
  return a.length > 0 && a === normalizeName(legalName).toLowerCase();
}

export type EsignAccountInput = RekeyAccount & { bankName: string; routingAgain: string; accountAgain: string };

/** Accounts typed by the employee, each number typed twice (the form's "check your numbers carefully"). */
export function checkEsignAccounts(accounts: readonly EsignAccountInput[]): string[] {
  const errs: string[] = [];
  if (!accounts.length) return ["Add at least one account."];
  accounts.forEach((a, i) => {
    const n = `Account ${i + 1}`;
    const dig = (s: string) => String(s ?? "").replace(/[\s-]/g, "");
    if (dig(a.routing) !== dig(a.routingAgain)) errs.push(`${n}: the two routing numbers do not match.`);
    if (dig(a.account) !== dig(a.accountAgain)) errs.push(`${n}: the two account numbers do not match.`);
    if (!String(a.bankName ?? "").trim()) errs.push(`${n}: bank or credit union name is required.`);
  });
  const plain = accounts.map(({ routing, account, accountType, rule }) => ({ routing, account, accountType, rule }));
  errs.push(...validateRekeyEntry(plain));
  errs.push(...acceptChecks("employee", plain));
  return [...new Set(errs)];
}

/** "1.2.3.4" from x-forwarded-for (first hop) or x-real-ip; anything not an IP becomes null. */
export function clientIp(get: (h: string) => string | null): string | null {
  const first = (get("x-forwarded-for") ?? "").split(",")[0].trim() || (get("x-real-ip") ?? "").trim();
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(first) && first.split(".").every((p) => Number(p) <= 255)) return first;
  if (/^[0-9a-f:]{2,39}$/i.test(first) && first.includes(":")) return first.toLowerCase();
  return null;
}

export function clampUserAgent(ua: string | null): string {
  return String(ua ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 400);
}

// ---------------------------------------------------------------------------
// The signed record and the certificate (text for pdf-text-core)
// ---------------------------------------------------------------------------
export type RecordInput = {
  employeeLegalName: string;
  employeeId: string;
  accounts: readonly (RekeyAccount & { bankName: string })[];
  signedAtIso: string;
  sessionId: string;
};

function ruleText(a: RekeyAccount): string {
  if (!a.rule) return "(missing)";
  if (a.rule.kind === "remainder") return "Remainder of net pay";
  if (a.rule.kind === "fixed") return `$${(a.rule.cents / 100).toFixed(2)} each payday`;
  return `${(a.rule.basisPoints / 100).toFixed(2)}% of net pay`;
}

/** Pacific date (America/Los_Angeles) of an instant, YYYY-MM-DD. */
export function pacificDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/**
 * The authorization itself. Full account numbers are printed, exactly as on
 * the paper form: the record must "accurately reflect" what was agreed
 * (7001(d)(1)(A)). It is stored only in the private ach-docs bucket and
 * opened only by owner/admin, like a scanned paper form.
 */
export function recordLines(r: RecordInput): PdfLine[] {
  const L: PdfLine[] = [];
  L.push({ kind: "h1", text: "Employee Direct Deposit Authorization" });
  L.push({ kind: "p", text: `Form ${ACH_E_TERMS.formId}  |  ${ACH_E_TERMS.formRev}  |  Signed electronically` });
  L.push({ kind: "p", text: "Lyman's Marijuana d/b/a Greenway Marijuana, 4851 Geiger Rd SE, Port Orchard, WA 98366" });
  L.push({ kind: "rule" });
  L.push({ kind: "h2", text: "1 Employee information" });
  L.push({ kind: "p", text: `Employee legal name: ${r.employeeLegalName}` });
  L.push({ kind: "p", text: `Employee record: ${r.employeeId}` });
  L.push({ kind: "p", text: "This form is a: New enrollment or change (this e-signed form replaces any earlier direct deposit form once accepted)." });
  L.push({ kind: "h2", text: "2 How you will be paid" });
  L.push({ kind: "p", text: "[x] Direct deposit (ACH) to the account(s) in Part 3." });
  L.push({ kind: "h2", text: "3 Deposit accounts" });
  r.accounts.forEach((a, i) => {
    L.push({ kind: "mono", text: `Account ${i + 1}: ${a.bankName}` });
    L.push({ kind: "mono", text: `  Routing ${a.routing.replace(/\D/g, "")}   Account ${a.account.replace(/[\s-]/g, "")}   ${a.accountType === "checking" ? "Checking" : "Savings"}` });
    L.push({ kind: "mono", text: `  Allocation: ${ruleText(a)}` });
  });
  L.push({ kind: "p", text: "Each number was typed twice by the employee and both entries matched." });
  L.push({ kind: "h2", text: "4 Washington wage rules that protect you" });
  for (const w of ACH_E_TERMS.wac) L.push({ kind: "p", text: w });
  L.push({ kind: "h2", text: "5 Terms and conditions" });
  for (const t of ACH_E_TERMS.terms) {
    if (t.k === "h") { L.push({ kind: "gap" }); L.push({ kind: "p", text: t.t.toUpperCase() }); }
    else L.push({ kind: "p", text: t.t });
  }
  L.push({ kind: "h2", text: "6 Signature" });
  L.push({ kind: "p", text: ACH_E_TERMS.acknowledgment });
  L.push({ kind: "p", text: ESIGN_INTENT_STATEMENT });
  L.push({ kind: "gap" });
  L.push({ kind: "mono", text: `Employee signature: /s/ ${r.employeeLegalName}` });
  L.push({ kind: "mono", text: `Printed name:       ${r.employeeLegalName}` });
  L.push({ kind: "mono", text: `Date:               ${pacificDate(r.signedAtIso)} (signed ${r.signedAtIso})` });
  L.push({ kind: "mono", text: `Signing session:    ${r.sessionId}` });
  L.push({ kind: "gap" });
  L.push({ kind: "p", text: `Terms text SHA-256: ${ACH_E_TERMS_SHA256}. The signing certificate filed with this record lists the evidence of signing.` });
  return L;
}

export type CertificateInput = {
  sessionId: string;
  employeeLegalName: string;
  employeeId: string;
  startedBy: { name: string; email: string };
  startedAtIso: string;
  idCheck: { type: IdType; detail: string };
  disclosureSha256: string;
  consentedAtIso: string;
  emailMasked: string;
  codeSentAtIso: string;
  codeVerifiedAtIso: string;
  codeAttempts: number;
  signedAtIso: string;
  typedSignature: string;
  ip: string | null;
  userAgent: string;
  recordSha256: string;
  recordBytes: number;
  accountsLast4: readonly string[];
};

export function certificateLines(c: CertificateInput): PdfLine[] {
  const L: PdfLine[] = [];
  const row = (k: string, v: string) => L.push({ kind: "mono", text: `${(k + ":").padEnd(24)}${v}` });
  L.push({ kind: "h1", text: "Electronic Signature Certificate" });
  L.push({ kind: "p", text: `For: ${ACH_E_TERMS.formId} Employee Direct Deposit Authorization, ${ACH_E_TERMS.formRev}` });
  L.push({ kind: "p", text: "Lyman's Marijuana d/b/a Greenway Marijuana. Kept with the signed record for the retention period (Terms Section 14)." });
  L.push({ kind: "rule" });
  L.push({ kind: "h2", text: "Signed record" });
  row("Record SHA-256", c.recordSha256);
  row("Record size", `${c.recordBytes} bytes`);
  row("Terms SHA-256", ACH_E_TERMS_SHA256);
  row("Accounts (last 4)", c.accountsLast4.join(", "));
  L.push({ kind: "h2", text: "Signer" });
  row("Name", c.employeeLegalName);
  row("Employee record", c.employeeId);
  row("Typed signature", `/s/ ${c.typedSignature}`);
  L.push({ kind: "h2", text: "Identity (in person, form Part 7)" });
  row("Photo ID checked", `${ID_TYPE_LABELS[c.idCheck.type]} (${c.idCheck.detail})`);
  row("Checked by", `${c.startedBy.name} <${c.startedBy.email}>`);
  row("Session started", c.startedAtIso);
  L.push({ kind: "h2", text: "Consent to electronic records (15 U.S.C. 7001(c))" });
  row("Disclosure", `${ESIGN_DISCLOSURE_VERSION}, SHA-256 ${c.disclosureSha256}`);
  row("Code emailed to", c.emailMasked);
  row("Code sent", c.codeSentAtIso);
  row("Code confirmed", `${c.codeVerifiedAtIso} (wrong tries before: ${c.codeAttempts})`);
  row("Consent recorded", c.consentedAtIso);
  L.push({ kind: "p", text: `Consent statement: "${ESIGN_CONSENT_STATEMENT}"` });
  L.push({ kind: "h2", text: "Signature" });
  row("Signed at", c.signedAtIso);
  row("IP address", c.ip ?? "not available");
  L.push({ kind: "mono", text: `User agent: ${c.userAgent || "not available"}` });
  L.push({ kind: "p", text: `Intent statement shown: "${ESIGN_INTENT_STATEMENT}"` });
  L.push({ kind: "rule" });
  L.push({ kind: "p", text: "Legal basis: E-SIGN Act, 15 U.S.C. 7001; Washington Uniform Electronic Transactions Act, chapter 1.80 RCW (RCW 1.80.080 attribution; RCW 1.80.110 retention). The emailed code shows the signer could open electronic records; identity was checked in person with photo ID." });
  return L;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------
export function __runAchEsignCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, name: string) => {
    if (c) passed++;
    else { failed++; console.error("ach-esign-core FAIL:", name); }
  };
  const clauses = new Set(ESIGN_DISCLOSURE.map((p) => p.clause));
  for (const c of ["B.i.I", "B.i.II", "B.ii", "B.iii", "B.iv", "C.i", "C.ii"]) ok(clauses.has(c), `disclosure covers ${c}`);
  ok(/no fee|free of charge|no charge/i.test(ESIGN_DISCLOSURE.find((p) => p.clause === "B.iv")!.text), "paper copy fee stated");
  ok(/no fee/i.test(ESIGN_DISCLOSURE.find((p) => p.clause === "B.i.II")!.text), "withdrawal fee stated");
  ok(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }) === '{"a":[2,{"c":2,"d":1}],"b":1}', "canonical json sorts keys");
  ok(canonicalJson({ a: undefined, b: null }) === '{"b":null}', "canonical json drops undefined");
  ok(canMoveEsign("started", "code_sent") && canMoveEsign("code_sent", "code_sent") && canMoveEsign("code_sent", "consented") && canMoveEsign("consented", "signed"), "happy path moves");
  ok(!canMoveEsign("started", "signed") && !canMoveEsign("started", "consented") && !canMoveEsign("signed", "cancelled") && !canMoveEsign("cancelled", "started"), "no skipping or reopening");
  const t0 = Date.parse("2026-01-15T10:00:00Z");
  ok(!sessionExpired("2026-01-15T10:00:00Z", t0 + SESSION_TTL_MS), "30 min edge ok");
  ok(sessionExpired("2026-01-15T10:00:00Z", t0 + SESSION_TTL_MS + 1), "past 30 min expired");
  ok(sessionExpired("bad", t0), "bad start expired");
  ok(makeOtp(() => 42) === "000042", "otp zero padded");
  let threw = false;
  try { makeOtp(() => 1_000_000); } catch { threw = true; }
  ok(threw, "otp range enforced");
  const hm = (s: string) => `h(${s})`;
  ok(otpDigest(hm, "S1", "123456") !== otpDigest(hm, "S2", "123456"), "digest bound to session");
  const same = (a: string, b: string) => a === b;
  const st: OtpState = { otpDigest: otpDigest(hm, "S1", "123456"), otpSentAtIso: "2026-01-15T10:00:00Z", otpSends: 1, otpAttempts: 0 };
  const dg = (c: string) => otpDigest(hm, "S1", c);
  ok(otpVerdict(st, "123456", t0 + 1000, dg, same).ok, "right code");
  ok(otpVerdict(st, " 123 456 ", t0 + 1000, dg, same).ok, "spaces ignored");
  const wrong = otpVerdict(st, "000000", t0 + 1000, dg, same);
  ok(!wrong.ok && wrong.countAttempt && !wrong.locked && /4 tries left/.test(wrong.error), "wrong code counts");
  const last = otpVerdict({ ...st, otpAttempts: 4 }, "000000", t0, dg, same);
  ok(!last.ok && last.locked && last.countAttempt, "fifth wrong locks");
  const locked = otpVerdict({ ...st, otpAttempts: 5 }, "123456", t0, dg, same);
  ok(!locked.ok && locked.locked && !locked.countAttempt, "locked refuses even right code");
  const exp = otpVerdict(st, "123456", t0 + OTP_TTL_MS + 1, dg, same);
  ok(!exp.ok && !exp.countAttempt && /expired/.test(exp.error), "expired after 10 min");
  ok(otpVerdict(st, "123456", t0 + OTP_TTL_MS, dg, same).ok, "10 min edge ok");
  const bad = otpVerdict(st, "12345", t0, dg, same);
  ok(!bad.ok && !bad.countAttempt, "malformed not counted");
  ok(!otpVerdict({ ...st, otpDigest: null }, "123456", t0, dg, same).ok, "no code sent");
  ok(canSendOtp({ ...st, otpSentAtIso: null, otpSends: 0 }, t0).ok, "first send");
  const cd = canSendOtp(st, t0 + 30_000);
  ok(!cd.ok && /30 seconds/.test(cd.error), "cooldown");
  ok(canSendOtp(st, t0 + OTP_RESEND_COOLDOWN_MS).ok, "after cooldown");
  ok(!canSendOtp({ ...st, otpSends: 3 }, t0 + 999_999).ok, "max sends");
  ok(checkIdCheck("wa_dl_id", "1234 exp 2029-05-01", "2026-01-15").ok, "id ok");
  ok(!checkIdCheck("wa_dl_id", "WDL123456789 exp 2029-05-01", "2026-01-15").ok, "full id refused");
  ok(!checkIdCheck("wa_dl_id", "1234 exp 2025-05-01", "2026-01-15").ok, "expired id refused");
  ok(!checkIdCheck("library", "1234", "2026-01-15").ok, "bad id type");
  ok(!checkIdCheck("passport", "12", "2026-01-15").ok, "too short");
  ok(checkEmail(" A@B.com ").ok && (checkEmail(" A@B.com ") as { email: string }).email === "a@b.com", "email normalized");
  ok(!checkEmail("nope").ok && !checkEmail("a@b").ok, "bad email");
  ok(maskEmail("john@example.com") === "jo***@example.com" && maskEmail("x") === "***", "mask email");
  ok(checkLegalName("  Jane   Q  Public ").ok && (checkLegalName("Jane Q Public") as { name: string }).name === "Jane Q Public", "legal name");
  ok(!checkLegalName("Jane").ok && !checkLegalName("<b> x").ok, "single or bad name refused");
  ok(signatureMatches(" jane  q PUBLIC", "Jane Q Public") && !signatureMatches("Jane Public", "Jane Q Public") && !signatureMatches("", ""), "signature match");
  const A = { routing: "021000021", routingAgain: "021000021", account: "12345678", accountAgain: "12345678", accountType: "checking" as const, rule: { kind: "remainder" as const }, bankName: "Bank" };
  ok(checkEsignAccounts([A]).length === 0, "one remainder account ok");
  ok(checkEsignAccounts([{ ...A, accountAgain: "12345679" }]).some((e) => /two account numbers/.test(e)), "account mismatch");
  ok(checkEsignAccounts([{ ...A, routingAgain: "021000022" }]).some((e) => /two routing/.test(e)), "routing mismatch");
  ok(checkEsignAccounts([{ ...A, bankName: " " }]).some((e) => /bank or credit union/.test(e)), "bank name required");
  ok(checkEsignAccounts([{ ...A, routing: "021000022", routingAgain: "021000022" }]).length > 0, "bad aba refused");
  ok(checkEsignAccounts([]).length === 1, "no accounts");
  ok(checkEsignAccounts([A, A, A, A]).length > 0, "four accounts refused");
  const h = (m: Record<string, string>) => (k: string) => m[k] ?? null;
  ok(clientIp(h({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" })) === "203.0.113.5", "first forwarded hop");
  ok(clientIp(h({ "x-real-ip": "198.51.100.7" })) === "198.51.100.7", "real ip");
  ok(clientIp(h({ "x-forwarded-for": "999.1.1.1" })) === null && clientIp(h({ "x-forwarded-for": "<script>" })) === null, "junk ip");
  ok(clientIp(h({ "x-forwarded-for": "2001:DB8::1" })) === "2001:db8::1", "ipv6");
  ok(clampUserAgent("a\nb".padEnd(500, "x")).length === 400 && !clampUserAgent("a\nb").includes("\n"), "ua clamp");
  ok(pacificDate("2026-01-16T05:00:00Z") === "2026-01-15", "pacific date");
  const rec = recordLines({ employeeLegalName: "Jane Q Public", employeeId: "E1", accounts: [A], signedAtIso: "2026-01-15T18:00:00Z", sessionId: "S1" });
  const recText = rec.map((l) => ("text" in l ? l.text : "")).join("\n");
  ok(recText.includes("/s/ Jane Q Public") && recText.includes("021000021") && recText.includes(ACH_E_TERMS_SHA256), "record has signature, numbers and terms hash");
  ok(ACH_E_TERMS.terms.every((t) => recText.includes(t.k === "h" ? t.t.toUpperCase() : t.t)), "record carries every term verbatim");
  ok(ACH_E_TERMS.wac.every((w) => recText.includes(w)) && recText.includes(ACH_E_TERMS.acknowledgment), "record carries WAC and acknowledgment");
  const cert = certificateLines({ sessionId: "S1", employeeLegalName: "Jane Q Public", employeeId: "E1", startedBy: { name: "Michael", email: "m@x.com" }, startedAtIso: "a", idCheck: { type: "passport", detail: "1234" }, disclosureSha256: "d".repeat(64), consentedAtIso: "c", emailMasked: "ja***@x.com", codeSentAtIso: "s", codeVerifiedAtIso: "v", codeAttempts: 1, signedAtIso: "t", typedSignature: "Jane Q Public", ip: "203.0.113.5", userAgent: "UA", recordSha256: "r".repeat(64), recordBytes: 10, accountsLast4: [last4("12345678")] });
  const certText = cert.map((l) => ("text" in l ? l.text : "")).join("\n");
  ok(certText.includes("r".repeat(64)) && certText.includes("203.0.113.5") && certText.includes("Passport (1234)") && certText.includes("5678"), "certificate evidence");
  ok(!certText.includes("12345678") && !certText.includes("021000021"), "certificate has no bank numbers");
  console.log(`ach-esign-core: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
