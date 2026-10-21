-- scripts/recon/ach-timberland-comms-0287-pg-check.sql  (R41 S13 - migration 0287)
--
-- Scenario check for 0287_ach_timberland_comms_notices.sql on Postgres 15 with
-- every migration applied. ONE transaction, rolled back: no rows remain.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/ach-timberland-comms-0287-pg-check.sql
--
-- Each refusal MUST raise with the expected text and sits beside a valid write
-- that MUST be accepted. "ACH 0287 CHECK PASSED" then ROLLBACK = all clear.
-- The 0277 check (scripts/recon/ach-timberland-comms-0277-pg-check.sql) must
-- still pass after 0287: append-only, owner-only, dates, shapes.
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
  c_noc  uuid;
  c_ofac uuid;
  c_rep  uuid;
  c_oth  uuid;
  c_old  uuid;
  t      text;
  n      int;
  ins    text;
begin
  insert into auth.users (id, email) values (u_m, 'm0287@x.test'), (u_s, 's0287@x.test');
  insert into public.staff_profiles (id, email, role, active) values
    (u_m, 'm0287@x.test', 'owner', true), (u_s, 's0287@x.test', 'admin', true)
    on conflict (id) do update set role = excluded.role, active = excluded.active;
  perform set_config('request.jwt.claim.sub', '', true);   -- service role (the app path)

  ins := $q$insert into public.ach_timberland_comms (entry_type, received_on, occurred_at, effective_on, amount_cents, summary, closes_id, created_by)
    values (%L, %L, %L, %L, %L, %L, %L, %L) returning id$q$;

  -- 0. the guard is still not security definer
  select count(*) into n from pg_proc where proname = 'ach_timberland_comms_guard' and prosecdef;
  assert n = 0, 'the guard is not security definer';

  -- 1. the three new types are accepted (owner), refused for an admin stamp
  perform pg_temp.must_fail(format(ins, 'noc_wrong', today, null, null, null, 'NOC C01 for a payee looks wrong', null, u_s), 'ACH_OWNER_ONLY');
  execute format(ins, 'noc_wrong', today - 3, null, null, null, 'NOC C01 for a payee looks wrong', null, u_m) into c_noc;
  execute format(ins, 'ofac_notice', today, null, null, null, 'Cash Management called: possible OFAC match', null, u_m) into c_ofac;
  execute format(ins, 'bank_report_received', today - 1, null, null, null, 'Return report on achedi.com', null, u_m) into c_rep;
  assert c_noc is not null and c_ofac is not null and c_rep is not null, 'the owner adds each new type';

  -- 2. every 0277 type is still accepted; an unknown type is still refused
  foreach t in array array['amendment_notice', 'fee_notice', 'auth_copy_request', 'prefunding_notice',
                           'dual_approval_on', 'schedule_g_email_corrected', 'access_ready',
                           'countersigned_received', 'statement_received'] loop
    execute format(ins, t, today, null, null, null, 'Still a valid type', null, u_m);
  end loop;
  execute format(ins, 'other', today, null, null, null, 'Called 1-800-562-8761', null, u_m) into c_oth;
  execute format(ins, 'fee_notice', today, null, null, null, 'Fee letter', null, u_m) into c_old;
  perform pg_temp.must_fail(format(ins, 'refused_noc', today, null, null, null, 'Not a type', null, u_m), 'ach_timberland_comms_entry_type_check');
  perform pg_temp.must_fail(format(ins, 'not_a_type', today, null, null, null, 'Not a type', null, u_m), 'ach_timberland_comms_entry_type_check');

  -- 3. each new type has a clock: a done row closes it, once, not before it arrived
  perform pg_temp.must_fail(format(ins, 'done', today - 4, null, null, null, 'Called Cash Management', c_noc, u_m), 'ACH_COMMS_CLOSE: it cannot be done before');
  execute format(ins, 'done', today, null, null, null, 'Called Cash Management', c_noc, u_m);
  perform pg_temp.must_fail(format(ins, 'done', today, null, null, null, 'Called again', c_noc, u_m), 'atc_closes_once');
  execute format(ins, 'done', today, null, null, null, 'Cash Management: cleared', c_ofac, u_m);
  execute format(ins, 'done', today, null, null, null, 'Report downloaded and kept', c_rep, u_m);
  execute format(ins, 'done', today, null, null, null, 'Fee letter read', c_old, u_m);
  -- every 0277 clock type is still closable (the re-created close list kept them)
  execute format(ins, 'termination_notice', today, null, today + 3, null, 'Termination letter', null, u_m) into c_old;
  execute format(ins, 'done', today, null, null, null, 'Withdrawn in writing', c_old, u_m);

  -- 4. facts still have no clock
  perform pg_temp.must_fail(format(ins, 'done', today, null, null, null, 'Closing a fact', c_oth, u_m), 'ACH_COMMS_CLOSE: a other entry has no clock');

  -- 5. still append-only
  perform pg_temp.must_fail(format($q$update public.ach_timberland_comms set summary = 'changed text' where id = %L$q$, c_noc), 'ACH_COMMS_APPEND_ONLY');
  perform pg_temp.must_fail(format($q$delete from public.ach_timberland_comms where id = %L$q$, c_ofac), 'ACH_COMMS_APPEND_ONLY');

  -- 6. the summary rule still refuses long digit runs for the new types
  perform pg_temp.must_fail(format(ins, 'bank_report_received', today, null, null, null, 'acct 123456789', null, u_m), 'ach_timberland_comms_summary_check');

  raise notice 'ACH 0287 CHECK PASSED';
end $$;

rollback;
