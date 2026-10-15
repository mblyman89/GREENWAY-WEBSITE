-- =============================================================================
-- Migration 0275 - R41 S7: Timberland's prenote wait, floored in the database
-- =============================================================================
-- Plan: R41-TIMBERLAND-SLICE-PLAN v4 section S7.
--
-- Timberland's signed ACH agreement, section 6 (mirror:
-- docs/authorities/ach/timberland-ach-agreement-2026-10-09.redacted.txt):
--   "it agrees not to initiate live dollar Entries until at least 6 banking
--   days following the settlement date of the prenotification Entry."
--
-- 0263 stores each prenote's first live day (eligible_on) as the app sends it
-- and only checks that it is after settlement. Until R41 S7 the app sent
-- Nacha's minimum (3 banking days). The app now sends Timberland's day: 6
-- usable banking days after settlement (Fridays before a Saturday Federal
-- Reserve holiday are not counted until Timberland answers Q9).
--
-- The database has no Federal Reserve calendar, so it cannot recompute that
-- day. It enforces a FLOOR instead: eligible_on >= settlement + 8 calendar
-- days. Six weekdays always span a weekend, so the sixth usable day is never
-- fewer than 8 calendar days away; holidays only push it later. The app's
-- self-test (timberland-prenote-core) proves for every day of 2026-2028 that
-- this floor never refuses a correct day, and that it is tight. Any app bug or
-- hand-typed call that tries to shorten the wait to Nacha's 3 days (at most
-- 5 calendar days, or 7 over a long weekend) is refused here.
--
-- 0263's passing guard already refuses a prenote pass before eligible_on
-- (Pacific), and payroll pays only verified accounts, so with this floor no
-- live entry can go to a prenoted account earlier than Timberland allows.
--
-- Add-only: one new trigger function and one new trigger. Nothing in 0263 is
-- replaced. Rows already sent keep their dates (0263 forbids changing them);
-- the floor applies when a prenote moves from planned to sent.
-- Idempotent: safe to paste and re-run in the Supabase SQL editor. Apply
-- MANUALLY (standing rule), AFTER 0263 (any order relative to 0271-0274).
-- Rollback: supabase/rollbacks/0275_ach_prenote_timberland_wait.rollback.sql
-- Check:    scripts/recon/ach-prenote-wait-0275-pg-check.sql
-- =============================================================================

create or replace function public.ach_verification_timberland_wait()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.method = 'prenote' and new.status = 'sent' and old.status is distinct from 'sent' then
    if new.settlement_date is null or new.eligible_on is null
       or new.eligible_on < new.settlement_date + 8 then
      raise exception 'ACH_VERIFICATION_TIMBERLAND_WAIT: a prenote''s first live day must be at least 6 banking days after it settles (Timberland agreement section 6); % is too early for settlement %.',
        coalesce(new.eligible_on::text, 'none'), coalesce(new.settlement_date::text, 'none')
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_ach_verification_timberland_wait on public.ach_verifications;
create trigger trg_ach_verification_timberland_wait
  before update on public.ach_verifications
  for each row execute function public.ach_verification_timberland_wait();

revoke all on function public.ach_verification_timberland_wait() from public, anon, authenticated;

comment on function public.ach_verification_timberland_wait() is
  'R41 S7: a prenote marked sent must carry eligible_on >= settlement + 8 calendar days (floor of Timberland section 6: 6 banking days after settlement).';
