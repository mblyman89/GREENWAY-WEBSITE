-- scripts/recon/ach-file-bank-steps-0274-pg-check.sql  (R41 S6 - migration 0274)
--
-- Scenario check for 0274_ach_file_bank_steps.sql on Postgres 15 with every
-- migration applied. ONE transaction, rolled back: no rows remain.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/ach-file-bank-steps-0274-pg-check.sql
--
-- Each refusal MUST raise with the expected text and sits beside a valid write
-- that MUST be accepted. "ACH 0274 CHECK PASSED" then ROLLBACK = all clear.
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
  u_o   uuid := gen_random_uuid();   -- a second owner (releases f1, so the upload stamp must name the ACTOR, not the releaser)
  f1    uuid;
  f2    uuid;
  f3    uuid;
  r     record;
  n     int;
  k     text;
  ins   text;
begin
  insert into auth.users (id, email) values (u_m, 'm0274@x.test'), (u_s, 's0274@x.test'), (u_o, 'o0274@x.test');
  insert into public.staff_profiles (id, email, role, active) values
    (u_m, 'm0274@x.test', 'owner', true), (u_s, 's0274@x.test', 'admin', true), (u_o, 'o0274@x.test', 'owner', true)
    on conflict (id) do update set role = excluded.role, active = excluded.active;
  perform set_config('request.jwt.claim.sub', '', true);   -- service role (the app path)

  ins := $q$insert into public.ach_files (kind, source_id, file_date, file_id_modifier, filename, effective_date, entry_count, total_cents, counts_toward_limit, sha256, entry_set_hmac, body_enc, released_by)
    values ('vendor', %L, '2026-10-20', %L, 'f.ach', '2026-10-23', 1, %s, true, %L, %L, 'encv1:x:y', %L) returning id$q$;
  execute format(ins, 'v-0274-1', 'A', 500, pg_temp.h('1'), pg_temp.h('a'), u_o) into f1;
  execute format(ins, 'v-0274-2', 'B', 600, pg_temp.h('2'), pg_temp.h('b'), u_m) into f2;
  execute format(ins, 'v-0274-3', 'C', 700, pg_temp.h('3'), pg_temp.h('c'), u_m) into f3;

  -- 0. shape: two server-only functions
  select count(*) into n from pg_proc where proname in ('ach_file_mark_uploaded', 'ach_file_mark_bank_approved');
  assert n = 2, format('two bank-step functions, found %s', n);
  assert not has_function_privilege('authenticated', 'public.ach_file_mark_uploaded(uuid, uuid)', 'EXECUTE'), 'mark uploaded is server only';
  assert not has_function_privilege('authenticated', 'public.ach_file_mark_bank_approved(uuid, uuid)', 'EXECUTE'), 'mark approved is server only';
  assert not has_function_privilege('anon', 'public.ach_file_mark_uploaded(uuid, uuid)', 'EXECUTE'), 'anon cannot mark uploaded';
  assert has_function_privilege('service_role', 'public.ach_file_mark_bank_approved(uuid, uuid)', 'EXECUTE'), 'the server can mark approved';

  -- 1. a new row cannot arrive already stamped
  perform pg_temp.must_fail(format($q$insert into public.ach_files (kind, source_id, file_date, file_id_modifier, filename, effective_date, entry_count, total_cents, counts_toward_limit, sha256, entry_set_hmac, body_enc, released_by, uploaded_by, uploaded_at)
    values ('vendor', 'v-0274-9', '2026-10-20', 'D', 'f.ach', '2026-10-23', 1, 1, true, %L, %L, 'encv1:x:y', %L, %L, now())$q$, pg_temp.h('9'), pg_temp.h('9'), u_m, u_m), 'ACH_BANK_STEP');

  -- 2. approve before upload: refused by the function and by the guard
  perform pg_temp.must_fail(format($q$select public.ach_file_mark_bank_approved(%L, %L)$q$, f1, u_m), 'ACH_FILE_TRANSITION');

  -- 3. upload: owner only; the admin is refused and nothing changes
  perform pg_temp.must_fail(format($q$select public.ach_file_mark_uploaded(%L, %L)$q$, f1, u_s), 'ACH_OWNER_ONLY');
  perform pg_temp.must_fail(format($q$select public.ach_file_mark_uploaded(%L, null)$q$, f1), 'ACH_OWNER_ONLY');
  select status, uploaded_by into r from public.ach_files where id = f1;
  assert r.status = 'released' and r.uploaded_by is null, 'the refused upload changed nothing';
  perform pg_temp.must_fail(format($q$select public.ach_file_mark_uploaded(%L, %L)$q$, gen_random_uuid(), u_m), 'ACH_FILE_NOT_FOUND');
  k := public.ach_file_mark_uploaded(f1, u_m);
  assert k = 'vendor', 'mark uploaded returns the kind';
  select * into r from public.ach_files where id = f1;
  assert r.status = 'uploaded' and r.uploaded_by = u_m and r.uploaded_at is not null and r.approved_at_bank_by is null, 'uploaded, stamped once';
  perform pg_temp.must_fail(format($q$select public.ach_file_mark_uploaded(%L, %L)$q$, f1, u_m), 'ACH_FILE_TRANSITION');

  -- 4. the stamps never change
  perform pg_temp.must_fail(format($q$update public.ach_files set uploaded_by = %L where id = %L$q$, u_s, f1), 'ACH_BANK_STEP_FINAL');
  perform pg_temp.must_fail(format($q$update public.ach_files set uploaded_at = now() - interval '1 day' where id = %L$q$, f1), 'ACH_BANK_STEP_FINAL');
  perform pg_temp.must_fail(format($q$update public.ach_files set uploaded_by = null, uploaded_at = null where id = %L$q$, f1), 'ACH_BANK_STEP_FINAL');

  -- 5. direct writes cannot skip the owner (the guard, not only the function)
  perform pg_temp.must_fail(format($q$update public.ach_files set status = 'uploaded', uploaded_by = %L, uploaded_at = now() where id = %L$q$, u_s, f2), 'ACH_OWNER_ONLY');
  perform pg_temp.must_fail(format($q$update public.ach_files set uploaded_by = %L, uploaded_at = now() where id = %L$q$, u_m, f2), 'ACH_BANK_STEP');
  perform pg_temp.must_fail(format($q$update public.ach_files set approved_at_bank_by = %L, approved_at_bank_at = now() where id = %L$q$, u_m, f1), 'ACH_BANK_STEP');

  -- 6. bank approval: owner only; the SAME person who uploaded may approve
  --    (dual approval is off, signed Schedule C; Michael is the only user)
  perform pg_temp.must_fail(format($q$select public.ach_file_mark_bank_approved(%L, %L)$q$, f1, u_s), 'ACH_OWNER_ONLY');
  select status into r from public.ach_files where id = f1;
  assert r.status = 'uploaded', 'the refused approval changed nothing';
  k := public.ach_file_mark_bank_approved(f1, u_m);
  assert k = 'vendor', 'mark approved returns the kind';
  select * into r from public.ach_files where id = f1;
  assert r.status = 'bank_approved' and r.approved_at_bank_by = u_m and r.uploaded_by = u_m and r.approved_at_bank_at is not null, 'approved by the same owner who uploaded';
  perform pg_temp.must_fail(format($q$select public.ach_file_mark_bank_approved(%L, %L)$q$, f1, u_m), 'ACH_FILE_TRANSITION');
  perform pg_temp.must_fail(format($q$update public.ach_files set approved_at_bank_by = %L where id = %L$q$, u_s, f1), 'ACH_BANK_STEP_FINAL');
  perform pg_temp.must_fail(format($q$update public.ach_files set status = 'uploaded' where id = %L$q$, f1), 'ACH_FILE_TRANSITION');

  -- 7. an uploaded row with no upload stamp (only reachable with the guard off) cannot be approved
  alter table public.ach_files disable trigger trg_ach_files_guard;
  update public.ach_files set status = 'uploaded' where id = f3;
  alter table public.ach_files enable trigger trg_ach_files_guard;
  perform pg_temp.must_fail(format($q$select public.ach_file_mark_bank_approved(%L, %L)$q$, f3, u_m), 'has no upload recorded');

  -- 8. void still works after each step (owner only), and a voided file takes no bank step
  perform pg_temp.must_fail(format($q$select public.ach_file_void(%L, %L, 'bank approved but wrong vendor')$q$, f1, u_s), 'ACH_OWNER_ONLY');
  perform public.ach_file_void(f1, u_m, 'bank approved but wrong vendor');
  select status, approved_at_bank_by into r from public.ach_files where id = f1;
  assert r.status = 'voided' and r.approved_at_bank_by = u_m, 'void keeps the bank stamps';
  perform pg_temp.must_fail(format($q$select public.ach_file_mark_uploaded(%L, %L)$q$, f2, u_s), 'ACH_OWNER_ONLY');
  perform public.ach_file_void(f2, u_m, 'released by mistake, never sent');
  perform pg_temp.must_fail(format($q$select public.ach_file_mark_uploaded(%L, %L)$q$, f2, u_m), 'ACH_FILE_TRANSITION');

  -- 9. the 0273 rules still hold
  perform pg_temp.must_fail(format($q$delete from public.ach_files where id = %L$q$, f2), 'ACH_FILE_KEEP');
  perform pg_temp.must_fail(format($q$update public.ach_files set voided_reason = 'changed my mind later' where id = %L$q$, f2), 'ACH_FILE_FINAL');
  perform pg_temp.must_fail(format($q$update public.ach_files set total_cents = 1 where id = %L$q$, f3), 'ACH_FILE_IMMUTABLE');
  perform pg_temp.must_fail(format(ins, 'v-0274-5', 'E', 800, pg_temp.h('5'), pg_temp.h('e'), u_s), 'ACH_OWNER_ONLY');

  raise notice 'ACH 0274 CHECK PASSED';
end $$;

rollback;
