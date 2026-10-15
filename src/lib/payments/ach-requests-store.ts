/**
 * R41 S0: the database side of owner authority (migration 0271).
 *
 *   ach_change_requests  Stephen's live ACH changes waiting for Michael.
 *   ach_owner_reviews    Stephen's stop actions (hold, return/NOC notice)
 *                        that took effect at once (D-6 option B); Michael
 *                        checks each one off.
 *
 * Every write goes through the service-role client. The rules themselves are
 * enforced in the database (0271 guards + ach_request_decide /
 * ach_request_record_result), so a bug here can refuse too much but cannot
 * let a non-owner approve, change what was asked, or delete a record.
 *
 * Nothing in this file ever reads or returns a full bank number: requests
 * carry them only inside payload_enc (encv1, AES-256-GCM), and the summary
 * column holds last-4 masks (ach-authority-core.maskedSummary).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import type { AchActionKind } from "@/lib/auth/ach-authority-core";
import { achActionLabel, isAchActionKind } from "@/lib/auth/ach-authority-core";
import { KIND_SPECS, shouldSupersede, versionString, type TargetType } from "@/lib/payments/ach-gate-core";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type Fail = { ok: false; error: string };

export type ChangeRequest = {
  id: string;
  kind: string;
  target_type: TargetType;
  target_id: string | null;
  target_label: string;
  base_version: string | null;
  payload_enc: string;
  summary: unknown;
  reason: string | null;
  requested_by: string;
  requested_at: string;
  status: "pending" | "approved" | "rejected" | "withdrawn" | "superseded";
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  applied_at: string | null;
  applied_ref: string | null;
  apply_error: string | null;
};

export type OwnerReview = {
  id: string;
  kind: string;
  target_label: string;
  summary: unknown;
  outcome: string;
  done_by: string;
  done_at: string;
  checked_off_by: string | null;
  checked_off_at: string | null;
  check_note: string | null;
};

const REQUEST_COLS =
  "id,kind,target_type,target_id,target_label,base_version,payload_enc,summary,reason,requested_by,requested_at,status,decided_by,decided_at,decision_note,applied_at,applied_ref,apply_error";
/** The list views never need the encrypted payload. */
const REQUEST_LIST_COLS = REQUEST_COLS.replace(",payload_enc", "");
const REVIEW_COLS = "id,kind,target_label,summary,outcome,done_by,done_at,checked_off_by,checked_off_at,check_note";

/** Database refusals in words. The codes are the 0271 RAISE prefixes. */
export function requestDbMessage(raw: string): string {
  const m = raw ?? "";
  if (/ACH_REQUEST_STALE/.test(m)) return "The record changed after this request was sent, so it may no longer be right. Reject it and ask Stephen to send it again.";
  if (/ACH_REQUEST_FINAL/.test(m)) return "This request was already decided. Reload the page.";
  if (/ACH_REQUEST_WITHDRAW/.test(m)) return "Only the person who sent a request can withdraw it.";
  if (/ACH_OWNER_ONLY/.test(m)) return "Only Michael (the owner) can do this.";
  if (/ACH_REQUEST_NOT_FOUND/.test(m)) return "That request no longer exists. Reload the page.";
  if (/ACH_REVIEW_FINAL/.test(m)) return "That item is already checked off. Reload the page.";
  if (/ACH_REQUEST_IMMUTABLE|ACH_REVIEW_IMMUTABLE/.test(m)) return "A request or review item cannot be edited after it is made.";
  if (/42P01|PGRST205|does not exist|could not find the table/i.test(m)) return "The approvals tables are not ready. Apply migration 0271 first (docs/MIGRATIONS_TO_RUN.md).";
  return "The database refused this. Reload the page and try again.";
}

function dbErr(e: { code?: string; message?: string } | null | undefined): string {
  return requestDbMessage(`${e?.code ?? ""} ${e?.message ?? ""}`.trim());
}

const NOT_CONFIGURED = "The database is not configured on this server.";

// ------------------------------------------------------------- versions ----

/**
 * The target's fingerprint now (ach-gate-core.versionString over the columns
 * in KIND_SPECS). null when the kind has no single record to compare.
 * A read error is returned as a failure, never as "absent": approving against
 * a record we could not read would skip the stale check.
 */
export async function readTargetVersion(kind: AchActionKind, targetId: string | null): Promise<{ ok: true; version: string | null } | Fail> {
  const spec = KIND_SPECS[kind].version;
  if (!spec) return { ok: true, version: null };
  if (!targetId) return { ok: false, error: "This change does not name the record it is about. Reload the page." };
  if (!isSupabaseServiceConfigured) return { ok: false, error: NOT_CONFIGURED };
  const { data, error } = await createSupabaseAdminClient()
    .from(spec.table)
    .select(spec.cols.join(","))
    .eq(spec.key, targetId)
    .limit(spec.many ? 1000 : 2);
  if (error) return { ok: false, error: "Could not read the record to check it has not changed. Try again." };
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  try {
    return { ok: true, version: versionString(spec, rows) };
  } catch {
    return { ok: false, error: "That record matched more than one row; nothing was changed." };
  }
}

// --------------------------------------------------------------- labels ----

async function one(table: string, cols: string, id: string): Promise<Record<string, unknown> | null> {
  if (!UUID.test(id)) return null;
  const { data } = await createSupabaseAdminClient().from(table).select(cols).eq("id", id).maybeSingle();
  return (data as Record<string, unknown> | null) ?? null;
}

const txt = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * A human name for the record ("Acme Farms", "Pat Worker ••••6789"), for the
 * approvals list and the emails. Never throws and never blocks the action:
 * if the lookup fails, the label falls back to the kind and a short id.
 */
export async function labelForTarget(kind: AchActionKind, targetId: string | null): Promise<string> {
  const t = KIND_SPECS[kind].targetType;
  const fallback = targetId ? `${t.replace("_", " ")} ${targetId.slice(0, 8)}` : achActionLabel(kind);
  if (!isSupabaseServiceConfigured) return fallback;
  try {
    if (t === "company") return "Company banking settings";
    if (t === "vendor_payment") return "Vendor ACH payment file";
    if (t === "ach_file" && targetId) {
      const f = await one("ach_files", "filename,file_date,file_id_modifier", targetId);
      if (f) return `ACH file ${txt(f.filename)} (${txt(f.file_date)} ${txt(f.file_id_modifier)})`.slice(0, 200);
    }
    if (t === "timberland_comms") {
      if (!targetId) return "New Timberland log entry";
      const c = await one("ach_timberland_comms", "entry_type,received_on", targetId);
      if (c) return `Timberland log: ${txt(c.entry_type).replace(/_/g, " ")} (${txt(c.received_on)})`.slice(0, 200);
    }
    if (!targetId) return fallback;
    let label = "";
    if (t === "vendor") label = txt((await one("vendors", "display_name", targetId))?.display_name);
    else if (t === "employee") label = txt((await one("employees", "full_name", targetId))?.full_name);
    else if (t === "authorization") label = txt((await one("ach_authorizations", "payee_name", targetId))?.payee_name);
    else if (t === "payroll_run") label = `Payroll run ${txt((await one("payroll_runs", "label", targetId))?.label)}`.trim();
    else if (t === "document") label = txt((await one("ach_authorization_documents", "original_filename", targetId))?.original_filename);
    else if (t === "account" || t === "verification") {
      const accountId = t === "account" ? targetId : txt((await one("ach_verifications", "account_id", targetId))?.account_id);
      const acc = accountId ? await one("ach_authorization_accounts", "authorization_id,account_last4", accountId) : null;
      const auth = acc ? await one("ach_authorizations", "payee_name", txt(acc.authorization_id)) : null;
      label = [txt(auth?.payee_name), acc?.account_last4 ? `\u2022\u2022\u2022\u2022${txt(acc.account_last4)}` : ""].filter(Boolean).join(" ");
    } else if (t === "notice") {
      const n = await one("ach_return_notices", "code,authorization_id", targetId);
      const auth = n ? await one("ach_authorizations", "payee_name", txt(n.authorization_id)) : null;
      label = [txt(n?.code), txt(auth?.payee_name)].filter(Boolean).join(" ");
    } else if (t === "contact" || t === "invite") {
      const row = await one(t === "contact" ? "payee_contacts" : "vendor_esign_invites", "vendor_id", targetId);
      label = row ? txt((await one("vendors", "display_name", txt(row.vendor_id)))?.display_name) : "";
    }
    return (label.trim() || fallback).slice(0, 200);
  } catch {
    return fallback;
  }
}

// ------------------------------------------------------------- requests ----

export async function insertChangeRequest(input: {
  kind: AchActionKind;
  targetId: string | null;
  targetLabel: string;
  baseVersion: string | null;
  payloadEnc: string;
  summary: { field: string; value: string }[];
  reason: string | null;
  requestedBy: string;
}): Promise<{ ok: true; id: string } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: NOT_CONFIGURED };
  if (!input.payloadEnc.startsWith("encv1:")) return { ok: false, error: "The request was not encrypted, so it was not stored." };
  const { data, error } = await createSupabaseAdminClient()
    .from("ach_change_requests")
    .insert({
      kind: input.kind,
      target_type: KIND_SPECS[input.kind].targetType,
      target_id: input.targetId,
      target_label: input.targetLabel.slice(0, 200),
      base_version: input.baseVersion,
      payload_enc: input.payloadEnc,
      summary: input.summary,
      reason: input.reason ? input.reason.slice(0, 1000) : null,
      requested_by: input.requestedBy,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: dbErr(error) };
  return { ok: true, id: String((data as { id: string }).id) };
}

export async function getChangeRequest(id: string): Promise<ChangeRequest | null> {
  if (!isSupabaseServiceConfigured || !UUID.test(id)) return null;
  const { data } = await createSupabaseAdminClient().from("ach_change_requests").select(REQUEST_COLS).eq("id", id).maybeSingle();
  return (data as ChangeRequest | null) ?? null;
}

export type RequestListRow = Omit<ChangeRequest, "payload_enc">;

/** Pending first (oldest first: the longest wait is on top), then the last 30 decided. */
export async function listChangeRequests(): Promise<{ ready: boolean; pending: RequestListRow[]; recent: RequestListRow[] }> {
  if (!isSupabaseServiceConfigured) return { ready: false, pending: [], recent: [] };
  const admin = createSupabaseAdminClient();
  const [p, r] = await Promise.all([
    admin.from("ach_change_requests").select(REQUEST_LIST_COLS).eq("status", "pending").order("requested_at", { ascending: true }).limit(200),
    admin.from("ach_change_requests").select(REQUEST_LIST_COLS).neq("status", "pending").order("decided_at", { ascending: false }).limit(30),
  ]);
  if (p.error || r.error) return { ready: false, pending: [], recent: [] };
  return { ready: true, pending: (p.data ?? []) as unknown as RequestListRow[], recent: (r.data ?? []) as unknown as RequestListRow[] };
}

/** Decide through the 0271 function (it re-checks owner, requester and staleness under a row lock). */
export async function decideChangeRequest(input: {
  requestId: string;
  actorId: string;
  decision: "approved" | "rejected" | "withdrawn" | "superseded";
  note: string | null;
  currentVersion: string | null;
}): Promise<{ ok: true } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: NOT_CONFIGURED };
  if (!UUID.test(input.requestId)) return { ok: false, error: "That request is not valid. Reload the page." };
  const { data, error } = await createSupabaseAdminClient().rpc("ach_request_decide", {
    p_request_id: input.requestId,
    p_actor: input.actorId,
    p_decision: input.decision,
    p_note: input.note,
    p_current_version: input.currentVersion,
  });
  if (error) return { ok: false, error: dbErr(error) };
  if (data !== input.decision) return { ok: false, error: "The database did not confirm the decision. Reload the page." };
  return { ok: true };
}

export async function recordRequestResult(input: { requestId: string; actorId: string; ref: string | null; error: string | null }): Promise<{ ok: true } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: NOT_CONFIGURED };
  const { error } = await createSupabaseAdminClient().rpc("ach_request_record_result", {
    p_request_id: input.requestId,
    p_actor: input.actorId,
    p_ref: input.ref === null ? null : input.ref.slice(0, 500) || "Done.",
    p_error: input.error === null ? null : input.error.slice(0, 1000) || "Failed.",
  });
  if (error) return { ok: false, error: dbErr(error) };
  return { ok: true };
}

/**
 * Nothing waits on Stephen: when Michael changes a record himself, Stephen's
 * pending requests that change replaces are marked superseded
 * (ach-gate-core.shouldSupersede: same kind, or the record no longer matches
 * the request's version). Failures are counted, not thrown, because the
 * owner's change already happened.
 */
export async function supersedePendingFor(input: { ownerKind: AchActionKind; targetType: TargetType; targetId: string; actorId: string }): Promise<{ superseded: number; failed: number }> {
  if (!isSupabaseServiceConfigured) return { superseded: 0, failed: 0 };
  const { data, error } = await createSupabaseAdminClient()
    .from("ach_change_requests")
    .select("id,kind,base_version")
    .eq("status", "pending")
    .eq("target_type", input.targetType)
    .eq("target_id", input.targetId)
    .limit(50);
  if (error || !data) return { superseded: 0, failed: error ? 1 : 0 };
  let superseded = 0;
  let failed = 0;
  for (const row of data as { id: string; kind: string; base_version: string | null }[]) {
    let current: string | null = null;
    if (isAchActionKind(row.kind) && row.base_version !== null) {
      const v = await readTargetVersion(row.kind, input.targetId);
      if (!v.ok) {
        failed += 1;
        continue;
      }
      current = v.version;
    }
    if (!shouldSupersede(input.ownerKind, { kind: row.kind, baseVersion: row.base_version }, current)) continue;
    const r = await decideChangeRequest({ requestId: row.id, actorId: input.actorId, decision: "superseded", note: "Michael made this change himself.", currentVersion: null });
    if (r.ok) superseded += 1;
    else failed += 1;
  }
  return { superseded, failed };
}

// -------------------------------------------------------------- reviews ----

export async function insertOwnerReview(input: {
  kind: AchActionKind;
  targetLabel: string;
  summary: { field: string; value: string }[];
  outcome: string;
  doneBy: string;
}): Promise<{ ok: true; id: string } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: NOT_CONFIGURED };
  const { data, error } = await createSupabaseAdminClient()
    .from("ach_owner_reviews")
    .insert({ kind: input.kind, target_label: input.targetLabel.slice(0, 200), summary: input.summary, outcome: input.outcome.slice(0, 1000), done_by: input.doneBy })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: dbErr(error) };
  return { ok: true, id: String((data as { id: string }).id) };
}

export async function listOwnerReviews(): Promise<{ ready: boolean; open: OwnerReview[]; done: OwnerReview[] }> {
  if (!isSupabaseServiceConfigured) return { ready: false, open: [], done: [] };
  const admin = createSupabaseAdminClient();
  const [o, d] = await Promise.all([
    admin.from("ach_owner_reviews").select(REVIEW_COLS).is("checked_off_at", null).order("done_at", { ascending: true }).limit(200),
    admin.from("ach_owner_reviews").select(REVIEW_COLS).not("checked_off_at", "is", null).order("checked_off_at", { ascending: false }).limit(30),
  ]);
  if (o.error || d.error) return { ready: false, open: [], done: [] };
  return { ready: true, open: (o.data ?? []) as unknown as OwnerReview[], done: (d.data ?? []) as unknown as OwnerReview[] };
}

/** Check one item off (one at a time, never in bulk). The 0271 guard re-checks the owner. */
export async function checkOffOwnerReview(input: { reviewId: string; actorId: string; note: string | null }): Promise<{ ok: true } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: NOT_CONFIGURED };
  if (!UUID.test(input.reviewId)) return { ok: false, error: "That review item is not valid. Reload the page." };
  const { data, error } = await createSupabaseAdminClient()
    .from("ach_owner_reviews")
    .update({ checked_off_by: input.actorId, checked_off_at: new Date().toISOString(), check_note: input.note ? input.note.slice(0, 1000) : null })
    .eq("id", input.reviewId)
    .is("checked_off_at", null)
    .select("id");
  if (error) return { ok: false, error: dbErr(error) };
  if (!data || (data as unknown[]).length !== 1) return { ok: false, error: "That item is already checked off. Reload the page." };
  return { ok: true };
}

// ------------------------------------------------------------ the badge ----

/** Pending requests + unchecked review items, for the Banking nav badge and the morning reminder. */
export async function countWaitingForOwner(): Promise<{ pending: number; toReview: number; oldest: string | null }> {
  if (!isSupabaseServiceConfigured) return { pending: 0, toReview: 0, oldest: null };
  const admin = createSupabaseAdminClient();
  const [p, r] = await Promise.all([
    admin.from("ach_change_requests").select("requested_at").eq("status", "pending").order("requested_at", { ascending: true }).limit(500),
    admin.from("ach_owner_reviews").select("done_at").is("checked_off_at", null).order("done_at", { ascending: true }).limit(500),
  ]);
  const pend = (p.error ? [] : (p.data ?? [])) as { requested_at: string }[];
  const rev = (r.error ? [] : (r.data ?? [])) as { done_at: string }[];
  const firsts = [pend[0]?.requested_at, rev[0]?.done_at].filter((x): x is string => typeof x === "string").sort();
  return { pending: pend.length, toReview: rev.length, oldest: firsts[0] ?? null };
}

/** Staff names for the lists (id -> full name or email). */
export async function staffNames(ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(ids.filter((i) => UUID.test(i)))];
  if (!isSupabaseServiceConfigured || uniq.length === 0) return out;
  const { data } = await createSupabaseAdminClient().from("staff_profiles").select("id,full_name,email").in("id", uniq);
  for (const r of (data ?? []) as { id: string; full_name: string | null; email: string }[]) out.set(r.id, r.full_name || r.email);
  return out;
}

/** One staff member's name and email (the requester, for the decision email). Null if unknown. */
export async function staffContact(id: string): Promise<{ name: string; email: string } | null> {
  if (!isSupabaseServiceConfigured || !UUID.test(id)) return null;
  const { data } = await createSupabaseAdminClient().from("staff_profiles").select("full_name,email").eq("id", id).maybeSingle();
  const r = data as { full_name: string | null; email: string | null } | null;
  if (!r || !r.email) return null;
  return { name: r.full_name || r.email, email: r.email };
}

/**
 * D-7 daily reminder: send once per Pacific day (compliance_reminder_log has
 * a unique dedupe_key, 0118). Returns false when today's reminder was already
 * claimed, so a re-run of the cron never double-sends.
 */
export async function claimDailyReminder(todayIso: string, subject: string, recipients: string): Promise<boolean> {
  if (!isSupabaseServiceConfigured) return false;
  const { error } = await createSupabaseAdminClient()
    .from("compliance_reminder_log")
    .insert({ dedupe_key: `ach_approvals:${todayIso}`, stage: "ach_approvals", channel: "email", subject: subject.slice(0, 300), recipients });
  return !error;
}

/** Stamp the pending requests that were in today's reminder (0271 last_reminded_on). */
export async function markReminded(todayIso: string): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  await createSupabaseAdminClient().from("ach_change_requests").update({ last_reminded_on: todayIso }).eq("status", "pending");
}
