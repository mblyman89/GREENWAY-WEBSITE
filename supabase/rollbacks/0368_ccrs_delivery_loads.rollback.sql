-- Rollback for 0368_ccrs_delivery_loads.sql (D250 slice 3).
-- Run MANUALLY only if needed. Drops the delivery-load history and the apply
-- function, and puts the ccrs-records bucket back to CSV/text only. Ledger
-- rows a load already wrote STAY (they are the State's record; their source
-- seed:<date>-delivery / proof:<date>-delivery-sale says where they came from).
drop function if exists public.ccrs_apply_delivery(uuid, integer, integer, jsonb, uuid, text);
drop table if exists public.ccrs_delivery_stage;
drop table if exists public.ccrs_delivery_loads;
do $m$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    execute 'update storage.buckets set allowed_mime_types = array[''text/csv'', ''text/plain''] where id = ''ccrs-records''';
  end if;
end
$m$;
