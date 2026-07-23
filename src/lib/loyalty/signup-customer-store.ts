/**
 * src/lib/loyalty/signup-customer-store.ts
 *
 * Task V / PR A — connect a validated loyalty signup to the customers table.
 * When staff mark a signup "entered" (or click "Add to customers" on an older
 * entered signup), this store:
 *
 *   1. Returns the already-linked customer when one carries this signup's id
 *      (idempotent — safe to run twice).
 *   2. Otherwise looks for an existing customer with the same normalized
 *      phone/email and LINKS it (fill-the-gaps patch, never overwrites).
 *   3. Otherwise CREATES a new customer from the signup's details.
 *   4. Best-effort enrolls the customer in the loyalty program (signup bonus
 *      applies via the loyalty engine; a missing loyalty table degrades
 *      gracefully to "not enrolled" without failing the connection).
 *
 * All decision logic is pure (signup-customer-core.ts); this file is I/O only.
 * SERVER-ONLY (service-role client).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { escapeIlikeOrTerm } from "@/lib/supabase/postgrest-escape";
import { enrollCustomer } from "@/lib/loyalty/loyalty-store";
import {
  mapSignupToCustomerFields,
  pickExistingCustomer,
  buildLinkPatch,
  normalizeEmailLower,
  normalizePhoneDigits,
  SIGNUP_MATCH_BASIS_LABEL,
  type SignupForCustomer,
  type CustomerForLink,
  type SignupMatchBasis,
} from "@/lib/loyalty/signup-customer-core";

export type ConnectOutcome = "created" | "linked" | "already_connected";

export type ConnectResult =
  | {
      ok: true;
      outcome: ConnectOutcome;
      customerId: string;
      customerName: string;
      /** Set when an existing customer was matched (linked). */
      basis: SignupMatchBasis | null;
      basisLabel: string | null;
      /** True when the customer holds a loyalty account after this call. */
      enrolled: boolean;
    }
  | { ok: false; error: string };

const CUSTOMER_LINK_COLUMNS =
  "id, first_name, last_name, email, email_normalized, phone, phone_normalized, birthdate, marketing_consent, do_not_contact, loyalty_signup_id";

function customerName(c: { first_name: string; last_name: string | null }): string {
  return `${c.first_name}${c.last_name ? ` ${c.last_name}` : ""}`.trim();
}

/** Best-effort loyalty enrollment; never throws, never fails the connection. */
async function tryEnroll(customerId: string, actorId: string | null): Promise<boolean> {
  try {
    const res = await enrollCustomer(customerId, actorId);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Create-or-link the customer record for a signup. Idempotent: re-running for
 * an already-connected signup returns the existing customer.
 */
export async function connectSignupToCustomer(
  signupId: string,
  actorId: string | null,
): Promise<ConnectResult> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Database not configured." };
  }
  const admin = createSupabaseAdminClient();

  const { data: signupRow, error: signupError } = await admin
    .from("loyalty_signups")
    .select(
      "id, first_name, last_name, birthday, mobile_phone, phone_normalized, email, consent, email_opt_out, unsubscribed_at",
    )
    .eq("id", signupId)
    .maybeSingle<SignupForCustomer>();
  if (signupError) return { ok: false, error: signupError.message };
  if (!signupRow) return { ok: false, error: "Signup not found." };

  // 1) Already connected? (customers.loyalty_signup_id carries this signup)
  const { data: existing } = await admin
    .from("customers")
    .select(CUSTOMER_LINK_COLUMNS)
    .eq("loyalty_signup_id", signupId)
    .limit(1)
    .maybeSingle<CustomerForLink>();
  if (existing) {
    const enrolled = await tryEnroll(existing.id, actorId);
    return {
      ok: true,
      outcome: "already_connected",
      customerId: existing.id,
      customerName: customerName(existing),
      basis: null,
      basisLabel: null,
      enrolled,
    };
  }

  // 2) Match an existing customer by normalized phone / email.
  const phone = signupRow.phone_normalized ?? normalizePhoneDigits(signupRow.mobile_phone);
  const email = normalizeEmailLower(signupRow.email);
  let candidates: CustomerForLink[] = [];
  if (phone || email) {
    const ors: string[] = [];
    if (phone) ors.push(`phone_normalized.eq.${phone}`);
    if (email) {
      ors.push(`email_normalized.eq.${email}`);
      // GW-021: `_` is legal in emails but is a LIKE wildcard; escape so the
      // case-insensitive match stays exact (and `.or()` grammar stays intact).
      const emailLike = escapeIlikeOrTerm(email);
      if (emailLike) ors.push(`email.ilike.${emailLike}`);
    }
    const { data } = await admin
      .from("customers")
      .select(CUSTOMER_LINK_COLUMNS)
      .or(ors.join(","))
      .limit(10);
    candidates = (data as CustomerForLink[] | null) ?? [];
  }

  const match = pickExistingCustomer(signupRow, candidates);
  if (match) {
    const patch = buildLinkPatch(signupRow, match.customer);
    if (Object.keys(patch).length > 0) {
      const { error } = await admin
        .from("customers")
        .update({ ...patch, updated_by: actorId })
        .eq("id", match.customer.id);
      if (error) return { ok: false, error: error.message };
    }
    const enrolled = await tryEnroll(match.customer.id, actorId);
    return {
      ok: true,
      outcome: "linked",
      customerId: match.customer.id,
      customerName: customerName(match.customer),
      basis: match.basis,
      basisLabel: SIGNUP_MATCH_BASIS_LABEL[match.basis],
      enrolled,
    };
  }

  // 3) No match — create a new customer from the signup.
  const fields = mapSignupToCustomerFields(signupRow);
  const { data: created, error: insertError } = await admin
    .from("customers")
    .insert({ ...fields, created_by: actorId, updated_by: actorId })
    .select("id, first_name, last_name")
    .single<{ id: string; first_name: string; last_name: string | null }>();
  if (insertError || !created) {
    return { ok: false, error: insertError?.message ?? "Could not create the customer." };
  }
  const enrolled = await tryEnroll(created.id, actorId);
  return {
    ok: true,
    outcome: "created",
    customerId: created.id,
    customerName: customerName(created),
    basis: null,
    basisLabel: null,
    enrolled,
  };
}

/**
 * For the queue UI: which of these signups already have a linked customer?
 * Returns a map signupId -> { customerId, name }.
 */
export async function getLinkedCustomersForSignups(
  signupIds: string[],
): Promise<Map<string, { customerId: string; name: string }>> {
  const out = new Map<string, { customerId: string; name: string }>();
  if (!isSupabaseServiceConfigured || signupIds.length === 0) return out;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("customers")
    .select("id, first_name, last_name, loyalty_signup_id")
    .in("loyalty_signup_id", signupIds);
  for (const row of (data as
    | { id: string; first_name: string; last_name: string | null; loyalty_signup_id: string | null }[]
    | null) ?? []) {
    if (row.loyalty_signup_id) {
      out.set(row.loyalty_signup_id, { customerId: row.id, name: customerName(row) });
    }
  }
  return out;
}
