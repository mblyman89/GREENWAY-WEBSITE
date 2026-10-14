-- scripts/recon/ach-files-0273-pg-check.sql  (R41 S3 - migration 0273)
--
-- Scenario check for 0273_ach_files.sql on Postgres 15 with every migration
-- applied. ONE transaction, rolled back: no rows remain.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/ach-files-0273-pg-check.sql
--
-- Each refusal MUST raise with the expected text and sits beside a valid write
-- that MUST be accepted. "ACH 0273 CHECK PASSED" then ROLLBACK = all clear.
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

create or replace function pg_temp.h(c text) returns text language sql as $$ select repeat(c, 64) $$;

do $$
declare
  u_m   uuid := gen_random_uuid();   -- "Michael", owner
  u_s   uuid := gen_random_uuid();   -- "Stephen", admin
  run1  uuid;
  run2  uuid;
  f1    uuid;
  f2    uuid;
  r     record;
  n     int;
  kind_out text;
  ins   text;
begin
  insert into auth.users (id, email) values (u_m, 'm0273@x.test'), (u_s, 's0273@x.test');
  insert into public.staff_profiles (id, email, role, active) values
    (u_m, 'm0273@x.test', 'owner', true), (u_s, 's0273@x.test', 'admin', true)
    on conflict (id) do update set role = excluded.role, active = excluded.active;
  perform set_config('request.jwt.claim.sub', '', true);   -- service role (the app path)

  insert into public.payroll_runs (label, pay_date, status, created_by) values ('PG 0273 run 1', '2026-10-23', 'draft', u_m) returning id into run1;
  insert into public.payroll_runs (label, pay_date, status, created_by) values ('PG 0273 run 2', '2026-11-06', 'draft', u_m) returning id into run2;

  -- 0. shape: table, trigger, three partial unique indexes, the day/letter constraint, RLS on
  select count(*) into n from pg_indexes where schemaname = 'public' and tablename = 'ach_files'
     and indexname in ('ach_files_sha_live', 'ach_files_no_duplicate_entries', 'ach_files_one_live_per_source');
  assert n = 3, format('three live-only unique indexes, found %s', n);
  select count(*) into n from pg_constraint where conname = 'ach_files_day_modifier_key' and contype = 'u';
  assert n = 1, 'unique (file_date, file_id_modifier) constraint';
  select count(*) into n from pg_class where relname = 'ach_files' and relrowsecurity;
  assert n = 1, 'RLS is on';
  assert not has_table_privilege('authenticated', 'public.ach_files', 'INSERT'), 'a browser session cannot insert';
  assert not has_table_privilege('authenticated', 'public.ach_files', 'UPDATE'), 'a browser session cannot update';
  assert not has_table_privilege('authenticated', 'public.ach_files', 'DELETE'), 'a browser session cannot delete';
  assert not has_table_privilege('anon', 'public.ach_files', 'SELECT'), 'anon reads nothing';
  assert not has_table_privilege('service_role', 'public.ach_files', 'DELETE'), 'not even the server may delete';
  assert not has_function_privilege('authenticated', 'public.ach_file_void(uuid, uuid, text)', 'EXECUTE'), 'void is server only';

  -- 1. release a payroll file: the owner, once; the run is stamped in the same call
  perform pg_temp.must_fail(format($q$select public.ach_file_release_payroll(%L, %L, '2026-10-20', 'A', 'payroll_2026-10-23_x.ach', '2026-10-23', 2, 150123, %L, %L, 'encv1:a:b', false, null)$q$,
    run1, u_s, pg_temp.h('1'), pg_temp.h('a')), 'ACH_OWNER_ONLY');
  select count(*) into n from public.ach_files;
  assert n = 0, 'the refused admin release wrote nothing';
  select status into r from public.payroll_runs where id = run1;
  assert r.status = 'draft', 'the refused release left the run a draft';

  f1 := public.ach_file_release_payroll(run1, u_m, '2026-10-20', 'A', 'payroll_2026-10-23_x.ach', '2026-10-23', 2, 150123, pg_temp.h('1'), pg_temp.h('a'), 'encv1:a:b', true, 'Bonus week, checked with Sage');
  select * into r from public.payroll_runs where id = run1;
  assert r.status = 'file_generated' and r.nacha_filename = 'payroll_2026-10-23_x.ach' and r.file_id_modifier = 'A', 'run stamped with the file';
  assert r.approved_by = u_m and r.guardrail_override and r.guardrail_override_by = u_m and r.guardrail_override_reason = 'Bonus week, checked with Sage', 'release and override recorded';
  select * into r from public.ach_files where id = f1;
  assert r.status = 'released' and r.released_by = u_m and r.counts_toward_limit and r.kind = 'payroll', 'ledger row written';

  -- 2. release once: the same run again is refused (run not a draft, and one live per source)
  perform pg_temp.must_fail(format($q$select public.ach_file_release_payroll(%L, %L, '2026-10-20', 'B', 'payroll_2026-10-23_y.ach', '2026-10-23', 2, 150123, %L, %L, 'encv1:c:d', false, null)$q$,
    run1, u_m, pg_temp.h('2'), pg_temp.h('b')), 'ACH_FILE_ALREADY_RELEASED');
  perform pg_temp.must_fail(format($q$insert into public.ach_files (kind, source_id, file_date, file_id_modifier, filename, effective_date, entry_count, total_cents, counts_toward_limit, sha256, entry_set_hmac, body_enc, released_by)
    values ('payroll', %L, '2026-10-20', 'B', 'p.ach', '2026-10-23', 2, 150123, true, %L, %L, 'encv1:c:d', %L)$q$, run1::text, pg_temp.h('2'), pg_temp.h('b'), u_m), 'ach_files_one_live_per_source');

  ins := $q$insert into public.ach_files (kind, source_id, file_date, file_id_modifier, filename, effective_date, entry_count, total_cents, counts_toward_limit, sha256, entry_set_hmac, body_enc, released_by)
    values (%L, %L, %L, %L, 'f.ach', %L, 1, %s, %L, %L, %L, 'encv1:x:y', %L)$q$;

  -- 3. File ID Modifier: one per Pacific day; same letter on another day is fine
  perform pg_temp.must_fail(format(ins, 'vendor', 'v-1', '2026-10-20', 'A', '2026-10-23', 500, true, pg_temp.h('3'), pg_temp.h('c'), u_m), 'ach_files_day_modifier_key');
  execute format(ins, 'vendor', 'v-1', '2026-10-20', 'B', '2026-10-23', 500, true, pg_temp.h('3'), pg_temp.h('c'), u_m);
  execute format(ins, 'vendor', 'v-2', '2026-10-21', 'A', '2026-10-23', 600, true, pg_temp.h('4'), pg_temp.h('d'), u_m);
  perform pg_temp.must_fail(format(ins, 'vendor', 'v-3', '2026-10-22', 'a', '2026-10-23', 600, true, pg_temp.h('5'), pg_temp.h('e'), u_m), 'ach_files_file_id_modifier_check');
  perform pg_temp.must_fail(format(ins, 'vendor', 'v-3', '2026-10-22', 'AB', '2026-10-23', 600, true, pg_temp.h('5'), pg_temp.h('e'), u_m), 'ach_files_file_id_modifier_check');

  -- 4. duplicates: same payments + same effective date, or the same bytes, while live
  perform pg_temp.must_fail(format(ins, 'vendor', 'v-4', '2026-10-22', 'A', '2026-10-23', 500, true, pg_temp.h('6'), pg_temp.h('c'), u_m), 'ach_files_no_duplicate_entries');
  execute format(ins, 'vendor', 'v-4', '2026-10-22', 'A', '2026-10-30', 500, true, pg_temp.h('6'), pg_temp.h('c'), u_m);   -- same payments, another week: allowed
  perform pg_temp.must_fail(format(ins, 'vendor', 'v-5', '2026-10-22', 'B', '2026-10-23', 700, true, pg_temp.h('3'), pg_temp.h('f'), u_m), 'ach_files_sha_live');

  -- 5. shape: prenotes do not count and carry no money; counts flag tied to kind
  perform pg_temp.must_fail(format(ins, 'prenote', 'p-1', '2026-10-22', 'C', '2026-10-23', 0, true, pg_temp.h('7'), pg_temp.h('7'), u_m), 'ach_files_kind_limit');
  perform pg_temp.must_fail(format(ins, 'prenote', 'p-1', '2026-10-22', 'C', '2026-10-23', 5, false, pg_temp.h('7'), pg_temp.h('7'), u_m), 'ach_files_prenote_zero');
  perform pg_temp.must_fail(format(ins, 'micro_entry', 'm-1', '2026-10-22', 'C', '2026-10-23', 37, false, pg_temp.h('7'), pg_temp.h('7'), u_m), 'ach_files_kind_limit');
  execute format(ins, 'prenote', 'p-1', '2026-10-22', 'C', '2026-10-23', 0, false, pg_temp.h('7'), pg_temp.h('7'), u_m);
  -- unencrypted body, short hashes: refused by the CHECKs (owner stamped, so the guard lets it reach them)
  perform pg_temp.must_fail(format($q$insert into public.ach_files (kind, source_id, file_date, file_id_modifier, filename, effective_date, entry_count, total_cents, counts_toward_limit, sha256, entry_set_hmac, body_enc, released_by)
    values ('vendor', 'v-9', '2026-10-22', 'D', 'f.ach', '2026-10-23', 1, 1, true, %L, %L, 'plain text', %L)$q$, pg_temp.h('8'), pg_temp.h('8'), u_m), 'ach_files_body_enc_check');
  perform pg_temp.must_fail(format($q$insert into public.ach_files (kind, source_id, file_date, file_id_modifier, filename, effective_date, entry_count, total_cents, counts_toward_limit, sha256, entry_set_hmac, body_enc, released_by)
    values ('vendor', 'v-9', '2026-10-22', 'D', 'f.ach', '2026-10-23', 1, 1, true, 'abc', %L, 'encv1:x:y', %L)$q$, pg_temp.h('8'), u_m), 'ach_files_sha256_check');
  perform pg_temp.must_fail(format($q$insert into public.ach_files (kind, source_id, file_date, file_id_modifier, filename, effective_date, entry_count, total_cents, counts_toward_limit, sha256, entry_set_hmac, body_enc, released_by, status)
    values ('vendor', 'v-9', '2026-10-22', 'D', 'f.ach', '2026-10-23', 1, 1, true, %L, %L, 'encv1:x:y', %L, 'uploaded')$q$, pg_temp.h('8'), pg_temp.h('8'), u_m), 'ACH_FILE_TRANSITION');

  -- 6. the facts never change; never deleted; forward moves only
  perform pg_temp.must_fail(format($q$update public.ach_files set body_enc = 'encv1:z:z' where id = %L$q$, f1), 'ACH_FILE_IMMUTABLE');
  perform pg_temp.must_fail(format($q$update public.ach_files set sha256 = %L where id = %L$q$, pg_temp.h('9'), f1), 'ACH_FILE_IMMUTABLE');
  perform pg_temp.must_fail(format($q$update public.ach_files set file_id_modifier = 'Z' where id = %L$q$, f1), 'ACH_FILE_IMMUTABLE');
  perform pg_temp.must_fail(format($q$update public.ach_files set total_cents = 1 where id = %L$q$, f1), 'ACH_FILE_IMMUTABLE');
  perform pg_temp.must_fail(format($q$update public.ach_files set released_by = %L where id = %L$q$, u_s, f1), 'ACH_FILE_IMMUTABLE');
  perform pg_temp.must_fail(format($q$delete from public.ach_files where id = %L$q$, f1), 'ACH_FILE_KEEP');
  perform pg_temp.must_fail(format($q$update public.ach_files set status = 'bank_approved', approved_at_bank_by = %L, approved_at_bank_at = now() where id = %L$q$, u_m, f1), 'ACH_FILE_TRANSITION');
  update public.ach_files set status = 'uploaded', uploaded_by = u_m, uploaded_at = now() where id = f1;
  perform pg_temp.must_fail(format($q$update public.ach_files set status = 'released' where id = %L$q$, f1), 'ACH_FILE_TRANSITION');

  -- 7. void: owner, with a reason; the run goes back to draft; the letter stays used
  perform pg_temp.must_fail(format($q$select public.ach_file_void(%L, %L, 'wrong pay date on the run')$q$, f1, u_s), 'ACH_OWNER_ONLY');
  perform pg_temp.must_fail(format($q$select public.ach_file_void(%L, %L, 'short')$q$, f1, u_m), 'ACH_FILE_REASON');
  select status into r from public.ach_files where id = f1;
  assert r.status = 'uploaded', 'refused voids changed nothing';
  kind_out := public.ach_file_void(f1, u_m, '  wrong pay date on the run  ');
  assert kind_out = 'payroll', 'void returns the kind';
  select * into r from public.ach_files where id = f1;
  assert r.status = 'voided' and r.voided_by = u_m and r.voided_reason = 'wrong pay date on the run', 'voided with who and why';
  select status into r from public.payroll_runs where id = run1;
  assert r.status = 'draft', 'a voided payroll file returns its run to draft';
  perform pg_temp.must_fail(format($q$update public.ach_files set voided_reason = 'changed my mind later' where id = %L$q$, f1), 'ACH_FILE_FINAL');
  perform pg_temp.must_fail(format($q$select public.ach_file_void(%L, %L, 'void it a second time')$q$, f1, u_m), 'ACH_FILE_FINAL');
  perform pg_temp.must_fail(format($q$delete from public.ach_files where id = %L$q$, f1), 'ACH_FILE_KEEP');

  -- 8. re-release after void: the SAME payments and bytes are allowed again (the old one is voided), but letter A is still taken that day
  perform pg_temp.must_fail(format($q$select public.ach_file_release_payroll(%L, %L, '2026-10-20', 'A', 'payroll_2026-10-23_x.ach', '2026-10-23', 2, 150123, %L, %L, 'encv1:a:b', false, null)$q$,
    run1, u_m, pg_temp.h('1'), pg_temp.h('a')), 'ach_files_day_modifier_key');
  select status into r from public.payroll_runs where id = run1;
  assert r.status = 'draft', 'the refused re-release rolled back with its run stamp';
  f2 := public.ach_file_release_payroll(run1, u_m, '2026-10-20', 'C', 'payroll_2026-10-23_x.ach', '2026-10-23', 2, 150123, pg_temp.h('1'), pg_temp.h('a'), 'encv1:a:b', false, null);
  select * into r from public.payroll_runs where id = run1;
  assert r.status = 'file_generated' and r.file_id_modifier = 'C' and not r.guardrail_override and r.guardrail_override_by is null, 're-released with a new letter, the old override cleared';

  -- 9. void of a non-payroll file leaves payroll runs alone
  select id into f2 from public.ach_files where source_id = 'v-2';
  perform public.ach_file_void(f2, u_m, 'vendor asked for a check instead');
  select status into r from public.payroll_runs where id = run1;
  assert r.status = 'file_generated', 'a vendor void does not touch payroll';
  select count(*) into n from public.payroll_runs where id = run2 and status = 'draft';
  assert n = 1, 'the other run is untouched';

  -- 10. the 0271 request list takes ach_file
  select count(*) into n from pg_constraint where conname = 'ach_change_requests_target_type_check' and pg_get_constraintdef(oid) like '%ach_file%';
  assert n = 1, 'ach_change_requests.target_type admits ach_file';

  raise notice 'ACH 0273 CHECK PASSED';
end $$;

rollback;
