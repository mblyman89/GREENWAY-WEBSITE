-- 0132_pos_device_rejected_report.sql  (GW-027)
--
-- "Rejected" POS events never enter the server ledger — they live ONLY in
-- the register's on-device queue. The back office therefore cannot list the
-- rows, but it CAN know they exist: each sync flush now reports a tiny
-- summary ({ count, note }) that the server stamps onto the device row, so
-- the admin Register Activity + POS devices pages can say
-- "Register 2 has 3 rejected rows on-device — review them at the register."
--
-- Columns are additive and nullable-safe; code written before this migration
-- keeps working (the update is best-effort and tolerates missing columns).

alter table public.pos_devices
  add column if not exists rejected_count int not null default 0,
  add column if not exists rejected_note text,
  add column if not exists rejected_reported_at timestamptz;

comment on column public.pos_devices.rejected_count is
  'How many server-REJECTED events the device reported holding on-device at last sync (GW-027).';
comment on column public.pos_devices.rejected_note is
  'Short summary of the oldest rejected row, as reported by the device (clamped server-side).';
comment on column public.pos_devices.rejected_reported_at is
  'When the device last reported its rejected-row summary.';
