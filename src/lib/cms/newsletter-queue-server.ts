/**
 * src/lib/cms/newsletter-queue-server.ts  (D237, SOP-22 N-2, G-112)
 *
 * The worker behind a newsletter broadcast. Pressing "Send to everyone"
 * writes one newsletter_send_recipients row per address (0362) and returns;
 * this worker sends them 100 at a time through Resend's batch endpoint.
 *
 * Who runs it:
 *   - right after the button, in the background (next/server `after`);
 *   - every 5 minutes, riding the existing /api/cron/content-schedule tick
 *     (no new cron), so a send that was cut off resumes by itself.
 *
 * Never a double send:
 *   - one worker per send at a time: a compare-and-set lease on
 *     newsletter_sends.claimed_at (LEASE_MS; a dead worker's lease expires);
 *   - every batch call carries an Idempotency-Key from (send, batch, round),
 *     so if a call reached Resend but the answer was lost, the repeat is
 *     answered from Resend's record instead of sending again (24 hours);
 *   - a row is only ever sent from status pending.
 * The rules are in newsletter-batch-core.ts (pure, self-tested).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { SEND_ID_TAG, POST_ID_TAG } from "@/lib/cms/email-events/normalize-core";
import {
  BATCH_PAUSE_MS,
  BATCH_SIZE,
  LEASE_MS,
  WORKER_BUDGET_MS,
  afterRetry,
  idempotencyKey,
  interpretBatchResponse,
  isMissingRecipientsTable,
  progressPercent,
  sendStatusFrom,
} from "./newsletter-batch-core";
import { listUnsubscribeHeaders, oneClickUnsubscribeUrl } from "./newsletter-email-core";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { buildNewsletterEmail, newsletterSendConfig, resendApiKey, siteUrl, unsubscribeUrl } from "./newsletter-send-store";

const RESEND_BATCH_ENDPOINT = "https://api.resend.com/emails/batch";

export type SendCounts = { pending: number; sent: number; failed: number };
export type SendProgress = SendCounts & { sendId: string; subject: string; status: string; percent: number; createdAt: string };

type RecipientRow = {
  id: string;
  email: string;
  unsubscribe_token: string | null;
  batch_no: number;
  round: number;
  tries: number;
};

type SendRow = {
  id: string;
  post_id: string | null;
  subject: string;
  pdf_url: string | null;
  status: string;
  claimed_at: string | null;
  created_at: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function countsFor(sendId: string): Promise<SendCounts> {
  const admin = createSupabaseAdminClient();
  const one = async (status: string) => {
    const { count } = await admin
      .from("newsletter_send_recipients")
      .select("id", { count: "exact", head: true })
      .eq("send_id", sendId)
      .eq("status", status);
    return count ?? 0;
  };
  const [pending, sent, failed] = await Promise.all([one("pending"), one("sent"), one("failed")]);
  return { pending, sent, failed };
}

/** Write the send's status and counts from its rows. */
async function refreshSend(sendId: string, release: boolean): Promise<SendCounts> {
  const admin = createSupabaseAdminClient();
  const c = await countsFor(sendId);
  const status = sendStatusFrom(c);
  const done = status !== "sending";
  await admin
    .from("newsletter_sends")
    .update({
      status,
      delivered_count: c.sent,
      failed_count: c.failed,
      error_summary: c.failed > 0 ? `${c.failed} recipient(s) failed to send.` : null,
      completed_at: done ? new Date().toISOString() : null,
      ...(release || done ? { claimed_at: null } : {}),
    })
    .eq("id", sendId);
  return c;
}

/** Take the send if nobody holds a live lease. */
async function claim(sendId: string, nowMs: number): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const nowIso = new Date(nowMs).toISOString();
  const staleIso = new Date(nowMs - LEASE_MS).toISOString();
  const { data, error } = await admin
    .from("newsletter_sends")
    .update({ claimed_at: nowIso, status: "sending" })
    .eq("id", sendId)
    .in("status", ["queued", "sending"])
    .or(`claimed_at.is.null,claimed_at.lt.${staleIso}`)
    .select("id");
  return !error && Array.isArray(data) && data.length === 1;
}

async function postBatch(
  apiKey: string,
  key: string,
  emails: Record<string, unknown>[],
): Promise<{ status: number | null; body: unknown }> {
  try {
    const res = await fetch(RESEND_BATCH_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify(emails),
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch {
    return { status: null, body: null };
  }
}

/** Send every pending batch of one send until done or out of time. */
async function workSend(send: SendRow, deadlineMs: number): Promise<{ batches: number; counts: SendCounts }> {
  const admin = createSupabaseAdminClient();
  const cfg = newsletterSendConfig();
  const apiKey = resendApiKey();
  let batches = 0;
  if (!cfg.configured || !cfg.from || !apiKey) {
    // Not configured: leave the rows pending; the Send Center says why.
    return { batches, counts: await refreshSend(send.id, true) };
  }

  // The newsletter's public page for the button.
  let title = send.subject;
  let publicUrl = siteUrl();
  if (send.post_id) {
    const { data: post } = await admin.from("blog_posts").select("title, slug").eq("id", send.post_id).maybeSingle();
    if (post) {
      title = (post as { title: string }).title;
      publicUrl = `${siteUrl()}/blog/${(post as { slug: string }).slug}`;
    }
  }
  const tags = [{ name: SEND_ID_TAG, value: send.id }, ...(send.post_id ? [{ name: POST_ID_TAG, value: send.post_id }] : [])];

  while (Date.now() < deadlineMs) {
    const { data: firstRows } = await admin
      .from("newsletter_send_recipients")
      .select("batch_no, round")
      .eq("send_id", send.id)
      .eq("status", "pending")
      .order("batch_no", { ascending: true })
      .order("round", { ascending: true })
      .limit(1);
    const first = (firstRows as { batch_no: number; round: number }[] | null)?.[0];
    if (!first) break;

    const { data: rowsData } = await admin
      .from("newsletter_send_recipients")
      .select("id, email, unsubscribe_token, batch_no, round, tries")
      .eq("send_id", send.id)
      .eq("status", "pending")
      .eq("batch_no", first.batch_no)
      .eq("round", first.round)
      .order("email", { ascending: true })
      .limit(BATCH_SIZE);
    const rows = (rowsData as RecipientRow[] | null) ?? [];
    if (rows.length === 0) break;

    const emails = rows.map((r) => {
      const { html } = buildNewsletterEmail({
        title,
        publicUrl,
        pdfUrl: send.pdf_url,
        unsubscribeUrl: unsubscribeUrl(r.unsubscribe_token),
      });
      const headers = listUnsubscribeHeaders(oneClickUnsubscribeUrl(siteUrl(), r.unsubscribe_token));
      const e: Record<string, unknown> = { from: cfg.from, to: [r.email], subject: send.subject, html, tags };
      if (Object.keys(headers).length > 0) e.headers = headers;
      return e;
    });

    const key = idempotencyKey(send.id, first.batch_no, first.round);
    const res = await postBatch(apiKey, key, emails);
    const outcome = interpretBatchResponse(res.status, res.body, rows.length);
    const nowIso = new Date().toISOString();
    batches += 1;

    if (outcome.kind === "sent") {
      // Rows in one batch are updated together; ids are written per row.
      await Promise.all(
        rows.map((r, i) =>
          admin
            .from("newsletter_send_recipients")
            .update({ status: "sent", resend_id: outcome.ids[i], sent_at: nowIso, error: null, tries: r.tries + 1, updated_at: nowIso })
            .eq("id", r.id)
            .eq("status", "pending"),
        ),
      );
    } else if (outcome.kind === "retry") {
      const next = afterRetry(rows[0].tries);
      await admin
        .from("newsletter_send_recipients")
        .update({ status: next.status, tries: next.tries, error: outcome.error, updated_at: nowIso })
        .in("id", rows.map((r) => r.id))
        .eq("status", "pending");
      if (next.status === "pending") break; // try again on the next run
    } else {
      await admin
        .from("newsletter_send_recipients")
        .update({ status: "failed", tries: rows[0].tries + 1, error: outcome.error, updated_at: nowIso })
        .in("id", rows.map((r) => r.id))
        .eq("status", "pending");
    }

    // Heartbeat so the lease stays ours while we work.
    await admin.from("newsletter_sends").update({ claimed_at: new Date().toISOString() }).eq("id", send.id);
    await sleep(BATCH_PAUSE_MS);
  }

  return { batches, counts: await refreshSend(send.id, true) };
}

export type QueueRunResult = { ok: boolean; sends: number; batches: number; skipped?: string; error?: string };

/**
 * Work open broadcasts (status queued or sending). With `sendId`, only that
 * one. Never throws.
 */
export async function runNewsletterQueue(opts: { sendId?: string; budgetMs?: number } = {}): Promise<QueueRunResult> {
  const base: QueueRunResult = { ok: true, sends: 0, batches: 0 };
  try {
    if (!isSupabaseServiceConfigured) return { ...base, skipped: "no_supabase" };
    const admin = createSupabaseAdminClient();
    const deadline = Date.now() + (opts.budgetMs ?? WORKER_BUDGET_MS);
    let q = admin
      .from("newsletter_sends")
      .select("id, post_id, subject, pdf_url, status, claimed_at, created_at")
      .eq("send_kind", "broadcast")
      .in("status", ["queued", "sending"])
      .order("created_at", { ascending: true })
      .limit(5);
    if (opts.sendId) q = q.eq("id", opts.sendId);
    const { data, error } = await q;
    if (error) {
      if (/claimed_at/.test(error.message ?? "")) return { ...base, skipped: "no_table" };
      return { ...base, ok: false, error: error.message };
    }
    const open = (data as SendRow[] | null) ?? [];
    if (open.length === 0) return { ...base, skipped: "nothing_open" };

    for (const send of open) {
      if (Date.now() >= deadline) break;
      // Rows exist? (a pre-0362 send has none and was sent inline.)
      const { error: probeErr } = await admin.from("newsletter_send_recipients").select("id").eq("send_id", send.id).limit(1);
      if (probeErr) {
        if (isMissingRecipientsTable(probeErr)) return { ...base, skipped: "no_table" };
        continue;
      }
      if (!(await claim(send.id, Date.now()))) continue;
      const r = await workSend(send, deadline);
      base.sends += 1;
      base.batches += r.batches;
    }
    return base;
  } catch (e) {
    return { ...base, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Progress for the open broadcasts, newest first (the Send Center bar). */
export async function listOpenSendProgress(): Promise<SendProgress[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("newsletter_sends")
    .select("id, subject, status, created_at")
    .eq("send_kind", "broadcast")
    .in("status", ["queued", "sending"])
    .order("created_at", { ascending: false })
    .limit(5);
  if (error || !data) return [];
  const out: SendProgress[] = [];
  for (const s of data as { id: string; subject: string; status: string; created_at: string }[]) {
    const c = await countsFor(s.id).catch(() => ({ pending: 0, sent: 0, failed: 0 }));
    out.push({ ...c, sendId: s.id, subject: s.subject, status: s.status, percent: progressPercent(c), createdAt: s.created_at });
  }
  return out;
}

/**
 * "Retry failed": failed rows of one broadcast go back to pending with
 * round + 1 (a new Idempotency-Key), tries reset. Sent rows are never
 * touched, so nobody gets it twice.
 */
export async function retryFailedRecipients(sendId: string): Promise<{ ok: true; requeued: number } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database is not set up." };
  const admin = createSupabaseAdminClient();
  // Paged (SLICE 5C rule: never one .limit(N>=1000) read; PostgREST caps at 1,000).
  let firstError: { code?: string; message?: string } | null = null;
  const read = await pagedAllChecked<{ id: string; round: number }>(async (from, to) => {
    const { data, error } = await admin
      .from("newsletter_send_recipients")
      .select("id, round")
      .eq("send_id", sendId)
      .eq("status", "failed")
      .order("id", { ascending: true })
      .range(from, to);
    if (error) firstError = firstError ?? error;
    return { ok: !error, rows: (data as { id: string; round: number }[] | null) ?? [] };
  });
  const err = firstError as { code?: string; message?: string } | null;
  if (err) {
    if (isMissingRecipientsTable(err)) return { ok: false, error: "Retry needs migration 0362 to be applied first." };
    return { ok: false, error: err.message ?? "Could not read the failed addresses." };
  }
  const rows = read.rows;
  if (rows.length === 0) return { ok: false, error: "There are no failed addresses on this send." };
  const byRound = new Map<number, string[]>();
  for (const r of rows) byRound.set(r.round, [...(byRound.get(r.round) ?? []), r.id]);
  const nowIso = new Date().toISOString();
  for (const [round, ids] of byRound) {
    for (let i = 0; i < ids.length; i += 500) {
      await admin
        .from("newsletter_send_recipients")
        .update({ status: "pending", round: round + 1, tries: 0, error: null, updated_at: nowIso })
        .in("id", ids.slice(i, i + 500))
        .eq("status", "failed");
    }
  }
  await admin
    .from("newsletter_sends")
    .update({ status: "sending", completed_at: null, claimed_at: null })
    .eq("id", sendId);
  return { ok: true, requeued: rows.length };
}
