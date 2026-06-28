"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { uploadMedia } from "@/lib/media/store";
import {
  createPost,
  updatePost,
  setPostStatus,
  deletePost,
  getPostById,
  isSlugAvailable,
  upsertNewsletterAsset,
} from "@/lib/cms/blog-store";
import type { BlogPostRow } from "@/lib/cms/types";
import {
  generateBlogBody,
  generateBlogSeo,
  generateHeroAltText,
  reviewBlogSuggestion,
  getBlogSuggestion,
  parseSeoSuggestion,
  isAiConfigured,
} from "@/lib/cms/ai-blog";
import type { BlogKind } from "@/lib/cms/types";
import { BLOG_CATEGORIES } from "@/lib/cms/types";
import type { PostStatus } from "@/lib/cms/types";

const MAX_IMG_BYTES = 5 * 1024 * 1024;
const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const PDF_MIME = "application/pdf";

function orNull(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s || null;
}

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Paragraph array from a textarea (split on blank lines). */
function bodyFromText(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function revalidateBlog(slug?: string) {
  revalidatePath("/admin/blog");
  revalidatePath("/blog");
  if (slug) revalidatePath(`/blog/${slug}`);
}

/** Validate the bounded title-typography inputs (defensive; matches schema). */
function titleTypographyFromForm(formData: FormData): {
  title_font: string | null;
  title_size: string;
  title_color: string | null;
} {
  const fontRaw = String(formData.get("title_font") ?? "").trim();
  const font = fontRaw && fontRaw !== "inherit" ? fontRaw : null;
  const sizeRaw = String(formData.get("title_size") ?? "md").trim();
  const size = ["sm", "md", "lg", "xl"].includes(sizeRaw) ? sizeRaw : "md";
  const colorRaw = String(formData.get("title_color") ?? "").trim();
  const color = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(colorRaw) ? colorRaw : null;
  return { title_font: font, title_size: size, title_color: color };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
export async function createPostAction(formData: FormData): Promise<void> {
  const session = await requirePermission("blog.manage");
  const title = String(formData.get("title") ?? "").trim();
  if (!title) redirect("/admin/blog/new?error=title");

  let slug = slugify(String(formData.get("slug") ?? "") || title);
  if (!slug) redirect("/admin/blog/new?error=slug");
  if (!(await isSlugAvailable(slug))) {
    // Append a short suffix to avoid collision.
    slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  }

  const categoryRaw = String(formData.get("category") ?? "CULTURE").toUpperCase();
  const category = (BLOG_CATEGORIES as string[]).includes(categoryRaw) ? categoryRaw : "CULTURE";
  const kind = (String(formData.get("kind") ?? "article") === "newsletter" ? "newsletter" : "article") as BlogKind;

  const post = await createPost({
    slug,
    title,
    category,
    kind,
    excerpt: orNull(formData.get("excerpt")),
    author: String(formData.get("author") ?? "Greenway Team").trim() || "Greenway Team",
    body: bodyFromText(String(formData.get("body") ?? "")),
    publish_date: orNull(formData.get("publish_date")),
    date_label: orNull(formData.get("date_label")),
    createdBy: session.userId,
  });

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "blog.create",
    entityType: "blog_post",
    entityId: post.id,
    after: { slug, title, category, kind },
  });

  revalidateBlog(slug);
  redirect(`/admin/blog/${post.id}`);
}

// ---------------------------------------------------------------------------
// Update (content + meta)
// ---------------------------------------------------------------------------
export async function updatePostAction(formData: FormData): Promise<void> {
  const session = await requirePermission("blog.manage");
  const id = String(formData.get("id") ?? "");
  const existing = await getPostById(id);
  if (!existing) redirect("/admin/blog");

  const before: Partial<BlogPostRow> = {
    title: existing.title,
    slug: existing.slug,
    category: existing.category,
    status: existing.status,
  };

  // Slug change with uniqueness guard.
  let slug = existing.slug;
  const requestedSlug = slugify(String(formData.get("slug") ?? ""));
  if (requestedSlug && requestedSlug !== existing.slug && (await isSlugAvailable(requestedSlug, id))) {
    slug = requestedSlug;
  }

  const categoryRaw = String(formData.get("category") ?? existing.category).toUpperCase();
  const category = (BLOG_CATEGORIES as string[]).includes(categoryRaw) ? categoryRaw : existing.category;
  const kind = (String(formData.get("kind") ?? existing.kind) === "newsletter" ? "newsletter" : "article") as BlogKind;

  // Optional hero image upload.
  let heroMediaId: string | undefined;
  const hero = formData.get("hero_image");
  if (hero instanceof File && hero.size > 0) {
    if (!IMAGE_MIME.has(hero.type)) redirect(`/admin/blog/${id}?error=heroType`);
    if (hero.size > MAX_IMG_BYTES) redirect(`/admin/blog/${id}?error=heroSize`);
    const buffer = Buffer.from(await hero.arrayBuffer());
    const asset = await uploadMedia({
      buffer,
      filename: hero.name,
      mimeType: hero.type,
      usageType: "blog-hero",
      altText: orNull(formData.get("hero_image_alt")) ?? undefined,
      title: existing.title,
      status: "published",
      uploadedBy: session.userId,
    });
    heroMediaId = asset.id;
  }

  await updatePost(id, {
    slug,
    title: String(formData.get("title") ?? existing.title).trim() || existing.title,
    category,
    kind,
    excerpt: orNull(formData.get("excerpt")),
    author: String(formData.get("author") ?? existing.author).trim() || existing.author,
    body: bodyFromText(String(formData.get("body") ?? "")),
    hero_media_id: heroMediaId,
    hero_image_alt: orNull(formData.get("hero_image_alt")),
    publish_date: orNull(formData.get("publish_date")),
    date_label: orNull(formData.get("date_label")),
    ...titleTypographyFromForm(formData),
    seo_title: orNull(formData.get("seo_title")),
    seo_description: orNull(formData.get("seo_description")),
    canonical_path: orNull(formData.get("canonical_path")),
    noindex: formData.get("noindex") === "on",
    updatedBy: session.userId,
  });

  // Newsletter page paths (one per line) if in newsletter mode.
  if (kind === "newsletter") {
    const pdf = formData.get("pdf_file");
    let pdfMediaId: string | null = null;
    if (pdf instanceof File && pdf.size > 0 && pdf.type === PDF_MIME) {
      const buffer = Buffer.from(await pdf.arrayBuffer());
      const asset = await uploadMedia({
        buffer,
        filename: pdf.name,
        mimeType: pdf.type,
        usageType: "newsletter-pdf",
        title: existing.title,
        status: "published",
        uploadedBy: session.userId,
      });
      pdfMediaId = asset.id;
    }
    const pagePaths = String(formData.get("page_paths") ?? "")
      .split(/\n+/)
      .map((p) => p.trim())
      .filter(Boolean);
    await upsertNewsletterAsset(id, {
      pdf_media_id: pdfMediaId,
      page_paths: pagePaths,
    });
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "blog.update",
    entityType: "blog_post",
    entityId: id,
    before,
    after: { slug, title: formData.get("title"), category, kind },
  });

  revalidateBlog(slug);
  redirect(`/admin/blog/${id}?saved=1`);
}

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------
export async function setPostStatusAction(formData: FormData): Promise<void> {
  const session = await requirePermission("blog.manage");
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as PostStatus;
  if (!["draft", "scheduled", "published", "archived"].includes(status)) redirect("/admin/blog");
  const post = await getPostById(id);
  if (!post) redirect("/admin/blog");

  await setPostStatus(id, status, session.userId);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: `blog.${status}`,
    entityType: "blog_post",
    entityId: id,
    before: { status: post.status },
    after: { status },
  });

  revalidateBlog(post.slug);
  redirect(`/admin/blog/${id}?saved=1`);
}

export async function deletePostAction(formData: FormData): Promise<void> {
  const session = await requirePermission("blog.manage");
  const id = String(formData.get("id") ?? "");
  const post = await getPostById(id);
  if (!post) redirect("/admin/blog");
  await deletePost(id);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "blog.delete",
    entityType: "blog_post",
    entityId: id,
    before: { slug: post.slug, title: post.title },
  });
  revalidateBlog(post.slug);
  redirect("/admin/blog");
}

// ---------------------------------------------------------------------------
// AI assist
// ---------------------------------------------------------------------------
export async function generateBlogAiAction(formData: FormData): Promise<void> {
  const session = await requirePermission("blog.manage");
  const id = String(formData.get("id") ?? "");
  const kind = String(formData.get("ai_kind") ?? "body"); // body | seo
  const post = await getPostById(id);
  if (!post) redirect("/admin/blog");

  const brief = {
    title: post.title,
    category: post.category,
    topic: orNull(formData.get("topic")),
  };

  if (kind === "seo") {
    await generateBlogSeo(id, brief, session.userId);
  } else {
    await generateBlogBody(id, brief, session.userId);
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: `blog.ai.${kind}`,
    entityType: "blog_post",
    entityId: id,
  });

  revalidatePath(`/admin/blog/${id}`);
  redirect(`/admin/blog/${id}?ai=1`);
}

export async function acceptBlogSuggestionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("blog.manage");
  const id = String(formData.get("id") ?? "");
  const suggestionId = String(formData.get("suggestion_id") ?? "");
  const suggestion = await getBlogSuggestion(suggestionId);
  const post = await getPostById(id);
  if (!suggestion || !post) redirect(`/admin/blog/${id}`);

  if (suggestion.field_key === "body") {
    await updatePost(id, {
      body: bodyFromText(suggestion.suggested_value ?? ""),
      updatedBy: session.userId,
    });
  } else if (suggestion.field_key === "seo") {
    const { title, description } = parseSeoSuggestion(suggestion.suggested_value ?? "");
    await updatePost(id, {
      seo_title: title || undefined,
      seo_description: description || undefined,
      updatedBy: session.userId,
    });
  }

  await reviewBlogSuggestion(suggestionId, "accepted", session.userId);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "blog.ai.accept",
    entityType: "blog_post",
    entityId: id,
    after: { field: suggestion.field_key },
  });

  revalidatePath(`/admin/blog/${id}`);
  redirect(`/admin/blog/${id}?saved=1`);
}

/**
 * Client-callable: suggest hero-image alt text. Returns the suggestion to the
 * editor (drafts-only) — never writes to the post. The author accepts/edits it
 * and saves via updatePostAction as normal.
 */
export type AltSuggestResult =
  | { ok: true; value: string; complianceFlags: string[]; model: string }
  | { ok: false; error: string };

export async function suggestHeroAltAction(
  postId: string,
  title: string,
  category: string,
): Promise<AltSuggestResult> {
  const session = await requirePermission("blog.manage");
  if (!isAiConfigured) {
    return { ok: false, error: "AI is not configured. Set AI_API_KEY to enable suggestions." };
  }
  const cleanTitle = (title ?? "").trim();
  if (!cleanTitle) return { ok: false, error: "Add a title first so the suggestion has context." };

  try {
    const { value, complianceFlags, model } = await generateHeroAltText(
      cleanTitle,
      (category ?? "").trim() || "CULTURE",
    );
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "blog.ai.alt_text",
      entityType: "blog_post",
      entityId: postId,
      after: { complianceFlags },
    });
    return { ok: true, value, complianceFlags, model };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "AI suggestion failed." };
  }
}

export async function rejectBlogSuggestionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("blog.manage");
  const id = String(formData.get("id") ?? "");
  const suggestionId = String(formData.get("suggestion_id") ?? "");
  await reviewBlogSuggestion(suggestionId, "rejected", session.userId);
  revalidatePath(`/admin/blog/${id}`);
  redirect(`/admin/blog/${id}`);
}
