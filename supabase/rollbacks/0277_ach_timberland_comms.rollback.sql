-- Rollback for 0277_ach_timberland_comms.sql (R41 S10).
--
-- REFUSES once the log has been USED: every row is a record of what Timberland
-- told Greenway (or what Greenway reported), kept forever. Export the rows
-- first and decide with the owner. Do not drop.
--
-- REFUSES when an owner-approval request targets the log (target_type
-- timberland_comms): the 0273 list without it could not hold it.
--
-- Otherwise it drops the trigger function and the table, and puts the 0273
-- ach_change_requests.target_type list back VERBATIM. Safe to re-run.
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
  if exists (select 1 from public.ach_change_requests where target_type = 'timberland_comms') then
    raise exception 'ROLLBACK REFUSED: an owner-approval request targets the Timberland log; the 0273 target list cannot hold it.';
  end if;
end $$;

drop table if exists public.ach_timberland_comms;
drop function if exists public.ach_timberland_comms_guard();

alter table public.ach_change_requests drop constraint if exists ach_change_requests_target_type_check;
alter table public.ach_change_requests add constraint ach_change_requests_target_type_check
  check (target_type in ('vendor', 'employee', 'authorization', 'account', 'verification',
                         'notice', 'document', 'contact', 'invite', 'payroll_run',
                         'company', 'vendor_payment', 'ach_file'));
