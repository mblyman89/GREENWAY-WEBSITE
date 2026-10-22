/**
 * src/lib/payments/ach-notice-mail-store.ts  (R41 S17). Server glue.
 *
 * The notice-email watch: settings (site_settings ach_notice_mail_settings),
 * one cron tick, the page list, and marking an email. Every decision is in
 * the PURE ach-notice-mail-core; the Gmail calls are the CCRS monitor's own
 * (ccrs-mail-fetch), with the same Google Workspace sign-in (no new keys).
 *
 * OFF BY DEFAULT: when the owner has not turned it on, a tick reads one
 * site_settings row and returns. No Google call of any kind.
 *
 * AGENTS rule 12: the INSERT is the claim (0290 unique (mailbox, gmail_id)),
 * so a doubled tick stores nothing twice; the owner email is claimed per
 * Gmail id in compliance_reminder_log, and the claim is removed if the email
 * fails so the next tick retries. Never throws past the route.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { encryptSecret, decryptSecret, isAtRestEncryptionConfigured } from "@/lib/security/at-rest-crypto";
import { header, headersAll, idsToFetch, mailConfigFromEnv, senderAddress, walkMessage, type MailConfig } from "@/lib/compliance/ccrs-mail-core";
import { getGmailAccessToken, getMessage, listMessageIds } from "@/lib/compliance/ccrs-mail-fetch";
import {
  isEncrypted,
  noticeAlert,
  noticeMailDbError,
  planTick,
  settingsFromJson,
  toNoticeRow,
  type LinkVerdict,
  type NoticeAuth,
  type NoticeMailSettings,
  type NoticeMailState,
} from "./ach-notice-mail-core";
import { resolveNotifyContacts } from "./ach-authorization-core";
import { resendOpsMailer } from "./ach-ops-store";
import { opsSiteUrl } from "./ach-ops-ui-core";
import { escapeHtml } from "@/lib/pos/cutover-watch-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const NOTICE_SETTINGS_KEY = "ach_notice_mail_settings";
const NOTICE_SETTINGS_LABEL = "ACH notice-email watch: on/off, senders, mailbox (R41 S17)";
export const NOTICE_HEARTBEAT_KEY = "ach_notice_mail_heartbeat";
const NOTICE_HEARTBEAT_LABEL = "ACH notice-email watch: last check (R41 S17)";
const GMAIL_ID_RE = /^[0-9a-zA-Z_-]{6,64}$/;
export const NOTICE_PAGE = "/admin/settings/banking/notice-email";
export const NOTICE_LOG_LINK = "/admin/settings/banking/operations#notices";

export type NoticeHeartbeat = { lastRunAt: string; ok: boolean; note: string; stored: number };

export type StoredNoticeMail = {
  id: string;
  mailbox: string;
  received_at: string | null;
  fetched_at: string;
  from_domain: string | null;
  sender_ok: boolean;
  auth: NoticeAuth;
  in_spam: boolean;
  link_verdict: LinkVerdict;
  link_hosts: string[];
  attachment_count: number;
  state: NoticeMailState;
  handled_at: string | null;
  handled_note: string | null;
};

const COLS = "id, mailbox, received_at, fetched_at, from_domain, sender_ok, auth, in_spam, link_verdict, link_hosts, attachment_count, state, handled_at, handled_note";

function mailFacts(cfg: MailConfig): { configured: boolean; mailbox: string; why: string | null } {
  if (cfg.configured) return { configured: true, mailbox: cfg.mailbox, why: null };
  return { configured: false, mailbox: cfg.mailbox, why: cfg.problem ?? (cfg.missing.length ? `${cfg.missing.join(", ")} missing` : null) };
}

export async function getNoticeSettings(admin: Admin = createSupabaseAdminClient()): Promise<NoticeMailSettings> {
  const { data, error } = await admin.from("site_settings").select("value_json").eq("key", NOTICE_SETTINGS_KEY).maybeSingle();
  if (error) return settingsFromJson(null); // unreadable = OFF
  return settingsFromJson(data?.value_json ?? null);
}

export async function saveNoticeSettings(s: Omit<NoticeMailSettings, "updatedAt" | "updatedBy">, actorId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const value: NoticeMailSettings = { ...s, updatedAt: new Date().toISOString(), updatedBy: actorId };
  const { error } = await createSupabaseAdminClient()
    .from("site_settings")
    .upsert({ key: NOTICE_SETTINGS_KEY, label: NOTICE_SETTINGS_LABEL, value_json: value, updated_by: actorId }, { onConflict: "key" });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function getNoticeHeartbeat(admin: Admin = createSupabaseAdminClient()): Promise<NoticeHeartbeat | null> {
  const { data, error } = await admin.from("site_settings").select("value_json").eq("key", NOTICE_HEARTBEAT_KEY).maybeSingle();
  if (error || !data?.value_json || typeof data.value_json !== "object") return null;
  const o = data.value_json as Record<string, unknown>;
  return typeof o.lastRunAt === "string" ? { lastRunAt: o.lastRunAt, ok: o.ok === true, note: String(o.note ?? ""), stored: Number(o.stored ?? 0) } : null;
}

/** Written only when something changed or every 6 hours, so a quiet tick writes nothing. */
async function maybeHeartbeat(admin: Admin, prev: NoticeHeartbeat | null, next: NoticeHeartbeat): Promise<void> {
  const age = prev ? Date.parse(next.lastRunAt) - Date.parse(prev.lastRunAt) : Infinity;
  if (prev && prev.ok === next.ok && prev.note === next.note && next.stored === 0 && age < 6 * 3_600_000) return;
  await admin.from("site_settings").upsert({ key: NOTICE_HEARTBEAT_KEY, label: NOTICE_HEARTBEAT_LABEL, value_json: next, updated_by: null }, { onConflict: "key" });
}

export type NoticeTickResult = { ok: boolean; ran: boolean; reason: string; listed: number; stored: number; alerted: number; failures: string[] };

/** One tick. OFF = one settings read and return. Never throws. */
export async function runNoticeMailTick(nowMs = Date.now()): Promise<NoticeTickResult> {
  const base: NoticeTickResult = { ok: true, ran: false, reason: "", listed: 0, stored: 0, alerted: 0, failures: [] };
  if (!isSupabaseServiceConfigured) return { ...base, ok: false, reason: "Database is not configured." };
  const admin = createSupabaseAdminClient();
  const settings = await getNoticeSettings(admin);
  // OFF: return before reading the mail configuration or calling Google.
  if (!settings.enabled) return { ...base, reason: "off" };
  const cfg = mailConfigFromEnv(process.env);
  const plan = planTick(settings, mailFacts(cfg), isAtRestEncryptionConfigured(), nowMs);
  const prev = await getNoticeHeartbeat(admin).catch(() => null);
  const nowIso = new Date(nowMs).toISOString();
  if (!plan.run || !cfg.configured) {
    const text = plan.run ? "Google Workspace sign-in is not set up." : plan.text;
    await maybeHeartbeat(admin, prev, { lastRunAt: nowIso, ok: false, note: text, stored: 0 }).catch(() => undefined);
    return { ...base, ok: false, reason: text };
  }
  try {
    const token = await getGmailAccessToken({ ...cfg, mailbox: plan.mailbox }, nowMs);
    const listed = await listMessageIds(token, plan.mailbox, plan.query);
    const valid = listed.ids.filter((id) => GMAIL_ID_RE.test(id));
    const known = new Set<string>();
    if (valid.length) {
      const { data, error } = await admin.from("ach_notice_mail").select("gmail_id").eq("mailbox", plan.mailbox).in("gmail_id", valid);
      if (error) throw new Error(noticeMailDbError(`${error.code ?? ""} ${error.message}`));
      for (const r of (data as { gmail_id: string }[] | null) ?? []) known.add(r.gmail_id);
    }
    const { fetch } = idsToFetch(valid, known);
    const failures: string[] = [];
    const newIds: string[] = [];
    for (const id of fetch) {
      try {
        const msg = await getMessage(token, plan.mailbox, id);
        const hs = msg.payload?.headers;
        const walked = walkMessage(msg.payload);
        const ms = Number(msg.internalDate);
        const row = toNoticeRow(
          plan.mailbox,
          {
            gmailId: id,
            receivedAt: Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null,
            fromAddress: senderAddress(header(hs, "From")),
            subject: header(hs, "Subject") ?? "",
            text: walked.text,
            labelIds: msg.labelIds ?? [],
            authResults: headersAll(hs, "Authentication-Results"),
            attachmentNames: walked.attachments.map((a) => a.filename),
          },
          settings.senders,
          (s) => encryptSecret(s),
        );
        // Never store bank email in clear (0290 refuses it too).
        if (!isEncrypted(row.subject_enc) || !isEncrypted(row.body_enc)) throw new Error("not encrypted (DATA_ENCRYPTION_KEY)");
        const { data, error } = await admin.from("ach_notice_mail").upsert(row, { onConflict: "mailbox,gmail_id", ignoreDuplicates: true }).select("id");
        if (error) throw new Error(noticeMailDbError(error.message));
        const got = (data as { id: string }[] | null) ?? [];
        if (got.length) newIds.push(got[0].id);
      } catch (e) {
        failures.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const alerted = await alertOpenNoticeMail(admin);
    const ok = failures.length === 0;
    await maybeHeartbeat(admin, prev, { lastRunAt: nowIso, ok, note: ok ? "ok" : failures[0].slice(0, 300), stored: newIds.length }).catch(() => undefined);
    return { ...base, ran: true, ok, reason: ok ? "checked" : `${failures.length} message(s) could not be read`, listed: valid.length, stored: newIds.length, alerted, failures };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await maybeHeartbeat(admin, prev, { lastRunAt: nowIso, ok: false, note: msg.slice(0, 300), stored: 0 }).catch(() => undefined);
    return { ...base, ran: true, ok: false, reason: msg };
  }
}

/** One owner email per waiting notice email, claimed per row id. Returns how many were sent. */
async function alertOpenNoticeMail(admin: Admin): Promise<number> {
  const { data, error } = await admin
    .from("ach_notice_mail")
    .select("id, received_at, sender_ok, auth, link_verdict, in_spam")
    .eq("state", "new")
    // The 25 NEWEST waiting emails (already-claimed ones are skipped by the
    // claim), so an older pile of waiting emails can never starve a new one.
    .order("fetched_at", { ascending: false })
    .order("id", { ascending: true })
    .range(0, 24);
  if (error) return 0;
  const site = opsSiteUrl(process.env);
  const links = { page: `${site}${NOTICE_PAGE}`, log: `${site}${NOTICE_LOG_LINK}` };
  const to = resolveNotifyContacts(process.env).contacts.michael.email;
  let sent = 0;
  for (const r of (data ?? []) as { id: string; received_at: string | null; sender_ok: boolean; auth: NoticeAuth; link_verdict: LinkVerdict; in_spam: boolean }[]) {
    const m = noticeAlert(r, links);
    const dedupeKey = `ach-notice-mail:${r.id}`;
    const { error: claimError } = await admin.from("compliance_reminder_log").insert({ dedupe_key: dedupeKey, stage: "ach-notice-mail", channel: "email", subject: m.subject.slice(0, 300), recipients: to });
    if (claimError) continue; // already claimed (sent before) or the log is unreachable
    let ok = false;
    try {
      const html = `<p><strong>${escapeHtml(m.subject)}</strong></p><pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(m.text)}</pre>`;
      ok = (await resendOpsMailer()([to], { subject: m.subject, html })).ok;
    } catch {
      ok = false;
    }
    if (ok) sent += 1;
    else await admin.from("compliance_reminder_log").delete().eq("dedupe_key", dedupeKey);
  }
  return sent;
}

/** The page list: every stored notice email, newest first (paged; no silent 1,000-row cap). */
export async function listNoticeMail(): Promise<{ available: boolean; rows: StoredNoticeMail[]; error: string | null }> {
  if (!isSupabaseServiceConfigured) return { available: false, rows: [], error: null };
  const admin = createSupabaseAdminClient();
  let lastError = "";
  const { rows, verdict } = await pagedAllChecked<StoredNoticeMail>(async (from, to) => {
    const { data, error } = await admin.from("ach_notice_mail").select(COLS).order("id", { ascending: true }).range(from, to);
    if (error) lastError = `${error.code ?? ""} ${error.message}`;
    return { rows: (data as StoredNoticeMail[] | null) ?? [], ok: !error };
  }, { maxRows: 10_000 });
  if (!verdict.complete) {
    const missing = /ach_notice_mail/.test(lastError) && /does not exist|schema cache|42P01/.test(lastError);
    return { available: !missing, rows: [], error: missing ? null : noticeMailDbError(lastError || "the read did not finish") };
  }
  rows.sort((a, b) => (b.received_at ?? b.fetched_at).localeCompare(a.received_at ?? a.fetched_at));
  return { available: true, rows, error: null };
}

/** The decrypted subject and body of one email, for the owner's eyes on the page only. */
export async function readNoticeMailText(id: string): Promise<{ subject: string; body: string } | null> {
  const { data, error } = await createSupabaseAdminClient().from("ach_notice_mail").select("subject_enc, body_enc").eq("id", id).maybeSingle();
  if (error || !data) return null;
  const d = data as { subject_enc: string; body_enc: string };
  return { subject: decryptSecret(d.subject_enc), body: decryptSecret(d.body_enc) };
}

/** new -> logged | not_a_notice, once (0290 refuses a second time). */
export async function markNoticeMail(i: { id: string; state: Exclude<NoticeMailState, "new">; note: string; actorId: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await createSupabaseAdminClient()
    .from("ach_notice_mail")
    .update({ state: i.state, handled_by: i.actorId, handled_at: new Date().toISOString(), handled_note: i.note })
    .eq("id", i.id)
    .eq("state", "new")
    .select("id");
  if (error) return { ok: false, error: noticeMailDbError(error.message) };
  if (((data as unknown[] | null) ?? []).length !== 1) return { ok: false, error: "This email was already marked, or it no longer exists. Reload the page." };
  return { ok: true };
}
