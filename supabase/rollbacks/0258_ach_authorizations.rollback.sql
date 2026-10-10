-- Rollback for 0258_ach_authorizations.sql (R39 S2).
--
-- ONLY run this before any real authorization has been signed. Once a signed
-- ACH authorization exists it is evidence that Nacha (2 years after it ends)
-- and WAC 314-55-087 (5 years) require you to keep, and dropping these tables
-- destroys it. The guard below refuses if any non-draft authorization or any
-- uploaded document exists.
do $$
declare
  n bigint;
begin
  -- Dynamic SQL: a static reference to a dropped table fails at plan time even
  -- behind the to_regclass test, which made a second run of this file error.
  if to_regclass('public.ach_authorizations') is not null then
    execute 'select count(*) from public.ach_authorizations where state <> ''draft''' into n;
    if n > 0 then
      raise exception 'ROLLBACK REFUSED: signed ACH authorizations exist and must be retained.';
    end if;
  end if;
  if to_regclass('public.ach_authorization_documents') is not null then
    execute 'select count(*) from public.ach_authorization_documents' into n;
    if n > 0 then
      raise exception 'ROLLBACK REFUSED: ACH documents have been uploaded and must be retained.';
    end if;
  end if;
end $$;

drop table if exists public.ach_return_notices;
drop table if exists public.ach_verifications;
drop table if exists public.ach_authorization_events;
drop table if exists public.ach_authorization_documents;
drop table if exists public.ach_authorization_accounts;
drop table if exists public.ach_authorizations;
drop table if exists public.payee_contacts;

drop function if exists public.ach_auth_guard_transition();
drop function if exists public.ach_auth_guard_delete();
drop function if exists public.ach_retention_may_dispose(date, date, boolean, date);
drop function if exists public.ach_acct_guard_update();
drop function if exists public.ach_acct_guard_count();
drop function if exists public.ach_doc_guard();
drop function if exists public.ach_events_append_only();
drop function if exists public.payee_contacts_guard();

drop policy if exists ach_docs_admin_read on storage.objects;
drop policy if exists ach_docs_manager_drop on storage.objects;
-- The bucket is left in place if it holds files (Supabase refuses to delete a
-- non-empty bucket, and the files are evidence).
delete from storage.buckets b where b.id = 'ach-docs'
  and not exists (select 1 from storage.objects o where o.bucket_id = 'ach-docs');

alter table public.vendors drop constraint if exists vendors_ach_opt_out_shape;
alter table public.vendors drop constraint if exists vendors_ach_flags_exclusive;
alter table public.vendors drop column if exists ach_opted_out_at;
alter table public.vendors drop column if exists ach_opted_out_by;
alter table public.vendors drop column if exists ach_opted_out_reason;
alter table public.vendors drop column if exists ach_opted_out;
alter table public.vendors drop column if exists ach_needs_bank_info;

-- vendor_bank_details: back to active/on_hold. Archived/revoked rows (if any)
-- are put on hold first so the narrower check can be added; they are not
-- deleted.
update public.vendor_bank_details set status = 'on_hold' where status in ('revoked', 'archived');
alter table public.vendor_bank_details drop constraint if exists vendor_bank_details_status_check;
alter table public.vendor_bank_details add constraint vendor_bank_details_status_check
  check (status in ('active', 'on_hold'));

notify pgrst, 'reload schema';
