-- scripts/recon/daily-checklists-0327-pg-check.sql  (Fix Phase 4.4b - migration 0327)
--
-- Scenario check for 0327_daily_checklists.sql on Postgres 15 with every
-- migration applied. ONE transaction, rolled back: nothing remains.
--   * rollback then re-apply, twice (idempotent); the seed is 61 tasks from
--     SOP-06 forms 8.5-8.8, three of them carry the live Cycle Counts line;
--   * re-running never overwrites an owner edit;
--   * RLS: a staff sign-in reads, a browser cannot insert / update / delete;
--   * a tick on the wrong list, a second tick of the same task, an edited or
--     deleted tick, a tick after sign-off: all refused;
--   * sign-off with open tasks needs a note; a sign-off cannot be changed;
--   * no delete of a task or a sheet; a task cannot move lists;
--   * the factory reset hatch lets the wipe through.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/daily-checklists-0327-pg-check.sql
--
-- "CHECKLISTS 0327 CHECK PASSED" then ROLLBACK = all clear.
begin;

\i supabase/rollbacks/0327_daily_checklists.rollback.sql
do $$ begin
  assert to_regclass('public.checklist_tasks') is null, 'clean start';
end $$;
\i supabase/migrations/0327_daily_checklists.sql
\i supabase/migrations/0327_daily_checklists.sql

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

do $$ begin
  assert (select count(*) from public.checklist_tasks) = 61, 'seed: 61 tasks from forms 8.5-8.8';
  assert (select count(*) from public.checklist_tasks where kind = 'opening') = 19, 'form 8.5: 19';
  assert (select count(*) from public.checklist_tasks where kind = 'during') = 15, 'form 8.6: 15';
  assert (select count(*) from public.checklist_tasks where kind = 'closing') = 11, 'form 8.7: 11';
  assert (select count(*) from public.checklist_tasks where kind in ('weekly','monthly','yearly')) = 16, 'form 8.8: 16';
  assert (select count(*) from public.checklist_tasks where live_line = 'cycle_counts') = 3, 'three live Cycle Counts lines';
  assert (select count(*) from public.checklist_tasks where sop_ref = 'SOP-05a ' || chr(167) || '4.16') = 2, 'SOP refs kept';
end $$;

-- an owner edit survives a re-run
update public.checklist_tasks set label = 'Owner wording' where seed_key = 'sop06-8.5-01';
\i supabase/migrations/0327_daily_checklists.sql
do $$ begin
  assert (select label from public.checklist_tasks where seed_key = 'sop06-8.5-01') = 'Owner wording', 're-run keeps the owner edit';
  assert (select count(*) from public.checklist_tasks) = 61, 're-run adds nothing';
end $$;

-- people
create temp table ids (k text primary key, v uuid);
grant all on ids to public;
do $$ declare u uuid; begin
  insert into auth.users (email) values ('ck-staff@example.com') returning id into u;
  insert into public.staff_profiles (id, email, full_name, role) values (u, 'ck-staff@example.com', 'Ana Floor', 'staff')
    on conflict (id) do update set full_name = 'Ana Floor', role = 'staff', active = true;
  insert into ids values ('staff', u);
end $$;

-- RLS: a browser (authenticated) reads but cannot write
grant select, insert, update, delete on public.checklist_tasks, public.checklist_runs, public.checklist_ticks to authenticated;
select set_config('request.jwt.claim.sub', (select v::text from ids where k = 'staff'), true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.checklist_tasks) = 61, 'staff reads the catalog';
end $$;
select pg_temp.expect_error($q$insert into public.checklist_runs (kind, period_key) values ('opening', '2026-10-30')$q$, 'row-level security');
do $$ declare n int; begin
  update public.checklist_tasks set label = 'x' where seed_key = 'sop06-8.5-02';
  get diagnostics n = row_count;
  assert n = 0, 'browser update touches no row';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);

-- a sheet and its ticks (server = service role)
do $$ declare r uuid; t_open uuid; t_close uuid; begin
  insert into public.checklist_runs (kind, period_key, opened_by) values ('opening', '2026-10-30', (select v from ids where k = 'staff')) returning id into r;
  insert into ids values ('run', r);
  select id into t_open from public.checklist_tasks where seed_key = 'sop06-8.5-02';
  select id into t_close from public.checklist_tasks where seed_key = 'sop06-8.7-01';
  insert into ids values ('t_open', t_open), ('t_close', t_close);
  insert into public.checklist_ticks (run_id, task_id, task_label, task_section, done_by, done_by_name, initials)
    values (r, t_open, 'Cameras', 'SECURITY & SAFETY', (select v from ids where k = 'staff'), 'Ana Floor', 'AF');
end $$;
select pg_temp.expect_error($q$insert into public.checklist_runs (kind, period_key) values ('opening', '2026-10-30')$q$, 'checklist_runs_kind_period_uq');
select pg_temp.expect_error(format($q$insert into public.checklist_ticks (run_id, task_id, task_label, task_section, done_by_name, initials) values (%L, %L, 'x', 'x', 'A', 'AF')$q$, (select v from ids where k = 'run'), (select v from ids where k = 't_close')), 'CHECKLIST_WRONG_LIST');
select pg_temp.expect_error(format($q$insert into public.checklist_ticks (run_id, task_id, task_label, task_section, done_by_name, initials) values (%L, %L, 'x', 'x', 'A', 'AF')$q$, (select v from ids where k = 'run'), (select v from ids where k = 't_open')), 'checklist_ticks_run_task_uq');
select pg_temp.expect_error(format($q$insert into public.checklist_ticks (run_id, task_id, task_label, task_section, done_by_name, initials) values (%L, (select id from public.checklist_tasks where seed_key = 'sop06-8.5-03'), 'x', 'x', 'A', 'a1')$q$, (select v from ids where k = 'run')), 'checklist_ticks_initials_ck');
select pg_temp.expect_error($q$update public.checklist_ticks set initials = 'ZZ'$q$, 'CHECKLIST_TICK_PERMANENT');
select pg_temp.expect_error($q$delete from public.checklist_ticks$q$, 'CHECKLIST_TICK_PERMANENT');

-- sign-off
select pg_temp.expect_error(format($q$update public.checklist_runs set signed_off_at = now(), signed_off_name = 'Mgr', open_tasks_at_signoff = 18 where id = %L$q$, (select v from ids where k = 'run')), 'checklist_runs_open_needs_note');
update public.checklist_runs set signed_off_at = now(), signed_off_name = 'Mgr', open_tasks_at_signoff = 18, signoff_note = 'short-staffed'
  where id = (select v from ids where k = 'run');
select pg_temp.expect_error(format($q$update public.checklist_runs set signoff_note = 'changed' where id = %L$q$, (select v from ids where k = 'run')), 'CHECKLIST_SIGNED_OFF');
select pg_temp.expect_error(format($q$insert into public.checklist_ticks (run_id, task_id, task_label, task_section, done_by_name, initials) values (%L, (select id from public.checklist_tasks where seed_key = 'sop06-8.5-03'), 'x', 'x', 'A', 'AF')$q$, (select v from ids where k = 'run')), 'CHECKLIST_SIGNED_OFF');

-- no delete; a task keeps its list
select pg_temp.expect_error($q$delete from public.checklist_runs$q$, 'CHECKLIST_RUN_PERMANENT');
select pg_temp.expect_error($q$delete from public.checklist_tasks where seed_key = 'sop06-8.5-04'$q$, 'CHECKLIST_TASK_PERMANENT');
select pg_temp.expect_error($q$update public.checklist_tasks set kind = 'closing' where seed_key = 'sop06-8.5-04'$q$, 'CHECKLIST_TASK_FIXED');
update public.checklist_tasks set active = false, label = 'Retired wording' where seed_key = 'sop06-8.5-04';

-- the factory reset hatch lets the wipe through
do $$ begin
  perform set_config('greenway.factory_reset', 'on', true);
  assert public.gl_factory_reset_active(), 'hatch on';
  delete from public.checklist_ticks;
  delete from public.checklist_runs;
  assert (select count(*) from public.checklist_runs) = 0, 'reset hatch';
  perform set_config('greenway.factory_reset', 'off', true);
end $$;

select 'CHECKLISTS 0327 CHECK PASSED' as result;
rollback;
