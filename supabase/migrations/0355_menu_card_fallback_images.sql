-- =============================================================================
-- 0355 - menu card fallback images: one picture per WEBSITE category (D224)
-- =============================================================================
-- SQL EDITOR: if the editor shows "Potential issue detected", click
-- "Run without RLS". The new table is service-role only with row level
-- security on, like media_collections.
-- The comments in this file carry no apostrophes and no semicolons, so it is
-- safe to paste as is (no separate editor-safe copy is needed).
--
-- Owner (D224, 2026-11-10), quoted in full in
-- docs/sop-program/00-OWNER-REQUEST-VERBATIM.md: one fallback image per website
-- category that automatically shows on every card in that category without a
-- product image set.
--
-- WHAT THIS MIGRATION DOES
--   menu_card_fallback_images: ONE row per website category (the primary key is
--   the category, so a second picture for the same category is impossible).
--   Each row points at a media_assets picture. The website (shop, category
--   pages, home, specials, product page and its related rail), the register
--   info card, and the admin product page show it on every card in that
--   category that has no photo of its own. Only the product own photo beats
--   it. It replaces the older generic substitutes (brand, vendor, POS category,
--   inventory type, global) on those cards, because the owner chose it.
--
--   The category list is the 21 website categories
--   (src/lib/pos/category-taxonomy.ts websiteCategoryDefinitions). The check
--   below refuses anything else, so a typo can never create a dead row.
--
--   Deleting a library picture that is a fallback is already blocked by the
--   media library (the usage ledger records it). If the picture row is ever
--   removed anyway, the fallback row goes with it (on delete cascade) and the
--   cards go back to the mockup. Nothing else is touched.
--
-- Idempotent: "if not exists" throughout. Safe to re-run.
-- Rollback: supabase/rollbacks/0355_menu_card_fallback_images.rollback.sql
-- =============================================================================

create table if not exists public.menu_card_fallback_images (
  website_category text primary key
    check (website_category in (
      'flower', 'popcorn-bud', 'infused-flower', 'accessories', 'merch',
      'paraphernalia', 'preroll', 'blunt', 'preroll-pack', 'infused-preroll',
      'infused-blunt', 'infused-preroll-pack', 'cartridge',
      'disposable-cartridge', 'concentrate', 'rso', 'edible-solid',
      'edible-liquid', 'tincture', 'topical', 'trim'
    )),
  media_id         uuid not null references public.media_assets(id) on delete cascade,
  updated_by       uuid references public.staff_profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_menu_card_fallback_images_media
  on public.menu_card_fallback_images(media_id);

alter table public.menu_card_fallback_images enable row level security;
revoke all on table public.menu_card_fallback_images from public, anon, authenticated;
grant select, insert, update, delete on table public.menu_card_fallback_images to service_role;

comment on table public.menu_card_fallback_images is
  'D224 (0355): one fallback picture per website category, shown on every menu card in that category that has no photo of its own. Chosen by a person on /admin/menu-card-fallbacks. Service role only.';

notify pgrst, 'reload schema';
