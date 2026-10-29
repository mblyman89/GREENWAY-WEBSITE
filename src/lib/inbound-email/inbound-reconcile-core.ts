/**
 * src/lib/inbound-email/inbound-reconcile-core.ts  (Fix Phase 3.2a · G-17 · F-04-4)
 *
 * PURE. Every decision behind "this table receives every manifest, no
 * exceptions". The owner, verbatim (owner message 7):
 *   "In addition to a notice when an email fails, please add a refetch button,
 *    or some intelligent way to manually ask the fetcher to look again ...
 *    If an invoice and manifest don't make it to the table and I know it's in
 *    the email account because I have it open and looking at it, I need a way
 *    to ask the system to grab the ones it missed or failed to get. Make it
 *    enterprise grade. Research what the professionals do in this scenario.
 *    I want this table to receive every manifest, no exceptions."
 *
 * WHAT THE PROFESSIONALS DO (read 2026-10-29) and where each lives here:
 *   1. Never trust the push alone - RECONCILE against the source of truth.
 *      Webhooks are best effort (Resend retries a failed delivery on a fixed
 *      schedule and then gives up; Hookdeck's dead-letter guidance: "run a
 *      reconciliation job against the source of truth"). Gmail's own sync
 *      guide is the same idea: list the mailbox, compare with what you have,
 *      fetch what is missing. -> planReconcile / matchSourceToLog.
 *   2. Idempotent replay: replaying an email twice must never stage twice.
 *      -> one identity per email (delivery key, then RFC Message-ID, then a
 *      sender + subject + time fingerprint), and the existing insert-first
 *      delivery claim (0255) plus the manifest dedupe key behind it.
 *   3. Categorise failures (temporary / permanent) and retry only the
 *      temporary ones automatically, with backoff and a cap.
 *      -> classifyAttention / autoRetryDue (5 min, 30 min, 2 h, 6 h).
 *   4. A dead-letter view a person can act on: Try again, Resolved (with a
 *      reason), and an audit row for each. -> retryEligibility / resolve*.
 *   5. Monitor queue depth and the age of the oldest item, and alert a person
 *      once. -> attentionSummary / planFailureAlerts / heartbeat + health.
 *   6. A grace period before calling an email "missed", so the reconcile does
 *      not race a webhook that is still working. -> RECONCILE_GRACE_MS.
 *
 * Reads nothing, writes nothing, no clock of its own (now is passed in).
 */

/* ------------------------------------------------------------------ *
 *  Constants
 * ------------------------------------------------------------------ */

/** site_settings key of the mailbox-check heartbeat. */
export const RECONCILE_HEARTBEAT_KEY = "inbound_reconcile_heartbeat";
export const RECONCILE_HEARTBEAT_LABEL = "Receiving: vendor_intake@ mailbox check (heartbeat)";
/** The intake mailbox the check reads (env INBOUND_RECONCILE_MAILBOX overrides). */
export const DEFAULT_RECONCILE_MAILBOX = "vendor_intake@greenwaymarijuana.com";
export const RECONCILE_MAILBOX_ENV = "INBOUND_RECONCILE_MAILBOX";
/** How far back the 15-minute check looks. */
export const RECONCILE_LOOKBACK_DAYS = 3;
/** How far back "Check the mailbox now" looks. */
export const MANUAL_LOOKBACK_DAYS = 14;
/** The longest window "Find an email" may search. */
export const MAX_FIND_DAYS = 365;
/**
 * An email younger than this is never called missed: the webhook may still
 * be working on it (the claim goes stale after 6 minutes; Resend's second and
 * third retries come at 5 s and 5 min). 15 minutes clears both.
 */
export const RECONCILE_GRACE_MS = 15 * 60 * 1000;
/** A "received" claim older than this is stuck (matches CLAIM_STALE_MS, 0255). */
export const STUCK_AFTER_MS = 6 * 60 * 1000;
/** At most this many emails are pulled in per run (each can take a minute). */
export const MAX_INGEST_PER_RUN = 5;
/** Stop starting new work after this much of the 300 s function budget. */
export const RUN_BUDGET_MS = 200 * 1000;
/** Automatic retries of a TEMPORARY failure: wait this long after each attempt. */
export const AUTO_RETRY_BACKOFF_MS: readonly number[] = [5 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000];
export const MAX_AUTO_RETRIES = AUTO_RETRY_BACKOFF_MS.length;
/** At most this many automatic retries per run. */
export const MAX_AUTO_RETRIES_PER_RUN = 3;
/** Fingerprint match: same sender + subject within this many minutes. */
export const FINGERPRINT_WINDOW_MS = 20 * 60 * 1000;
/** The heartbeat is refreshed at least this often even when nothing changed. */
export const HEARTBEAT_REFRESH_MS = 30 * 60 * 1000;
/** The 15-minute check has not run for this long: say so in red. */
export const HEARTBEAT_STALE_MS = 45 * 60 * 1000;
/** A failing mailbox check alerts the owner once it has failed this long. */
export const HEALTH_ALERT_AFTER_MS = 60 * 60 * 1000;
/** compliance_reminder_log stages (send-once claims). */
export const FAIL_ALERT_STAGE = "inbound_email_failed";
export const HEALTH_ALERT_STAGE = "inbound_mailbox_check_failing";

/* ------------------------------------------------------------------ *
 *  Identity
 * ------------------------------------------------------------------ */

/** RFC 5322 Message-ID -> lower case, no angle brackets; null when unusable. */
export function normalizeMessageId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  let t = v.trim();
  const m = /<([^<>]+)>/.exec(t);
  if (m) t = m[1];
  t = t.trim().toLowerCase();
  if (!t || t.length > 300 || !/^[\x21-\x7e]+$/.test(t) || !t.includes("@")) return null;
  return t;
}

/** Subject for matching: no Fwd:/Fw:/Re: prefixes, one space, lower case. */
export function normalizeSubject(v: unknown): string {
  let s = typeof v === "string" ? v : "";
  for (let i = 0; i < 5; i += 1) {
    const next = s.replace(/^\s*(fwd?|fw|re|aw|tr)\s*:\s*/i, "").replace(/^\s*\[(fwd?|fw)[^\]]*\]\s*/i, "");
    if (next === s) break;
    s = next;
  }
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** The address inside `Name <addr>` (or a bare address), lower case. */
export function addressOf(from: unknown): string | null {
  if (typeof from !== "string" || !from.trim()) return null;
  const angle = /<([^<>\s]+@[^<>\s]+)>\s*$/.exec(from.trim());
  const addr = (angle ? angle[1] : from.trim()).toLowerCase();
  return EMAIL_RE.test(addr) ? addr : null;
}

function cleanToken(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.length > 200 || !/^[\x21-\x7e]+$/.test(t)) return null;
  return t;
}

/** Delivery key of an email read straight from Gmail (same 0255 unique index). */
export function gmailDeliveryKey(gmailId: unknown): string | null {
  const id = cleanToken(gmailId);
  return id ? `gmail:msg:${id}` : null;
}

/** Delivery key of an email in Resend's receiving list (= the webhook's key). */
export function resendDeliveryKey(emailId: unknown): string | null {
  const id = cleanToken(emailId);
  return id ? `resend:email:${id}` : null;
}

/** An email as listed at a source (Resend receiving list, or Gmail). */
export type SourceEmail = {
  source: "resend" | "gmail";
  /** Resend email id / Gmail message id. */
  ref: string;
  messageId: string | null;
  from: string | null;
  subject: string | null;
  /** ISO time the source received it. */
  receivedAt: string;
  to: string[];
};

/** The parts of an inbound_email_log row the matcher reads. */
export type LogRef = {
  id: string;
  provider?: string | null;
  delivery_key: string | null;
  message_id?: string | null;
  source_ref?: string | null;
  from_address: string | null;
  subject: string | null;
  received_at: string | null;
  disposition: string | null;
};

export type MatchHow = "delivery_key" | "source_ref" | "message_id" | "fingerprint";

export function sourceDeliveryKey(s: SourceEmail): string | null {
  return s.source === "resend" ? resendDeliveryKey(s.ref) : gmailDeliveryKey(s.ref);
}

/**
 * Is this source email already on the table? Strongest identity first:
 * the delivery key, the source id, the RFC Message-ID, and last a fingerprint
 * (same sender, same subject without Fwd:/Re:, within 20 minutes). The
 * fingerprint only looks at rows with no Message-ID of their own, so two
 * different emails that share a subject (a vendor's daily "Manifest" mail)
 * are never confused once Message-IDs are recorded.
 */
export function matchSourceToLog(s: SourceEmail, logs: readonly LogRef[]): { row: LogRef; how: MatchHow } | null {
  const key = sourceDeliveryKey(s);
  if (key) {
    const hit = logs.find((l) => l.delivery_key === key);
    if (hit) return { row: hit, how: "delivery_key" };
  }
  const refHit = logs.find((l) => l.source_ref && l.source_ref === s.ref && (l.provider ?? s.source) === s.source);
  if (refHit) return { row: refHit, how: "source_ref" };
  const mid = normalizeMessageId(s.messageId);
  if (mid) {
    const hit = logs.find((l) => normalizeMessageId(l.message_id) === mid);
    if (hit) return { row: hit, how: "message_id" };
  }
  const addr = addressOf(s.from);
  const subj = normalizeSubject(s.subject);
  const t = Date.parse(s.receivedAt);
  if (addr && subj && Number.isFinite(t)) {
    const hit = logs.find((l) => {
      if (normalizeMessageId(l.message_id) && mid) return false;
      if (addressOf(l.from_address) !== addr) return false;
      if (normalizeSubject(l.subject) !== subj) return false;
      const lt = Date.parse(l.received_at ?? "");
      return Number.isFinite(lt) && Math.abs(lt - t) <= FINGERPRINT_WINDOW_MS;
    });
    if (hit) return { row: hit, how: "fingerprint" };
  }
  return null;
}

export type ReconcilePlan = {
  /** Source emails already on the table. */
  onTable: number;
  /** Emails to pull in now (oldest first, at most maxIngest). */
  ingest: SourceEmail[];
  /** Missing emails left for the next run (over the per-run cap). */
  deferred: number;
  /** Too new to call missed (inside the grace period). */
  tooNew: number;
  /** The same email listed by both sources is counted once. */
  sameEmailTwice: number;
};

/**
 * Compare what the mailbox holds with what the table holds. The same email
 * listed by Resend AND Gmail (it was forwarded) is pulled in once, preferring
 * the Gmail copy (it is the mailbox the owner looks at). Oldest first, so a
 * backlog drains in order across runs.
 */
export function planReconcile(input: {
  sources: readonly SourceEmail[];
  logs: readonly LogRef[];
  nowMs: number;
  graceMs?: number;
  maxIngest?: number;
}): ReconcilePlan {
  const grace = input.graceMs ?? RECONCILE_GRACE_MS;
  const max = input.maxIngest ?? MAX_INGEST_PER_RUN;
  let onTable = 0;
  let tooNew = 0;
  let sameEmailTwice = 0;
  const missing: SourceEmail[] = [];
  const ordered = [...input.sources].sort((a, b) => (a.source === b.source ? 0 : a.source === "gmail" ? -1 : 1));
  const seenMid = new Set<string>();
  const seenFp: SourceEmail[] = [];
  for (const s of ordered) {
    if (matchSourceToLog(s, input.logs)) {
      onTable += 1;
      continue;
    }
    const mid = normalizeMessageId(s.messageId);
    if (mid && seenMid.has(mid)) {
      sameEmailTwice += 1;
      continue;
    }
    const asLog: LogRef[] = seenFp.map((x, i) => ({
      id: `pending-${i}`,
      delivery_key: null,
      message_id: x.messageId,
      from_address: x.from,
      subject: x.subject,
      received_at: x.receivedAt,
      disposition: null,
    }));
    if (!mid && matchSourceToLog({ ...s, ref: "\u0000" }, asLog)) {
      sameEmailTwice += 1;
      continue;
    }
    const t = Date.parse(s.receivedAt);
    if (Number.isFinite(t) && input.nowMs - t < grace) {
      tooNew += 1;
      continue;
    }
    if (mid) seenMid.add(mid);
    seenFp.push(s);
    missing.push(s);
  }
  missing.sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
  return { onTable, ingest: missing.slice(0, max), deferred: Math.max(0, missing.length - max), tooNew, sameEmailTwice };
}

/* ------------------------------------------------------------------ *
 *  Needs attention: classify, retry, resolve
 * ------------------------------------------------------------------ */

/** The inbound_email_log columns the attention rules read. */
export type AttentionRow = {
  id: string;
  provider: string | null;
  delivery_key: string | null;
  source_ref?: string | null;
  message_id?: string | null;
  from_address: string | null;
  subject: string | null;
  received_at: string | null;
  created_at?: string | null;
  claimed_at?: string | null;
  to_intake: boolean | null;
  disposition: string | null;
  manifest_id: string | null;
  note: string | null;
  attachment_count?: number | null;
  retry_count?: number | null;
  last_retry_at?: string | null;
  resolved_at?: string | null;
};

export type AttentionKind = "failed_to_read" | "no_manifest" | "stuck" | "fetch_failed";
export type FailureCategory = "temporary" | "permanent";

export type Attention = {
  kind: AttentionKind;
  category: FailureCategory;
  /** Short label for the badge. */
  label: string;
  /** One plain sentence: what happened and what to do. */
  advice: string;
};

const FETCH_FAIL_RE =
  /RESEND_API_KEY not set|could not fetch|fetch failed|receiving\.get|HTTP 5\d\d|HTTP 429|timed? ?out|aborted|ECONNRESET|ETIMEDOUT|webhook had no email_id|not an email payload/i;

/** Did the fetch itself fail (network / provider / key), as opposed to the email lacking a manifest? */
export function noteShowsFetchFailure(note: string | null | undefined): boolean {
  return FETCH_FAIL_RE.test(note ?? "");
}

/**
 * Does this row need a person (or an automatic retry)? Only intake-mailbox
 * rows count (menus and LCB bulletins have their own pages). A row a person
 * marked Resolved, a staged row and a duplicate are fine. The vendor_intake@
 * mailbox only receives manifests (owner message 6, verbatim: "The
 * vendor_intake@ address will only receive manifests."), so an intake email
 * with no manifest found IS a failure to chase, not noise.
 */
export function classifyAttention(row: AttentionRow, nowMs: number): Attention | null {
  if (row.resolved_at) return null;
  const disp = (row.disposition ?? "").toLowerCase();
  if (disp === "received") {
    // A claim that is still fresh is a delivery being worked on right now.
    const t = Date.parse(row.claimed_at ?? row.last_retry_at ?? row.created_at ?? row.received_at ?? "");
    if (Number.isFinite(t) && nowMs - t < STUCK_AFTER_MS) return null;
    return {
      kind: "stuck",
      category: "temporary",
      label: "Stuck",
      advice: "The fetch started but never finished (the run was cut off). Try again pulls it in from the start.",
    };
  }
  if (row.to_intake === false) return null;
  if (disp === "parse_failed") {
    return {
      kind: "failed_to_read",
      category: "temporary",
      label: "Could not read",
      advice:
        "A manifest file arrived but could not be read. Try again reads it once more (the document reader is sometimes busy); if it still fails, ask the vendor to resend it.",
    };
  }
  if (disp === "no_manifest") {
    if (noteShowsFetchFailure(row.note)) {
      return {
        kind: "fetch_failed",
        category: "temporary",
        label: "Fetch failed",
        advice: "The email's contents could not be downloaded. Try again downloads it once more.",
      };
    }
    return {
      kind: "no_manifest",
      category: "permanent",
      label: "No manifest found",
      advice:
        "No manifest file or transfer link was found in this email. Open it in the mailbox: if it is a manifest, Try again; if it is not (a reply, a sample note), mark it Resolved.",
    };
  }
  return null;
}

function baseTimeMs(row: AttentionRow): number {
  const t = Date.parse(row.last_retry_at ?? row.created_at ?? row.received_at ?? "");
  return Number.isFinite(t) ? t : 0;
}

/** Should the background check retry this row now, by itself? Temporary failures only, with backoff and a cap. */
export function autoRetryDue(row: AttentionRow, att: Attention | null, nowMs: number): boolean {
  if (!att || att.category !== "temporary") return false;
  const n = Math.max(0, Math.floor(row.retry_count ?? 0));
  if (n >= MAX_AUTO_RETRIES) return false;
  return nowMs - baseTimeMs(row) >= AUTO_RETRY_BACKOFF_MS[n];
}

/** A person must look: a permanent failure, or a temporary one the automatic retries did not fix. */
export function needsPerson(row: AttentionRow, att: Attention | null): boolean {
  if (!att) return false;
  return att.category === "permanent" || Math.floor(row.retry_count ?? 0) >= MAX_AUTO_RETRIES;
}

/** When the next automatic retry runs (ISO), or null when there is none left. */
export function nextAutoRetryAt(row: AttentionRow, att: Attention | null): string | null {
  if (!att || att.category !== "temporary") return null;
  const n = Math.max(0, Math.floor(row.retry_count ?? 0));
  if (n >= MAX_AUTO_RETRIES) return null;
  return new Date(baseTimeMs(row) + AUTO_RETRY_BACKOFF_MS[n]).toISOString();
}

/** Where this row's email can be fetched again from. */
export type SourceRef = { kind: "resend"; id: string } | { kind: "gmail"; id: string };

export function sourceRefFor(row: Pick<AttentionRow, "provider" | "source_ref" | "delivery_key">): SourceRef | null {
  const ref = cleanToken(row.source_ref);
  if (ref && (row.provider === "resend" || row.provider === "gmail")) return { kind: row.provider, id: ref };
  const key = row.delivery_key ?? "";
  if (key.startsWith("resend:email:")) {
    const id = cleanToken(key.slice("resend:email:".length));
    if (id) return { kind: "resend", id };
  }
  if (key.startsWith("gmail:msg:")) {
    const id = cleanToken(key.slice("gmail:msg:".length));
    if (id) return { kind: "gmail", id };
  }
  return null;
}

export type RetryCheck = { ok: true } | { ok: false; reason: string };

/** May this row be fetched again right now? */
export function retryEligibility(row: AttentionRow, nowMs: number): RetryCheck {
  if (row.resolved_at) return { ok: false, reason: "This email was marked Resolved. It is closed." };
  const disp = (row.disposition ?? "").toLowerCase();
  if (disp === "staged") return { ok: false, reason: "This email already made its manifest. It is on the table." };
  if (disp === "duplicate") return { ok: false, reason: "This email's manifest is already on the table (a re-send)." };
  if (disp === "ignored") return { ok: false, reason: "This email was not sent to the vendor_intake@ mailbox." };
  if (disp === "received") {
    const t = Date.parse(row.claimed_at ?? row.last_retry_at ?? row.created_at ?? "");
    if (Number.isFinite(t) && nowMs - t < STUCK_AFTER_MS) {
      return { ok: false, reason: "This email is being fetched right now. Wait a few minutes and look again." };
    }
  }
  if (disp !== "received" && disp !== "parse_failed" && disp !== "no_manifest") {
    return { ok: false, reason: `This email's state (${disp || "unknown"}) cannot be fetched again.` };
  }
  return { ok: true };
}

/** Why a person closed a failure (0320 inbound_email_log_resolved_reason_chk). */
export const RESOLVE_REASONS = [
  { code: "handled_manually", label: "Entered by hand under Manual tools" },
  { code: "not_a_manifest", label: "Not a manifest (reply, sample note, other mail)" },
  { code: "vendor_resent", label: "The vendor sent it again (that email is on the table)" },
  { code: "duplicate", label: "A copy of an email already on the table" },
  { code: "pulled_again", label: "Pulled in with Find an email" },
  { code: "other", label: "Other (say why)" },
] as const;
export type ResolveReason = (typeof RESOLVE_REASONS)[number]["code"];

export function resolveReasonLabel(code: string | null | undefined): string {
  return RESOLVE_REASONS.find((r) => r.code === code)?.label ?? "Resolved";
}

export function validateResolve(reason: unknown, note: unknown): { ok: true; reason: ResolveReason; note: string | null } | { ok: false; error: string } {
  const code = typeof reason === "string" ? reason.trim() : "";
  const r = RESOLVE_REASONS.find((x) => x.code === code);
  if (!r) return { ok: false, error: "Choose why this email is resolved." };
  const n = typeof note === "string" ? note.replace(/\s+/g, " ").trim().slice(0, 500) : "";
  if (r.code === "other" && n.length < 3) return { ok: false, error: "Say why in a few words when the reason is Other." };
  return { ok: true, reason: r.code, note: n || null };
}

/* ------------------------------------------------------------------ *
 *  The attention list summary + alerts
 * ------------------------------------------------------------------ */

export type AttentionItem = { row: AttentionRow; attention: Attention; person: boolean; nextRetryAt: string | null };

export function buildAttentionList(rows: readonly AttentionRow[], nowMs: number): AttentionItem[] {
  const out: AttentionItem[] = [];
  for (const row of rows) {
    const attention = classifyAttention(row, nowMs);
    if (!attention) continue;
    out.push({ row, attention, person: needsPerson(row, attention), nextRetryAt: nextAutoRetryAt(row, attention) });
  }
  // People first, then the oldest.
  out.sort((a, b) => (a.person === b.person ? Date.parse(a.row.received_at ?? "") - Date.parse(b.row.received_at ?? "") : a.person ? -1 : 1));
  return out;
}

/** Depth and age of the oldest item (the dead-letter metrics). */
export function attentionSummary(items: readonly AttentionItem[], nowMs: number): { total: number; needPerson: number; autoRetrying: number; oldestAgeMs: number | null } {
  let oldest: number | null = null;
  for (const i of items) {
    const t = Date.parse(i.row.received_at ?? "");
    if (Number.isFinite(t)) oldest = oldest === null ? t : Math.min(oldest, t);
  }
  const needPerson = items.filter((i) => i.person).length;
  return { total: items.length, needPerson, autoRetrying: items.length - needPerson, oldestAgeMs: oldest === null ? null : Math.max(0, nowMs - oldest) };
}

export function failAlertKey(logId: string): string {
  return `inbound-fail:${logId}`;
}

export type InboundAlert = { dedupeKey: string; stage: string; subject: string; text: string; html: string; linkPath: string };

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** One alert per email that needs a person, sent once (the key is claimed in compliance_reminder_log first). */
export function planFailureAlert(item: AttentionItem, origin: string): InboundAlert | null {
  if (!item.person) return null;
  const r = item.row;
  const who = r.from_address || "an unknown sender";
  const subj = r.subject || "(no subject)";
  const linkPath = `/admin/inventory/intake?tab=email#needs-attention`;
  const url = `${origin.replace(/\/$/, "")}${linkPath}`;
  const tries = Math.floor(r.retry_count ?? 0);
  const triesText = tries > 0 ? ` It was fetched again ${tries} time${tries === 1 ? "" : "s"} and still did not make a manifest.` : "";
  const text = `${item.attention.label}: "${subj}" from ${who}.${triesText} ${item.attention.advice}`;
  return {
    dedupeKey: failAlertKey(r.id),
    stage: FAIL_ALERT_STAGE,
    subject: `Receiving: a vendor email did not make a manifest (${item.attention.label})`,
    text,
    linkPath,
    html:
      `<p><strong>${esc(item.attention.label)}</strong>: &ldquo;${esc(subj)}&rdquo; from ${esc(who)}.${esc(triesText)}</p>` +
      `<p>${esc(item.attention.advice)}</p>` +
      `<p><a href="${esc(url)}">Open Receiving &rarr; Needs attention</a> to press <strong>Try again</strong> or <strong>Resolved</strong>.</p>` +
      `<p style="color:#666;font-size:12px">Sent once for this email by the 15-minute vendor_intake@ mailbox check.</p>`,
  };
}

/* ------------------------------------------------------------------ *
 *  Heartbeat + health
 * ------------------------------------------------------------------ */

export type SourceState = { configured: boolean; ok: boolean; listed: number; error: string | null };

export type ReconcileHeartbeat = {
  lastRunAt: string;
  ok: boolean;
  trigger: "cron" | "manual";
  mailbox: string;
  resend: SourceState;
  gmail: SourceState;
  /** Emails found missing and pulled in this run. */
  recovered: number;
  /** Missing emails left for the next run. */
  deferred: number;
  /** Automatic retries done this run. */
  autoRetried: number;
  /** Open failures after this run, and how many need a person. */
  attention: number;
  needPerson: number;
  failingSince: string | null;
  lastOkAt: string | null;
  /** The last run that pulled in a missed email. */
  lastRecoveredAt: string | null;
};

export function nextFailingSince(prev: ReconcileHeartbeat | null, ok: boolean, nowIso: string): string | null {
  if (ok) return null;
  return prev && !prev.ok && prev.failingSince ? prev.failingSince : nowIso;
}

/** Write when something happened, the state changed, or every 30 minutes. A quiet tick writes nothing. */
export function shouldWriteHeartbeat(prev: ReconcileHeartbeat | null, next: ReconcileHeartbeat, nowMs: number): boolean {
  if (!prev) return true;
  if (next.trigger === "manual") return true;
  if (prev.ok !== next.ok) return true;
  if (next.recovered > 0 || next.autoRetried > 0) return true;
  if (prev.attention !== next.attention || prev.needPerson !== next.needPerson) return true;
  if (prev.resend.configured !== next.resend.configured || prev.gmail.configured !== next.gmail.configured) return true;
  if ((prev.resend.error ?? "") !== (next.resend.error ?? "") || (prev.gmail.error ?? "") !== (next.gmail.error ?? "")) return true;
  const t = Date.parse(prev.lastRunAt);
  return !Number.isFinite(t) || nowMs - t >= HEARTBEAT_REFRESH_MS;
}

export function heartbeatFromSetting(v: unknown): ReconcileHeartbeat | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.lastRunAt !== "string" || typeof o.ok !== "boolean") return null;
  const src = (x: unknown): SourceState => {
    const s = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    return {
      configured: s.configured === true,
      ok: s.ok === true,
      listed: typeof s.listed === "number" && Number.isFinite(s.listed) ? s.listed : 0,
      error: typeof s.error === "string" ? s.error : null,
    };
  };
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  const str = (x: unknown) => (typeof x === "string" ? x : null);
  return {
    lastRunAt: o.lastRunAt,
    ok: o.ok,
    trigger: o.trigger === "manual" ? "manual" : "cron",
    mailbox: typeof o.mailbox === "string" ? o.mailbox : DEFAULT_RECONCILE_MAILBOX,
    resend: src(o.resend),
    gmail: src(o.gmail),
    recovered: num(o.recovered),
    deferred: num(o.deferred),
    autoRetried: num(o.autoRetried),
    attention: num(o.attention),
    needPerson: num(o.needPerson),
    failingSince: str(o.failingSince),
    lastOkAt: str(o.lastOkAt),
    lastRecoveredAt: str(o.lastRecoveredAt),
  };
}

export type HealthTone = "ok" | "warn" | "bad";

function ago(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** The one line the Receiving page shows about the mailbox check. */
export function healthLine(hb: ReconcileHeartbeat | null, nowMs: number, migrationApplied: boolean): { tone: HealthTone; text: string } {
  if (!migrationApplied) {
    return { tone: "warn", text: "Apply database update 0320 (supabase/migrations/0320_inbound_email_reconcile.sql) to turn on the mailbox check, Try again and Resolved." };
  }
  if (!hb) return { tone: "warn", text: "The mailbox check has not run yet. It runs every 15 minutes; press Check the mailbox now to run it at once." };
  const t = Date.parse(hb.lastRunAt);
  const age = Number.isFinite(t) ? nowMs - t : Number.POSITIVE_INFINITY;
  if (!hb.resend.configured && !hb.gmail.configured) {
    return { tone: "bad", text: "The mailbox check cannot read any source: set RESEND_API_KEY, or the GMAIL_WIF_* sign-in for the vendor_intake@ mailbox." };
  }
  if (age > HEARTBEAT_STALE_MS) {
    return { tone: "bad", text: `The 15-minute mailbox check last ran ${ago(age)}. It should run every 15 minutes: check the cron in Vercel.` };
  }
  if (!hb.ok) {
    const since = hb.failingSince ? Date.parse(hb.failingSince) : NaN;
    const err = hb.gmail.error ?? hb.resend.error ?? "unknown error";
    return { tone: "bad", text: `The mailbox check is failing${Number.isFinite(since) ? ` (since ${ago(nowMs - since)})` : ""}: ${err}` };
  }
  const parts: string[] = [];
  if (hb.gmail.configured) parts.push(`Gmail ${hb.mailbox}: ${hb.gmail.listed} email${hb.gmail.listed === 1 ? "" : "s"}`);
  if (hb.resend.configured) parts.push(`Resend: ${hb.resend.listed}`);
  const missingGmail = !hb.gmail.configured ? " Gmail sign-in is not set up, so only Resend's copy is compared." : "";
  const deferred = hb.deferred > 0 ? ` ${hb.deferred} more missed email${hb.deferred === 1 ? "" : "s"} will be pulled in on the next check.` : "";
  return {
    tone: hb.gmail.configured && hb.deferred === 0 ? "ok" : "warn",
    text: `Mailbox checked ${ago(age)} (${parts.join("; ")}, last ${RECONCILE_LOOKBACK_DAYS} days).${missingGmail}${deferred}`,
  };
}

export function healthAlertKey(failingSince: string): string {
  return `inbound-health:${failingSince}`;
}

/** Once the check has failed for an hour, alert once for that failure stretch. */
export function planHealthAlert(hb: ReconcileHeartbeat, nowMs: number, origin: string): InboundAlert | null {
  if (hb.ok || !hb.failingSince) return null;
  const since = Date.parse(hb.failingSince);
  if (!Number.isFinite(since) || nowMs - since < HEALTH_ALERT_AFTER_MS) return null;
  const err = hb.gmail.error ?? hb.resend.error ?? "unknown error";
  const linkPath = "/admin/inventory/intake?tab=email#needs-attention";
  const url = `${origin.replace(/\/$/, "")}${linkPath}`;
  return {
    dedupeKey: healthAlertKey(hb.failingSince),
    stage: HEALTH_ALERT_STAGE,
    subject: "Receiving: the vendor_intake@ mailbox check is failing",
    text: `The 15-minute mailbox check has failed for over an hour: ${err}. Missed manifest emails are not being pulled in until it is fixed.`,
    linkPath,
    html:
      `<p>The 15-minute vendor_intake@ mailbox check has failed for over an hour:</p><p><code>${esc(err)}</code></p>` +
      `<p>Until it is fixed, a manifest email the webhook missed is not pulled in automatically. <a href="${esc(url)}">Open Receiving</a>.</p>`,
  };
}

/* ------------------------------------------------------------------ *
 *  Gmail: query + message walk
 * ------------------------------------------------------------------ */

/** The mailbox to read: INBOUND_RECONCILE_MAILBOX, else vendor_intake@greenwaymarijuana.com. */
export function reconcileMailbox(env: Readonly<Record<string, string | undefined>>): string | null {
  const v = ((env[RECONCILE_MAILBOX_ENV] ?? "").trim() || DEFAULT_RECONCILE_MAILBOX).toLowerCase();
  return EMAIL_RE.test(v) ? v : null;
}

/** Everything that arrived in the window (not sent mail, not drafts). Spam and Trash are included by the caller. */
export function buildReconcileQuery(nowMs: number, days: number): string {
  const d = Math.max(1, Math.min(MAX_FIND_DAYS, Math.floor(days)));
  const after = Math.floor((nowMs - d * 86_400_000) / 1000);
  return `after:${after} -in:sent -in:drafts -in:chats`;
}

/**
 * "Find an email": the owner's words become a Gmail search, kept inside the
 * window and the received mail. Gmail operators the owner types (from:,
 * subject:, has:attachment) still work; line breaks and quotes are tidied and
 * the text is capped.
 */
export function buildFindQuery(text: unknown, nowMs: number, days: number): { ok: true; q: string; shown: string } | { ok: false; error: string } {
  const raw = typeof text === "string" ? text.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim() : "";
  if (raw.length < 2) return { ok: false, error: "Type part of the sender, the subject or the manifest number." };
  const shown = raw.slice(0, 200);
  const quotes = (shown.match(/"/g) ?? []).length;
  const safe = quotes % 2 === 0 ? shown : shown.replace(/"/g, "");
  return { ok: true, q: `${safe} ${buildReconcileQuery(nowMs, days)}`, shown };
}

export type GmailPartLike = {
  mimeType?: string;
  filename?: string;
  headers?: { name?: string; value?: string }[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPartLike[];
};

export type GmailAttachmentRef = { filename: string; mimeType: string; size: number; attachmentId: string | null; inlineData: string | null };

function decodeB64url(data: string | undefined): string {
  if (!data) return "";
  return Buffer.from(data, "base64url").toString("utf8");
}

/**
 * Walk a Gmail message for the intake pipeline: BOTH bodies (the HTML holds
 * the transfer and invoice links as anchors; the CCRS walker drops it when
 * plain text exists), every named attachment, and the headers that identify
 * the email. Inline signature images are skipped (they are never documents).
 */
export function walkGmailForIntake(payload: GmailPartLike | undefined): {
  text: string;
  html: string;
  attachments: GmailAttachmentRef[];
  skippedImages: number;
} {
  const plain: string[] = [];
  const html: string[] = [];
  const attachments: GmailAttachmentRef[] = [];
  let skippedImages = 0;
  const visit = (p: GmailPartLike | undefined, depth: number) => {
    if (!p || depth > 20) return;
    const mt = (p.mimeType ?? "").toLowerCase();
    const name = (p.filename ?? "").trim();
    if (name) {
      if (mt.startsWith("image/") && !/\.pdf$/i.test(name)) {
        skippedImages += 1;
      } else {
        attachments.push({
          filename: name,
          mimeType: mt,
          size: typeof p.body?.size === "number" ? p.body.size : 0,
          attachmentId: p.body?.attachmentId ?? null,
          inlineData: p.body?.attachmentId ? null : (p.body?.data ?? null),
        });
      }
    } else if (mt === "text/plain" && p.body?.data) plain.push(decodeB64url(p.body.data));
    else if (mt === "text/html" && p.body?.data) html.push(decodeB64url(p.body.data));
    for (const c of p.parts ?? []) visit(c, depth + 1);
  };
  visit(payload, 0);
  return { text: plain.join("\n"), html: html.join("\n"), attachments, skippedImages };
}

export function gmailHeader(payload: GmailPartLike | undefined, name: string): string | null {
  const h = (payload?.headers ?? []).find((x) => (x.name ?? "").toLowerCase() === name.toLowerCase());
  return h && typeof h.value === "string" ? h.value : null;
}

/** Recipient list (To, Cc, Delivered-To), lower-case addresses. */
export function gmailRecipients(payload: GmailPartLike | undefined): string[] {
  const out = new Set<string>();
  for (const n of ["to", "cc", "delivered-to", "x-forwarded-to"]) {
    for (const h of payload?.headers ?? []) {
      if ((h.name ?? "").toLowerCase() !== n) continue;
      for (const piece of (h.value ?? "").split(",")) {
        const a = addressOf(piece.trim());
        if (a) out.add(a);
      }
    }
  }
  return [...out];
}

/** Gmail list item -> SourceEmail (metadata only, from a format=metadata get). */
export function gmailToSource(msg: { id?: string; internalDate?: string; payload?: GmailPartLike }): SourceEmail | null {
  if (typeof msg.id !== "string" || !msg.id) return null;
  const ms = Number(msg.internalDate);
  const date = gmailHeader(msg.payload, "date");
  const iso = Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : date && Number.isFinite(Date.parse(date)) ? new Date(Date.parse(date)).toISOString() : new Date(0).toISOString();
  return {
    source: "gmail",
    ref: msg.id,
    messageId: normalizeMessageId(gmailHeader(msg.payload, "message-id")),
    from: gmailHeader(msg.payload, "from"),
    subject: gmailHeader(msg.payload, "subject"),
    receivedAt: iso,
    to: gmailRecipients(msg.payload),
  };
}

/** Resend receiving list item -> SourceEmail. */
export function resendToSource(item: unknown): SourceEmail | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  const id = cleanToken(o.id);
  if (!id) return null;
  const to = Array.isArray(o.to) ? o.to.map((x) => addressOf(x)).filter((x): x is string => !!x) : typeof o.to === "string" ? [addressOf(o.to)].filter((x): x is string => !!x) : [];
  const created = typeof o.created_at === "string" && Number.isFinite(Date.parse(o.created_at)) ? new Date(Date.parse(o.created_at)).toISOString() : new Date(0).toISOString();
  return {
    source: "resend",
    ref: id,
    messageId: normalizeMessageId(o.message_id),
    from: typeof o.from === "string" ? o.from : null,
    subject: typeof o.subject === "string" ? o.subject : null,
    receivedAt: created,
    to,
  };
}

/** Is a source email addressed to the intake mailbox (local part match, as isForIntakeMailbox)? */
export function addressedTo(s: SourceEmail, mailbox: string): boolean {
  const target = mailbox.trim().toLowerCase();
  if (!target) return false;
  const local = target.includes("@") ? target.split("@")[0] : target;
  return s.to.some((a) => a === target || a.split("@")[0] === local);
}

/* ------------------------------------------------------------------ *
 *  Run summary (the banner after "Check the mailbox now")
 * ------------------------------------------------------------------ */

export type ReconcileRunSummary = {
  configured: boolean;
  onTable: number;
  recovered: number;
  recoveredStaged: number;
  deferred: number;
  tooNew: number;
  autoRetried: number;
  errors: string[];
};

export function describeRun(r: ReconcileRunSummary): string {
  if (!r.configured) return "No source to read: set RESEND_API_KEY or the GMAIL_WIF_* sign-in for the vendor_intake@ mailbox.";
  const parts: string[] = [];
  if (r.recovered === 0) parts.push(`Every email in the mailbox is on the table (${r.onTable} checked).`);
  else
    parts.push(
      `Pulled in ${r.recovered} email${r.recovered === 1 ? "" : "s"} the system had missed (${r.recoveredStaged} made a manifest); ${r.onTable} were already on the table.`,
    );
  if (r.deferred > 0) parts.push(`${r.deferred} more will be pulled in by the next check (press again to do it now).`);
  if (r.tooNew > 0) parts.push(`${r.tooNew} arrived in the last 15 minutes and are still being received.`);
  if (r.autoRetried > 0) parts.push(`${r.autoRetried} failed email${r.autoRetried === 1 ? " was" : "s were"} fetched again.`);
  if (r.errors.length > 0) parts.push(`Problems: ${r.errors.join("; ")}`);
  return parts.join(" ");
}

/* ------------------------------------------------------------------ *
 *  Self-test
 * ------------------------------------------------------------------ */

export function __runInboundReconcileCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`inbound-reconcile-core FAIL: ${m}`);
    }
  };
  const NOW = Date.parse("2026-10-29T18:00:00Z");
  const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();

  // identity
  ok(normalizeMessageId("<CAF=abc@mail.gmail.com>") === "caf=abc@mail.gmail.com", "message-id brackets + case");
  ok(normalizeMessageId("  abc@x.com ") === "abc@x.com", "message-id bare");
  ok(normalizeMessageId("no-at-sign") === null, "message-id needs @");
  ok(normalizeMessageId(42) === null, "message-id non-string");
  ok(normalizeMessageId("a b@x.com") === null, "message-id no spaces");
  ok(normalizeSubject("Fwd: RE: Fw:  Manifest  #123") === "manifest #123", "subject prefixes");
  ok(normalizeSubject("[Fwd: x] Manifest") === "manifest", "subject bracket fwd");
  ok(addressOf("Lilac <Orders@Lilac.com>") === "orders@lilac.com", "address angle");
  ok(addressOf("orders@lilac.com") === "orders@lilac.com", "address bare");
  ok(addressOf("nobody") === null, "address none");
  ok(gmailDeliveryKey("18c2f") === "gmail:msg:18c2f", "gmail key");
  ok(gmailDeliveryKey("bad id") === null, "gmail key refuses spaces");
  ok(resendDeliveryKey("e_1") === "resend:email:e_1", "resend key = webhook key");

  // matching
  const src = (o: Partial<SourceEmail>): SourceEmail => ({ source: "gmail", ref: "g1", messageId: null, from: "a@v.com", subject: "Manifest 1", receivedAt: iso(60), to: [DEFAULT_RECONCILE_MAILBOX], ...o });
  const log = (o: Partial<LogRef>): LogRef => ({ id: "L1", delivery_key: null, message_id: null, source_ref: null, from_address: null, subject: null, received_at: null, disposition: "staged", ...o });
  ok(matchSourceToLog(src({ source: "resend", ref: "e1" }), [log({ delivery_key: "resend:email:e1" })])?.how === "delivery_key", "match by delivery key");
  ok(matchSourceToLog(src({ ref: "g9" }), [log({ provider: "gmail", source_ref: "g9" })])?.how === "source_ref", "match by source ref");
  ok(matchSourceToLog(src({ messageId: "<M@x>" }), [log({ message_id: "m@x" })])?.how === "message_id", "match by message id across sources");
  ok(matchSourceToLog(src({ subject: "Fwd: Manifest 1" }), [log({ from_address: "A <a@v.com>", subject: "Manifest 1", received_at: iso(70) })])?.how === "fingerprint", "fingerprint within 20 min");
  ok(matchSourceToLog(src({}), [log({ from_address: "a@v.com", subject: "Manifest 1", received_at: iso(90) })]) === null, "fingerprint outside window");
  ok(matchSourceToLog(src({}), [log({ from_address: "b@v.com", subject: "Manifest 1", received_at: iso(60) })]) === null, "fingerprint other sender");
  ok(
    matchSourceToLog(src({ messageId: "new@x" }), [log({ message_id: "old@x", from_address: "a@v.com", subject: "Manifest 1", received_at: iso(60) })]) === null,
    "two different emails with the same subject are not confused once message ids exist",
  );
  ok(matchSourceToLog(src({ source: "resend", ref: "g9" }), [log({ provider: "gmail", source_ref: "g9" })]) === null, "source ref is per provider");

  // plan
  const plan = planReconcile({
    nowMs: NOW,
    sources: [
      src({ ref: "g1", messageId: "one@x", receivedAt: iso(120) }),
      src({ source: "resend", ref: "e1", messageId: "one@x", receivedAt: iso(119) }),
      src({ ref: "g2", messageId: "two@x", receivedAt: iso(300) }),
      src({ ref: "g3", messageId: "three@x", receivedAt: iso(5) }),
      src({ ref: "g4", messageId: "four@x", receivedAt: iso(60) }),
    ],
    logs: [log({ message_id: "four@x" })],
  });
  ok(plan.onTable === 1, `plan onTable ${plan.onTable}`);
  ok(plan.tooNew === 1, "plan grace period");
  ok(plan.sameEmailTwice === 1, "plan same email in two sources once");
  ok(plan.ingest.map((s) => s.ref).join(",") === "g2,g1", `plan oldest first, gmail copy preferred (${plan.ingest.map((s) => s.ref).join(",")})`);
  const capped = planReconcile({ nowMs: NOW, maxIngest: 1, logs: [], sources: [src({ ref: "a", messageId: "a@x" }), src({ ref: "b", messageId: "b@x" })] });
  ok(capped.ingest.length === 1 && capped.deferred === 1, "plan cap + deferred");
  const fpTwice = planReconcile({
    nowMs: NOW,
    logs: [],
    sources: [src({ ref: "g1", receivedAt: iso(100) }), src({ source: "resend", ref: "e1", receivedAt: iso(99) })],
  });
  ok(fpTwice.ingest.length === 1 && fpTwice.sameEmailTwice === 1, "no message ids: the two copies still pulled once (fingerprint)");

  // attention
  const row = (o: Partial<AttentionRow>): AttentionRow => ({
    id: "R1", provider: "resend", delivery_key: "resend:email:e1", from_address: "a@v.com", subject: "Manifest", received_at: iso(60), created_at: iso(60),
    claimed_at: null, to_intake: true, disposition: "parse_failed", manifest_id: null, note: null, retry_count: 0, last_retry_at: null, resolved_at: null, ...o,
  });
  ok(classifyAttention(row({}), NOW)?.kind === "failed_to_read", "parse_failed -> could not read");
  ok(classifyAttention(row({}), NOW)?.category === "temporary", "parse_failed is temporary");
  ok(classifyAttention(row({ disposition: "no_manifest" }), NOW)?.category === "permanent", "no manifest is permanent");
  ok(classifyAttention(row({ disposition: "no_manifest", note: "x — RESEND_API_KEY not set — could not fetch" }), NOW)?.kind === "fetch_failed", "fetch failure is temporary");
  ok(classifyAttention(row({ disposition: "received", claimed_at: iso(2) }), NOW) === null, "fresh claim is in flight, not stuck");
  ok(classifyAttention(row({ disposition: "received", claimed_at: iso(10) }), NOW)?.kind === "stuck", "stale claim is stuck");
  ok(classifyAttention(row({ disposition: "received", claimed_at: null, created_at: iso(30) }), NOW)?.kind === "stuck", "released claim is stuck");
  ok(classifyAttention(row({ disposition: "staged" }), NOW) === null, "staged fine");
  ok(classifyAttention(row({ disposition: "duplicate" }), NOW) === null, "duplicate fine");
  ok(classifyAttention(row({ disposition: "ignored", to_intake: false }), NOW) === null, "other mailbox fine");
  ok(classifyAttention(row({ disposition: "no_manifest", to_intake: false }), NOW) === null, "non-intake no_manifest fine");
  ok(classifyAttention(row({ resolved_at: iso(1) }), NOW) === null, "resolved fine");

  // auto retry
  const a1 = classifyAttention(row({ created_at: iso(4) }), NOW);
  ok(!autoRetryDue(row({ created_at: iso(4) }), a1, NOW), "backoff 5 min not reached");
  ok(autoRetryDue(row({ created_at: iso(6) }), a1, NOW), "backoff 5 min reached");
  ok(!autoRetryDue(row({ retry_count: 1, last_retry_at: iso(20) }), a1, NOW), "second retry waits 30 min");
  ok(autoRetryDue(row({ retry_count: 1, last_retry_at: iso(31) }), a1, NOW), "second retry after 30 min");
  ok(!autoRetryDue(row({ retry_count: 4, last_retry_at: iso(9999) }), a1, NOW), "cap of 4 automatic retries");
  const perm = classifyAttention(row({ disposition: "no_manifest" }), NOW);
  ok(!autoRetryDue(row({ disposition: "no_manifest", created_at: iso(999) }), perm, NOW), "permanent never retried automatically");
  ok(needsPerson(row({ disposition: "no_manifest" }), perm), "permanent needs a person");
  ok(!needsPerson(row({}), a1) && needsPerson(row({ retry_count: 4 }), a1), "temporary needs a person after the cap");
  ok(nextAutoRetryAt(row({ created_at: iso(0) }), a1) === new Date(NOW + 5 * 60_000).toISOString(), "next retry time");
  ok(nextAutoRetryAt(row({ retry_count: 4 }), a1) === null, "no next retry after cap");

  // source ref
  ok(sourceRefFor({ provider: "gmail", source_ref: "g1", delivery_key: null })?.kind === "gmail", "source ref gmail");
  ok(sourceRefFor({ provider: "resend", source_ref: null, delivery_key: "resend:email:e7" })?.id === "e7", "source ref from webhook key");
  ok(sourceRefFor({ provider: "resend", source_ref: null, delivery_key: "svix:msg_1" }) === null, "svix-only key has no source id");
  ok(sourceRefFor({ provider: "sendgrid", source_ref: "x", delivery_key: null }) === null, "sendgrid cannot be refetched");

  // retry eligibility
  ok(retryEligibility(row({}), NOW).ok, "parse_failed may retry");
  ok(!retryEligibility(row({ disposition: "staged" }), NOW).ok, "staged may not retry");
  ok(!retryEligibility(row({ disposition: "duplicate" }), NOW).ok, "duplicate may not retry");
  ok(!retryEligibility(row({ disposition: "ignored" }), NOW).ok, "ignored may not retry");
  ok(!retryEligibility(row({ resolved_at: iso(1) }), NOW).ok, "resolved may not retry");
  ok(!retryEligibility(row({ disposition: "received", claimed_at: iso(1) }), NOW).ok, "in flight may not retry");
  ok(retryEligibility(row({ disposition: "received", claimed_at: iso(30) }), NOW).ok, "stuck may retry");

  // resolve
  ok(!validateResolve("nope", "").ok, "resolve needs a known reason");
  ok(!validateResolve("other", " ").ok, "other needs words");
  const vr = validateResolve("not_a_manifest", "  a reply  ");
  ok(vr.ok && vr.note === "a reply", "resolve trims note");
  ok(RESOLVE_REASONS.length === 6, "six reasons (match 0320 check)");
  ok(resolveReasonLabel("vendor_resent").startsWith("The vendor sent it again"), "reason label");

  // list + summary + alerts
  const list = buildAttentionList(
    [row({ id: "t", received_at: iso(10) }), row({ id: "p", disposition: "no_manifest", received_at: iso(5) }), row({ id: "ok", disposition: "staged" })],
    NOW,
  );
  ok(list.length === 2 && list[0].row.id === "p", "people first");
  const sum = attentionSummary(list, NOW);
  ok(sum.total === 2 && sum.needPerson === 1 && sum.autoRetrying === 1 && sum.oldestAgeMs === 10 * 60_000, "depth + oldest age");
  const al = planFailureAlert(list[0], "https://www.greenwaymarijuana.com/");
  ok(!!al && al.dedupeKey === "inbound-fail:p" && al.stage === FAIL_ALERT_STAGE, "alert key once per email");
  ok(!!al && al.html.includes("https://www.greenwaymarijuana.com/admin/inventory/intake?tab=email#needs-attention"), "alert link");
  ok(planFailureAlert(list[1], "https://x") === null, "no alert while automatic retries remain");
  const xss = planFailureAlert({ ...list[0], row: { ...list[0].row, subject: "<script>x</script>" } }, "https://x");
  ok(!!xss && !xss.html.includes("<script>"), "alert escapes the subject");

  // heartbeat
  const hb = (o: Partial<ReconcileHeartbeat>): ReconcileHeartbeat => ({
    lastRunAt: iso(5), ok: true, trigger: "cron", mailbox: DEFAULT_RECONCILE_MAILBOX,
    resend: { configured: true, ok: true, listed: 4, error: null }, gmail: { configured: true, ok: true, listed: 5, error: null },
    recovered: 0, deferred: 0, autoRetried: 0, attention: 0, needPerson: 0, failingSince: null, lastOkAt: iso(5), lastRecoveredAt: null, ...o,
  });
  ok(nextFailingSince(null, false, iso(0)) === iso(0), "failing since starts");
  ok(nextFailingSince(hb({ ok: false, failingSince: iso(90) }), false, iso(0)) === iso(90), "failing since kept");
  ok(nextFailingSince(hb({ ok: false, failingSince: iso(90) }), true, iso(0)) === null, "failing since cleared");
  ok(!shouldWriteHeartbeat(hb({}), hb({ lastRunAt: iso(0) }), NOW), "quiet tick writes nothing");
  ok(shouldWriteHeartbeat(hb({ lastRunAt: iso(31) }), hb({ lastRunAt: iso(0) }), NOW), "refresh every 30 min");
  ok(shouldWriteHeartbeat(hb({}), hb({ recovered: 1 }), NOW), "recovery writes");
  ok(shouldWriteHeartbeat(hb({}), hb({ ok: false }), NOW), "state change writes");
  ok(shouldWriteHeartbeat(hb({}), hb({ trigger: "manual" }), NOW), "manual run writes");
  ok(shouldWriteHeartbeat(hb({}), hb({ attention: 1 }), NOW), "attention change writes");
  ok(heartbeatFromSetting(hb({}))?.gmail.listed === 5, "heartbeat round trip");
  ok(heartbeatFromSetting({ nope: 1 }) === null, "heartbeat rejects junk");
  ok(healthLine(null, NOW, false).text.includes("0320"), "health: migration first");
  ok(healthLine(null, NOW, true).tone === "warn", "health: never ran");
  ok(healthLine(hb({}), NOW, true).tone === "ok", "health ok");
  ok(healthLine(hb({ lastRunAt: iso(50) }), NOW, true).tone === "bad", "health stale");
  ok(healthLine(hb({ ok: false, failingSince: iso(20), gmail: { configured: true, ok: false, listed: 0, error: "Gmail messages.list: HTTP 403" } }), NOW, true).text.includes("HTTP 403"), "health failing names the error");
  ok(healthLine(hb({ gmail: { configured: false, ok: false, listed: 0, error: null } }), NOW, true).tone === "warn", "health: Gmail not set up is gold");
  ok(healthLine(hb({ gmail: { configured: false, ok: false, listed: 0, error: null }, resend: { configured: false, ok: false, listed: 0, error: null } }), NOW, true).tone === "bad", "health: no source is red");
  ok(planHealthAlert(hb({ ok: false, failingSince: iso(30) }), NOW, "https://x") === null, "health alert waits an hour");
  const ha = planHealthAlert(hb({ ok: false, failingSince: iso(61) }), NOW, "https://x");
  ok(!!ha && ha.dedupeKey === `inbound-health:${iso(61)}`, "health alert once per failing stretch");

  // gmail
  ok(reconcileMailbox({}) === DEFAULT_RECONCILE_MAILBOX, "mailbox default");
  ok(reconcileMailbox({ INBOUND_RECONCILE_MAILBOX: "Other@greenwaymarijuana.com" }) === "other@greenwaymarijuana.com", "mailbox env");
  ok(reconcileMailbox({ INBOUND_RECONCILE_MAILBOX: "nope" }) === null, "mailbox invalid");
  ok(buildReconcileQuery(NOW, 3) === `after:${Math.floor((NOW - 3 * 86_400_000) / 1000)} -in:sent -in:drafts -in:chats`, "reconcile query");
  ok(buildReconcileQuery(NOW, 9999).startsWith(`after:${Math.floor((NOW - MAX_FIND_DAYS * 86_400_000) / 1000)}`), "query window capped");
  const fq = buildFindQuery('from:lilac "manifest\n 12', NOW, 30);
  ok(fq.ok && !fq.q.includes("\n") && !fq.q.includes('"'), "find query tidied (odd quote removed)");
  ok(!buildFindQuery(" ", NOW, 30).ok, "find query needs words");
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
  const walked = walkGmailForIntake({
    mimeType: "multipart/mixed",
    parts: [
      { mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data: b64("Plain body") } }, { mimeType: "text/html", body: { data: b64('<a href="https://x/t.json">Transfer Data Link</a>') } }] },
      { mimeType: "application/pdf", filename: "manifest.pdf", body: { attachmentId: "A1", size: 100 } },
      { mimeType: "image/png", filename: "logo.png", body: { attachmentId: "A2", size: 10 } },
      { mimeType: "application/json", filename: "t.json", body: { data: b64("{}"), size: 2 } },
    ],
  });
  ok(walked.text === "Plain body" && walked.html.includes("Transfer Data Link"), "walk keeps BOTH bodies");
  ok(walked.attachments.length === 2 && walked.skippedImages === 1, "walk skips signature images");
  ok(walked.attachments[1].inlineData !== null && walked.attachments[0].attachmentId === "A1", "walk inline vs attachment id");
  const gs = gmailToSource({
    id: "g1",
    internalDate: String(NOW),
    payload: { headers: [{ name: "Message-ID", value: "<X@Y>" }, { name: "From", value: "V <v@v.com>" }, { name: "Subject", value: "Manifest" }, { name: "To", value: "Vendor Intake <vendor_intake@greenwaymarijuana.com>, b@c.com" }] },
  });
  ok(!!gs && gs.messageId === "x@y" && gs.receivedAt === new Date(NOW).toISOString() && gs.to.length === 2, "gmail -> source");
  ok(!!gs && addressedTo(gs, DEFAULT_RECONCILE_MAILBOX), "addressed to intake");
  const rs = resendToSource({ id: "e1", to: ["vendor_intake@in.greenwaymarijuana.com"], from: "v@v.com", subject: "s", created_at: "2026-10-29T17:00:00Z", message_id: "<A@B>" });
  ok(!!rs && rs.messageId === "a@b" && addressedTo(rs, "vendor_intake"), "resend -> source, local-part match");
  ok(resendToSource({ id: "bad id" }) === null, "resend item needs a clean id");

  // summary
  ok(describeRun({ configured: true, onTable: 9, recovered: 0, recoveredStaged: 0, deferred: 0, tooNew: 0, autoRetried: 0, errors: [] }).startsWith("Every email in the mailbox is on the table (9"), "describe clean");
  ok(describeRun({ configured: true, onTable: 9, recovered: 2, recoveredStaged: 1, deferred: 3, tooNew: 1, autoRetried: 1, errors: ["x"] }).includes("Pulled in 2 emails"), "describe recovery");
  ok(describeRun({ configured: false, onTable: 0, recovered: 0, recoveredStaged: 0, deferred: 0, tooNew: 0, autoRetried: 0, errors: [] }).includes("RESEND_API_KEY"), "describe not configured");

  return { passed, failed };
}
