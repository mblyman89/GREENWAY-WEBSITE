/**
 * src/lib/compliance/ccrs-mail-store.ts  (CCRS Bible v2 slice S-18a). Server glue.
 *
 * One cron tick (runCcrsMailTick) and the reads/writes the hub needs. Every
 * decision is in the PURE ccrs-mail-core; Gmail I/O is in ccrs-mail-fetch.
 *
 * AGENTS rule 12 (crons):
 *   - Idempotent: a message is stored once (0282 unique (mailbox, gmail_id));
 *     the INSERT is the claim, so a doubled tick stores nothing twice.
 *   - A quiet tick writes nothing: the heartbeat (site_settings
 *     ccrs_mail_heartbeat) is written only when the state changes, when new
 *     mail arrived, or every 30 minutes (shouldWriteHeartbeat).
 *   - Never throws past the route; the tick answers { ok, ... }.
 *
 * Nothing here writes ccrs_files. Apply (actions.ts) does that as the signed-in
 * owner, through the same 0249 function the paste boxes use.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  attachmentPlan,
  buildCcrsQuery,
  classifyCcrsMail,
  heartbeatFromSetting,
  idsToFetch,
  mailConfigFromEnv,
  nextFailingSince,
  normalizeGmailMessage,
  shouldWriteHeartbeat,
  toMailRow,
  type CcrsMailRow,
  type MailHeartbeat,
} from "./ccrs-mail-core";
import { getAttachmentText, getGmailAccessToken, getMessage, listMessageIds } from "./ccrs-mail-fetch";
import { notifyOpenCcrsMail, type MailNotifyResult } from "./ccrs-mail-notify";
import { runCcrsWatchdog, type WatchdogResult } from "./ccrs-watchdog";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const MAIL_HEARTBEAT_KEY = "ccrs_mail_heartbeat";
const MAIL_HEARTBEAT_LABEL = "CCRS email monitor: last check of the submitting mailbox (S-18a)";
const GMAIL_ID_RE = /^[0-9a-zA-Z_-]{6,64}$/;

export type StoredCcrsMail = CcrsMailRow & {
  id: string;
  fetched_at: string;
  state: "new" | "applied" | "dismissed";
  handled_at: string | null;
  handled_note: string | null;
};

const COLS =
  "id, mailbox, gmail_id, thread_id, received_at, fetched_at, from_header, subject, kind, env, env_verified, auth, in_spam, body_text, analysis, csvs, state, handled_at, handled_note";

function missingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return err.code === "42P01" || (/ccrs_mail_messages/.test(err.message ?? "") && /does not exist|schema cache/.test(err.message ?? ""));
}

export async function getMailHeartbeat(admin: Admin): Promise<MailHeartbeat | null> {
  const { data, error } = await admin.from("site_settings").select("value_json").eq("key", MAIL_HEARTBEAT_KEY).maybeSingle();
  if (error) return null;
  return heartbeatFromSetting(data?.value_json ?? null);
}

async function writeHeartbeat(admin: Admin, hb: MailHeartbeat): Promise<void> {
  await admin.from("site_settings").upsert({ key: MAIL_HEARTBEAT_KEY, label: MAIL_HEARTBEAT_LABEL, value_json: hb, updated_by: null }, { onConflict: "key" });
}

async function knownIds(admin: Admin, mailbox: string, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await admin.from("ccrs_mail_messages").select("gmail_id").eq("mailbox", mailbox).in("gmail_id", [...ids]);
  if (error) throw new Error(missingTable(error) ? "Apply database update 0282 (ccrs_mail_messages) first." : `ccrs_mail_messages: ${error.message}`);
  return new Set(((data as { gmail_id: string }[] | null) ?? []).map((r) => r.gmail_id));
}

export type MailTickResult = {
  ok: boolean;
  configured: boolean;
  mode: string | null;
  listed: number;
  stored: number;
  deferred: number;
  failures: string[];
  error: string | null;
  /** S-18b owner alerts for open error / unreadable mail (null when the monitor is not set up). */
  alerts: MailNotifyResult | null;
  /** S-18c watchdog (no CCRS answer after 60 minutes; monitor failing). Runs on every path once the database is reachable. */
  watchdog: WatchdogResult | null;
};

/** One poll of the submitting mailbox. Never throws. */
export async function runCcrsMailTick(nowMs = Date.now()): Promise<MailTickResult> {
  const base: MailTickResult = { ok: true, configured: false, mode: null, listed: 0, stored: 0, deferred: 0, failures: [], error: null, alerts: null, watchdog: null };
  if (!isSupabaseServiceConfigured) return { ...base, ok: false, error: "Database is not configured." };
  const cfg = mailConfigFromEnv(process.env);
  const admin = createSupabaseAdminClient();
  const prev = await getMailHeartbeat(admin).catch(() => null);
  const finish = async (r: MailTickResult): Promise<MailTickResult> => {
    const nowIso = new Date(nowMs).toISOString();
    const next: MailHeartbeat = {
      lastRunAt: nowIso,
      lastOkAt: r.ok ? nowIso : (prev?.lastOkAt ?? null),
      ok: r.ok,
      error: r.error,
      mode: cfg.configured ? cfg.mode : null,
      newMessages: r.stored,
      failingSince: nextFailingSince(prev, r.ok, cfg.configured ? cfg.mode : null, nowIso),
    };
    if (shouldWriteHeartbeat(prev, next, nowMs)) await writeHeartbeat(admin, next).catch(() => undefined);
    // S-18c: on every path (set up or not, Gmail working or not). Never throws.
    const watchdog = await runCcrsWatchdog(admin, { configured: cfg.configured, mailbox: cfg.mailbox, heartbeat: next, nowMs, checkStale: false });
    return { ...r, watchdog };
  };
  if (!cfg.configured) {
    // Not set up yet is a routine state, not a failure: the route answers 200 and the
    // heartbeat records why (written only when that reason changes, rule 12).
    const why = cfg.problem ?? `Not set up: ${cfg.missing.join(", ")} missing.`;
    return finish({ ...base, ok: false, error: why });
  }
  try {
    const token = await getGmailAccessToken(cfg, nowMs);
    const q = buildCcrsQuery(nowMs, cfg.lookbackHours);
    const listed = await listMessageIds(token, cfg.mailbox, q);
    const valid = listed.ids.filter((id) => GMAIL_ID_RE.test(id));
    const known = await knownIds(admin, cfg.mailbox, valid);
    const { fetch, deferred } = idsToFetch(valid, known);
    const failures: string[] = [];
    let stored = 0;
    for (const id of fetch) {
      try {
        const msg = await getMessage(token, cfg.mailbox, id);
        const plan = attachmentPlan(msg);
        const csvs: { filename: string; text: string }[] = [];
        for (const a of plan.download) csvs.push({ filename: a.filename, text: await getAttachmentText(token, cfg.mailbox, id, a) });
        const m = normalizeGmailMessage(msg, csvs, plan.skipped);
        const row = toMailRow(cfg.mailbox, m, classifyCcrsMail(m));
        // The insert is the claim: a concurrent tick that got here first wins, this one stores nothing.
        const { data, error } = await admin.from("ccrs_mail_messages").upsert(row, { onConflict: "mailbox,gmail_id", ignoreDuplicates: true }).select("id");
        if (error) throw new Error(error.message);
        if (((data as unknown[] | null) ?? []).length > 0) stored += 1;
      } catch (e) {
        failures.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const truncated = listed.truncated ? ["more CCRS mail in the window than one tick lists; the rest is read next tick"] : [];
    const ok = failures.length === 0;
    // S-18b: alert the owner once per open error email (claimed in compliance_reminder_log). Never throws.
    const alerts = await notifyOpenCcrsMail(admin, cfg.mailbox, nowMs);
    return finish({
      ...base,
      alerts,
      ok,
      configured: true,
      mode: cfg.mode,
      listed: valid.length,
      stored,
      deferred,
      failures: [...failures, ...truncated],
      error: ok ? null : `${failures.length} message(s) could not be read: ${failures[0]}`,
    });
  } catch (e) {
    return finish({ ...base, ok: false, configured: true, mode: cfg.mode, error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * S-18c, from the DAILY compliance-reminders cron: the same watchdog with
 * checkStale=true, so a 5-minute cron that stopped running is reported by a
 * cron that still runs. Never throws.
 */
export async function runCcrsWatchdogDaily(nowMs = Date.now()): Promise<WatchdogResult | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const cfg = mailConfigFromEnv(process.env);
    const admin = createSupabaseAdminClient();
    const heartbeat = await getMailHeartbeat(admin).catch(() => null);
    return await runCcrsWatchdog(admin, { configured: cfg.configured, mailbox: cfg.mailbox, heartbeat, nowMs, checkStale: true });
  } catch (e) {
    return { planned: 0, sent: 0, alreadyClaimed: 0, undelivered: 0, unsentNoChannel: 0, notes: [`watchdog failed: ${e instanceof Error ? e.message : String(e)}`] };
  }
}

/** The hub panel: newest stored CCRS mail. available=false while 0282 is not applied. */
export async function listRecentCcrsMail(limit = 25): Promise<{ available: boolean; rows: StoredCcrsMail[]; error: string | null; heartbeat: MailHeartbeat | null }> {
  if (!isSupabaseServiceConfigured) return { available: false, rows: [], error: null, heartbeat: null };
  const admin = createSupabaseAdminClient();
  const heartbeat = await getMailHeartbeat(admin).catch(() => null);
  const { data, error } = await admin
    .from("ccrs_mail_messages")
    .select(COLS)
    .order("received_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) return { available: !missingTable(error), rows: [], error: missingTable(error) ? null : `ccrs_mail_messages: ${error.message}`, heartbeat };
  return { available: true, rows: (data as StoredCcrsMail[] | null) ?? [], error: null, heartbeat };
}

export async function getCcrsMail(admin: Admin, id: string): Promise<StoredCcrsMail> {
  const { data, error } = await admin.from("ccrs_mail_messages").select(COLS).eq("id", id).single();
  if (error || !data) throw new Error(`ccrs_mail_messages ${id}: ${error?.message ?? "not found"}`);
  return data as StoredCcrsMail;
}

/** new -> applied | dismissed, once. The `.eq("state","new")` makes a double click a no-op. */
export async function markCcrsMailHandled(admin: Admin, id: string, state: "applied" | "dismissed", byProfileId: string, note: string): Promise<boolean> {
  const { data, error } = await admin
    .from("ccrs_mail_messages")
    .update({ state, handled_by: byProfileId, handled_at: new Date().toISOString(), handled_note: note.slice(0, 2000) })
    .eq("id", id)
    .eq("state", "new")
    .select("id");
  if (error) throw new Error(`ccrs_mail_messages: ${error.message}`);
  return ((data as unknown[] | null) ?? []).length === 1;
}

/** R74 S48: every CCRS email still waiting to be applied, oldest first (the order "Answer all" works in). */
export async function listOpenCcrsMail(admin: Admin, limit = 60): Promise<StoredCcrsMail[]> {
  const { data, error } = await admin
    .from("ccrs_mail_messages")
    .select(COLS)
    .eq("state", "new")
    .order("received_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw new Error(`ccrs_mail_messages: ${error.message}`);
  return (data as StoredCcrsMail[] | null) ?? [];
}
