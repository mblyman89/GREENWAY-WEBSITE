-- Rollback for 0291_ach_control_records.sql (R41 S18).
--
-- REFUSES once any control record exists: they are the owner's signed record
-- that the ACH policies were adopted, access was reviewed and keys were
-- checked. Export the rows first and decide with the owner. Do not drop.
--
-- Otherwise it drops the table and its two trigger functions. Safe to re-run.
do $$
declare
  used boolean;
begin
  if to_regclass('public.ach_control_records') is not null then
    execute 'select exists (select 1 from public.ach_control_records)' into used;
    if used then
      raise exception 'ROLLBACK REFUSED: ach_control_records holds signed control records. Export them first; do not drop.';
    end if;
  end if;
end $$;

drop table if exists public.ach_control_records;
drop function if exists public.ach_control_records_guard();
drop function if exists public.ach_control_records_no_truncate();
