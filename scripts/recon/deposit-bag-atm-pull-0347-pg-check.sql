-- scripts/recon/deposit-bag-atm-pull-0347-pg-check.sql  (D198e - migration 0347)
--
-- Scenario check for 0347_deposit_bag_atm_pull.sql on Postgres 15 with every migration applied.
-- ONE transaction, rolled back: nothing remains.
--   * 0347 applies twice (idempotent);
--   * an old-style bag (no pull) still saves, and its flags default to '{}';
--   * a bag with a pull must carry count, amount = count x $20, time and terminal; zero bills,
--     over 2500 bills, an odd amount, a pull with no time / terminal, a half pull (person or reason
--     with no count), the witness being the puller, a too-short reason, and a negative balance are
--     refused;
--   * the pull is write-once: the count, the amount, the time, the terminal, the flags, the reason,
--     the balance seen and the people cannot be changed, and a pull cannot be ADDED to a saved bag;
--     other bag columns (the morning recount) still update; an employee delete still nulls the
--     puller / witness through the foreign key;
--   * the rollback keeps the money visible (night_note gets "[ATM pull: ...]", also on a sealed bag)
--     and drops the columns, and 0347 applies again after it.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/deposit-bag-atm-pull-0347-pg-check.sql
--
-- "DEPOSIT BAG ATM PULL 0347 CHECK PASSED" then ROLLBACK = all clear.
begin;

\i supabase/migrations/0347_deposit_bag_atm_pull.sql
\i supabase/migrations/0347_deposit_bag_atm_pull.sql

create temp table _c0347 (k text primary key, v uuid);

do $$
declare
  v_emp uuid;
  v_wit uuid;
  v_gone uuid;
  v_old uuid;
  v_bag uuid;
  v_sealed uuid;
begin
  insert into public.employees (full_name) values ('__0347 builder__') returning id into v_emp;
  insert into public.employees (full_name) values ('__0347 witness__') returning id into v_wit;
  insert into public.employees (full_name) values ('__0347 leaver__') returning id into v_gone;

  -- old-style bag: no pull
  insert into public.deposit_bags (bag_no, business_day, status, pulled_by, night_count_minor, night_counted_by,
                                   night_counted_at, expected_minor)
    values ('__0347-A__', current_date - 400, 'undeclared', v_emp, 250000, v_emp, now(), 250000)
    returning id into v_old;
  assert (select atm_pull_flags from public.deposit_bags where id = v_old) = '{}'::text[], 'flags default to empty';
  assert (select atm_pull_twenties from public.deposit_bags where id = v_old) is null, 'no pull on an old bag';

  -- a proper pull: 40 x $20 = $800 out of a $2,500 deposit
  insert into public.deposit_bags (bag_no, business_day, status, pulled_by, night_count_minor, night_counted_by,
                                   night_counted_at, expected_minor,
                                   atm_pull_twenties, atm_pull_minor, atm_pulled_by, atm_pull_witnessed_by,
                                   atm_pulled_at, atm_pull_terminal_id, atm_pull_flags,
                                   atm_pull_balance_seen_cents, atm_pull_balance_seen_at, atm_pull_reason)
    values ('__0347-B__', current_date - 400, 'undeclared', v_gone, 170000, v_gone, now(), 250000,
            40, 80000, v_gone, v_wit, now(), 'HG26499', array['OVER_NEED'], 120000, now() - interval '5 minutes',
            'busy weekend coming')
    returning id into v_bag;
  assert (select atm_pull_minor from public.deposit_bags where id = v_bag) = 80000, 'pull saved';

  -- refusals
  begin
    insert into public.deposit_bags (bag_no, business_day, atm_pull_twenties, atm_pull_minor, atm_pulled_at, atm_pull_terminal_id)
      values ('__0347-X1__', current_date - 400, 0, 0, now(), 'HG26499');
    raise exception 'TEST_FAILED: zero bills';
  exception when check_violation then null; end;
  begin
    insert into public.deposit_bags (bag_no, business_day, atm_pull_twenties, atm_pull_minor, atm_pulled_at, atm_pull_terminal_id)
      values ('__0347-X2__', current_date - 400, 2501, 5002000, now(), 'HG26499');
    raise exception 'TEST_FAILED: over 2500 bills';
  exception when check_violation then null; end;
  begin
    insert into public.deposit_bags (bag_no, business_day, atm_pull_twenties, atm_pull_minor, atm_pulled_at, atm_pull_terminal_id)
      values ('__0347-X3__', current_date - 400, 40, 79999, now(), 'HG26499');
    raise exception 'TEST_FAILED: amount must equal count x 2000';
  exception when check_violation then null; end;
  begin
    insert into public.deposit_bags (bag_no, business_day, atm_pull_twenties, atm_pull_minor, atm_pull_terminal_id)
      values ('__0347-X4__', current_date - 400, 40, 80000, 'HG26499');
    raise exception 'TEST_FAILED: pull needs a time';
  exception when check_violation then null; end;
  begin
    insert into public.deposit_bags (bag_no, business_day, atm_pull_twenties, atm_pull_minor, atm_pulled_at)
      values ('__0347-X5__', current_date - 400, 40, 80000, now());
    raise exception 'TEST_FAILED: pull needs a terminal';
  exception when check_violation then null; end;
  begin
    insert into public.deposit_bags (bag_no, business_day, atm_pulled_by) values ('__0347-X6__', current_date - 400, v_emp);
    raise exception 'TEST_FAILED: puller with no pull';
  exception when check_violation then null; end;
  begin
    insert into public.deposit_bags (bag_no, business_day, atm_pull_reason) values ('__0347-X7__', current_date - 400, 'why not');
    raise exception 'TEST_FAILED: reason with no pull';
  exception when check_violation then null; end;
  begin
    insert into public.deposit_bags (bag_no, business_day, atm_pull_flags) values ('__0347-X7b__', current_date - 400, array['NO_WITNESS']);
    raise exception 'TEST_FAILED: flags with no pull';
  exception when check_violation then null; end;
  begin
    insert into public.deposit_bags (bag_no, business_day, atm_pull_twenties, atm_pull_minor, atm_pulled_at, atm_pull_terminal_id,
                                     atm_pulled_by, atm_pull_witnessed_by)
      values ('__0347-X8__', current_date - 400, 40, 80000, now(), 'HG26499', v_emp, v_emp);
    raise exception 'TEST_FAILED: witness must be another person';
  exception when check_violation then null; end;
  begin
    insert into public.deposit_bags (bag_no, business_day, atm_pull_twenties, atm_pull_minor, atm_pulled_at, atm_pull_terminal_id, atm_pull_reason)
      values ('__0347-X9__', current_date - 400, 40, 80000, now(), 'HG26499', 'no');
    raise exception 'TEST_FAILED: reason too short';
  exception when check_violation then null; end;
  begin
    insert into public.deposit_bags (bag_no, business_day, atm_pull_twenties, atm_pull_minor, atm_pulled_at, atm_pull_terminal_id, atm_pull_balance_seen_cents)
      values ('__0347-X10__', current_date - 400, 40, 80000, now(), 'HG26499', -1);
    raise exception 'TEST_FAILED: negative balance';
  exception when check_violation then null; end;
  begin
    insert into public.deposit_bags (bag_no, business_day, atm_pull_twenties, atm_pull_minor, atm_pulled_at, atm_pull_terminal_id, atm_pull_balance_seen_at)
      values ('__0347-X11__', current_date - 400, 40, 80000, now(), 'HG26499', now());
    raise exception 'TEST_FAILED: balance time with no balance';
  exception when check_violation then null; end;

  -- write-once
  begin
    update public.deposit_bags set atm_pull_twenties = 41, atm_pull_minor = 82000 where id = v_bag;
    raise exception 'TEST_FAILED: count changed';
  exception when check_violation then
    if sqlerrm not like 'DEPOSIT_BAG_ATM_PULL_IMMUTABLE%' then raise; end if;
  end;
  begin
    update public.deposit_bags set atm_pulled_at = now() - interval '1 day' where id = v_bag;
    raise exception 'TEST_FAILED: time changed';
  exception when check_violation then null; end;
  begin
    update public.deposit_bags set atm_pull_terminal_id = 'OTHER' where id = v_bag;
    raise exception 'TEST_FAILED: terminal changed';
  exception when check_violation then null; end;
  begin
    update public.deposit_bags set atm_pull_flags = '{}' where id = v_bag;
    raise exception 'TEST_FAILED: flags cleared';
  exception when check_violation then null; end;
  begin
    update public.deposit_bags set atm_pull_reason = 'a nicer reason' where id = v_bag;
    raise exception 'TEST_FAILED: reason changed';
  exception when check_violation then null; end;
  begin
    update public.deposit_bags set atm_pull_balance_seen_cents = 0 where id = v_bag;
    raise exception 'TEST_FAILED: balance seen changed';
  exception when check_violation then null; end;
  begin
    update public.deposit_bags set atm_pull_witnessed_by = v_emp where id = v_bag;
    raise exception 'TEST_FAILED: witness changed';
  exception when check_violation then null; end;
  begin
    update public.deposit_bags set atm_pulled_by = v_emp where id = v_bag;
    raise exception 'TEST_FAILED: puller changed';
  exception when check_violation then null; end;
  begin
    update public.deposit_bags set atm_pull_twenties = 10, atm_pull_minor = 20000, atm_pulled_at = now(),
                                   atm_pull_terminal_id = 'HG26499', atm_pulled_by = v_emp
     where id = v_old;
    raise exception 'TEST_FAILED: a pull added to a saved bag';
  exception when check_violation then
    if sqlerrm not like 'DEPOSIT_BAG_ATM_PULL_IMMUTABLE%' then raise; end if;
  end;

  -- other columns still update (the morning recount, by a different person)
  update public.deposit_bags set morning_count_minor = 170000, morning_counted_by = v_emp, morning_counted_at = now()
   where id = v_bag;
  assert (select morning_count_minor from public.deposit_bags where id = v_bag) = 170000, 'recount still saves';

  -- employee delete nulls the people through the foreign key
  delete from public.employees where id = v_gone;
  assert (select atm_pulled_by from public.deposit_bags where id = v_bag) is null, 'puller nulled on delete';
  assert (select atm_pull_twenties from public.deposit_bags where id = v_bag) = 40, 'pull money kept';

  -- a sealed bag with a pull (for the rollback check)
  insert into public.deposit_bags (bag_no, business_day, status, pulled_by, night_count_minor, night_counted_by,
                                   night_counted_at, expected_minor,
                                   atm_pull_twenties, atm_pull_minor, atm_pulled_by, atm_pulled_at, atm_pull_terminal_id,
                                   atm_pull_flags)
    values ('__0347-C__', current_date - 400, 'undeclared', v_emp, 100000, v_emp, now(), 120000,
            10, 20000, v_emp, now(), 'HG26499', array['NO_WITNESS'])
    returning id into v_sealed;
  update public.deposit_bags set sealed_at = now() where id = v_sealed;

  insert into _c0347 values ('bag', v_bag), ('sealed', v_sealed), ('old', v_old);
end
$$;

\i supabase/rollbacks/0347_deposit_bag_atm_pull.rollback.sql

do $$
begin
  assert not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'deposit_bags'
                        and column_name like 'atm_pull%'), 'rollback dropped the pull columns';
  assert (select night_note from public.deposit_bags where id = (select v from _c0347 where k = 'bag'))
         like '%[ATM pull: 40 x $20 = $800.00 into HG26499 at %', 'rollback note on the open bag';
  assert (select night_note from public.deposit_bags where id = (select v from _c0347 where k = 'sealed'))
         like '%[ATM pull: 10 x $20 = $200.00 into HG26499 at %', 'rollback note on the sealed bag';
  assert (select night_note from public.deposit_bags where id = (select v from _c0347 where k = 'old')) is null,
         'no note on a bag without a pull';
  assert exists (select 1 from pg_trigger where tgname = 'trg_deposit_bags_sealed_guard' and tgenabled <> 'D'),
         'sealed guard switched back on';
  begin
    update public.deposit_bags set night_note = 'x' where id = (select v from _c0347 where k = 'sealed');
    raise exception 'TEST_FAILED: sealed guard is off after the rollback';
  exception when others then
    if sqlerrm not like 'DEPOSIT_BAG_SEALED%' then raise; end if;
  end;
end
$$;

\i supabase/migrations/0347_deposit_bag_atm_pull.sql

do $$
begin
  assert exists (select 1 from pg_trigger where tgname = 'deposit_bags_atm_pull_immutable'), '0347 re-applies after the rollback';
end
$$;

\echo DEPOSIT BAG ATM PULL 0347 CHECK PASSED
rollback;
