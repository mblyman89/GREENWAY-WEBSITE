-- =============================================================================
-- ROLLBACK for 0239_intake_merge_decisions.sql (bible S32)
-- =============================================================================
-- This file is NOT a migration. It lives outside supabase/migrations on
-- purpose, so the migration runner (scripts/compliance/verify-migrations-execute.ts,
-- which reads only supabase/migrations/*.sql) never applies it.
--
-- Bible S32.7: "Revert code; the table can stay (unused). Or drop the table -
-- the planner treats a missing table as 'no decisions'."
--
-- Running this FORGETS every saved "join card X" / "keep separate" answer.
-- The warning "matched more than one live card" returns on the next delivery
-- of each of those products. Nothing on the menu changes when it runs.
-- =============================================================================

drop table if exists public.intake_merge_decisions;
