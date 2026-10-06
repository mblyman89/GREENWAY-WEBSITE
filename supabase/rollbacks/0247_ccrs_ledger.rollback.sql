-- 0247_ccrs_ledger.rollback.sql — undo 0247_ccrs_ledger.sql exactly.
--
-- REFUSES to run if any file has left `draft` (state <> 'draft' other than the
-- seed pseudo-files) — those rows are the record of what was sent to the
-- State and must be exported before anyone drops them. Seed rows (entities
-- with source like 'seed:%' and purpose='seed' files) are re-creatable from
-- the delivery by scripts/compliance/seed-ccrs-ledger.ts, so they do not block.
do $$
begin
  if to_regclass('public.ccrs_files') is not null and exists (
    select 1 from public.ccrs_files where state <> 'draft' and purpose <> 'seed'
  ) then
    raise exception 'ROLLBACK_REFUSED: ccrs_files holds files that left draft; export them first';
  end if;
end $$;

drop table if exists public.ccrs_file_issues;
drop table if exists public.ccrs_file_rows;
drop table if exists public.ccrs_filed_entities;
-- the guard would refuse to delete non-draft rows, but DROP TABLE does not fire row triggers
drop table if exists public.ccrs_files;
drop function if exists public.ccrs_files_guard();
