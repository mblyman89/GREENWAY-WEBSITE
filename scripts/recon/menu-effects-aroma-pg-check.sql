-- scripts/recon/menu-effects-aroma-pg-check.sql  (R35 #6 - migration 0254)
--
-- Scenario check for 0254_menu_item_effects_aroma.sql against a REAL Postgres
-- with every migration 0001..0254 applied. ONE transaction, rolled back.
--
-- Rolls back to a clean slate, applies 0254 TWICE (idempotency), asserts every
-- accepted and refused shape, applies the ROLLBACK and asserts the columns and
-- checks are gone, then re-applies 0254. A run that prints
-- MENU EFFECTS AROMA CHECK PASSED then ROLLBACK is the all-clear.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/menu-effects-aroma-pg-check.sql
begin;

\ir ../../supabase/rollbacks/0254_menu_item_effects_aroma.rollback.sql
\ir ../../supabase/migrations/0254_menu_item_effects_aroma.sql
\ir ../../supabase/migrations/0254_menu_item_effects_aroma.sql

do $$
declare
  v uuid;
  i uuid;
  n int;
  refused boolean;
  bad text[];
  bads text[][] := array[]::text[][];
  shape text;
begin
  -- Both columns exist, nullable text[].
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'menu_items'
     and column_name in ('effects', 'aroma_notes') and data_type = 'ARRAY' and is_nullable = 'YES';
  if n <> 2 then raise exception 'expected 2 nullable array columns, got %', n; end if;

  select count(*) into n from pg_constraint
   where conrelid = 'public.menu_items'::regclass
     and conname in ('menu_items_effects_shape_chk', 'menu_items_aroma_notes_shape_chk');
  if n <> 2 then raise exception 'expected 2 shape checks, got %', n; end if;

  insert into public.menu_versions (status) values ('staged') returning id into v;

  -- Accepted: NULL, one entry, eight entries.
  insert into public.menu_items (menu_version_id, source_item_id, name, brand_name, category, strain_type, price_minor_units, inventory_status)
    values (v, 'R35-NULL', 'n', 'b', 'flower', 'unknown', 100, 'in-stock') returning id into i;
  if (select effects from public.menu_items where id = i) is not null then raise exception 'default must be NULL (effects)'; end if;
  if (select aroma_notes from public.menu_items where id = i) is not null then raise exception 'default must be NULL (aroma)'; end if;

  insert into public.menu_items (menu_version_id, source_item_id, name, brand_name, category, strain_type, price_minor_units, inventory_status, effects, aroma_notes)
    values (v, 'R35-ONE', 'n', 'b', 'flower', 'unknown', 100, 'in-stock', array['relaxed'], array['citrus']);
  insert into public.menu_items (menu_version_id, source_item_id, name, brand_name, category, strain_type, price_minor_units, inventory_status, effects, aroma_notes)
    values (v, 'R35-EIGHT', 'n', 'b', 'flower', 'unknown', 100, 'in-stock',
            array['a','b','c','d','e','f','g','h'], array['a','b','c','d','e','f','g','h']);

  -- Refused, per column: empty list, nine entries, a NULL element.
  foreach shape in array array['empty', 'nine', 'nullelem'] loop
    bad := case shape
      when 'empty' then array[]::text[]
      when 'nine' then array['a','b','c','d','e','f','g','h','i']
      else array['a', null]
    end;
    refused := false;
    begin
      insert into public.menu_items (menu_version_id, source_item_id, name, brand_name, category, strain_type, price_minor_units, inventory_status, effects)
        values (v, 'R35-BAD-E-' || shape, 'n', 'b', 'flower', 'unknown', 100, 'in-stock', bad);
    exception when check_violation then refused := true;
    end;
    if not refused then raise exception 'effects % was accepted', shape; end if;
    refused := false;
    begin
      insert into public.menu_items (menu_version_id, source_item_id, name, brand_name, category, strain_type, price_minor_units, inventory_status, aroma_notes)
        values (v, 'R35-BAD-A-' || shape, 'n', 'b', 'flower', 'unknown', 100, 'in-stock', bad);
    exception when check_violation then refused := true;
    end;
    if not refused then raise exception 'aroma_notes % was accepted', shape; end if;
  end loop;

  -- An UPDATE is held to the same rule.
  refused := false;
  begin
    update public.menu_items set effects = array[]::text[] where id = i;
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'update to an empty effects list was accepted'; end if;

  -- Fill-only update pattern the backfill uses: only a NULL is filled.
  update public.menu_items set effects = array['calm'] where menu_version_id = v and effects is null;
  if (select effects from public.menu_items where source_item_id = 'R35-ONE' and menu_version_id = v) <> array['relaxed'] then
    raise exception 'fill-only update overwrote an existing list';
  end if;
  if (select effects from public.menu_items where id = i) <> array['calm'] then
    raise exception 'fill-only update did not fill the NULL';
  end if;
  raise notice 'shape checks ok';
end $$;

-- Rollback removes both columns and both checks.
\ir ../../supabase/rollbacks/0254_menu_item_effects_aroma.rollback.sql
do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'menu_items' and column_name in ('effects', 'aroma_notes');
  if n <> 0 then raise exception 'rollback left % column(s)', n; end if;
  select count(*) into n from pg_constraint
   where conrelid = 'public.menu_items'::regclass
     and conname in ('menu_items_effects_shape_chk', 'menu_items_aroma_notes_shape_chk');
  if n <> 0 then raise exception 'rollback left % check(s)', n; end if;
  raise notice 'rollback ok';
end $$;

-- Re-apply after the rollback.
\ir ../../supabase/migrations/0254_menu_item_effects_aroma.sql
do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'menu_items' and column_name in ('effects', 'aroma_notes');
  if n <> 2 then raise exception 're-apply gave % column(s)', n; end if;
  raise notice 'MENU EFFECTS AROMA CHECK PASSED';
end $$;

