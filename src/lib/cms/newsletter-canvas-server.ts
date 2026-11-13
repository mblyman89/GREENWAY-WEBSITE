/**
 * src/lib/cms/newsletter-canvas-server.ts
 *
 * D238 N-8a (SOP-22 G-118, F-22-8): storage, the send-readiness check with
 * real image weights, image compression with sharp, QR images and the
 * send-side render for the in-app newsletter canvas.
 *
 * The canvas lives in site_settings under `newsletter_canvas:<postId>`
 * (KEEP table, no migration). When a newsletter has a canvas with
 * "Send this canvas as the email" on, every send (test, broadcast, the
 * queued worker and the Sunday approval) uses the canvas HTML plus its
 * plain-text part; otherwise the PDF announcement is sent exactly as before.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { greenwayBusiness } from "@/content/business";
import { uploadMedia, publicUrlForKey } from "@/lib/media/store";
import { qrSvg } from "@/lib/printing/qr-core";
import { getThisWeekFeed } from "./this-week-feed-server";
import {
  canvasSettingKey,
  canvasPlainText,
  cardsFromFeed,
  checkCanvas,
  imagesIn,
  isProbeableUrl,
  normalizeCanvas,
  planEmailCompress,
  renderCanvasEmail,
  replaceImageUrl,
  type CanvasCheck,
  type CanvasDoc,
  type FeedPostLink,
  type ImageInfo,
  type RenderOpts,
} from "./newsletter-canvas-core";

const SITE = greenwayBusiness.website.replace(/\/$/, "");
const PROBE_TIMEOUT_MS = 8000;
/** Never download more than this for one image (the check only needs the size). */
const PROBE_MAX_BYTES = 12 * 1024 * 1024;

export type CanvasPostInfo = { id: string; title: string; slug: string; status: string; kind: string };

export async function getCanvasPost(postId: string): Promise<CanvasPostInfo | null> {
  if (!isSupabaseServiceConfigured || !postId) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("blog_posts").select("id,title,slug,status,kind").eq("id", postId).maybeSingle();
  return (data as CanvasPostInfo | null) ?? null;
}

/** The saved canvas, or null when this newsletter has none. */
export async function loadCanvas(postId: string): Promise<CanvasDoc | null> {
  if (!isSupabaseServiceConfigured || !postId) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("site_settings").select("value_json").eq("key", canvasSettingKey(postId)).maybeSingle();
    const v = (data as { value_json: unknown } | null)?.value_json;
    return v ? normalizeCanvas(v) : null;
  } catch {
    return null;
  }
}

export async function saveCanvas(postId: string, raw: unknown, updatedBy: string | null): Promise<{ ok: true; doc: CanvasDoc } | { ok: false; error: string }> {
  const doc = normalizeCanvas(raw);
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("site_settings").upsert(
      {
        key: canvasSettingKey(postId),
        label: "Newsletter canvas (D238 N-8)",
        value_json: doc as unknown as Record<string, unknown>,
        updated_by: updatedBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
    if (error) return { ok: false, error: error.message };
    return { ok: true, doc };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

/** Render options for one newsletter (unsubscribe null = preview / sample link). */
export function renderOptsFor(post: { slug: string } | null, unsubscribeUrl: string | null): RenderOpts {
  return {
    businessName: greenwayBusiness.name,
    address: greenwayBusiness.address?.full ?? "Port Orchard, WA",
    siteUrl: SITE,
    hours: greenwayBusiness.hours.display,
    unsubscribeUrl,
    webUrl: post ? `${SITE}/blog/${post.slug}` : null,
    campaign: post?.slug ?? "newsletter",
  };
}

/**
 * The email for a send, when the newsletter has a canvas switched on.
 * Returns null when the PDF announcement should be used instead.
 */
export async function canvasEmailFor(
  postId: string | null,
): Promise<{ doc: CanvasDoc; post: CanvasPostInfo; render: (unsubscribeUrl: string | null) => { html: string; text: string } } | null> {
  if (!postId) return null;
  const [doc, post] = await Promise.all([loadCanvas(postId), getCanvasPost(postId)]);
  if (!doc || !post || !doc.useForEmail || doc.blocks.length === 0) return null;
  return {
    doc,
    post,
    render: (unsub) => {
      const o = renderOptsFor(post, unsub);
      return { html: renderCanvasEmail(doc, o), text: canvasPlainText(doc, o) };
    },
  };
}

// ── Image probing ─────────────────────────────────────────────────────────

async function fetchCapped(url: string): Promise<{ buf: Buffer | null; mime: string | null; error?: string }> {
  if (!isProbeableUrl(url)) return { buf: null, mime: null, error: "not a public https link" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    if (!res.ok || !res.body) return { buf: null, mime: null, error: `HTTP ${res.status}` };
    const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() || null;
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len > PROBE_MAX_BYTES) {
      ctrl.abort();
      return { buf: null, mime, error: `${Math.round(len / 1048576)} MB is too big to send` };
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > PROBE_MAX_BYTES) {
        ctrl.abort();
        return { buf: null, mime, error: "over 12 MB, too big to send" };
      }
      chunks.push(value);
    }
    return { buf: Buffer.concat(chunks), mime };
  } catch (e) {
    return { buf: null, mime: null, error: e instanceof Error && e.name === "AbortError" ? "timed out" : "could not be loaded" };
  } finally {
    clearTimeout(timer);
  }
}

async function metaOf(buf: Buffer): Promise<{ width: number | null; format: string | null; hasAlpha: boolean }> {
  try {
    const sharp = (await import("sharp")).default;
    const m = await sharp(buf, { animated: true, limitInputPixels: 8192 * 8192 }).metadata();
    return { width: m.width ?? null, format: m.format ?? null, hasAlpha: Boolean(m.hasAlpha) };
  } catch {
    return { width: null, format: null, hasAlpha: false };
  }
}

function mimeOfFormat(format: string | null, fallback: string | null): string | null {
  if (!format) return fallback;
  if (format === "jpeg" || format === "jpg") return "image/jpeg";
  if (format === "svg") return "image/svg+xml";
  if (format === "heif") return "image/avif";
  return `image/${format}`;
}

/** Size, type and width of every image in the canvas (3 at a time). */
export async function probeImages(doc: CanvasDoc): Promise<Map<string, ImageInfo & { hasAlpha?: boolean; buf?: Buffer }>> {
  const urls = [...new Set(imagesIn(doc).map((r) => r.url))].slice(0, 40);
  const out = new Map<string, ImageInfo & { hasAlpha?: boolean; buf?: Buffer }>();
  for (let i = 0; i < urls.length; i += 3) {
    await Promise.all(
      urls.slice(i, i + 3).map(async (url) => {
        const r = await fetchCapped(url);
        if (!r.buf) {
          out.set(url, { bytes: null, mime: r.mime, width: null, error: r.error ?? "could not be loaded" });
          return;
        }
        const m = await metaOf(r.buf);
        out.set(url, { bytes: r.buf.length, mime: mimeOfFormat(m.format, r.mime), width: m.width, hasAlpha: m.hasAlpha, buf: r.buf });
      }),
    );
  }
  return out;
}

/** The full send-readiness check: HTML size, plain text and real image weights. */
export async function runCanvasCheck(doc: CanvasDoc, post: { slug: string } | null): Promise<CanvasCheck> {
  const o = renderOptsFor(post, null);
  const html = renderCanvasEmail(doc, o);
  const text = canvasPlainText(doc, o);
  const probed = await probeImages(doc);
  const plain = new Map<string, ImageInfo>();
  for (const [k, v] of probed) plain.set(k, { bytes: v.bytes, mime: v.mime, width: v.width, error: v.error });
  return checkCanvas(doc, html, text, plain);
}

// ── Compression ───────────────────────────────────────────────────────────

export type CompressOutcome = { doc: CanvasDoc; changed: { from: string; to: string; before: number; after: number }[]; skipped: number; errors: string[] };

/**
 * Re-encode every heavy, too-wide or WebP/AVIF picture for email (JPEG, PNG
 * or GIF with fewer colours), store each result in the media library as a
 * new file and point the canvas at it. The originals are not touched.
 */
export async function compressCanvasImages(doc: CanvasDoc, uploadedBy: string | null): Promise<CompressOutcome> {
  const probed = await probeImages(doc);
  const widthByUrl = new Map<string, number>();
  for (const r of imagesIn(doc)) widthByUrl.set(r.url, Math.max(widthByUrl.get(r.url) ?? 0, r.displayWidth));
  let next = doc;
  const changed: CompressOutcome["changed"] = [];
  const errors: string[] = [];
  let skipped = 0;
  const sharp = (await import("sharp")).default;
  for (const [url, info] of probed) {
    if (!info.buf || info.bytes == null) {
      skipped++;
      continue;
    }
    const plan = planEmailCompress({ mime: info.mime, bytes: info.bytes, width: info.width, displayWidth: widthByUrl.get(url) ?? 600, hasAlpha: info.hasAlpha });
    if (plan.action === "skip") {
      skipped++;
      continue;
    }
    try {
      let out: Buffer;
      let mime: string;
      let ext: string;
      if (plan.format === "gif") {
        out = await sharp(info.buf, { animated: true, limitInputPixels: 8192 * 8192 })
          .resize({ width: plan.maxWidth, withoutEnlargement: true })
          .gif({ colours: plan.colours, effort: 7, dither: 0.6, reuse: false })
          .toBuffer();
        mime = "image/gif";
        ext = "gif";
      } else if (plan.format === "png") {
        out = await sharp(info.buf, { limitInputPixels: 8192 * 8192 })
          .rotate()
          .resize({ width: plan.maxWidth, withoutEnlargement: true })
          .png({ palette: true, quality: plan.quality, compressionLevel: 9, effort: 8 })
          .toBuffer();
        mime = "image/png";
        ext = "png";
      } else {
        out = await sharp(info.buf, { limitInputPixels: 8192 * 8192 })
          .rotate()
          .resize({ width: plan.maxWidth, withoutEnlargement: true })
          .flatten({ background: "#ffffff" })
          .jpeg({ quality: plan.quality, mozjpeg: true, progressive: true })
          .toBuffer();
        mime = "image/jpeg";
        ext = "jpg";
      }
      const badFormat = info.mime === "image/webp" || info.mime === "image/avif";
      if (out.length >= info.bytes && !badFormat) {
        skipped++;
        continue;
      }
      const base = (url.split("/").pop() ?? "image").replace(/\.[a-z0-9]+(\?.*)?$/i, "").replace(/[^a-z0-9_-]/gi, "-").slice(0, 60) || "image";
      const asset = await uploadMedia({
        buffer: out,
        filename: `${base}-email.${ext}`,
        mimeType: mime,
        usageType: "newsletter",
        tags: ["newsletter", "email-compressed"],
        title: `${base} (email size)`,
        uploadedBy,
        status: "published",
        optimize: false,
      });
      const to = publicUrlForKey(asset.storage_key) ?? asset.public_url;
      if (!to) {
        errors.push(`${base}: stored but no public link`);
        continue;
      }
      next = replaceImageUrl(next, url, to);
      changed.push({ from: url, to, before: info.bytes, after: out.length });
    } catch (e) {
      errors.push(e instanceof Error ? e.message.slice(0, 160) : "compress failed");
    }
  }
  return { doc: next, changed, skipped, errors };
}

// ── QR images ─────────────────────────────────────────────────────────────

/** A QR PNG for a link (email clients do not show SVG), stored in the media library. */
export async function makeQrImage(url: string, uploadedBy: string | null): Promise<{ ok: true; src: string } | { ok: false; error: string }> {
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: "Enter a full link that starts with https://" };
  const q = qrSvg(url, { level: "Q", scale: 12, quietModules: 4 });
  if (!q.ok) return { ok: false, error: q.error ?? "That link is too long for a QR code. Use a shorter link." };
  try {
    const sharp = (await import("sharp")).default;
    const png = await sharp(Buffer.from(q.svg)).resize(600, 600, { kernel: "nearest" }).png({ palette: true, colours: 2, compressionLevel: 9 }).toBuffer();
    const asset = await uploadMedia({
      buffer: png,
      filename: `qr-${url.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").slice(0, 50)}.png`,
      mimeType: "image/png",
      usageType: "newsletter",
      tags: ["newsletter", "qr"],
      title: `QR code: ${url.slice(0, 120)}`,
      altText: "QR code",
      uploadedBy,
      status: "published",
      optimize: false,
    });
    const src = publicUrlForKey(asset.storage_key) ?? asset.public_url;
    return src ? { ok: true, src } : { ok: false, error: "The QR image was stored but has no public link." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not make the QR image." };
  }
}

// ── Fill from this week ───────────────────────────────────────────────────

/** Recent published posts (for From the blog and the Culture pick). */
export async function recentPostLinks(excludeId: string | null): Promise<FeedPostLink[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("blog_posts")
    .select("id,title,slug,excerpt,category,kind,hero_media_id")
    .eq("status", "published")
    .eq("kind", "article")
    .order("publish_date", { ascending: false, nullsFirst: false })
    .range(0, 11);
  const rows = ((data as { id: string; title: string; slug: string; excerpt: string | null; category: string; hero_media_id: string | null }[] | null) ?? []).filter((r) => r.id !== excludeId);
  const ids = rows.map((r) => r.hero_media_id).filter((x): x is string => Boolean(x));
  const keyById = new Map<string, string>();
  if (ids.length) {
    const { data: media } = await admin.from("media_assets").select("id,storage_key").in("id", ids);
    for (const m of (media as { id: string; storage_key: string }[] | null) ?? []) keyById.set(m.id, m.storage_key);
  }
  return rows.map((r) => ({
    title: r.title,
    slug: r.slug,
    excerpt: r.excerpt ?? "",
    category: String(r.category ?? "").toUpperCase(),
    imageUrl: r.hero_media_id && keyById.has(r.hero_media_id) ? publicUrlForKey(keyById.get(r.hero_media_id)!) ?? "" : "",
  }));
}

/** Fill every empty card section from this week's feed and posts (no AI). */
export async function fillCanvasFromWeek(doc: CanvasDoc, postId: string | null): Promise<{ doc: CanvasDoc; filled: number; partial: boolean }> {
  const [{ feed, partial }, posts] = await Promise.all([getThisWeekFeed({ withBelowCost: true }), recentPostLinks(postId)]);
  let filled = 0;
  const blocks = doc.blocks.map((b) => {
    if (b.type !== "cards" || b.cards.length > 0 || b.kind === "custom") return b;
    const cards = cardsFromFeed(b.kind, feed, posts, SITE);
    if (cards.length) filled++;
    return { ...b, cards };
  });
  return { doc: normalizeCanvas({ ...doc, blocks }), filled, partial };
}

// ── Test send (works on drafts) ───────────────────────────────────────────

/**
 * Send the canvas to ONE address as a test (drafts too, so it can be checked
 * in a real inbox before publishing). Recorded as a 'test' send. The same
 * must-fix checks as a broadcast apply.
 */
export async function sendCanvasTest(params: {
  postId: string;
  doc: CanvasDoc;
  to: string;
  actorId: string | null;
  actorEmail: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { newsletterSendConfig, resendApiKey } = await import("./newsletter-send-store");
  const cfg = newsletterSendConfig();
  const apiKey = resendApiKey();
  if (!cfg.configured || !cfg.from || !apiKey) return { ok: false, error: "Email sending is not configured yet. Add RESEND_API_KEY and NEWSLETTER_FROM_EMAIL." };
  const post = await getCanvasPost(params.postId);
  if (!post) return { ok: false, error: "Newsletter not found." };
  const o = renderOptsFor(post, null);
  const html = renderCanvasEmail(params.doc, o);
  const text = canvasPlainText(params.doc, o);
  const check = checkCanvas(params.doc, html, text);
  const blocking = check.issues.filter((i) => i.level === "must-fix");
  if (blocking.length) return { ok: false, error: `Fix these first: ${blocking.map((b) => b.text).join(" ")}` };
  const subject = `[TEST] ${params.doc.subject || post.title}`;
  let ok = false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: cfg.from, to: [params.to], subject, html, text }),
    });
    ok = res.ok;
  } catch {
    ok = false;
  }
  try {
    const admin = createSupabaseAdminClient();
    await admin.from("newsletter_sends").insert({
      post_id: post.id,
      subject,
      pdf_url: null,
      send_kind: "test",
      status: ok ? "sent" : "failed",
      recipient_count: 1,
      delivered_count: ok ? 1 : 0,
      failed_count: ok ? 0 : 1,
      sent_by: params.actorId,
      sent_by_email: params.actorEmail,
      completed_at: new Date().toISOString(),
    });
  } catch {
    // history is best-effort for tests
  }
  return ok ? { ok: true } : { ok: false, error: "The email service did not accept the test. Check the Resend settings." };
}
