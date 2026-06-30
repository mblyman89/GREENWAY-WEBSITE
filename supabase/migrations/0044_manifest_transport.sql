-- 0044_manifest_transport.sql
-- Slice 33 (Feature L): capture transport / chain-of-custody info on inbound
-- vendor manifests. WA WAC 314-55-085 requires licensees to keep transportation
-- manifest records (transporter, driver, vehicle, departure/arrival). These
-- columns let an employee record what physically arrived without leaving the
-- intake review screen. All nullable and idempotent.

ALTER TABLE public.inbound_manifests
  ADD COLUMN IF NOT EXISTS transporter_name        text,
  ADD COLUMN IF NOT EXISTS transporter_license     text,
  ADD COLUMN IF NOT EXISTS driver_name             text,
  ADD COLUMN IF NOT EXISTS driver_license_number   text,
  ADD COLUMN IF NOT EXISTS vehicle_description      text,
  ADD COLUMN IF NOT EXISTS vehicle_plate            text,
  ADD COLUMN IF NOT EXISTS vehicle_vin              text,
  ADD COLUMN IF NOT EXISTS departed_at              timestamptz,
  ADD COLUMN IF NOT EXISTS arrived_at               timestamptz,
  ADD COLUMN IF NOT EXISTS route_notes              text,
  ADD COLUMN IF NOT EXISTS transport_recorded_by    uuid,
  ADD COLUMN IF NOT EXISTS transport_recorded_at    timestamptz;

COMMENT ON COLUMN public.inbound_manifests.transporter_name IS
  'Carrier / transporter business that moved the load (WAC 314-55-085).';
COMMENT ON COLUMN public.inbound_manifests.driver_name IS
  'Name of the person who physically delivered the manifest.';
COMMENT ON COLUMN public.inbound_manifests.vehicle_plate IS
  'Delivery vehicle license plate for chain-of-custody records.';
