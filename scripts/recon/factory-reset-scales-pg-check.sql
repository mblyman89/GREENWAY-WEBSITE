-- scripts/recon/factory-reset-scales-pg-check.sql  (D-82 - migration 0240)
--
-- Scenario check for 0240_factory_reset_scales.sql against a real Postgres 15
-- that has every migration applied. Runs in ONE transaction that is rolled
-- back, so it leaves no rows behind. A run that prints
-- "FACTORY RESET SCALES CHECK PASSED" and then ROLLBACK is the all-clear.
--
--   psql -h localhost -U postgres -d greenway -v ON_ERROR_STOP=1 \
--     -f scripts/recon/factory-reset-scales-pg-check.sql
--
-- Part 1  fixture: an owner, 2000 customers, 40000 completed orders with lines
--         and events, 500000 CCRS discovery rows, a kept Plaid connection with
--         a cursor. The same shape as the owner database, larger than it.
-- Part 2  every refusal still happens BEFORE anything is emptied: wrong
--         phrase, missing retention attestation, not the owner.
-- Part 3  the preflight refuses, by name, with nothing emptied: a kept table
--         with a foreign key into a WIPE table, and a WIPE table that is gone.
-- Part 4  THE FIX: the reset runs as role authenticated under the 8 second
--         statement timeout Supabase gives that role, and succeeds. Every
--         WIPE table is empty, every count reported is exact, kept tables
--         survive, the cursor is rewound, one audit row is written, the post
--         reset audit is clean and the door is closed again.
-- Part 5  the guards still refuse outside a reset.
-- Part 6  the rollback file brings back the 0209 engine, which is canceled by
--         the same 8 second limit on the same data (the D-82 defect), and
--         re-applying 0240 twice restores the fix.
begin;

-- Part 1 ---------------------------------------------------------------------
insert into auth.users (id, email)
  values ('00000000-0000-4000-8000-0000000d8201', 'owner-d82@example.com');
update public.staff_profiles set role = 'owner', active = true, full_name = 'D82 Owner'
  where id = '00000000-0000-4000-8000-0000000d8201';
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000d8201', true);

insert into public.customers (id, first_name, marketing_consent, do_not_contact, is_medical_patient,
                              visit_count, lifetime_spend_minor_units, imported_spend_minor_units)
  select gen_random_uuid(), 'D82C' || g, false, false, false, 0, 0, 0
  from generate_series(1, 2000) g;

create temporary table d82_customers as
  select id, row_number() over (order by id) as rn
  from public.customers where first_name like 'D82C%';

insert into public.orders (id, order_number, status, customer_first_name, subtotal_minor_units,
                           estimated_tax_minor_units, savings_minor_units, total_minor_units, item_count,
                           placed_at, limit_flag, limit_reasons, loyalty_discount_minor_units, origin, customer_id)
  select gen_random_uuid(), 'D82-' || g, 'completed', 'C', 1000, 370, 0, 1370, 1, now(), false, '[]', 0,
         'register', c.id
  from generate_series(1, 40000) g
  join d82_customers c on c.rn = 1 + (g % 2000);

insert into public.order_lines (order_id, product_name, quantity, price_minor_units, loyalty_discount_minor_units)
  select o.id, 'P', 1, 1000, 0 from public.orders o where o.order_number like 'D82-%';
insert into public.order_events (order_id, event_type)
  select o.id, 'created' from public.orders o where o.order_number like 'D82-%';

insert into public.discovery_datasets (id, label, status, ingest_kind)
  values ('00000000-0000-4000-8000-0000000d82dd', 'D82 dataset', 'ready', 'csv');
insert into public.discovery_ccrs_sales
  (dataset_id, seller_license, buyer_license, sale_type, sale_date, quantity_num,
   unit_price_minor, discount_minor, sales_tax_minor, other_tax_minor,
   inventory_ext_id, sale_ext_id, product_category, product_type, product_name, brand,
   unit_weight_grams, price_per_gram_minor)
  select '00000000-0000-4000-8000-0000000d82dd', 'LIC' || (g % 900), 'BUY' || (g % 2000), 'other',
         date '2026-01-01' + (g % 200), 1, 1000, 0, 0, 0, 'INV' || g, 'SALE' || g,
         'cat', 'type', 'product ' || g, 'brand', 1.0, 1000
  from generate_series(1, 500000) g;

insert into public.plaid_items (item_id, access_token, transactions_cursor, last_successful_sync)
  values ('d82-item', 'enc-token', 'cursor-abc', now());

analyze public.orders;
analyze public.discovery_ccrs_sales;

create temporary table d82_before as
  select (select count(*) from public.orders) as orders,
         (select count(*) from public.order_lines) as order_lines,
         (select count(*) from public.customers) as customers,
         (select count(*) from public.discovery_ccrs_sales) as ccrs_sales,
         (select count(*) from public.gl_accounts) as gl_accounts,
         (select count(*) from public.gl_entities) as gl_entities,
         (select count(*) from public.plaid_items) as plaid_items,
         (select count(*) from public.staff_profiles) as staff_profiles,
         (select count(*) from public.audit_logs where action = 'ops.factory_reset') as reset_audits;

do $p1$
begin
  assert public.is_owner(), 'part1: is_owner() must be true or the reset below is vacuous';
  assert (select orders from d82_before) >= 40000, 'part1: 40000 orders loaded';
  assert (select ccrs_sales from d82_before) >= 500000, 'part1: CCRS rows loaded';
  assert (select proconfig from pg_proc where oid = 'public.gl_factory_reset(text, boolean)'::regprocedure)
         @> array['statement_timeout=55s', 'lock_timeout=20s'],
    'part1: 0240 time limits are on the function';
  assert (public.gl_factory_reset_preview()->>'reset_engine') = 'truncate-0240', 'part1: preview reports the 0240 engine';
end
$p1$;

-- Part 2 ---------------------------------------------------------------------
do $p2$
begin
  begin
    perform public.gl_factory_reset('erase all test data', true);
    raise exception 'part2: a lower-case phrase was accepted';
  exception when raise_exception then
    assert sqlerrm like 'RESET_BAD_CONFIRMATION:%', 'part2: phrase refused by name, got ' || sqlerrm;
  end;
  begin
    perform public.gl_factory_reset('ERASE ALL TEST DATA', false);
    raise exception 'part2: reset ran without the retention attestation';
  exception when raise_exception then
    assert sqlerrm like 'RETENTION GUARD (WAC 314-55-087(1))%', 'part2: retention refused by name, got ' || sqlerrm;
  end;
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000d8ff', true);
  begin
    perform public.gl_factory_reset('ERASE ALL TEST DATA', true);
    raise exception 'part2: a non-owner ran the reset';
  exception when raise_exception then
    assert sqlerrm like 'RESET_NOT_OWNER:%', 'part2: non-owner refused by name, got ' || sqlerrm;
  end;
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000d8201', true);
  assert (select count(*) from public.orders) = (select orders from d82_before), 'part2: nothing emptied';
  assert (select count(*) from public.discovery_ccrs_sales) = (select ccrs_sales from d82_before), 'part2: nothing emptied';
end
$p2$;

-- Part 3 ---------------------------------------------------------------------
do $p3$
begin
  begin
    create table public.d82_kept_probe (order_id uuid references public.orders(id));
    perform public.gl_factory_reset('ERASE ALL TEST DATA', true);
    raise exception 'part3: reset ran with a kept table pointing at orders';
  exception when raise_exception then
    assert sqlerrm like 'RESET_KEPT_TABLE_POINTS_AT_WIPE:%d82_kept_probe%', 'part3: FK refused by name, got ' || sqlerrm;
  end;
  begin
    alter table public.ai_usage rename to d82_ai_usage_moved;
    perform public.gl_factory_reset('ERASE ALL TEST DATA', true);
    raise exception 'part3: reset ran with a WIPE table missing';
  exception when raise_exception then
    assert sqlerrm like 'RESET_SCHEMA_DRIFT:%ai_usage%', 'part3: drift refused by name, got ' || sqlerrm;
  end;
  assert to_regclass('public.d82_kept_probe') is null, 'part3: probe table rolled back';
  assert to_regclass('public.ai_usage') is not null, 'part3: rename rolled back';
  assert (select count(*) from public.orders) = (select orders from d82_before), 'part3: nothing emptied';
  assert not public.gl_factory_reset_active(), 'part3: door closed after a refusal';
end
$p3$;

-- Part 4 ---------------------------------------------------------------------
-- Exactly what the reset button does: role authenticated, 8 second limit.
-- The limit here is armed on the statement itself, so this passes without
-- relying on the API honouring the function level 55s.
set local role authenticated;
set local statement_timeout = '8s';
select set_config('d82.result', public.gl_factory_reset('ERASE ALL TEST DATA', true)::text, true);
select set_config('d82.problems', (select count(*) from public.gl_audit_factory_reset())::text, true);
reset role;
set local statement_timeout = 0;

do $p4$
declare
  r jsonb := current_setting('d82.result')::jsonb;
  t text;
  n bigint;
begin
  assert (r->>'ok')::boolean, 'part4: reset ok, got ' || r::text;
  assert r->>'reset_engine' = 'truncate-0240', 'part4: engine reported';
  assert (r->>'tables_emptied')::int = 139, 'part4: 139 tables reported, got ' || (r->>'tables_emptied');
  assert (r->'tables'->>'orders')::bigint = (select orders from d82_before), 'part4: exact orders count';
  assert (r->'tables'->>'order_lines')::bigint = (select order_lines from d82_before), 'part4: exact lines count';
  assert (r->'tables'->>'customers')::bigint = (select customers from d82_before), 'part4: exact customers count';
  assert (r->'tables'->>'discovery_ccrs_sales')::bigint = (select ccrs_sales from d82_before), 'part4: exact CCRS count';
  assert (r->>'total_rows_deleted')::bigint
         = (select sum(value::bigint) from jsonb_each_text(r->'tables')), 'part4: total adds up';

  for t in select key from jsonb_each_text(r->'tables') loop
    execute format('select count(*) from public.%I', t) into n;
    assert n = 0, 'part4: ' || t || ' still has ' || n || ' row(s)';
  end loop;

  assert (select count(*) from public.gl_accounts) = (select gl_accounts from d82_before), 'part4: chart of accounts KEPT';
  assert (select count(*) from public.gl_entities) = (select gl_entities from d82_before), 'part4: entities KEPT';
  assert (select count(*) from public.staff_profiles) = (select staff_profiles from d82_before), 'part4: people KEPT';
  assert (select count(*) from public.plaid_items) = (select plaid_items from d82_before), 'part4: bank link KEPT';
  assert (select transactions_cursor from public.plaid_items where item_id = 'd82-item') is null, 'part4: cursor rewound';
  assert (select count(*) from public.audit_logs where action = 'ops.factory_reset')
         = (select reset_audits from d82_before) + 1, 'part4: exactly one audit row';
  assert current_setting('d82.problems') = '0', 'part4: post reset audit clean, problems ' || current_setting('d82.problems');
  assert not public.gl_factory_reset_active(), 'part4: door closed after the reset';
end
$p4$;

-- Part 5 ---------------------------------------------------------------------
do $p5$
begin
  insert into public.gl_override_log (entity_id, override_kind, amount_cents, threshold_cents, actor, reason)
    values ((select id from public.gl_entities where code = 'greenway'), 'self_approval', 1, 1,
            auth.uid(), 'post reset probe row');
  begin
    delete from public.gl_override_log;
    raise exception 'part5: override log DELETE accepted after the reset';
  exception when raise_exception then
    assert sqlerrm like 'GL_OVERRIDE_LOG_APPEND_ONLY:%', 'part5: refused by name, got ' || sqlerrm;
  end;
end
$p5$;

-- Part 6 ---------------------------------------------------------------------
-- Refill (60000 orders), then the 0209 engine under the same 8 second limit.
insert into public.customers (id, first_name, marketing_consent, do_not_contact, is_medical_patient,
                              visit_count, lifetime_spend_minor_units, imported_spend_minor_units)
  select gen_random_uuid(), 'D82D' || g, false, false, false, 0, 0, 0
  from generate_series(1, 2000) g;
truncate d82_customers;
insert into d82_customers
  select id, row_number() over (order by id) from public.customers where first_name like 'D82D%';
insert into public.orders (id, order_number, status, customer_first_name, subtotal_minor_units,
                           estimated_tax_minor_units, savings_minor_units, total_minor_units, item_count,
                           placed_at, limit_flag, limit_reasons, loyalty_discount_minor_units, origin, customer_id)
  select gen_random_uuid(), 'D82B-' || g, 'completed', 'C', 1000, 370, 0, 1370, 1, now(), false, '[]', 0,
         'register', c.id
  from generate_series(1, 60000) g
  join d82_customers c on c.rn = 1 + (g % 2000);
analyze public.orders;

\ir ../../supabase/rollbacks/0240_factory_reset_scales.rollback.sql

do $p6a$
begin
  assert (select proconfig from pg_proc where oid = 'public.gl_factory_reset(text, boolean)'::regprocedure)
         = array['search_path=public'], 'part6: rollback removed the time limits';
  assert (public.gl_factory_reset_preview() ? 'reset_engine') = false, 'part6: rollback restored the 0209 preview';
end
$p6a$;

-- The timer must be armed at top level (a SET inside a DO block does not arm
-- it), so the expected failure is caught with a savepoint and psql SQLSTATE.
savepoint d82_old_engine;
set local role authenticated;
set local statement_timeout = '8s';
\set ON_ERROR_STOP 0
select public.gl_factory_reset('ERASE ALL TEST DATA', true);
\set old_engine_state :SQLSTATE
\set ON_ERROR_STOP 1
rollback to savepoint d82_old_engine;
reset role;
select set_config('d82.old_engine_state', :'old_engine_state', true);
do $p6c$
begin
  assert current_setting('d82.old_engine_state') = '57014',
    'part6: the 0209 engine must be canceled by the 8s limit (57014), got ' || current_setting('d82.old_engine_state');
end
$p6c$;
set local statement_timeout = 0;

\ir ../../supabase/migrations/0240_factory_reset_scales.sql
\ir ../../supabase/migrations/0240_factory_reset_scales.sql

set local role authenticated;
set local statement_timeout = '8s';
select set_config('d82.result', public.gl_factory_reset('ERASE ALL TEST DATA', true)::text, true);
reset role;
set local statement_timeout = 0;

do $p6b$
declare
  r jsonb := current_setting('d82.result')::jsonb;
begin
  assert (r->>'ok')::boolean and r->>'reset_engine' = 'truncate-0240', 'part6: 0240 re-applied twice and works';
  assert (r->'tables'->>'orders')::bigint = 60000, 'part6: exact count again';
  assert (select count(*) from public.orders) = 0, 'part6: orders empty';
end
$p6b$;

select 'FACTORY RESET SCALES CHECK PASSED' as result;
rollback;
