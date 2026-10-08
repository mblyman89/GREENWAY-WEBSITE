-- =============================================================================
-- ROLLBACK for 0252_lab_coa_extract.sql (R28)
-- =============================================================================
-- This file is NOT a migration. It lives outside supabase/migrations on
-- purpose, so the migration runner never applies it.
--
-- 0252 added four columns to lab_results and four check constraints. This
-- drops them. It FORGETS every stored certificate read and every backfilled
-- JSON link (they can be read again after re-applying 0252 with the
-- Re-read lab certificate button on the lot page). Nothing else is touched:
-- product facts already staged onto menu cards stay as they are.
--
-- Revert the app code first if the columns should stay gone: the app writes
-- them on every delivery and is no-op safe without them.
-- =============================================================================

alter table public.lab_results drop constraint if exists lab_results_coa_extract_status_check;
alter table public.lab_results drop constraint if exists lab_results_coa_extract_json_object_check;
alter table public.lab_results drop constraint if exists lab_results_coa_extract_pair_check;
alter table public.lab_results drop constraint if exists lab_results_wcia_json_url_https_check;

alter table public.lab_results
  drop column if exists coa_extracted_at,
  drop column if exists coa_extract_status,
  drop column if exists coa_extract_json,
  drop column if exists wcia_json_url;
