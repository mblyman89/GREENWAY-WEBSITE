/**
 * src/lib/loyalty/signup-customer-core.ts
 *
 * Task V / PR A — PURE logic for connecting a validated loyalty signup to a
 * CUSTOMER record. When staff mark a signup "entered", the back office now
 * creates (or links to an existing) customer automatically, so the owner never
 * re-keys signups into a POS by hand again.
 *
 * This module decides — with zero I/O — HOW a given signup maps onto the
 * customers table:
 *   - mapSignupToCustomerFields(): field-by-field mapping for a NEW customer
 *   - pickExistingCustomer():      best existing match (phone+email > phone > email)
 *   - buildLinkPatch():            conservative fill-the-gaps patch for a match
 *
 * Consent rules are deliberate:
 *   - marketing_consent comes from the signup's consent checkbox, but is
 *     revoked by an email unsubscribe (email_opt_out / unsubscribed_at).
 *   - an existing customer's do_not_contact flag is NEVER overridden.
 *
 * Unit-tested via __runSignupCustomerTests() (registered in the pure
 * self-test suite).
 */

/** The subset of a loyalty_signups row this module needs. */
export type SignupForCustomer = {
  id: string;
  first_name: string;
  last_name: string;
  birthday: string | null;
  mobile_phone: string | null;
  phone_normalized: string | null;
  email: string | null;
  consent: boolean;
  email_opt_out: boolean;
  unsubscribed_at: string | null;
};

/** The subset of a customers row needed to match & patch. */
export type CustomerForLink = {
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

export type SignupMatchBasis = "phone_and_email" | "phone" | "email";

const BASIS_RANK: Record<SignupMatchBasis, number> = {
  phone_and_email: 0,
  phone: 1,
  email: 2,
};

export const SIGNUP_MATCH_BASIS_LABEL: Record<SignupMatchBasis, string> = {
  phone_and_email: "phone + email match",
  phone: "phone match",
  email: "email match",
};

/** Digits-only phone (mirrors customers/store.ts normalizePhone). */
export function normalizePhoneDigits(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

/** Lowercased, trimmed email; null when empty/invalid-ish. */
export function normalizeEmailLower(value: string | null | undefined): string | null {
  if (!value) return null;
  const e = value.trim().toLowerCase();
  return e.length > 0 && e.includes("@") ? e : null;
}

/**
 * Marketing consent derived from the signup: the customer ticked the consent
 * box AND has not since unsubscribed from emails.
 */
export function marketingConsentFromSignup(s: SignupForCustomer): boolean {
  return s.consent === true && s.email_opt_out !== true && s.unsubscribed_at == null;
}

/** Fields for INSERTING a brand-new customer from a signup. */
export type NewCustomerFields = {
  first_name: string;
  last_name: string | null;
  email: string | null;
  email_normalized: string | null;
  phone: string | null;
  phone_normalized: string | null;
  birthdate: string | null;
  marketing_consent: boolean;
  loyalty_signup_id: string;
  import_source: string;
};

export function mapSignupToCustomerFields(s: SignupForCustomer): NewCustomerFields {
  const email = normalizeEmailLower(s.email);
  return {
    first_name: s.first_name.trim() || "(unknown)",
    last_name: s.last_name.trim() ? s.last_name.trim() : null,
    email,
    email_normalized: email,
    phone: s.mobile_phone?.trim() ? s.mobile_phone.trim() : null,
    phone_normalized: s.phone_normalized ?? normalizePhoneDigits(s.mobile_phone),
    birthdate: s.birthday?.trim() ? s.birthday.trim() : null,
    marketing_consent: marketingConsentFromSignup(s),
    loyalty_signup_id: s.id,
    import_source: "loyalty-signup",
  };
}

/** How (if at all) an existing customer matches the signup's contact info. */
export function signupMatchBasis(
  s: SignupForCustomer,
  c: Pick<CustomerForLink, "phone_normalized" | "email" | "email_normalized">,
): SignupMatchBasis | null {
  const sPhone = s.phone_normalized ?? normalizePhoneDigits(s.mobile_phone);
  const sEmail = normalizeEmailLower(s.email);
  const cEmail = c.email_normalized ?? normalizeEmailLower(c.email);
  const phoneHit = sPhone != null && c.phone_normalized != null && sPhone === c.phone_normalized;
  const emailHit = sEmail != null && cEmail != null && sEmail === cEmail;
  if (phoneHit && emailHit) return "phone_and_email";
  if (phoneHit) return "phone";
  if (emailHit) return "email";
  return null;
}

/**
 * Pick the best existing customer for this signup, or null when a new record
 * should be created. Rank: phone+email > phone > email; within a basis, a
 * customer already carrying this signup's id wins (idempotent re-runs), then
 * one with NO signup link yet beats one linked to a different signup.
 */
export function pickExistingCustomer(
  s: SignupForCustomer,
  candidates: CustomerForLink[],
): { customer: CustomerForLink; basis: SignupMatchBasis } | null {
  let best: { customer: CustomerForLink; basis: SignupMatchBasis; tie: number } | null = null;
  for (const c of candidates) {
    const basis = signupMatchBasis(s, c);
    if (!basis) continue;
    // Tie-break within a basis: 0 = already linked to THIS signup,
    // 1 = no signup link yet, 2 = linked to a different signup.
    const tie = c.loyalty_signup_id === s.id ? 0 : c.loyalty_signup_id == null ? 1 : 2;
    if (
      !best ||
      BASIS_RANK[basis] < BASIS_RANK[best.basis] ||
      (BASIS_RANK[basis] === BASIS_RANK[best.basis] && tie < best.tie)
    ) {
      best = { customer: c, basis, tie };
    }
  }
  return best ? { customer: best.customer, basis: best.basis } : null;
}

/**
 * Conservative patch for LINKING a signup to an existing customer:
 *   - only FILLS fields the customer is missing (never overwrites data)
 *   - sets loyalty_signup_id only when the customer has none
 *   - upgrades marketing_consent false -> true only when the signup grants it
 *     AND the customer is not flagged do_not_contact
 * Returns {} when nothing needs to change.
 */
export function buildLinkPatch(
  s: SignupForCustomer,
  c: CustomerForLink,
): Record<string, string | boolean> {
  const patch: Record<string, string | boolean> = {};
  const email = normalizeEmailLower(s.email);
  const phone = s.mobile_phone?.trim() ? s.mobile_phone.trim() : null;
  const phoneNorm = s.phone_normalized ?? normalizePhoneDigits(s.mobile_phone);
  const birthdate = s.birthday?.trim() ? s.birthday.trim() : null;

  if (c.loyalty_signup_id == null) patch.loyalty_signup_id = s.id;
  if (c.email == null && email) {
    patch.email = email;
    patch.email_normalized = email;
  } else if (c.email != null && c.email_normalized == null) {
    const norm = normalizeEmailLower(c.email);
    if (norm) patch.email_normalized = norm;
  }
  if (c.phone == null && phone) {
    patch.phone = phone;
    if (phoneNorm) patch.phone_normalized = phoneNorm;
  }
  if (c.birthdate == null && birthdate) patch.birthdate = birthdate;
  if (
    !c.marketing_consent &&
    !c.do_not_contact &&
    marketingConsentFromSignup(s)
  ) {
    patch.marketing_consent = true;
  }
  return patch;
}

// ---------------------------------------------------------------------------
// Embedded self-tests
// ---------------------------------------------------------------------------

export function __runSignupCustomerTests(): string {
  let n = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
    n++;
  };

  const signup: SignupForCustomer = {
    id: "sig-1",
    first_name: "Jane",
    last_name: "Doe",
    birthday: "1990-04-12",
    mobile_phone: "(360) 555-0101",
    phone_normalized: "3605550101",
    email: "Jane@Example.com",
    consent: true,
    email_opt_out: false,
    unsubscribed_at: null,
  };

  // normalization helpers
  ok(normalizePhoneDigits("(360) 555-0101") === "3605550101", "phone digits");
  ok(normalizePhoneDigits("") === null, "empty phone -> null");
  ok(normalizeEmailLower("  Jane@Example.com ") === "jane@example.com", "email lowercased");
  ok(normalizeEmailLower("not-an-email") === null, "email without @ -> null");

  // consent mapping
  ok(marketingConsentFromSignup(signup) === true, "consent true");
  ok(
    marketingConsentFromSignup({ ...signup, email_opt_out: true }) === false,
    "opt-out revokes consent",
  );
  ok(
    marketingConsentFromSignup({ ...signup, unsubscribed_at: "2025-01-01T00:00:00Z" }) === false,
    "unsubscribe revokes consent",
  );
  ok(marketingConsentFromSignup({ ...signup, consent: false }) === false, "no checkbox -> false");

  // new-customer mapping
  const fields = mapSignupToCustomerFields(signup);
  ok(fields.first_name === "Jane" && fields.last_name === "Doe", "names mapped");
  ok(fields.email === "jane@example.com", "email normalized on create");
  ok(fields.email_normalized === "jane@example.com", "email_normalized set");
  ok(fields.phone === "(360) 555-0101", "raw phone preserved");
  ok(fields.phone_normalized === "3605550101", "phone_normalized mapped");
  ok(fields.birthdate === "1990-04-12", "birthday -> birthdate");
  ok(fields.marketing_consent === true, "consent mapped");
  ok(fields.loyalty_signup_id === "sig-1", "signup id linked");
  ok(fields.import_source === "loyalty-signup", "import source stamped");
  const blank = mapSignupToCustomerFields({
    ...signup,
    first_name: "  ",
    last_name: "",
    email: null,
    mobile_phone: null,
    phone_normalized: null,
    birthday: null,
  });
  ok(blank.first_name === "(unknown)", "blank first name placeholder");
  ok(blank.email === null && blank.phone === null && blank.birthdate === null, "blank contact -> nulls");

  // match basis
  const cust = (over: Partial<CustomerForLink>): CustomerForLink => ({
    id: "c-1",
    first_name: "Jane",
    last_name: "Doe",
    email: "jane@example.com",
    email_normalized: "jane@example.com",
    phone: "3605550101",
    phone_normalized: "3605550101",
    birthdate: null,
    marketing_consent: false,
    do_not_contact: false,
    loyalty_signup_id: null,
    ...over,
  });
  ok(signupMatchBasis(signup, cust({})) === "phone_and_email", "both match");
  ok(signupMatchBasis(signup, cust({ email: null, email_normalized: null })) === "phone", "phone only");
  ok(
    signupMatchBasis(signup, cust({ phone_normalized: null })) === "email",
    "email only",
  );
  ok(
    signupMatchBasis(signup, cust({ phone_normalized: "9998887777", email: "x@y.com", email_normalized: "x@y.com" })) === null,
    "no match",
  );
  // email matches via raw email when email_normalized is null
  ok(
    signupMatchBasis(signup, cust({ phone_normalized: null, email: "JANE@example.com", email_normalized: null })) ===
      "email",
    "raw email fallback match",
  );

  // pick best candidate
  const phoneOnly = cust({ id: "c-phone", email: null, email_normalized: null });
  const emailOnly = cust({ id: "c-email", phone_normalized: null });
  const both = cust({ id: "c-both" });
  ok(
    pickExistingCustomer(signup, [emailOnly, phoneOnly, both])?.customer.id === "c-both",
    "phone+email outranks singles",
  );
  ok(
    pickExistingCustomer(signup, [emailOnly, phoneOnly])?.customer.id === "c-phone",
    "phone outranks email",
  );
  ok(pickExistingCustomer(signup, []) === null, "no candidates -> create");
  // tie-break: already-linked-to-this-signup wins; unlinked beats other-signup
  const linkedHere = cust({ id: "c-mine", loyalty_signup_id: "sig-1" });
  const linkedOther = cust({ id: "c-other", loyalty_signup_id: "sig-999" });
  const unlinked = cust({ id: "c-free" });
  ok(
    pickExistingCustomer(signup, [linkedOther, unlinked, linkedHere])?.customer.id === "c-mine",
    "idempotent: same-signup link wins tie",
  );
  ok(
    pickExistingCustomer(signup, [linkedOther, unlinked])?.customer.id === "c-free",
    "unlinked beats other-signup link",
  );

  // link patch: fill-only
  const bare = cust({
    id: "c-bare",
    email: null,
    email_normalized: null,
    phone: null,
    phone_normalized: null,
    birthdate: null,
  });
  const patch = buildLinkPatch(signup, bare);
  ok(patch.loyalty_signup_id === "sig-1", "patch links signup");
  ok(patch.email === "jane@example.com" && patch.email_normalized === "jane@example.com", "patch fills email");
  ok(patch.phone === "(360) 555-0101" && patch.phone_normalized === "3605550101", "patch fills phone");
  ok(patch.birthdate === "1990-04-12", "patch fills birthdate");
  ok(patch.marketing_consent === true, "patch grants consent");

  // never overwrite existing data / other links
  const full = cust({
    id: "c-full",
    email: "old@example.com",
    email_normalized: "old@example.com",
    birthdate: "1980-01-01",
    marketing_consent: true,
    loyalty_signup_id: "sig-999",
  });
  const patch2 = buildLinkPatch(signup, full);
  ok(!("email" in patch2) && !("birthdate" in patch2), "existing data untouched");
  ok(!("loyalty_signup_id" in patch2), "existing signup link untouched");
  ok(!("marketing_consent" in patch2), "already-consented untouched");

  // do_not_contact is never overridden
  const dnc = cust({ id: "c-dnc", marketing_consent: false, do_not_contact: true });
  ok(!("marketing_consent" in buildLinkPatch(signup, dnc)), "do_not_contact respected");

  // backfill email_normalized on customers that predate migration 0029
  const legacyEmail = cust({ id: "c-legacy", email: "Jane@Example.com", email_normalized: null });
  ok(
    buildLinkPatch(signup, legacyEmail).email_normalized === "jane@example.com",
    "email_normalized backfilled",
  );

  return `signup-customer-core: ${n} assertions passed`;
}
