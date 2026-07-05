-- 0081_vendor_contact_address.sql
-- Slice: capture ALL vendor detail from the Cultivera vendor export (Msg L +
-- owner follow-up: "add whatever fields needed to the vendors page, I want all
-- the data"). The prior vendors table (0003) has no home for a vendor number,
-- DBA, shipping/billing address, active flag, or year-to-date accepted totals.
--
-- Standing rules honored:
--   * Idempotent: every ADD is `if not exists` (safe to re-run in SQL editor).
--   * Money in MINOR UNITS: total_accepted_ytd stored as integer CENTS.
--   * No destructive changes; only additive columns on public.vendors.
--
-- Source columns (Greenway_Vendor_Export.xlsx, Cultivera):
--   VendorNo                     -> vendor_number
--   DBA                          -> dba
--   TradeName                    -> display_name (existing)
--   LicenseNo                    -> license_number (existing, 0064)
--   Phone                        -> phone (existing)
--   ShippingAddress1/2/City/State/Zip -> shipping_*
--   BillingAddress1/2/City/State/Zip  -> billing_*
--   BillingAddressSameAsShipping -> billing_same_as_shipping
--   IsActive                     -> is_active
--   TotalAcceptedYtd             -> total_accepted_ytd_cents
--   LastDateAccepted             -> last_accepted_at
--   Id                           -> external_id (Cultivera row id; traceability)

alter table public.vendors add column if not exists vendor_number text;
alter table public.vendors add column if not exists dba text;
alter table public.vendors add column if not exists external_id text;

-- Shipping address
alter table public.vendors add column if not exists shipping_address1 text;
alter table public.vendors add column if not exists shipping_address2 text;
alter table public.vendors add column if not exists shipping_city text;
alter table public.vendors add column if not exists shipping_state text;
alter table public.vendors add column if not exists shipping_zip text;

-- Billing address
alter table public.vendors add column if not exists billing_address1 text;
alter table public.vendors add column if not exists billing_address2 text;
alter table public.vendors add column if not exists billing_city text;
alter table public.vendors add column if not exists billing_state text;
alter table public.vendors add column if not exists billing_zip text;
alter table public.vendors add column if not exists billing_same_as_shipping boolean;

-- Operational facts
alter table public.vendors add column if not exists is_active boolean;
alter table public.vendors add column if not exists total_accepted_ytd_cents bigint;
alter table public.vendors add column if not exists last_accepted_at timestamptz;

-- Helpful lookups for the natural keys used during import / manifests.
create index if not exists vendors_vendor_number_idx on public.vendors (vendor_number);
create index if not exists vendors_external_id_idx on public.vendors (external_id);

comment on column public.vendors.vendor_number is 'Cultivera VendorNo (partner ordering reference).';
comment on column public.vendors.dba is 'Doing-business-as name from Cultivera export.';
comment on column public.vendors.external_id is 'Cultivera source row Id, for import traceability.';
comment on column public.vendors.total_accepted_ytd_cents is 'Year-to-date accepted total in MINOR UNITS (cents).';
comment on column public.vendors.billing_same_as_shipping is 'True when billing address mirrors shipping (per Cultivera flag).';
