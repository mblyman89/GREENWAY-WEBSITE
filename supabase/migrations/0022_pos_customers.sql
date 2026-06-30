-- =============================================================================
-- Migration 0022 — POS Slice 2: Customer & patient records
-- =============================================================================
-- Adds first-class CUSTOMER profiles (recreational) and PATIENT AUTHORIZATIONS
-- (medical), the foundation for loyalty linkage, purchase history, and (later)
-- age / purchase-limit enforcement at the register.
--
-- PII: customers/patient data is STAFF-ONLY. No public read policy. Service-role
-- / app-gated server actions perform writes.
--
-- Reuses: public.set_updated_at(), public.is_staff(), public.staff_profiles,
-- public.loyalty_signups, public.orders.
--
-- Idempotent: safe to run multiple times. Apply manually in the Supabase SQL editor.
-- =============================================================================

-- ── customers ────────────────────────────────────────────────────────────────
create table if not exists public.customers (
  id                 uuid primary key default gen_random_uuid(),
  -- Identity
  first_name         text not null,
  last_name          text,
  -- Contact
  email              text,
  phone              text,
  -- Digits-only normalized phone for dedupe + search (mirrors loyalty_signups).
  phone_normalized   text,
  -- Date of birth (yyyy-mm-dd as captured) — drives the 21+ check at sale time.
  birthdate          text,
  -- Marketing / contact preferences
  marketing_consent  boolean not null default false,
  do_not_contact     boolean not null default false,
  -- Medical flag (true when this customer has an active patient authorization).
  is_medical_patient boolean not null default false,
  -- Optional link back to the loyalty signup this customer was created from.
  loyalty_signup_id  uuid references public.loyalty_signups(id) on delete set null,
  -- Rolled-up lifetime stats (maintained by the sell flow in a later slice;
  -- default 0 so reporting never sees null).
  visit_count        integer not null default 0,
  lifetime_spend_minor_units integer not null default 0,
  last_visit_at      timestamptz,
  -- Free-form staff-only note.
  staff_note         text,
  -- Audit
  created_by         uuid references public.staff_profiles(id) on delete set null,
  updated_by         uuid references public.staff_profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists customers_phone_normalized_idx on public.customers (phone_normalized);
create index if not exists customers_email_idx            on public.customers (lower(email));
create index if not exists customers_last_name_idx        on public.customers (lower(last_name));
create index if not exists customers_loyalty_signup_idx   on public.customers (loyalty_signup_id);

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

-- ── patient_authorizations ──────────────────────────────────────────────────
-- A medical patient's authorization card. A customer may renew over time, so
-- multiple rows can exist; the active one is the latest non-expired record.
create table if not exists public.patient_authorizations (
  id                 uuid primary key default gen_random_uuid(),
  customer_id        uuid not null references public.customers(id) on delete cascade,
  -- Authorization / card identifier as issued.
  authorization_id   text,
  issued_on          date,
  expires_on         date,
  -- Optional medical purchase-limit overrides (interpreted by limit math later).
  notes              text,
  status             text not null default 'active',  -- active | expired | revoked
  -- Audit
  created_by         uuid references public.staff_profiles(id) on delete set null,
  updated_by         uuid references public.staff_profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists patient_auth_customer_idx on public.patient_authorizations (customer_id);
create index if not exists patient_auth_expires_idx  on public.patient_authorizations (expires_on);

drop trigger if exists patient_auth_set_updated_at on public.patient_authorizations;
create trigger patient_auth_set_updated_at
  before update on public.patient_authorizations
  for each row execute function public.set_updated_at();

-- ── optional link: orders → customer ────────────────────────────────────────
-- Web reservations can later be attached to a customer record. Nullable so the
-- existing guest-checkout flow is unaffected.
alter table public.orders
  add column if not exists customer_id uuid references public.customers(id) on delete set null;
create index if not exists orders_customer_idx on public.orders (customer_id);

-- =============================================================================
-- Row-Level Security — STAFF ONLY (PII). No public policies.
-- =============================================================================
alter table public.customers              enable row level security;
alter table public.patient_authorizations enable row level security;

drop policy if exists customers_staff_all on public.customers;
create policy customers_staff_all on public.customers
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists patient_auth_staff_all on public.patient_authorizations;
create policy patient_auth_staff_all on public.patient_authorizations
  for all using (public.is_staff()) with check (public.is_staff());
