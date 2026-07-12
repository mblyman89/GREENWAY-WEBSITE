/**
 * src/lib/orders/customer-link-core.ts
 *
 * PURE matching logic for STAFF-CONFIRMED customer↔order linking
 * (Task T / PR 4). An online pickup order arrives as guest contact info
 * (name/phone/email typed at checkout). Linking it to a POS customer record
 * makes loyalty accrual work on completion (orders-store accrues points for
 * `customer_id` when the order completes) — but the link must be a HUMAN
 * decision: this module only ranks candidates, it never auto-links.
 *
 * No I/O — unit-testable in isolation.
 */

/** Digits-only phone, mirroring customers/store.ts normalizePhone. */
export function normalizePhoneDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D+/g, "");
  return digits.length > 0 ? digits : null;
}

/** Lowercased, trimmed email for case-insensitive comparison. */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  return e.length > 0 ? e : null;
}

export type OrderContact = {
  phone: string | null;
  email: string | null;
};

export type CustomerCandidate = {
  id: string;
  firstName: string;
  lastName: string | null;
  /** Digits-only (customers.phone_normalized). */
  phoneNormalized: string | null;
  email: string | null;
};

export type MatchBasis = "phone_and_email" | "phone" | "email";

export type RankedMatch = {
  customerId: string;
  name: string;
  basis: MatchBasis;
  /** Human label for the UI, e.g. "Phone + email match". */
  basisLabel: string;
};

const BASIS_LABEL: Record<MatchBasis, string> = {
  phone_and_email: "Phone + email match",
  phone: "Phone match",
  email: "Email match",
};

const BASIS_RANK: Record<MatchBasis, number> = {
  phone_and_email: 0,
  phone: 1,
  email: 2,
};

/** How (if at all) a candidate matches the order's contact info. */
export function matchBasis(order: OrderContact, c: CustomerCandidate): MatchBasis | null {
  const orderPhone = normalizePhoneDigits(order.phone);
  const orderEmail = normalizeEmail(order.email);
  const phoneHit = orderPhone != null && c.phoneNormalized != null && orderPhone === c.phoneNormalized;
  const emailHit = orderEmail != null && normalizeEmail(c.email) === orderEmail;
  if (phoneHit && emailHit) return "phone_and_email";
  if (phoneHit) return "phone";
  if (emailHit) return "email";
  return null;
}

/**
 * Rank candidates best-first (phone+email, then phone, then email;
 * stable within a basis). Non-matching candidates are dropped.
 */
export function rankCustomerMatches(
  order: OrderContact,
  candidates: CustomerCandidate[],
): RankedMatch[] {
  const out: RankedMatch[] = [];
  for (const c of candidates) {
    const basis = matchBasis(order, c);
    if (!basis) continue;
    out.push({
      customerId: c.id,
      name: `${c.firstName}${c.lastName ? ` ${c.lastName}` : ""}`,
      basis,
      basisLabel: BASIS_LABEL[basis],
    });
  }
  return out.sort((a, b) => BASIS_RANK[a.basis] - BASIS_RANK[b.basis]);
}
