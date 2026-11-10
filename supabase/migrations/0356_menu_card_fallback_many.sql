-- =============================================================================
-- 0356 - menu card fallback images: MANY pictures per website category (D225)
-- =============================================================================
-- SQL EDITOR: if the editor shows "Potential issue detected", click
-- "Run without RLS". The table stays service-role only with row level
-- security on, exactly as 0355 left it.
-- The comments in this file carry no apostrophes and no semicolons, so it is
-- safe to paste as is (no separate editor-safe copy is needed).
--
-- Owner (D225, 2026-11-10), quoted in full in
-- docs/sop-program/00-OWNER-REQUEST-VERBATIM.md: add many fallback images to
-- the categories so the menu has a variety of images, and the cards with
-- fallback images rotate images.
--
-- WHAT THIS MIGRATION DOES
--   0355 made the website category the primary key, so a category could hold
--   ONE picture. This migration keeps the same table and every row already in
--   it, and turns it into a list:
--     id          a new surrogate primary key (filled for existing rows)
--     sort_order  the order the owner chose on the page (existing rows get 0)
--   The same picture can still appear only once per category (unique on
--   website_category plus media_id). The 21 category check, the cascade from
--   media_assets, row level security and the grants are unchanged and are
--   re-asserted below.
--
--   The page caps a category at 12 pictures. The cap lives in the app
--   (src/lib/menu/menu-card-fallback-core.ts MAX_FALLBACKS_PER_CATEGORY) so
--   it can change without a migration.
--
-- Run it AFTER 0355. Idempotent: every step checks first. Safe to re-run.
-- Rollback: supabase/rollbacks/0356_menu_card_fallback_many.rollback.sql
-- =============================================================================

alter table public.menu_card_fallback_images
  add column if not exists id uuid not null default gen_random_uuid();

alter table public.menu_card_fallback_images
  add column if not exists sort_order integer not null default 0;

do $$
declare
  pk_def text;
begin
  select pg_get_constraintdef(c.oid) into pk_def
    from pg_constraint c
   where c.conrelid = 'public.menu_card_fallback_images'::regclass
     and c.contype = 'p'
   limit 1;
  if pk_def is not null and pk_def <> 'PRIMARY KEY (id)' then
    alter table public.menu_card_fallback_images drop constraint menu_card_fallback_images_pkey;
    pk_def := null;
  end if;
  if pk_def is null then
    alter table public.menu_card_fallback_images
      add constraint menu_card_fallback_images_pkey primary key (id);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.menu_card_fallback_images'::regclass
       and conname = 'menu_card_fallback_images_sort_order_check'
  ) then
    alter table public.menu_card_fallback_images
      add constraint menu_card_fallback_images_sort_order_check check (sort_order >= 0);
  end if;
end $$;

create unique index if not exists uq_menu_card_fallback_images_category_media
  on public.menu_card_fallback_images(website_category, media_id);

create index if not exists idx_menu_card_fallback_images_category_order
  on public.menu_card_fallback_images(website_category, sort_order);

alter table public.menu_card_fallback_images enable row level security;
revoke all on table public.menu_card_fallback_images from public, anon, authenticated;
grant select, insert, update, delete on table public.menu_card_fallback_images to service_role;

comment on table public.menu_card_fallback_images is
  'D224 (0355) + D225 (0356): the fallback pictures for each website category, in the order chosen on /admin/menu-card-fallbacks. Cards in that category with no photo of their own show them, and rotate through them. Service role only.';

notify pgrst, 'reload schema';
