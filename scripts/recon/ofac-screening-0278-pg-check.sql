-- scripts/recon/ofac-screening-0278-pg-check.sql  (R41 S11 - migration 0278)
--
-- Scenario check for 0278_ofac_screening.sql on Postgres 15 with every
-- migration applied. ONE transaction, rolled back: no rows remain.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/ofac-screening-0278-pg-check.sql
--
-- Each refusal MUST raise with the expected text and sits beside a valid write
-- that MUST be accepted. "ACH 0278 CHECK PASSED" then ROLLBACK = all clear.
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
  u_m     uuid := gen_random_uuid();   -- "Michael", owner
  u_s     uuid := gen_random_uuid();   -- "Stephen", admin
  emp     uuid := gen_random_uuid();
  ven     uuid := gen_random_uuid();
  run_ok  uuid;
  run_bad uuid;
  res_pm  uuid;
  res_cl  uuid;
  n       int;
  hex     text := repeat('ab', 32);
  okrun   jsonb;
  results jsonb;
  rev     text;
  note    text := 'Compared date of birth and country; they differ.';
begin
  insert into auth.users (id, email) values (u_m, 'm0278@x.test'), (u_s, 's0278@x.test');
  insert into public.staff_profiles (id, email, role, active) values
    (u_m, 'm0278@x.test', 'owner', true), (u_s, 's0278@x.test', 'admin', true)
    on conflict (id) do update set role = excluded.role, active = excluded.active;
  perform set_config('request.jwt.claim.sub', '', true);   -- service role (the app path)

  -- 0. shape: three tables with RLS, service role may only select and insert
  select count(*) into n from pg_class where relname in ('ofac_screening_runs', 'ofac_screening_results', 'ofac_match_reviews') and relkind = 'r' and relrowsecurity;
  assert n = 3, 'three tables with RLS on';
  assert has_table_privilege('service_role', 'public.ofac_screening_results', 'INSERT'), 'the server can add results';
  assert not has_table_privilege('service_role', 'public.ofac_screening_runs', 'UPDATE'), 'the server cannot update runs';
  assert not has_table_privilege('service_role', 'public.ofac_screening_results', 'DELETE'), 'the server cannot delete results';
  assert not has_table_privilege('service_role', 'public.ofac_match_reviews', 'TRUNCATE'), 'the server cannot truncate reviews';
  assert not has_table_privilege('authenticated', 'public.ofac_match_reviews', 'INSERT'), 'a browser session cannot add a review';
  assert not has_table_privilege('anon', 'public.ofac_screening_runs', 'SELECT'), 'anon reads nothing';
  assert has_function_privilege('service_role', 'public.ofac_record_run(jsonb, jsonb)', 'EXECUTE'), 'the server can record a run';
  assert not has_function_privilege('authenticated', 'public.ofac_record_run(jsonb, jsonb)', 'EXECUTE'), 'a browser session cannot record a run';
  select count(*) into n from pg_proc where proname in ('ofac_screening_guard', 'ofac_match_reviews_guard', 'ofac_record_run', 'ofac_screening_no_truncate') and prosecdef;
  assert n = 0, 'nothing is security definer';

  -- 1. a run and its results in one call
  okrun := jsonb_build_object('trigger', 'cron', 'status', 'ok', 'list_last_modified', 'Thu, 15 Oct 2026 13:00:00 GMT', 'list_sha256', hex,
    'files', '[{"file":"SDN.CSV","records":3}]'::jsonb, 'digest_verified', true, 'payees_sha256', hex, 'payees_count', 2, 'possible_matches', 1, 'unscreenable', 0, 'threshold', 0.85);
  results := jsonb_build_array(
    jsonb_build_object('payee_type', 'employee', 'payee_id', emp, 'label', 'Test Employee', 'names_screened', array['Jo Doe'], 'result', 'possible_match', 'top_score', 0.91,
      'matches', '[{"key":"SDN:1","screenedName":"Jo Doe","score":0.91}]'::jsonb),
    jsonb_build_object('payee_type', 'vendor', 'payee_id', ven, 'label', 'Test Vendor LLC', 'names_screened', array['Test Vendor LLC'], 'result', 'clear', 'top_score', 0, 'matches', '[]'::jsonb));
  run_ok := public.ofac_record_run(okrun, results);
  select count(*) into n from public.ofac_screening_results where run_id = run_ok;
  assert n = 2, 'both results recorded with the run';
  select id into res_pm from public.ofac_screening_results where run_id = run_ok and result = 'possible_match';
  select id into res_cl from public.ofac_screening_results where run_id = run_ok and result = 'clear';

  -- 2. all or nothing: a bad result rolls the whole run back
  select count(*) into n from public.ofac_screening_runs;
  perform pg_temp.must_fail(format('select public.ofac_record_run(%L::jsonb, %L::jsonb)', okrun,
    jsonb_build_array(jsonb_build_object('payee_type', 'vendor', 'payee_id', ven, 'label', 'V', 'names_screened', array['V'], 'result', 'clear', 'top_score', 0.9,
      'matches', '[{"key":"SDN:2"}]'::jsonb))), 'osres_clear_shape');
  assert (select count(*) from public.ofac_screening_runs) = n, 'no half-recorded run';
  perform pg_temp.must_fail(format('select public.ofac_record_run(%L::jsonb, %L::jsonb)', okrun, '{}'), 'OFAC_RECORD_RUN');

  -- 3. run shapes
  run_bad := public.ofac_record_run(jsonb_build_object('trigger', 'cron', 'status', 'failed', 'error', 'SDN.CSV: no end-of-file mark', 'threshold', 0.85), '[]'::jsonb);
  assert run_bad is not null, 'a failed run is recorded with its reason';
  perform pg_temp.must_fail(format('select public.ofac_record_run(%L::jsonb, %L::jsonb)', jsonb_build_object('trigger', 'cron', 'status', 'failed', 'threshold', 0.85), '[]'), 'osr_failed_has_error');
  perform pg_temp.must_fail(format('select public.ofac_record_run(%L::jsonb, %L::jsonb)', jsonb_build_object('trigger', 'manual', 'status', 'failed', 'error', 'x', 'threshold', 0.85), '[]'), 'osr_manual_has_actor');
  perform pg_temp.must_fail(format('select public.ofac_record_run(%L::jsonb, %L::jsonb)', jsonb_build_object('trigger', 'cron', 'status', 'ok', 'threshold', 0.85), '[]'), 'osr_ok_has_lists');
  perform pg_temp.must_fail(format('select public.ofac_record_run(%L::jsonb, %L::jsonb)', okrun || '{"list_sha256":"nothex"}'::jsonb, '[]'), 'ofac_screening_runs_list_sha256_check');
  perform pg_temp.must_fail(format('select public.ofac_record_run(%L::jsonb, %L::jsonb)', okrun || '{"threshold":0}'::jsonb, '[]'), 'ofac_screening_runs_threshold_check');
  perform pg_temp.must_fail(format($q$insert into public.ofac_screening_results (run_id, payee_type, payee_id, label, names_screened, result, top_score) values (%L, 'vendor', %L, 'V', array['V'], 'clear', 0)$q$, run_bad, ven), 'OFAC_RESULT_RUN');
  perform pg_temp.must_fail(format($q$insert into public.ofac_screening_results (run_id, payee_type, payee_id, label, names_screened, result, top_score) values (%L, 'vendor', %L, 'V', array['V'], 'clear', 0)$q$, run_ok, ven), 'osres_once_per_run');

  -- 4. reviews: owner only, possible matches only, same payee, real note, once
  rev := $q$insert into public.ofac_match_reviews (result_id, payee_type, payee_id, decision, match_keys, note, created_by) values (%L, %L, %L, %L, array['SDN:1|JO DOE'], %L, %L)$q$;
  perform pg_temp.must_fail(format(rev, res_pm, 'employee', emp, 'not_a_match', note, u_s), 'ACH_OWNER_ONLY');
  perform pg_temp.must_fail(format(rev, res_cl, 'vendor', ven, 'not_a_match', note, u_m), 'OFAC_REVIEW_TARGET');
  perform pg_temp.must_fail(format(rev, gen_random_uuid(), 'employee', emp, 'not_a_match', note, u_m), 'OFAC_REVIEW_TARGET');
  perform pg_temp.must_fail(format(rev, res_pm, 'vendor', emp, 'not_a_match', note, u_m), 'OFAC_REVIEW_TARGET: the review must name the same payee');
  perform pg_temp.must_fail(format(rev, res_pm, 'employee', emp, 'not_a_match', 'too short', u_m), 'OFAC_REVIEW_NOTE');
  perform pg_temp.must_fail(format(rev, res_pm, 'employee', emp, 'not_a_match', 'Checked SSN 123456789 and it differs', u_m), 'OFAC_REVIEW_NOTE');
  perform pg_temp.must_fail(format(rev, res_pm, 'employee', emp, 'maybe', note, u_m), 'ofac_match_reviews_decision_check');
  perform set_config('request.jwt.claim.sub', u_s::text, true);
  perform pg_temp.must_fail(format(rev, res_pm, 'employee', emp, 'not_a_match', note, u_m), 'ACH_OWNER_ONLY');
  perform set_config('request.jwt.claim.sub', '', true);
  execute format(rev, res_pm, 'employee', emp, 'not_a_match', note, u_m);
  perform pg_temp.must_fail(format(rev, res_pm, 'employee', emp, 'true_match', note, u_m), 'ofac_reviews_once');

  -- 5. append-only: never updated, deleted or truncated (even as the table owner)
  perform pg_temp.must_fail(format($q$update public.ofac_screening_runs set error = 'x' where id = %L$q$, run_ok), 'OFAC_APPEND_ONLY');
  perform pg_temp.must_fail(format($q$delete from public.ofac_screening_results where id = %L$q$, res_cl), 'OFAC_APPEND_ONLY');
  perform pg_temp.must_fail(format($q$update public.ofac_match_reviews set decision = 'true_match' where result_id = %L$q$, res_pm), 'OFAC_APPEND_ONLY');
  perform pg_temp.must_fail($q$truncate public.ofac_match_reviews$q$, 'OFAC_APPEND_ONLY');
  perform pg_temp.must_fail($q$truncate public.ofac_screening_results cascade$q$, 'OFAC_APPEND_ONLY');
  select count(*) into n from public.ofac_match_reviews where result_id = res_pm;
  assert n = 1, 'the review is still there';

  -- 6. never a payment gate: no function body outside 0278 reads the screening tables
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname = 'public' and p.prosrc ~ 'ofac_(screening|match)'
      and p.proname not in ('ofac_screening_guard', 'ofac_match_reviews_guard', 'ofac_record_run', 'ofac_screening_no_truncate');
  assert n = 0, 'no other database function reads the screening tables (screening never blocks a payment)';

  -- 7. an admin's review can wait for the owner: the request list takes the new target
  select count(*) into n from pg_constraint where conname = 'ach_change_requests_target_type_check'
    and pg_get_constraintdef(oid) like '%ofac_review%' and pg_get_constraintdef(oid) like '%timberland_comms%' and pg_get_constraintdef(oid) like '%ach_file%';
  assert n = 1, 'request target list has ofac_review and still timberland_comms and ach_file';
  insert into public.ach_change_requests (kind, target_type, payload_enc, requested_by) values ('ofac_review.record', 'ofac_review', 'encv1:p:y', u_s);

  raise notice 'ACH 0278 CHECK PASSED';
end $$;

rollback;
