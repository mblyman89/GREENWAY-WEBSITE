-- ===========================================================================
-- 0267_content_schedule_releases.sql
--
-- R46 (owner-requested R45-R48 "top off the website editor").
-- SCHEDULED PUBLISH / UNPUBLISH (R46-S1) and RELEASES (R46-S2).
--
-- WHY: every enterprise CMS lets you say "put this banner live Friday at
-- 9 AM and take it down Sunday night" (Contentful Scheduled actions, Sanity
-- Scheduled drafts, Storyblok Releases), and lets you group several changes
-- into one named RELEASE that goes live together ("Black Friday": three
-- slides, a section and an FAQ answer, all at 6 AM). Before this, a sale
-- banner meant someone at a computer pressing Publish at the right minute.
--
-- WHAT THIS ADDS - two tables, no function, no change to existing tables:
--
--   content_releases   a named group of scheduled changes.
--                      status: draft (collecting items) | scheduled (has a
--                      time) | published | cancelled.
--
--   content_schedule   one row = "do ACTION to THING at TIME".
--                      target_kind  carousel_slide | shop_slide | page_section
--                                   | faq_item | content_block
--                      target_key   the row id (uuid text) or, for
--                                   content_block, its block_key
--                      action       publish | unpublish
--                                   (content_block: publish only; the app
--                                   enforces it and so does a CHECK)
--                      run_at       when (UTC; the editor converts from
--                                   Pacific). NULL only while the row is
--                                   'held' inside a release with no time yet.
--                      status       held | pending | running | done | failed
--                                   | cancelled
--                      release_id   NULL for a stand-alone schedule.
--
-- HOW IT RUNS: /api/cron/content-schedule wakes every 5 minutes (vercel.json),
-- claims due rows with a compare-and-swap on status (pending -> running), and
-- calls the SAME publish function the editor's Publish button calls.
-- Unpublish turns the item off (enabled = false) - the public read rule on
-- each of those tables is status = 'published' AND enabled = true. A row left
-- 'running' by a killed run is retried after 10 minutes; publishing is
-- idempotent so a retry is safe. Three failures -> 'failed' with the reason.
--
-- The website works BEFORE this is applied: the Schedule panels say "apply
-- migration 0267" and the cron returns skipped "no_table".
--
-- FACTORY RESET: both tables are KEEP in
-- src/lib/accounting/factory-reset-core.ts (your planned website changes,
-- like the content they point at, which is also KEEP).
-- IDEMPOTENT (create if not exists, guarded constraints, drop/create
-- policies). APPLY MANUALLY in the Supabase SQL editor.
-- ROLLBACK: supabase/rollbacks/0267_content_schedule_releases.rollback.sql
-- ===========================================================================

do $precheck$
begin
  if to_regprocedure('public.is_staff()') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0267 depends on is_staff() from 0001';
  end if;
  if to_regclass('public.staff_profiles') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0267 depends on staff_profiles from 0001';
  end if;
end
$precheck$;

-- ---------------------------------------------------------------------------
-- content_releases
-- ---------------------------------------------------------------------------
create table if not exists public.content_releases (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  note          text,
  status        text not null default 'draft',
  run_at        timestamptz,
  created_by    uuid references public.staff_profiles(id) on delete set null,
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'content_releases_status_chk'
                   and conrelid = 'public.content_releases'::regclass) then
    alter table public.content_releases add constraint content_releases_status_chk
      check (status in ('draft', 'scheduled', 'published', 'cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'content_releases_name_chk'
                   and conrelid = 'public.content_releases'::regclass) then
    alter table public.content_releases add constraint content_releases_name_chk
      check (char_length(btrim(name)) between 1 and 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'content_releases_note_chk'
                   and conrelid = 'public.content_releases'::regclass) then
    alter table public.content_releases add constraint content_releases_note_chk
      check (note is null or char_length(note) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'content_releases_scheduled_has_time'
                   and conrelid = 'public.content_releases'::regclass) then
    alter table public.content_releases add constraint content_releases_scheduled_has_time
      check (status <> 'scheduled' or run_at is not null);
  end if;
end
$c$;

create index if not exists content_releases_status_idx on public.content_releases (status, run_at);

drop trigger if exists content_releases_set_updated_at on public.content_releases;
create trigger content_releases_set_updated_at
  before update on public.content_releases
  for each row execute function public.set_updated_at();

alter table public.content_releases enable row level security;
drop policy if exists content_releases_staff_all on public.content_releases;
create policy content_releases_staff_all on public.content_releases
  for all using (public.is_staff()) with check (public.is_staff());
grant select, insert, update, delete on public.content_releases to service_role;

-- ---------------------------------------------------------------------------
-- content_schedule
-- ---------------------------------------------------------------------------
create table if not exists public.content_schedule (
  id            uuid primary key default gen_random_uuid(),
  target_kind   text not null,
  target_key    text not null,
  -- What the owner saw when scheduling ("Black Friday slide"), so the list
  -- reads well even after the item is renamed or deleted.
  target_label  text,
  action        text not null,
  run_at        timestamptz,
  status        text not null default 'pending',
  release_id    uuid references public.content_releases(id) on delete cascade,
  attempts      integer not null default 0,
  claimed_at    timestamptz,
  ran_at        timestamptz,
  error         text,
  created_by    uuid references public.staff_profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'content_schedule_kind_chk'
                   and conrelid = 'public.content_schedule'::regclass) then
    alter table public.content_schedule add constraint content_schedule_kind_chk
      check (target_kind in ('carousel_slide', 'shop_slide', 'page_section', 'faq_item', 'content_block'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'content_schedule_action_chk'
                   and conrelid = 'public.content_schedule'::regclass) then
    alter table public.content_schedule add constraint content_schedule_action_chk
      check (action in ('publish', 'unpublish')
             and not (target_kind = 'content_block' and action = 'unpublish'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'content_schedule_status_chk'
                   and conrelid = 'public.content_schedule'::regclass) then
    alter table public.content_schedule add constraint content_schedule_status_chk
      check (status in ('held', 'pending', 'running', 'done', 'failed', 'cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'content_schedule_time_chk'
                   and conrelid = 'public.content_schedule'::regclass) then
    -- Only a row held inside a release may be without a time.
    alter table public.content_schedule add constraint content_schedule_time_chk
      check (run_at is not null or (status in ('held', 'cancelled') and release_id is not null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'content_schedule_key_chk'
                   and conrelid = 'public.content_schedule'::regclass) then
    alter table public.content_schedule add constraint content_schedule_key_chk
      check (char_length(target_key) between 1 and 160);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'content_schedule_text_len_chk'
                   and conrelid = 'public.content_schedule'::regclass) then
    alter table public.content_schedule add constraint content_schedule_text_len_chk
      check ((target_label is null or char_length(target_label) <= 200)
             and (error is null or char_length(error) <= 1000)
             and attempts between 0 and 100);
  end if;
end
$c$;

-- The cron's one query: due work, oldest first.
create index if not exists content_schedule_due_idx
  on public.content_schedule (run_at)
  where status in ('pending', 'running');
-- The editor's per-item lookup ("this slide goes live Friday").
create index if not exists content_schedule_target_idx
  on public.content_schedule (target_kind, target_key)
  where status in ('held', 'pending', 'running');
create index if not exists content_schedule_release_idx
  on public.content_schedule (release_id)
  where release_id is not null;
-- A double-click (or a doubled form post) must not create two identical
-- pending schedules.
create unique index if not exists content_schedule_no_dupe_uq
  on public.content_schedule (target_kind, target_key, action, run_at)
  where status = 'pending' and release_id is null;

drop trigger if exists content_schedule_set_updated_at on public.content_schedule;
create trigger content_schedule_set_updated_at
  before update on public.content_schedule
  for each row execute function public.set_updated_at();

alter table public.content_schedule enable row level security;
drop policy if exists content_schedule_staff_all on public.content_schedule;
create policy content_schedule_staff_all on public.content_schedule
  for all using (public.is_staff()) with check (public.is_staff());
grant select, insert, update, delete on public.content_schedule to service_role;

notify pgrst, 'reload schema';
