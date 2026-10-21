-- =============================================================================
-- Migration 0289 - R41 S16: the daily bank watch (known-payee rules + reviews)
-- =============================================================================
-- The site already pulls every Timberland Main-account transaction from Plaid
-- (plaid_transactions). The bank watch (src/lib/payments/ach-bank-watch-core.ts)
-- lists every money-out line nothing explains. The Washington State Auditor's
-- ACH best practices (mirrored verbatim at docs/authorities/ach/
-- wa-sao-ach-best-practices.txt):
--   "Use an ACH filter (also known as ACH positive pay)."
--   "Set up a list of authorized vendors, dollar limits, start and end dates,
--    and payment frequency."
-- These two tables are the site's version of that list, and the record of
-- what each unexplained line turned out to be. The watch never blocks a
-- payment; it only reports.
--
--   ach_bank_watch_rules     a known payee that may take money out of the
--                            Main account (utilities, card processor...).
--     match_text             3 to 60 characters, as it shows on the bank
--                            statement. No run of 7+ digits.
--     max_cents              optional dollar limit; above it the line is
--                            reported again ("over the limit you set").
--     note                   10 to 300 characters: who it is and why.
--     created_by             the OWNER (ach_write_by_owner, 0271).
--     retired_at/retired_by  set once, by the owner; nothing else on a rule
--                            ever changes (ACH_WATCH_RETIRE). Never deleted.
--
--   ach_bank_watch_reviews   what a bank line turned out to be. Append-only;
--                            the newest review of a line stands.
--     transaction_id         the Plaid transaction id (no account number).
--     verdict                known | reported_to_bank | returned_payment |
--                            fee | not_ours.
--     note                   10 to 500 characters, no run of 7+ digits
--                            (1-800-562-8761 is fine).
--     created_by             the owner, or an ACTIVE admin
--                            (ACH_WATCH_STAFF_ONLY). Reviewing a line moves
--                            no money, so an admin may record it.
--
-- Add-only: two new tables and four trigger functions; nothing existing
-- changes. Not security definer. Idempotent.
-- Apply MANUALLY (standing rule), AFTER 0288.
-- Rollback: supabase/rollbacks/0289_ach_bank_watch.rollback.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------
create table if not exists public.ach_bank_watch_rules (
  id          uuid primary key default gen_random_uuid(),
  match_text  text not null check (length(trim(match_text)) between 3 and 60 and match_text !~ '[0-9]{7,}'),
  max_cents   bigint check (max_cents is null or max_cents > 0),
  note        text not null check (length(trim(note)) between 10 and 300 and note !~ '[0-9]{7,}'),
  created_by  uuid not null references public.staff_profiles (id) on delete restrict,
  created_at  timestamptz not null default now(),
  retired_at  timestamptz,
  retired_by  uuid references public.staff_profiles (id) on delete restrict,
  constraint abwr_retire_shape check ((retired_at is null) = (retired_by is null))
);

create index if not exists abwr_live_idx on public.ach_bank_watch_rules (created_at desc) where retired_at is null;

comment on table public.ach_bank_watch_rules is
  'R41 S16 (0289): known payees that may take money out of the Timberland Main account (the site''s ACH filter list). Owner-stamped; retired once, never edited or deleted.';

create table if not exists public.ach_bank_watch_reviews (
  id              uuid primary key default gen_random_uuid(),
  transaction_id  text not null check (transaction_id ~ '^[A-Za-z0-9_-]{6,128}$'),
  verdict         text not null check (verdict in ('known', 'reported_to_bank', 'returned_payment', 'fee', 'not_ours')),
  note            text not null check (length(trim(note)) between 10 and 500 and note !~ '[0-9]{7,}'),
  created_by      uuid not null references public.staff_profiles (id) on delete restrict,
  created_at      timestamptz not null default now()
);

create index if not exists abwv_txn_idx on public.ach_bank_watch_reviews (transaction_id, created_at desc);

comment on table public.ach_bank_watch_reviews is
  'R41 S16 (0289): what an unexplained Main-account bank line turned out to be. Append-only (never updated or deleted); the newest review of a line stands. Owner or active admin.';

-- -----------------------------------------------------------------------------
-- 2. Guards
-- -----------------------------------------------------------------------------
create or replace function public.ach_bank_watch_rules_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ACH_WATCH_RETIRE: a known-payee rule is never deleted. Retire it instead.';
  end if;
  if tg_op = 'INSERT' then
    if not public.ach_write_by_owner(new.created_by) then
      raise exception 'ACH_OWNER_ONLY: only the owner adds a known-payee rule.';
    end if;
    if new.retired_at is not null or new.retired_by is not null then
      raise exception 'ACH_WATCH_RETIRE: a new rule cannot start retired.';
    end if;
    return new;
  end if;
  -- UPDATE: only retiring, once, by the owner; nothing else changes.
  if old.retired_at is not null then
    raise exception 'ACH_WATCH_RETIRE: this rule is already retired.';
  end if;
  if new.retired_at is null or new.retired_by is null then
    raise exception 'ACH_WATCH_RETIRE: the only change allowed is retiring the rule.';
  end if;
  if new.id <> old.id or new.match_text <> old.match_text
     or new.max_cents is distinct from old.max_cents or new.note <> old.note
     or new.created_by <> old.created_by or new.created_at <> old.created_at then
    raise exception 'ACH_WATCH_RETIRE: nothing on a rule can change except retiring it. Retire it and add a new one.';
  end if;
  if not public.ach_write_by_owner(new.retired_by) then
    raise exception 'ACH_OWNER_ONLY: only the owner retires a known-payee rule.';
  end if;
  if new.retired_at > now() + interval '5 minutes' or new.retired_at < now() - interval '1 day' then
    raise exception 'ACH_WATCH_RETIRE: the retire time is the moment it is retired.';
  end if;
  return new;
end $$;

drop trigger if exists trg_ach_bank_watch_rules_guard on public.ach_bank_watch_rules;
create trigger trg_ach_bank_watch_rules_guard
  before insert or update or delete on public.ach_bank_watch_rules
  for each row execute function public.ach_bank_watch_rules_guard();

create or replace function public.ach_bank_watch_reviews_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'ACH_WATCH_APPEND_ONLY: a bank watch review is never changed or deleted. Add a new review instead.';
  end if;
  -- The owner (0271 helper), or an ACTIVE admin; and when a user JWT is
  -- present it must be the same person.
  if not (
    public.ach_write_by_owner(new.created_by)
    or (
      exists (select 1 from public.staff_profiles where id = new.created_by and active = true and role = 'admin')
      and (auth.uid() is null or auth.uid() = new.created_by)
    )
  ) then
    raise exception 'ACH_WATCH_STAFF_ONLY: only the owner or an active admin records what a bank line is.';
  end if;
  return new;
end $$;

drop trigger if exists trg_ach_bank_watch_reviews_guard on public.ach_bank_watch_reviews;
create trigger trg_ach_bank_watch_reviews_guard
  before insert or update or delete on public.ach_bank_watch_reviews
  for each row execute function public.ach_bank_watch_reviews_guard();

-- TRUNCATE skips row triggers; refuse it on both tables.
create or replace function public.ach_bank_watch_no_truncate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'ACH_WATCH_APPEND_ONLY: the bank watch records are never truncated.';
end $$;

drop trigger if exists trg_ach_bank_watch_rules_no_truncate on public.ach_bank_watch_rules;
create trigger trg_ach_bank_watch_rules_no_truncate
  before truncate on public.ach_bank_watch_rules
  for each statement execute function public.ach_bank_watch_no_truncate();

drop trigger if exists trg_ach_bank_watch_reviews_no_truncate on public.ach_bank_watch_reviews;
create trigger trg_ach_bank_watch_reviews_no_truncate
  before truncate on public.ach_bank_watch_reviews
  for each statement execute function public.ach_bank_watch_no_truncate();

-- -----------------------------------------------------------------------------
-- 3. RLS and grants (same pattern as 0288)
-- -----------------------------------------------------------------------------
alter table public.ach_bank_watch_rules enable row level security;
alter table public.ach_bank_watch_reviews enable row level security;

drop policy if exists ach_bank_watch_rules_admin_read on public.ach_bank_watch_rules;
create policy ach_bank_watch_rules_admin_read on public.ach_bank_watch_rules
  for select using (public.is_admin());

drop policy if exists ach_bank_watch_reviews_admin_read on public.ach_bank_watch_reviews;
create policy ach_bank_watch_reviews_admin_read on public.ach_bank_watch_reviews
  for select using (public.is_admin());

-- Least privilege: anon nothing; authenticated select (admins by RLS);
-- service_role: rules select/insert/update (retire only, by the guard);
-- reviews select/insert only. No delete or truncate anywhere.
revoke all on table public.ach_bank_watch_rules from anon;
revoke all on table public.ach_bank_watch_rules from authenticated;
grant select on table public.ach_bank_watch_rules to authenticated;
revoke delete, truncate on table public.ach_bank_watch_rules from service_role;
grant select, insert, update on table public.ach_bank_watch_rules to service_role;

revoke all on table public.ach_bank_watch_reviews from anon;
revoke all on table public.ach_bank_watch_reviews from authenticated;
grant select on table public.ach_bank_watch_reviews to authenticated;
revoke update, delete, truncate on table public.ach_bank_watch_reviews from service_role;
grant select, insert on table public.ach_bank_watch_reviews to service_role;

revoke all on function public.ach_bank_watch_rules_guard() from public, anon, authenticated;
revoke all on function public.ach_bank_watch_reviews_guard() from public, anon, authenticated;
revoke all on function public.ach_bank_watch_no_truncate() from public, anon, authenticated;
