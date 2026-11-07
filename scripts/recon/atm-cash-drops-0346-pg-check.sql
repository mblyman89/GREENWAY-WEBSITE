-- scripts/recon/atm-cash-drops-0346-pg-check.sql  (D198 S1 - migration 0346)
--
-- Scenario check for 0346_atm_cash_drops.sql on Postgres 15 with every migration applied.
-- ONE transaction, rolled back: nothing remains.
--   * 0346 applies twice (idempotent);
--   * an old-style insert (no destination) is a safe drop with no $20 count;
--   * an ATM drop must carry a $20 count and amount = count x $20; odd amounts, zero bills, a safe
--     drop with a $20 count, a terminal on a safe drop and an unknown destination are refused;
--   * the money on a drop is write-once (amount / destination / count / terminal / time / drawer)
--     while notes and witness stay writable, an employee delete still nulls dropped_by, and the
--     drawer delete still cascades (the factory reset path);
--   * atm_drop_reviews: append-only for the server, invisible to anon / authenticated, 'linked'
--     needs a load id and only on a drop.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/atm-cash-drops-0346-pg-check.sql
--
-- "ATM CASH DROPS 0346 CHECK PASSED" then ROLLBACK = all clear.
begin;

\i supabase/migrations/0346_atm_cash_drops.sql
\i supabase/migrations/0346_atm_cash_drops.sql

do $$
declare
  v_reg uuid;
  v_emp uuid;
  v_wit uuid;
  v_s uuid;
  v_safe uuid;
  v_atm uuid;
  v_ok boolean;
begin
  insert into public.registers (name, kind, active, notes) values ('__0346__', 'sales', false, '0346 check')
    returning id into v_reg;
  insert into public.employees (full_name) values ('__0346 dropper__') returning id into v_emp;
  insert into public.employees (full_name) values ('__0346 witness__') returning id into v_wit;
  insert into public.drawer_sessions (register_id, business_day, status, opening_count_minor, opened_at, notes)
    values (v_reg, current_date, 'open', 16750, now() - interval '3 hours', '__0346__')
    returning id into v_s;

  -- old-style insert: safe, no count
  insert into public.drawer_drops (session_id, amount_minor, drop_window, dropped_by, notes)
    values (v_s, 123456, 'afternoon', v_emp, 'old style') returning id into v_safe;
  assert (select destination from public.drawer_drops where id = v_safe) = 'safe', 'default destination is safe';
  assert (select twenties_count from public.drawer_drops where id = v_safe) is null, 'safe drop has no count';

  -- a proper ATM drop
  insert into public.drawer_drops (session_id, amount_minor, drop_window, dropped_by, witnessed_by,
                                   destination, twenties_count, atm_terminal_id, device_id, recorded_via)
    values (v_s, 160000, 'other', v_emp, v_wit, 'atm', 80, 'HG26499', 'ipad-1', 'register')
    returning id into v_atm;
  assert (select amount_minor from public.drawer_drops where id = v_atm) = 160000, 'atm drop saved';

  -- refusals
  begin
    insert into public.drawer_drops (session_id, amount_minor, destination, twenties_count) values (v_s, 150000, 'atm', 80);
    raise exception 'TEST_FAILED: amount must equal count x 2000';
  exception when check_violation then null; end;
  begin
    insert into public.drawer_drops (session_id, amount_minor, destination) values (v_s, 100000, 'atm');
    raise exception 'TEST_FAILED: atm drop without a count';
  exception when check_violation then null; end;
  begin
    insert into public.drawer_drops (session_id, amount_minor, destination, twenties_count) values (v_s, 0, 'atm', 0);
    raise exception 'TEST_FAILED: zero bills';
  exception when check_violation then null; end;
  begin
    insert into public.drawer_drops (session_id, amount_minor, destination, twenties_count) values (v_s, 4000, 'safe', 2);
    raise exception 'TEST_FAILED: safe drop with a count';
  exception when check_violation then null; end;
  begin
    insert into public.drawer_drops (session_id, amount_minor, destination, atm_terminal_id) values (v_s, 4000, 'safe', 'HG26499');
    raise exception 'TEST_FAILED: terminal on a safe drop';
  exception when check_violation then null; end;
  begin
    insert into public.drawer_drops (session_id, amount_minor, destination) values (v_s, 4000, 'pocket');
    raise exception 'TEST_FAILED: unknown destination';
  exception when check_violation then null; end;
  begin
    insert into public.drawer_drops (session_id, amount_minor, recorded_via) values (v_s, 4000, 'phone');
    raise exception 'TEST_FAILED: unknown recorded_via';
  exception when check_violation then null; end;
  begin
    insert into public.drawer_drops (session_id, amount_minor) values (v_s, -500);
    raise exception 'TEST_FAILED: negative drop';
  exception when check_violation then null; end;

  -- write-once money
  begin
    update public.drawer_drops set amount_minor = 140000, twenties_count = 70 where id = v_atm;
    raise exception 'TEST_FAILED: amount changed';
  exception when check_violation then null; end;
  begin
    update public.drawer_drops set destination = 'safe', twenties_count = null, atm_terminal_id = null where id = v_atm;
    raise exception 'TEST_FAILED: destination changed';
  exception when check_violation then null; end;
  begin
    update public.drawer_drops set dropped_at = now() - interval '1 day' where id = v_atm;
    raise exception 'TEST_FAILED: time changed';
  exception when check_violation then null; end;
  begin
    update public.drawer_drops set amount_minor = 1 where id = v_safe;
    raise exception 'TEST_FAILED: safe amount changed';
  exception when check_violation then null; end;
  update public.drawer_drops set notes = 'explained', witnessed_by = null where id = v_atm;
  assert (select notes from public.drawer_drops where id = v_atm) = 'explained', 'notes writable';

  delete from public.employees where id = v_emp;
  assert (select dropped_by from public.drawer_drops where id = v_atm) is null, 'employee delete nulls dropped_by';

  -- reviews
  insert into public.atm_drop_reviews (subject_kind, subject_id, decision, note, signal_codes)
    values ('drop', v_atm::text, 'accepted', 'counted with me', array['no_witness']);
  begin
    insert into public.atm_drop_reviews (subject_kind, subject_id, decision, note) values ('drop', v_atm::text, 'linked', 'no load');
    raise exception 'TEST_FAILED: linked without load';
  exception when check_violation then null; end;
  begin
    insert into public.atm_drop_reviews (subject_kind, subject_id, decision, link_load_id, note)
      values ('load', 'x', 'linked', gen_random_uuid(), 'wrong kind');
    raise exception 'TEST_FAILED: linked on a load';
  exception when check_violation then null; end;
  begin
    insert into public.atm_drop_reviews (subject_kind, subject_id, decision, note) values ('drop', 'x', 'accepted', '  ');
    raise exception 'TEST_FAILED: blank note';
  exception when check_violation then null; end;

  assert has_table_privilege('service_role', 'public.atm_drop_reviews', 'INSERT'), 'service inserts reviews';
  assert has_table_privilege('service_role', 'public.atm_drop_reviews', 'SELECT'), 'service reads reviews';
  assert not has_table_privilege('service_role', 'public.atm_drop_reviews', 'UPDATE'), 'reviews never updated';
  assert not has_table_privilege('service_role', 'public.atm_drop_reviews', 'DELETE'), 'reviews never deleted';
  assert not has_table_privilege('anon', 'public.atm_drop_reviews', 'SELECT'), 'anon cannot read reviews';
  assert not has_table_privilege('authenticated', 'public.atm_drop_reviews', 'SELECT'), 'authenticated cannot read reviews';
  assert (select relrowsecurity from pg_class where oid = 'public.atm_drop_reviews'::regclass), 'RLS on';
  assert not has_function_privilege('anon', 'public.drawer_drops_money_immutable()', 'EXECUTE'), 'anon cannot call trigger fn';

  -- the drawer delete still cascades (reset / cleanup path)
  delete from public.drawer_sessions where id = v_s;
  assert not exists (select 1 from public.drawer_drops where session_id = v_s), 'cascade delete still works';
end
$$;

\echo 'ATM CASH DROPS 0346 CHECK PASSED'
rollback;
