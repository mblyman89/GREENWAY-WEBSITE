-- scripts/recon/ach-timberland-comms-0277-pg-check.sql  (R41 S10 - migration 0277)
--
-- Scenario check for 0277_ach_timberland_comms.sql on Postgres 15 with every
-- migration applied. ONE transaction, rolled back: no rows remain.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/ach-timberland-comms-0277-pg-check.sql
--
-- Each refusal MUST raise with the expected text and sits beside a valid write
-- that MUST be accepted. "ACH 0277 CHECK PASSED" then ROLLBACK = all clear.
begin;

create or replace function pg_temp.must_fail(sql text, expect text) returns void
language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if position(expect in sqlerrm) = 0 and sqlstate <> expect then
      raise exception 'probe raised the WRONG error. expected %, got [%] %  -- %', expect, sqlstate, sqlerrm, sql;
    end if;
    return;
  end;
  raise exception 'probe was ACCEPTED but must be refused (expected %): %', expect, sql;
end $$;

do $$
declare
  u_m    uuid := gen_random_uuid();   -- "Michael", owner
  u_s    uuid := gen_random_uuid();   -- "Stephen", admin
  today  date := (now() at time zone 'America/Los_Angeles')::date;
  c_fee  uuid;
  c_res  uuid;
  c_acc  uuid;
  c_cmp  uuid;
  n      int;
  ins    text;
begin
  insert into auth.users (id, email) values (u_m, 'm0277@x.test'), (u_s, 's0277@x.test');
  insert into public.staff_profiles (id, email, role, active) values
    (u_m, 'm0277@x.test', 'owner', true), (u_s, 's0277@x.test', 'admin', true)
    on conflict (id) do update set role = excluded.role, active = excluded.active;
  perform set_config('request.jwt.claim.sub', '', true);   -- service role (the app path)

  ins := $q$insert into public.ach_timberland_comms (entry_type, received_on, occurred_at, effective_on, amount_cents, summary, closes_id, created_by)
    values (%L, %L, %L, %L, %L, %L, %L, %L) returning id$q$;

  -- 0. shape: one table, RLS on, service role may only select and insert
  select count(*) into n from pg_class where relname = 'ach_timberland_comms' and relkind = 'r' and relrowsecurity;
  assert n = 1, 'one table with RLS on';
  assert has_table_privilege('service_role', 'public.ach_timberland_comms', 'INSERT'), 'the server can add entries';
  assert not has_table_privilege('service_role', 'public.ach_timberland_comms', 'UPDATE'), 'the server cannot update';
  assert not has_table_privilege('service_role', 'public.ach_timberland_comms', 'DELETE'), 'the server cannot delete';
  assert not has_table_privilege('authenticated', 'public.ach_timberland_comms', 'INSERT'), 'a browser session cannot add';
  assert not has_table_privilege('anon', 'public.ach_timberland_comms', 'SELECT'), 'anon reads nothing';
  select count(*) into n from pg_proc where proname = 'ach_timberland_comms_guard' and prosecdef;
  assert n = 0, 'the guard is not security definer';

  -- 1. owner only
  perform pg_temp.must_fail(format(ins, 'fee_notice', today, null, null, null, 'Fee change letter', null, u_s), 'ACH_OWNER_ONLY');
  execute format(ins, 'fee_notice', today, null, null, null, 'Fee change letter', null, u_m) into c_fee;
  assert c_fee is not null, 'the owner adds a fee notice';

  -- 2. dates: not in the future, not more than 400 days back
  perform pg_temp.must_fail(format(ins, 'fee_notice', today + 1, null, null, null, 'Fee change letter', null, u_m), 'ACH_COMMS_DATE');
  perform pg_temp.must_fail(format(ins, 'fee_notice', today - 401, null, null, null, 'Fee change letter', null, u_m), 'ACH_COMMS_DATE');
  execute format(ins, 'statement_received', today - 400, null, null, null, 'Old statement', null, u_m);
  perform pg_temp.must_fail(format(ins, 'compromise_reported', today, now() + interval '1 hour', null, null, 'Phoned Timberland', null, u_m), 'ACH_COMMS_DATE');

  -- 3. no long digit runs in the summary (no account or routing numbers); short text refused
  perform pg_temp.must_fail(format(ins, 'other', today, null, null, null, 'acct 123456789', null, u_m), 'ach_timberland_comms_summary_check');
  perform pg_temp.must_fail(format(ins, 'other', today, null, null, null, ' ab ', null, u_m), 'ach_timberland_comms_summary_check');
  execute format(ins, 'other', today, null, null, null, 'Called 1-800-562-8761', null, u_m);

  -- 4. types that need a time, a second date or an amount
  perform pg_temp.must_fail(format(ins, 'compromise_reported', today, null, null, null, 'Phoned Timberland', null, u_m), 'atc_time_needed');
  execute format(ins, 'compromise_reported', today, now() - interval '1 hour', null, null, 'Phoned Timberland', null, u_m) into c_cmp;
  perform pg_temp.must_fail(format(ins, 'reversal_needed', today, now(), null, null, 'Duplicate payroll file', null, u_m), 'atc_second_date_needed');
  perform pg_temp.must_fail(format(ins, 'reversal_needed', today, now(), today + 1, null, 'Duplicate payroll file', null, u_m), 'atc_reversal_original_before');
  execute format(ins, 'reversal_needed', today, now(), today - 1, null, 'Duplicate payroll file', null, u_m);
  perform pg_temp.must_fail(format(ins, 'reserve_demand', today, null, null, null, 'Reserve letter', null, u_m), 'atc_amount_needed');
  execute format(ins, 'reserve_demand', today, null, null, 500000, 'Reserve letter', null, u_m) into c_res;
  perform pg_temp.must_fail(format(ins, 'termination_notice', today, null, today - 1, null, 'Termination letter', null, u_m), 'atc_termination_not_before');
  execute format(ins, 'termination_notice', today, null, today + 3, null, 'Termination letter', null, u_m);
  perform pg_temp.must_fail(format(ins, 'not_a_type', today, null, null, null, 'Something else', null, u_m), 'ach_timberland_comms_entry_type_check');

  -- 5. 'done' must close an open clock, once, not before it arrived
  perform pg_temp.must_fail(format(ins, 'done', today, null, null, null, 'Read and applied', null, u_m), 'ACH_COMMS_CLOSE: a done entry must name');
  perform pg_temp.must_fail(format(ins, 'fee_notice', today, null, null, null, 'Read and applied', c_res, u_m), 'atc_done_shape');
  perform pg_temp.must_fail(format(ins, 'done', today, null, null, null, 'Read and applied', gen_random_uuid(), u_m), 'ACH_COMMS_CLOSE');
  execute format(ins, 'access_ready', today, null, null, null, 'Brenda: access is set up', null, u_m) into c_acc;
  perform pg_temp.must_fail(format(ins, 'done', today, null, null, null, 'Closing a fact', c_acc, u_m), 'ACH_COMMS_CLOSE: a access_ready entry has no clock');
  perform pg_temp.must_fail(format(ins, 'done', today - 1, null, null, null, 'Read and applied', c_fee, u_m), 'ACH_COMMS_CLOSE: it cannot be done before');
  perform pg_temp.must_fail(format(ins, 'done', today, null, null, null, 'Read and applied', c_fee, u_s), 'ACH_OWNER_ONLY');
  execute format(ins, 'done', today, null, null, null, 'Read and applied', c_fee, u_m);
  perform pg_temp.must_fail(format(ins, 'done', today, null, null, null, 'Read and applied again', c_fee, u_m), 'atc_closes_once');
  execute format(ins, 'done', today, null, null, null, 'Written confirmation mailed', c_cmp, u_m);

  -- 6. append-only: never updated, never deleted (even as the table owner)
  perform pg_temp.must_fail(format($q$update public.ach_timberland_comms set summary = 'changed text' where id = %L$q$, c_fee), 'ACH_COMMS_APPEND_ONLY');
  perform pg_temp.must_fail(format($q$delete from public.ach_timberland_comms where id = %L$q$, c_res), 'ACH_COMMS_APPEND_ONLY');
  select count(*) into n from public.ach_timberland_comms where id in (c_fee, c_res);
  assert n = 2, 'both rows still there';

  -- 7. a signed-in admin JWT cannot pass as the owner
  perform set_config('request.jwt.claim.sub', u_s::text, true);
  perform pg_temp.must_fail(format(ins, 'other', today, null, null, null, 'Admin JWT, owner stamp', null, u_m), 'ACH_OWNER_ONLY');
  perform set_config('request.jwt.claim.sub', '', true);

  -- 8. an admin's entry can wait for the owner: the request list takes the new target
  select count(*) into n from pg_constraint where conname = 'ach_change_requests_target_type_check' and pg_get_constraintdef(oid) like '%timberland_comms%' and pg_get_constraintdef(oid) like '%ach_file%';
  assert n = 1, 'request target list has timberland_comms and still ach_file';
  insert into public.ach_change_requests (kind, target_type, payload_enc, requested_by) values ('timberland_comms.log', 'timberland_comms', 'encv1:p:y', u_s);
  perform pg_temp.must_fail(format($q$insert into public.ach_change_requests (kind, target_type, payload_enc, requested_by) values ('timberland_comms.log', 'planet', 'encv1:p:y', %L)$q$, u_s), 'ach_change_requests_target_type_check');

  raise notice 'ACH 0277 CHECK PASSED';
end $$;

rollback;
