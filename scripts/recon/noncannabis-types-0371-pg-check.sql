-- scripts/recon/noncannabis-types-0371-pg-check.sql  (OI-ACC S3 - migration 0371)
-- ONE transaction, rolled back. "NCTYPES 0371 CHECK PASSED" then ROLLBACK = all clear.
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
declare n int;
begin
  select count(*) into n from pg_class where relname = 'noncannabis_types' and relkind = 'r' and relrowsecurity;
  assert n = 1, 'noncannabis_types with RLS on';
  assert not has_table_privilege('anon', 'public.noncannabis_types', 'select'), 'anon cannot read';
  assert not has_table_privilege('authenticated', 'public.noncannabis_types', 'select'), 'authenticated cannot read';
  assert has_table_privilege('service_role', 'public.noncannabis_types', 'select'), 'service_role reads';
  assert has_table_privilege('service_role', 'public.noncannabis_types', 'insert'), 'service_role adds';
  assert has_table_privilege('service_role', 'public.noncannabis_types', 'update'), 'service_role archives';
  assert not has_table_privilege('service_role', 'public.noncannabis_types', 'delete'), 'archive, never delete';

  select count(*) into n from public.noncannabis_types;
  assert n >= 25, 'seeded 22 built-ins + 3 card-only types';
  select count(*) into n from public.noncannabis_types where value in ('sherlock', 'chillum', 'dab_tool') and card_image <> '';
  assert n = 3, 'card-only placeholders became types';
  select count(*) into n from public.noncannabis_types where value = 'apparel' and menu_group = 'merch';
  assert n = 1, 'apparel is merch';

  perform pg_temp.must_fail($q$insert into public.noncannabis_types (value, label, sku_prefix) values ('Bad Value', 'x', 'XX')$q$, 'noncannabis_types_value_chk');
  perform pg_temp.must_fail($q$insert into public.noncannabis_types (value, label, sku_prefix) values ('ok_1', '   ', 'XX')$q$, 'noncannabis_types_label_chk');
  perform pg_temp.must_fail($q$insert into public.noncannabis_types (value, label, sku_prefix) values ('ok_2', 'x', 'toolong')$q$, 'noncannabis_types_prefix_chk');
  perform pg_temp.must_fail($q$insert into public.noncannabis_types (value, label, sku_prefix, menu_group) values ('ok_3', 'x', 'XX', 'flower')$q$, 'noncannabis_types_group_chk');
  insert into public.noncannabis_types (value, label, sku_prefix) values ('ok_4', 'A/B & C #1 "x"', 'ABC');
  perform pg_temp.must_fail($q$insert into public.noncannabis_types (value, label, sku_prefix) values ('ok_4', 'dup', 'XX')$q$, 'duplicate key');
end $$;

select 'NCTYPES 0371 CHECK PASSED';
rollback;
