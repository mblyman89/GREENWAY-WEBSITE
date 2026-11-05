-- scripts/recon/menu-copy-retention-0344-pg-check.sql  (PERF round P1/P2 - migration 0344)
--
-- Scenario check for 0344_menu_copy_retention.sql on Postgres 15 with every migration applied.
-- ONE transaction, rolled back: nothing remains.
--   * 0344 applies twice (idempotent);
--   * product_latest_facts always gives the 0305 answer (created_at desc, id asc) after inserts,
--     a multi-row insert, an update, an older insert (ignored) and a clean-slate style delete
--     of the newest row (falls back to the newest remaining row);
--   * latest_menu_facts(null) and latest_menu_facts(keys) read it;
--   * prune_menu_version_items keeps the published / staged / import-origin / test / newest-N /
--     archived-in-the-last-10-minutes versions, removes the rest's items (variants cascade),
--     stamps summary_json, never changes a key's facts, refuses keep < 3, is bounded per call;
--   * TRUNCATE of menu_items empties the facts (the factory reset);
--   * privileges: anon / authenticated cannot read the table or run either function;
--     service_role can read the table and run both functions but cannot write the table
--     or run the trigger bodies.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/menu-copy-retention-0344-pg-check.sql
--
-- "MENU COPY RETENTION 0344 CHECK PASSED" then ROLLBACK = all clear.
begin;

\i supabase/migrations/0344_menu_copy_retention.sql
\i supabase/migrations/0344_menu_copy_retention.sql

create or replace function pg_temp.try_as(r text, sql text) returns text language plpgsql as $$
begin
  execute format('set local role %I', r);
  begin
    execute sql;
  exception when others then
    reset role;
    return sqlstate;
  end;
  reset role;
  return 'ran';
end $$;

-- The 0305 rule computed straight from menu_items, for comparison.
create or replace function pg_temp.rule_0305(k text) returns text language sql as $$
  select coalesce((
    select mi.id::text || '|' || coalesce(mi.category, '') || '|' || coalesce(mi.vendor_name, '')
      from public.menu_items mi
     where mi.source_item_id = k
     order by mi.created_at desc, mi.id asc
     limit 1), 'none')
$$;
create or replace function pg_temp.facts(k text) returns text language sql as $$
  select coalesce((
    select f.row_id::text || '|' || coalesce(f.category, '') || '|' || coalesce(f.vendor_name, '')
      from public.product_latest_facts f where f.source_item_id = k), 'none')
$$;

do $$
declare
  t0 timestamptz := now() - interval '30 days';
  v uuid[] := array[]::uuid[];
  vid uuid;
  v_pub uuid;
  v_staged uuid;
  v_imp uuid;
  v_test uuid;
  v_fresh uuid;
  v_imp_id uuid;
  i int;
  r text;
  j jsonb;
  n bigint;
  blocked boolean;
begin
  -- Start from a clean menu (inside this rolled-back transaction).
  truncate table public.menu_items cascade;
  assert (select count(*) from public.product_latest_facts) = 0, 'truncate empties the facts';

  -- 10 archived intake copies, oldest first, 30 to 21 days old.
  for i in 1..10 loop
    insert into public.menu_versions (status, created_at, updated_at, summary_json)
      values ('archived', t0 + make_interval(days => i), t0 + make_interval(days => i), jsonb_build_object('origin', 'intake'))
      returning id into vid;
    v := v || vid;
    insert into public.menu_items (menu_version_id, source_item_id, name, category, vendor_name, created_at)
      values (vid, '__k1__', 'K1', 'flower-' || i, 'V', t0 + make_interval(days => i)),
             (vid, '__k2__', 'K2', 'edible-' || i, 'V', t0 + make_interval(days => i));
    insert into public.menu_variants (menu_item_id, source_variant_id, label)
      select mi.id, mi.source_item_id || '-1g', '1g' from public.menu_items mi where mi.menu_version_id = vid;
  end loop;

  -- One key that only ever existed in the OLDEST copy (a product that left the menu, sold once).
  insert into public.menu_items (menu_version_id, source_item_id, name, category, vendor_name, created_at)
    values (v[1], '__gone__', 'Gone', 'preroll', 'OldVendor', t0 + interval '1 day');

  -- The published version, a staged one, an import-origin archived one, a test one, and one archived
  -- just now (inside the 10-minute window).
  insert into public.menu_versions (status, created_at, updated_at) values ('published', now() - interval '1 day', now() - interval '1 day')
    returning id into v_pub;
  insert into public.menu_items (menu_version_id, source_item_id, name, category, vendor_name, created_at)
    values (v_pub, '__k1__', 'K1', 'flower-pub', 'V', now() - interval '1 day');
  insert into public.menu_versions (status, created_at, updated_at) values ('staged', now() - interval '20 days', now() - interval '20 days')
    returning id into v_staged;
  insert into public.menu_items (menu_version_id, source_item_id, name, category, created_at)
    values (v_staged, '__k3__', 'K3', 'staged-cat', now() - interval '20 days');

  insert into public.pos_imports default values returning id into v_imp_id;
  insert into public.menu_versions (status, created_at, updated_at, import_id) values ('archived', t0, t0, v_imp_id)
    returning id into v_imp;
  insert into public.menu_items (menu_version_id, source_item_id, name, category, created_at)
    values (v_imp, '__k4__', 'K4', 'import-cat', t0);
  insert into public.menu_versions (status, created_at, updated_at, is_test) values ('archived', t0, t0, true)
    returning id into v_test;
  insert into public.menu_items (menu_version_id, source_item_id, name, category, created_at)
    values (v_test, '__k5__', 'K5', 'test-cat', t0);
  insert into public.menu_versions (status, created_at, updated_at) values ('archived', t0 - interval '1 day', now())
    returning id into v_fresh;
  insert into public.menu_items (menu_version_id, source_item_id, name, category, created_at)
    values (v_fresh, '__k6__', 'K6', 'fresh-cat', t0 - interval '1 day');

  -- The facts match the 0305 rule for every key.
  assert pg_temp.facts('__k1__') = pg_temp.rule_0305('__k1__'), 'k1 facts = 0305 rule';
  assert (select category from public.product_latest_facts where source_item_id = '__k1__') = 'flower-pub', 'k1 newest is published';
  assert (select category from public.product_latest_facts where source_item_id = '__k2__') = 'edible-10', 'k2 newest copy';
  assert (select category from public.product_latest_facts where source_item_id = '__gone__') = 'preroll', 'gone key resolved';
  assert (select count(*) from public.product_latest_facts where source_item_id like '\_\_%') = 7, 'seven keys';

  -- An OLDER row for a key changes nothing; an update to the newest row is followed.
  insert into public.menu_items (menu_version_id, source_item_id, name, category, created_at)
    values (v[1], '__k2__', 'K2 old', 'ancient', t0);
  assert (select category from public.product_latest_facts where source_item_id = '__k2__') = 'edible-10', 'older row ignored';
  update public.menu_items set category = 'edible-fixed' where menu_version_id = v[10] and source_item_id = '__k2__';
  assert (select category from public.product_latest_facts where source_item_id = '__k2__') = 'edible-fixed', 'update followed';
  assert pg_temp.facts('__k2__') = pg_temp.rule_0305('__k2__'), 'k2 facts = 0305 rule after update';
  -- An update to an older row does not take over.
  update public.menu_items set category = 'edible-old-fix' where menu_version_id = v[3] and source_item_id = '__k2__';
  assert pg_temp.facts('__k2__') = pg_temp.rule_0305('__k2__'), 'k2 facts = 0305 rule after old-row update';

  -- Same created_at: the smaller id wins, as in 0305.
  insert into public.menu_items (id, menu_version_id, source_item_id, name, category, created_at)
    values ('ffffffff-ffff-4fff-8fff-ffffffffffff', v_staged, '__k7__', 'K7', 'big-id', t0),
           ('00000000-0000-4000-8000-000000000001', v_staged, '__k7__', 'K7', 'small-id', t0);
  assert (select category from public.product_latest_facts where source_item_id = '__k7__') = 'small-id', 'tie: smaller id';

  -- Blank keys are skipped.
  insert into public.menu_items (menu_version_id, source_item_id, name, category) values (v_staged, '', 'Blank', 'x');
  assert not exists (select 1 from public.product_latest_facts where source_item_id = ''), 'blank key skipped';

  -- latest_menu_facts reads the table.
  assert (select count(*) from public.latest_menu_facts(array['__k1__', '__k2__', '__nope__'])) = 2, 'keyed read';
  assert (select count(*) from public.latest_menu_facts(null) where source_item_id like '\_\_%') = 8, 'all keys';
  assert (select category from public.latest_menu_facts(array['__k1__'])) = 'flower-pub', 'keyed category';

  -- A clean-slate style delete of a key's newest row: the key falls back to its newest remaining row.
  delete from public.menu_items where menu_version_id = v_pub;
  assert (select category from public.product_latest_facts where source_item_id = '__k1__') = 'flower-10', 'delete falls back';
  assert pg_temp.facts('__k1__') = pg_temp.rule_0305('__k1__'), 'k1 facts = 0305 rule after delete';
  delete from public.menu_items where menu_version_id = v_staged and source_item_id = '__k7__';
  assert (select category from public.product_latest_facts where source_item_id = '__k7__') = 'small-id', 'no rows left: facts kept';
  insert into public.menu_items (menu_version_id, source_item_id, name, category, vendor_name, created_at)
    values (v_pub, '__k1__', 'K1', 'flower-pub', 'V', now() - interval '1 day');

  -- clean_slate_test_data deletes menu_versions rows; the items go by ON DELETE CASCADE and the
  -- facts still fall back (the delete trigger fires for the cascaded delete too).
  insert into public.menu_versions (status, created_at, updated_at, is_test) values ('staged', now(), now(), true)
    returning id into vid;
  insert into public.menu_items (menu_version_id, source_item_id, name, category) values (vid, '__k2__', 'K2', 'test-newest');
  assert (select category from public.product_latest_facts where source_item_id = '__k2__') = 'test-newest', 'test row newest';
  delete from public.menu_versions where id = vid;
  assert pg_temp.facts('__k2__') = pg_temp.rule_0305('__k2__'), 'k2 facts = 0305 rule after cascaded delete';
  assert (select category from public.product_latest_facts where source_item_id = '__k2__') = 'edible-fixed', 'cascade falls back';

  -- The prune: keep < 3 is refused.
  blocked := false;
  begin
    perform public.prune_menu_version_items(2, 10);
  exception when sqlstate '22023' then blocked := true;
  end;
  assert blocked, 'keep < 3 refused';

  -- Bounded: 2 per call. Prunable now = v[1]..v[7]: the newest 3 archived intake copies by
  -- created_at are v[8], v[9], v[10]; v_fresh is older but was archived under 10 minutes ago.
  j := public.prune_menu_version_items(3, 2);
  assert (j->>'versions')::int = 2, 'two per call: ' || j::text;
  assert (j->>'remaining')::int = 5, 'five remain (v3..v7): ' || j::text;
  assert not exists (select 1 from public.menu_items where menu_version_id in (v[1], v[2])), 'oldest two pruned';
  assert (select (summary_json->>'items_pruned')::int from public.menu_versions where id = v[1]) = 4, 'stamp counts rows (k1, k2, gone, old k2)';
  assert (select summary_json->>'origin' from public.menu_versions where id = v[1]) = 'intake', 'summary kept';
  assert exists (select 1 from public.menu_versions where id = v[1]), 'version row kept';

  loop
    j := public.prune_menu_version_items(3, 500);
    exit when (j->>'versions')::int = 0;
  end loop;
  assert (j->>'remaining')::int = 0, 'nothing left to prune';
  for i in 1..7 loop
    assert not exists (select 1 from public.menu_items where menu_version_id = v[i]), 'pruned v' || i;
  end loop;
  for i in 8..10 loop
    assert exists (select 1 from public.menu_items where menu_version_id = v[i]), 'kept newest v' || i;
  end loop;
  assert exists (select 1 from public.menu_items where menu_version_id = v_pub), 'published kept';
  assert exists (select 1 from public.menu_items where menu_version_id = v_staged), 'staged kept';
  assert exists (select 1 from public.menu_items where menu_version_id = v_imp), 'import-origin kept';
  assert exists (select 1 from public.menu_items where menu_version_id = v_test), 'test kept';
  assert exists (select 1 from public.menu_items where menu_version_id = v_fresh), 'archived < 10 min ago kept';
  assert not exists (select 1 from public.menu_variants mv join public.menu_items mi on mi.id = mv.menu_item_id
                      where mi.menu_version_id = v[1]), 'variants cascaded';
  select count(*) into n from public.menu_variants mv join public.menu_items mi on mi.id = mv.menu_item_id
   where mi.menu_version_id = any (v);
  assert n = 6, 'variants of the 3 kept copies remain: ' || n;

  -- Pruning never changed a fact: the key that only lived in the oldest copy still resolves.
  assert (select category from public.product_latest_facts where source_item_id = '__gone__') = 'preroll', 'gone key survives prune';
  assert (select vendor_name from public.latest_menu_facts(array['__gone__'])) = 'OldVendor', 'gone key via RPC';
  assert (select category from public.product_latest_facts where source_item_id = '__k1__') = 'flower-pub', 'k1 survives prune';
  assert current_setting('greenway.menu_prune', true) is distinct from 'on', 'prune flag cleared';

  -- Privileges.
  r := pg_temp.try_as('anon', 'select 1 from public.product_latest_facts limit 1');
  assert r = '42501', 'anon cannot read facts: ' || r;
  r := pg_temp.try_as('authenticated', 'select 1 from public.product_latest_facts limit 1');
  assert r = '42501', 'authenticated cannot read facts: ' || r;
  r := pg_temp.try_as('anon', 'select * from public.latest_menu_facts(null)');
  assert r = '42501', 'anon cannot run latest_menu_facts: ' || r;
  r := pg_temp.try_as('authenticated', 'select public.prune_menu_version_items(5, 1)');
  assert r = '42501', 'authenticated cannot prune: ' || r;
  r := pg_temp.try_as('service_role', 'select * from public.latest_menu_facts(array[''__k1__''])');
  assert r = 'ran', 'service_role reads facts: ' || r;
  r := pg_temp.try_as('service_role', 'select public.prune_menu_version_items(5, 1)');
  assert r = 'ran', 'service_role prunes: ' || r;
  r := pg_temp.try_as('service_role', 'update public.product_latest_facts set category = ''x''');
  assert r = '42501', 'service_role cannot write facts: ' || r;
  r := pg_temp.try_as('service_role', 'delete from public.product_latest_facts');
  assert r = '42501', 'service_role cannot delete facts: ' || r;
  assert not has_function_privilege('service_role', 'public.product_latest_facts_sync()', 'EXECUTE'), 'no direct sync';
  assert not has_function_privilege('anon', 'public.product_latest_facts_on_delete()', 'EXECUTE'), 'no direct on_delete';
  assert not has_function_privilege('authenticated', 'public.product_latest_facts_on_truncate()', 'EXECUTE'), 'no direct on_truncate';
  -- service_role writing menu_items still keeps the facts current (SECURITY DEFINER trigger).
  r := pg_temp.try_as('service_role', format($q$insert into public.menu_items (menu_version_id, source_item_id, name, category) values (%L, '__k8__', 'K8', 'sr-cat')$q$, v_staged));
  assert r = 'ran', 'service_role inserts menu items: ' || r;
  assert (select category from public.product_latest_facts where source_item_id = '__k8__') = 'sr-cat', 'trigger ran for service_role';
  assert (select prosecdef from pg_proc where oid = 'public.latest_menu_facts(text[])'::regprocedure) = false, 'latest_menu_facts invoker';
  assert (select prosecdef from pg_proc where oid = 'public.prune_menu_version_items(integer, integer)'::regprocedure) = false, 'prune invoker';
  assert (select relrowsecurity from pg_class where oid = 'public.product_latest_facts'::regclass), 'RLS on';

  -- The factory reset truncates menu_items: the facts go with them.
  truncate table public.menu_items cascade;
  assert (select count(*) from public.product_latest_facts) = 0, 'truncate empties facts';
end
$$;

\echo 'MENU COPY RETENTION 0344 CHECK PASSED'
rollback;
