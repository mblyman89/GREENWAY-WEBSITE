-- Rollback for 0336_cultivera_loyalty_import.sql (CVL, owner interrupt 2026-11-01).
-- Removes the apply function, so nothing more can be imported. Credited
-- opening balances stay: they are real points customers can spend, and the
-- ledger is the source of truth. The history table and the import_key column
-- are KEPT by default because they hold imported data and stop a second
-- credit; to remove them too, uncomment the last statements (a later re-apply
-- of 0336 would then credit customers again).
begin;
drop function if exists public.apply_cultivera_loyalty(text, timestamptz, uuid, jsonb);
-- drop table if exists public.customer_cultivera_loyalty;
-- drop index if exists public.loyalty_ledger_import_key_uidx;
-- alter table public.loyalty_ledger drop column if exists import_key;
commit;
notify pgrst, 'reload schema';
