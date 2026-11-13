/**
 * src/lib/cms/newsletter-motion-server.ts
 *
 * D238 N-8c (SOP-22 G-118): the server side of the moving and interactive
 * canvas pieces.
 *   - buildCanvasGif: joins 2-10 hosted pictures into a slideshow GIF
 *     (sharp), shrinking colours then width until it is under the GIF
 *     heads-up weight, and saves it to Media as a new file.
 *   - countdownGif: draws the live countdown GIF for /api/newsletter/countdown.
 *   - canvasClicksFor: clicks per section and poll votes for one newsletter,
 *     from newsletter_email_events (utm_content = block id).
 *   - webVersionFor: the hosted "view in your browser" copy of a published
 *     canvas newsletter.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { uploadMedia, publicUrlForKey } from "@/lib/media/store";
import { GIF_WARN_BYTES, isProbeableUrl, renderCanvasEmail, type CanvasDoc } from "./newsletter-canvas-core";
import { fetchCapped, loadCanvas, renderOptsFor } from "./newsletter-canvas-server";
import {
  canvasClickReport,
  countdownFrameSeconds,
  countdownSvg,
  gifRetry,
  planGifBuild,
  type ClickEvent,
  type ClickReport,
  type CountdownTheme,
} from "./newsletter-motion-core";
import { greenwayBusiness } from "@/content/business";
import { checkGifFrames, DESIGN_GIF_W } from "./newsletter-polish-core";

const SITE = greenwayBusiness.website.replace(/\/$/, "");

// ── GIF maker ───────────────────────────────────────────────────────────────

export async function buildCanvasGif(p: {
  urls: string[];
  seconds: number;
  shape: string;
  width: number;
  title: string;
  uploadedBy: string | null;
}): Promise<{ ok: true; url: string; mediaId: string; bytes: number; frames: number; width: number } | { ok: false; error: string }> {
  const urls = p.urls.map((u) => String(u)).filter(Boolean);
  const plan = planGifBuild({ frames: urls.length, width: p.width, seconds: p.seconds, shape: p.shape });
  if (!plan.ok) return plan;
  if (urls.some((u) => !isProbeableUrl(u))) return { ok: false, error: "Every picture must be a public https link (pick them from Media)." };
  const sharp = (await import("sharp")).default;
  const sources: Buffer[] = [];
  for (const u of urls) {
    const r = await fetchCapped(u);
    if (!r.buf) return { ok: false, error: `A picture could not be loaded (${r.error ?? "error"}).` };
    sources.push(r.buf);
  }
  let size = { width: plan.width, height: plan.height, colours: plan.colours };
  for (let attempt = 0; attempt < 5; attempt++) {
    let frames: Buffer[];
    try {
      frames = await Promise.all(
        sources.map((b) =>
          sharp(b, { limitInputPixels: 8192 * 8192 })
            .rotate()
            .resize({ width: size.width, height: size.height, fit: "cover", position: "attention" })
            .flatten({ background: "#000000" })
            .png()
            .toBuffer(),
        ),
      );
    } catch {
      return { ok: false, error: "One of the files is not a picture the GIF maker can read." };
    }
    const gif = await sharp(frames, { join: { animated: true } })
      .gif({ delay: frames.map(() => plan.delayMs), loop: 0, colours: size.colours, effort: 7, dither: 0.6 })
      .toBuffer();
    const next = gifRetry(gif.length, GIF_WARN_BYTES, size);
    if (next && attempt < 4) {
      size = next;
      continue;
    }
    if (gif.length > GIF_WARN_BYTES * 3) return { ok: false, error: "The GIF is still too heavy for email. Use fewer pictures." };
    const asset = await uploadMedia({
      buffer: gif,
      filename: `newsletter-gif-${Date.now().toString(36)}.gif`,
      mimeType: "image/gif",
      usageType: "newsletter",
      tags: ["newsletter", "gif", "canvas"],
      title: (p.title || "Newsletter GIF").slice(0, 120),
      altText: p.title.slice(0, 200),
      uploadedBy: p.uploadedBy,
      status: "published",
      optimize: false,
    });
    const url = publicUrlForKey(asset.storage_key) ?? asset.public_url;
    if (!url) return { ok: false, error: "The GIF was saved but has no public link." };
    return { ok: true, url, mediaId: asset.id, bytes: gif.length, frames: frames.length, width: size.width };
  }
  return { ok: false, error: "The GIF could not be made light enough for email." };
}

// ── Live countdown ──────────────────────────────────────────────────────────

/** The countdown GIF as it looks right now (plays once through one minute, then stops). */
/**
 * D243 E-6 (G-126): a moving design section. The browser draws each frame of
 * the design's entrance (newsletter-polish-core designGifPlan: the finished
 * design first, for Outlook) and uploads them; this joins them into one GIF
 * at email width, shrinking colours then width until it is light enough.
 */
export async function buildDesignGif(p: {
  frames: Buffer[];
  delays: number[];
  title: string;
  uploadedBy: string | null;
}): Promise<{ ok: true; url: string; mediaId: string; bytes: number; frames: number; width: number; height: number } | { ok: false; error: string }> {
  const checked = checkGifFrames(p.frames.length, p.delays);
  if (!checked.ok) return checked;
  const sharp = (await import("sharp")).default;
  let first: { width?: number; height?: number };
  try {
    first = await sharp(p.frames[0], { limitInputPixels: 8192 * 8192 }).metadata();
  } catch {
    return { ok: false, error: "A frame is not a picture the GIF maker can read." };
  }
  if (!first.width || !first.height) return { ok: false, error: "A frame came out empty. Try again." };
  const ratio = first.height / first.width;
  let size = { width: DESIGN_GIF_W, height: Math.round(DESIGN_GIF_W * ratio), colours: 128 };
  for (let attempt = 0; attempt < 5; attempt++) {
    let frames: Buffer[];
    try {
      frames = await Promise.all(
        p.frames.map((b) =>
          sharp(b, { limitInputPixels: 8192 * 8192 })
            .resize({ width: size.width, height: size.height, fit: "fill" })
            .flatten({ background: "#000000" })
            .png()
            .toBuffer(),
        ),
      );
    } catch {
      return { ok: false, error: "A frame is not a picture the GIF maker can read." };
    }
    const gif = await sharp(frames, { join: { animated: true } })
      .gif({ delay: checked.delays, loop: 0, colours: size.colours, effort: 7, dither: 0.6 })
      .toBuffer();
    const next = gifRetry(gif.length, GIF_WARN_BYTES, size);
    if (next && attempt < 4) {
      size = next;
      continue;
    }
    if (gif.length > GIF_WARN_BYTES * 3) return { ok: false, error: "The moving picture is still too heavy for email. Use fewer entrances or a simpler background." };
    const asset = await uploadMedia({
      buffer: gif,
      filename: `newsletter-design-gif-${Date.now().toString(36)}.gif`,
      mimeType: "image/gif",
      usageType: "newsletter",
      tags: ["newsletter", "gif", "design-section"],
      title: `Newsletter moving design: ${(p.title || "section").slice(0, 100)}`,
      altText: p.title.slice(0, 200),
      uploadedBy: p.uploadedBy,
      status: "published",
      optimize: false,
    });
    const url = publicUrlForKey(asset.storage_key) ?? asset.public_url;
    if (!url) return { ok: false, error: "The GIF was saved but has no public link." };
    return { ok: true, url, mediaId: asset.id, bytes: gif.length, frames: frames.length, width: size.width, height: size.height };
  }
  return { ok: false, error: "The moving picture could not be made light enough for email." };
}

export async function countdownGif(endSec: number, theme: CountdownTheme, nowSec: number): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const secs = countdownFrameSeconds(endSec - nowSec);
  const frames = await Promise.all(secs.map((s) => sharp(Buffer.from(countdownSvg(s, theme))).png().toBuffer()));
  if (frames.length === 1) return sharp(frames[0]).gif({ colours: 16 }).toBuffer();
  return sharp(frames, { join: { animated: true } })
    .gif({ delay: frames.map(() => 1000), loop: 1, colours: 16, effort: 1 })
    .toBuffer();
}

// ── Click report ────────────────────────────────────────────────────────────

/** Clicks per section and poll votes across every real send of this newsletter. */
export async function canvasClicksFor(postId: string, doc: CanvasDoc | null): Promise<(ClickReport & { sends: number }) | null> {
  if (!isSupabaseServiceConfigured || !doc) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data: sends } = await admin.from("newsletter_sends").select("id").eq("post_id", postId).neq("send_kind", "test");
    const ids = ((sends as { id: string }[] | null) ?? []).map((s) => s.id);
    if (!ids.length) return { ...canvasClickReport(doc, []), sends: 0 };
    const events: ClickEvent[] = [];
    const PAGE = 1000;
    for (let from = 0; from < 50_000; from += PAGE) {
      const { data, error } = await admin
        .from("newsletter_email_events")
        .select("url, recipient_email")
        .in("newsletter_send_id", ids)
        .eq("event_type", "clicked")
        .order("occurred_at", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error || !data || data.length === 0) break;
      for (const r of data as { url: string | null; recipient_email: string }[]) events.push({ url: r.url, recipient: r.recipient_email });
      if (data.length < PAGE) break;
    }
    return { ...canvasClickReport(doc, events), sends: ids.length };
  } catch {
    return null;
  }
}

// ── Hosted web version ──────────────────────────────────────────────────────

/** The web copy of a PUBLISHED canvas newsletter, or null (then the blog post is shown). */
export async function webVersionFor(slug: string): Promise<string | null> {
  if (!isSupabaseServiceConfigured || !slug) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("blog_posts").select("id, slug, kind, status").eq("slug", slug).eq("status", "published").maybeSingle();
  const post = data as { id: string; slug: string; kind: string } | null;
  if (!post || post.kind !== "newsletter") return null;
  const doc = await loadCanvas(post.id);
  if (!doc || !doc.useForEmail || doc.blocks.length === 0) return null;
  // No member token on the web copy: the unsubscribe page explains how to leave.
  const { frameContextFor } = await import("./newsletter-frame-server");
  return renderCanvasEmail(doc, { ...renderOptsFor(post, `${SITE}/unsubscribe`, await frameContextFor(post.id)), webUrl: null });
}
