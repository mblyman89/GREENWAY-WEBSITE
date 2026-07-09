-- 0100_vendor_usual_transport.sql
-- Slice H15e: remember each vendor's "usual transport" so the intake review
-- screen can pre-suggest the carrier / driver / vehicle on their next
-- delivery ("Using QGT's usual carrier — confirm or change").
--
-- WHY jsonb (not 7 discrete columns): this is a remembered SNAPSHOT of the
-- vendor-stable transport identity (carrier, driver, vehicle), written back
-- whenever one of their manifests is accepted with transport recorded. It is
-- only ever read/written as a unit by the app (vendor-transport-core.ts owns
-- the shape + a tolerant parser), mirroring the vendors.social_json
-- precedent. Per-shipment facts (departed_at / arrived_at / route_notes /
-- eta_date) deliberately stay on inbound_manifests (migration 0044) — they
-- are not "usual" anything.
--
-- Shape (all keys nullable text, enforced app-side):
--   { transporter_name, transporter_license, driver_name,
--     driver_license_number, vehicle_description, vehicle_plate, vehicle_vin }
--
-- Idempotent + zero-risk: adds two nullable columns only. No backfill, no
-- RLS change (vendors policies already cover all columns), no index needed
-- (always fetched by vendor id).

alter table public.vendors
  add column if not exists usual_transport jsonb,
  add column if not exists usual_transport_updated_at timestamptz;

comment on column public.vendors.usual_transport is
  'Vendor''s usual carrier/driver/vehicle, remembered from their last accepted manifest with transport recorded. Used ONLY to pre-suggest (never auto-commit) transport fields at intake review. Shape owned by src/lib/inventory/vendor-transport-core.ts.';
comment on column public.vendors.usual_transport_updated_at is
  'When usual_transport was last refreshed by an accepted manifest.';
