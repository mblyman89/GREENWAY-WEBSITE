-- scripts/recon/inventory-lot-menu-variant-0294-pg-check.sql  (R74 S30 - migration 0294)
--
-- Check for 0294_inventory_lot_menu_variant.sql on Postgres 15 with every
-- migration applied. One transaction, rolled back.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/inventory-lot-menu-variant-0294-pg-check.sql
--
-- "R74 0294 CHECK PASSED" then ROLLBACK = all clear.
begin;

do $$
declare
  def text;
  lot uuid;
  refused boolean;
begin
  -- 1. both columns exist, nullable text
  assert (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'inventory_lots' and column_name = 'menu_source_variant_id') = 'text',
    'inventory_lots.menu_source_variant_id is text';
  assert (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'inventory_lots' and column_name = 'menu_source_variant_id') = 'YES',
    'menu_source_variant_id is nullable (null = not linked)';
  assert (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'inventory_lots' and column_name = 'menu_source_variant_source') = 'text',
    'inventory_lots.menu_source_variant_source is text';

  -- 2. the partial index exists on the right column
  select indexdef into def from pg_indexes where schemaname = 'public' and indexname = 'inventory_lots_menu_source_variant_id_idx';
  assert def is not null, 'inventory_lots_menu_source_variant_id_idx exists';
  assert def like '%(menu_source_variant_id)%' and def like '%WHERE (menu_source_variant_id IS NOT NULL)%', 'partial index on menu_source_variant_id: ' || def;

  -- 3. the pair rule: both null, or an id with a known source
  insert into public.inventory_lots (product_name, received_qty, on_hand_qty, unit, status)
    values ('0294 check lot', 1, 1, 'each', 'active') returning id into lot;
  update public.inventory_lots set menu_source_variant_id = 'pos-abc-def', menu_source_variant_source = 'pos_import' where id = lot;
  update public.inventory_lots set menu_source_variant_source = 'owner' where id = lot;
  update public.inventory_lots set menu_source_variant_id = null, menu_source_variant_source = null where id = lot;

  refused := false;
  begin
    update public.inventory_lots set menu_source_variant_id = 'pos-abc-def', menu_source_variant_source = null where id = lot;
  exception when check_violation then refused := true;
  end;
  assert refused, 'an id without a source is refused';

  refused := false;
  begin
    update public.inventory_lots set menu_source_variant_id = 'pos-abc-def', menu_source_variant_source = 'guess' where id = lot;
  exception when check_violation then refused := true;
  end;
  assert refused, 'an unknown source is refused';

  refused := false;
  begin
    update public.inventory_lots set menu_source_variant_id = null, menu_source_variant_source = 'owner' where id = lot;
  exception when check_violation then refused := true;
  end;
  assert refused, 'a source without an id is refused';

  raise notice 'R74 0294 CHECK PASSED';
end $$;

rollback;
