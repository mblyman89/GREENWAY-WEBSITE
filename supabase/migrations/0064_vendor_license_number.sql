-- 0064_vendor_license_number.sql
-- E7 (inventory intake manifest autofill).
--
-- Adds a stable WA cannabis LICENSE NUMBER to each vendor so the vendor-intake
-- manifest transport form can auto-fill the ORIGIN license number and origin
-- license name (legal_name/display_name) from the vendor record instead of
-- re-typing it on every delivery. Per WAC 314-55-085 the transportation
-- manifest must record the originating licensee; the license number and legal
-- name are stable per vendor (unlike the per-shipment driver/vehicle, which
-- stay on inbound_manifests where they already live via migration 0044).
--
-- Idempotent: safe to run more than once.

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS license_number text;

COMMENT ON COLUMN public.vendors.license_number IS
  'WA cannabis license number of the vendor (originating licensee). Used to auto-fill the CCRS/WAC 314-55-085 manifest origin license fields at intake.';
