-- ===========================================================================
-- 0110_discovery_signal_vendor.sql
--
-- Task I (I4, owner request): per-type top-10 product signals with the
-- VENDOR (producer/processor) behind each product — "to be able to have a
-- list of the top 10 products from every single type shown each in its own
-- section with the ability to see which vendor/ brand those products come
-- from."
--
-- Two additive, nullable columns on discovery_market_signals:
--   * vendor_name    — display name of the shipping vendor
--   * vendor_license — the vendor's WSLCB license number (stable public id)
--
-- Sources (VERIFIED against the real May-2026 delivery, never guessed):
--   * Retail Product.LicenseeId is the RETAILER 99.7% of the time — NOT a
--     vendor signal. Vendor comes from manifests instead:
--   * lot-level: ManifestHeader (live rows only) OriginLicenseNumber/Name,
--     joined via TransportedItems.InventoryExternalIdentifier ==
--     Inventory.ExternalIdentifier (306,998 lots resolved; 1,858 conflicting
--     lots tombstoned rather than guessed);
--   * brand bridge fallback: extractBrand(transported description) → dominant
--     origin, only at ≥80% share across ≥3 manifests (2,698 brands resolve).
--   * NULL when unresolvable — never guessed.
--
-- The signal `kind` column (plain text, no CHECK constraint) now also carries
-- 'type_mover' — the statewide top-10 products per inventory type. No schema
-- change needed for that; this migration only adds the vendor columns.
--
-- Idempotent (safe to re-run). RLS unchanged (0106 staff policy covers new
-- columns automatically). No money columns added.
--
-- APPLY MANUALLY (owner applies migrations by hand, per standing rules),
-- then RE-UPLOAD monthly zips to backfill vendor data + type_mover signals.
-- ===========================================================================

alter table public.discovery_market_signals
  add column if not exists vendor_name    text,
  add column if not exists vendor_license text;

comment on column public.discovery_market_signals.vendor_name is
  'Task I (I4): shipping vendor (producer/processor) display name from manifest origin joins; null = unresolvable, never guessed.';
comment on column public.discovery_market_signals.vendor_license is
  'Task I (I4): shipping vendor WSLCB license number from manifest origin joins; null = unresolvable, never guessed.';
