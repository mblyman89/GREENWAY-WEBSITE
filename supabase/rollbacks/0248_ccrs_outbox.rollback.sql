-- 0248_ccrs_outbox.rollback.sql — undo 0248_ccrs_outbox.sql exactly.
--
-- REFUSES to run once anything 0248 wrote is a record of what we sent or
-- assigned: an emitted outbox file (stamp_at set) or an assigned GWP- id.
-- Those must be exported first. The `unknown` link entities created by
-- ccrs_link_unfiled_migration_lots are removed only while still `unknown`
-- (if routing has since moved one, it is a record and the rollback refuses).
do $$
begin
  if to_regclass('public.ccrs_product_ids') is not null and exists (select 1 from public.ccrs_product_ids) then
    raise exception 'ROLLBACK_REFUSED: ccrs_product_ids holds assigned CCRS Product ids; export them first';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'ccrs_files' and column_name = 'stamp_at') then
    if exists (select 1 from public.ccrs_files where stamp_at is not null and state <> 'draft') then
      raise exception 'ROLLBACK_REFUSED: ccrs_files holds emitted outbox files; export them first';
    end if;
  end if;
  if to_regclass('public.ccrs_filed_entities') is not null and exists (
    select 1 from public.ccrs_filed_entities where source = 'link:unfiled-migration-lot' and state <> 'unknown'
  ) then
    raise exception 'ROLLBACK_REFUSED: a linked lot entity has moved past unknown; it is a record now';
  end if;
end $$;

delete from public.ccrs_filed_entities where source = 'link:unfiled-migration-lot' and state = 'unknown';

drop function if exists public.ccrs_ledger_slice(text, text[], text[]);
drop function if exists public.ccrs_seed_finalize(text, jsonb, jsonb);
drop function if exists public.ccrs_link_unfiled_migration_lots(boolean);
drop function if exists public.ccrs_assign_product_ids(text, text[], text, text);
drop function if exists public.ccrs_emit_files(text, jsonb, jsonb);
drop table if exists public.ccrs_product_ids;
drop function if exists public.ccrs_product_ids_guard();
drop sequence if exists public.ccrs_gwp_seq;
drop table if exists public.ccrs_file_contents;
drop function if exists public.ccrs_file_contents_guard();
drop index if exists public.ccrs_files_env_stamp_idx;
alter table if exists public.ccrs_files drop column if exists control_totals;
alter table if exists public.ccrs_files drop column if exists stamp_at;
