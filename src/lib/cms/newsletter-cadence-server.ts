/**
 * D237 N-3 (SOP-22 G-113, F-22-9): the Sunday newsletter cadence, server side.
 *
 *   - settings: one site_settings JSON row (key newsletter_cadence), the same
 *     no-migration pattern as the ATM-drop settings. The Sunday send time is
 *     a setting because the owner has not named it (Q-22-4).
 *   - approvals: public.newsletter_approvals (migration 0363), one row per
 *     newsletter post: ready -> approved (with send_at) -> sending -> sent.
 *   - the tick (called by the 5-minute content-schedule cron): sends every
 *     approved newsletter whose time has come through the SAME sendNewsletter
 *     the Send button uses (so the N-1 warnings, unsubscribe and the N-2 queue
 *     all apply), then the reminder on the reminder day if nothing is ready.
 *
 * Every read degrades quietly before 0363 is applied. Never throws.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { revalidatePath } from "next/cache";
import { recordAudit } from "@/lib/auth/audit";
import { setPostStatus } from "./blog-store";
import { sendNewsletter, newsletterSendConfig, resendApiKey } from "./newsletter-send-store";
import {
  DEFAULT_CADENCE,
  NEWSLETTER_CADENCE_KEY,
  REMINDER_SUBJECT,
  isSendDue,
  normalizeCadence,
  reminderDue,
  reminderText,
  type ApprovalState,
  type CadenceSettings,
} from "./newsletter-cadence-core";

export const CADENCE_MIGRATION_HINT =
  "The Sunday approval steps need database migration 0363 (supabase/migrations/0363_newsletter_approvals_blog_schedule.sql). Run it in the Supabase SQL editor, then reload.";

export type ApprovalRow = {
  post_id: string;
  state: ApprovalState;
  send_at: string | null;
  ready_by: string | null;
  ready_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  send_id: string | null;
  error: string | null;
  updated_at: string;
};

const COLS = "post_id,state,send_at,ready_by,ready_at,approved_by,approved_at,send_id,error,updated_at";

type DbError = { code?: string | null; message?: string | null } | null | undefined;

export function isMissingApprovals(error: DbError): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const msg = String(error.message ?? "").toLowerCase();
  return (code === "42P01" || code === "PGRST205" || /does not exist|could not find the table/.test(msg)) && msg.includes("newsletter_approvals");
}

// ── Settings ────────────────────────────────────────────────────────────────

export async function getCadence(): Promise<CadenceSettings> {
  if (!isSupabaseServiceConfigured) return { ...DEFAULT_CADENCE };
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("site_settings").select("value_json").eq("key", NEWSLETTER_CADENCE_KEY).maybeSingle();
    if (!data || data.value_json == null) return { ...DEFAULT_CADENCE };
    return normalizeCadence(data.value_json);
  } catch {
    return { ...DEFAULT_CADENCE };
  }
}

export async function saveCadence(raw: unknown, updatedBy: string | null): Promise<{ ok: boolean; error?: string; settings: CadenceSettings }> {
  const settings = normalizeCadence(raw);
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured.", settings };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("site_settings").upsert(
      {
        key: NEWSLETTER_CADENCE_KEY,
        label: "Sunday newsletter: send time and reminder (D237 N-3)",
        value_json: settings as unknown as Record<string, unknown>,
        updated_by: updatedBy,
      },
      { onConflict: "key" },
    );
    if (error) return { ok: false, error: error.message, settings };
    return { ok: true, settings };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed.", settings };
  }
}

// ── Approvals ───────────────────────────────────────────────────────────────

export async function listApprovals(): Promise<{ ready: boolean; byPost: Record<string, ApprovalRow> }> {
  if (!isSupabaseServiceConfigured) return { ready: false, byPost: {} };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("newsletter_approvals").select(COLS).order("updated_at", { ascending: false }).limit(200);
  if (error) return { ready: !isMissingApprovals(error), byPost: {} };
  const byPost: Record<string, ApprovalRow> = {};
  for (const r of (data as ApprovalRow[] | null) ?? []) byPost[r.post_id] = r;
  return { ready: true, byPost };
}

function errText(error: DbError): string {
  return isMissingApprovals(error) ? CADENCE_MIGRATION_HINT : String(error?.message ?? "Save failed.");
}

/** Anyone with Blog access: "this week's newsletter is ready for the owner to approve". */
export async function markReady(postId: string, actorId: string | null): Promise<{ error?: string }> {
  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const { error } = await admin.from("newsletter_approvals").upsert(
    { post_id: postId, state: "ready", send_at: null, ready_by: actorId, ready_at: now, approved_by: null, approved_at: null, send_id: null, error: null, updated_at: now },
    { onConflict: "post_id" },
  );
  return error ? { error: errText(error) } : {};
}

/** Owner / admin: approve with the send time (UTC ISO, already validated). */
export async function approve(postId: string, sendAtIso: string, actorId: string | null): Promise<{ error?: string }> {
  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("newsletter_approvals")
    .update({ state: "approved", send_at: sendAtIso, approved_by: actorId, approved_at: now, error: null, updated_at: now })
    .eq("post_id", postId)
    .in("state", ["ready", "approved"])
    .select("post_id");
  if (error) return { error: errText(error) };
  if (!data || (data as unknown[]).length === 0) return { error: "Mark it ready for approval first." };
  return {};
}

/** Take an approval (or the ready mark) back: the newsletter returns to draft. */
export async function backToDraft(postId: string): Promise<{ error?: string }> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("newsletter_approvals").delete().eq("post_id", postId).in("state", ["ready", "approved"]);
  return error ? { error: errText(error) } : {};
}

/**
 * Editing an approved newsletter takes the approval back (a person approves
 * exactly what goes out). Returns true when an approval was voided.
 */
export async function voidApprovalOnEdit(postId: string): Promise<boolean> {
  if (!isSupabaseServiceConfigured) return false;
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("newsletter_approvals")
      .update({ state: "ready", send_at: null, approved_by: null, approved_at: null, updated_at: new Date().toISOString() })
      .eq("post_id", postId)
      .eq("state", "approved")
      .select("post_id");
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

// ── The tick (5-minute content-schedule cron) ───────────────────────────────

export type CadenceTickResult = { ok: boolean; sent: number; failed: number; reminded: boolean; skipped?: string; error?: string };

async function sendReminder(c: CadenceSettings, key: string): Promise<boolean> {
  const cfg = newsletterSendConfig();
  const apiKey = resendApiKey();
  const to = c.remindEmails.length > 0
    ? c.remindEmails
    : (process.env.ORDER_STAFF_EMAILS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!cfg.from || !apiKey || to.length === 0) return false;
  const admin = createSupabaseAdminClient();
  // Claim first (UNIQUE dedupe_key): at most one reminder a day.
  const { error: claimErr } = await admin.from("compliance_reminder_log").insert({
    dedupe_key: key,
    stage: "newsletter_reminder",
    week_key: null,
    channel: "email",
    subject: REMINDER_SUBJECT,
    recipients: to.join(", ").slice(0, 1000),
  });
  if (claimErr) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: cfg.from, to, subject: REMINDER_SUBJECT, text: reminderText(c) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function runNewsletterCadenceTick(nowIso = new Date().toISOString()): Promise<CadenceTickResult> {
  const base: CadenceTickResult = { ok: true, sent: 0, failed: 0, reminded: false };
  if (!isSupabaseServiceConfigured) return { ...base, skipped: "no_supabase" };
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("newsletter_approvals")
      .select(COLS)
      .in("state", ["ready", "approved", "sending"])
      .limit(50);
    if (error) {
      if (isMissingApprovals(error)) return { ...base, skipped: "no_table" };
      return { ...base, ok: false, error: error.message };
    }
    const open = (data as ApprovalRow[] | null) ?? [];

    for (const a of open) {
      if (!isSendDue(a, nowIso)) continue;
      // CLAIM: approved -> sending at this exact send_at (a doubled tick loses).
      const { data: claimed } = await admin
        .from("newsletter_approvals")
        .update({ state: "sending", updated_at: nowIso })
        .eq("post_id", a.post_id)
        .eq("state", "approved")
        .eq("send_at", a.send_at as string)
        .select("post_id");
      if (!claimed || (claimed as unknown[]).length === 0) continue;

      // Approval covers the post too: an approved newsletter that is not live
      // on /blog yet goes live first, so the email's button opens it.
      const { data: post } = await admin.from("blog_posts").select("status,slug").eq("id", a.post_id).maybeSingle();
      const p = post as { status: string; slug: string } | null;
      if (p && p.status !== "published") {
        try {
          await setPostStatus(a.post_id, "published", a.approved_by);
          revalidatePath("/blog");
          revalidatePath(`/blog/${p.slug}`);
        } catch {
          // sendNewsletter below reports "Publish the newsletter before sending it."
        }
      }

      const res = await sendNewsletter({ newsletterId: a.post_id, testEmail: null, actorId: a.approved_by, actorEmail: null });
      if (res.ok) {
        await admin
          .from("newsletter_approvals")
          .update({ state: "sent", send_id: res.sendId, error: null, updated_at: new Date().toISOString() })
          .eq("post_id", a.post_id);
        base.sent++;
        await recordAudit({
          actorId: a.approved_by,
          action: "newsletter.scheduled_send",
          entityType: "newsletter",
          entityId: a.post_id,
          after: { send_at: a.send_at, sendId: res.sendId, recipientCount: res.recipientCount, status: res.status, queued: res.queued === true },
        });
      } else {
        // Back to "ready": it needs a person again (never retried blindly).
        await admin
          .from("newsletter_approvals")
          .update({ state: "ready", send_at: null, approved_by: null, approved_at: null, error: res.error.slice(0, 500), updated_at: new Date().toISOString() })
          .eq("post_id", a.post_id);
        base.failed++;
        await recordAudit({
          actorId: a.approved_by,
          action: "newsletter.scheduled_send_failed",
          entityType: "newsletter",
          entityId: a.post_id,
          after: { send_at: a.send_at, error: res.error.slice(0, 500) },
        });
      }
    }

    const c = await getCadence();
    const covered = open.some((a) => a.state === "ready" || a.state === "approved" || a.state === "sending");
    const r = reminderDue(c, nowIso, covered);
    if (r.due) base.reminded = await sendReminder(c, r.key);
    return base;
  } catch (e) {
    return { ...base, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
