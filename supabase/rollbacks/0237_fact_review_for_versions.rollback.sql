-- =============================================================================
-- ROLLBACK for 0237_fact_review_for_versions.sql (S30)
-- =============================================================================
-- This file is NOT a migration. It lives outside supabase/migrations on
-- purpose, so the migration runner (scripts/compliance/verify-migrations-execute.ts,
-- which reads only supabase/migrations/*.sql) never applies it.
--
-- Run it ONLY to undo 0237. The bible (S30.7) says the simplest rollback is to
-- LEAVE the schema and revert the code, because every change is additive.
-- Use this file only if the columns themselves must go.
--
-- WARNING: it DELETES every receiving-origin decision (rows with a
-- manifest_id), because import_id cannot become NOT NULL again while they
-- exist. Held receiving updates then go back to being published by hand
-- under Admin, Publish Menu. Import-scoped decisions are kept untouched.
-- =============================================================================

alter table public.pos_fact_reviews drop constraint if exists pos_fact_reviews_manifest_item_key;
alter table public.pos_fact_reviews drop constraint if exists pos_fact_reviews_one_scope;

delete from public.pos_fact_reviews where import_id is null;

alter table public.pos_fact_reviews drop column if exists flag_signature;
alter table public.pos_fact_reviews drop column if exists draft_id;
alter table public.pos_fact_reviews drop column if exists manifest_id;

alter table public.pos_fact_reviews alter column import_id set not null;
