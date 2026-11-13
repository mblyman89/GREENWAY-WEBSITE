"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { sendNewsletter } from "@/lib/cms/newsletter-send-store";
import { can } from "@/lib/auth/roles";
import { BROADCAST_GATE_MESSAGE } from "@/lib/cms/newsletter-email-core";
import { runNewsletterQueue, retryFailedRecipients } from "@/lib/cms/newsletter-queue-server";
import { RETRY_FAILED_MESSAGE } from "@/lib/cms/newsletter-batch-core";
import { markReady, approve, backToDraft, saveCadence } from "@/lib/cms/newsletter-cadence-server";
import { validateSendAt } from "@/lib/cms/newsletter-cadence-core";
import { pacificLocalToUtc, snapUpToGrid } from "@/lib/cms/content-schedule-core";

const ADMIN = "/admin/newsletter";

function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/** Send a test copy to a single address. */
export async function testSendNewsletterAction(formData: FormData): Promise<void> {
  const session = await requirePermission("blog.manage");
  const newsletterId = String(formData.get("newsletter_id") ?? "");
  const testEmail = String(formData.get("test_email") ?? "").trim().toLowerCase();

  if (!newsletterId) redirect(`${ADMIN}?error=${encodeURIComponent("Choose a newsletter first.")}`);
  if (!isValidEmail(testEmail)) {
    redirect(`${ADMIN}?selected=${newsletterId}&error=${encodeURIComponent("Enter a valid test email address.")}`);
  }

  const res = await sendNewsletter({
    newsletterId,
    testEmail,
    actorId: session.userId,
    actorEmail: session.email,
  });

  if (!res.ok) {
    redirect(`${ADMIN}?selected=${newsletterId}&error=${encodeURIComponent(res.error)}`);
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "newsletter.test_send",
    entityType: "newsletter",
    entityId: newsletterId,
    after: { testEmail, status: res.status },
  });

  revalidatePath(ADMIN);
  redirect(`${ADMIN}?selected=${newsletterId}&tested=${encodeURIComponent(testEmail)}`);
}

/** Broadcast to the full loyalty list. Requires an explicit confirm checkbox. */
export async function broadcastNewsletterAction(formData: FormData): Promise<void> {
  // D237 N-1 (Q-22-3, F-22-17): only the owner or an admin can send to everyone.
  const session = await requirePermission("blog.manage");
  if (!can(session.profile.role, "newsletter.broadcast")) {
    const id = String(formData.get("newsletter_id") ?? "");
    redirect(`${ADMIN}?selected=${encodeURIComponent(id)}&error=${encodeURIComponent(BROADCAST_GATE_MESSAGE)}`);
  }
  const newsletterId = String(formData.get("newsletter_id") ?? "");
  const confirmed = formData.get("confirm") === "on";

  if (!newsletterId) redirect(`${ADMIN}?error=${encodeURIComponent("Choose a newsletter first.")}`);
  if (!confirmed) {
    redirect(`${ADMIN}?selected=${newsletterId}&error=${encodeURIComponent("Tick the confirmation box before sending to everyone.")}`);
  }

  const res = await sendNewsletter({
    newsletterId,
    testEmail: null,
    actorId: session.userId,
    actorEmail: session.email,
  });

  if (!res.ok) {
    redirect(`${ADMIN}?selected=${newsletterId}&error=${encodeURIComponent(res.error)}`);
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "newsletter.broadcast",
    entityType: "newsletter",
    entityId: newsletterId,
    after: {
      recipientCount: res.recipientCount,
      delivered: res.delivered,
      failed: res.failed,
      status: res.status,
      queued: res.queued === true,
    },
  });

  revalidatePath(ADMIN);
  if (res.queued) {
    // D237 N-2 (G-112, F-22-3): the send is queued in batches of 100. Start
    // working it right after this response; the 5-minute content-schedule
    // cron picks up anything left, so leaving the page is fine.
    const sendId = res.sendId;
    after(async () => {
      await runNewsletterQueue({ sendId });
    });
    redirect(`${ADMIN}?selected=${newsletterId}&queued=${res.recipientCount}`);
  }
  redirect(
    `${ADMIN}?selected=${newsletterId}&sent=${res.delivered}&failed=${res.failed}`,
  );
}

/** D237 N-2: put a queued send's failed addresses back in line (owner/admin). */
export async function retryFailedNewsletterAction(formData: FormData): Promise<void> {
  const session = await requirePermission("blog.manage");
  const sendId = String(formData.get("send_id") ?? "");
  const newsletterId = String(formData.get("newsletter_id") ?? "");
  const back = newsletterId ? `${ADMIN}?selected=${encodeURIComponent(newsletterId)}&` : `${ADMIN}?`;
  if (!can(session.profile.role, "newsletter.broadcast")) {
    redirect(`${back}error=${encodeURIComponent(BROADCAST_GATE_MESSAGE)}`);
  }
  if (!sendId) redirect(`${back}error=${encodeURIComponent("Choose a send first.")}`);
  const res = await retryFailedRecipients(sendId);
  if (!res.ok) redirect(`${back}error=${encodeURIComponent(res.error)}`);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "newsletter.retry_failed",
    entityType: "newsletter_send",
    entityId: sendId,
    after: { requeued: res.requeued },
  });
  if (res.requeued > 0) {
    after(async () => {
      await runNewsletterQueue({ sendId });
    });
  }
  revalidatePath(ADMIN);
  redirect(`${back}notice=${encodeURIComponent(res.requeued > 0 ? RETRY_FAILED_MESSAGE : "No failed addresses to retry.")}`);
}

// ── D237 N-3 (G-113, Q-22-4): the Sunday newsletter cadence ─────────────────

function cadenceBack(postId: string): string {
  return postId ? `${ADMIN}?selected=${encodeURIComponent(postId)}&` : `${ADMIN}?`;
}

/** Anyone with Blog access: this week's newsletter is ready for the owner to approve. */
export async function markNewsletterReadyAction(formData: FormData): Promise<void> {
  const session = await requirePermission("blog.manage");
  const postId = String(formData.get("post_id") ?? "");
  if (!postId) redirect(`${ADMIN}?error=${encodeURIComponent("Choose a newsletter first.")}`);
  const res = await markReady(postId, session.userId);
  if (res.error) redirect(`${cadenceBack(postId)}error=${encodeURIComponent(res.error)}#sunday`);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "newsletter.ready",
    entityType: "newsletter",
    entityId: postId,
  });
  revalidatePath(ADMIN);
  redirect(`${cadenceBack(postId)}notice=${encodeURIComponent("Marked ready for approval.")}#sunday`);
}

/** Owner / admin only: approve a ready newsletter and pick when it sends (Pacific). */
export async function approveNewsletterAction(formData: FormData): Promise<void> {
  const session = await requirePermission("blog.manage");
  const postId = String(formData.get("post_id") ?? "");
  const back = cadenceBack(postId);
  if (!can(session.profile.role, "newsletter.broadcast")) {
    redirect(`${back}error=${encodeURIComponent(BROADCAST_GATE_MESSAGE)}#sunday`);
  }
  if (!postId) redirect(`${ADMIN}?error=${encodeURIComponent("Choose a newsletter first.")}`);
  const picked = pacificLocalToUtc(formData.get("send_at"));
  const sendAt = picked ? snapUpToGrid(picked) : null;
  const bad = validateSendAt(sendAt, new Date().toISOString());
  if (bad || !sendAt) redirect(`${back}error=${encodeURIComponent(bad ?? "Pick a date and time.")}#sunday`);
  const res = await approve(postId, sendAt, session.userId);
  if (res.error) redirect(`${back}error=${encodeURIComponent(res.error)}#sunday`);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "newsletter.approve",
    entityType: "newsletter",
    entityId: postId,
    after: { sendAt },
  });
  revalidatePath(ADMIN);
  redirect(`${back}notice=${encodeURIComponent("Approved. It sends to the loyalty list at the time you picked.")}#sunday`);
}

/** Take the ready mark or the approval back. Approving and un-approving are owner/admin. */
export async function newsletterBackToDraftAction(formData: FormData): Promise<void> {
  const session = await requirePermission("blog.manage");
  const postId = String(formData.get("post_id") ?? "");
  const back = cadenceBack(postId);
  if (!postId) redirect(`${ADMIN}?error=${encodeURIComponent("Choose a newsletter first.")}`);
  const res = await backToDraft(postId);
  if (res.error) redirect(`${back}error=${encodeURIComponent(res.error)}#sunday`);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "newsletter.back_to_draft",
    entityType: "newsletter",
    entityId: postId,
  });
  revalidatePath(ADMIN);
  redirect(`${back}notice=${encodeURIComponent("Back to draft. It will not send.")}#sunday`);
}

/** Owner / admin: the Sunday send time and the reminder settings. */
export async function saveNewsletterCadenceAction(formData: FormData): Promise<void> {
  const session = await requirePermission("blog.manage");
  if (!can(session.profile.role, "newsletter.broadcast")) {
    redirect(`${ADMIN}?error=${encodeURIComponent(BROADCAST_GATE_MESSAGE)}#sunday`);
  }
  const res = await saveCadence(
    {
      sendTime: String(formData.get("send_time") ?? "").trim() || null,
      remindDay: Number(formData.get("remind_day")),
      remindTime: String(formData.get("remind_time") ?? "").trim(),
      remindEnabled: formData.get("remind_enabled") === "on",
      remindEmails: String(formData.get("remind_emails") ?? ""),
    },
    session.userId,
  );
  if (!res.ok) redirect(`${ADMIN}?error=${encodeURIComponent(res.error ?? "Save failed.")}#sunday`);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "newsletter.cadence_save",
    entityType: "site_settings",
    entityId: "newsletter_cadence",
    after: res.settings as unknown as Record<string, unknown>,
  });
  revalidatePath(ADMIN);
  redirect(`${ADMIN}?notice=${encodeURIComponent("Sunday settings saved.")}#sunday`);
}
