-- =============================================================================
-- Slice 5 — Blog/Newsletter CMS + controlled site-text editor
-- =============================================================================
-- Tables: blog_posts, newsletter_assets, content_blocks, seo_entries
--
-- blog_posts        : database-backed replacement for src/lib/blog/posts.ts.
--                     Draft/scheduled/published/archived lifecycle, slug
--                     uniqueness, categories, hero image, body (paragraph
--                     array), SEO fields. Public reads PUBLISHED only; the
--                     public blog falls back to the static array when empty.
-- newsletter_assets : per-post PDF + ordered page images for "newsletter" kind.
-- content_blocks    : controlled site-text editor (NOT a free-form page
--                     builder). One row per editable key (e.g. home.hero.title)
--                     with separate published_value + draft_value, a field_type,
--                     and SEO-impact flag. Public reads published_value.
-- seo_entries       : per-path / per-entity SEO overrides with Google-style
--                     preview support and sitemap inclusion control.
--
-- Reuses: asset_status enum, public.set_updated_at(), public.is_staff(),
--         public.staff_profiles, public.media_assets (all from earlier slices).
-- Idempotent: create if not exists + drop policy/trigger if exists.
-- =============================================================================

-- A post lifecycle enum that adds 'scheduled' on top of the asset_status set.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'post_status') then
    create type public.post_status as enum ('draft', 'scheduled', 'published', 'archived');
  end if;
end$$;

-- ---------- blog_posts -------------------------------------------------------
create table if not exists public.blog_posts (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  title             text not null,
  -- PRODUCTS | DEALS | CULTURE | NEWSLETTER (free text so future categories
  -- can be added without a migration; validated in the app layer).
  category          text not null default 'CULTURE',
  -- article | newsletter
  kind              text not null default 'article',
  status            public.post_status not null default 'draft',
  excerpt           text,
  author            text not null default 'Greenway Team',
  -- Body stored as an ordered array of paragraph strings (mirrors the existing
  -- BlogPost.content[] shape; rich text/markdown stored as paragraph blocks).
  body              text[] not null default '{}',
  -- Hero image: prefer a media_assets reference; keep a raw path for migrated
  -- static posts whose images still live under /public/blog/...
  hero_media_id     uuid references public.media_assets(id) on delete set null,
  hero_image_path   text,
  hero_image_alt    text,
  -- Publish scheduling. publish_date is the display/scheduled date.
  publish_date      timestamptz,
  date_label        text,                                 -- e.g. "JUN 20, 2026"
  published_at      timestamptz,
  -- SEO overrides (fallback to derived values when null).
  seo_title         text,
  seo_description   text,
  canonical_path    text,
  og_media_id       uuid references public.media_assets(id) on delete set null,
  noindex           boolean not null default false,
  -- Provenance.
  created_by        uuid references public.staff_profiles(id) on delete set null,
  updated_by        uuid references public.staff_profiles(id) on delete set null,
  published_by      uuid references public.staff_profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_blog_posts_status on public.blog_posts(status);
create index if not exists idx_blog_posts_category on public.blog_posts(category);
create index if not exists idx_blog_posts_publish_date on public.blog_posts(publish_date desc);

-- ---------- newsletter_assets ------------------------------------------------
create table if not exists public.newsletter_assets (
  id              uuid primary key default gen_random_uuid(),
  post_id         uuid not null references public.blog_posts(id) on delete cascade,
  -- The source PDF (preferred via media_assets; raw path for migrated assets).
  pdf_media_id    uuid references public.media_assets(id) on delete set null,
  pdf_path        text,
  -- Ordered page images. media ids preferred; raw paths supported for migrated
  -- newsletters whose page images live under /public/blog/newsletters/...
  page_media_ids  uuid[] not null default '{}',
  page_paths      text[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists idx_newsletter_assets_post on public.newsletter_assets(post_id);

-- ---------- content_blocks ---------------------------------------------------
create table if not exists public.content_blocks (
  id                uuid primary key default gen_random_uuid(),
  -- Stable dotted key, e.g. home.hero.title. One row per editable slot.
  block_key         text not null unique,
  page              text not null,                        -- home | menu | loyalty | vendors | footer | business | specials
  section           text,                                 -- hero | outreach | compliance | hours | ...
  label             text not null,                        -- human-friendly label in the editor
  help_text         text,                                 -- guidance for staff
  -- plain | rich | markdown | url | phone | email | image
  field_type        text not null default 'plain',
  published_value   text,
  draft_value       text,
  -- Optional JSON validation hints (max length, required, pattern, ...).
  validation        jsonb,
  -- True when editing this block can affect SEO (shows a warning in the editor).
  seo_impact        boolean not null default false,
  status            public.post_status not null default 'published',
  last_edited_by    uuid references public.staff_profiles(id) on delete set null,
  last_published_by uuid references public.staff_profiles(id) on delete set null,
  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_content_blocks_page on public.content_blocks(page);

-- ---------- seo_entries ------------------------------------------------------
create table if not exists public.seo_entries (
  id                uuid primary key default gen_random_uuid(),
  -- Either a route path (e.g. /menu) OR an entity reference. path is unique when set.
  path              text unique,
  entity_type       text,                                 -- page | product | blog | vendor | brand
  entity_id         text,
  seo_title         text,
  seo_description   text,
  canonical         text,
  og_media_id       uuid references public.media_assets(id) on delete set null,
  noindex           boolean not null default false,
  -- Sitemap inclusion control for published content.
  sitemap_include   boolean not null default true,
  status            public.post_status not null default 'published',
  updated_by        uuid references public.staff_profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_seo_entries_entity on public.seo_entries(entity_type, entity_id);

-- ---------- updated_at triggers ---------------------------------------------
drop trigger if exists trg_blog_posts_updated on public.blog_posts;
create trigger trg_blog_posts_updated before update on public.blog_posts
  for each row execute function public.set_updated_at();

drop trigger if exists trg_newsletter_assets_updated on public.newsletter_assets;
create trigger trg_newsletter_assets_updated before update on public.newsletter_assets
  for each row execute function public.set_updated_at();

drop trigger if exists trg_content_blocks_updated on public.content_blocks;
create trigger trg_content_blocks_updated before update on public.content_blocks
  for each row execute function public.set_updated_at();

drop trigger if exists trg_seo_entries_updated on public.seo_entries;
create trigger trg_seo_entries_updated before update on public.seo_entries
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.blog_posts        enable row level security;
alter table public.newsletter_assets enable row level security;
alter table public.content_blocks    enable row level security;
alter table public.seo_entries       enable row level security;

-- blog_posts: staff read/write all; PUBLIC reads only PUBLISHED.
drop policy if exists blog_posts_staff_all on public.blog_posts;
create policy blog_posts_staff_all on public.blog_posts
  for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists blog_posts_public_read_published on public.blog_posts;
create policy blog_posts_public_read_published on public.blog_posts
  for select using (status = 'published');

-- newsletter_assets: staff read/write all; PUBLIC reads when parent post is published.
drop policy if exists newsletter_assets_staff_all on public.newsletter_assets;
create policy newsletter_assets_staff_all on public.newsletter_assets
  for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists newsletter_assets_public_read on public.newsletter_assets;
create policy newsletter_assets_public_read on public.newsletter_assets
  for select using (
    exists (
      select 1 from public.blog_posts p
      where p.id = newsletter_assets.post_id and p.status = 'published'
    )
  );

-- content_blocks: staff read/write all; PUBLIC reads published_value of published rows.
drop policy if exists content_blocks_staff_all on public.content_blocks;
create policy content_blocks_staff_all on public.content_blocks
  for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists content_blocks_public_read on public.content_blocks;
create policy content_blocks_public_read on public.content_blocks
  for select using (status = 'published');

-- seo_entries: staff read/write all; PUBLIC reads published rows.
drop policy if exists seo_entries_staff_all on public.seo_entries;
create policy seo_entries_staff_all on public.seo_entries
  for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists seo_entries_public_read on public.seo_entries;
create policy seo_entries_public_read on public.seo_entries
  for select using (status = 'published');
