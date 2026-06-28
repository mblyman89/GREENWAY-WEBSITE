/**
 * src/lib/loyalty/signups-store.ts
 *
 * Server-side service for the Slice 8 loyalty queue. Database-backed
 * replacement for the JSONL reader. All DB access uses the service-role client
 * (SERVER-ONLY); permission checks live in the admin actions.
 *
 * - createLoyaltySignup(): called by the public signup write path; normalizes
 *   the phone, detects a likely duplicate (email or phone), and inserts the row
 *   (flagging dedupe_of when matched). Idempotent on legacy_id for migration.
 * - listLoyaltySignups(): staff queue with status filter + search.
 * - getLoyaltySignup(): single record.
 * - setLoyaltyStatus() / markEntered() / updateLoyaltyNote(): staff mutations.
 * - exportLoyaltyCsv(): CSV string of the (optionally filtered) queue.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

export type LoyaltyStatus = "new" | "entered" | "duplicate" | "archived";

export type LoyaltyNotifyStatus =
  | "email-not-configured"
  | "email-sent"
  | "email-failed";

export const LOYALTY_STATUS_LABELS: Record<LoyaltyStatus, string> = {
  new: "New",
  entered: "Entered in POS",
  duplicate: "Duplicate",
  archived: "Archived",
};

export type LoyaltySignupRow = {
  id: string;
  legacy_id: string | null;
  status: LoyaltyStatus;
  first_name: string;
  last_name: string;
  birthday: string | null;
  mobile_phone: string | null;
  phone_normalized: string | null;
  email: string | null;
  consent: boolean;
  signature: string | null;
  source: string;
  notification_status: LoyaltyNotifyStatus;
  dedupe_of: string | null;
  staff_note: string | null;
  entered_by: string | null;
  entered_at: string | null;
  submitted_at: string;
  created_at: string;
  updated_at: string;
};

export type CreateLoyaltyInput = {
  legacyId?: string | null;
  firstName: string;
  lastName: string;
  birthday?: string | null;
  mobilePhone?: string | null;
  email?: string | null;
  consent: boolean;
  signature?: string | null;
  source?: string;
  notificationStatus?: LoyaltyNotifyStatus;
  submittedAt?: string | null;
};

function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits || null;
}

/**
 * Insert a loyalty signup. Detects a likely duplicate by email or normalized
 * phone and stores dedupe_of for the audit trail (but still keeps the row so no
 * data is lost). Returns the created row id, or null when DB is unconfigured.
 */
export async function createLoyaltySignup(
  input: CreateLoyaltyInput,
): Promise<{ id: string; isDuplicate: boolean } | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();

  const email = input.email?.trim().toLowerCase() || null;
  const phoneNormalized = normalizePhone(input.mobilePhone);

  // Idempotent on legacy_id (migration re-runs).
  if (input.legacyId) {
    const { data: existing } = await admin
      .from("loyalty_signups")
      .select("id")
      .eq("legacy_id", input.legacyId)
      .maybeSingle<{ id: string }>();
    if (existing) return { id: existing.id, isDuplicate: false };
  }

  // Dedupe detection: an earlier signup with the same email or phone.
  let dedupeOf: string | null = null;
  if (email || phoneNormalized) {
    const ors: string[] = [];
    if (email) ors.push(`email.eq.${email}`);
    if (phoneNormalized) ors.push(`phone_normalized.eq.${phoneNormalized}`);
    const { data: match } = await admin
      .from("loyalty_signups")
      .select("id")
      .or(ors.join(","))
      .order("submitted_at", { ascending: true })
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (match) dedupeOf = match.id;
  }

  const { data, error } = await admin
    .from("loyalty_signups")
    .insert({
      legacy_id: input.legacyId ?? null,
      status: "new",
      first_name: input.firstName,
      last_name: input.lastName,
      birthday: input.birthday ?? null,
      mobile_phone: input.mobilePhone ?? null,
      phone_normalized: phoneNormalized,
      email,
      consent: input.consent,
      signature: input.signature ?? null,
      source: input.source ?? "greenway-website",
      notification_status: input.notificationStatus ?? "email-not-configured",
      dedupe_of: dedupeOf,
      submitted_at: input.submittedAt ?? new Date().toISOString(),
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) return null;
  return { id: data.id, isDuplicate: Boolean(dedupeOf) };
}

export type ListLoyaltyFilter = {
  status?: LoyaltyStatus | "all";
  search?: string;
  limit?: number;
};

export async function listLoyaltySignups(
  filter: ListLoyaltyFilter = {},
): Promise<LoyaltySignupRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();

  let query = admin.from("loyalty_signups").select("*");

  if (filter.status && filter.status !== "all") {
    query = query.eq("status", filter.status);
  }

  const search = filter.search?.trim();
  if (search) {
    const like = `%${search}%`;
    query = query.or(
      [
        `first_name.ilike.${like}`,
        `last_name.ilike.${like}`,
        `email.ilike.${like}`,
        `mobile_phone.ilike.${like}`,
        `phone_normalized.ilike.${like}`,
      ].join(","),
    );
  }

  query = query.order("submitted_at", { ascending: false }).limit(filter.limit ?? 500);
  const { data } = await query;
  return (data as LoyaltySignupRow[]) ?? [];
}

export async function getLoyaltyStatusCounts(): Promise<Record<LoyaltyStatus, number>> {
  const empty: Record<LoyaltyStatus, number> = {
    new: 0,
    entered: 0,
    duplicate: 0,
    archived: 0,
  };
  if (!isSupabaseServiceConfigured) return empty;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("loyalty_signups").select("status");
  if (!data) return empty;
  for (const row of data as { status: LoyaltyStatus }[]) {
    empty[row.status] = (empty[row.status] ?? 0) + 1;
  }
  return empty;
}

export async function getLoyaltySignup(id: string): Promise<LoyaltySignupRow | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("loyalty_signups")
    .select("*")
    .eq("id", id)
    .maybeSingle<LoyaltySignupRow>();
  return data ?? null;
}

export type LoyaltyMutationActor = { actorId?: string | null };

export async function setLoyaltyStatus(
  id: string,
  status: LoyaltyStatus,
  actor: LoyaltyMutationActor = {},
): Promise<boolean> {
  if (!isSupabaseServiceConfigured) return false;
  const admin = createSupabaseAdminClient();
  const patch: Record<string, unknown> = { status };
  if (status === "entered") {
    patch.entered_by = actor.actorId ?? null;
    patch.entered_at = new Date().toISOString();
  }
  const { error } = await admin.from("loyalty_signups").update(patch).eq("id", id);
  return !error;
}

export async function updateLoyaltyNote(id: string, note: string): Promise<boolean> {
  if (!isSupabaseServiceConfigured) return false;
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("loyalty_signups")
    .update({ staff_note: note })
    .eq("id", id);
  return !error;
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function exportLoyaltyCsv(filter: ListLoyaltyFilter = {}): Promise<string> {
  const rows = await listLoyaltySignups({ ...filter, limit: 10000 });
  const header = [
    "submitted_at",
    "status",
    "first_name",
    "last_name",
    "email",
    "mobile_phone",
    "birthday",
    "consent",
    "signature",
    "source",
    "notification_status",
    "is_duplicate",
    "entered_at",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.submitted_at,
        r.status,
        r.first_name,
        r.last_name,
        r.email ?? "",
        r.mobile_phone ?? "",
        r.birthday ?? "",
        r.consent ? "yes" : "no",
        r.signature ?? "",
        r.source,
        r.notification_status,
        r.dedupe_of ? "yes" : "no",
        r.entered_at ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}
