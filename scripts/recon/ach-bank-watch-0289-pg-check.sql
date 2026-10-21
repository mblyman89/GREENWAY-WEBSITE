-- scripts/recon/ach-bank-watch-0289-pg-check.sql  (R41 S16 - migration 0289)
--
-- Scenario check for 0289_ach_bank_watch.sql on Postgres 15 with every
-- migration applied. ONE transaction, rolled back: no rows remain.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/ach-bank-watch-0289-pg-check.sql
--
-- Each refusal MUST raise with the expected text and sits beside a valid write
-- that MUST be accepted. "ACH 0289 CHECK PASSED" then ROLLBACK = all clear.
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
  u_x    uuid := gen_random_uuid();   -- a former admin, inactive
  u_b    uuid := gen_random_uuid();   -- a manager (not an admin)
  rule1  uuid;
  rule2  uuid;
  rv1    uuid;
  n      int;
  insr   text;
  insv   text;
begin
  insert into auth.users (id, email) values (u_m, 'm0289@x.test'), (u_s, 's0289@x.test'), (u_x, 'x0289@x.test'), (u_b, 'b0289@x.test');
  insert into public.staff_profiles (id, email, role, active) values
    (u_m, 'm0289@x.test', 'owner', true), (u_s, 's0289@x.test', 'admin', true),
    (u_x, 'x0289@x.test', 'admin', false), (u_b, 'b0289@x.test', 'manager', true)
    on conflict (id) do update set role = excluded.role, active = excluded.active;
  perform set_config('request.jwt.claim.sub', '', true);   -- service role (the app path)

  insr := $q$insert into public.ach_bank_watch_rules (match_text, max_cents, note, created_by) values (%L, %L, %L, %L) returning id$q$;
  insv := $q$insert into public.ach_bank_watch_reviews (transaction_id, verdict, note, created_by) values (%L, %L, %L, %L) returning id$q$;

  -- 0. shape: guards not security definer; least privilege; admin-only reads
  select count(*) into n from pg_proc where proname in ('ach_bank_watch_rules_guard', 'ach_bank_watch_reviews_guard', 'ach_bank_watch_no_truncate') and prosecdef;
  assert n = 0, 'the guards are not security definer';
  assert has_table_privilege('service_role', 'public.ach_bank_watch_rules', 'INSERT'), 'the server can add rules';
  assert not has_table_privilege('service_role', 'public.ach_bank_watch_rules', 'DELETE'), 'the server cannot delete rules';
  assert has_table_privilege('service_role', 'public.ach_bank_watch_reviews', 'INSERT'), 'the server can add reviews';
  assert not has_table_privilege('service_role', 'public.ach_bank_watch_reviews', 'UPDATE'), 'the server cannot update reviews';
  assert not has_table_privilege('service_role', 'public.ach_bank_watch_reviews', 'DELETE'), 'the server cannot delete reviews';
  assert not has_table_privilege('authenticated', 'public.ach_bank_watch_rules', 'INSERT'), 'a browser session cannot add rules';
  assert not has_table_privilege('authenticated', 'public.ach_bank_watch_reviews', 'INSERT'), 'a browser session cannot add reviews';
  assert not has_table_privilege('anon', 'public.ach_bank_watch_rules', 'SELECT'), 'anon reads no rules';
  assert not has_table_privilege('anon', 'public.ach_bank_watch_reviews', 'SELECT'), 'anon reads no reviews';
  select count(*) into n from pg_policies where tablename in ('ach_bank_watch_rules', 'ach_bank_watch_reviews') and qual like '%is_admin()%';
  assert n = 2, 'RLS read is admin-only on both';

  -- 1. rules: owner only
  perform pg_temp.must_fail(format(insr, 'Waste Co', 10000, 'Garbage pickup, monthly', u_s), 'ACH_OWNER_ONLY');
  perform set_config('request.jwt.claim.sub', u_s::text, true);
  perform pg_temp.must_fail(format(insr, 'Waste Co', 10000, 'Garbage pickup, monthly', u_m), 'ACH_OWNER_ONLY');
  perform set_config('request.jwt.claim.sub', '', true);

  -- 2. rule field checks
  perform pg_temp.must_fail(format(insr, 'ab', null, 'Garbage pickup, monthly', u_m), 'ach_bank_watch_rules_match_text_check');
  perform pg_temp.must_fail(format(insr, 'Acct 12345678', null, 'Garbage pickup, monthly', u_m), 'ach_bank_watch_rules_match_text_check');
  perform pg_temp.must_fail(format(insr, 'Waste Co', 0, 'Garbage pickup, monthly', u_m), 'ach_bank_watch_rules_max_cents_check');
  perform pg_temp.must_fail(format(insr, 'Waste Co', null, 'short', u_m), 'ach_bank_watch_rules_note_check');
  perform pg_temp.must_fail(format(insr, 'Waste Co', null, 'Account 123456789 pays it', u_m), 'ach_bank_watch_rules_note_check');
  perform pg_temp.must_fail(format($q$insert into public.ach_bank_watch_rules (match_text, note, created_by, retired_at, retired_by) values ('Waste Co', 'Garbage pickup, monthly', %L, now(), %L)$q$, u_m, u_m), 'ACH_WATCH_RETIRE: a new rule cannot start retired');

  -- 3. the owner adds two rules
  execute format(insr, 'Waste Co', 10000, 'Garbage pickup, monthly', u_m) into rule1;
  execute format(insr, 'Card Processor', null, 'Card processor monthly fees', u_m) into rule2;
  assert rule1 is not null and rule2 is not null, 'the owner adds rules';

  -- 4. rules never edited, only retired once by the owner; never deleted
  perform pg_temp.must_fail(format($q$update public.ach_bank_watch_rules set max_cents = 99999999 where id = %L$q$, rule1), 'ACH_WATCH_RETIRE: the only change allowed');
  perform pg_temp.must_fail(format($q$update public.ach_bank_watch_rules set max_cents = 99999999, retired_at = now(), retired_by = %L where id = %L$q$, u_m, rule1), 'ACH_WATCH_RETIRE: nothing on a rule can change');
  perform pg_temp.must_fail(format($q$update public.ach_bank_watch_rules set retired_at = now(), retired_by = %L where id = %L$q$, u_s, rule1), 'ACH_OWNER_ONLY');
  perform pg_temp.must_fail(format($q$update public.ach_bank_watch_rules set retired_at = now() - interval '3 days', retired_by = %L where id = %L$q$, u_m, rule1), 'ACH_WATCH_RETIRE: the retire time');
  execute format($q$update public.ach_bank_watch_rules set retired_at = now(), retired_by = %L where id = %L$q$, u_m, rule1);
  perform pg_temp.must_fail(format($q$update public.ach_bank_watch_rules set retired_at = now(), retired_by = %L where id = %L$q$, u_m, rule1), 'ACH_WATCH_RETIRE: this rule is already retired');
  perform pg_temp.must_fail(format($q$delete from public.ach_bank_watch_rules where id = %L$q$, rule2), 'ACH_WATCH_RETIRE: a known-payee rule is never deleted');
  perform pg_temp.must_fail('truncate public.ach_bank_watch_rules', 'ACH_WATCH_APPEND_ONLY');

  -- 5. reviews: owner or ACTIVE admin; not an inactive admin, not a manager, not a JWT mismatch
  execute format(insv, 'txnABC_123', 'known', 'Called 1-800-562-8761, it is the monthly fee.', u_m) into rv1;
  execute format(insv, 'txnABC_123', 'reported_to_bank', 'Stephen reported it to Timberland by phone.', u_s);
  perform pg_temp.must_fail(format(insv, 'txnABC_123', 'known', 'An inactive admin tries to review.', u_x), 'ACH_WATCH_STAFF_ONLY');
  perform pg_temp.must_fail(format(insv, 'txnABC_123', 'known', 'A manager tries to review this line.', u_b), 'ACH_WATCH_STAFF_ONLY');
  perform set_config('request.jwt.claim.sub', u_b::text, true);
  perform pg_temp.must_fail(format(insv, 'txnABC_123', 'known', 'Manager JWT with an admin stamp.', u_s), 'ACH_WATCH_STAFF_ONLY');
  perform set_config('request.jwt.claim.sub', u_s::text, true);
  execute format(insv, 'txnABC_123', 'fee', 'Admin JWT, own stamp: it is the return fee.', u_s);
  perform set_config('request.jwt.claim.sub', '', true);

  -- 6. review field checks
  perform pg_temp.must_fail(format(insv, 'x', 'known', 'A note that is long enough.', u_m), 'ach_bank_watch_reviews_transaction_id_check');
  perform pg_temp.must_fail(format(insv, 'txn with space', 'known', 'A note that is long enough.', u_m), 'ach_bank_watch_reviews_transaction_id_check');
  perform pg_temp.must_fail(format(insv, 'txnABC_123', 'maybe', 'A note that is long enough.', u_m), 'ach_bank_watch_reviews_verdict_check');
  perform pg_temp.must_fail(format(insv, 'txnABC_123', 'known', 'short', u_m), 'ach_bank_watch_reviews_note_check');
  perform pg_temp.must_fail(format(insv, 'txnABC_123', 'known', 'Paid from account 123456789 today.', u_m), 'ach_bank_watch_reviews_note_check');

  -- 7. reviews append-only
  perform pg_temp.must_fail(format($q$update public.ach_bank_watch_reviews set note = 'changed the note text here' where id = %L$q$, rv1), 'ACH_WATCH_APPEND_ONLY');
  perform pg_temp.must_fail(format($q$delete from public.ach_bank_watch_reviews where id = %L$q$, rv1), 'ACH_WATCH_APPEND_ONLY');
  perform pg_temp.must_fail('truncate public.ach_bank_watch_reviews', 'ACH_WATCH_APPEND_ONLY');
  select count(*) into n from public.ach_bank_watch_reviews where transaction_id = 'txnABC_123';
  assert n = 3, 'all three reviews still there';
  select count(*) into n from public.ach_bank_watch_rules where id in (rule1, rule2);
  assert n = 2, 'both rules still there';

  raise notice 'ACH 0289 CHECK PASSED';
end $$;

rollback;
