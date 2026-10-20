/**
 * src/lib/compliance/ccrs-watchdog-core.ts  (CCRS Bible v2 slice S-18c). PURE.
 *
 * Two things the owner could only see by opening the hub until now; this
 * slice makes the system tell him (email + phone, once each):
 *
 *   1. NO ANSWER FROM CCRS. A file marked uploaded that is still `uploaded`
 *      60 minutes later (CCRS_EMAIL_SLA_MINUTES, Part 05 E; the same line
 *      0249 enforces for "no email"). CCRS answers in 30-90 s (Part 15 A1),
 *      so an hour of silence means: the answer went to Spam / another
 *      mailbox, or the upload did not happen, or CCRS is down. The message
 *      says which of those the mailbox monitor can already rule in or out:
 *        - a CCRS confirmation naming the file is stored and not applied
 *          -> "CCRS confirmed it; press Apply" (nothing is missing);
 *        - an unhandled error / unreadable CCRS email arrived after the upload
 *          -> "it may be the answer" (error attachments do not carry our file
 *          name, so it is never matched by guess, Part 15 A2);
 *        - the monitor is not set up / not working -> "check Gmail by hand";
 *        - otherwise -> Spam, the CCRS portal, then the hub's no-email button.
 *      The button stays the owner's: nothing here records an outcome
 *      (standing rule 3).
 *
 *   2. THE MAILBOX MONITOR STOPPED. Configured, but every check has failed
 *      for MAIL_DOWN_AFTER_MINUTES (one alert per outage, keyed on when the
 *      failure began), or no check has run at all for 45 minutes
 *      (heartbeatStale; the daily cron asks, because a dead 5-minute cron
 *      cannot report itself). "Not set up yet" never alerts: the hub's amber
 *      box already says it and nothing was ever promised.
 *
 * Dedupe keys (compliance_reminder_log.dedupe_key, UNIQUE, 0118):
 *   ccrs_no_email:<env>:<file id>
 *   ccrs_mail_down:<mailbox>:<failingSince ISO>
 *   ccrs_mail_stale:<mailbox>:<lastRunAt ISO | never>
 */
import { CCRS_EMAIL_SLA_MINUTES, noEmailAllowedAt } from "./ccrs-outcome-core";
import { heartbeatStale, type MailHeartbeat } from "./ccrs-mail-core";
import { escHtml } from "./ccrs-strategy-core";
import type { LedgerEnv } from "./ccrs-ledger-core";

export const NO_EMAIL_STAGE = "ccrs_no_email";
export const MAIL_DOWN_STAGE = "ccrs_mail_down";
export const MAIL_STALE_STAGE = "ccrs_mail_stale";
/** Three failed 5-minute ticks in a row: one Gmail blip never pages anyone. */
export const MAIL_DOWN_AFTER_MINUTES = 15;
/** At most this many waiting files are read per tick (oldest first). */
export const WATCHDOG_FILE_LIMIT = 25;
const MAIL_PANEL = "/admin/compliance/ccrs#ccrs-mail";

export function filesLink(env: LedgerEnv): string {
  return env === "preprod" ? "/admin/compliance/ccrs?env=preprod#ccrs-files" : "/admin/compliance/ccrs#ccrs-files";
}

export function noEmailKey(env: LedgerEnv, fileId: string): string {
  return `${NO_EMAIL_STAGE}:${env}:${fileId}`;
}
export function mailDownKey(mailbox: string, failingSince: string): string {
  return `${MAIL_DOWN_STAGE}:${mailbox.toLowerCase()}:${failingSince}`;
}
export function mailStaleKey(mailbox: string, lastRunAt: string | null): string {
  return `${MAIL_STALE_STAGE}:${mailbox.toLowerCase()}:${lastRunAt ?? "never"}`;
}

/* ------------------------------------------------------------------ *
 * 1. No answer from CCRS.
 * ------------------------------------------------------------------ */
export type WaitingFile = { id: string; env: LedgerEnv; file_name: string; file_type: string; state: string; uploaded_at: string | null };
/** Stored CCRS mail the owner has not handled yet (0282 state 'new'). */
export type OpenMail = { kind: string; received_at: string | null; fetched_at: string; successNames: string[] };
export type MonitorView = { configured: boolean; healthy: boolean };

export type NoEmailReason = "unapplied-confirmation" | "error-mail-waiting" | "monitor-off" | "silence";
export type NoEmailItem = { dedupeKey: string; fileId: string; env: LedgerEnv; fileName: string; uploadedAt: string; reason: NoEmailReason };

/** When a mail counts as "after the upload": CCRS's arrival, or our fetch when Gmail gave no date. */
function mailAt(m: OpenMail): number {
  const r = m.received_at ? Date.parse(m.received_at) : NaN;
  return Number.isFinite(r) ? r : Date.parse(m.fetched_at);
}

/** The files past the 60-minute line, each with what the mailbox already says about it. */
export function planNoEmail(files: readonly WaitingFile[], mail: readonly OpenMail[], monitor: MonitorView, nowMs: number): NoEmailItem[] {
  const out: NoEmailItem[] = [];
  const confirmed = new Set(mail.filter((m) => m.kind === "success").flatMap((m) => m.successNames));
  for (const f of files) {
    if (f.state !== "uploaded" || !f.uploaded_at) continue;
    const up = Date.parse(f.uploaded_at);
    if (!Number.isFinite(up)) continue;
    if (nowMs < noEmailAllowedAt(new Date(up)).getTime()) continue;
    let reason: NoEmailReason;
    if (confirmed.has(f.file_name)) reason = "unapplied-confirmation";
    else if (mail.some((m) => (m.kind === "error" || m.kind === "unknown") && mailAt(m) >= up - 60_000)) reason = "error-mail-waiting";
    else if (!monitor.configured || !monitor.healthy) reason = "monitor-off";
    else reason = "silence";
    out.push({ dedupeKey: noEmailKey(f.env, f.id), fileId: f.id, env: f.env, fileName: f.file_name, uploadedAt: new Date(up).toISOString(), reason });
  }
  return out;
}

const REASON_TEXT: Record<NoEmailReason, string> = {
  "unapplied-confirmation": "CCRS DID confirm this file: the confirmation is in the hub's CCRS email list and has not been applied. Press Apply there; nothing is missing.",
  "error-mail-waiting":
    "A CCRS error (or unreadable) email arrived after this upload and is waiting in the hub. It may be the answer to this file. Open it; the system never matches an error file to an upload by guess.",
  "monitor-off": "The mailbox monitor is not watching right now, so the system cannot see CCRS's answer. Look in Gmail (Inbox AND Spam) for email from info@lcb.wa.gov.",
  silence:
    "The mailbox monitor checked the submitting mailbox (Spam included) and found nothing from CCRS for this file. Check that the upload really finished in the CCRS portal. If CCRS shows it and still no email came, press \"No email after 60 minutes\" on the hub.",
};

export type WatchdogMessage = { subject: string; text: string; html: string; linkPath: string };

/** One message for every file that crossed the line in this tick (a weekly upload is up to 7 files). */
export function noEmailMessage(items: readonly NoEmailItem[], linkOrigin: string): WatchdogMessage | null {
  if (items.length === 0) return null;
  const envs = [...new Set(items.map((i) => i.env))];
  const envWord = envs.length === 1 ? (envs[0] === "preprod" ? "PREprod " : "") : "";
  const subject =
    items.length === 1
      ? `CCRS: no answer for ${items[0].fileName} after ${CCRS_EMAIL_SLA_MINUTES} minutes`
      : `CCRS: no answer for ${items.length} ${envWord}files after ${CCRS_EMAIL_SLA_MINUTES} minutes`;
  const linkPath = filesLink(envs.length === 1 ? envs[0] : "prod");
  const lines = items.map((i) => `${i.fileName}${i.env === "preprod" ? " (PREprod)" : ""}, uploaded ${i.uploadedAt}: ${REASON_TEXT[i.reason]}`);
  const text = `${items.length === 1 ? lines[0] : `${items.length} uploaded files have no CCRS answer after ${CCRS_EMAIL_SLA_MINUTES} minutes. Open the hub.`}`.slice(0, 300);
  const url = `${linkOrigin}${linkPath}`;
  const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:640px">
  <h2 style="color:#b45309;margin-bottom:4px">${escHtml(subject)}</h2>
  <p style="line-height:1.5;margin:6px 0">CCRS normally answers every upload by email within 1-2 minutes. These files are still waiting after ${CCRS_EMAIL_SLA_MINUTES} minutes:</p>
  <ul>${items.map((_, k) => `<li style="line-height:1.5;margin:6px 0">${escHtml(lines[k])}</li>`).join("")}</ul>
  <p><a href="${escHtml(url)}" style="display:inline-block;background:#12351f;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open the CCRS hub</a></p>
  <p style="color:#555;font-size:13px">Sent once per file by the CCRS watchdog (S-18c). Nothing was recorded for you: the hub's buttons stay yours.</p>
</div>`;
  return { subject, text, html, linkPath };
}

/* ------------------------------------------------------------------ *
 * 2. The mailbox monitor stopped.
 * ------------------------------------------------------------------ */
export type MonitorAlert = { dedupeKey: string; stage: string } & WatchdogMessage;

/**
 * The monitor alert for this moment, or null. `configured` is the env
 * verdict (mailConfigFromEnv); `checkStale` is true only for the daily cron,
 * because the 5-minute tick that just wrote the heartbeat is never stale.
 */
export function planMonitorAlert(hb: MailHeartbeat | null, configured: boolean, mailbox: string, nowMs: number, checkStale: boolean, linkOrigin: string): MonitorAlert | null {
  if (!configured) return null;
  const url = `${linkOrigin}${MAIL_PANEL}`;
  const wrap = (subject: string, lines: string[]) =>
    `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:640px">
  <h2 style="color:#b91c1c;margin-bottom:4px">${escHtml(subject)}</h2>
  ${lines.map((l) => `<p style="line-height:1.5;margin:6px 0">${escHtml(l)}</p>`).join("\n  ")}
  <p><a href="${escHtml(url)}" style="display:inline-block;background:#12351f;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open the CCRS email panel</a></p>
  <p style="color:#555;font-size:13px">Sent once per outage by the CCRS watchdog (S-18c).</p>
</div>`;
  if (checkStale && heartbeatStale(hb, nowMs)) {
    const subject = "CCRS email monitor has stopped checking";
    const lines = [
      hb ? `The last check of ${mailbox} ran at ${hb.lastRunAt}.` : `No check of ${mailbox} has ever been recorded.`,
      "Until it runs again, CCRS confirmations and error emails are NOT being read. Check Gmail (Inbox and Spam) by hand after every upload.",
      "Look at Vercel > the project > Logs for /api/cron/ccrs-mail, and check that CRON_SECRET is set.",
    ];
    return { dedupeKey: mailStaleKey(mailbox, hb?.lastRunAt ?? null), stage: MAIL_STALE_STAGE, subject, text: lines.slice(0, 2).join(" ").slice(0, 300), html: wrap(subject, lines), linkPath: MAIL_PANEL };
  }
  if (!hb || hb.ok || !hb.failingSince) return null;
  const since = Date.parse(hb.failingSince);
  if (!Number.isFinite(since) || nowMs - since < MAIL_DOWN_AFTER_MINUTES * 60_000) return null;
  const subject = "CCRS email monitor is failing";
  const lines = [
    `Every check of ${mailbox} since ${hb.failingSince} has failed: ${(hb.error ?? "unknown error").slice(0, 300)}`,
    `Last good check: ${hb.lastOkAt ?? "never"}.`,
    "Until it is fixed, CCRS confirmations and error emails are NOT being read. Check Gmail (Inbox and Spam) by hand after every upload. The setup guide's error table says what each message means.",
  ];
  return { dedupeKey: mailDownKey(mailbox, hb.failingSince), stage: MAIL_DOWN_STAGE, subject, text: lines.slice(0, 1).join(" ").slice(0, 300), html: wrap(subject, lines), linkPath: MAIL_PANEL };
}

/** The success-notice file names a stored analysis carries (0282 analysis.successes). Unknown shapes give []. */
export function successNamesFromAnalysis(analysis: unknown): string[] {
  if (!analysis || typeof analysis !== "object") return [];
  const s = (analysis as { successes?: unknown }).successes;
  if (!Array.isArray(s)) return [];
  return s.map((x) => (x && typeof x === "object" ? (x as { fileName?: unknown }).fileName : null)).filter((n): n is string => typeof n === "string" && n.length > 0);
}

/* ------------------------------------------------------------------ *
 * Self-tests.
 * ------------------------------------------------------------------ */
export function __runCcrsWatchdogCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, msg: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`  FAIL ccrs-watchdog-core: ${msg}`);
    }
  };
  const T = Date.parse("2026-11-08T20:00:00Z");
  const f = (over: Partial<WaitingFile> = {}): WaitingFile => ({ id: "f1", env: "prod", file_name: "Sale_413541_20261108120000.csv", file_type: "Sale", state: "uploaded", uploaded_at: new Date(T - 61 * 60_000).toISOString(), ...over });
  const on: MonitorView = { configured: true, healthy: true };
  ok(planNoEmail([f()], [], on, T).length === 1, "61 min -> due");
  ok(planNoEmail([f({ uploaded_at: new Date(T - 59 * 60_000).toISOString() })], [], on, T).length === 0, "59 min -> not yet");
  ok(planNoEmail([f({ uploaded_at: new Date(T - 60 * 60_000).toISOString() })], [], on, T).length === 1, "exactly 60 min -> due (0249 allows no-email at 60)");
  ok(planNoEmail([f({ state: "succeeded" })], [], on, T).length === 0, "answered files never alert");
  ok(planNoEmail([f({ uploaded_at: null })], [], on, T).length === 0, "no upload time -> nothing");
  ok(planNoEmail([f()], [], on, T)[0].reason === "silence", "healthy + nothing -> silence");
  ok(planNoEmail([f()], [], { configured: false, healthy: false }, T)[0].reason === "monitor-off", "not set up -> monitor-off");
  ok(planNoEmail([f()], [{ kind: "success", received_at: null, fetched_at: new Date(T).toISOString(), successNames: ["Sale_413541_20261108120000.csv"] }], on, T)[0].reason === "unapplied-confirmation", "confirmation stored");
  ok(planNoEmail([f()], [{ kind: "error", received_at: new Date(T - 30 * 60_000).toISOString(), fetched_at: new Date(T).toISOString(), successNames: [] }], on, T)[0].reason === "error-mail-waiting", "error after upload");
  ok(planNoEmail([f()], [{ kind: "error", received_at: new Date(T - 5 * 3_600_000).toISOString(), fetched_at: new Date(T).toISOString(), successNames: [] }], on, T)[0].reason === "silence", "error long before the upload is not this file's");
  ok(noEmailKey("preprod", "x") === "ccrs_no_email:preprod:x", "key");
  const m = noEmailMessage(planNoEmail([f({ file_name: "<b>.csv" })], [], on, T), "https://s")!;
  ok(!m.html.includes("<b>.csv") && m.html.includes("&lt;b&gt;"), "html escaped");
  ok(noEmailMessage([], "") === null, "no items -> no message");
  const hb: MailHeartbeat = { lastRunAt: new Date(T).toISOString(), lastOkAt: null, ok: false, error: "invalid_grant", mode: "oauth-refresh", newMessages: 0, failingSince: new Date(T - 16 * 60_000).toISOString() };
  ok(planMonitorAlert(hb, true, "M@x.com", T, false, "")?.dedupeKey === `ccrs_mail_down:m@x.com:${hb.failingSince}`, "down after 16 min");
  ok(planMonitorAlert({ ...hb, failingSince: new Date(T - 14 * 60_000).toISOString() }, true, "m", T, false, "") === null, "not down at 14 min");
  ok(planMonitorAlert(hb, false, "m", T, true, "") === null, "not configured never alerts");
  ok(planMonitorAlert({ ...hb, ok: true, failingSince: null }, true, "m", T, false, "") === null, "healthy -> nothing");
  ok(planMonitorAlert({ ...hb, ok: true, lastRunAt: new Date(T - 46 * 60_000).toISOString() }, true, "m", T, true, "")?.stage === MAIL_STALE_STAGE, "stale on the daily check");
  ok(planMonitorAlert({ ...hb, ok: true, lastRunAt: new Date(T - 46 * 60_000).toISOString() }, true, "m", T, false, "") === null, "the tick never reports stale");
  ok(planMonitorAlert(null, true, "m", T, true, "")?.dedupeKey === "ccrs_mail_stale:m:never", "never ran -> stale:never");
  ok(successNamesFromAnalysis({ successes: [{ fileName: "a.csv" }, { x: 1 }] }).join() === "a.csv", "names from analysis");
  ok(successNamesFromAnalysis(null).length === 0, "bad analysis -> []");
  return { passed, failed };
}
