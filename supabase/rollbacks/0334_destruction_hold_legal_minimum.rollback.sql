-- Rollback for 0334_destruction_hold_legal_minimum.sql (Fix Phase 7.1 · G-50).
-- Puts the column default back to 72. The saved hold is NOT changed back:
-- 0334 only moved it from 72 to 0, and someone may have chosen a value on
-- screen since. To restore the old hold, set Hold (hours) to 72 on
-- Returns & Destruction. The column comments stay (they are only accurate text).
begin;
alter table public.disposition_settings
  alter column hold_hours set default 72;
commit;
notify pgrst, 'reload schema';
