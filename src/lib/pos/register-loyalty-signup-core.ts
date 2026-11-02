/**
 * src/lib/pos/register-loyalty-signup-core.ts  (slice register-loyalty-signup)
 *
 * The owner, verbatim: "I need a way to sign up new loyalty customers from the
 * iPad register. ... Make sure to include anything and everything to make the
 * process simple and powerful."
 *
 * PURE logic (no I/O, no server-only imports) for signing a customer up for
 * loyalty at the register, in the middle of a sale. The route
 * (/api/pos/loyalty-signup) and the register UI both import this file, so the
 * rules live in exactly one tested place.
 *
 * What this module decides:
 *
 *   parseRegisterSignupRequest()  validates what the register sent. The date
 *       of birth is NOT typed into the form: it is the DOB the ID gate already
 *       verified for this sale (scan or manual), and the server re-checks 21+
 *       on the Pacific calendar (standing rule 9; RCW 69.50.357(2) "persons
 *       under twenty-one years of age" may not enter a retail outlet).
 *   findRegisterSignupDuplicates() / planRegisterSignup()  stop a second
 *       account for someone already on file (same phone, same email, or the
 *       same name + birthday, the AO-3 scan identity), BEFORE anything is
 *       written. The budtender picks: use the existing account, or create a
 *       new one anyway (for example a shared family phone).
 *   consentVerdict()  marketing consent is OPTIONAL and recorded only as
 *       "prior express written consent" (47 CFR 64.1200(f)(9)): the customer
 *       read the PUBLISHED wording on the screen (the server checks the
 *       SHA-256 of the wording shown equals what is published now) and signed
 *       it (an electronic signature counts, (f)(9)(ii)). Declining never
 *       blocks the signup: the wording itself says "Consent is not a condition
 *       of purchase" ((f)(9)(i)(B)), so the loyalty account is open to every
 *       21+ customer on equal terms (docs/LOYALTY_COMPLIANCE.md 1.3).
 *   buildRegisterSignupCustomer() / buildRegisterSignupRow()  the exact
 *       columns written (standing rule 15: name every column; never lean on a
 *       default for something the code relies on).
 *   classifySignupDbError()  the plain-English meaning of the database codes
 *       that mean "the platform moved" (rule 15).
 *
 * Unit-tested via __runRegisterLoyaltySignupCoreTests() (registered in
 * scripts/compliance/run-pure-selftests.ts with a floor) and mirrored in
 * tests/compliance/register-loyalty-signup.test.ts.
 */
import { ageOn, isYmd, MINIMUM_AGE_YEARS } from "@/lib/pos/id-scan-core";
import { cleanEmail, cleanPhone } from "@/lib/customers/customer-import-core";
import { normalizeFirstName, normalizeLastName } from "@/lib/pos/member-match-core";
import { memberLabel } from "@/lib/customers/customer-search-core";
import {
  buildLinkPatch,
  mapSignupToCustomerFields,
  type CustomerForLink,
  type NewCustomerFields,
  type SignupForCustomer,
} from "@/lib/loyalty/signup-customer-core";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** loyalty_signups.source for a signup taken at the register. */
export const REGISTER_SIGNUP_SOURCE = "greenway-register";
/** customers.import_source for a customer created at the register. */
export const REGISTER_SIGNUP_IMPORT_SOURCE = "register-signup";
/** audit_logs.action for a completed register signup. */
export const REGISTER_SIGNUP_AUDIT_ACTION = "register.loyalty_signup";
/** loyalty_signups.legacy_id prefix: the UNIQUE column is the idempotency key. */
export const REGISTER_SIGNUP_LEGACY_PREFIX = "register:";

export const NAME_MAX = 60;
export const EMAIL_MAX = 254; // RFC 5321 path limit
export const SIGNATURE_MAX = 120;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** How the ID gate verified the DOB for this sale. */
export type DobSource = "scan" | "manual";

/** A validated register signup request. */
export type RegisterSignupRequest = {
  /** Made by the register when the form opens; reused on every retry. */
  clientRequestId: string;
  firstName: string;
  lastName: string;
  /** YYYY-MM-DD, from the sale's ID verdict. */
  dateOfBirth: string;
  dobSource: DobSource;
  /** "(360) 555-0101" or null. */
  phone: string | null;
  /** 10 digits or null. */
  phoneNormalized: string | null;
  /** lowercased email or null. */
  email: string | null;
  marketingConsent: boolean;
  /** SHA-256 hex of the consent wording the customer was shown (consent only). */
  consentTextSha256: string | null;
  /** Typed signature (consent only). */
  signature: string | null;
  employeeName: string;
  /** The budtender chose an existing account from the duplicate list. */
  useExistingCustomerId: string | null;
  /** The budtender saw the duplicate list and chose a new account anyway. */
  createAnyway: boolean;
};

export type FieldErrors = Partial<
  Record<
    "clientRequestId" | "firstName" | "lastName" | "dateOfBirth" | "contact" | "phone" | "email" | "signature" | "consent",
    string
  >
>;

export type ParseResult =
  | { ok: true; request: RegisterSignupRequest }
  | { ok: false; error: string; fields: FieldErrors };

/** The customers columns the duplicate check needs (explicit select). */
export type DuplicateCandidate = {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  email_normalized: string | null;
  phone: string | null;
  phone_normalized: string | null;
  birthdate: string | null;
  marketing_consent: boolean;
  do_not_contact: boolean;
  loyalty_signup_id: string | null;
};

export const DUPLICATE_CANDIDATE_COLUMNS =
  "id, first_name, last_name, email, email_normalized, phone, phone_normalized, birthdate, marketing_consent, do_not_contact, loyalty_signup_id";

export type DuplicateBasis = "name_dob" | "phone" | "email";

export const DUPLICATE_BASIS_LABEL: Record<DuplicateBasis, string> = {
  name_dob: "same name and birthday",
  phone: "same phone",
  email: "same email",
};

const BASIS_RANK: Record<DuplicateBasis, number> = { name_dob: 0, phone: 1, email: 2 };

export type DuplicateMatch = {
  customerId: string;
  /** Strongest reason first. */
  bases: DuplicateBasis[];
  fullName: string;
  label: string;
};

export type SignupPlan =
  | { kind: "duplicates"; matches: DuplicateMatch[] }
  | { kind: "attach_existing"; customer: DuplicateCandidate }
  | { kind: "create" }
  | { kind: "refuse"; error: string };

// ---------------------------------------------------------------------------
// Small text helpers (shared with the register UI)
// ---------------------------------------------------------------------------

function text(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}

/**
 * ID cards print names in capitals ("JANE", "O'BRIEN", "SMITH-JONES"). Title
 * case them for the form; a name that already has lower case is left alone
 * (the customer's own spelling wins).
 */
export function titleCaseName(raw: string | null | undefined): string {
  const t = text(raw ?? "");
  if (!t) return "";
  if (t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** The form's first-name prefill: the first word of the ID's first name. */
export function prefillFirstName(raw: string | null | undefined): string {
  const first = text(raw ?? "").split(" ")[0] ?? "";
  return titleCaseName(first);
}

/** Phone as the budtender types it: "3605550101" -> "(360) 555-0101". */
export function formatPhoneInput(raw: string): string {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  d = d.slice(0, 10);
  if (d.length === 0) return "";
  if (d.length < 4) return `(${d}`;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/**
 * When the member search found nobody, carry what was typed into the signup
 * form: digits become the phone, an email becomes the email, words become the
 * name (only when the ID did not already give us one).
 */
export function prefillFromSearch(q: string): { phone?: string; email?: string; firstName?: string; lastName?: string } {
  const t = text(q);
  if (!t) return {};
  if (t.includes("@")) return { email: t.toLowerCase() };
  const digits = t.replace(/\D/g, "");
  if (/^[\d\s().+-]+$/.test(t) && digits.length >= 7) return { phone: formatPhoneInput(digits) };
  const words = t.split(" ").filter((w) => /\p{L}/u.test(w));
  if (words.length === 0) return {};
  // Typed search is often all lower case ("jane doe"); treat it like an ID's
  // all-caps name so the form gets "Jane Doe". Mixed case is kept as typed.
  const tc = (w: string) => titleCaseName(w === w.toLowerCase() ? w.toUpperCase() : w);
  if (words.length === 1) return { lastName: tc(words[0]) };
  return { firstName: tc(words[0]), lastName: tc(words.slice(1).join(" ")) };
}

function validName(n: string): boolean {
  return n.length >= 1 && n.length <= NAME_MAX && /\p{L}/u.test(n);
}

// ---------------------------------------------------------------------------
// Parse + validate
// ---------------------------------------------------------------------------

/**
 * Validate a signup body. `todayYmd` is today on the Pacific calendar (the
 * route passes pacificToday()). Never throws.
 */
export function parseRegisterSignupRequest(body: unknown, todayYmd: string): ParseResult {
  const raw = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const fields: FieldErrors = {};

  const clientRequestId = text(raw.clientRequestId).toLowerCase();
  if (!UUID_RE.test(clientRequestId)) fields.clientRequestId = "The register sent no request id. Close the form and open it again.";

  const firstName = text(raw.firstName);
  const lastName = text(raw.lastName);
  if (!validName(firstName)) fields.firstName = "First name is required.";
  if (!validName(lastName)) fields.lastName = "Last name is required.";

  const dateOfBirth = text(raw.dateOfBirth);
  const dobSource: DobSource = raw.dobSource === "manual" ? "manual" : "scan";
  if (!isYmd(dateOfBirth)) {
    fields.dateOfBirth = "The ID check for this sale has no birthday. Check the ID again, then sign up.";
  } else {
    const age = ageOn(dateOfBirth, todayYmd);
    if (age === null || age < MINIMUM_AGE_YEARS) {
      fields.dateOfBirth = `Loyalty members must be ${MINIMUM_AGE_YEARS} or older.`;
    } else if (age > 120) {
      fields.dateOfBirth = "That birthday is not possible. Check the ID again.";
    }
  }

  const phoneRaw = text(raw.phone);
  const emailRaw = text(raw.email);
  const phone = phoneRaw ? cleanPhone(phoneRaw) : { phone: null, normalized: null };
  const email = emailRaw ? cleanEmail(emailRaw) : { email: null, normalized: null };
  if (phoneRaw && !phone.normalized) fields.phone = "Enter a 10-digit phone number.";
  if (emailRaw && (!email.normalized || emailRaw.length > EMAIL_MAX)) fields.email = "That email does not look right.";
  if (!phoneRaw && !emailRaw) fields.contact = "Add a phone number or an email so we can find the account next time.";

  const marketingConsent = raw.marketingConsent === true;
  const signature = text(raw.signature).slice(0, SIGNATURE_MAX);
  const shaRaw = text(raw.consentTextSha256).toLowerCase();
  if (marketingConsent) {
    if (signature.length < 2) fields.signature = "To say yes to messages, the customer types their full name as a signature.";
    if (!SHA256_RE.test(shaRaw)) fields.consent = "The consent wording did not load. Close the form and open it again.";
  }

  const useExistingRaw = text(raw.useExistingCustomerId).toLowerCase();
  const useExistingCustomerId = UUID_RE.test(useExistingRaw) ? useExistingRaw : null;
  const createAnyway = raw.createAnyway === true;

  const keys = Object.keys(fields) as (keyof FieldErrors)[];
  if (keys.length > 0) {
    return { ok: false, error: fields[keys[0]] ?? "Check the form.", fields };
  }

  return {
    ok: true,
    request: {
      clientRequestId,
      firstName,
      lastName,
      dateOfBirth,
      dobSource,
      phone: phone.phone,
      phoneNormalized: phone.normalized,
      email: email.normalized,
      marketingConsent,
      consentTextSha256: marketingConsent ? shaRaw : null,
      signature: marketingConsent ? signature : null,
      employeeName: text(raw.employeeName).slice(0, 120),
      useExistingCustomerId,
      createAnyway: useExistingCustomerId ? false : createAnyway,
    },
  };
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

export type ConsentVerdict =
  | { ok: true; recordConsent: boolean }
  | { ok: false; error: string };

/**
 * Marketing consent is recorded only when the customer saw the wording that
 * is published RIGHT NOW. If the owner edited the wording while the form was
 * open, the register must show the new wording first (never record a
 * signature against words the customer did not read).
 */
export function consentVerdict(req: Pick<RegisterSignupRequest, "marketingConsent" | "consentTextSha256">, publishedSha256: string): ConsentVerdict {
  if (!req.marketingConsent) return { ok: true, recordConsent: false };
  if (!req.consentTextSha256 || req.consentTextSha256 !== publishedSha256.toLowerCase()) {
    return {
      ok: false,
      error: "The message consent wording was just updated. Show the customer the new wording and ask again.",
    };
  }
  return { ok: true, recordConsent: true };
}

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

function candidateDob(raw: string | null): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec((raw ?? "").trim());
  return m ? m[1] : "";
}

function candidatePhone(c: DuplicateCandidate): string | null {
  if (c.phone_normalized) {
    const d = c.phone_normalized.replace(/\D/g, "");
    return d.length === 11 && d.startsWith("1") ? d.slice(1) : d || null;
  }
  return c.phone ? cleanPhone(c.phone).normalized : null;
}

function candidateEmail(c: DuplicateCandidate): string | null {
  const e = (c.email_normalized ?? c.email ?? "").trim().toLowerCase();
  return e.includes("@") ? e : null;
}

/** Every reason this customer may already be the person signing up. */
export function duplicateBases(
  req: Pick<RegisterSignupRequest, "firstName" | "lastName" | "dateOfBirth" | "phoneNormalized" | "email">,
  c: DuplicateCandidate,
): DuplicateBasis[] {
  const out: DuplicateBasis[] = [];
  const first = normalizeFirstName(req.firstName);
  const last = normalizeLastName(req.lastName);
  if (
    first &&
    last &&
    candidateDob(c.birthdate) === req.dateOfBirth &&
    normalizeFirstName(c.first_name) === first &&
    normalizeLastName(c.last_name) === last
  ) {
    out.push("name_dob");
  }
  if (req.phoneNormalized && candidatePhone(c) === req.phoneNormalized) out.push("phone");
  if (req.email && candidateEmail(c) === req.email) out.push("email");
  return out;
}

/** The customers on file this signup may duplicate, strongest first. */
export function findRegisterSignupDuplicates(
  req: Pick<RegisterSignupRequest, "firstName" | "lastName" | "dateOfBirth" | "phoneNormalized" | "email">,
  candidates: readonly DuplicateCandidate[],
): DuplicateMatch[] {
  const seen = new Set<string>();
  const out: (DuplicateMatch & { rank: number })[] = [];
  for (const c of candidates) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const bases = duplicateBases(req, c).sort((a, b) => BASIS_RANK[a] - BASIS_RANK[b]);
    if (bases.length === 0) continue;
    out.push({
      customerId: c.id,
      bases,
      fullName: `${c.first_name.trim()} ${(c.last_name ?? "").trim()}`.trim(),
      label: memberLabel(c.first_name, c.last_name),
      rank: BASIS_RANK[bases[0]] * 10 - bases.length,
    });
  }
  out.sort((a, b) => a.rank - b.rank || a.fullName.localeCompare(b.fullName));
  return out.map((m) => ({ customerId: m.customerId, bases: m.bases, fullName: m.fullName, label: m.label }));
}

/**
 * What to do with this request, given the customers that might match.
 *   - The budtender chose an existing account -> attach it (it must be one of
 *     the matches: a register can never attach an arbitrary customer id).
 *   - Matches and no choice yet -> show them; write nothing.
 *   - No matches, or "create anyway" -> create.
 */
export function planRegisterSignup(req: RegisterSignupRequest, candidates: readonly DuplicateCandidate[]): SignupPlan {
  const matches = findRegisterSignupDuplicates(req, candidates);
  if (req.useExistingCustomerId) {
    const ok = matches.some((m) => m.customerId === req.useExistingCustomerId);
    const customer = candidates.find((c) => c.id === req.useExistingCustomerId);
    if (!ok || !customer) {
      return { kind: "refuse", error: "That account no longer matches this customer. Search again." };
    }
    return { kind: "attach_existing", customer };
  }
  if (matches.length > 0 && !req.createAnyway) return { kind: "duplicates", matches };
  return { kind: "create" };
}

// ---------------------------------------------------------------------------
// Rows written (rule 15: every column named)
// ---------------------------------------------------------------------------

export function legacyIdFor(clientRequestId: string): string {
  return `${REGISTER_SIGNUP_LEGACY_PREFIX}${clientRequestId.toLowerCase()}`;
}

export type RegisterSignupRow = {
  legacy_id: string;
  status: "entered";
  first_name: string;
  last_name: string;
  birthday: string;
  mobile_phone: string | null;
  phone_normalized: string | null;
  email: string | null;
  consent: boolean;
  signature: string | null;
  source: typeof REGISTER_SIGNUP_SOURCE;
  notification_status: "email-not-configured";
  email_opt_out: false;
  unsubscribed_at: null;
  dedupe_of: string | null;
  staff_note: string;
  entered_by: null;
  entered_at: string;
  submitted_at: string;
  consent_text: string | null;
  consent_text_sha256: string | null;
};

/**
 * The loyalty_signups row. Status is "entered" (the customer record exists
 * the moment the register is done, so nothing waits in the staff queue).
 * `entered_by` is null because a register DEVICE is not a staff_profiles row;
 * the employee is named in staff_note and the audit row. The staff email
 * notification is skipped on purpose: the website sends it because nobody
 * has seen the signup yet; at the register a budtender is looking at it.
 */
export function buildRegisterSignupRow(
  req: RegisterSignupRequest,
  opts: { nowIso: string; registerName: string; consentText: string | null; consentSha256: string | null; dedupeOf: string | null },
): RegisterSignupRow {
  const who = req.employeeName ? ` by ${req.employeeName}` : "";
  const where = opts.registerName ? ` (${opts.registerName})` : "";
  return {
    legacy_id: legacyIdFor(req.clientRequestId),
    status: "entered",
    first_name: req.firstName,
    last_name: req.lastName,
    birthday: req.dateOfBirth,
    mobile_phone: req.phone,
    phone_normalized: req.phoneNormalized,
    email: req.email,
    consent: req.marketingConsent,
    signature: req.marketingConsent ? req.signature : null,
    source: REGISTER_SIGNUP_SOURCE,
    notification_status: "email-not-configured",
    email_opt_out: false,
    unsubscribed_at: null,
    dedupe_of: opts.dedupeOf,
    staff_note: `Signed up at the register${where}${who}. Birthday from the ${req.dobSource === "scan" ? "scanned" : "hand-checked"} ID. Messages: ${req.marketingConsent ? "yes (signed)" : "no"}.`,
    entered_by: null,
    entered_at: opts.nowIso,
    submitted_at: opts.nowIso,
    consent_text: req.marketingConsent ? opts.consentText : null,
    consent_text_sha256: req.marketingConsent ? opts.consentSha256 : null,
  };
}

/** The signup row shaped for the shared signup->customer core. */
export function signupForCustomer(signupId: string, req: RegisterSignupRequest): SignupForCustomer {
  return {
    id: signupId,
    first_name: req.firstName,
    last_name: req.lastName,
    birthday: req.dateOfBirth,
    mobile_phone: req.phone,
    phone_normalized: req.phoneNormalized,
    email: req.email,
    consent: req.marketingConsent,
    email_opt_out: false,
    unsubscribed_at: null,
  };
}

/** A NEW customer row (the shared mapping, stamped as a register signup). */
export function buildRegisterSignupCustomer(signupId: string, req: RegisterSignupRequest): NewCustomerFields {
  return { ...mapSignupToCustomerFields(signupForCustomer(signupId, req)), import_source: REGISTER_SIGNUP_IMPORT_SOURCE };
}

/**
 * Linking an EXISTING customer: the shared fill-the-gaps patch (never
 * overwrites data, never overrides do_not_contact). A customer who said NO to
 * messages today is not downgraded: a past yes stays until they revoke it
 * (STOP or unsubscribe), because a "no thanks" at the counter is a choice not
 * to sign again, not a revocation.
 */
export function buildRegisterLinkPatch(signupId: string, req: RegisterSignupRequest, c: DuplicateCandidate): Record<string, string | boolean> {
  return buildLinkPatch(signupForCustomer(signupId, req), c as CustomerForLink);
}

// ---------------------------------------------------------------------------
// Messages + audit
// ---------------------------------------------------------------------------

export type SignupOutcome = "created" | "linked" | "replayed";

/** The words the register shows when the signup is done. */
export function welcomeMessage(o: { firstName: string; outcome: SignupOutcome; points: number; bonusPoints: number; attachedToSale: boolean }): string {
  const name = o.firstName.trim() || "the customer";
  const head =
    o.outcome === "linked" ? `${name} already had an account. It is now a loyalty account.` : `Welcome, ${name}! The loyalty account is open.`;
  const pts =
    o.points > 0
      ? ` ${o.points.toLocaleString("en-US")} points on the account${o.outcome === "created" && o.bonusPoints > 0 && o.points === o.bonusPoints ? " (signup bonus)" : ""}.`
      : "";
  const sale = o.attachedToSale ? " Attached to this sale: it earns points when the sale completes." : "";
  return `${head}${pts}${sale}`;
}

/**
 * The audit payload. Ids and choices only: no phone, email, birthday or
 * signature, because audit_logs is read far more widely than the customer
 * record.
 */
export function signupAuditAfter(o: {
  req: RegisterSignupRequest;
  outcome: SignupOutcome;
  signupId: string;
  customerId: string;
  enrolled: boolean;
  deviceId: string;
  registerId: string | null;
  duplicateBases: DuplicateBasis[];
}): Record<string, unknown> {
  return {
    via: "register",
    outcome: o.outcome,
    signupId: o.signupId,
    customerId: o.customerId,
    enrolled: o.enrolled,
    marketingConsent: o.req.marketingConsent,
    dobSource: o.req.dobSource,
    hadPhone: !!o.req.phoneNormalized,
    hadEmail: !!o.req.email,
    createdAnyway: o.req.createAnyway,
    usedExisting: !!o.req.useExistingCustomerId,
    duplicateBases: o.duplicateBases,
    deviceId: o.deviceId,
    registerId: o.registerId,
    employeeName: o.req.employeeName,
  };
}

/**
 * Rule 15: say what a database error means. Codes that mean the platform
 * moved get the fix; anything else is shown as-is with a retry hint.
 */
export function classifySignupDbError(err: { code?: string | null; message?: string | null } | null | undefined, what: string): string {
  const code = err?.code ?? "";
  const msg = (err?.message ?? "").trim();
  if (code === "42501" || /permission denied/i.test(msg)) {
    return `The server is not allowed to ${what} (permission denied). Nothing was saved. Tell the owner: run 0330_service_role_grants.sql in the Supabase SQL editor.`;
  }
  if (code === "42P01" || code === "PGRST205" || /could not find the table|does not exist/i.test(msg)) {
    return `The database is missing a table needed to ${what}. Nothing was saved. Tell the owner: a migration has not been applied.`;
  }
  if (code === "42703" || code === "PGRST204") {
    return `The database is missing a column needed to ${what}. Nothing was saved. Tell the owner: a migration has not been applied.`;
  }
  return `Could not ${what}${msg ? `: ${msg}` : ""}. Nothing was lost, try again.`;
}

/** True when an insert lost a UNIQUE race (rule 12/15: 23505 = already done). */
export function isUniqueViolation(err: { code?: string | null } | null | undefined): boolean {
  return err?.code === "23505";
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runRegisterLoyaltySignupCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`register-loyalty-signup-core FAIL: ${msg}`);
    }
  };
  const today = "2026-11-01";
  const sha = "a".repeat(64);
  const body = (over: Record<string, unknown> = {}) => ({
    clientRequestId: "11111111-2222-4333-8444-555555555555",
    firstName: "Jane",
    lastName: "Doe",
    dateOfBirth: "1990-04-12",
    dobSource: "scan",
    phone: "(360) 555-0101",
    email: "Jane@Example.com",
    marketingConsent: false,
    employeeName: "Sam Budtender",
    ...over,
  });
  const parse = (over: Record<string, unknown> = {}) => parseRegisterSignupRequest(body(over), today);
  const must = (over: Record<string, unknown> = {}) => {
    const r = parse(over);
    if (!r.ok) throw new Error(`register-loyalty-signup-core: expected ok, got ${r.error}`);
    return r.request;
  };

  // --- name helpers
  ok(titleCaseName("JANE") === "Jane", "title case caps");
  ok(titleCaseName("O'BRIEN") === "O'Brien", "title case apostrophe");
  ok(titleCaseName("SMITH-JONES") === "Smith-Jones", "title case hyphen");
  ok(titleCaseName("VAN DYKE") === "Van Dyke", "title case two words");
  ok(titleCaseName("McDonald") === "McDonald", "mixed case left alone");
  ok(titleCaseName(null) === "", "null -> empty");
  ok(prefillFirstName("JANE MARIE") === "Jane", "first word of ID first name");
  ok(formatPhoneInput("3605550101") === "(360) 555-0101", "format full phone");
  ok(formatPhoneInput("13605550101") === "(360) 555-0101", "format drops leading 1");
  ok(formatPhoneInput("360") === "(360", "format partial 3");
  ok(formatPhoneInput("36055") === "(360) 55", "format partial 5");
  ok(formatPhoneInput("") === "", "format empty");
  ok(formatPhoneInput("360555010199") === "(360) 555-0101", "format caps at 10 digits");
  ok(prefillFromSearch("360-555-0101").phone === "(360) 555-0101", "search digits -> phone");
  ok(prefillFromSearch("JANE@x.com").email === "jane@x.com", "search email -> email");
  ok(prefillFromSearch("doe").lastName === "Doe", "search one word -> last name");
  const two = prefillFromSearch("jane doe");
  ok(two.firstName === "Jane" && two.lastName === "Doe", "search two words -> names");
  ok(Object.keys(prefillFromSearch("13")).length === 0, "search short digits (Customer ID) -> nothing");

  // --- parse: happy path
  const r1 = must();
  ok(r1.phone === "(360) 555-0101" && r1.phoneNormalized === "3605550101", "phone cleaned");
  ok(r1.email === "jane@example.com", "email lowercased");
  ok(r1.marketingConsent === false && r1.signature === null && r1.consentTextSha256 === null, "no consent -> nothing recorded");
  ok(r1.dobSource === "scan", "dob source scan");
  ok(must({ dobSource: "manual" }).dobSource === "manual", "dob source manual");
  ok(must({ email: "" }).email === null, "email optional when phone given");
  ok(must({ phone: "" }).phoneNormalized === null, "phone optional when email given");
  ok(must({ clientRequestId: "11111111-2222-4333-8444-55555555555A" }).clientRequestId.endsWith("a"), "request id lowercased");

  // --- parse: refusals
  const bad = (over: Record<string, unknown>, field: keyof FieldErrors, msg: string) => {
    const r = parse(over);
    ok(!r.ok && !!r.fields[field], msg);
  };
  bad({ clientRequestId: "nope" }, "clientRequestId", "request id must be a uuid");
  bad({ firstName: "" }, "firstName", "first name required");
  bad({ lastName: "  " }, "lastName", "last name required");
  bad({ firstName: "123" }, "firstName", "name needs a letter");
  bad({ firstName: "x".repeat(NAME_MAX + 1) }, "firstName", "name max length");
  bad({ dateOfBirth: "" }, "dateOfBirth", "dob required");
  bad({ dateOfBirth: "04/12/1990" }, "dateOfBirth", "dob must be ymd");
  bad({ dateOfBirth: "2005-11-02" }, "dateOfBirth", "20 years 364 days is refused (Pacific today)");
  ok(parse({ dateOfBirth: "2005-11-01" }).ok, "21st birthday today is allowed");
  bad({ dateOfBirth: "1890-01-01" }, "dateOfBirth", "impossible age refused");
  bad({ phone: "555-0101" }, "phone", "7-digit phone refused");
  bad({ email: "not-an-email" }, "email", "bad email refused");
  bad({ phone: "", email: "" }, "contact", "phone or email required");
  bad({ marketingConsent: true, consentTextSha256: sha, signature: "" }, "signature", "consent needs a signature");
  bad({ marketingConsent: true, signature: "Jane Doe" }, "consent", "consent needs the wording hash");
  bad({ marketingConsent: true, signature: "Jane Doe", consentTextSha256: "xyz" }, "consent", "hash must be hex sha256");
  ok(parse({ marketingConsent: "true", signature: "" }).ok, "consent must be boolean true (string is a no)");
  ok(!parseRegisterSignupRequest(null, today).ok && !parseRegisterSignupRequest("x", today).ok, "non-object body refused");

  const rc = must({ marketingConsent: true, consentTextSha256: sha.toUpperCase(), signature: "  Jane   Doe " });
  ok(rc.marketingConsent && rc.signature === "Jane Doe" && rc.consentTextSha256 === sha, "consent parsed + normalized");

  // existing / create anyway
  const exId = "99999999-2222-4333-8444-555555555555";
  ok(must({ useExistingCustomerId: exId }).useExistingCustomerId === exId, "use existing parsed");
  ok(must({ useExistingCustomerId: "bad" }).useExistingCustomerId === null, "bad existing id ignored");
  ok(must({ useExistingCustomerId: exId, createAnyway: true }).createAnyway === false, "existing wins over create anyway");
  ok(must({ createAnyway: true }).createAnyway === true, "create anyway parsed");

  // --- consent verdict
  ok(consentVerdict(r1, sha).ok && (consentVerdict(r1, sha) as { recordConsent: boolean }).recordConsent === false, "no consent -> ok, not recorded");
  const cv = consentVerdict(rc, sha);
  ok(cv.ok && cv.recordConsent, "matching wording -> recorded");
  ok(!consentVerdict(rc, "b".repeat(64)).ok, "wording changed -> refused");
  ok(consentVerdict(rc, sha.toUpperCase()).ok, "published hash compared case-insensitively");

  // --- duplicates
  const cand = (over: Partial<DuplicateCandidate>): DuplicateCandidate => ({
    id: "c-x",
    first_name: "Someone",
    last_name: "Else",
    email: null,
    email_normalized: null,
    phone: null,
    phone_normalized: null,
    birthdate: null,
    marketing_consent: false,
    do_not_contact: false,
    loyalty_signup_id: null,
    ...over,
  });
  const byPhone = cand({ id: "c-phone", phone_normalized: "3605550101" });
  const byPhone11 = cand({ id: "c-phone11", phone_normalized: "13605550101" });
  const byRawPhone = cand({ id: "c-rawphone", phone: "360.555.0101" });
  const byEmail = cand({ id: "c-email", email: "JANE@example.com" });
  const byNameDob = cand({ id: "c-namedob", first_name: "JANE M", last_name: "doe", birthdate: "1990-04-12T00:00:00Z" });
  const nameNoDob = cand({ id: "c-nodob", first_name: "Jane", last_name: "Doe", birthdate: null });
  const nameOtherDob = cand({ id: "c-otherdob", first_name: "Jane", last_name: "Doe", birthdate: "1991-04-12" });
  const all3 = cand({ id: "c-all", first_name: "Jane", last_name: "Doe", birthdate: "1990-04-12", phone_normalized: "3605550101", email_normalized: "jane@example.com" });
  const stranger = cand({ id: "c-none", phone_normalized: "2065550000", email: "x@y.com" });

  ok(duplicateBases(r1, byPhone).join() === "phone", "phone match");
  ok(duplicateBases(r1, byPhone11).join() === "phone", "11-digit stored phone matches");
  ok(duplicateBases(r1, byRawPhone).join() === "phone", "raw phone matches when not normalized");
  ok(duplicateBases(r1, byEmail).join() === "email", "email match via raw email");
  ok(duplicateBases(r1, byNameDob).join() === "name_dob", "name+dob match (first token, case, timestamp dob)");
  ok(duplicateBases(r1, nameNoDob).length === 0, "same name, no dob -> not a match");
  ok(duplicateBases(r1, nameOtherDob).length === 0, "same name, other dob -> not a match");
  ok(duplicateBases(r1, stranger).length === 0, "stranger -> no match");
  ok(duplicateBases({ ...r1, phoneNormalized: null, email: null }, byPhone).length === 0, "no contact -> no contact match");

  const found = findRegisterSignupDuplicates(r1, [stranger, byEmail, byPhone, all3, byNameDob, byPhone]);
  ok(found.length === 4, "duplicates listed once each, strangers dropped");
  ok(found[0].customerId === "c-all" && found[0].bases.join() === "name_dob,phone,email", "strongest + most reasons first");
  ok(found[1].customerId === "c-namedob", "name+dob before phone");
  ok(found[2].customerId === "c-phone" && found[3].customerId === "c-email", "phone before email");
  ok(found[0].label === "Jane D." && found[0].fullName === "Jane Doe", "privacy-lean label + full name");

  // --- plan
  ok(planRegisterSignup(r1, []).kind === "create", "no candidates -> create");
  ok(planRegisterSignup(r1, [stranger]).kind === "create", "only strangers -> create");
  const pd = planRegisterSignup(r1, [byPhone]);
  ok(pd.kind === "duplicates" && pd.matches.length === 1, "match -> show duplicates, write nothing");
  ok(planRegisterSignup({ ...r1, createAnyway: true }, [byPhone]).kind === "create", "create anyway -> create");
  const pa = planRegisterSignup({ ...r1, useExistingCustomerId: "c-phone" }, [byPhone]);
  ok(pa.kind === "attach_existing" && pa.customer.id === "c-phone", "chosen match -> attach");
  ok(planRegisterSignup({ ...r1, useExistingCustomerId: "c-none" }, [stranger]).kind === "refuse", "cannot attach a non-matching customer");
  ok(planRegisterSignup({ ...r1, useExistingCustomerId: "c-gone" }, [byPhone]).kind === "refuse", "cannot attach a missing customer");

  // --- rows
  ok(legacyIdFor("ABC") === "register:abc", "legacy id prefix + lowercase");
  const now = "2026-11-02T03:00:00.000Z";
  const row = buildRegisterSignupRow(r1, { nowIso: now, registerName: "Register 1", consentText: "words", consentSha256: sha, dedupeOf: null });
  ok(row.legacy_id === "register:11111111-2222-4333-8444-555555555555", "row legacy id");
  ok(row.status === "entered" && row.entered_at === now && row.entered_by === null, "row entered, device is not staff");
  ok(row.source === REGISTER_SIGNUP_SOURCE, "row source register");
  ok(row.birthday === "1990-04-12" && row.mobile_phone === "(360) 555-0101" && row.phone_normalized === "3605550101", "row contact");
  ok(row.consent === false && row.signature === null && row.consent_text === null && row.consent_text_sha256 === null, "no consent -> no wording, no signature recorded");
  ok(row.email_opt_out === false && row.unsubscribed_at === null, "opt-out columns explicit");
  ok(row.staff_note.includes("Register 1") && row.staff_note.includes("Sam Budtender") && row.staff_note.includes("scanned"), "staff note names register, employee, dob source");
  ok(row.staff_note.includes("Messages: no"), "staff note says no messages");
  const rowC = buildRegisterSignupRow(rc, { nowIso: now, registerName: "", consentText: "words", consentSha256: sha, dedupeOf: "s-0" });
  ok(rowC.consent && rowC.signature === "Jane Doe" && rowC.consent_text === "words" && rowC.consent_text_sha256 === sha, "consent -> wording + hash + signature recorded");
  ok(rowC.dedupe_of === "s-0", "dedupe_of carried");
  ok(rowC.staff_note.includes("Messages: yes (signed)") && !rowC.staff_note.includes("()"), "consent note; no empty register name");

  const cust = buildRegisterSignupCustomer("sig-9", r1);
  ok(cust.import_source === REGISTER_SIGNUP_IMPORT_SOURCE, "customer stamped register-signup");
  ok(cust.loyalty_signup_id === "sig-9", "customer linked to signup");
  ok(cust.birthdate === "1990-04-12", "customer birthdate = verified dob (next visit auto-matches)");
  ok(cust.phone_normalized === "3605550101" && cust.email_normalized === "jane@example.com", "customer normalized contact");
  ok(cust.marketing_consent === false, "no consent -> marketing false");
  ok(buildRegisterSignupCustomer("sig-9", rc).marketing_consent === true, "consent -> marketing true");

  const patch = buildRegisterLinkPatch("sig-9", rc, byPhone);
  ok(patch.loyalty_signup_id === "sig-9" && patch.birthdate === "1990-04-12" && patch.marketing_consent === true, "link fills gaps + consent");
  const dnc = buildRegisterLinkPatch("sig-9", rc, { ...byPhone, do_not_contact: true });
  ok(!("marketing_consent" in dnc), "link never overrides do_not_contact");
  const keepYes = buildRegisterLinkPatch("sig-9", r1, { ...all3, marketing_consent: true });
  ok(!("marketing_consent" in keepYes), "a 'no thanks' today never downgrades a past yes");
  ok(!("email" in buildRegisterLinkPatch("sig-9", r1, { ...byEmail, email: "old@x.com" })), "link never overwrites email");

  // --- messages + audit
  const w1 = welcomeMessage({ firstName: "Jane", outcome: "created", points: 200, bonusPoints: 200, attachedToSale: true });
  ok(w1.includes("Welcome, Jane") && w1.includes("200 points") && w1.includes("signup bonus") && w1.includes("Attached"), "welcome created");
  const w2 = welcomeMessage({ firstName: "Jane", outcome: "linked", points: 1500, bonusPoints: 200, attachedToSale: false });
  ok(w2.includes("already had an account") && w2.includes("1,500 points") && !w2.includes("bonus") && !w2.includes("Attached"), "welcome linked");
  ok(!welcomeMessage({ firstName: "", outcome: "created", points: 0, bonusPoints: 0, attachedToSale: false }).includes("points"), "no points line at 0");

  const audit = signupAuditAfter({ req: rc, outcome: "created", signupId: "s", customerId: "c", enrolled: true, deviceId: "d", registerId: null, duplicateBases: [] });
  const auditText = JSON.stringify(audit);
  ok(!auditText.includes("555") && !auditText.includes("example.com") && !auditText.includes("1990") && !auditText.includes("Jane Doe"), "audit has no phone/email/dob/signature");
  ok(audit.marketingConsent === true && audit.hadPhone === true && audit.outcome === "created", "audit has the choices");

  // --- db errors
  ok(classifySignupDbError({ code: "42501", message: "permission denied for table customers" }, "save").includes("0330"), "42501 -> grants fix");
  ok(classifySignupDbError({ code: "PGRST205" }, "save").includes("migration"), "missing table");
  ok(classifySignupDbError({ code: "42703" }, "save").includes("column"), "missing column");
  ok(classifySignupDbError({ code: "XX000", message: "boom" }, "save").includes("boom"), "other error shown");
  ok(isUniqueViolation({ code: "23505" }) && !isUniqueViolation({ code: "42501" }) && !isUniqueViolation(null), "23505 = already done");

  return { passed, failed };
}
