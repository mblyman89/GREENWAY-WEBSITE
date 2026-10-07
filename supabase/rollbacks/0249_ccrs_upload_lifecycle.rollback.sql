-- Rollback for 0249_ccrs_upload_lifecycle.sql  (CCRS Bible v2 slice S-12c)
--
-- 0249 adds FUNCTIONS ONLY: no table, column, constraint, trigger or row.
-- Everything those functions wrote (file states uploaded/succeeded/errored/
-- reconciling/closed/abandoned, row states, filed entities, issues, the
-- PREprod start marker) lives in 0247/0248 tables, is valid under the 0247
-- guard on its own, and is the State's record: a rollback must NEVER delete
-- it. So this drops the functions and keeps every row. Re-applying 0249
-- restores the behaviour against the same data (every function is
-- create-or-replace and idempotent).
--
-- What you lose while rolled back: the hub cannot mark uploads or record
-- CCRS answers, so the ledger stops moving. Do not export a second
-- production batch while rolled back (Part 05 A: un-recorded Inserts would
-- be routed as Insert again -> "Duplicate External Identifier").
drop function if exists public.ccrs_preprod_ledger_start(text);
drop function if exists public.ccrs_abandon_file(uuid, text);
drop function if exists public.ccrs_record_outcome(uuid, text, timestamptz, jsonb, text[]);
drop function if exists public.ccrs_promote_rows(uuid, uuid[], timestamptz);
drop function if exists public.ccrs_mark_uploaded(uuid, timestamptz, uuid, text);
drop function if exists public.ccrs_upload_group(text);
