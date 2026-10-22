-- scripts/recon/ach-control-records-0291-pg-check.sql  (R41 S18 - migration 0291)
--
-- Scenario check for 0291_ach_control_records.sql on Postgres 15 with every
-- migration applied. ONE transaction, rolled back: no rows remain.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/ach-control-records-0291-pg-check.sql
--
-- Each refusal MUST raise with the expected text and sits beside a valid write
-- that MUST be accepted. "ACH 0291 CHECK PASSED" then ROLLBACK = all clear.
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
  u_m   uuid := gen_random_uuid();   -- "Michael", owner
  u_s   uuid := gen_random_uuid();   -- "Stephen", admin
  today date := (now() at time zone 'America/Los_Angeles')::date;
  y     text := to_char((now() at time zone 'America/Los_Angeles')::date, 'YYYY');
  qnow  text;
  qprev text;
  qold  text;
  fp    text := repeat('ab', 32);
  r1    uuid;
  n     int;
  ins   text;
  qi    int;
begin
  insert into auth.users (id, email) values (u_m, 'm0291@x.test'), (u_s, 's0291@x.test');
  insert into public.staff_profiles (id, email, role, active) values
    (u_m, 'm0291@x.test', 'owner', true), (u_s, 's0291@x.test', 'admin', true)
    on conflict (id) do update set role = excluded.role, active = excluded.active;
  perform set_config('request.jwt.claim.sub', '', true);   -- service role (the app path)

  qi := extract(year from today)::int * 4 + (extract(month from today)::int - 1) / 3;
  qnow  := (qi / 4)::text || '-Q' || ((qi % 4) + 1)::text;
  qprev := ((qi - 1) / 4)::text || '-Q' || (((qi - 1) % 4) + 1)::text;
  qold  := ((qi - 2) / 4)::text || '-Q' || (((qi - 2) % 4) + 1)::text;

  ins := $q$insert into public.ach_control_records (kind, period_key, recorded_on, text_sha256, summary, item, item_set_on, created_by) values (%L, %L, %L, %L, %L, %L, %L, %L) returning id$q$;

  -- 0. shape: not security definer; least privilege; admin-only reads
  select count(*) into n from pg_proc where proname in ('ach_control_records_guard', 'ach_control_records_no_truncate') and prosecdef;
  assert n = 0, 'the guards are not security definer';
  assert has_table_privilege('service_role', 'public.ach_control_records', 'INSERT'), 'the app can record';
  assert not has_table_privilege('service_role', 'public.ach_control_records', 'UPDATE'), 'the server cannot edit';
  assert not has_table_privilege('service_role', 'public.ach_control_records', 'DELETE'), 'the server cannot delete';
  assert not has_table_privilege('authenticated', 'public.ach_control_records', 'INSERT'), 'a browser session cannot record';
  assert not has_table_privilege('anon', 'public.ach_control_records', 'SELECT'), 'anon reads nothing';
  select count(*) into n from pg_policies where tablename = 'ach_control_records' and qual like '%is_admin()%';
  assert n = 1, 'RLS read is admin-only';

  -- 1. owner only
  perform pg_temp.must_fail(format(ins, 'policy_adoption', y, today, fp, 'Admin tries to adopt the policies.', null, null, u_s), 'ACH_OWNER_ONLY');

  -- 2. field checks
  perform pg_temp.must_fail(format(ins, 'policy_reading', y, today, fp, 'Unknown kind of record here.', null, null, u_m), 'ach_control_records_kind_check');
  perform pg_temp.must_fail(format(ins, 'policy_adoption', y, today, 'nothex', 'Adopted after reading them all.', null, null, u_m), 'ach_control_records_text_sha256_check');
  perform pg_temp.must_fail(format(ins, 'policy_adoption', y, today, fp, 'short', null, null, u_m), 'ach_control_records_summary_check');
  perform pg_temp.must_fail(format(ins, 'policy_adoption', y, today, fp, 'Account 1234567 noted here.', null, null, u_m), 'ach_control_records_summary_check');
  perform pg_temp.must_fail(format(ins, 'policy_adoption', 'abcd', today, fp, 'Adopted after reading them all.', null, null, u_m), 'ach_control_records_period_key_check');
  perform pg_temp.must_fail(format(ins, 'key_check', y, today, fp, 'Checked the token, it works.', 'Bad Item!', null, u_m), 'ach_control_records_item_check');

  -- 3. shape per kind
  perform pg_temp.must_fail(format(ins, 'access_review', y, today, fp, 'Quarterly review with a year key.', null, null, u_m), 'acr_shape');
  perform pg_temp.must_fail(format(ins, 'policy_adoption', qnow, today, fp, 'Adoption with a quarter key here.', null, null, u_m), 'acr_shape');
  perform pg_temp.must_fail(format(ins, 'policy_adoption', y, today, fp, 'Adoption that names an item.', 'timberland_token', null, u_m), 'acr_shape');
  perform pg_temp.must_fail(format(ins, 'access_review', qnow, today, fp, 'Access review with an item set.', 'timberland_token', null, u_m), 'acr_shape');
  perform pg_temp.must_fail(format(ins, 'key_check', y, today, fp, 'Key check with no item named.', null, null, u_m), 'acr_shape');
  perform pg_temp.must_fail(format(ins, 'key_check', y, today, fp, 'Changed in the future, impossible.', 'timberland_token', today + 5, u_m), 'acr_shape');
  perform pg_temp.must_fail(format(ins, 'access_review', qnow, today, fp, 'Access review with a set date.', null, today, u_m), 'acr_shape');

  -- 4. honest dates and periods
  perform pg_temp.must_fail(format(ins, 'policy_adoption', y, today - 3, fp, 'Backdated adoption attempt here.', null, null, u_m), 'ACH_CONTROL_DATE');
  perform pg_temp.must_fail(format(ins, 'policy_adoption', y, today + 1, fp, 'Adoption dated tomorrow, refused.', null, null, u_m), 'ACH_CONTROL_DATE');
  perform pg_temp.must_fail(format(ins, 'policy_adoption', (y::int - 1)::text, today, fp, 'Adoption for last year, refused.', null, null, u_m), 'ACH_CONTROL_PERIOD');
  perform pg_temp.must_fail(format(ins, 'key_check', (y::int + 1)::text, today, fp, 'Key check for next year here.', 'timberland_token', null, u_m), 'ACH_CONTROL_PERIOD');
  perform pg_temp.must_fail(format(ins, 'access_review', qold, today, fp, 'Review two quarters ago, refused.', null, null, u_m), 'ACH_CONTROL_PERIOD');
  perform pg_temp.must_fail(format(ins, 'access_review', (y::int + 1)::text || '-Q1', today, fp, 'Review for a future quarter here.', null, null, u_m), 'ACH_CONTROL_PERIOD');

  -- 5. valid writes
  execute format(ins, 'policy_adoption', y, today, fp, 'Read all seven policies; adopted. Bank: 1-800-562-8761.', null, null, u_m) into r1;
  execute format(ins, 'policy_adoption', y, today - 1, fp, 'Adopted again after an edit to the text.', null, null, u_m);
  execute format(ins, 'access_review', qnow, today, fp, 'Two people hold ACH access; both still need it.', null, null, u_m);
  execute format(ins, 'access_review', qprev, today, fp, 'Late review of last quarter; no changes.', null, null, u_m);
  execute format(ins, 'key_check', y, today, fp, 'Token works; kept in the safe.', 'timberland_token', null, u_m);
  execute format(ins, 'key_check', y, today, fp, 'Rotated the encryption key backup copy.', 'encryption_key', today - 30, u_m);
  execute format(ins, 'key_check', y, today, fp, 'Changed today, recorded today.', 'bank_password', today, u_m);

  -- 6. never changed, deleted or truncated
  perform pg_temp.must_fail(format($q$update public.ach_control_records set summary = 'Rewritten summary afterwards.' where id = %L$q$, r1), 'ACH_CONTROL_APPEND_ONLY');
  perform pg_temp.must_fail(format($q$delete from public.ach_control_records where id = %L$q$, r1), 'ACH_CONTROL_APPEND_ONLY');
  perform pg_temp.must_fail('truncate public.ach_control_records', 'ACH_CONTROL_APPEND_ONLY');
  select count(*) into n from public.ach_control_records where created_by = u_m;
  assert n = 7, 'all seven valid records are there';

  raise notice 'ACH 0291 CHECK PASSED';
end $$;

rollback;
