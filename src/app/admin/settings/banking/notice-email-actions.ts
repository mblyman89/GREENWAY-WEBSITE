"use server";

/**
 * R41 S17 (0290): the notice-email watch actions.
 *
 *   saveNoticeSettingsAction   OWNER ONLY (ach.act). It decides which
 *     mailbox is read and which senders count, and turning it ON needs the
 *     typed confirmation "I STILL CHECK THE PORTAL" (checkSettingsForm),
 *     because the Fed's guide (NOTICE_MAIL_QUOTES.fedDontRely) says not to
 *     rely on these emails.
 *   checkNowAction             OWNER ONLY (ach.act). Runs one tick now (the
 *     same code the hourly cron runs). When the watch is off it says so and
 *     makes no Google call.
 *   markNoticeMailAction       finances.view or settings.manage. Saying an
 *     email was logged on ACH operations (or is not a notice) moves no money;
 *     it is the record of who looked. The 0290 trigger is the floor (owner or
 *     an ACTIVE admin, once per email, no edits).
 *
 * Every write is audited (Security Log). Nothing here blocks a payment.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission, requireStaff } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { recordAudit } from "@/lib/auth/audit";
import { checkHandleForm, checkSettingsForm, STATE_WORD } from "@/lib/payments/ach-notice-mail-core";
import { markNoticeMail, runNoticeMailTick, saveNoticeSettings } from "@/lib/payments/ach-notice-mail-store";

const PAGE = "/admin/settings/banking/notice-email";

function back(qs: { msg?: string; error?: string }, anchor = "top"): never {
  const p = new URLSearchParams();
  if (qs.msg) p.set("msg", qs.msg.slice(0, 900));
  if (qs.error) p.set("error", qs.error.slice(0, 900));
  revalidatePath(PAGE);
  redirect(`${PAGE}?${p.toString()}#${anchor}`);
}

export async function saveNoticeSettingsAction(fd: FormData): Promise<void> {
  const session = await requirePermission("ach.act");
  const form = checkSettingsForm((k) => fd.get(k) as string | null);
  if (!form.ok) back({ error: form.error }, "settings");
  const r = await saveNoticeSettings(form.settings, session.profile.id);
  if (!r.ok) back({ error: `Could not save: ${r.error}` }, "settings");
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ach.notice_mail.settings_saved",
    entityType: "site_settings",
    entityId: null,
    after: { enabled: form.settings.enabled, senders: form.settings.senders, custom_mailbox: form.settings.mailbox !== null, lookback_hours: form.settings.lookbackHours },
  }).catch(() => {});
  back(
    {
      msg: form.settings.enabled
        ? "Saved. The watch is ON: it looks once an hour. Keep checking the Fed portal and the Timberland portal every day; this is only a heads-up."
        : "Saved. The watch is OFF: no Google call is made.",
    },
    "settings",
  );
}

export async function checkNowAction(): Promise<void> {
  const session = await requirePermission("ach.act");
  const r = await runNoticeMailTick(Date.now());
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ach.notice_mail.checked_now",
    entityType: "ach_notice_mail",
    entityId: null,
    after: { ran: r.ran, ok: r.ok, listed: r.listed, stored: r.stored, alerted: r.alerted },
  }).catch(() => {});
  if (r.reason === "off") back({ msg: "The watch is off, so nothing was checked and no Google call was made. Turn it on below when you are ready." }, "settings");
  if (!r.ok) back({ error: `Check failed: ${r.reason.slice(0, 400)}` }, "status");
  back({ msg: `Checked: ${r.listed} matching email(s) in the look-back window, ${r.stored} new stored, ${r.alerted} owner alert(s) sent.` }, "status");
}

export async function markNoticeMailAction(fd: FormData): Promise<void> {
  const session = await requireStaff();
  if (!(can(session.profile.role, "finances.view") || can(session.profile.role, "settings.manage"))) {
    back({ error: "You do not have access to mark notice emails." }, "emails");
  }
  const form = checkHandleForm((k) => fd.get(k) as string | null);
  if (!form.ok) back({ error: form.error }, "emails");
  const r = await markNoticeMail({ id: form.id, state: form.state, note: form.note, actorId: session.profile.id });
  if (!r.ok) back({ error: r.error }, "emails");
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ach.notice_mail.marked",
    entityType: "ach_notice_mail",
    entityId: form.id,
    after: { state: form.state },
  }).catch(() => {});
  back({ msg: `Marked: ${STATE_WORD[form.state]}. It stays on record and cannot be changed.` }, "emails");
}
