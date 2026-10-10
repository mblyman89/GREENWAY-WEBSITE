-- R37 S5 - 0257_delivery_brand.sql scenario check (Postgres 15).
-- Run after every migration is applied:  psql -d greenway -v ON_ERROR_STOP=1 -f scripts/r37/delivery-brand-pg-check.sql
-- Proves: both columns exist as uuid FKs to brands; deleting a brand nulls
-- them (never deletes the vendor/delivery); a bogus id is refused; indexes
-- exist; rollback drops exactly them; re-apply restores them.
begin;
do $$
declare v uuid; b uuid; m uuid; n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema='public' and table_name='vendors' and column_name='default_brand_id' and data_type='uuid';
  if n <> 1 then raise exception 'vendors.default_brand_id missing or not uuid'; end if;
  select count(*) into n from information_schema.columns
   where table_schema='public' and table_name='inbound_manifests' and column_name='brand_id' and data_type='uuid';
  if n <> 1 then raise exception 'inbound_manifests.brand_id missing or not uuid'; end if;
  select count(*) into n from pg_indexes where schemaname='public' and indexname in ('vendors_default_brand_idx','inbound_manifests_brand_idx');
  if n <> 2 then raise exception 'indexes missing (%)', n; end if;

  insert into public.vendors (display_name, slug) values ('R37 Check Vendor', 'r37-check-vendor') returning id into v;
  insert into public.brands (display_name, slug, vendor_id) values ('R37 Check Brand', 'r37-check-brand', v) returning id into b;
  update public.vendors set default_brand_id = b where id = v;
  insert into public.inbound_manifests (manifest_number, vendor_id, status, brand_id) values ('R37-CHK-1', v, 'pending', b) returning id into m;

  begin
    update public.vendors set default_brand_id = gen_random_uuid() where id = v;
    raise exception 'bogus brand id accepted on vendors';
  exception when foreign_key_violation then null;
  end;
  begin
    update public.inbound_manifests set brand_id = gen_random_uuid() where id = m;
    raise exception 'bogus brand id accepted on inbound_manifests';
  exception when foreign_key_violation then null;
  end;

  delete from public.brands where id = b;
  select count(*) into n from public.vendors where id = v and default_brand_id is null;
  if n <> 1 then raise exception 'brand delete did not null vendors.default_brand_id (or deleted the vendor)'; end if;
  select count(*) into n from public.inbound_manifests where id = m and brand_id is null;
  if n <> 1 then raise exception 'brand delete did not null inbound_manifests.brand_id (or deleted the delivery)'; end if;
end $$;
rollback;

-- Rollback drops exactly the two columns; re-apply restores them.
begin;
\i supabase/rollbacks/0257_delivery_brand.rollback.sql
do $$ declare n int; begin
  select count(*) into n from information_schema.columns
   where table_schema='public' and ((table_name='vendors' and column_name='default_brand_id') or (table_name='inbound_manifests' and column_name='brand_id'));
  if n <> 0 then raise exception 'rollback left % column(s)', n; end if;
  select count(*) into n from information_schema.columns where table_schema='public' and table_name='vendors' and column_name='display_name';
  if n <> 1 then raise exception 'rollback dropped too much'; end if;
end $$;
\i supabase/migrations/0257_delivery_brand.sql
do $$ declare n int; begin
  select count(*) into n from information_schema.columns
   where table_schema='public' and ((table_name='vendors' and column_name='default_brand_id') or (table_name='inbound_manifests' and column_name='brand_id'));
  if n <> 2 then raise exception 're-apply restored % of 2 columns', n; end if;
end $$;
rollback;
select 'DELIVERY BRAND PG CHECK PASSED' as result;
