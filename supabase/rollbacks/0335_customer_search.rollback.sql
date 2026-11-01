-- Rollback for 0335_customer_search.sql (G-75, owner message 17).
-- Removes the typo-search function and the trigram indexes. The app keeps
-- working: search still finds partial names, last names, phone digits,
-- email and Customer ID, it just stops offering "closest spellings".
-- The two columns are KEPT by default because they hold imported data
-- (Date Created, Tax Designations). To remove them too, uncomment the last
-- two statements. The pg_trgm extension is left installed (harmless).
begin;
drop function if exists public.customer_search_fuzzy(text, integer);
drop index if exists public.customers_first_name_trgm_idx;
drop index if exists public.customers_last_name_trgm_idx;
drop index if exists public.customers_email_trgm_idx;
drop index if exists public.customers_phone_normalized_trgm_idx;
-- alter table public.customers drop column if exists imported_created_at;
-- alter table public.customers drop column if exists tax_designations;
commit;
notify pgrst, 'reload schema';
