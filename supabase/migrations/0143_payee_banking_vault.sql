-- =============================================================================
-- Migration 0143 — SLICE 80: Payee banking vault (vendor bank details)
-- =============================================================================
-- Owner's requirement (verbatim intent): "I need a way to add bank details for
-- my vendors that only I the admin can enter and modify. When we marry a
-- payment to its invoice and manifest and purchase order, I want the bank
-- details to fill in automatically and not be allowed to change them. That way
-- we can't marry an invoice to a payment sent to the wrong bank account."
--
-- Industry grounding (WA State Auditor, "Protect your vendor master file from
-- fraudsters", Apr 2023): ACH fraud almost always starts with a bank-detail
-- change on the vendor master file. Controls required: (1) segregate duties —
-- the person paying invoices must NOT be able to edit payee banking; (2) audit
-- every change; (3) verify changes out-of-band before trusting them.
--
-- This migration adds vendor_bank_details — ONE row per vendor, the single
-- source of truth for where that vendor gets paid. Employee banking already
-- lives on public.employees (0057, encrypted, admin-gated by 0130); this table
-- gives vendors the same treatment.
--
-- Security design:
--   * routing/account stored ENCRYPTED at the app layer (at-rest-crypto S-10,
--     encv1: envelope) — same scheme as employee banking.
--   * RLS: is_admin() for EVERYTHING including SELECT. Payables staff
--     (payables.manage includes managers) can PAY to these details via the
--     service role's server-only resolution, but can never read or edit them
--     through the API. Segregation of duties, enforced at the database.
--   * status on_hold: freezes payments to a vendor while a change request is
--     being verified out-of-band (the SAO-recommended callback step).
--   * verified_at / verified_note: records THAT the owner verified the details
--     with the vendor by phone/known contact, and how.
--
-- Money is not stored here. Idempotent: safe to re-run in the Supabase SQL
-- editor. Apply MANUALLY (standing rule). Code ships no-op-safe: before this
-- is applied, the vault page shows a "migration pending" banner and Accounts
-- Payable keeps its legacy manual entry.
-- =============================================================================

create table if not exists public.vendor_bank_details (
  id                  uuid primary key default gen_random_uuid(),
  -- ONE banking record per vendor (unique). Deleting a vendor removes it.
  vendor_id           uuid not null unique references public.vendors (id) on delete cascade,
  -- Snapshot of the vendor's display name at save time (durable for audit).
  vendor_name         text not null default '',
  -- Bank details. routing + account are ENCRYPTED by the app (encv1: envelope)
  -- before they land here; account_type and bank_name are not secrets.
  bank_name           text not null default '',
  bank_routing        text not null default '',
  bank_account_number text not null default '',
  bank_account_type   text not null default 'checking'
                        check (bank_account_type in ('checking', 'savings')),
  -- active: payments may use these details. on_hold: payments to this vendor
  -- are BLOCKED (e.g. a change request arrived and is being verified with the
  -- vendor by phone before being trusted — the anti-fraud callback step).
  status              text not null default 'active'
                        check (status in ('active', 'on_hold')),
  -- Out-of-band verification record: when the owner confirmed these details
  -- with the vendor using a KNOWN contact (not the one in the change request).
  verified_at         timestamptz,
  verified_note       text,
  notes               text,
  created_by          uuid references public.staff_profiles (id) on delete set null,
  updated_by          uuid references public.staff_profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists vendor_bank_details_vendor_idx
  on public.vendor_bank_details (vendor_id);

drop trigger if exists set_updated_at_vendor_bank_details on public.vendor_bank_details;
create trigger set_updated_at_vendor_bank_details
  before update on public.vendor_bank_details
  for each row execute function public.set_updated_at();

-- RLS — ADMIN ONLY for everything, including reads. Managers who pay vendors
-- never see raw banking through the API; the app resolves details server-side
-- and shows only masked tails (••••1234).
alter table public.vendor_bank_details enable row level security;

drop policy if exists vendor_bank_details_admin_read on public.vendor_bank_details;
create policy vendor_bank_details_admin_read on public.vendor_bank_details
  for select using (public.is_admin());

drop policy if exists vendor_bank_details_admin_write on public.vendor_bank_details;
create policy vendor_bank_details_admin_write on public.vendor_bank_details
  for all using (public.is_admin()) with check (public.is_admin());

-- Belt-and-suspenders: revoke direct table access from the API roles; RLS is
-- the gate, this removes even the surface. service_role (server) is unaffected.
revoke all on table public.vendor_bank_details from anon;
revoke all on table public.vendor_bank_details from authenticated;

comment on table public.vendor_bank_details is
  'SLICE 80: admin-only vendor banking vault. One row per vendor; routing/account encrypted (encv1:). Payments RESOLVE details from here server-side — never from form input. on_hold blocks payments pending out-of-band verification (WA SAO anti-fraud guidance).';
