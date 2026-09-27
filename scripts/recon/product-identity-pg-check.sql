-- scripts/recon/product-identity-pg-check.sql  (S04 — migration 0234)
--
-- Scenario check for 0234_product_identity.sql against a real Postgres that
-- has every migration applied (scripts/compliance/verify-migrations-execute.ts).
-- Runs in ONE transaction that is rolled back, so it leaves no rows behind.
-- Every `assert` raises on failure; a silent run followed by ROLLBACK is the
-- all-clear.
--
--   PATH=/usr/lib/postgresql/15/bin:$PATH psql \
--     'postgres://postgres@/greenway?host=/tmp/pgsock&port=5433' \
--     -v ON_ERROR_STOP=1 -f scripts/recon/product-identity-pg-check.sql
begin;

do $$
declare
  v_vendor uuid;
  v_brand  uuid;
  v_kb     uuid;
  v_lot    uuid;
  v_draft  uuid;
  v_ver    uuid;
  v_item   uuid;
  v_enr    uuid;
  n        int;
  plan     text;
  r        record;
begin
  -- 1. Every column exists, is nullable, and has NO default (catalog-only add,
  --    and "not stamped" stays distinguishable from any value).
  for r in
    select * from (values
      ('catalog_product_drafts','identity_key','text'),
      ('catalog_product_drafts','kb_product_id','uuid'),
      ('catalog_product_drafts','brand_id','uuid'),
      ('catalog_product_drafts','vendor_id','uuid'),
      ('catalog_product_drafts','lot_code','text'),
      ('catalog_product_drafts','sku','text'),
      ('catalog_product_drafts','strain_type','text'),
      ('catalog_product_drafts','restock_of_card_key','text'),
      ('inventory_lots','identity_key','text'),
      ('inventory_lots','kb_product_id','uuid'),
      ('menu_items','identity_key','text'),
      ('menu_items','kb_product_id','uuid'),
      ('product_enrichments','identity_key','text'),
      ('product_enrichments','kb_product_id','uuid'),
      ('product_enrichments','first_manifest_id','uuid'),
      ('product_enrichments','last_manifest_id','uuid'),
      ('product_enrichments','last_received_at','timestamp with time zone'),
      ('kb_products','identity_key','text')
    ) as t(tbl, col, typ)
  loop
    select count(*) into n from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = r.tbl and c.column_name = r.col
       and c.data_type = r.typ and c.is_nullable = 'YES' and c.column_default is null;
    assert n = 1, format('%s.%s must exist as nullable %s with no default', r.tbl, r.col, r.typ);
  end loop;

  -- 2. Foreign keys: exactly where intended, with ON DELETE SET NULL.
  for r in
    select * from (values
      ('catalog_product_drafts','kb_product_id','kb_products'),
      ('catalog_product_drafts','brand_id','brands'),
      ('catalog_product_drafts','vendor_id','vendors'),
      ('inventory_lots','kb_product_id','kb_products')
    ) as t(tbl, col, parent)
  loop
    select count(*) into n
      from pg_constraint k
      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey)
     where k.contype = 'f' and k.conrelid = ('public.' || r.tbl)::regclass
       and a.attname = r.col and k.confrelid = ('public.' || r.parent)::regclass
       and k.confdeltype = 'n';
    assert n = 1, format('%s.%s must reference %s ON DELETE SET NULL', r.tbl, r.col, r.parent);
  end loop;
  --    ...and deliberately NOT on the snapshot / kept-table columns.
  for r in
    select * from (values
      ('menu_items','kb_product_id'),
      ('product_enrichments','kb_product_id'),
      ('product_enrichments','first_manifest_id'),
      ('product_enrichments','last_manifest_id')
    ) as t(tbl, col)
  loop
    select count(*) into n
      from pg_constraint k
      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey)
     where k.contype = 'f' and k.conrelid = ('public.' || r.tbl)::regclass and a.attname = r.col;
    assert n = 0, format('%s.%s must have NO foreign key', r.tbl, r.col);
  end loop;

  -- 3. Indexes: present, partial on NOT NULL, and none of them UNIQUE (the
  --    identity carries no size, so two sizes legitimately share it).
  for r in
    select * from (values
      ('idx_cpd_identity','identity_key'),
      ('idx_cpd_kb_product','kb_product_id'),
      ('idx_inventory_lots_identity','identity_key'),
      ('idx_inventory_lots_kb_product','kb_product_id'),
      ('idx_menu_items_identity','identity_key'),
      ('idx_prod_enrich_identity','identity_key'),
      ('idx_kb_products_identity','identity_key')
    ) as t(idx, col)
  loop
    select count(*) into n from pg_indexes i
     where i.schemaname = 'public' and i.indexname = r.idx
       and i.indexdef ilike format('%%WHERE (%s IS NOT NULL)%%', r.col)
       and i.indexdef not ilike 'CREATE UNIQUE%';
    assert n = 1, format('%s must be a non-unique partial index WHERE %s IS NOT NULL', r.idx, r.col);
  end loop;
  select count(*) into n from pg_indexes
   where schemaname = 'public' and indexname = 'idx_menu_items_identity'
     and indexdef ilike '%(menu_version_id, identity_key)%';
  assert n = 1, 'menu_items identity index is version-scoped (menu_version_id, identity_key)';

  -- 4. Doctrine is in the catalog, not only in the file.
  select count(*) into n
    from pg_description d
    join pg_attribute a on a.attrelid = d.objoid and a.attnum = d.objsubid
   where a.attname = 'identity_key'
     and d.objoid in ('public.catalog_product_drafts'::regclass, 'public.inventory_lots'::regclass,
                      'public.menu_items'::regclass, 'public.product_enrichments'::regclass,
                      'public.kb_products'::regclass)
     and d.description ilike '%NEVER a wildcard%';
  assert n = 5, 'all five identity_key comments state NEVER a wildcard';
  select count(*) into n
    from pg_description d
    join pg_attribute a on a.attrelid = d.objoid and a.attnum = d.objsubid
   where a.attname = 'identity_key' and d.description ilike '%ADDITIVE%';
  assert n = 5, 'all five identity_key comments state the key is ADDITIVE';
  assert col_description('public.catalog_product_drafts'::regclass,
           (select attnum from pg_attribute where attrelid = 'public.catalog_product_drafts'::regclass and attname = 'restock_of_card_key'))
         ilike '%never suppresses%', 'restock hint comment says it never suppresses the draft';

  -- 5. Behaviour: a realistic row set.
  insert into public.vendors (display_name, slug) values ('Releaf Test Co', 'releaf-test-co-0234') returning id into v_vendor;
  insert into public.brands  (display_name, slug) values ('Releaf Test',    'releaf-test-0234')    returning id into v_brand;
  insert into public.kb_products (brand_slug, product_slug, variant_label, display_name, identity_key)
    values ('releaf-test', 'suppository', '', 'Releaf Test Suppository', 'releaf test co|topical|suppository')
    returning id into v_kb;
  insert into public.inventory_lots (lot_code, vendor_id, brand_id, pos_product_key, product_name, identity_key, kb_product_id)
    values ('LOT-0234', v_vendor, v_brand, 'LOT-0234', 'Releaf Test Suppository 6pk',
            'releaf test co|topical|suppository', v_kb)
    returning id into v_lot;
  insert into public.catalog_product_drafts
    (pos_product_key, source_item_id, name, lot_id, identity_key, kb_product_id, brand_id, vendor_id,
     lot_code, sku, strain_type, restock_of_card_key, status)
    values ('LOT-0234', 'LOT-0234', 'Releaf Test Suppository 6pk', v_lot, 'releaf test co|topical|suppository',
            v_kb, v_brand, v_vendor, 'LOT-0234', null, null, 'CARD-LIVE-1', 'draft')
    returning id into v_draft;
  insert into public.menu_versions (status) values ('staged') returning id into v_ver;
  -- No FK: an unknown kb id is accepted on the snapshot table.
  insert into public.menu_items (menu_version_id, source_item_id, name, category, identity_key, kb_product_id)
    values (v_ver, 'CARD-LIVE-1', 'Releaf Test Suppository', 'topical',
            'releaf test co|topical|suppository', gen_random_uuid())
    returning id into v_item;
  -- No FK: a manifest id that does not exist is accepted (provenance stamp).
  insert into public.product_enrichments (pos_product_key, identity_key, kb_product_id, first_manifest_id, last_manifest_id, last_received_at)
    values ('LOT-0234-ENR', 'releaf test co|topical|suppository', v_kb, gen_random_uuid(), gen_random_uuid(), now())
    returning id into v_enr;

  -- 5a. The identity lookup returns every row type for one product.
  assert (select count(*) from public.inventory_lots where identity_key = 'releaf test co|topical|suppository') = 1, 'lot by identity';
  assert (select count(*) from public.catalog_product_drafts where identity_key = 'releaf test co|topical|suppository') = 1, 'draft by identity';
  assert (select count(*) from public.menu_items where menu_version_id = v_ver and identity_key = 'releaf test co|topical|suppository') = 1, 'card by identity';

  -- 5b. NOT unique: a second size of the same product shares the identity.
  insert into public.kb_products (brand_slug, product_slug, variant_label, display_name, identity_key)
    values ('releaf-test', 'suppository', '12 pk', 'Releaf Test Suppository 12pk', 'releaf test co|topical|suppository');
  assert (select count(*) from public.kb_products where identity_key = 'releaf test co|topical|suppository') = 2, 'two sizes share one identity';

  -- 5c. NULL identity is allowed and never matches anything (not a wildcard).
  insert into public.inventory_lots (lot_code, pos_product_key, product_name) values ('LOT-0234-NULL', 'LOT-0234-NULL', 'Mystery');
  assert (select count(*) from public.inventory_lots l1 join public.inventory_lots l2
           on l1.identity_key = l2.identity_key
          where l1.lot_code = 'LOT-0234-NULL') = 0, 'NULL identity joins to nothing';

  -- 5d. pos_product_key untouched (additive doctrine).
  assert (select pos_product_key from public.catalog_product_drafts where id = v_draft) = 'LOT-0234', 'pos_product_key unchanged';

  -- 5e. ON DELETE SET NULL: removing the golden record unlinks, never deletes.
  delete from public.kb_products where id = v_kb;
  assert (select kb_product_id from public.catalog_product_drafts where id = v_draft) is null, 'draft kb link nulled';
  assert (select kb_product_id from public.inventory_lots where id = v_lot) is null, 'lot kb link nulled';
  assert (select count(*) from public.catalog_product_drafts where id = v_draft) = 1, 'draft survives kb delete';
  assert (select identity_key from public.inventory_lots where id = v_lot) = 'releaf test co|topical|suppository', 'identity survives kb delete';

  -- 5f. The open-draft partial unique index (0026) is unaffected: a second
  --     OPEN draft for the same pos key still collides, a same-IDENTITY draft
  --     with a different pos key does not.
  begin
    insert into public.catalog_product_drafts (pos_product_key, name, status) values ('LOT-0234', 'dup', 'draft');
    assert false, 'second open draft for one pos key must still be rejected';
  exception when unique_violation then null;
  end;
  insert into public.catalog_product_drafts (pos_product_key, name, status, identity_key)
    values ('LOT-0234-B', 'Releaf Test Suppository 12pk', 'draft', 'releaf test co|topical|suppository');

  -- 6. The planner can use the identity indexes (seqscan disabled so a tiny
  --    table does not hide an unusable index).
  set local enable_seqscan = off;
  execute 'explain select id from public.catalog_product_drafts where identity_key = ''x''' into plan;
  assert plan ilike '%idx_cpd_identity%', 'drafts identity lookup uses idx_cpd_identity: ' || plan;
  execute 'explain select id from public.inventory_lots where identity_key = ''x''' into plan;
  assert plan ilike '%idx_inventory_lots_identity%', 'lots identity lookup uses its index: ' || plan;
  execute format('explain select id from public.menu_items where menu_version_id = %L and identity_key = ''x''', v_ver) into plan;
  assert plan ilike '%idx_menu_items_identity%', 'menu identity lookup uses its index: ' || plan;
  execute 'explain select id from public.product_enrichments where identity_key = ''x''' into plan;
  assert plan ilike '%idx_prod_enrich_identity%', 'enrichment identity lookup uses its index: ' || plan;
  execute 'explain select id from public.kb_products where identity_key = ''x''' into plan;
  assert plan ilike '%idx_kb_products_identity%', 'kb identity lookup uses its index: ' || plan;

  raise notice 'product-identity-pg-check: all scenarios passed';
end
$$;

rollback;
