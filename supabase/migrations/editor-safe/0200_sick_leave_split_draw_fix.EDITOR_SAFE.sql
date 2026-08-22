do $precheck$begin
  if to_regclass('public.sick_leave_ledger') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0200 repairs an index on public.sick_leave_ledger, which does not exist yet. Run 0198_sick_leave_and_garnishments.sql first, then run this file again. Nothing was changed.';
  end if;
end
$precheck$;

drop index if exists public.sick_leave_ledger_one_usage_per_request;

create unique index if not exists sick_leave_ledger_one_usage_per_request
  on public.sick_leave_ledger (request_id, drawn_from)
  where entry_kind = 'usage';

comment on index public.sick_leave_ledger_one_usage_per_request is
  'ONE USAGE ROW PER REQUEST PER BUCKET. A single approved sick day may draw from the statutory bucket and the awarded bucket at once, because sick-leave-core.ts spends earned hours before gifted ones, so a request can legitimately produce two rows. The original 0198 key was (request_id) alone, which made that lawful split impossible to write. Widening the key to (request_id, drawn_from) keeps the double-click defence intact - a second attempt at the SAME bucket for the SAME request is still rejected - while permitting the two-bucket draw the engine actually plans.';

do $verify$declare
  key_columns integer;
begin
  select count(*) into key_columns
  from pg_index i
  join pg_class c on c.oid = i.indexrelid
  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
  where c.relname = 'sick_leave_ledger_one_usage_per_request'
    and a.attname in ('request_id', 'drawn_from');

  if key_columns <> 2 then
    raise exception
      'SICK_LEAVE_INDEX_NOT_REPAIRED: sick_leave_ledger_one_usage_per_request should be keyed on BOTH request_id and drawn_from, but the catalogue reports % of those 2 columns. A single approved sick day that draws from the earned bucket and the awarded bucket at once would be rejected by the database. Nothing about the balances is wrong, but no such approval can be recorded until this index is correct.', key_columns;
  end if;
end
$verify$;
