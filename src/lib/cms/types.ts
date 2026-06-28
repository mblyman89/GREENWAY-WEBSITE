/**
 * src/lib/cms/types.ts
 *
 * Shared types for the Slice 5 CMS: blog posts + newsletters, controlled
 * content blocks, and SEO entries. These mirror the 0005 migration columns.
 */

export type PostStatus = "draft" | "scheduled" | "published" | "archived";

/** Categories match the existing static blog model; free text in DB. */
export type BlogCategory = "PRODUCTS" | "DEALS" | "CULTURE" | "NEWSLETTER";
export const BLOG_CATEGORIES: BlogCategory[] = ["PRODUCTS", "DEALS", "CULTURE", "NEWSLETTER"];

export type BlogKind = "article" | "newsletter";

export type BlogPostRow = {
  id: string;
  slug: string;
  title: string;
  category: string;
  kind: string;
  status: PostStatus;
  excerpt: string | null;
  author: string;
  body: string[];
  hero_media_id: string | null;
  hero_image_path: string | null;
  hero_image_alt: string | null;
  publish_date: string | null;
  date_label: string | null;
  published_at: string | null;
  seo_title: string | null;
  seo_description: string | null;
  canonical_path: string | null;
  og_media_id: string | null;
  noindex: boolean;
  created_by: string | null;
  updated_by: string | null;
  published_by: string | null;
  created_at: string;
  updated_at: string;
};

export type NewsletterAssetRow = {
  id: string;
  post_id: string;
  pdf_media_id: string | null;
  pdf_path: string | null;
  page_media_ids: string[];
  page_paths: string[];
  created_at: string;
  updated_at: string;
};

/** Field types for controlled content blocks. */
export type ContentFieldType =
  | "plain"
  | "rich"
  | "markdown"
  | "url"
  | "phone"
  | "email"
  | "image";

export type ContentBlockRow = {
  id: string;
  block_key: string;
  page: string;
  section: string | null;
  label: string;
  help_text: string | null;
  field_type: ContentFieldType;
  published_value: string | null;
  draft_value: string | null;
  validation: Record<string, unknown> | null;
  seo_impact: boolean;
  status: PostStatus;
  last_edited_by: string | null;
  last_published_by: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SeoEntryRow = {
  id: string;
  path: string | null;
  entity_type: string | null;
  entity_id: string | null;
  seo_title: string | null;
  seo_description: string | null;
  canonical: string | null;
  og_media_id: string | null;
  noindex: boolean;
  sitemap_include: boolean;
  status: PostStatus;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Shape consumed by the public blog UI (matches the legacy BlogPost type). */
export type PublicBlogPost = {
  slug: string;
  title: string;
  category: BlogCategory;
  kind?: BlogKind;
  publishDate: string;
  dateLabel: string;
  author: string;
  excerpt: string;
  image: { src: string; alt: string };
  content: string[];
  newsletter?: { pdfSrc: string; pages: string[] };
};
