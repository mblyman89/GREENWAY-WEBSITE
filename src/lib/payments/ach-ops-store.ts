/**
 * src/lib/payments/ach-ops-store.ts  (R39 S7 part 2)
 *
 * Server-only I/O for the day-to-day ACH operations recorded by migration
 * 0263. Every rule lives in the pure cores (ach-ops-core.ts,
 * ach-return-log-core.ts) or in the database (0263 refuses anything out of
 * order even if this file is wrong). This file only reads rows, decrypts what
 * a file needs, calls ONE function per action, and sends the owner email.
 *
 *   notices   log a return / NOC (the money stops in the same transaction),
 *             resolve it with a note. Stephen, Michael and the store are
 *             emailed (owner Q9); the screen lists who to call.
 *   holds     release an employee hold after a callback. R41 S0: only
 *             Michael (the owner) releases; Stephen's release is a request.
 *   checks    start a prenote / test credit / callback; build the check file
 *             (pure GET, nothing recorded); mark it sent only when the person
 *             confirms the upload, and only if the list is still exactly the
 *             one they downloaded (fingerprint); finish passed/failed/cancelled.
 *   records   legal hold on/off; annual review done.
 *
 * No full bank number is written anywhere except the encrypted columns. The
 * corrected NOC data is encrypted before it leaves this process; events,
 * audit and email carry last-4 only.
 */
import "server-only";
import { createHash, randomInt } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { decryptSecret, encryptSecret } from "@/lib/security/at-rest-crypto";
import { resolveNotifyContacts, type NotifyContact } from "@/lib/payments/ach-authorization-core";
import { phoneReminder } from "@/lib/payments/vault-release-notice-core";
import { checkResolutionNote, noticeHoldReason, noticeOwnerEmail, parseReturnNotice, type ParsedNotice } from "@/lib/payments/ach-return-log-core";
import {
  checkFinishForm,
  checkHoldReleaseForm,
  checkLegalHoldReason,
  checkNextStep,
  checkReviewNote,
  microEntryMonitor,
  opsDbErrorMessage,
  pickMicroCents,
  planCheckFile,
  retentionLine,
  reviewList,
  type CheckFilePlan,
  type CheckStep,
  type FileMethod,
  type MonitorReport,
  type MonitorRow,
  type PlannedCheck,
  type ReviewItem,
} from "@/lib/payments/ach-ops-core";
import type { AchOriginator } from "@/lib/payments/nacha-core";
import type { VerificationMethod } from "@/lib/payments/ach-authorization-core";

const NOT_CONFIGURED = "Database is not configured.";
export const OPS_NO_KEY = "DATA_ENCRYPTION_KEY is not set on the server, so bank details cannot be read or protected. Set it in Vercel and redeploy.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Fail = { ok: false; error: string };

/** Sends one email. The default uses Resend (sendStaffAlertEmail); tests inject their own. */
export type OpsMailer = (to: readonly string[], msg: { subject: string; html: string }) => Promise<{ ok: true } | { ok: false; detail: string }>;

/** What the person on screen should do about the notice email / phones. */
export type OwnerNotice = { emailed: boolean; detail: string; call: string[]; missingPhones: string[] };

function dbErr(e: { code?: string; message?: string } | null | undefined): string {
  return opsDbErrorMessage(`${e?.code ?? ""} ${e?.message ?? ""}`.trim());
}

function isMissing(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return (
    e.code === "42P01" ||
    e.code === "42703" ||
    e.code === "PGRST205" ||
    e.code === "PGRST204" ||
    /relation .* does not exist|could not find the table|column .* does not exist/i.test(e.message ?? "")
  );
}

async function notify(mail: OpsMailer, to: readonly NotifyContact[], msg: { subject: string; html: string }): Promise<OwnerNotice> {
  const emails = [...new Set(to.map((c) => c.email).filter(Boolean))];
  let emailed = false;
  let detail: string;
  try {
    const r = await mail(emails, msg);
    emailed = r.ok;
    detail = r.ok ? `emailed ${emails.length}` : r.detail;
  } catch (e) {
    detail = e instanceof Error ? e.message.slice(0, 200) : "email failed";
  }
  const pr = phoneReminder(to);
  return { emailed, detail, call: pr.call, missingPhones: pr.missing };
}

// --------------------------------------------------------------- reads -----

export type OpsAuthorization = {
  id: string;
  payee_type: "employee" | "vendor";
  employee_id: string | null;
  vendor_id: string | null;
  payee_name: string;
  state: string;
  hold_reason: string | null;
  hold_entered_by: string | null;
  hold_entered_at: string | null;
  legal_hold: boolean;
  legal_hold_reason: string | null;
  annual_review_due_on: string | null;
  signed_on: string | null;
  ended_on: string | null;
};

const AUTH_COLS =
  "id, payee_type, employee_id, vendor_id, payee_name, state, hold_reason, hold_entered_by, hold_entered_at, legal_hold, legal_hold_reason, annual_review_due_on, signed_on, ended_on";

export type OpenNotice = {
  id: string;
  notice_kind: "return" | "noc";
  code: string;
  received_on: string;
  apply_by: string | null;
  payee_type: "employee" | "vendor" | null;
  employee_id: string | null;
  vendor_id: string | null;
  hold_applied: string | null;
  corrected_last4: string | null;
  verification_id: string | null;
  payee: string;
};

export type CheckListRow = {
  accountId: string;
  authorizationId: string;
  payee: string;
  accountLast4: string;
  accountType: string;
  verificationStatus: string;
  authState: string;
  open: null | {
    id: string;
    method: VerificationMethod;
    status: "planned" | "sent";
    eligible_on: string | null;
    settlement_date: string | null;
    step: CheckStep;
  };
};

export type OpsView = {
  ready: boolean;
  error: string | null;
  notices: OpenNotice[];
  holds: OpsAuthorization[];
  checks: CheckListRow[];
  reviews: readonly ReviewItem[];
  records: (OpsAuthorization & { retention: string })[];
  monitor: MonitorReport;
  planned: { prenote: string[]; micro_entry: string[] };
};

const EMPTY_MONITOR: MonitorReport = { sent30: 0, returned30: 0, sent365: 0, returned365: 0, flags: [] };

function emptyView(ready: boolean, error: string | null): OpsView {
  return { ready, error, notices: [], holds: [], checks: [], reviews: [], records: [], monitor: EMPTY_MONITOR, planned: { prenote: [], micro_entry: [] } };
}

function pacificDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

async function payeeNames(employeeIds: string[], vendorIds: string[]): Promise<Map<string, string>> {
  const admin = createSupabaseAdminClient();
  const names = new Map<string, string>();
  if (employeeIds.length) {
    const { data } = await admin.from("employees").select("id, full_name").in("id", [...new Set(employeeIds)]);
    for (const r of (data ?? []) as { id: string; full_name: string | null }[]) names.set(`employee:${r.id}`, r.full_name || "Employee");
  }
  if (vendorIds.length) {
    const { data } = await admin.from("vendors").select("id, display_name").in("id", [...new Set(vendorIds)]);
    for (const r of (data ?? []) as { id: string; display_name: string | null }[]) names.set(`vendor:${r.id}`, r.display_name || "Vendor");
  }
  return names;
}

/**
 * Everything the banking page's Operations tab shows. The clock is passed in
 * (the page reads pacificToday() in the data layer, keeping render pure).
 */
export async function opsPageView(todayIso: string): Promise<OpsView> {
  if (!isSupabaseServiceConfigured) return emptyView(false, NOT_CONFIGURED);
  const admin = createSupabaseAdminClient();

  const [auths, notices, accounts, vers] = await Promise.all([
    admin.from("ach_authorizations").select(AUTH_COLS).neq("state", "archived").order("payee_name", { ascending: true }),
    admin
      .from("ach_return_notices")
      .select("id, notice_kind, code, received_on, apply_by, payee_type, employee_id, vendor_id, hold_applied, corrected_last4, verification_id")
      .is("resolved_at", null)
      .order("received_on", { ascending: true }),
    admin.from("ach_authorization_accounts").select("id, authorization_id, account_last4, account_type, verification_status, account_key_hmac, archived_at"),
    admin.from("ach_verifications").select("id, account_id, method, status, micro_amount_cents, effective_date, settlement_date, eligible_on, result_code, created_at"),
  ]);
  for (const r of [auths, notices, accounts, vers]) {
    if (r.error) {
      if (isMissing(r.error)) return emptyView(false, "One-time setup needed: apply migrations 0258 to 0263 (docs/MIGRATIONS_TO_RUN.md), then reload.");
      return emptyView(true, dbErr(r.error));
    }
  }

  const authRows = (auths.data ?? []) as OpsAuthorization[];
  const authById = new Map(authRows.map((a) => [a.id, a]));
  const noticeRows = (notices.data ?? []) as Omit<OpenNotice, "payee">[];
  const names = await payeeNames(
    noticeRows.filter((n) => n.employee_id).map((n) => n.employee_id as string),
    noticeRows.filter((n) => n.vendor_id).map((n) => n.vendor_id as string),
  );
  const payeeOf = (a: OpsAuthorization | undefined) => (a ? `${a.payee_type}:${a.employee_id ?? a.vendor_id}` : "unknown");

  type Acct = { id: string; authorization_id: string; account_last4: string; account_type: string; verification_status: string; account_key_hmac: string; archived_at: string | null };
  type Ver = { id: string; account_id: string; method: VerificationMethod; status: string; micro_amount_cents: number | null; effective_date: string | null; settlement_date: string | null; eligible_on: string | null; result_code: string | null; created_at: string };
  const acctRows = (accounts.data ?? []) as Acct[];
  const acctById = new Map(acctRows.map((a) => [a.id, a]));
  const verRows = (vers.data ?? []) as Ver[];

  const checks: CheckListRow[] = [];
  for (const acct of acctRows) {
    if (acct.archived_at) continue;
    const a = authById.get(acct.authorization_id);
    if (!a || !["signed", "verifying", "on_hold"].includes(a.state)) continue;
    const open = verRows.find((v) => v.account_id === acct.id && (v.status === "planned" || v.status === "sent"));
    if (!open && acct.verification_status === "verified") continue;
    checks.push({
      accountId: acct.id,
      authorizationId: a.id,
      payee: a.payee_name,
      accountLast4: acct.account_last4,
      accountType: acct.account_type,
      verificationStatus: acct.verification_status,
      authState: a.state,
      open: open
        ? {
            id: open.id,
            method: open.method,
            status: open.status as "planned" | "sent",
            eligible_on: open.eligible_on,
            settlement_date: open.settlement_date,
            step: checkNextStep({ id: open.id, method: open.method, status: open.status as "planned" | "sent", eligible_on: open.eligible_on, settlement_date: open.settlement_date }, todayIso),
          }
        : null,
    });
  }

  const monitorRows: MonitorRow[] = [];
  for (const v of verRows) {
    const acct = acctById.get(v.account_id);
    if (!acct) continue;
    monitorRows.push({
      method: v.method,
      status: v.status,
      on: v.effective_date ?? pacificDay(v.created_at),
      result_code: v.result_code,
      account_key: acct.account_key_hmac,
      payee: payeeOf(authById.get(acct.authorization_id)),
    });
  }

  const plannedIds = (m: FileMethod) => verRows.filter((v) => v.method === m && v.status === "planned").map((v) => v.id).sort();

  return {
    ready: true,
    error: null,
    notices: noticeRows.map((n) => ({ ...n, payee: names.get(`${n.payee_type}:${n.employee_id ?? n.vendor_id}`) ?? "(unknown payee)" })),
    holds: authRows.filter((a) => a.payee_type === "employee" && a.state === "on_hold"),
    checks,
    reviews: reviewList(authRows.map((a) => ({ id: a.id, payee: a.payee_name, state: a.state, annual_review_due_on: a.annual_review_due_on })), todayIso),
    records: authRows.map((a) => ({ ...a, retention: retentionLine({ signedOn: a.signed_on, endedOn: a.ended_on, legalHold: a.legal_hold, todayIso }) })),
    monitor: microEntryMonitor(monitorRows, todayIso),
    planned: { prenote: plannedIds("prenote"), micro_entry: plannedIds("micro_entry") },
  };
}

// ------------------------------------------------------------- notices -----

export async function logNotice(input: {
  get: (k: string) => string | null | undefined;
  actorId: string;
  actorLabel: string;
  todayIso: string;
  bankingUrl: string;
  mail: OpsMailer;
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<{ ok: true; noticeId: string; hold: string; notice: ParsedNotice; owner: OwnerNotice } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: NOT_CONFIGURED };
  const parsed = parseReturnNotice(input.get, input.todayIso);
  if (!parsed.ok) return { ok: false, error: Object.values(parsed.errors).join(" ") };
  const n = parsed.notice;
  const verRaw = String(input.get("verification") ?? "").trim();
  if (verRaw && !UUID.test(verRaw)) return { ok: false, error: "That account check is not valid. Reload the page." };

  let correctedEnc: string | null = null;
  let correctedLast4: string | null = null;
  if (n.correctedData) {
    correctedEnc = encryptSecret(n.correctedData);
    if (!correctedEnc.startsWith("encv1:")) return { ok: false, error: OPS_NO_KEY };
    correctedLast4 = n.correctedData.replace(/\D/g, "").slice(-4) || null;
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("ach_notice_log", {
    p_actor: input.actorId,
    p_payee_type: n.payeeType,
    p_payee_id: n.payeeId,
    p_code: n.code,
    p_received_on: n.receivedOn,
    p_settlement_date: n.settlementDate,
    p_amount_cents: n.amountCents,
    p_trace: n.traceNumber,
    p_corrected_enc: correctedEnc,
    p_corrected_last4: correctedLast4,
    p_apply_by: n.applyBy,
    p_hold_reason: noticeHoldReason(n),
    p_verification_id: verRaw || null,
  });
  if (error) return { ok: false, error: dbErr(error) };
  const res = (data ?? {}) as { notice_id?: string; hold?: string };
  if (!res.notice_id || !res.hold) return { ok: false, error: "The database did not confirm the notice. Reload the page and check the list before logging it again." };

  const names = await payeeNames(n.payeeType === "employee" ? [n.payeeId] : [], n.payeeType === "vendor" ? [n.payeeId] : []);
  const payeeName = names.get(`${n.payeeType}:${n.payeeId}`) ?? `(${n.payeeType})`;
  const held = res.hold !== "none";
  const holdDetail =
    res.hold === "vault"
      ? "vendor banking was put ON HOLD; release it on the Vault tab after a callback"
      : res.hold === "authorization"
        ? "the employee's ACH authorization was put ON HOLD; release it on the Operations tab after a callback"
        : res.hold === "already_on_hold"
          ? "it was already on hold"
          : "NOT on hold: there was no active banking to stop. Check how this payment was sent.";
  const msg = noticeOwnerEmail({ notice: n, payeeName, held, holdDetail, loggedBy: input.actorLabel, bankingUrl: input.bankingUrl });
  const book = resolveNotifyContacts(input.env ?? process.env).contacts;
  const owner = await notify(input.mail, [book.stephen, book.michael, book.store], { subject: msg.subject, html: msg.html });
  return { ok: true, noticeId: res.notice_id, hold: res.hold, notice: n, owner };
}

export async function resolveNotice(input: { noticeId: string; actorId: string; note: string | null | undefined }): Promise<{ ok: true; note: string } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: NOT_CONFIGURED };
  if (!UUID.test(input.noticeId)) return { ok: false, error: "That notice is not valid. Reload the page." };
  const c = checkResolutionNote(input.note);
  if (!c.ok) return c;
  const { error } = await createSupabaseAdminClient().rpc("ach_notice_resolve", { p_notice_id: input.noticeId, p_actor: input.actorId, p_note: c.note });
  if (error) return { ok: false, error: dbErr(error) };
  return { ok: true, note: c.note };
}

// --------------------------------------------------------------- holds -----

async function readAuth(id: string): Promise<{ ok: true; auth: OpsAuthorization } | Fail> {
  if (!UUID.test(id)) return { ok: false, error: "That authorization is not valid. Reload the page." };
  const { data, error } = await createSupabaseAdminClient().from("ach_authorizations").select(AUTH_COLS).eq("id", id).maybeSingle();
  if (error) return { ok: false, error: dbErr(error) };
  if (!data) return { ok: false, error: opsDbErrorMessage("ACH_RELEASE_NOT_FOUND") };
  return { ok: true, auth: data as OpsAuthorization };
}

/**
 * R41 S0 (D-6 option B): only the owner releases an employee hold, alone, and
 * the database (0271 ach_auth_release_hold) refuses anyone else and returns
 * 'owner'. The owner's "Was this you?" receipt is sent by the ACH gate
 * (src/lib/payments/ach-gate.ts), so this no longer emails anyone itself.
 */
export async function releaseEmployeeHold(input: {
  authId: string;
  actorId: string;
  actorIsOwner: boolean;
  method: string | null | undefined;
  note: string | null | undefined;
  reason: string | null | undefined;
}): Promise<{ ok: true; mode: "owner"; before: OpsAuthorization } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: NOT_CONFIGURED };
  const r = await readAuth(input.authId);
  if (!r.ok) return r;
  const a = r.auth;
  if (a.payee_type !== "employee") return { ok: false, error: opsDbErrorMessage("ACH_RELEASE_PAYEE") };
  if (a.state !== "on_hold") return { ok: false, error: opsDbErrorMessage("ACH_RELEASE_STATE") };
  const f = checkHoldReleaseForm({ actorIsOwner: input.actorIsOwner, method: input.method, note: input.note, reason: input.reason });
  if (!f.ok) return f;
  const { data, error } = await createSupabaseAdminClient().rpc("ach_auth_release_hold", {
    p_auth_id: a.id,
    p_actor: input.actorId,
    p_method: f.method,
    p_note: f.note,
    p_reason: f.reason || null,
  });
  if (error) return { ok: false, error: dbErr(error) };
  if (data !== "owner") return { ok: false, error: "The database did not confirm the release. Reload the page." };
  return { ok: true, mode: "owner", before: a };
}

// -------------------------------------------------------------- checks -----

export async function startCheck(input: {
  accountId: string;
  actorId: string;
  method: string;
  randomBelow?: (n: number) => number;
}): Promise<{ ok: true; verificationId: string; method: VerificationMethod } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: NOT_CONFIGURED };
  if (!UUID.test(input.accountId)) return { ok: false, error: "That account is not valid. Reload the page." };
  if (input.method !== "prenote" && input.method !== "micro_entry" && input.method !== "voided_check_callback") {
    return { ok: false, error: opsDbErrorMessage("ACH_VERIFICATION_METHOD") };
  }
  const method = input.method as VerificationMethod;
  // Test amounts come from the OS CSPRNG: a guessable amount is no test.
  const cents = method === "micro_entry" ? pickMicroCents(input.randomBelow ?? ((n) => randomInt(n))) : null;
  const { data, error } = await createSupabaseAdminClient().rpc("ach_verification_start", {
    p_account_id: input.accountId,
    p_actor: input.actorId,
    p_method: method,
    p_micro_cents: cents,
  });
  if (error) return { ok: false, error: dbErr(error) };
  if (typeof data !== "string" || !UUID.test(data)) return { ok: false, error: "The database did not confirm the check. Reload the page." };
  return { ok: true, verificationId: data, method };
}

export async function finishCheck(input: {
  verificationId: string;
  actorId: string;
  outcome: string;
  confirmed: string | null | undefined;
  note: string | null | undefined;
}): Promise<{ ok: true; state: string; outcome: "passed" | "failed" | "cancelled"; method: VerificationMethod } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: NOT_CONFIGURED };
  if (!UUID.test(input.verificationId)) return { ok: false, error: "That check is not valid. Reload the page." };
  const admin = createSupabaseAdminClient();
  const { data: v, error: rErr } = await admin.from("ach_verifications").select("id, method, status").eq("id", input.verificationId).maybeSingle();
  if (rErr) return { ok: false, error: dbErr(rErr) };
  if (!v) return { ok: false, error: opsDbErrorMessage("ACH_VERIFICATION_NOT_FOUND") };
  const row = v as { id: string; method: VerificationMethod; status: string };
  if (row.status !== "planned" && row.status !== "sent") return { ok: false, error: opsDbErrorMessage("ACH_VERIFICATION_FINAL") };
  const f = checkFinishForm({ method: row.method, outcome: input.outcome, confirmed: input.confirmed, note: input.note });
  if (!f.ok) return f;
  const { data, error } = await admin.rpc("ach_verification_finish", {
    p_id: row.id,
    p_actor: input.actorId,
    p_outcome: f.outcome,
    p_confirmed_cents: f.cents,
    p_note: f.note || null,
  });
  if (error) return { ok: false, error: dbErr(error) };
  return { ok: true, state: String(data ?? ""), outcome: f.outcome, method: row.method };
}

/** A short, stable fingerprint of exactly which checks are in a file. */
export function checkListFingerprint(ids: readonly string[]): string {
  return createHash("sha256").update([...ids].sort().join(","), "utf8").digest("hex").slice(0, 16);
}

async function originatorFromSettings(): Promise<{ ok: true; originator: AchOriginator } | Fail> {
  // R41 S2: one readiness answer (settings + company EIN vs Timberland's setup).
  const { getOriginatorReadiness } = await import("@/lib/payroll/payroll-store");
  const { readiness } = await getOriginatorReadiness();
  if (!readiness.originator) {
    return { ok: false, error: `The company ACH settings do not match Timberland's setup (My banking tab): ${readiness.problems.join(" ")}` };
  }
  return { ok: true, originator: readiness.originator };
}

/** The planned checks of one method, with bank details decrypted for the file. */
export async function loadPlannedChecks(method: FileMethod): Promise<{ ok: true; checks: PlannedCheck[]; skipped: string[] } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: NOT_CONFIGURED };
  const admin = createSupabaseAdminClient();
  const { data: vers, error } = await admin.from("ach_verifications").select("id, account_id, method, status, micro_amount_cents").eq("method", method).eq("status", "planned");
  if (error) return { ok: false, error: dbErr(error) };
  const vrows = (vers ?? []) as { id: string; account_id: string; method: VerificationMethod; status: string; micro_amount_cents: number | null }[];
  if (!vrows.length) return { ok: true, checks: [], skipped: [] };
  const { data: accts, error: aErr } = await admin
    .from("ach_authorization_accounts")
    .select("id, authorization_id, account_type, routing_enc, account_enc, archived_at")
    .in("id", [...new Set(vrows.map((v) => v.account_id))]);
  if (aErr) return { ok: false, error: dbErr(aErr) };
  const acctById = new Map(((accts ?? []) as { id: string; authorization_id: string; account_type: "checking" | "savings"; routing_enc: string; account_enc: string; archived_at: string | null }[]).map((a) => [a.id, a]));
  const authIds = [...new Set([...acctById.values()].map((a) => a.authorization_id))];
  const { data: auths, error: auErr } = await admin.from("ach_authorizations").select("id, payee_name, employee_id, vendor_id, state").in("id", authIds);
  if (auErr) return { ok: false, error: dbErr(auErr) };
  const authById = new Map(((auths ?? []) as { id: string; payee_name: string; employee_id: string | null; vendor_id: string | null; state: string }[]).map((a) => [a.id, a]));
  const checks: PlannedCheck[] = [];
  const skipped: string[] = [];
  for (const v of vrows.sort((x, y) => x.id.localeCompare(y.id))) {
    const acct = acctById.get(v.account_id);
    const a = acct ? authById.get(acct.authorization_id) : undefined;
    if (!acct || !a) return { ok: false, error: "A planned check points at an account that is missing. Reload the page." };
    // Left out (and listed), not a reason to block everyone else's check.
    if (acct.archived_at) {
      skipped.push(`${a.payee_name}: the account was archived (cancel that check)`);
      continue;
    }
    if (a.state !== "verifying") {
      skipped.push(`${a.payee_name}: the authorization is ${a.state.replace("_", " ")} (release the hold or cancel the check)`);
      continue;
    }
    const routing = decryptSecret(acct.routing_enc);
    const accountNumber = decryptSecret(acct.account_enc);
    if (!routing || !accountNumber) return { ok: false, error: OPS_NO_KEY };
    checks.push({
      verificationId: v.id,
      method: v.method,
      status: v.status,
      microCents: v.micro_amount_cents,
      payeeName: a.payee_name,
      payeeRef: (a.employee_id ?? a.vendor_id ?? "").slice(0, 15) || null,
      accountType: acct.account_type,
      routing,
      accountNumber,
    });
  }
  return { ok: true, checks, skipped };
}

/**
 * Build the check file. Nothing is recorded: this runs on a GET download. If
 * `expect` (the fingerprint the page showed) is given and the list changed
 * since, the build is refused so the person never uploads a file that differs
 * from what they confirm.
 */
export async function buildCheckFile(input: {
  method: FileMethod;
  effective: string;
  todayIso: string;
  now: Date;
  expect?: string | null;
}): Promise<{ ok: true; plan: CheckFilePlan; fingerprint: string; skipped: string[] } | Fail> {
  const loaded = await loadPlannedChecks(input.method);
  if (!loaded.ok) return loaded;
  const fp = checkListFingerprint(loaded.checks.map((c) => c.verificationId));
  if (input.expect && input.expect !== fp) return { ok: false, error: "The list of checks changed since this page loaded. Reload the page and download again." };
  const orig = await originatorFromSettings();
  if (!orig.ok) return orig;
  const plan = planCheckFile({ method: input.method, checks: loaded.checks, originator: orig.originator, effective: input.effective, todayIso: input.todayIso, createdAt: input.now });
  if (!plan.ok) return loaded.skipped.length ? { ok: false, error: `${plan.error} Left out: ${loaded.skipped.join("; ")}.` } : plan;
  return { ok: true, plan: plan.plan, fingerprint: fp, skipped: loaded.skipped };
}

/**
 * The person confirms the file was uploaded to Timberland. The plan is built
 * again from the database (same method and effective date) and must have the
 * same fingerprint as the file they downloaded; then ONE call marks them sent.
 */
export async function markCheckFileSent(input: {
  method: FileMethod;
  effective: string;
  fingerprint: string;
  actorId: string;
  todayIso: string;
  now: Date;
}): Promise<{ ok: true; count: number; plan: CheckFilePlan } | Fail> {
  if (!/^[0-9a-f]{16}$/.test(input.fingerprint)) return { ok: false, error: "Download the file first, then confirm it was uploaded." };
  const built = await buildCheckFile({ method: input.method, effective: input.effective, todayIso: input.todayIso, now: input.now, expect: input.fingerprint });
  if (!built.ok) return built;
  const p = built.plan;
  const { data, error } = await createSupabaseAdminClient().rpc("ach_verification_mark_sent", {
    p_ids: [...p.ids],
    p_actor: input.actorId,
    p_effective: p.effective,
    p_settlement: p.settlement,
    p_eligible: p.eligible,
    p_filename: p.filename,
  });
  if (error) return { ok: false, error: dbErr(error) };
  if (data !== p.ids.length) return { ok: false, error: "The database marked a different number of checks than the file holds. Reload the page and look before sending anything." };
  return { ok: true, count: p.ids.length, plan: p };
}

// ------------------------------------------------------------- records -----

export async function setLegalHold(input: { authId: string; actorId: string; on: boolean; reason: string | null | undefined }): Promise<{ ok: true; before: OpsAuthorization; reason: string } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: NOT_CONFIGURED };
  const c = checkLegalHoldReason(input.reason);
  if (!c.ok) return c;
  const r = await readAuth(input.authId);
  if (!r.ok) return r;
  const { error } = await createSupabaseAdminClient().rpc("ach_auth_set_legal_hold", { p_auth_id: r.auth.id, p_actor: input.actorId, p_on: input.on, p_reason: c.reason });
  if (error) return { ok: false, error: dbErr(error) };
  return { ok: true, before: r.auth, reason: c.reason };
}

export async function markReviewDone(input: { authId: string; actorId: string; note: string | null | undefined }): Promise<{ ok: true; nextDue: string; before: OpsAuthorization } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: NOT_CONFIGURED };
  const c = checkReviewNote(input.note);
  if (!c.ok) return c;
  const r = await readAuth(input.authId);
  if (!r.ok) return r;
  const { data, error } = await createSupabaseAdminClient().rpc("ach_auth_review_done", { p_auth_id: r.auth.id, p_actor: input.actorId, p_note: c.note });
  if (error) return { ok: false, error: dbErr(error) };
  if (typeof data !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return { ok: false, error: "The database did not confirm the review. Reload the page." };
  return { ok: true, nextDue: data, before: r.auth };
}

/** The default mailer: Resend through sendStaffAlertEmail. */
export function resendOpsMailer(env: Readonly<Record<string, string | undefined>> = process.env): OpsMailer {
  return async (to, msg) => {
    const apiKey = env.RESEND_API_KEY ?? "";
    const from = env.ORDER_EMAIL_FROM ?? "";
    if (!apiKey || !from) return { ok: false, detail: "RESEND_API_KEY or ORDER_EMAIL_FROM is not set" };
    const { sendStaffAlertEmail } = await import("@/lib/orders/staff-alert-email");
    const r = await sendStaffAlertEmail({ apiKey, from, to: [...to], subject: msg.subject, html: msg.html });
    return r.ok ? { ok: true } : { ok: false, detail: r.detail };
  };
}
