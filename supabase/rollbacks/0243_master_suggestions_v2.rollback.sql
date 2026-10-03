-- =============================================================================
-- ROLLBACK for 0243_master_suggestions_v2.sql (bible S36)
-- =============================================================================
-- This file is NOT a migration. It lives outside supabase/migrations on
-- purpose, so the migration runner (scripts/compliance/verify-migrations-execute.ts,
-- which reads only supabase/migrations/*.sql) never applies it.
--
-- Bible S36.7: "Revert masters-store/page; the core is additive; the
-- migration is additive and unused when reverted." Reverting the code is
-- enough; the column and table can stay.
--
-- Running this FORGETS every remembered "not the same product" rejection and
-- every suggestion's waterfall. Rejected pairs may be proposed again on the
-- next "Generate suggestions". No master, member or menu card changes.
-- =============================================================================

drop table if exists public.product_master_pair_decisions;
alter table public.product_master_suggestions drop column if exists evidence_json;
