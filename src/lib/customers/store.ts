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
    const term = opts.q.trim();
    const digits = normalizePhone(term);
    // Match on name, email, or normalized phone.
    const ors = [
      `first_name.ilike.%${term}%`,
      `last_name.ilike.%${term}%`,
      `email.ilike.%${term}%`,
    ];
    if (digits) ors.push(`phone_normalized.ilike.%${digits}%`);
    query = query.or(ors.join(","));
  }

  const { data } = await query;
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

/** True when a yyyy-mm-dd birthdate is at least 21 years ago (age-gate helper). */
export function isAtLeast21(birthdate: string | null | undefined): boolean | null {
  if (!birthdate) return null;
  const dob = new Date(birthdate);
  if (Number.isNaN(dob.getTime())) return null;
  const today = new Date();
  const cutoff = new Date(today.getFullYear() - 21, today.getMonth(), today.getDate());
  return dob.getTime() <= cutoff.getTime();
}
