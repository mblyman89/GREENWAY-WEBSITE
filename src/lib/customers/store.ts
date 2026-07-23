/**
 * src/lib/customers/store.ts
 *
 * Server-side read/write helpers for customers + patient authorizations.
 * Staff-only (PII) — all access via the service-role client behind RLS.
 * Part of POS Slice 2.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { ilikeContains } from "@/lib/supabase/postgrest-escape";
import type { Customer, CustomerInput, PatientAuthorization } from "@/lib/customers/types";

/** Digits-only phone for dedupe/search (mirrors loyalty normalization). */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D+/g, "");
  return digits.length > 0 ? digits : null;
}

export async function listCustomers(opts?: { q?: string; limit?: number }): Promise<Customer[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  let query = admin
    .from("customers")
    .select("*")
    .order("last_visit_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 500);

  if (opts?.q && opts.q.trim().length > 0) {
    const digits = normalizePhone(opts.q.trim());
    // GW-021: escape LIKE wildcards + .or() grammar so the term matches literally.
    const like = ilikeContains(opts.q);
    // Match on name, email, or normalized phone.
    const ors = like
      ? [`first_name.ilike.${like}`, `last_name.ilike.${like}`, `email.ilike.${like}`]
      : [];
    if (digits) ors.push(`phone_normalized.ilike.%${digits}%`);
    if (ors.length > 0) query = query.or(ors.join(","));
  }

  const { data } = await query;
  return (data as Customer[] | null) ?? [];
}

/**
 * GW-033 — paged variant of listCustomers for the admin customers list.
 * Returns the requested window plus the exact filtered total so the page can
 * render a real pager ("Showing 101–200 of 431 customers") instead of a
 * silently truncated 500-row list. Same search semantics as listCustomers
 * (name/email ilike + digits-only phone); other callers keep the small-limit
 * listCustomers.
 */
export async function listCustomersPaged(opts: {
  q?: string;
  from: number;
  to: number;
}): Promise<{ rows: Customer[]; total: number }> {
  if (!isSupabaseServiceConfigured) return { rows: [], total: 0 };
  const admin = createSupabaseAdminClient();
  let query = admin
    .from("customers")
    .select("*", { count: "exact" })
    .order("last_visit_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (opts.q && opts.q.trim().length > 0) {
    const digits = normalizePhone(opts.q.trim());
    // GW-021: escape LIKE wildcards + .or() grammar so the term matches literally.
    const like = ilikeContains(opts.q);
    const ors = like
      ? [`first_name.ilike.${like}`, `last_name.ilike.${like}`, `email.ilike.${like}`]
      : [];
    if (digits) ors.push(`phone_normalized.ilike.%${digits}%`);
    if (ors.length > 0) query = query.or(ors.join(","));
  }

  const { data, count } = await query.range(opts.from, opts.to);
  return { rows: (data as Customer[] | null) ?? [], total: count ?? 0 };
}

/**
 * Task AO-3 — candidate pool for the register's scan-to-member match: every
 * customer whose birthdate equals the scanned DOB (yyyy-mm-dd). DOB is the
 * strictest single filter available (a store has few customers per exact
 * birthday), so the pure matcher only ever sees a handful of rows and the
 * name comparison happens in code, not in SQL (normalization lives in ONE
 * place: member-match-core).
 */
export async function listCustomersByBirthdate(birthdate: string): Promise<Customer[]> {
  if (!isSupabaseServiceConfigured) return [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("customers").select("*").eq("birthdate", birthdate).limit(25);
  return (data as Customer[] | null) ?? [];
}

export async function countCustomers(): Promise<{ total: number; medical: number; consented: number }> {
  if (!isSupabaseServiceConfigured) return { total: 0, medical: 0, consented: 0 };
  const admin = createSupabaseAdminClient();
  const [{ count: total }, { count: medical }, { count: consented }] = await Promise.all([
    admin.from("customers").select("*", { count: "exact", head: true }),
    admin.from("customers").select("*", { count: "exact", head: true }).eq("is_medical_patient", true),
    admin.from("customers").select("*", { count: "exact", head: true }).eq("marketing_consent", true),
  ]);
  return { total: total ?? 0, medical: medical ?? 0, consented: consented ?? 0 };
}

export async function getCustomerById(id: string): Promise<Customer | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("customers").select("*").eq("id", id).maybeSingle();
  return (data as Customer | null) ?? null;
}

export async function listPatientAuthorizations(customerId: string): Promise<PatientAuthorization[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("patient_authorizations")
    .select("*")
    .eq("customer_id", customerId)
    .order("expires_on", { ascending: false, nullsFirst: false });
  return (data as PatientAuthorization[] | null) ?? [];
}

export async function createCustomer(input: CustomerInput, actorId: string | null): Promise<Customer | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("customers")
    .insert({
      first_name: input.first_name,
      last_name: input.last_name ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      phone_normalized: normalizePhone(input.phone),
      birthdate: input.birthdate ?? null,
      marketing_consent: input.marketing_consent ?? false,
      do_not_contact: input.do_not_contact ?? false,
      staff_note: input.staff_note ?? null,
      created_by: actorId,
      updated_by: actorId,
    })
    .select("*")
    .single();
  if (error) throw error;
  return (data as Customer) ?? null;
}

export async function updateCustomer(
  id: string,
  input: CustomerInput,
  actorId: string | null,
): Promise<Customer | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("customers")
    .update({
      first_name: input.first_name,
      last_name: input.last_name ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      phone_normalized: normalizePhone(input.phone),
      birthdate: input.birthdate ?? null,
      marketing_consent: input.marketing_consent ?? false,
      do_not_contact: input.do_not_contact ?? false,
      staff_note: input.staff_note ?? null,
      updated_by: actorId,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return (data as Customer) ?? null;
}

/**
 * True when a yyyy-mm-dd birthdate is at least 21 years ago (age-gate helper).
 *
 * S-20 timezone fix: `new Date("yyyy-mm-dd")` parses as UTC MIDNIGHT, but the
 * old cutoff was built in the SERVER's local zone — on a UTC server that could
 * flip the answer for someone whose 21st birthday is "today" in Pacific time.
 * Now both sides are compared as plain calendar dates in the STORE's
 * (America/Los_Angeles) wall-clock — no Date-parsing of the birthdate at all.
 */
export function isAtLeast21(birthdate: string | null | undefined): boolean | null {
  if (!birthdate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthdate.trim());
  if (!m) return null;
  const [dobY, dobM, dobD] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (dobM < 1 || dobM > 12 || dobD < 1 || dobD > 31) return null;

  // Today's calendar date on the store's Pacific wall clock.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [nowY, nowM, nowD] = parts.split("-").map(Number);

  // 21st birthday as a comparable yyyymmdd number vs today.
  const birthdayPlus21 = (dobY + 21) * 10000 + dobM * 100 + dobD;
  const today = nowY * 10000 + nowM * 100 + nowD;
  return birthdayPlus21 <= today;
}
