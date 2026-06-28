-- =============================================================================
-- Slice 11 — Home hero carousel slides (staff-managed)
-- =============================================================================
-- Table: home_carousel_slides
--
-- Replaces the hardcoded SLIDES[] array in src/components/home/Hero.tsx with a
-- staff-editable, draft-aware set of slides. Each slide carries its OWN
-- published/draft copy + image so a slide can be edited and previewed before it
-- goes live — mirroring the content_blocks lifecycle exactly.
--
-- Design notes:
--  * Up to 6 slides are shown publicly (enforced in the app; not a hard DB cap
--    so staff can keep a 7th disabled/parked without an error).
--  * CTAs are stored as JSONB: [{ "href": "/menu", "label": "Shop", "variant": "solid" }].
--    Max 2 CTAs per slide (validated in the app layer).
--  * Layout knobs (image focus + text alignment) are simple enums kept as text
--    so the editor can offer a friendly dropdown without a migration per option.
--  * Public reads ENABLED + PUBLISHED slides only; staff preview (Draft Mode)
--    reads draft_* and includes draft-enabled slides.
--
-- Reuses: public.set_updated_at(), public.is_staff(), public.staff_profiles,
--         public.media_assets, public.post_status enum (from slice 5).
-- Idempotent: create if not exists + drop policy/trigger if exists.
-- =============================================================================

create table if not exists public.home_carousel_slides (
  id                 uuid primary key default gen_random_uuid(),
  -- Stable human-friendly key for the slide (e.g. "welcome"); unique so seeds
  -- and the editor can address a slide deterministically.
  slide_key          text not null unique,

  -- Ordering among slides (ascending). Lower = earlier.
  sort_order         integer not null default 0,

  -- Lifecycle: 'published' slides can appear publicly; 'draft' only in preview.
  status             public.post_status not null default 'draft',
  -- Whether the slide is turned on at all (staff toggle, independent of status).
  -- Published value the public sees; draft value the editor is staging.
  enabled            boolean not null default true,
  draft_enabled      boolean not null default true,

  -- ----- Published values (what the public sees) -----
  image              text,                 -- background image path or media URL
  image_alt          text,
  -- 'left' | 'center' | 'right' — where the focal point of the art sits.
  image_focus        text not null default 'right',
  -- 'left' | 'right' — which side the headline/text block aligns to.
  text_align         text not null default 'left',
  eyebrow            text,
  title              text,
  description        text,
  ctas               jsonb not null default '[]'::jsonb,

  -- ----- Draft values (what the editor is staging before publish) -----
  draft_image        text,
  draft_image_alt    text,
  draft_image_focus  text,
  draft_text_align   text,
  draft_eyebrow      text,
  draft_title        text,
  draft_description  text,
  draft_ctas         jsonb,

  -- Optional media-library link for the image (provenance / future-proofing).
  image_media_id     uuid references public.media_assets(id) on delete set null,

  -- Provenance.
  last_edited_by     uuid references public.staff_profiles(id) on delete set null,
  last_published_by  uuid references public.staff_profiles(id) on delete set null,
  published_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_home_carousel_sort on public.home_carousel_slides(sort_order);
create index if not exists idx_home_carousel_status on public.home_carousel_slides(status);

-- updated_at trigger
drop trigger if exists trg_home_carousel_updated on public.home_carousel_slides;
create trigger trg_home_carousel_updated before update on public.home_carousel_slides
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.home_carousel_slides enable row level security;

-- Staff: full read/write.
drop policy if exists home_carousel_staff_all on public.home_carousel_slides;
create policy home_carousel_staff_all on public.home_carousel_slides
  for all using (public.is_staff()) with check (public.is_staff());

-- Public: read PUBLISHED + ENABLED slides only.
drop policy if exists home_carousel_public_read on public.home_carousel_slides;
create policy home_carousel_public_read on public.home_carousel_slides
  for select using (status = 'published' and enabled = true);
