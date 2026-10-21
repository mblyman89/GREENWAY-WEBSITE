-- Rollback for 0286_ccrs_inventory_last_told.sql: drops the one read-only
-- function. No data is touched. With it gone the batch sends every held lot
-- as an Update again (the pre-R6-3 behaviour).
drop function if exists public.ccrs_inventory_last_told(text, text[]);
