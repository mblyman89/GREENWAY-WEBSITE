-- =============================================================================
-- Migration 0291 - R41 S18: written ACH policies, access reviews, key care
-- =============================================================================
-- Three owner sign-offs, one append-only table:
--
--   policy_adoption  the owner adopts Greenway's written ACH policies (the
--                    WA State Auditor: "Develop a detailed ACH payment
--                    policy."). text_sha256 is the fingerprint of the exact
--                    policy text shown when it was adopted, so a later edit
--                    shows the adoption no longer covers the words on screen.
--   access_review    the quarterly look at who can touch ACH (the Auditor's
--                    annual "Review the people authorized to initiate and
--                    approve ACH payments"; quarterly is Greenway's choice).
--                    text_sha256 fingerprints the list of people reviewed.
--   key_check        the owner checked one credential (Timberland token or
--                    text-code phone, passkeys, the encryption key backup,
--                    ...). item names it; item_set_on is when it was last
--                    changed, if known.
--
--   ach_control_records
--     kind          policy_adoption | access_review | key_check
--     period_key    policy_adoption: the year (YYYY); access_review: the
--                   quarter (YYYY-Qn); key_check: the year (YYYY).
--     recorded_on   the Pacific date it was recorded: today (or yesterday,
--                   for the midnight edge). Never backdated.
--     text_sha256   SHA-256 hex the app computes (see above).
--     summary       10 to 2000 characters. No run of 7+ digits (no account or
--                   routing numbers; 1-800-562-8761 is fine).
--     item          key_check only: a short id (a-z and _). Null otherwise.
--     item_set_on   key_check only, optional: when the credential was last
--                   changed (not after recorded_on). Null otherwise.
--     created_by    the OWNER (ach_write_by_owner, 0271).
--
-- Never updated, never deleted (ACH_CONTROL_APPEND_ONLY); TRUNCATE refused.
-- Add-only: one table, two trigger functions. Not security definer.
-- Idempotent. Apply MANUALLY (standing rule), AFTER 0290.
-- Rollback: supabase/rollbacks/0291_ach_control_records.rollback.sql
-- =============================================================================

create table if not exists public.ach_control_records (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('policy_adoption', 'access_review', 'key_check')),
  period_key   text not null check (period_key ~ '^20[0-9]{2}(-Q[1-4])?$'),
  recorded_on  date not null,
  text_sha256  text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  summary      text not null check (length(trim(summary)) between 10 and 2000 and summary !~ '[0-9]{7,}'),
  item         text check (item is null or item ~ '^[a-z_]{3,40}$'),
  item_set_on  date,
  created_by   uuid not null references public.staff_profiles (id) on delete restrict,
  created_at   timestamptz not null default now(),
  constraint acr_shape check (
    (kind = 'access_review' and period_key ~ '-Q[1-4]$' and item is null and item_set_on is null)
    or (kind = 'policy_adoption' and period_key ~ '^[0-9]{4}$' and item is null and item_set_on is null)
    or (kind = 'key_check' and period_key ~ '^[0-9]{4}$' and item is not null
        and (item_set_on is null or (item_set_on <= recorded_on and item_set_on >= date '2000-01-01')))
  )
);

create index if not exists acr_kind_idx on public.ach_control_records (kind, created_at desc);

comment on table public.ach_control_records is
  'R41 S18 (0291): owner sign-offs for the written ACH policies (adoption), the quarterly ACH access review and credential (key) checks. Append-only (never updated or deleted), owner-stamped, never backdated.';

create or replace function public.ach_control_records_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  today date := (now() at time zone 'America/Los_Angeles')::date;
  y int;
  q int;
begin
  if tg_op <> 'INSERT' then
    raise exception 'ACH_CONTROL_APPEND_ONLY: a control record is never changed or deleted. Record a new one instead.';
  end if;
  if not public.ach_write_by_owner(new.created_by) then
    raise exception 'ACH_OWNER_ONLY: only the owner records ACH policy adoptions, access reviews and key checks.';
  end if;
  if new.recorded_on > today or new.recorded_on < today - 1 then
    raise exception 'ACH_CONTROL_DATE: the date is the day it is recorded (got %).', new.recorded_on;
  end if;
  y := extract(year from new.recorded_on)::int;
  -- A malformed key is left for the column CHECKs (which run after this
  -- trigger) to refuse with their own named error; never cast it here.
  if new.period_key is null or new.period_key !~ '^20[0-9]{2}(-Q[1-4])?$' then
    return new;
  end if;
  if new.kind = 'access_review' and new.period_key ~ '-Q[1-4]$' then
    -- This quarter, or the one before it (a quarter-end review recorded a few days late).
    q := (y * 4) + ((extract(month from new.recorded_on)::int - 1) / 3);
    if (left(new.period_key, 4)::int * 4) + (right(new.period_key, 1)::int - 1) not between q - 1 and q then
      raise exception 'ACH_CONTROL_PERIOD: only this quarter or last quarter can be recorded (got %).', new.period_key;
    end if;
  elsif new.kind <> 'access_review' and new.period_key ~ '^[0-9]{4}$' and new.period_key::int <> y then
    raise exception 'ACH_CONTROL_PERIOD: the year must be the year it is recorded (got %).', new.period_key;
  end if;
  return new;
end $$;

drop trigger if exists trg_ach_control_records_guard on public.ach_control_records;
create trigger trg_ach_control_records_guard
  before insert or update or delete on public.ach_control_records
  for each row execute function public.ach_control_records_guard();

create or replace function public.ach_control_records_no_truncate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'ACH_CONTROL_APPEND_ONLY: the control records are never truncated.';
end $$;

drop trigger if exists trg_ach_control_records_no_truncate on public.ach_control_records;
create trigger trg_ach_control_records_no_truncate
  before truncate on public.ach_control_records
  for each statement execute function public.ach_control_records_no_truncate();

alter table public.ach_control_records enable row level security;

drop policy if exists ach_control_records_admin_read on public.ach_control_records;
create policy ach_control_records_admin_read on public.ach_control_records
  for select using (public.is_admin());

revoke all on table public.ach_control_records from anon;
revoke all on table public.ach_control_records from authenticated;
grant select on table public.ach_control_records to authenticated;
revoke update, delete, truncate on table public.ach_control_records from service_role;
grant select, insert on table public.ach_control_records to service_role;

revoke all on function public.ach_control_records_guard() from public, anon, authenticated;
revoke all on function public.ach_control_records_no_truncate() from public, anon, authenticated;
