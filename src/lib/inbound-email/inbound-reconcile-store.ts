/**
 * src/lib/inbound-email/inbound-reconcile-store.ts  (Fix Phase 3.2a, G-17 / F-04-4). SERVER-ONLY.
 *
 * "I want this table to receive every manifest, no exceptions." (owner,
 * message 7, verbatim). The I/O behind it; every decision is in the PURE
 * inbound-reconcile-core.ts.
 *
 *   runReconcile        the mailbox check (cron every 15 min + "Check the mailbox now"):
 *                       list Resend's received mail AND the vendor_intake@ Gmail mailbox,
 *                       pull in every email the table does not have, retry temporary
 *                       failures with backoff, alert a person once per failure, heartbeat.
 *   retryInboundEmail   "Try again" on one row: CAS-reopen the row, fetch the email
 *                       again from where it came from, run it through routeAndStage.
 *   resolveInboundEmail "Resolved" with a reason (CAS on resolved_at is null).
 *   findAndIngest       "Find an email": the owner's words -> a Gmail search (and
 *                       Resend's list), pull in whatever is not on the table yet.
 *   loadAttention       the Needs attention list + the health line for the page.
 *
 * Idempotent and safe to run twice at once (AGENTS rule 12): a missed email is
 * pulled in under the insert-first delivery claim (0255 unique delivery_key,
 * keys "gmail:msg:<id>" / "resend:email:<id>"); a retry re-opens its row with a
 * compare-and-set on (id, disposition, retry_count, resolved_at is null); an
 * alert is claimed by inserting its dedupe_key into compliance_reminder_log
 * (unique); the manifest dedupe behind stageManifestsFromEmail stops a second
 * manifest even if the same email somehow arrives twice. Never throws.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { isMissingColumnError } from "@/lib/inventory/coa-extract-core";
import { sendPushToAll, isPushConfigured } from "@/lib/notifications/push";
import { sendStaffAlertEmail } from "@/lib/orders/staff-alert-email";
import { publicSiteOrigin } from "@/lib/site/site-domain-core";
import { MAIL_CLAIM_PENDING, MAIL_UNDELIVERED } from "@/lib/compliance/ccrs-mail-notify";
import {
  addressedTo,
  attentionSummary,
  autoRetryDue,
  buildAttentionList,
  buildFindQuery,
  buildReconcileQuery,
  classifyAttention,
  failAlertKey,
  heartbeatFromSetting,
  MANUAL_GRACE_MS,
  MANUAL_LOOKBACK_DAYS,
  MAX_AUTO_RETRIES_PER_RUN,
  MAX_FIND_DAYS,
  MAX_INGEST_PER_RUN,
  matchSourceToLog,
  nextFailingSince,
  normalizeSubject,
  pickAlertItems,
  planFailureAlert,
  planHealthAlert,
  planReconcile,
  RECONCILE_HEARTBEAT_KEY,
  RECONCILE_HEARTBEAT_LABEL,
  RECONCILE_LOOKBACK_DAYS,
  resendToSource,
  retryEligibility,
  RUN_BUDGET_MS,
  shouldWriteHeartbeat,
  sourceDeliveryKey,
  sourceRefFor,
  validateResolve,
  type AttentionItem,
  type AttentionRow,
  type InboundAlert,
  type LogRef,
  type ReconcileHeartbeat,
  type ReconcileRunSummary,
  type SourceEmail,
  type SourceState,
} from "./inbound-reconcile-core";
import { claimInboundDelivery, logInboundEmail, releaseInboundDelivery } from "./inbound-store";
import { intakeMailbox, routeAndStage, type IngestOutcome, type IngestSource } from "./inbound-ingest";
import { fetchResendInboundById, listResendReceived } from "./resend-receiving-fetch";
import { fetchGmailInboundById, gmailIntakeConfig, listGmailIntake } from "./gmail-intake-fetch";
import type { NormalizedInboundEmail } from "./inbound-normalize-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** The columns the attention rules read (0320 columns included). */
export const ATTENTION_SELECT =
  "id, provider, delivery_key, source_ref, message_id, from_address, subject, received_at, created_at, claimed_at, to_intake, disposition, manifest_id, note, attachment_count, retry_count, last_retry_at, resolved_at";
/** Unresolved failures this far back are listed (the alert itself only looks 7 days back). */
const ATTENTION_LOOKBACK_DAYS = 90;
const ATTENTION_LIMIT = 200;
const LOG_MATCH_LIMIT = 3000;

/* ------------------------------------------------------------------ *
 *  Small reads
 * ------------------------------------------------------------------ */

/** Is migration 0320 applied (the retry / resolve columns exist)? */
export async function reconcileMigrationApplied(admin: Admin): Promise<boolean> {
  try {
    const { error } = await admin.from("inbound_email_log").select("retry_count, resolved_at").limit(1);
    return !error;
  } catch {
    return false;
  }
}

export async function readReconcileHeartbeat(admin: Admin): Promise<ReconcileHeartbeat | null> {
  try {
    const { data } = await admin.from("site_settings").select("value_json").eq("key", RECONCILE_HEARTBEAT_KEY).maybeSingle();
    return heartbeatFromSetting((data as { value_json?: unknown } | null)?.value_json);
  } catch {
    return null;
  }
}

async function writeHeartbeat(admin: Admin, hb: ReconcileHeartbeat): Promise<void> {
  try {
    await admin
      .from("site_settings")
      .upsert({ key: RECONCILE_HEARTBEAT_KEY, label: RECONCILE_HEARTBEAT_LABEL, value_json: hb as unknown as Record<string, unknown>, updated_by: null }, { onConflict: "key" });
  } catch {
    // best effort: the page says "has not run" / "last ran ..." from what is stored
  }
}

/** Open failures (0320 applied) for the Needs attention panel and the cron. */
async function readAttentionRows(admin: Admin, nowMs: number): Promise<AttentionRow[]> {
  const since = new Date(nowMs - ATTENTION_LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data, error } = await admin
    .from("inbound_email_log")
    .select(ATTENTION_SELECT)
    .is("resolved_at", null)
    .in("disposition", ["received", "parse_failed", "no_manifest"])
    .gte("received_at", since)
    .order("received_at", { ascending: false })
    .limit(ATTENTION_LIMIT);
  if (error || !Array.isArray(data)) return [];
  return data as AttentionRow[];
}

/** The rows the mailbox check compares the sources with (0320 identity columns when present). */
async function readLogRefs(admin: Admin, sinceIso: string): Promise<LogRef[]> {
  const cols: string = "id, provider, delivery_key, from_address, subject, received_at, disposition";
  let r: { data: unknown; error: { message: string; code?: string } | null } = await admin
    .from("inbound_email_log")
    .select(`${cols}, message_id, source_ref`)
    .gte("received_at", sinceIso)
    .order("received_at", { ascending: false })
    .limit(LOG_MATCH_LIMIT);
  if (r.error && isMissingColumnError(r.error)) {
    r = await admin.from("inbound_email_log").select(cols).gte("received_at", sinceIso).order("received_at", { ascending: false }).limit(LOG_MATCH_LIMIT);
  }
  if (r.error || !Array.isArray(r.data)) throw new Error(`could not read the email table: ${r.error?.message ?? "no data"}`);
  return r.data as LogRef[];
}

/* ------------------------------------------------------------------ *
 *  Alerts (email + push, once per key)
 * ------------------------------------------------------------------ */

function staffEmails(): string[] {
  return (process.env.ORDER_STAFF_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

type AlertOutcome = "sent" | "taken" | "undelivered" | "no_channel" | "error";

/** Claim the alert key first (unique dedupe_key), then send. A second runner gets "taken". */
export async function sendInboundAlert(admin: Admin, a: InboundAlert): Promise<AlertOutcome> {
  const emailOn = Boolean(process.env.RESEND_API_KEY && process.env.ORDER_EMAIL_FROM && staffEmails().length > 0);
  const pushOn = isPushConfigured();
  // Nothing claimed while no channel exists, so the alert still goes out once one does.
  if (!emailOn && !pushOn) return "no_channel";
  try {
    const { error } = await admin.from("compliance_reminder_log").insert({
      dedupe_key: a.dedupeKey,
      stage: a.stage,
      week_key: null,
      channel: "email",
      subject: a.subject,
      recipients: MAIL_CLAIM_PENDING,
    });
    if (error) return error.code === "23505" ? "taken" : "error";
  } catch {
    return "error";
  }
  const channels: string[] = [];
  const recipients: string[] = [];
  if (emailOn) {
    const r = await sendStaffAlertEmail({
      apiKey: process.env.RESEND_API_KEY ?? "",
      from: process.env.ORDER_EMAIL_FROM ?? "",
      to: staffEmails(),
      subject: a.subject,
      html: a.html,
    }).catch(() => ({ ok: false as const }));
    if (r.ok) {
      channels.push("email");
      recipients.push(...staffEmails());
    }
  }
  if (pushOn) {
    const n = await sendPushToAll({ title: a.subject, body: a.text, url: a.linkPath, tag: a.dedupeKey }).catch(() => 0);
    if (n > 0) {
      channels.push("push");
      recipients.push(`${n} push device(s)`);
    }
  }
  try {
    await admin
      .from("compliance_reminder_log")
      .update(channels.length === 0 ? { channel: "email", recipients: MAIL_UNDELIVERED } : { channel: channels.join("+"), recipients: recipients.join(", ") })
      .eq("dedupe_key", a.dedupeKey);
  } catch {
    // the claim row already stops a second send
  }
  return channels.length === 0 ? "undelivered" : "sent";
}

async function alertedKeys(admin: Admin, keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const { data, error } = await admin.from("compliance_reminder_log").select("dedupe_key").in("dedupe_key", keys);
  if (error) throw new Error(error.message);
  return new Set(((data as { dedupe_key: string }[] | null) ?? []).map((d) => d.dedupe_key));
}

/* ------------------------------------------------------------------ *
 *  Pull one email in
 * ------------------------------------------------------------------ */

export type PullResult = { ok: true; outcome: IngestOutcome | null; skipped: "already_claimed" | null } | { ok: false; error: string };

/** When a fetch fails outright, the row still lands on the table (and is retried), never dropped. */
function placeholderEmail(s: SourceEmail): NormalizedInboundEmail {
  return {
    provider: s.source,
    from: s.from ?? "",
    to: s.source === "gmail" ? [...new Set([...s.to, intakeMailbox()])] : s.to,
    subject: s.subject ?? "",
    receivedAt: s.receivedAt,
    attachments: [],
    messageId: s.messageId,
    sourceRef: s.ref,
  };
}

/**
 * Fix 3.5 (owner: "It should only target vendor_intake@ and none of my other
 * @greenwaymarijuana.com addresses."): a message in the box that was sent to
 * another of our addresses is logged ignored - not staged, not routed to the
 * menu / regulatory readers, not retried, never on Needs attention.
 */
async function logNotIntake(email: NormalizedInboundEmail, note: string, logId: string | null, ingestSource: IngestSource): Promise<IngestOutcome> {
  await logInboundEmail({ email, signatureOk: null, toIntake: false, disposition: "ignored", manifestId: null, logId, ingestSource, note });
  return { kind: "ignored", disposition: "ignored", staged: 0, manifestIds: [], logId, body: { ok: true, ignored: "not-intake-mailbox" } };
}

/**
 * The email was listed in (or logged from) the intake mailbox, so it IS an
 * intake email even when a failed fetch left its recipients empty. Without
 * this a failed re-fetch would be logged "not addressed to the intake mailbox"
 * (ignored) and drop off Needs attention - the silent loss this slice ends.
 * The source id and Message-ID are kept so the next Try again knows where to look.
 */
export function keepIntakeIdentity(email: NormalizedInboundEmail, s: Pick<SourceEmail, "ref" | "messageId" | "from" | "subject">): NormalizedInboundEmail {
  return {
    ...email,
    from: email.from || s.from || "",
    subject: email.subject || s.subject || "",
    to: email.to.length > 0 ? email.to : [intakeMailbox()],
    sourceRef: email.sourceRef ?? s.ref,
    messageId: email.messageId ?? s.messageId,
  };
}

/**
 * Pull ONE source email onto the table: claim its delivery key, fetch it in
 * full, route + stage it. The claim makes this safe against the webhook and a
 * second mailbox check running at the same moment.
 */
export async function pullSourceEmail(s: SourceEmail, ingestSource: IngestSource, gmailToken: string | null = null): Promise<PullResult> {
  const claim = await claimInboundDelivery({ provider: s.source, key: sourceDeliveryKey(s) });
  if (claim.kind === "duplicate") return { ok: true, outcome: null, skipped: "already_claimed" };
  const logId = claim.kind === "claimed" ? claim.logId : null;
  try {
    if (s.source === "resend") {
      const { email, fetchNote } = await fetchResendInboundById(s.ref);
      const note = `${fetchNote}; pulled in by the mailbox check (${ingestSource})`;
      return { ok: true, outcome: await routeAndStage(keepIntakeIdentity(email, s), null, note, logId, ingestSource), skipped: null };
    }
    const g = await fetchGmailInboundById(s.ref, gmailToken);
    if (!g.ok && g.notIntake) {
      // Fix 3.5: sent to another of our addresses - logged as ignored (never
      // staged, never retried, not on Needs attention).
      return { ok: true, outcome: await logNotIntake(g.email, g.error, logId, ingestSource), skipped: null };
    }
    if (!g.ok) {
      // Record it as a fetch failure (temporary): the next check retries it.
      await logInboundEmail({
        email: placeholderEmail(s),
        signatureOk: null,
        toIntake: true,
        disposition: "no_manifest",
        manifestId: null,
        logId,
        ingestSource,
        note: `${g.error}; the mailbox check will try again`,
      });
      return { ok: false, error: g.error };
    }
    const note = `${g.result.fetchNote}; pulled in by the mailbox check (${ingestSource})`;
    return { ok: true, outcome: await routeAndStage(g.result.email, null, note, logId, ingestSource), skipped: null };
  } catch (err) {
    if (logId) await releaseInboundDelivery(logId);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/* ------------------------------------------------------------------ *
 *  Try again (one row)
 * ------------------------------------------------------------------ */

export type RetryResult =
  | { ok: true; disposition: string; staged: number; manifestIds: string[]; note: string }
  | { ok: false; error: string };

/**
 * Fetch one failed / stuck email again. The row is re-opened with a
 * compare-and-set so two presses (or the cron + a person) cannot both run it,
 * and the finished run completes the SAME row (one email, one row).
 */
export async function retryInboundEmail(logId: string, actorId: string | null, ingestSource: IngestSource = "retry", nowMs: number = Date.now()): Promise<RetryResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database is not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("inbound_email_log").select(ATTENTION_SELECT).eq("id", logId).maybeSingle();
  if (error && isMissingColumnError(error)) return { ok: false, error: "Apply database update 0320 first (supabase/migrations/0320_inbound_email_reconcile.sql)." };
  if (error || !data) return { ok: false, error: "That email row was not found." };
  const row = data as AttentionRow;
  const can = retryEligibility(row, nowMs);
  if (!can.ok) return { ok: false, error: can.reason };
  const ref = sourceRefFor(row);
  if (!ref) {
    return { ok: false, error: "This row does not record where the email came from (it arrived before the mailbox check existed). Use Find an email with its sender or subject." };
  }
  const n = Math.max(0, Math.floor(row.retry_count ?? 0));
  const nowIso = new Date(nowMs).toISOString();
  const q = admin
    .from("inbound_email_log")
    .update({
      disposition: "received",
      claimed_at: nowIso,
      retry_count: n + 1,
      last_retry_at: nowIso,
      last_retry_by: actorId,
      note: `fetching again (${ingestSource === "retry" ? "Try again" : "automatic retry"} ${n + 1})`,
    })
    .eq("id", row.id)
    .eq("disposition", row.disposition ?? "")
    .is("resolved_at", null);
  // retry_count is NOT NULL default 0 (0320): the count is the CAS version.
  const cas = await q.eq("retry_count", n).select("id");
  if (cas.error || !Array.isArray(cas.data) || cas.data.length !== 1) {
    return { ok: false, error: "Someone else is fetching this email right now (or it just changed). Reload the page." };
  }
  const source: SourceEmail = {
    source: ref.kind,
    ref: ref.id,
    messageId: row.message_id ?? null,
    from: row.from_address,
    subject: row.subject,
    receivedAt: row.received_at ?? nowIso,
    to: [],
  };
  try {
    let email: NormalizedInboundEmail;
    let fetchNote: string;
    if (ref.kind === "resend") {
      ({ email, fetchNote } = await fetchResendInboundById(ref.id));
    } else {
      const g = await fetchGmailInboundById(ref.id);
      if (!g.ok && g.notIntake) {
        // Fix 3.5: this row came from another of our addresses: it is closed as
        // ignored (off Needs attention), never staged.
        const out = await logNotIntake(g.email, `${g.error} (fetch ${n + 1})`, row.id, ingestSource);
        return { ok: true, disposition: out.disposition, staged: 0, manifestIds: [], note: g.error.slice(0, 400) };
      }
      if (!g.ok) {
        await logInboundEmail({
          email: { ...placeholderEmail(source), to: [intakeMailbox()] },
          signatureOk: null,
          toIntake: true,
          disposition: "no_manifest",
          manifestId: null,
          logId: row.id,
          ingestSource,
          note: `${g.error} (fetch ${n + 1})`,
        });
        return { ok: false, error: g.error };
      }
      ({ email, fetchNote } = g.result);
    }
    const out = await routeAndStage(keepIntakeIdentity(email, source), null, `${fetchNote}; fetched again (${n + 1})`, row.id, ingestSource);
    const fresh = await admin.from("inbound_email_log").select("note").eq("id", row.id).maybeSingle();
    return {
      ok: true,
      disposition: out.disposition,
      staged: out.staged,
      manifestIds: out.manifestIds,
      note: ((fresh.data as { note?: string | null } | null)?.note ?? "").slice(0, 400),
    };
  } catch (err) {
    await releaseInboundDelivery(row.id);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/* ------------------------------------------------------------------ *
 *  Resolved (one row)
 * ------------------------------------------------------------------ */

export type ResolveResult = { ok: true; before: Record<string, unknown>; after: Record<string, unknown> } | { ok: false; error: string };

export async function resolveInboundEmail(logId: string, reason: unknown, note: unknown, actorId: string | null, nowMs: number = Date.now()): Promise<ResolveResult> {
  const v = validateResolve(reason, note);
  if (!v.ok) return { ok: false, error: v.error };
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database is not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("inbound_email_log").select(ATTENTION_SELECT).eq("id", logId).maybeSingle();
  if (error && isMissingColumnError(error)) return { ok: false, error: "Apply database update 0320 first (supabase/migrations/0320_inbound_email_reconcile.sql)." };
  if (error || !data) return { ok: false, error: "That email row was not found." };
  const row = data as AttentionRow;
  if (row.resolved_at) return { ok: false, error: "This email is already marked Resolved." };
  if (!classifyAttention(row, nowMs)) return { ok: false, error: "This email does not need attention (it made its manifest, or it is being fetched right now)." };
  const after = { resolved_at: new Date(nowMs).toISOString(), resolved_by: actorId, resolved_reason: v.reason, resolved_note: v.note };
  const upd = await admin.from("inbound_email_log").update(after).eq("id", logId).is("resolved_at", null).select("id");
  if (upd.error || !Array.isArray(upd.data) || upd.data.length !== 1) return { ok: false, error: "Someone else changed this email just now. Reload the page." };
  return { ok: true, before: { disposition: row.disposition, note: row.note, resolved_at: null }, after };
}

/* ------------------------------------------------------------------ *
 *  The mailbox check
 * ------------------------------------------------------------------ */

export type ReconcileRun = ReconcileRunSummary & {
  heartbeat: ReconcileHeartbeat | null;
  alertsSent: number;
  migrationApplied: boolean;
};

type Listed = { state: SourceState; items: SourceEmail[]; token: string | null; mailbox: string; notIntake: number };

async function listSources(nowMs: number, days: number): Promise<{ resend: Listed; gmail: Listed }> {
  const sinceIso = new Date(nowMs - days * 86_400_000).toISOString();
  const intake = intakeMailbox();
  const resend: Listed = { state: { configured: Boolean(process.env.RESEND_API_KEY), ok: false, listed: 0, error: null }, items: [], token: null, mailbox: intake, notIntake: 0 };
  const gconf = gmailIntakeConfig();
  const gmail: Listed = { state: { configured: gconf.configured, ok: false, listed: 0, error: null }, items: [], token: null, mailbox: gconf.mailbox ?? "", notIntake: 0 };
  const [r, g] = await Promise.all([
    resend.state.configured ? listResendReceived(sinceIso) : Promise.resolve(null),
    gconf.configured ? listGmailIntake(buildReconcileQuery(nowMs, days, gconf.mailbox)) : Promise.resolve(null),
  ]);
  if (r) {
    if (r.ok) {
      // Resend receives every address on the domain: only the intake mailbox is Receiving's.
      resend.items = r.items.map(resendToSource).filter((x): x is SourceEmail => !!x && addressedTo(x, intake));
      resend.state = { configured: true, ok: true, listed: resend.items.length, error: r.truncated ? "Resend list cut at 500 emails" : null };
    } else resend.state = { configured: true, ok: false, listed: 0, error: r.error };
  }
  if (g) {
    if (g.ok) {
      gmail.items = g.items;
      gmail.token = g.token;
      gmail.notIntake = g.notIntake;
      gmail.state = { configured: true, ok: true, listed: g.items.length, error: g.truncated ? "Gmail list cut at 200 emails" : null };
    } else gmail.state = { configured: g.configured, ok: false, listed: 0, error: g.error };
  } else if (!gconf.configured) gmail.state.error = gconf.problem;
  return { resend, gmail };
}

/**
 * One mailbox check. `trigger` "manual" = the owner pressed Check the mailbox
 * now (shorter grace, always writes the heartbeat). Never throws.
 */
export async function runReconcile(opts: { trigger: "cron" | "manual"; days?: number; nowMs?: number } = { trigger: "cron" }): Promise<ReconcileRun> {
  const started = Date.now();
  const nowMs = opts.nowMs ?? started;
  const nowIso = new Date(nowMs).toISOString();
  const days = Math.max(1, Math.min(MAX_FIND_DAYS, Math.floor(opts.days ?? (opts.trigger === "manual" ? MANUAL_LOOKBACK_DAYS : RECONCILE_LOOKBACK_DAYS))));
  const out: ReconcileRun = {
    configured: false,
    onTable: 0,
    recovered: 0,
    recoveredStaged: 0,
    deferred: 0,
    tooNew: 0,
    autoRetried: 0,
    errors: [],
    heartbeat: null,
    alertsSent: 0,
    migrationApplied: false,
  };
  if (!isSupabaseServiceConfigured) {
    out.errors.push("database not configured");
    return out;
  }
  const admin = createSupabaseAdminClient();
  const overBudget = () => Date.now() - started > RUN_BUDGET_MS;
  out.migrationApplied = await reconcileMigrationApplied(admin);
  const prev = await readReconcileHeartbeat(admin);

  // 1. Compare the sources with the table and pull in what is missing.
  const { resend, gmail } = await listSources(nowMs, days);
  out.configured = resend.state.configured || gmail.state.configured;
  out.notIntake = gmail.notIntake;
  if (resend.state.configured && !resend.state.ok && resend.state.error) out.errors.push(resend.state.error);
  if (gmail.state.configured && !gmail.state.ok && gmail.state.error) out.errors.push(gmail.state.error);
  if (resend.state.ok || gmail.state.ok) {
    try {
      const logs = await readLogRefs(admin, new Date(nowMs - (days + 1) * 86_400_000).toISOString());
      const plan = planReconcile({
        sources: [...gmail.items, ...resend.items],
        logs,
        nowMs,
        graceMs: opts.trigger === "manual" ? MANUAL_GRACE_MS : undefined,
        maxIngest: MAX_INGEST_PER_RUN,
      });
      out.onTable = plan.onTable;
      out.tooNew = plan.tooNew;
      out.deferred = plan.deferred;
      for (const s of plan.ingest) {
        if (overBudget()) {
          out.deferred += 1;
          continue;
        }
        const r = await pullSourceEmail(s, "reconcile", s.source === "gmail" ? gmail.token : null);
        if (!r.ok) out.errors.push(`${s.subject ?? s.ref}: ${r.error}`);
        else if (r.outcome) {
          out.recovered += 1;
          if (r.outcome.staged > 0) out.recoveredStaged += 1;
        }
      }
    } catch (err) {
      out.errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  // 2. Retry temporary failures by themselves (backoff 5 min / 30 min / 2 h / 6 h, then a person).
  let items: AttentionItem[] = [];
  if (out.migrationApplied) {
    try {
      let rows = await readAttentionRows(admin, nowMs);
      const due = rows.filter((r) => autoRetryDue(r, classifyAttention(r, nowMs), nowMs)).slice(0, MAX_AUTO_RETRIES_PER_RUN);
      for (const r of due) {
        if (overBudget()) break;
        const res = await retryInboundEmail(r.id, null, "reconcile", Date.now());
        if (res.ok) out.autoRetried += 1;
      }
      if (due.length > 0) rows = await readAttentionRows(admin, Date.now());
      items = buildAttentionList(rows, Date.now());
    } catch (err) {
      out.errors.push(`retry pass: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 3. One alert per email that needs a person (claimed first, so never twice).
    try {
      const origin = publicSiteOrigin(process.env);
      const done = await alertedKeys(admin, items.filter((i) => i.person).map((i) => failAlertKey(i.row.id)));
      for (const item of pickAlertItems(items, done, nowMs)) {
        const a = planFailureAlert(item, origin);
        if (a && (await sendInboundAlert(admin, a)) === "sent") out.alertsSent += 1;
      }
    } catch (err) {
      out.errors.push(`alerts: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 4. Heartbeat (+ one health alert when the check has failed for an hour).
  const summary = attentionSummary(items, nowMs);
  const ok = out.configured && (!resend.state.configured || resend.state.ok) && (!gmail.state.configured || gmail.state.ok);
  const hb: ReconcileHeartbeat = {
    lastRunAt: nowIso,
    ok,
    trigger: opts.trigger,
    mailbox: gmail.mailbox || resend.mailbox,
    resend: resend.state,
    gmail: gmail.state,
    recovered: out.recovered,
    deferred: out.deferred,
    autoRetried: out.autoRetried,
    attention: summary.total,
    needPerson: summary.needPerson,
    failingSince: nextFailingSince(prev, ok, nowIso),
    lastOkAt: ok ? nowIso : (prev?.lastOkAt ?? null),
    lastRecoveredAt: out.recovered > 0 ? nowIso : (prev?.lastRecoveredAt ?? null),
  };
  out.heartbeat = hb;
  if (shouldWriteHeartbeat(prev, hb, nowMs)) await writeHeartbeat(admin, hb);
  const health = planHealthAlert(hb, nowMs, publicSiteOrigin(process.env));
  if (health && (await sendInboundAlert(admin, health)) === "sent") out.alertsSent += 1;
  return out;
}

/* ------------------------------------------------------------------ *
 *  Find an email
 * ------------------------------------------------------------------ */

export type FindResult =
  | { ok: true; shown: string; found: number; onTable: number; pulledIn: number; staged: number; retried: number; notes: string[] }
  | { ok: false; error: string };

const FIND_MAX_PULL = 5;

/**
 * "Find an email": search the mailbox for the owner's words and pull in every
 * match the table does not have. A match that IS on the table but failed is
 * fetched again (Try again) instead. Gmail first (the mailbox the owner looks
 * at); Resend's list is searched by sender / subject as well.
 */
export async function findAndIngest(text: unknown, daysIn: unknown, actorId: string | null, nowMs: number = Date.now()): Promise<FindResult> {
  const daysNum = Number(daysIn);
  const days = Number.isFinite(daysNum) ? Math.max(1, Math.min(MAX_FIND_DAYS, Math.floor(daysNum))) : 30;
  const fq = buildFindQuery(text, nowMs, days, gmailIntakeConfig().mailbox);
  if (!fq.ok) return { ok: false, error: fq.error };
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database is not configured." };
  const admin = createSupabaseAdminClient();
  const notes: string[] = [];
  const sources: SourceEmail[] = [];
  let gmailToken: string | null = null;
  const g = await listGmailIntake(fq.q, 50);
  if (g.ok) {
    sources.push(...g.items);
    gmailToken = g.token;
  } else notes.push(g.configured ? `Gmail: ${g.error}` : "Gmail sign-in is not set up, so only Resend's copy was searched.");
  if (process.env.RESEND_API_KEY) {
    const r = await listResendReceived(new Date(nowMs - days * 86_400_000).toISOString());
    if (r.ok) {
      const words = fq.shown
        .toLowerCase()
        .replace(/\b(from|to|subject|has|in|after|before):\S*/g, " ")
        .split(/\s+/)
        .map((w) => w.replace(/"/g, ""))
        .filter((w) => w.length >= 2);
      const intake = intakeMailbox();
      for (const s of r.items.map(resendToSource)) {
        if (!s || !addressedTo(s, intake)) continue;
        const hay = `${(s.from ?? "").toLowerCase()} ${normalizeSubject(s.subject)}`;
        if (words.length > 0 && words.every((w) => hay.includes(w))) sources.push(s);
      }
    } else notes.push(`Resend: ${r.error}`);
  }
  if (sources.length === 0) return { ok: true, shown: fq.shown, found: 0, onTable: 0, pulledIn: 0, staged: 0, retried: 0, notes };

  let logs: LogRef[];
  try {
    logs = await readLogRefs(admin, new Date(nowMs - (days + 1) * 86_400_000).toISOString());
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const plan = planReconcile({ sources, logs, nowMs, graceMs: 0, maxIngest: FIND_MAX_PULL });
  let pulledIn = 0;
  let staged = 0;
  let retried = 0;
  for (const s of plan.ingest) {
    const r = await pullSourceEmail(s, "find", s.source === "gmail" ? gmailToken : null);
    if (!r.ok) notes.push(`${s.subject ?? s.ref}: ${r.error}`);
    else if (r.outcome) {
      pulledIn += 1;
      if (r.outcome.staged > 0) staged += 1;
    }
  }
  if (plan.deferred > 0) notes.push(`${plan.deferred} more match${plan.deferred === 1 ? "" : "es"}: search again (or narrow the words) to pull them in.`);
  // Matches already on the table that FAILED: fetch them again now.
  const failedIds = new Set<string>();
  for (const s of sources) {
    const hit = matchSourceToLog(s, logs);
    if (hit && ["parse_failed", "no_manifest", "received"].includes((hit.row.disposition ?? "").toLowerCase())) failedIds.add(hit.row.id);
  }
  for (const id of [...failedIds].slice(0, 3)) {
    const r = await retryInboundEmail(id, actorId, "retry", Date.now());
    if (r.ok) {
      retried += 1;
      if (r.staged > 0) staged += 1;
    } else if (!/does not need|already made|already on the table|being fetched/i.test(r.error)) notes.push(r.error);
  }
  return { ok: true, shown: fq.shown, found: sources.length - plan.sameEmailTwice, onTable: plan.onTable, pulledIn, staged, retried, notes };
}

/* ------------------------------------------------------------------ *
 *  The page
 * ------------------------------------------------------------------ */

export type AttentionView = {
  migrationApplied: boolean;
  heartbeat: ReconcileHeartbeat | null;
  items: AttentionItem[];
  summary: ReturnType<typeof attentionSummary>;
  gmailConfigured: boolean;
};

export async function loadAttention(nowMs: number = Date.now()): Promise<AttentionView> {
  const empty: AttentionView = { migrationApplied: false, heartbeat: null, items: [], summary: attentionSummary([], nowMs), gmailConfigured: gmailIntakeConfig().configured };
  if (!isSupabaseServiceConfigured) return empty;
  try {
    const admin = createSupabaseAdminClient();
    const migrationApplied = await reconcileMigrationApplied(admin);
    const heartbeat = await readReconcileHeartbeat(admin);
    if (!migrationApplied) return { ...empty, heartbeat };
    const items = buildAttentionList(await readAttentionRows(admin, nowMs), nowMs);
    return { migrationApplied, heartbeat, items, summary: attentionSummary(items, nowMs), gmailConfigured: empty.gmailConfigured };
  } catch {
    return empty;
  }
}
