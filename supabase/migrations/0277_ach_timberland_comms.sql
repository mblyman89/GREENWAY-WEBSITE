-- =============================================================================
-- Migration 0277 - R41 S10: the Timberland communications log (append-only)
-- =============================================================================
-- Plan: R41-TIMBERLAND-SLICE-PLAN v4 section S10, point 1.
--
-- The signed Timberland ACH agreement (docs/authorities/ach/timberland-ach-
-- agreement-2026-10-09.redacted.txt) starts clocks when Timberland tells
-- Greenway something, or when Greenway finds something:
--   section 5   authorization copy on request ......... 5 banking days
--   section 15  pre-funding notice ..................... before the next file
--   section 17  statement discrepancy .................. 30 calendar days
--   section 21  reversal ................ 5 banking days AND 24 hours of discovery
--   section 22  reserve demand ......................... 10 banking days
--   section 24  fee change by written notice ........... read the same day
--   section 26  over-limit request ..... 2 banking days before the entry date
--   section 28  amendment, effective on receipt ........ read the same day
--   section 30  termination ............................ 3 calendar days
--   Schedule F  compromise: phone at once, written confirmation in 1 calendar day
-- The app computes the due dates (timberland-obligations-core.ts). This table
-- keeps WHAT happened and WHEN, as a record that is never edited or deleted.
--
--   ach_timberland_comms   one row per communication or event.
--     entry_type           what it was (list below).
--     received_on          the Pacific date it arrived or happened. Not in the
--                          future, not more than 400 days back (a typo guard).
--     occurred_at          the exact time, where a clock runs in hours: the
--                          phone call for a compromise report, the discovery
--                          of an error for a reversal.
--     effective_on         a second date some types need: the original
--                          entry's settlement date (reversal), the date of
--                          the bigger file (over-limit), the end date
--                          (termination).
--     amount_cents         reserve amount, over-limit amount (cents).
--     summary              5 to 1000 characters. No run of 7+ digits (no
--                          account or routing numbers; 1-800-562-8761 is fine).
--     closes_id            only for entry_type 'done': the item it closes.
--                          Each item is closed at most once.
--     created_by           the OWNER (ach_write_by_owner, 0271). An admin's
--                          press is a request for the owner's approval, made
--                          in the app (achGate kind timberland_comms.log).
--
-- Never updated, never deleted (ACH_COMMS_APPEND_ONLY). A mistake is fixed by
-- a new row that says so. Add-only: one new table, one trigger function, no
-- change to any existing object. Not security definer. Idempotent.
-- Apply MANUALLY (standing rule), AFTER 0276.
-- Rollback: supabase/rollbacks/0277_ach_timberland_comms.rollback.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Table
-- -----------------------------------------------------------------------------
create table if not exists public.ach_timberland_comms (
  id            uuid primary key default gen_random_uuid(),
  entry_type    text not null check (entry_type in (
                  'amendment_notice', 'fee_notice', 'reserve_demand', 'auth_copy_request',
                  'over_limit_request', 'prefunding_notice', 'termination_notice',
                  'dual_approval_on', 'schedule_g_email_corrected', 'access_ready',
                  'countersigned_received', 'compromise_reported', 'reversal_needed',
                  'statement_received', 'other', 'done')),
  received_on   date not null,
  occurred_at   timestamptz,
  effective_on  date,
  amount_cents  bigint check (amount_cents is null or amount_cents >= 0),
  summary       text not null check (length(trim(summary)) between 5 and 1000 and summary !~ '[0-9]{7,}'),
  closes_id     uuid references public.ach_timberland_comms (id) on delete restrict,
  created_by    uuid not null references public.staff_profiles (id) on delete restrict,
  created_at    timestamptz not null default now(),
  constraint atc_done_shape check ((entry_type = 'done') = (closes_id is not null)),
  constraint atc_time_needed check (entry_type not in ('compromise_reported', 'reversal_needed') or occurred_at is not null),
  constraint atc_second_date_needed check (entry_type not in ('reversal_needed', 'over_limit_request', 'termination_notice') or effective_on is not null),
  constraint atc_amount_needed check (entry_type not in ('reserve_demand', 'over_limit_request') or amount_cents is not null),
  constraint atc_termination_not_before check (entry_type <> 'termination_notice' or effective_on >= received_on),
  constraint atc_reversal_original_before check (entry_type <> 'reversal_needed' or effective_on <= received_on)
);

-- Each item is closed at most once.
create unique index if not exists atc_closes_once on public.ach_timberland_comms (closes_id) where closes_id is not null;
create index if not exists atc_received_idx on public.ach_timberland_comms (received_on desc, created_at desc);

comment on table public.ach_timberland_comms is
  'R41 S10 (0277): the Timberland communications log. Append-only (never updated or deleted), owner-stamped. Due dates are computed in the app from the signed agreement.';

-- -----------------------------------------------------------------------------
-- 2. Guard: owner-stamped, dates sane, 'done' closes an open item, append-only
-- -----------------------------------------------------------------------------
create or replace function public.ach_timberland_comms_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  today date := (now() at time zone 'America/Los_Angeles')::date;
  target record;
begin
  if tg_op <> 'INSERT' then
    raise exception 'ACH_COMMS_APPEND_ONLY: the Timberland log is never changed or deleted. Add a new entry that corrects it.';
  end if;
  if not public.ach_write_by_owner(new.created_by) then
    raise exception 'ACH_OWNER_ONLY: only the owner adds to the Timberland log. Send it as a request for owner approval.';
  end if;
  if new.received_on > today then
    raise exception 'ACH_COMMS_DATE: the date cannot be in the future (%).', new.received_on;
  end if;
  if new.received_on < today - 400 then
    raise exception 'ACH_COMMS_DATE: the date is more than 400 days ago (%). Check the year.', new.received_on;
  end if;
  if new.occurred_at is not null and new.occurred_at > now() + interval '5 minutes' then
    raise exception 'ACH_COMMS_DATE: the time cannot be in the future.';
  end if;
  if new.entry_type = 'done' then
    if new.closes_id is null then
      raise exception 'ACH_COMMS_CLOSE: a done entry must name the item it closes.';
    end if;
    select entry_type, received_on into target from public.ach_timberland_comms where id = new.closes_id;
    if not found then
      raise exception 'ACH_COMMS_CLOSE: the item to close was not found.';
    end if;
    if target.entry_type not in ('amendment_notice', 'fee_notice', 'reserve_demand', 'auth_copy_request',
                                 'over_limit_request', 'prefunding_notice', 'compromise_reported',
                                 'reversal_needed', 'statement_received') then
      raise exception 'ACH_COMMS_CLOSE: a % entry has no clock to close.', target.entry_type;
    end if;
    if new.received_on < target.received_on then
      raise exception 'ACH_COMMS_CLOSE: it cannot be done before it arrived (%).', target.received_on;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_ach_timberland_comms_guard on public.ach_timberland_comms;
create trigger trg_ach_timberland_comms_guard
  before insert or update or delete on public.ach_timberland_comms
  for each row execute function public.ach_timberland_comms_guard();

-- -----------------------------------------------------------------------------
-- 3. RLS and grants (same pattern as 0273)
-- -----------------------------------------------------------------------------
alter table public.ach_timberland_comms enable row level security;

drop policy if exists ach_timberland_comms_admin_read on public.ach_timberland_comms;
create policy ach_timberland_comms_admin_read on public.ach_timberland_comms
  for select using (public.is_admin());

-- Least privilege: anon nothing; authenticated select (admins by RLS);
-- service_role select and insert only (no update, no delete at all).
revoke all on table public.ach_timberland_comms from anon;
revoke all on table public.ach_timberland_comms from authenticated;
grant select on table public.ach_timberland_comms to authenticated;
revoke update, delete, truncate on table public.ach_timberland_comms from service_role;
grant select, insert on table public.ach_timberland_comms to service_role;

revoke all on function public.ach_timberland_comms_guard() from public, anon, authenticated;
