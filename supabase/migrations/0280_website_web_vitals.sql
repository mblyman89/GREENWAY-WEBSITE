-- ===========================================================================
-- 0280_website_web_vitals.sql
--
-- R59-S4 (owner request: "the real performance numbers added to the reports
-- page").
--
-- WEBSITE WEB VITALS (Reports > Website > Page speed)
--   One row per Core Web Vital measured in a real shopper's browser on a
--   real page load (LCP, INP, CLS, FCP, TTFB — Google's web-vitals library,
--   via Next's useReportWebVitals). Sent as one small beacon to
--   POST /api/vitals when the page is hidden.
--   PRIVACY: no cookies, no IP address, no user id, no user-agent string.
--   Only: when, which page (path only, never the query string), which
--   metric, its value, Google's rating, a coarse device class (phone /
--   tablet / desktop) and how the page was opened (navigate / reload /
--   back-forward ...). Nothing is sent with Global Privacy Control on, on
--   staff / admin / no-track pages, or from staff previews.
--   Rows are written by the server (service role); staff can read them;
--   nobody else can read or write.
--
-- The website works BEFORE this is applied: the endpoint answers 204 and
-- stores nothing, and the report says "apply update 0280".
--
-- FACTORY RESET: website_web_vitals is KEEP in factory-reset-core.ts
-- (anonymous website speed analytics, like website_click_events; the reset
-- function's pinned WIPE list from 0240 is deliberately not reopened).
-- IDEMPOTENT (create if not exists, guarded constraints, drop/create
-- policies). APPLY MANUALLY in the Supabase SQL editor.
-- ROLLBACK: supabase/rollbacks/0280_website_web_vitals.rollback.sql
-- ===========================================================================

do $precheck$
begin
  if to_regprocedure('public.is_staff()') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0280 depends on is_staff() from 0001';
  end if;
end
$precheck$;

create table if not exists public.website_web_vitals (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  page_path    text not null,
  -- LCP | INP | CLS | FCP | TTFB
  metric       text not null,
  -- milliseconds (CLS: unitless score)
  value        double precision not null,
  -- good | needs-improvement | poor (recomputed on the server)
  rating       text not null,
  device       text not null default 'desktop',
  nav_type     text
);

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'website_web_vitals_metric_chk'
                   and conrelid = 'public.website_web_vitals'::regclass) then
    alter table public.website_web_vitals add constraint website_web_vitals_metric_chk
      check (metric in ('LCP', 'INP', 'CLS', 'FCP', 'TTFB'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'website_web_vitals_rating_chk'
                   and conrelid = 'public.website_web_vitals'::regclass) then
    alter table public.website_web_vitals add constraint website_web_vitals_rating_chk
      check (rating in ('good', 'needs-improvement', 'poor'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'website_web_vitals_device_chk'
                   and conrelid = 'public.website_web_vitals'::regclass) then
    alter table public.website_web_vitals add constraint website_web_vitals_device_chk
      check (device in ('phone', 'tablet', 'desktop'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'website_web_vitals_value_chk'
                   and conrelid = 'public.website_web_vitals'::regclass) then
    alter table public.website_web_vitals add constraint website_web_vitals_value_chk
      check (value >= 0 and value <= case when metric = 'CLS' then 50 else 120000 end
         and char_length(page_path) between 1 and 300
         and (nav_type is null or char_length(nav_type) <= 24));
  end if;
end
$c$;

create index if not exists website_web_vitals_time_idx
  on public.website_web_vitals (occurred_at desc);

alter table public.website_web_vitals enable row level security;
drop policy if exists website_web_vitals_staff_read on public.website_web_vitals;
create policy website_web_vitals_staff_read on public.website_web_vitals
  for select using (public.is_staff());
grant select, insert, delete on public.website_web_vitals to service_role;

notify pgrst, 'reload schema';
