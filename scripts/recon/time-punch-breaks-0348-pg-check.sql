-- scripts/recon/time-punch-breaks-0348-pg-check.sql  (D211 - migration 0348)
--
-- Scenario check for 0348_time_punch_breaks.sql on Postgres 15 with every migration applied.
-- ONE transaction, rolled back: nothing remains.
--   * 0348 applies twice (idempotent);
--   * a plain work punch still saves with no reason;
--   * a lunch break saves with or without a note; an other break saves with a note;
--   * refused: a break with no reason, an unknown reason, other with no note, a too-short note,
--     a work punch carrying a reason or a note;
--   * the rollback keeps the reason in `notes` ("[Break: ...]") and drops the columns, and 0348
--     applies again after it.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/time-punch-breaks-0348-pg-check.sql
--
-- "TIME PUNCH BREAKS 0348 CHECK PASSED" then ROLLBACK = all clear.
begin;

\i supabase/migrations/0348_time_punch_breaks.sql
\i supabase/migrations/0348_time_punch_breaks.sql

create temp table _c0348 (k text primary key, v uuid);

do $$
declare
  v_emp uuid;
  v_work uuid;
  v_lunch uuid;
  v_other uuid;
begin
  insert into public.employees (full_name) values ('__0348 cashier__') returning id into v_emp;

  insert into public.time_punches (employee_id, punch_kind, clock_in_at, clock_out_at, minutes, source)
    values (v_emp, 'work', now() - interval '6 hours', now() - interval '3 hours', 180, 'register')
    returning id into v_work;
  assert (select break_reason from public.time_punches where id = v_work) is null, 'work punch has no reason';

  insert into public.time_punches (employee_id, punch_kind, clock_in_at, clock_out_at, minutes, source, break_reason)
    values (v_emp, 'break', now() - interval '3 hours', now() - interval '150 minutes', 30, 'register', 'lunch')
    returning id into v_lunch;
  insert into public.time_punches (employee_id, punch_kind, clock_in_at, source, break_reason, break_note)
    values (v_emp, 'break', now() - interval '1 hour', 'phone', 'other', 'doctor called back')
    returning id into v_other;
  assert (select count(*) from public.time_punches
           where employee_id = v_emp and punch_kind = 'break' and clock_out_at is null) = 1, 'one open break';

  begin
    insert into public.time_punches (employee_id, punch_kind, source) values (v_emp, 'break', 'web');
    raise exception 'TEST_FAILED: a break needs a reason';
  exception when check_violation then null; end;
  begin
    insert into public.time_punches (employee_id, punch_kind, source, break_reason) values (v_emp, 'break', 'web', 'nap');
    raise exception 'TEST_FAILED: unknown reason';
  exception when check_violation then null; end;
  begin
    insert into public.time_punches (employee_id, punch_kind, source, break_reason) values (v_emp, 'break', 'web', 'other');
    raise exception 'TEST_FAILED: other needs a note';
  exception when check_violation then null; end;
  begin
    insert into public.time_punches (employee_id, punch_kind, source, break_reason, break_note)
      values (v_emp, 'break', 'web', 'other', 'ok');
    raise exception 'TEST_FAILED: note too short';
  exception when check_violation then null; end;
  begin
    insert into public.time_punches (employee_id, punch_kind, source, break_reason) values (v_emp, 'work', 'web', 'lunch');
    raise exception 'TEST_FAILED: work punch with a reason';
  exception when check_violation then null; end;
  begin
    insert into public.time_punches (employee_id, punch_kind, source, break_note) values (v_emp, 'work', 'web', 'some note');
    raise exception 'TEST_FAILED: work punch with a break note';
  exception when check_violation then null; end;

  -- closing a break still works (the end-break path)
  update public.time_punches set clock_out_at = now(), minutes = 60 where id = v_other;
  assert (select minutes from public.time_punches where id = v_other) = 60, 'break closes';

  insert into _c0348 values ('lunch', v_lunch), ('other', v_other), ('work', v_work);
end
$$;

\i supabase/rollbacks/0348_time_punch_breaks.rollback.sql

do $$
begin
  assert not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'time_punches'
                        and column_name in ('break_reason', 'break_note')), 'rollback dropped the columns';
  assert (select notes from public.time_punches where id = (select v from _c0348 where k = 'lunch'))
         = '[Break: lunch]', 'rollback note on the lunch break';
  assert (select notes from public.time_punches where id = (select v from _c0348 where k = 'other'))
         = '[Break: other - doctor called back]', 'rollback note on the other break';
  assert (select notes from public.time_punches where id = (select v from _c0348 where k = 'work')) is null,
         'no note on a work punch';
  assert exists (select 1 from public.time_punches where id = (select v from _c0348 where k = 'lunch')
                   and punch_kind = 'break'), 'break punches are kept';
end
$$;

\i supabase/migrations/0348_time_punch_breaks.sql

do $$
begin
  assert exists (select 1 from pg_constraint where conname = 'time_punches_break_shape'), '0348 re-applies after the rollback';
  assert (select break_reason from public.time_punches where id = (select v from _c0348 where k = 'lunch')) = 'other',
         're-apply backfills old breaks as other';
end
$$;

\echo TIME PUNCH BREAKS 0348 CHECK PASSED
rollback;
