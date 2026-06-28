"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { sendNewsletter } from "@/lib/cms/newsletter-send-store";

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
  const session = await requirePermission("blog.manage");
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
    after: { recipientCount: res.recipientCount, delivered: res.delivered, failed: res.failed, status: res.status },
  });

  revalidatePath(ADMIN);
  redirect(
    `${ADMIN}?selected=${newsletterId}&sent=${res.delivered}&failed=${res.failed}`,
  );
}
