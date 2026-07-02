-- =============================================================================
-- 0067 — Vendor ACH payments tied to an ACCEPTED inbound manifest
-- =============================================================================
-- Owner's requirement (verbatim intent): a vendor ACH payment must be "married"
-- to an ACCEPTED invoice, with guardrails against over/under-paying. In this
-- I-502 back office the authoritative "invoice" is the ACCEPTED inbound manifest
-- (WCIA transfer JSON), because that is where cost basis is captured for CCRS:
--   inventory_lots.unit_cost_minor_units = round((line_price / qty) * 100)
-- and lots link to a manifest via inventory_lots.manifest_id. So the amount OWED
-- for a manifest is:
--   SUM(received_qty * unit_cost_minor_units) over its non-rejected lots (cents).
--
-- There was NO table tracking what we have ALREADY PAID against a manifest, so
-- over/under-pay math had nothing to subtract against. This table fixes that:
-- each row is one payment applied to one manifest (in CENTS, minor units).
--
-- GUARDRAILS (enforced in app logic, see vendor-ach-core.ts):
--   • payment must reference an ACCEPTED manifest
--   • overpay  (paid > owed - already_paid)  = BLOCKED
--   • underpay (0 < paid < remaining)        = allowed WITH WARNING
--
-- DRAFTS-ONLY: recording a payment here logs intent + the generated NACHA batch;
-- nothing is transmitted to a bank. Amounts are CENTS (integer minor units).
--
-- Idempotent: create if not exists + drop policy/trigger if exists. Apply
-- MANUALLY in the Supabase SQL editor.
-- =============================================================================

create table if not exists public.vendor_manifest_payments (
  id                 uuid primary key default gen_random_uuid(),
  -- The ACCEPTED manifest this payment is applied to (the "invoice").
  manifest_id        uuid not null references public.inbound_manifests(id) on delete restrict,
  -- Denormalized for reporting / statements (snapshot at pay time).
  vendor_id          uuid references public.vendors(id) on delete set null,
  vendor_name        text not null default '',
  manifest_number    text not null default '',
  -- Amount applied to this manifest in this payment, in CENTS (> 0).
  amount_minor_units integer not null check (amount_minor_units > 0),
  -- The owed total at pay time (SUM received_qty*unit_cost), for audit trail.
  owed_minor_units   integer not null default 0,
  -- Whether this was flagged as an underpayment (partial) at the time.
  is_partial         boolean not null default false,
  -- The NACHA batch stamp this payment belonged to (draft grouping), if any.
  ach_batch_ref      text,
  note               text,
  created_by         uuid references public.staff_profiles(id) on delete set null,
  created_at         timestamptz not null default now()
);

create index if not exists idx_vendor_manifest_payments_manifest
  on public.vendor_manifest_payments(manifest_id, created_at);

create index if not exists idx_vendor_manifest_payments_vendor
  on public.vendor_manifest_payments(vendor_id, created_at);

-- RLS -------------------------------------------------------------------------
alter table public.vendor_manifest_payments enable row level security;

drop policy if exists "vendor_manifest_payments staff read" on public.vendor_manifest_payments;
create policy "vendor_manifest_payments staff read" on public.vendor_manifest_payments
  for select using (public.is_staff());

drop policy if exists "vendor_manifest_payments admin write" on public.vendor_manifest_payments;
create policy "vendor_manifest_payments admin write" on public.vendor_manifest_payments
  for all using (public.is_admin()) with check (public.is_admin());
