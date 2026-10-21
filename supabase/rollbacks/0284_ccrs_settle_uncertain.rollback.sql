-- Rollback for 0284_ccrs_settle_uncertain.sql: drops the three functions.
-- No data is touched. Entities already settled stay as they are; with the
-- functions gone an uncertain id is settled only by a Service Desk copy again.
drop function if exists public.ccrs_preprod_settle_duplicates(text);
drop function if exists public.ccrs_prove_by_reference(text);
drop function if exists public.ccrs_close_settled_files(text, text);
