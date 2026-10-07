-- scripts/recon/obligation-waivers-pg-check.sql  (CCRS Bible v2 S-12d - migration 0250)
--
-- Scenario check for 0250_obligation_waivers.sql on a real Postgres with all
-- migrations applied. ONE transaction, rolled back: leaves nothing behind.
-- Starts from nothing (rollback), applies 0250 twice (idempotency), then
-- proves every rule by attempting the forbidden thing and requiring the
-- exact error, proves RLS as real roles, then proves the rollback refuses
-- with rows and drops cleanly without them.
-- A run printing OBLIGATION WAIVERS CHECK PASSED then ROLLBACK is the all-clear.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/obligation-waivers-pg-check.sql
begin;

\i supabase/rollbacks/0250_obligation_waivers.rollback.sql
do $$ begin assert to_regclass('public.obligation_waivers') is null, 'clean start'; end $$;
\i supabase/migrations/0250_obligation_waivers.sql
\i supabase/migrations/0250_obligation_waivers.sql

create or replace function pg_temp.expect_error(sql text, needle text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if position(needle in sqlerrm) = 0 then
      raise exception 'expected error containing "%" from [%], got: %', needle, sql, sqlerrm;
    end if;
    return;
  end;
  raise exception 'expected error containing "%" but [%] succeeded', needle, sql;
end $$;

-- two staff: an admin and a budtender (handle_new_auth_user makes the profile)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'budtender@test.local');
insert into public.staff_profiles (id, email, full_name, role, active) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@test.local', 'Owner', 'owner', true),
  ('00000000-0000-0000-0000-0000000000b2', 'budtender@test.local', 'Bud', 'staff', true)
on conflict (id) do update set role = excluded.role, active = true;

-- ---- valid rows ------------------------------------------------------------
insert into public.obligation_waivers (obligation, period_key, reason, waived_by, waived_by_email) values
  ('ccrs_weekly', 'W-2026-09-27', 'Filed by Cultivera that week', '00000000-0000-0000-0000-0000000000a1', 'owner@test.local'),
  ('liq1295',     '2026-08',      'Paid on PayStation 2026-09-18', '00000000-0000-0000-0000-0000000000a1', 'owner@test.local'),
  ('ccrs_weekly', 'W-2028-02-27', '1234567890', null, null);   -- exactly 10 chars, leap-year Feb

-- ---- obligation ------------------------------------------------------------
select pg_temp.expect_error($q$insert into public.obligation_waivers (obligation, period_key, reason) values ('dor_excise','2026-08','Some long reason here')$q$, 'obligation_waivers_obligation_chk');

-- ---- period keys -----------------------------------------------------------
select pg_temp.expect_error($q$insert into public.obligation_waivers (obligation, period_key, reason) values ('ccrs_weekly','W-2026-09-28','Monday is not a week start')$q$, 'obligation_waivers_period_chk');
select pg_temp.expect_error($q$insert into public.obligation_waivers (obligation, period_key, reason) values ('ccrs_weekly','W-2026-02-30','Impossible date given here')$q$, 'obligation_waivers_period_chk');
select pg_temp.expect_error($q$insert into public.obligation_waivers (obligation, period_key, reason) values ('ccrs_weekly','2026-09-27','Missing the W- prefix here')$q$, 'obligation_waivers_period_chk');
select pg_temp.expect_error($q$insert into public.obligation_waivers (obligation, period_key, reason) values ('ccrs_weekly','X-2026-09-27','Wrong prefix on a Sunday')$q$, 'obligation_waivers_period_chk');
select pg_temp.expect_error($q$insert into public.obligation_waivers (obligation, period_key, reason) values ('ccrs_weekly','W-2026-9-27','Unpadded month in this key')$q$, 'obligation_waivers_period_chk');
select pg_temp.expect_error($q$insert into public.obligation_waivers (obligation, period_key, reason) values ('ccrs_weekly','2026-08','Monthly key on weekly row')$q$, 'obligation_waivers_period_chk');
select pg_temp.expect_error($q$insert into public.obligation_waivers (obligation, period_key, reason) values ('liq1295','2026-13','Month thirteen is not real')$q$, 'obligation_waivers_period_chk');
select pg_temp.expect_error($q$insert into public.obligation_waivers (obligation, period_key, reason) values ('liq1295','2026-00','Month zero is not real ok')$q$, 'obligation_waivers_period_chk');
select pg_temp.expect_error($q$insert into public.obligation_waivers (obligation, period_key, reason) values ('liq1295','W-2026-09-27','Weekly key on monthly row')$q$, 'obligation_waivers_period_chk');
select pg_temp.expect_error($q$insert into public.obligation_waivers (obligation, period_key, reason) values ('liq1295','2026-08-01','Day on a monthly key here')$q$, 'obligation_waivers_period_chk');

-- ---- reason ----------------------------------------------------------------
select pg_temp.expect_error($q$insert into public.obligation_waivers (obligation, period_key, reason) values ('liq1295','2026-07','   short   ')$q$, 'obligation_waivers_reason_chk');
select pg_temp.expect_error($q$insert into public.obligation_waivers (obligation, period_key, reason) values ('liq1295','2026-07', repeat('x', 501))$q$, 'obligation_waivers_reason_chk');
insert into public.obligation_waivers (obligation, period_key, reason) values ('liq1295','2026-06', repeat('y', 500));
select pg_temp.expect_error($q$insert into public.obligation_waivers (obligation, period_key, reason) values ('liq1295','2026-05', null)$q$, 'null value');

-- ---- revoke pair -----------------------------------------------------------
select pg_temp.expect_error($q$insert into public.obligation_waivers (obligation, period_key, reason, revoked_by_email) values ('liq1295','2026-04','Undo who without undo when','x@y.z')$q$, 'obligation_waivers_revoke_pair_chk');

-- ---- one live per period ---------------------------------------------------
select pg_temp.expect_error($q$insert into public.obligation_waivers (obligation, period_key, reason) values ('liq1295','2026-08','A second live dismissal')$q$, 'obligation_waivers_one_live');
-- the same period key under the OTHER obligation is independent
-- (no clash possible: the key shapes differ — proven by the period checks)

-- ---- guard: delete / edit / undo -------------------------------------------
select pg_temp.expect_error($q$delete from public.obligation_waivers where period_key='2026-08'$q$, 'WAIVER_PERMANENT');
select pg_temp.expect_error($q$update public.obligation_waivers set reason='A brand new reason text' where period_key='2026-08'$q$, 'WAIVER_ONLY_UNDO');
select pg_temp.expect_error($q$update public.obligation_waivers set period_key='2026-07' where period_key='2026-08'$q$, 'WAIVER_ONLY_UNDO');
select pg_temp.expect_error($q$update public.obligation_waivers set waived_at=now()-interval '1 day' where period_key='2026-08'$q$, 'WAIVER_ONLY_UNDO');
select pg_temp.expect_error($q$update public.obligation_waivers set waived_by_email='someone@else' where period_key='2026-08'$q$, 'WAIVER_ONLY_UNDO');
select pg_temp.expect_error($q$update public.obligation_waivers set obligation='ccrs_weekly' where period_key='2026-08'$q$, 'WAIVER_ONLY_UNDO');
select pg_temp.expect_error($q$update public.obligation_waivers set revoked_by_email='x@y' where period_key='2026-08'$q$, 'WAIVER_ONLY_UNDO');
-- undo + changing the reason in the same statement is still refused
select pg_temp.expect_error($q$update public.obligation_waivers set revoked_at=now(), reason='Sneaky reason change' where period_key='2026-08'$q$, 'WAIVER_ONLY_UNDO');
-- undo + changing any recorded column in the same statement is refused (one test per column)
select pg_temp.expect_error($q$update public.obligation_waivers set revoked_at=now(), period_key='2026-07' where period_key='2026-08'$q$, 'WAIVER_ONLY_UNDO');
select pg_temp.expect_error($q$update public.obligation_waivers set revoked_at=now(), waived_at=now()-interval '1 day' where period_key='2026-08'$q$, 'WAIVER_ONLY_UNDO');
select pg_temp.expect_error($q$update public.obligation_waivers set revoked_at=now(), waived_by_email='someone@else' where period_key='2026-08'$q$, 'WAIVER_ONLY_UNDO');
select pg_temp.expect_error($q$update public.obligation_waivers set revoked_at=now(), obligation='ccrs_weekly', period_key='W-2026-09-20' where period_key='2026-08'$q$, 'WAIVER_ONLY_UNDO');
select pg_temp.expect_error($q$update public.obligation_waivers set revoked_at=now(), waived_by=null where period_key='2026-08'$q$, 'WAIVER_ONLY_UNDO');
-- the set-null "staff removed" path is not a loophole: nulling the staff id
-- together with any other change is still refused
select pg_temp.expect_error($q$update public.obligation_waivers set waived_by=null, reason='Changed with the null' where period_key='W-2026-09-27'$q$, 'WAIVER_ONLY_UNDO');
select pg_temp.expect_error($q$update public.obligation_waivers set waived_by=null, waived_by_email=null where period_key='W-2026-09-27'$q$, 'WAIVER_ONLY_UNDO');
-- the real undo
update public.obligation_waivers
   set revoked_at = now(), revoked_by = '00000000-0000-0000-0000-0000000000a1', revoked_by_email = 'owner@test.local'
 where period_key = '2026-08' and revoked_at is null;
select pg_temp.expect_error($q$update public.obligation_waivers set revoked_at=now() where period_key='2026-08'$q$, 'WAIVER_ALREADY_UNDONE');
select pg_temp.expect_error($q$update public.obligation_waivers set revoked_by=null, revoked_by_email='other@x' where period_key='2026-08'$q$, 'WAIVER_ALREADY_UNDONE');
-- re-dismiss after undo inserts a NEW row; history keeps both
insert into public.obligation_waivers (obligation, period_key, reason) values ('liq1295','2026-08','Re-dismissed after checking');
do $$ begin
  assert (select count(*) from public.obligation_waivers where period_key='2026-08') = 2, 'history keeps undone + new';
  assert (select count(*) from public.obligation_waivers where period_key='2026-08' and revoked_at is null) = 1, 'one live';
end $$;

-- ---- staff removal: FK set-null cascade passes the guard, emails stay -------
delete from auth.users where id = '00000000-0000-0000-0000-0000000000a1';
do $$ begin
  assert (select count(*) from public.obligation_waivers where waived_by_email='owner@test.local' and waived_by is null) = 2, 'set null cascade allowed, email kept';
  assert (select count(*) from public.obligation_waivers where revoked_by_email='owner@test.local' and revoked_by is null) = 1, 'revoked_by set null allowed';
end $$;

-- ---- structure -------------------------------------------------------------
do $$ begin
  assert (select relrowsecurity from pg_class where oid='public.obligation_waivers'::regclass), 'RLS on';
  assert (select count(*) from pg_policies where tablename='obligation_waivers') = 2, 'two policies';
  assert has_table_privilege('service_role','public.obligation_waivers','INSERT'), 'service_role insert';
  assert has_table_privilege('service_role','public.obligation_waivers','UPDATE'), 'service_role update';
  assert (select count(*) from pg_trigger where tgrelid='public.obligation_waivers'::regclass and tgname='obligation_waivers_guard_trg') = 1, 'guard trigger';
  assert (select indisunique from pg_index where indexrelid='public.obligation_waivers_one_live'::regclass), 'one_live is unique';
end $$;

-- ---- RLS as real roles -----------------------------------------------------
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c3', 'owner2@test.local');
insert into public.staff_profiles (id, email, full_name, role, active) values
  ('00000000-0000-0000-0000-0000000000c3', 'owner2@test.local', 'Owner2', 'owner', true)
on conflict (id) do update set role = 'owner', active = true;
grant select, insert, update on public.obligation_waivers to authenticated;  -- inside this txn only
set local role authenticated;
-- plain staff: reads, cannot write
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
do $$ begin assert (select count(*) from public.obligation_waivers) >= 5, 'staff can read'; end $$;
select pg_temp.expect_error($q$insert into public.obligation_waivers (obligation, period_key, reason) values ('liq1295','2025-01','Staff role should not write')$q$, 'row-level security');
-- anonymous (no staff): sees nothing
select set_config('request.jwt.claim.sub', '', true);
do $$ begin assert (select count(*) from public.obligation_waivers) = 0, 'non-staff sees nothing'; end $$;
-- admin: writes
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c3', true);
insert into public.obligation_waivers (obligation, period_key, reason) values ('liq1295','2025-01','Admin can write this one');
reset role;

-- ---- rollback: refuses with rows, drops clean without ----------------------
-- With rows present the rollback file must abort. psql sets :ERROR after
-- each statement; once aborted, its last statement fails too, so ERROR is
-- true only if the refusal fired (a rollback that dropped the table would
-- finish cleanly and leave ERROR false).
savepoint before_rb;
\set ON_ERROR_STOP 0
\i supabase/rollbacks/0250_obligation_waivers.rollback.sql
\set ON_ERROR_STOP 1
\if :ERROR
\echo rollback refused as required
\else
select 'ROLLBACK DID NOT REFUSE'::int;
\endif
rollback to savepoint before_rb;
do $$ begin assert to_regclass('public.obligation_waivers') is not null, 'refused rollback left table'; end $$;
alter table public.obligation_waivers disable trigger obligation_waivers_guard_trg;
delete from public.obligation_waivers;
alter table public.obligation_waivers enable trigger obligation_waivers_guard_trg;
\i supabase/rollbacks/0250_obligation_waivers.rollback.sql
do $$ begin
  assert to_regclass('public.obligation_waivers') is null, 'rollback dropped table';
  assert to_regprocedure('public.obligation_waivers_guard()') is null, 'rollback dropped guard';
  assert to_regprocedure('public.obligation_waivers_is_sunday(text)') is null, 'rollback dropped helper';
end $$;
\i supabase/migrations/0250_obligation_waivers.sql
do $$ begin
  assert to_regclass('public.obligation_waivers') is not null, 're-apply after rollback';
  raise notice 'OBLIGATION WAIVERS CHECK PASSED';
end $$;
rollback;
