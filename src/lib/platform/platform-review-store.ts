/**
 * src/lib/platform/platform-review-store.ts  (slice G-71b, owner message 12)
 *
 * Server side of the platform changes register (platform-changes.ts):
 *   1. Once per Pacific month, email staff the monthly platform review
 *      (standing rule 16): what is open, what is due, the vendor sources.
 *   2. For each open register item with a deadline, email a warning at 30
 *      days, 7 days, 1 day and once when overdue.
 *
 * Runs from the daily platform-health cron (no new cron). Every message is
 * claimed first in compliance_reminder_log (UNIQUE dedupe_key): the row is
 * written before the email, so a second run the same day sends nothing
 * (standing rule 12). Every database call reads its error (standing rule 15).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { sendStaffAlertEmail } from "@/lib/orders/staff-alert-email";
import { publicSiteOrigin } from "@/lib/site/site-domain-core";
import { pacificToday } from "@/lib/reports/timezone";
import {
  PLATFORM_CHANGES,
  PLATFORM_SOURCES,
  deadlineAlertKey,
  deadlineHtml,
  deadlineStage,
  deadlineSubject,
  monthlyReviewKey,
  reviewDigest,
  reviewHtml,
  reviewSubject,
} from "./platform-changes";

const PAGE = "/admin/settings/platform-health";
const STAGE = "platform_review";

export type PlatformReviewOutcome = {
  review: "sent" | "already-sent" | "not-configured" | "skipped" | "failed";
  deadlines: { id: string; stage: string; result: "sent" | "already-sent" | "failed" }[];
  notes: string[];
};

function staffEmails(): string[] {
  return (process.env.ORDER_STAFF_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

type Admin = ReturnType<typeof createSupabaseAdminClient>;

async function claim(admin: Admin, key: string, subject: string, to: string[]): Promise<"claimed" | "taken" | "error"> {
  try {
    const { error } = await admin.from("compliance_reminder_log").insert({
      dedupe_key: key,
      stage: STAGE,
      week_key: null,
      channel: "email",
      subject: subject.slice(0, 300),
      recipients: to.join(", ").slice(0, 1000),
    });
    if (!error) return "claimed";
    return error.code === "23505" ? "taken" : "error";
  } catch {
    return "error";
  }
}

/** Release a claim when the email failed, so tomorrow's run tries again. */
async function release(admin: Admin, key: string, notes: string[]): Promise<void> {
  try {
    const { error } = await admin.from("compliance_reminder_log").delete().eq("dedupe_key", key);
    if (error) notes.push(`could not release ${key} (${error.code ?? "?"}): ${error.message}`);
  } catch (e) {
    notes.push(`could not release ${key}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Send what is due today. Claim failures (other than "already taken") skip the
 * send: without a claim row we cannot promise "once", and the daily health
 * check already reports when the reminder log cannot be reached.
 */
export async function runPlatformReview(today: string = pacificToday()): Promise<PlatformReviewOutcome> {
  const notes: string[] = [];
  const out: PlatformReviewOutcome = { review: "skipped", deadlines: [], notes };
  if (!isSupabaseServiceConfigured) {
    notes.push("supabase not configured");
    return out;
  }
  const to = staffEmails();
  const apiKey = process.env.RESEND_API_KEY ?? "";
  const from = process.env.ORDER_EMAIL_FROM ?? "";
  if (!apiKey || !from || to.length === 0) {
    out.review = "not-configured";
    notes.push("email not configured (RESEND_API_KEY, ORDER_EMAIL_FROM, ORDER_STAFF_EMAILS)");
    return out;
  }
  const admin = createSupabaseAdminClient();
  const pageUrl = `${publicSiteOrigin(process.env)}${PAGE}`;

  async function sendOnce(key: string, subject: string, html: string): Promise<"sent" | "already-sent" | "failed"> {
    const c = await claim(admin, key, subject, to);
    if (c === "taken") return "already-sent";
    if (c === "error") {
      notes.push(`could not claim ${key}; not sending`);
      return "failed";
    }
    const r = await sendStaffAlertEmail({ apiKey, from, to, subject, html });
    if (r.ok) return "sent";
    notes.push(`email failed for ${key}: ${r.detail}`);
    await release(admin, key, notes);
    return "failed";
  }

  const digest = reviewDigest(PLATFORM_CHANGES, today);
  out.review = await sendOnce(monthlyReviewKey(today), reviewSubject(today, digest), reviewHtml(digest, PLATFORM_SOURCES, pageUrl));

  for (const e of PLATFORM_CHANGES) {
    const stage = deadlineStage(e, today);
    if (!stage) continue;
    const result = await sendOnce(deadlineAlertKey(e.id, stage), deadlineSubject(e, stage), deadlineHtml(e, today, pageUrl));
    out.deadlines.push({ id: e.id, stage, result });
  }
  return out;
}
