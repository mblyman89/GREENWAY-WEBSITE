-- scripts/recon/ach-timberland-confirm-0272-pg-check.sql  (R41 S2 - migration 0272)
--
-- Scenario check for 0272_ach_company_timberland_confirmed.sql on Postgres 15
-- with every migration applied. ONE transaction, rolled back: no rows remain.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/ach-timberland-confirm-0272-pg-check.sql
--
-- Each refusal MUST raise with the expected text and sits beside a valid write
-- that MUST be accepted. "ACH 0272 CHECK PASSED" then ROLLBACK = all clear.
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
  u_m  uuid := gen_random_uuid();   -- "Michael", owner
  u_s  uuid := gen_random_uuid();   -- "Stephen", admin
  r    record;
  n    int;
  f    text;
  t0   timestamptz;
begin
  insert into auth.users (id, email) values (u_m, 'm0272@x.test'), (u_s, 's0272@x.test');
  insert into public.staff_profiles (id, email, role, active) values
    (u_m, 'm0272@x.test', 'owner', true), (u_s, 's0272@x.test', 'admin', true)
    on conflict (id) do update set role = excluded.role, active = excluded.active;
  perform set_config('request.jwt.claim.sub', '', true);   -- service role (the app's path)

  -- 0. the columns, constraint and trigger exist; trigger order is guard -> stamp -> updated_at
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'ach_company_settings'
     and column_name in ('timberland_confirmed_at', 'timberland_confirmed_by', 'timberland_confirm_note', 'timberland_confirm_cleared_at');
  assert n = 4, format('four stamp columns, found %s', n);
  select count(*) into n from pg_trigger where tgrelid = 'public.ach_company_settings'::regclass and not tgisinternal
     and tgname in ('trg_ach_company_settings_owner_guard', 'trg_ach_company_settings_timberland_stamp', 'trg_ach_company_settings_updated');
  assert n = 3, format('the three before-update triggers, found %s', n);
  assert 'trg_ach_company_settings_owner_guard' < 'trg_ach_company_settings_timberland_stamp', 'the owner guard fires first (alphabetical)';

  -- a Timberland-shaped row, saved by the owner
  update public.ach_company_settings set destination_routing = '325170754', destination_name = 'TIMBERLAND BANK',
    immediate_origin = '1911234567', company_id = '1911234567', company_name = 'GREENWAY MARIJUANA', originating_dfi = '32517075',
    timberland_confirmed_at = null, timberland_confirmed_by = null, timberland_confirm_note = null, timberland_confirm_cleared_at = null,
    updated_by = u_m where id = true;

  -- 1. who may stamp: the owner (0271 guard), naming himself, with a note, not in the future
  perform pg_temp.must_fail(format($q$update public.ach_company_settings set timberland_confirmed_at = now(), timberland_confirmed_by = %L, timberland_confirm_note = 'Brenda, email of 10/16', updated_by = %L where id = true$q$, u_s, u_s),
    'ACH_OWNER_ONLY');
  perform pg_temp.must_fail(format($q$update public.ach_company_settings set timberland_confirmed_at = now(), timberland_confirmed_by = %L, timberland_confirm_note = 'Brenda, email of 10/16', updated_by = %L where id = true$q$, u_s, u_m),
    'TIMBERLAND_STAMP_SELF');
  perform pg_temp.must_fail(format($q$update public.ach_company_settings set timberland_confirmed_at = now(), timberland_confirmed_by = null, timberland_confirm_note = 'Brenda, email of 10/16', updated_by = %L where id = true$q$, u_m),
    'TIMBERLAND_STAMP_SELF');
  perform pg_temp.must_fail(format($q$update public.ach_company_settings set timberland_confirmed_at = now() + interval '1 day', timberland_confirmed_by = %L, timberland_confirm_note = 'Brenda, email of 10/16', updated_by = %L where id = true$q$, u_m, u_m),
    'TIMBERLAND_STAMP_FUTURE');
  perform pg_temp.must_fail(format($q$update public.ach_company_settings set timberland_confirmed_at = now(), timberland_confirmed_by = %L, timberland_confirm_note = 'ok', updated_by = %L where id = true$q$, u_m, u_m),
    'ach_timberland_stamp_shape');
  perform pg_temp.must_fail(format($q$update public.ach_company_settings set timberland_confirmed_at = now(), timberland_confirmed_by = %L, timberland_confirm_note = null, updated_by = %L where id = true$q$, u_m, u_m),
    'ach_timberland_stamp_shape');
  perform pg_temp.must_fail($q$update public.ach_company_settings set timberland_confirm_note = 'a note with no stamp time' where id = true$q$,
    'ach_timberland_stamp_shape');
  update public.ach_company_settings set timberland_confirmed_at = now(), timberland_confirmed_by = u_m,
    timberland_confirm_note = 'Brenda, email of 10/16', updated_by = u_m where id = true;
  select * into r from public.ach_company_settings where id = true;
  assert r.timberland_confirmed_at is not null and r.timberland_confirmed_by = u_m and r.timberland_confirm_cleared_at is null, 'owner stamp accepted';

  -- 2. a non-matched change keeps the stamp (statement description, account type)
  update public.ach_company_settings set entry_description = 'PAYROLL', company_account_type = 'checking', destination_name = 'TIMBERLAND BANK N.A.', updated_by = u_m where id = true;
  select * into r from public.ach_company_settings where id = true;
  assert r.timberland_confirmed_at is not null, 'a change to a field Timberland does not match keeps the stamp';
  -- the funding account (encrypted, random IV) is not a matched field
  update public.ach_company_settings set company_account_number = 'encv1:new-iv', updated_by = u_m where id = true;
  select * into r from public.ach_company_settings where id = true;
  assert r.timberland_confirmed_at is not null, 'a re-encrypted account number keeps the stamp';

  -- 3. each matched field, changed alone, clears the stamp and records when
  foreach f in array array['destination_routing', 'immediate_origin', 'company_name', 'company_id', 'originating_dfi'] loop
    update public.ach_company_settings set timberland_confirmed_at = now(), timberland_confirmed_by = u_m,
      timberland_confirm_note = 'Brenda, email of 10/16', timberland_confirm_cleared_at = null, updated_by = u_m where id = true;
    execute format('update public.ach_company_settings set %I = %I || %L, updated_by = %L where id = true', f, f, 'X', u_m);
    select * into r from public.ach_company_settings where id = true;
    assert r.timberland_confirmed_at is null and r.timberland_confirmed_by is null and r.timberland_confirm_note is null,
      format('changing %s clears the stamp', f);
    assert r.timberland_confirm_cleared_at is not null, format('changing %s records when the stamp was cleared', f);
    execute format('update public.ach_company_settings set %I = left(%I, length(%I) - 1), updated_by = %L where id = true', f, f, f, u_m);
  end loop;

  -- 4. a matched change and a new stamp in ONE write: the stamp does not survive
  update public.ach_company_settings set company_name = 'GREENWAY MARIJUA', timberland_confirmed_at = now(), timberland_confirmed_by = u_m,
    timberland_confirm_note = 'Brenda, email of 10/16', updated_by = u_m where id = true;
  select * into r from public.ach_company_settings where id = true;
  assert r.timberland_confirmed_at is null, 'a stamp cannot ride along with the change it would have to cover';

  -- 5. never-stamped row: a matched change does not invent a cleared time
  update public.ach_company_settings set timberland_confirm_cleared_at = null, updated_by = u_m where id = true;
  update public.ach_company_settings set company_name = 'GREENWAY MARIJUANA', updated_by = u_m where id = true;
  select * into r from public.ach_company_settings where id = true;
  assert r.timberland_confirm_cleared_at is null, 'no stamp to clear: cleared_at stays empty';

  -- 6. an admin cannot clear a stamp by editing a matched field (0271 refuses first)
  update public.ach_company_settings set timberland_confirmed_at = now(), timberland_confirmed_by = u_m,
    timberland_confirm_note = 'Brenda, email of 10/16', updated_by = u_m where id = true;
  perform pg_temp.must_fail(format($q$update public.ach_company_settings set company_id = '1999999999', updated_by = %L where id = true$q$, u_s), 'ACH_OWNER_ONLY');
  select * into r from public.ach_company_settings where id = true;
  assert r.timberland_confirmed_at is not null and r.company_id = '1911234567', 'the refused admin write changed nothing';
  -- an owner re-save with identical values keeps the stamp
  t0 := r.timberland_confirmed_at;
  update public.ach_company_settings set company_id = '1911234567', updated_by = u_m where id = true;
  select * into r from public.ach_company_settings where id = true;
  assert r.timberland_confirmed_at = t0, 'saving the same values keeps the stamp';

  raise notice 'ACH 0272 CHECK PASSED';
end $$;

rollback;
