-- scripts/recon/ach-file-funding-0276-pg-check.sql  (R41 S9 - migration 0276)
--
-- Scenario check for 0276_ach_file_funding_confirm.sql on Postgres 15 with
-- every migration applied. ONE transaction, rolled back: no rows remain.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/ach-file-funding-0276-pg-check.sql
--
-- Each refusal MUST raise with the expected text and sits beside a valid write
-- that MUST be accepted. "ACH 0276 CHECK PASSED" then ROLLBACK = all clear.
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
  f1    uuid;
  f2    uuid;
  f3    uuid;
  f4    uuid;
  r     record;
  n     int;
  k     text;
  ins   text;
begin
  insert into auth.users (id, email) values (u_m, 'm0276@x.test'), (u_s, 's0276@x.test');
  insert into public.staff_profiles (id, email, role, active) values
    (u_m, 'm0276@x.test', 'owner', true), (u_s, 's0276@x.test', 'admin', true)
    on conflict (id) do update set role = excluded.role, active = excluded.active;
  perform set_config('request.jwt.claim.sub', '', true);   -- service role (the app path)

  ins := $q$insert into public.ach_files (kind, source_id, file_date, file_id_modifier, filename, effective_date, entry_count, total_cents, counts_toward_limit, sha256, entry_set_hmac, body_enc, released_by)
    values ('payroll', %L, '2026-10-20', %L, 'f.ach', '2026-10-23', 1, %s, true, %L, %L, 'encv1:x:y', %L) returning id$q$;
  execute format(ins, 'p-0276-1', 'A', 50000, pg_temp.h('1'), pg_temp.h('a'), u_m) into f1;
  execute format(ins, 'p-0276-2', 'B', 60000, pg_temp.h('2'), pg_temp.h('b'), u_m) into f2;
  execute format(ins, 'p-0276-3', 'C', 70000, pg_temp.h('3'), pg_temp.h('c'), u_m) into f3;
  execute format(ins, 'p-0276-4', 'D', 80000, pg_temp.h('4'), pg_temp.h('d'), u_m) into f4;

  -- 0. shape: one server-only function
  select count(*) into n from pg_proc where proname = 'ach_file_confirm_funding';
  assert n = 1, format('one funding function, found %s', n);
  assert not has_function_privilege('authenticated', 'public.ach_file_confirm_funding(uuid, uuid, bigint)', 'EXECUTE'), 'confirm funding is server only';
  assert not has_function_privilege('anon', 'public.ach_file_confirm_funding(uuid, uuid, bigint)', 'EXECUTE'), 'anon cannot confirm funding';
  assert has_function_privilege('service_role', 'public.ach_file_confirm_funding(uuid, uuid, bigint)', 'EXECUTE'), 'the server can confirm funding';

  -- 1. a new row cannot arrive already confirmed
  perform pg_temp.must_fail(format($q$insert into public.ach_files (kind, source_id, file_date, file_id_modifier, filename, effective_date, entry_count, total_cents, counts_toward_limit, sha256, entry_set_hmac, body_enc, released_by, funding_confirmed_by, funding_confirmed_at, funding_confirmed_amount_cents)
    values ('payroll', 'p-0276-9', '2026-10-20', 'E', 'f.ach', '2026-10-23', 1, 1, true, %L, %L, 'encv1:x:y', %L, %L, now(), 1)$q$, pg_temp.h('9'), pg_temp.h('9'), u_m, u_m), 'ACH_FUNDING');

  -- 2. owner only; nothing changes on a refusal
  perform pg_temp.must_fail(format($q$select public.ach_file_confirm_funding(%L, %L, 50000)$q$, f1, u_s), 'ACH_OWNER_ONLY');
  perform pg_temp.must_fail(format($q$select public.ach_file_confirm_funding(%L, null, 50000)$q$, f1), 'ACH_OWNER_ONLY');
  select funding_confirmed_at into r from public.ach_files where id = f1;
  assert r.funding_confirmed_at is null, 'the refused confirmation changed nothing';
  perform pg_temp.must_fail(format($q$select public.ach_file_confirm_funding(%L, %L, 50000)$q$, gen_random_uuid(), u_m), 'ACH_FILE_NOT_FOUND');

  -- 3. the amount must cover the file total (one cent short is refused; exact is accepted)
  perform pg_temp.must_fail(format($q$select public.ach_file_confirm_funding(%L, %L, 49999)$q$, f1, u_m), 'ACH_FUNDING_SHORT');
  perform pg_temp.must_fail(format($q$select public.ach_file_confirm_funding(%L, %L, null)$q$, f1, u_m), 'ACH_FUNDING_SHORT');
  perform pg_temp.must_fail(format($q$update public.ach_files set funding_confirmed_by = %L, funding_confirmed_at = now(), funding_confirmed_amount_cents = 49999 where id = %L$q$, u_m, f1), 'ACH_FUNDING_SHORT');
  k := public.ach_file_confirm_funding(f1, u_m, 50000);
  assert k = 'payroll', 'confirm funding returns the kind';
  select * into r from public.ach_files where id = f1;
  assert r.funding_confirmed_by = u_m and r.funding_confirmed_at is not null and r.funding_confirmed_amount_cents = 50000 and r.status = 'released', 'confirmed once, status unchanged';

  -- 4. set once: never again, never changed, never cleared
  perform pg_temp.must_fail(format($q$select public.ach_file_confirm_funding(%L, %L, 90000)$q$, f1, u_m), 'ACH_FUNDING_FINAL');
  perform pg_temp.must_fail(format($q$update public.ach_files set funding_confirmed_amount_cents = 90000 where id = %L$q$, f1), 'ACH_FUNDING_FINAL');
  perform pg_temp.must_fail(format($q$update public.ach_files set funding_confirmed_by = %L where id = %L$q$, u_s, f1), 'ACH_FUNDING_FINAL');
  perform pg_temp.must_fail(format($q$update public.ach_files set funding_confirmed_at = now() - interval '1 day' where id = %L$q$, f1), 'ACH_FUNDING_FINAL');
  perform pg_temp.must_fail(format($q$update public.ach_files set funding_confirmed_by = null, funding_confirmed_at = null, funding_confirmed_amount_cents = null where id = %L$q$, f1), 'ACH_FUNDING_FINAL');

  -- 5. a confirmed file still moves through the bank steps, keeping the stamp
  perform public.ach_file_mark_uploaded(f1, u_m);
  select status, funding_confirmed_amount_cents into r from public.ach_files where id = f1;
  assert r.status = 'uploaded' and r.funding_confirmed_amount_cents = 50000, 'upload keeps the funding stamp';

  -- 6. an uploaded file may be confirmed (released OR uploaded), more than the total is fine
  perform public.ach_file_mark_uploaded(f2, u_m);
  perform public.ach_file_confirm_funding(f2, u_m, 65000);
  select funding_confirmed_amount_cents, status into r from public.ach_files where id = f2;
  assert r.funding_confirmed_amount_cents = 65000 and r.status = 'uploaded', 'an uploaded file confirmed';

  -- 7. not on a bank-approved or voided file; not together with a status change (direct write)
  perform public.ach_file_mark_bank_approved(f2, u_m);
  perform public.ach_file_mark_uploaded(f3, u_m);
  perform public.ach_file_mark_bank_approved(f3, u_m);
  perform pg_temp.must_fail(format($q$select public.ach_file_confirm_funding(%L, %L, 70000)$q$, f3, u_m), 'ACH_FILE_TRANSITION');
  perform pg_temp.must_fail(format($q$update public.ach_files set funding_confirmed_by = %L, funding_confirmed_at = now(), funding_confirmed_amount_cents = 70000 where id = %L$q$, u_m, f3), 'ACH_FUNDING');
  perform pg_temp.must_fail(format($q$update public.ach_files set status = 'uploaded', uploaded_by = %L, uploaded_at = now(), funding_confirmed_by = %L, funding_confirmed_at = now(), funding_confirmed_amount_cents = 80000 where id = %L$q$, u_m, u_m, f4), 'ACH_FUNDING');
  perform public.ach_file_void(f4, u_m, 'released by mistake, never sent');
  perform pg_temp.must_fail(format($q$select public.ach_file_confirm_funding(%L, %L, 80000)$q$, f4, u_m), 'ACH_FILE_TRANSITION');

  -- 8. a direct write by an admin is refused by the guard (not only the function)
  execute format(ins, 'p-0276-5', 'F', 1000, pg_temp.h('5'), pg_temp.h('f'), u_m) into f4;
  perform pg_temp.must_fail(format($q$update public.ach_files set funding_confirmed_by = %L, funding_confirmed_at = now(), funding_confirmed_amount_cents = 1000 where id = %L$q$, u_s, f4), 'ACH_OWNER_ONLY');

  -- 9. the 0273 and 0274 rules still hold
  perform pg_temp.must_fail(format($q$delete from public.ach_files where id = %L$q$, f1), 'ACH_FILE_KEEP');
  perform pg_temp.must_fail(format($q$update public.ach_files set total_cents = 1 where id = %L$q$, f1), 'ACH_FILE_IMMUTABLE');
  perform pg_temp.must_fail(format($q$update public.ach_files set uploaded_by = %L where id = %L$q$, u_s, f1), 'ACH_BANK_STEP_FINAL');
  perform pg_temp.must_fail(format($q$select public.ach_file_mark_uploaded(%L, %L)$q$, f4, u_s), 'ACH_OWNER_ONLY');
  perform pg_temp.must_fail(format(ins, 'p-0276-6', 'G', 800, pg_temp.h('6'), pg_temp.h('g'), u_s), 'ACH_OWNER_ONLY');

  raise notice 'ACH 0276 CHECK PASSED';
end $$;

rollback;
