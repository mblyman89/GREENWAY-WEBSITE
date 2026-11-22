-- scripts/recon/print-designs-0370-pg-check.sql  (D263 S8 - migration 0370)
--
-- Scenario check for 0370_print_designs.sql on Postgres 15 with every
-- migration applied. ONE transaction, rolled back: no rows remain.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/print-designs-0370-pg-check.sql
--
-- "PRINT 0370 CHECK PASSED" then ROLLBACK = all clear.
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
  n int;
begin
  -- 0. shape and grants
  select count(*) into n from pg_class where relname = 'print_designs' and relkind = 'r' and relrowsecurity;
  assert n = 1, 'print_designs with RLS on';
  select count(*) into n from pg_policies where tablename = 'print_designs';
  assert n = 0, 'no policies: service role only';
  assert not has_table_privilege('anon', 'public.print_designs', 'select'), 'anon cannot read';
  assert not has_table_privilege('authenticated', 'public.print_designs', 'insert'), 'authenticated cannot write';
  assert has_table_privilege('service_role', 'public.print_designs', 'update'), 'service_role saves';

  -- 1. a good row
  insert into public.print_designs (id, name, preset_id, doc) values ('pd_check_1', 'Grand opening banner', 'banner-6x12', '{"v":1,"pages":[]}');
  select rev into n from public.print_designs where id = 'pd_check_1';
  assert n = 1, 'rev starts at 1';

  -- 2. guards
  perform pg_temp.must_fail($q$insert into public.print_designs (id, name, preset_id, doc) values ('bad id!', 'x', 'flyer-letter', '{}')$q$, 'print_designs_id_chk');
  perform pg_temp.must_fail($q$insert into public.print_designs (id, name, preset_id, doc) values ('pd_check_2', '   ', 'flyer-letter', '{}')$q$, 'print_designs_name_chk');
  perform pg_temp.must_fail($q$insert into public.print_designs (id, name, preset_id, doc) values ('pd_check_3', 'x', 'flyer letter', '{}')$q$, 'print_designs_preset_chk');
  perform pg_temp.must_fail($q$insert into public.print_designs (id, name, preset_id, doc) values ('pd_check_4', 'x', 'flyer-letter', '[1,2]')$q$, 'print_designs_doc_chk');
  perform pg_temp.must_fail($q$update public.print_designs set rev = 0 where id = 'pd_check_1'$q$, 'print_designs_rev_chk');
  perform pg_temp.must_fail($q$insert into public.print_designs (id, name, preset_id, doc) values ('pd_check_1', 'dup', 'flyer-letter', '{}')$q$, 'duplicate key');

  -- 3. compare-and-set: a stale rev updates nothing
  update public.print_designs set name = 'v2', rev = rev + 1 where id = 'pd_check_1' and rev = 1;
  update public.print_designs set name = 'stale', rev = rev + 1 where id = 'pd_check_1' and rev = 1;
  select count(*) into n from public.print_designs where id = 'pd_check_1' and name = 'v2' and rev = 2;
  assert n = 1, 'stale save refused by rev';

  raise notice 'PRINT 0370 CHECK PASSED';
end $$;

rollback;
