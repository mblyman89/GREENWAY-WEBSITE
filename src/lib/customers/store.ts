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
import { isMissingDbFunctionError } from "@/lib/db/rpc-fallback-core";
import {
  SEARCH_CANDIDATE_CAP,
  buildCustomerSearchFilter,
  fuzzyQueryText,
  parseCustomerQuery,
  rankCustomerMatches,
  shouldTryFuzzy,
} from "@/lib/customers/customer-search-core";
import type { Customer, CustomerInput, PatientAuthorization } from "@/lib/customers/types";
import type { SortColumn } from "@/lib/admin/list-filter-core";

/** 0335: closest spellings of a name (trigram similarity), service_role only. */
export const CUSTOMER_SEARCH_FUZZY_RPC = "customer_search_fuzzy";

/** Digits-only phone for dedupe/search (mirrors loyalty normalization). */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D+/g, "");
  return digits.length > 0 ? digits : null;
}

/**
 * G-75 (owner message 17): THE customer search. Every word typed must match
 * a first name, last name or email (any order, any part); digits match
 * anywhere in the phone or exactly the Cultivera Customer ID. Matches are
 * ranked best first by customer-search-core (pure, self-tested). When nothing
 * matches exactly and a name was typed, the typo search from migration 0335
 * (customer_search_fuzzy) offers the closest spellings; until 0335 is applied
 * that step is simply skipped.
 */
export type CustomerSearchResult = { rows: Customer[]; total: number; fuzzy: boolean };

export async function searchCustomers(
  raw: string,
  opts?: { limit?: number; isMedical?: boolean; marketingConsent?: boolean; doNotContact?: boolean },
): Promise<CustomerSearchResult> {
  const empty: CustomerSearchResult = { rows: [], total: 0, fuzzy: false };
  if (!isSupabaseServiceConfigured) return empty;
  const parsed = parseCustomerQuery(raw);
  const filter = buildCustomerSearchFilter(parsed);
  if (!filter) return empty;
  const limit = Math.max(1, Math.min(opts?.limit ?? 25, SEARCH_CANDIDATE_CAP));
  const admin = createSupabaseAdminClient();
  let query = admin
    .from("customers")
    .select("*", { count: "exact" })
    .or(filter)
    .order("last_visit_at", { ascending: false, nullsFirst: false })
    .order("last_purchase_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(SEARCH_CANDIDATE_CAP);
  if (opts?.isMedical !== undefined) query = query.eq("is_medical_patient", opts.isMedical);
  if (opts?.marketingConsent !== undefined) query = query.eq("marketing_consent", opts.marketingConsent);
  if (opts?.doNotContact !== undefined) query = query.eq("do_not_contact", opts.doNotContact);
  const { data, count, error } = await query;
  if (error) {
    console.error("[customers] search failed", error.message);
    return empty;
  }
  const exact = rankCustomerMatches((data as Customer[] | null) ?? [], parsed);
  if (exact.length > 0 || !shouldTryFuzzy(parsed, exact.length)) {
    return { rows: exact.slice(0, limit), total: Math.max(count ?? 0, exact.length), fuzzy: false };
  }

  // Nobody spelled that way: ask for the closest spellings (0335).
  const { data: near, error: nearErr } = await admin.rpc(CUSTOMER_SEARCH_FUZZY_RPC, {
    p_query: fuzzyQueryText(parsed),
    p_limit: limit,
  });
  if (nearErr) {
    if (!isMissingDbFunctionError(nearErr)) console.error("[customers] fuzzy search failed", nearErr.message);
    return empty;
  }
  const scores = new Map<string, number>();
  for (const r of (near ?? []) as { customer_id: string; score: number }[]) scores.set(r.customer_id, Number(r.score) || 0);
  if (scores.size === 0) return empty;
  let fq = admin.from("customers").select("*").in("id", [...scores.keys()]);
  if (opts?.isMedical !== undefined) fq = fq.eq("is_medical_patient", opts.isMedical);
  if (opts?.marketingConsent !== undefined) fq = fq.eq("marketing_consent", opts.marketingConsent);
  if (opts?.doNotContact !== undefined) fq = fq.eq("do_not_contact", opts.doNotContact);
  const { data: rows } = await fq;
  const ranked = rankCustomerMatches((rows as Customer[] | null) ?? [], parsed, scores);
  return { rows: ranked.slice(0, limit), total: ranked.length, fuzzy: ranked.length > 0 };
}

export async function listCustomers(opts?: { q?: string; limit?: number }): Promise<Customer[]> {
  if (!isSupabaseServiceConfigured) return [];
  if (opts?.q && opts.q.trim().length > 0) {
    return (await searchCustomers(opts.q, { limit: opts.limit ?? 500 })).rows;
  }
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("customers")
    .select("*")
    .order("last_visit_at", { ascending: false, nullsFirst: false })
    .order("last_purchase_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 500);
  return (data as Customer[] | null) ?? [];
}

/**
 * GW-033 — paged variant of listCustomers for the admin customers list.
 * Returns the requested window plus the exact filtered total so the page can
 * render a real pager. G-75: a search uses searchCustomers, so the back office
 * and the register find exactly the same people. With the default sort
 * ("Best match") the results are ranked; any other sort orders the matches by
 * that column.
 */
export async function listCustomersPaged(opts: {
  q?: string;
  from: number;
  to: number;
  /** SLICE 26: whitelisted sort columns (list-filter-core.CUSTOMER_SORTS). */
  sort?: SortColumn[];
  /** G-75: rank a search best match first (the default sort). */
  bestMatch?: boolean;
  /** Tri-state flags (undefined = filter off). */
  isMedical?: boolean;
  marketingConsent?: boolean;
  doNotContact?: boolean;
}): Promise<{ rows: Customer[]; total: number; fuzzy?: boolean }> {
  if (!isSupabaseServiceConfigured) return { rows: [], total: 0 };
  const parsed = parseCustomerQuery(opts.q);
  const filter = buildCustomerSearchFilter(parsed);
  const flags = { isMedical: opts.isMedical, marketingConsent: opts.marketingConsent, doNotContact: opts.doNotContact };

  if (filter && opts.bestMatch !== false) {
    const res = await searchCustomers(opts.q ?? "", { ...flags, limit: SEARCH_CANDIDATE_CAP });
    // Ranked paging covers the best SEARCH_CANDIDATE_CAP matches; a search
    // broader than that falls through to plain column order below.
    if (res.fuzzy || res.total <= SEARCH_CANDIDATE_CAP) {
      return { rows: res.rows.slice(opts.from, opts.to + 1), total: res.rows.length, fuzzy: res.fuzzy };
    }
  }

  const admin = createSupabaseAdminClient();
  let query = admin.from("customers").select("*", { count: "exact" });

  if (opts.isMedical !== undefined) query = query.eq("is_medical_patient", opts.isMedical);
  if (opts.marketingConsent !== undefined)
    query = query.eq("marketing_consent", opts.marketingConsent);
  if (opts.doNotContact !== undefined) query = query.eq("do_not_contact", opts.doNotContact);

  const sort: SortColumn[] = opts.sort ?? [
    { column: "last_visit_at", ascending: false, nullsFirst: false },
    { column: "last_purchase_at", ascending: false, nullsFirst: false },
    { column: "created_at", ascending: false },
  ];
  for (const s of sort) {
    query = query.order(s.column, {
      ascending: s.ascending,
      ...(s.nullsFirst !== undefined ? { nullsFirst: s.nullsFirst } : {}),
    });
  }

  if (filter) query = query.or(filter);

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
