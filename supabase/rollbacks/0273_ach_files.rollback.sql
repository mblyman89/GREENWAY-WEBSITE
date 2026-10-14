-- Rollback for 0273_ach_files.sql (R41 S3).
--
-- REFUSES once the ledger has been USED: every row in ach_files is a payment
-- record (a file that may be at the bank), kept forever by owner rule and for
-- at least one calendar year by the Timberland agreement section 12. Export
-- the rows first and decide with the owner. Do not drop.
--
-- REFUSES when an owner-approval request targets an ACH file (target_type
-- ach_file): the 0271 list without ach_file could not hold it.
--
-- Otherwise it drops the functions, the trigger and the table, and puts the
-- 0271 ach_change_requests.target_type list back VERBATIM. Payroll runs keep
-- whatever status they have (0273 never adds a status). Safe to re-run.
do $$
declare
  used boolean;
begin
  if to_regclass('public.ach_files') is not null then
    execute 'select exists (select 1 from public.ach_files)' into used;
    if used then
      raise exception 'ROLLBACK REFUSED: ach_files holds released ACH files (payment records). Export them first; do not drop.';
    end if;
  end if;
  if exists (select 1 from public.ach_change_requests where target_type = 'ach_file') then
    raise exception 'ROLLBACK REFUSED: an owner-approval request targets an ACH file; the 0271 target list cannot hold it.';
  end if;
end $$;

drop function if exists public.ach_file_void(uuid, uuid, text);
drop function if exists public.ach_file_release_payroll(uuid, uuid, date, text, text, date, integer, bigint, text, text, text, boolean, text);
drop table if exists public.ach_files;
drop function if exists public.ach_files_guard();

alter table public.ach_change_requests drop constraint if exists ach_change_requests_target_type_check;
alter table public.ach_change_requests add constraint ach_change_requests_target_type_check
  check (target_type in ('vendor', 'employee', 'authorization', 'account', 'verification',
                                                       'notice', 'document', 'contact', 'invite', 'payroll_run',
                                                       'company', 'vendor_payment'));
