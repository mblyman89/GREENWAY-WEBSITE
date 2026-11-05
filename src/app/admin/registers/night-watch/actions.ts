"use server";

/**
 * /admin/registers/night-watch: server actions (D182, round slice S5).
 *
 * Owner only (requireBooksAccess): who gets nagged, and on which channel, is
 * the owner's call. Both actions are audited.
 *   saveNightWatchNotifyAction  turn email / text on or off, set recipients
 *   sendNightWatchTestAction    send this morning's report now (ignores the
 *                               once-a-day claim and the all-clear rule)
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireBooksAccess } from "@/lib/accounting/books-access";
import { recordAudit } from "@/lib/auth/audit";
import { validateNotifyForm } from "@/lib/registers/night-watch-core";
import { NIGHT_WATCH_PAGE, saveNotifySettings, sendNightWatchTest } from "@/lib/registers/night-watch-store";

export async function saveNightWatchNotifyAction(formData: FormData): Promise<void> {
  const session = await requireBooksAccess();
  const v = validateNotifyForm({
    emailEnabled: formData.get("emailEnabled") === "on",
    smsEnabled: formData.get("smsEnabled") === "on",
    emailTo: String(formData.get("emailTo") ?? ""),
    smsTo: String(formData.get("smsTo") ?? ""),
    sendAllClear: formData.get("sendAllClear") === "on",
  });
  if (!v.ok) redirect(`${NIGHT_WATCH_PAGE}?error=${encodeURIComponent(v.error)}`);
  const saved = await saveNotifySettings(v.settings, session.profile.id);
  if (!saved.ok) redirect(`${NIGHT_WATCH_PAGE}?error=${encodeURIComponent(saved.error)}`);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "night_watch.notify_saved",
    entityType: "site_settings",
    entityId: "night_watch_notify",
    after: {
      emailEnabled: v.settings.emailEnabled,
      smsEnabled: v.settings.smsEnabled,
      emails: v.settings.emailTo.length,
      phones: v.settings.smsTo.length,
      sendAllClear: v.settings.sendAllClear,
    },
  });
  revalidatePath(NIGHT_WATCH_PAGE);
  redirect(`${NIGHT_WATCH_PAGE}?saved=1`);
}

export async function sendNightWatchTestAction(): Promise<void> {
  const session = await requireBooksAccess();
  const out = await sendNightWatchTest();
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "night_watch.test_sent",
    entityType: "night_watch",
    entityId: out.report.day,
    after: { email: out.sent.email, sms: out.sent.sms, why: out.why, notes: out.notes },
  });
  const nothing = !out.sent.email && out.sent.sms === 0;
  const msg = nothing
    ? `Nothing sent: ${[out.why, ...out.notes].join("; ")}`
    : `Sent${out.sent.email ? " by email" : ""}${out.sent.sms > 0 ? `${out.sent.email ? " and" : ""} by text to ${out.sent.sms} phone(s)` : ""}.${out.notes.length ? ` ${out.notes.join("; ")}` : ""}`;
  redirect(`${NIGHT_WATCH_PAGE}?${nothing ? "error" : "sent"}=${encodeURIComponent(msg)}`);
}
