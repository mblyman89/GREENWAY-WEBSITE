-- Rollback for 0255_inbound_dedupe.sql (R36 #2).
-- Drops only what 0255 added. Rows set to status 'dismissed' keep that status
-- (the app then shows them as Pending again - re-dismiss after re-applying).
drop index if exists public.inbound_manifests_duplicate_of_idx;
drop index if exists public.inbound_manifests_dedupe_key_uidx;
alter table public.inbound_manifests
  drop column if exists duplicate_of,
  drop column if exists dismissed_reason,
  drop column if exists dismissed_at,
  drop column if exists dedupe_key;
drop index if exists public.inbound_email_log_delivery_key_uidx;
alter table public.inbound_email_log
  drop column if exists claimed_at,
  drop column if exists delivery_key;
