-- scripts/recon/medical-endorsement-0329-pg-check.sql  (slice A-06 - migration 0329)
--
-- Scenario check for 0329_medical_endorsement_switch.sql on Postgres 15 with
-- every migration applied. ONE transaction, rolled back: nothing remains.
--   * rollback then re-apply, twice (idempotent);
--   * the 0040 seed (TRUE, no number, no date) is switched OFF; no row -> one OFF row;
--   * a real endorsement row (number + date) survives the migration ON;
--   * the check refuses ON without a number / without a date;
--   * register_test_mode_allowed defaults false;
--   * RLS: staff read; staff cannot write; the owner can.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/medical-endorsement-0329-pg-check.sql
--
-- "MEDICAL 0329 CHECK PASSED" then ROLLBACK = all clear.
begin;

\i supabase/rollbacks/0329_medical_endorsement_switch.rollback.sql
do $$ begin
  assert not exists (select 1 from information_schema.columns
                      where table_name = 'medical_endorsement_config' and column_name = 'register_test_mode_allowed'),
         'clean start';
end $$;

create or replace function pg_temp.expect_error(sql text, needle text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if position(needle in sqlerrm) = 0 then
      raise exception 'expected error containing "%" from [%], got: %', needle, sql, sqlerrm;
    end if;
    return;
  end;
  raise exception 'expected error containing "%" but [%] succeeded', needle, sql;
end $$;

-- 1. The legacy 0040 seed: TRUE with no number. 0329 must switch it OFF.
delete from public.medical_endorsement_config;
insert into public.medical_endorsement_config (is_medically_endorsed, notes)
values (true, 'Greenway holds an LCB medical endorsement.');
insert into public.tax_settings (id, medical_endorsement) values (true, true)
  on conflict (id) do update set medical_endorsement = true;
\i supabase/migrations/0329_medical_endorsement_switch.sql
\i supabase/migrations/0329_medical_endorsement_switch.sql
do $$ begin
  assert (select not medical_endorsement from public.tax_settings where id), 'tax_settings mirror switched OFF';
  assert (select count(*) from public.medical_endorsement_config) = 1, 'still one row';
  assert (select bool_and(not is_medically_endorsed) from public.medical_endorsement_config), 'legacy seed switched OFF';
  assert (select bool_and(not register_test_mode_allowed) from public.medical_endorsement_config), 'test mode hidden by default';
  assert (select notes from public.medical_endorsement_config) like 'Switched OFF by migration 0329%', 'note explains why';
end $$;

-- 2. No row at all -> one OFF row.
delete from public.medical_endorsement_config;
\i supabase/migrations/0329_medical_endorsement_switch.sql
do $$ begin
  assert (select count(*) from public.medical_endorsement_config) = 1, 'row created';
  assert (select bool_and(not is_medically_endorsed) from public.medical_endorsement_config), 'created OFF';
end $$;

-- 3. A real endorsement survives a re-run ON.
update public.medical_endorsement_config
   set is_medically_endorsed = true, endorsement_number = 'ME-1', endorsed_effective_on = date '2027-03-01';
update public.tax_settings set medical_endorsement = true where id;
\i supabase/migrations/0329_medical_endorsement_switch.sql
do $$ begin
  assert (select bool_and(is_medically_endorsed) from public.medical_endorsement_config), 'real endorsement kept ON';
  assert (select medical_endorsement from public.tax_settings where id), 'mirror of a real endorsement kept ON';
end $$;

-- 4. The check: ON needs a number and a date.
select pg_temp.expect_error($q$update public.medical_endorsement_config set endorsement_number = '  '$q$, 'medical_endorsement_config_on_needs_facts');
select pg_temp.expect_error($q$update public.medical_endorsement_config set endorsed_effective_on = null$q$, 'medical_endorsement_config_on_needs_facts');
update public.medical_endorsement_config set is_medically_endorsed = false, endorsed_effective_on = null;
do $$ begin
  assert (select count(*) from public.medical_endorsement_config where not is_medically_endorsed) = 1, 'OFF needs nothing';
end $$;

-- 5. RLS: staff read but cannot write; the owner can.
create temp table ids (k text primary key, v uuid);
grant all on ids to public;
do $$ declare u uuid; o uuid; begin
  insert into auth.users (email) values ('ck-staff-0329@example.com') returning id into u;
  insert into public.staff_profiles (id, email, full_name, role) values (u, 'ck-staff-0329@example.com', 'Ana Floor', 'staff')
    on conflict (id) do update set role = 'staff', active = true;
  insert into auth.users (email) values ('ck-owner-0329@example.com') returning id into o;
  insert into public.staff_profiles (id, email, full_name, role) values (o, 'ck-owner-0329@example.com', 'Owner', 'owner')
    on conflict (id) do update set role = 'owner', active = true;
  insert into ids values ('staff', u), ('owner', o);
end $$;
grant select, insert, update, delete on public.medical_endorsement_config to authenticated;

select set_config('request.jwt.claim.sub', (select v::text from ids where k = 'staff'), true);
set local role authenticated;
do $$ declare n int; begin
  assert (select count(*) from public.medical_endorsement_config) = 1, 'staff reads';
  update public.medical_endorsement_config set register_test_mode_allowed = true;
  get diagnostics n = row_count;
  assert n = 0, 'staff update touches no row';
end $$;
reset role;

select set_config('request.jwt.claim.sub', (select v::text from ids where k = 'owner'), true);
set local role authenticated;
do $$ declare n int; begin
  update public.medical_endorsement_config set register_test_mode_allowed = true;
  get diagnostics n = row_count;
  assert n = 1, 'owner update writes';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);

select 'MEDICAL 0329 CHECK PASSED' as result;
rollback;
