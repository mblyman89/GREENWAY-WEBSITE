-- scripts/recon/drawer-drop-bills-0349-pg-check.sql  (D217 - migration 0349)
--
-- Scenario check for 0349_drawer_drop_bills.sql on Postgres 15 with every migration applied.
-- ONE transaction, rolled back: nothing remains.
--   * 0349 applies twice (idempotent);
--   * an old-style safe drop (no bills) and an ATM drop still save;
--   * a safe drop with bills that add up to its amount saves (the owner's SR1 drop: 3 x $100,
--     1 x $50, 103 x $20, 10 x $1 = $2,420.00);
--   * refused: bills that disagree with the amount (the SR2 case: $2,080 typed, 77 x $20 = $1,540),
--     bills on an ATM drop, coins, unknown keys, negatives, fractions, strings, all-zero, a non-object;
--   * the bills are write-once (trigger) while notes stay writable;
--   * the rollback keeps the bills in the note ("[bills: ...]") and drops the column, and 0349 applies
--     again after it.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/drawer-drop-bills-0349-pg-check.sql
--
-- "DRAWER DROP BILLS 0349 CHECK PASSED" then ROLLBACK = all clear.
begin;

\i supabase/migrations/0349_drawer_drop_bills.sql
\i supabase/migrations/0349_drawer_drop_bills.sql

create temp table _c0349 (k text primary key, v uuid);

do $$
declare
  v_reg uuid;
  v_emp uuid;
  v_s uuid;
  v_old uuid;
  v_atm uuid;
  v_sr1 uuid;
begin
  insert into public.registers (name, kind, active, notes) values ('__0349__', 'sales', false, '0349 check')
    returning id into v_reg;
  insert into public.employees (full_name) values ('__0349 dropper__') returning id into v_emp;
  insert into public.drawer_sessions (register_id, business_day, status, opening_count_minor, opened_at, notes)
    values (v_reg, current_date, 'open', 16750, now() - interval '3 hours', '__0349__')
    returning id into v_s;

  insert into public.drawer_drops (session_id, amount_minor, drop_window, dropped_by, notes)
    values (v_s, 208000, 'afternoon', v_emp, 'old style') returning id into v_old;
  assert (select bills from public.drawer_drops where id = v_old) is null, 'old-style drop has no bills';

  insert into public.drawer_drops (session_id, amount_minor, drop_window, dropped_by, destination, twenties_count, atm_terminal_id)
    values (v_s, 160000, 'other', v_emp, 'atm', 80, 'HG26499') returning id into v_atm;

  insert into public.drawer_drops (session_id, amount_minor, drop_window, dropped_by, destination, bills)
    values (v_s, 242000, 'night', v_emp, 'safe', '{"hundreds":3,"fifties":1,"twenties":103,"ones":10}'::jsonb)
    returning id into v_sr1;
  assert public.drawer_drop_bills_total((select bills from public.drawer_drops where id = v_sr1)) = 242000, 'SR1 bills add up';

  begin
    insert into public.drawer_drops (session_id, amount_minor, destination, bills) values (v_s, 208000, 'safe', '{"twenties":77}');
    raise exception 'TEST_FAILED: bills disagree with the amount';
  exception when check_violation then null; end;
  begin
    insert into public.drawer_drops (session_id, amount_minor, destination, twenties_count, bills) values (v_s, 4000, 'atm', 2, '{"twenties":2}');
    raise exception 'TEST_FAILED: bills on an ATM drop';
  exception when check_violation then null; end;
  begin
    insert into public.drawer_drops (session_id, amount_minor, destination, bills) values (v_s, 100, 'safe', '{"quarters":4}');
    raise exception 'TEST_FAILED: coins';
  exception when check_violation then null; end;
  begin
    insert into public.drawer_drops (session_id, amount_minor, destination, bills) values (v_s, 2000, 'safe', '{"twenties":1,"bogus":0}');
    raise exception 'TEST_FAILED: unknown key';
  exception when check_violation then null; end;
  begin
    insert into public.drawer_drops (session_id, amount_minor, destination, bills) values (v_s, 2000, 'safe', '{"twenties":2,"tens":-2}');
    raise exception 'TEST_FAILED: negative';
  exception when check_violation then null; end;
  begin
    insert into public.drawer_drops (session_id, amount_minor, destination, bills) values (v_s, 3000, 'safe', '{"twenties":1.5}');
    raise exception 'TEST_FAILED: fraction';
  exception when check_violation then null; end;
  begin
    insert into public.drawer_drops (session_id, amount_minor, destination, bills) values (v_s, 2000, 'safe', '{"twenties":"1"}');
    raise exception 'TEST_FAILED: string count';
  exception when check_violation then null; end;
  begin
    insert into public.drawer_drops (session_id, amount_minor, destination, bills) values (v_s, 2000, 'safe', '{"twenties":0}');
    raise exception 'TEST_FAILED: all zero';
  exception when check_violation then null; end;
  begin
    insert into public.drawer_drops (session_id, amount_minor, destination, bills) values (v_s, 2000, 'safe', '[1]');
    raise exception 'TEST_FAILED: not an object';
  exception when check_violation then null; end;

  -- write-once bills; notes stay writable
  begin
    update public.drawer_drops set bills = '{"twenties":121}'::jsonb where id = v_sr1;
    raise exception 'TEST_FAILED: bills changed';
  exception when check_violation then null; end;
  update public.drawer_drops set notes = 'counted twice' where id = v_sr1;
  assert (select notes from public.drawer_drops where id = v_sr1) = 'counted twice', 'notes writable';

  assert has_function_privilege('service_role', 'public.drawer_drop_bills_total(jsonb)', 'execute'),
         'service_role can run the CHECK helper (the server inserts drops)';
  assert not has_function_privilege('anon', 'public.drawer_drop_bills_total(jsonb)', 'execute'), 'anon cannot';

  insert into _c0349 values ('sr1', v_sr1), ('old', v_old), ('atm', v_atm);
end
$$;

\i supabase/rollbacks/0349_drawer_drop_bills.rollback.sql

do $$
begin
  assert not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'drawer_drops'
                        and column_name = 'bills'), 'rollback dropped the column';
  assert (select notes from public.drawer_drops where id = (select v from _c0349 where k = 'sr1')) like 'counted twice [bills: %',
         'rollback keeps the bills in the note';
  assert (select notes from public.drawer_drops where id = (select v from _c0349 where k = 'old')) = 'old style',
         'no bills note on an uncounted drop';
  begin
    update public.drawer_drops set amount_minor = 1 where id = (select v from _c0349 where k = 'old');
    raise exception 'TEST_FAILED: rollback must keep the 0346 money trigger';
  exception when check_violation then null; end;
end
$$;

\i supabase/migrations/0349_drawer_drop_bills.sql

do $$
begin
  assert exists (select 1 from pg_constraint where conname = 'drawer_drops_bills_shape'), '0349 re-applies after the rollback';
end
$$;

\echo DRAWER DROP BILLS 0349 CHECK PASSED
rollback;
