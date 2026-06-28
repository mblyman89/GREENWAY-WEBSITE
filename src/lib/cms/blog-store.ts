/**
 * src/lib/cms/blog-store.ts
 *
 * Server-side service for the blog/newsletter CMS (Slice 5). CRUD for staff,
 * plus public read helpers that fall back to the static `blogPosts` array when
 * the DB is unconfigured or empty so the public /blog never goes blank.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured, supabaseUrl } from "@/lib/supabase/env";
import type {
  BlogPostRow,
  NewsletterAssetRow,
  PostStatus,
  PublicBlogPost,
  BlogCategory,
  BlogKind,
} from "./types";
import { blogPosts as staticBlogPosts } from "@/lib/blog/posts";

const MEDIA_BUCKET = "media";

function publicMediaUrl(storageKey: string): string {
  return `${supabaseUrl}/storage/v1/object/public/${MEDIA_BUCKET}/${storageKey}`;
}

/** Resolve a media id (preferred) or raw path into a usable src URL. */
async function resolveMediaSrc(
  mediaId: string | null,
  rawPath: string | null,
): Promise<string | null> {
  if (mediaId && isSupabaseServiceConfigured) {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("media_assets")
      .select("storage_key")
      .eq("id", mediaId)
      .maybeSingle();
    const key = (data as { storage_key?: string } | null)?.storage_key;
    if (key) return publicMediaUrl(key);
  }
  return rawPath ?? null;
}

/** Public wrapper: resolve a displayable hero image URL for the editor preview. */
export async function resolveHeroSrc(
  mediaId: string | null,
  rawPath: string | null,
): Promise<string | null> {
  return resolveMediaSrc(mediaId, rawPath);
}

// ---------------------------------------------------------------------------
// Staff CRUD
// ---------------------------------------------------------------------------

export async function listPosts(): Promise<BlogPostRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("blog_posts")
    .select("*")
    .order("publish_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  return (data as BlogPostRow[] | null) ?? [];
}

export async function getPostById(id: string): Promise<BlogPostRow | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("blog_posts").select("*").eq("id", id).maybeSingle();
  return (data as BlogPostRow | null) ?? null;
}

export async function getNewsletterAsset(postId: string): Promise<NewsletterAssetRow | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("newsletter_assets")
    .select("*")
    .eq("post_id", postId)
    .maybeSingle();
  return (data as NewsletterAssetRow | null) ?? null;
}

export type SlugCheck = { available: boolean };

/** Is this slug free (optionally excluding the post being edited)? */
export async function isSlugAvailable(slug: string, excludeId?: string): Promise<boolean> {
  if (!isSupabaseServiceConfigured) return true;
  const admin = createSupabaseAdminClient();
  let q = admin.from("blog_posts").select("id").eq("slug", slug);
  if (excludeId) q = q.neq("id", excludeId);
  const { data } = await q.maybeSingle();
  return !data;
}

export type CreatePostInput = {
  slug: string;
  title: string;
  category: string;
  kind: BlogKind;
  excerpt?: string | null;
  author?: string;
  body?: string[];
  hero_media_id?: string | null;
  hero_image_path?: string | null;
  hero_image_alt?: string | null;
  publish_date?: string | null;
  date_label?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  canonical_path?: string | null;
  noindex?: boolean;
  createdBy: string | null;
};

export async function createPost(input: CreatePostInput): Promise<BlogPostRow> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("blog_posts")
    .insert({
      slug: input.slug,
      title: input.title,
      category: input.category,
      kind: input.kind,
      status: "draft" as PostStatus,
      excerpt: input.excerpt ?? null,
      author: input.author ?? "Greenway Team",
      body: input.body ?? [],
      hero_media_id: input.hero_media_id ?? null,
      hero_image_path: input.hero_image_path ?? null,
      hero_image_alt: input.hero_image_alt ?? null,
      publish_date: input.publish_date ?? null,
      date_label: input.date_label ?? null,
      seo_title: input.seo_title ?? null,
      seo_description: input.seo_description ?? null,
      canonical_path: input.canonical_path ?? null,
      noindex: input.noindex ?? false,
      created_by: input.createdBy,
      updated_by: input.createdBy,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`blog_posts insert failed: ${error?.message}`);
  return data as BlogPostRow;
}

export type UpdatePostInput = Partial<
  Omit<CreatePostInput, "createdBy" | "slug">
> & {
  slug?: string;
  updatedBy: string | null;
};

export async function updatePost(id: string, input: UpdatePostInput): Promise<void> {
  const admin = createSupabaseAdminClient();
  const patch: Record<string, unknown> = { updated_by: input.updatedBy };
  const keys: (keyof UpdatePostInput)[] = [
    "slug",
    "title",
    "category",
    "kind",
    "excerpt",
    "author",
    "body",
    "hero_media_id",
    "hero_image_path",
    "hero_image_alt",
    "publish_date",
    "date_label",
    "seo_title",
    "seo_description",
    "canonical_path",
    "noindex",
  ];
  for (const k of keys) {
    if (input[k] !== undefined) patch[k] = input[k];
  }
  const { error } = await admin.from("blog_posts").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Transition a post's lifecycle status; stamps published metadata on publish. */
export async function setPostStatus(
  id: string,
  status: PostStatus,
  actorId: string | null,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const patch: Record<string, unknown> = { status, updated_by: actorId };
  if (status === "published") {
    patch.published_at = new Date().toISOString();
    patch.published_by = actorId;
  }
  const { error } = await admin.from("blog_posts").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deletePost(id: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("blog_posts").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function upsertNewsletterAsset(
  postId: string,
  input: {
    pdf_media_id?: string | null;
    pdf_path?: string | null;
    page_media_ids?: string[];
    page_paths?: string[];
  },
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("newsletter_assets").upsert(
    {
      post_id: postId,
      pdf_media_id: input.pdf_media_id ?? null,
      pdf_path: input.pdf_path ?? null,
      page_media_ids: input.page_media_ids ?? [],
      page_paths: input.page_paths ?? [],
    },
    { onConflict: "post_id" },
  );
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Public read (with static fallback)
// ---------------------------------------------------------------------------

function normalizeCategory(c: string): BlogCategory {
  const up = c.toUpperCase();
  if (up === "PRODUCTS" || up === "DEALS" || up === "CULTURE" || up === "NEWSLETTER") {
    return up as BlogCategory;
  }
  return "CULTURE";
}

async function rowToPublic(row: BlogPostRow): Promise<PublicBlogPost> {
  const src = (await resolveMediaSrc(row.hero_media_id, row.hero_image_path)) ?? "/blog/placeholders/products-flower.svg";
  const post: PublicBlogPost = {
    slug: row.slug,
    title: row.title,
    category: normalizeCategory(row.category),
    kind: (row.kind as BlogKind) ?? "article",
    publishDate: row.publish_date ?? row.created_at,
    dateLabel: row.date_label ?? "",
    author: row.author,
    excerpt: row.excerpt ?? "",
    image: { src, alt: row.hero_image_alt ?? row.title },
    content: row.body ?? [],
  };
  if (row.kind === "newsletter") {
    const asset = await getNewsletterAsset(row.id);
    if (asset) {
      const pdfSrc = (await resolveMediaSrc(asset.pdf_media_id, asset.pdf_path)) ?? "";
      const pages: string[] = [];
      // Prefer media ids, then raw paths, preserving order of each array.
      for (const mid of asset.page_media_ids) {
        const u = await resolveMediaSrc(mid, null);
        if (u) pages.push(u);
      }
      for (const p of asset.page_paths) pages.push(p);
      post.newsletter = { pdfSrc, pages };
    }
  }
  return post;
}

/**
 * Public list of published posts. Falls back to the committed static array when
 * the DB is unconfigured or has no published posts (zero-blank guarantee).
 */
export async function getPublicPosts(): Promise<PublicBlogPost[]> {
  if (!isSupabaseServiceConfigured) return staticBlogPosts as PublicBlogPost[];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("blog_posts")
    .select("*")
    .eq("status", "published")
    .order("publish_date", { ascending: false, nullsFirst: false });
  const rows = (data as BlogPostRow[] | null) ?? [];
  if (rows.length === 0) return staticBlogPosts as PublicBlogPost[];
  return Promise.all(rows.map(rowToPublic));
}

/** Public single post by slug; static fallback by slug when not in DB. */
export async function getPublicPost(slug: string): Promise<PublicBlogPost | null> {
  if (isSupabaseServiceConfigured) {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("blog_posts")
      .select("*")
      .eq("slug", slug)
      .eq("status", "published")
      .maybeSingle();
    if (data) return rowToPublic(data as BlogPostRow);
  }
  const fallback = (staticBlogPosts as PublicBlogPost[]).find((p) => p.slug === slug);
  return fallback ?? null;
}

/** All published slugs (for sitemap + static params). Includes static fallback. */
export async function getPublishedSlugs(): Promise<string[]> {
  if (!isSupabaseServiceConfigured) {
    return (staticBlogPosts as PublicBlogPost[]).map((p) => p.slug);
  }
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("blog_posts").select("slug").eq("status", "published");
  const slugs = ((data as { slug: string }[] | null) ?? []).map((r) => r.slug);
  if (slugs.length === 0) return (staticBlogPosts as PublicBlogPost[]).map((p) => p.slug);
  return slugs;
}
