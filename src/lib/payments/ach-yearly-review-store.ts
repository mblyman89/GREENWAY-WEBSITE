/**
 * R41 S14: the yearly ACH fraud-procedure review (migration 0288, table
 * ach_annual_reviews) and the segregation-of-duties report.
 *
 * Writes: one review row per year (plus corrections), owner only. The 0288
 * trigger checks the owner again (ach_write_by_owner), refuses backdating and
 * never lets a row change.
 *
 * Reads: every read is paged by a unique id (pagedAllChecked). PostgREST caps
 * one response at 1,000 rows, and a short Security Log read would make the
 * who-did-what report look complete when it is not. An unfinished read
 * returns { ok: false } with plain words, never a partial report.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import {
  ACH_AUDIT_PREFIXES,
  reviewDbErrorMessage,
  reviewedTextFingerprint,
  yearWindowUtc,
  type AnnualReviewRow,
  type AuditRow,
  type OwnerReviewRow,
  type RequestRow,
  type ReviewInsert,
  type StaffRow,
} from "@/lib/payments/ach-yearly-review-core";

type Fail = { ok: false; error: string };

const NOT_CONFIGURED = "Database not connected. Nothing was saved.";
const COLS = "id, review_year, reviewed_on, outcome, summary, procedure_sha256, corrects_id, created_by, created_at";

function dbErr(e: { code?: string; message?: string } | null | undefined): string {
  return reviewDbErrorMessage(`${e?.code ?? ""} ${e?.message ?? ""}`.trim());
}

/** Every yearly review (a handful of rows a year), oldest first. */
export async function readAnnualReviews(): Promise<{ ok: true; rows: AnnualReviewRow[] } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected, so the yearly reviews cannot be read." };
  const sb = createSupabaseAdminClient();
  const { rows, verdict } = await pagedAllChecked<AnnualReviewRow>(async (from, to) => {
    const { data, error } = await sb.from("ach_annual_reviews").select(COLS).order("id", { ascending: true }).range(from, to);
    return { rows: (data ?? []) as unknown as AnnualReviewRow[], ok: !error };
  });
  if (!verdict.complete) return { ok: false, error: "The yearly reviews could not be read in full (has migration 0288 been applied?)." };
  return { ok: true, rows: [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at)) };
}

/** Record one review (checked by checkYearlyReviewForm first). */
export async function recordAnnualReview(input: { row: ReviewInsert; actorId: string; todayIso: string }): Promise<{ ok: true; id: string } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: NOT_CONFIGURED };
  const r = input.row;
  const { data, error } = await createSupabaseAdminClient()
    .from("ach_annual_reviews")
    .insert({
      review_year: r.reviewYear,
      reviewed_on: input.todayIso,
      outcome: r.outcome,
      summary: r.summary,
      procedure_sha256: reviewedTextFingerprint(),
      corrects_id: r.correctsId,
      created_by: input.actorId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: dbErr(error) };
  const id = (data as { id?: string } | null)?.id;
  if (!id) return { ok: false, error: "The database did not confirm the review. Reload the page and check before recording it again." };
  return { ok: true, id };
}

/** Names for the reviewers (staff id -> name), for the review list and packet. */
export async function readStaff(): Promise<{ ok: true; rows: StaffRow[] } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  const sb = createSupabaseAdminClient();
  const { rows, verdict } = await pagedAllChecked<StaffRow>(async (from, to) => {
    const { data, error } = await sb.from("staff_profiles").select("id, email, full_name, role, active, last_login_at").order("id", { ascending: true }).range(from, to);
    return { rows: (data ?? []) as unknown as StaffRow[], ok: !error };
  });
  if (!verdict.complete) return { ok: false, error: "The staff list could not be read in full." };
  return { ok: true, rows };
}

/** PostgREST `or` filter for the ACH action prefixes (`*` is its LIKE wildcard). */
export function achActionOrFilter(): string {
  return ACH_AUDIT_PREFIXES.map((p) => `action.like.${p}*`).join(",");
}

/**
 * Everything the segregation-of-duties report needs for one Pacific year.
 * OWNER ONLY at the call site: it reads the Security Log (audit.view).
 */
export async function readSodInputs(year: number): Promise<
  { ok: true; staff: StaffRow[]; audit: AuditRow[]; requests: RequestRow[]; stopReviews: OwnerReviewRow[] } | Fail
> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected, so the who-did-what report cannot be made." };
  const sb = createSupabaseAdminClient();
  const { fromIso, toIso } = yearWindowUtc(year);
  const staff = await readStaff();
  if (!staff.ok) return staff;

  const audit = await pagedAllChecked<AuditRow>(async (from, to) => {
    const { data, error } = await sb
      .from("audit_logs")
      .select("id, actor_id, actor_email, action, created_at")
      .gte("created_at", fromIso)
      .lt("created_at", toIso)
      .or(achActionOrFilter())
      .order("id", { ascending: true })
      .range(from, to);
    return { rows: (data ?? []) as unknown as AuditRow[], ok: !error };
  });
  if (!audit.verdict.complete) return { ok: false, error: "The Security Log could not be read in full, so the who-did-what report was not made (a partial report would look complete)." };

  const requests = await pagedAllChecked<RequestRow>(async (from, to) => {
    const { data, error } = await sb
      .from("ach_change_requests")
      .select("id, kind, target_label, requested_by, requested_at, status, decided_by, decided_at, apply_error")
      .gte("requested_at", fromIso)
      .lt("requested_at", toIso)
      .order("id", { ascending: true })
      .range(from, to);
    return { rows: (data ?? []) as unknown as RequestRow[], ok: !error };
  });
  if (!requests.verdict.complete) return { ok: false, error: "The approval requests could not be read in full, so the who-did-what report was not made." };

  const stops = await pagedAllChecked<OwnerReviewRow>(async (from, to) => {
    const { data, error } = await sb
      .from("ach_owner_reviews")
      .select("id, kind, target_label, done_by, done_at, checked_off_by, checked_off_at")
      .gte("done_at", fromIso)
      .lt("done_at", toIso)
      .order("id", { ascending: true })
      .range(from, to);
    return { rows: (data ?? []) as unknown as OwnerReviewRow[], ok: !error };
  });
  if (!stops.verdict.complete) return { ok: false, error: "The stop-action review list could not be read in full, so the who-did-what report was not made." };

  return { ok: true, staff: staff.rows, audit: audit.rows, requests: requests.rows, stopReviews: stops.rows };
}
