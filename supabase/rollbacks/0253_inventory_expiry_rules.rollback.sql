-- =============================================================================
-- ROLLBACK for 0253_inventory_expiry_rules.sql (R34)
-- =============================================================================
-- This file is NOT a migration. It lives outside supabase/migrations on
-- purpose, so the migration runner never applies it.
--
-- REFUSES while any lot still carries an expires_on_source of 'rule' or
-- 'manifest': 0215's narrower vocabulary cannot hold those rows, and silently
-- re-labelling a date's provenance would destroy evidence. To roll back,
-- first decide what those dates should become, for example:
--
--   -- forget rule-derived dates (they can be re-applied after re-running 0253)
--   update public.inventory_lots
--      set expires_on = null, expires_on_source = null, expires_on_set_by = null,
--          expires_on_set_at = null, expires_on_rule_id = null, expires_on_rule_note = null
--    where expires_on_source = 'rule';
--   -- manifest dates become "source not recorded" (they stay protected)
--   update public.inventory_lots set expires_on_source = null where expires_on_source = 'manifest';
--
-- The rules themselves are dropped with the table (export them first from the
-- Supabase table editor if you want to keep them).
-- =============================================================================
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'inventory_lots' and column_name = 'expires_on_source'
  ) then
    if exists (
      select 1 from public.inventory_lots where expires_on_source in ('rule', 'manifest')
    ) then
      raise exception 'ROLLBACK_REFUSED: lots still carry expires_on_source rule/manifest; see the header of this file';
    end if;
  end if;
end $$;

alter table public.inventory_lots drop constraint if exists inventory_lots_expires_on_rule_note_chk;
drop index if exists public.inventory_lots_expires_on_source_idx;
alter table public.inventory_lots
  drop column if exists expires_on_rule_note,
  drop column if exists expires_on_rule_id;

alter table public.inventory_lots drop constraint if exists inventory_lots_expires_on_source_chk;
alter table public.inventory_lots
  add constraint inventory_lots_expires_on_source_chk
  check (expires_on_source is null or expires_on_source in ('pos_import', 'coa', 'owner_entered'));

drop table if exists public.inventory_expiry_rules;

notify pgrst, 'reload schema';
