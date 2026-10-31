-- scripts/recon/full-count-0328-pg-check.sql  (Fix Phase 4.4d - migration 0328)
--
-- Scenario check for 0328_full_count.sql on Postgres 15 with every migration
-- applied. ONE transaction, rolled back: nothing remains.
--   * rollback then re-apply, twice (idempotent);
--   * the four full-count columns are all-or-none, section_no within
--     1..section_count, a section number used once per count;
--   * a section cannot be moved to another count, year or number;
--   * one full count a year: a second count for the same year is refused
--     while the first has a section that is not cancelled, and allowed once
--     every section of the first is cancelled;
--   * an ordinary audit (no full count) is untouched;
--   * the factory reset hatch lets a change through.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/full-count-0328-pg-check.sql
--
-- "FULL COUNT 0328 CHECK PASSED" then ROLLBACK = all clear.
begin;

\i supabase/rollbacks/0328_full_count.rollback.sql
do $$ begin
  assert not exists (select 1 from information_schema.columns
                      where table_name = 'inventory_audit_sessions' and column_name = 'full_count_id'), 'clean start';
end $$;
\i supabase/migrations/0328_full_count.sql
\i supabase/migrations/0328_full_count.sql

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

create temp table ids (k text primary key, v uuid) on commit drop;
insert into ids values ('fc1', gen_random_uuid()), ('fc2', gen_random_uuid());

-- an ordinary audit is untouched
insert into public.inventory_audit_sessions (label, status) values ('0328 ordinary', 'draft');

-- shape: all four or none
select pg_temp.expect_error(format($q$insert into public.inventory_audit_sessions (label, status, full_count_id) values ('x', 'draft', %L)$q$, (select v from ids where k = 'fc1')), 'inventory_audit_sessions_full_count_ck');
select pg_temp.expect_error(format($q$insert into public.inventory_audit_sessions (label, status, full_count_id, full_count_year, section_no, section_count) values ('x', 'draft', %L, 2026, 3, 2)$q$, (select v from ids where k = 'fc1')), 'inventory_audit_sessions_full_count_ck');
select pg_temp.expect_error(format($q$insert into public.inventory_audit_sessions (label, status, full_count_id, full_count_year, section_no, section_count) values ('x', 'draft', %L, 1999, 1, 1)$q$, (select v from ids where k = 'fc1')), 'inventory_audit_sessions_full_count_ck');

-- two sections of the 2026 full count
insert into public.inventory_audit_sessions (label, status, full_count_id, full_count_year, section_no, section_count)
values ('Year-end 2026 - section 1 of 2', 'draft', (select v from ids where k = 'fc1'), 2026, 1, 2),
       ('Year-end 2026 - section 2 of 2', 'draft', (select v from ids where k = 'fc1'), 2026, 2, 2);

-- a section number is used once
select pg_temp.expect_error(format($q$insert into public.inventory_audit_sessions (label, status, full_count_id, full_count_year, section_no, section_count) values ('dup', 'draft', %L, 2026, 2, 2)$q$, (select v from ids where k = 'fc1')), 'inventory_audit_sessions_full_count_section_uq');

-- a section cannot move
select pg_temp.expect_error($q$update public.inventory_audit_sessions set section_no = 2 where label = 'Year-end 2026 - section 1 of 2'$q$, 'FULL_COUNT_FIXED');
select pg_temp.expect_error($q$update public.inventory_audit_sessions set full_count_year = 2027 where label = 'Year-end 2026 - section 1 of 2'$q$, 'FULL_COUNT_FIXED');
select pg_temp.expect_error(format($q$update public.inventory_audit_sessions set full_count_id = %L where label = 'Year-end 2026 - section 1 of 2'$q$, (select v from ids where k = 'fc2')), 'FULL_COUNT_FIXED');
select pg_temp.expect_error($q$update public.inventory_audit_sessions set full_count_id = null, full_count_year = null, section_no = null, section_count = null where label = 'Year-end 2026 - section 1 of 2'$q$, 'FULL_COUNT_FIXED');
-- ordinary status changes still work
update public.inventory_audit_sessions set status = 'scope_approved' where full_count_id = (select v from ids where k = 'fc1');

-- one full count a year
select pg_temp.expect_error(format($q$insert into public.inventory_audit_sessions (label, status, full_count_id, full_count_year, section_no, section_count) values ('second 2026', 'draft', %L, 2026, 1, 1)$q$, (select v from ids where k = 'fc2')), 'FULL_COUNT_ONE_PER_YEAR');
-- another year is fine
insert into public.inventory_audit_sessions (label, status, full_count_id, full_count_year, section_no, section_count)
values ('Year-end 2027 - section 1 of 1', 'draft', gen_random_uuid(), 2027, 1, 1);
-- once every section of the first is cancelled, a new 2026 count is allowed
update public.inventory_audit_sessions set status = 'cancelled', cancel_reason = '0328 check: start again'
 where full_count_id = (select v from ids where k = 'fc1');
insert into public.inventory_audit_sessions (label, status, full_count_id, full_count_year, section_no, section_count)
values ('second 2026', 'draft', (select v from ids where k = 'fc2'), 2026, 1, 1);

-- the factory reset hatch
do $$ begin
  perform set_config('greenway.factory_reset', 'on', true);
  update public.inventory_audit_sessions set section_count = 3 where label = 'Year-end 2026 - section 2 of 2';
  perform set_config('greenway.factory_reset', 'off', true);
  assert (select section_count from public.inventory_audit_sessions where label = 'Year-end 2026 - section 2 of 2') = 3, 'reset hatch';
end $$;

do $$ begin
  assert (select count(*) from public.inventory_audit_sessions where label = '0328 ordinary' and full_count_id is null) = 1, 'ordinary audit kept';
end $$;

select 'FULL COUNT 0328 CHECK PASSED' as result;
rollback;
