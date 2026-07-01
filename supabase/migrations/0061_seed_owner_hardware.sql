-- 0061_seed_owner_hardware.sql
-- Slice 86: register ALL owner-purchased / integrated hardware into the EXISTING
-- equipment asset registry (public.equipment_assets, migration 0046) so it shows
-- up on /admin/equipment alongside terminals, scales, safes, and cameras.
--
-- Devices, each grounded in the model actually integrated into the back office:
--   • Star Micronics TSP143IV  — receipt printer (CloudPRNT auto-print of online
--     pickup orders). Part 39473010 gray / 39473110 white.
--   • Rollo Wireless X1040      — 4x6 label printer (lot/shelf label reprint,
--     Slice 83). AirPrint/Wi-Fi driverless, 203 DPI, no cloud print API.
--   • Canon PIXMA TS3522        — flatbed scanner/printer used to scan medical
--     authorization forms (Slice 85). Part 4977C042, 600x1200 dpi optical.
--   • Scotch Thermal Laminator  — laminates printed medical recognition cards
--     (Slice 85). Category 'other' (no laminator category exists).
--
-- These are seeded as DRAFT registry rows for the owner to verify/complete
-- (serial numbers, purchase date/cost, warranty).
--
-- IDEMPOTENCY NOTE (why this file changed):
--   0046 makes asset_tag unique with a PARTIAL index:
--     create unique index ... on equipment_assets (asset_tag) where asset_tag is not null;
--   Postgres cannot use a PARTIAL unique index as an `on conflict (asset_tag)`
--   arbiter unless the exact same predicate is repeated. Rather than depend on
--   that, we insert each row only when its asset_tag does not already exist
--   (`where not exists (...)`). This is fully idempotent — re-running does
--   nothing and never overwrites owner edits — and does not touch the index.

insert into public.equipment_assets
  (asset_tag, name, category, manufacturer, model, location, status, requires_calibration, notes)
select
  'PRN-RECEIPT-01',
  'Receipt printer (online-order auto-print)',
  'printer',
  'Star Micronics',
  'TSP143IV (CloudPRNT) — Part 39473010 gray / 39473110 white',
  'POS counter',
  'active',
  false,
  'Auto-prints online pickup orders via CloudPRNT. Configure at Settings → Receipt Printer. Connect by Ethernet; no PC driver / no Star cloud subscription. 80mm paper (48 cols).'
where not exists (
  select 1 from public.equipment_assets where asset_tag = 'PRN-RECEIPT-01'
);

insert into public.equipment_assets
  (asset_tag, name, category, manufacturer, model, location, status, requires_calibration, notes)
select
  'PRN-LABEL-01',
  'Label printer (4x6 lot/shelf labels)',
  'label_printer',
  'Rollo',
  'Wireless X1040',
  'Inventory / intake area',
  'active',
  false,
  'AirPrint/Wi-Fi driverless, 203 DPI, 150mm/s, 4x6 labels. No cloud print API — labels print from the browser print dialog (see /admin/inventory/lots/[id]/label and docs/rollo-label-printing.md). Reprint only; not a CCRS tag.'
where not exists (
  select 1 from public.equipment_assets where asset_tag = 'PRN-LABEL-01'
);

insert into public.equipment_assets
  (asset_tag, name, category, manufacturer, model, location, status, requires_calibration, notes)
select
  'SCAN-MEDICAL-01',
  'Medical authorization scanner',
  'printer',
  'Canon',
  'PIXMA TS3522 — Part 4977C042',
  'Medical / consultant desk',
  'active',
  false,
  'Flatbed CIS scanner, 600x1200 dpi optical, max doc 8.5x11.7 (A4/Letter). AirPrint/Mopria/Canon PRINT, Wi-Fi 2.4GHz + USB. Scan authorization forms to PDF, then upload at Admin → Medical → Authorization Intake. No retailer scan API (scan-to-file then upload).'
where not exists (
  select 1 from public.equipment_assets where asset_tag = 'SCAN-MEDICAL-01'
);

insert into public.equipment_assets
  (asset_tag, name, category, manufacturer, model, location, status, requires_calibration, notes)
select
  'LAMINATOR-01',
  'Thermal laminator (recognition cards)',
  'other',
  'Scotch',
  'Thermal Laminator',
  'Medical / consultant desk',
  'active',
  false,
  'Laminates printed medical recognition cards (3.5x2.25in) after issuing at Admin → Medical → Authorization Intake, so the card survives repeated register handling.'
where not exists (
  select 1 from public.equipment_assets where asset_tag = 'LAMINATOR-01'
);
