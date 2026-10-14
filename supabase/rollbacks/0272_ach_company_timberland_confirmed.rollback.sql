-- Rollback for 0272_ach_company_timberland_confirmed.sql (R41 S2).
-- Removes the stamp trigger, its function, the shape constraint and the four
-- stamp columns. The stamp history (who confirmed, when, the note) is LOST:
-- copy it first if it matters:
--   select timberland_confirmed_at, timberland_confirmed_by, timberland_confirm_note,
--          timberland_confirm_cleared_at from public.ach_company_settings;
-- The app keeps working: it reads the stamp as "needs migration 0272".
drop trigger if exists trg_ach_company_settings_timberland_stamp on public.ach_company_settings;
drop function if exists public.ach_company_timberland_stamp();
alter table public.ach_company_settings drop constraint if exists ach_timberland_stamp_shape;
alter table public.ach_company_settings
  drop column if exists timberland_confirm_cleared_at,
  drop column if exists timberland_confirm_note,
  drop column if exists timberland_confirmed_by,
  drop column if exists timberland_confirmed_at;
