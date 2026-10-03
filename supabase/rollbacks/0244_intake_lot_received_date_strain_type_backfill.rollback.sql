-- =============================================================================
-- ROLLBACK for 0244_intake_lot_received_date_strain_type_backfill.sql (R25 A)
-- =============================================================================
-- This file is NOT a migration. It lives outside supabase/migrations on
-- purpose, so the migration runner (scripts/compliance/verify-migrations-execute.ts,
-- which reads only supabase/migrations/*.sql) never applies it.
--
-- 0244 added no schema. It filled values, and wrote one audit_logs row per
-- lot it changed (actor_email 'migration:0244') holding the BEFORE values.
-- This restores EXACTLY those lots to their BEFORE values, and only where the
-- value is still the one 0244 wrote (a later human edit is never undone).
--
-- Reverting the app code is NOT required. Running this sends the backfilled
-- intake lots back to the received-date worklist and the inventory page shows
-- the manifest's strain type again.
-- =============================================================================

-- 1. Received dates 0244 stamped (still exactly as stamped).
update public.inventory_lots l
   set received_on        = null,
       received_on_source = null,
       received_on_set_by = null,
       received_on_set_at = null
  from public.audit_logs a
 where a.actor_email = 'migration:0244'
   and a.action = 'migration_0244.received_on_backfill'
   and a.entity_type = 'inventory_lot'
   and a.entity_id = l.id::text
   and l.received_on_source = 'manifest'
   and l.received_on = (a.after_json ->> 'received_on')::date;

-- 2. Strain types 0244 mirrored (still exactly as mirrored).
update public.inventory_lots l
   set strain_type = a.before_json ->> 'strain_type',
       fact_provenance = case
         when a.before_json -> 'fact_provenance_strain_type' is null
           or jsonb_typeof(a.before_json -> 'fact_provenance_strain_type') = 'null'
           then coalesce(l.fact_provenance, '{}'::jsonb) - 'strain_type'
         else coalesce(l.fact_provenance, '{}'::jsonb)
              || jsonb_build_object('strain_type', a.before_json -> 'fact_provenance_strain_type')
       end
  from public.audit_logs a
 where a.actor_email = 'migration:0244'
   and a.action = 'migration_0244.strain_type_backfill'
   and a.entity_type = 'inventory_lot'
   and a.entity_id = l.id::text
   and l.strain_type = a.after_json ->> 'strain_type'
   and coalesce(l.fact_provenance ->> 'strain_type', '') = 'reviewer';

-- 3. Forget the 0244 audit rows, so a re-apply records afresh.
delete from public.audit_logs
 where actor_email = 'migration:0244'
   and action in ('migration_0244.received_on_backfill', 'migration_0244.strain_type_backfill');
