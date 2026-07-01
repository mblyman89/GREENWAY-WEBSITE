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
-- (serial numbers, purchase date/cost, warranty). Idempotent: keyed on the
-- unique asset_tag partial index (0046), so re-running does nothing and never
-- overwrites owner edits.

insert into public.equipment_assets
  (asset_tag, name, category, manufacturer, model, location, status, requires_calibration, notes)
values
  (
    'PRN-RECEIPT-01',
    'Receipt printer (online-order auto-print)',
    'printer',
    'Star Micronics',
    'TSP143IV (CloudPRNT) — Part 39473010 gray / 39473110 white',
    'POS counter',
    'active',
    false,
    'Auto-prints online pickup orders via CloudPRNT. Configure at Settings → Receipt Printer. Connect by Ethernet; no PC driver / no Star cloud subscription. 80mm paper (48 cols).'
  ),
  (
    'PRN-LABEL-01',
    'Label printer (4x6 lot/shelf labels)',
    'label_printer',
    'Rollo',
    'Wireless X1040',
    'Inventory / intake area',
    'active',
    false,
    'AirPrint/Wi-Fi driverless, 203 DPI, 150mm/s, 4x6 labels. No cloud print API — labels print from the browser print dialog (see /admin/inventory/lots/[id]/label and docs/rollo-label-printing.md). Reprint only; not a CCRS tag.'
  ),
  (
    'SCAN-MEDICAL-01',
    'Medical authorization scanner',
    'printer',
    'Canon',
    'PIXMA TS3522 — Part 4977C042',
    'Medical / consultant desk',
    'active',
    false,
    'Flatbed CIS scanner, 600x1200 dpi optical, max doc 8.5x11.7 (A4/Letter). AirPrint/Mopria/Canon PRINT, Wi-Fi 2.4GHz + USB. Scan authorization forms to PDF, then upload at Admin → Medical → Authorization Intake. No retailer scan API (scan-to-file then upload).'
  ),
  (
    'LAMINATOR-01',
    'Thermal laminator (recognition cards)',
    'other',
    'Scotch',
    'Thermal Laminator',
    'Medical / consultant desk',
    'active',
    false,
    'Laminates printed medical recognition cards (3.5x2.25in) after issuing at Admin → Medical → Authorization Intake, so the card survives repeated register handling.'
  )
on conflict (asset_tag) do nothing;
