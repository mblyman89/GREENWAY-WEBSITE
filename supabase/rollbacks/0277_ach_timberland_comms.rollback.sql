-- Rollback for 0277_ach_timberland_comms.sql (R41 S10).
--
-- REFUSES once the log has been USED: every row is a record of what Timberland
-- told Greenway (or what Greenway reported), kept forever. Export the rows
-- first and decide with the owner. Do not drop.
--
-- Otherwise it drops the trigger function and the table (0277 changed nothing
-- else). Safe to re-run.
do $$
declare
  used boolean;
begin
  if to_regclass('public.ach_timberland_comms') is not null then
    execute 'select exists (select 1 from public.ach_timberland_comms)' into used;
    if used then
      raise exception 'ROLLBACK REFUSED: ach_timberland_comms holds Timberland log entries (records). Export them first; do not drop.';
    end if;
  end if;
end $$;

drop table if exists public.ach_timberland_comms;
drop function if exists public.ach_timberland_comms_guard();
