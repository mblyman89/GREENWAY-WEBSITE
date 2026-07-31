-- =============================================================================
-- Slice A (SHOP-1) — Shop (/menu) top-banner carousel slides (staff-managed)
-- =============================================================================
-- Table: shop_carousel_slides
--
-- Replaces the single hardcoded static top banner on /menu (the orange/green
-- radial-gradient blob with the menu.hero title + subtitle) with a staff-
-- editable, draft-aware CAROUSEL of up to ten "special" slides. Each slide is a
-- fully-editable banner (background image + three styled overlay text blocks
-- with per-block fonts / colors / cursive, per-slide CTA buttons, and an
-- optional schedule window) — mirroring the loyalty hero (SLICE 123) powers.
--
-- Design notes:
--  * Mirrors public.home_carousel_slides (migration 0011): each slide carries
--    its OWN published + draft copy so it can be edited and previewed before it
--    goes live, exactly like content_blocks and the home carousel.
--  * The slide's ENTIRE look is stored as JSON in `presentation` (published) and
--    `draft_presentation` (staging), shaped by src/lib/cms/shop-carousel-core.ts
--    (ShopHeroPresentation). Keeping it as one JSON blob means adding a new knob
--    to a slide never needs another migration.
--  * Up to 10 slides are shown publicly (enforced in the app; NOT a hard DB cap
--    so staff can keep an 11th parked/disabled without an error).
--  * Public reads ENABLED + PUBLISHED slides only; staff preview (Draft Mode)
--    reads draft_* and includes draft-enabled slides.
--
-- Reuses: public.set_updated_at(), public.is_staff(), public.staff_profiles,
--         public.media_assets, public.post_status enum (from slice 5).
-- Idempotent: create if not exists + drop policy/trigger if exists.
-- Code ships WORKING PRE-MIGRATION: the store falls back to a single default
-- slide (matching today's banner) until this table exists + is seeded, so the
-- Shop banner never blanks and stays effectively identical until publish.
-- =============================================================================

create table if not exists public.shop_carousel_slides (
  id                 uuid primary key default gen_random_uuid(),
  -- Stable human-friendly key for the slide; unique so seeds + the editor can
  -- address a slide deterministically.
  slide_key          text not null unique,

  -- Ordering among slides (ascending). Lower = earlier.
  sort_order         integer not null default 0,

  -- Lifecycle: 'published' slides can appear publicly; 'draft' only in preview.
  status             public.post_status not null default 'draft',
  -- Whether the slide is turned on at all (staff toggle, independent of status).
  enabled            boolean not null default true,
  draft_enabled      boolean not null default true,

  -- ----- Published value (what the public sees) -----
  -- Full ShopHeroPresentation JSON (image, focuses, aligns, three text blocks,
  -- CTAs, optional schedule). Parsed + normalized by shop-carousel-core.
  presentation       jsonb not null default '{}'::jsonb,

  -- ----- Draft value (what the editor is staging before publish) -----
  draft_presentation jsonb,

  -- Optional media-library links for the images (provenance / future-proofing).
  image_media_id        uuid references public.media_assets(id) on delete set null,
  image_media_id_mobile uuid references public.media_assets(id) on delete set null,

  -- Provenance.
  last_edited_by     uuid references public.staff_profiles(id) on delete set null,
  last_published_by  uuid references public.staff_profiles(id) on delete set null,
  published_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_shop_carousel_sort on public.shop_carousel_slides(sort_order);
create index if not exists idx_shop_carousel_status on public.shop_carousel_slides(status);

-- updated_at trigger
drop trigger if exists trg_shop_carousel_updated on public.shop_carousel_slides;
create trigger trg_shop_carousel_updated before update on public.shop_carousel_slides
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.shop_carousel_slides enable row level security;

-- Staff: full read/write.
drop policy if exists shop_carousel_staff_all on public.shop_carousel_slides;
create policy shop_carousel_staff_all on public.shop_carousel_slides
  for all using (public.is_staff()) with check (public.is_staff());

-- Public: read PUBLISHED + ENABLED slides only.
drop policy if exists shop_carousel_public_read on public.shop_carousel_slides;
create policy shop_carousel_public_read on public.shop_carousel_slides
  for select using (status = 'published' and enabled = true);
