-- =============================================================================
-- ROLLBACK for 0251_wa_total_thc_cbd_repair.sql (R27)
-- =============================================================================
-- This file is NOT a migration. It lives outside supabase/migrations on
-- purpose, so the migration runner (scripts/compliance/verify-migrations-execute.ts,
-- which reads only supabase/migrations/*.sql) never applies it.
--
-- 0251 added no schema. It repaired values, and wrote one audit_logs row per
-- row it changed (actor_email 'migration:0251') holding the BEFORE values.
-- This restores EXACTLY those rows to their BEFORE values, and only where the
-- value is still the one 0251 wrote (a later edit is never undone).
-- Reverting the app code is NOT required (new intakes keep the WA rule).
-- =============================================================================

-- 1. Drafts 0251 repaired (still exactly as repaired).
update public.catalog_product_drafts d
   set total_thc_pct = (a.before_json ->> 'total_thc_pct')::numeric
  from public.audit_logs a
 where a.actor_email = 'migration:0251'
   and a.action = 'migration_0251.draft_total_repair'
   and a.entity_type = 'catalog_product_draft'
   and a.entity_id = d.id::text
   and d.total_thc_pct is not distinct from (a.after_json ->> 'total_thc_pct')::numeric;

-- 2. KB products 0251 repaired (each column only while still as repaired).
update public.kb_products k
   set total_thc_pct = case when k.total_thc_pct is not distinct from (a.after_json ->> 'total_thc_pct')::numeric
                            then (a.before_json ->> 'total_thc_pct')::numeric else k.total_thc_pct end,
       total_cbd_pct = case when k.total_cbd_pct is not distinct from (a.after_json ->> 'total_cbd_pct')::numeric
                            then (a.before_json ->> 'total_cbd_pct')::numeric else k.total_cbd_pct end
  from public.audit_logs a
 where a.actor_email = 'migration:0251'
   and a.action = 'migration_0251.kb_total_repair'
   and a.entity_type = 'kb_product'
   and a.entity_id = k.id::text;

-- 3. Lab results 0251 repaired (each column only while still as repaired).
update public.lab_results r
   set total_thc_pct = case when r.total_thc_pct is not distinct from (a.after_json ->> 'total_thc_pct')::numeric
                            then (a.before_json ->> 'total_thc_pct')::numeric else r.total_thc_pct end,
       total_cbd_pct = case when r.total_cbd_pct is not distinct from (a.after_json ->> 'total_cbd_pct')::numeric
                            then (a.before_json ->> 'total_cbd_pct')::numeric else r.total_cbd_pct end
  from public.audit_logs a
 where a.actor_email = 'migration:0251'
   and a.action = 'migration_0251.lab_total_repair'
   and a.entity_type = 'lab_result'
   and a.entity_id = r.id::text;

-- 4. Forget the 0251 audit rows, so a re-apply records afresh.
delete from public.audit_logs
 where actor_email = 'migration:0251'
   and action in ('migration_0251.lab_total_repair', 'migration_0251.draft_total_repair', 'migration_0251.kb_total_repair');
