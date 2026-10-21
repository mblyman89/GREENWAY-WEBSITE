-- =============================================================================
-- Migration 0288 - R41 S14: the yearly ACH fraud-procedure review (append-only)
-- =============================================================================
-- Nacha Fraud Monitoring Phase 2 (mirrored verbatim at docs/authorities/ach/
-- nacha-fraud-monitoring-phase-2.txt), what every non-consumer Originator
-- must do:
--   "review (at least annually) these processes and procedures and make
--    appropriate updates to address evolving risks."
--
-- Until now the yearly review was a tick in the calendar's done map
-- (site_settings, a value that can be overwritten or undone). This table is
-- the durable record: who reviewed, when, what they found, and a fingerprint
-- of the exact procedure and risk-assessment text they reviewed.
--
--   ach_annual_reviews     one row per review (plus corrections).
--     review_year          the year the review covers (2026 or later: the
--                          Phase 2 rule took effect June 19, 2026). This
--                          year or last year (a year-end review may be
--                          recorded in early January).
--     reviewed_on          the Pacific date it was recorded: today (or
--                          yesterday, for the midnight edge). Never backdated.
--     outcome              no_changes | changes_made | changes_needed.
--     summary              20 to 2000 characters. No run of 7+ digits (no
--                          account or routing numbers; 1-800-562-8761 is fine).
--     procedure_sha256     SHA-256 (hex) of the procedure + risk assessment
--                          text shown when it was reviewed (the app computes it).
--     corrects_id          null for the review itself; for a correction, the
--                          original review of the SAME year. One original per
--                          year (aar_one_per_year); corrections are unlimited
--                          and the newest stands.
--     created_by           the OWNER (ach_write_by_owner, 0271). The review is
--                          the owner's sign-off, so an admin cannot record it
--                          (not even as a request).
--
-- Never updated, never deleted (ACH_YEARLY_APPEND_ONLY). Add-only: one new
-- table and one trigger function; nothing existing changes. Not security
-- definer. Idempotent.
-- Apply MANUALLY (standing rule), AFTER 0287.
-- Rollback: supabase/rollbacks/0288_ach_annual_reviews.rollback.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Table
-- -----------------------------------------------------------------------------
create table if not exists public.ach_annual_reviews (
  id                uuid primary key default gen_random_uuid(),
  review_year       integer not null check (review_year between 2026 and 2200),
  reviewed_on       date not null,
  outcome           text not null check (outcome in ('no_changes', 'changes_made', 'changes_needed')),
  summary           text not null check (length(trim(summary)) between 20 and 2000 and summary !~ '[0-9]{7,}'),
  procedure_sha256  text not null check (procedure_sha256 ~ '^[0-9a-f]{64}$'),
  corrects_id       uuid references public.ach_annual_reviews (id) on delete restrict,
  created_by        uuid not null references public.staff_profiles (id) on delete restrict,
  created_at        timestamptz not null default now()
);

-- One original review per year; corrections point at it.
create unique index if not exists aar_one_per_year on public.ach_annual_reviews (review_year) where corrects_id is null;
create index if not exists aar_year_idx on public.ach_annual_reviews (review_year desc, created_at desc);

comment on table public.ach_annual_reviews is
  'R41 S14 (0288): the yearly review of the ACH fraud procedure (Nacha Phase 2: at least annually). Append-only (never updated or deleted), owner-stamped. One original per year; corrections point at it.';

-- -----------------------------------------------------------------------------
-- 2. Guard: owner-stamped, dates honest, corrections well-formed, append-only
-- -----------------------------------------------------------------------------
create or replace function public.ach_annual_reviews_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  today date := (now() at time zone 'America/Los_Angeles')::date;
  target record;
begin
  if tg_op <> 'INSERT' then
    raise exception 'ACH_YEARLY_APPEND_ONLY: a yearly review is never changed or deleted. Add a correction instead.';
  end if;
  if not public.ach_write_by_owner(new.created_by) then
    raise exception 'ACH_OWNER_ONLY: only the owner records the yearly review.';
  end if;
  if new.reviewed_on > today or new.reviewed_on < today - 1 then
    raise exception 'ACH_YEARLY_DATE: the review date is the day it is recorded (got %).', new.reviewed_on;
  end if;
  if new.review_year > extract(year from new.reviewed_on)::int
     or new.review_year < extract(year from new.reviewed_on)::int - 1 then
    raise exception 'ACH_YEARLY_YEAR: only this year or last year can be recorded (got %).', new.review_year;
  end if;
  if new.corrects_id is not null then
    select review_year, corrects_id into target from public.ach_annual_reviews where id = new.corrects_id;
    if not found then
      raise exception 'ACH_YEARLY_CORRECTS: the review to correct was not found.';
    end if;
    if target.corrects_id is not null then
      raise exception 'ACH_YEARLY_CORRECTS: correct the original review, not a correction.';
    end if;
    if target.review_year <> new.review_year then
      raise exception 'ACH_YEARLY_CORRECTS: a correction must be for the same year (%).', target.review_year;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_ach_annual_reviews_guard on public.ach_annual_reviews;
create trigger trg_ach_annual_reviews_guard
  before insert or update or delete on public.ach_annual_reviews
  for each row execute function public.ach_annual_reviews_guard();

-- TRUNCATE skips row triggers; refuse it too.
create or replace function public.ach_annual_reviews_no_truncate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'ACH_YEARLY_APPEND_ONLY: the yearly reviews are never truncated.';
end $$;

drop trigger if exists trg_ach_annual_reviews_no_truncate on public.ach_annual_reviews;
create trigger trg_ach_annual_reviews_no_truncate
  before truncate on public.ach_annual_reviews
  for each statement execute function public.ach_annual_reviews_no_truncate();

-- -----------------------------------------------------------------------------
-- 3. RLS and grants (same pattern as 0277)
-- -----------------------------------------------------------------------------
alter table public.ach_annual_reviews enable row level security;

drop policy if exists ach_annual_reviews_admin_read on public.ach_annual_reviews;
create policy ach_annual_reviews_admin_read on public.ach_annual_reviews
  for select using (public.is_admin());

-- Least privilege: anon nothing; authenticated select (admins by RLS);
-- service_role select and insert only (no update, no delete at all).
revoke all on table public.ach_annual_reviews from anon;
revoke all on table public.ach_annual_reviews from authenticated;
grant select on table public.ach_annual_reviews to authenticated;
revoke update, delete, truncate on table public.ach_annual_reviews from service_role;
grant select, insert on table public.ach_annual_reviews to service_role;

revoke all on function public.ach_annual_reviews_guard() from public, anon, authenticated;
revoke all on function public.ach_annual_reviews_no_truncate() from public, anon, authenticated;
