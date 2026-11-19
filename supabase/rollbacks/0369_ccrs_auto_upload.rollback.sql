-- Rollback for 0369_ccrs_auto_upload.sql (D253 assisted CCRS uploader).
-- Run MANUALLY only if needed. Drops the run history and the paired browsers
-- (every paired extension stops working at once). Ledger rows the uploader
-- marked uploaded STAY: ccrs_files and the audit log are the record of what
-- was sent to the State.
drop table if exists public.ccrs_upload_run_files;
drop table if exists public.ccrs_upload_runs;
drop table if exists public.ccrs_uploader_devices;
