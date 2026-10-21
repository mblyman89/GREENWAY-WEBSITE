-- Rollback for 0283_ccrs_sale_slice.sql: drops the one read-only function.
-- No data is touched. With it gone the batch withholds every return
-- correction (E48) because it can no longer prove CCRS holds the sale line.
drop function if exists public.ccrs_sale_slice(text, text[]);
