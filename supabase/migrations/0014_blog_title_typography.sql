-- =============================================================================
-- 0014 — Blog/newsletter editable title typography
-- =============================================================================
-- Adds per-post title typography controls so a non-technical editor can style
-- a post's headline from the carousel-style blog editor:
--   - title_font : a font id from the curated registry (src/lib/cms/fonts.ts),
--                  e.g. 'poppins'. NULL/'inherit' = use the site heading font.
--   - title_size : a bounded scale token applied on the card + article hero:
--                  'sm' | 'md' (default) | 'lg' | 'xl'.
--   - title_color: optional hex (e.g. '#ffd700'); NULL = theme default (white).
--
-- Bounded choices (not free CSS) keep editor output on-brand and safe.
-- Idempotent: add column if not exists.
-- =============================================================================

alter table public.blog_posts
  add column if not exists title_font  text,
  add column if not exists title_size  text not null default 'md',
  add column if not exists title_color text;

-- Guard the size token to the supported set (defensive; app also validates).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'blog_posts_title_size_chk'
  ) then
    alter table public.blog_posts
      add constraint blog_posts_title_size_chk
      check (title_size in ('sm', 'md', 'lg', 'xl'));
  end if;
end$$;
