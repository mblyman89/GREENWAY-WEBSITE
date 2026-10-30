-- Rollback for 0325_ccrs_transfer_last_told.sql: drops the one read-only
-- function. No data is touched. With it gone the batch proposes no transfer
-- corrections (C1 rule 7 sees "absent"); every other transfer rule is unchanged.
drop function if exists public.ccrs_transfer_last_told(text, text[]);
