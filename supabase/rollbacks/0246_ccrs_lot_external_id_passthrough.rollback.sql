-- =============================================================================
-- ROLLBACK for 0246_ccrs_lot_external_id_passthrough.sql (CCRS Bible v2 S-10)
-- =============================================================================
-- This file is NOT a migration. It lives outside supabase/migrations on
-- purpose, so the migration runner never applies it.
--
-- 0246 added no schema. It restored the dotted, filed CCRS id on one-time
-- Cultivera lots and wrote one audit_logs row per lot (actor_email
-- 'migration:0246') holding the BEFORE (sanitized) id. This puts EXACTLY those
-- lots back, and only where the id is still the one 0246 wrote (a later human
-- edit is never undone). WARNING: the sanitized id is NOT the id CCRS holds;
-- do not upload Inventory/Adjustment/Sale files after rolling back.
-- =============================================================================
update public.inventory_lots l
   set ccrs_inventory_external_id = a.before_json ->> 'ccrs_inventory_external_id'
  from public.audit_logs a
 where a.actor_email = 'migration:0246'
   and a.action = 'migration_0246.ccrs_external_id_passthrough'
   and a.entity_type = 'inventory_lot'
   and a.entity_id = l.id::text
   and l.ccrs_inventory_external_id = a.after_json ->> 'ccrs_inventory_external_id';

delete from public.audit_logs
 where actor_email = 'migration:0246'
   and action = 'migration_0246.ccrs_external_id_passthrough';
