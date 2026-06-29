/**
 * src/lib/cms/newsletter-send-store.ts
 *
 * Slice 7 — Newsletter Send Center (the approved HYBRID model).
 *
 * Workflow: staff design the newsletter in Canva → upload the PDF via the
 * existing blog/newsletter editor (kind = 'newsletter') → come here to email a
 * BRANDED announcement to the loyalty list via Resend. We don't render the PDF
 * inside the email (clients strip it); we send a tasteful branded HTML email
 * with a big "Read the newsletter" button linking to the public newsletter page
 * (which opens the PDF) plus a direct PDF link.
 *
 * Recipients = loyalty_signups with a valid email + consent = true, excluding
 * archived/duplicate rows. Every send is recorded in newsletter_sends (0016) so
 * we can show history + warn about re-sends. Resend calls are batched and any
 * per-recipient failure is counted, not fatal.
 *
 * All env-gated: if RESEND_API_KEY / from address are missing, send() returns a
 * clear "not configured" result instead of throwing.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured, supabaseUrl } from "@/lib/supabase/env";
import { greenwayBusiness } from "@/content/business";
import type { BlogPostRow } from "./types";

const MEDIA_BUCKET = "media";
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const SITE_URL = greenwayBusiness.website.replace(/\/$/, "");

// ---------------------------------------------------------------------------
// Config / env
// ---------------------------------------------------------------------------

export type SendConfig = {
  configured: boolean;
  from: string | null;
};

export function newsletterSendConfig(): SendConfig {
  const apiKey = process.env.RESEND_API_KEY ?? "";
  const from =
    process.env.NEWSLETTER_FROM_EMAIL ??
    process.env.ORDER_EMAIL_FROM ??
    null;
  return { configured: Boolean(apiKey && from), from };
}

// ---------------------------------------------------------------------------
// Sendable newsletters
// ---------------------------------------------------------------------------

export type SendableNewsletter = {
  id: string;
  title: string;
  slug: string;
  status: string;
  publishDate: string | null;
  pdfUrl: string | null;
  publicUrl: string;
  lastSentAt: string | null;
};

function publicMediaUrl(key: string): string | null {
  if (!key || !supabaseUrl) return null;
  return `${supabaseUrl}/storage/v1/object/public/${MEDIA_BUCKET}/${key}`;
}

/** List published newsletters that can be sent (have a PDF). */
export async function listSendableNewsletters(): Promise<SendableNewsletter[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();

  const { data: posts } = await admin
    .from("blog_posts")
    .select("*")
    .eq("kind", "newsletter")
    .order("publish_date", { ascending: false, nullsFirst: false });

  const rows = (posts as BlogPostRow[] | null) ?? [];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);

  // Resolve PDF urls (newsletter_assets) and last-send timestamps in bulk.
  const [{ data: assets }, { data: sends }] = await Promise.all([
    admin.from("newsletter_assets").select("post_id, pdf_media_id, pdf_path").in("post_id", ids),
    admin
      .from("newsletter_sends")
      .select("post_id, completed_at, created_at, send_kind")
      .in("post_id", ids)
      .eq("send_kind", "broadcast")
      .order("created_at", { ascending: false }),
  ]);

  const assetByPost = new Map<string, { pdf_media_id: string | null; pdf_path: string | null }>();
  for (const a of (assets as { post_id: string; pdf_media_id: string | null; pdf_path: string | null }[] | null) ?? []) {
    assetByPost.set(a.post_id, { pdf_media_id: a.pdf_media_id, pdf_path: a.pdf_path });
  }

  const lastSendByPost = new Map<string, string>();
  for (const s of (sends as { post_id: string; completed_at: string | null; created_at: string }[] | null) ?? []) {
    if (!lastSendByPost.has(s.post_id)) {
      lastSendByPost.set(s.post_id, s.completed_at ?? s.created_at);
    }
  }

  // Resolve media-id-backed PDFs to public urls.
  const mediaIds = Array.from(assetByPost.values())
    .map((a) => a.pdf_media_id)
    .filter((x): x is string => Boolean(x));
  const keyById = new Map<string, string>();
  if (mediaIds.length > 0) {
    const { data: media } = await admin.from("media_assets").select("id, storage_key").in("id", mediaIds);
    for (const m of (media as { id: string; storage_key: string }[] | null) ?? []) {
      keyById.set(m.id, m.storage_key);
    }
  }

  return rows.map((r) => {
    const asset = assetByPost.get(r.id);
    let pdfUrl: string | null = null;
    if (asset?.pdf_media_id && keyById.has(asset.pdf_media_id)) {
      pdfUrl = publicMediaUrl(keyById.get(asset.pdf_media_id)!);
    } else if (asset?.pdf_path) {
      pdfUrl = asset.pdf_path.startsWith("http") ? asset.pdf_path : `${SITE_URL}${asset.pdf_path}`;
    }
    return {
      id: r.id,
      title: r.title,
      slug: r.slug,
      status: r.status,
      publishDate: r.publish_date,
      pdfUrl,
      publicUrl: `${SITE_URL}/blog/${r.slug}`,
      lastSentAt: lastSendByPost.get(r.id) ?? null,
    };
  });
}

export async function getSendableNewsletter(id: string): Promise<SendableNewsletter | null> {
  const all = await listSendableNewsletters();
  return all.find((n) => n.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Recipients
// ---------------------------------------------------------------------------

export type RecipientStats = { total: number; sample: string[] };
export type Recipient = { email: string; token: string | null };

/**
 * Loyalty members eligible for marketing email: have a valid email + consent,
 * status new/entered, AND have NOT opted out (email_opt_out = false). Each
 * recipient carries their unsubscribe token so we can put a unique one-click
 * unsubscribe link in their copy (CAN-SPAM). De-duplicated by email.
 */
export async function getNewsletterRecipients(): Promise<Recipient[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("loyalty_signups")
    .select("email, consent, status, email_opt_out, unsubscribe_token")
    .eq("consent", true)
    .eq("email_opt_out", false)
    .in("status", ["new", "entered"]);

  const byEmail = new Map<string, Recipient>();
  for (const r of (data as { email: string | null; unsubscribe_token: string | null }[] | null) ?? []) {
    const email = (r.email ?? "").trim().toLowerCase();
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !byEmail.has(email)) {
      byEmail.set(email, { email, token: r.unsubscribe_token });
    }
  }
  return Array.from(byEmail.values());
}

export async function getRecipientStats(): Promise<RecipientStats> {
  const recipients = await getNewsletterRecipients();
  return { total: recipients.length, sample: recipients.slice(0, 5).map((r) => r.email) };
}

// ---------------------------------------------------------------------------
// Branded email
// ---------------------------------------------------------------------------

export function unsubscribeUrl(token: string | null): string | null {
  if (!token) return null;
  return `${SITE_URL}/unsubscribe?token=${encodeURIComponent(token)}`;
}

export function buildNewsletterEmail(n: {
  title: string;
  publicUrl: string;
  pdfUrl: string | null;
  unsubscribeUrl?: string | null;
}): {
  subject: string;
  html: string;
} {
  const subject = `${greenwayBusiness.name}: ${n.title}`;
  const readUrl = n.publicUrl;
  const pdfBtn = n.pdfUrl
    ? `<p style="margin:8px 0 0"><a href="${n.pdfUrl}" style="color:#7ed957;font-size:13px">Or open the PDF directly ↗</a></p>`
    : "";
  const unsubLine = n.unsubscribeUrl
    ? `<br/><a href="${n.unsubscribeUrl}" style="color:#8a8a8a;text-decoration:underline">Unsubscribe from these emails</a>`
    : "";

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#000000;font-family:Arial,Helvetica,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#000000">
      <tr><td align="center" style="padding:28px 16px">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#0f0f0f;border:1px solid #1f1f1f;border-radius:16px;overflow:hidden">
          <tr><td style="padding:28px 28px 8px;text-align:center">
            <h1 style="margin:0;font-size:22px;color:#7ed957;letter-spacing:0.5px">${greenwayBusiness.name}</h1>
            <p style="margin:6px 0 0;color:#ffd700;font-size:12px;text-transform:uppercase;letter-spacing:2px">Newsletter</p>
          </td></tr>
          <tr><td style="padding:8px 28px 0;text-align:center">
            <h2 style="margin:18px 0 6px;color:#ffffff;font-size:24px;line-height:1.25">${n.title}</h2>
            <p style="margin:0;color:#b8b8b8;font-size:14px;line-height:1.6">Your latest update from the Greenway team is ready to read.</p>
          </td></tr>
          <tr><td align="center" style="padding:24px 28px 8px">
            <a href="${readUrl}" style="display:inline-block;background:#7ed957;color:#000000;font-weight:bold;font-size:15px;text-decoration:none;padding:14px 28px;border-radius:999px">Read the newsletter →</a>
            ${pdfBtn}
          </td></tr>
          <tr><td style="padding:24px 28px 28px;border-top:1px solid #1f1f1f;margin-top:16px">
            <p style="margin:16px 0 0;color:#6f6f6f;font-size:11px;line-height:1.6;text-align:center">
              ${greenwayBusiness.name} &middot; ${greenwayBusiness.address?.full ?? "Port Orchard, WA"}<br/>
              You're receiving this because you joined the Greenway loyalty program.
              For adults 21+. Keep out of reach of children.
              ${unsubLine}
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject, html };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export type SendResult =
  | { ok: true; sendId: string; recipientCount: number; delivered: number; failed: number; status: string }
  | { ok: false; error: string };

async function resendBatch(apiKey: string, from: string, to: string[], subject: string, html: string): Promise<boolean> {
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      // Resend: a single email with multiple "to" is one send; for marketing we
      // BCC nothing and put recipients in `to`. To protect privacy we send one
      // request per recipient batch via the `to` array is visible to all — so we
      // instead loop in small chunks using individual sends would be N calls.
      // Here we use one-recipient-per-call to keep addresses private.
      body: JSON.stringify({ from, to, subject, html }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Send a newsletter. When testEmail is provided, sends ONLY to that address and
 * records a 'test' send. Otherwise sends to the full loyalty list (privacy-safe:
 * one message per recipient) and records a 'broadcast' send.
 */
export async function sendNewsletter(params: {
  newsletterId: string;
  testEmail?: string | null;
  actorId: string | null;
  actorEmail: string | null;
}): Promise<SendResult> {
  const cfg = newsletterSendConfig();
  if (!cfg.configured || !cfg.from) {
    return { ok: false, error: "Email sending is not configured yet. Add RESEND_API_KEY and NEWSLETTER_FROM_EMAIL." };
  }
  const apiKey = process.env.RESEND_API_KEY!;

  const n = await getSendableNewsletter(params.newsletterId);
  if (!n) return { ok: false, error: "Newsletter not found." };
  if (n.status !== "published") {
    return { ok: false, error: "Publish the newsletter before sending it." };
  }

  const isTest = Boolean(params.testEmail);
  const recipients: Recipient[] = isTest
    ? [{ email: String(params.testEmail).trim().toLowerCase(), token: null }]
    : await getNewsletterRecipients();

  if (recipients.length === 0) {
    return { ok: false, error: isTest ? "Enter a valid test email." : "No loyalty members with email + consent yet." };
  }

  // Subject is constant; the HTML body varies per recipient (unique unsubscribe
  // link). We build the subject once and the body inside the send loop.
  const { subject } = buildNewsletterEmail(n);
  const admin = createSupabaseAdminClient();

  // Open a send record.
  const { data: created, error: insErr } = await admin
    .from("newsletter_sends")
    .insert({
      post_id: n.id,
      subject,
      pdf_url: n.pdfUrl,
      send_kind: isTest ? "test" : "broadcast",
      status: "queued",
      recipient_count: recipients.length,
      sent_by: params.actorId,
      sent_by_email: params.actorEmail,
    })
    .select("id")
    .single();
  if (insErr || !created) {
    return { ok: false, error: `Could not start send: ${insErr?.message ?? "unknown"}` };
  }
  const sendId = (created as { id: string }).id;

  // Send one message per recipient (keeps addresses private) with light
  // concurrency to avoid hammering the API.
  let delivered = 0;
  let failed = 0;
  const CONCURRENCY = 5;
  for (let i = 0; i < recipients.length; i += CONCURRENCY) {
    const chunk = recipients.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map((r) => {
        // Each recipient gets their own copy with a unique unsubscribe link.
        const { html } = buildNewsletterEmail({
          title: n.title,
          publicUrl: n.publicUrl,
          pdfUrl: n.pdfUrl,
          unsubscribeUrl: unsubscribeUrl(r.token),
        });
        return resendBatch(apiKey, cfg.from!, [r.email], subject, html);
      }),
    );
    for (const ok of results) {
      if (ok) delivered += 1;
      else failed += 1;
    }
  }

  const status = failed === 0 ? "sent" : delivered === 0 ? "failed" : "partial";
  await admin
    .from("newsletter_sends")
    .update({
      status,
      delivered_count: delivered,
      failed_count: failed,
      error_summary: failed > 0 ? `${failed} recipient(s) failed to send.` : null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", sendId);

  return { ok: true, sendId, recipientCount: recipients.length, delivered, failed, status };
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export type SendHistoryRow = {
  id: string;
  subject: string;
  send_kind: string;
  status: string;
  recipient_count: number;
  delivered_count: number;
  failed_count: number;
  sent_by_email: string | null;
  created_at: string;
  completed_at: string | null;
};

export async function listSendHistory(limit = 25): Promise<SendHistoryRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("newsletter_sends")
    .select("id, subject, send_kind, status, recipient_count, delivered_count, failed_count, sent_by_email, created_at, completed_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as SendHistoryRow[] | null) ?? [];
}
