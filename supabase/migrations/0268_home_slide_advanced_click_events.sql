-- ===========================================================================
-- 0268_home_slide_advanced_click_events.sql
--
-- R47 (owner-requested "R47-S2 first" round).
--
-- PART 1 - HOME CAROUSEL ADVANCED OPTIONS
--   The Shop banner, Specials and Loyalty heroes already have the "fancy"
--   options: per-line font / colour / show, a separate phone picture,
--   5-way picture focus for desktop and phone, centred text, top / middle /
--   bottom text, a start / end window, and the free-form Banner Studio.
--   The home carousel now gets the same, stored as ONE optional jsonb per
--   slide (shape: src/lib/cms/home-slide-advanced-core.ts), with a draft copy
--   so the existing draft -> Publish flow keeps working:
--     home_carousel_slides.advanced        what visitors see
--     home_carousel_slides.draft_advanced  what the editor is working on
--   NULL = the slide looks exactly as it did before R47.
--
-- PART 2 - WEBSITE CLICK EVENTS (Reports > Website)
--   One row per press of a banner / slide button on the public website.
--   PRIVACY: no cookies, no IP address, no user id, no user-agent string.
--   Only: when, which page, which banner / slide, which button, where it
--   pointed, and a coarse device class (phone / tablet / desktop). The
--   browser does not send anything when Global Privacy Control is on, and
--   staff / admin pages never send (same rule as Google Analytics).
--   Rows are written by the server (service role) from POST /api/clicks;
--   staff can read them; nobody else can read or write.
--
-- The website works BEFORE this is applied: the carousel save falls back to
-- the classic columns, the click endpoint answers 204 and stores nothing,
-- and Reports > Website says "apply migration 0268".
--
-- FACTORY RESET: website_click_events is KEEP in factory-reset-core.ts
-- (anonymous website analytics; the reset function's pinned WIPE list from
-- 0240 is deliberately not reopened). The two new carousel columns live on
-- home_carousel_slides, which is already KEEP.
-- IDEMPOTENT (add column if not exists, create if not exists, guarded
-- constraints, drop/create policies). APPLY MANUALLY in the Supabase SQL
-- editor.
-- ROLLBACK: supabase/rollbacks/0268_home_slide_advanced_click_events.rollback.sql
-- ===========================================================================

do $precheck$
begin
  if to_regprocedure('public.is_staff()') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0268 depends on is_staff() from 0001';
  end if;
  if to_regclass('public.home_carousel_slides') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0268 depends on home_carousel_slides from 0011';
  end if;
end
$precheck$;

-- ---------------------------------------------------------------------------
-- PART 1: home carousel advanced options
-- ---------------------------------------------------------------------------
alter table public.home_carousel_slides
  add column if not exists advanced jsonb,
  add column if not exists draft_advanced jsonb;

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'home_carousel_slides_advanced_obj_chk'
                   and conrelid = 'public.home_carousel_slides'::regclass) then
    alter table public.home_carousel_slides add constraint home_carousel_slides_advanced_obj_chk
      check (advanced is null or jsonb_typeof(advanced) = 'object');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'home_carousel_slides_draft_advanced_obj_chk'
                   and conrelid = 'public.home_carousel_slides'::regclass) then
    alter table public.home_carousel_slides add constraint home_carousel_slides_draft_advanced_obj_chk
      check (draft_advanced is null or jsonb_typeof(draft_advanced) = 'object');
  end if;
end
$c$;

-- ---------------------------------------------------------------------------
-- PART 2: website_click_events
-- ---------------------------------------------------------------------------
create table if not exists public.website_click_events (
  id            bigint generated always as identity primary key,
  occurred_at   timestamptz not null default now(),
  page_path     text not null,
  -- home_hero | shop_banner | specials_hero | loyalty_hero | section | other
  placement     text not null,
  -- the slide / banner id (or section key) the button sits on
  slot_key      text,
  -- what the owner called it when it was clicked ("Black Friday slide")
  slot_label    text,
  slot_position integer,
  button_label  text,
  target_href   text,
  device        text not null default 'desktop'
);

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'website_click_events_placement_chk'
                   and conrelid = 'public.website_click_events'::regclass) then
    alter table public.website_click_events add constraint website_click_events_placement_chk
      check (placement in ('home_hero', 'shop_banner', 'specials_hero', 'loyalty_hero', 'section', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'website_click_events_device_chk'
                   and conrelid = 'public.website_click_events'::regclass) then
    alter table public.website_click_events add constraint website_click_events_device_chk
      check (device in ('phone', 'tablet', 'desktop'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'website_click_events_len_chk'
                   and conrelid = 'public.website_click_events'::regclass) then
    alter table public.website_click_events add constraint website_click_events_len_chk
      check (char_length(page_path) between 1 and 300
         and (slot_key is null or char_length(slot_key) <= 120)
         and (slot_label is null or char_length(slot_label) <= 160)
         and (button_label is null or char_length(button_label) <= 120)
         and (target_href is null or char_length(target_href) <= 500)
         and (slot_position is null or slot_position between 0 and 99));
  end if;
end
$c$;

create index if not exists website_click_events_time_idx
  on public.website_click_events (occurred_at desc);
create index if not exists website_click_events_slot_idx
  on public.website_click_events (placement, slot_key, occurred_at desc);

alter table public.website_click_events enable row level security;
drop policy if exists website_click_events_staff_read on public.website_click_events;
create policy website_click_events_staff_read on public.website_click_events
  for select using (public.is_staff());
grant select, insert, delete on public.website_click_events to service_role;

notify pgrst, 'reload schema';
