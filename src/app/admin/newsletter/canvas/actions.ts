"use server";

/**
 * D238 N-8a (SOP-22 G-118, F-22-8): server actions for the newsletter canvas.
 * Everyone who can write posts (blog.manage) can build, check, compress and
 * test-send a canvas; sending to everyone stays owner/admin (N-1).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createPost, isSlugAvailable } from "@/lib/cms/blog-store";
import { voidApprovalOnEdit } from "@/lib/cms/newsletter-cadence-server";
import { APPROVAL_VOIDED_MESSAGE } from "@/lib/cms/newsletter-cadence-core";
import { uploadMedia, publicUrlForKey } from "@/lib/media/store";
import { MEDIA_UPLOAD_MAX_BYTES, tooLargeMessage } from "@/lib/media/gif-core";
import { normalizeCanvas, starterCanvas, type CanvasCheck, type CanvasDoc } from "@/lib/cms/newsletter-canvas-core";
import {
  compressCanvasImages,
  fillCanvasFromWeek,
  getCanvasPost,
  makeQrImage,
  runCanvasCheck,
  saveCanvas,
  sendCanvasTest,
} from "@/lib/cms/newsletter-canvas-server";

const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

type Fail = { ok: false; error: string };

async function newsletterOrFail(postId: string): Promise<Fail | null> {
  const post = await getCanvasPost(String(postId ?? ""));
  if (!post) return { ok: false, error: "Newsletter not found." };
  if (post.kind !== "newsletter") return { ok: false, error: "The canvas is only for newsletters." };
  return null;
}

/** Create a new newsletter post with the starter canvas and open the editor. */
export async function createCanvasNewsletterAction(formData: FormData): Promise<void> {
  const session = await requirePermission("blog.manage");
  const title = String(formData.get("title") ?? "").trim().slice(0, 140) || `Newsletter ${new Date().toISOString().slice(0, 10)}`;
  let slug = title.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 80) || "newsletter";
  if (!(await isSlugAvailable(slug))) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  const post = await createPost({ slug, title, category: "NEWSLETTER", kind: "newsletter", excerpt: null, body: [], createdBy: session.userId });
  await saveCanvas(post.id, starterCanvas(title), session.userId);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "newsletter.canvas.create",
    entityType: "blog_post",
    entityId: post.id,
    after: { slug, title },
  });
  revalidatePath("/admin/newsletter");
  redirect(`/admin/newsletter/canvas/${post.id}`);
}

export type SaveCanvasOut = { ok: true; doc: CanvasDoc; approvalVoided: boolean; notice: string | null } | Fail;

export async function saveCanvasAction(postId: string, raw: unknown): Promise<SaveCanvasOut> {
  const session = await requirePermission("blog.manage");
  const bad = await newsletterOrFail(postId);
  if (bad) return bad;
  const res = await saveCanvas(postId, raw, session.userId);
  if (!res.ok) return res;
  // Editing an approved newsletter takes the approval back (N-3).
  const voided = await voidApprovalOnEdit(postId);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "newsletter.canvas.save",
    entityType: "blog_post",
    entityId: postId,
    after: { blocks: res.doc.blocks.length, useForEmail: res.doc.useForEmail, theme: res.doc.theme, approvalVoided: voided },
  });
  revalidatePath("/admin/newsletter");
  return { ok: true, doc: res.doc, approvalVoided: voided, notice: voided ? APPROVAL_VOIDED_MESSAGE : null };
}

export type CheckCanvasOut = { ok: true; check: CanvasCheck } | Fail;

/** The full send check (downloads each image to weigh it). */
export async function checkCanvasAction(postId: string, raw: unknown): Promise<CheckCanvasOut> {
  await requirePermission("blog.manage");
  const post = await getCanvasPost(String(postId ?? ""));
  if (!post) return { ok: false, error: "Newsletter not found." };
  try {
    return { ok: true, check: await runCanvasCheck(normalizeCanvas(raw), post) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The check failed." };
  }
}

export type CompressCanvasOut =
  | { ok: true; doc: CanvasDoc; changed: { from: string; to: string; before: number; after: number }[]; skipped: number; errors: string[]; check: CanvasCheck }
  | Fail;

/** Compress heavy pictures for email, save the canvas and re-run the check. */
export async function compressCanvasAction(postId: string, raw: unknown): Promise<CompressCanvasOut> {
  const session = await requirePermission("blog.manage");
  const bad = await newsletterOrFail(postId);
  if (bad) return bad;
  const post = await getCanvasPost(postId);
  try {
    const out = await compressCanvasImages(normalizeCanvas(raw), session.userId);
    if (out.changed.length) {
      const saved = await saveCanvas(postId, out.doc, session.userId);
      if (!saved.ok) return saved;
      await voidApprovalOnEdit(postId);
    }
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "newsletter.canvas.compress",
      entityType: "blog_post",
      entityId: postId,
      after: {
        changed: out.changed.length,
        bytesBefore: out.changed.reduce((a, c) => a + c.before, 0),
        bytesAfter: out.changed.reduce((a, c) => a + c.after, 0),
        skipped: out.skipped,
        errors: out.errors.length,
      },
    });
    const check = await runCanvasCheck(out.doc, post);
    return { ok: true, doc: out.doc, changed: out.changed, skipped: out.skipped, errors: out.errors, check };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Compress failed." };
  }
}

export type QrOut = { ok: true; src: string } | Fail;

/** Make a QR image (PNG, stored in the media library) for a link. */
export async function makeQrAction(url: string): Promise<QrOut> {
  const session = await requirePermission("blog.manage");
  const res = await makeQrImage(String(url ?? "").trim(), session.userId);
  if (res.ok) {
    await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "newsletter.canvas.qr", entityType: "media_asset", after: { url: String(url).slice(0, 300) } });
  }
  return res;
}

export type FillOut = { ok: true; doc: CanvasDoc; filled: number; partial: boolean } | Fail;

/** Fill the empty card sections from this week's feed and recent posts (no AI). */
export async function fillFromWeekAction(postId: string, raw: unknown): Promise<FillOut> {
  await requirePermission("blog.manage");
  const bad = await newsletterOrFail(postId);
  if (bad) return bad;
  try {
    const res = await fillCanvasFromWeek(normalizeCanvas(raw), postId);
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not read this week." };
  }
}

export type UploadOut = { ok: true; src: string; mime: string } | Fail;

/** Upload a picture or a moving GIF for the canvas (GIFs are stored as they are). */
export async function uploadCanvasImageAction(formData: FormData): Promise<UploadOut> {
  const session = await requirePermission("blog.manage");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a picture." };
  if (!IMAGE_MIME.has(file.type)) return { ok: false, error: "Use PNG, JPEG, GIF or WebP." };
  if (file.size > MEDIA_UPLOAD_MAX_BYTES) return { ok: false, error: tooLargeMessage(file.name, file.size) };
  try {
    const asset = await uploadMedia({
      buffer: Buffer.from(await file.arrayBuffer()),
      filename: file.name,
      mimeType: file.type,
      usageType: "newsletter",
      tags: ["newsletter", "canvas"],
      title: file.name,
      uploadedBy: session.userId,
      status: "published",
      // Keep JPEG/PNG/GIF as they are: Outlook for Windows does not show WebP.
      optimize: false,
    });
    const src = publicUrlForKey(asset.storage_key) ?? asset.public_url;
    if (!src) return { ok: false, error: "Stored, but the picture has no public link." };
    await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "newsletter.canvas.upload", entityType: "media_asset", entityId: asset.id, after: { mime: file.type, bytes: file.size } });
    return { ok: true, src, mime: file.type };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Upload failed." };
  }
}

export type TestOut = { ok: true } | Fail;

/** Send the canvas to one address (works on drafts). */
export async function testSendCanvasAction(postId: string, raw: unknown, to: string): Promise<TestOut> {
  const session = await requirePermission("blog.manage");
  const bad = await newsletterOrFail(postId);
  if (bad) return bad;
  const email = String(to ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Enter a valid test email address." };
  const res = await sendCanvasTest({ postId, doc: normalizeCanvas(raw), to: email, actorId: session.userId, actorEmail: session.email });
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "newsletter.canvas.test_send",
    entityType: "newsletter",
    entityId: postId,
    after: { testEmail: email, ok: res.ok },
  });
  return res;
}
