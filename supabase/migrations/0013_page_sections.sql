-- ===========================================================================
-- Greenway Back Office — Migration 0013: page_sections (generic page builder)
--
-- One table powers the editable banners / sections on EVERY page (home, menu,
-- loyalty, specials, vendors, faq, about, locations, price-match, ...). It
-- generalizes the home_carousel_slides pattern (0011): each row carries its own
-- PUBLISHED copy + a DRAFT mirror so staff can edit + preview before publishing,
-- exactly like content_blocks and the carousel.
--
-- Buttons are stored as jsonb so an editor can add/delete/relabel/restyle the
-- call-to-action buttons on any banner.
--
-- Caps (e.g. "home = 4 sections total") are enforced in the store layer, not in
-- the DB, so the cap can vary per page.
--
-- Idempotent: safe to run more than once.
-- ===========================================================================

create table if not exists public.page_sections (
  id            uuid primary key default gen_random_uuid(),
  -- Which public page this section belongs to, e.g. 'home' | 'menu' | 'loyalty'
  -- | 'specials' | 'vendors' | 'faq' | 'about' | 'locations' | 'price-match'.
  page_slug     text not null,
  -- Stable per-page key for seeding/lookup (e.g. 'home.category', 'home.brand').
  section_key   text not null,
  -- Section variety, drives which renderer is used: 'banner' (default) |
  -- 'highlight' | 'feature'. The locked home daily-special is NOT stored here.
  kind          text not null default 'banner',

  sort_order    int  not null default 0,
  status        public.post_status not null default 'draft',
  enabled       boolean not null default true,
  draft_enabled boolean not null default true,
  -- locked sections are shown in the editor read-only (cannot edit/delete).
  locked        boolean not null default false,

  -- ----- PUBLISHED content -----
  image          text,
  image_alt      text,
  image_focus    text not null default 'center',   -- center|top|bottom|left|right
  text_align     text not null default 'left',      -- left|center|right
  eyebrow        text,
  title          text,
  subtitle       text,
  body           text,
  buttons        jsonb not null default '[]'::jsonb, -- [{label,href,variant,enabled}]
  settings       jsonb not null default '{}'::jsonb, -- per-kind extras (font, bg, product filter)

  -- ----- DRAFT mirror -----
  draft_image          text,
  draft_image_alt      text,
  draft_image_focus    text,
  draft_text_align     text,
  draft_eyebrow        text,
  draft_title          text,
  draft_subtitle       text,
  draft_body           text,
  draft_buttons        jsonb,
  draft_settings       jsonb,

  image_media_id     uuid references public.media_assets(id) on delete set null,
  last_edited_by     uuid references public.staff_profiles(id) on delete set null,
  last_published_by  uuid references public.staff_profiles(id) on delete set null,
  published_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  unique (page_slug, section_key)
);

create index if not exists idx_page_sections_page on public.page_sections(page_slug);
create index if not exists idx_page_sections_order on public.page_sections(page_slug, sort_order);
create index if not exists idx_page_sections_status on public.page_sections(status);

-- updated_at trigger
drop trigger if exists trg_page_sections_updated on public.page_sections;
create trigger trg_page_sections_updated before update on public.page_sections
  for each row execute function public.set_updated_at();

-- RLS
alter table public.page_sections enable row level security;

-- Staff can do everything (the app gates writes behind requirePermission too).
drop policy if exists page_sections_staff_all on public.page_sections;
create policy page_sections_staff_all on public.page_sections
  for all using (public.is_staff()) with check (public.is_staff());

-- Public can read PUBLISHED + ENABLED sections (so public pages render them).
drop policy if exists page_sections_public_read on public.page_sections;
create policy page_sections_public_read on public.page_sections
  for select using (status = 'published' and enabled = true);
