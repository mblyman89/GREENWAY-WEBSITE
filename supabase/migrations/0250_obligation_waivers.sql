-- 0250_obligation_waivers.sql  (CCRS Bible v2 slice S-12d)
--
-- WHY. Michael, 2026-10-07: "let me set the first week of sales so the back
-- log of weekly uploads I haven't uploaded stops harassing me so much about
-- them. Or a way to check it off the list with a reason maybe."
--
-- The START DATE needs no table: it is one value in site_settings (key
-- compliance_obligation_start), same pattern as the S-18 calendar.
--
-- This table holds the second tool: one specific CCRS week or LIQ-1295 sales
-- month checked off WITH A WRITTEN REASON, who and when. The reminder cron,
-- the CCRS page, the compliance calendar, the dashboard banner and
-- Compliance Health all read it (src/lib/compliance/obligation-waiver-core.ts
-- holds the one precedence rule they share).
--
-- RULES THE DATABASE ENFORCES (the app enforces the same, this is the floor):
--   * obligation is 'ccrs_weekly' or 'liq1295'.
--   * period_key is W-YYYY-MM-DD (a Sunday) for ccrs_weekly, YYYY-MM (month
--     01-12) for liq1295.
--   * reason is 10 to 500 characters after trimming.
--   * at most ONE live (not revoked) waiver per obligation + period.
--   * a waiver is never edited and never deleted. The only change allowed is
--     undoing it once: revoked_at goes from empty to a time, together with
--     who undid it. Re-dismissing later inserts a NEW row, so the history of
--     every decision stays readable for an examiner.
--   (The app also refuses to dismiss a period that has not ended yet; that
--   rule depends on today's date, so it lives in the app, not in a check.)
--
-- FACTORY RESET: KEEP (src/lib/accounting/factory-reset-core.ts). These are
-- the owner's written reasons about REAL State deadlines (for example "filed
-- by Cultivera"), not test activity. Because the table is kept, its
-- no-delete guard never meets the reset's TRUNCATE.
--
-- Idempotent. APPLY MANUALLY in the Supabase SQL editor (standing rule 6).
-- Owner steps: OWNER-GUIDE-S12d.md. Verified by
-- scripts/recon/obligation-waivers-pg-check.sql and the SQL mutants in
-- scripts/ccrs-bible/mutate_0250_sql.py.
-- ROLLBACK: supabase/rollbacks/0250_obligation_waivers.rollback.sql

do $precheck$
begin
  if to_regclass('public.staff_profiles') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0250 depends on staff_profiles (0001)';
  end if;
  if to_regprocedure('public.is_staff()') is null or to_regprocedure('public.is_admin()') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0250 depends on is_staff() / is_admin()';
  end if;
end
$precheck$;

-- True only for a real calendar date that is a Sunday. Returns false (never
-- raises) for impossible dates like 2026-02-30, so a bad key is a clean
-- check violation instead of a date error.
create or replace function public.obligation_waivers_is_sunday(d text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v date;
begin
  begin
    v := d::date;
  exception when others then
    return false;
  end;
  return to_char(v, 'YYYY-MM-DD') = d and extract(isodow from v) = 7;
end $$;

create table if not exists public.obligation_waivers (
  id                uuid primary key default gen_random_uuid(),
  obligation        text not null,
  period_key        text not null,
  reason            text not null,
  waived_at         timestamptz not null default now(),
  waived_by         uuid references public.staff_profiles(id) on delete set null,
  waived_by_email   text,
  revoked_at        timestamptz,
  revoked_by        uuid references public.staff_profiles(id) on delete set null,
  revoked_by_email  text,
  constraint obligation_waivers_obligation_chk
    check (obligation in ('ccrs_weekly', 'liq1295')),
  -- CASE (not AND/OR) so to_date() never sees a monthly key or a malformed
  -- weekly key: Postgres does not promise left-to-right evaluation of AND.
  constraint obligation_waivers_period_chk
    check (
      case
        when obligation = 'liq1295' then
          period_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
        when obligation = 'ccrs_weekly' then
          case
            when period_key ~ '^W-[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
              then public.obligation_waivers_is_sunday(substr(period_key, 3))
            else false
          end
        else false
      end
    ),
  constraint obligation_waivers_reason_chk
    check (char_length(btrim(reason)) between 10 and 500),
  -- "who undid it" may only be filled in when it WAS undone.
  constraint obligation_waivers_revoke_pair_chk
    check (revoked_at is not null or (revoked_by is null and revoked_by_email is null))
);

comment on table public.obligation_waivers is
  '0250 (S-12d): one CCRS week or LIQ-1295 sales month checked off with a written reason (10-500 chars). Never edited or deleted; undo sets revoked_at once. At most one live waiver per obligation + period. Factory reset: KEEP.';

create unique index if not exists obligation_waivers_one_live
  on public.obligation_waivers (obligation, period_key)
  where revoked_at is null;

create index if not exists obligation_waivers_period_idx
  on public.obligation_waivers (obligation, period_key, waived_at desc);

-- The guard: no delete; the only update is the one-time undo.
create or replace function public.obligation_waivers_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'WAIVER_PERMANENT: a dismissal is never deleted. Undo it instead (it keeps the history).'
      using errcode = 'raise_exception';
  end if;
  -- UPDATE
  -- Allowed: the staff_profiles "on delete set null" cascade (a staff
  -- member was removed). Only waived_by / revoked_by go to NULL; the
  -- e-mail columns still say who it was.
  if new.id = old.id
     and new.obligation = old.obligation
     and new.period_key = old.period_key
     and new.reason = old.reason
     and new.waived_at = old.waived_at
     and new.waived_by_email is not distinct from old.waived_by_email
     and new.revoked_at is not distinct from old.revoked_at
     and new.revoked_by_email is not distinct from old.revoked_by_email
     and (new.waived_by is not distinct from old.waived_by or new.waived_by is null)
     and (new.revoked_by is not distinct from old.revoked_by or new.revoked_by is null)
     and (new.waived_by is distinct from old.waived_by or new.revoked_by is distinct from old.revoked_by) then
    return new;
  end if;
  if old.revoked_at is not null then
    raise exception 'WAIVER_ALREADY_UNDONE: this dismissal was already undone. Dismiss again to create a new one.'
      using errcode = 'raise_exception';
  end if;
  if new.revoked_at is null then
    raise exception 'WAIVER_ONLY_UNDO: the only change allowed to a dismissal is undoing it.'
      using errcode = 'raise_exception';
  end if;
  if new.id is distinct from old.id
     or new.obligation is distinct from old.obligation
     or new.period_key is distinct from old.period_key
     or new.reason is distinct from old.reason
     or new.waived_at is distinct from old.waived_at
     or new.waived_by is distinct from old.waived_by
     or new.waived_by_email is distinct from old.waived_by_email then
    raise exception 'WAIVER_ONLY_UNDO: the reason, period and who/when of a dismissal can never be edited.'
      using errcode = 'raise_exception';
  end if;
  return new;
end $$;

drop trigger if exists obligation_waivers_guard_trg on public.obligation_waivers;
create trigger obligation_waivers_guard_trg
  before update or delete on public.obligation_waivers
  for each row execute function public.obligation_waivers_guard();

alter table public.obligation_waivers enable row level security;

drop policy if exists "obligation_waivers staff read" on public.obligation_waivers;
create policy "obligation_waivers staff read" on public.obligation_waivers
  for select using (public.is_staff());

drop policy if exists "obligation_waivers admin write" on public.obligation_waivers;
create policy "obligation_waivers admin write" on public.obligation_waivers
  for all using (public.is_admin()) with check (public.is_admin());

grant select, insert, update on public.obligation_waivers to service_role;

notify pgrst, 'reload schema';
