-- Rollback for 0259_vendor_vault_change_control.sql (R39 S3).
--
-- ONLY run this before anyone has used the new change controls. Once a row
-- records who entered a bank change, who released a hold, or who archived
-- banking, that record is the audit trail for a payment-instruction change
-- (Nacha fraud-monitoring rules; WAC 314-55-087 keeps business records 5
-- years). Dropping the columns would erase it, so the guard below REFUSES.
--
-- Removing the trigger also removes "no deletes": after this rollback a
-- vendor delete cascades to its banking row again (0143 behaviour).
do $$
declare
  n bigint;
begin
  if to_regclass('public.vendor_bank_details') is null then
    return;
  end if;
  -- Dynamic SQL: the columns may already be gone on a second run.
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'vendor_bank_details'
                and column_name = 'released_by') then
    execute 'select count(*) from public.vendor_bank_details
              where change_entered_by is not null or released_by is not null
                 or archived_by is not null or release_callback_note is not null'
      into n;
    if n > 0 then
      raise exception 'ROLLBACK REFUSED: vendor banking change/release/archive history exists and must be retained.';
    end if;
  end if;
end $$;

drop trigger if exists trg_vendor_bank_guard on public.vendor_bank_details;
drop function if exists public.vendor_bank_guard();

alter table public.vendor_bank_details drop constraint if exists vbd_release_mode_shape;
alter table public.vendor_bank_details drop constraint if exists vbd_release_method_shape;
alter table public.vendor_bank_details drop constraint if exists vbd_hold_has_reason;
alter table public.vendor_bank_details drop constraint if exists vbd_archived_shape;

alter table public.vendor_bank_details drop column if exists archive_reason;
alter table public.vendor_bank_details drop column if exists archived_by;
alter table public.vendor_bank_details drop column if exists archived_at;
alter table public.vendor_bank_details drop column if exists release_reason;
alter table public.vendor_bank_details drop column if exists release_callback_note;
alter table public.vendor_bank_details drop column if exists release_callback_method;
alter table public.vendor_bank_details drop column if exists release_mode;
alter table public.vendor_bank_details drop column if exists released_at;
alter table public.vendor_bank_details drop column if exists released_by;
alter table public.vendor_bank_details drop column if exists change_entered_at;
alter table public.vendor_bank_details drop column if exists change_entered_by;
alter table public.vendor_bank_details drop column if exists hold_reason;

notify pgrst, 'reload schema';
