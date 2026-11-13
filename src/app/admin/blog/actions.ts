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
import {
  generateBlogIdeas,
  type BlogIdea,
  type BlogIdeaKind,
} from "@/lib/cms/ai-blog-ideas";
import { acceptWithComplianceGate } from "@/lib/ai/accept-gate";
import { MEDIA_UPLOAD_MAX_BYTES } from "@/lib/media/gif-core";
import { voidApprovalOnEdit } from "@/lib/cms/newsletter-cadence-server";
import { APPROVAL_VOIDED_MESSAGE } from "@/lib/cms/newsletter-cadence-core";
import { parseLocalEventsText } from "@/lib/cms/this-week-feed-core";
import { saveLocalEvents } from "@/lib/cms/this-week-feed-server";
import { loadTemplateItems, draftFromTemplate, checkFinalDraft, type TemplateItemsOut, type TemplateDraftOut } from "@/lib/cms/post-templates-server";
import { normalizeDraft, draftToParagraphs, type DraftIssue } from "@/lib/cms/post-templates-core";

const MAX_IMG_BYTES = MEDIA_UPLOAD_MAX_BYTES; // R43: 4 MB (Vercel Function 4.5 MB request cap)
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
  // Carry any idea-assistant seed to the editor so the body-draft AI has context.
  const seed = String(formData.get("ai_topic_seed") ?? "").trim();
  const suffix = seed ? `?topic=${encodeURIComponent(seed.slice(0, 300))}` : "";
  redirect(`/admin/blog/${post.id}${suffix}`);
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
    if (!IMAGE_MIME.has(hero.type)) redirect(`/admin/blog/${id}?error=` + encodeURIComponent("Hero image must be PNG, JPG, WEBP or GIF."));
    if (hero.size > MAX_IMG_BYTES) redirect(`/admin/blog/${id}?error=` + encodeURIComponent("Hero image exceeds 4 MB (the upload limit)."));
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
    // F-22-6 (N-1): undefined = no new PDF, keep the stored one.
    let pdfMediaId: string | undefined = undefined;
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

  // D237 N-3: editing an approved newsletter takes the approval back, so the
  // owner approves exactly what goes out on Sunday.
  if (kind === "newsletter" && (await voidApprovalOnEdit(id))) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "newsletter.approval_voided",
      entityType: "newsletter",
      entityId: id,
      after: { reason: "edited after approval" },
    });
    revalidateBlog(slug);
    redirect(`/admin/blog/${id}?saved=1&error=${encodeURIComponent(APPROVAL_VOIDED_MESSAGE)}`);
  }

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
  // D237 N-3 (F-22-5): "Scheduled" only means something with a time. Use the
  // Schedule panel; it sets this status and the 5-minute cron publishes it.
  if (status === "scheduled") {
    redirect(`/admin/blog/${id}?error=${encodeURIComponent("Use \u201cSchedule this to go live\u201d below and pick a Pacific time. The post then shows as Scheduled and goes live by itself.")}#schedule`);
  }

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

  // S-4: compliance RE-SCAN at accept — blocking flags refuse the accept.
  const gate = await acceptWithComplianceGate(suggestion!);
  if (!gate.ok) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "blog.ai.accept_blocked",
      entityType: "blog_post",
      entityId: id,
      after: { field: suggestion!.field_key, ...gate.audit },
    });
    redirect(`/admin/blog/${id}?error=` + encodeURIComponent(gate.message));
  }

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
    after: { field: suggestion.field_key, ...gate.audit },
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

/**
 * Client-callable: suggest blog IDEAS / HEADLINES / TRENDS for the local market
 * (Kitsap County + surrounding + Seattle). DRAFTS-ONLY — returns suggestions to
 * the editor; nothing is persisted or published. The author picks an idea and
 * uses it to seed a new post (or the topic box for a body draft).
 */
export type BlogIdeaResultOut =
  | { ok: true; ideas: BlogIdea[]; model: string }
  | { ok: false; error: string };

export async function suggestBlogIdeasAction(
  kind: BlogIdeaKind,
  topic: string,
): Promise<BlogIdeaResultOut> {
  const session = await requirePermission("blog.manage");
  if (!isAiConfigured) {
    return { ok: false, error: "AI is not configured. Set AI_API_KEY (or OPENAI_API_KEY) to enable idea suggestions." };
  }
  const cleanKind: BlogIdeaKind =
    kind === "headline" || kind === "trend" ? kind : "idea";
  try {
    const { ideas, model } = await generateBlogIdeas({
      kind: cleanKind,
      count: 6,
      topic: topic.trim() || null,
      actorId: session.userId,
      actorEmail: session.email,
    });
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: `blog.ai.ideas.${cleanKind}`,
      entityType: "blog_post",
      after: { count: ideas.length, topic: topic.trim() || null },
    }).catch(() => {});
    if (ideas.length === 0) {
      return { ok: false, error: "The assistant returned no usable ideas. Try again or add a topic." };
    }
    return { ok: true, ideas, model };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "AI idea generation failed." };
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

// ── D237 N-4 (SOP-22 G-114): local events for the "This week" feed ──────────

export async function saveBlogLocalEventsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("blog.manage");
  const events = parseLocalEventsText(String(formData.get("events") ?? ""));
  const res = await saveLocalEvents(events, session.userId);
  if (res.error) redirect(`/admin/blog?error=${encodeURIComponent(res.error)}#this-week`);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "blog.local_events_save",
    entityType: "site_settings",
    entityId: "blog_calendar_events",
    after: { count: events.length },
  });
  revalidatePath("/admin/blog");
  redirect(`/admin/blog?saved=events#this-week`);
}

// ---------------------------------------------------------------------------
// D237 N-5 (SOP-22 G-115; F-22-10, F-22-16): "New post from…" — grounded AI.
// The facts are re-read on the server from the This-week feed every time; the
// browser sends only the template, the item id and the notes. Drafts only.
// ---------------------------------------------------------------------------
export async function loadTemplateItemsAction(key: string): Promise<TemplateItemsOut> {
  await requirePermission("blog.manage");
  try {
    return await loadTemplateItems(String(key ?? ""));
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not read this week's facts." };
  }
}

export async function draftFromTemplateAction(input: { key: string; itemId: string; notes: string }): Promise<TemplateDraftOut> {
  const session = await requirePermission("blog.manage");
  try {
    const res = await draftFromTemplate({
      key: String(input?.key ?? ""),
      itemId: String(input?.itemId ?? ""),
      notes: String(input?.notes ?? ""),
      actorId: session.userId,
      actorEmail: session.email,
    });
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "blog.ai.template_draft",
      entityType: "blog_post",
      after: res.ok
        ? { template: input?.key, item: input?.itemId, issues: res.issues.length, complianceFlags: res.complianceFlags.length, pictures: res.pictures.length }
        : { template: input?.key, item: input?.itemId, error: res.error },
    }).catch(() => {});
    return res;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "AI draft failed." };
  }
}

export type CreateFromDraftOut = { ok: true; id: string } | { ok: false; error: string; blocking?: string[]; issues?: DraftIssue[] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createPostFromDraftAction(input: {
  key: string;
  itemId: string;
  notes: string;
  title: string;
  draft: unknown;
  heroMediaId?: string | null;
}): Promise<CreateFromDraftOut> {
  const session = await requirePermission("blog.manage");
  const title = String(input?.title ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (!title) return { ok: false, error: "Pick or type a headline first." };
  const draft = normalizeDraft(input?.draft);
  const checked = { ...draft, headlines: [title] };
  const final = await checkFinalDraft(String(input?.key ?? ""), String(input?.itemId ?? ""), String(input?.notes ?? ""), checked);
  if (!final.ok) return { ok: false, error: final.error };
  if (final.blocking.length > 0) {
    return { ok: false, error: "Fix the must-fix items before creating the draft.", blocking: final.blocking, issues: final.issues };
  }
  let slug = slugify(title);
  if (!slug) return { ok: false, error: "That headline does not make a usable web address. Use some letters or numbers." };
  if (!(await isSlugAvailable(slug))) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  const hero = input?.heroMediaId && UUID_RE.test(String(input.heroMediaId)) ? String(input.heroMediaId) : null;
  const post = await createPost({
    slug,
    title,
    category: final.t.category,
    kind: "article",
    excerpt: draft.excerpt || null,
    author: "Greenway Team",
    body: draftToParagraphs(draft),
    hero_media_id: hero,
    createdBy: session.userId,
  });
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "blog.create",
    entityType: "blog_post",
    entityId: post.id,
    after: { slug, title, category: final.t.category, kind: "article", fromTemplate: final.t.key, item: input?.itemId, hero, headsUp: final.issues.length + final.complianceFlags.length },
  });
  revalidateBlog(slug);
  return { ok: true, id: post.id };
}
