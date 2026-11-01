-- 0334_destruction_hold_legal_minimum.sql  (Fix Phase 7.1 · G-50 / G-49 · D67)
--
-- WHY. The owner, verbatim (Q-15-5, recorded as D67):
--   "Q5- reduce it to the minimum required by law. Look it up in CCRS please."
-- Current rule has no waiting period before destruction: WAC 314-55-097 sets
-- how waste is rendered unusable and recorded, and the old 72-hour WSLCB
-- destruction notice was removed by WSR 22-14-111. 0115 created
-- disposition_settings.hold_hours with default 72 and saved a row of 72, so
-- changing the code default alone would not change the store.
--
-- WHAT.
--   1. disposition_settings.hold_hours default 72 -> 0.
--   2. The saved row moves 72 -> 0 ONLY if it still holds the old default 72.
--      A value someone chose on screen (anything other than 72) is left alone.
--   3. G-49 housekeeping: 0042's column comments said "WSLCB requires a
--      quarantine + notice period" / "72h hold before destruction is
--      permitted". That is not current law. The columns get accurate comments.
--
-- Grants (standing rule 15): NO new objects, so NO grant changes. The existing
-- grants and RLS on disposition_settings (0115: staff read, admin write) and
-- destruction_events (0042) are untouched. COMMENT ON and ALTER ... SET
-- DEFAULT do not change privileges.
--
-- Scheduling still quarantines the lot and records the event; CCRS still
-- receives the Destruction adjustment in that week's file. The owner can still
-- set any hold from 0 to 336 hours on Returns & Destruction.
--
-- Safe to re-run (the update only matches 72; comments and defaults are
-- idempotent).
-- Rollback: supabase/rollbacks/0334_destruction_hold_legal_minimum.rollback.sql.
-- PG check: scripts/recon/destruction-hold-0334-pg-check.sql.

do $precheck$
begin
  if to_regclass('public.disposition_settings') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0334 depends on 0115_disposition_command_center.sql';
  end if;
  if to_regclass('public.destruction_events') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0334 depends on 0042_returns_destruction_samples.sql';
  end if;
end
$precheck$;

alter table public.disposition_settings
  alter column hold_hours set default 0;

update public.disposition_settings
   set hold_hours = 0
 where id = true
   and hold_hours = 72;

comment on column public.disposition_settings.hold_hours is
  'Pre-destruction hold in hours (0-336). STORE POLICY, not law: current rule (WAC 314-55-097) has no waiting period and the old 72-hour WSLCB notice was removed by WSR 22-14-111. Default 0 = the legal minimum (D67, migration 0334).';

comment on column public.destruction_events.quarantine_start is
  'When the destruction was scheduled and the lot was quarantined internally. Store practice, not a WSLCB notice period (the 72-hour notice was removed by WSR 22-14-111).';

comment on column public.destruction_events.earliest_destroy_at is
  'quarantine_start plus the store hold (disposition_settings.hold_hours, default 0). Store policy only; current rule sets no waiting period (WAC 314-55-097).';

notify pgrst, 'reload schema';
